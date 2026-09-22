/* Pierfume Demo 前端逻辑:生成(轮询)+ 校验(即时)+ 结果渲染 */
const $ = (sel) => document.querySelector(sel);

const CATEGORIES = ["1", "2", "3", "4", "5A", "5B", "5C", "5D", "6", "7A", "7B", "8", "9", "10A", "10B", "11A", "11B", "12"];
const CAT_LABEL = { 1: "唇部/儿童", 2: "腋下", 3: "女性卫生", 4: "香水/古龙水", "5A": "驻留类", "5B": "驻留类", "5C": "驻留类", "5D": "驻留类", 6: "口腔", "7A": "免洗", "7B": "免洗", 8: "卸妆", 9: "洗护", "10A": "家居", "10B": "家居", "11A": "接触用品", "11B": "接触用品", 12: "无接触" };
const FAMILY_COLOR = {
  citrus: "#d9a441", floral: "#c97b9a", woody: "#8a6a45", balsamic: "#a3825a", spicy: "#b3573a",
  musk: "#9c8aa5", fresh: "#6f9e8f", green: "#7d9b6a", fruity: "#c96f4a", powdery: "#b7a6c9",
  sweet: "#c98aa0", amber: "#b0791f",
};
const famColor = (f) => FAMILY_COLOR[f] ?? "#8d7f68";

// ---------------- tabs ----------------
function showTab(which) {
  $("#view-generate").classList.toggle("hidden", which !== "generate");
  $("#view-validate").classList.toggle("hidden", which !== "validate");
  $("#view-diff").classList.toggle("hidden", which !== "diff");
  $("#tab-generate").classList.toggle("active", which === "generate");
  $("#tab-validate").classList.toggle("active", which === "validate");
  $("#tab-diff").classList.toggle("active", which === "diff");
}
$("#tab-generate").addEventListener("click", () => showTab("generate"));
$("#tab-validate").addEventListener("click", () => showTab("validate"));
$("#tab-diff").addEventListener("click", () => showTab("diff"));

// ---------------- init form ----------------
const catSel = $("#category");
for (const c of CATEGORIES) {
  const opt = document.createElement("option");
  opt.value = c;
  opt.textContent = `Category ${c}(${CAT_LABEL[c] ?? ""})`;
  if (c === "4") opt.selected = true;
  catSel.appendChild(opt);
}

fetch("/api/materials").then((r) => r.json()).then(({ materials }) => {
  $("#palette-count").textContent = `(${materials.length} 条)`;
  const palette = $("#palette");
  for (const m of materials) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.title = `${m.name} · CAS ${m.cas} · ${(m.family ?? []).join("/")}${m.ifra ? "" : " · 无 IFRA 条目"}`;
    chip.innerHTML = `<i class="dot" style="background:${famColor((m.family ?? [])[0])}"></i>` +
      `${m.id}${m.ifra ? "" : '<span class="noifra">*</span>'}`;
    palette.appendChild(chip);
  }
}).catch(() => {});

const EXAMPLES = ["formula.example.yaml", "formula.citrus-cologne.yaml", "formula.musk-amber.yaml", "diff-v2.yaml"];
function buildExampleButtons(containerId, textareaId) {
  const box = $(`#${containerId}`);
  for (const name of EXAMPLES) {
    const b = document.createElement("button");
    b.textContent = name.replace(/^formula\./, "").replace(/\.yaml$/, "");
    b.title = name;
    b.addEventListener("click", async () => {
      const r = await fetch(`/api/example?name=${encodeURIComponent(name)}`);
      const data = await r.json();
      if (data.yaml) $(`#${textareaId}`).value = data.yaml;
    });
    box.appendChild(b);
  }
}
buildExampleButtons("example-btns", "yaml-input");
buildExampleButtons("example-btns-a", "yaml-a");
buildExampleButtons("example-btns-b", "yaml-b");

// 配方库:下拉载入 + 刷新
async function refreshLibrarySelect(selectId) {
  const sel = $(`#${selectId}`);
  if (!sel) return;
  const keep = sel.value;
  try {
    const { files } = await (await fetch("/api/library")).json();
    sel.innerHTML = `<option value="">配方库(${files.length})…</option>` +
      files.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join("");
    sel.value = keep;
  } catch {}
}
for (const [selId, textareaId] of [["library-sel-validate", "yaml-input"], ["library-sel-a", "yaml-a"], ["library-sel-b", "yaml-b"]]) {
  const sel = $(`#${selId}`);
  if (sel) sel.addEventListener("change", async () => {
    if (!sel.value) return;
    const r = await fetch(`/api/library-file?name=${encodeURIComponent(sel.value)}`);
    const data = await r.json();
    if (data.yaml) $(`#${textareaId}`).value = data.yaml;
  });
}
refreshLibrarySelect("library-sel-validate");
refreshLibrarySelect("library-sel-a");
refreshLibrarySelect("library-sel-b");

