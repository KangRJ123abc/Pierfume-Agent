# Pierfume Agent — AGENTS.md

> 项目级上下文文件。AI 助手接手本仓库任务前必须先读本文件,再读 [docs/Pierfume-Agent-项目初始文档.md](docs/Pierfume-Agent-项目初始文档.md)(第一上下文来源,范围/验收/红线以此为准)。
> 更新:2026-09-21(D2 代码完成、卡在网络验证的状态快照)。

## 1. 项目一句话

基于 **Pi**(earendil-works/pi)二次开发的**调香师副驾驶**:Agent 负责检索/校验/穷举/文档化,创意决策留给调香师。**不改 Pi 内核**,一切能力以 extension / skill / prompt 外挂。

## 2. 仓库布局

```
Pierfume_Agent/
├── pi/                       # 底座源码(v0.85.1+87,已构建成功,只读参考)
├── packages/pierfume-core/   # 主 pi package(本项目的开发主场)
│   ├── extensions/
│   │   ├── formula-lint/    # 已实现(with-deps 结构:package.json + index.ts;node_modules 不入 git)
│   │   └── ifra-check/      # 骨架,未实现
│   ├── skills/  prompts/                        # 占位
│   ├── schemas/{materials,ifra-rules,formula}.schema.json
│   ├── data/{materials.sample.json, ifra-rules.json, _cas-draft.json}
│   ├── examples/   # 3 个好配方:formula.example / citrus-cologne / musk-amber .yaml
│   ├── tests/fixtures/  # 5 个坏夹具:bad-unknown-material/sum/duplicate/category-number/syntax
│   ├── scripts/{schema-validator, formula-lint-core, validate-data, validate-formula, fetch-cas, build-materials}.mjs
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
- [~] **formula-lint 扩展(D2)**:代码已完成,**端到端验证被网络阻塞,尚未提交**。已完成:
  - `scripts/formula-lint-core.mjs`:零副作用共享校验核心(YAML→schema→materialRef→重复→总量 ±1),CLI 与扩展共用
  - `scripts/schema-validator.mjs`:从 validate-data 抽出的共享迷你 Schema 校验器
  - `extensions/formula-lint/`:with-deps 目录结构(自带 package.json 声明 yaml 依赖),`index.ts` 同时注册命令 `/formula-lint <file...>` 与工具 `formula_lint`(TypeBox 参数,LLM 强制校验)
  - 3 好配方(example/citrus-cologne/musk-amber)+ 5 坏夹具(tests/fixtures/,各注入一类错误)
  - CLI 层(`npm run validate-formula`)回归通过;**pi CLI 加载真实扩展的 E2E 未跑通,见 §7 卡点**
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

# pi CLI 加载真实扩展(print 模式 E2E;务必 < /dev/null 且重定向到文件取真实退出码)
cd packages/pierfume-core
node ../../pi/packages/coding-agent/dist/bundle/cli.js --offline \
  -e extensions/formula-lint "/formula-lint examples/formula.example.yaml" \
  < /dev/null > /tmp/out.log 2>&1; echo $?
```

## 7. 环境、网络变通与当前卡点

### 7.1 已实测的网络变通
- GitHub 直连不通 → clone 用 `https://gh-proxy.com/https://github.com/...`
- npm registry 已是 npmmirror;canvas 等原生二进制装不上时加 `npm_config_canvas_binary_host_mirror=https://registry.npmmirror.com/-/binary/canvas`
- `npm run build:offline`(跳过联网模型数据);模型数据缺失时从 npmmirror 的 `@earendil-works/pi-ai` tgz 解包
- **PubChem REST API 可达** → CAS 核验用它(`/rest/pug/compound/name/{n}/cids/JSON` → `/cid/{cid}/synonyms/JSON`)
- 详细见 memory 文件 `china-network-build-workarounds`

### 7.2 DeepSeek provider 配置(2026-09-21)
- 用户指定 provider = DeepSeek(`https://api.deepseek.com`),api key 在**本机环境变量 `DEEPSEEK_API_KEY`**(已确认存在)
- **模型名用 `deepseek-flash`**(DeepSeek V4.1 Flash,推理模型);**禁用 v3 系列(已下架)**。pi 自带目录快照是旧名 `deepseek-v4-flash`,新名来源:pi 仓库 `packages/ai/scripts/generate-models.ts` 内联定义
- 已写 `~/.pi/agent/models.json`:覆盖内置 deepseek provider,`apiKey:"$DEEPSEEK_API_KEY"`,按 id upsert 加入 deepseek-flash(内置模型保留)

