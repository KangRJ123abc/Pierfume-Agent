/**
 * formula-lint:配方 YAML 校验扩展。
 *
 * 校验实现与 scripts/formula-lint-core.mjs 共用(单一实现):
 *   YAML 解析 → schemas/formula.schema.json → materialRef 存在性 → 重复原料 → 总量归一(100±1%)。
 *
 * 能力:
 *   1. 命令 `/formula-lint <file...>` — 调香师/人工触发
 *   2. 工具 `formula_lint` — Agent 生成/修改配方后的强制工具链校验
 *      (项目验收标准 3.2#5:Agent 输出必须经过工具链校验,不允许仅依赖模型自觉)
 *
 * 依赖:yaml 经本目录 package.json 声明(with-deps 模式,jiti 从本目录 node_modules 解析);
 *       typebox/@earendil-works/pi-coding-agent 由 pi 运行时提供(import type 编译期即抹除)。
 * 安全:扩展以完整用户权限运行;本扩展对配方文件只读,不写不改,无网络调用。
 */

import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { lintFormulaYaml } from "../../scripts/formula-lint-core.mjs";

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
				const path = isAbsolute(target) ? target : resolve(ctx.cwd, target);
				try {
					const { ok, errors, unverifiedRefs, ingredientCount } = lintFormulaYaml(
						readFileSync(path, "utf8"),
						target,
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
				result = lintFormulaYaml(readFileSync(path, "utf8"), params.path);
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
}
