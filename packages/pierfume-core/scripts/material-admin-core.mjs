/**
 * material-admin 共享核心:原料添加/校正的草稿构建、校验与合并(文件路径可注入)。
 * 由 extensions/data-admin/index.ts(Pi 扩展,带审批写盘)与 scripts/material-admin.mjs(CLI)共用。
 *
 * 红线约束(项目 AGENTS.md §5):
 *   - 事实性字段(CID/CAS)只能来自 PubChem 机器解析,模型记忆不得入库;
 *   - 机器解析的原料 humanVerified=false,人工逐条核对后方可置 true;
 *   - cid 必填:正整数(PubChem CID)或字面量 "用户自有";cid 为整数时 cas 必填。
 *
 * 设计:纯函数(校验/合并)与 IO(PubChem fetch、文件读写)分离,便于离线测试。
 * 数据文件默认按本文件所在包的相对路径解析(pi install 后包布局不变)。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateValue } from "./schema-validator.mjs";
import { casCheckDigitValid } from "./cas-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const MATERIALS_PATH = join(ROOT, "data/materials.sample.json");
export const USER_OWNED_CID = "用户自有";
const PUG = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";
const FETCH_TIMEOUT_MS = 15_000;

let schemaCache = null;
function loadMaterialsSchema() {
  if (schemaCache === null)
    schemaCache = JSON.parse(readFileSync(join(ROOT, "schemas/materials.schema.json"), "utf8"));
  return schemaCache;
}

// ---------------------------------------------------------------------------
// 文件 IO(路径可注入,CLI/测试可用 --data 指向临时副本)
// ---------------------------------------------------------------------------
export function loadMaterialsFile(path = MATERIALS_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function saveMaterialsFile(materials, path = MATERIALS_PATH) {
  writeFileSync(path, JSON.stringify(materials, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// 纯函数:命名 / CAS 抽取 / 校验 / 合并
// ---------------------------------------------------------------------------

/** 由常用名生成 kebab-case id:去括号内容、小写、非字母数字折叠为连字符。 */
export function kebabName(name) {
  return name
    .replace(/[([（][^)\]）]*[\])\）]/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** 从 PubChem synonyms 列表抽取通过校验位算法的 CAS 号(首个命中)。 */
export function extractCas(synonyms) {
  for (const s of synonyms) {
    const m = /\b(\d{2,7}-\d{2}-\d)\b/.exec(s);
    if (m && casCheckDigitValid(m[1])) return m[1];
  }
  return null;
}

/** 单条草稿的 schema + 业务校验(不查重;查重由 merge* 负责)。 */
export function validateDraft(draft) {
  const errors = [];
  const itemsSchema = loadMaterialsSchema().items;
  validateValue(draft, itemsSchema, `draft(${draft.id ?? "?"})`, errors);
  if (draft.cas !== undefined && !casCheckDigitValid(draft.cas))
    errors.push(`draft(${draft.id}).cas: CAS 校验位不通过: "${draft.cas}"`);
  if (Number.isInteger(draft.cid) && draft.cas === undefined)
    errors.push(`draft(${draft.id}).cas: cid 为 PubChem 整数(${draft.cid})时 cas 必填`);
  return errors;
}

/** 添加草稿:返回新数组;id 或整数 cid 冲突时抛错。 */
export function mergeAdd(materials, draft) {
  if (materials.some((m) => m.id === draft.id))
    throw new Error(`原料 id 已存在: "${draft.id}"(如需修改请用 material_update)`);
  if (Number.isInteger(draft.cid) && materials.some((m) => m.cid === draft.cid))
    throw new Error(`PubChem CID ${draft.cid} 已存在于原料库(${materials.find((m) => m.cid === draft.cid).id})`);
  return [...materials, draft];
}

/**
 * 校正既有原料:id 不可变;humanVerified 重置为 false 并追加修改来源(修改后须重新人工核对)。
 * patch 允许的键:name/cid/cas/family/note/odor/physChem/ifraEntryRef/euAllergen/synonyms。
 * 返回 { next, before, after }。
 */
export function mergeUpdate(materials, id, patch) {
  const idx = materials.findIndex((m) => m.id === id);
  if (idx === -1) throw new Error(`原料不存在: "${id}"`);
  const before = materials[idx];
  const provenance = {
    ...before.provenance,
    sources: [
      ...(before.provenance?.sources ?? []),
      `material_update 修改 ${today()}: ${Object.keys(patch).join(",")}`,
    ],
    humanVerified: false,
  };
  delete provenance.verifiedBy; // 重置核对状态:改内存对象须真删键(JSON.stringify 会丢 undefined,但校验发生在序列化前)
  delete provenance.verifiedAt;
  const after = { ...before, ...patch, provenance };
  const next = materials.slice();
  next[idx] = after;
  return { next, before, after };
}

