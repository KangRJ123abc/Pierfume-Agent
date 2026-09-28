#!/usr/bin/env node
/**
 * import-pyrfume.mjs — Pyrfume 数据导入第二步:PubChem 批量补全 CAS → 写 staging 区。
 *
 * 流程:
 *   1. 读 demo/workspace/pyrfume-raw.json(pyrfume-extract.py 的产物);
 *   2. 主库已有的 CID 标记 imported=true(不重复入库);
 *   3. 缺 CAS 的记录走 PubChem PUG REST 批量 synonyms(每 100 个 CID 一批,
 *      CAS 经 cas-check 校验位过滤 —— 与 Agent 工具同一套机器核验逻辑);
 *   4. 写 demo/workspace/pyrfume.staging.json(demo GUI 原料库页的待入库区)。
 *
 * staging 记录:{cid, name, cas, odor, datasets, imported}
 * 说明:staging 不受 materials schema 约束(无 family/note —— 受控词表须人工/Agent
 * 在入库时给定);入库动作本身走 POST /api/materials-admin 或 material_add 工具,
 * 同一套 validateDraft 校验。
 *
 * 用法:node scripts/import-pyrfume.mjs [--limit N](调试用;正式导入不带参数)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractCas, loadMaterialsFile } from "./material-admin-core.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(ROOT, "demo/workspace/pyrfume-raw.json");
const OUT = join(ROOT, "demo/workspace/pyrfume.staging.json");
const PUG = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";
const BATCH = 100;
const DELAY_MS = 220; // PubChem 建议 ≤5 req/s
const TIMEOUT_MS = 30_000;

const limitIdx = process.argv.indexOf("--limit");
const limit = limitIdx > -1 ? Number(process.argv[limitIdx + 1]) : Infinity;

const raw = JSON.parse(readFileSync(RAW, "utf8")).slice(0, Number.isFinite(limit) ? limit : undefined);
const libraryCids = new Set(loadMaterialsFile().map((m) => m.cid).filter((c) => Number.isInteger(c)));

async function fetchSynonyms(cids) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${PUG}/compound/cid/${cids.join(",")}/synonyms/JSON`, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data?.InformationList?.Information ?? [];
  } finally {
    clearTimeout(timer);
  }
}

const needCas = raw.filter((r) => !r.cas && Number.isInteger(r.cid));
console.log(`共 ${raw.length} 条;主库已含 ${raw.filter((r) => libraryCids.has(r.cid)).length} 条;待 PubChem 补 CAS ${needCas.length} 条`);

let filled = 0;
let failedBatches = 0;
for (let i = 0; i < needCas.length; i += BATCH) {
  const chunk = needCas.slice(i, i + BATCH);
  try {
    const infos = await fetchSynonyms(chunk.map((r) => r.cid));
    const byCid = new Map(infos.map((x) => [Number(x.CID), x.Synonym ?? []]));
    for (const r of chunk) {
      const cas = extractCas(byCid.get(r.cid) ?? []);
      if (cas) {
        r.cas = cas;
        filled++;
      }
    }
  } catch (e) {
    failedBatches++;
    console.warn(`  [warn] CID 批次 ${chunk[0].cid}..${chunk[chunk.length - 1].cid} 失败:${e.message}(cas 留空)`);
  }
  if ((i / BATCH) % 10 === 0) console.log(`  进度 ${Math.min(i + BATCH, needCas.length)}/${needCas.length},已补 ${filled}`);
  await new Promise((r) => setTimeout(r, DELAY_MS));
}

const staging = raw.map((r) => ({
  cid: r.cid,
  name: r.name,
  cas: r.cas ?? null,
  odor: r.odor ?? null,
  datasets: r.datasets ?? [],
  imported: libraryCids.has(r.cid),
}));
writeFileSync(OUT, JSON.stringify(staging, null, 1) + "\n", "utf8");
console.log(`✅ staging 完成:${staging.length} 条 → ${OUT}`);
console.log(`   含 CAS ${staging.filter((s) => s.cas).length} 条;已在主库 ${staging.filter((s) => s.imported).length} 条;PubChem 批次失败 ${failedBatches} 个(cas 留空,可重跑补齐)`);
