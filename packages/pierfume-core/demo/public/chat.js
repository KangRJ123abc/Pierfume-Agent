/* Pierfume 对话页:pi RPC 桥(SSE 事件流 + 审批弹层 + 数据卡片) */
const chat$ = (sel) => document.querySelector(sel);
const chatEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
window.addEventListener("error", (e) => {
	const el = document.querySelector("#chat-status");
	if (el) el.textContent = `JS 错误: ${e.message} @ ${(e.filename ?? "").split("/").pop()}:${e.lineno}`;
});
window.addEventListener("unhandledrejection", (e) => {
	const el = document.querySelector("#chat-status");
	if (el) el.textContent = `请求失败: ${e.reason?.message ?? e.reason}`;
});

const chat = {
	sessionId: null,
	lastSeq: 0,
	seen: new Set(),
	es: null,
	busy: false,
	streamEl: null,
	streamBuf: "",
	thinkingBuf: "",
	pendingEchoes: [], // 本地已即时渲染的用户消息,等待服务端 message_end 回显时去重
	toolArgs: new Map(), // toolCallId → args(tool_execution_end 不带参数,从 start 事件缓存)
};

const CHAT_STATUS_COLOR = { draft: "#8d7f68", reviewed: "#3a6ea5", approved: "#3d7a4e", archived: "#999" };
const chatStatusPill = (s) => `<span class="status-pill" style="background:${CHAT_STATUS_COLOR[s] ?? "#8d7f68"}">${chatEsc(s ?? "?")}</span>`;

// ---------------- 会话管理 ----------------
async function api(path, body) {
	const r = await fetch(path, body === undefined ? {} : {
		method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
	});
	return r.json();
}

async function loadSessionList() {
	const { sessions } = await api("/api/chat/list");
	const sel = chat$("#chat-sessions");
	sel.innerHTML = `<option value="">会话(${sessions.length})…</option>` +
		sessions.map((s) => `<option value="${chatEsc(s.id)}">${chatEsc(s.name || s.id)}${s.dead ? " ·已退出" : ""}</option>`).join("");
	if (chat.sessionId) sel.value = chat.sessionId;
}

async function ensureSession() {
	if (chat.sessionId) return chat.sessionId;
	const { id } = await api("/api/chat/new", {});
	if (!id) throw new Error("服务器未返回会话 id");
	await selectSession(id);
	return id;
}

async function selectSession(id) {
	if (typeof id !== "string" || !id) {
		setStatus("会话 id 无效(创建失败?)");
		return;
	}
	chat.sessionId = id;
	chat.lastSeq = 0;
	chat.seen = new Set();
	chat$("#chat-messages").innerHTML = "";
	try {
		await api("/api/chat/resume", { id });
	} catch {
		/* 会话可能已在内存,继续 */
	}
	let events = [];
	try {
		const { events: evs } = await (await fetch(`/api/chat/history?id=${id}`)).json();
		events = Array.isArray(evs) ? evs : [];
	} catch {
		/* 历史损坏不阻塞换会话 */
	}
	for (const rec of events) {
		try {
			replayEvent(rec);
		} catch {
			/* 单条坏事件跳过 */
		}
	}
	openSSE();
	setStatus(chat.busy ? "思考中…" : "就绪");
	loadSessionList();
}

function openSSE() {
	if (chat.es) chat.es.close();
	const es = new EventSource(`/api/chat/events?id=${chat.sessionId}&since=${chat.lastSeq}`);
	chat.es = es;
	let errors = 0;
	es.onopen = () => {
		errors = 0;
		// 重连成功后必须刷新状态文本,否则"连接中断,重连中…"会永久残留(状态只在出错时写,成功时从不复位)
		setStatus(chat.busy ? "思考中…" : "就绪");
	};
	es.onmessage = (msg) => {
		errors = 0;
		let rec;
		try { rec = JSON.parse(msg.data); } catch { return; }
		handleRec(rec);
	};
	es.onerror = () => {
		errors++;
		if (errors <= 3) {
			setStatus("连接中断,重连中…");
			return;
		}
		// 连续失败:停止无意义重连(避免僵尸连接占满浏览器连接数),提示手动恢复
		es.close();
		setStatus("连接无法恢复,请重新选择会话或新建会话");
	};
}

function setStatus(t) { chat$("#chat-status").textContent = t; }