// ---------------------------------------------------------------------------
// PubChem 机器解析(IO;红线:事实字段唯一合法来源)
// ---------------------------------------------------------------------------
async function fetchPubChemJson(path, fetchImpl) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(PUG + path, { signal: ctl.signal });
    if (!res.ok) throw new Error(`PubChem ${res.status} (${path})`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** CID → 基础属性 + synonyms。 */
export async function resolveByCid(cid, fetchImpl = fetch) {
  const prop = await fetchPubChemJson(
    `/compound/cid/${cid}/property/Title,MolecularFormula,MolecularWeight,IUPACName/JSON`,
    fetchImpl,
  );
  const syn = await fetchPubChemJson(`/compound/cid/${cid}/synonyms/JSON`, fetchImpl);
  const p = prop?.PropertyTable?.Properties?.[0];
  if (!p) throw new Error(`PubChem CID ${cid} 无属性记录`);
  return {
    title: p.Title ?? null,
    iupac: p.IUPACName ?? null,
    molFormula: p.MolecularFormula ?? null,
    molWeight: typeof p.MolecularWeight === "number" ? p.MolecularWeight : null,
    synonyms: syn?.InformationList?.Information?.[0]?.Synonym ?? [],
  };
}

/** 化合物名(含部分商品名)→ 首个 CID。 */
export async function resolveCidByName(name, fetchImpl = fetch) {
  const data = await fetchPubChemJson(`/compound/name/${encodeURIComponent(name)}/cids/JSON`, fetchImpl);
  const cids = data?.IdentifierList?.CID;
  if (!Array.isArray(cids) || cids.length === 0) throw new Error(`PubChem 无法按名称解析: "${name}"`);
  return cids[0];
}

/**
 * 构建原料草稿。
 * @param {object} item { cid?: number|"用户自有", name?, id?, family?, note?, odor?, cas?, ifraEntryRef? }
 *   - cid 为整数:机器解析名称/CAS/分子量;
 *   - cid 省略但给 name:先走 PubChem 名称解析(name→CID)再按整数路径;
 *   - cid 为 "用户自有":name 必填,无网络。
 * @returns {Promise<{draft: object, warnings: string[]}>}
 * @throws 缺必填分类字段(family/note)或 PubChem 解析失败
 */
export async function buildDraft(item, fetchImpl = fetch) {
  const warnings = [];
  const missing = [];
  if (!Array.isArray(item.family) || item.family.length === 0) missing.push("family(香型,受控词表)");
  if (!item.note) missing.push("note(top/heart/base)");
  if (missing.length) throw new Error(`草稿缺少必填分类字段: ${missing.join("、")}(由 Agent/用户在审批前给出,机器不提供)`);

  if (item.cid === undefined) {
    if (!item.name?.trim()) throw new Error(`cid 与 name 至少给一项:${JSON.stringify({ cid: item.cid, name: item.name })}`);
    item = { ...item, cid: await resolveCidByName(item.name.trim(), fetchImpl) };
    warnings.push(`名称 "${item.name}" 经 PubChem 解析为 CID ${item.cid}`);
  }

  if (item.cid === USER_OWNED_CID) {
    if (!item.name?.trim()) throw new Error('cid 为 "用户自有" 时 name 必填');
    const draft = {
      id: item.id?.trim() || kebabName(item.name),
      name: item.name.trim(),
      cid: USER_OWNED_CID,
      ...(item.cas ? { cas: item.cas } : {}),
      family: item.family,
      note: item.note,
      ...(item.odor ? { odor: item.odor } : {}),
      ...(item.ifraEntryRef !== undefined ? { ifraEntryRef: item.ifraEntryRef } : {}),
      provenance: { sources: [`用户自有原料,无 PubChem 记录 (${today()})`], humanVerified: false },
    };
    if (!draft.id) throw new Error(`无法由名称生成 id: "${item.name}"(纯中文名请显式给出 kebab-case id,如 "rose-absolute")`);
    warnings.push("用户自有原料:CAS 未经验证,请人工核对后置 humanVerified=true");
    return { draft, warnings };
  }

  if (!Number.isInteger(item.cid) || item.cid <= 0) throw new Error(`cid 必须是正整数或 "${USER_OWNED_CID}": ${JSON.stringify(item.cid)}`);
  const pc = await resolveByCid(item.cid, fetchImpl);
  const cas = item.cas ?? extractCas(pc.synonyms);
  if (!cas) warnings.push(`PubChem CID ${item.cid} 的 synonyms 未找到通过校验位的 CAS(可稍后人工补录)`);
  const draft = {
    id: item.id?.trim() || kebabName(item.name?.trim() || pc.title || ""),
    name: item.name?.trim() || pc.title || String(item.cid),
    cid: item.cid,
    ...(cas ? { cas } : {}),
    family: item.family,
    note: item.note,
    ...(item.odor ? { odor: item.odor } : {}),
    ...(pc.molWeight ? { physChem: { molWeight: pc.molWeight } } : {}),
    ...(item.ifraEntryRef !== undefined ? { ifraEntryRef: item.ifraEntryRef } : {}),
    provenance: {
      sources: [`PubChem CID ${item.cid} (PUG REST 机器解析 ${today()};名称/分子量来自 PubChem,CAS 经校验位算法)`],
      humanVerified: false,
    },
  };
  if (!draft.id) throw new Error(`无法由名称生成 id: "${item.name ?? pc.title}"`);
  return { draft, warnings };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
