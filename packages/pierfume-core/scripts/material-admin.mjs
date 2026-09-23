#!/usr/bin/env node
/**
 * material-admin CLI:原料添加/校正的独立人工入口(与 data-admin 扩展共用核心)。
 *
 *   node scripts/material-admin.mjs preview --cid 6549 --family floral --note top [--name X] [--id X]
 *   node scripts/material-admin.mjs preview --name "linalool" --family floral,woody --note top   # 名称解析
 *   node scripts/material-admin.mjs preview --cid 用户自有 --name "玫瑰净油" --id rose-absolute --family floral --note heart
 *   node scripts/material-admin.mjs add --data <materials.json> --json '<draft|draft[]>' [--yes]
 *   node scripts/material-admin.mjs update --data <materials.json> --id <id> --json '<patch>' [--yes]
 *
 * 说明:
 *   - preview 走 PubChem 机器解析,只打印草稿,不写文件;
 *   - add/update 写文件前做 schema + CAS 校验位 + 冲突检查;
 *   - --data 指向真实 data/materials.sample.json 时需 --yes 确认;测试/演练请指向临时副本。
 */
import {
  MATERIALS_PATH,
  USER_OWNED_CID,
  buildDraft,
  loadMaterialsFile,
  mergeAdd,
  mergeUpdate,
  saveMaterialsFile,
  validateDraft,
} from "./material-admin-core.mjs";
import { readFileSync } from "node:fs";

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = { _: [] };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) opts[rest[i].slice(2)] = rest[++i];
    else opts._.push(rest[i]);
  }
  return { cmd, opts };
}

function die(msg, code = 1) {
  console.error(`❌ ${msg}`);
  process.exit(code);
}

function splitList(s) {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

async function cmdPreview(opts) {
  const item = {};
  if (opts.cid !== undefined) item.cid = /^\d+$/.test(opts.cid) ? Number(opts.cid) : opts.cid;
  if (opts.name) item.name = opts.name;
  if (opts.id) item.id = opts.id;
  if (opts.family) item.family = splitList(opts.family);
  if (opts.note) item.note = opts.note;
  if (opts.odor) item.odor = opts.odor;
  if (opts.cas) item.cas = opts.cas;
  const { draft, warnings } = await buildDraft(item);
  console.log(JSON.stringify({ draft, warnings }, null, 2));
}

function cmdAdd(opts) {
  if (!opts.data) die("add 需要 --data <materials.json>");
  if (!opts.json) die("add 需要 --json '<draft|draft[]>'");
  confirmIfReal(opts); // 安全门最先执行:指向真实原料库时必须显式 --yes
  const drafts = JSON.parse(opts.json);
  const list = Array.isArray(drafts) ? drafts : [drafts];
  let materials = loadMaterialsFile(opts.data);
  for (const d of list) {
    const errors = validateDraft(d);
    if (errors.length) die(`草稿校验失败:\n${errors.join("\n")}`);
  }
  for (const d of list) materials = mergeAdd(materials, d); // 冲突抛错
  saveMaterialsFile(materials, opts.data);
  console.log(`✅ 已写入 ${list.length} 条 → ${opts.data}(humanVerified=false,待人工核对)`);
}

function cmdUpdate(opts) {
  if (!opts.data) die("update 需要 --data <materials.json>");
  if (!opts.id) die("update 需要 --id <原料id>");
  if (!opts.json) die("update 需要 --json '<patch>'");
  confirmIfReal(opts);
  const patch = JSON.parse(opts.json);
  const materials = loadMaterialsFile(opts.data);
  const { next } = mergeUpdate(materials, opts.id, patch);
  const errors = validateDraft(next.find((m) => m.id === opts.id));
  if (errors.length) die(`更新结果校验失败:\n${errors.join("\n")}`);
  saveMaterialsFile(next, opts.data);
  console.log(`✅ 已更新 ${opts.id} → ${opts.data}(humanVerified 已重置为 false)`);
}

function confirmIfReal(opts) {
  if (opts.data === MATERIALS_PATH && !opts.yes)
    die("--data 指向真实原料库,需加 --yes 确认(或先指向临时副本演练)");
}

const { cmd, opts } = parseArgs(process.argv.slice(2));
try {
  if (cmd === "preview") await cmdPreview(opts);
  else if (cmd === "add") cmdAdd(opts);
  else if (cmd === "update") cmdUpdate(opts);
  else
    die(
      "用法:\n" +
        "  preview --cid <N|用户自有> --family a,b --note top|heart|base [--name X] [--id X] [--odor S] [--cas X]\n" +
        "  add --data <file> --json '<draft|draft[]>' [--yes]\n" +
        "  update --data <file> --id <id> --json '<patch>' [--yes]",
      0,
    );
} catch (e) {
  die(e instanceof Error ? e.message : String(e));
}
