# Pierfume Agent — AGENTS.md

> 项目级上下文文件。AI 助手接手本仓库任务前必须先读本文件,再读 [docs/Pierfume-Agent-项目初始文档.md](docs/Pierfume-Agent-项目初始文档.md)(第一上下文来源,范围/验收/红线以此为准)。
> 更新:2026-09-21(对话 compact 前的状态快照)。

## 1. 项目一句话

基于 **Pi**(earendil-works/pi)二次开发的**调香师副驾驶**:Agent 负责检索/校验/穷举/文档化,创意决策留给调香师。**不改 Pi 内核**,一切能力以 extension / skill / prompt 外挂。

## 2. 仓库布局

```
Pierfume_Agent/
├── pi/                       # 底座源码(v0.85.1+87,已构建成功,只读参考)
├── packages/pierfume-core/   # 主 pi package(本项目的开发主场)
│   ├── extensions/{ifra-check,formula-lint}/   # 扩展(骨架,未实现)
│   ├── skills/  prompts/                        # 占位
│   ├── schemas/{materials,ifra-rules,formula}.schema.json
│   ├── data/{materials.sample.json, ifra-rules.json, _cas-draft.json}
│   ├── examples/formula.example.yaml           # 示例配方
│   ├── scripts/{schema-validator, validate-data, validate-formula, fetch-cas, build-materials}.mjs
│   └── docs/{data-verification-checklist, data-verification-report-2026-09-21}.md
├── docs/Pierfume-Agent-项目初始文档.md
└── AGENTS.md                 # 本文件
```

## 3. 当前进度(2026-09-21)

- [x] **底座环境**:pi 克隆 + 构建成功 + CLI 可用(`node packages/coding-agent/dist/bundle/cli.js --version` → 0.85.1)
- [x] **数据 Schema**:materials + ifra-rules 双 JSON Schema
- [x] **校验工具**:`scripts/validate-data.mjs`(零依赖:迷你 JSON Schema 校验 + CAS 校验位 + 跨文件引用检查 + `--selftest` 自测)
- [x] **原料数据集**:22 条,**全部人工核对**(`humanVerified=true`),CAS 经 PubChem 机器核验
- [x] **IFRA 规则表**:18 条带真实限量数值(来自 IFRA 官方 STD 文档,逐条标注 `stdDoc`/`amendment`/`drivingProperty`),全部人工核对
- [x] **git 仓库初始化**(2026-09-21,首个提交 aa88e64;pi/ 自带独立仓库,已 gitignore)
- [x] **配方 YAML Schema**(D1):`schemas/formula.schema.json` + 示例 `examples/formula.example.yaml` + 校验脚本 `validate-formula.mjs`(schema 校验 + materialRef 跨文件引用 + 重复原料 + 总量归一 ±1;负向测试 4 类错误全部拦截)。设计:product.category(加引号的字符串)决定 ifra-check 适用限量列;fragranceUseLevelPct(缺省 100)换算浓缩物→成品
- [ ] **formula-lint 扩展**(移植 validate-formula 为 Pi 扩展)—— D2
- [ ] **ifra-check 扩展** —— D3–D4
- [ ] **打包为 pi package 验证 `pi install`** —— D5

## 4. 数据现状与缺口

| 资产 | 现状 | 目标 |
|---|---|---|
| 原料 | 22 条 | 50–100 条 |
| IFRA 规则 | 18 条 | 80–100 条 |

**待人工提供的数据**(已在报告中记录,尚未入库):
- `iso-e-super`(常见引用 54464-57-2,未验证)、`oakmoss-absolute`(9000-50-4?)、`bergamot-oil`(8007-75-8?)——混合物/天然提取物,需权威 CAS
- linalool / limonene 为 **specification** 型(过氧化物等规格参数待补录)
- 原料的香型/气味描述(用户已确认沿用现库初稿)

**多市场差异测试用例**(已入库):lyral(EU 2021 禁用,IFRA 限量 0.20% Cat4)、lilial(EU 2022 全面禁用,IFRA Cat1/6 禁用其余限量)。

## 5. 红线规则(必须遵守)

1. **不修改 `pi/` 内核源码**,能力一律走 extension / skill / prompt;
2. 依赖与 import 用 `@earendil-works/*`(不用已废弃的 `@mariozechner/*`、`badlogic/pi-mono`);
3. IFRA 限量、CAS 号等事实数据**禁止凭模型记忆生成**,必须来自 `data/` 下文件;新增数据走 PubChem 机器核验 + 人工确认流程;
4. `provenance.humanVerified=false` 的数据**不得用于测试断言**;
5. 合规相关测试断言需人工确认后合入;
6. 第三方 pi package 安装前必须人工审查源码(扩展无沙箱);
7. 每天保持可运行状态。

## 6. 常用命令

```bash
# 数据校验(改数据后必跑)
cd packages/pierfume-core && npm run validate-data        # 校验
npm run validate-data:self                                # 自测 + 校验
npm run validate-formula [-- path/to/f.yaml]              # 校验配方(默认示例;支持绝对路径)

# 扩展/包最终要能 pi install;本地验证方式
cd pi && node packages/coding-agent/dist/bundle/cli.js --help
```

## 7. 环境与网络变通(本机已实测)

- GitHub 直连不通 → clone 用 `https://gh-proxy.com/https://github.com/...`
- npm registry 已是 npmmirror;canvas 等原生二进制装不上时加 `npm_config_canvas_binary_host_mirror=https://registry.npmmirror.com/-/binary/canvas`
- `npm run build:offline`(跳过联网模型数据);模型数据缺失时从 npmmirror 的 `@earendil-works/pi-ai` tgz 解包
- **PubChem REST API 可达** → CAS 核验用它(`/rest/pug/compound/name/{n}/cids/JSON` → `/cid/{cid}/synonyms/JSON`)
- 详细见 memory 文件 `china-network-build-workarounds`

## 8. 设计决策备忘

- **单一事实来源**:限量数值只存在 `data/ifra-rules.json`;materials 通过 `ifraEntryRef` 引用,禁止抄录限量数值到原料表
- 香型词表为受控 enum(citrus/floral/woody/…+carrier),禁止自由发挥
- CAS 主号取 PubChem 同义词首条 + 校验位过滤;异构体/别名进 `synonyms`
- amyl-cinnamal 主 CAS 为 **122-40-7**(母体),101365-33-7 为 (2Z) 异构体

## 9. 待办与下一步

1. [x] ~~定义**配方 YAML Schema**~~(已完成 D1,见 §3)
2. 实现 **formula-lint** 扩展(未知原料、总量归一、剂量边界)—— D2:先看 pi 扩展如何注册命令/读取文件(参考 pi 内置扩展),把 validate-formula.mjs 逻辑移植为 TS 扩展
3. 实现 **ifra-check** 扩展 + Markdown/JSON 双输出合规报告—— D3
4. 打包验证 `pi install` + 端到端 demo—— D5
5. [x] ~~git init~~(2026-09-21 完成,首个提交 aa88e64)
6. 测试断言需基于人工核对后的数据,编写时向用户确认
