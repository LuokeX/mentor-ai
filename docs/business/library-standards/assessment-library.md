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
