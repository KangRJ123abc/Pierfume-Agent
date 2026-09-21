# Pierfume Agent — 项目初始文档

> 本文档是 Pierfume Agent 项目的**第一上下文来源**，供所有参与开发的人员和 AI 编码助手阅读。
> AI 助手在接手本项目任何任务前，应先完整阅读本文档，理解项目目标、边界、技术栈与计划，再开始工作。

- 文档版本：v0.1
- 创建日期：2026-09-17
- 状态：立项 / 开发前

---

## 1. 项目概述

**Pierfume Agent** 是一个面向香料香精（Flavor & Fragrance）轻工业领域的 AI Agent，基于开源项目 **Pi（Pi Coding Agent）** 二次开发。

命名含义：**Pi**erfume = **Pi**（底座项目）+ p**erfume**（香料香精领域）。

产品定位：**调香师的副驾驶**——Agent 负责检索、校验、穷举、文档化等确定性强的环节，创意决策始终留给调香师。不追求"自动调香"。

### 1.1 要解决的核心问题

1. 配方（formula）管理依赖个人经验，缺乏结构化、可检索、可版本化的载体；
2. IFRA 等国际法规合规核查靠人工逐条比对，耗时且易错；
3. 客户 brief（模糊感官描述）到候选配方的转化周期长；
4. 资深调香师的经验难以沉淀和传承。

---

## 2. 底座项目（Base Project）

| 项目 | 信息 |
|---|---|
| 名称 | Pi（Pi Coding Agent） |
| 当前 GitHub | https://github.com/earendil-works/pi （**以此为准**） |
| 历史仓库 | https://github.com/badlogic/pi-mono （已迁移，2026-05 起弃用） |
| npm 包（当前） | `@earendil-works/pi-coding-agent` |
| npm 包（已废弃） | `@mariozechner/pi-coding-agent`（勿再使用） |
| 核心包目录 | `packages/coding-agent` |
| 许可证 | MIT |
| 语言 | TypeScript |
| 官网 | https://pi.dev |

> ⚠️ 注意：网上大量旧资料仍引用 `badlogic/pi-mono` 和 `@mariozechner/*` 命名。开发时所有 import、依赖、文档一律使用 `@earendil-works/*` 新命名。

### 2.1 Pi 的架构哲学（二开必须遵守）

- Pi 是**极简 agent harness**：内核只有 `read` / `write` / `edit` / `bash` 等少量内置工具，系统提示极短；
- 所有行业能力通过四种机制外挂，**不修改内核**：
  - **Extensions**：TypeScript 模块，可注册工具、命令、事件钩子；
  - **Skills**：按需加载的能力包（`SKILL.md` 格式）；
  - **Prompt Templates**：可复用提示模板；
  - **Pi Packages**：把 extensions + skills + prompts + themes 打包，通过 `pi install npm:xxx` 或 `pi install git:xxx` 分发；
- 项目级上下文通过 `AGENTS.md` 注入。

### 2.2 安全注意事项

Pi 的扩展机制以完整系统权限运行（`.pi/extensions/` 下的代码启动时自动执行，无沙箱），曾因此出现 CVE-2026-5556。**任何第三方 pi package 安装前必须人工审查源码**；本项目自研扩展也要遵循最小权限原则。

---

## 3. 项目目标

### 3.1 长期愿景（Roadmap 全景）

| 模块 | 说明 | 阶段 |
|---|---|---|
| 配方工作台 | YAML 结构化配方文件，新建/改版/diff/校验 | **MVP** |
| `formula-lint` | 总量归一、剂量边界、未知原料校验 | **MVP** |
| `ifra-check` | IFRA 限量核查（按 Category 1–12），输出合规报告 | **MVP** |
| 项目模板 | 客户级 AGENTS.md 模板（禁限用清单、成本上限） | **MVP** |
| 感官语言翻译器 | brief ↔ 香型/原料建议 ↔ 香气描述文案 | 二期 |
| 成本与替代 | 实时成本核算、同香型低价/断供替代推荐 | 二期 |
| 原料知识库 | 企业原料库检索 + RAG（香气描述/理化性质/供应商/库存） | 二期 |
| GC-MS 助手 | 仪器数据解析、仿香分析辅助 | 三期 |
| 多市场法规 | EU / 中国 / 美国法规差异、过敏原标签生成 | 三期 |

### 3.2 MVP 验收标准（v0.1）

1. `pi install` 一键安装 `pierfume-core` 包；
2. 给定一个 brief，Agent 能生成结构化配方 YAML 并通过 `formula-lint`；
3. 对任意配方文件，`ifra-check` 能按指定产品类别输出正确的合规报告（超标项、限量依据、建议调整）；
4. 10 个测试配方（含故意超标样本）合规判定全部正确；
5. Agent 输出的所有配方**必须强制经过工具链校验**才能标记为"可用"，不允许仅依赖模型自觉。

---

## 4. 数据与规则资产

