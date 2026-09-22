/**
 * formula-lint:配方 YAML 校验扩展。
 *
 * 校验实现与 scripts/formula-lint-core.mjs 共用(单一实现):
 *   YAML 解析 → schemas/formula.schema.json → materialRef 存在性 → 重复原料 → 总量归一(100±1%)。
 *
 * 能力:
 *   1. 命令 `/formula-lint <file...>` — 调香师/人工触发(含项目禁限用清单,见下)
 *   2. 工具 `formula_lint` — Agent 生成/修改配方后的强制工具链校验
 *      (项目验收标准 3.2#5:Agent 输出必须经过工具链校验,不允许仅依赖模型自觉)
 *   3. 命令 `/formula-diff <old> <new>` + 工具 `formula_diff` — 配方改版对比
 *      (剂量调整/新增/移除 + 两版合规差异)
 *
 * 项目级规则:若 cwd 下存在 pierfume.project.json(如 {"bannedMaterials":["lilial"]}),
 * 命中客户禁限用清单的原料判违规(项目红线,独立于 IFRA)。
 *
 * 依赖:yaml 经本目录 package.json 声明(with-deps 模式,jiti 从本目录 node_modules 解析);
 *       typebox/@earendil-works/pi-coding-agent 由 pi 运行时提供(import type 编译期即抹除)。
 * 安全:扩展以完整用户权限运行;本扩展对配方文件只读,不写不改,无网络调用。
 */

import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { lintFormulaYaml, loadProjectRules } from "../../scripts/formula-lint-core.mjs";
import { diffFormulas, renderMarkdownDiff } from "../../scripts/formula-diff-core.mjs";

function readTarget(target: string, cwd: string) {
	const path = isAbsolute(target) ? target : resolve(cwd, target);
	return readFileSync(path, "utf8");
}

