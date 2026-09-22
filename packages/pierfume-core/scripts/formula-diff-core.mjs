/**
 * formula-diff 共享核心(零副作用):两版配方 YAML 的结构对比 + 合规差异摘要。
 * 由 scripts/formula-diff.mjs(CLI)与 extensions/formula-lint/index.ts(命令 /formula-diff、工具 formula_diff)共用。
 *
 * 结构 diff(按 materialRef 对齐,先各自过 formula-lint,不合法不对比):
 *   changed: 两版都有,pct 不同 → { materialRef, pctA, pctB, delta }
 *   added / removed / unchangedCount
 * 合规差异:各自调 checkFormulaIfra(用各自的 product.category),只取摘要,不重复实现限量逻辑。
 *
 * 数据/schema 按本文件所在包的相对路径运行时读取(pi install 后包布局不变)。
 */

import { parse } from "yaml";
import { lintFormulaYaml } from "./formula-lint-core.mjs";
import { checkFormulaIfra } from "./ifra-check-core.mjs";

/**
 * @param {string} rawA 旧版 YAML
 * @param {string} rawB 新版 YAML
 * @param {{labelA?: string, labelB?: string}} labels
 * @returns 结果对象;ok = 两版都通过 lint;errors 任一版 lint 失败时填充
 */
export function diffFormulas(rawA, rawB, labels = {}) {
	const labelA = labels.labelA ?? "A";
	const labelB = labels.labelB ?? "B";

	const lintA = lintFormulaYaml(rawA, labelA);
	const lintB = lintFormulaYaml(rawB, labelB);
	const errors = [];
	if (!lintA.ok) errors.push(...lintA.errors.map((e) => `${labelA}: ${e}`));
	if (!lintB.ok) errors.push(...lintB.errors.map((e) => `${labelB}: ${e}`));
	if (errors.length) {
		return {
			ok: false,
			errors,
			changed: [], added: [], removed: [], unchangedCount: 0,
			compliance: null,
		};
	}

	const docA = parse(rawA);
	const docB = parse(rawB);
	const mapA = new Map(docA.formula.map((i) => [i.materialRef, i.pct]));
	const mapB = new Map(docB.formula.map((i) => [i.materialRef, i.pct]));

	const changed = [];
	const added = [];
	const removed = [];
	let unchangedCount = 0;
	for (const [ref, pctB] of mapB) {
		if (!mapA.has(ref)) {
			added.push({ materialRef: ref, pct: pctB });
		} else {
			const pctA = mapA.get(ref);
			if (pctA !== pctB) changed.push({ materialRef: ref, pctA, pctB, delta: Math.round((pctB - pctA) * 1e4) / 1e4 });
			else unchangedCount++;
		}
	}
	for (const [ref, pctA] of mapA) {
		if (!mapB.has(ref)) removed.push({ materialRef: ref, pct: pctA });
	}

	const ifraA = checkFormulaIfra(rawA, labelA);
	const ifraB = checkFormulaIfra(rawB, labelB);
	const compliance = {
		a: { ok: ifraA.ok, violationCount: ifraA.violations.length, category: ifraA.summary.category, useLevelPct: ifraA.summary.fragranceUseLevelPct },
		b: { ok: ifraB.ok, violationCount: ifraB.violations.length, category: ifraB.summary.category, useLevelPct: ifraB.summary.fragranceUseLevelPct },
		newViolationsInB: ifraB.violations.filter((v) => !ifraA.violations.some((x) => x.materialRef === v.materialRef)).map((v) => v.materialRef),
		resolvedViolations: ifraA.violations.filter((v) => !ifraB.violations.some((x) => x.materialRef === v.materialRef)).map((v) => v.materialRef),
	};

	return {
		ok: true,
		errors: [],
		changed, added, removed, unchangedCount,
		meta: { idA: docA.meta?.id ?? null, idB: docB.meta?.id ?? null, nameA: docA.product?.name ?? null, nameB: docB.product?.name ?? null },
		compliance,
	};
}

/**
 * 渲染 Markdown 对比报告(变更清单 + 合规差异)。
 */
export function renderMarkdownDiff(result, labels = {}) {
	const labelA = labels.labelA ?? "A";
	const labelB = labels.labelB ?? "B";
	const lines = [];
	lines.push(`# 配方对比:${result.meta?.nameA ?? result.meta?.idA ?? labelA} → ${result.meta?.nameB ?? result.meta?.idB ?? labelB}`);
	lines.push("");
	if (!result.ok) {
		lines.push(`## ⚠️ 无法对比`);
		for (const e of result.errors) lines.push(`- ${e}`);
		return lines.join("\n");
	}
	lines.push(`- ${labelA}:\`${result.meta?.idA ?? "?"}\` ← ${labelB}:\`${result.meta?.idB ?? "?"}\``);
	lines.push(`- 变更:${result.changed.length} 项调整,${result.added.length} 项新增,${result.removed.length} 项移除,${result.unchangedCount} 项未变`);
	lines.push("");
	if (result.changed.length) {
		lines.push("## 剂量调整");
		lines.push("| 原料 | 旧% | 新% | Δ |");
		lines.push("|---|---|---|---|");
		for (const c of result.changed) {
			const sign = c.delta > 0 ? `+${c.delta}` : `${c.delta}`;
			lines.push(`| ${c.materialRef} | ${c.pctA} | ${c.pctB} | ${sign} |`);
		}
		lines.push("");
	}
	if (result.added.length) {
		lines.push("## 新增原料");
		for (const a of result.added) lines.push(`- ${a.materialRef}(${a.pct}%)`);
		lines.push("");
	}
	if (result.removed.length) {
		lines.push("## 移除原料");
		for (const r of result.removed) lines.push(`- ${r.materialRef}(原 ${r.pct}%)`);
		lines.push("");
	}
	if (result.compliance) {
		const c = result.compliance;
		lines.push("## 合规差异");
		lines.push(`- ${labelA}: ${c.a.ok ? "✅ 合规" : `❌ ${c.a.violationCount} 项违规`}(Category ${c.a.category},${c.a.useLevelPct}%)`);
		lines.push(`- ${labelB}: ${c.b.ok ? "✅ 合规" : `❌ ${c.b.violationCount} 项违规`}(Category ${c.b.category},${c.b.useLevelPct}%)`);
		if (c.newViolationsInB.length) lines.push(`- ⚠️ 新版引入违规:${c.newViolationsInB.join(", ")}`);
		if (c.resolvedViolations.length) lines.push(`- ✅ 新版消除违规:${c.resolvedViolations.join(", ")}`);
		lines.push("");
	}
	return lines.join("\n");
}
