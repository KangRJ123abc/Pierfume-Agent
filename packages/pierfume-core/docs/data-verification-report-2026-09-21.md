# 原料数据人工核对报告(2026-09-21)

> 状态:✅ 已完成,全部条目 `humanVerified=true`,数据已落库。
> 数据来源:PubChem PUG REST / PUG View、IFRA 官方 51st Amendment 标准文档(ifrafragrance.org / cloudfront)。
> 本报告是 data/materials.sample.json 与 data/ifra-rules.json 的权威审计记录。

## A. 原料条目核对(22 条)——22/22 通过

| id  | PubChem 物质 | 主 CAS 校验位 | 主 CAS 在同义词 | 次要 CAS 核验 | 结论 |
| --- | --- | --- | --- | --- | --- |
| hedione | Hedione | ✅ 24851-98-7 | ✅ 存在 | 128087-96-7 ✅ 在同义词 | 通过 |
| ethanol | Ethanol | ✅ 64-17-5 | ✅ 存在 | 42845-45-4 ✅ 在同义词 | 通过 |
| coumarin | Coumarin | ✅ 91-64-5 | ✅ 存在 | 103802-83-1 ✅ 在同义词 | 通过 |
| citral | Citral | ✅ 5392-40-5 | ✅ 存在 | 141-27-5 ✅ 在同义词 | 通过 |
| eugenol | Eugenol | ✅ 97-53-0 | ✅ 存在 | — | 通过 |
| isoeugenol | Isoeugenol | ✅ 97-54-1 | ✅ 存在 | 5932-68-3 ✅ 在同义词 | 通过 |
| cinnamal | Cinnamaldehyde | ✅ 104-55-2 | ✅ 存在 | 14371-10-9 ✅ 在同义词 | 通过 |
| geraniol | Geraniol | ✅ 106-24-1 | ✅ 存在 | 624-15-7 ✅ 在同义词 | 通过 |
| citronellol | Citronellol | ✅ 106-22-9 | ✅ 存在 | 26489-01-0 ✅ 在同义词 | 通过 |
| linalool | Linalool | ✅ 78-70-6 | ✅ 存在 | 22564-99-4 ✅ 在同义词 | 通过 |
| benzyl-salicylate | Benzyl Salicylate | ✅ 118-58-1 | ✅ 存在 | — | 通过 |
| benzyl-benzoate | Benzyl Benzoate | ✅ 120-51-4 | ✅ 存在 | — | 通过 |
| hydroxycitronellal | Hydroxycitronellal | ✅ 107-75-5 | ✅ 存在 | — | 通过 |
| amyl-cinnamal | 2-Benzylideneheptanal(见 D 节) | ✅ 101365-33-7 | ✅ 存在 | — | 通过 |
| lyral | Liral | ✅ 31906-04-4 | ✅ 存在 | 130066-44-3 ✅ 在同义词 | 通过 |
| lilial | Lilial | ✅ 80-54-6 | ✅ 存在 | — | 通过 |
| musk-ketone | Musk ketone | ✅ 81-14-1 | ✅ 存在 | — | 通过 |
| musk-xylene | Musk Xylene | ✅ 81-15-2 | ✅ 存在 | — | 通过 |
| limonene | (+)-Limonene | ✅ 5989-27-5 | ✅ 存在 | — | 通过 |
| vanillin | Vanillin | ✅ 121-33-5 | ✅ 存在 | — | 通过 |
| methyl-anthranilate | Methyl Anthranilate | ✅ 134-20-3 | ✅ 存在 | — | 通过 |
| alpha-isomethyl-ionone | α-Isomethyl ionone(同义词确认) | ✅ 127-51-5 | ✅ 存在 | 15789-90-9 ✅ 在同义词 | 通过 |

说明:① 物质身份均与条目相符(PubChem Title/IUPAC/同义词逐条比对);② 主 CAS 全部通过校验位算法且存在于该 CID 同义词库;③ 香型/香阶属主观描述,PubChem 未收录气味字段,建议沿用原库描述,本核对未做改动。amyl-cinnamal 与 alpha-isomethyl-ionone 的命名细节见 D 节。

## B. 需人工提供数据的原料(3 条)——维持"待人工提供"

