# 工具库规范

工具库回答“用什么方法处理”。工具库只提供可执行工具，方案由归因结果和工具匹配结果组合生成，不另建方案库。业务侧统一填写 `business-libraries/templates/三库填写模板_v3.xlsx`，系统导入时转换为发布数据。

## 必填字段

| 字段 | 说明 |
| --- | --- |
| `code` | 工具编码，模块内唯一 |
| `name` | 工具名称 |
| `form` | 工具形式，如话术卡、记录表、流程卡、课堂动作 |
| `relatedModule` | 适用模块 |
| `attributionCode` / `attributionCodes` | 引用归因库 ⑤c 的归因编码 |
| `severity` | 严重度，必须使用 `low/medium/high/crisis` |
| `dimensions` | 作用维度编码，来自量表库 ④c |
| `tags` / `toolTags` | 场景标签 |
| `steps` | 执行步骤 |
| `duration` / `timePerSession` | 建议周期或单次时长 |
| `targetUsers` | 适用对象 |
| `expectedEffect` | 预期输出或效果 |
| `prohibitions` | 禁忌条件 |

## 业务侧需补齐

- 每个工具至少能映射到一个模块、一个归因或一组标签。
- 禁忌条件必须明确，尤其是高风险、心理转介、家校冲突场景；`block` 只有在条件可被当前评估结果确认时才会硬过滤。
- 建议复盘周期需给出默认值，供方案生成器安排 `nextReviewAt`。
- 工具输出物要可记录，例如沟通纪要、观察表、班级机制表、行动打卡。
