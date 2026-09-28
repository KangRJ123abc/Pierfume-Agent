/* Pierfume 原料库管理页:主库增/改 + Pyrfume staging 待入库(P2 数据管理 GUI)。
 * 依赖 app.js/pages.js 先加载:复用全局 $ / esc / famColor / libFetchJson。
 * 注意:经典 <script> 共享全局作用域,本文件所有顶层标识符一律 mat 前缀。
 */

// 受控词表(与 schemas/materials.schema.json 的 family enum 一致;受控,禁止自由发挥)
const MAT_FAMILIES = ["citrus", "carrier", "floral", "green", "woody", "oriental", "gourmand", "herbal", "minty", "spicy", "fruity", "musky", "aquatic", "leathery", "powdery", "balsamic", "earthy", "animalic"];
const MAT_NOTES = ["top", "heart", "base"];
const MAT_NOTE_LABEL = { top: "前调", heart: "中调", base: "后调" };
const MAT_USER_OWNED = "用户自有";

const matCache = { loaded: false, list: [], byId: {} };
const matIfraEntries = [];
const matFilters = { q: "", family: "", verified: "" };
let matStagingTimer = null;

async function matEnsureData() {
	if (!matCache.loaded) {
		const [{ materials }, entries] = await Promise.all([
			libFetchJson("/api/materials-admin"),
			libFetchJson("/api/ifra-entries"),
		]);
		matCache.list = materials ?? [];
		matCache.byId = Object.fromEntries(matCache.list.map((m) => [m.id, m]));
		matIfraEntries.length = 0;
		matIfraEntries.push(...(entries.entries ?? []));
		matCache.loaded = true;
	}
	return matCache;
}

async function matShowPage() {
	showTab("materials");
	history.replaceState(null, "", location.pathname);
	$("#mat-notice").innerHTML = "";
	const table = $("#mat-table");
	table.innerHTML = `<p class="muted">加载中…</p>`;
	try {
		await matEnsureData();
		matInitFamilyFilter();
		matRenderTable();
		await matRenderStaging();
	} catch (e) {
		table.innerHTML = `<div class="error-box">加载原料库失败:${esc(e.message)}</div>`;
	}
}

function matInitFamilyFilter() {
	const sel = $("#mat-filter-family");
	if (sel.children.length > 1) return; // 已初始化
	for (const f of MAT_FAMILIES) {
		const opt = document.createElement("option");
		opt.value = f;
		opt.textContent = f;
		sel.appendChild(opt);
	}
}

function matFiltered() {
	const q = matFilters.q.trim().toLowerCase();
	return matCache.list.filter((m) => {
		if (matFilters.family && !(m.family ?? []).includes(matFilters.family)) return false;
		if (matFilters.verified === "1" && !m.humanVerified) return false;
		if (matFilters.verified === "0" && m.humanVerified) return false;
		if (q && !(`${m.name} ${m.id} ${m.cas ?? ""}`.toLowerCase().includes(q))) return false;
		return true;
	});
}

function matVerifiedBadge(m) {
	return m.humanVerified
		? `<span class="status-pill" style="background:#3d7a4e">✅ 已核对</span>`
		: `<span class="status-pill" style="background:#b03a2c">⚠️ 未核对</span>`;
}

function matRenderTable() {
	const box = $("#mat-table");
	const list = matFiltered();
	$("#mat-count").textContent = `${list.length} / ${matCache.list.length} 条`;
	if (!list.length) {
		box.innerHTML = `<p class="muted small">没有匹配的原料。</p>`;
		return;
	}
	const rows = list.map((m) => `<tr data-mat-id="${esc(m.id)}" title="点击编辑">
		<td><strong>${esc(m.name)}</strong></td>
		<td class="muted">${esc(m.id)}</td>
		<td class="num">${esc(String(m.cid ?? "—"))}</td>
		<td class="num">${esc(m.cas ?? "—")}</td>
		<td>${(m.family ?? []).map((f) => `<span class="chip"><i class="dot" style="background:${famColor(f)}"></i>${esc(f)}</span>`).join(" ")}</td>
		<td>${esc(m.note ?? "—")}</td>
		<td class="muted small">${esc(m.odor ?? "—")}</td>
		<td>${matVerifiedBadge(m)}${m.humanVerified ? "" : ` <button class="btn ghost slim" data-mat-verify="${esc(m.id)}" title="人工逐条核对完成后,标记为已核对">✓ 核对</button>`}</td>
	</tr>`).join("");
	box.innerHTML = `<table class="report mat-table">
		<tr><th>名称</th><th>id</th><th>CID</th><th>CAS</th><th>香型</th><th>香阶</th><th>气味</th><th>核对</th></tr>${rows}</table>`;
	box.querySelectorAll("[data-mat-id]").forEach((tr) =>
		tr.addEventListener("click", () => matOpenForm("edit", { id: tr.dataset.matId })));
	box.querySelectorAll("[data-mat-verify]").forEach((b) => b.addEventListener("click", (e) => {
		e.stopPropagation(); // 行点击是打开编辑,核对按钮独立
		matVerify(b.dataset.matVerify);
	}));
}