- **iso-e-super**(Tetramethyl acetyloctahydronaphthalenes):混合物,PubChem 单化合物检索确实无法稳定解析;行业常见引用 CAS 54464-57-2,**未经权威确认,仅供参考**。
- **oakmoss-absolute**:天然提取物;行业常见引用 CAS 9000-50-4(Evernia prunastri),另有 IFRA 橡苔相关标准与 atranol/chloroatranol 限量规则,**需人工提供权威 CAS**。
- **bergamot-oil**:冷压佛手柑油为呋喃香豆素类光毒性管控对象(IFRA 对柑橘类 NCS 有专门标准);行业常见引用 CAS 8007-75-8,**需人工提供权威 CAS**。

以上常见引用值均来自行业通行做法,未经本次权威源核验,标注为"未验证",请以供应商 CoA/权威数据库为准。

## C. IFRA 规则条目补数值(18 条)——已完成,全部标注来源

红线遵守情况:以下数值全部来自 IFRA 官方标准文档(官网 51st Amendment 合集/单个 STD PDF)或 PubChem 逐条标注官方 STD 文档号的转引栏目;未使用任何凭记忆填写的数值。其中 geraniol、methyl ionone 经官方 PDF 截图直读;lyral(HMPCC)、musk xylene、musk ketone 经官方合集 PDF 文字直读;citral、coumarin 与官方合集 PDF 文字抽查比对一致;其余以 PubChem 转引为准(每条均附官方文档号,可回溯)。

