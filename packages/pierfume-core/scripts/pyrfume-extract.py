#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
pyrfume-extract.py — 从 pyrfume-data 克隆提取带 CID 的分子清单(demo 数据导入第一步)。

来源(需在 demo/workspace/pyrfume-data 有仓库克隆,如缺:
  git clone --depth 1 https://gh-proxy.com/https://github.com/pyrfume/pyrfume-data demo/workspace/pyrfume-data)

输出:demo/workspace/pyrfume-raw.json
  [{cid, name, iupac, molWeight, cas, odor, datasets[]}]
  - 仅保留 CID>0 的记录(pyrfume 用负数 CID 占位无 PubChem 条目者);
  - cas/odor 仅来自 goodscents 子集(stimuli.csv 的 CAS↔CID 映射 + behavior.csv 描述词),
    其余记录的 CAS 由第二步 scripts/import-pyrfume.mjs 走 PubChem 批量补全(机器核验)。

运行(demo/workspace/.venv-pyrfume,见 AGENTS.md §7.1):
  demo/workspace/.venv-pyrfume/Scripts/python.exe scripts/pyrfume-extract.py
"""
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "demo" / "workspace" / "pyrfume-data"
OUT = ROOT / "demo" / "workspace" / "pyrfume-raw.json"

if not DATA.is_dir():
    sys.exit(f"缺少 {DATA},先按文件头注释克隆 pyrfume-data")

molecules = pd.read_csv(DATA / "molecules" / "molecules.csv", dtype={"CID": "int64"})
usage = pd.read_csv(DATA / "molecules" / "usage.csv", dtype={"CID": "int64"})
molecules = molecules[molecules["CID"] > 0].drop_duplicates("CID")
usage = usage[usage["CID"] > 0].drop_duplicates("CID")

# 各数据集覆盖情况(usage 表列:首个为 CID,其余 0/1)
dataset_cols = [c for c in usage.columns if c != "CID"]
usage["datasets"] = usage[dataset_cols].apply(
    lambda row: [c for c in dataset_cols if row[c] == 1], axis=1,
)

df = molecules.merge(usage[["CID", "datasets"]], on="CID", how="left")

# goodscents:CID→CAS,以及 CAS→气味描述词
gs_cas = {}
gs_stimuli = DATA / "goodscents" / "stimuli.csv"
if gs_stimuli.is_file():
    stim = pd.read_csv(gs_stimuli, dtype={"CID": "Int64"})
    for _, r in stim.dropna(subset=["CID"]).iterrows():
        cid = int(r["CID"])
        cas = str(r["Stimulus"]).strip()
        if cid > 0 and cid not in gs_cas:
            gs_cas[cid] = cas

gs_odor = {}
gs_behavior = DATA / "goodscents" / "behavior.csv"
if gs_behavior.is_file():
    beh = pd.read_csv(gs_behavior)
    for _, r in beh.iterrows():
        cas = str(r["Stimulus"]).strip()
        desc = str(r.get("Descriptors", "")).strip()
        if cas and desc and desc.lower() != "nan" and cas not in gs_odor:
            gs_odor[cas] = desc

records = []
for _, r in df.iterrows():
    cid = int(r["CID"])
    cas = gs_cas.get(cid)
    odor = (gs_odor.get(cas) or None) if cas else None
    if odor and len(odor) > 120:
        odor = odor[:119] + "…"
    name = r.get("name")
    if pd.isna(name) or not str(name).strip():
        name = r.get("IUPACName")
    records.append({
        "cid": cid,
        "name": str(name).strip() if pd.notna(name) else str(cid),
        "iupac": None if pd.isna(r.get("IUPACName")) else str(r["IUPACName"]),
        "molWeight": None if pd.isna(r.get("MolecularWeight")) else round(float(r["MolecularWeight"]), 3),
        "cas": cas,
        "odor": odor,
        "datasets": r["datasets"] if isinstance(r["datasets"], list) else [],
    })

OUT.write_text(json.dumps(records, ensure_ascii=False, indent=1), encoding="utf-8")
with_cas = sum(1 for r in records if r["cas"])
with_odor = sum(1 for r in records if r["odor"])
print(f"[ok] {len(records)} 条 CID>0 分子 -> {OUT}")
print(f"     goodscents 提供 CAS {with_cas} 条、气味描述 {with_odor} 条;其余待 PubChem 批量补全")
