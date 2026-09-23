/* Pierfume 配方库 / 配方详情 / 新建配方 / 香调轮盘(P2+P3 前端页面)。
 * 依赖 app.js 先加载:复用全局 $ / esc / showTab / statusPill / famColor / refreshLibrarySelect / jsYamlLite。
 * 注意:经典 <script> 共享全局作用域,本文件所有顶层标识符一律 lib/wheel 前缀,避免与 app.js/chat.js 重名导致静默失效。
 */

const LIB_ACCORDS = [
	{ id: "floral", zh: "花香" }, { id: "oriental", zh: "东方" }, { id: "woody", zh: "木质" },
	{ id: "leather", zh: "皮革" }, { id: "chypre", zh: "西普" }, { id: "fougere", zh: "馥奇" },
	{ id: "aromatic", zh: "芳香" }, { id: "green", zh: "绿叶" }, { id: "aquatic", zh: "水生" },
	{ id: "citrus", zh: "柑橘" }, { id: "gourmand", zh: "美食" }, { id: "fruity", zh: "果香" },
];
const libAccordZh = (id) => (LIB_ACCORDS.find((a) => a.id === id)?.zh ?? id ?? "—");
const LIB_TIERS = ["top", "heart", "base"];
const LIB_TIER_LABEL = { top: "前调", heart: "中调", base: "后调" };
const LIB_EXAMPLES = ["formula.example.yaml", "formula.citrus-cologne.yaml", "formula.musk-amber.yaml"];
// 香调 → 原料 family 词表(leather≈leathery;chypre/fougere/aromatic 无对应 family,只显示配方)
const WHEEL_FAMILY = {
	floral: "floral", oriental: "oriental", woody: "woody", leather: "leathery",
	green: "green", aquatic: "aquatic", citrus: "citrus", gourmand: "gourmand", fruity: "fruity",
};

const libMatCache = { loaded: false, list: [], byId: {} };
const libState = { recipes: [], recipesLoaded: false };

async function libFetchJson(url, options) {
	const r = await fetch(url, options);
	const data = await r.json().catch(() => ({}));
	if (!r.ok) {
		const err = new Error(data.error ?? (Array.isArray(data.errors) ? data.errors.join("; ") : `HTTP ${r.status}`));
		err.status = r.status;
		err.data = data;
		throw err;
	}
	return data;
}

async function libEnsureMaterials() {
	if (libMatCache.loaded) return libMatCache;
	const { materials } = await libFetchJson("/api/materials");
	libMatCache.list = materials ?? [];
	libMatCache.byId = Object.fromEntries(libMatCache.list.map((m) => [m.id, m]));
	libMatCache.loaded = true;
	return libMatCache;
}

async function libEnsureRecipes(force = false) {
	if (libState.recipesLoaded && !force) return libState.recipes;
	const data = await libFetchJson("/api/library");
	libState.recipes = data.recipes ?? [];
	libState.recipesLoaded = true;
	return libState.recipes;
}

function libMatName(id) { return libMatCache.byId[id]?.name ?? id; }

// ---------------- 原料资料卡(模态子窗口)----------------
async function libShowMaterial(id) {
	let m = libMatCache.byId[id];
	try {
		const data = await libFetchJson(`/api/material?id=${encodeURIComponent(id)}`);
		m = data.material;
	} catch (e) {
		if (!m) {
			const overlay = document.createElement("div");
			overlay.className = "modal-overlay";
			overlay.innerHTML = `<div class="modal"><h3>原料不存在</h3><p class="muted">${esc(id)}:${esc(e.message)}</p>
				<div class="modal-actions"><button class="btn ghost" data-close>关闭</button></div></div>`;
			document.body.appendChild(overlay);
			overlay.addEventListener("click", (ev) => { if (ev.target === overlay || ev.target.hasAttribute("data-close")) overlay.remove(); });
			return;
		}
	}
	const verified = m.humanVerified;
	const overlay = document.createElement("div");
	overlay.className = "modal-overlay";
	overlay.innerHTML = `<div class="modal">
		<h3>${esc(m.name ?? m.id)}
			${verified ? '<span class="status-pill" style="background:#3d7a4e">✅ 人工核对</span>' : '<span class="status-pill" style="background:#b03a2c">⚠️ 未核对</span>'}
		</h3>
		<dl class="kv">
			<dt>id</dt><dd>${esc(m.id)}</dd>
			<dt>CID</dt><dd>${esc(m.cid ?? "—")}</dd>
			<dt>CAS</dt><dd>${esc(m.cas ?? "—")}</dd>
			<dt>香型</dt><dd>${(m.family ?? []).map((f) => `<span class="chip"><i class="dot" style="background:${famColor(f)}"></i>${esc(f)}</span>`).join(" ") || "—"}</dd>
			<dt>香阶</dt><dd>${esc(m.note ?? "—")}</dd>
			<dt>气味</dt><dd>${esc(m.odor ?? "—")}</dd>
			<dt>IFRA</dt><dd>${m.ifraEntryRef ? esc(m.ifraEntryRef) : "无条目"}</dd>
		</dl>
		<div class="modal-actions"><button class="btn ghost" data-close>关闭</button></div>
	</div>`;
	document.body.appendChild(overlay);
	overlay.addEventListener("click", (ev) => {
		if (ev.target === overlay || ev.target.hasAttribute("data-close")) overlay.remove();
	});
}