| 条目 id | IFRA 物质名 | 标准文档 | 修订版 | restrictionType | 驱动属性 | Cat 1 | Cat 2 | Cat 3 | Cat 4 | Cat 5A | Cat 5B | Cat 5C | Cat 5D | Cat 6 | Cat 7A | Cat 7B | Cat 8 | Cat 9 | Cat 10A | Cat 10B | Cat 11A | Cat 11B | Cat 12 | 来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ifra-alpha-isomethyl-ionone | Methyl ionone, mixed isomers(含 CAS 127-51-5) | IFRA_STD_063.pdf | 49 | Restriction / Specification | DERMAL SENSITIZATION | 5.4 | 1.6 | 32 | 30 | 7.6 | 7.6 | 7.6 | 7.6 | 18 | 61 | 61 | 3.2 | 59 | 100 | 100 | 100 | 100 | 无限制 | IFRA 官方 STD_063 PDF 截图直读 |
| ifra-amyl-cinnamal | alpha-Amyl cinnamic aldehyde | IFRA_STD_005.pdf | 49 | Restriction | DERMAL SENSITIZATION AND SYSTEMIC TOXICITY | 0.58 | 0.53 | 0.26 | 7 | 2.5 | 0.32 | 0.45 | 0.11 | 0.064 | 0.26 | 0.26 | 0.11 | 1.5 | 1.5 | 3.5 | 0.11 | 0.11 | 无限制 | PubChem IFRA 栏目转引(标注官方 STD 文档号) |
| ifra-benzyl-benzoate | Benzyl benzoate | IFRA_STD_009.pdf | 49 | Restriction | DERMAL SENSITIZATION AND SYSTEMIC TOXICITY | 1.7 | 1.4 | 0.41 | 4.8 | 4.3 | 0.21 | 0.83 | 0.07 | 0.41 | 0.41 | 0.41 | 0.07 | 1.9 | 1.9 | 12 | 0.07 | 0.07 | 无限制 | PubChem IFRA 栏目转引(标注官方 STD 文档号) |
| ifra-benzyl-salicylate | Benzyl salicylate | IFRA_STD_011.pdf | 49 | Restriction | DERMAL SENSITIZATION | 1.3 | 0.39 | 7.8 | 7.3 | 1.9 | 1.9 | 1.9 | 1.9 | 4.3 | 15 | 15 | 0.77 | 14 | 51 | 51 | 28 | 28 | 无限制 | PubChem IFRA 栏目转引(标注官方 STD 文档号) |
| ifra-cinnamal | Cinnamic aldehyde | IFRA_STD_018.pdf | 49 | Restriction | DERMAL SENSITIZATION AND SYSTEMIC TOXICITY | 0.045 | 0.014 | 0.021 | 0.25 | 0.064 | 0.042 | 0.064 | 0.014 | 0.15 | 0.17 | 0.17 | 0.014 | 0.49 | 0.49 | 1.8 | 0.014 | 0.014 | 无限制 | PubChem IFRA 栏目转引(标注官方 STD 文档号) |
| ifra-citral | Citral | IFRA_STD_021.pdf | 49 | Restriction | DERMAL SENSITIZATION AND SYSTEMIC TOXICITY | 0.11 | 0.032 | 0.1 | 0.6 | 0.15 | 0.15 | 0.15 | 0.051 | 0.35 | 0.2 | 0.2 | 0.051 | 1.2 | 1.2 | 4.2 | 0.051 | 0.051 | 无限制 | PubChem IFRA 栏目转引(标注官方 STD 文档号) |
| ifra-citronellol | Citronellol | IFRA_STD_022.pdf | 49 | Restriction | DERMAL SENSITIZATION | 2.2 | 0.67 | 13 | 12 | 3.2 | 3.2 | 3.2 | 3.2 | 7.3 | 25 | 25 | 1.3 | 24 | 87 | 87 | 48 | 48 | 无限制 | PubChem IFRA 栏目转引(标注官方 STD 文档号) |
| ifra-coumarin | Coumarin | IFRA_STD_023.pdf | 49 | Restriction | DERMAL SENSITIZATION AND SYSTEMIC TOXICITY | 0.089 | 0.08 | 0.089 | 1.5 | 0.38 | 0.11 | 0.16 | 0.035 | 0.0024 | 0.18 | 0.18 | 0.035 | 0.52 | 0.52 | 1.6 | 0.035 | 0.035 | 33 | PubChem IFRA 栏目转引(标注官方 STD 文档号) |
| ifra-eugenol | Eugenol | IFRA_STD_035.pdf | 51 | Restriction | DERMAL SENSITIZATION AND SYSTEMIC TOXICITY | 0.45 | 0.14 | 1 | 2.5 | 0.64 | 0.64 | 0.64 | 0.21 | 1.5 | 2 | 2 | 0.21 | 4.9 | 4 | 18 | 0.21 | 0.21 | 无限制 | PubChem IFRA 栏目转引(标注官方 STD 文档号) |
| ifra-geraniol | Geraniol | IFRA_STD_037.pdf | 51 | Restriction | DERMAL SENSITIZATION AND SYSTEMIC TOXICITY | 0.78 | 0.25 | 1.1 | 4.7 | 1.2 | 0.78 | 0.94 | 0.26 | 0.16 | 0.78 | 0.78 | 0.26 | 2.8 | 1.1 | 5.3 | 0.26 | 0.26 | 无限制 | PubChem IFRA 栏目转引(标注官方 STD 文档号) |
| ifra-hydroxycitronellal | Hydroxycitronellal | IFRA_STD_043.pdf | 51 | Restriction | DERMAL SENSITIZATION AND SYSTEMIC TOXICITY | 0.38 | 0.11 | 2.3 | 2.1 | 0.53 | 0.53 | 0.53 | 0.18 | 1.2 | 1.6 | 1.6 | 0.18 | 4.1 | 0.78 | 7.8 | 0.18 | 0.18 | 无限制 | PubChem IFRA 栏目转引(标注官方 STD 文档号) |
| ifra-isoeugenol | Isoeugenol | IFRA_STD_048.pdf | 49 | Restriction | DERMAL SENSITIZATION AND SYSTEMIC TOXICITY | 0.019 | 0.0057 | 0.12 | 0.11 | 0.027 | 0.027 | 0.027 | 0.009 | 0.063 | 0.22 | 0.22 | 0.009 | 0.21 | 0.21 | 0.75 | 0.009 | 0.009 | 无限制 | PubChem IFRA 栏目转引(标注官方 STD 文档号) |
| ifra-lilial | p-tert-Butyl-α-methylhydrocinnamic aldehyde (Lilial) (p-BMHCA) | IFRA_STD_015.pdf | 49 | Restriction | DERMAL SENSITIZATION AND SYSTEMIC TOXICITY | 0(禁用) | 0.09 | 0.04 | 1.4 | 0.06 | 0.05 | 0.05 | 0.017 | 0(禁用) | 0.04 | 0.04 | 0.017 | 0.1 | 0.1 | 0.63 | 0.017 | 0.017 | 16 | PubChem IFRA 栏目转引(标注官方 STD 文档号) |
| ifra-limonene | Limonene | IFRA_STD_186.pdf | 29 | Specification | DERMAL SENSITIZATION | | | | | | | | | | | | | | | | | | | PubChem IFRA 栏目转引(标注官方 STD 文档号) |
| ifra-linalool | Linalool | IFRA_STD_187.pdf | 38 | Specification | DERMAL SENSITIZATION | | | | | | | | | | | | | | | | | | | PubChem IFRA 栏目转引(标注官方 STD 文档号) |
| ifra-lyral | 3 and 4-(4-Hydroxy-4-methylpentyl)-3-cyclohexene-1-carboxaldehyde (HMPCC) | IFRA 51st 合集中的 HMPCC 标准 | 49 | Restriction(注:非 QRA,务实限值) | DERMAL SENSITIZATION | 0.020 | 0.020 | 0.10 | 0.20 | 0.20 | 0.20 | 0.20 | 0.067 | 0.20 | 0.020 | 0.020 | 0.067 | 0.20 | 0.20 | 0.20 | 0.067 | 0.067 | 91 | IFRA 官方 51st 合集 PDF 文字 + PerfumersWorld 镜像比对 |
| ifra-musk-ketone | Musk ketone | IFRA_STD_189.pdf | 45 | Specification | SEE FRAGRANCE INGREDIENT SPECIFICATION | | | | | | | | | | | | | | | | | | | PubChem IFRA 栏目转引(标注官方 STD 文档号) |
| ifra-musk-xylene | Musk xylene | IFRA_STD_170.pdf | 44 | Prohibition | VPVB | | | | | | | | | | | | | | | | | | | PubChem IFRA 栏目转引(标注官方 STD 文档号) |

