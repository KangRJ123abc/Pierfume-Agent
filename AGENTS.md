# Pierfume Agent — AGENTS.md

> 项目级上下文文件。AI 助手接手本仓库任务前必须先读本文件,再读 [docs/Pierfume-Agent-项目初始文档.md](docs/Pierfume-Agent-项目初始文档.md)(第一上下文来源,范围/验收/红线以此为准)。
> 更新:2026-09-22(配方工作台闭环:formula-diff 改版对比 + 项目禁限用清单 + 报告导出;GUI 增至三页,三套测试 59 断言)。

## 1. 项目一句话

基于 **Pi**(earendil-works/pi)二次开发的**调香师副驾驶**:Agent 负责检索/校验/穷举/文档化,创意决策留给调香师。**不改 Pi 内核**,一切能力以 extension / skill / prompt 外挂。

## 2. 仓库布局

```
Pierfume_Agent/
├── pi/                       # 底座源码(v0.85.1+87,已构建成功,只读参考)
├── packages/pierfume-core/   # 主 pi package(本项目的开发主场)
│   ├── extensions/
│   │   ├── formula-lint/    # 已实现(D2,提交 7c2c62e;with-deps:package.json + index.ts;node_modules 不入 git)
│   │   └── ifra-check/      # 已实现(D3,待提交;命令 /ifra-check + 工具 ifra_check,Markdown/JSON 双输出)
│   ├── skills/  prompts/                        # 占位
│   ├── schemas/{materials,ifra-rules,formula}.schema.json
│   ├── data/{materials.sample.json, ifra-rules.json, _cas-draft.json}
│   ├── examples/   # 3 个好配方:formula.example / citrus-cologne / musk-amber .yaml(均 IFRA 合规)
│   ├── tests/fixtures/  # lint 坏夹具 5 个 + ifra 夹具 5 个(3 违规/1 边界合规/1 specification 提示)
│   ├── scripts/{schema-validator, formula-lint-core, validate-data, validate-formula, ifra-check-core, ifra-check, fetch-cas, build-materials}.mjs
│   └── docs/{data-verification-checklist, data-verification-report-2026-09-21}.md
├── docs/Pierfume-Agent-项目初始文档.md
└── AGENTS.md                 # 本文件
```

## 3. 当前进度(2026-09-22)

- [x] **底座环境**:pi 克隆 + 构建成功 + CLI 可用(`node packages/coding-agent/dist/bundle/cli.js --version` → 0.85.1)
- [x] **数据 Schema**:materials + ifra-rules 双 JSON Schema
- [x] **校验工具**:`scripts/validate-data.mjs`(零依赖:迷你 JSON Schema 校验 + CAS 校验位 + 跨文件引用检查 + `--selftest` 自测)
- [x] **原料数据集**:22 条,**全部人工核对**(`humanVerified=true`),CAS 经 PubChem 机器核验
- [x] **IFRA 规则表**:18 条带真实限量数值(来自 IFRA 官方 STD 文档,逐条标注 `stdDoc`/`amendment`/`drivingProperty`),全部人工核对
- [x] **git 仓库初始化**(2026-09-21,首个提交 aa88e64;pi/ 自带独立仓库,已 gitignore)
- [x] **配方 YAML Schema**(D1):`schemas/formula.schema.json` + 示例 `examples/formula.example.yaml` + 校验脚本 `validate-formula.mjs`(schema 校验 + materialRef 跨文件引用 + 重复原料 + 总量归一 ±1;负向测试 4 类错误全部拦截)。设计:product.category(加引号的字符串)决定 ifra-check 适用限量列;fragranceUseLevelPct(缺省 100)换算浓缩物→成品
- [x] **formula-lint 扩展(D2,提交 7c2c62e)**:三层测试全绿(24 断言)。已完成:
  - `scripts/formula-lint-core.mjs`:零副作用共享校验核心(YAML→schema→materialRef→重复→总量 ±1),CLI 与扩展共用
  - `scripts/schema-validator.mjs`:从 validate-data 抽出的共享迷你 Schema 校验器
  - `extensions/formula-lint/`:with-deps 目录结构(自带 package.json 声明 yaml 依赖),`index.ts` 同时注册命令 `/formula-lint <file...>` 与工具 `formula_lint`(TypeBox 参数,LLM 强制校验)
  - 3 好配方(example/citrus-cologne/musk-amber)+ 5 坏夹具(tests/fixtures/,各注入一类错误)
  - `tests/formula-lint.e2e.mjs`:A 单元/B CLI/C pi E2E 三层;`npm run test:formula-lint`
  - E2E 实测结论见 §7.3(网络已通,扩展真实分发成功)
