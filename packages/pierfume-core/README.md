# pierfume-core

Pierfume Agent 的核心 pi package:调香师副驾驶的配方工作台与工具链校验能力。
基于 [pi](https://github.com/earendil-works/pi) 二次开发,**不改 pi 内核**,能力以 extension / CLI 外挂。

## 能力一览

| 能力 | 形态 | 说明 |
|---|---|---|
| `formula-lint` | pi 扩展(命令 `/formula-lint` + 工具 `formula_lint`)+ CLI | 配方 YAML 校验:schema、原料引用、重复原料、总量归一 100±1% |
| `ifra-check` | pi 扩展(命令 `/ifra-check` + 工具 `ifra_check`)+ CLI | IFRA 合规核查:按 `product.category` 比对限量,输出 Markdown/JSON 报告(超标项、限量依据、建议调整) |
| 数据资产 | `data/` | 22 条原料(全部人工核对,CAS 经 PubChem 机器核验)+ 18 条 IFRA 规则(51st Amendment,逐条标注 STD 文档号/修订号) |

设计原则:**单一事实来源** —— 限量数值只存在 `data/ifra-rules.json`,原料经 `ifraEntryRef` 引用,任何代码不硬编码合规数值。

## 安装(pi package)

```bash
# 本地路径安装(开发期)
pi install /path/to/Pierfume_Agent/packages/pierfume-core        # 用户级,任意 cwd 可用
pi install ./packages/pierfume-core -l                           # 项目级(仅该目录 cwd,需 pi -a 信任)

# 分发形态(目标,未验证)
pi install git:github.com/<org>/pierfume-core
pi install npm:@pierfume/core
```

安装后 pi 会话内可用:

```
/formula-lint <file...>     # 校验配方
/ifra-check <file...>       # IFRA 合规报告(Markdown)
```

Agent 侧:创建/修改配方 YAML 后,工具 `formula_lint`、`ifra_check` 必须依次通过,
才允许把 `meta.status` 标记为 `approved`(工具描述与 promptSnippet 强制)。

## 脱离 pi 的 CLI(开发/CI)

```bash
npm install                                # 装 yaml(devDependency)
npm run validate-data                      # 数据/schema 校验(改数据后必跑)
npm run validate-formula -- <file>         # formula-lint CLI(默认示例)
npm run check-ifra -- <file>               # ifra-check CLI(Markdown;--json 出 JSON)
npm test                                   # 双套件三层测试共 50 断言
```

## 配方 YAML 速览

```yaml
meta:
  id: fm-demo                 # ^fm-[a-z0-9-]+$
  name: 示例
  version: "0.1.0"
  status: draft               # draft/reviewed/approved/archived
product:
  category: "4"               # IFRA 类别,字符串必须加引号
  fragranceUseLevelPct: 15    # 香精添加量 %(缺省 100);IFRA 限量作用于成品
formula:
  - materialRef: geraniol     # 必须是 data/materials.sample.json 里的 id
    pct: 12                   # 浓缩物中的 %,合计 ≈100
```

## 目录结构

```
extensions/formula-lint/   # with-deps pi 扩展(自带 package.json + node_modules)
extensions/ifra-check/     # 同上
scripts/                   # 共享核心(*-core.mjs)+ 薄 CLI(扩展与 CLI 同一实现)
schemas/  data/  examples/  tests/
```

## 红线(开发须知)

- IFRA 限量、CAS 等事实数据**禁止凭模型记忆生成**,只能来自 `data/` 文件;
- 新增数据走 PubChem 机器核验 + 人工确认(`provenance.humanVerified`);
- `humanVerified=false` 的原料不得用于测试断言;合规断言需人工确认后合入;
- 商用前必须购买正版 IFRA Standard 逐条核对规则表。

详见仓库根 `AGENTS.md` 与 `docs/Pierfume-Agent-项目初始文档.md`。