// ---------------- 配方库列表页 ----------------
function libRecipeCardHtml(r) {
	const p = r.pyramid ?? {};
	const tier = (ids) => (Array.isArray(ids) && ids.length ? ids.map(libMatName).join("、") : "—");
	return `<div class="lib-card" data-lib-file="${esc(r.file)}" tabindex="0" role="button">
		<div class="lib-card-title">${esc(r.meta.name ?? r.file)}
			${r.meta.accord ? `<span class="accord-pill">${esc(libAccordZh(r.meta.accord))}</span>` : ""}
			${statusPill(r.meta.status)}
			<span class="muted small" style="margin-left:auto">${r.lintOk ? "✅ lint" : "❌ lint"}</span>
		</div>
		<div class="muted small">${esc(r.meta.id ?? "—")} · v${esc(String(r.meta.version ?? "?"))} · ${r.ingredientCount} 个原料</div>
		<div class="lib-tier"><b>前调</b> ${esc(tier(p.top))}</div>
		<div class="lib-tier"><b>中调</b> ${esc(tier(p.heart))}</div>
		<div class="lib-tier"><b>后调</b> ${esc(tier(p.base))}</div>
	</div>`;
}

async function libShowLibraryPage() {
	showTab("library");
	history.replaceState(null, "", location.pathname);
	const box = $("#lib-list");
	box.innerHTML = `<p class="muted">加载中…</p>`;
	try {
		await Promise.all([libEnsureMaterials(), libEnsureRecipes(true)]);
		if (!libState.recipes.length) {
			box.innerHTML = `<div class="empty-hint"><p>配方库还是空的。</p>
				<p class="muted">点右上角「新建配方」手动创建一个,或到「Brief 生成配方」页让 Agent 生成后入库。</p></div>`;
		} else {
			box.innerHTML = `<div class="lib-grid">${libState.recipes.map(libRecipeCardHtml).join("")}</div>`;
			box.querySelectorAll("[data-lib-file]").forEach((el) => {
				el.addEventListener("click", () => libOpenFormula(el.dataset.libFile));
				el.addEventListener("keydown", (e) => { if (e.key === "Enter") libOpenFormula(el.dataset.libFile); });
			});
		}
	} catch (e) {
		box.innerHTML = `<div class="error-box">加载配方库失败:${esc(e.message)}</div>`;
	}
}

// 内置示例(只读):解析走 app.js 的 jsYamlLite + 行内 pyramid 正则
function libParsePyramidLite(yaml) {
	const out = {};
	for (const line of yaml.split(/\r?\n/)) {
		const mm = line.match(/^\s*(top|heart|base)\s*:\s*\[(.*)\]\s*$/);
		if (mm) out[mm[1]] = mm[2].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
	}
	return Object.keys(out).length ? out : null;
}

