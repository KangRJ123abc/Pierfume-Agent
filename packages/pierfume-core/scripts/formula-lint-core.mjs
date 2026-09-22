/**
 * formula-lint 共享校验核心(零副作用,无 CLI 输出)。
 * 由 scripts/validate-formula.mjs(独立 CLI)与 extensions/formula-lint/index.ts(Pi 扩展)共用,
 * 保证"调香师命令行校验"与"Agent 工具链校验"走同一实现。
 *
 * 校验项:
 *   1. YAML 可解析
 *   2. 符合 schemas/formula.schema.json
 *   3. formula[].materialRef 必须在 data/materials.sample.json 中存在(跨文件引用完整性)
 *   4. 同一 materialRef 不得重复出现
 *   5. 各 pct 合计 ≈ 100(容差 SUM_TOLERANCE,防四舍五入误报)
 *
 * 数据/schema 按本文件所在包的相对路径运行时读取(pi install 后包布局不变)。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { validateValue } from "./schema-validator.mjs";

export const SUM_TOLERANCE = 1.0; // 总量归一容差 ±1%

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let schemaCache = null;
let materialsCache = null;

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

/**
 * 校验单个配方 YAML 文本。
 * @param {string} raw YAML 原文
 * @param {string} label 错误信息中的文件标签(如 "examples/formula.example.yaml")
 * @returns {{ ok: boolean, errors: string[], unverifiedRefs: string[], ingredientCount: number|null }}
 *   unverifiedRefs: 引用了 humanVerified=false 原料的 id 列表(仅提示,不判错;测试断言须拒绝此类数据)
 */
export function lintFormulaYaml(raw, label) {
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
