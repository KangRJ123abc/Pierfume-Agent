#!/usr/bin/env node
/**
 * pierfume-core 数据校验脚本(零依赖)。
 *
 * 校验内容:
 *   1. data/materials.sample.json 与 data/ifra-rules.json 符合各自 JSON Schema
 *   2. 所有 CAS 号通过校验位算法(格式 + 最后一位校验)
 *   3. materials.ifraEntryRef 必须能在 ifra-rules.json entries 中找到(跨文件引用完整性)
 *
 * 用法:
 *   npm run validate-data            # 校验数据文件
 *   npm run validate-data:self       # 先运行内置自测(验证校验器自身正确),再校验数据
 *
 * 说明:humanVerified=false 的数据(即 AI 整理的初稿)允许存在,但不得用于测试断言。
 * 脚本对未核对数据只提示、不报错;测试入口应自行拒绝 unverified 数据。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateValue } from "./schema-validator.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

function err(path, msg) {
  errors.push(`${path}: ${msg}`);
}

// ---------------------------------------------------------------------------
// CAS 号校验位
// ---------------------------------------------------------------------------
// 算法:取去掉校验位的数字(从右往左),依次乘以 1,2,3,... 求和,校验位 = 和 mod 10。
// 例:5989-27-5 → 基数字符串 "598927",从右到左 7*1+2*2+9*3+8*4+9*5+5*6=145,145%10=5 ✓
export function casCheckDigitValid(cas) {
  const m = /^(\d{2,7})-(\d{2})-(\d)$/.exec(cas);
  if (!m) return false;
  const base = (m[1] + m[2]).split("").reverse().join("");
  let sum = 0;
  for (let i = 0; i < base.length; i++) sum += (i + 1) * Number(base[i]);
  return sum % 10 === Number(m[3]);
}

// 迷你 JSON Schema 校验器见 ./schema-validator.mjs(两脚本共用)

function validateJson(path, schemaPath) {
  const data = JSON.parse(readFileSync(join(ROOT, path), "utf8"));
  const schema = JSON.parse(readFileSync(join(ROOT, schemaPath), "utf8"));
  validateValue(data, schema, path, errors);
  return data;
}

// ---------------------------------------------------------------------------
// 自测:验证校验器自身逻辑(防"校验器写错导致假阳性/假阴性")
// ---------------------------------------------------------------------------
function selftest() {
  const fail = [];
  const check = (name, cond) => { if (!cond) fail.push(`selftest 失败: ${name}`); };

  // CAS 校验位
  check("合法 CAS 5989-27-5", casCheckDigitValid("5989-27-5") === true);
  check("合法 CAS 91-64-5", casCheckDigitValid("91-64-5") === true);
  check("校验位错误 5989-27-6", casCheckDigitValid("5989-27-6") === false);
  check("格式错误 598927-5", casCheckDigitValid("598927-5") === false);
  check("格式错误 91-64", casCheckDigitValid("91-64") === false);

  // schema 校验器:命中 = 有错误
  const hit = (schema, value) => {
    const e = [];
    validateValue(value, schema, "$", e);
    return e.length > 0;
  };
  check("缺必填字段被拦截", hit({ required: ["a"] }, {}));
  check("额外字段被拦截", hit({ properties: { a: {} }, additionalProperties: false }, { a: 1, b: 2 }));
  check("pattern 不匹配被拦截", hit({ pattern: "^x" }, "abc"));
  check("enum 越界被拦截", hit({ enum: [1, 2] }, 3));
  check("类型错误被拦截", hit({ type: "string" }, 5));
  check("integer 类型正确放行", !hit({ type: "integer" }, 5));
  check("number 兼容 integer 放行", !hit({ type: "number" }, 5));
  check("数组子项递归", hit({ items: { type: "number" } }, [1, "x"]));
  check("null 与 type 组合", !hit({ type: ["number", "null"] }, null));
  check("uniqueItems 拦截", hit({ uniqueItems: true }, [1, 1]));
  check("minItems 拦截", hit({ minItems: 1 }, []));

  if (fail.length) {
    console.error(fail.join("\n"));
    process.exit(1);
  }
  console.log("✅ 校验器自测通过");
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) selftest();

  const materials = validateJson("data/materials.sample.json", "schemas/materials.schema.json");
  const ifra = validateJson("data/ifra-rules.json", "schemas/ifra-rules.schema.json");

  // CAS 校验位
  materials.forEach((m, i) => {
    if (!casCheckDigitValid(m.cas)) err(`materials.sample.json[${i}].cas`, `CAS 校验位不通过: "${m.cas}"`);
  });
  ifra.entries.forEach((e, i) => {
    e.cas.forEach((c) => {
      if (!casCheckDigitValid(c)) err(`ifra-rules.json.entries[${i}].cas`, `CAS 校验位不通过: "${c}"`);
    });
  });

  // 跨文件引用完整性:materials.ifraEntryRef → ifra-rules.json entries.id
  const entryIds = new Set(ifra.entries.map((e) => e.id));
  materials.forEach((m, i) => {
    if (typeof m.ifraEntryRef === "string" && !entryIds.has(m.ifraEntryRef))
      err(`materials.sample.json[${i}].ifraEntryRef`, `引用的 IFRA 条目不存在: "${m.ifraEntryRef}"`);
  });

  if (errors.length) {
    console.error(errors.join("\n"));
    console.error(`\n❌ 数据校验失败:${errors.length} 个错误`);
    process.exit(1);
  }

  const matUnver = materials.filter((m) => !m.provenance.humanVerified).length;
  const ifraUnver = ifra.entries.filter((e) => !e.provenance.humanVerified).length;
  console.log(`✅ 数据校验通过 (materials: ${materials.length} 条, ifra entries: ${ifra.entries.length} 条)`);
  if (matUnver || ifraUnver)
    console.log(`⚠️  待人工核对: materials ${matUnver}/${materials.length}, ifra ${ifraUnver}/${ifra.entries.length} — humanVerified=false 的数据不得用于测试断言`);
}

main();