// ---------------- 事件处理 ----------------
function handleRec(rec) {
	if (!rec || rec.seq === undefined) {
		if (rec?.type === "chat_dead") setStatus("会话已退出");
		return;
	}
	chat.lastSeq = Math.max(chat.lastSeq, rec.seq);
	if (chat.seen.has(rec.seq)) return;
	const ev = rec.event ?? rec;
	switch (ev.type) {
		case "message_update": return onDelta(ev);
		case "message_end": return onMessageEnd(ev);
		case "tool_execution_start": return onToolStart(ev);
		case "tool_execution_end": return onToolEnd(ev);
		case "extension_ui_request": return onUiRequest(ev);
		case "agent_settled":
			chat.busy = false;
			chat$("#btn-chat-send").disabled = false;
			chat$("#btn-chat-stop").classList.add("hidden");
			finalizeStream();
			return setStatus("就绪");
		case "agent_start":
			chat.busy = true;
			chat$("#btn-chat-send").disabled = true;
			chat$("#btn-chat-stop").classList.remove("hidden");
			return setStatus("思考中…");
	}
}

function replayEvent(rec) {
	if (rec.seq !== undefined) {
		chat.lastSeq = Math.max(chat.lastSeq, rec.seq);
		if (chat.seen.has(rec.seq)) return;
		chat.seen.add(rec.seq);
	}
	const ev = rec.event ?? rec;
	if (ev.type === "message_end") onMessageEnd(ev, true);
	else if (ev.type === "tool_execution_end") onToolEnd(ev, true);
	// start 事件不渲染,但其参数要缓存(终态 end 事件不带 args,重放时靠它补全工具行细节)
	else if (ev.type === "tool_execution_start") chat.toolArgs.set(ev.toolCallId, ev.args ?? null);
	// 注意:extension_ui_request 是一次性交互,不回放(旧审批弹层不应重现)
}

const isDialog = (ev) => ["select", "confirm", "input", "editor"].includes(ev.method);

function onDelta(ev) {
	const d = ev.assistantMessageEvent ?? {};
	if (d.type === "text_delta") {
		if (!chat.streamEl) newAssistantBubble();
		chat.streamBuf += d.delta;
		chat.streamEl.querySelector(".bubble-text").innerHTML = chatRenderMd(chat.streamBuf);
		scrollBottom();
	} else if (d.type === "thinking_delta") {
		chat.thinkingBuf += d.delta;
	}
}

function onMessageEnd(ev, replay = false) {
	const m = ev.message ?? {};
	if (m.role === "user") {
		const text = contentText(m);
		if (text) {
			// 本地发送时已即时渲染(见 sendMessage),服务端 message_end 回显需去重;
			// 页面重放(replay)时 pendingEchoes 为空,正常渲染
			const i = chat.pendingEchoes.indexOf(text);
			if (i >= 0) chat.pendingEchoes.splice(i, 1);
			else addBubble("user", text);
		}
		return;
	}
	if (m.role !== "assistant") return;
	const text = contentText(m);
	const thinking = (m.content ?? []).find((b) => b.type === "thinking")?.thinking ?? chat.thinkingBuf;
	if (chat.streamEl && !replay) {
		finalizeStream(text, thinking);
	} else if (replay) {
		newAssistantBubble();
		finalizeStream(text, thinking);
	}
}

function finalizeStream(text, thinking) {
	if (!chat.streamEl) return;
	if (typeof text === "string") chat.streamEl.querySelector(".bubble-text").innerHTML = chatRenderMd(text);
	if (thinking) {
		chat.streamEl.insertAdjacentHTML("beforeend",
			`<details class="thinking"><summary>思考过程</summary><pre>${chatEsc(thinking.slice(0, 4000))}</pre></details>`);
	}
	chat.streamEl.classList.remove("streaming");
	chat.streamEl = null;
	chat.streamBuf = "";
	chat.thinkingBuf = "";
	scrollBottom();
}