export default function (pi: ExtensionAPI) {
	// ------------------------------------------------------------------
	// 命令:/formula-lint <file...>(空格分隔多文件,相对 cwd 解析)
	// ------------------------------------------------------------------
	pi.registerCommand("formula-lint", {
		description: "校验配方 YAML(结构/原料引用/重复原料/总量归一);用法:/formula-lint <file...>",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const targets = args.trim().split(/\s+/).filter(Boolean);
			if (targets.length === 0) {
				const msg = "用法:/formula-lint <file...>(支持相对 cwd 的路径)";
				if (ctx.hasUI) ctx.ui.notify(msg, "warning");
				else console.log(msg);
				return;
			}
			for (const target of targets) {
				const project = loadProjectRules(ctx.cwd);
				try {
					const { ok, errors, unverifiedRefs, ingredientCount } = lintFormulaYaml(
						readFileSync(isAbsolute(target) ? target : resolve(ctx.cwd, target), "utf8"),
						target,
						project,
					);
					if (ok) {
						const msg = `✅ ${target}: 通过 (${ingredientCount} 个原料)${
							unverifiedRefs.length
								? `; ⚠️ 含 ${unverifiedRefs.length} 个未人工核对原料 ${unverifiedRefs.join(", ")}`
								: ""
						}`;
						if (ctx.hasUI) ctx.ui.notify(msg, "info");
						else console.log(msg);
					} else {
						const msg = `❌ ${target}: ${errors.length} 个错误\n${errors.join("\n")}`;
						if (ctx.hasUI) ctx.ui.notify(msg, "error");
						else console.log(msg);
					}
				} catch (e) {
					const msg = `❌ ${target}: 无法读取/校验 — ${e instanceof Error ? e.message : String(e)}`;
					if (ctx.hasUI) ctx.ui.notify(msg, "error");
					else console.log(msg);
				}
			}
		},
	});

	// ------------------------------------------------------------------
	// 工具:formula_lint(path) — Agent 创建/编辑配方文件后必须调用
	// ------------------------------------------------------------------
	pi.registerTool({
		name: "formula_lint",
		label: "Formula Lint",
		description:
			"校验配方 YAML 文件(结构、原料引用、重复原料、总量归一 100±1%)。创建或修改任何配方 YAML 后必须调用本工具;校验失败时返回违规清单。",
		promptSnippet: "Always run formula_lint on formula YAML files after creating or editing them.",
		parameters: Type.Object({
			path: Type.String({ description: "配方 YAML 路径(绝对路径或相对 cwd)" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const path = isAbsolute(params.path) ? params.path : resolve(ctx.cwd, params.path);
			let result;
			try {
				result = lintFormulaYaml(readFileSync(path, "utf8"), params.path, loadProjectRules(ctx.cwd));
			} catch (e) {
				throw new Error(`无法读取配方文件: ${e instanceof Error ? e.message : String(e)}`);
			}
			if (result.ok) {
				return {
					content: [
						{
							type: "text" as const,
							text: `✅ ${params.path}: 校验通过 (${result.ingredientCount} 个原料)${
								result.unverifiedRefs.length
									? `; 注意:${result.unverifiedRefs.length} 个原料未人工核对(${result.unverifiedRefs.join(", ")}),不得用于合规断言`
									: ""
							}`,
						},
					],
					details: {
						ok: true,
						ingredientCount: result.ingredientCount,
						unverifiedRefs: result.unverifiedRefs,
					},
				};
			}
			return {
				content: [
					{
						type: "text" as const,
						text: `❌ ${params.path}: ${result.errors.length} 个违规\n${result.errors.join("\n")}`,
					},
				],
				details: { ok: false, errors: result.errors },
			};
		},
	});

	// ------------------------------------------------------------------
	// 命令:/formula-diff <old.yaml> <new.yaml> — 配方改版对比
	// ------------------------------------------------------------------
	pi.registerCommand("formula-diff", {
		description: "对比两版配方 YAML(剂量调整/新增/移除 + 合规差异);用法:/formula-diff <old.yaml> <new.yaml>",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const targets = args.trim().split(/\s+/).filter(Boolean);
			if (targets.length !== 2) {
				const msg = "用法:/formula-diff <old.yaml> <new.yaml>";
				if (ctx.hasUI) ctx.ui.notify(msg, "warning");
				else console.log(msg);
				return;
			}
			const [labelA, labelB] = targets;
			try {
				const result = diffFormulas(readTarget(labelA, ctx.cwd), readTarget(labelB, ctx.cwd), { labelA, labelB });
				if (ctx.hasUI) {
					const c = result.compliance;
					ctx.ui.notify(
						result.ok
							? `✅ 对比完成:调 ${result.changed.length} / 增 ${result.added.length} / 删 ${result.removed.length}` +
									(c ? `;合规 ${c.a.ok ? "✅" : "❌"} → ${c.b.ok ? "✅" : "❌"}` : "")
							: `❌ 无法对比:${result.errors.length} 个错误`,
						result.ok ? "info" : "error",
					);
				}
				console.log(renderMarkdownDiff(result, { labelA, labelB }));
			} catch (e) {
				const msg = `❌ 无法对比 — ${e instanceof Error ? e.message : String(e)}`;
				if (ctx.hasUI) ctx.ui.notify(msg, "error");
				else console.log(msg);
			}
		},
	});

	// ------------------------------------------------------------------
	// 工具:formula_diff(path_a, path_b) — 改版评审
	// ------------------------------------------------------------------
	pi.registerTool({
		name: "formula_diff",
		label: "Formula Diff",
		description:
			"对比两版配方 YAML:剂量调整、新增/移除原料,以及两版各自的 IFRA 合规判定与差异(新版引入/消除的违规)。评审改版、比较方案时使用。",
		promptSnippet: "Use formula_diff to compare two versions of a formula before accepting changes.",
		parameters: Type.Object({
			path_a: Type.String({ description: "旧版配方 YAML 路径" }),
			path_b: Type.String({ description: "新版配方 YAML 路径" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			let result;
			try {
				result = diffFormulas(readTarget(params.path_a, ctx.cwd), readTarget(params.path_b, ctx.cwd), {
					labelA: params.path_a,
					labelB: params.path_b,
				});
			} catch (e) {
				throw new Error(`无法读取配方文件: ${e instanceof Error ? e.message : String(e)}`);
			}
			const text = result.ok
				? `对比 ${params.path_a} → ${params.path_b}:调 ${result.changed.length} / 增 ${result.added.length} / 删 ${result.removed.length} / 未变 ${result.unchangedCount}` +
					(result.compliance?.newViolationsInB.length ? `;⚠️ 新版引入违规: ${result.compliance.newViolationsInB.join(", ")}` : "") +
					(result.compliance?.resolvedViolations.length ? `;✅ 新版消除违规: ${result.compliance.resolvedViolations.join(", ")}` : "")
				: `❌ 无法对比:\n${result.errors.join("\n")}`;
			return {
				content: [{ type: "text" as const, text }],
				details: { ...result, reportMarkdown: renderMarkdownDiff(result, { labelA: params.path_a, labelB: params.path_b }) },
			};
		},
	});
}
