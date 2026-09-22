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
	const { id } = await api("/api/chat/new");
	await selectSession(id);
	return id;
}

async function selectSession(id) {
	chat.sessionId = id;
	chat.lastSeq = 0;
	chat.seen = new Set();
	chat$("#chat-messages").innerHTML = "";
	await api("/api/chat/resume", { id });
	const { events } = await (await fetch(`/api/chat/history?id=${id}`)).json();
	for (const rec of events) replayEvent(rec);
	openSSE();
	setStatus("就绪");
	loadSessionList();
}

function openSSE() {
	if (chat.es) chat.es.close();
	const es = new EventSource(`/api/chat/events?id=${chat.sessionId}&since=${chat.lastSeq}`);
	chat.es = es;
	es.onmessage = (msg) => {
		let rec;
		try { rec = JSON.parse(msg.data); } catch { return; }
		handleRec(rec);
	};
	es.onerror = () => setStatus("连接中断,重连中…");
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
			chat$.querySelector("#btn-chat-send").disabled = false;
			chat$("#btn-chat-stop").classList.add("hidden");
			finalizeStream();
			return setStatus("就绪");
		case "agent_start":
			chat.busy = true;
			chat$.querySelector("#btn-chat-send").disabled = true;
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
	// 注意:extension_ui_request 是一次性交互,不回放(旧审批弹层不应重现)
}

const isDialog = (ev) => ["select", "confirm", "input", "editor"].includes(ev.method);

function onDelta(ev) {
	const d = ev.assistantMessageEvent ?? {};
	if (d.type === "text_delta") {
		if (!chat.streamEl) newAssistantBubble();
		chat.streamBuf += d.delta;
		chat.streamEl.querySelector(".bubble-text").textContent = chat.streamBuf;
		scrollBottom();
	} else if (d.type === "thinking_delta") {
		chat.thinkingBuf += d.delta;
	}
}

function onMessageEnd(ev, replay = false) {
	const m = ev.message ?? {};
	if (m.role === "user") {
		const text = contentText(m);
		if (text) addBubble("user", text);
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
	if (typeof text === "string") chat.streamEl.querySelector(".bubble-text").textContent = text;
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

function onToolStart(ev) {
	const row = document.createElement("div");
	row.className = "tool-row";
	row.id = `tool-${ev.toolCallId}`;
	row.textContent = `⚙ ${ev.toolName} ${summarizeArgs(ev.args)}`;
	chat$("#chat-messages").appendChild(row);
	scrollBottom();
}

function onToolEnd(ev, replay = false) {
	const row = chat$(`#tool-${CSS.escape(ev.toolCallId)}`) ?? document.createElement("div");
	row.className = "tool-row done";
	row.textContent = `⚙ ${ev.toolName} ${ev.isError ? "· ❌" : "· ✅"}`;
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

function summarizeArgs(args) {
	if (!args) return "";
	const s = JSON.stringify(args);
	return s.length > 80 ? s.slice(0, 77) + "…" : s;
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

// ---------------- 发送/停止 ----------------
async function sendMessage() {
	const input = chat$("#chat-input");
	const text = input.value.trim();
	if (!text) return;
	try {
		await ensureSession();
		addBubble("user", text);
		input.value = "";
		const r = await fetch("/api/chat/message", {
			method: "POST", headers: { "content-type": "application/json" },
			body: JSON.stringify({ id: chat.sessionId, text }),
		});
		if (r.status === 409) {
			addBubble("assistant", "⏳ 上一个任务还在进行中,请稍候或点「停止」。");
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
	const { id } = await api("/api/chat/new");
	await selectSession(id);
});
chat$("#btn-chat-stop").addEventListener("click", () => api("/api/chat/abort", { id: chat.sessionId }));
chat$("#chat-sessions").addEventListener("change", async (e) => {
	if (e.target.value) await selectSession(e.target.value);
});

loadSessionList();
// 执行标记:便于自动化/诊断确认本脚本已完整执行
document.title = "Pierfume · 调香师副驾驶 ✓";
