#!/usr/bin/env node
// 一次性工具:从 data/_cas-draft.json(PubChem 机器核验的 CAS)合成 materials.sample.json 草稿。
// 所有条目的 humanVerified=false(AI 整理初稿),事实字段(CAS)来自 PubChem,描述字段(香型/气味)待人工复核。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const draft = JSON.parse(readFileSync(join(ROOT, "data", "_cas-draft.json"), "utf8"));

// id -> 属性映射(description 字段为初稿)
const META = {
  "hedione":              { name: "Hedione (Methyl Dihydrojasmonate)", family: ["floral"],           note: "heart", odor: "jasmine, fresh, transparent", ref: null },
  "ethanol":              { name: "Ethanol",                          family: ["carrier"],           note: "top",   odor: "alcohol, solvent",             ref: null },
  "coumarin":             { name: "Coumarin",                         family: ["gourmand", "balsamic"], note: "base", odor: "sweet hay, tonka, vanilla",    ref: "ifra-coumarin" },
  "citral":               { name: "Citral",                           family: ["citrus"],            note: "top",   odor: "lemon, sharp, citrus",          ref: "ifra-citral" },
  "eugenol":              { name: "Eugenol",                          family: ["spicy"],             note: "heart", odor: "clove, warm, spicy",            ref: "ifra-eugenol" },
  "isoeugenol":           { name: "Isoeugenol",                       family: ["spicy"],             note: "heart", odor: "clove, carnation",               ref: "ifra-isoeugenol" },
  "cinnamal":             { name: "Cinnamal (Cinnamaldehyde)",        family: ["spicy"],             note: "heart", odor: "cinnamon, warm",                 ref: "ifra-cinnamal" },
  "geraniol":             { name: "Geraniol",                         family: ["floral"],            note: "heart", odor: "rose, geranium",                 ref: "ifra-geraniol" },
  "citronellol":          { name: "Citronellol",                      family: ["floral"],            note: "heart", odor: "rose, fresh citrus",             ref: "ifra-citronellol" },
  "linalool":             { name: "Linalool",                         family: ["floral", "woody"],   note: "top",   odor: "floral, woody, lavender",       ref: "ifra-linalool" },
  "benzyl-salicylate":    { name: "Benzyl Salicylate",                family: ["balsamic"],          note: "base",  odor: "faint balsamic, creamy",        ref: "ifra-benzyl-salicylate" },
  "benzyl-benzoate":      { name: "Benzyl Benzoate",                  family: ["balsamic"],          note: "base",  odor: "faint sweet balsamic, fixative", ref: "ifra-benzyl-benzoate" },
  "hydroxycitronellal":   { name: "Hydroxycitronellal",               family: ["floral"],            note: "heart", odor: "lily of the valley, fresh",     ref: "ifra-hydroxycitronellal" },
  "amyl-cinnamal":        { name: "Amyl Cinnamal",                    family: ["floral"],            note: "heart", odor: "jasmine, floral",                ref: "ifra-amyl-cinnamal" },
  "lyral":                { name: "Lyral (HMMC)",                     family: ["floral"],            note: "heart", odor: "lily of the valley, watery",     ref: "ifra-lyral" },
  "lilial":               { name: "Lilial (BMHCA)",                   family: ["floral"],            note: "heart", odor: "lily of the valley, muguet",     ref: "ifra-lilial" },
  "musk-ketone":          { name: "Musk Ketone",                      family: ["musky"],             note: "base",  odor: "sweet, powdery musk",           ref: "ifra-musk-ketone" },
  "musk-xylene":          { name: "Musk Xylene",                      family: ["musky"],             note: "base",  odor: "musky, sweet",                  ref: "ifra-musk-xylene" },
  "limonene":             { name: "d-Limonene",                       family: ["citrus"],            note: "top",   odor: "orange peel, fresh",            ref: "ifra-limonene" },
  "vanillin":             { name: "Vanillin",                         family: ["gourmand"],          note: "base",  odor: "vanilla, sweet",                ref: null },
  "methyl-anthranilate":  { name: "Methyl Anthranilate",              family: ["fruity"],            note: "heart", odor: "grape, sweet floral",            ref: null },
  "alpha-isomethyl-ionone": { name: "Alpha-Isomethyl Ionone",         family: ["floral", "powdery"], note: "heart", odor: "violet, powdery",               ref: "ifra-alpha-isomethyl-ionone" },
};

const primaryCas = (casList) => (casList && casList.length ? casList[0] : null);

const materials = [];
for (const d of draft) {
  const meta = META[d.id];
  if (!meta) continue; // 未在映射中(如解析失败的)跳过
  if (!d.cas || d.cas.length === 0) {
    console.warn(`⚠️  跳过 ${d.id}: 无机器核验 CAS (${d.error ?? ""})`);
    continue;
  }
  materials.push({
    id: d.id,
    name: meta.name,
    cas: primaryCas(d.cas),
    family: meta.family,
    note: meta.note,
    odor: meta.odor,
    ifraEntryRef: meta.ref,
    provenance: {
      sources: [`PubChem CID ${d.cid} (CAS 经校验位算法验证)`, "AI 整理初稿,待人工复核"],
      humanVerified: false,
    },
  });
}

materials.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(join(ROOT, "data", "materials.sample.json"), JSON.stringify(materials, null, 2) + "\n");
console.log(`✅ 已生成 materials.sample.json:${materials.length} 条 (全部 humanVerified=false)`);