// 人工核对确认:二次确认清单 → POST verify → 差异展示
async function matVerify(id) {
	const m = matCache.byId[id];
	if (!m) return;
	const ok = window.confirm(
		`确认完成「${m.name}」的人工核对?\n\n请逐项确认:\n` +
		`· CID / CAS 与权威来源(PubChem 页面)一致\n` +
		`· 名称、香型、香阶、气味描述符合实际\n` +
		`· IFRA 条目引用正确(有挂条目时)\n\n` +
		`确认后将标记为「已人工核对」并记录核对人与日期。`,
	);
	if (!ok) return;
	try {
		const data = await libFetchJson("/api/materials-admin/verify", { id });
		matCache.loaded = false;
		await matEnsureData();
		matRenderTable();
		matShowDiff(data.before, data.after ?? data.material,
			`✅ 已人工核对 · ${esc((data.after ?? data.material).name)} <span class="muted small">核对人与日期已记录</span>`);
	} catch (e) {
		alert(`核对标记失败:${e.message}`);
	}
}

// ---------------- Pyrfume staging ----------------
async function matRenderStaging() {
	const q = $("#mat-staging-q").value.trim();
	const pending = $("#mat-staging-pending").checked ? "1" : "";
	const box = $("#mat-staging-table");
	try {
		const params = new URLSearchParams();
		if (q) params.set("q", q);
		if (pending) params.set("pending", pending);
		const { items } = await libFetchJson(`/api/staging?${params.toString()}`);
		$("#mat-staging-title").textContent = `Pyrfume 待入库 (${items.length})`;
		$("#mat-staging-count").textContent = `${items.filter((x) => !x.imported).length} 条未入库`;
		if (!items.length) {
			box.innerHTML = `<p class="muted small">没有匹配的记录。</p>`;
			return;
		}
		const rows = items.map((it, i) => `<tr class="${it.imported ? "mat-staging-imported" : ""}">
			<td><strong>${esc(it.name ?? "?")}</strong></td>
			<td class="num">${esc(String(it.cid ?? "—"))}</td>
			<td class="num">${esc(it.cas ?? "—")}</td>
			<td class="muted small" title="${esc((it.datasets ?? []).join(", "))}">${esc(it.odor ?? "—")}</td>
			<td>${it.imported ? '<span class="status-pill" style="background:#8d7f68">已入库</span>' : `<button class="btn ghost slim" data-mat-staging="${i}">入库</button>`}</td>
		</tr>`).join("");
		box.innerHTML = `<table class="report mat-table">
			<tr><th>名称</th><th>CID</th><th>CAS</th><th>气味描述</th><th>状态</th></tr>${rows}</table>`;
		box.querySelectorAll("[data-mat-staging]").forEach((b) => b.addEventListener("click", () => {
			const it = items[Number(b.dataset.matStaging)];
			matOpenForm("staging", { staging: it });
		}));
	} catch (e) {
		box.innerHTML = `<div class="error-box">加载 staging 失败:${esc(e.message)}</div>`;
	}
}