// 下载与入库
function download(filename, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
async function saveToLibrary(yaml) {
  const m = yaml.match(/^id:\s*([A-Za-z0-9-]+)/m) ?? yaml.match(/^\s+id:\s*([A-Za-z0-9-]+)/m);
  const id = m ? m[1] : `formula-${Date.now()}`;
  const r = await fetch("/api/library", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `${id}.yaml`, yaml }),
  });
  const data = await r.json();
  for (const selId of ["library-sel-validate", "library-sel-a", "library-sel-b"]) refreshLibrarySelect(selId);
  return data.name;
}

// ---------------- rendering ----------------
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const fmt = (n) => (n === null || n === undefined ? "—" : String(Math.round(n * 1e4) / 1e4));

function renderLint(lint) {
  const ok = lint.code === 0;
  return `<div class="card"><h2>formula-lint</h2>` +
    `<div class="verdict"><span class="badge ${ok ? "ok" : "bad"}">${ok ? "✅ 通过" : "❌ 未通过"}</span>` +
    `<span class="meta">退出码 ${lint.code}</span></div>` +
    (ok ? "" : `<pre class="raw-block">${esc(lint.output)}</pre>`) + `</div>`;
}

function renderIfra(ifra) {
  const j = ifra.json;
  if (!j) {
    return `<div class="card"><h2>ifra-check</h2><div class="error-box">报告解析失败<pre class="raw-block">${esc(ifra.markdown ?? "")}</pre></div></div>`;
  }
  const s = j.summary;
  let html = `<div class="card"><h2>ifra-check · IFRA 合规报告</h2>`;
  if (j.errors?.length) {
    html += `<div class="error-box">${j.errors.map(esc).join("<br>")}</div>`;
  }
  const badge = j.violations.length ? `<span class="badge bad">❌ 不合规 — ${j.violations.length} 项违规</span>`
    : `<span class="badge ok">✅ 合规</span>`;
  html += `<div class="verdict">${badge}<span class="meta">Category ${esc(s.category)} · 添加量 ${fmt(s.fragranceUseLevelPct)}% · ${esc(s.ifraStandard ?? "")} · 受限原料 ${s.checkedCount} 项通过</span></div>`;

  if (j.violations.length) {
    html += `<table class="report"><tr><th>原料</th><th>成品含量%</th><th>限量%</th><th>状态</th><th>依据</th><th>建议浓缩物≤%</th></tr>`;
    for (const v of j.violations) {
      const status = v.status === "prohibited" ? `<span class="status-pill bad">🚫 禁用</span>` : `<span class="status-pill warn">⚠️ 超量 ${fmt(v.finishedPct - v.limitPct)}</span>`;
      const basis = [v.basis?.stdDoc, v.basis?.amendment ? `Amd ${v.basis.amendment}` : null].filter(Boolean).join(", ");
      html += `<tr class="violation"><td>${esc(v.materialRef)}</td><td class="num">${fmt(v.finishedPct)}</td><td class="num">${fmt(v.limitPct)}</td><td>${status}</td><td>${esc(basis)}</td><td class="num">${fmt(v.maxAllowedConcentratePct)}</td></tr>`;
    }
    html += `</table>`;
  }
  if (j.passed?.length) {
    html += `<h3>受限但合规</h3><table class="report"><tr><th>原料</th><th>成品含量%</th><th>限量%</th></tr>`;
    for (const p of j.passed) html += `<tr><td>${esc(p.materialRef)}</td><td class="num">${fmt(p.finishedPct)}</td><td class="num">${fmt(p.limitPct)}</td></tr>`;
    html += `</table>`;
  }
  if (j.notices?.length) {
    html += `<h3>提示</h3><ul class="notices">${j.notices.map((n) => `<li>[${esc(n.kind)}] ${esc(n.message)}</li>`).join("")}</ul>`;
  }
  return html + `</div>`;
}

function renderFormula(yaml) {
  let doc;
  try {
    doc = jsYamlLite(yaml);
  } catch (e) {
    return `<div class="card"><h2>配方</h2><div class="error-box">YAML 无法解析:${esc(e.message)}</div></div>`;
  }
  if (!doc) return "";
  const max = Math.max(...doc.formula.map((i) => i.pct), 1);
  const matById = window.__materials ?? {};
  let rows = "";
  for (const ing of doc.formula) {
    const m = matById[ing.materialRef];
    const fam = (m?.family ?? [])[0];
    rows += `<div class="ingredient"><div class="name" title="${esc(m?.name ?? "")}">${esc(ing.materialRef)}` +
      (m ? `<small>${esc(m.name)} · ${esc((m.family ?? []).join("/"))}</small>` : `<small>未知原料</small>`) + `</div>` +
      `<div class="bar"><i style="width:${(ing.pct / max) * 100}%;${fam ? `background:${famColor(fam)}` : ""}"></i></div>` +
      `<div class="pct">${fmt(ing.pct)}%</div></div>`;
  }
  return `<div class="card"><h2>${esc(doc.name ?? "配方")} <small class="muted">${esc(doc.id ?? "")}</small></h2>` +
    `<div class="formula-list">${rows}</div>` +
    `<details class="raw"><summary>查看原始 YAML</summary><pre class="raw-block">${esc(yaml)}</pre></details></div>`;
}

