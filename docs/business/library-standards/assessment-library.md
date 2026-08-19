# 量表库规范

量表库回答“评估什么、怎么采集”。每个模块至少维护一个可发布量表版本。业务侧统一填写 `business-libraries/templates/三库填写模板_v4.xlsx`，系统导入时转换为发布数据，运行时发布到 `module_resource_libraries.library_type = assessment`。

## 必填字段

| 字段 | 说明 |
| --- | --- |
| `module` | 五模块之一：`self_growth`、`class_system`、`home_school`、`student_case`、`learning_problem` |
| `code` / `instrumentCode` | 量表编码，模块内唯一 |
| `version` | 业务版本号 |
| `title` | 量表名称 |
| `estimatedMinutes` | 预计完成时间 |
| `questions[]` | 题项列表 |
| `questions[].id` | 题项编码，量表内唯一 |
| `questions[].text` | 题干 |
| `questions[].dimension` | 维度编码；若业务填写维度名称，导入器会按 ④c 映射为编码 |
| `questions[].options[]` | 选项与分值 |
| `questions[].reverse` | 是否反向计分，默认 `false` |

## 业务侧需补齐

- 维度定义：④c 里维护维度编码、名称、所属题号和计算方式。
- 红线题项：题项编码、触发选项、触发后的阻断或转介动作，具体规则在归因库 ⑥ 维护。
- 适用对象：教师自评、班级、学生、家长沟通或学习问题。
- 版本变更说明：新增题项、删除题项、阈值变化需可追溯。

## 多量表编排（一个模块多张量表）

一个模块可编排多张量表（入口筛查 → 深度诊断 → 专项情境），编排元数据随发布版本 `instruments` 下发。除必填字段外，每张量表可填：

| 字段 | 语义 |
| --- | --- |
| `instrumentRole` | 量表角色：`screening` 入口筛查 / `deep_dive` 深度诊断 / `situational` 专项情境 / `red_line` 红线检查。模板填「入口筛查」「深度诊断」等中文别名；红线检查量表在教师端默认隐藏，仅高危阈值命中时可见 |
| `isRequired` | 必做标记 |
| `prerequisiteCodes` | 前置量表编码；前置未完成时本量表锁定（locked） |
| `exclusiveCodes` | 互斥量表编码；互斥量表已完成时本量表锁定（locked） |
| `triggerCondition` | 触发条件（如 `量表[SG_S1].总分 >= 15`），引用此前量表的结果；未满足时标「当前不需要做」（not_needed，仍可手动做），满足时标「建议做」（suggested） |
| `triggerConditionNote` | 触发条件说明，教师端展示 |

导入校验强制要求非入口量表填写触发条件（否则要么人人做一遍、要么永远没人做），并对前置/触发条件引用的量表编码做交叉校验。运行时的状态判定（available/suggested/not_needed/locked/completed）、推荐与「提交延后、全部量表做完后统一出方案」的连续流程见 [AI 分诊与三库资源说明](../../AI_ASSISTANT_AND_KNOWLEDGE.md)；各模块业务上的量表递进与互补见 [跨模块依赖矩阵](../cross-module-dependencies.md)。
