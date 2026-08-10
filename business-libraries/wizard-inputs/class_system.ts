import type { WizardInput } from '../../shared/business-wizard'

// class_system 模块向导输入（v4.2.0：三库完整提炼）
// 来源文档：docs/2026_07_27_家校沟通与合作-工具库、评估库、专业知识库0722/班级系统建设 工具、评估、术语库/
//   1. 班级系统建设_评估库（量表）_v2.xlsx —— A01-A09 共 10 张量表 sheet（A02 拆教师版/学生版）
//   2. 班级系统建设_五系统逐级关联知识图谱.xlsx —— 15 个归因因子 + 诊断归因库 + 三级干预匹配
//   3. 班级系统建设小学版_工具库（每个模块的解决处理）.xlsx —— T01-T31 共 31 个工具
//   4. 班级系统建设小学版_专业知识库（术语解读）.xlsx —— K01-K30 共 30 个术语
// 计分方向：自评量表正向计分（1-5，非常符合=5），高分=健康、低分=问题；
//   A02 含 4 道反向题（题2/7/21/23）按 6−原始分 转换；A03-A09 为观测/勾选/点检式清单。
// 预警口径：A05 心理风险 A-E 五级，A/B 级 24-48h 上报学校，不得由班主任独自处理。
export const CLASS_SYSTEM_WIZARD_INPUT: WizardInput = {
  "module": "class_system",
  "version": "4.5.0",
  "sourceRef": "班级系统建设 2.0 三库文档（2026-07-27 版）",
  "defaults": {
    "schoolSection": "primary",
    "targetAudience": "teacher",
    "formType": "self_report",
    "triggerMethod": "manual",
    "frequency": "per_case",
    "resultVisibility": "teacher_only",
    "responsibleRole": "班主任",
    "dataSensitivity": "sensitive",
    "sourceType": "proprietary",
    "evidenceLevel": "B",
    "redLineScope": "module",
    "redLineActions": "停止常规建议输出；A/B级24-48小时内上报学校并通知心理专员；A级同步公安/医疗转介；记录安全事件",
    "redLineRecovery": "学校心理专业评估确认风险解除后",
    "redLineOwner": "心理专员"
  },
  "computedVariables": [
    {
      "name": "系统均分",
      "scale": "五系统自评表",
      "expression": "均分"
    }
  ],
  "optionGroups": [
    {
      "id": "进班观测三分",
      "name": "进班观测三分",
      "options": [
        { "label": "需关注", "score": 1 },
        { "label": "一般", "score": 2 },
        { "label": "良好", "score": 3 }
      ]
    },
    {
      "id": "能量锚点1-3-5",
      "name": "能量锚点1-3-5",
      "options": [
        { "label": "1分·低能量", "score": 1 },
        { "label": "3分·中能量", "score": 3 },
        { "label": "5分·高能量", "score": 5 }
      ]
    },
    {
      "id": "依恋观察记录",
      "name": "依恋观察记录",
      "options": [
        { "label": "未观察到", "score": 1 },
        { "label": "有时出现", "score": 2 },
        { "label": "明显出现", "score": 3 }
      ]
    }
  ],
  "scales": [
    {
      "name": "五系统自评表",
      "role": "入口筛查",
      "shortName": "五系统自评",
      "description": "A01 五系统自评表（班主任自评·15题）：关系/组织/规范/目标/情感五个系统各3题，1-5分加总15-75分。四档解读：60-75健康 / 45-59关注(挑1-2弱项4周专项) / 30-44系统性问题(启动重建+分层干预) / <30立即介入(学校支援)。适用：每两周一次。",
      "minutes": 5,
      "frequency": "monthly",
      "usageTiming": "每两周一次；学期初/中/末必做",
      "normReference": "总分15-75：60-75健康 / 45-59关注 / 30-44系统性问题 / <30立即介入",
      "reAssessmentIntervalDays": 14,
      "prerequisites": [],
      "exclusives": [],
      "triggerConditions": [],
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "关系系统",
          "calcMethod": "mean",
          "weight": 1,
          "description": "同伴互助、氛围温暖、弱势学生不被孤立",
          "highInterpretation": "关系稳定，学生被听见、同伴互助充分",
          "lowInterpretation": "冲突难以修复，存在被孤立或欺负的学生"
        },
        {
          "name": "组织系统",
          "calcMethod": "mean",
          "weight": 1,
          "description": "班委服务意识、参与渠道、无人被边缘化",
          "highInterpretation": "岗位职责清晰，事务分散自主运转",
          "lowInterpretation": "班委形同虚设，事务集中在教师身上"
        },
        {
          "name": "规范系统",
          "calcMethod": "mean",
          "weight": 1,
          "description": "规则认同、执行一致公平、规则有弹性",
          "highInterpretation": "规则被理解并一致执行，秩序可自主恢复",
          "lowInterpretation": "规则悬空、督导标准不一，混乱后难以恢复"
        },
        {
          "name": "目标系统",
          "calcMethod": "mean",
          "weight": 1,
          "description": "学习目标与动力、班级共同目标、目标凝聚力",
          "highInterpretation": "目标清晰并转化为可观察里程碑",
          "lowInterpretation": "目标缺位、空泛，努力无方向"
        },
        {
          "name": "情感系统",
          "calcMethod": "mean",
          "weight": 1,
          "description": "上学意愿、求助行为、集体荣誉感",
          "highInterpretation": "归属感强，学生愿意来学校、遇到问题会求助",
          "lowInterpretation": "氛围负向，个体情绪失接、集体无温度"
        }
      ],
      "questions": [
        {
          "text": "学生之间愿意互相帮助",
          "dimension": "关系系统",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "班级有温暖、友爱的氛围",
          "dimension": "关系系统",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "弱势学生不被孤立或欺负",
          "dimension": "关系系统",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "班委有真正的服务意识",
          "dimension": "组织系统",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "普通学生有参与班级事务的渠道",
          "dimension": "组织系统",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "没有学生被“边缘化”",
          "dimension": "组织系统",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "学生认同班级规则",
          "dimension": "规范系统",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "规则执行一致、公平",
          "dimension": "规范系统",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "规则有弹性、能适应特殊情况",
          "dimension": "规范系统",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "学生有学习目标和动力",
          "dimension": "目标系统",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "班级有共同的进步目标",
          "dimension": "目标系统",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "班级目标能凝聚大家的力量",
          "dimension": "目标系统",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "学生愿意来学校",
          "dimension": "情感系统",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "学生遇到问题会求助",
          "dimension": "情感系统",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "班级有集体荣誉感",
          "dimension": "情感系统",
          "optionGroup": "AGREE_5",
          "reverse": false
        }
      ]
    },
    {
      "name": "班级能量场问卷·教师版",
      "role": "深度诊断",
      "shortName": "能量场·教师版",
      "description": "A02-T 班级能量场问卷（教师版·25题）：教师评价班级能量场，五维情感/认知/行为/关系/环境，1-5 Likert 非常符合=5；反向题（题2/7/21/23）按 6−原始分 转换。环境维度信度不足，降为筛查层，不计入五维综合均值。",
      "minutes": 5,
      "frequency": "monthly",
      "usageTiming": "五系统自评整体偏弱或关系维度突出时施测",
      "reAssessmentIntervalDays": 30,
      "prerequisites": [
        "五系统自评表"
      ],
      "exclusives": [],
      "triggerConditions": [
        {
          "targetType": "average",
          "target": "",
          "comparator": "低于或等于",
          "value": 3.6,
          "join": "且"
        },
        {
          "targetType": "dimension",
          "target": "关系系统",
          "comparator": "低于或等于",
          "value": 3.5,
          "join": "或"
        }
      ],
      "triggerNote": "五系统自评均分≤3.6 或关系系统≤3.5 时，建议做能量场问卷（教师版）看具体维度表现",
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "情感",
          "calcMethod": "mean",
          "weight": 1,
          "description": "课堂氛围、师生情绪体验（情感维度）",
          "highInterpretation": "氛围积极，师生情绪体验良好",
          "lowInterpretation": "氛围压抑，教师压力大、被接纳感低"
        },
        {
          "name": "认知",
          "calcMethod": "mean",
          "weight": 1,
          "description": "集体荣誉感、规则建议、思考回答、学习信心（认知维度）",
          "highInterpretation": "班级认同高，思考与订正投入",
          "lowInterpretation": "认同感低，学习投入依赖外部推动"
        },
        {
          "name": "行为",
          "calcMethod": "mean",
          "weight": 1,
          "description": "举手提问、指令响应、任务参与、秩序维护（行为维度）",
          "highInterpretation": "行为规范自主，参与度高",
          "lowInterpretation": "需反复提醒，秩序依赖教师在场"
        },
        {
          "name": "关系",
          "calcMethod": "mean",
          "weight": 1,
          "description": "同学相处、互助、师生交流（关系维度）",
          "highInterpretation": "同伴联结紧密，愿意与教师交流",
          "lowInterpretation": "学生之间缺少正向联结"
        },
        {
          "name": "环境",
          "calcMethod": "mean",
          "weight": 1,
          "description": "学习态度、精神状态（环境维度·筛查层，不计入五维综合均值，单独报告）",
          "highInterpretation": "状态饱满、求助而非放弃",
          "lowInterpretation": "状态低迷，需关注个体支持"
        }
      ],
      "questions": [
        {
          "text": "积极课堂氛围",
          "dimension": "情感",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "学生表情放松",
          "dimension": "情感",
          "optionGroup": "AGREE_5",
          "reverse": true,
          "help": "反向题：按 6−原始分 转换后计入维度"
        },
        {
          "text": "教师心理压力小",
          "dimension": "情感",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "被学生接纳愉悦感",
          "dimension": "情感",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "有效帮助学生成就感",
          "dimension": "情感",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "集体荣誉感",
          "dimension": "认知",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "主动提规则建议",
          "dimension": "认知",
          "optionGroup": "AGREE_5",
          "reverse": true,
          "help": "反向题：按 6−原始分 转换后计入维度"
        },
        {
          "text": "积极思考并回答",
          "dimension": "认知",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "有效订正错误",
          "dimension": "认知",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "相信能提升班级",
          "dimension": "认知",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "主动举手提问",
          "dimension": "行为",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "用表情回应教师",
          "dimension": "行为",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "集体任务参与积极",
          "dimension": "行为",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "指令响应迅速",
          "dimension": "行为",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "提醒次数≤3次/节",
          "dimension": "行为",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "主动维护秩序",
          "dimension": "行为",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "行为规范有礼貌",
          "dimension": "行为",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "同学相处融洽",
          "dimension": "关系",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "包容回答偏差",
          "dimension": "关系",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "学习互助",
          "dimension": "关系",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "倾听回应批评",
          "dimension": "关系",
          "optionGroup": "AGREE_5",
          "reverse": true,
          "help": "反向题：按 6−原始分 转换后计入维度"
        },
        {
          "text": "愿意与教师交流",
          "dimension": "关系",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "学习态度认真",
          "dimension": "环境",
          "optionGroup": "AGREE_5",
          "reverse": true,
          "help": "反向题：按 6−原始分 转换后计入维度（环境为筛查层）"
        },
        {
          "text": "精神状态饱满",
          "dimension": "环境",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "求助而非放弃",
          "dimension": "环境",
          "optionGroup": "AGREE_5",
          "reverse": false
        }
      ]
    },
    {
      "name": "班级能量场问卷·学生版",
      "role": "深度诊断",
      "shortName": "能量场·学生版",
      "description": "A02-S 班级能量场问卷（学生版·25题）：学生自评自身体验，计分同教师版（反向题2/7/21/23按 6−v 转换）。学生版维度归组与教师版不同：情感1-5 / 关系6,7,11-15,24 / 认知8-10,17,22 / 行为16,18-21 / 环境23,25。⚠️ 学生自陈题干与逐题维度归组为本次整理推断的 draft，待学校定稿。学生问卷须匿名、班主任回避。",
      "minutes": 5,
      "targetAudience": "student",
      "frequency": "monthly",
      "usageTiming": "教师版施测后需学生视角交叉验证时",
      "reAssessmentIntervalDays": 30,
      "prerequisites": [
        "班级能量场问卷·教师版"
      ],
      "exclusives": [],
      "triggerConditions": [
        {
          "targetType": "average",
          "target": "",
          "comparator": "低于或等于",
          "value": 3.5,
          "join": "且"
        },
        {
          "targetType": "dimension",
          "target": "关系",
          "comparator": "低于或等于",
          "value": 3.5,
          "join": "或"
        }
      ],
      "triggerNote": "能量场问卷（教师版）均分≤3.5 或关系维度≤3.5 时，建议再做学生版交叉验证",
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "情感",
          "calcMethod": "mean",
          "weight": 1,
          "description": "课堂氛围、轻松感、被接纳、成就感（学生版情感维度）",
          "highInterpretation": "学生感到被接纳、氛围轻松",
          "lowInterpretation": "感到紧张不放松、不被接纳"
        },
        {
          "name": "关系",
          "calcMethod": "mean",
          "weight": 1,
          "description": "集体荣誉、规则参与、同伴关系、师生交流（学生版关系维度）",
          "highInterpretation": "归属感强，同伴与师生联结紧密",
          "lowInterpretation": "同伴联结薄弱，参与度低"
        },
        {
          "name": "认知",
          "calcMethod": "mean",
          "weight": 1,
          "description": "积极思考回答、订正、班级信心、主动交流（学生版认知维度）",
          "highInterpretation": "学习投入与班级信心高",
          "lowInterpretation": "学习投入低，缺乏班级信心"
        },
        {
          "name": "行为",
          "calcMethod": "mean",
          "weight": 1,
          "description": "维护秩序、文明礼貌、同伴互助、回应批评（学生版行为维度）",
          "highInterpretation": "行为自主规范，互助充分",
          "lowInterpretation": "行为依赖提醒，互助缺失"
        },
        {
          "name": "环境",
          "calcMethod": "mean",
          "weight": 1,
          "description": "学习态度、求助行为（学生版环境维度·筛查层，不计入综合均值）",
          "highInterpretation": "状态饱满、遇困求助",
          "lowInterpretation": "状态低迷、倾向放弃"
        }
      ],
      "questions": [
        {
          "text": "我们班的课堂氛围让我感到积极、愉快。",
          "dimension": "情感",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "在课堂或班级里，我经常感到紧张、不放松。",
          "dimension": "情感",
          "optionGroup": "AGREE_5",
          "reverse": true,
          "help": "反向题：按 6−原始分 转换后计入维度"
        },
        {
          "text": "在班级里我觉得轻松，没有太大的压力。",
          "dimension": "情感",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我觉得自己被这个班集体接纳，是被欢迎的。",
          "dimension": "情感",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我在班里做的事能得到认可，让我有成就感。",
          "dimension": "情感",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我为在这个班而自豪，有集体荣誉感。",
          "dimension": "关系",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我愿意主动对班级的规则提建议。",
          "dimension": "关系",
          "optionGroup": "AGREE_5",
          "reverse": true,
          "help": "反向题：按 6−原始分 转换后计入维度"
        },
        {
          "text": "上课时我会积极思考并回答老师的问题。",
          "dimension": "认知",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我能认真订正作业里的错误。",
          "dimension": "认知",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我相信我们这个班会越来越好。",
          "dimension": "认知",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我愿意主动举手回答问题。",
          "dimension": "关系",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我会用表情或眼神回应老师。",
          "dimension": "关系",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "集体任务或小组活动我都会积极参与。",
          "dimension": "关系",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "老师布置的事情我能很快照着做。",
          "dimension": "关系",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "一节课里我很少需要老师反复提醒。",
          "dimension": "关系",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我会主动帮忙维护班级秩序。",
          "dimension": "行为",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我的言行举止文明、有礼貌。",
          "dimension": "认知",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我和同学相处得融洽。",
          "dimension": "行为",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "同学答错时我愿意包容，不嘲笑。",
          "dimension": "行为",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "同学学习遇到困难时我愿意帮忙。",
          "dimension": "行为",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "别人批评我时，我愿意听并回应。",
          "dimension": "行为",
          "optionGroup": "AGREE_5",
          "reverse": true,
          "help": "反向题：按 6−原始分 转换后计入维度"
        },
        {
          "text": "我愿意主动和老师交流。",
          "dimension": "认知",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我对待学习的态度是认真的。",
          "dimension": "环境",
          "optionGroup": "AGREE_5",
          "reverse": true,
          "help": "反向题：按 6−原始分 转换后计入维度（环境为筛查层）"
        },
        {
          "text": "我精神状态饱满，上课有精神。",
          "dimension": "关系",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "遇到困难时我愿意求助，而不是放弃。",
          "dimension": "环境",
          "optionGroup": "AGREE_5",
          "reverse": false
        }
      ]
    },
    {
      "name": "进班观测速记卡",
      "role": "专项/情境",
      "shortName": "进班观测",
      "description": "A03 进班观测速记卡（每周2-3次）：按五维锚点做 1-3 快速勾选，周追踪趋势，配合能量场问卷使用。走进教室第一感觉即最真实数据，非检查而是感受。环境为筛查层，不计入能量场综合均值。",
      "minutes": 3,
      "formType": "observation",
      "frequency": "weekly",
      "usageTiming": "每周2-3次进班时快速记录",
      "reAssessmentIntervalDays": 7,
      "prerequisites": [
        "五系统自评表"
      ],
      "exclusives": [],
      "triggerConditions": [
        {
          "targetType": "average",
          "target": "",
          "comparator": "低于或等于",
          "value": 3.6,
          "join": "且"
        }
      ],
      "triggerNote": "五系统自评均分≤3.6 时，建议每周用进班观测速记卡追踪趋势",
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "情感",
          "calcMethod": "mean",
          "weight": 1,
          "description": "面部表情、整体情绪温度",
          "highInterpretation": "表情放松、情绪温度高",
          "lowInterpretation": "表情紧绷、情绪温度低"
        },
        {
          "name": "认知",
          "calcMethod": "mean",
          "weight": 1,
          "description": "口头指代（我们班/这个班）、规则讨论频次",
          "highInterpretation": "「我们班」占比高，认同高",
          "lowInterpretation": "「这个班」占比高，归属感弱"
        },
        {
          "name": "行为",
          "calcMethod": "mean",
          "weight": 1,
          "description": "课前状态、指令响应速度、自习纪律",
          "highInterpretation": "课前状态稳、响应快、自习纪律好",
          "lowInterpretation": "需反复提醒、响应慢"
        },
        {
          "name": "关系",
          "calcMethod": "mean",
          "weight": 1,
          "description": "同伴互动（互助/冲突）、师生互动姿态",
          "highInterpretation": "互助多、师生互动自然",
          "lowInterpretation": "冲突多、存在小圈子和落单者"
        },
        {
          "name": "环境",
          "calcMethod": "mean",
          "weight": 1,
          "description": "整洁度、绿植/布置（筛查层，不计入能量场综合均值）",
          "highInterpretation": "整洁、布置有生机",
          "lowInterpretation": "杂乱、布置陈旧"
        }
      ],
      "questions": [
        {
          "text": "情感：①面部表情（放松/平静/紧绷）②整体情绪温度",
          "dimension": "情感",
          "optionGroup": "进班观测三分",
          "reverse": false,
          "help": "走进教室第一感觉即最真实数据"
        },
        {
          "text": "认知：①口头指代（我们班/这个班）②规则讨论频次",
          "dimension": "认知",
          "optionGroup": "进班观测三分",
          "reverse": false,
          "help": "「我们班」占比高=认同高"
        },
        {
          "text": "行为：①课前状态②指令响应速度③自习纪律",
          "dimension": "行为",
          "optionGroup": "进班观测三分",
          "reverse": false,
          "help": "非检查，是感受"
        },
        {
          "text": "关系：①同伴互动（互助/冲突）②师生互动姿态",
          "dimension": "关系",
          "optionGroup": "进班观测三分",
          "reverse": false,
          "help": "观察小圈子与落单者"
        },
        {
          "text": "环境：①整洁度②绿植/布置（仅筛查，不计入能量场综合均值）",
          "dimension": "环境",
          "optionGroup": "进班观测三分",
          "reverse": false
        }
      ]
    },
    {
      "name": "能量场五维评分锚点表",
      "role": "专项/情境",
      "shortName": "五维锚点",
      "description": "A04 能量场五维评分锚点表：五维 1/3/5 锚点描述（半定量），快速评级 1=低能量 5=高能量，配合进班观测速记卡使用。环境为筛查层。",
      "minutes": 3,
      "formType": "observation",
      "frequency": "weekly",
      "usageTiming": "配合进班观测速记卡做半定量评级",
      "prerequisites": [
        "进班观测速记卡"
      ],
      "exclusives": [],
      "triggerConditions": [
        {
          "targetType": "average",
          "target": "",
          "comparator": "低于或等于",
          "value": 2.5,
          "join": "且"
        }
      ],
      "triggerNote": "进班观测速记卡均分≤2.5 时，用五维锚点表做半定量评级",
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "情感",
          "calcMethod": "mean",
          "weight": 1,
          "description": "1分=面无表情/趴桌比例>30%；3分=部分学生主动参与；5分=集体自发的笑声、击掌",
          "highInterpretation": "集体自发笑声、击掌",
          "lowInterpretation": "面无表情/趴桌比例>30%"
        },
        {
          "name": "认知",
          "calcMethod": "mean",
          "weight": 1,
          "description": "1分=「这个班」频率高、外归因；3分=「我们班」与「这个班」并存；5分=「我们班」为主",
          "highInterpretation": "「我们班」为主、主动为班级归因",
          "lowInterpretation": "「这个班」频率高、外归因"
        },
        {
          "name": "行为",
          "calcMethod": "mean",
          "weight": 1,
          "description": "1分=需反复提醒、抄作业现象多；3分=基本按时按质；5分=主动举手、主动完成",
          "highInterpretation": "主动举手、主动完成",
          "lowInterpretation": "需反复提醒、抄作业现象多"
        },
        {
          "name": "关系",
          "calcMethod": "mean",
          "weight": 1,
          "description": "1分=独来独往比例高、冲突多；3分=小圈子明显但稳定；5分=课间合作游戏、主动找老师",
          "highInterpretation": "课间合作游戏、主动找老师",
          "lowInterpretation": "独来独往比例高、冲突多"
        },
        {
          "name": "环境",
          "calcMethod": "mean",
          "weight": 1,
          "description": "1分=桌椅乱、墙面陈旧、绿植枯萎；3分=基本整洁、布置常规；5分=教室有「家」的感觉（筛查层）",
          "highInterpretation": "教室有「家」的感觉、学生主动维护",
          "lowInterpretation": "桌椅乱、墙面陈旧、绿植枯萎"
        }
      ],
      "questions": [
        {
          "text": "情感：1分=面无表情/趴桌比例>30%；3分=部分学生主动参与；5分=集体自发的笑声、击掌",
          "dimension": "情感",
          "optionGroup": "能量锚点1-3-5",
          "reverse": false
        },
        {
          "text": "认知：1分=「这个班」频率高、外归因；3分=「我们班」与「这个班」并存；5分=「我们班」为主、主动为班级归因",
          "dimension": "认知",
          "optionGroup": "能量锚点1-3-5",
          "reverse": false
        },
        {
          "text": "行为：1分=需反复提醒、抄作业现象多；3分=基本按时按质；5分=主动举手、主动完成",
          "dimension": "行为",
          "optionGroup": "能量锚点1-3-5",
          "reverse": false
        },
        {
          "text": "关系：1分=独来独往比例高、冲突多；3分=小圈子明显但稳定；5分=课间合作游戏、主动找老师",
          "dimension": "关系",
          "optionGroup": "能量锚点1-3-5",
          "reverse": false
        },
        {
          "text": "环境：1分=桌椅乱、墙面陈旧、绿植枯萎；3分=基本整洁、布置常规；5分=教室有「家」的感觉、学生主动维护（筛查层）",
          "dimension": "环境",
          "optionGroup": "能量锚点1-3-5",
          "reverse": false
        }
      ]
    },
    {
      "name": "心理风险A-E点检表",
      "role": "红线检查",
      "shortName": "A-E点检",
      "description": "A05 心理风险 A-E 级点检表（班主任/心理教师）：等级判定（典型表现+量化指标），响应动作分级。重要原则：A/B 级必须第一时间上报学校，不能由班主任独自处理；E 级为健康观察·月度追踪。",
      "minutes": 3,
      "formType": "checklist",
      "frequency": "per_case",
      "resultVisibility": "psychologist",
      "dataSensitivity": "highly_sensitive",
      "usageTiming": "出现风险信号或班级系统性问题时点检",
      "reAssessmentIntervalDays": 14,
      "prerequisites": [
        "五系统自评表"
      ],
      "exclusives": [],
      "triggerConditions": [
        {
          "targetType": "average",
          "target": "",
          "comparator": "低于或等于",
          "value": 3,
          "join": "且"
        },
        {
          "targetType": "dimension",
          "target": "关系系统",
          "comparator": "低于或等于",
          "value": 3,
          "join": "或"
        }
      ],
      "triggerNote": "五系统自评均分≤3 或关系系统≤3 时，建议做心理风险 A-E 点检排查个体风险",
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "风险等级",
          "calcMethod": "sum",
          "weight": 1,
          "description": "A-E 五级点检命中（A安全危机/B高风险/C中度/D轻度/E健康观察），A/B 级须 24-48h 上报",
          "highInterpretation": "命中高等级风险，需立即分级响应",
          "lowInterpretation": "仅命中 E 级健康观察"
        }
      ],
      "questions": [
        {
          "text": "A级·安全危机：自伤/伤他念头或行为、严重家庭变故、性侵线索",
          "dimension": "风险等级",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "量化指标：出现自伤工具持有、攻击性威胁言论、躯体化反应；响应：24小时内学校+公安+心理转介"
        },
        {
          "text": "B级·高风险：持续情绪低落≥2周、自伤意念、家庭剧变、行为冲突频发(周均≥5次)",
          "dimension": "风险等级",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "量化指标：周均≥5次冲突、确诊多动/自闭等行为障碍；响应：48小时评估、家长面谈、专业转介"
        },
        {
          "text": "C级·中度困扰：1-2周情绪低落、回避社交、成绩骤降、外向攻击",
          "dimension": "风险等级",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "量化指标：破坏公物、欺凌行为、对抗权威；响应：1周内班主任+心理教师介入"
        },
        {
          "text": "D级·轻度关注：多动倾向、注意分散、偶发冲突、课堂干扰",
          "dimension": "风险等级",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "量化指标：多动倾向、注意分散、偶发冲突(可控)；响应：1个月内家校沟通、班级内支持"
        },
        {
          "text": "E级·健康观察：适应良好、偶有情绪起伏、内向困扰",
          "dimension": "风险等级",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "量化指标：持续抑郁/焦虑倾向、社交回避；响应：常规关注、月度追踪"
        }
      ]
    },
    {
      "name": "绘画投射筛查",
      "role": "专项/情境",
      "shortName": "绘画筛查",
      "description": "A06 绘画投射筛查指标（HTP/雨中人/树木画，心理教师使用）：红旗清单判定风险等级 红/橙/黄/绿，红=高危需转介、橙=中风险关注、黄=轻度提示、绿=保护性因素（降级）。使用边界：筛查与转介建议，非诊断结论。",
      "minutes": 10,
      "formType": "checklist",
      "frequency": "per_case",
      "responsibleRole": "心理教师",
      "resultVisibility": "psychologist",
      "dataSensitivity": "highly_sensitive",
      "usageTiming": "心理教师对疑似风险学生做绘画投射筛查时",
      "prerequisites": [
        "心理风险A-E点检表"
      ],
      "exclusives": [],
      "triggerConditions": [
        {
          "targetType": "question",
          "target": "3",
          "comparator": "正好等于",
          "value": 1,
          "join": "且"
        },
        {
          "targetType": "question",
          "target": "2",
          "comparator": "正好等于",
          "value": 1,
          "join": "或"
        }
      ],
      "triggerNote": "A-E 点检命中 C 级或 B 级时，建议心理教师用绘画投射筛查进一步评估风险",
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "通用",
          "calcMethod": "sum",
          "weight": 1,
          "description": "通用绘画语言维度：画面布局/大小比例/透视空间/线条质量/阴影涂黑/省略缺失/附加物",
          "highInterpretation": "命中多项红旗信号",
          "lowInterpretation": "无红旗信号"
        },
        {
          "name": "HTP·房",
          "calcMethod": "sum",
          "weight": 1,
          "description": "房树人·房的门/窗：无门/重锁/铁栏；无窗",
          "highInterpretation": "命中社交封闭信号",
          "lowInterpretation": "无红旗信号"
        },
        {
          "name": "HTP·树",
          "calcMethod": "sum",
          "weight": 1,
          "description": "房树人·树的根/干：无根/根断；枯无皮/裂/虫洞/砍断",
          "highInterpretation": "命中生命力受损信号",
          "lowInterpretation": "无红旗信号"
        },
        {
          "name": "HTP·人",
          "calcMethod": "sum",
          "weight": 1,
          "description": "房树人·人的眼/臂/脸：眼被挖空；无臂；无脸",
          "highInterpretation": "命中被监视感/行动力缺失信号",
          "lowInterpretation": "无红旗信号"
        },
        {
          "name": "雨中人",
          "calcMethod": "sum",
          "weight": 1,
          "description": "雨中人：防护物/人物状态/积极资源",
          "highInterpretation": "命中缺乏应对资源、被压垮信号",
          "lowInterpretation": "出现积极资源（保护性因素）"
        },
        {
          "name": "树木画",
          "calcMethod": "sum",
          "weight": 1,
          "description": "树木画：树干纹理/气象附加",
          "highInterpretation": "命中创伤印记/毁灭感信号",
          "lowInterpretation": "无红旗信号"
        }
      ],
      "questions": [
        {
          "text": "通用·画面布局：过于偏角/挤压边缘；极空或溢出；主体压底",
          "dimension": "通用",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "可能指向：边缘化/不安全感；或控制欲/冲动（风险：黄）"
        },
        {
          "text": "通用·大小比例：单一物体异常巨大/渺小",
          "dimension": "通用",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "可能指向：自我膨胀/控制欲；或自卑/被压迫（风险：橙）"
        },
        {
          "text": "通用·透视/空间：漂浮无地面线；关系严重错乱",
          "dimension": "通用",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "可能指向：现实感薄弱、自我界限模糊（风险：红）"
        },
        {
          "text": "通用·线条质量：断续颤抖；用力刻破纸；生硬直线",
          "dimension": "通用",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "可能指向：焦虑/控制/情感隔离（风险：黄）"
        },
        {
          "text": "通用·阴影/涂黑：大面积涂黑；主体被重阴影裹",
          "dimension": "通用",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "可能指向：抑郁、内疚、被压迫（风险：橙）"
        },
        {
          "text": "通用·省略/缺失：人无脸/手/脚、房无门无窗、树无根",
          "dimension": "通用",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "可能指向：回避、自我界限、行动力缺失（风险：橙）"
        },
        {
          "text": "通用·附加物：诡异生物、防御工事、武器、血迹",
          "dimension": "通用",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "依内容判断（见红旗清单）（风险：红）"
        },
        {
          "text": "HTP·房·门/窗：无门/重锁/铁栏；无窗",
          "dimension": "HTP·房",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "可能指向：社交封闭、防御过度、不安全感（风险：橙）"
        },
        {
          "text": "HTP·树·树根/干：无根/根断；枯无皮/裂/虫洞/砍断",
          "dimension": "HTP·树",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "可能指向：生命力受损/创伤/自我脆弱（风险：红）"
        },
        {
          "text": "HTP·人·眼/臂/脸：眼被挖空；无臂；无脸",
          "dimension": "HTP·人",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "可能指向：被监视感/行动力缺失/认同模糊（风险：红/橙）"
        },
        {
          "text": "雨中人·防护物：无伞无衣直接暴露；伞破失效",
          "dimension": "雨中人",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "可能指向：缺乏应对资源、无助（重点）（风险：红）"
        },
        {
          "text": "雨中人·人物状态：被雨压弯/蜷缩/跌倒水洼",
          "dimension": "雨中人",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "可能指向：被压垮、无力、抑郁倾向（风险：红）"
        },
        {
          "text": "雨中人·积极资源：有效雨伞/稳固房屋/他人共撑/彩虹",
          "dimension": "雨中人",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "保护性因素，风险相对降低（风险：绿）"
        },
        {
          "text": "树木画·树干纹理：皮剥落/裂/虫洞/绳捆",
          "dimension": "树木画",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "可能指向：创伤印记/受束缚/自我受损（风险：红）"
        },
        {
          "text": "树木画·气象附加：风暴劈树/连根拔起/火焚",
          "dimension": "树木画",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "可能指向：重大危机/创伤/毁灭感（风险：红）"
        }
      ]
    },
    {
      "name": "依恋关系观察清单",
      "role": "专项/情境",
      "shortName": "依恋观察",
      "description": "A07 依恋关系观察清单（班主任）：每学期开学前 3 周完成全班依恋观察评估。家庭背景五问（访谈）+ 四类识别（安全/A回避/C焦虑-矛盾/D混乱）+ 快速观察清单 7 维度。D 型须警惕创伤背景，及时转介。理论 Bowlby 1969 / Ainsworth 1978。",
      "minutes": 10,
      "formType": "observation",
      "frequency": "per_case",
      "usageTiming": "每学期开学前3周完成全班依恋观察评估",
      "prerequisites": [
        "五系统自评表"
      ],
      "exclusives": [],
      "triggerConditions": [
        {
          "targetType": "dimension",
          "target": "关系系统",
          "comparator": "低于或等于",
          "value": 3.5,
          "join": "且"
        }
      ],
      "triggerNote": "五系统自评关系系统≤3.5 时，建议做全班依恋关系观察评估",
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "家庭背景",
          "calcMethod": "mean",
          "weight": 1,
          "description": "家庭背景五问：依恋对象/照料回应/沟通开放度/创伤变化/依恋信号物",
          "highInterpretation": "家庭依恋背景整体稳定",
          "lowInterpretation": "存在创伤/重大变化或回应模式不一致"
        },
        {
          "name": "依恋类型",
          "calcMethod": "mean",
          "weight": 1,
          "description": "四类识别：安全型/A型回避/C型焦虑-矛盾/D型混乱",
          "highInterpretation": "以安全型特征为主",
          "lowInterpretation": "出现回避/焦虑-矛盾/混乱型特征"
        },
        {
          "name": "依恋观察",
          "calcMethod": "mean",
          "weight": 1,
          "description": "快速观察清单 7 维度：情绪稳定性/社交连接/分离反应/求助行为/规则回应/任务投入/依恋信号物",
          "highInterpretation": "各维度观察良好",
          "lowInterpretation": "多项观察异常"
        }
      ],
      "questions": [
        {
          "text": "家庭背景问1：孩子平时更喜欢找谁？（了解主要依恋对象）",
          "dimension": "家庭背景",
          "optionGroup": "依恋观察记录",
          "reverse": false,
          "help": "家访/家长会自然对话收集，切忌审问"
        },
        {
          "text": "家庭背景问2：孩子情绪不好时，你们通常怎么处理？（照料者回应模式）",
          "dimension": "家庭背景",
          "optionGroup": "依恋观察记录",
          "reverse": false,
          "help": "记录回应模式一致性"
        },
        {
          "text": "家庭背景问3：孩子在家会主动说学校的事情吗？（家庭沟通开放度）",
          "dimension": "家庭背景",
          "optionGroup": "依恋观察记录",
          "reverse": false,
          "help": "评估沟通开放度"
        },
        {
          "text": "家庭背景问4：有没有什么“变化”让孩子比较难适应？（创伤/重大变化）",
          "dimension": "家庭背景",
          "optionGroup": "依恋观察记录",
          "reverse": false,
          "help": "识别转型/创伤信号"
        },
        {
          "text": "家庭背景问5：孩子有没有特别依赖或回避的物品/场所/人？（依恋信号物）",
          "dimension": "家庭背景",
          "optionGroup": "依恋观察记录",
          "reverse": false,
          "help": "记录依恋信号物"
        },
        {
          "text": "安全型：主动靠近教师寻求安慰；有稳定朋友圈；愿意倾诉",
          "dimension": "依恋类型",
          "optionGroup": "依恋观察记录",
          "reverse": false,
          "help": "全班通用：建设安全基地（可预期、在场）"
        },
        {
          "text": "A型·回避：不要求情绪表达；用共同任务/并行活动切入；小任务委托",
          "dimension": "依恋类型",
          "optionGroup": "依恋观察记录",
          "reverse": false,
          "help": "无压力关系建立，从认知切入，不逼情绪暴露"
        },
        {
          "text": "C型·焦虑-矛盾：最需要一致性；结构化安抚+情绪验证+渐进分离仪式",
          "dimension": "依恋类型",
          "optionGroup": "依恋观察记录",
          "reverse": false,
          "help": "教师反应可预期，陪伴不急于消除情绪"
        },
        {
          "text": "D型·混乱：提供稳定而非解决创伤；保持预测性；允许不信任；危机预案",
          "dimension": "依恋类型",
          "optionGroup": "依恋观察记录",
          "reverse": false,
          "help": "必要时立即联动专业支持，制定个性危机流程"
        },
        {
          "text": "观察·情绪稳定性：情绪起伏是否平缓可控",
          "dimension": "依恋观察",
          "optionGroup": "依恋观察记录",
          "reverse": false
        },
        {
          "text": "观察·社交连接：与同伴的互动质量与频率",
          "dimension": "依恋观察",
          "optionGroup": "依恋观察记录",
          "reverse": false
        },
        {
          "text": "观察·分离反应：与主要照料者分离时的反应",
          "dimension": "依恋观察",
          "optionGroup": "依恋观察记录",
          "reverse": false
        },
        {
          "text": "观察·求助行为：遇到困难时是否会主动求助",
          "dimension": "依恋观察",
          "optionGroup": "依恋观察记录",
          "reverse": false
        },
        {
          "text": "观察·规则回应：对班级规则与指令的回应方式",
          "dimension": "依恋观察",
          "optionGroup": "依恋观察记录",
          "reverse": false
        },
        {
          "text": "观察·任务投入：对学习任务的投入程度",
          "dimension": "依恋观察",
          "optionGroup": "依恋观察记录",
          "reverse": false
        },
        {
          "text": "观察·依恋信号物：是否存在特别依赖或回避的物品/场所/人",
          "dimension": "依恋观察",
          "optionGroup": "依恋观察记录",
          "reverse": false
        }
      ]
    },
    {
      "name": "个案诊断矩阵",
      "role": "专项/情境",
      "shortName": "个案诊断",
      "description": "A08 个案诊断矩阵（能力×意愿）：双轴诊断 能力(会不会)×意愿(想不想) → 四类型匹配干预（成功/挫折/对抗/放弃型）。适用：出现个体行为问题时。另含第二诊断维度「情境vs模式」与「诊断四步法」（见手册）。",
      "minutes": 5,
      "formType": "checklist",
      "frequency": "per_case",
      "usageTiming": "出现个体学生行为问题时",
      "prerequisites": [
        "五系统自评表"
      ],
      "exclusives": [],
      "triggerConditions": [
        {
          "targetType": "average",
          "target": "",
          "comparator": "低于或等于",
          "value": 3.6,
          "join": "且"
        },
        {
          "targetType": "dimension",
          "target": "目标系统",
          "comparator": "低于或等于",
          "value": 3.5,
          "join": "或"
        }
      ],
      "triggerNote": "五系统自评均分≤3.6 或目标系统≤3.5 时，对个体行为问题做能力×意愿个案诊断",
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "个案类型",
          "calcMethod": "sum",
          "weight": 1,
          "description": "能力×意愿四型：成功型/挫折型/对抗型/放弃型",
          "highInterpretation": "命中需优先处理的类型",
          "lowInterpretation": "暂无明显个案类型"
        }
      ],
      "questions": [
        {
          "text": "【成功型】能力高×意愿高：表现好，可能隐藏风险（倦怠/骄傲）",
          "dimension": "个案类型",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "策略：激发更高目标，防止倦怠/骄傲"
        },
        {
          "text": "【挫折型】能力高×意愿低：会做但不愿做，可能反复失败/被否定",
          "dimension": "个案类型",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "策略：拆解目标、重建小成功"
        },
        {
          "text": "【对抗型】能力低×意愿高：不会做但嘴硬/用行为表达不满",
          "dimension": "个案类型",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "策略：先建立关系、再处理行为"
        },
        {
          "text": "【放弃型】能力低×意愿低：不会做也不想做，长期受挫/被边缘化",
          "dimension": "个案类型",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "策略：先看见人、再处理学习"
        }
      ]
    },
    {
      "name": "SDQ小学生心理筛查量表（使用指引）",
      "role": "专项/情境",
      "shortName": "SDQ指引",
      "description": "A09 SDQ 小学生心理筛查量表（使用指引·外部量表）：R. Goodman 编制的优势与困难问卷，5 维度 25 题。⚠️ 仅给使用指引，题项与常模须引用原版权方，不标为我方原创。用于发现隐形焦虑/情绪症状学生，异常者启动 B/C 级响应；群体筛查维度均分>4 提示班级系统性问题。",
      "minutes": 10,
      "formType": "checklist",
      "frequency": "per_case",
      "responsibleRole": "心理教师",
      "resultVisibility": "psychologist",
      "dataSensitivity": "highly_sensitive",
      "sourceType": "external",
      "externalAuthorizationNote": "外部量表（Goodman SDQ），题项与常模须引用原版权方；严禁公开宣读或贴标签",
      "usageTiming": "发现隐形焦虑/情绪症状学生，需筛查确认时",
      "prerequisites": [
        "心理风险A-E点检表"
      ],
      "exclusives": [],
      "triggerConditions": [
        {
          "targetType": "question",
          "target": "4",
          "comparator": "正好等于",
          "value": 1,
          "join": "且"
        },
        {
          "targetType": "question",
          "target": "5",
          "comparator": "正好等于",
          "value": 1,
          "join": "或"
        }
      ],
      "triggerNote": "A-E 点检命中 D 级或 E 级（疑似隐形情绪症状）时，建议用 SDQ 筛查确认",
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "情绪症状",
          "calcMethod": "sum",
          "weight": 1,
          "description": "情绪低落、焦虑、恐惧、躯体不适（教师版评定）",
          "highInterpretation": "达临床区间，需启动 B/C 级响应",
          "lowInterpretation": "正常区间"
        },
        {
          "name": "品行问题",
          "calcMethod": "sum",
          "weight": 1,
          "description": "攻击、说谎、偷拿、违抗（结合日常观察）",
          "highInterpretation": "异常，需关注",
          "lowInterpretation": "正常区间"
        },
        {
          "name": "多动注意",
          "calcMethod": "sum",
          "weight": 1,
          "description": "坐不住、易分心、冲动（注意与环境干扰区分）",
          "highInterpretation": "异常，需关注",
          "lowInterpretation": "正常区间"
        },
        {
          "name": "同伴交往",
          "calcMethod": "sum",
          "weight": 1,
          "description": "孤独、被排挤、少朋友（关注社交回避）",
          "highInterpretation": "异常，需关注",
          "lowInterpretation": "正常区间"
        },
        {
          "name": "亲社会行为",
          "calcMethod": "sum",
          "weight": 1,
          "description": "乐于助人、体谅他人（保护性因素）",
          "highInterpretation": "保护性因素充足",
          "lowInterpretation": "亲社会行为不足"
        }
      ],
      "questions": [
        {
          "text": "情绪症状：情绪低落、焦虑、恐惧、躯体不适",
          "dimension": "情绪症状",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "教师版评定；汇总看是否达临床区间"
        },
        {
          "text": "品行问题：攻击、说谎、偷拿、违抗",
          "dimension": "品行问题",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "结合日常观察"
        },
        {
          "text": "多动/注意：坐不住、易分心、冲动",
          "dimension": "多动注意",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "注意与环境干扰区分"
        },
        {
          "text": "同伴交往：孤独、被排挤、少朋友",
          "dimension": "同伴交往",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "关注社交回避"
        },
        {
          "text": "亲社会行为：乐于助人、体谅他人",
          "dimension": "亲社会行为",
          "optionGroup": "YES_NO",
          "reverse": false,
          "help": "保护性因素"
        }
      ]
    }
  ],
  "attributions": [
    {
      "name": "亲师依恋断裂",
      "description": "学生与班主任未形成安全依恋基地，遇困不求助、对抗权威，关系得分持续偏低。",
      "highSign": "连续2周零主动求助；遇困回避求助、对抗权威、不愿敞开心扉",
      "typicalTrigger": "亲师依恋未建立安全基地（家庭依恋不安全且师生关系未补偿）",
      "action": "每日1次非评价性打招呼；设固定谈心时间(10min/周)；用「先跟后带」接住情绪再谈事",
      "weight": 1.3,
      "tags": [
        "class_system",
        "relationship",
        "attachment"
      ]
    },
    {
      "name": "同伴联结薄弱",
      "description": "同伴支持网络缺失，冲突无缓冲层，易升级为排斥或孤立。",
      "highSign": "周冲突≥3次且调解失败率>50%；小团体排斥、冲突升级无缓冲、孤立个体",
      "typicalTrigger": "同伴支持网络缺失、缺少冲突缓冲与调解机制",
      "action": "重排小组(异质搭配)；设「联结员」角色；每日合作任务打卡",
      "weight": 1.3,
      "tags": [
        "class_system",
        "relationship",
        "peer"
      ]
    },
    {
      "name": "家校连接松散",
      "description": "家长参与度低、沟通单向，重要通知无闭环。",
      "highSign": "关键通知24h响应率<60%；家长失联、群内零响应、沟通单向",
      "typicalTrigger": "家校双向连接松散、沟通单向无回执闭环",
      "action": "用73855法则沟通；每周1条正向反馈；重要事项回执闭环",
      "weight": 1.1,
      "tags": [
        "class_system",
        "relationship",
        "family"
      ]
    },
    {
      "name": "组织架构空缺",
      "description": "班委/小组未建立或形同虚设，事事班主任兜底。",
      "highSign": "核心岗位空缺>1周；班干部缺位、履职差、唯名不干事",
      "typicalTrigger": "选举即任命、无试用考核、岗位无职责说明",
      "action": "发布岗位说明书；自荐+竞选；1个月试用期+考核表；正式任命",
      "weight": 1.5,
      "tags": [
        "class_system",
        "organization",
        "structure"
      ]
    },
    {
      "name": "架构适配失当",
      "description": "座位/分组未按特质与关系调整，引发冲突或搭便车。",
      "highSign": "组内贡献方差过大；排座冲突、小组失效、搭便车",
      "typicalTrigger": "未按特质分组、排座无透明依据",
      "action": "按特质与关系重排座位/小组；设互补搭档；周复盘适配度",
      "weight": 1.1,
      "tags": [
        "class_system",
        "organization",
        "seating"
      ]
    },
    {
      "name": "运转机制失效",
      "description": "值日/事务无标准流程，响应慢、易积压。",
      "highSign": "常规事务响应>48h；值日推诿、事务积压、无人兜底",
      "typicalTrigger": "无运转SOP、岗位无责任人",
      "action": "列值日/事务清单与标准；设轮值负责人；日清日毕打卡",
      "weight": 1.1,
      "tags": [
        "class_system",
        "organization",
        "operation"
      ]
    },
    {
      "name": "公约悬空",
      "description": "公约未共建或建而不用，学生不知晓、无约束力。",
      "highSign": "知晓率<70%或复发率>40%；公约悬空、学生不知晓",
      "typicalTrigger": "未共建即张贴、公约上墙后缺乏复盘",
      "action": "公约六步法：草案征集→小组讨论→全班表决→上墙签名→月度复盘",
      "weight": 1.5,
      "tags": [
        "class_system",
        "norm",
        "rules"
      ]
    },
    {
      "name": "督导标准不一",
      "description": "同一行为不同老师/不同次处理不一致，学生无所适从、规则感崩塌。",
      "highSign": "同行为处置差异>2级；同一行为不同处理、违规反复",
      "typicalTrigger": "督导标准不一、无统一行为清单与处置标准",
      "action": "公布行为清单与处置标准；师生共议边界；一致执行",
      "weight": 1.1,
      "tags": [
        "class_system",
        "norm",
        "supervision"
      ]
    },
    {
      "name": "危机响应迟滞",
      "description": "风险未识别或识别后升级缓慢，错过干预窗口。",
      "highSign": "达到C级仍未在24h内启动；风险迟报漏报、处置失当升级",
      "typicalTrigger": "危机识别清单未用、A-E响应流程缺失",
      "action": "按A-E填识别卡；B/C级48h内启动；记录与跟踪",
      "weight": 1.5,
      "tags": [
        "class_system",
        "norm",
        "crisis"
      ]
    },
    {
      "name": "目标缺位",
      "description": "班级/个人无清晰目标，努力无方向。",
      "highSign": "学期目标覆盖率<80%；班级/个人无清晰目标、目标空泛",
      "typicalTrigger": "无目标金字塔、目标未拆解为里程碑",
      "action": "班→组→人三级拆解；SMART改写；周看板追踪",
      "weight": 1.2,
      "tags": [
        "class_system",
        "goal",
        "target"
      ]
    },
    {
      "name": "动力错配",
      "description": "能力-意愿组合误判，任务分配错位导致推诿或闲置。",
      "highSign": "高能力低意愿岗位闲置；任务分配与能力意愿错配、推一下动一下",
      "typicalTrigger": "未做动力矩阵、任务委派未按能力×意愿匹配",
      "action": "给每生画能力×意愿坐标；高能力低意愿→赋挑战岗；双低→降槛+陪跑",
      "weight": 1.2,
      "tags": [
        "class_system",
        "goal",
        "motivation"
      ]
    },
    {
      "name": "学业堰塞",
      "description": "知识欠账累积成坝，后续学习链断裂。",
      "highSign": "模块得分率<80%且连续失分；知识欠账堆积成坝、学习链断裂",
      "typicalTrigger": "欠账未溯源回填、缺堰塞湖疏浚机制",
      "action": "定位断点模块；降难度回填；每日1节点+错题重做",
      "weight": 1.5,
      "tags": [
        "class_system",
        "goal",
        "learning"
      ]
    },
    {
      "name": "氛围负向",
      "description": "班级情绪基调消极，集体无温度、无正向仪式。",
      "highSign": "月度氛围评分<3.5；冷漠、负向情绪弥漫、集体无温度",
      "typicalTrigger": "正向仪式感缺失、缺乏每日正向反馈机制",
      "action": "每日1句正向反馈；周班会亮点仪式；正念/颂钵3min",
      "weight": 1.2,
      "tags": [
        "class_system",
        "emotion",
        "climate"
      ]
    },
    {
      "name": "个体情绪失接",
      "description": "个体情绪问题未被及时接住，积压后爆发。",
      "highSign": "周转介>2人且情绪角零使用；个体情绪问题无人接住、积压爆发",
      "typicalTrigger": "情绪角缺位、缺乏EQ型情绪承接机制",
      "action": "设情绪角；EQ型四步接住；每周情绪签到",
      "weight": 1.2,
      "tags": [
        "class_system",
        "emotion",
        "support"
      ]
    },
    {
      "name": "归属感缺失",
      "description": "边缘学生无连接通道，持续低参与、隐形。",
      "highSign": "持续2周零主动发言；边缘学生、低参与、隐形人",
      "typicalTrigger": "无连接通道、缺乏归属感建设机制",
      "action": "设固定搭档/导师；每日1次正向点名；安全岛角落",
      "weight": 1.5,
      "tags": [
        "class_system",
        "emotion",
        "belonging"
      ]
    }
  ],
  "evidences": [
    {
      "attribution": "亲师依恋断裂",
      "scale": "五系统自评表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "关系系统",
          "comparator": "低于或等于",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "关系系统得分处于低位，师生信任与依恋基础薄弱"
    },
    {
      "attribution": "亲师依恋断裂",
      "scale": "依恋关系观察清单",
      "conditions": [
        {
          "targetType": "question",
          "target": "7",
          "comparator": "达到或超过",
          "value": 2,
          "join": "且"
        },
        {
          "targetType": "question",
          "target": "9",
          "comparator": "达到或超过",
          "value": 2,
          "join": "或"
        }
      ],
      "weight": 3,
      "description": "依恋观察显示回避型或混乱型特征，须警惕创伤背景"
    },
    {
      "attribution": "同伴联结薄弱",
      "scale": "五系统自评表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "关系系统",
          "comparator": "低于或等于",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "关系系统低位，同伴互助与氛围不足"
    },
    {
      "attribution": "同伴联结薄弱",
      "scale": "班级能量场问卷·教师版",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "关系",
          "comparator": "低于或等于",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "能量场关系维度偏低，学生之间缺少正向联结"
    },
    {
      "attribution": "家校连接松散",
      "scale": "五系统自评表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "关系系统",
          "comparator": "低于或等于",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "本模块无家校维度直接量表，以关系系统低位作为代理信号（家校连接松散需结合沟通记录确认）"
    },
    {
      "attribution": "组织架构空缺",
      "scale": "五系统自评表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "组织系统",
          "comparator": "低于或等于",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "组织系统低位，班委与服务岗位运转不足"
    },
    {
      "attribution": "架构适配失当",
      "scale": "五系统自评表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "组织系统",
          "comparator": "低于或等于",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "组织系统待建设，座位/分组适配存在风险"
    },
    {
      "attribution": "架构适配失当",
      "scale": "班级能量场问卷·教师版",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "行为",
          "comparator": "低于或等于",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "行为维度偏低，参与度不足提示分组适配失当"
    },
    {
      "attribution": "运转机制失效",
      "scale": "五系统自评表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "组织系统",
          "comparator": "低于或等于",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "组织系统待建设，日常事务运转缺乏标准流程"
    },
    {
      "attribution": "运转机制失效",
      "scale": "班级能量场问卷·教师版",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "行为",
          "comparator": "低于或等于",
          "value": 2.5,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "行为维度明显偏低，指令响应与秩序依赖教师"
    },
    {
      "attribution": "公约悬空",
      "scale": "五系统自评表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "规范系统",
          "comparator": "低于或等于",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "规范系统低位，规则认同与执行不足"
    },
    {
      "attribution": "督导标准不一",
      "scale": "五系统自评表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "规范系统",
          "comparator": "低于或等于",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "规范系统待建设，规则执行一致性存疑"
    },
    {
      "attribution": "危机响应迟滞",
      "scale": "心理风险A-E点检表",
      "conditions": [
        {
          "targetType": "question",
          "target": "3",
          "comparator": "正好等于",
          "value": 1,
          "join": "且"
        },
        {
          "targetType": "question",
          "target": "4",
          "comparator": "正好等于",
          "value": 1,
          "join": "或"
        }
      ],
      "weight": 2.5,
      "description": "点检命中 C 级或 D 级，存在风险识别与响应缺口"
    },
    {
      "attribution": "危机响应迟滞",
      "scale": "五系统自评表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "规范系统",
          "comparator": "低于或等于",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "规范系统低位，危机识别与响应机制薄弱"
    },
    {
      "attribution": "目标缺位",
      "scale": "五系统自评表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "目标系统",
          "comparator": "低于或等于",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "目标系统低位，班级/个人目标不清晰"
    },
    {
      "attribution": "动力错配",
      "scale": "五系统自评表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "目标系统",
          "comparator": "低于或等于",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "目标系统待建设，动力与目标衔接不足"
    },
    {
      "attribution": "动力错配",
      "scale": "个案诊断矩阵",
      "conditions": [
        {
          "targetType": "question",
          "target": "2",
          "comparator": "正好等于",
          "value": 1,
          "join": "且"
        },
        {
          "targetType": "question",
          "target": "3",
          "comparator": "正好等于",
          "value": 1,
          "join": "或"
        }
      ],
      "weight": 2.5,
      "description": "个案诊断为挫折型或对抗型，能力-意愿组合错配"
    },
    {
      "attribution": "学业堰塞",
      "scale": "五系统自评表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "目标系统",
          "comparator": "低于或等于",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "目标系统待建设，学习动力与目标不足（学业欠账需结合成绩数据确认）"
    },
    {
      "attribution": "学业堰塞",
      "scale": "班级能量场问卷·教师版",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "认知",
          "comparator": "低于或等于",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "认知维度偏低，学习投入与订正不足，存在欠账累积风险"
    },
    {
      "attribution": "氛围负向",
      "scale": "五系统自评表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "情感系统",
          "comparator": "低于或等于",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "情感系统低位，归属感与集体温度不足"
    },
    {
      "attribution": "氛围负向",
      "scale": "班级能量场问卷·教师版",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "情感",
          "comparator": "低于或等于",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "能量场情感维度偏低，课堂氛围压抑"
    },
    {
      "attribution": "个体情绪失接",
      "scale": "五系统自评表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "情感系统",
          "comparator": "低于或等于",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "情感系统待建设，个体情绪支持通道不足"
    },
    {
      "attribution": "个体情绪失接",
      "scale": "绘画投射筛查",
      "conditions": [
        {
          "targetType": "question",
          "target": "12",
          "comparator": "正好等于",
          "value": 1,
          "join": "且"
        },
        {
          "targetType": "question",
          "target": "15",
          "comparator": "正好等于",
          "value": 1,
          "join": "或"
        }
      ],
      "weight": 2.5,
      "description": "绘画筛查命中被压垮/毁灭感信号，情绪风险高"
    },
    {
      "attribution": "归属感缺失",
      "scale": "五系统自评表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "情感系统",
          "comparator": "低于或等于",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "情感系统待建设，边缘学生连接通道不足"
    },
    {
      "attribution": "归属感缺失",
      "scale": "班级能量场问卷·学生版",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "情感",
          "comparator": "低于或等于",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "学生版情感维度偏低，被接纳感与归属感不足"
    }
  ],
  "levels": [
    {
      "name": "安全危机·立即上报",
      "redLine": true,
      "scale": "心理风险A-E点检表",
      "conditions": [
        {
          "targetType": "question",
          "target": "1",
          "comparator": "正好等于",
          "value": 1,
          "join": "且"
        },
        {
          "targetType": "question",
          "target": "2",
          "comparator": "正好等于",
          "value": 1,
          "join": "或"
        }
      ],
      "teacherMessage": "A级（安全危机）或 B级（高风险）点检命中：该生存在自伤/伤他等安全风险。请立即停止常规建议输出，24-48小时内上报学校并通知心理专员，A级同时联系公安/医疗转介，全程留痕。",
      "redLineAction": "24-48小时内上报学校并通知心理专员，A级同步公安/医疗转介",
      "notificationTemplate": "[教师姓名]老师触发了心理风险红线（A/B级点检命中），请尽快登录系统查看处置要求。",
      "resultNote": "A/B级点检命中，须立即启动安全流程",
      "escalationCondition": "A级（安全事件）出现自伤工具持有、攻击性威胁言论、躯体化反应",
      "escalationTarget": "年级组长、心理专员、学校危机响应组",
      "reAssessTrigger": "上报后48小时复核",
      "interventionTools": [
        "心理风险A-E响应SOP",
        "情绪急救三步法"
      ],
      "interventionActions": [
        "立即按A-E响应SOP分级处置",
        "现场使用情绪急救三步法稳住局面"
      ]
    },
    {
      "name": "秩序奠基期",
      "scale": "五系统自评表",
      "conditions": [
        {
          "targetType": "average",
          "target": "",
          "comparator": "低于或等于",
          "value": 2,
          "join": "且"
        },
        {
          "targetType": "dimension",
          "target": "关系系统",
          "comparator": "低于或等于",
          "value": 2,
          "join": "或"
        }
      ],
      "teacherMessage": "五系统自评总分低于30分（或关系系统严重偏低）：班级处于系统性危机边缘，常规建设手段已不足以应对。请立即联系年级组长与心理专员，启动分层干预与学校支援。",
      "resultNote": "总分<30：立即介入，学校支援，必要时拆班/转介",
      "escalationTarget": "年级组长、心理专员",
      "reAssessTrigger": "介入后2周复评",
      "interventionTools": [
        "五系统诊断向导",
        "堰塞湖破局法"
      ],
      "interventionActions": [
        "启动五系统诊断向导定位短板",
        "用堰塞湖破局法疏解积压问题"
      ]
    },
    {
      "name": "关系激活期",
      "scale": "五系统自评表",
      "conditions": [
        {
          "targetType": "average",
          "target": "",
          "comparator": "低于或等于",
          "value": 3.6,
          "join": "且"
        },
        {
          "targetType": "dimension",
          "target": "关系系统",
          "comparator": "低于或等于",
          "value": 3.5,
          "join": "或"
        }
      ],
      "teacherMessage": "五系统自评总分30-59分：班级存在系统性问题或待建设弱项（${主要归因}），建议按短板启动重建或挑1-2个弱项做4周专项，从推荐工具中选一项本周落地，4周后复评。",
      "resultNote": "总分30-59：系统性问题或待建设弱项，启动重建+4周专项",
      "reAssessTrigger": "4周后复评",
      "interventionTools": [
        "五系统诊断向导",
        "班级愿景共建"
      ],
      "interventionActions": [
        "按短板系统匹配对应模块工具"
      ]
    },
    {
      "name": "制度自转期",
      "scale": "班级能量场问卷·教师版",
      "conditions": [
        {
          "targetType": "average",
          "target": "",
          "comparator": "低于或等于",
          "value": 3.5,
          "join": "且"
        },
        {
          "targetType": "dimension",
          "target": "情感",
          "comparator": "低于或等于",
          "value": 3.5,
          "join": "或"
        }
      ],
      "teacherMessage": "能量场问卷显示班级能量偏低（情感/关系维度尤为明显）：五系统自评总体健康但具体维度存在短板，建议结合五系统自评定位弱项，安排4周专项建设后复评。",
      "resultNote": "能量场均分≤3.5：班级能量偏低，安排4周专项观察与建设",
      "reAssessTrigger": "4周后复评",
      "interventionTools": [
        "五系统诊断向导",
        "班级团建与仪式感活动"
      ],
      "interventionActions": [
        "按能量短板维度匹配专项工具"
      ]
    }
  ],
  "tools": [
    {
      "name": "五系统诊断向导",
      "attributions": [
        "亲师依恋断裂",
        "同伴联结薄弱",
        "家校连接松散",
        "组织架构空缺",
        "架构适配失当",
        "运转机制失效",
        "公约悬空",
        "督导标准不一",
        "危机响应迟滞",
        "目标缺位",
        "动力错配",
        "学业堰塞",
        "氛围负向",
        "个体情绪失接",
        "归属感缺失"
      ],
      "whenToUse": "学期初/中/末班级整体体检；定位短板系统",
      "steps": [
        "发放五系统自评表（15题，1-5分）",
        "加总得15-75分",
        "四档解读：60-75健康 / 45-59关注 / 30-44系统问题 / <30立即介入",
        "按短板系统匹配对应模块工具"
      ],
      "form": "framework",
      "severity": "medium",
      "prohibition": "总分低于30时不要停留在常规建议，立即启动学校支援",
      "timePerSession": "10 分钟",
      "duration": "每学期初/中/末",
      "expectedEffect": "定位最需要建设的班级子系统",
      "effectNote": "诊断→归因→匹配工具的总入口",
      "outputArtifact": "系统诊断结论",
      "dimensions": [
        "关系系统",
        "组织系统",
        "规范系统",
        "目标系统",
        "情感系统"
      ],
      "reAssessmentIntervalDays": 90,
      "evidenceSource": "工作手册·第一章1.1",
      "materials": "自评表（15题）、四档解读阈值",
      "preparation": "准备五系统自评表",
      "outcomeIndicator": "产出四档诊断结论并匹配短板工具",
      "failureCriteria": "自评表回收率低或数据失真",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "堰塞湖破局法",
      "attributions": [
        "学业堰塞",
        "氛围负向",
        "个体情绪失接"
      ],
      "whenToUse": "班级问题积累/突发（凝聚力骤降、班委集体辞职）",
      "steps": [
        "识别4种截断（积累/堵塞/溃堤/重建）",
        "疏浚SOP·定期排空：班会复盘",
        "疏浚SOP·拓宽河道：声音通道",
        "疏浚SOP·降低水位：小步成功",
        "溃堤预警：出现集体辞职/安全事件立即启动危机响应"
      ],
      "form": "framework",
      "severity": "high",
      "prohibition": "出现集体辞职或安全事件时立即启动危机响应，不要按常规疏浚流程处理",
      "timePerSession": "一节班会",
      "duration": "按需持续",
      "expectedEffect": "截断信号恢复表达，堰塞湖水位下降",
      "effectNote": "把『为什么问题突然爆发』的水面下积累显性化并疏解",
      "outputArtifact": "疏浚行动计划",
      "dimensions": [
        "情感系统",
        "目标系统"
      ],
      "reAssessmentIntervalDays": 14,
      "evidenceSource": "工作手册·第一章1.3",
      "materials": "堰塞湖模型、4种截断识别卡",
      "preparation": "准备截断识别卡",
      "outcomeIndicator": "四类截断信号均有表达出口",
      "failureCriteria": "出现集体辞职或安全事件",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "个案诊断矩阵应用",
      "attributions": [
        "动力错配"
      ],
      "whenToUse": "单个学生问题行为归因与策略匹配",
      "steps": [
        "判能力（会不会）",
        "判意愿（想不想）",
        "定四型（成功/挫折/对抗/放弃）",
        "匹配策略（赋能/拆解/连接/降门槛）"
      ],
      "form": "framework",
      "severity": "medium",
      "timePerSession": "10 分钟",
      "duration": "按需",
      "expectedEffect": "个体行为问题归因清晰并匹配干预策略",
      "effectNote": "个案诊断（个体）区别于五系统（班级整体）诊断",
      "outputArtifact": "个案诊断结论",
      "dimensions": [
        "目标系统"
      ],
      "evidenceSource": "工作手册·第一章1.4",
      "materials": "能力×意愿四象限图、四型策略表",
      "preparation": "准备四象限图",
      "outcomeIndicator": "四型判定完成并给出策略",
      "failureCriteria": "信息不足无法判定",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "班委选拔六步法",
      "attributions": [
        "组织架构空缺"
      ],
      "whenToUse": "开学第1周组建服务型班委",
      "steps": [
        "岗位发布（开学前张贴，1-2年师生共议，3-6年自主申报）",
        "自主报名",
        "岗位答辩（1-2分钟说想做+怎么做）",
        "试用考核（1周）",
        "正式任命",
        "月度培训赋能（8课时例会）"
      ],
      "form": "framework",
      "severity": "medium",
      "timePerSession": "一节课",
      "duration": "开学第1周启动，月度例会",
      "expectedEffect": "服务型班委组建，岗位覆盖率100%",
      "effectNote": "选举-试用-考核，避免『选举即任命』",
      "outputArtifact": "班委任命名单",
      "dimensions": [
        "组织系统",
        "关系系统"
      ],
      "evidenceSource": "工作手册·第三章3.2",
      "materials": "岗位发布海报、答辩评价表",
      "preparation": "准备岗位说明书",
      "outcomeIndicator": "班委履职打卡≥90%",
      "failureCriteria": "无人报名或答辩流于形式",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "班级公约制定六步法",
      "attributions": [
        "公约悬空"
      ],
      "whenToUse": "开学第2周民主制定班级规则（软规则）",
      "steps": [
        "案例收集",
        "小组讨论",
        "全班共商",
        "草拟公约（8-12条）",
        "签字上墙（师生签字）",
        "执行评估（定期修订）"
      ],
      "form": "framework",
      "severity": "medium",
      "timePerSession": "两节课",
      "duration": "开学第2周，月度修订",
      "expectedEffect": "公约知晓率≥90%，违规复发率<20%",
      "effectNote": "软规则（公约）区别于硬制度，签约上墙增强『被制定感』",
      "outputArtifact": "班级公约",
      "dimensions": [
        "规范系统",
        "关系系统"
      ],
      "evidenceSource": "工作手册·第五章5.2 / 第十章10.2",
      "materials": "公约墙模板、签字上墙版",
      "preparation": "准备公约草案",
      "outcomeIndicator": "学生能说出公约条款",
      "failureCriteria": "公约上墙后无人知晓",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "同伴冲突调解·修复性对话",
      "attributions": [
        "同伴联结薄弱",
        "归属感缺失"
      ],
      "whenToUse": "学生打闹/告状/冲突后的关系修复",
      "steps": [
        "分开冷静",
        "各自陈述（事实-影响-感受）",
        "修复性对话（你做了什么/影响了谁/怎么修复）",
        "达成修复约定",
        "跟进复盘"
      ],
      "form": "script",
      "severity": "high",
      "script": "我们先不讨论谁对谁错，先把事实说清楚：发生了什么？影响了谁？你觉得可以怎么修复？",
      "prohibition": "涉及欺凌或安全事件时不适用同伴调解，须启动危机响应流程",
      "timePerSession": "20 分钟",
      "duration": "按需",
      "expectedEffect": "同类冲突复发率下降，调解成功率≥80%",
      "effectNote": "聚焦修复而非追责，是关系修复与文化生成的关键技术",
      "outputArtifact": "修复约定记录",
      "dimensions": [
        "关系系统"
      ],
      "evidenceSource": "技术手册·第七部分危机响应",
      "materials": "修复性对话话术卡",
      "preparation": "准备话术卡",
      "outcomeIndicator": "双方达成修复约定并执行",
      "failureCriteria": "任一方拒绝进入流程",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": [
        {
          "condition": "冲突涉及欺凌或安全事件",
          "type": "block",
          "description": "欺凌/安全事件须启动危机响应流程而非同伴调解",
          "alternative": "启动心理风险A-E响应SOP并上报学校"
        }
      ]
    },
    {
      "name": "师生连接技术",
      "attributions": [
        "亲师依恋断裂",
        "个体情绪失接"
      ],
      "whenToUse": "师生沟通、学生情绪、家长沟通中的连接建立",
      "steps": [
        "73855法则（7%文字/38%语调/55%肢体，70%积极+30%待改进）",
        "意义换框（把『下滑』重构为『成长课题』）",
        "EQ四步（停-听-标-析-选）"
      ],
      "form": "script",
      "severity": "low",
      "script": "听起来你现在很（情绪），是吗？（先跟）那对你最重要的是什么？（上堆）我们可以做哪些尝试？（后带）",
      "timePerSession": "10 分钟",
      "duration": "日常持续",
      "expectedEffect": "师生连接增强，对抗减少",
      "effectNote": "73855/意义换框/EQ为密码本教师核心技术",
      "outputArtifact": "沟通记录",
      "dimensions": [
        "关系系统",
        "情感系统"
      ],
      "evidenceSource": "技术手册·第十六/十八部分",
      "materials": "73855自评表、意义换框练习册、EQ四步海报",
      "preparation": "熟悉73855法则",
      "outcomeIndicator": "学生愿意表达与求助",
      "failureCriteria": "多次尝试仍对抗",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "依恋关系干预技术",
      "attributions": [
        "亲师依恋断裂"
      ],
      "whenToUse": "安全/A(回避)/B(焦虑)/C(抗拒)/D(混乱)五型学生的差异化干预",
      "steps": [
        "安全型：维持安全基地",
        "A型（回避）：主动靠近+低压力邀请",
        "B型（焦虑）：可预测回应+稳定陪伴",
        "C型（抗拒）：先连接情绪再提要求",
        "D型（混乱）：优先建安全感，1个工作日内转介心理专业"
      ],
      "form": "framework",
      "severity": "high",
      "prohibition": "D型（混乱）须1个工作日内转介心理专业，不要独自长时间处理",
      "timePerSession": "按型别",
      "duration": "4-6周/轮",
      "expectedEffect": "主动求助≥2次/周，谈心覆盖率100%",
      "effectNote": "补偿性安全基地：教师可部分弥补不安全家庭依恋",
      "outputArtifact": "依恋干预记录",
      "dimensions": [
        "关系系统"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "技术手册·第十九部分19.3",
      "materials": "依恋类型识别卡、转介沟通话术",
      "preparation": "完成依恋关系观察清单评估",
      "outcomeIndicator": "回避/对抗行为下降",
      "failureCriteria": "D型未及时转介",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "班级团建与仪式感活动",
      "attributions": [
        "归属感缺失",
        "氛围负向",
        "同伴联结薄弱"
      ],
      "whenToUse": "关系激活期凝聚力建设",
      "steps": [
        "周仪式（晨圈/点赞）",
        "月度团建",
        "混搭座位+小组任务",
        "夸夸墙"
      ],
      "form": "exercise",
      "severity": "low",
      "timePerSession": "每周30分钟",
      "duration": "持续",
      "expectedEffect": "低参与学生归零，主动发言≥1次/周",
      "effectNote": "仪式感是正向氛围的稳定器",
      "outputArtifact": "活动记录",
      "dimensions": [
        "关系系统",
        "情感系统"
      ],
      "evidenceSource": "工作手册·文化建设",
      "materials": "团建活动清单、仪式设计模板",
      "preparation": "准备活动清单",
      "outcomeIndicator": "参与率提升",
      "failureCriteria": "活动后无复盘、参与度持续走低",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "班委架构搭建",
      "attributions": [
        "组织架构空缺",
        "运转机制失效"
      ],
      "whenToUse": "班级组织运转、责任分散",
      "steps": [
        "1个大管家（班委）+1个小管家（全班轮值）",
        "2个长期岗位+2个短期项目",
        "区块长制（人人有事做，事事有人管）"
      ],
      "form": "framework",
      "severity": "medium",
      "timePerSession": "一节课",
      "duration": "学期初搭建，每月微调",
      "expectedEffect": "岗位覆盖率100%，事务响应<24h",
      "effectNote": "重塑角色定义（服务而非管），降低『怕得罪人/形同虚设』",
      "outputArtifact": "班委架构图",
      "dimensions": [
        "组织系统"
      ],
      "evidenceSource": "工作手册·第三章3.1",
      "materials": "班委架构图、区块长分工表",
      "preparation": "准备分工表",
      "outcomeIndicator": "人人有事做、事事有人管",
      "failureCriteria": "核心岗位空缺超过1周",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "岗位认领与轮换",
      "attributions": [
        "组织架构空缺",
        "运转机制失效"
      ],
      "whenToUse": "责任岗位长期真空或集中个别人",
      "steps": [
        "长期岗学期初选，稳定运行",
        "短期项目按需发布",
        "轮值制让每人有机会",
        "每月扩展1项新责任"
      ],
      "form": "worksheet",
      "severity": "low",
      "timePerSession": "20 分钟",
      "duration": "每月扩展1项",
      "expectedEffect": "岗位覆盖率提升，责任分散",
      "effectNote": "避免责任岗位真空或集中在个别人",
      "outputArtifact": "岗位认领表",
      "dimensions": [
        "组织系统"
      ],
      "evidenceSource": "工作手册·第三章3.3",
      "materials": "岗位认领表、轮换日历",
      "preparation": "准备认领表",
      "outcomeIndicator": "每人至少1个责任岗位",
      "failureCriteria": "岗位长期无人认领",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "座位编排SOP",
      "attributions": [
        "架构适配失当"
      ],
      "whenToUse": "座位调整（小学敏感动作，需透明有依据）",
      "steps": [
        "明确原则（身高+视力+男女混搭+性格互补+小组合作便利）",
        "拟方案→班级共商→确定",
        "自评座位满意度",
        "每学期调整1-2次"
      ],
      "form": "framework",
      "severity": "low",
      "prohibition": "座位调整需透明有依据，先共商再执行，避免学生产生不公感",
      "timePerSession": "一节课",
      "duration": "每学期1-2次",
      "expectedEffect": "组内贡献方差下降，冲突≤1次/周",
      "effectNote": "按特质与关系分组，避免排座冲突与搭便车",
      "outputArtifact": "座位表",
      "dimensions": [
        "组织系统"
      ],
      "evidenceSource": "工作手册·第十一章11.1.3",
      "materials": "座位编排模板、满意度自评表",
      "preparation": "收集学生意见",
      "outcomeIndicator": "座位满意度自评达标",
      "failureCriteria": "排座引发冲突",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "Kagan合作学习结构",
      "attributions": [
        "同伴联结薄弱",
        "架构适配失当"
      ],
      "whenToUse": "课堂合作、打破小团体、提升参与度",
      "steps": [
        "时钟伙伴（12/3/6/9点找不同伙伴，自然打破小团体）",
        "PIES原则（正向互赖/个体责任/平等参与/同时互动）",
        "从1分钟逐步加长"
      ],
      "form": "framework",
      "severity": "low",
      "timePerSession": "课堂内嵌",
      "duration": "持续",
      "expectedEffect": "小组参与均衡，小团体被打破",
      "effectNote": "结构化合作，解决少数人发言/搭便车/闲聊三大弊病",
      "outputArtifact": "合作任务记录",
      "dimensions": [
        "组织系统",
        "关系系统"
      ],
      "evidenceSource": "技术手册·第十三部分（Kagan）",
      "materials": "时钟伙伴地面标识、PIES检查表",
      "preparation": "设计时钟伙伴分组",
      "outcomeIndicator": "全员参与率提升",
      "failureCriteria": "合作流于形式",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "班规共创与执行评估",
      "attributions": [
        "公约悬空",
        "督导标准不一"
      ],
      "whenToUse": "规则执行乏力、需定期修订",
      "steps": [
        "共识复盘（每月）",
        "执行评估（达标/修订）",
        "配套五星点检",
        "修订启动（制度自转期）"
      ],
      "form": "framework",
      "severity": "medium",
      "timePerSession": "一节班会",
      "duration": "每月",
      "expectedEffect": "规则执行一致性提升，违规复发率<20%",
      "effectNote": "把规则从教师要求转成共同约定并持续评估",
      "outputArtifact": "班规执行评估表",
      "dimensions": [
        "规范系统"
      ],
      "evidenceSource": "工作手册·第五章5.2",
      "materials": "班规执行评估表",
      "preparation": "准备评估表",
      "outcomeIndicator": "违规复发率下降",
      "failureCriteria": "修订后仍无人知晓",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "行为规范督导",
      "attributions": [
        "督导标准不一"
      ],
      "whenToUse": "行为系统日常督导",
      "steps": [
        "日点检（班委/值日班长）",
        "周点检（班主任）",
        "月反馈（家长/五星）",
        "三级网络覆盖五维度"
      ],
      "form": "checklist",
      "severity": "medium",
      "timePerSession": "每日3分钟",
      "duration": "日周月循环",
      "expectedEffect": "处置一致性≥90%",
      "effectNote": "三级点检网络统一督导标准",
      "outputArtifact": "三级点检记录",
      "dimensions": [
        "规范系统"
      ],
      "evidenceSource": "工作手册·第十二章12.2",
      "materials": "三级点检记录表、日周月反馈模板",
      "preparation": "公布行为清单与处置标准",
      "outcomeIndicator": "同行为处置差异≤2级",
      "failureCriteria": "点检流于形式",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "五星正向评价",
      "attributions": [
        "督导标准不一",
        "氛围负向"
      ],
      "whenToUse": "德育常规/学风管理/家校共育评价",
      "steps": [
        "德育常规1-5星",
        "学风管理1-5星",
        "家校共育1-5星",
        "班主任为第一责任人",
        "月度评定，9/12/15星→三/四/五星班级"
      ],
      "form": "checklist",
      "severity": "low",
      "timePerSession": "月度评定",
      "duration": "每月",
      "expectedEffect": "正向评价体系落地，氛围评分≥4.0",
      "effectNote": "引自学校《六力小学班级系统建设制度》",
      "outputArtifact": "五星评定表",
      "dimensions": [
        "规范系统",
        "情感系统"
      ],
      "evidenceSource": "学校《六力小学班级系统建设制度》（工作手册引）",
      "materials": "五星点检标准",
      "preparation": "熟悉五星标准",
      "outcomeIndicator": "月度评定完成",
      "failureCriteria": "评定无依据或流于形式",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "班主任一日工作SOP",
      "attributions": [
        "运转机制失效"
      ],
      "whenToUse": "每日工作节奏把控",
      "steps": [
        "「三个1分钟」（课前组织/课中每15分钟巡视/课后小结）",
        "早读-课间-眼保健操-午餐-放学节点",
        "周班会（班委主舞台，班主任导演）"
      ],
      "form": "framework",
      "severity": "medium",
      "timePerSession": "全天",
      "duration": "每日",
      "expectedEffect": "常规事务响应<24h，积压=0",
      "effectNote": "把每日事务转成固定节奏，降低教师负担",
      "outputArtifact": "一日流程时段表",
      "dimensions": [
        "规范系统",
        "组织系统"
      ],
      "evidenceSource": "工作手册·第六章6.1",
      "materials": "一日流程时段表",
      "preparation": "制定个人时段表",
      "outcomeIndicator": "节点执行无遗漏",
      "failureCriteria": "节奏被打乱后无法恢复",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "班级愿景共建",
      "attributions": [
        "目标缺位"
      ],
      "whenToUse": "目标系统建设、班级方向感",
      "steps": [
        "师生共议『班级想要的样子』",
        "凝练班名/口号/班级目标",
        "上墙可视化"
      ],
      "form": "worksheet",
      "severity": "low",
      "timePerSession": "一节班会",
      "duration": "每学期一次",
      "expectedEffect": "目标覆盖率≥90%，达成率≥70%",
      "effectNote": "把抽象目标转成可观察的班级共识",
      "outputArtifact": "班级愿景墙",
      "dimensions": [
        "目标系统"
      ],
      "reAssessmentIntervalDays": 90,
      "evidenceSource": "工作手册·文化建设",
      "materials": "愿景共创引导卡",
      "preparation": "准备引导卡",
      "outcomeIndicator": "学生能说出班级目标",
      "failureCriteria": "目标只停留在口号",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "个人目标卡与成长档案袋",
      "attributions": [
        "动力错配",
        "目标缺位"
      ],
      "whenToUse": "学生个人发展目标管理",
      "steps": [
        "学期初设个人目标卡",
        "过程记录（档案袋：文字+数据+反思）",
        "家长会/展示日呈现"
      ],
      "form": "worksheet",
      "severity": "low",
      "timePerSession": "20 分钟",
      "duration": "学期制",
      "expectedEffect": "个人目标达成率提升，自主任务发起≥2次/周",
      "effectNote": "用目标卡+档案袋让成长可见",
      "outputArtifact": "个人目标卡/档案袋",
      "dimensions": [
        "目标系统"
      ],
      "evidenceSource": "技术手册·成长档案袋",
      "materials": "目标卡模板、档案袋模板",
      "preparation": "准备目标卡",
      "outcomeIndicator": "档案袋有过程记录",
      "failureCriteria": "目标卡填完即弃",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "目标墙与进度追踪",
      "attributions": [
        "目标缺位"
      ],
      "whenToUse": "目标可视化、持续动力",
      "steps": [
        "目标墙张贴",
        "进度贴纸标记",
        "月度复盘会"
      ],
      "form": "worksheet",
      "severity": "low",
      "timePerSession": "月度复盘20分钟",
      "duration": "持续",
      "expectedEffect": "目标进度可见，持续动力",
      "effectNote": "可视化让目标从墙上走进日常",
      "outputArtifact": "目标墙",
      "dimensions": [
        "目标系统"
      ],
      "evidenceSource": "工作手册·文化建设",
      "materials": "目标墙模板、进度贴纸",
      "preparation": "设计目标墙",
      "outcomeIndicator": "月度复盘会常态化",
      "failureCriteria": "目标墙无人更新",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "情绪角设置",
      "attributions": [
        "个体情绪失接"
      ],
      "whenToUse": "学生情绪失控、需安全空间",
      "steps": [
        "设安全角（软垫/绘本/情绪卡）",
        "建安全信号（举手求助）",
        "允许短暂休息但明确『休息后回来继续』",
        "频率过高（周>3次）转介心理"
      ],
      "form": "framework",
      "severity": "medium",
      "prohibition": "使用频率过高（每周超过3次）须转介心理教师，不能只靠情绪角",
      "timePerSession": "10 分钟/次",
      "duration": "持续",
      "expectedEffect": "情绪角周使用≥3人，情绪失接减少",
      "effectNote": "给情绪一个安全出口",
      "outputArtifact": "情绪角使用记录",
      "dimensions": [
        "情感系统"
      ],
      "evidenceSource": "技术手册·积极心理",
      "materials": "情绪角布置清单、情绪卡片",
      "preparation": "布置情绪角",
      "outcomeIndicator": "情绪角正常使用",
      "failureCriteria": "周使用>3次（提示需转介）",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "正念练习",
      "attributions": [
        "氛围负向",
        "个体情绪失接"
      ],
      "whenToUse": "注意力、情绪调节、课堂静定",
      "steps": [
        "葡萄干练习（30秒观察一颗）",
        "呼吸计时器（3分钟『大脑充电器』）",
        "时段表（晨间/课前/午后）",
        "从1分钟逐步加到3分钟"
      ],
      "form": "exercise",
      "severity": "low",
      "timePerSession": "1-3 分钟",
      "duration": "每日固定时段",
      "expectedEffect": "课堂静定、注意力提升",
      "effectNote": "对外可称『注意力训练』降低家长误解",
      "outputArtifact": "正念时段记录",
      "dimensions": [
        "情感系统"
      ],
      "evidenceSource": "技术手册·第十二部分（正念）",
      "materials": "正念时段表、呼吸计时器APP",
      "preparation": "教师先行练习",
      "outcomeIndicator": "班级静定时间增长",
      "failureCriteria": "学生抗拒练习",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "VIA品格优势培育",
      "attributions": [
        "氛围负向",
        "归属感缺失"
      ],
      "whenToUse": "积极心理、品格发展",
      "steps": [
        "6项小学重点（创造力/勇敢/仁爱/公平/领导力/好奇）",
        "12项优势卡",
        "发现-命名-强化话术",
        "学科渗透（语文渗善良/数学渗坚持）"
      ],
      "form": "exercise",
      "severity": "low",
      "script": "看到小X主动帮助（发现），这是责任优势（命名），为你骄傲（强化）",
      "timePerSession": "每周1次",
      "duration": "持续",
      "expectedEffect": "品格优势被看见，正向氛围提升",
      "effectNote": "与SDQ互补：SDQ查『困难』，VIA查『优势』",
      "outputArtifact": "优势卡记录",
      "dimensions": [
        "情感系统"
      ],
      "evidenceSource": "技术手册·第十五部分（VIA/Seligman）",
      "materials": "VIA 12项小学版核心优势卡",
      "preparation": "准备优势卡",
      "outcomeIndicator": "学生能说出自己的优势",
      "failureCriteria": "流于表扬没有命名强化",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "感恩与赞美仪式",
      "attributions": [
        "氛围负向",
        "归属感缺失"
      ],
      "whenToUse": "情感连接、正向氛围",
      "steps": [
        "每日点赞",
        "夸夸墙",
        "发现-命名-强化话术"
      ],
      "form": "exercise",
      "severity": "low",
      "script": "看到小X主动帮助（发现），这是责任优势（命名），为你骄傲（强化）",
      "timePerSession": "每日3分钟",
      "duration": "持续",
      "expectedEffect": "正向氛围提升，月度氛围评分≥4.0",
      "effectNote": "仪式感是班级温度的建设器",
      "outputArtifact": "夸夸墙",
      "dimensions": [
        "情感系统"
      ],
      "evidenceSource": "工作手册/技术手册",
      "materials": "夸夸墙模板、优势命名话术",
      "preparation": "设置夸夸墙",
      "outcomeIndicator": "每日有点赞发生",
      "failureCriteria": "流于形式",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "心理风险A-E响应SOP",
      "attributions": [
        "危机响应迟滞"
      ],
      "whenToUse": "心理危机五级分级响应",
      "steps": [
        "A级（安全事件）即时处置",
        "B级（高风险：欺凌/自伤）2h内班主任+心理+家长",
        "C级（中度）1周约谈+班级支持",
        "D级（轻度）1月家校沟通",
        "E级（健康）月度追踪",
        "A/B级24-48h上报"
      ],
      "form": "checklist",
      "severity": "crisis",
      "prohibition": "A/B级不得由班主任独自处理，必须24-48h内上报学校",
      "timePerSession": "即时",
      "duration": "按级响应",
      "expectedEffect": "C级24h内启动率100%，漏报=0",
      "effectNote": "A-E五级响应流程，框架参照六力小学制度",
      "outputArtifact": "A-E响应记录",
      "dimensions": [
        "规范系统"
      ],
      "evidenceSource": "工作手册·附录F（框架参照六力制度）",
      "materials": "A-E点检表、响应动作分级卡",
      "preparation": "熟悉A-E分级标准",
      "outcomeIndicator": "分级处置无遗漏",
      "failureCriteria": "迟报漏报",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": [
        {
          "condition": "A级（安全事件）出现自伤/伤他行为",
          "type": "block",
          "description": "A级须24小时内学校+公安+心理转介",
          "alternative": "立即联系学校危机响应组并同步公安/医疗"
        }
      ]
    },
    {
      "name": "危机后班级修复4步",
      "attributions": [
        "危机响应迟滞",
        "同伴联结薄弱"
      ],
      "whenToUse": "危机处置后的班级二次伤害预防",
      "steps": [
        "班会复盘（1周内，『我们学到了什么』代替指责）",
        "关系修复（涉及学生+家长1对1，持续4周）",
        "规则审视（1节班会补漏洞）",
        "班主任自我复盘（3天内，复盘卡）"
      ],
      "form": "framework",
      "severity": "high",
      "timePerSession": "1节班会+1对1",
      "duration": "4周/轮",
      "expectedEffect": "班级二次伤害预防，关系修复完成",
      "effectNote": "危机后修复与文化生成，区别于惩罚式处理",
      "outputArtifact": "危机处理复盘卡",
      "dimensions": [
        "关系系统"
      ],
      "evidenceSource": "工作手册·第八章8.4",
      "materials": "危机处理复盘卡",
      "preparation": "准备复盘卡",
      "outcomeIndicator": "复盘完成且班级恢复稳定",
      "failureCriteria": "回避复盘或互相指责",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "绘画投射筛查后处理",
      "attributions": [
        "危机响应迟滞",
        "个体情绪失接"
      ],
      "whenToUse": "绘画筛查红旗信号的专业跟进",
      "steps": [
        "红旗清单判定风险等级（红/橙/黄/绿）",
        "红/橙级转介学校心理专业",
        "保护性因素降级评估",
        "家校沟通协作"
      ],
      "form": "checklist",
      "severity": "high",
      "prohibition": "绘画筛查是筛查工具非诊断结论，不得据此给学生贴标签",
      "timePerSession": "30 分钟",
      "duration": "按需",
      "expectedEffect": "红旗信号及时转介，转介及时",
      "effectNote": "与SDQ、A-E点检构成多源风险识别",
      "outputArtifact": "筛查结论与转介建议",
      "dimensions": [
        "情感系统",
        "规范系统"
      ],
      "evidenceSource": "评估库A06对接 / 绘画投射分析参考",
      "materials": "绘画筛查指标表、转介沟通话术",
      "preparation": "完成绘画投射筛查",
      "outcomeIndicator": "红/橙级全部转介",
      "failureCriteria": "红旗信号未跟进",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "情绪急救三步法",
      "attributions": [
        "个体情绪失接",
        "危机响应迟滞"
      ],
      "whenToUse": "即时情绪崩溃的现场处置",
      "steps": [
        "停（安全隔开，移除危险源）",
        "听（共情倾听，不评判）",
        "析-选（EQ四步：标情绪-析需求-选行动）"
      ],
      "form": "script",
      "severity": "crisis",
      "script": "我听到你现在很（标情绪），你希望（析需求），我们可以（选行动）。",
      "prohibition": "周使用超过3次须转介学校心理老师",
      "timePerSession": "5-10 分钟",
      "duration": "即时",
      "expectedEffect": "现场情绪平复，无升级",
      "effectNote": "危机『即时』层技术，与EQ四步呼应",
      "outputArtifact": "处置记录",
      "dimensions": [
        "情感系统"
      ],
      "evidenceSource": "技术手册·密码本/EQ",
      "materials": "情绪急救流程卡、EQ四步海报",
      "preparation": "熟记EQ四步",
      "outcomeIndicator": "现场情绪稳定",
      "failureCriteria": "频繁使用（周>3次）",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": [
        {
          "condition": "存在自伤/伤他风险",
          "type": "block",
          "description": "情绪急救只处理情绪，安全风险须立即启动A-E响应",
          "alternative": "启动心理风险A-E响应SOP并上报"
        }
      ]
    },
    {
      "name": "家校沟通SOP",
      "attributions": [
        "家校连接松散"
      ],
      "whenToUse": "家长日常反馈与投诉处理",
      "steps": [
        "日常反馈（73855：70%积极+30%待改进）",
        "投诉处理（先跟后带+意义换框）",
        "结构化表达（事实-影响-建议）"
      ],
      "form": "script",
      "severity": "low",
      "script": "先说事实，再说影响，最后给建议；积极与待改进保持70:30。",
      "timePerSession": "10 分钟",
      "duration": "每周1次反馈",
      "expectedEffect": "关键通知响应率≥85%",
      "effectNote": "三通工程+73855法则配套使用",
      "outputArtifact": "沟通记录",
      "dimensions": [
        "关系系统"
      ],
      "evidenceSource": "工作手册·第七章7.4 / 技术手册·第十八部分",
      "materials": "73855沟通法则、分场景话术库",
      "preparation": "熟悉73855法则",
      "outcomeIndicator": "家长群响应率提升",
      "failureCriteria": "沟通单向无回执",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "家长会4种形式",
      "attributions": [
        "家校连接松散"
      ],
      "whenToUse": "家长会设计与实施",
      "steps": [
        "从『情况通报』升级为『共同叙事』",
        "4形式（全体/小组/工作坊/学生主导）",
        "先展示非学业成就再谈学业"
      ],
      "form": "framework",
      "severity": "low",
      "timePerSession": "1-2 小时",
      "duration": "每学期1-2次",
      "expectedEffect": "家长参与度提升，参与门槛降低",
      "effectNote": "把家长会从通报会变成共同叙事场",
      "outputArtifact": "家长会方案",
      "dimensions": [
        "关系系统"
      ],
      "evidenceSource": "工作手册·第七章7.3",
      "materials": "家长会形式选择表、共同叙事模板",
      "preparation": "选择家长会形式",
      "outcomeIndicator": "家长到场率提升",
      "failureCriteria": "流于情况通报",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    },
    {
      "name": "家访与家长工作坊",
      "attributions": [
        "家校连接松散"
      ],
      "whenToUse": "深度协同、降低参与门槛",
      "steps": [
        "个别家访（针对需额外支持学生）",
        "家长工作坊（每学期1次主题技能）",
        "降低门槛（把『参会』改为『群里回个表情』）"
      ],
      "form": "framework",
      "severity": "low",
      "timePerSession": "家访30分钟",
      "duration": "每学期1次工作坊",
      "expectedEffect": "家访覆盖率提升，家校深度协同",
      "effectNote": "降低参与门槛让家校连接持续发生",
      "outputArtifact": "家访记录",
      "dimensions": [
        "关系系统"
      ],
      "evidenceSource": "工作手册/技术手册·家校共育",
      "materials": "家访提纲、工作坊方案模板",
      "preparation": "制定家访提纲",
      "outcomeIndicator": "家访完成率提升",
      "failureCriteria": "家长拒绝沟通",
      "crossModuleTags": [],
      "collaborativeTools": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "contraindications": []
    }
  ],
  "keywords": [
    {
      "core": [
        "五系统",
        "班级系统"
      ],
      "expanded": [
        "定位短板",
        "班级体检"
      ],
      "category": "诊断框架类",
      "scale": "五系统自评表",
      "tool": "五系统诊断向导",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "五系统诊断模型：定位短板属于哪类系统"
    },
    {
      "core": [
        "能量场",
        "班级氛围"
      ],
      "expanded": [
        "生命体征",
        "集体势能"
      ],
      "category": "诊断框架类",
      "scale": "班级能量场问卷·教师版",
      "tool": "班级团建与仪式感活动",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "班级能量场：无形心理氛围与集体势能"
    },
    {
      "core": [
        "堰塞湖",
        "问题积累"
      ],
      "expanded": [
        "突然爆发",
        "集体辞职",
        "凝聚力骤降"
      ],
      "category": "诊断框架类",
      "scale": "五系统自评表",
      "tool": "堰塞湖破局法",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "堰塞湖模型：问题积累到爆发，需在低水位时疏通"
    },
    {
      "core": [
        "能力意愿",
        "个案诊断"
      ],
      "expanded": [
        "成功型",
        "挫折型",
        "对抗型",
        "放弃型"
      ],
      "category": "诊断框架类",
      "scale": "个案诊断矩阵",
      "tool": "个案诊断矩阵应用",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "能力×意愿矩阵：个体行为问题归因"
    },
    {
      "core": [
        "五星评价",
        "五星班级"
      ],
      "expanded": [
        "德育常规",
        "学风管理",
        "家校共育"
      ],
      "category": "评价与制度类",
      "tool": "五星正向评价",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "green",
      "description": "五星评价：三维度1-5星，月度评定"
    },
    {
      "core": [
        "三通",
        "家校群"
      ],
      "expanded": [
        "通情",
        "通理",
        "通力"
      ],
      "category": "评价与制度类",
      "tool": "家校沟通SOP",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "green",
      "description": "三通工程：家校协同三项机制，关键是持续做"
    },
    {
      "core": [
        "心理风险",
        "A-E",
        "安全危机"
      ],
      "expanded": [
        "高风险",
        "自伤",
        "上报"
      ],
      "category": "评价与制度类",
      "scale": "心理风险A-E点检表",
      "tool": "心理风险A-E响应SOP",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "red",
      "description": "心理风险A-E五级，A/B级须24-48h上报"
    },
    {
      "core": [
        "SDQ",
        "优势困难问卷"
      ],
      "expanded": [
        "情绪症状",
        "隐形焦虑"
      ],
      "category": "评价与制度类",
      "scale": "SDQ小学生心理筛查量表（使用指引）",
      "tool": "心理风险A-E响应SOP",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "SDQ外部量表，筛查非诊断，严禁贴标签"
    },
    {
      "core": [
        "VIA",
        "品格优势",
        "优势卡"
      ],
      "expanded": [
        "创造力",
        "勇敢",
        "仁爱"
      ],
      "category": "评价与制度类",
      "tool": "VIA品格优势培育",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "green",
      "description": "VIA品格优势：SDQ查困难，VIA查优势"
    },
    {
      "core": [
        "依恋",
        "回避型",
        "焦虑型",
        "混乱型"
      ],
      "expanded": [
        "安全基地",
        "插嘴",
        "不服管"
      ],
      "category": "关系与依恋类",
      "scale": "依恋关系观察清单",
      "tool": "依恋关系干预技术",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "依恋关系四型：问题行为多与依恋根源有关"
    },
    {
      "core": [
        "安全基地"
      ],
      "expanded": [
        "补偿性安全基地",
        "在这里是安全的"
      ],
      "category": "关系与依恋类",
      "tool": "依恋关系干预技术",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "安全基地：安全感充足的孩子更敢探索"
    },
    {
      "core": [
        "73855",
        "沟通密码"
      ],
      "expanded": [
        "7%文字",
        "38%语调",
        "55%肢体"
      ],
      "category": "密码本技术类",
      "tool": "家校沟通SOP",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "green",
      "description": "73855法则：70%积极+30%待改进的结构化表达"
    },
    {
      "core": [
        "意义换框"
      ],
      "expanded": [
        "成长课题",
        "重构"
      ],
      "category": "密码本技术类",
      "tool": "师生连接技术",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "意义换框法：从负面事件挖出正面意义"
    },
    {
      "core": [
        "EQ",
        "处理情绪"
      ],
      "expanded": [
        "停听标析选",
        "情绪沟通"
      ],
      "category": "密码本技术类",
      "scale": "心理风险A-E点检表",
      "tool": "情绪急救三步法",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "EQ型处理情绪：停-听-标-析-选五步"
    },
    {
      "core": [
        "六步脱困",
        "我做不到"
      ],
      "expanded": [
        "还没做到",
        "限制性信念"
      ],
      "category": "密码本技术类",
      "tool": "师生连接技术",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "六步脱困法：把『我做不到』变成『我还没做到』"
    },
    {
      "core": [
        "经典八问"
      ],
      "expanded": [
        "结构化提问",
        "问题解决"
      ],
      "category": "密码本技术类",
      "tool": "师生连接技术",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "经典八问：上手最快、适用范围最广的结构化提问"
    },
    {
      "core": [
        "先跟后带"
      ],
      "expanded": [
        "对抗",
        "共情跟随",
        "上堆"
      ],
      "category": "密码本技术类",
      "tool": "师生连接技术",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "先跟后带：处理沟通模式与对抗"
    },
    {
      "core": [
        "内感官"
      ],
      "expanded": [
        "视觉型",
        "听觉型",
        "感觉型"
      ],
      "category": "密码本技术类",
      "tool": "师生连接技术",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "green",
      "description": "内感官：按信息接收偏好提升沟通效率"
    },
    {
      "core": [
        "正念",
        "注意力训练"
      ],
      "expanded": [
        "葡萄干练习",
        "大脑充电器",
        "静不下来"
      ],
      "category": "积极心理类",
      "tool": "正念练习",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "正念教育：对『静不下来/注意力散/情绪爆发』有效"
    },
    {
      "core": [
        "Kagan",
        "合作学习"
      ],
      "expanded": [
        "时钟伙伴",
        "小组讨论",
        "搭便车"
      ],
      "category": "积极心理类",
      "tool": "Kagan合作学习结构",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "Kagan合作学习：解决少数人发言/搭便车/闲聊"
    },
    {
      "core": [
        "成长型思维"
      ],
      "expanded": [
        "我不行",
        "还没找到方法",
        "错误分析档案"
      ],
      "category": "积极心理类",
      "tool": "个人目标卡与成长档案袋",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "成长型思维：把『我不行』重框为『还没找到方法』"
    },
    {
      "core": [
        "PERMA"
      ],
      "expanded": [
        "积极情绪",
        "投入",
        "关系",
        "意义",
        "成就"
      ],
      "category": "积极心理类",
      "tool": "感恩与赞美仪式",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "green",
      "description": "PERMA幸福公式：每月选一维度设计班级活动"
    },
    {
      "core": [
        "区块长"
      ],
      "expanded": [
        "人人有事做",
        "事事有人管",
        "责任区划"
      ],
      "category": "组织与规范类",
      "tool": "班委架构搭建",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "区块长：责任区划由学生认领，避免只靠班委"
    },
    {
      "core": [
        "大管家",
        "小管家"
      ],
      "expanded": [
        "班干部",
        "班级小管家"
      ],
      "category": "组织与规范类",
      "tool": "班委架构搭建",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "大管家+小管家：班级服务者角色重构"
    },
    {
      "core": [
        "班委",
        "竞选",
        "班干部"
      ],
      "expanded": [
        "岗位答辩",
        "试用考核",
        "没人干活"
      ],
      "category": "组织与规范类",
      "scale": "五系统自评表",
      "tool": "班委选拔六步法",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "班委选拔六步法：组建服务型班委"
    },
    {
      "core": [
        "公约",
        "班规",
        "班级规则"
      ],
      "expanded": [
        "签字上墙",
        "规则没人听"
      ],
      "category": "组织与规范类",
      "scale": "五系统自评表",
      "tool": "班级公约制定六步法",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "班级公约六步法：民主制定软规则"
    },
    {
      "core": [
        "修复性对话",
        "冲突修复"
      ],
      "expanded": [
        "打闹",
        "告状",
        "修复约定"
      ],
      "category": "组织与规范类",
      "scale": "心理风险A-E点检表",
      "tool": "同伴冲突调解·修复性对话",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "修复性对话：聚焦修复而非追责"
    },
    {
      "core": [
        "危机",
        "危机响应"
      ],
      "expanded": [
        "自伤",
        "欺凌",
        "漏报",
        "迟报"
      ],
      "category": "危机与筛查类",
      "scale": "心理风险A-E点检表",
      "tool": "心理风险A-E响应SOP",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "red",
      "description": "危机响应A-E分级：以制度原文A-E五级为准"
    },
    {
      "core": [
        "情绪崩溃",
        "情绪急救"
      ],
      "expanded": [
        "大哭",
        "失控",
        "现场处置"
      ],
      "category": "危机与筛查类",
      "scale": "心理风险A-E点检表",
      "tool": "情绪急救三步法",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "red",
      "description": "情绪急救三步法：停-听-析选"
    },
    {
      "core": [
        "绘画",
        "房树人",
        "雨中人",
        "树木画"
      ],
      "expanded": [
        "红旗清单",
        "转介"
      ],
      "category": "危机与筛查类",
      "scale": "绘画投射筛查",
      "tool": "绘画投射筛查后处理",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "绘画投射筛查：筛查非诊断，红橙级转介"
    },
    {
      "core": [
        "班级乱",
        "纪律差",
        "管不住"
      ],
      "expanded": [
        "课堂混乱",
        "说话没人听",
        "违规反复"
      ],
      "category": "场景路由",
      "scale": "五系统自评表",
      "tool": "班规共创与执行评估",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "班级秩序失控：规则认同与督导问题"
    },
    {
      "core": [
        "打架",
        "吵架",
        "同学矛盾"
      ],
      "expanded": [
        "闹翻了",
        "不理人",
        "起冲突"
      ],
      "category": "场景路由",
      "scale": "班级能量场问卷·教师版",
      "tool": "同伴冲突调解·修复性对话",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "同伴冲突：需要修复性对话与缓冲层"
    },
    {
      "core": [
        "被孤立",
        "没朋友",
        "不合群"
      ],
      "expanded": [
        "没人跟他玩",
        "排挤",
        "隐形人"
      ],
      "category": "场景路由",
      "scale": "班级能量场问卷·学生版",
      "tool": "班级团建与仪式感活动",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "同伴排斥与孤立：归属感连接通道缺失"
    },
    {
      "core": [
        "成绩下滑",
        "知识欠账",
        "跟不上"
      ],
      "expanded": [
        "断崖式下跌",
        "听不懂"
      ],
      "category": "场景路由",
      "tool": "堰塞湖破局法",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "学业欠账堆积：需溯源补漏、降难度回填"
    },
    {
      "core": [
        "情绪失控",
        "发脾气",
        "哭闹"
      ],
      "expanded": [
        "情绪角",
        "冷静角"
      ],
      "category": "场景路由",
      "scale": "心理风险A-E点检表",
      "tool": "情绪角设置",
      "exclude": [],
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "情绪失控：先给安全空间再接住情绪"
    }
  ],
  "defaultLevelName": "文化生成期",
  "defaultMessage": "五系统自评总分60-75分：班级健康，各系统自主运转，已进入文化生成期，保持现有节奏、持续沉淀班级文化即可。"
}