- [x] **ifra-check 扩展(D3,提交 4857dff;合规断言经人工确认 2026-09-22,红线 5)**:三层测试 26 断言全绿。已实现:
  - `scripts/ifra-check-core.mjs`:共享核查核心 —— formula-lint 前置 → 成品口径换算(pct × fragranceUseLevelPct/100)→ quantitative/prohibition/specification 三型判定;不硬编码任何限量(单一事实来源 data/ifra-rules.json)
  - `scripts/ifra-check.mjs`:CLI(Markdown 默认,`--json` 输出 JSON,退出码 0/1)
  - `extensions/ifra-check/`:命令 `/ifra-check`(Markdown 报告:超标项/限量依据/建议调整)+ 工具 `ifra_check`(摘要 + JSON details)
  - `tests/fixtures/ifra-*.yaml` 5 个:lilial Cat1 禁用、lyral Cat4 超量、cinnamal 恰界合规、musk-xylene 全类禁用、specification 仅提示
  - `tests/ifra-check.e2e.mjs`:A 单元/B CLI/C pi E2E;`npm run test:ifra-check`
  - 3 个存量示例配方实测均 IFRA 合规(仅有 specification/no-entry 提示)
- [x] **打包验证 `pi install` + 真实 brief 端到端 demo(D5,2026-09-22)**:双 scope 均验证通过,机制细节见 §7.4
  - 项目级:`pi install ./packages/pierfume-core -l` → 仓库根 `.pi/settings.json`(已 gitignore)
  - 用户级:`pi install <绝对路径>` → `~/.pi/agent/settings.json`,neutral cwd 实测 `/formula-lint`、`/ifra-check` 真实分发
  - 真实 brief demo:Agent 读原料库 → 生成 12 原料配方 → `formula_lint` ✅ + `ifra_check` ✅ → `status: approved`;独立 CLI 复验双通
  - 新增 `packages/pierfume-core/README.md`(安装/CLI/红线)
- [x] **demo GUI(2026-09-22,随 D5 提交)**:`demo/` 本地 Web 界面,零新依赖(node:http 后端 + 原生 HTML/CSS/JS)
  - `npm run demo` → http://127.0.0.1:3210(atelier 风格:象牙白/墨/琥珀金,衬线标题)
  - 两页:「Brief 生成配方」(后端走 pi CLI 同手动 demo 链路,服务端 CLI 独立复验不采信模型自述)+「配方校验」(纯本地秒回)
  - API 全测 + 浏览器交互实测(载入示例→校验→渲染成分条/合规报告);修 1 处 app.js 语法错(CAT_LABEL 键引号)
- [x] **配方工作台闭环(2026-09-22)**:改版对比 + 项目禁限用清单 + 报告导出(缺口分析见提交信息)
  - `formula-diff`:`scripts/formula-diff-core.mjs` + CLI + 扩展命令 `/formula-diff` 与工具 `formula_diff`(挂在 formula-lint 扩展下);结构 diff(调整/新增/移除)+ 两版合规差异(复用 ifra-check-core,不重复限量逻辑)
  - 项目禁限用清单:cwd 下 `pierfume.project.json`(`{"bannedMaterials": [...]}`)→ formula-lint 项目规则,命中判违规(成本上限因缺原料价格数据未做,数据阻塞)
  - 报告导出:ifra-check CLI `--out <file>`、扩展 `/ifra-check <file> --out <md>`;GUI 一键下载
  - GUI 第三页「配方对比」+ 配方库(生成结果入库,各页可载入)+ 静态资源 no-store
  - `tests/formula-diff.e2e.mjs` 三层 9 断言;三套合计 59 断言全绿

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
npm run check-ifra [-- path/to/f.yaml]                    # IFRA 合规报告(Markdown;--json 出 JSON)
npm run diff-formula -- old.yaml new.yaml                 # 两版配方对比(结构 diff + 合规差异)
# 项目禁限用清单:cwd 下放 pierfume.project.json,如 {"bannedMaterials": ["lilial"]}

# 扩展/包最终要能 pi install;本地验证方式
cd pi && node packages/coding-agent/dist/bundle/cli.js --help

# 配方/扩展测试(三层:单元/CLI/pi E2E;E2E 需 DEEPSEEK_API_KEY)
npm test                                                  # formula-lint + ifra-check 全量(50 断言)
npm run test:formula-lint
npm run test:ifra-check
PIERFUME_SKIP_PI_E2E=1 npm run test:formula-lint     # 只跑离线两层