| 资产 | 内容 | 来源与可信度要求 |
|---|---|---|
| 原料测试数据集 | 50–100 条：名称 / CAS / 香型标签 / IFRA 限量 / 理化性质 | MVP 阶段可基于公开资料整理，**每条需人工核对** |
| IFRA 规则表 | 80–100 条核心受限条目，按 Category 分组，结构化 JSON | 开发期用公开修订摘要；**商用前必须购买正版 IFRA Standard 并逐条核对** |
| 测试 brief 集 | 15–20 个真实风格客户 brief | 用于第二周的输出质量评估 |

---

## 5. 开发与测试计划（两周，AI 辅助）

前提：AI 辅助编码，单人或小团队；范围已冻结（仅 §3.2 的 MVP 内容）。

### 第 0 天（半天）：范围冻结与环境

- [ ] 冻结 MVP 范围，明确不做项（GC-MS、成本、RAG 仅留接口占位）
- [ ] fork / clone `earendil-works/pi`，跑通开发环境
- [ ] 准备原料测试数据子集

### 第一周：核心开发（D1–D5）

| 天 | 任务 | 里程碑 |
|---|---|---|
| D1–D2 | 配方 YAML Schema + JSON Schema 校验 + `formula-lint`（AI 生成代码与单测，人工评审） | 3 个手工配方通过 lint；错误配方被正确拦截 |
| D3–D4 | IFRA 规则表整理 + `ifra-check` 扩展 + 合规报告模板（Markdown + JSON 双输出） | 10 个测试配方（含超标样本）全部判对 |
| D5 | 打包为 Pi package，验证 `pi install`；写 README；用一个真实 brief 走端到端流程 | 完整 demo 可跑，记录卡点 |

### 第二周：测试与打磨（D6–D10）

| 天 | 任务 |
|---|---|
| D6–D7 | 系统测试：功能边界用例（空配方/非法 CAS/剂量溢出）；LLM 输出质量评估（**重点查幻觉**：编造 CAS 号、引用不存在的 IFRA 条目）；回归测试脚本化 |
| D8–D9 | 缺陷修复（优先级：合规误判 > 数据错误 > 体验）；提示词打磨（不确定时必须声明"需人工确认"）；大配方文件的上下文压力检查 |
| D10 | 内部演示（brief → 配方 → 合规报告）；冻结 v0.1；发布说明 + 已知问题清单 + 二期 backlog |

### 贯穿两周的测试原则

1. **合规逻辑零信任 AI**：限量规则表人工核对来源，测试断言人工编写，AI 只生成样板代码；
2. **每天可运行**：每日结束主分支必须能跑通 demo；
3. **真实数据早介入**：D1 起用真实原料数据；
4. **D8–D9 是机动缓冲**，不被新需求占用。

---

## 6. 主要风险与预案

| 风险 | 预案 |
|---|---|
| IFRA 完整标准为付费文档 | 开发期用公开资料；商用前购买正版并核对 |
| AI 幻觉进入配方 | 工具链兜底：`formula-lint` + `ifra-check` 强制校验，不靠提示词 |
| 范围蔓延（GC-MS/成本诱惑大） | 严格守 MVP 边界，新想法进二期 backlog |
| 底座迁移期文档混乱 | 一律以 `earendil-works/pi` 新仓库为准 |
| 配方保密性 | 配方是企业核心资产；评估本地模型（llama.cpp / Ollama）实现数据不出内网 |

---

## 7. 目标用户与典型场景

| 场景 | 用户 | Agent 职责 |
|---|---|---|
| 日常调香辅助 | 调香师 | 配方修改建议、多方案对比说明 |
| 客户 brief 响应 | 销售 / 应用工程师 | brief → 候选配方 + 提案文案 |
| 合规审查 | 法规专员 / QA | 产品线批量 IFRA 核查 |
| 知识沉淀 | 企业 | 经验 → Skills 与配方模板库 |

---

## 8. 仓库结构约定（建议）

```
pierfume-agent/
├── packages/
│   └── pierfume-core/        # 主 pi package（含 pi 清单的 package.json）
│       ├── extensions/
│       │   ├── ifra-check/   # IFRA 合规核查扩展
│       │   └── formula-lint/ # 配方校验扩展
│       ├── skills/           # 领域 Skills
│       ├── prompts/          # 提示模板
│       └── data/
│           ├── materials.sample.json   # 原料测试数据
│           └── ifra-rules.json         # IFRA 规则表
├── examples/                 # 示例配方 + 示例 AGENTS.md
├── tests/                    # 单元测试 + 回归测试 + brief 评估集
└── docs/                     # 本文档及后续设计文档
```

---

## 9. 给 AI 助手的工作规则

1. 开始任何任务前先读本文件；
2. 不修改 Pi 内核源码，一切能力以 extension / skill / prompt 形式实现；
3. 所有依赖与 import 使用 `@earendil-works/*` 命名空间；
4. 涉及 IFRA 限量、CAS 号等事实性数据，禁止凭模型记忆生成，必须来自 `data/` 下的规则文件；
5. 合规相关代码的测试断言由人工确认后方可合入；
6. 每天提交可运行的代码，不留"快好了"的中间状态。
