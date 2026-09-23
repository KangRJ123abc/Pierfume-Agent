/**
 * data-admin:数据管理扩展(原料添加/校正 + 配方热图)。
 *
 * 能力:
 *   1. 工具 `material_add` — 按 PubChem CID 或化合物名(批量)添加原料草稿;
 *   2. 工具 `material_update` — 校正既有原料字段;
 *   3. 工具 `formula_heatmap` — 多配方原料用量矩阵(前端渲染热图)。
 *
 * 红线(项目 AGENTS.md §5):
 *   - CID/CAS 只来自 PubChem 机器解析(scripts/material-admin-core.mjs),模型记忆不得入库;
 *   - 写入前必经 ctx.ui.confirm 审批(RPC 模式前端弹层);humanVerified=false,人工逐条核对后置 true;
 *   - cid 必填:正整数或 "用户自有"。
 *
 * 依赖:yaml 经本目录 package.json 声明(with-deps 模式);
 *       typebox/@earendil-works/pi-coding-agent 由 pi 运行时提供。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  MATERIALS_PATH,
  buildDraft,
  loadMaterialsFile,
  mergeAdd,
  mergeUpdate,
  saveMaterialsFile,
  validateDraft,
} from "../../scripts/material-admin-core.mjs";
import { buildHeatmap } from "../../scripts/formula-heatmap-core.mjs";
import { getMaterials } from "../../scripts/formula-lint-core.mjs";

const FAMILY = [
  "citrus", "carrier", "floral", "green", "woody", "oriental", "gourmand", "herbal",
  "minty", "spicy", "fruity", "musky", "aquatic", "leathery", "powdery", "balsamic",
  "earthy", "animalic",
] as const;

const familySchema = Type.Array(Type.String({ enum: FAMILY as unknown as string[] }), { minItems: 1 });

const draftItemSchema = Type.Object({
  cid: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Literal("用户自有")], {
    description: 'PubChem CID;客观无法提供时用字面量 "用户自有"。省略时必须给 name(走 PubChem 名称解析)',
  })),
  name: Type.Optional(Type.String({ description: "常用英文名;cid 为整数时可省略(取 PubChem Title);cid 省略时必填" })),
  id: Type.Optional(Type.String({ description: "kebab-case id;省略时由名称生成" })),
  family: Type.Optional(familySchema),
  note: Type.Optional(Type.Union([Type.Literal("top"), Type.Literal("heart"), Type.Literal("base")], { description: "香阶" })),
  odor: Type.Optional(Type.String({ description: "简短气味描述" })),
  cas: Type.Optional(Type.String({ description: "仅当与 PubChem synonyms 不一致时才显式给出" })),
  ifraEntryRef: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const patchSchema = Type.Object(
  {
    name: Type.Optional(Type.String()),
    cid: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Literal("用户自有")])),
    cas: Type.Optional(Type.String()),
    family: Type.Optional(familySchema),
    note: Type.Optional(Type.Union([Type.Literal("top"), Type.Literal("heart"), Type.Literal("base")])),
    odor: Type.Optional(Type.String()),
    physChem: Type.Optional(
      Type.Object({
        molWeight: Type.Optional(Type.Number()),
        logP: Type.Optional(Type.Number()),
        flashPointC: Type.Optional(Type.Number()),
      }),
    ),
    ifraEntryRef: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    euAllergen: Type.Optional(Type.Boolean()),
    synonyms: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

function renderDraftLine(d: Record<string, any>) {
  return `${d.id} · ${d.name} · CID ${d.cid} · CAS ${d.cas ?? "—"} · ${(d.family ?? []).join("/")} · ${d.note}`;
}

export default function (pi: ExtensionAPI) {
  // ------------------------------------------------------------------
  // 工具:material_add — PubChem 机器解析草稿 → 审批 → 写盘(批量)
  // ------------------------------------------------------------------
  pi.registerTool({
    name: "material_add",
    label: "Material Add",
    description:
      "向原料库添加原料(支持批量)。按 PubChem CID 机器解析名称/CAS/分子量;也可给化合物名(走 PubChem 名称解析)或 \"用户自有\"。事实字段全部来自 PubChem,写入前会请求用户批准。",
    promptSnippet:
      "Use material_add to add new materials by PubChem CID (or compound name). Never invent CID/CAS values from memory.",
    parameters: Type.Object({
      items: Type.Array(draftItemSchema, { minItems: 1, description: "原料草稿列表(批量)" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const drafts: Array<Record<string, any>> = [];
      const warnings: string[] = [];
      const failures: string[] = [];
      for (const item of params.items) {
        try {
          const r = await buildDraft(item as any);
          drafts.push(r.draft);
          warnings.push(...r.warnings);
        } catch (e) {
          failures.push(`${(item as any).name ?? (item as any).cid}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (drafts.length === 0) {
        return {
          content: [{ type: "text" as const, text: `❌ 没有可写入的草稿:\n${failures.join("\n")}` }],
          details: { kind: "material-save", written: false, errors: failures },
        };
      }

      let candidate = loadMaterialsFile();
      const mergedErrors: string[] = [];
      for (const d of drafts) {
        mergedErrors.push(...validateDraft(d));
        try {
          candidate = mergeAdd(candidate, d);
        } catch (e) {
          mergedErrors.push(e instanceof Error ? e.message : String(e));
        }
      }
      if (mergedErrors.length) {
        return {
          content: [{
            type: "text" as const,
            text:
              `❌ 草稿校验未通过,未写入:\n${mergedErrors.join("\n")}` +
              (failures.length ? `\n解析失败项:\n${failures.join("\n")}` : ""),
          }],
          details: { kind: "material-save", written: false, errors: mergedErrors },
        };
      }

      const summary =
        `添加 ${drafts.length} 个原料(全部 humanVerified=false,待人工核对):\n` +
        drafts.map(renderDraftLine).join("\n") +
        (warnings.length ? `\n⚠️ ${warnings.join("\n⚠️ ")}` : "") +
        (failures.length ? `\n另有 ${failures.length} 项解析失败(不写):\n${failures.join("\n")}` : "");
      const approved = await ctx.ui.confirm("写入原料库?", summary);
      if (!approved) {
        return {
          content: [{ type: "text" as const, text: "⛔ 用户拒绝写入原料库" }],
          details: { kind: "material-save", written: false, cancelled: true },
        };
      }

      const previousRaw = readFileSync(MATERIALS_PATH, "utf8");
      saveMaterialsFile(candidate);
      const postErrors: string[] = [];
      for (const m of loadMaterialsFile()) postErrors.push(...validateDraft(m));
      if (postErrors.length) {
        writeFileSync(MATERIALS_PATH, previousRaw, "utf8");
        return {
          content: [{ type: "text" as const, text: `❌ 写入后校验失败,已回滚:\n${postErrors.join("\n")}` }],
          details: { kind: "material-save", written: false, errors: postErrors, rolledBack: true },
        };
      }
      return {
        content: [{
          type: "text" as const,
          text: `✅ 已添加 ${drafts.length} 个原料:${drafts.map((d) => d.id).join(", ")}(humanVerified=false)`,
        }],
        details: { kind: "material-save", written: true, materials: drafts, warnings, failures },
      };
    },
  });

  // ------------------------------------------------------------------
  // 工具:material_update — 校正既有原料(id 不可变;humanVerified 重置 false)
  // ------------------------------------------------------------------
  pi.registerTool({
    name: "material_update",
    label: "Material Update",
    description:
      "校正原料库中既有原料的字段(名称/分类/气味/CID/CAS/IFRA 引用等)。展示旧→新差异并经用户批准后写入;修改会将 humanVerified 重置为 false(须重新人工核对)。",
    promptSnippet: "Use material_update to correct existing material records; it always requires user approval and resets humanVerified.",
    parameters: Type.Object({
      id: Type.String({ description: "原料 id(不可变)" }),
      patch: patchSchema,
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      let result;
      try {
        result = mergeUpdate(loadMaterialsFile(), params.id, params.patch as Record<string, unknown>);
      } catch (e) {
        throw new Error(e instanceof Error ? e.message : String(e));
      }
      const errors = validateDraft(result.after);
      if (errors.length) {
        return {
          content: [{ type: "text" as const, text: `❌ 更新结果校验未通过,未写入:\n${errors.join("\n")}` }],
          details: { kind: "material-save", written: false, errors },
        };
      }
      const diffLines = Object.keys(params.patch).map((k) => {
        const o = JSON.stringify(result.before[k] ?? null);
        const n = JSON.stringify(result.after[k] ?? null);
        return `${k}: ${o} → ${n}`;
      });
      const summary = `校正原料 ${params.id}\n${diffLines.join("\n")}\n(修改后 humanVerified=false,需重新人工核对)`;
      const approved = await ctx.ui.confirm(`校正原料 ${params.id}?`, summary);
      if (!approved) {
        return {
          content: [{ type: "text" as const, text: `⛔ 用户拒绝校正 ${params.id}` }],
          details: { kind: "material-save", written: false, cancelled: true },
        };
      }
      saveMaterialsFile(result.next);
      return {
        content: [{ type: "text" as const, text: `✅ 已校正 ${params.id}:${diffLines.join("; ")}` }],
        details: { kind: "material-save", written: true, id: params.id, before: result.before, after: result.after },
      };
    },
  });

  // ------------------------------------------------------------------
  // 工具:formula_heatmap — 多配方原料用量矩阵(前端渲染热图)
  // ------------------------------------------------------------------
  pi.registerTool({
    name: "formula_heatmap",
    label: "Formula Heatmap",
    description:
      "对比多个配方 YAML 的原料用量,返回 配方×原料 的 pct 矩阵(前端以热图展示)。分析配方间原料使用差异、香型重叠度时使用。",
    parameters: Type.Object({
      paths: Type.Array(Type.String(), { minItems: 1, description: "配方 YAML 路径列表" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const entries = params.paths.map((p) => {
        const abs = isAbsolute(p) ? p : resolve(ctx.cwd, p);
        return { label: p, raw: readFileSync(abs, "utf8") };
      });
      const result = buildHeatmap(entries, getMaterials());
      if (!result.ok) {
        return {
          content: [{ type: "text" as const, text: `❌ 无法生成热图:\n${result.errors.join("\n")}` }],
          details: { kind: "heatmap", ok: false, errors: result.errors },
        };
      }
      const text = `热图矩阵:${result.rows.length} 个配方 × ${result.materials.length} 种原料(列按总用量降序)`;
      return {
        content: [{ type: "text" as const, text }],
        details: { kind: "heatmap", ok: true, materials: result.materials, rows: result.rows },
      };
    },
  });
}