// Markdown 渲染(markdown.js 的 window.mdToHtml;流式中围栏未闭合时临时补收尾,避免半块代码不渲染)
function chatRenderMd(text) {
	let src = String(text ?? "");
	if (((src.match(/```/g) ?? []).length % 2) === 1) src += "\n```";
	return window.mdToHtml ? window.mdToHtml(src) : chatEsc(src);
}

function onToolStart(ev) {
	const row = document.createElement("div");
	row.className = "tool-row";
	row.id = `tool-${ev.toolCallId}`;
	chat.toolArgs.set(ev.toolCallId, ev.args ?? null);
	row.textContent = `${friendlyToolLine(ev.toolName, ev.args)}…`;
	chat$("#chat-messages").appendChild(row);
	scrollBottom();
}

function onToolEnd(ev, replay = false) {
	const args = ev.args ?? chat.toolArgs.get(ev.toolCallId);
	chat.toolArgs.delete(ev.toolCallId);
	const row = chat$(`#tool-${CSS.escape(ev.toolCallId)}`) ?? document.createElement("div");
	row.className = "tool-row done";
	row.textContent = `${friendlyToolLine(ev.toolName, args)} ${ev.isError ? "· ❌" : "· ✅"}`;
	const card = cardFromDetails(ev.result?.details, ev.toolName);
	if (card) row.appendChild(card);
	if (!row.parentElement) chat$("#chat-messages").appendChild(row);
	scrollBottom();
}

function onUiRequest(ev, replay = false) {
	if (!isDialog(ev)) return; // notify/setStatus 等忽略
	showApproval(ev);
}

// ---------------- UI 构件 ----------------
function contentText(m) {
	if (typeof m.content === "string") return m.content;
	return (m.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

// 工具行的领域友好展示:调香师不需要看工具名和 JSON 参数
const TOOL_LABELS = {
	read: "读取文件", write: "写入文件", edit: "编辑文件", bash: "执行命令",
	material_get: "查询原料", formula_get: "读取配方", material_alternatives: "同香型替换建议",
	formula_save: "保存配方", formula_lint: "校验配方", ifra_check: "IFRA 合规检查",
	ifra_headroom: "合规余量计算", formula_diff: "配方对比", material_add: "添加原料",
	material_update: "校正原料", formula_heatmap: "生成配方热图",
};

// 路径缩写:能相对到仓库根就相对,否则取末两段,超长加省略号
function shortenPath(p) {
	const s = String(p ?? "").replace(/\\/g, "/");
	if (!s) return "";
	const anchor = "Pierfume_Agent/";
	const i = s.indexOf(anchor);
	const rel = i >= 0 ? s.slice(i + anchor.length) : s.split("/").slice(-2).join("/");
	return rel.length > 44 ? "…" + rel.slice(-43) : rel;
}

function friendlyToolLine(name, args) {
	const label = TOOL_LABELS[name] ?? name;
	let detail = "";
	try {
		const a = args ?? {};
		if (name === "read" || name === "write" || name === "edit") detail = shortenPath(a.path);
		else if (name === "material_get" || name === "material_update" || name === "material_alternatives") detail = a.id ?? a.material_ref ?? "";
		else if (name === "material_add") {
			const items = Array.isArray(a.items) ? a.items : [];
			const names = items.map((x) => x?.name ?? x?.cid).filter(Boolean);
			detail = names.slice(0, 3).join("、") + (names.length > 3 ? ` 等 ${names.length} 项` : "");
		}
		else if (name === "formula_heatmap") detail = `${(a.paths ?? []).length || ""} 个配方`;
		else if (name === "formula_diff") detail = "两版对比";
		else if (typeof a.path === "string") detail = shortenPath(a.path);
		else if (typeof a.id === "string") detail = a.id;
	} catch {
		/* 参数形状异常时只显示标签 */
	}
	return `⚙ ${label}${detail ? ` · ${detail}` : ""}`;
}

function addBubble(role, text) {
	const div = document.createElement("div");
	div.className = `bubble ${role}`;
	div.innerHTML = `<div class="bubble-text"></div>`;
	div.querySelector(".bubble-text").textContent = text;
	chat$("#chat-messages").appendChild(div);
	scrollBottom();
	return div;
}

function newAssistantBubble() {
	chat.streamEl = addBubble("assistant", "");
	chat.streamEl.classList.add("streaming");
	chat.streamBuf = "";
	return chat.streamEl;
}

function scrollBottom() {
	const box = chat$("#chat-messages");
	box.scrollTop = box.scrollHeight;
}

// 审批弹层
function showApproval(ev) {
	const overlay = document.createElement("div");
	overlay.className = "modal-overlay";
	let body = "";
	if (ev.method === "confirm") {
		body = `<pre class="modal-msg">${chatEsc(ev.message ?? "")}</pre>
			<div class="modal-actions">
			<button class="btn primary" data-r="confirmed:true">批准</button>
			<button class="btn ghost" data-r="confirmed:false">拒绝</button></div>`;
	} else if (ev.method === "select") {
		body = `<div class="modal-actions">${(ev.options ?? []).map((o) => `<button class="btn ghost" data-r='${chatEsc(JSON.stringify({ value: o }))}'>${chatEsc(o)}</button>`).join("")}</div>
			<div class="modal-actions"><button class="btn ghost" data-r="cancelled:true">取消</button></div>`;
	} else if (ev.method === "input") {
		body = `<input class="modal-input" placeholder="${chatEsc(ev.placeholder ?? "")}">
			<div class="modal-actions"><button class="btn primary" data-r="input">提交</button>
			<button class="btn ghost" data-r="cancelled:true">取消</button></div>`;
	} else if (ev.method === "editor") {
		body = `<textarea class="modal-input" rows="8">${chatEsc(ev.prefill ?? "")}</textarea>
			<div class="modal-actions"><button class="btn primary" data-r="input">提交</button>
			<button class="btn ghost" data-r="cancelled:true">取消</button></div>`;
	}
	overlay.innerHTML = `<div class="modal"><h3>${chatEsc(ev.title ?? "需要你的确认")}</h3>${body}</div>`;
	document.body.appendChild(overlay);
	overlay.querySelectorAll("[data-r]").forEach((btn) => btn.addEventListener("click", async () => {
		const spec = btn.dataset.r;
		let payload;
		if (spec === "input") {
			const field = overlay.querySelector(".modal-input");
			payload = { value: field.value };
		} else if (spec === "cancelled:true") {
			payload = { cancelled: true };
		} else if (spec.startsWith("{")) {
			payload = JSON.parse(spec);
		} else {
			payload = { [spec.split(":")[0]]: spec.split(":")[1] === "true" };
		}
		await api("/api/chat/respond", { id: chat.sessionId, reqId: ev.id, ...payload });
		overlay.remove();
	}));
}

// ---------------- 数据卡片 ----------------
function cardFromDetails(d, toolName) {
	if (!d || typeof d !== "object") return null;
	if (d.kind === "material") return materialCard(d.data);
	if (d.kind === "formula") return formulaCard(d);
	if (d.kind === "headroom") return headroomCard(d);
	if (d.kind === "alternatives") return alternativesCard(d);
	if (d.kind === "save") return saveCard(d);
	if (d.kind === "heatmap") return heatmapCard(d);
	if (d.kind === "material-save") return materialSaveCard(d);
	return null;
}

function materialCard(m) {
	const verified = m.provenance?.humanVerified;
	const div = document.createElement("div");
	div.className = "data-card";
	div.innerHTML = `
		<div class="card-head"><strong>${chatEsc(m.name)}</strong>
			<span class="muted small">CAS ${chatEsc(m.cas)}</span>
			${verified ? `<span class="status-pill" style="background:#3d7a4e">✅ 人工核对</span>` : `<span class="status-pill" style="background:#b03a2c">⚠️ 未核对</span>`}
		</div>
		<div class="muted small">${(m.family ?? []).map((f) => `<span class="chip"><i class="dot" style="background:#c9a227"></i>${chatEsc(f)}</span>`).join(" ")} · ${chatEsc(m.note ?? "")}香 · 气味:${chatEsc(m.odor ?? "—")}</div>
		${m.ifraEntryRef ? `<div class="muted small">IFRA 条目:${chatEsc(m.ifraEntryRef)}</div>` : `<div class="muted small">无 IFRA 条目</div>`}`;
	return div;
}

function formulaCard(d) {
	const div = document.createElement("div");
	div.className = "data-card";
	const max = Math.max(...(d.ingredients ?? []).map((i) => i.pct), 1);
	const rows = (d.ingredients ?? []).map((i) =>
		`<div class="ingredient"><div class="name">${chatEsc(i.materialRef)}${i.name ? `<small>${chatEsc(i.name)}</small>` : ""}</div>
		<div class="bar"><i style="width:${(i.pct / max) * 100}%"></i></div><div class="pct">${i.pct}%</div></div>`).join("");
	div.innerHTML = `
		<div class="card-head"><strong>${chatEsc(d.meta?.name ?? d.path)}</strong>
			<span class="muted small">${chatEsc(d.meta?.id ?? "")}</span>${chatStatusPill(d.meta?.status)}
		</div>
		<div class="muted small">Category ${chatEsc(d.product?.category ?? "?")} · 添加量 ${d.product?.fragranceUseLevelPct ?? 100}%</div>
		${rows}
		<div class="muted small">lint ${d.lint?.ok ? "✅" : "❌"} · ifra ${d.ifra ? (d.ifra.ok ? "✅ 合规" : `❌ ${d.ifra.violationCount} 项违规`) : "—"}</div>`;
	return div;
}

function headroomCard(d) {
	const div = document.createElement("div");
	div.className = "data-card";
	const rows = (d.rows ?? []).map((r) => {
		const cell = r.maxAddPct === null ? "—" : r.maxAddPct <= 0 ? `<span style="color:#b03a2c">${r.maxAddPct}</span>` : `+${r.maxAddPct}`;
		return `<tr><td>${chatEsc(r.materialRef)}</td><td class="num">${r.currentPct}%</td><td class="num">${r.limitPct ?? "—"}</td><td class="num">${cell}</td></tr>`;
	}).join("");
	div.innerHTML = `
		<div class="card-head"><strong>合规余量</strong><span class="muted small">Category ${chatEsc(d.rows?.length ? "" : "")} 总量余量 ${d.maxAddBySum ?? "—"}%</span></div>
		<table class="report"><tr><th>原料</th><th>现用量</th><th>限量</th><th>最多再加</th></tr>${rows}</table>`;
	return div;
}

function alternativesCard(d) {
	const div = document.createElement("div");
	div.className = "data-card";
	div.innerHTML = `
		<div class="card-head"><strong>${chatEsc(d.target?.name ?? d.target?.id)}</strong><span class="muted small">同香型候选</span></div>
		<div>${(d.candidates ?? []).map((c) => `<span class="chip" title="${chatEsc(c.odor ?? "")}"><i class="dot" style="background:#c9a227"></i>${chatEsc(c.id)} <small>${chatEsc((c.family ?? []).join("/"))}</small></span>`).join(" ") || '<span class="muted small">无候选</span>'}</div>`;
	return div;
}

function saveCard(d) {
	const div = document.createElement("div");
	div.className = "data-card";
	div.innerHTML = `
		<div class="card-head"><strong>${chatEsc(d.path)}</strong>
			${d.written ? '<span class="status-pill" style="background:#3d7a4e">已写入</span>' : d.cancelled ? '<span class="status-pill" style="background:#8d7f68">已取消</span>' : '<span class="status-pill" style="background:#b03a2c">未写入</span>'}
			${d.meta ? chatStatusPill(d.meta.status) : ""}
		</div>
		${d.diff ? `<div class="muted small">变更:调 ${d.diff.changed.length} / 增 ${d.diff.added.length} / 删 ${d.diff.removed.length}</div>` : ""}
		<div class="muted small">lint ${d.lint?.ok ? "✅" : "❌"} · ifra ${d.ifra ? (d.ifra.ok ? "✅" : `❌ ${d.ifra.violationCount} 项违规`) : "—"}</div>`;
	return div;
}

// 配方热图卡片:details.kind === "heatmap"(formula_heatmap 工具,纯手写 SVG,无图表库)
// 行 = 配方 label,列 = 原料 name(后端已按总用量降序);单元格色阶 0→透明,越大越深
function heatmapCard(d) {
	const div = document.createElement("div");
	div.className = "data-card heatmap-card";
	if (!d.ok) {
		div.innerHTML = `<div class="card-head"><strong>配方热图</strong><span class="status-pill bad">生成失败</span></div>
			<div class="error-box">${(d.errors ?? []).map(chatEsc).join("<br>")}</div>`;
		return div;
	}
	const mats = d.materials ?? [];
	const rows = d.rows ?? [];
	if (!mats.length || !rows.length) {
		div.innerHTML = `<div class="card-head"><strong>配方热图</strong></div><p class="muted small">无数据。</p>`;
		return div;
	}
	const max = Math.max(1, ...rows.flatMap((r) => (r.values ?? []).filter((v) => typeof v === "number")));
	const labelW = 150, cellW = 56, headH = 104, cellH = 30, pad = 4;
	const w = labelW + mats.length * cellW + pad;
	const h = headH + rows.length * cellH + pad;
	const NS = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(NS, "svg");
	svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
	svg.setAttribute("class", "heatmap-svg");
	// 列表头(斜排原料名)
	mats.forEach((m, j) => {
		const x = labelW + j * cellW + cellW / 2;
		const text = document.createElementNS(NS, "text");
		text.setAttribute("class", "hm-head");
		text.setAttribute("transform", `translate(${x},${headH - 10}) rotate(-45)`);
		const short = (m.name ?? m.id).length > 20 ? (m.name ?? m.id).slice(0, 19) + "…" : (m.name ?? m.id);
		text.textContent = short;
		const t = document.createElementNS(NS, "title");
		t.textContent = m.name ?? m.id;
		text.appendChild(t);
		svg.appendChild(text);
	});
	// 行
	rows.forEach((r, i) => {
		const y = headH + i * cellH;
		const short = String(r.label ?? `row-${i + 1}`);
		const label = document.createElementNS(NS, "text");
		label.setAttribute("class", "hm-rowlabel");
		label.setAttribute("x", labelW - 8);
		label.setAttribute("y", y + cellH / 2 + 4);
		label.setAttribute("text-anchor", "end");
		label.textContent = short.length > 22 ? short.slice(0, 21) + "…" : short;
		const lt = document.createElementNS(NS, "title");
		lt.textContent = short;
		label.appendChild(lt);
		svg.appendChild(label);
		(r.values ?? []).forEach((v, j) => {
			const rect = document.createElementNS(NS, "rect");
			rect.setAttribute("x", labelW + j * cellW);
			rect.setAttribute("y", y);
			rect.setAttribute("width", cellW - 1.5);
			rect.setAttribute("height", cellH - 1.5);
			rect.setAttribute("rx", 3);
			rect.setAttribute("class", "hm-cell");
			if (v === null || v === undefined) {
				rect.setAttribute("fill", "#efe7d6"); // 该配方不含此原料
			} else if (v <= 0) {
				rect.setAttribute("fill", "#faf6ec");
			} else {
				rect.setAttribute("fill", `rgba(169,116,28,${(0.16 + 0.72 * (v / max)).toFixed(3)})`);
			}
			const title = document.createElementNS(NS, "title");
			title.textContent = v === null || v === undefined ? `${r.label} × ${mats[j].name} = 不含` : `${r.label} × ${mats[j].name} = ${v}%`;
			rect.appendChild(title);
			svg.appendChild(rect);
			if (typeof v === "number" && v > 0) {
				const tv = document.createElementNS(NS, "text");
				tv.setAttribute("class", `hm-val${v / max <= 0.45 ? " dim" : ""}`);
				tv.setAttribute("x", labelW + j * cellW + (cellW - 1.5) / 2);
				tv.setAttribute("y", y + cellH / 2 + 3.5);
				tv.textContent = String(Math.round(v * 100) / 100);
				svg.appendChild(tv);
			}
		});
	});
	const head = document.createElement("div");
	head.className = "card-head";
	head.innerHTML = `<strong>配方热图</strong><span class="muted small">${rows.length} 个配方 × ${mats.length} 种原料(列按总用量降序,悬停看数值)</span>`;
	div.appendChild(head);
	div.appendChild(svg);
	return div;
}

// 原料写入结果卡片:details.kind === "material-save"(material_add / material_update 工具)
function materialSaveCard(d) {
	const div = document.createElement("div");
	div.className = "data-card mat-save-card";
	let head = "";
	let body = "";
	if (d.written && Array.isArray(d.materials)) {
		div.classList.add("save-ok");
		head = `<strong>已写入 ${d.materials.length} 个原料</strong><span class="status-pill" style="background:#3d7a4e">✅ 已写入</span>`;
		body = `<table class="report"><tr><th>id</th><th>名称</th><th>CID</th><th>CAS</th></tr>` +
			d.materials.map((m) => `<tr><td>${chatEsc(m.id)}</td><td>${chatEsc(m.name ?? "")}</td><td class="num">${chatEsc(String(m.cid ?? "—"))}</td><td class="num">${chatEsc(m.cas ?? "—")}</td></tr>`).join("") +
			`</table>` +
			(d.warnings?.length ? `<ul class="notices">${d.warnings.map((x) => `<li>⚠️ ${chatEsc(x)}</li>`).join("")}</ul>` : "") +
			(d.failures?.length ? `<ul class="notices">${d.failures.map((x) => `<li>❌ 解析失败:${chatEsc(x)}</li>`).join("")}</ul>` : "");
	} else if (d.written && d.id) {
		// material_update:单条校正,展示 before → after
		div.classList.add("save-ok");
		head = `<strong>已校正原料 ${chatEsc(d.id)}</strong><span class="status-pill" style="background:#3d7a4e">✅ 已写入</span>`;
		const keys = Object.keys(d.after ?? {});
		body = `<table class="report"><tr><th>字段</th><th>旧值</th><th>新值</th></tr>` +
			keys.map((k) => {
				const o = JSON.stringify(d.before?.[k] ?? null);
				const n = JSON.stringify(d.after?.[k] ?? null);
				return o === n ? "" : `<tr><td>${chatEsc(k)}</td><td class="num">${chatEsc(o)}</td><td class="num">${chatEsc(n)}</td></tr>`;
			}).join("") + `</table>` +
			`<p class="muted small">humanVerified 已重置为 false,须重新人工核对。</p>`;
	} else if (d.cancelled) {
		div.classList.add("save-cancel");
		head = `<strong>已取消</strong><span class="status-pill" style="background:#8d7f68">未写入</span>`;
		body = `<p class="muted small">用户拒绝了本次写入,原料库未改动。</p>`;
	} else {
		div.classList.add("save-bad");
		head = `<strong>${d.rolledBack ? "写入后校验失败,已回滚" : "未写入"}</strong><span class="status-pill bad">❌</span>`;
		body = `<ul class="notices">${(d.errors ?? ["未知错误"]).map((x) => `<li>${chatEsc(x)}</li>`).join("")}</ul>`;
	}
	div.innerHTML = `<div class="card-head">${head}</div>${body}`;
	return div;
}

// ---------------- 发送/停止 ----------------
async function sendMessage() {
	const input = chat$("#chat-input");
	const text = input.value.trim();
	if (!text) return;
	try {
		await ensureSession();
		addBubble("user", text);
		chat.pendingEchoes.push(text);
		if (chat.pendingEchoes.length > 20) chat.pendingEchoes.shift();
		input.value = "";
		let r = await fetch("/api/chat/message", {
			method: "POST", headers: { "content-type": "application/json" },
			body: JSON.stringify({ id: chat.sessionId, text }),
		});
		if (r.status === 410) {
			// 会话不在内存(如服务器重启):恢复一次并重发
			await api("/api/chat/resume", { id: chat.sessionId });
			r = await fetch("/api/chat/message", {
				method: "POST", headers: { "content-type": "application/json" },
				body: JSON.stringify({ id: chat.sessionId, text }),
			});
		}
		if (r.status === 409) {
			addBubble("assistant", "⏳ 上一个任务还在进行中,请稍候或点「停止」。");
		} else if (!r.ok) {
			addBubble("assistant", `❌ 发送失败(HTTP ${r.status}),请新建会话重试。`);
		}
	} catch (e) {
		setStatus(`发送失败: ${e.message}`);
	}
}

chat$("#btn-chat-send").addEventListener("click", sendMessage);
chat$("#chat-input").addEventListener("keydown", (e) => {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		sendMessage();
	}
});
chat$("#btn-chat-new").addEventListener("click", async () => {
	try {
		const { id } = await api("/api/chat/new", {});
		if (!id) throw new Error("服务器未返回会话 id");
		await selectSession(id);
	} catch (e) {
		setStatus(`新建会话失败: ${e instanceof Error ? e.message : e}`);
	}
});
chat$("#btn-chat-stop").addEventListener("click", () => api("/api/chat/abort", { id: chat.sessionId }));
chat$("#chat-sessions").addEventListener("change", async (e) => {
	if (e.target.value) await selectSession(e.target.value);
});

loadSessionList();
// 执行标记:便于自动化/诊断确认本脚本已完整执行
document.title = "Pierfume · 调香师副驾驶 ✓";
