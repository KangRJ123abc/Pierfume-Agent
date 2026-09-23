#!/usr/bin/env node
/**
 * material-admin(原料添加/校正)+ formula-heatmap 两层测试。
 *   A. 单元 — scripts/material-admin-core.mjs / formula-heatmap-core.mjs(确定性,离线)
 *   B. CLI  — scripts/material-admin.mjs(临时副本写入,退出码 + 输出)
 *
 * 说明:扩展层的审批写盘(ctx.ui.confirm)无法在 print 模式下自动完成,
 *      写路径由 CLI 层覆盖同一份核心代码;pi RPC 链路审批另由前端人工验证。
 *
 * 用例(结构断言,无合规数值断言):
 *   kebabName / extractCas / 用户自有草稿 / PubChem 草稿(mock fetch)/ validateDraft 拦截
 *   mergeAdd 冲突 / mergeUpdate 重置 humanVerified / CLI add+update 临时副本回读
 *   buildHeatmap 2 示例配方矩阵 / 未知原料报错
 */
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN_CORE = join(ROOT, "scripts/material-admin-core.mjs");
const HEATMAP_CORE = join(ROOT, "scripts/formula-heatmap-core.mjs");
const LINT_CORE = join(ROOT, "scripts/formula-lint-core.mjs");
const ADMIN_CLI = join(ROOT, "scripts/material-admin.mjs");
const DATA = join(ROOT, "data/materials.sample.json");

