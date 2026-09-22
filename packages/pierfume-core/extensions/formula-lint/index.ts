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

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { parse } from "yaml";
import { lintFormulaYaml, loadProjectRules, getMaterials } from "../../scripts/formula-lint-core.mjs";
import { diffFormulas } from "../../scripts/formula-diff-core.mjs";
import { checkFormulaIfra } from "../../scripts/ifra-check-core.mjs";

function readTarget(target: string, cwd: string) {
	const path = isAbsolute(target) ? target : resolve(cwd, target);
	return readFileSync(path, "utf8");
}

function loadMaterialIndex() {
	const materials = getMaterials();
	return { materials, byId: new Map(materials.map((m: any) => [m.id, m])) };
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

	// ------------------------------------------------------------------
	// 工具:material_get / formula_get — 数据查看(前端渲染展示卡片)
	// ------------------------------------------------------------------
	pi.registerTool({
		name: "material_get",
		label: "Material Get",
		description: "按 id 查原料详情(名称/CAS/香型/香韵/IFRA 引用/核对状态),前端以卡片展示。用户想查看原料时使用。",
		parameters: Type.Object({ id: Type.String({ description: "原料 id(materials.sample.json 的 id)" }) }),
		async execute(_id, params) {
			const { byId } = loadMaterialIndex();
			const m = byId.get(params.id);
			if (!m) throw new Error(`原料不存在: "${params.id}"`);
			const text = `${m.name}(CAS ${m.cas})· ${(m.family ?? []).join("/")} · ${m.note ?? ""} · ${m.odor ?? ""}` +
				`${m.provenance?.humanVerified ? "" : " · ⚠️ 未人工核对"}`;
			return {
				content: [{ type: "text" as const, text }],
				details: { kind: "material", data: m },
			};
		},
	});

	pi.registerTool({
		name: "formula_get",
		label: "Formula Get",
		description: "读取配方 YAML:结构、成分、formula-lint 与 ifra-check 摘要,前端以卡片展示。用户想查看配方时使用。",
		parameters: Type.Object({ path: Type.String({ description: "配方 YAML 路径" }) }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			let raw;
			try {
				raw = readTarget(params.path, ctx.cwd);
			} catch (e) {
				throw new Error(`无法读取配方文件: ${e instanceof Error ? e.message : String(e)}`);
			}
			const project = loadProjectRules(ctx.cwd);
			const lint = lintFormulaYaml(raw, params.path, project);
			const ifra = lint.ok ? checkFormulaIfra(raw, params.path) : null;
			let doc = null;
			try {
				doc = parse(raw);
			} catch {}
			const { byId } = loadMaterialIndex();
			const ingredients = Array.isArray(doc?.formula)
				? doc.formula.map((i: any) => ({
						materialRef: i.materialRef,
						pct: i.pct,
						name: byId.get(i.materialRef)?.name ?? null,
						family: byId.get(i.materialRef)?.family ?? [],
					}))
				: [];
			const text = lint.ok
				? `配方 ${doc?.meta?.id ?? params.path}:${ingredients.length} 个原料,` +
					(ifra ? (ifra.ok ? "IFRA 合规" : `${ifra.violations.length} 项违规`) : "")
				: `❌ ${lint.errors.length} 个错误\n${lint.errors.join("\n")}`;
			return {
				content: [{ type: "text" as const, text }],
				details: {
					kind: "formula",
					path: params.path,
					meta: doc?.meta ?? null,
					product: doc?.product ?? null,
					ingredients,
					lint: { ok: lint.ok, errors: lint.errors },
					ifra: ifra ? { ok: ifra.ok, violationCount: ifra.violations.length } : null,
				},
			};
		},
	});

	// ------------------------------------------------------------------
	// 工具:material_alternatives — 同香型替换建议(启发式)
	// ------------------------------------------------------------------
	pi.registerTool({
		name: "material_alternatives",
		label: "Material Alternatives",
		description: "给定原料,按香型标签重叠推荐同香型候选(排除 IFRA 全禁原料),供替换/替代决策参考。",
		parameters: Type.Object({ material_ref: Type.String({ description: "原料 id" }) }),
		async execute(_id, params) {
			const { materials, byId } = loadMaterialIndex();
			const target = byId.get(params.material_ref);
			if (!target) throw new Error(`原料不存在: "${params.material_ref}"`);
			const targetFam = new Set(target.family ?? []);
			const candidates = materials
				.filter((m: any) => m.id !== target.id)
				.map((m: any) => ({ m, overlap: (m.family ?? []).filter((f: string) => targetFam.has(f)).length }))
				.filter((x: any) => x.overlap > 0)
				.sort((a: any, b: any) => b.overlap - a.overlap || a.m.id.localeCompare(b.m.id))
				.slice(0, 6)
				.map((x: any) => ({ id: x.m.id, name: x.m.name, family: x.m.family, odor: x.m.odor, note: x.m.note, overlap: x.overlap }));
			const text = candidates.length
				? `候选:${candidates.map((c: any) => `${c.id}(${(c.family ?? []).join("/")})`).join(", ")}`
				: "无同香型候选";
			return {
				content: [{ type: "text" as const, text }],
				details: { kind: "alternatives", target: { id: target.id, name: target.name, family: target.family, odor: target.odor }, candidates },
			};
		},
	});

	// ------------------------------------------------------------------
	// 工具:formula_save — 受审写入(数据管理的 Agent 路径)
	//   审批门(ctx.ui.confirm,RPC 模式下前端弹层)→ 自动重检(lint+ifra+diff)
	//   → status=approved 硬门(双检不通过则拒绝写入)
	// ------------------------------------------------------------------
	pi.registerTool({
		name: "formula_save",
		label: "Formula Save",
		description:
			"写入/更新配方 YAML(完整内容)。写前会请求用户批准(展示校验与差异摘要);meta.status=approved 时要求 formula-lint 与 ifra-check 双双通过,否则拒绝。",
		promptSnippet: "Always use formula_save (never raw file writes) to create or update formula YAML files.",
		parameters: Type.Object({
			path: Type.String({ description: "配方文件路径(相对 cwd 或绝对)" }),
			yaml: Type.String({ description: "完整配方 YAML 内容" }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const path = isAbsolute(params.path) ? params.path : resolve(ctx.cwd, params.path);
			const project = loadProjectRules(ctx.cwd);
			const lint = lintFormulaYaml(params.yaml, params.path, project);
			if (!lint.ok) {
				return {
					content: [{ type: "text" as const, text: `❌ 校验未通过,未写入:\n${lint.errors.join("\n")}` }],
					details: { kind: "save", path: params.path, written: false, lint: { ok: false, errors: lint.errors } },
				};
			}
			const ifra = checkFormulaIfra(params.yaml, params.path);
			const doc = parse(params.yaml);
			const wantsApproved = doc?.meta?.status === "approved";
			if (wantsApproved && !ifra.ok) {
				return {
					content: [{
						type: "text" as const,
						text: `❌ 拒绝写入:meta.status=approved 要求 ifra-check 通过,当前 ${ifra.violations.length} 项违规。请先修正或保持 draft。`,
					}],
					details: { kind: "save", path: params.path, written: false, lint: { ok: true }, ifra: { ok: false, violations: ifra.violations } },
				};
			}

			const oldExists = existsSync(path);
			const oldRaw = oldExists ? readFileSync(path, "utf8") : null;
			const diff = oldRaw !== null ? diffFormulas(oldRaw, params.yaml, { labelA: "旧版", labelB: "新版" }) : null;
			const diffLine = diff?.ok
				? `变更:调 ${diff.changed.length} / 增 ${diff.added.length} / 删 ${diff.removed.length}`
				: oldExists ? "(旧版无法解析,全量替换)" : "(新文件)";
			const summary =
				`${params.path}\n${diffLine}\n` +
				`lint: ✅ · ifra: ${ifra.ok ? "✅ 合规" : `❌ ${ifra.violations.length} 项违规`}` +
				`${ifra.notices.length ? ` · ${ifra.notices.length} 条提示` : ""}` +
				`${wantsApproved ? " · 状态: approved" : ""}`;
			const approved = await ctx.ui.confirm(`写入配方 ${doc?.meta?.id ?? params.path}?`, summary);
			if (!approved) {
				return {
					content: [{ type: "text" as const, text: `⛔ 用户拒绝写入 ${params.path}` }],
					details: { kind: "save", path: params.path, written: false, cancelled: true },
				};
			}

			writeFileSync(path, params.yaml, "utf8");
			const text = `✅ 已写入 ${params.path}(lint ✅ · ifra ${ifra.ok ? "✅" : "❌ " + ifra.violations.length + " 项违规"})`;
			return {
				content: [{ type: "text" as const, text }],
				details: {
					kind: "save",
					path: params.path,
					written: true,
					meta: doc?.meta ?? null,
					diff: diff ? { changed: diff.changed, added: diff.added, removed: diff.removed } : null,
					lint: { ok: true },
					ifra: { ok: ifra.ok, violationCount: ifra.violations.length },
				},
			};
		},
	});
}