# demo GUI(零新依赖;另开终端)
npm run demo                                          # → http://127.0.0.1:3210

# pi CLI 加载真实扩展(print 模式 E2E;务必 < /dev/null 且重定向到文件)
# 注意:Git Bash 必须 MSYS_NO_PATHCONV=1,否则 /formula-lint 被转成 D:/ruanjian/Git/...;
# -nt 禁止模型动工具(防其借 bash 工具"代跑"并改文件);扩展输出走 stderr
cd packages/pierfume-core
MSYS_NO_PATHCONV=1 node ../../pi/packages/coding-agent/dist/bundle/cli.js --offline -nt \
  -e extensions/formula-lint "/formula-lint examples/formula.example.yaml" \
  < /dev/null > /tmp/out.log 2>&1; echo $?

# pi package 安装(D5 已验证,机制见 §7.4)
pi install ./packages/pierfume-core -l     # 项目级(仅仓库根 cwd 加载,运行需 -a;.pi/ 已 gitignore)
pi install "D:\...\packages\pierfume-core" # 用户级(任意 cwd 可用,建议绝对路径;已装入本机)
pi list -a                                 # 查看项目级包(不加 -a 只列用户级)
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

### 7.3 卡点已解除(2026-09-22):网络通,扩展 E2E 全绿;三条实测备忘
- **结论**:2026-09-21 的 `Request timed out.` 是环境网络问题,已消失:`curl https://api.deepseek.com/` → HTTP 401(0.23s,未授权属正常响应);`DEEPSEEK_API_KEY` 与 `~/.pi/agent/models.json` 均生效
- **E2E 实测**:`/formula-lint` 在 pi CLI print 模式真实分发,3 好 5 坏全部符合预期(`npm run test:formula-lint`,24 断言全绿,提交 7c2c62e)
- **备忘 1(Git Bash 路径转换)**:直接传 `"/formula-lint ..."` 会被 MSYS 转成 `D:/ruanjian/Git/formula-lint ...`(以为是无盘符 POSIX 路径),命令静默不分发、模型拿错路径"自由发挥"(甚至借工具代跑、改文件)。对策:`MSYS_NO_PATHCONV=1`,或像测试脚本那样用 node `spawnSync` 传参(不经 MSYS)
- **备忘 2(print 模式流语义)**:扩展 `console.log` 走 **stderr**(stdout 留给模型最终答复);进程退出码只反映模型调用成功与否,**不反映校验结果** → E2E 必须断言输出标记(✅/❌ + 错误签名)
- **备忘 3(防模型代跑)**:E2E 加 `-nt`(禁全部工具),模型无法借 bash/edit 干预,输出只剩扩展的确定性行;不加 `-nt` 时模型可能自行"完成"任务,造成验证假象(2026-09-22 实测踩过:模型自行改写 validate-formula.mjs, luckily 结果符合 D2 设计,经回归后保留)

### 7.4 pi install 机制实测备忘(D5,2026-09-22)
- 两种 scope:`pi install <src> -l` → 项目级 `<cwd>/.pi/settings.json`;不加 `-l` → 用户级 `~/.pi/agent/settings.json`。local 源**不拷贝**,settings 只记源路径、运行时原地加载(相对路径以 settings 所在目录为基)
- **项目级只在该 cwd 恰好是含 `.pi/` 的目录时加载**(settings-manager 只查 `<cwd>/.pi/`,不向上走),且每次运行需 `-a` 信任项目文件;`pi list` 也要 `-a` 才列出项目级包
- **用户级任意 cwd 可用**;local 源建议给绝对路径(相对路径会按 `~/.pi/agent` 解析,易错)
- 包发现:`pi.extensions` 指向目录时,按子目录 package.json 的 `pi.extensions`/index.ts 递归发现(with-deps 扩展各自带 node_modules,原地加载可用)
- 卸载:`pi uninstall <source> [-l]`;当前用户级与项目级均已装 pierfume-core

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
2. [x] ~~**formula-lint 扩展**~~(D2,提交 7c2c62e;网络验证 + 三层测试 24 断言全绿,见 §7.3)
3. [x] ~~**ifra-check 扩展(D3)**~~(提交 4857dff;合规断言 2026-09-22 经人工确认,红线 5)
4. [x] ~~打包验证 `pi install` + 端到端 demo~~(D5,2026-09-22;双 scope 安装验证 + 真实 brief demo 通过,见 §3/§7.4)
5. [x] ~~git init~~(首个提交 aa88e64)
6. 测试断言需基于人工核对后的数据,编写时向用户确认
