/**
 * ifra-check 共享核查核心(零副作用,无 CLI 输出)。
 * 由 scripts/ifra-check.mjs(独立 CLI)与 extensions/ifra-check/index.ts(Pi 扩展)共用。
 *
 * 流程:先过 formula-lint(结构/引用/重复/总量),再按 IFRA 规则表逐原料核查:
 *   成品中含量(%) = 浓缩物剂量 pct × product.fragranceUseLevelPct(缺省 100)/ 100
 *   - restrictionType = quantitative:对照 product.category 对应限量;
 *     limitPct = 0(Prohibited)→ 任何用量均违规;limitPct = null(No Restriction)→ 合规;
 *     finished > limitPct → over-limit 违规,并给出浓缩物中的建议上限
 *   - restrictionType = prohibition:全类别违规(如 musk-xylene)
 *   - restrictionType = specification:无限量数值(linalool/limonene 等),
 *     按 STD 规格要求人工核查 → 仅提示,不判违规
 *   - 原料无 ifraEntryRef(ethanol/hedione 等):按无收录限制处理 → 仅提示
 *
 * 红线:限量数值只来自 data/ifra-rules.json(单一事实来源),本文件不硬编码任何限量。
 * 数据/schema 按本文件所在包的相对路径运行时读取(pi install 后包布局不变)。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { lintFormulaYaml } from "./formula-lint-core.mjs";

const EPS = 1e-9; // 限量比较容差(浮点噪声)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let rulesCache = null;
let materialsCache = null;

function loadIfraRules() {
	if (rulesCache === null) {
		rulesCache = JSON.parse(readFileSync(join(ROOT, "data/ifra-rules.json"), "utf8"));
	}
	return rulesCache;
}

function loadMaterials() {
	if (materialsCache === null) {
		materialsCache = JSON.parse(readFileSync(join(ROOT, "data/materials.sample.json"), "utf8"));
	}
	return materialsCache;
}

function basisOf(entry) {
	return {
		stdDoc: entry.stdDoc ?? null,
		amendment: entry.amendment ?? null,
		drivingProperty: entry.drivingProperty ?? null,
		restrictionType: entry.restrictionType ?? null,
	};
}

/**
 * 核查单个配方 YAML 文本的 IFRA 合规性。
 * @param {string} raw YAML 原文
 * @param {string} label 报告中的文件标签
 * @returns 结果对象;ok = 无输入错误且无违规(notices 不影响 ok)
 */
