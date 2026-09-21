/**
 * 迷你 JSON Schema 校验器(draft 2020-12 子集),零依赖。
 * 覆盖本项目各 schema 用到的关键字;由 validate-data.mjs 与 validate-formula.mjs 共用。
 * 校验结果追加到调用方传入的 errors 数组(字符串:path: message)。
 */

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

export function validateValue(value, schema, path, errors) {
  // meta 关键字
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const got = typeOf(value);
    const ok = types.some((t) => {
      if (t === "number") return typeof value === "number";
      if (t === "integer") return Number.isInteger(value);
      return t === got;
    });
    if (!ok) errors.push(`${path}: 期望类型 ${types.join("/")},实际 ${got === "integer" ? "number" : got}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      errors.push(`${path}: 长度 ${value.length} < minLength ${schema.minLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value))
      errors.push(`${path}: 不匹配 pattern ${schema.pattern} ("${value}")`);
    if (schema.format === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value))
      errors.push(`${path}: 非法日期格式 "${value}"`);
  }
  if (typeof value === "number") {
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum)
      errors.push(`${path}: ${value} 不满足 exclusiveMinimum ${schema.exclusiveMinimum}`);
    if (schema.minimum !== undefined && value < schema.minimum)
      errors.push(`${path}: ${value} < minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum)
      errors.push(`${path}: ${value} > maximum ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      errors.push(`${path}: 元素数 ${value.length} < minItems ${schema.minItems}`);
    if (schema.uniqueItems === true) {
      const seen = new Set(value.map((v) => JSON.stringify(v)));
      if (seen.size !== value.length) errors.push(`${path}: 存在重复元素`);
    }
    if (schema.items !== undefined)
      value.forEach((item, i) => validateValue(item, schema.items, `${path}[${i}]`, errors));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    if (schema.properties !== undefined) {
      for (const [key, sub] of Object.entries(schema.properties))
        if (key in value) validateValue(value[key], sub, `${path}.${key}`, errors);
    }
    if (schema.required !== undefined)
      for (const key of schema.required)
        if (!(key in value)) errors.push(`${path}: 缺少必填字段 "${key}"`);
    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(value))
        if (!known.has(key)) errors.push(`${path}: 未声明的字段 "${key}"`);
    }
  }
  if (schema.enum !== undefined && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value)))
    errors.push(`${path}: 值不在枚举 ${JSON.stringify(schema.enum)} 内`);
}
