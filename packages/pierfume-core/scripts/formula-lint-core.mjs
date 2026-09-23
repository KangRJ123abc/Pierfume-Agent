/**
 * formula-lint 共享校验核心(零副作用,无 CLI 输出)。
 * 由 scripts/validate-formula.mjs(独立 CLI)与 extensions/formula-lint/index.ts(Pi 扩展)共用,
 * 保证"调香师命令行校验"与"Agent 工具链校验"走同一实现。
 *
 * 校验项:
 *   1. YAML 可解析
 *   2. 符合 schemas/formula.schema.json
 *   3. formula[].materialRef 必须在 data/materials.sample.json 中存在(跨文件引用完整性)
 *   3b. pyramid 前/中/后调引用必须存在,且须同时出现在 formula 组成中
 *   4. 同一 materialRef 不得重复出现
 *   5. 各 pct 合计 ≈ 100(容差 SUM_TOLERANCE,防四舍五入误报)
 *
 * 数据/schema 按本文件所在包的相对路径运行时读取(pi install 后包布局不变)。
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { validateValue } from "./schema-validator.mjs";

export const SUM_TOLERANCE = 1.0; // 总量归一容差 ±1%

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let schemaCache = null;
let materialsCache = null;

/**
 * 读取项目级规则文件(cwd 下的 pierfume.project.json)。
 * 不存在或格式不对时返回空规则(不报错)——项目文件是可选增强。
 * @returns {{bannedMaterials: string[]}}
 */
export function loadProjectRules(cwd = process.cwd()) {
  try {
    const file = join(cwd, "pierfume.project.json");
    if (!existsSync(file)) return { bannedMaterials: [] };
    const doc = JSON.parse(readFileSync(file, "utf8"));
    const banned = Array.isArray(doc.bannedMaterials) ? doc.bannedMaterials.filter((x) => typeof x === "string") : [];
    return { bannedMaterials: banned };
  } catch {
    return { bannedMaterials: [] };
  }
}

function loadFormulaSchema() {
  if (schemaCache === null) {
    schemaCache = JSON.parse(readFileSync(join(ROOT, "schemas/formula.schema.json"), "utf8"));
  }
  return schemaCache;
}

function loadMaterials() {
  if (materialsCache === null) {
    materialsCache = JSON.parse(readFileSync(join(ROOT, "data/materials.sample.json"), "utf8"));
  }
  return materialsCache;
}

/** 供扩展使用:原料表(带缓存)。 */
export function getMaterials() {
  return loadMaterials();
}

/**
 * 校验单个配方 YAML 文本。
 * @param {string} raw YAML 原文
 * @param {string} label 错误信息中的文件标签(如 "examples/formula.example.yaml")
 * @param {{bannedMaterials?: string[]}} [project] 项目级规则(来自 cwd 下 pierfume.project.json):
 *   bannedMaterials —— 客户禁限用清单,命中即判违规(项目红线,独立于 IFRA)
 * @returns {{ ok: boolean, errors: string[], unverifiedRefs: string[], ingredientCount: number|null }}
 *   unverifiedRefs: 引用了 humanVerified=false 原料的 id 列表(仅提示,不判错;测试断言须拒绝此类数据)
 */
export function lintFormulaYaml(raw, label, project = {}) {
  const errors = [];

  let doc;
  try {
    doc = parse(raw);
  } catch (e) {
    return { ok: false, errors: [`${label}: YAML 解析失败 — ${e.message}`], unverifiedRefs: [], ingredientCount: null };
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, errors: [`${label}: 顶层必须是一个 YAML 映射对象`], unverifiedRefs: [], ingredientCount: null };
  }

  const schema = loadFormulaSchema();
  const materials = loadMaterials();
  const matById = new Map(materials.map((m) => [m.id, m]));

  // 1. JSON Schema 校验
  validateValue(doc, schema, label, errors);

  // 2. 跨文件引用:materialRef → materials.sample.json id;3. 重复原料
  const unverifiedRefs = [];
  if (Array.isArray(doc.formula)) {
    const seen = new Set();
    doc.formula.forEach((ing, i) => {
      const ref = ing?.materialRef;
      if (typeof ref !== "string") return; // 类型错误已由 schema 报告
      if (!matById.has(ref)) errors.push(`${label}.formula[${i}].materialRef: 引用的原料不存在: "${ref}"`);
      if (seen.has(ref)) errors.push(`${label}.formula[${i}].materialRef: 原料重复出现: "${ref}"`);
      seen.add(ref);
      const m = matById.get(ref);
      if (m && !m.provenance?.humanVerified) unverifiedRefs.push(ref);
    });
  }

  // 3b. 香调金字塔:refs 存在 + 与 formula 组成一致
  if (doc.pyramid && typeof doc.pyramid === "object" && !Array.isArray(doc.pyramid)) {
    const compRefs = new Set(
      Array.isArray(doc.formula) ? doc.formula.map((i) => i?.materialRef).filter((x) => typeof x === "string") : [],
    );
    for (const tier of ["top", "heart", "base"]) {
      const arr = doc.pyramid[tier];
      if (!Array.isArray(arr)) continue;
      arr.forEach((ref, i) => {
        if (typeof ref !== "string") return; // 类型错误已由 schema 报告
        if (!matById.has(ref)) errors.push(`${label}.pyramid.${tier}[${i}]: 引用的原料不存在: "${ref}"`);
        else if (!compRefs.has(ref)) errors.push(`${label}.pyramid.${tier}[${i}]: 金字塔原料未在配方组成中出现: "${ref}"`);
      });
    }
  }

  // 项目级红线:客户禁限用清单(pierfume.project.json 的 bannedMaterials)
  if (Array.isArray(project.bannedMaterials) && Array.isArray(doc.formula)) {
    const banned = new Set(project.bannedMaterials);
    doc.formula.forEach((ing, i) => {
      const ref = ing?.materialRef;
      if (typeof ref === "string" && banned.has(ref))
        errors.push(`${label}.formula[${i}].materialRef: 项目禁限用清单命中: "${ref}"`);
    });
  }

  // 4. 总量归一
  if (Array.isArray(doc.formula) && doc.formula.every((i) => typeof i?.pct === "number")) {
    const sum = doc.formula.reduce((s, i) => s + i.pct, 0);
    if (Math.abs(sum - 100) > SUM_TOLERANCE)
      errors.push(`${label}: 剂量合计 ${sum.toFixed(2)}%,超出 100±${SUM_TOLERANCE} 容差`);
  }

  return {
    ok: errors.length === 0,
    errors,
    unverifiedRefs,
    ingredientCount: Array.isArray(doc.formula) ? doc.formula.length : null,
  };
}