async function libOpenExample(name) {
	showTab("formula");
	history.replaceState(null, "", `?view=formula&example=${encodeURIComponent(name)}`);
	const box = $("#lib-detail");
	box.innerHTML = `<div class="card"><p class="muted">加载中…</p></div>`;
	try {
		await libEnsureMaterials();
		const { yaml } = await libFetchJson(`/api/example?name=${encodeURIComponent(name)}`);
		const doc = jsYamlLite(yaml);
		const data = {
			file: name, readonly: true,
			meta: { id: doc.id ?? name, name: doc.name ?? name, version: "示例", status: doc.status ?? "?", accord: null },
			product: {}, pyramid: libParsePyramidLite(yaml),
			ingredients: (doc.formula ?? []).map((i) => {
				const m = libMatCache.byId[i.materialRef];
				return {
					materialRef: i.materialRef, pct: i.pct, name: m?.name ?? null, cid: m?.cid ?? null,
					family: m?.family ?? [], note: m?.note ?? null, odor: m?.odor ?? null,
				};
			}),
			lint: null, raw: yaml,
		};
		box.innerHTML = libDetailHtml(data);
		libWireDetail(box);
	} catch (e) {
		box.innerHTML = `<div class="card"><div class="error-box">载入示例失败:${esc(e.message)}</div></div>`;
	}
}

// ---------------- 配方详情页 ----------------
async function libOpenFormula(file, { pushState = true } = {}) {
	showTab("formula");
	if (pushState) history.replaceState(null, "", `?view=formula&file=${encodeURIComponent(file)}`);
	const box = $("#lib-detail");
	box.innerHTML = `<div class="card"><p class="muted">加载中…</p></div>`;
	try {
		await libEnsureMaterials();
		const data = await libFetchJson(`/api/formula?file=${encodeURIComponent(file)}`);
		box.innerHTML = libDetailHtml(data);
		libWireDetail(box);
	} catch (e) {
		box.innerHTML = `<div class="card"><div class="error-box">载入配方失败:${esc(e.message)}</div>
			<div class="action-bar" style="margin-top:10px"><button class="btn ghost slim" id="lib-back">返回配方库</button></div></div>`;
		$("#lib-back")?.addEventListener("click", libShowLibraryPage);
	}
}

function libDetailHtml(d) {
	const p = d.pyramid ?? {};
	const tierChips = (ids) => (Array.isArray(ids) && ids.length
		? ids.map((id) => `<span class="chip" data-lib-mat="${esc(id)}" title="查看原料资料"><i class="dot" style="background:${famColor(libMatCache.byId[id]?.family?.[0])}"></i>${esc(libMatName(id))}</span>`).join(" ")
		: `<span class="muted">—</span>`);
	const rows = (d.ingredients ?? []).map((i) => `<tr>
		<td><a class="mat-link" data-lib-mat="${esc(i.materialRef)}">${esc(i.name ?? i.materialRef)}</a>
			<div class="muted small">${esc(i.materialRef)}${i.note ? " · " + esc(i.note) + "香" : ""}${(i.family ?? []).length ? " · " + esc(i.family.join("/")) : ""}</div></td>
		<td class="num">${esc(i.cid ?? "—")}</td>
		<td class="num">${i.pct ?? "—"}%</td>
	</tr>`).join("");
	const lintBlock = d.lint
		? (d.lint.ok
			? `<div class="verdict"><span class="badge ok">✅ formula-lint 通过</span></div>`
			: `<div class="verdict"><span class="badge bad">❌ formula-lint 未通过</span></div><ul class="notices">${d.lint.errors.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`)
		: `<p class="muted small">内置示例,未跑 lint。</p>`;
	const prodLine = d.product?.category
		? ` · Category ${esc(d.product.category)}${d.product.fragranceUseLevelPct ? ` · 添加量 ${esc(d.product.fragranceUseLevelPct)}%` : ""}`
		: "";
	return `<div class="card">
		<div class="action-bar" style="margin-bottom:12px">
			<button class="btn ghost slim" id="lib-back">← 配方库</button>
			${d.readonly ? `<span class="status-pill" style="background:#8d7f68">只读 · 内置示例</span>` : ""}
		</div>
		<h2>${esc(d.meta.name ?? d.file)} ${d.meta.accord ? `<span class="accord-pill">${esc(libAccordZh(d.meta.accord))}</span>` : ""}</h2>
		<div class="muted small">${esc(d.meta.id ?? "—")} · 版本 ${esc(String(d.meta.version ?? "?"))} · ${statusPill(d.meta.status)}${prodLine}${d.meta.createdAt ? ` · 创建于 ${esc(d.meta.createdAt)}` : ""}</div>
		<h3>香调金字塔</h3>
		<div class="pyramid-tiers">
			${LIB_TIERS.map((t) => `<div class="lib-tier"><b>${LIB_TIER_LABEL[t]}</b> ${tierChips(p[t])}</div>`).join("")}
		</div>
		<h3>原料表(点击名称看资料卡)</h3>
		<table class="report"><tr><th>原料</th><th>CID</th><th>配比</th></tr>${rows || `<tr><td colspan="3" class="muted">无</td></tr>`}</table>
		<h3>校验状态</h3>
		${lintBlock}
		${d.raw ? `<details class="raw"><summary>查看原始 YAML</summary><pre class="raw-block">${esc(d.raw)}</pre></details>` : ""}
	</div>`;
}