let pass = 0;
let fail = 0;
const failures = [];
function check(layer, name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ [${layer}] ${name}`);
  } else {
    fail++;
    failures.push(`[${layer}] ${name} ${detail}`);
    console.log(`  ✗ [${layer}] ${name} ${detail}`);
  }
}

// ---------- A. 单元 ----------
console.log("A. 单元:material-admin-core + formula-heatmap-core");
const {
  kebabName,
  extractCas,
  buildDraft,
  validateDraft,
  mergeAdd,
  mergeUpdate,
  USER_OWNED_CID,
} = await import(pathToFileURL(ADMIN_CORE).href);
const { buildHeatmap } = await import(pathToFileURL(HEATMAP_CORE).href);
const { lintFormulaYaml } = await import(pathToFileURL(LINT_CORE).href);

// kebabName
check("A", "kebabName 去括号折叠", kebabName("Lilial (BMHCA)") === "lilial");
check("A", "kebabName 多词连字符", kebabName("Alpha-Isomethyl Ionone") === "alpha-isomethyl-ionone");

// extractCas(校验位过滤)
check("A", "extractCas 命中合法 CAS", extractCas(["Linalool", "78-70-6", "CAS 78-70-5"]) === "78-70-6");
check("A", "extractCas 拒绝校验位错误", extractCas(["78-70-5"]) === null);

// 用户自有草稿(无网络)
{
  const { draft, warnings } = await buildDraft({
    cid: USER_OWNED_CID,
    name: "玫瑰净油",
    id: "rose-absolute",
    family: ["floral"],
    note: "heart",
  });
  check("A", "用户自有草稿", draft.cid === USER_OWNED_CID && draft.id === "rose-absolute" && draft.humanVerified !== true);
  check("A", "用户自有无 CAS 通过草稿", validateDraft(draft).length === 0, validateDraft(draft).join(";"));
  check("A", "用户自有警告提示", warnings.some((w) => w.includes("用户自有")));
}
{
  let msg = "";
  try {
    await buildDraft({ cid: USER_OWNED_CID, name: "玫瑰净油", family: ["floral"], note: "heart" });
  } catch (e) {
    msg = e.message;
  }
  check("A", "纯中文名缺 id 显式报错", msg.includes("kebab-case id"), msg);
}

// PubChem 草稿(mock fetch)
const fakeSyn = { InformationList: { Information: [{ Synonym: ["Linalool", "78-70-6"] }] } };
const fakeProp = { PropertyTable: { Properties: [{ Title: "Linalool", MolecularWeight: 154.25, IUPACName: "3,7-dimethylocta-1,6-dien-3-ol" }] } };
const mockFetch = async (url) => {
  if (url.includes("/synonyms/")) return { ok: true, json: async () => fakeSyn };
  if (url.includes("/property/")) return { ok: true, json: async () => fakeProp };
  if (url.includes("/cids/")) return { ok: true, json: async () => ({ IdentifierList: { CID: [6549] } }) };
  return { ok: false, status: 404 };
};
{
  const { draft } = await buildDraft({ cid: 6549, family: ["floral"], note: "top", odor: "floral" }, mockFetch);
  check("A", "PubChem 草稿机器解析", draft.name === "Linalool" && draft.cas === "78-70-6" && draft.physChem.molWeight === 154.25);
  check("A", "PubChem 草稿 humanVerified=false", draft.provenance.humanVerified === false);
  check("A", "PubChem 草稿通过校验", validateDraft(draft).length === 0, validateDraft(draft).join(";"));
}
{
  const { draft } = await buildDraft({ name: "linalool", family: ["floral"], note: "top" }, mockFetch);
  check("A", "名称解析路径(名称→CID→属性)", draft.cid === 6549);
}

// validateDraft 拦截
{
  const bad = { id: "x", name: "X", cid: 6549, family: ["floral"], note: "top", provenance: { sources: [], humanVerified: false } };
  check("A", "整数 CID 缺 CAS 被拦截", validateDraft(bad).some((e) => e.includes("cas 必填")));
  const badCas = { ...bad, cas: "78-70-5" };
  check("A", "校验位错误 CAS 被拦截", validateDraft(badCas).some((e) => e.includes("校验位")));
}

// mergeAdd 冲突
{
  const materials = JSON.parse(readFileSync(DATA, "utf8"));
  const dupId = { ...materials[0] };
  let msg = "";
  try {
    mergeAdd(materials, dupId);
  } catch (e) {
    msg = e.message;
  }
  check("A", "mergeAdd id 冲突抛错", msg.includes("已存在"));
  const dupCid = { ...materials[1], id: "another-id", cid: materials[0].cid };
  msg = "";
  try {
    mergeAdd(materials, dupCid);
  } catch (e) {
    msg = e.message;
  }
  check("A", "mergeAdd CID 冲突抛错", msg.includes("CID"), msg);
}

// mergeUpdate 重置核对状态
{
  const materials = JSON.parse(readFileSync(DATA, "utf8"));
  const target = materials.find((m) => m.id === "linalool");
  const { next, before, after } = mergeUpdate(materials, "linalool", { odor: "floral, woody" });
  check("A", "mergeUpdate 应用补丁", after.odor === "floral, woody" && before.odor !== after.odor);
  check("A", "mergeUpdate 重置 humanVerified", after.provenance.humanVerified === false && target.provenance.humanVerified === true);
  check("A", "mergeUpdate 追加来源", after.provenance.sources.length === before.provenance.sources.length + 1);
  check("A", "mergeUpdate 原数组不变", next.find((m) => m.id === "linalool").odor === "floral, woody" &&
    materials.find((m) => m.id === "linalool").odor === before.odor);
  let msg = "";
  try {
    mergeUpdate(materials, "no-such-id", { odor: "x" });
  } catch (e) {
    msg = e.message;
  }
  check("A", "mergeUpdate 未知 id 抛错", msg.includes("不存在"));
}

// buildHeatmap
{
  const materials = JSON.parse(readFileSync(DATA, "utf8"));
  const a = readFileSync(join(ROOT, "examples/formula.citrus-cologne.yaml"), "utf8");
  const b = readFileSync(join(ROOT, "examples/formula.musk-amber.yaml"), "utf8");
  const hm = buildHeatmap(
    [
      { label: "citrus", raw: a },
      { label: "musk", raw: b },
    ],
    materials,
  );
  check("A", "heatmap 矩阵形状", hm.ok && hm.rows.length === 2 && hm.materials.length > 0);
  const limeCol = hm.materials.findIndex((m) => m.id === "limonene");
  check("A", "heatmap limonene 列 citrus 有值/musk 为空", hm.rows[0].values[limeCol] !== null && hm.rows[1].values[limeCol] === null);
  const vanCol = hm.materials.findIndex((m) => m.id === "vanillin");
  check("A", "heatmap vanillin 两版均有值", hm.rows[0].values[vanCol] !== null && hm.rows[1].values[vanCol] !== null);
  const bad = buildHeatmap([{ label: "x", raw: "formula:\n  - materialRef: no-such\n    pct: 100\n" }], materials);
  check("A", "heatmap 未知原料报错", !bad.ok && bad.errors.some((e) => e.includes("no-such")));
}

// pyramid lint(示例 musk-amber 新增字段回归)
{
  const raw = readFileSync(join(ROOT, "examples/formula.musk-amber.yaml"), "utf8");
  const r = lintFormulaYaml(raw, "musk-amber");
  check("A", "musk-amber(含 accord+pyramid)lint 通过", r.ok, r.errors.join(";"));
  const badPyr = raw.replace("  top: [ethanol]", "  top: [ethanol, no-such-material]");
  const r2 = lintFormulaYaml(badPyr, "bad-pyramid");
  check("A", "金字塔未知原料被拦截", !r2.ok && r2.errors.some((e) => e.includes("no-such-material")));
  const orphanPyr = raw.replace(
    "  heart: [alpha-isomethyl-ionone, hydroxycitronellal, methyl-anthranilate, eugenol, cinnamal]",
    "  heart: [alpha-isomethyl-ionone, hydroxycitronellal, methyl-anthranilate, eugenol, cinnamal, benzyl-benzoate]",
  );
  const r3 = lintFormulaYaml(orphanPyr, "orphan-pyramid");
  check("A", "金字塔原料须在组成中", !r3.ok && r3.errors.some((e) => e.includes("未在配方组成中出现")));
}

// ---------- B. CLI(临时副本) ----------
console.log("B. CLI:material-admin add/update(临时副本)");
const tmp = mkdtempSync(join(tmpdir(), "pierfume-admin-"));
const tmpData = join(tmp, "materials.json");
copyFileSync(DATA, tmpData);

const draftJson = JSON.stringify({
  id: "test-rose-oxide",
  name: "Rose Oxide",
  cid: 61847,
  cas: "16409-43-1",
  family: ["floral"],
  note: "top",
  provenance: { sources: ["mock"], humanVerified: false },
});
{
  const r = spawnSync(process.execPath, [ADMIN_CLI, "add", "--data", tmpData, "--json", draftJson], { encoding: "utf8" });
  const back = JSON.parse(readFileSync(tmpData, "utf8"));
  check("B", "CLI add 写入并回读", r.status === 0 && back.some((m) => m.id === "test-rose-oxide"), (r.stderr ?? "").slice(0, 120));
}
{
  const r = spawnSync(process.execPath, [ADMIN_CLI, "add", "--data", tmpData, "--json", draftJson], { encoding: "utf8" });
  check("B", "CLI add 重复 id 拒绝", r.status === 1 && (r.stderr ?? "").includes("已存在"));
}
{
  const r = spawnSync(
    process.execPath,
    [ADMIN_CLI, "update", "--data", tmpData, "--id", "test-rose-oxide", "--json", JSON.stringify({ note: "heart" })],
    { encoding: "utf8" },
  );
  const back = JSON.parse(readFileSync(tmpData, "utf8"));
  const m = back.find((x) => x.id === "test-rose-oxide");
  check("B", "CLI update 应用补丁", r.status === 0 && m.note === "heart", (r.stderr ?? "").slice(0, 120));
}
{
  const r = spawnSync(process.execPath, [ADMIN_CLI, "add", "--data", DATA, "--json", draftJson], { encoding: "utf8" });
  check("B", "真实原料库无 --yes 拒绝写入", r.status === 1 && (r.stderr ?? "").includes("--yes"));
}
{
  // 用户自有:CLI preview 无网络路径
  const r = spawnSync(
    process.execPath,
    [ADMIN_CLI, "preview", "--cid", "用户自有", "--name", "玫瑰净油", "--id", "rose-absolute", "--family", "floral", "--note", "heart"],
    { encoding: "utf8" },
  );
  check("B", "CLI preview 用户自有(离线)", r.status === 0 && r.stdout.includes('"cid": "用户自有"'), (r.stderr ?? "").slice(0, 120));
}

console.log(`\n结果:${pass} 通过,${fail} 失败`);
if (fail) {
  console.log("失败项:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