// ---------------- 添加 / 编辑表单(模态,三种模式共用)----------------
// preset: {id} 编辑 | {staging: item} staging 预填 | {} 空白添加
function matOpenForm(mode, preset = {}) {
	const isEdit = mode === "edit";
	const isStaging = mode === "staging";
	const m = isEdit ? matCache.byId[preset.id] : null;
	const st = isStaging ? preset.staging : null;
	if (isEdit && !m) return;
	const famSel = new Set(isEdit ? (m.family ?? []) : []);
	const noteVal = isEdit ? m.note : "";
	const cidVal = isEdit ? m.cid : (isStaging ? st.cid : "");
	const cidUserOwned = cidVal === MAT_USER_OWNED;
	const ifraVal = isEdit ? (m.ifraEntryRef ?? "") : "";

	const overlay = document.createElement("div");
	overlay.className = "modal-overlay";
	const famChips = MAT_FAMILIES.map((f) =>
		`<button type="button" class="chip mat-fam-chip${famSel.has(f) ? " active" : ""}" data-fam="${f}"><i class="dot" style="background:${famColor(f)}"></i>${f}</button>`).join("");
	const noteRadios = MAT_NOTES.map((n) =>
		`<label class="mat-radio"><input type="radio" name="mat-note" value="${n}"${noteVal === n ? " checked" : ""}> ${MAT_NOTE_LABEL[n]}(${n})</label>`).join("");
	const ifraOpts = [`<option value="">(无 IFRA 条目)</option>`]
		.concat(matIfraEntries.map((e) => `<option value="${esc(e.id)}"${ifraVal === e.id ? " selected" : ""}>${esc(e.id)} — ${esc(e.name)}</option>`)).join("");
	overlay.innerHTML = `<div class="modal mat-modal">
		<h3>${isEdit ? `编辑原料 · ${esc(m.id)}` : isStaging ? "入库 staging 原料" : "手动添加原料"}</h3>
		${isStaging ? `<p class="muted small mat-staging-info">Pyrfume 草稿 · datasets:${esc((st.datasets ?? []).join(", ") || "—")}</p>` : ""}
		${isEdit ? `<p class="muted small">修改会重置核对状态为 ⚠️ 未核对(需重新人工核对)。</p>` : ""}
		${!isEdit ? `<label class="field"><span>id(可选;留空按名称生成,纯中文名须显式填写 kebab-case)</span><input id="mat-f-id" type="text" placeholder="如 rose-absolute" value=""></label>` : ""}
		<label class="field"><span>名称(必填)</span><input id="mat-f-name" type="text" value="${esc(isEdit ? m.name : isStaging ? st.name : "")}"></label>
		<div class="field">
			<span>CID(必填)</span>
			<div class="mat-cid-row">
				<label class="mat-radio"><input type="radio" name="mat-cidmode" value="pubchem"${cidUserOwned ? "" : " checked"}> PubChem CID</label>
				<label class="mat-radio"><input type="radio" name="mat-cidmode" value="owned"${cidUserOwned ? " checked" : ""}> ${MAT_USER_OWNED}</label>
			</div>
			<input id="mat-f-cid" type="number" min="1" step="1" placeholder="PubChem CID 整数" value="${esc(String(cidVal === MAT_USER_OWNED ? "" : cidVal ?? ""))}"${cidUserOwned ? " disabled" : ""}>
		</div>
		<label class="field"><span>CAS(整数 CID 时建议由 PubChem 解析;可人工补录)</span><input id="mat-f-cas" type="text" placeholder="如 106-24-1" value="${esc(isEdit ? (m.cas ?? "") : isStaging ? (st.cas ?? "") : "")}"></label>
		<div class="field">
			<span>香型 family(受控词表,至少一个)</span>
			<div id="mat-f-family" class="mat-fam-box">${famChips}</div>
		</div>
		<div class="field">
			<span>香阶 note(必填)</span>
			<div>${noteRadios}</div>
		</div>
		<label class="field"><span>气味描述</span><input id="mat-f-odor" type="text" value="${esc(isEdit ? (m.odor ?? "") : isStaging ? (st.odor ?? "") : "")}"></label>
		<label class="field"><span>IFRA 条目</span><select id="mat-f-ifra" class="lib-inline-sel">${ifraOpts}</select></label>
		<div id="mat-f-errors"></div>
		<div class="modal-actions">
			<button class="btn primary slim" id="mat-f-submit">${isEdit ? "保存修改" : "添加"}</button>
			<button class="btn ghost" data-close>取消</button>
		</div>
	</div>`;
	document.body.appendChild(overlay);
	overlay.addEventListener("click", (ev) => { if (ev.target === overlay) overlay.remove(); });
	overlay.querySelector("[data-close]").addEventListener("click", () => overlay.remove());
	// CID 模式切换
	const cidInput = overlay.querySelector("#mat-f-cid");
	overlay.querySelectorAll('input[name="mat-cidmode"]').forEach((r) => r.addEventListener("change", () => {
		const owned = overlay.querySelector('input[name="mat-cidmode"]:checked').value === "owned";
		cidInput.disabled = owned;
		if (owned) cidInput.value = "";
	}));
	// family chip 多选
	overlay.querySelectorAll(".mat-fam-chip").forEach((chip) => chip.addEventListener("click", () => {
		const f = chip.dataset.fam;
		if (famSel.has(f)) { famSel.delete(f); chip.classList.remove("active"); }
		else { famSel.add(f); chip.classList.add("active"); }
	}));
	overlay.querySelector("#mat-f-submit").addEventListener("click", async () => {
		const btn = overlay.querySelector("#mat-f-submit");
		const errBox = overlay.querySelector("#mat-f-errors");
		errBox.innerHTML = "";
		const name = overlay.querySelector("#mat-f-name").value.trim();
		const owned = overlay.querySelector('input[name="mat-cidmode"]:checked').value === "owned";
		const cidNum = Number(cidInput.value);
		const cid = owned ? MAT_USER_OWNED : cidNum;
		const cas = overlay.querySelector("#mat-f-cas").value.trim();
		const note = overlay.querySelector('input[name="mat-note"]:checked')?.value;
		const odor = overlay.querySelector("#mat-f-odor").value.trim();
		const ifra = overlay.querySelector("#mat-f-ifra").value || null;
		// 前端校验(cid 必填:正整数或"用户自有";family/note 必填)
		const errs = [];
		if (!name) errs.push("名称必填");
		if (!owned && !(Number.isInteger(cidNum) && cidNum > 0)) errs.push("CID 必须是正整数(或选「用户自有」)");
		if (!famSel.size) errs.push("至少选择一个香型");
		if (!note) errs.push("请选择香阶");
		if (errs.length) {
			errBox.innerHTML = `<div class="error-box">${errs.map(esc).join("<br>")}</div>`;
			return;
		}
		btn.disabled = true;
		btn.textContent = isEdit ? "保存中…" : "添加中…(整数 CID 将查 PubChem)";
		try {
			if (isEdit) {
				const patch = { name, cid, family: [...famSel], note };
				if (cas) patch.cas = cas; // 留空 = 不改动
				if (odor) patch.odor = odor;
				patch.ifraEntryRef = ifra; // 可显式置 null
				const data = await libFetchJson("/api/materials-admin", {
					method: "PUT", headers: { "content-type": "application/json" },
					body: JSON.stringify({ id: preset.id, patch }),
				});
				overlay.remove();
				matCache.loaded = false;
				await matEnsureData();
				matRenderTable();
				matShowDiff(data.before, data.after);
			} else {
				const body = { name, cid, family: [...famSel], note };
				const explicitId = overlay.querySelector("#mat-f-id")?.value.trim();
				if (explicitId) body.id = explicitId;
				if (cas) body.cas = cas;
				if (odor) body.odor = odor;
				if (ifra) body.ifraEntryRef = ifra;
				const url = isStaging ? `/api/materials-admin?staging=${encodeURIComponent(String(st.cid))}` : "/api/materials-admin";
				const data = await libFetchJson(url, {
					method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
				});
				overlay.remove();
				matCache.loaded = false;
				await matEnsureData();
				matRenderTable();
				await matRenderStaging();
				const warn = (data.warnings ?? []).length ? `<ul class="notices">${data.warnings.map((w) => `<li>⚠️ ${esc(w)}</li>`).join("")}</ul>` : "";
				$("#mat-notice").innerHTML = `<div class="good-note mat-notice-ok">✅ 已添加 <strong>${esc(data.material.name)}</strong>(${esc(data.material.id)}),核对状态为 ⚠️ 未核对。${warn}</div>`;
			}
		} catch (e) {
			const list = e.data?.errors;
			errBox.innerHTML = `<div class="error-box"><strong>${e.status === 409 ? "冲突" : "失败"}:</strong><ul class="notices">${(list ?? [e.message]).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
			btn.disabled = false;
			btn.textContent = isEdit ? "保存修改" : "添加";
		}
	});
}

// 编辑/核对后的差异结果(before → after);headline 自定义标题行
function matShowDiff(before, after, headline = null) {
	const label = { name: "名称", cid: "CID", cas: "CAS", family: "香型", note: "香阶", odor: "气味", ifraEntryRef: "IFRA 条目", humanVerified: "核对状态" };
	const rows = [];
	for (const [k, lab] of Object.entries(label)) {
		const o = JSON.stringify(before?.[k] ?? null);
		const n = JSON.stringify(after?.[k] ?? null);
		if (o !== n) rows.push(`<tr><td>${lab}</td><td class="num">${esc(o)}</td><td class="num">${esc(n)}</td></tr>`);
	}
	$("#mat-notice").innerHTML = `<div class="card mat-diff"><h3>${headline ?? `已保存 · ${esc(after.name)} <span class="muted small">核对状态已重置 ⚠️ 未核对</span>`}</h3>` +
		(rows.length
			? `<table class="report"><tr><th>字段</th><th>旧值</th><th>新值</th></tr>${rows.join("")}</table>`
			: `<p class="muted small">字段无变化。</p>`) + `</div>`;
}

// ---------------- 事件绑定 ----------------
$("#mat-btn-add").addEventListener("click", () => matOpenForm("add"));
$("#mat-filter-q").addEventListener("input", (e) => { matFilters.q = e.target.value; matRenderTable(); });
$("#mat-filter-family").addEventListener("change", (e) => { matFilters.family = e.target.value; matRenderTable(); });
$("#mat-filter-verified").addEventListener("change", (e) => { matFilters.verified = e.target.value; matRenderTable(); });
$("#mat-staging-q").addEventListener("input", () => {
	clearTimeout(matStagingTimer);
	matStagingTimer = setTimeout(matRenderStaging, 250); // 防抖
});
$("#mat-staging-pending").addEventListener("change", matRenderStaging);
$("#tab-materials").addEventListener("click", matShowPage);
