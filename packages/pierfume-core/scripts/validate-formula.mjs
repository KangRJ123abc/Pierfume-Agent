#!/usr/bin/env node
/**
 * pierfume-core 配方校验脚本(D1 阶段;D2 将移植为 formula-lint 扩展)。
 *
 * 校验内容(对每个配方 YAML 文件):
 *   1. YAML 可解析,且符合 schemas/formula.schema.json
 *   2. formula[].materialRef 必须在 data/materials.sample.json 中存在(跨文件引用完整性)
 *   3. 同一 materialRef 不得重复出现
 *   4. 各 pct 合计 ≈ 100(容差 ±1,防四舍五入误报)
 *
 * 用法:
 *   npm run validate-formula                     # 校验默认示例 examples/formula.example.yaml
 *   npm run validate-formula -- path/to/f.yaml   # 校验指定配方文件
 *
 * 说明:引用 humanVerified=false 的原料(未人工核对的初稿)时仅提示,不报错;
 * 测试断言仍应拒绝 unverified 数据。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import { parse } from "yaml";
import { validateValue } from "./schema-validator.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SUM_TOLERANCE = 1.0; // 总量归一容差 ±1%

function main() {
  const args = process.argv.slice(2);
  const files = args.length ? args : ["examples/formula.example.yaml"];

  const materials = JSON.parse(readFileSync(join(ROOT, "data/materials.sample.json"), "utf8"));
  const schema = JSON.parse(readFileSync(join(ROOT, "schemas/formula.schema.json"), "utf8"));
  const matById = new Map(materials.map((m) => [m.id, m]));
  const unverifiedIds = new Set(
    materials.filter((m) => !m.provenance.humanVerified).map((m) => m.id)
  );

  let anyError = false;
  for (const file of files) {
    const errors = [];
    const path = isAbsolute(file) ? file : join(ROOT, file);
    const label = isAbsolute(file) ? file.split(/[\\/]/).pop() : `examples/${file.split("/").pop()}`;

    let doc;
    try {
      doc = parse(readFileSync(path, "utf8"));
    } catch (e) {
      console.error(`❌ ${label}: YAML 解析失败 — ${e.message}`);
      anyError = true;
      continue;
    }
    if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
      console.error(`❌ ${label}: 顶层必须是一个 YAML 映射对象`);
      anyError = true;
      continue;
    }

    // 1. JSON Schema 校验
    validateValue(doc, schema, label, errors);

    // 2. 跨文件引用:materialRef → materials.sample.json id
    if (Array.isArray(doc.formula)) {
      const seen = new Set();
      doc.formula.forEach((ing, i) => {
        const ref = ing?.materialRef;
        if (typeof ref !== "string") return; // 类型错误已由 schema 报告
        if (!matById.has(ref))
          errors.push(`${label}.formula[${i}].materialRef: 引用的原料不存在: "${ref}"`);
        if (seen.has(ref))
          errors.push(`${label}.formula[${i}].materialRef: 原料重复出现: "${ref}"`);
        seen.add(ref);
      });
    }

    // 3. 总量归一
    if (Array.isArray(doc.formula) && doc.formula.every((i) => typeof i?.pct === "number")) {
      const sum = doc.formula.reduce((s, i) => s + i.pct, 0);
      if (Math.abs(sum - 100) > SUM_TOLERANCE)
        errors.push(`${label}: 剂量合计 ${sum.toFixed(2)}%,超出 100±${SUM_TOLERANCE} 容差`);
    }

    if (errors.length) {
      console.error(errors.join("\n"));
      console.error(`❌ ${label}: 校验失败,${errors.length} 个错误`);
      anyError = true;
    } else {
      console.log(`✅ ${label}: 通过 (${doc.formula?.length ?? 0} 个原料, category ${doc.product?.category})`);
      const unver = (doc.formula ?? []).filter((i) => unverifiedIds.has(i.materialRef));
      if (unver.length)
        console.log(`⚠️  ${label}: 引用 ${unver.length} 个未人工核对的原料 ${unver.map((i) => i.materialRef).join(", ")} — 不得用于测试断言`);
    }
  }

  if (anyError) process.exit(1);
}

main();
