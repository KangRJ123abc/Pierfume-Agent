#!/usr/bin/env node
// 一次性工具:对候选原料清单,从 PubChem REST API 批量解析 CAS 号。
// 流程:name → CID → synonyms → 抽取形如 \d{2,7}-\d{2}-\d 的条目 → 校验位过滤。
// 输出:每条的 { query, cid, cas[] }。自然提取物/商品名解析失败会标注,需人工处理。
import { writeFileSync } from "node:fs";

function casCheckDigitValid(cas) {
  const m = /^(\d{2,7})-(\d{2})-(\d)$/.exec(cas);
  if (!m) return false;
  const base = (m[1] + m[2]).split("").reverse().join("");
  let sum = 0;
  for (let i = 0; i < base.length; i++) sum += (i + 1) * Number(base[i]);
  return sum % 10 === Number(m[3]);
}

const CANDIDATES = [
  // 无 IFRA 条目(走"无限制"分支)
  ["hedione", "methyl dihydrojasmonate"],
  ["iso-e-super", "Tetramethyl acetyloctahydronaphthalenes"],
  ["ethanol", "ethanol"],
  // 限量(quantitative)
  ["coumarin", "coumarin"],
  ["citral", "citral"],
  ["eugenol", "eugenol"],
  ["isoeugenol", "isoeugenol"],
  ["cinnamal", "cinnamaldehyde"],
  ["geraniol", "geraniol"],
  ["citronellol", "citronellol"],
  ["linalool", "linalool"],
  ["benzyl-salicylate", "benzyl salicylate"],
  ["benzyl-benzoate", "benzyl benzoate"],
  ["hydroxycitronellal", "hydroxycitronellal"],
  ["amyl-cinnamal", "amyl cinnamal"],
  ["lyral", "hydroxyisohexyl 3-cyclohexene carboxaldehyde"],
  ["lilial", "butylphenyl methylpropional"],
  // 禁用/禁限(nitro musk 等)
  ["musk-ketone", "musk ketone"],
  ["musk-xylene", "musk xylene"],
  // 条件性(过氧化物等)
  ["limonene", "d-limonene"],
  // 无限制常用
  ["vanillin", "vanillin"],
  ["methyl-anthranilate", "methyl anthranilate"],
  ["alpha-isomethyl-ionone", "alpha-isomethyl ionone"],
  // 自然提取物(预期解析失败,需人工处理)
  ["oakmoss-absolute", "oakmoss absolute"],
  ["bergamot-oil", "bergamot oil"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function resolve(query) {
  // name → CID
  let cids;
  try {
    const j = await fetchJson(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(query)}/cids/JSON`);
    cids = j.IdentifierList?.CID ?? [];
  } catch (e) {
    return { query, error: `resolve: ${e.message}` };
  }
  if (cids.length === 0) return { query, error: "no CID found" };
  const cid = cids[0];
  // CID → synonyms(含 CAS)
  let synonyms = [];
  try {
    const j = await fetchJson(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/synonyms/JSON`);
    synonyms = j.InformationList?.Information?.[0]?.Synonym ?? [];
  } catch (e) {
    return { query, cid, error: `synonyms: ${e.message}` };
  }
  const cas = [...new Set(synonyms.filter((s) => casCheckDigitValid(s)))];
  return { query, cid, cas };
}

async function main() {
  const out = [];
  for (const [id, query] of CANDIDATES) {
    const r = await resolve(query);
    r.id = id;
    out.push(r);
    console.log(`${r.id.padEnd(22)} cid=${String(r.cid ?? "-").padEnd(7)} cas=[${(r.cas ?? []).join(", ")}] ${r.error ?? ""}`);
    await sleep(400); // PubChem 限流礼貌间隔
  }
  writeFileSync("D:/GLMProject/2026.9/Pierfume_Agent/packages/pierfume-core/data/_cas-draft.json", JSON.stringify(out, null, 2));
  console.log("\n已写入 data/_cas-draft.json");
}

main();