function libWireDetail(box) {
	box.querySelector("#lib-back")?.addEventListener("click", libShowLibraryPage);
	box.querySelectorAll("[data-lib-mat]").forEach((el) =>
		el.addEventListener("click", () => libShowMaterial(el.dataset.libMat)));
}

// ---------------- 新建配方页(手动入口;lint 硬门在服务端)----------------
const libCreate = { tiers: { top: [], heart: [], base: [] } };

function libFillMaterialSelect(sel, placeholder) {
	sel.innerHTML = `<option value="">${esc(placeholder)}</option>` +
		libMatCache.list.map((m) => `<option value="${esc(m.id)}">${esc(m.id)} — ${esc(m.name)}</option>`).join("");
}

async function libShowCreatePage() {
	showTab("create");
	history.replaceState(null, "", location.pathname);
	await libEnsureMaterials();
	$("#create-accord").innerHTML = `<option value="">(未指定)</option>` +
		LIB_ACCORDS.map((a) => `<option value="${a.id}">${a.zh}(${a.id})</option>`).join("");
	for (const t of LIB_TIERS) libFillMaterialSelect($(`#create-add-${t}`), `添加${LIB_TIER_LABEL[t]}原料…`);
	if (!$("#create-rows").children.length) libAddIngredientRow();
	libUpdateTierChips();
	libUpdateSum();
}

function libUpdateTierChips() {
	for (const t of LIB_TIERS) {
		const box = $(`#create-chips-${t}`);
		box.innerHTML = libCreate.tiers[t].map((id) =>
			`<span class="chip">${esc(libMatName(id))}<button type="button" class="chip-x" data-tier="${t}" data-id="${esc(id)}" title="移除">×</button></span>`).join("");
		box.querySelectorAll(".chip-x").forEach((b) => b.addEventListener("click", () => {
			libCreate.tiers[b.dataset.tier] = libCreate.tiers[b.dataset.tier].filter((x) => x !== b.dataset.id);
			libUpdateTierChips();
		}));
	}
}

function libIngredientIds() {
	return [...$("#create-rows").querySelectorAll("select")].map((s) => s.value).filter(Boolean);
}

function libAddTierMaterial(t, id) {
	if (!id || libCreate.tiers[t].includes(id)) return;
	libCreate.tiers[t].push(id);
	libUpdateTierChips();
	// pyramid 原料必须出现在 formula 组成中(lint 规则),选中即自动补配比行
	if (!libIngredientIds().includes(id)) libAddIngredientRow(id);
}

function libAddIngredientRow(materialRef = "", pct = "") {
	const rows = $("#create-rows");
	const row = document.createElement("div");
	row.className = "ing-edit-row";
	const sel = document.createElement("select");
	libFillMaterialSelect(sel, "选择原料…");
	sel.value = materialRef;
	const input = document.createElement("input");
	input.type = "number";
	input.min = "0";
	input.max = "100";
	input.step = "0.1";
	input.value = pct;
	input.placeholder = "pct%";
	const del = document.createElement("button");
	del.type = "button";
	del.className = "btn ghost slim";
	del.textContent = "×";
	del.title = "删除行";
	del.addEventListener("click", () => { row.remove(); libUpdateSum(); });
	sel.addEventListener("change", libUpdateSum);
	input.addEventListener("input", libUpdateSum);
	row.append(sel, input, del);
	rows.appendChild(row);
	libUpdateSum();
}

function libUpdateSum() {
	const sum = [...$("#create-rows").querySelectorAll("input")].reduce((s, i) => s + (Number(i.value) || 0), 0);
	const ok = Math.abs(sum - 100) <= 1;
	const el = $("#create-sum");
	el.textContent = `合计 ${Math.round(sum * 100) / 100}%(目标 100±1)`;
	el.className = `create-sum ${ok ? "sum-ok" : "sum-bad"}`;
}

