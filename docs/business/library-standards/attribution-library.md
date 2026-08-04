# 归因库规范

归因库回答“为什么是这个问题、属于什么等级”。业务侧按 Excel 表格整理，系统导入时转换为规则引擎需要的 JSON；业务不需要直接维护 JSON。

统一模板见 `business-libraries/templates/三库填写模板_v4.xlsx`。如果需要按模块拆分导入，可把归因相关 Sheet 拆到 `business-libraries/[module]/attribution.xlsx`，运行时发布到 `module_resource_libraries.library_type = attribution`。

## 归因变量表

用于定义从量表答案/分值计算出的中间变量。

| 字段 | 说明 | 示例 |
| --- | --- | --- |
| `module` | 五模块之一 | `home_school` |
| `version` | 规则版本 | `1.0.0` |
| `variableName` | 变量编码，供规则条件引用 | `conflict` |
| `expression` | 计算表达式 | `MAX(scores)` |
| `description` | 变量含义 | `冲突强度最高分` |
| `sourceDimensions` | 来源维度或题项 | `conflict` |
| `notes` | 备注 | `业务说明` |

当前可执行表达式包括：`SUM(scores)`、`MAX(scores)`、`MIN(scores)`、`SCORE(q1)`、`RAW(q1)`。

## 归因项表

⑤c 维护模块级归因词表。⑤d 证据规则和 ⑦ 工具库只能引用这里的归因编码。

| 字段 | 说明 | 示例 |
| --- | --- | --- |
| `code` | 归因编码，模块内唯一 | `HS_AT_CONFLICT` |
| `name` | 归因名称 | `家校沟通冲突升级` |
| `baseWeight` | 权重基数 | `1.2` |
| `toolTags` | 传给工具匹配的标签 | `home_school;conflict` |

## 证据规则表

⑤d 负责把量表分数转成多归因得分。一次评估可命中多条证据，系统按权重累加并归一化为主归因/次归因。

| 字段 | 说明 | 示例 |
| --- | --- | --- |
| `evidenceCode` | 证据编码 | `HS_EV_01` |
| `attributionCode` | 引用 ⑤c 的归因编码 | `HS_AT_CONFLICT` |
| `assessmentCode` | 依据量表编码 | `HS_QUICK` |
| `condition` | 触发条件 | `维度[HS_ATTITUDE] >= 4` |
| `weight` | 证据权重 | `2.5` |
| `description` | 给教师看的证据说明 | `沟通态度维度处于高位` |

## 分级规则表

⑤e 产出等级与严重度，并可**可选配置等级干预**（干预工具/干预动作）——归因通道与等级通道并行：任一命中即产出干预，两者都命中则合并去重。按 `priority` 升序匹配，第一条命中即输出。每个模块最后必须有一条兜底规则，`when` 可留空，且优先级必须是全表最大值。

| 字段 | 说明 | 示例 |
| --- | --- | --- |
| `module` | 五模块之一 | `home_school` |
| `version` | 规则版本 | `1.0.0` |
| `priority` | 优先级，数字越小越先匹配 | `10` |
| `when` | 条件表达式，兜底规则可留空 | `conflict >= 4` |
| `level` | 等级输出 | `high` |
| `blocked` | 是否阻断常规方案，填 `是/否` | `否` |
| `ruleId` | 规则编码，模块内唯一 | `home-school-conflict-high` |
| `levelName` | 等级中文名 | `D 级高冲突` |
| `severity` | 严重度，必须使用 `low/medium/high/crisis` | `high` |
| `resultDescription` | 分级结果说明 | `沟通风险较高` |
| `escalationCondition` | 升级条件；设置复评时应同步填写 | `连续两次 D 级` |
| `interventionTools` | 干预工具：命中该等级直接进方案的工具编码，多个用 `;` 分隔；须存在于本模块工具库（导入时交叉校验） | `HS_TL_01;HS_TL_03` |
| `interventionActions` | 干预动作：命中该等级直接进方案的动作文案，多个用 `；` 分隔 | `由年级组长陪同完成一次家校沟通` |
| `notes` | 备注 | `优先处理高冲突` |

等级干预与归因干预的关系：**并行且叠加**——归因命中产出归因建议动作与归因加权匹配工具，等级命中产出等级干预动作与等级直选工具，两者同时命中时合并去重；红线/熔断（`blocked = 是`）仍优先于一切常规干预，熔断时不生成方案。

条件表达式支持：变量引用、数字比较、字符串比较、`&&`、`||`、括号，例如 `conflict >= 4 && support <= 2`。

> v4 模板（`三库填写模板_v4.xlsx`）本次新增 ⑤e 的「干预工具」「干预动作」两列（可选，旧文件无这两列也能正常导入）。

## 业务侧需补齐

- 等级定义：每个模块等级集合、含义和升级边界。
- 兜底规则：所有归因库必须有最后兜底规则，优先级最大。
- 优先级：红线、极端等级、人工协同规则必须优先于普通分支。
- 工具标签：与工具库的 `tags` / `toolTags` 保持同一套字典。
- 人工协同/转介条件：高等级、危机或超出教师处置边界时必须明确。