export function checkFormulaIfra(raw, label) {
	// 1. 先过 formula-lint:结构不合法的配方不做合规判定
	const lint = lintFormulaYaml(raw, label);
	const empty = { violations: [], notices: [], passed: [] };
	if (!lint.ok) {
		return {
			ok: false,
			errors: lint.errors,
			...empty,
			summary: {
				label,
				metaId: null,
				name: null,
				category: null,
				fragranceUseLevelPct: null,
				ingredientCount: lint.ingredientCount,
				ifraStandard: loadIfraRules().version?.ifraStandard ?? null,
				violationCount: 0,
				noticeCount: 0,
				checkedCount: 0,
			},
		};
	}

	const doc = parse(raw);
	const materials = loadMaterials();
	const rules = loadIfraRules();
	const matById = new Map(materials.map((m) => [m.id, m]));
	const entryById = new Map(rules.entries.map((e) => [e.id, e]));

	const category = String(doc.product.category);
	const useLevel = typeof doc.product.fragranceUseLevelPct === "number" ? doc.product.fragranceUseLevelPct : 100;

	const errors = [];
	const violations = [];
	const notices = [];
	const passed = [];

	for (const ing of doc.formula) {
		const ref = ing.materialRef;
		const pct = ing.pct;
		const material = matById.get(ref);
		const finishedPct = (pct * useLevel) / 100;

		if (material && !material.provenance?.humanVerified) {
			notices.push({
				materialRef: ref,
				kind: "unverified-material",
				message: `${ref} 的 provenance.humanVerified=false,不得用于合规断言`,
			});
		}

		const entryRef = material?.ifraEntryRef;
		if (!entryRef) {
			notices.push({
				materialRef: ref,
				kind: "no-ifra-entry",
				message: `${ref} 在 IFRA 规则表中无条目,按无收录限制处理`,
			});
			continue;
		}
		const entry = entryById.get(entryRef);
		if (!entry) {
			errors.push(`${label}: 数据完整性 — 原料 "${ref}" 引用了不存在的 IFRA 条目 "${entryRef}"`);
			continue;
		}

		if (entry.restrictionType === "prohibition") {
			violations.push({
				materialRef: ref,
				materialName: material?.name ?? ref,
				finishedPct,
				limitPct: 0,
				status: "prohibited",
				basis: basisOf(entry),
				maxAllowedConcentratePct: 0,
				condition: entry.conditions || null,
			});
			continue;
		}

		if (entry.restrictionType === "specification") {
			notices.push({
				materialRef: ref,
				kind: "specification",
				message: `${entry.name} 为 Specification 型(无类别限量数值),需按 ${entry.stdDoc} 规格要求人工核查`,
			});
			continue;
		}

		// quantitative
		const limit = (entry.limits ?? []).find((l) => l.category === category);
		if (!limit) {
			notices.push({
				materialRef: ref,
				kind: "missing-category-limit",
				message: `${entry.name} 的规则表缺少 Category ${category} 限量,需人工核对(${entry.stdDoc})`,
			});
			continue;
		}
		const prohibited = limit.condition === "Prohibited" || limit.limitPct === 0;
		if (prohibited) {
			if (finishedPct > EPS) {
				violations.push({
					materialRef: ref,
					materialName: material?.name ?? ref,
					finishedPct,
					limitPct: 0,
					status: "prohibited",
					basis: basisOf(entry),
					maxAllowedConcentratePct: 0,
					condition: limit.condition ?? "Prohibited",
				});
			} else {
				passed.push({ materialRef: ref, finishedPct, limitPct: 0 });
			}
			continue;
		}
		if (limit.limitPct === null || limit.limitPct === undefined) {
			passed.push({ materialRef: ref, finishedPct, limitPct: null });
			continue;
		}
		if (finishedPct > limit.limitPct + EPS) {
			violations.push({
				materialRef: ref,
				materialName: material?.name ?? ref,
				finishedPct,
				limitPct: limit.limitPct,
				status: "over-limit",
				basis: basisOf(entry),
				maxAllowedConcentratePct: (limit.limitPct * 100) / useLevel,
				condition: null,
			});
		} else {
			passed.push({ materialRef: ref, finishedPct, limitPct: limit.limitPct });
		}
	}

	return {
		ok: errors.length === 0 && violations.length === 0,
		errors,
		violations,
		notices,
		passed,
		summary: {
			label,
			metaId: doc.meta?.id ?? null,
			name: doc.product?.name ?? doc.meta?.name ?? null,
			category,
			fragranceUseLevelPct: useLevel,
			ingredientCount: doc.formula.length,
			ifraStandard: rules.version?.ifraStandard ?? null,
			violationCount: violations.length,
			noticeCount: notices.length,
			checkedCount: passed.length + violations.length,
		},
	};
}

/**
 * 合规余量(求极值):对配方中每个原料,计算"在不突破任何限量、且总量不超 100 的前提下,
 * 浓缩物中最多还能再加多少个百分点"。
 * - quantitative:maxAdd = (limitPct - finishedPct) × 100 / useLevel(可为负 = 已超标)
 * - prohibition:0(已违规)
 * - specification / 无 IFRA 条目:null(无法据此判定)
 * @returns {{ ok: boolean, errors: string[], useLevelPct: number, sumPct: number,
 *   maxAddBySum: number, rows: Array<{materialRef, kind, currentPct, limitPct, maxAddPct}> }}
 */