async function libSubmitCreate() {
	const errBox = $("#create-errors");
	errBox.innerHTML = "";
	const name = $("#create-name").value.trim();
	if (!name) { errBox.innerHTML = `<div class="error-box">请填写配方名称。</div>`; return; }
	const ingredients = [...$("#create-rows").querySelectorAll(".ing-edit-row")]
		.map((row) => ({ materialRef: row.querySelector("select").value, pct: row.querySelector("input").value }))
		.filter((i) => i.materialRef);
	if (!ingredients.length) { errBox.innerHTML = `<div class="error-box">请至少添加一行原料配比。</div>`; return; }
	const refs = new Set(ingredients.map((i) => i.materialRef));
	const missing = LIB_TIERS.flatMap((t) => libCreate.tiers[t].filter((id) => !refs.has(id)));
	if (missing.length) { errBox.innerHTML = `<div class="error-box">金字塔原料未出现在配比表中:${esc(missing.join(", "))}</div>`; return; }
	const sum = ingredients.reduce((s, i) => s + (Number(i.pct) || 0), 0);
	if (Math.abs(sum - 100) > 1) { errBox.innerHTML = `<div class="error-box">剂量合计 ${sum}%,须在 100±1 内。</div>`; return; }
	const body = {
		name,
		accord: $("#create-accord").value || null,
		top: libCreate.tiers.top, heart: libCreate.tiers.heart, base: libCreate.tiers.base,
		ingredients: ingredients.map((i) => ({ materialRef: i.materialRef, pct: Number(i.pct) })),
		category: $("#create-category").value.trim() || "4",
	};
	const useLevel = $("#create-uselevel").value;
	if (useLevel !== "") body.fragranceUseLevelPct = Number(useLevel);
	const btn = $("#create-submit");
	btn.disabled = true;
	try {
		const data = await libFetchJson("/api/formula", {
			method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
		});
		libState.recipesLoaded = false;
		for (const selId of ["library-sel-validate", "library-sel-a", "library-sel-b"]) refreshLibrarySelect(selId);
		libOpenFormula(data.file);
	} catch (e) {
		const errs = e.data?.errors;
		errBox.innerHTML = `<div class="error-box"><strong>创建失败(lint 硬门未过):</strong><ul class="notices">${(errs ?? [e.message]).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
		errBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
	} finally {
		btn.disabled = false;
	}
}

// ---------------- 香调轮盘页(12 宫格 SVG,自绘)----------------
let wheelSelected = null;
let wheelRendered = false;

function libRenderWheel() {
	const NS = "http://www.w3.org/2000/svg";
	const size = 440, cx = size / 2, cy = size / 2, R = 148, nodeR = 36, centerR = 58;
	const svg = document.createElementNS(NS, "svg");
	svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
	svg.setAttribute("class", "wheel-svg-el");
	// 辐条 + 12 个节点:正上为花香,顺时针依次(与香水时代布局一致)
	LIB_ACCORDS.forEach((a, i) => {
		const ang = (-90 + i * 30) * Math.PI / 180;
		const x = cx + R * Math.cos(ang), y = cy + R * Math.sin(ang);
		const line = document.createElementNS(NS, "line");
		line.setAttribute("x1", cx); line.setAttribute("y1", cy);
		line.setAttribute("x2", x); line.setAttribute("y2", y);
		line.setAttribute("class", "wheel-spoke");
		svg.appendChild(line);
		const g = document.createElementNS(NS, "g");
		g.setAttribute("class", "wheel-node");
		g.dataset.accord = a.id;
		const c = document.createElementNS(NS, "circle");
		c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", nodeR);
		const t1 = document.createElementNS(NS, "text");
		t1.setAttribute("x", x); t1.setAttribute("y", y + 1);
		t1.textContent = a.zh;
		const t2 = document.createElementNS(NS, "text");
		t2.setAttribute("x", x); t2.setAttribute("y", y + 15);
		t2.setAttribute("class", "wheel-node-sub");
		t2.textContent = a.id;
		g.append(c, t1, t2);
		g.addEventListener("click", () => libWheelSelect(a.id));
		svg.appendChild(g);
	});
	const cg = document.createElementNS(NS, "g");
	cg.setAttribute("class", "wheel-center");
	const cc = document.createElementNS(NS, "circle");
	cc.setAttribute("cx", cx); cc.setAttribute("cy", cy); cc.setAttribute("r", centerR);
	const ct = document.createElementNS(NS, "text");
	ct.setAttribute("x", cx); ct.setAttribute("y", cy + 6);
	ct.textContent = "香调";
	cg.append(cc, ct);
	svg.appendChild(cg);
	const box = $("#wheel-svg");
	box.innerHTML = "";
	box.appendChild(svg);
	wheelRendered = true;
}

async function libShowWheelPage() {
	showTab("wheel");
	history.replaceState(null, "", location.pathname);
	if (!wheelRendered) libRenderWheel();
	const results = $("#wheel-results");
	try {
		await Promise.all([libEnsureMaterials(), libEnsureRecipes(true)]);
		if (wheelSelected) libWheelSelect(wheelSelected);
		else results.innerHTML = `<p class="muted">点击轮盘上的香调,查看该香调的配方与原料。配方库 ${libState.recipes.length} 个 · 原料库 ${libMatCache.list.length} 种。</p>`;
	} catch (e) {
		results.innerHTML = `<div class="error-box">加载失败:${esc(e.message)}</div>`;
	}
}

function libWheelSelect(accordId) {
	if (!libState.recipesLoaded || !libMatCache.loaded) return; // 数据未就绪,等页面加载完成
	wheelSelected = accordId;
	document.querySelectorAll(".wheel-node").forEach((g) => g.classList.toggle("sel", g.dataset.accord === accordId));
	const a = LIB_ACCORDS.find((x) => x.id === accordId);
	const recipes = libState.recipes.filter((r) => r.meta.accord === accordId);
	const fam = WHEEL_FAMILY[accordId];
	const mats = fam ? libMatCache.list.filter((m) => (m.family ?? []).includes(fam)) : [];
	let html = `<h2>${a.zh} <small class="muted">${a.id}</small></h2>`;
	html += `<h3>配方(${recipes.length})</h3>`;
	html += recipes.length
		? `<div class="lib-grid">${recipes.map(libRecipeCardHtml).join("")}</div>`
		: `<p class="muted small">配方库中暂无${a.zh}调配方。</p>`;
	html += `<h3>原料(${mats.length})${fam ? "" : " · 该香调无对应原料 family 词表"}</h3>`;
	html += mats.length
		? `<div>${mats.map((m) => `<span class="chip wheel-mat" data-lib-mat="${esc(m.id)}" title="${esc(m.odor ?? "")} · 点击看资料卡"><i class="dot" style="background:${famColor((m.family ?? [])[0])}"></i>${esc(m.name)}</span>`).join(" ")}</div>`
		: `<p class="muted small">原料库中暂无${a.zh} family 原料。</p>`;
	const results = $("#wheel-results");
	results.innerHTML = html;
	results.querySelectorAll("[data-lib-file]").forEach((el) => el.addEventListener("click", () => libOpenFormula(el.dataset.libFile)));
	results.querySelectorAll(".wheel-mat").forEach((el) => el.addEventListener("click", () => libShowMaterial(el.dataset.libMat)));
}

// ---------------- 路由与初始化 ----------------
function libInitRoute() {
	const params = new URLSearchParams(location.search);
	if (params.get("view") !== "formula") return;
	if (params.get("file")) libOpenFormula(params.get("file"), { pushState: false });
	else if (params.get("example")) libOpenExample(params.get("example"));
}

// 主导航 tab 点击时清掉详情页查询串;三个新页各自绑定数据加载
for (const v of ["chat", "generate", "validate", "diff", "library", "create", "wheel"]) {
	const tab = $(`#tab-${v}`);
	if (tab) tab.addEventListener("click", () => history.replaceState(null, "", location.pathname));
}
$("#tab-library").addEventListener("click", libShowLibraryPage);
$("#tab-create").addEventListener("click", libShowCreatePage);
$("#tab-wheel").addEventListener("click", libShowWheelPage);
$("#lib-btn-new").addEventListener("click", libShowCreatePage);
$("#create-add-row").addEventListener("click", () => libAddIngredientRow());
$("#create-submit").addEventListener("click", libSubmitCreate);
for (const t of LIB_TIERS) {
	$(`#create-add-${t}`).addEventListener("change", (e) => {
		if (e.target.value) {
			libAddTierMaterial(t, e.target.value);
			e.target.value = "";
		}
	});
}

// 内置示例按钮
for (const name of LIB_EXAMPLES) {
	const b = document.createElement("button");
	b.type = "button";
	b.textContent = name.replace(/^formula\./, "").replace(/\.yaml$/, "");
	b.title = name;
	b.addEventListener("click", () => libOpenExample(name));
	$("#lib-examples").appendChild(b);
}

libInitRoute();
