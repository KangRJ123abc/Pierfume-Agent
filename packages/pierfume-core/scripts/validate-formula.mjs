#!/usr/bin/env node
/**
 * pierfume-core 配方校验 CLI(独立于 Pi 运行,供开发/CI 使用)。
 * 校验逻辑见 ./formula-lint-core.mjs(Pi 扩展 formula-lint 与本品共用同一实现)。
 *
 * 校验内容(对每个配方 YAML 文件):
 *   1. YAML 可解析,且符合 schemas/formula.schema.json
 *   2. formula[].materialRef 必须在 data/materials.sample.json 中存在
 *   3. 同一 materialRef 不得重复出现
 *   4. 各 pct 合计 ≈ 100(容差 ±1)
 *
 * 用法:
 *   npm run validate-formula                     # 校验默认示例 examples/formula.example.yaml
 *   npm run validate-formula -- path/to/f.yaml   # 校验指定配方文件(支持绝对路径)
 *
 * 说明:引用 humanVerified=false 的原料(未人工核对的初稿)时仅提示,不报错;
 * 测试断言仍应拒绝 unverified 数据。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import { lintFormulaYaml } from "./formula-lint-core.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function main() {
  const args = process.argv.slice(2);
  const files = args.length ? args : ["examples/formula.example.yaml"];

  let anyError = false;
  for (const file of files) {
    const path = isAbsolute(file) ? file : join(ROOT, file);
    const label = isAbsolute(file) ? file.split(/[\\/]/).pop() : file;

    let raw;
    try {
      raw = readFileSync(path, "utf8");
    } catch (e) {
      console.error(`❌ ${label}: 无法读取文件 — ${e.message}`);
      anyError = true;
      continue;
    }

    const { ok, errors, unverifiedRefs, ingredientCount } = lintFormulaYaml(raw, label);
    if (!ok) {
      console.error(errors.join("\n"));
      console.error(`❌ ${label}: 校验失败,${errors.length} 个错误`);
      anyError = true;
    } else {
      console.log(`✅ ${label}: 通过 (${ingredientCount} 个原料)`);
      if (unverifiedRefs.length)
        console.log(`⚠️  ${label}: 引用 ${unverifiedRefs.length} 个未人工核对的原料 ${unverifiedRefs.join(", ")} — 不得用于测试断言`);
    }
  }

  if (anyError) process.exit(1);
}

main();