### 7.3 ⚠️ 当前卡点:pi CLI 所有运行都返回 `Request timed out.`(真实退出码 1)
- `Request timed out.` = SDK 的 `APIConnectionTimeoutError`(在 dist/bundle/chunks/* 中),客户端连接 provider 端点超时
- 三种运行全部同样失败:① `/formula-lint`(加载我们扩展);② **零依赖探针扩展 `/probe`**(只 console.log);③ **无扩展普通 prompt `-p`**
- 关键矛盾:命令分发(`agent-session.ts:1237` `_tryExecuteExtensionCommand`,print 模式 bind 在 `print-mode.ts:74`)**先于**模型/认证,命令被找到就不该有网络请求;但探针也超时 → 两种未排除的假设:
  1. **沙箱 shell 网络不通 api.deepseek.com**(与 GitHub 直连同类;用户本人终端可能通),且启动链路某处在 prompt 前阻塞(待查:`main.ts:790` `resolveModelScope` 带 15s AbortSignal、startup 是否有别的 provider 调用)
  2. 扩展/命令在 print 模式下未成功注册分发(但扩展加载错误会进 diagnostics 打印,实测无任何诊断输出)
- 已排除:stdin 阻塞(已 `< /dev/null`)、扩展加载报错(无 diagnostics)、"no models available"(未出现 → session.model 存在,models.json 生效)
- **下一步**:① `curl -m 8 https://api.deepseek.com/` 实测沙箱通达性(上次被中断);② 若沙箱不通,请用户在自己终端跑同一条命令,或给沙箱加代理;③ 网络确认后依次重跑探针 → formula-lint → 编写 E2E 测试脚本(3 好 5 坏)→ 提交 D2

## 8. 设计决策备忘

- **单一事实来源**:限量数值只存在 `data/ifra-rules.json`;materials 通过 `ifraEntryRef` 引用,禁止抄录限量数值到原料表
- 香型词表为受控 enum(citrus/floral/woody/…+carrier),禁止自由发挥
- CAS 主号取 PubChem 同义词首条 + 校验位过滤;异构体/别名进 `synonyms`
- amyl-cinnamal 主 CAS 为 **122-40-7**(母体),101365-33-7 为 (2Z) 异构体

**Pi 扩展机制调研结论(2026-09-21,本地源码 + pi.dev 双源核对一致)**:
- 扩展 = **默认导出工厂函数** `(pi: ExtensionAPI) => void|Promise<void>`,**无 `defineExtension()`**;jiti 直接加载 TS 免编译,扩展永不打进 bundle
- 注册:`pi.registerCommand(name,{description,handler:(args,ctx)=>...})`、`pi.registerTool({name,parameters:TypeBox,execute})`;改文件用 `withFileMutationQueue`;拦截调用用 `pi.on("tool_call",...)` 返回 `{block,reason}`
- 扩展读文件直接 `node:fs`,无 ctx 文件 API;`pi.exec` 跑命令;headless 下 `ctx.ui.notify` 是 no-op → 需 `console.log` fallback
- **`yaml` 不在 bundle 形态 virtualModules 白名单** → 用扩展必须 with-deps:扩展目录自带 package.json + node_modules(typebox/pi-coding-agent 由运行时提供,peerDeps)
- 扩展无沙箱完整权限(官方明确"有意为之");CVE-2026-5556 经 NVD 核实:影响旧名 badlogic/pi-mono ≤0.58.4,NVD Deferred,官方无披露记录
- 权威文档:https://pi.dev/docs/latest/extensions(实测可达)、`pi/packages/coding-agent/docs/`、示例 `examples/extensions/`(hello.ts/trigger-compact.ts/todo.ts/claude-rules.ts)

## 9. 待办与下一步

1. [x] ~~定义**配方 YAML Schema**~~(D1,提交 87952e0)
2. [~] **formula-lint 扩展** —— D2 代码已完成(见 §3),**待网络验证**:curl 测 api.deepseek.com → 用户终端代跑/加代理 → 探针 → `/formula-lint` 3 好 5 坏 E2E → 编写测试脚本 → **提交 D2**
3. 实现 **ifra-check** 扩展 + Markdown/JSON 双输出合规报告—— D3
4. 打包验证 `pi install` + 端到端 demo—— D5
5. [x] ~~git init~~(首个提交 aa88e64)
6. 测试断言需基于人工核对后的数据,编写时向用户确认