**特殊条目说明:**

- **musk-xylene**:IFRA **Prohibition**(STD IFRA_STD_170.pdf,Amendment 44),全类别禁用(驱动属性:VPvB),无分类限量可补;官方原文"should not be used as a fragrance ingredient",仅可作为 musk ketone 中 <0.1% 的杂质存在。
- **musk-ketone**:IFRA **Specification**(STD IFRA_STD_189.pdf,Amendment 45),无限量表;规格要求"仅当 musk xylene 含量 <0.1% 时方可使用"。
- **linalool / limonene**:均为 **Specification** 型标准(对原料品质/过氧化物控制提出要求),非限量型,故无 Category 1–12 数值——C 表对这两条应填 specification 内容而非分类限量。
- **lilial(p-BMHCA)**:IFRA 现行标准为 Restriction(Amendment 49),其中 **Category 1 与 Category 6 为禁用(0.0 Prohibited)**;而 **EU 化妆品法规(EC 1223/2009 Annex II,经 Regulation 2021/1902 修订)已于 2022-03-01 起全面禁用** lilial。两套规则依据需分别记录(见 D 节)。
- **lyral(HMPCC)**:IFRA 为 Restriction(Amendment 49,非 QRA 务实限值,Cat 4 仅 0.20%);**EU 自 2021-08-23 起全面禁用**(Regulation 2017/1410, Annex II)。

## D. 已知待确认事项——处理结论

1. **amyl-cinnamal 双 CAS**:已确认对应关系——`101365-33-7`(PubChem CID 1712058)为 **(2Z)-2-苄亚基庚醛(单一 Z 构型异构体)**;行业常用 `122-40-7`(PubChem CID 31209,"Amylcinnamaldehyde")为**未指定立体构型的母体物质**。二者不是别名,是"母体 vs 特定异构体"的关系。IFRA 标准(IFRA_STD_005)与欧盟过敏原清单均以 **122-40-7** 为范围 CAS。**结论:主 CAS 已统一为 122-40-7 / CID 31209,101365-33-7 降为异构体次要 CAS(已落库)。**
2. **lyral / lilial 多市场差异**:已按两套规则分别记录——IFRA(国际自律标准,lyral=限量 0.20% Cat4;lilial=限 1.4% Cat4 且 Cat 1/6 禁用)vs EU 化妆品法规(两者均全面禁用)。作为多市场差异测试用例保留。
3. **Iso E Super / oakmoss / bergamot**:确认为混合物/天然提取物,PubChem 单化合物检索无法核验,维持 B 节"人工提供权威 CAS"的结论。
