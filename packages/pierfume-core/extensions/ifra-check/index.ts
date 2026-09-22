/**
 * ifra-check:IFRA 合规核查扩展。
 *
 * 核查实现与 scripts/ifra-check-core.mjs 共用(单一实现):
 *   formula-lint 前置 → 逐原料按 Category 限量比对(成品口径 = 浓缩物 × fragranceUseLevelPct)。
 *   限量数值只来自 data/ifra-rules.json,本扩展不硬编码任何限量(红线)。
 *
 * 能力:
 *   1. 命令 `/ifra-check <file...>` — 输出 Markdown 合规报告(超标项/限量依据/建议调整)
 *   2. 工具 `ifra_check` — Agent 判定配方"可用"前的强制合规校验,返回 Markdown 摘要 + JSON details
 *
 * 依赖:yaml 经本目录 package.json 声明(with-deps 模式);
 *       typebox/@earendil-works/pi-coding-agent 由 pi 运行时提供(import type 编译期即抹除)。
 * 安全:扩展以完整用户权限运行;本扩展对配方文件只读,不写不改,无网络调用。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { checkFormulaIfra, renderMarkdownReport, computeHeadroom } from "../../scripts/ifra-check-core.mjs";

function runCheck(target: string, cwd: string) {
	const path = isAbsolute(target) ? target : resolve(cwd, target);
	return checkFormulaIfra(readFileSync(path, "utf8"), target);
}

export default function (pi: ExtensionAPI) {
	// ------------------------------------------------------------------
	// 命令:/ifra-check <file...>(空格分隔多文件,相对 cwd 解析)
	// ------------------------------------------------------------------
	pi.registerCommand("ifra-check", {
		description: "IFRA 合规核查(按 product.category 比对限量,输出 Markdown 报告);用法:/ifra-check <file...>",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const tokens = args.trim().split(/\s+/).filter(Boolean);
			const outIdx = tokens.indexOf("--out");
			const outFile = outIdx >= 0 ? tokens[outIdx + 1] : undefined;
			const targets = tokens.filter((t, i) => t !== "--out" && tokens[i - 1] !== "--out");
			if (targets.length === 0 || (outFile && targets.length !== 1)) {
				const msg = "用法:/ifra-check <file...> [--out report.md](--out 仅支持单文件)";
				if (ctx.hasUI) ctx.ui.notify(msg, "warning");
				else console.log(msg);
				return;
			}
			for (const target of targets) {
				try {
					const result = runCheck(target, ctx.cwd);
					if (ctx.hasUI) {
						ctx.ui.notify(
							result.ok
								? `✅ ${target}: 合规(${result.summary.checkedCount} 项受限原料通过,${result.summary.noticeCount} 条提示)`
								: `❌ ${target}: ${result.summary.violationCount} 项违规 / ${result.errors.length} 个错误`,
							result.ok ? "info" : "error",
						);
					}
					const markdown = renderMarkdownReport(result);
					if (outFile) {
						const outPath = isAbsolute(outFile) ? outFile : resolve(ctx.cwd, outFile);
						writeFileSync(outPath, markdown, "utf8");
						console.log(`✅ 报告已写入 ${outPath}`);
					} else {
						// Markdown 报告全文走 console.log(print 模式为 stderr,见 AGENTS.md §7.3)
						console.log(markdown);
					}
				} catch (e) {
					const msg = `❌ ${target}: 无法读取/核查 — ${e instanceof Error ? e.message : String(e)}`;
					if (ctx.hasUI) ctx.ui.notify(msg, "error");
					else console.log(msg);
				}
			}
		},
	});

	// ------------------------------------------------------------------
	// 工具:ifra_check(path) — Agent 标记配方"可用"前必须调用
	// ------------------------------------------------------------------
	pi.registerTool({
		name: "ifra_check",
		label: "IFRA Check",
		description:
			"IFRA 合规核查:按 product.category 比对 data/ifra-rules.json 限量(成品口径 = 浓缩物剂量 × fragranceUseLevelPct)。标记任何配方为可用/可提交前必须调用;返回违规清单、限量依据与建议调整。",
		promptSnippet: "Always run ifra_check on formula YAML files before marking them as usable or compliant.",
		parameters: Type.Object({
			path: Type.String({ description: "配方 YAML 路径(绝对路径或相对 cwd)" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			let result;
			try {
				result = runCheck(params.path, ctx.cwd);
			} catch (e) {
				throw new Error(`无法读取配方文件: ${e instanceof Error ? e.message : String(e)}`);
			}
			const s = result.summary;
			const head = result.ok
				? `✅ ${params.path}: IFRA 合规(Category ${s.category},${s.checkedCount} 项受限原料通过,${s.noticeCount} 条提示)`
				: `❌ ${params.path}: ${s.violationCount} 项违规 / ${result.errors.length} 个错误`;
			const violationLines = result.violations.map(
				(v) =>
					`- ${v.materialRef}: 成品 ${v.finishedPct.toFixed(4)}% vs 限量 ${v.limitPct}% ` +
					`(${v.status === "prohibited" ? "禁用" : "超量"};依据 ${v.basis.stdDoc ?? "?"}, Amd ${v.basis.amendment ?? "?"};浓缩物中≤ ${v.maxAllowedConcentratePct.toFixed(4)}%)`,
			);
			const noticeLines = result.notices.map((n) => `- [${n.kind}] ${n.message}`);
			const text = [head, ...violationLines, ...noticeLines].join("\n");
			return {
				content: [{ type: "text" as const, text }],
				details: { ...result, reportMarkdown: renderMarkdownReport(result) },
			};
		},
	});

	// ------------------------------------------------------------------
	// 工具:ifra_headroom — 合规余量(每个原料还能再加多少)
	// ------------------------------------------------------------------
	pi.registerTool({
		name: "ifra_headroom",
		label: "IFRA Headroom",
		description: "计算配方中各原料的合规余量:在不突破限量与总量 100 的前提下,浓缩物中最多还能增加多少个百分点。调整配方剂量前使用。",
		parameters: Type.Object({ path: Type.String({ description: "配方 YAML 路径" }) }),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			let raw;
			try {
				raw = readTarget(params.path, ctx.cwd);
			} catch (e) {
				throw new Error(`无法读取配方文件: ${e instanceof Error ? e.message : String(e)}`);
			}
			const result = computeHeadroom(raw, params.path);
			if (!result.ok) {
				return {
					content: [{ type: "text" as const, text: `❌ ${result.errors.join("\n")}` }],
					details: { kind: "headroom", ok: false, errors: result.errors },
				};
			}
			const capped = result.rows.map((r) =>
				r.maxAddPct === null ? r : { ...r, maxAddPct: Math.min(r.maxAddPct, result.maxAddBySum) },
			);
			const text =
				`余量(同时受总量 100 限制,当前合计 ${result.sumPct}%):` +
				capped
					.filter((r) => r.kind === "quantitative")
					.map((r) => `${r.materialRef} 还可 +${r.maxAddPct}`)
					.join("; ") +
				` · 总量余量 ${result.maxAddBySum}`;
			return {
				content: [{ type: "text" as const, text }],
				details: { kind: "headroom", ...result, rows: capped },
			};
		},
	});
}