export function computeHeadroom(raw, label) {
	const lint = lintFormulaYaml(raw, label);
	const empty = { rows: [] };
	if (!lint.ok) {
		return { ok: false, errors: lint.errors, useLevelPct: null, sumPct: null, maxAddBySum: null, ...empty };
	}
	const doc = parse(raw);
	const materials = loadMaterials();
	const rules = loadIfraRules();
	const matById = new Map(materials.map((m) => [m.id, m]));
	const entryById = new Map(rules.entries.map((e) => [e.id, e]));
	const useLevel = typeof doc.product.fragranceUseLevelPct === "number" ? doc.product.fragranceUseLevelPct : 100;
	const category = String(doc.product.category);
	const sumPct = doc.formula.reduce((s, i) => s + i.pct, 0);

	const rows = [];
	for (const ing of doc.formula) {
		const material = matById.get(ing.materialRef);
		const entryRef = material?.ifraEntryRef;
		const entry = entryRef ? entryById.get(entryRef) : null;
		const finishedPct = (ing.pct * useLevel) / 100;
		if (!entry || entry.restrictionType === "specification") {
			rows.push({ materialRef: ing.materialRef, kind: entry ? "specification" : "no-entry", currentPct: ing.pct, limitPct: null, maxAddPct: null });
			continue;
		}
		if (entry.restrictionType === "prohibition") {
			rows.push({ materialRef: ing.materialRef, kind: "prohibition", currentPct: ing.pct, limitPct: 0, maxAddPct: 0 });
			continue;
		}
		const limit = (entry.limits ?? []).find((l) => l.category === category);
		if (!limit || limit.limitPct === null || limit.limitPct === undefined || limit.condition === "Prohibited" || limit.limitPct === 0) {
			const maxAdd = limit && (limit.condition === "Prohibited" || limit.limitPct === 0) ? 0 : null;
			rows.push({ materialRef: ing.materialRef, kind: maxAdd === 0 ? "prohibited" : "no-limit", currentPct: ing.pct, limitPct: maxAdd === 0 ? 0 : null, maxAddPct: maxAdd });
			continue;
		}
		const maxAddPct = Math.round(((limit.limitPct - finishedPct) * 100) / useLevel * 1e4) / 1e4;
		rows.push({ materialRef: ing.materialRef, kind: "quantitative", currentPct: ing.pct, limitPct: limit.limitPct, maxAddPct });
	}

	return {
		ok: true,
		errors: [],
		useLevelPct: useLevel,
		sumPct: Math.round(sumPct * 1e4) / 1e4,
		maxAddBySum: Math.round((100 - sumPct) * 1e4) / 1e4,
		rows,
	};
}

function fmtPct(n) {
	if (n === null || n === undefined) return "—";
	const r = Math.round(n * 1e4) / 1e4;
	return String(r);
}

/**
 * 渲染 Markdown 合规报告(超标项 / 限量依据 / 建议调整 + 提示 + 合规明细)。
 */
export function renderMarkdownReport(result) {
	const s = result.summary;
	const lines = [];
	lines.push(`# IFRA 合规报告:${s.name ?? s.label}`);
	lines.push("");
	lines.push(`- 配方:\`${s.metaId ?? "?"}\`(${s.label})`);
	lines.push(`- 产品类别:Category ${s.category ?? "?"};香精添加量:${s.fragranceUseLevelPct ?? "?"}%`);
	lines.push(`- 口径:成品中含量 = 浓缩物剂量 × ${s.fragranceUseLevelPct ?? "?"} / 100`);
	lines.push(`- 规则版本:${s.ifraStandard ?? "?"}`);
	if (result.errors.length) {
		lines.push(`- 判定:⚠️ 无法判定 — ${result.errors.length} 个输入/数据错误(请先跑 formula-lint)`);
	} else if (result.violations.length) {
		lines.push(`- 判定:❌ 不合规 — ${result.violations.length} 项违规`);
	} else {
		lines.push("- 判定:✅ 合规");
	}
	lines.push("");

	if (result.errors.length) {
		lines.push("## ⚠️ 输入/数据错误");
		for (const e of result.errors) lines.push(`- ${e}`);
		lines.push("");
	}

	if (result.violations.length) {
		lines.push("## ❌ 违规项");
		lines.push("| 原料 | 成品中含量(%) | 限量(%) | 状态 | 依据 | 建议:浓缩物中≤(%) |");
		lines.push("|---|---|---|---|---|---|");
		for (const v of result.violations) {
			const status = v.status === "prohibited" ? "🚫 禁用" : `⚠️ 超量 ${fmtPct(v.finishedPct - v.limitPct)} 点`;
			const basis = [v.basis.stdDoc, v.basis.amendment ? `Amd ${v.basis.amendment}` : null, v.basis.drivingProperty]
				.filter(Boolean)
				.join(", ");
			lines.push(
				`| ${v.materialRef} | ${fmtPct(v.finishedPct)} | ${fmtPct(v.limitPct)} | ${status} | ${basis} | ${fmtPct(v.maxAllowedConcentratePct)} |`,
			);
		}
		lines.push("");
	}

	if (result.notices.length) {
		lines.push("## ⚠️ 提示");
		for (const n of result.notices) lines.push(`- [${n.kind}] ${n.message}`);
		lines.push("");
	}

	if (result.passed.length) {
		lines.push("## ✅ 受限但合规的原料");
		lines.push("| 原料 | 成品中含量(%) | 限量(%) |");
		lines.push("|---|---|---|");
		for (const p of result.passed) {
			lines.push(`| ${p.materialRef} | ${fmtPct(p.finishedPct)} | ${fmtPct(p.limitPct)} |`);
		}
		lines.push("");
	}

	lines.push("> 免责:本报告基于本地规则表快照,商用前必须以正版 IFRA Standard 逐条核对;本报告不替代法规意见。");
	return lines.join("\n");
}
