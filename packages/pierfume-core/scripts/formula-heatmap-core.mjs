/**
 * formula-heatmap 共享核心(零副作用):多配方原料用量矩阵。
 * 行 = 配方,列 = 原料(并集,按总用量降序),单元 = 该原料在香精浓缩物中的 pct(未用为 null)。
 * 由 extensions/data-admin/index.ts 的 formula_heatmap 工具与 CLI/测试共用。
 */

import { parse } from "yaml";

/**
 * @param {Array<{label: string, raw: string}>} entries 配方 YAML 文本
 * @param {Array} materials 原料库(解析名称展示)
 * @returns {{ ok: boolean, errors: string[], materials: Array<{id:string,name:string}>,
 *           rows: Array<{label:string, values:(number|null)[]}> }}
 */
export function buildHeatmap(entries, materials) {
  const errors = [];
  const byId = new Map(materials.map((m) => [m.id, m]));
  const usage = new Map(); // ref → Map(label → pct)

  for (const { label, raw } of entries) {
    let doc;
    try {
      doc = parse(raw);
    } catch (e) {
      errors.push(`${label}: YAML 解析失败 — ${e.message}`);
      continue;
    }
    if (!Array.isArray(doc?.formula)) {
      errors.push(`${label}: 缺少 formula 组成`);
      continue;
    }
    for (const ing of doc.formula) {
      const ref = ing?.materialRef;
      if (typeof ref !== "string" || typeof ing?.pct !== "number") continue;
      if (!byId.has(ref)) errors.push(`${label}: 引用的原料不存在: "${ref}"`);
      if (!usage.has(ref)) usage.set(ref, new Map());
      usage.get(ref).set(label, ing.pct);
    }
  }
  if (errors.length) return { ok: false, errors, materials: [], rows: [] };

  const refs = [...usage.keys()].sort((a, b) => {
    const sum = (r) => [...usage.get(r).values()].reduce((s, v) => s + v, 0);
    return sum(b) - sum(a) || a.localeCompare(b);
  });
  const rows = entries.map(({ label }) => ({
    label,
    values: refs.map((ref) => usage.get(ref).get(label) ?? null),
  }));
  return {
    ok: true,
    errors: [],
    materials: refs.map((id) => ({ id, name: byId.get(id)?.name ?? id })),
    rows,
  };
}