// 极简 YAML 解析(仅支持本 demo 的配方结构;失败则交给后端结果兜底)
function jsYamlLite(yaml) {
  const doc = { formula: [] };
  let cur = null, section = null;
  for (const rawLine of yaml.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "");
    const t = line.trim();
    if (!t) continue;
    const ind = rawLine.match(/^\s*/)[0].length;
    if (ind === 0) { section = t.replace(/:$/, ""); cur = null; continue; }
    const kv = t.match(/^([A-Za-z]+):\s*(.*)$/);
    if (section === "meta" && kv) {
      if (kv[1] === "id") doc.id = kv[2].replace(/["']/g, "");
      if (kv[1] === "name") doc.name = kv[2].replace(/["']/g, "");
      if (kv[1] === "status") doc.status = kv[2].replace(/["']/g, "");
    } else if (section === "formula") {
      if (ind <= 2 && t.startsWith("- ")) {
        cur = {};
        doc.formula.push(cur);
        const rest = t.slice(2);
        const m = rest.match(/^([A-Za-z]+):\s*(.*)$/);
        if (m) cur[m[1]] = m[2].replace(/["']/g, "");
      } else if (cur && kv) {
        cur[kv[1]] = kv[2].replace(/["']/g, "");
      }
    }
  }
  if (!doc.formula.length) throw new Error("未解析到 formula 段");
  for (const ing of doc.formula) ing.pct = Number(ing.pct);
  return doc;
}

function renderAll(resultsEl, { yaml, lint, ifra, logTail, piExitCode }) {
  resultsEl.innerHTML = "";
  if (yaml) resultsEl.insertAdjacentHTML("beforeend", renderFormula(yaml));
  resultsEl.insertAdjacentHTML("beforeend", renderLint(lint));
  resultsEl.insertAdjacentHTML("beforeend", renderIfra(ifra));
  if (typeof piExitCode === "number") {
    resultsEl.insertAdjacentHTML("beforeend",
      `<details class="raw"><summary>Agent 运行日志(pi 退出码 ${piExitCode})</summary><pre class="raw-block">${esc(logTail ?? "")}</pre></details>`);
  }
  // 操作条:入库 + 导出报告
  const bar = document.createElement("div");
  bar.className = "action-bar";
  if (yaml) {
    const save = document.createElement("button");
    save.className = "btn ghost";
    save.textContent = "存入配方库";
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        const name = await saveToLibrary(yaml);
        save.textContent = `已入库:${name}`;
      } catch (e) {
        save.textContent = `入库失败:${e.message}`;
      }
    });
    bar.appendChild(save);
  }
  const md = typeof ifra?.markdown === "string" ? ifra.markdown : null;
  if (md) {
    const exp = document.createElement("button");
    exp.className = "btn ghost";
    exp.textContent = "下载合规报告(.md)";
    exp.addEventListener("click", () => download("ifra-report.md", md));
    bar.appendChild(exp);
  }
  if (bar.children.length) resultsEl.appendChild(bar);
}

// ---------------- validate tab ----------------
$("#btn-validate").addEventListener("click", async () => {
  const yaml = $("#yaml-input").value;
  const btn = $("#btn-validate");
  if (!yaml.trim()) return;
  btn.disabled = true;
  try {
    const r = await fetch("/api/validate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ yaml }),
    });
    const data = await r.json();
    renderAll($("#validate-results"), { yaml, lint: data.lint, ifra: data.ifra });
  } catch (e) {
    $("#validate-results").innerHTML = `<div class="card"><div class="error-box">请求失败:${esc(e.message)}</div></div>`;
  } finally {
    btn.disabled = false;
  }
});

// ---------------- generate tab ----------------
let polling = null;
$("#btn-generate").addEventListener("click", async () => {
  const brief = $("#brief").value.trim();
  if (!brief) return;
  const btn = $("#btn-generate");
  btn.disabled = true;
  $("#generate-progress").classList.remove("hidden");
  $("#generate-results").innerHTML = `<div class="empty-hint card"><p>调香师副驾驶工作中,通常 1–3 分钟…</p></div>`;
  try {
    const r = await fetch("/api/generate", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief, category: catSel.value, useLevelPct: Number($("#useLevel").value) }),
    });
    const { id, error } = await r.json();
    if (error) throw new Error(error);
    polling = setInterval(() => pollJob(id), 2000);
  } catch (e) {
    finishGenerate();
    $("#generate-results").innerHTML = `<div class="card"><div class="error-box">启动失败:${esc(e.message)}</div></div>`;
  }
});

async function pollJob(id) {
  const r = await fetch(`/api/job/${id}`);
  const job = await r.json();
  if (job.status === "running") return;
  clearInterval(polling);
  polling = null;
  finishGenerate();
  if (job.status === "failed") {
    $("#generate-results").innerHTML = `<div class="card"><div class="error-box">${esc(job.error ?? "生成失败")}</div>` +
      `<details class="raw"><summary>运行日志</summary><pre class="raw-block">${esc(job.logTail ?? "")}</pre></details></div>`;
    return;
  }
  renderAll($("#generate-results"), job.result);
  $("#generate-results").scrollIntoView({ behavior: "smooth", block: "start" });
}
function finishGenerate() {
  $("#btn-generate").disabled = false;
  $("#generate-progress").classList.add("hidden");
}

// 原料索引(配方条显示香型用)
fetch("/api/materials").then((r) => r.json()).then(({ materials }) => {
  window.__materials = Object.fromEntries(materials.map((m) => [m.id, m]));
}).catch(() => {});

// ---------------- diff tab ----------------
function renderDiff(data) {
  const el = $("#diff-results");
  if (!data.ok) {
    el.innerHTML = `<div class="card"><h2>配方对比</h2><div class="error-box">${(data.errors ?? []).map(esc).join("<br>")}</div></div>`;
    return;
  }
  const c = data.compliance;
  const badge = (v) => v.ok ? `<span class="badge ok">✅ 合规</span>` : `<span class="badge bad">❌ ${v.violationCount} 项违规</span>`;
  let html = `<div class="card"><h2>对比:${esc(data.meta?.idA ?? "A")} → ${esc(data.meta?.idB ?? "B")}</h2>`;
  html += `<p class="muted">变更:调 ${data.changed.length} / 增 ${data.added.length} / 删 ${data.removed.length} / 未变 ${data.unchangedCount}</p>`;
  if (data.changed.length) {
    html += `<table class="report"><tr><th>原料</th><th>旧%</th><th>新%</th><th>Δ</th></tr>`;
    for (const x of data.changed) {
      const sign = x.delta > 0 ? `+${x.delta}` : `${x.delta}`;
      html += `<tr><td>${esc(x.materialRef)}</td><td class="num">${x.pctA}</td><td class="num">${x.pctB}</td><td class="num ${x.delta > 0 ? "delta-up" : "delta-down"}">${sign}</td></tr>`;
    }
    html += `</table>`;
  }
  if (data.added.length || data.removed.length) {
    html += `<h3>新增 / 移除</h3><ul class="notices">`;
    for (const a of data.added) html += `<li>+ ${esc(a.materialRef)}(${a.pct}%)</li>`;
    for (const r of data.removed) html += `<li>− ${esc(r.materialRef)}(原 ${r.pct}%)</li>`;
    html += `</ul>`;
  }
  html += `<h3>合规差异</h3><div class="verdict">${badge(c.a)}<span class="meta">Category ${esc(c.a.category)},${c.a.useLevelPct}%</span>` +
    `<span class="arrow">→</span>${badge(c.b)}<span class="meta">Category ${esc(c.b.category)},${c.b.useLevelPct}%</span></div>`;
  if (c.newViolationsInB.length) html += `<div class="error-box">⚠️ 新版引入违规:${c.newViolationsInB.map(esc).join(", ")}</div>`;
  if (c.resolvedViolations.length) html += `<p class="good-note">✅ 新版消除违规:${c.resolvedViolations.map(esc).join(", ")}</p>`;
  html += `</div>`;
  el.innerHTML = html;
  const bar = document.createElement("div");
  bar.className = "action-bar";
  const exp = document.createElement("button");
  exp.className = "btn ghost";
  exp.textContent = "下载对比报告(.md)";
  exp.addEventListener("click", () => download("formula-diff.md", data.markdown ?? ""));
  bar.appendChild(exp);
  el.appendChild(bar);
}

$("#btn-diff").addEventListener("click", async () => {
  const yamlA = $("#yaml-a").value;
  const yamlB = $("#yaml-b").value;
  if (!yamlA.trim() || !yamlB.trim()) return;
  const btn = $("#btn-diff");
  btn.disabled = true;
  try {
    const r = await fetch("/api/diff", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ yamlA, yamlB }),
    });
    renderDiff(await r.json());
  } catch (e) {
    $("#diff-results").innerHTML = `<div class="card"><div class="error-box">请求失败:${esc(e.message)}</div></div>`;
  } finally {
    btn.disabled = false;
  }
});
