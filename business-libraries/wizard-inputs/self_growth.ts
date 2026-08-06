import type { WizardInput } from '../../shared/business-wizard'

// self_growth 模块向导输入（4.2.0，三库提炼版）
// 来源文档（docs/2026_07_27_家校沟通与合作-工具库、评估库、专业知识库0722/个人成长模块-工具库、评估库、专业知识库/）：
//   1. 教师自我成长模块_量表整理.xlsx —— 五问自评（5 题）/ HERO+AS+PCS（20 题）/ 六维深度评估（46 题，6 个量表）
//   2. 教师自我成长工具库.xlsx —— 处方总表 RX-001~RX-081（81 个处方）
//   3. 教师自我成长赋能_专业知识库_术语解读.xlsx —— 78 条术语，提炼归因项与关键词路由
// 版本：4.2.0；sourceRef：个人成长 2.0 三库文档（2026-07-27 版）
export const SELF_GROWTH_WIZARD_INPUT: WizardInput = {
  "module": "self_growth",
  "version": "4.2.0",
  "sourceRef": "个人成长 2.0 三库文档（2026-07-27 版）",
  "defaults": {
    "schoolSection": "all",
    "targetAudience": "teacher",
    "formType": "self_report",
    "triggerMethod": "manual",
    "frequency": "monthly",
    "resultVisibility": "teacher_only",
    "responsibleRole": "班主任",
    "dataSensitivity": "sensitive",
    "sourceType": "proprietary",
    "evidenceLevel": "B",
    "redLineScope": "module",
    "redLineActions": "停止当前评估流程；展示危机求助指引；创建安全事件；生成转介工单；短信通知心理专员",
    "redLineRecovery": "当事教师完成心理专员面谈，且专员在系统中标记为「已处置」",
    "redLineOwner": "心理专员"
  },
  "computedVariables": [
    {
      "name": "状态总分",
      "scale": "教师自我成长五问自评",
      "expression": "总分"
    }
  ],
  "optionGroups": [
    {
      "id": "cg-confidence",
      "name": "信心程度五点",
      "options": [
        {
          "label": "完全没有信心"
        },
        {
          "label": "信心不足"
        },
        {
          "label": "一般"
        },
        {
          "label": "比较有信心"
        },
        {
          "label": "非常有信心"
        }
      ]
    },
    {
      "id": "cg-as",
      "name": "依恋调节能力五点",
      "options": [
        {
          "label": "几乎不能"
        },
        {
          "label": "很少能"
        },
        {
          "label": "有时能"
        },
        {
          "label": "经常能"
        },
        {
          "label": "总是能"
        }
      ]
    },
    {
      "id": "cg-severity",
      "name": "压力严重程度五点",
      "options": [
        {
          "label": "完全没有"
        },
        {
          "label": "有一点"
        },
        {
          "label": "中等"
        },
        {
          "label": "较严重"
        },
        {
          "label": "非常严重"
        }
      ]
    },
    {
      "id": "cg-mbi",
      "name": "MBI频率七点",
      "options": [
        {
          "label": "从不",
          "score": 0
        },
        {
          "label": "一年几次",
          "score": 1
        },
        {
          "label": "每月一次",
          "score": 2
        },
        {
          "label": "一月几次",
          "score": 3
        },
        {
          "label": "每周一次",
          "score": 4
        },
        {
          "label": "一周几次",
          "score": 5
        },
        {
          "label": "每天",
          "score": 6
        }
      ]
    },
    {
      "id": "cg-psqi1",
      "name": "入睡时长四档",
      "options": [
        {
          "label": "15分钟以内",
          "score": 0
        },
        {
          "label": "16-30分钟",
          "score": 1
        },
        {
          "label": "31-60分钟",
          "score": 2
        },
        {
          "label": "超过60分钟",
          "score": 3
        }
      ]
    },
    {
      "id": "cg-psqi2",
      "name": "睡眠时长四档",
      "options": [
        {
          "label": "超过7小时",
          "score": 0
        },
        {
          "label": "6-7小时",
          "score": 1
        },
        {
          "label": "5-6小时",
          "score": 2
        },
        {
          "label": "不足5小时",
          "score": 3
        }
      ]
    },
    {
      "id": "cg-psqi3",
      "name": "睡眠问题频率四档",
      "options": [
        {
          "label": "无",
          "score": 0
        },
        {
          "label": "每周不到1次",
          "score": 1
        },
        {
          "label": "每周1-2次",
          "score": 2
        },
        {
          "label": "每周3次及以上",
          "score": 3
        }
      ]
    },
    {
      "id": "cg-psqi4",
      "name": "睡眠效率四档",
      "options": [
        {
          "label": "超过85%",
          "score": 0
        },
        {
          "label": "75-84%",
          "score": 1
        },
        {
          "label": "65-74%",
          "score": 2
        },
        {
          "label": "不足65%",
          "score": 3
        }
      ]
    },
    {
      "id": "cg-psqi5",
      "name": "主观睡眠质量四档",
      "options": [
        {
          "label": "很好",
          "score": 0
        },
        {
          "label": "较好",
          "score": 1
        },
        {
          "label": "较差",
          "score": 2
        },
        {
          "label": "很差",
          "score": 3
        }
      ]
    },
    {
      "id": "cg-bpnsf",
      "name": "基本需要符合七点",
      "options": [
        {
          "label": "完全不符合",
          "score": 1
        },
        {
          "label": "不符合",
          "score": 2
        },
        {
          "label": "比较不符合",
          "score": 3
        },
        {
          "label": "一般",
          "score": 4
        },
        {
          "label": "比较符合",
          "score": 5
        },
        {
          "label": "符合",
          "score": 6
        },
        {
          "label": "完全符合",
          "score": 7
        }
      ]
    }
  ],
  "scales": [
    {
      "name": "教师自我成长五问自评",
      "role": "入口筛查",
      "shortName": "五问自评",
      "description": "回顾最近一周的真实状态，3 分钟完成，系统按六色预警给出提示。总分越高越需关注；Q3、Q4 为保护性题目需反向计分。",
      "minutes": 3,
      "prerequisites": [],
      "exclusives": [],
      "triggerConditions": [],
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "情绪状态",
          "calcMethod": "mean",
          "weight": 1,
          "description": "身心疲惫难以恢复的频率",
          "highInterpretation": "情绪耗竭风险高",
          "lowInterpretation": "情绪状态良好"
        },
        {
          "name": "角色边界",
          "calcMethod": "mean",
          "weight": 1,
          "description": "「什么都是我的责任」的频率",
          "highInterpretation": "责任边界模糊，独自承接全部问题",
          "lowInterpretation": "职责边界清晰"
        },
        {
          "name": "意义感知",
          "calcMethod": "mean",
          "weight": 1,
          "description": "「当班主任是值得的」的频率（反向计分）",
          "highInterpretation": "意义感流失（转换分高）",
          "lowInterpretation": "意义感充足"
        },
        {
          "name": "效能信心",
          "calcMethod": "mean",
          "weight": 1,
          "description": "处理棘手问题的信心（反向计分）",
          "highInterpretation": "效能信心不足（转换分高）",
          "lowInterpretation": "效能感稳定"
        },
        {
          "name": "同伴支持",
          "calcMethod": "mean",
          "weight": 1,
          "description": "困难无人分担的频率",
          "highInterpretation": "支持来源长期缺失",
          "lowInterpretation": "有稳定的支持来源"
        }
      ],
      "questions": [
        {
          "text": "这一周，我有多少时间感到身心疲惫、难以恢复？",
          "dimension": "情绪状态",
          "optionGroup": "FREQ_5",
          "reverse": false
        },
        {
          "text": "这一周，我有多少次感到\"什么都是我的责任\"？",
          "dimension": "角色边界",
          "optionGroup": "FREQ_5",
          "reverse": false
        },
        {
          "text": "这一周，有多少次我觉得\"当班主任是值得的\"？",
          "dimension": "意义感知",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "遇到让我头疼的学生或家长问题时，我对自己能处理好有多大信心？",
          "dimension": "效能信心",
          "optionGroup": "cg-confidence",
          "reverse": true
        },
        {
          "text": "这一周，我有多少时间感到工作中的困难没有人可以分担？",
          "dimension": "同伴支持",
          "optionGroup": "FREQ_5",
          "reverse": false
        }
      ]
    },
    {
      "name": "HERO心理资本与依恋安全感评估",
      "role": "深度诊断",
      "shortName": "HERO+AS+PCS",
      "description": "12 题心理资本（HERO）+3 题依恋安全感快筛（AS）+5 题家长沟通压力（PCS），全部正向计分，得分越低越需关注。",
      "minutes": 10,
      "prerequisites": [
        "教师自我成长五问自评"
      ],
      "exclusives": [],
      "triggerConditions": [
        {
          "targetType": "total",
          "target": "",
          "comparator": "达到或超过",
          "value": 15,
          "join": "且"
        }
      ],
      "triggerNote": "五问自评总分达到 15 分及以上（消耗型区间）时建议做深度评估",
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "H·职业希望",
          "calcMethod": "sum",
          "weight": 1,
          "description": "职业希望，3 题之和 3-15 分",
          "highInterpretation": "对目标路径有清晰规划",
          "lowInterpretation": "看不到可行路径"
        },
        {
          "name": "E·职业效能",
          "calcMethod": "sum",
          "weight": 1,
          "description": "职业效能，3 题之和 3-15 分",
          "highInterpretation": "相信自己能应对挑战",
          "lowInterpretation": "对自身能力持续怀疑"
        },
        {
          "name": "R·职业韧性",
          "calcMethod": "sum",
          "weight": 1,
          "description": "职业韧性，3 题之和 3-15 分",
          "highInterpretation": "受挫后能较快恢复",
          "lowInterpretation": "受挫后长时间难以恢复"
        },
        {
          "name": "O·职业乐观",
          "calcMethod": "sum",
          "weight": 1,
          "description": "职业乐观，3 题之和 3-15 分",
          "highInterpretation": "对未来持积极预期",
          "lowInterpretation": "倾向于预期负面结果"
        },
        {
          "name": "依恋稳定度",
          "calcMethod": "mean",
          "weight": 1,
          "description": "面对学生强烈情感需求时能否稳定回应"
        },
        {
          "name": "依恋开放度",
          "calcMethod": "mean",
          "weight": 1,
          "description": "面对家长质疑时能否保护自尊同时保持情感开放"
        },
        {
          "name": "依恋恢复度",
          "calcMethod": "mean",
          "weight": 1,
          "description": "情感挫折后能否找到恢复安全感的方式"
        },
        {
          "name": "时间边界",
          "calcMethod": "mean",
          "weight": 1,
          "description": "非工作时间被联系时的边界侵犯感"
        },
        {
          "name": "自我怀疑",
          "calcMethod": "mean",
          "weight": 1,
          "description": "面对质疑投诉时的委屈无力与自我怀疑"
        },
        {
          "name": "时间消耗",
          "calcMethod": "mean",
          "weight": 1,
          "description": "家长沟通挤占备课与休息时间的程度"
        },
        {
          "name": "过度监督",
          "calcMethod": "mean",
          "weight": 1,
          "description": "被家长过度监督的感受"
        },
        {
          "name": "协作受阻",
          "calcMethod": "mean",
          "weight": 1,
          "description": "家长指责教师管理不到位的程度"
        }
      ],
      "questions": [
        {
          "text": "我对未来的职业发展有清晰的规划",
          "dimension": "H·职业希望",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我知道如何成为一个更好的班主任",
          "dimension": "H·职业希望",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "即使遇到挫折，我也有多种方法可以实现我的职业目标",
          "dimension": "H·职业希望",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我相信自己能够管理好我的班级",
          "dimension": "E·职业效能",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我相信我能够与家长建立有效的沟通",
          "dimension": "E·职业效能",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我相信我能够帮助问题学生取得进步",
          "dimension": "E·职业效能",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "当学生的问题让我受挫时，我能恢复过来继续工作",
          "dimension": "R·职业韧性",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我能从职业挫折中找到成长的资源",
          "dimension": "R·职业韧性",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "即使连续遇到困难，我也能坚持做班主任",
          "dimension": "R·职业韧性",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我的努力通常能带来正面的改变",
          "dimension": "O·职业乐观",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "当事情不顺利时，我相信这是可以改变的",
          "dimension": "O·职业乐观",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我相信我正在成为一个更好的老师",
          "dimension": "O·职业乐观",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "当学生向我表达强烈情感需求时，我通常能稳定回应而不会过度卷入或回避",
          "dimension": "依恋稳定度",
          "optionGroup": "cg-as",
          "reverse": false
        },
        {
          "text": "面对家长的质疑或不满，我能够在保护自尊的同时保持情感开放",
          "dimension": "依恋开放度",
          "optionGroup": "cg-as",
          "reverse": false
        },
        {
          "text": "工作中遇到情感挫折时，我能找到让自己恢复安全感的方式",
          "dimension": "依恋恢复度",
          "optionGroup": "cg-as",
          "reverse": false
        },
        {
          "text": "家长随时通过微信/电话联系我，即使在非工作时间，让我感到边界被侵犯",
          "dimension": "时间边界",
          "optionGroup": "cg-severity",
          "reverse": false
        },
        {
          "text": "面对家长的质疑或投诉时，我感到委屈、无力，甚至出现自我怀疑",
          "dimension": "自我怀疑",
          "optionGroup": "cg-severity",
          "reverse": false
        },
        {
          "text": "需要花费大量时间回复家长群消息、发送通知、解释学校政策，挤占备课和休息时间",
          "dimension": "时间消耗",
          "optionGroup": "cg-severity",
          "reverse": false
        },
        {
          "text": "部分家长对学生在校细节过度关注，让我感到被过度监督",
          "dimension": "过度监督",
          "optionGroup": "cg-severity",
          "reverse": false
        },
        {
          "text": "当学生出现行为问题时，家长倾向于指责教师\"管理不到位\"，而非共同协作解决",
          "dimension": "协作受阻",
          "optionGroup": "cg-severity",
          "reverse": false
        }
      ]
    },
    {
      "name": "教师六维深度评估",
      "role": "深度诊断",
      "shortName": "六维深评",
      "description": "含 MBI-EE 情绪衰竭、PSQI-5 睡眠、HERO 心理资本、BPNSF 基本需要、职业认同、PCS 家长沟通压力 6 个量表共 46 题。六维度各自按阈值分级后取最高预警等级；职业认同<2.5 分触发紫色（意义危机）预警。",
      "minutes": 25,
      "prerequisites": [
        "HERO心理资本与依恋安全感评估"
      ],
      "exclusives": [],
      "triggerConditions": [
        {
          "targetType": "dimension",
          "target": "H·职业希望",
          "comparator": "低于或等于",
          "value": 8,
          "join": "且"
        },
        {
          "targetType": "dimension",
          "target": "E·职业效能",
          "comparator": "低于或等于",
          "value": 8,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "R·职业韧性",
          "comparator": "低于或等于",
          "value": 8,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "O·职业乐观",
          "comparator": "低于或等于",
          "value": 8,
          "join": "或"
        }
      ],
      "triggerNote": "HERO 任一维度≤8 分（中度不足）时建议做六维深度评估；也可由顾问判断或学期初制度性安排触发",
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "情绪耗竭",
          "calcMethod": "mean",
          "weight": 2.2
        },
        {
          "name": "精力耗尽",
          "calcMethod": "mean",
          "weight": 2.2
        },
        {
          "name": "晨起疲惫",
          "calcMethod": "mean",
          "weight": 2.2
        },
        {
          "name": "人际压力",
          "calcMethod": "mean",
          "weight": 2.2
        },
        {
          "name": "身心俱疲",
          "calcMethod": "mean",
          "weight": 2.2
        },
        {
          "name": "工作挫折",
          "calcMethod": "mean",
          "weight": 2.2
        },
        {
          "name": "过度努力",
          "calcMethod": "mean",
          "weight": 2.2
        },
        {
          "name": "直接压力",
          "calcMethod": "mean",
          "weight": 2.2
        },
        {
          "name": "到达极限",
          "calcMethod": "mean",
          "weight": 2.2
        },
        {
          "name": "入睡时间",
          "calcMethod": "mean",
          "weight": 1.5
        },
        {
          "name": "睡眠时间",
          "calcMethod": "mean",
          "weight": 1.5
        },
        {
          "name": "睡眠障碍",
          "calcMethod": "mean",
          "weight": 1.5
        },
        {
          "name": "睡眠效率",
          "calcMethod": "mean",
          "weight": 1.5
        },
        {
          "name": "主观质量",
          "calcMethod": "mean",
          "weight": 1.5
        },
        {
          "name": "H·职业希望",
          "calcMethod": "sum",
          "weight": 1.8
        },
        {
          "name": "E·职业效能",
          "calcMethod": "sum",
          "weight": 1.8
        },
        {
          "name": "R·职业韧性",
          "calcMethod": "sum",
          "weight": 1.8
        },
        {
          "name": "O·职业乐观",
          "calcMethod": "sum",
          "weight": 1.8
        },
        {
          "name": "自主需要",
          "calcMethod": "sum",
          "weight": 1.8
        },
        {
          "name": "能力需要",
          "calcMethod": "sum",
          "weight": 1.8
        },
        {
          "name": "关系需要",
          "calcMethod": "sum",
          "weight": 1.8
        },
        {
          "name": "价值认同",
          "calcMethod": "mean",
          "weight": 1.2
        },
        {
          "name": "再选意愿",
          "calcMethod": "mean",
          "weight": 1.2
        },
        {
          "name": "职业自豪",
          "calcMethod": "mean",
          "weight": 1.2
        },
        {
          "name": "长期意愿",
          "calcMethod": "mean",
          "weight": 1.2
        },
        {
          "name": "自我一致",
          "calcMethod": "mean",
          "weight": 1.2
        },
        {
          "name": "价值实现",
          "calcMethod": "mean",
          "weight": 1.2
        },
        {
          "name": "时间边界",
          "calcMethod": "mean",
          "weight": 1.5
        },
        {
          "name": "自我怀疑",
          "calcMethod": "mean",
          "weight": 1.5
        },
        {
          "name": "时间消耗",
          "calcMethod": "mean",
          "weight": 1.5
        },
        {
          "name": "过度监督",
          "calcMethod": "mean",
          "weight": 1.5
        },
        {
          "name": "协作受阻",
          "calcMethod": "mean",
          "weight": 1.5
        }
      ],
      "questions": [
        {
          "text": "我的工作让我感到情绪耗竭",
          "dimension": "情绪耗竭",
          "optionGroup": "cg-mbi",
          "reverse": false
        },
        {
          "text": "下班后我感觉精力完全耗尽",
          "dimension": "精力耗尽",
          "optionGroup": "cg-mbi",
          "reverse": false
        },
        {
          "text": "早上起来想到又要面对一天的工作，我就觉得疲惫不堪",
          "dimension": "晨起疲惫",
          "optionGroup": "cg-mbi",
          "reverse": false
        },
        {
          "text": "整天与人打交道让我感到压力很大",
          "dimension": "人际压力",
          "optionGroup": "cg-mbi",
          "reverse": false
        },
        {
          "text": "我感到自己的工作让我身心俱疲（burned out）",
          "dimension": "身心俱疲",
          "optionGroup": "cg-mbi",
          "reverse": false
        },
        {
          "text": "工作让我感到挫折",
          "dimension": "工作挫折",
          "optionGroup": "cg-mbi",
          "reverse": false
        },
        {
          "text": "我觉得自己工作太拼命了",
          "dimension": "过度努力",
          "optionGroup": "cg-mbi",
          "reverse": false
        },
        {
          "text": "直接与人打交道让我感到压力很大",
          "dimension": "直接压力",
          "optionGroup": "cg-mbi",
          "reverse": false
        },
        {
          "text": "我感到自己已经到了承受的极限",
          "dimension": "到达极限",
          "optionGroup": "cg-mbi",
          "reverse": false
        },
        {
          "text": "最近1个月，你通常需要多长时间才能入睡？",
          "dimension": "入睡时间",
          "optionGroup": "cg-psqi1",
          "reverse": false
        },
        {
          "text": "最近1个月，你每晚实际睡眠时间大约是？",
          "dimension": "睡眠时间",
          "optionGroup": "cg-psqi2",
          "reverse": false
        },
        {
          "text": "最近1个月，你有以下睡眠问题的频率（夜间易醒/早醒/需要药物助眠等）？",
          "dimension": "睡眠障碍",
          "optionGroup": "cg-psqi3",
          "reverse": false
        },
        {
          "text": "最近1个月，你的睡眠效率如何（实际睡眠时间÷卧床时间）？",
          "dimension": "睡眠效率",
          "optionGroup": "cg-psqi4",
          "reverse": false
        },
        {
          "text": "最近1个月，你对自己的总体睡眠质量评价如何？",
          "dimension": "主观质量",
          "optionGroup": "cg-psqi5",
          "reverse": false
        },
        {
          "text": "我对未来的职业发展有清晰的规划",
          "dimension": "H·职业希望",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我知道如何成为一个更好的班主任",
          "dimension": "H·职业希望",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "即使遇到挫折，我也有多种方法可以实现我的职业目标",
          "dimension": "H·职业希望",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我相信自己能够管理好我的班级",
          "dimension": "E·职业效能",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我相信我能够与家长建立有效的沟通",
          "dimension": "E·职业效能",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我相信我能够帮助问题学生取得进步",
          "dimension": "E·职业效能",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "当学生的问题让我受挫时，我能恢复过来继续工作",
          "dimension": "R·职业韧性",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我能从职业挫折中找到成长的资源",
          "dimension": "R·职业韧性",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "即使连续遇到困难，我也能坚持做班主任",
          "dimension": "R·职业韧性",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我的努力通常能带来正面的改变",
          "dimension": "O·职业乐观",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "当事情不顺利时，我相信这是可以改变的",
          "dimension": "O·职业乐观",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我相信我正在成为一个更好的老师",
          "dimension": "O·职业乐观",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我在工作中感到有选择的自由",
          "dimension": "自主需要",
          "optionGroup": "cg-bpnsf",
          "reverse": false
        },
        {
          "text": "我的工作决定能体现真实的自我",
          "dimension": "自主需要",
          "optionGroup": "cg-bpnsf",
          "reverse": false
        },
        {
          "text": "我在工作中感到自由自主地做事",
          "dimension": "自主需要",
          "optionGroup": "cg-bpnsf",
          "reverse": false
        },
        {
          "text": "我感到自己有能力完成重要的工作",
          "dimension": "能力需要",
          "optionGroup": "cg-bpnsf",
          "reverse": false
        },
        {
          "text": "我能很好地应对工作中的挑战",
          "dimension": "能力需要",
          "optionGroup": "cg-bpnsf",
          "reverse": false
        },
        {
          "text": "我对自己在工作中完成的事情感到满意",
          "dimension": "能力需要",
          "optionGroup": "cg-bpnsf",
          "reverse": false
        },
        {
          "text": "我感到身边有人关心我",
          "dimension": "关系需要",
          "optionGroup": "cg-bpnsf",
          "reverse": false
        },
        {
          "text": "我感到与他人关系亲密",
          "dimension": "关系需要",
          "optionGroup": "cg-bpnsf",
          "reverse": false
        },
        {
          "text": "我感到被他人尊重和重视",
          "dimension": "关系需要",
          "optionGroup": "cg-bpnsf",
          "reverse": false
        },
        {
          "text": "我觉得班主任工作对社会有价值",
          "dimension": "价值认同",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "如果重新选择，我还会选择当班主任",
          "dimension": "再选意愿",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "作为班主任，我感到自豪",
          "dimension": "职业自豪",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我愿意在班主任岗位上长期工作",
          "dimension": "长期意愿",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我觉得班主任角色与我的自我认知一致",
          "dimension": "自我一致",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "我在班主任工作中能体现自己的教育理念",
          "dimension": "价值实现",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "家长随时通过微信/电话联系我，即使在非工作时间，让我感到边界被侵犯",
          "dimension": "时间边界",
          "optionGroup": "cg-severity",
          "reverse": false
        },
        {
          "text": "面对家长的质疑或投诉时，我感到委屈、无力，甚至出现自我怀疑",
          "dimension": "自我怀疑",
          "optionGroup": "cg-severity",
          "reverse": false
        },
        {
          "text": "需要花费大量时间回复家长群消息、发送通知、解释学校政策，挤占备课和休息时间",
          "dimension": "时间消耗",
          "optionGroup": "cg-severity",
          "reverse": false
        },
        {
          "text": "部分家长对学生在校细节过度关注，让我感到被过度监督",
          "dimension": "过度监督",
          "optionGroup": "cg-severity",
          "reverse": false
        },
        {
          "text": "当学生出现行为问题时，家长倾向于指责教师\"管理不到位\"，而非共同协作解决",
          "dimension": "协作受阻",
          "optionGroup": "cg-severity",
          "reverse": false
        }
      ]
    }
  ],
  "attributions": [
    {
      "name": "情绪耗竭",
      "description": "教师的情绪资源被持续消耗且难以自然恢复，是职业倦怠的核心成分。",
      "highSign": "晨起即感疲惫、对学生反应变钝、下班后无力社交",
      "typicalTrigger": "长期高强度班务叠加缺乏恢复时段",
      "action": "本周内安排两段各 30 分钟的不可打扰恢复时段，并减少一项非必要班务承接",
      "weight": 1.3,
      "tags": [
        "self_growth",
        "emotion",
        "burnout"
      ]
    },
    {
      "name": "精力耗尽与躯体疲劳",
      "description": "身体能量长期透支，陷入疲劳-低效循环，出现躯体化压力反应。",
      "highSign": "下午极度疲劳、肩颈酸痛、全身紧绷、久坐后注意力断崖式下降",
      "typicalTrigger": "连续工作超 3 小时无休息、久坐不动、咖啡因替代休息",
      "action": "每小时起身活动 2-3 分钟，每天安排一次身体放松练习（渐进式肌肉放松或身体扫描）",
      "weight": 1.1,
      "tags": [
        "self_growth",
        "body",
        "fatigue"
      ]
    },
    {
      "name": "睡眠问题",
      "description": "入睡困难、睡眠质量差、早晨疲惫，是情绪耗竭最先反映的客观指标。",
      "highSign": "入睡超过 30 分钟、夜间易醒早醒、白天疲惫",
      "typicalTrigger": "睡前处理工作、屏幕蓝光暴露、大脑停不下来",
      "action": "执行睡前数字日落流程：睡前 1 小时放下屏幕，做脑力倾倒与放松练习",
      "weight": 1.2,
      "tags": [
        "self_growth",
        "body",
        "sleep"
      ]
    },
    {
      "name": "急性焦虑与紧张",
      "description": "面对棘手情境时的急性焦虑反应，干扰理性思考与临场表现。",
      "highSign": "心跳加速、大脑空白、紧张到无法行动",
      "typicalTrigger": "重要事件前、突发冲突、被投诉被质疑时",
      "action": "用 478 呼吸法 30 秒降心率、激活副交感神经，冷静后再处理事件",
      "weight": 1,
      "tags": [
        "self_growth",
        "emotion",
        "anxiety"
      ]
    },
    {
      "name": "灾难化思维",
      "description": "过度放大最坏情况的心理偏差，焦虑阻碍行动形成回避循环。",
      "highSign": "脑中不断预演最坏场景、过度担心、不敢行动",
      "typicalTrigger": "结果不确定的重要事项、缺乏应对预案",
      "action": "做最坏情况预演：写下最坏结果、应对措施与可求助资源，再行动",
      "weight": 1,
      "tags": [
        "self_growth",
        "cognition",
        "anxiety"
      ]
    },
    {
      "name": "情绪觉察薄弱",
      "description": "说不清自己的情绪状态，情绪累积到临界点才突然爆发。",
      "highSign": "突然爆发吓到自己和他人、用「烦/累」模糊概括所有情绪",
      "typicalTrigger": "长期忽略微小情绪信号、没有情绪记录习惯",
      "action": "用情绪温度计每天 3 次自评（黄灯即处理），配合情绪命名练习提升情绪粒度",
      "weight": 1,
      "tags": [
        "self_growth",
        "emotion",
        "awareness"
      ]
    },
    {
      "name": "情绪劳动耗竭",
      "description": "浅层扮演（装）的长期内耗导致内外割裂，是班主任困境核心机制之一。",
      "highSign": "人前温暖独处崩溃、下班后情绪爆发、维持多个情绪面具",
      "typicalTrigger": "必须维持「亲切耐心」形象、浅层扮演持续超过 2 周",
      "action": "用情绪充电站四步（深呼吸→命名情绪→允许存在→选择回应）从浅层扮演转向深层扮演",
      "weight": 1.2,
      "tags": [
        "self_growth",
        "emotion",
        "burnout"
      ]
    },
    {
      "name": "共情疲劳",
      "description": "长期接触学生痛苦情绪导致情绪资源耗竭，96.71% 班主任存在不同程度共情疲劳。",
      "highSign": "对学生情绪反应范围收窄、不愿情感深入、对学生问题麻木",
      "typicalTrigger": "每天承接几十个孩子的情绪需求、不安全依恋调节策略脆弱",
      "action": "每月做共情检查站自检，识别到耗竭及时补能，必要时寻求支持",
      "weight": 1.2,
      "tags": [
        "self_growth",
        "emotion",
        "fatigue"
      ]
    },
    {
      "name": "双重依恋困境",
      "description": "小学班主任特有消耗机制：学生的依恋需求反复激活教师自身依恋系统，依恋安全感不足时形成负循环。",
      "highSign": "过度卷入或情感回避交替出现、越回应越耗竭",
      "typicalTrigger": "6-12 岁学生高依恋需求+教师自身依恋安全感不足",
      "action": "先做 AS 快筛了解自己的调节模式，干预遵循依恋知情原则（先情感回应再给策略）",
      "weight": 1,
      "tags": [
        "self_growth",
        "relation",
        "attachment"
      ]
    },
    {
      "name": "角色边界消失",
      "description": "把学生的一切问题都当成自己的责任，边界消失，被需要=被肯定（A 过载-全能模式）。",
      "highSign": "「什么都是我的责任」、无法拒绝额外要求、下班后仍处理班务",
      "typicalTrigger": "学校分工不清或教师自我期待过高、被需要感驱动",
      "action": "做责任边界思维练习：把困扰事项分为责任圈/影响圈/他人系统责任，只推进可控的一项",
      "weight": 1.2,
      "tags": [
        "self_growth",
        "boundary"
      ]
    },
    {
      "name": "边界感丧失",
      "description": "时间、职责、情绪边界不断被突破，个人时间与精力被持续侵占。",
      "highSign": "家长随时联系、非工作时间被占用、不敢拒绝、答应了又后悔",
      "typicalTrigger": "未建立边界声明、拒绝困难、怕伤害关系",
      "action": "用边界声明话术与标准化拒绝模板建立并维护个人边界",
      "weight": 1.1,
      "tags": [
        "self_growth",
        "boundary"
      ]
    },
    {
      "name": "完美主义",
      "description": "反复打磨不敢交付，「够好」标准缺失，效率与心理双重受损。",
      "highSign": "反复修改检查犹豫、不敢开始、对「差不多」无法接受",
      "typicalTrigger": "高标准内化、害怕被评价、边际收益递减仍不放手",
      "action": "做完美主义去魅：设定 60/80/95 分三级标准，90% 的事做到 80 分即可",
      "weight": 1,
      "tags": [
        "self_growth",
        "cognition",
        "perfectionism"
      ]
    },
    {
      "name": "过度自责",
      "description": "把所有问题都归因于自己能力不足，自我攻击加剧习得性无助。",
      "highSign": "「都是我的错」「我就是不行」、拒绝正面反馈",
      "typicalTrigger": "消极能力归因+高自我期待、失败经历累积",
      "action": "用归因重构三步法做归因三角检验，写下平衡归因陈述",
      "weight": 1.1,
      "tags": [
        "self_growth",
        "cognition"
      ]
    },
    {
      "name": "冒名顶替综合征",
      "description": "明明有能力却感觉自己不配，被肯定归为运气，93% 以上职前教师存在冒名顶替想法。",
      "highSign": "被肯定归结为运气、无法内化成功、觉得随时会被发现「不配」",
      "typicalTrigger": "新手期、外部证据无法动摇其信念",
      "action": "用自戒暂停与「我的不可替代性」反思：自己列出 3 件 AI 无法替代的独特做法",
      "weight": 1.1,
      "tags": [
        "self_growth",
        "cognition"
      ]
    },
    {
      "name": "认知锁定",
      "description": "消极归因→行为退缩→负性结果→强化消极归因的自我强化闭环，67.3% 班主任存在。",
      "highSign": "大量自我否定语言、拒绝正面反馈、回避尝试",
      "typicalTrigger": "失败经历重复+缺乏成功证据，冒名顶替加剧",
      "action": "用认知转换卡打开可变空间（「还」字法），配合进步证据库用微小成功逐步松动",
      "weight": 1.2,
      "tags": [
        "self_growth",
        "cognition"
      ]
    },
    {
      "name": "意义感流失",
      "description": "对班主任工作的价值感知下降，成就感延迟导致意义来源不足。",
      "highSign": "反复怀疑工作价值、对学生进步不再有反应、例行公事感",
      "typicalTrigger": "成就感延迟、长期付出未获反馈、成果难以量化",
      "action": "用影响力日志每周记录一件对学生的积极影响，配合教育初心回溯重建意义",
      "weight": 1.4,
      "tags": [
        "self_growth",
        "meaning"
      ]
    },
    {
      "name": "职业认同下降",
      "description": "对班主任职业的价值认同、归属感与发展意愿下降，职业认同<2.5 分触发紫色（意义危机）预警。",
      "highSign": "觉得做这些没意思、只是为工资硬撑、找不到职业方向",
      "typicalTrigger": "价值冲突、长期无正向反馈、意义危机",
      "action": "通过职业认同量表确认后启动意义重构专项，探索职业意义锚点",
      "weight": 1.2,
      "tags": [
        "self_growth",
        "meaning",
        "identity"
      ]
    },
    {
      "name": "心理资本不足",
      "description": "HERO 四维度（希望/效能/韧性/乐观）整体偏低，心理资本匮乏。",
      "highSign": "看不到可行路径、对未来消极预期、受挫后难以恢复",
      "typicalTrigger": "长期挫折+缺乏成功体验+支持不足",
      "action": "用微成功阶梯每天完成 3 个「微小到不可能失败」的任务，重建自我效能",
      "weight": 1.1,
      "tags": [
        "self_growth",
        "psychology"
      ]
    },
    {
      "name": "效能感不足",
      "description": "对自己处理复杂问题的能力缺乏信心，容易回避而非应对。",
      "highSign": "遇到难题先想「我搞不定」、倾向于上交问题",
      "typicalTrigger": "缺少可复用的方法储备或成功经验",
      "action": "用最小成功案例复演，把一次成功经验拆成三步套用到当前难题",
      "weight": 1.1,
      "tags": [
        "self_growth",
        "psychology",
        "efficacy"
      ]
    },
    {
      "name": "韧性不足",
      "description": "受挫后长时间难以恢复，挫折持续影响生活与工作状态。",
      "highSign": "被批评后一蹶不振、挫折影响睡眠和生活",
      "typicalTrigger": "缺乏恢复资源与缓冲、情绪恢复路径缺失",
      "action": "用渐进式肌肉放松降低躯体紧张，配合同伴支持加速恢复",
      "weight": 1,
      "tags": [
        "self_growth",
        "psychology"
      ]
    },
    {
      "name": "基本心理需要受挫",
      "description": "自主、能力、关系三大基本心理需要同时受压（SDT 理论），是倦怠与意义感缺失的结构性来源。",
      "highSign": "觉得身不由己、怀疑自己能力、专业孤立无人理解",
      "typicalTrigger": "工作边界模糊+成就感延迟+专业孤立",
      "action": "用 BPNSF 定位最缺的需要，从工作环境与个人调节两个层面同时改善",
      "weight": 1,
      "tags": [
        "self_growth",
        "psychology"
      ]
    },
    {
      "name": "家长沟通压力",
      "description": "家长沟通频率压力、边界侵犯感与情绪影响，是小学班主任第一压力源。",
      "highSign": "非工作时间被联系、被投诉后自我怀疑、被过度监督",
      "typicalTrigger": "家长高频率联系、责任推诿、过度关注型家长多",
      "action": "用信息分流系统分类响应消息，配合家长预期管理话术建立家校同盟",
      "weight": 1.3,
      "tags": [
        "self_growth",
        "relation",
        "parent"
      ]
    },
    {
      "name": "任务过载",
      "description": "待办堆积、非教学任务挤占时间导致焦虑性忙碌，失去掌控感。",
      "highSign": "待办清单超 10 项、感觉永远做不完、焦虑性忙碌",
      "typicalTrigger": "非教学任务挤占+不会委托+不会拒绝",
      "action": "用任务剃刀三把刀（删除/委托/降级）削减 50% 非必要任务",
      "weight": 1.1,
      "tags": [
        "self_growth",
        "workload"
      ]
    },
    {
      "name": "时间碎片化",
      "description": "注意力被不断打断，缺乏整块深度工作时间，感觉很忙但没产出。",
      "highSign": "随时回消息、难有整块时间、切换成本过高",
      "typicalTrigger": "信息无分流、无时间块规划、边界未建立",
      "action": "用信息隔离时段+时间块规划保护深度工作时间",
      "weight": 1,
      "tags": [
        "self_growth",
        "workload"
      ]
    },
    {
      "name": "拖延回避",
      "description": "小任务堆积、重要事项不推进，启动困难导致恶性循环。",
      "highSign": "「等一下」就永远没做、DDL 前赶工、多任务并行无产出",
      "typicalTrigger": "任务过大无拆解+启动困难+完美主义前置",
      "action": "用两分钟闪电战消灭微任务，配合微成功阶梯降低启动门槛",
      "weight": 1,
      "tags": [
        "self_growth",
        "workload"
      ]
    },
    {
      "name": "支持系统缺失",
      "description": "缺少可求助的同伴与制度通道，独自消化问题，43.18% 班主任无法获得有效系统支持。",
      "highSign": "独自消化问题、不主动求助、认为求助等于无能",
      "typicalTrigger": "教研组协作弱、校内缺少同伴支持机制、求助曾被拒",
      "action": "建立同伴支持二人组，每周一次结构化支持性对话；梳理资源地图",
      "weight": 1.2,
      "tags": [
        "self_growth",
        "support"
      ]
    },
    {
      "name": "关系疏离",
      "description": "师生/同事关系停留在事务层面，情感连接缺失，师生关系功利化。",
      "highSign": "和学生只谈管理、感受不到连接的意义、同事间无真正交流",
      "typicalTrigger": "高强度事务挤压情感连接时间、用标准代替感受",
      "action": "用五分钟深度连接与学生做非学业对话，配合角色转换体验恢复同理心",
      "weight": 1,
      "tags": [
        "self_growth",
        "relation"
      ]
    },
    {
      "name": "防御退缩",
      "description": "尝试后觉得没用，放弃寻找意义与连接，回避深度情感（E 防御-退缩模式）。",
      "highSign": "回避与学生深度情感连接、用物质奖励替代情感回应、放弃尝试",
      "typicalTrigger": "多次受挫+求助被拒+系统支持缺失",
      "action": "通过同行配对提供安全的一对一关系，不强迫干预，必要时专业支持转介",
      "weight": 1.1,
      "tags": [
        "self_growth",
        "support"
      ]
    },
    {
      "name": "自我关怀不足",
      "description": "忙于照顾所有人却忘了照顾自己，对自己苛刻，基本自我照顾被牺牲。",
      "highSign": "一天没吃没喝没休息、自我攻击「我不配」",
      "typicalTrigger": "责任感过强+自我批评习惯+「先人后己」信念",
      "action": "用自我关怀休息三步（正念→共通人性→自我善意），每天对照自我照顾清单打勾",
      "weight": 1,
      "tags": [
        "self_growth",
        "selfcare"
      ]
    },
    {
      "name": "工作生活失衡",
      "description": "工作与个人生活边界消失，下班后大脑仍持续运转，无法切换模式。",
      "highSign": "下班脑中仍想工作、周末还在想工作、对周一抗拒",
      "typicalTrigger": "无结束仪式、手机成为「隐形办公室」、不回消息焦虑",
      "action": "用每日三件删除+周末清零仪式建立工作结束信号",
      "weight": 1,
      "tags": [
        "self_growth",
        "boundary"
      ]
    },
    {
      "name": "AI焦虑",
      "description": "AI 技术发展带来的职业价值不确定感，是影响教师幸福感的第二大因素。",
      "highSign": "担心被 AI 取代、跟不上技术发展、对职业价值感到焦虑",
      "typicalTrigger": "数字素养差异大、对职业价值的 existential 焦虑",
      "action": "用「我的不可替代性」反思列出 AI 做不到的事，配合本周小尝试微步式提升数字自信",
      "weight": 0.9,
      "tags": [
        "self_growth",
        "cognition",
        "ai"
      ]
    }
  ],
  "evidences": [
    {
      "attribution": "情绪耗竭",
      "scale": "教师自我成长五问自评",
      "conditions": [
        {
          "targetType": "question",
          "target": "1",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "疲惫题项处于高位，情绪资源大量消耗"
    },
    {
      "attribution": "精力耗尽与躯体疲劳",
      "scale": "教师六维深度评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "精力耗尽",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "「下班后精力完全耗尽」高频出现"
    },
    {
      "attribution": "睡眠问题",
      "scale": "教师六维深度评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "入睡时间",
          "comparator": "达到或超过",
          "value": 2,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "入睡时间超过 30 分钟，睡眠问题明显"
    },
    {
      "attribution": "急性焦虑与紧张",
      "scale": "教师六维深度评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "到达极限",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "「已经到了承受的极限」高频出现"
    },
    {
      "attribution": "灾难化思维",
      "scale": "HERO心理资本与依恋安全感评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "O·职业乐观",
          "comparator": "低于或等于",
          "value": 8,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "职业乐观维度偏低，倾向预期负面结果"
    },
    {
      "attribution": "情绪觉察薄弱",
      "scale": "HERO心理资本与依恋安全感评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "依恋恢复度",
          "comparator": "低于或等于",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "情感挫折后难以找到恢复安全感的方式"
    },
    {
      "attribution": "情绪劳动耗竭",
      "scale": "教师六维深度评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "直接压力",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "直接与人打交道带来的压力处于高位"
    },
    {
      "attribution": "共情疲劳",
      "scale": "教师六维深度评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "人际压力",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "整天与人打交道带来的压力处于高位"
    },
    {
      "attribution": "双重依恋困境",
      "scale": "HERO心理资本与依恋安全感评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "依恋稳定度",
          "comparator": "低于或等于",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "面对学生强烈情感需求难以稳定回应"
    },
    {
      "attribution": "角色边界消失",
      "scale": "教师自我成长五问自评",
      "conditions": [
        {
          "targetType": "question",
          "target": "2",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "频繁出现「什么都是我的责任」"
    },
    {
      "attribution": "边界感丧失",
      "scale": "HERO心理资本与依恋安全感评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "时间边界",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "非工作时间被联系、边界被侵犯感受强烈"
    },
    {
      "attribution": "完美主义",
      "scale": "教师六维深度评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "过度努力",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "「工作太拼命」频率高，完美主义倾向"
    },
    {
      "attribution": "过度自责",
      "scale": "教师六维深度评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "自我怀疑",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "面对质疑投诉时自我怀疑明显"
    },
    {
      "attribution": "冒名顶替综合征",
      "scale": "教师六维深度评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "自我怀疑",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "自我怀疑出现，存在冒名顶替倾向"
    },
    {
      "attribution": "认知锁定",
      "scale": "HERO心理资本与依恋安全感评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "E·职业效能",
          "comparator": "低于或等于",
          "value": 8,
          "join": "且"
        },
        {
          "targetType": "dimension",
          "target": "H·职业希望",
          "comparator": "低于或等于",
          "value": 8,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "职业效能与职业希望双低，认知锁定风险"
    },
    {
      "attribution": "意义感流失",
      "scale": "教师自我成长五问自评",
      "conditions": [
        {
          "targetType": "question",
          "target": "3",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 3,
      "description": "意义感知处于低位（反向计分后得分高）"
    },
    {
      "attribution": "职业认同下降",
      "scale": "教师六维深度评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "价值认同",
          "comparator": "低于或等于",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "职业价值认同偏低（1-5 分制）"
    },
    {
      "attribution": "心理资本不足",
      "scale": "HERO心理资本与依恋安全感评估",
      "conditions": [
        {
          "targetType": "total",
          "target": "",
          "comparator": "低于或等于",
          "value": 31,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "HERO 总分 24-31 分中度风险区间"
    },
    {
      "attribution": "效能感不足",
      "scale": "教师自我成长五问自评",
      "conditions": [
        {
          "targetType": "question",
          "target": "4",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "处理棘手问题的信心不足（反向计分后得分高）"
    },
    {
      "attribution": "韧性不足",
      "scale": "HERO心理资本与依恋安全感评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "R·职业韧性",
          "comparator": "低于或等于",
          "value": 8,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "职业韧性维度偏低，受挫后恢复困难"
    },
    {
      "attribution": "基本心理需要受挫",
      "scale": "教师六维深度评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "自主需要",
          "comparator": "低于或等于",
          "value": 9,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "自主需要满足度低（3 题和 3-21 分）"
    },
    {
      "attribution": "家长沟通压力",
      "scale": "教师六维深度评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "协作受阻",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "家长指责教师管理不到位的情况明显"
    },
    {
      "attribution": "任务过载",
      "scale": "HERO心理资本与依恋安全感评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "时间消耗",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "家长沟通挤占备课与休息时间明显"
    },
    {
      "attribution": "时间碎片化",
      "scale": "教师六维深度评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "时间消耗",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "时间被消息与事务大量挤占"
    },
    {
      "attribution": "拖延回避",
      "scale": "HERO心理资本与依恋安全感评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "H·职业希望",
          "comparator": "低于或等于",
          "value": 9,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "职业希望偏低，缺少规划与启动动力"
    },
    {
      "attribution": "支持系统缺失",
      "scale": "教师自我成长五问自评",
      "conditions": [
        {
          "targetType": "question",
          "target": "5",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "工作困难长期无人分担"
    },
    {
      "attribution": "关系疏离",
      "scale": "教师六维深度评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "关系需要",
          "comparator": "低于或等于",
          "value": 9,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "关系需要满足度低，情感连接缺失"
    },
    {
      "attribution": "防御退缩",
      "scale": "教师六维深度评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "关系需要",
          "comparator": "低于或等于",
          "value": 6,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "关系需要严重受挫，倾向防御退缩"
    },
    {
      "attribution": "自我关怀不足",
      "scale": "教师六维深度评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "睡眠效率",
          "comparator": "达到或超过",
          "value": 2,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "睡眠效率偏低，基本自我照顾被牺牲"
    },
    {
      "attribution": "工作生活失衡",
      "scale": "HERO心理资本与依恋安全感评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "时间边界",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "非工作时间被占用，工作生活边界模糊"
    },
    {
      "attribution": "AI焦虑",
      "scale": "HERO心理资本与依恋安全感评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "O·职业乐观",
          "comparator": "低于或等于",
          "value": 6,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "职业乐观严重偏低，存在职业价值焦虑"
    }
  ],
  "levels": [
    {
      "name": "需转介",
      "scale": "教师自我成长五问自评",
      "conditions": [
        {
          "targetType": "question",
          "target": "1",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        },
        {
          "targetType": "question",
          "target": "3",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "redLine": true,
      "redLineAction": "立即阻断常规建议输出，展示危机求助指引，生成转介工单通知心理专员",
      "teacherMessage": "评估显示，您在「${主要归因}」上的信号已经处于需要重点关注的位置。系统已暂停常规建议并生成转介工单，心理专员会与您联系。在此之前，请优先照顾好自己的基本作息。",
      "resultNote": "疲惫与意义感同时处于高位，已暂停常规建议并生成转介工单。",
      "escalationTarget": "心理专员",
      "notificationTemplate": "[教师姓名]老师在自我成长评估中触发红线：疲惫与意义感同时告急。请尽快登录系统查看工单。"
    },
    {
      "name": "重度风险",
      "scale": "教师自我成长五问自评",
      "conditions": [
        {
          "targetType": "total",
          "target": "",
          "comparator": "达到或超过",
          "value": 20,
          "join": "且"
        }
      ],
      "redLine": false,
      "teacherMessage": "本次评估的主要归因是「${主要归因}」，同时「${次要归因}」也需要一并关注。建议本周内安排一次支持性沟通，并从推荐工具中选一项今天就能开始的动作。",
      "resultNote": "五问自评总分≥20，启动支持响应。",
      "escalationCondition": "连续两次评估仍为重度风险",
      "escalationTarget": "年级组长",
      "reAssessTrigger": "14 天后复评"
    },
    {
      "name": "明显消耗",
      "scale": "HERO心理资本与依恋安全感评估",
      "conditions": [
        {
          "targetType": "total",
          "target": "",
          "comparator": "低于或等于",
          "value": 31,
          "join": "且"
        }
      ],
      "redLine": false,
      "teacherMessage": "本次评估提示「${主要归因}」值得关注。心理资本出现消耗，建议先用推荐工具自主调整，本周内完成至少一个微行动。",
      "resultNote": "HERO 心理资本处于中度消耗区间，建议针对性调整。",
      "escalationCondition": "连续两次深评均分未下降",
      "escalationTarget": "年级组长",
      "reAssessTrigger": "30 天后复评"
    },
    {
      "name": "轻度关注",
      "scale": "教师六维深度评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "情绪耗竭",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "redLine": false,
      "teacherMessage": "六维评估显示「${主要归因}」开始出现信号，尚未到需要外部介入的程度。建议从推荐工具中选一项今天就能开始的动作，保持观察。",
      "resultNote": "六维深度评估中情绪耗竭维度开始出现信号。",
      "escalationCondition": "复评时信号加重",
      "escalationTarget": "年级组长",
      "reAssessTrigger": "30 天后复评"
    }
  ],
  "tools": [
    {
      "name": "478呼吸法",
      "attributions": [
        "急性焦虑与紧张"
      ],
      "whenToUse": "焦虑突然来袭、心跳加速、即将面对棘手家长/学生时紧张",
      "steps": [
        "①无论坐或站，先让脊椎挺直但不僵硬",
        "②用鼻子吸气，默数4秒，感受腹部鼓起",
        "③屏住呼吸，默数7秒",
        "④用嘴巴缓慢呼气，默数8秒，感受腹部收缩",
        "⑤重复3-4轮。初次练习可将比例调整为4-4-4"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "low",
      "script": "对自己说'我只是需要4-7-8秒。情绪是信号，不是敌人。'\n对旁人'稍等，我需要喘口气。'",
      "prohibition": "不要在焦虑高峰期强迫自己一次做到4-7-8；哮喘或呼吸系统疾病患者需调整比例；不要在驾驶时闭眼练习",
      "timePerSession": "30秒-1分钟",
      "duration": "随时可用，每天练习2-3次效果更好",
      "expectedEffect": "30秒内降低心率，激活副交感神经，恢复理性思考能力",
      "effectNote": "30秒内降低心率，激活副交感神经，恢复理性思考能力",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "精力耗尽",
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "5-4-3-2-1感官锚定",
      "attributions": [
        "急性焦虑与紧张",
        "情绪觉察薄弱"
      ],
      "whenToUse": "情绪风暴中感觉失控、被愤怒/恐慌淹没、大脑一片空白",
      "steps": [
        "①找到5样你能看到的东西，在心里或出声说出它们（如：'我看到白色的墙壁、蓝色的文件夹……'）",
        "②找到4样你能触摸的东西，用手感受并说出触感（如：'键盘是光滑的、毛衣是柔软的……'）",
        "③找到3样你能听到的声音（如：'空调的嗡嗡声、窗外的鸟叫……'）",
        "④找到2样你能闻到的气味（实在没有可以回忆熟悉的气味）",
        "⑤找到1样你能尝到的味道（喝口水或回忆一种味道）",
        "⑥完成后做一次深呼吸，感受当下的安全感"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "low",
      "script": "（内心）'我在这里，现在是安全的。这不是危险，只是不适。'",
      "prohibition": "不要一边做一边继续想刚才的刺激事件；不要在危险环境中停留做这个练习（先离开危险现场）",
      "timePerSession": "3-5分钟",
      "duration": "情绪失控时立刻使用；平时练习可增强效果",
      "expectedEffect": "通过感官重新连接当下现实，打断情绪失控的恶性循环",
      "effectNote": "通过感官重新连接当下现实，打断情绪失控的恶性循环",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "精力耗尽",
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "渐进式肌肉放松",
      "attributions": [
        "精力耗尽与躯体疲劳",
        "睡眠问题"
      ],
      "whenToUse": "全身紧绷、肩颈酸痛、入睡困难、长期紧张无法放松",
      "steps": [
        "①穿宽松衣物，平躺或舒适坐着",
        "②从脚趾开始：用力蜷缩脚趾5秒→突然放松，感受松弛感10秒",
        "③依次向上：脚踝→小腿→大腿→臀部→腹部→胸部→手指→手臂→肩膀→颈部→面部",
        "④每个部位：绷紧5秒→放松10秒，注意对比紧张与松弛的感觉",
        "⑤全程保持缓慢深呼吸",
        "⑥初学者可用音频引导"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "low",
      "script": "（自我引导）'现在我让脚趾紧张……好，放松。感受这种轻松。'\n对学生'像一只小猫，先蜷起来，再伸展开。'",
      "prohibition": "不要在有拉伤的部位强行绷紧；不要跳过对比感受的10秒（这是关键）；不要在会议中做面部放松（可能引起尴尬）",
      "timePerSession": "10-15分钟",
      "duration": "每天1次，睡前最佳；连续2周见效",
      "expectedEffect": "系统性释放全身肌肉张力，降低躯体化压力反应，改善睡眠",
      "effectNote": "系统性释放全身肌肉张力，降低躯体化压力反应，改善睡眠",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "精力耗尽",
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "蝴蝶拥抱法",
      "attributions": [
        "自我关怀不足",
        "急性焦虑与紧张"
      ],
      "whenToUse": "感到孤独/被批评后/被否定时需自我安抚、无法从他人处获得安慰",
      "steps": [
        "①将双手交叉放在胸前，右手放在左肩，左手放在右肩",
        "②指尖刚好在锁骨下方",
        "③闭上眼睛或半闭",
        "④像蝴蝶翅膀一样，双手交替轻拍肩膀（左-右-左-右）",
        "⑤节奏缓慢而稳定，约每秒1次",
        "⑥同时深呼吸，可以对自己说安抚的话",
        "⑦持续到感觉平静或至少2分钟"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "low",
      "script": "对自己'我是安全的。我在照顾自己。这只是一阵风，会过去的。'",
      "prohibition": "不要在需要保持警觉的情境使用（如监控学生安全时）；如果轻拍引发不适（部分人有创伤相关反应），改为双手静静放在胸前即可",
      "timePerSession": "2-3分钟",
      "duration": "需要时随时使用；每次2-3分钟",
      "expectedEffect": "通过双侧身体刺激激活自我安抚系统，快速获得安全感",
      "effectNote": "通过双侧身体刺激激活自我安抚系统，快速获得安全感",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "精力耗尽",
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "充电站姿势调整",
      "attributions": [
        "精力耗尽与躯体疲劳"
      ],
      "whenToUse": "下午3-4点极度疲劳、连续工作3小时以上、感觉被掏空",
      "steps": [
        "①站起来，离开座位",
        "②双脚与肩同宽，膝盖微弯",
        "③双手向上伸展，像要摘星星一样",
        "④保持伸展10秒",
        "⑤缓慢放下，做3次肩部大回环（向前3圈+向后3圈）",
        "⑥喝一杯常温水",
        "⑦如果可能，走到窗边远眺30秒",
        "⑧返回座位时调整坐姿：臀部坐满椅子，双脚平放地面"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "low",
      "script": "对自己'我不是累了，我只是在一个姿势里困太久了。'\n对学生'来，我们一起起来活动一下。'",
      "prohibition": "不要喝咖啡或浓茶替代（这会让身体忽略真实信号）；不要做剧烈拉伸以免拉伤；不要做完马上坐下刷手机",
      "timePerSession": "2-3分钟",
      "duration": "感觉疲劳时立即使用",
      "expectedEffect": "通过改变身体姿态快速提升能量水平，打破疲劳-低效循环",
      "effectNote": "通过改变身体姿态快速提升能量水平，打破疲劳-低效循环",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "精力耗尽"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "正念饮水",
      "attributions": [
        "情绪觉察薄弱",
        "急性焦虑与紧张"
      ],
      "whenToUse": "烦躁不安、注意力涣散、被杂事不断打断、无法专注",
      "steps": [
        "①拿一杯常温水（不要滚烫的茶或咖啡）",
        "②先看水：观察它的透明度和光线",
        "③感受杯子的温度和重量",
        "④慢慢喝第一口，让水在口中停留3秒",
        "⑤感受水从口腔流到喉咙的过程",
        "⑥喝完整杯（约200ml），每口都慢慢来",
        "⑦放下杯子时做一次深呼吸"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "low",
      "script": "不需要说什么。这是一个只属于你的1分钟。",
      "prohibition": "不要一边喝水一边看手机/电脑；不要用这个方法代替该有的休息；不要喝冰水（刺激太大）",
      "timePerSession": "1-2分钟",
      "duration": "每天2-3次，尤其在工作切换间隙",
      "expectedEffect": "通过聚焦于喝水这个简单动作，重置注意力，获得微型冥想效果",
      "effectNote": "通过聚焦于喝水这个简单动作，重置注意力，获得微型冥想效果",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "精力耗尽",
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "身体扫描",
      "attributions": [
        "精力耗尽与躯体疲劳",
        "睡眠问题"
      ],
      "whenToUse": "下班后脑力停不下来、身体有明显紧张但说不清在哪、周日焦虑",
      "steps": [
        "①平躺，双手放在身体两侧，闭上眼睛",
        "②做3次深呼吸，将注意力带到身体",
        "③从头到脚或从脚到头，逐个部位扫描：；- 头顶→额头→眼睛→脸颊→下巴；- 脖子→肩膀→上臂→前臂→手掌；- 胸部→上背→腹部→下背；- 臀部→大腿→膝盖→小腿→脚踝→脚掌",
        "④每个部位停留10-15秒，观察：紧绷？温暖？麻木？疼痛？",
        "⑤不评判、不改变，只是观察",
        "⑥扫描到紧张区域时，用呼吸向那里\"吹气\"",
        "⑦全程结束后，感受整个身体的整体感"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "medium",
      "script": "（内心引导）'我现在注意到肩膀……这里有紧绷感。不需要改变它，只是注意到它。'",
      "prohibition": "不要边做边评判'我怎么这么紧张'；不要在有疼痛时不就医只靠扫描；不要强行改变感受，观察即可",
      "timePerSession": "10-15分钟",
      "duration": "每天1次，睡前做；坚持4周为1个疗程",
      "expectedEffect": "建立身体觉察能力，在压力积累到爆发前识别早期信号",
      "effectNote": "建立身体觉察能力，在压力积累到爆发前识别早期信号",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "精力耗尽",
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "能量姿势",
      "attributions": [
        "急性焦虑与紧张",
        "效能感不足"
      ],
      "whenToUse": "重要会议/公开课/家长沟通前紧张、自信不足、需要快速提升气场",
      "steps": [
        "①找一个私密空间（洗手间、空教室、储物间）",
        "②选择一个能量姿势：；- 神奇女侠式：双脚分开站立，双手叉腰，挺胸抬头；- 胜利式：双手举过头顶呈V字形；- 展开式：双臂向外伸展，像要拥抱整个房间",
        "③保持姿势2分钟，深呼吸",
        "④期间想象自己充满力量的样子"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "low",
      "script": "对自己'我有一个充分准备的大脑和一个准备行动的body。'",
      "prohibition": "不要在公共场合做（可能引起尴尬）；不要只用姿势而忽略内容准备；不要过度依赖（它是辅助，不是替代方案）",
      "timePerSession": "2分钟",
      "duration": "重要事件前2分钟即可",
      "expectedEffect": "通过扩张性身体姿势提升睾酮水平、降低皮质醇，增强自信感",
      "effectNote": "通过扩张性身体姿势提升睾酮水平、降低皮质醇，增强自信感",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "精力耗尽",
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "午间微型运动",
      "attributions": [
        "精力耗尽与躯体疲劳"
      ],
      "whenToUse": "全天伏案、肩颈僵硬、下午注意力断崖式下降",
      "steps": [
        "①从座位上站起来",
        "②20个原地高抬腿",
        "③10个开合跳",
        "④前后绕肩各10圈",
        "⑤颈部缓慢拉伸（左倾→右倾→前倾→后仰，各10秒）",
        "⑥手腕脚踝绕圈各10圈",
        "⑦3个深蹲",
        "⑧最后做3次深呼吸，喝半杯水"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "low",
      "script": "对同事'课间活动一下，一起来？'\n对自己'动5分钟，清醒2小时。'",
      "prohibition": "不要在饭后立即做（饭后45分钟后再做）；有心脑血管疾病者减量；不要在正式场合穿正装时做开合跳",
      "timePerSession": "5-7分钟",
      "duration": "每天午休或下午时段1次",
      "expectedEffect": "通过短时高强度活动改善血液循环和大脑供氧，打破久坐伤害",
      "effectNote": "通过短时高强度活动改善血液循环和大脑供氧，打破久坐伤害",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "精力耗尽"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "睡前数字日落",
      "attributions": [
        "睡眠问题",
        "工作生活失衡"
      ],
      "whenToUse": "睡前大脑仍在想工作、入睡困难、睡眠质量差、早晨疲惫",
      "steps": [
        "①睡前1小时：手机/电脑开启夜间模式或放下所有屏幕",
        "②睡前45分钟：调暗室内灯光至暖黄",
        "③睡前30分钟：温水洗脸/洗澡（水温不超过40°C）",
        "④睡前20分钟：做渐进式肌肉放松或身体扫描（RX-007）",
        "⑤睡前10分钟：写下脑中所有盘旋的事项（脑力倾倒）",
        "⑥睡前5分钟：阅读纸质书（非工作相关）",
        "⑦设定固定起床时间（即使是周末也保持一致）"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "medium",
      "script": "对自己'工作没有做完的时候，但我的休息时间是神圣的。'\n对家人'这是我的关机时间，明天再聊。'",
      "prohibition": "不要睡前查看工作消息（即使只是'看一眼'）；不要在床上做任何与工作相关的事；不要用酒精助眠",
      "timePerSession": "30-45分钟",
      "duration": "每天睡前一小时执行；坚持2周见效",
      "expectedEffect": "通过蓝光阻断+放松程序，帮助大脑从工作模式切换到睡眠模式",
      "effectNote": "通过蓝光阻断+放松程序，帮助大脑从工作模式切换到睡眠模式",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "精力耗尽",
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "任务剃刀",
      "attributions": [
        "任务过载"
      ],
      "whenToUse": "待办清单超过10项、不知道该做什么先、感觉永远做不完、焦虑性忙碌",
      "steps": [
        "①拿出你的待办清单（或写下所有盘旋在脑中的事）",
        "②用三把剃刀逐项审视：；剃刀A-删除刀：'这件事不做，最坏的结果是什么？能承受吗？' 能→直接删除；剃刀B-委托刀：'这件事必须我本人做吗？谁能做？' 有别人→标注委托；剃刀C-降级刀：'这件事做到60分够吗？' 够→降级为'最低可用版本'",
        "③剩下的事按重要度排序列出前3件",
        "④把前3件之外的放入'停车场清单'（本周稍后处理）",
        "⑤立刻执行第1件"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "low",
      "script": "对自己'完成比完美重要。砍掉比完成更高效。'\n对委托对象'这件事我想交给你，你来做可能比我更好。'",
      "prohibition": "不要试图一次处理完所有事再开始做第一件；不要对'被砍掉的事'感到愧疚（那是节省出来的生命）；不要在没有委托对象时强行委托",
      "timePerSession": "10-15分钟",
      "duration": "每周一早上或感到过载时立即使用",
      "expectedEffect": "快速削减50%以上非必要任务，找回掌控感",
      "effectNote": "快速削减50%以上非必要任务，找回掌控感",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "角色边界"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "强制委托清单",
      "attributions": [
        "任务过载",
        "角色边界消失"
      ],
      "whenToUse": "觉得只有自己能做好、不敢/不愿分派任务、大包大揽导致过载",
      "steps": [
        "①列出本周所有你亲力亲为的事",
        "②对每件事打分（1-5分）：；- 必须我做 = 5分；- 最好我做但别人也行 = 3分；- 别人也能做 = 1分",
        "③所有≤3分的事项，写下可委托的人选（班干部/同事/家长/学生本人）",
        "④选择本周至少委托2件事",
        "⑤对每件委托的事：写清楚'做什么-截止时间-质量标准-可以找谁帮忙'",
        "⑥委托后设定1个检查点（不做微管理）"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "medium",
      "script": "对委托对象'这件事交给你，你按自己的方式做。截止时间前我们碰一下就行。'\n对自己'我放手，别人才能成长。'",
      "prohibition": "不要委托后仍暗中检查/修改/重做；不要只委托杂活而保留'重要'的事（那是假委托）；不要让委托变成甩锅",
      "timePerSession": "首次30分钟/之后10分钟",
      "duration": "首次执行需30分钟；之后每周审视1次；坚持4周",
      "expectedEffect": "突破'非我不可'认知，建立委托习惯，释放50%低价值事务时间",
      "effectNote": "突破'非我不可'认知，建立委托习惯，释放50%低价值事务时间",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "角色边界"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "微成功阶梯",
      "attributions": [
        "效能感不足",
        "认知锁定"
      ],
      "whenToUse": "效能感低下、觉得自己什么都做不好、陷入'我做什么都没用'的习得性无助",
      "steps": [
        "①每天早晨写下3个'微小到不可能失败'的任务：；- 例：'整理桌上3本书'（不是'整理教室'）；- 例：'对1个学生微笑并叫出名字'（不是'改善班级氛围'）；- 例：'给1位家长发1条正面消息'（不是'做好家校沟通'）",
        "②完成一项立即打勾，对自己说'我做到了'",
        "③不要跳过这个打勾和确认的动作",
        "④晚上回顾：今天这3个小成就是什么？",
        "⑤每周总结：这周我完成了15+个小任务",
        "⑥阶梯升级：2周后把任务稍微变难一点"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "medium",
      "script": "对自己'我今天做了这件事。我是有能力的人。'\n（写在便签上）'不积跬步，无以至千里。'",
      "prohibition": "不要把任务设得太大（宁可太小也不要大）；不要在做完后立刻加更多任务（享受完成感）；不要跳过回顾环节",
      "timePerSession": "每天5-10分钟",
      "duration": "每天至少完成1个阶梯；持续2-4周",
      "expectedEffect": "通过一连串小胜利重建自我效能感，打破'什么都做不好'的负向循环",
      "effectNote": "通过一连串小胜利重建自我效能感，打破'什么都做不好'的负向循环",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "角色边界",
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "番茄工作法（班主任版）",
      "attributions": [
        "时间碎片化",
        "拖延回避"
      ],
      "whenToUse": "碎片化工作模式、不断被打断、注意力涣散、工作拖延",
      "steps": [
        "①选择一项需要专注的任务（如备课/写评语/分析数据）",
        "②设定25分钟倒计时（手机或计时器）",
        "③这25分钟内：；- 手机关闭或放远；- 告知学生/同事：'这个时间段我有集中工作'；- 任何新事写入'中断记录'，不处理；- 如果被强制打断，该番茄钟作废，重新开始",
        "④25分钟到→强制休息5分钟（站起来、走动、喝水）",
        "⑤每4个番茄钟后休息15-30分钟",
        "⑥对班主任的调整：课间和学生管理不算打断，是本职工作时间"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "medium",
      "script": "对学生/同事'接下来25分钟我在专注工作，有事25分钟后找我。'\n对自己'我现在只做这一件事。'",
      "prohibition": "不要在休息时间继续看工作消息；不要连续做超过4个番茄钟不休息；不要在上课/班级管理时间使用",
      "timePerSession": "每个番茄钟25分钟",
      "duration": "每天使用2-4个番茄钟；坚持2周形成习惯",
      "expectedEffect": "通过结构化时间块保护注意力和心流，提高核心工作效率",
      "effectNote": "通过结构化时间块保护注意力和心流，提高核心工作效率",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "角色边界"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "桌面清零术",
      "attributions": [
        "任务过载"
      ],
      "whenToUse": "办公桌/电脑桌面混乱、找不到东西、环境混乱导致心理混乱",
      "steps": [
        "①每日清零（下班前5分钟）：；- 所有文件归位到固定位置；- 桌面只留3样东西（电脑+水杯+当前任务1件）；- 垃圾清空",
        "②每周清零（周五下午30分钟）：；- 电脑桌面文件≤10个；- 邮件收件箱归档/删除至≤20封；- 待办清单更新；- 下周前3件要事写在便签上放桌面",
        "③离开前拍一张整洁桌面的照片（作为明天来的'欢迎礼'）"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "low",
      "script": "对自己'干净桌面 = 干净头脑。明天来的我，会感谢今天离开的我。'",
      "prohibition": "不要整理上瘾（以'整理'为名逃避真正的工作）；不要丢弃可能重要的文件（不确定的先放'待处理'文件夹）；不要要求所有同事和你一样整齐",
      "timePerSession": "5-30分钟",
      "duration": "每天下班前5分钟+每周五下午30分钟",
      "expectedEffect": "通过物理环境的清理带动心理状态的清理，降低认知负荷",
      "effectNote": "通过物理环境的清理带动心理状态的清理，降低认知负荷",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "角色边界"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "信息隔离时段",
      "attributions": [
        "边界感丧失",
        "时间碎片化"
      ],
      "whenToUse": "随时随地回微信、工作群消息轰炸、下班后无法脱身、边界感丧失",
      "steps": [
        "①选择每天1-2个信息隔离时段（建议：上午9-11点或下午3-5点）",
        "②隔离时段内：；- 手机静音/工作群设为免打扰；- 关闭微信/钉钉桌面提醒；- 告知关键人紧急联络方式（打电话，不是发消息）",
        "③隔离时段结束后：集中15分钟批量处理消息",
        "④下班后：设置自动回复告知已下班",
        "⑤周末：至少半天完全不看工作消息"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "medium",
      "script": "对家长群公告'工作日上午9-11点是我的专注工作时间，急事请直接打电话。'\n对自己'关掉通知不是不负责任，是对重要的事负责。'",
      "prohibition": "不要一上来就设定4小时隔离（从1小时开始）；不要在紧急/危机时期使用（如学生安全事件处理期）；不要对所有人隐瞒你的隔离时段",
      "timePerSession": "每天1-3小时",
      "duration": "每天设定1-2个隔离时段；坚持4周",
      "expectedEffect": "建立信息防火墙，保护个人时间和注意力，恢复工作-生活边界",
      "effectNote": "建立信息防火墙，保护个人时间和注意力，恢复工作-生活边界",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "角色边界"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "两分钟闪电战",
      "attributions": [
        "拖延回避",
        "任务过载"
      ],
      "whenToUse": "小任务堆积如山、拖延症发作、很多事'等一下'就永远没做",
      "steps": [
        "①扫描你所有'等一下再做'的小事",
        "②任何预估≤2分钟能完成的事：立刻做，不放进待办清单；- 例：回复一个简单微信、订正一个错字、归档一个文件",
        "③每次做3-5件这样的2分钟任务",
        "④做完一批后自我认可：'我消灭了X件事'",
        "⑤如果2分钟内做不完：放进待办清单（不是继续做下去）"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "low",
      "script": "对自己'两分钟，我现在就干掉它。'\n对自己'我选择行动，而不是堆积。'",
      "prohibition": "不要把大事拆成小事来逃避大事；不要连续做太多批（容易疲于应付而非真正推进）；不要用这个方法来回避真正需要深度工作的事",
      "timePerSession": "2-5分钟",
      "duration": "每天早晨/午休后立即执行一批",
      "expectedEffect": "利用两分钟规则消灭微任务堆积，减少认知负担",
      "effectNote": "利用两分钟规则消灭微任务堆积，减少认知负担",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "角色边界"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "提前10分钟预演",
      "attributions": [
        "急性焦虑与紧张"
      ],
      "whenToUse": "重要场合紧张（家长会/公开课/汇报/个别谈话）、怕出差错",
      "steps": [
        "①提前30分钟到达场地",
        "②花5分钟熟悉环境：站在讲台/座位、看看光线、摸摸设备",
        "③花5分钟预演开场：；- 想象第一个走进来的人；- 排练前3句话（出声或默念）；- 预想1个可能的意外及应对",
        "④做2次478呼吸（RX-001）",
        "⑤喝半杯温水",
        "⑥开场前对自己微笑一下"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "low",
      "script": "对自己'我准备好了。不是完美，是充分。'\n对自己'我和在场所有人一样，都是普通人。'",
      "prohibition": "不要过度预演到每个细节（反而增加焦虑）；不要临时改内容（预演是为了确认，不是为了推翻重来）；不要喝咖啡/浓茶增加心率",
      "timePerSession": "10分钟",
      "duration": "重要事件前30分钟到场地",
      "expectedEffect": "通过心理和行为预演消除不确定性焦虑，提升临场表现",
      "effectNote": "通过心理和行为预演消除不确定性焦虑，提升临场表现",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "角色边界",
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "单向任务日",
      "attributions": [
        "时间碎片化",
        "任务过载"
      ],
      "whenToUse": "多任务并行导致每件事都做不好、切换成本过高、感觉很忙但没产出",
      "steps": [
        "①每周划出1个半天，只做一类事（如：周三下午=只写评语/只备课/只处理文档）",
        "②提前告知同事这个时段不被打扰",
        "③移除所有与核心任务无关的干扰源",
        "④准备一个'杂念本'：过程中想到其他事→写下来→回到主线",
        "⑤完成后复盘：今天完成了多少？比平时切换模式多完成多少？"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "medium",
      "script": "对自己'今天下午我的身份只有一个：XX任务的执行者。'\n对同事'周三下午是我的深度工作时间，有事我们周四聊。'",
      "prohibition": "不要在做单向任务日的同时接听无关电话；不要选择需要大量协作的事作为单向任务；不要在单向任务日安排会议",
      "timePerSession": "每周半天（3-4小时）",
      "duration": "每周设定1个单向任务半天；坚持4周",
      "expectedEffect": "通过指定'单任务时段'减少注意力切换，提升深度工作产出",
      "effectNote": "通过指定'单任务时段'减少注意力切换，提升深度工作产出",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "角色边界"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "能量匹配任务法",
      "attributions": [
        "精力耗尽与躯体疲劳",
        "时间碎片化"
      ],
      "whenToUse": "高效时段做低价值事、低效时段被迫做高难度事、能量管理一团乱",
      "steps": [
        "①花1周记录自己的能量日志（用RX-021工具）：；- 每小时记录精力值（1-10分）；- 标记什么时段精力最高/最低",
        "②识别你的'黄金时段'（通常2-3个2小时窗口）",
        "③将需要深度思考/创造力的任务安排到黄金时段",
        "④将低能量时段安排行政/重复/社交任务",
        "⑤每天下班前列出明天的3件要事，标注放在哪个时段",
        "⑥每周调整一次"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "medium",
      "script": "对自己'我不需要更多时间，我需要用对时间。'\n（规划时）'上午9-11点是我的钻石时间，只做最难的事。'",
      "prohibition": "不要强行改变自己的节律去迎合别人的时间表（先尊重自己的节律再协调）；不要在黄金时段安排会议和杂务；不要期望每天都能完美执行（70%就是胜利）",
      "timePerSession": "每天5分钟（规划）",
      "duration": "第一周记录能量日志；之后每天根据能量安排任务",
      "expectedEffect": "根据自身能量节律匹配任务难度，让高效率时间做高价值事",
      "effectNote": "根据自身能量节律匹配任务难度，让高效率时间做高价值事",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "角色边界"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "责任边界思维",
      "attributions": [
        "角色边界消失",
        "边界感丧失"
      ],
      "whenToUse": "觉得学生的一切问题都是我的责任、家长不配合也怪自己、过度负责导致倦怠",
      "steps": [
        "①拿出一张纸，画两个圆圈：；- 内圈（我的责任圈）：我直接可控的事；- 外圈（影响圈）：我可以影响但无法控制的事；- 圈外（他人/系统责任）：完全不由我控制的事",
        "②将当前困扰你的事分类放入三个区域",
        "③对内圈的事：制定行动计划",
        "④对外圈的事：写下'我可以做XX来施加影响，但结果不完全取决于我'",
        "⑤对圈外的事：写下'这不是我的责任，我需要练习放手'"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "medium",
      "script": "对自己'我是学生的老师，不是学生的救世主。'\n对家长'教育是家校共同努力的事，我负责学校的部分，家里的部分需要您的配合。'",
      "prohibition": "不要把'有限责任'等同于'不负责'；不要在情绪高涨时做分类（冷静时做）；不要用这个思维来合理化不作为",
      "timePerSession": "10-15分钟",
      "duration": "每次感到过度自责时使用；推荐写下来效果更好",
      "expectedEffect": "建立清晰的责任边界，把自己从'无限责任公司'变成'有限责任合伙'",
      "effectNote": "建立清晰的责任边界，把自己从'无限责任公司'变成'有限责任合伙'",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心",
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "归因重构三步法",
      "attributions": [
        "过度自责",
        "认知锁定"
      ],
      "whenToUse": "自我苛责、把所有问题归因于自己能力不足、'我就是不行'思维",
      "steps": [
        "①识别自动归因：'发生了什么？我的第一反应是什么？'（例：学生成绩下降→'我教得不好'）",
        "②归因三角检验：；- 内因 vs 外因：哪些是我造成的？哪些是外部因素？；- 稳定 vs 不稳定：这是长期问题还是暂时波动？；- 全面 vs 局部：这个问题波及所有方面还是只在这一点上？",
        "③重构平衡归因：'学生的成绩下降可能有一部分和我教学有关，但同时也受到家庭环境、同伴影响和自身状态的影响。这是一个暂时波动，不影响我在其他方面的教学效果。'",
        "④写下重构后的归因陈述"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "medium",
      "script": "对自己'发生这件事，我的责任部分是什么？不是全部。'\n对自己'一件事不能定义我这个人。'",
      "prohibition": "不要从'全是我的错'跳到'全是他们的错'（归因重构追求平衡，不是推卸）；不要在非常情绪化时做（等冷静后再做）；不要用过度积极的归因（'一切都是最好的安排'）来回避真实问题",
      "timePerSession": "5-10分钟/次",
      "duration": "每次出现'都是我的错'想法时使用；坚持2周",
      "expectedEffect": "建立真实、平衡的归因方式，减少过度自责和习得性无助",
      "effectNote": "建立真实、平衡的归因方式，减少过度自责和习得性无助",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心",
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "完美主义去魅",
      "attributions": [
        "完美主义"
      ],
      "whenToUse": "反复修改/检查/犹豫、不敢开始因为怕做得不够好、对'差不多'无法接受",
      "steps": [
        "①当你反复打磨却不敢交付时，问自己三个问题：；- 如果现在交付，最坏的结果是什么？（往往没那么糟）；- 我再花1小时改进，实际效果能提升多少？（边际收益递减）；- 这件事对最终目标的影响有多大？（区分关键和非关键）",
        "②对当前任务设定明确'够好'标准：；- 及格线（60分）：基本完成，能用；- 良好线（80分）：核心质量保证；- 卓越线（95分）：锦上添花",
        "③告诉自己：'90%的事情做到80分就够了'",
        "④节省下来的时间用在真正值得做到95分的事上"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "medium",
      "script": "对自己'完成比完美重要。80分的交付比100分的草稿有价值得多。'\n对同事'这个版本已经可以用了，我们先用起来再迭代。'",
      "prohibition": "不要把'去完美主义'当成偷懒的借口；不要对确实需要高标准的事（如学生安全/关键报告）也降低标准；不要在去魅过程中产生新的完美主义（'我一定要完美地克服完美主义'）",
      "timePerSession": "5-10分钟",
      "duration": "每次遇到完美主义阻碍时使用；关键练习:设定'够好'标准",
      "expectedEffect": "降低完美主义对效率和心理的损害，建立'够好就好'的标准",
      "effectNote": "降低完美主义对效率和心理的损害，建立'够好就好'的标准",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心",
        "角色边界"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "ABCDE情绪重构",
      "attributions": [
        "情绪劳动耗竭",
        "灾难化思维"
      ],
      "whenToUse": "被家长的指责/学生的顶撞/领导的批评击中后持续愤怒或沮丧",
      "steps": [
        "A-激活事件（Activating event）：写下发生了什么（只写事实，不加评论）；例：家长发微信说'你根本不关心我的孩子'",
        "B-自动信念（Belief）：写下你脑中立刻出现的想法；例：'我做的所有努力都被否定了''我不够好'",
        "C-情绪后果（Consequence）：识别你的情绪和身体感受；例：愤怒（胸口发紧）、委屈（想哭）、焦虑（胃紧）",
        "D-挑战信念（Dispute）：用苏格拉底式提问；- 这个信念100%真实吗？；- 有证据反对这个信念吗？；- 如果朋友遇到同样的事，我会怎么劝他？；- 这个信念对我是有帮助的还是有害的？",
        "E-新效果（Effect）：写下调整后的新信念和感受变化；例：'这位家长可能是因为自己焦虑才这样表达的。我的努力没有白费，我需要和他沟通了解他的真实诉求。'"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "low",
      "script": "对家长'我理解您的担忧，我们可以约个时间具体聊聊孩子的情况。'\n对自己'他说的不是我的全部，只是他的感受。两者我都可以接住。'",
      "prohibition": "不要在情绪峰值时做D步骤（先做RX-001冷静）；不要用'理性化'来压抑情绪（承认情绪，再重构认知）；不要让重构变成'找借口'",
      "timePerSession": "5-10分钟",
      "duration": "情绪被触发后10分钟内使用最佳",
      "expectedEffect": "通过认知重构打破'事件→情绪'的自动反应链条，建立更灵活的情绪回应",
      "effectNote": "通过认知重构打破'事件→情绪'的自动反应链条，建立更灵活的情绪回应",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心",
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "最坏情况预演",
      "attributions": [
        "灾难化思维",
        "急性焦虑与紧张"
      ],
      "whenToUse": "对某件事过度焦虑、脑中不断灾难化想象、焦虑阻碍行动",
      "steps": [
        "①写下你脑中最担心的事：_________________",
        "②问自己：这件事发生的概率真实有多少？（1-100%）",
        "③如果最坏情况真的发生：；- 具体会是什么样？（写详细）；- 我能做什么来应对？（至少写3条）；- 谁可以帮我？（至少写1个资源）；- 3个月后回头看，这件事还重要吗？",
        "④你发现：通常最坏情况要么不会发生，要么发生了你也有能力应对",
        "⑤写下1个当下可以做的行动（哪怕只是一小步）"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "low",
      "script": "对自己'就算最坏情况发生了，我也会找到办法应对。我不是毫无资源的。'\n对自己'我的大脑在保护我，但它放大了威胁信号。'",
      "prohibition": "不要在真正危险的情境下使用（如人身安全威胁）；不要沉溺于详细描写最坏情况而不做应对预案；不要在已经有严重焦虑障碍的情况下自行处理",
      "timePerSession": "10-15分钟",
      "duration": "发现自己在灾难化想象时使用",
      "expectedEffect": "通过直面最坏情况降低其心理威慑力，打破焦虑-回避循环",
      "effectNote": "通过直面最坏情况降低其心理威慑力，打破焦虑-回避循环",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心",
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "成长型思维切换",
      "attributions": [
        "认知锁定",
        "效能感不足"
      ],
      "whenToUse": "'我就是不擅长XX''我天生做不好这个'的固定思维、逃避挑战",
      "steps": [
        "①识别固定思维信号词：；- '我天生就……'；- '我就是不擅长……'；- '努力也没用……'；- '他比我聪明……'",
        "②把固定思维'翻译'为成长型思维：；- '我就是不擅长和家长沟通' → '我还在学习如何和家长有效沟通'；- '努力也没用' → '现在的策略没效果，我可以换一种方法'；- '他比我聪明' → '他似乎有不一样的学习策略，我可以观察学习'",
        "③在'翻译'后加一个具体的'我可以……'行动",
        "④每周总结一个'这周我通过努力学到/改进了什么'"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "medium",
      "script": "对自己'我现在还不擅长，但我在学习中。'\n对学生'你不是不会，你只是还不会。'",
      "prohibition": "不要用成长型思维来否定天赋和才能的存在；不要用'努力就好'来回避对结果的评价；不要在需要系统变革的问题上只强调个人成长",
      "timePerSession": "3-5分钟/次",
      "duration": "每次发现固定思维时练习；持续4-8周",
      "expectedEffect": "将固定思维转化为成长型思维，恢复尝试和学习的勇气",
      "effectNote": "将固定思维转化为成长型思维，恢复尝试和学习的勇气",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心",
        "角色边界"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "比较陷阱觉察",
      "attributions": [
        "过度自责",
        "完美主义"
      ],
      "whenToUse": "看到同事获奖/家长认可/别班成绩好时产生嫉妒和自卑、卷又卷不赢躺又躺不平",
      "steps": [
        "①当你觉得'他比我好/我更差'时，暂停并问：；- 我在和谁比？；- 我比的是他的全部还是某一个方面？；- 我是否在用我的'幕后'比他的'高光时刻'？",
        "②写下你独有的3个优势/资源（别人不一定有的）",
        "③将比较方向翻转：；- 不是'他比我好，我不行'；- 而是'去年的我和现在的我相比，我进步了什么？'",
        "④如果对方确实有值得学习的地方：写下1个你可以学习的点（不是'成为他'，而是'借鉴他的方法'）"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "medium",
      "script": "对自己'他的成功 ≠ 我的失败。我们不在同一个跑道上。'\n对自己'我唯一应该比较的人，是昨天的自己。'",
      "prohibition": "不要用'别人靠关系/运气'来贬低他人以减轻自己的不适；不要在教师群体中制造比较（如'你看X老师多厉害'）；不要把合理的学习借鉴变成自我否定",
      "timePerSession": "5-10分钟",
      "duration": "每次感到比较焦虑时使用",
      "expectedEffect": "觉察社会比较的自动化倾向，将比较能量转化为自我参照的成长",
      "effectNote": "觉察社会比较的自动化倾向，将比较能量转化为自我参照的成长",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心",
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "去个人化思维",
      "attributions": [
        "情绪劳动耗竭",
        "关系疏离"
      ],
      "whenToUse": "把学生的行为/家长的态度/领导的要求都理解为针对自己",
      "steps": [
        "①当感到'他这样做是针对我'时，暂停情绪反应",
        "②问自己：；- 这个人对其他同事/老师也是这样吗？；- 他的行为更多反映了他的什么？（处境、压力、习惯、性格）；- 如果换一个人站在我的位置，他会怎么做/怎么说？；- 这件事的本质是关于我还是关于这个人自己的需求？",
        "③写出一个去个人化的解释：'他这样做，更可能是因为XX（他的原因），而不是因为我XX（我的问题）'"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "medium",
      "script": "对自己'这不是针对我，这是他自己的剧本。'\n对家长'我理解您现在很着急，我们来聊聊具体怎么帮孩子。'（不接'你不关心'这个球）",
      "prohibition": "不要用去个人化来逃避真实的反馈（有些批评确实关于你，需要你改进）；不要在明显是针对你的时候强行自我安慰（先确认事实）；不要把一切都归为'他有问题'",
      "timePerSession": "5分钟",
      "duration": "每次感到被针对时使用",
      "expectedEffect": "区分'关于我'和'关于他们自身'的事件，减少不必要的情感消耗",
      "effectNote": "区分'关于我'和'关于他们自身'的事件，减少不必要的情感消耗",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心",
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "影响圈/关注圈练习",
      "attributions": [
        "任务过载",
        "角色边界消失"
      ],
      "whenToUse": "对学校政策/家长素质/社会问题感到无力、觉得'做什么都没用'",
      "steps": [
        "①拿出一张纸，画两个同心圆：；- 内圆 = 影响圈（我能直接控制的事）；- 外圆 = 关注圈（我关心但无法直接控制的事）",
        "②将最近困扰你的事全写出来",
        "③逐一分类放入两个圈",
        "④关注圈里的事：在每一项旁边写上'放手'或'我接受'",
        "⑤影响圈里的事：每一项写出1个具体的行动（哪怕很小）",
        "⑥今天就做1个影响圈里的行动"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "low",
      "script": "对自己'我无法控制风的方向，但我可以调整帆。'\n对自己'把精力放在我能改变的事情上。'",
      "prohibition": "不要把本该在影响圈的事放进关注圈（这是一种逃避）；不要在分类后什么行动都不做（练习的价值在执行）；不要期望一次练习就消除无力感",
      "timePerSession": "10分钟",
      "duration": "感到无力时使用，可每周做1次系统梳理",
      "expectedEffect": "区分可控和不可控，把精力从担忧圈收回影响圈，恢复行动力",
      "effectNote": "区分可控和不可控，把精力从担忧圈收回影响圈，恢复行动力",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心",
        "角色边界"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "叙事重构",
      "attributions": [
        "意义感流失"
      ],
      "whenToUse": "对自己的职业故事只有'累''没意义''不被理解'等负面叙述",
      "steps": [
        "①选一个你感觉'失败'或'没意义'的事件",
        "②用第一人称写下这件事的'标准版'叙述（你平常怎么讲这个故事）",
        "③用三种不同视角重新写这个故事：；- 学生视角：如果你是那个学生，你会怎么描述这个老师的做法？；- 旁观者视角：如果你是一个旁观的同事，你看到了什么？；- 时间拉远视角：5年后回头看，这件事在你职业生涯里是什么位置？",
        "④找出三个版本中的共同主题和被你忽略的细节",
        "⑤写一个新的整合版叙述：'在这个故事里，我其实……'"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "low",
      "script": "（新的叙述可能这样开头）'在那个看似失败的事件里，我其实做到了在压力下保持在场，这本身就是一种力量。'",
      "prohibition": "不要强迫自己一定要找到'正面意义'（有些事就是很难的，承认它很难也是一种重构）；不要在情绪很低落时做（需要一定心理空间）；不要一次重构太多事件",
      "timePerSession": "30-45分钟",
      "duration": "每季度1次深度重构；每次30-45分钟",
      "expectedEffect": "从多个角度重新讲述自己的教育故事，发现被忽略的意义和力量",
      "effectNote": "从多个角度重新讲述自己的教育故事，发现被忽略的意义和力量",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心",
        "意义感知"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "标准化拒绝模板",
      "attributions": [
        "边界感丧失"
      ],
      "whenToUse": "不敢拒绝、答应了又后悔、怕拒绝伤害关系、边界不断被侵蚀",
      "steps": [
        "三步拒绝法：",
        "①肯定（表达感谢或理解）：'谢谢您想到我/我理解这个事很重要……'",
        "②陈述（说明你的限制，用事实而非感受）：'我目前手上有XX和XX，截止时间是XX，确实没办法接下这个。'",
        "③替代（提供可能的出路）：'也许可以找XX试试？/我可以在XX方面给一点建议，但没法完整接手。'；完整示例：'谢谢领导信任我。我目前手上有家长会和期中评语两项工作，本周内确实没办法接新的任务。张老师在这方面很有经验，也许可以和他商量一下？'"
      ],
      "stepDetails": [],
      "form": "script",
      "severity": "low",
      "script": "关键：使用'没办法接下'而不是'我不愿意做'。前者是客观限制，后者容易被理解为态度问题。",
      "prohibition": "不要在拒绝时过度解释（解释越多，越像在找借口）；不要用'可能''也许'这类模棱两可的词（导致对方认为你在犹豫）；不要在情绪化时说'不'（先冷静再拒绝）",
      "timePerSession": "1-2分钟/次",
      "duration": "需要时直接使用，提前练习效果更好",
      "expectedEffect": "掌握安全、尊重、坚定的拒绝话术，保护自己的时间和精力",
      "effectNote": "掌握安全、尊重、坚定的拒绝话术，保护自己的时间和精力",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "时间边界",
        "角色边界"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "边界声明话术",
      "attributions": [
        "边界感丧失",
        "家长沟通压力"
      ],
      "whenToUse": "家长/同事在下班后/周末联系、被要求做超出职责范围的事、边界不断被突破",
      "steps": [
        "①预防性声明（提前说，不针对任何人）：；'各位家长，我的工作时间是周一至周五8:00-17:00，这个时间段内的消息我会及时回复。晚上和周末是家庭时间，紧急情况请直接打电话给我。'",
        "②回应性声明（边界被触碰时）：；'收到您的消息了，明天上班后我会第一时间处理。'；'这个事情超出了我能处理的范围，我建议您联系XX。'",
        "③不回应当做一种回应：非紧急消息在下班后不回复，等到工作时间再回"
      ],
      "stepDetails": [],
      "form": "script",
      "severity": "low",
      "script": "'这是我的休息时间，明天我会好好处理的。'\n'我能做的是XX，超出这个范围的，需要您找XX。'",
      "prohibition": "不要因为内疚而打破自己刚设的边界（一次打破=边界失效）；不要用攻击性语言设边界（'你怎么老是下班发消息'←伤害关系）；不要在设边界后反复道歉",
      "timePerSession": "1-2分钟",
      "duration": "边界被触碰时使用；平时可在家长会/群里做预防性声明",
      "expectedEffect": "清晰、礼貌、坚定地建立和维护个人边界",
      "effectNote": "清晰、礼貌、坚定地建立和维护个人边界",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "时间边界",
        "角色边界"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "转介话术",
      "attributions": [
        "家长沟通压力",
        "支持系统缺失"
      ],
      "whenToUse": "遇到超出自己能力范围的学生问题/家长诉求，不知如何引导他们寻求专业帮助",
      "steps": [
        "①确认转介需要（参照框架二的判断标准）",
        "②使用四步转介话术：",
        "①共情：'我听到你说的这些，感觉你最近确实很不容易。'",
        "②正常化：'很多孩子/家长在类似情况下都会找专业的人聊聊，这很正常。'",
        "③赋权：'你很勇敢，愿意面对这个问题。接下来可能需要比老师更专业的人来帮你。'",
        "④路径：'学校心理老师/XX机构的XX老师在这方面很有经验，我可以帮你联系。我们一起走第一步？'",
        "③不要用'你病了你需要治疗'这样的框架",
        "④如果对方拒绝，不强迫，保持门开着：'好的，什么时候你想聊这个，我都在。'"
      ],
      "stepDetails": [],
      "form": "script",
      "severity": "low",
      "script": "对学生'你不是有问题，你只是遇到了一些需要专业帮手的事。就像打球需要教练一样。'\n对家长'术业有专攻，这方面我不够专业，但我可以帮您找到专业的人。'",
      "prohibition": "不要说'我帮不了你'（听起来像拒绝）；不要说'你问题很严重'（加重污名感）；不要在没有确认资源的情况下空口转介（先建立好转介关系）",
      "timePerSession": "3-5分钟",
      "duration": "需要转介时使用",
      "expectedEffect": "掌握专业、温暖、有效的转介语言，让学生/家长愿意接受专业帮助",
      "effectNote": "掌握专业、温暖、有效的转介语言，让学生/家长愿意接受专业帮助",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "时间边界",
        "同伴支持"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "非暴力沟通四步",
      "attributions": [
        "家长沟通压力",
        "关系疏离"
      ],
      "whenToUse": "和学生/家长/同事发生冲突、沟通总变争吵、说了很多但对方听不进去",
      "steps": [
        "①观察（说事实，不加评论）：'我注意到这已经是这周第三次作业没交了。'；不要说：'你总是偷懒不写作业。'",
        "②感受（说我的感受，不指责对方）：'我感到有些担心。'；不要说：'你让我很生气。'",
        "③需要（说我需要什么，不说你缺什么）：'因为我需要确认你掌握了这个知识点。'；不要说：'你需要更努力。'",
        "④请求（提出具体请求，不是要求）：'你愿意和我一起想个办法，让作业能按时完成吗？'；不要说：'你必须明天把作业补上。'"
      ],
      "stepDetails": [],
      "form": "script",
      "severity": "medium",
      "script": "完整示例：'我看到你最近上课经常低头（观察），我有点担心（感受），因为我想确保你跟得上课程（需要），你愿意下课后和我聊5分钟吗（请求）？'",
      "prohibition": "不要把'请求'伪装成'命令'（如果对方说'不'你就生气，那你提的就是要求不是请求）；不要在情绪激动时强行使用（先冷静再做）；不要只用于别人对自己用（也用来倾听别人的'暴力语言'背后的需要）",
      "timePerSession": "5-15分钟/次",
      "duration": "每次冲突沟通前练习使用；坚持4-8周可内化",
      "expectedEffect": "掌握非暴力沟通框架，把冲突转化为理解与合作的契机",
      "effectNote": "掌握非暴力沟通框架，把冲突转化为理解与合作的契机",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "时间边界",
        "同伴支持"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "积极反馈公式",
      "attributions": [
        "关系疏离"
      ],
      "whenToUse": "只会批评不会表扬、表扬显得空洞（'你真棒'）、需要给学生/同事建设性反馈",
      "steps": [
        "表扬公式（BIA）：",
        "B-行为（Behavior）：'我注意到你最近每天放学后都会留下来整理图书角。'；I-影响（Impact）：'这让我看到了你的责任感，也让其他同学有了干净的阅读环境。'",
        "A-欣赏（Appreciation）：'谢谢你。'；建设性反馈公式（SBI）：；S-情境（Situation）：'昨天课堂小组讨论的时候……'",
        "B-行为（Behavior）：'我注意到你打断了XX同学好几次。'；I-影响（Impact）：'这可能让他觉得自己的观点不被重视。'；→接着用RX-034提出请求"
      ],
      "stepDetails": [],
      "form": "script",
      "severity": "low",
      "script": "（表扬学生）'你今天主动帮同桌捡了掉在地上的文具，这份细心被老师看到了。'\n（建设性反馈）'如果你能等他说完再轮流发言，我觉得大家都会更舒服。'",
      "prohibition": "不要说'但是'（'你很好，但是……'前面的全白说）；不要表扬天赋/聪明（要表扬努力/策略/进步）；不要用笼统的'很棒''不错'（没有信息量）",
      "timePerSession": "1-3分钟/次",
      "duration": "需要给予反馈时使用",
      "expectedEffect": "掌握具体、真诚、有效的行为反馈公式，让表扬有力量、批评有建设性",
      "effectNote": "掌握具体、真诚、有效的行为反馈公式，让表扬有力量、批评有建设性",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "时间边界",
        "同伴支持"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "家长预期管理话术",
      "attributions": [
        "家长沟通压力"
      ],
      "whenToUse": "家长对老师/学校有不切实际的期待、要求'特殊照顾'、把教育责任全部推给老师",
      "steps": [
        "①先倾听：让家长充分表达期望（很多时候被'听见'就满足了大部分）",
        "②反馈理解：'我理解您希望孩子得到最好的教育。'",
        "③共享现实：用客观信息调整预期；- '班级有XX个学生，我每天分配给每个孩子的个别关注时间大约是XX分钟。'；- 'XX问题在这个年龄段是很常见的，通常需要学校和家庭一起来帮孩子度过。'",
        "④提供具体方案：'我能做到的是XX。您在家可以配合的是XX。这样我们分工合作，效果会更好。'",
        "⑤设定复查点：'我们一个月后再看看效果，再调整方案。'"
      ],
      "stepDetails": [],
      "form": "script",
      "severity": "medium",
      "script": "对家长'教育不是老师一个人的事，也不是家长一个人的事。我们是一个团队。'\n'我能承诺的是公平对待每个孩子，尽我所能。但我做不到的是只关注某一个孩子。'",
      "prohibition": "不要承诺做不到的事来安抚家长（短期安抚→长期失信）；不要用专业性打压家长（'你不懂教育'）；不要在情绪对抗时做预期管理（先冷静再沟通）",
      "timePerSession": "10-20分钟/次",
      "duration": "每学期初家长会和日常关键节点使用",
      "expectedEffect": "通过透明、尊重的沟通帮助家长建立合理预期，形成家校同盟",
      "effectNote": "通过透明、尊重的沟通帮助家长建立合理预期，形成家校同盟",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "时间边界",
        "同伴支持"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "沉默的勇气",
      "attributions": [
        "关系疏离",
        "家长沟通压力"
      ],
      "whenToUse": "总想'说点什么'来填满沉默、对学生/家长过度解释、急于解决问题而说太多",
      "steps": [
        "①识别什么时候该沉默：；- 学生刚说完一件重要的事，需要时间消化时；- 对方情绪激动，讲道理没有用时；- 你已经表达了核心意思，再说就是重复时；- 你不知道说什么但又觉得非说不可时",
        "②沉默时可以做的事：；- 做一次深呼吸；- 保持眼神接触（柔和，不是凝视）；- 微微点头表示你在",
        "③沉默后可以说的：；- '我在想你说的。'；- '谢谢你告诉我这些。'；- '我想了解更多。'"
      ],
      "stepDetails": [],
      "form": "script",
      "severity": "low",
      "script": "（沉默本身就是一种语言。它说的是：'我在这里，我在听，我不急着修好你。'）",
      "prohibition": "不要用沉默来惩罚/冷暴力对方；不要在需要明确回应时保持沉默（如安全问题、紧急决策）；不要把'沉默'等同于'不关心'",
      "timePerSession": "不需要额外时间",
      "duration": "与学生个别谈话/家长面谈/危机安抚时使用",
      "expectedEffect": "学会在适当的时候不说什么，让沉默成为有力的沟通工具",
      "effectNote": "学会在适当的时候不说什么，让沉默成为有力的沟通工具",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "时间边界",
        "同伴支持"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "重新框架话术",
      "attributions": [
        "家长沟通压力"
      ],
      "whenToUse": "面对消极/抱怨的学生或家长，对话越聊越丧、不知如何扭转氛围",
      "steps": [
        "重新框架三步：",
        "①接纳对方感受（不说'别这么想'）：'我能理解你为什么这么觉得。'",
        "②引入新视角（以提问方式，不强制）：'如果从这个角度看呢……？'",
        "③连接到可能性和行动：'你觉得有哪些小事情是我们现在可以做的？'；示例：；家长：'我孩子就是不爱学习，怎么管都没用。'；回应：'我能理解您的挫败感（接纳）。我注意到他在体育课上非常积极，也很有团队精神。您觉得这种状态有没有可能迁移到学习上（新视角）？我们可以从一个小目标开始试试（连接行动）？'"
      ],
      "stepDetails": [],
      "form": "script",
      "severity": "low",
      "script": "'我听到了你的困难。除了这些困难，最近有没有哪怕一件小事是顺利的？'\n'我看到了问题所在。同时，我也注意到了你在XX方面的进步。'",
      "prohibition": "不要说'往好处想'或'乐观点'（否定对方感受）；不要强行找积极面（显得不真诚）；不要在对方处于严重危机时使用（先做危机干预）",
      "timePerSession": "2-5分钟",
      "duration": "对话陷入消极循环时使用",
      "expectedEffect": "掌握重新框架技术，帮助对方看到不同的角度而不否定他们的感受",
      "effectNote": "掌握重新框架技术，帮助对方看到不同的角度而不否定他们的感受",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "时间边界",
        "效能信心"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "情绪温度计",
      "attributions": [
        "情绪觉察薄弱",
        "情绪劳动耗竭"
      ],
      "whenToUse": "不知道自己的情绪已经累积到临界点、突然爆发吓到自己和他人、情绪觉察力弱",
      "steps": [
        "①设置闹钟提醒（上午10点/下午3点/下班前）",
        "②每次用1-10给自己打分：；1-3（绿灯）：平静/满足/有能量 → 正常运转；4-6（黄灯）：烦躁/疲惫/有一点堵 → 需要微调（喝水/呼吸/走动）；7-8（橙灯）：愤怒/委屈/想哭 → 需要暂停（做一次RX-001/RX-002）；9-10（红灯）：快要爆发/崩溃 → 立即离开当前情境，使用应急处方",
        "③记录触发事件（什么事让温度上升）",
        "④一周后回顾：什么规律？什么最容易升温？",
        "⑤规则：黄灯就开始处理，不要等到红灯"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "medium",
      "script": "对自己'我现在是6分，已经有累的信号了。我需要休息5分钟。'\n对学生'老师现在需要冷静一下，我们暂停2分钟。'",
      "prohibition": "不要到红灯才处理（目标是在黄灯时就干预）；不要因为分数高而自责（分数只是信号，不是评价）；不要在红灯时做重要决策",
      "timePerSession": "每次30秒",
      "duration": "每天3次（上午/下午/下班时）自评；坚持2周可提升觉察力",
      "expectedEffect": "通过可视化+规律化监测，提前识别情绪升级信号，在爆发前主动干预",
      "effectNote": "通过可视化+规律化监测，提前识别情绪升级信号，在爆发前主动干预",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "STOP技术",
      "attributions": [
        "急性焦虑与紧张",
        "情绪觉察薄弱"
      ],
      "whenToUse": "被激怒时马上要做出过激反应、即将说出伤人的话或做出冲动的决定",
      "steps": [
        "S-Stop（停下来）：不管在做什么、说什么，立刻停下来。像按了暂停键。；T-Take a breath（深呼吸）：做一次缓慢深呼吸，吸气4秒，呼气6秒。；O-Observe（观察）：问自己——；- 我身体哪个部位有感觉？（胸口紧？脸发热？）；- 我此刻的情绪是什么？（愤怒/受伤/害怕？）；- 我的冲动反应是什么？（想骂人？想走掉？）；- 如果我真的那样做，后果是什么？；P-Proceed（继续）：选择最有助于达成目标的回应方式"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "low",
      "script": "对自己'STOP.我可以选择怎么回应。'\n（暂停后对他人）'让我想一下再回答你。'",
      "prohibition": "不要在Stop环节被对方催促就跳过（'我在想'是正当的）；不要在Observe环节沉溺于分析（目的是回归理性，不是分析到底谁对谁错）；不要在极度危险情境用（如有人身安全威胁→先离开）",
      "timePerSession": "30秒-2分钟",
      "duration": "感觉'马上要爆发'时立即使用",
      "expectedEffect": "在刺激和反应之间插入一个4步暂停，避免冲动反应带来的后果",
      "effectNote": "在刺激和反应之间插入一个4步暂停，避免冲动反应带来的后果",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "情绪命名练习",
      "attributions": [
        "情绪觉察薄弱"
      ],
      "whenToUse": "说不清楚自己什么感受、只觉得'难受/烦/不好'、情绪模糊加剧痛苦",
      "steps": [
        "①准备一张'情绪词汇表'（或打印贴在桌上）：；- 基础情绪：快乐/悲伤/愤怒/恐惧/厌恶/惊讶；- 进阶词汇：沮丧/失望/委屈/嫉妒/惭愧/羞愧/焦虑/紧张/孤独/无助/疲惫/麻木/压抑/不甘/迷茫/感动/欣慰/释然/骄傲/满足",
        "②每天睡前问自己：'今天我主要体验了哪3种情绪？'",
        "③给每种情绪打分（1-10强弱）",
        "④写下触发该情绪的事件",
        "⑤进阶：发现自己经常用什么词回避真实情绪（如用'烦'替代'失望'/'委屈'）"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "medium",
      "script": "对自己‘我今天感到的不只是“烦”，而是“因被误解而产生的委屈”和“因工作量过大而产生的无力感”。’",
      "prohibition": "不要只用1-2个词概括所有情绪（如一切都用'累'或'烦'）；不要在情绪命名时自我批判（'我不该有这种情绪'）；不要强迫自己一定要找到'正确'的词",
      "timePerSession": "3-5分钟",
      "duration": "每天睡前做1次情绪命名练习；坚持4周",
      "expectedEffect": "提升情绪粒度（emotional granularity），用精准命名降低情绪的模糊性痛苦",
      "effectNote": "提升情绪粒度（emotional granularity），用精准命名降低情绪的模糊性痛苦",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "正念三分钟",
      "attributions": [
        "急性焦虑与紧张",
        "情绪觉察薄弱"
      ],
      "whenToUse": "课间/活动间隙/走廊上时的碎片焦虑、需要快速重置注意力",
      "steps": [
        "第一分钟-扫描：注意此刻身体的感觉——脚踩地面的感觉、坐着的压力、衣服接触皮肤……；第二分钟-呼吸：将所有注意力放在鼻尖的呼吸上，感受气息一进一出。思绪飘走没关系，轻轻带回来。；第三分钟-扩展：将注意力从呼吸扩展到整个身体，感受身体作为一个整体的存在感。然后慢慢睁开眼睛，重新进入当下的任务。"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "low",
      "script": "不需要说什么。这是你给自己留的3分钟空隙。",
      "prohibition": "不要把'思绪飘走'当做失败（飘走-回来-飘走-回来就是练习本身）；不要在需要高度警惕的情境中闭眼（可以用睁眼正念）；不要期望每次都有'特别的感觉'",
      "timePerSession": "3分钟",
      "duration": "任何碎片间隙使用；每天2-5次",
      "expectedEffect": "在极短时间内通过正念呼吸恢复注意力和情绪平衡",
      "effectNote": "在极短时间内通过正念呼吸恢复注意力和情绪平衡",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "冷静角",
      "attributions": [
        "情绪觉察薄弱",
        "自我关怀不足"
      ],
      "whenToUse": "办公室/教室里没有可以独处冷静的空间、情绪上来无处可去",
      "steps": [
        "①物理冷静角：在办公室/教室找一个角落，放一把椅子、一个小靠枕、一张'冷静提示卡'",
        "②冷静提示卡内容：；- 做3次深呼吸；- 喝一口水；- 你想对这个情绪说什么？；- 这个情绪想告诉你什么？；- 你现在需要什么？（安静/喝水/写下来/找人聊聊/出去走走）",
        "③也可以创建'移动冷静角'：包里放一个小物件（光滑石头/精油滚珠/薄荷糖），情绪上来时触摸/闻/尝它",
        "④用冷静角不等于'逃避'，等于'我先处理好自己，再处理好事情'"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "low",
      "script": "对自己'我需要5分钟来处理自己的情绪，这是专业的做法。'\n对学生'老师现在在冷静角充电，5分钟后再聊。'",
      "prohibition": "不要把冷静角变成惩罚角（尤其不要对学生说'去冷静角罚站'）；不要在冷静角待超过15分钟（超过可能是回避）；不要指望设置后立即自动使用（需要刻意练习）",
      "timePerSession": "3-5分钟",
      "duration": "需要时使用；预热：提前布置好",
      "expectedEffect": "创建一个物理或心理的'安全小空间'，用于短期情绪调节",
      "effectNote": "创建一个物理或心理的'安全小空间'，用于短期情绪调节",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "情绪日志",
      "attributions": [
        "情绪觉察薄弱",
        "情绪劳动耗竭"
      ],
      "whenToUse": "情绪起伏大但不知道为什么、同样的情况反复触发同样的情绪反应",
      "steps": [
        "①每天睡前回答以下问题：；- 今天情绪最高点是什么时候？发生了什么？；- 今天情绪最低点是什么时候？发生了什么？；- 我用了什么方法来应对？效果如何？；- 今天有什么让我感到感恩/满足的事？（至少1件）；- 今天的情绪温度计总分是？（1-10）",
        "②每周日回顾：；- 这周的触发模式是什么？；- 哪些应对策略有效？哪些无效？；- 下周想尝试什么不同的方法？",
        "③不追求写得多好，追求真实和持续"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "medium",
      "script": "（日志开头）'今天发生了……我的感受是……我在那个时刻做了什么……现在回头看，我学到了……'",
      "prohibition": "不要为了'好看'而美化真实感受；不要跳过感恩/满足的部分（即使很少也要写）；不要因为有一天没写就放弃整个习惯",
      "timePerSession": "10分钟/天",
      "duration": "每天睡前10分钟；坚持至少4周",
      "expectedEffect": "通过规律记录发现情绪模式、触发点和有效的应对策略",
      "effectNote": "通过规律记录发现情绪模式、触发点和有效的应对策略",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "预期性焦虑管理",
      "attributions": [
        "急性焦虑与紧张",
        "灾难化思维"
      ],
      "whenToUse": "周日晚上开始焦虑周一、开学前一周失眠、重要节点前持续紧张",
      "steps": [
        "①写下'我最担心的5件事'（具体化焦虑）",
        "②对每件事标注：；- 实际发生概率（1-100%）；- 即使发生，我能做的应对措施；- 有什么我现在可以提前准备的？",
        "③列出'我能控制的'和'我无法控制的'（参考RX-029）",
        "④写一个'最可能发生的真实情况'（不是灾难版，也不是理想版）",
        "⑤制定'如果XX就XX'的应急小方案（至少3条）",
        "⑥每天选择一个当前能做的小行动并完成它"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "medium",
      "script": "对自己'焦虑是我的大脑在预演问题，这是正常的。现在我让大脑预演解决方案。'\n对自己'无论下周发生什么，今天的我可以做什么准备？'",
      "prohibition": "不要在睡前做这个练习（容易激活焦虑）；不要反复预演同一个灾难场景（一次就够了）；不要用'别焦虑了'来压制自己",
      "timePerSession": "每天10-15分钟",
      "duration": "重大节点前1周开始使用",
      "expectedEffect": "通过结构化预期管理降低等待性焦虑，变焦虑为准备",
      "effectNote": "通过结构化预期管理降低等待性焦虑，变焦虑为准备",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "每日三件删除",
      "attributions": [
        "工作生活失衡"
      ],
      "whenToUse": "下班后脑中仍在运转工作、无法切换到生活模式、在家心不在焉",
      "steps": [
        "①下班前做三件事：；删除：从待办清单中勾掉今天完成的事（即使只完成了一半，勾掉已完成部分）；归档：把今天用过的文件/物品归位；写下：写下明天第一件要做的事（放在桌面上）",
        "②做完后对自己说一句结束语（建议固定一句话）：；'今天的工作结束了。剩下的明天再说。'",
        "③做一个小动作作为'关闸'信号：关上电脑盖子/关灯/把椅子推进桌子",
        "④离开时不回头看办公桌"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "low",
      "script": "对自己'今天我已尽力。不够好的地方，明天再修。'\n对自己'现在开始，我是我自己，不是班主任。'",
      "prohibition": "不要在删除时追加新任务；不要说'再回最后一条消息'（永远没有最后一条）；不要让手机成为'隐形办公室'",
      "timePerSession": "3-5分钟",
      "duration": "每天下班前执行",
      "expectedEffect": "通过仪式化的'工作结束信号'，帮助大脑完成从工作模式到个人模式的切换",
      "effectNote": "通过仪式化的'工作结束信号'，帮助大脑完成从工作模式到个人模式的切换",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "意义感知",
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "周末清零仪式",
      "attributions": [
        "工作生活失衡",
        "睡眠问题"
      ],
      "whenToUse": "周末还在想工作、玩也玩不好、对周一充满抗拒和焦虑",
      "steps": [
        "①周五下班前完成以下5件事：",
        "①桌面物理清零（RX-015）",
        "②周工作简结（3句话：这周完成了什么？有什么挑战？学到了什么？）",
        "③列出下周前3件要事（不超过3件）",
        "④写下1件周末期待的事（无论多小）",
        "⑤关掉工作设备或退出所有工作账号",
        "②说一句：'这周结束了。周末是我的。'",
        "③如果周末想到了工作相关的事：记在手机备忘录里（不展开思考），周一再看"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "low",
      "script": "对自己'周一到周五我是老师，周六和周日我是我自己。这两个身份同等重要。'",
      "prohibition": "不要定'周末必须完成XX工作'的目标（除非绝对必要且你愿意）；不要因为'别的老师都在加班'而内疚；不要在周日下午/晚上开始'预习'周一的焦虑",
      "timePerSession": "15分钟",
      "duration": "每周五下班前执行",
      "expectedEffect": "通过一套仪式化流程完成工作周和个人周的切换，保护周末的心理空间",
      "effectNote": "通过一套仪式化流程完成工作周和个人周的切换，保护周末的心理空间",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "意义感知",
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "晨间自我确认仪式",
      "attributions": [
        "自我关怀不足",
        "效能感不足"
      ],
      "whenToUse": "早晨起床就感觉沉重、没有动力、带着负面预期开始一天",
      "steps": [
        "①起床后第一件事：喝一杯常温水（不做别的事）",
        "②站在镜子前，看着自己的眼睛，说三句话：；- '今天，我选择带着XX面对这一天。'（XX填入你需要的品质：耐心/温柔/力量/平静）；- '我是够好的。'；- '今天会出现的不顺，不是我的失败。'",
        "③做3次深呼吸",
        "④如果时间允许：写下今天最想做成的1件事和1件为了自己的事",
        "⑤进阶：每周换一个'品质词'来聚焦练习"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "medium",
      "script": "对自己'今天，我选择带着耐心面对这一天。我是够好的。今天会出现的不顺，不是我的失败。'",
      "prohibition": "不要机械背诵不走心（哪怕只说一句走心的也比三句空洞的好）；不要在确认时批判自己（'我根本就不够好'）；不要在严重抑郁时强迫积极（那时需要的是接纳不是确认）",
      "timePerSession": "3-5分钟",
      "duration": "每天早晨起床后执行；坚持3周形成习惯",
      "expectedEffect": "通过简短的早晨仪式设置一天的积极基调，建立内在稳定感",
      "effectNote": "通过简短的早晨仪式设置一天的积极基调，建立内在稳定感",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "意义感知"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "感谢信仪式",
      "attributions": [
        "关系疏离",
        "意义感流失"
      ],
      "whenToUse": "只看到问题看不到好、关系变得疏离、觉得付出没有回报",
      "steps": [
        "①每周选1个你想感谢的人（同事/学生/家长/家人/自己）",
        "②写一封信，包含：；- 具体的某件事或某个时刻（他做了什么/说了什么）；- 这件事对你的影响（你的感受/改变）；- 你欣赏他的什么品质",
        "③不一定真的要寄出去（当然寄出去效果更好）",
        "④如果不写信，用'三件好事'简化版：每天睡前写下今天发生的3件好事以及为什么它们会发生",
        "⑤回顾：写完之后，你的情绪有变化吗？"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "medium",
      "script": "（给同事的信）'上周你在家长会上帮我打圆场的那一刻，我心里特别暖。在那种被质问的情境下，有同伴站在身边，感觉完全不一样。谢谢你。'\n（给自己的）'今天我耐心地听一个孩子说了10分钟。那颗心是打开的。我觉得我做对了。'",
      "prohibition": "不要写笼统的感谢（'谢谢你对我好'=不够具体）；不要带着'我写了所以你也应该回馈'的期待；不要在情绪非常低落时强迫自己写（那时可以用RX-050替代）",
      "timePerSession": "10-15分钟/周",
      "duration": "每周写1封感谢信/感谢记录；坚持4周",
      "expectedEffect": "通过结构化的感谢练习，重新注意到关系中积极的部分，改善情感连接",
      "effectNote": "通过结构化的感谢练习，重新注意到关系中积极的部分，改善情感连接",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "意义感知",
        "同伴支持"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "自我关怀休息",
      "attributions": [
        "自我关怀不足",
        "过度自责"
      ],
      "whenToUse": "觉得自己不够好/做错了事后的自我攻击、对自我关怀有抵触（'我不配'）",
      "steps": [
        "①当你发现自己正在自我攻击时（'我怎么这么差''又搞砸了'），先停下来",
        "②把手轻轻放在心口",
        "③对自己说三句话（顺序很重要）：",
        "①正念：'此刻我很难受/此刻我很挫败。'（承认，不回避）",
        "②共通人性：'难受是人之常情。每个人都会经历这样的时刻。'（我不孤单）",
        "③自我善意：'愿我对自己温柔一点。'（给自己善意）",
        "④问自己：'我现在需要什么？'（休息/独处/说说话/哭一场/一杯热水）",
        "⑤满足那个需要（哪怕是其中一小部分）"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "medium",
      "script": "对自己'搞砸了就是搞砸了。我不是完美的人。这不妨碍我是一个在努力的好老师。'\n对自己'如果我的好朋友犯了同样的错，我会怎么对她说？现在，我这样对自己说。'",
      "prohibition": "不要让自我关怀变成自我放纵（自我关怀≠不负责）；不要在自我关怀时转而陷入自怜（自怜=孤立，自我关怀=连接）；不要因为第一次做觉得别扭就放弃（这是技能，需要练习）",
      "timePerSession": "5-10分钟",
      "duration": "每次自我批评出现时使用；关键期每天1次",
      "expectedEffect": "通过结构化的自我关怀练习，建立像对待好朋友一样对待自己的能力",
      "effectNote": "通过结构化的自我关怀练习，建立像对待好朋友一样对待自己的能力",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "意义感知",
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "每月回顾仪式",
      "attributions": [
        "意义感流失",
        "工作生活失衡"
      ],
      "whenToUse": "浑浑噩噩一个月过去不知道做了什么、觉得没有成长、失去方向感",
      "steps": [
        "①打开日历/日志，回顾这个月：；- 发生了哪些重要的事？（工作+个人）；- 哪些事做得好？为什么？；- 哪些事可以改进？怎么改进？；- 哪些事消耗了我？哪些事滋养了我？",
        "②检查上个月的目标完成情况",
        "③写下本月在班主任能力模型（7个维度）中的进展",
        "④设定下个月1-2个成长重点（不要贪多）",
        "⑤写一句话送给下个月的自己"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "low",
      "script": "（写给自己）'这个月你度过了XX挑战，你在XX方面进步了。下个月，让XX成为你的焦点。'",
      "prohibition": "不要变成形式主义的'填表游戏'（走心比走量重要）；不要只关注工作忽略个人生活；不要在非常疲惫时做（选一个有精力的时间）",
      "timePerSession": "30分钟",
      "duration": "每月最后一天/第一天执行",
      "expectedEffect": "通过系统性月度回顾建立时间感和成长感，调整下月方向",
      "effectNote": "通过系统性月度回顾建立时间感和成长感，调整下月方向",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "意义感知"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "告别仪式",
      "attributions": [
        "意义感流失"
      ],
      "whenToUse": "学期/学年/带班周期结束时感觉空虚、毕业生离开后的失落、没有好好告别",
      "steps": [
        "①回顾：写下这个阶段你印象最深的3个瞬间",
        "②梳理：你从这个阶段学到了什么？（关于教学/关于自己/关于关系）",
        "③感谢：写下你想感谢的3个人/事（可以写给具体的某个人）",
        "④遗憾：写下你的遗憾（没做到的/做得不够好的）。然后对自己说：'我接受这些遗憾。它们也是我故事的一部分。'",
        "⑤告别：写一句话做正式的告别",
        "⑥仪式：做一个小动作（合上笔记本/摘下班级名牌/折一架纸飞机飞出去）"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "low",
      "script": "（告别的话）'这段旅程结束了。我带走了这些，放下了那些。谢谢你。'\n对学生'很高兴做了你们这一程的老师。你们教会我的，和我想教你们的一样多。'",
      "prohibition": "不要跳过'遗憾'环节（很多人会在告别时回避负面感受）；不要让告别变成自我否定的机会；不要在情绪高涨时做重要的收尾决策",
      "timePerSession": "15-30分钟",
      "duration": "每个重要周期结束时使用",
      "expectedEffect": "为重要的关系和阶段画上完整的句号，为新的开始腾出心理空间",
      "effectNote": "为重要的关系和阶段画上完整的句号，为新的开始腾出心理空间",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "意义感知"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "压力-能量日志",
      "attributions": [
        "精力耗尽与躯体疲劳",
        "情绪觉察薄弱"
      ],
      "whenToUse": "不知道什么在消耗自己、什么在滋养自己、感到'累'但不知道为什么",
      "steps": [
        "记录模板（每天结束时填写）：；| 活动/事件 | 压力值（-5到+5） | 能量变化 | 备注 |；压力值：-5=极度消耗，0=中性，+5=极大充电；能量变化：用箭头表示 ↑充电 ↓消耗 →不变；示例：；| 和家长沟通学生问题 | -3 | ↓ | 感觉无力；| 和学生课间聊天 | +3 | ↑ | 轻松愉快；| 开无效会议 | -4 | ↓↓ | 浪费时间；2周后统计分析：高频消耗活动有哪些？高频充电活动有哪些？如何减少前者、增加后者？"
      ],
      "stepDetails": [],
      "form": "worksheet",
      "severity": "medium",
      "script": "（回顾时）'我原来以为最累的是上课，结果数据显示是家长沟通。我需要在这方面找装备。'",
      "prohibition": "不要在记录时自我批判（'我居然觉得这个累'←不评判）；不要只记消耗不记充电（正向数据同样重要）；不要用这个工具来证明'我的工作就是苦'",
      "timePerSession": "每天5分钟",
      "duration": "每天记录；持续2周为1个周期",
      "expectedEffect": "通过2周的系统记录发现个人压力源和能量源的规律，精准调整生活",
      "effectNote": "通过2周的系统记录发现个人压力源和能量源的规律，精准调整生活",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "边界地图",
      "attributions": [
        "边界感丧失",
        "角色边界消失"
      ],
      "whenToUse": "说不清自己的边界在哪、总在不同情境中边界不一致、边界经常被突破",
      "steps": [
        "①在一张纸上画出5个同心圆层：；最内层：只属于自己的-核心自我；第二层：亲密关系-极少数人（家人/挚友）；第三层：工作协作-同事/学生/家长；第四层：社交-普通熟人；最外层：公众",
        "②在每一层写下：；- 这一层的人可以接触到我的什么信息/时间/精力？；- 这一层的人不可以触碰我的什么？（非卖品清单）；- 如果这一层有人越界了，我该怎么回应？",
        "③把'非卖品清单'贴在看得见的地方",
        "④当边界被触碰时，对照地图决定回应"
      ],
      "stepDetails": [],
      "form": "worksheet",
      "severity": "medium",
      "script": "对自己'我的下班时间属于第二层以内。第四层的人在工作时间之外联系我，不是非回不可的。'\n对家长'有关孩子的学习情况，我们可以在工作时间沟通。我的个人微信是留给家人和朋友的。'",
      "prohibition": "不要期望画了地图就能完美执行（边界是肌肉，需要练习）；不要对所有人设同样的边界（教师和家长/同事是不同的层级）；不要一边设边界一边为设边界道歉",
      "timePerSession": "首次30分钟/维护10分钟",
      "duration": "首次绘制30分钟；之后每月维护1次",
      "expectedEffect": "通过可视化自己的边界体系，建立清晰、一致的边界认知和行动指南",
      "effectNote": "通过可视化自己的边界体系，建立清晰、一致的边界认知和行动指南",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心",
        "角色边界"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "优先级矩阵",
      "attributions": [
        "任务过载",
        "时间碎片化"
      ],
      "whenToUse": "每天忙忙碌碌但最重要的事没推进、被紧急但不重要的事牵着走",
      "steps": [
        "画一个2×2矩阵：；紧急           不紧急；重要    Q1-危机/截止    Q2-成长/规划/关系；不重要  Q3-打扰/琐事    Q4-逃避/消磨；使用方法：",
        "①列出今天/本周所有要做的事",
        "②逐项放入四个象限",
        "③Q1（重要+紧急）：立即做，做完1件再做下1件",
        "④Q2（重要+不紧急）：安排在黄金时段（RX-020）",
        "⑤Q3（紧急+不重要）：委托或批量处理",
        "⑥Q4（不紧急+不重要）：果断删除",
        "⑦目标：逐渐把时间从Q1转移到Q2（灭火→防火）"
      ],
      "stepDetails": [],
      "form": "worksheet",
      "severity": "low",
      "script": "对自己'这件事紧急，但它重要吗？'\n对自己'花在Q2上的每一分钟，都是在预防未来的Q1危机。'",
      "prohibition": "不要把Q3误判为Q1（紧急≠重要）；不要在Q2被长期忽略后才开始重视；不要把所有事都放进Q1（如果'都是紧急重要的'，说明你的判断标准需要校准）",
      "timePerSession": "5-10分钟",
      "duration": "每天早晨/每周一使用",
      "expectedEffect": "使用艾森豪威尔矩阵对任务进行四象限分类，确保时间投向重要的事",
      "effectNote": "使用艾森豪威尔矩阵对任务进行四象限分类，确保时间投向重要的事",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心",
        "角色边界"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "能量审计表",
      "attributions": [
        "精力耗尽与躯体疲劳"
      ],
      "whenToUse": "精力管理一团糟、不知道什么活动消耗/补充能量、常感疲惫但找不到原因",
      "steps": [
        "记录模板（每2小时记录1次）：；| 时间段 | 主要活动 | 精力值(1-10) | 专注度(1-10) | 情绪状态 |；精力值评估标准：；1-3：精疲力竭，不想动；4-6：一般，能应付；7-8：精力充沛，状态好；9-10：精力爆棚，心流状态；7天后统计：；- 精力高峰在什么时段？；- 精力低谷在什么时段？；- 什么事最耗精力？什么事最补充精力？；- 周末和工作日的精力曲线有何不同？；调整策略：高精力做高价值事，低谷安排机械/社交/休息"
      ],
      "stepDetails": [],
      "form": "worksheet",
      "severity": "medium",
      "script": "（审视数据时）'我下午3点后精力跌到3分，这段时间安排需要创造力的工作是无效的。改做批改作业/整理文件这类机械任务。'",
      "prohibition": "不要记录得过于精细以至于记录本身成为负担；不要在看到数据后不做任何调整；不要拿自己的精力曲线和别人比",
      "timePerSession": "每天5分钟×7天",
      "duration": "连续记录1周；之后每季度做1次复查",
      "expectedEffect": "通过1周的详细记录绘制个人能量地图，精准优化精力分配",
      "effectNote": "通过1周的详细记录绘制个人能量地图，精准优化精力分配",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心",
        "角色边界"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "倦怠信号自查表",
      "attributions": [
        "情绪耗竭",
        "意义感流失"
      ],
      "whenToUse": "不确定自己是否正在倦怠、身边人提醒'你最近状态不对'但自己没感觉",
      "steps": [
        "请在以下条目中，勾选近1个月出现的频率（从未/偶尔/经常/总是）：；情绪耗竭维度：",
        "□ 早上起床想到上班就觉得累",
        "□ 感觉情感上被掏空了",
        "□ 对学生/家长越来越没有耐心",
        "□ 下班后需要很长时间才能恢复；去人格化维度：",
        "□ 把学生当成'一个个案例'而非活生生的人",
        "□ 对学生的问题感到麻木或不关心",
        "□ 用冷嘲热讽的方式谈论学生/家长",
        "□ 越来越想回避与人打交道；成就感降低维度：",
        "□ 觉得自己的工作没有意义",
        "□ 觉得自己越来越不称职",
        "□ 看不到自己的进步和成长",
        "□ 对曾经热爱的工作失去热情；评分：从未=0/偶尔=1/经常=2/总是=3；总分0-12：绿灯，状态良好；总分13-24：黄灯，需要关注和调整；总分25-36：红灯，建议寻求专业支持和结构性调整"
      ],
      "stepDetails": [],
      "form": "worksheet",
      "severity": "low",
      "script": "（黄灯时）'我最近有一些倦怠信号，这不是我的错，这是我的身体在提醒我需要调整。'\n（红灯时）'我需要认真对待这些信号。找心理老师聊聊/和领导沟通调整/好好休息。'",
      "prohibition": "不要在红灯时忽视或否认（'大家都这样'）；不要把自查表当诊断工具（它是筛查，不是诊断）；不要在评估后什么都不做",
      "timePerSession": "5-10分钟",
      "duration": "每月自评1次；高风险期每2周1次",
      "expectedEffect": "通过系统化自查工具早期识别职业倦怠信号，在可逆阶段采取行动",
      "effectNote": "通过系统化自查工具早期识别职业倦怠信号，在可逆阶段采取行动",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "能力雷达图自评",
      "attributions": [
        "效能感不足",
        "支持系统缺失"
      ],
      "whenToUse": "不清楚自己的优势和短板、不知道从哪开始职业成长",
      "steps": [
        "对以下7个维度打分（1-10）：",
        "①班级管理能力：建立秩序、营造氛围、处理突发事件",
        "②心理识别能力：发现学生心理/情绪问题的早期信号",
        "③家校沟通能力：与家长建立合作、处理冲突、传达困难信息",
        "④危机干预能力：识别和初步处理心理危机、掌握转介流程",
        "⑤自我调节能力：管理自身压力情绪、保持工作-生活平衡",
        "⑥团队协作能力：与同事合作、给同伴支持、参与集体决策",
        "⑦教育规划能力：设计班级发展目标、规划学期工作、迭代改进；将7个分数连接成雷达图。；标记：前2高分=优势区，最低2分=成长区；选择1个成长区作为本学期重点发展方向"
      ],
      "stepDetails": [],
      "form": "worksheet",
      "severity": "low",
      "script": "对自己'我的心理识别能力和家校沟通能力是强项，但自我调节能力需要加强。这学期我把成长重点放在这里。'",
      "prohibition": "不要在和同事比较的心态下打分（这是自评，不是排名）；不要期望所有维度都高分（有强有弱才是真实的）；不要在打分后不做成长计划",
      "timePerSession": "15分钟",
      "duration": "每学期1次",
      "expectedEffect": "通过7维度能力自评可视化自己能力的强弱分布，精准定位成长方向",
      "effectNote": "通过7维度能力自评可视化自己能力的强弱分布，精准定位成长方向",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "周三检查点",
      "attributions": [
        "任务过载",
        "时间碎片化"
      ],
      "whenToUse": "一周过了一半发现什么都没推进、到了周五才开始赶工、周计划形同虚设",
      "steps": [
        "周三下午用10分钟回答以下问题：",
        "①这周前3天，我完成了周计划中的多少？（%）",
        "②有什么计划外的事占用了大量时间？（反思是否需要调整边界）",
        "③剩下的2天半，前3件最需要完成的事是什么？（重新排序）",
        "④有什么可以放弃/推迟/委托的？（用RX-011的剃刀思维）",
        "⑤我这周的整体感受如何？（打分1-10）",
        "⑥今天下班前，我能做什么来让周五不那么赶？"
      ],
      "stepDetails": [],
      "form": "worksheet",
      "severity": "low",
      "script": "对自己'周计划执行了40%，主要是因为两个计划外的家长沟通。接下来2天聚焦于完成期中评语和家长会方案这两件事。'\n对自己'完成比完美重要。这周不追求做完全部，追求做完最重要的。'",
      "prohibition": "不要在检查时自我攻击（'我又没完成计划'←这不是重点，重点是重新聚焦）；不要在周三检查后追加更多任务（检查是为了聚焦不是加量）；不要在已经完美执行计划时跳过检查（保持节奏也很重要）",
      "timePerSession": "10分钟",
      "duration": "每周三下午固定时间使用",
      "expectedEffect": "在周中设置结构性检查点，及时校准方向，避免'失控的一周'",
      "effectNote": "在周中设置结构性检查点，及时校准方向，避免'失控的一周'",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心",
        "角色边界"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "五分钟深度连接",
      "attributions": [
        "关系疏离",
        "双重依恋困境"
      ],
      "whenToUse": "和学生的关系停留在管理层面、师生关系功利化、感受不到连接的意义",
      "steps": [
        "①选一个学生（轮流覆盖，不要只关注'好学生'或'问题学生'）",
        "②做一次5分钟的非学业对话：；- 不聊成绩、作业、纪律；- 聊他喜欢的事（游戏/运动/宠物/兄弟姊妹）；- 用开放式问题：'你最近在玩什么？''周末做了什么开心的事？'",
        "③全神贯注地听（不看手机、不打断、不评判）",
        "④结束时说一句：'很高兴和你聊天。'",
        "⑤记录：今天和谁聊了什么（方便下次延续话题）",
        "⑥目标：一个月内和每个学生至少有一次这样的连接"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "low",
      "script": "对学生'你上次说的那个拼图拼完了吗？'\n对学生'我发现你最近画的东西很有意思，能给我讲讲吗？'",
      "prohibition": "不要在做连接时突然切换到管理/批评模式（'说起来你上次作业……'←破坏连接）；不要只连接'好带'的学生；不要期望一次连接就改善所有问题",
      "timePerSession": "5分钟/次",
      "duration": "每天1-2次，利用课间/午休等碎片时间",
      "expectedEffect": "通过高质量短时互动建立真实的师生连接，提升工作意义感和班级氛围",
      "effectNote": "通过高质量短时互动建立真实的师生连接，提升工作意义感和班级氛围",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "同伴支持",
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "家长同盟建设",
      "attributions": [
        "家长沟通压力",
        "关系疏离"
      ],
      "whenToUse": "家长站在对立面、总觉得家长在找茬、家校关系紧张",
      "steps": [
        "①主动出击（不等家长来找你）：开学第一周给每位家长发一条学生正面信息；例：'小明妈妈您好，开学第一周小明在XX方面表现很好，想跟您分享一下。'",
        "②使用'我们'语言：'我们一起来想办法''我们对孩子的期望是一样的'",
        "③分享一个你的观察+一个邀请：'我注意到XX，您在家里有没有类似的观察？'",
        "④在问题沟通中使用三明治法：正面→问题→正面；例：'小明上课很活跃（+）。最近我注意到他有时候会打断别人（问题）。他是个有想法的孩子，如果能学会等待发言就更好了（+）。'",
        "⑤定期传递正面消息（不是只有问题才联系家长）"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "medium",
      "script": "对家长'我们的目标是一样的：让孩子成长得更好。我每天都在想这件事，我相信您也是。'\n对家长'谢谢您的反馈。我从您那里听到了一个新的角度。'",
      "prohibition": "不要在情绪对抗时强行沟通（先冷静）；不要在家长群里公开讨论个别学生的问题（私聊）；不要为了搞好关系而报喜不报忧",
      "timePerSession": "每次沟通15-30分钟",
      "duration": "关键节点使用（开学/期末/出现问题时）",
      "expectedEffect": "从'对抗模式'切换到'同盟模式'，把家长变成教育合伙人",
      "effectNote": "从'对抗模式'切换到'同盟模式'，把家长变成教育合伙人",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "同伴支持",
        "时间边界"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "同伴支持二人组",
      "attributions": [
        "支持系统缺失"
      ],
      "whenToUse": "觉得只有自己在战斗、没有可以倾诉的同事、团队氛围冷漠",
      "steps": [
        "①在同事中找1个你信任且价值观相近的人",
        "②明确约定：这是我们两个人的支持关系，内容是保密的",
        "③定期会面（建议每2周1次，午餐或放学后）",
        "④会面结构（轮流当说话者和倾听者）：；- 最近发生了什么？（15分钟）；- 什么事在困扰你？（10分钟）；- 你用了什么方法？效果如何？（5分钟）；- 你需要什么支持？（5分钟）",
        "⑤倾听者的角色：只听不评价、不解决问题、不说'你应该'（除非对方明确向你请教）",
        "⑥关键是持续见面，而不是一次性深聊"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "low",
      "script": "对同伴'我不是要你帮我解决问题，我只是需要有个人听听。'\n对同伴'我在呢。你说的我听到了。'",
      "prohibition": "不要把同伴变成'垃圾桶'（只说负面）；不要把同伴的分享拿去和其他同事讨论（破坏信任）；不要选择你日常需要直接汇报/考核的人（选择平级）",
      "timePerSession": "每2周30-60分钟",
      "duration": "建立关系需要1-2次深度交流；之后每周/每2周1次",
      "expectedEffect": "通过建立结构化的同伴支持关系，获得持续的同行陪伴和专业回响",
      "effectNote": "通过建立结构化的同伴支持关系，获得持续的同行陪伴和专业回响",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "同伴支持",
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "冲突修复对话",
      "attributions": [
        "关系疏离",
        "家长沟通压力"
      ],
      "whenToUse": "和学生/家长/同事发生了冲突后关系破裂、不知道如何修复、回避沟通",
      "steps": [
        "①先自省：我的哪一部分对这个冲突有贡献？（不一定是'错'，但一定有你'可以做不同'的地方）",
        "②选择一个合适的时机（不匆忙、不公开）",
        "③使用修复对话四步：",
        "①表达你的意图（不是指责）：'我想和你聊聊刚才的事，因为我在乎我们的关系。'",
        "②承认你的部分：'我需要承认，我当时说XX的时候语气不太好。'",
        "③表达你的感受和需要：'当XX发生的时候，我感到有点XX，因为我很在乎XX。'",
        "④邀请对方：'我很想听听你的感受。'",
        "④倾听时不打断、不辩护",
        "⑤一起找出一个'下次可以怎么做'的约定"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "medium",
      "script": "对学生'刚才老师说话大声了一点，我需要向你道歉。我们关系比对错重要。我很想听听你的感受。'\n对家长'上次沟通可能让我们都不太舒服。我想重新开始，为了孩子我们好好聊聊。'",
      "prohibition": "不要在修复对话中说'但是'（'我承认我语气不好，但是你……'←修复失败）；不要在公开场合做修复对话；不要期望对方立即接受（修复需要时间）",
      "timePerSession": "15-30分钟",
      "duration": "冲突发生后24-48小时内使用最佳",
      "expectedEffect": "通过结构化的修复对话重建信任，把冲突转化为关系深化的契机",
      "effectNote": "通过结构化的修复对话重建信任，把冲突转化为关系深化的契机",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "同伴支持",
        "时间边界"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "团队感恩圈",
      "attributions": [
        "支持系统缺失",
        "关系疏离"
      ],
      "whenToUse": "年级组/教研组氛围负面、同事间只有抱怨没有支持、离职率高",
      "steps": [
        "①在教研组会议上留出最后10-15分钟",
        "②规则：每个人轮流说——；'这个月，我想感谢XX，因为……'（具体的一件事）",
        "③被感谢的人只需要说：'谢谢你告诉我。'",
        "④不强迫参加（但通常参加了就会感受到效果）",
        "⑤进阶：可以写感谢小纸条，匿名投到'感恩信箱'，会议时抽取朗读",
        "⑥目的是让团队中每个成员的贡献被看见、被认可"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "low",
      "script": "（在感恩圈中说）'我想感谢张老师，因为上周我孩子生病时她主动帮我代了课，而且教案准备得特别认真。那一刻我觉得我不孤单。'",
      "prohibition": "不要强迫所有人参加（'必须说一个感谢'←变味）；不要比较（'XX说的比YY好'）；不要让感恩圈变成形式主义（真心话才有力量）",
      "timePerSession": "20-30分钟",
      "duration": "每月1次；每次20-30分钟",
      "expectedEffect": "通过结构化的感恩分享活动改善团队氛围，建立积极协作文化",
      "effectNote": "通过结构化的感恩分享活动改善团队氛围，建立积极协作文化",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "同伴支持",
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "角色转换体验",
      "attributions": [
        "关系疏离",
        "双重依恋困境"
      ],
      "whenToUse": "对学生/家长的处境缺乏同理心、以自己的标准要求所有人、关系僵化",
      "steps": [
        "①选一个你目前不太理解或让你有挫败感的人（学生/家长）",
        "②拿出一张纸，以第一人称写他的一天24小时：；- 他早上几点起床？起床后做什么？谁来叫他？；- 他的家庭环境是什么样的？（安静/嘈杂/拥挤/独处）；- 他一天中最开心的时候是什么？最不开心的时候是什么？；- 他来学校/和你打交道时，他带着什么样的心情和身体状态？；- 他晚上几点睡？睡前在想什么？",
        "③写完后读一遍，问自己：'如果我是他，我会有什么感受？我会需要老师怎么对我？'",
        "④基于这个新理解，你会有什么不同的做法？"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "low",
      "script": "对自己'我不是他。他的世界和我的世界不一样。在我看来不可理喻的行为，在他的处境里可能是合理的选择。'",
      "prohibition": "不要把'理解'等同于'同意'（理解他的处境≠认同他的行为）；不要在角色转换中陷入对自己的批判（'我怎么早不这么想'）；不要因为一次转换就认为你完全理解了",
      "timePerSession": "10分钟",
      "duration": "需要时使用；每次10分钟",
      "expectedEffect": "通过系统化的换位思考练习，恢复对他人处境的好奇和理解",
      "effectNote": "通过系统化的换位思考练习，恢复对他人处境的好奇和理解",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心",
        "同伴支持"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "成功经验回溯",
      "attributions": [
        "效能感不足",
        "认知锁定"
      ],
      "whenToUse": "觉得自己最近什么都做不好、忘记了曾经的成功、效能感最低谷时",
      "steps": [
        "①闭上眼睛，回忆一个你过去觉得'做得很好'的时刻（任何场景：教学/沟通/处理危机/被认可）",
        "②用所有感官还原那个场景：；- 你当时在哪？什么时候？什么天气？；- 你做了什么？说了什么？；- 别人对你说了什么？你的身体感受是什么？；- 你当时的想法是什么？",
        "③问自己：'那个场景里的我，拥有什么品质/能力？'",
        "④写下至少3个你认可的自身品质",
        "⑤告诉自己：'这些品质没有消失。它们还在我身上，只是最近被遮蔽了。'"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "low",
      "script": "对自己'我做过那些事。我有那些能力。它们是我的一部分。'\n对自己'那个能处理XX事件的我，和现在的我，是同一个人。'",
      "prohibition": "不要拿过去的最佳状态否定现在的状态（'以前行现在不行'←这不是回溯的目的）；不要在寻找成功经验时筛选掉'小事'（小成功也是成功）；不要只在低落时才做，平时也可以积累'成功档案'",
      "timePerSession": "10-15分钟",
      "duration": "效能感低落时使用",
      "expectedEffect": "通过回溯详细的具体成功经验，激活'我能行'的自我认知",
      "effectNote": "通过回溯详细的具体成功经验，激活'我能行'的自我认知",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "困境外化练习",
      "attributions": [
        "认知锁定",
        "过度自责"
      ],
      "whenToUse": "被一个问题纠缠太久、觉得'我就是问题''我性格有问题''我改不了'",
      "steps": [
        "①把你的困扰命名为一个'它'（给它起个名字，如'那个声音''完美主义先生''焦虑怪兽'）",
        "②和'它'对话（写下来或和同伴说）：；- '它'什么时候出现？最常在什么情境出现？；- '它'对我说什么？（找出'它'的典型台词）；- '它'想让我做什么？；- 当'它'出现时，它对我和他人的关系有什么影响？",
        "③现在你站在'你'这边来回应'它'：；- '我听到你了，但我不一定要按你说的做。'；- '你以前也许保护过我，但现在已经不需要你了。'；- '我可以带着你，同时继续做我该做的事。'",
        "④写下你从外化中获得的新认识"
      ],
      "stepDetails": [],
      "form": "exercise",
      "severity": "medium",
      "script": "对自己'焦虑不是我，它是我身上的一个访客。我可以请它坐下，但不让它开车。'\n对同伴'我发现'完美主义先生'每次都在我被评价的时候出现。它在试图保护我，但方式已经过时了。'",
      "prohibition": "不要把外化变成推卸责任（'不是我的问题，是它的问题'←外化是为了厘清和应对，不是为了逃避）；不要在严重心理健康危机时使用（寻求专业帮助）；不要用外化来标签他人（'你被你的XX控制了'）",
      "timePerSession": "20-30分钟",
      "duration": "被问题纠缠时使用；可配合同伴一起来做",
      "expectedEffect": "将问题与人分离，用外化视角看待困境，降低自我认同式的绝望感",
      "effectNote": "将问题与人分离，用外化视角看待困境，降低自我认同式的绝望感",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "教育初心回溯",
      "attributions": [
        "意义感流失",
        "职业认同下降"
      ],
      "whenToUse": "感觉这个职业没有意义、不知道为什么还在做、每天只是为了工资在硬撑",
      "steps": [
        "①找一个安静的时间，拿出一本笔记本",
        "②回答以下问题（不赶时间，想多少写多少）：；- 你当初为什么选择做老师？（不要用'因为分数不够'这种表面答案，再往下挖）；- 你记忆中第一个'做对了'的教育瞬间是什么？；- 这些年来，有没有学生/家长对你说过什么，让你觉得'值了'？；- 如果你不做老师了，你最怀念的会是什么？；- 在那些'好日子'里，你是一个什么样的老师？",
        "③读完自己的所有回答",
        "④写一句话：'我做这份工作，最深的意义在于______。'",
        "⑤把这页纸放在一个你可以偶尔看看的地方"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "low",
      "script": "（写给自己的话）'我可能改变不了整个系统，但我可以改变一个孩子的一天。也许那就是意义所在。'\n（写给自己的话）'意义不是每天都能感受到的。有时它藏得很深，需要我停下来回头找。'",
      "prohibition": "不要在极度疲惫时做这个练习（先休息）；不要因为一次写不出答案就判定'果然没有意义'（意义是需要挖掘的）；不要拿别人的意义来要求自己（你的答案和别人不一样很正常）",
      "timePerSession": "30-45分钟",
      "duration": "每学期或意义感严重缺失时做1次",
      "expectedEffect": "重新连接选择这个职业的深层原因，发现被日常琐事遮蔽的意义感",
      "effectNote": "重新连接选择这个职业的深层原因，发现被日常琐事遮蔽的意义感",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "同伴支持",
        "意义感知"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "同事深度对话卡",
      "attributions": [
        "支持系统缺失",
        "关系疏离"
      ],
      "whenToUse": "和同事只聊工作事务、没有真正的连接、团队缺乏心理安全感",
      "steps": [
        "制作一套'深度对话卡片'，每张一个开放性问题（建议12-15张）：",
        "①做老师以来，最让你骄傲的一个瞬间是什么？",
        "②有没有哪个学生改变过你对教育的理解？",
        "③你最近一次觉得'做不下去了'是什么时候？后来怎么过来的？",
        "④如果给你一个超能力帮班主任，你希望是什么？",
        "⑤你希望10年后的自己是什么样？",
        "⑥你最近学到了什么新东西？（不一定是工作相关的）",
        "⑦什么小事能让你一天心情变好？",
        "⑧你觉得我们年级组/教研组最需要改进的是什么？；使用规则：；- 两个人轮流抽卡，抽到的人先回答；- 倾听者不打断、不评价、不'你这个想法不对'；- 回答可以跳过（'这张我还不想聊'），换一张；- 对话内容仅限两人之间"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "low",
      "script": "对同事'这周要不要一起吃个午饭？我带了对话卡片。'\n对话中'谢谢你分享这个。我之前不知道你经历过这些。'",
      "prohibition": "不要在会议/正式场合使用（这是关系建设工具，不是工作任务）；不要强迫不想参加的人；不要在对话中评判或给建议（除非明确被请教）",
      "timePerSession": "每次20-30分钟",
      "duration": "每2周1次，每次选1个同事+2-3张卡片",
      "expectedEffect": "通过结构化对话卡片引导有深度的同事交流，建立真实的工作友谊",
      "effectNote": "通过结构化对话卡片引导有深度的同事交流，建立真实的工作友谊",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "同伴支持"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "师生关系修复信",
      "attributions": [
        "关系疏离",
        "双重依恋困境"
      ],
      "whenToUse": "和一个或多个学生的关系已经僵化、不知道如何重新建立连接",
      "steps": [
        "①选择一个关系紧张的学生",
        "②给他写一封信（可以真的给，也可以只是写给自己辅助思考）：；- 开头：'XX同学，我想给你写这封信，因为我在乎我们之间的关系。'；- 观察（不评判）：'我注意到最近我们之间好像有些距离。'；- 你的部分（不推卸）：'我反思了一下，也许我XX时候的处理方式可以更好。'；- 邀请（不强迫）：'如果你愿意，我们可以聊聊。不想聊也没关系，我想让你知道，门是开着的。'",
        "③决定是否真的给这封信（给了效果更好，但要根据实际情况判断）",
        "④如果不给信：把信中的核心意图用非正式的方式传达（课间随口一句、作业批注中的一句鼓励）",
        "⑤给关系修复时间——不期待一次沟通就解决"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "medium",
      "script": "（信中）'我不想假装什么都没发生。我也不想强迫你原谅我。我只是想让你知道，我还在。'\n（日常传达）'今天的作业做得不错。慢慢来，不着急。'",
      "prohibition": "不要在信中进行道德说教或解释'我为什么那样做'（信的目的是修复连接，不是'讲道理'）；不要在对方还没有准备好时就面对面深度对话；不要在修复关系时附带条件（'如果你改了我就对你好'）",
      "timePerSession": "15-20分钟写作+后续行动",
      "duration": "关系僵化持续1周以上时使用",
      "expectedEffect": "通过书面的、非面对面的方式迈出修复关系的第一步",
      "effectNote": "通过书面的、非面对面的方式迈出修复关系的第一步",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "同伴支持"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "班级微系统优化",
      "attributions": [
        "任务过载",
        "时间碎片化"
      ],
      "whenToUse": "班级日常管理混乱、规则执行不一致、学生不清楚期望",
      "steps": [
        "①诊断：当前班级管理中最消耗你精力的3件事是什么？",
        "②选其中1件，设计一个微系统（把'靠人盯着'变成'靠系统运行'）：；例：作业收交混乱 → 建立'作业收交流程图'贴墙上；7:50小组长收齐→7:55课代表汇总→8:00送到讲台→未交名单贴公告栏；例：卫生值日推诿 → 建立'值日积分制'（完成得分/不完成扣分/累积兑换奖励）；例：排队吵闹 → 建立'无声排队挑战'（每天计时/挑战成功=课前5分钟自由活动）",
        "③系统和学生一起设计（让他们参与进来，增加执行意愿）",
        "④试行1周→收集反馈→调整→正式运行",
        "⑤每学期优化1-2个微系统"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "medium",
      "script": "对学生'我们来一起设计一个让大家都省事的方案。你们有什么好主意？'\n对自己'系统运行好了，我就不用每天当警察了。'",
      "prohibition": "不要一次改太多（1-2个微系统足够，多了执行不过来）；不要自己闭门造车不征求学生意见；不要执行了一周效果不好就放弃（调整，不是放弃）",
      "timePerSession": "建设期每周2-3小时/维护每月1小时",
      "duration": "开学前2周建设+学期中每月微调",
      "expectedEffect": "通过系统化微调班级管理流程，减少日常事务摩擦，释放管理精力",
      "effectNote": "通过系统化微调班级管理流程，减少日常事务摩擦，释放管理精力",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "角色边界"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "信息分流系统",
      "attributions": [
        "时间碎片化",
        "边界感丧失"
      ],
      "whenToUse": "微信/钉钉消息爆炸、重要消息被淹没、信息处理占据大量时间",
      "steps": [
        "①分类你的信息来源：；- A类（必须立即响应）：学生安全/危机事件（设置特殊铃声）；- B类（当天内回复即可）：家长个别沟通/领导工作安排；- C类（可批量处理）：群消息/通知/转发；- D类（可忽略）：广告/无关推送",
        "②建立处理规则：；- A类：立即处理；- B类：每天集中2个时段批量回复（如上午10点+下午4点）；- C类：每天集中1次浏览（下午4点）；- D类：关闭通知/退群/屏蔽",
        "③家长群设置：；- 公告置顶统一口径；- 设置关键词自动回复（如'作业''考试'等高频提问）；- 明确群规则（什么可以群里问，什么需要私聊）",
        "④工具箱：微信'置顶''免打扰''标签分组'功能用起来"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "medium",
      "script": "（群公告）'家长您好，每日16:00-17:00我会集中回复消息。急事请直接打我电话，号码是XX。'\n对自己'我不是实时客服。集中回复效率更高。'",
      "prohibition": "不要给A类设置免打扰；不要在设置系统后偷偷'看一眼'（破坏批处理习惯）；不要因为信息少了而焦虑（'是不是错过了什么'）",
      "timePerSession": "首次设置30分钟",
      "duration": "首次设置30分钟；之后每天按系统执行",
      "expectedEffect": "建立信息分流和批处理机制，减少信息焦虑和碎片化注意力损耗",
      "effectNote": "建立信息分流和批处理机制，减少信息焦虑和碎片化注意力损耗",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "角色边界"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "文件管理极简法",
      "attributions": [
        "任务过载",
        "时间碎片化"
      ],
      "whenToUse": "电脑文件乱七八糟找不到、每次找文件浪费大量时间、备份混乱",
      "steps": [
        "①文件夹结构（不超过3层）：；第一层：按学期/学年分（如'2025-2026学年'）；第二层：按工作类型分（备课/班级管理/家校沟通/行政/个人成长）；第三层：按具体项目分（如'家校沟通/家长会2025秋'）",
        "②文件命名规则（三要素）：日期_主题_版本；例：20250527_期中评语_V1.docx；例：20250527_家长会PPT_终稿.pptx",
        "③桌面文件≤5个（其余全归档到对应文件夹）",
        "④每周五下午做一次文件归位（5分钟）",
        "⑤备份规则：每月备份到云盘/硬盘1次"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "medium",
      "script": "对自己'3秒钟：命名→归档→完成。'\n对自己'花3秒现在归档，省5分钟以后找文件。'",
      "prohibition": "不要创建'杂项''临时''待整理'文件夹（它们会变成垃圾场）；不要在命名时偷懒（'新建文档(3).docx'）；不要所有文件都堆在桌面",
      "timePerSession": "首次1-2小时",
      "duration": "首次整理1-2小时；之后每次保存文件时执行3秒规则",
      "expectedEffect": "建立一套极简文件管理规则，让找文件从5分钟变成5秒",
      "effectNote": "建立一套极简文件管理规则，让找文件从5分钟变成5秒",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "角色边界"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "时间块规划",
      "attributions": [
        "时间碎片化",
        "任务过载"
      ],
      "whenToUse": "每天被各种琐事填满、没有整块时间做核心工作、时间碎片化严重",
      "steps": [
        "将一天分为几个'时间块'，每个块只做一类事：；| 时间块 | 做什么 | 不做什么 |；| 8:00-9:00 | 深度工作（备课/分析/写作） | 不查消息不接电话 |；| 9:00-12:00 | 教学+课间管理 | （这是本职工作时段）|；| 12:00-13:00 | 午休/吃饭/微型运动 | 不处理工作 |；| 13:00-14:00 | 行政事务批处理 | 不开始新的深度任务 |；| 14:00-15:30 | 教学/学生管理 | — |；| 15:30-16:00 | 消息集中回复 | 只回不聊（不开启对话）|；| 16:00-17:00 | 弹性时间（机动+明日后备）| — |；- 每个块之间留5-10分钟缓冲；- 非教学时间块的边界要坚决保护；- 根据RX-020的能量节律调整深度工作块的时段"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "medium",
      "script": "对自己'现在是深度工作块。其他事等我出来再说。'\n对同事'我上午8-9点有集中工作时间，那个时间段尽量不要找我。'",
      "prohibition": "不要把时间块排得太满（留弹性）；不要在上课/班级管理时间块拒绝处理学生的事（那是本职）；不要在被打断后放弃整个块（调整剩余部分的计划）",
      "timePerSession": "5分钟/天",
      "duration": "每天上班前5分钟规划；或前一天下班前规划",
      "expectedEffect": "以'时间块'而非'待办清单'来规划一天，保护深度工作时间",
      "effectNote": "以'时间块'而非'待办清单'来规划一天，保护深度工作时间",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "角色边界"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "价值观排序",
      "attributions": [
        "意义感流失",
        "职业认同下降"
      ],
      "whenToUse": "感觉自己在做的事和自己在乎的事不一致、有持续的内心冲突、选择困难",
      "steps": [
        "①从以下价值观中选出你认为最重要的10个：；自由 安全 成就 归属 创造 成长 公平 服务 连接 认可 独立 健康 学习 意义 快乐 尊重 责任 卓越 平衡 贡献 真实 勇气 善良 智慧 冒险 秩序 和谐",
        "②从10个中筛选出5个",
        "③从5个中筛选出3个（核心的）",
        "④对你的3个核心价值观分别写一句话：；'对我来说，XX意味着……'",
        "⑤对照你当前的日常工作和生活：；- 哪些在支持你的核心价值观？；- 哪些在冲突？；- 可以做一个小调整来减少冲突吗？",
        "⑥把3个核心价值写下来，贴在日常可见的地方"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "low",
      "script": "（写给自己）'我的核心价值是：连接（和人建立真实的联系）、成长（持续学习和变得更好）、平衡（工作和生活都不能偏废）。'\n（做选择时）'这个选择，更靠近我的哪个价值？'",
      "prohibition": "不要选'应该'选的（选你真的在乎的）；不要在一次排序后就认为永远不变（价值观会随着人生阶段变化）；不要用价值观来评判他人（你的价值≠别人的价值）",
      "timePerSession": "20-30分钟",
      "duration": "每学期1次；重大选择时即时使用",
      "expectedEffect": "通过明确核心价值观排序，为日常决策提供内在锚点和一致感",
      "effectNote": "通过明确核心价值观排序，为日常决策提供内在锚点和一致感",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "意义感知",
        "效能信心"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "我的教育宣言",
      "attributions": [
        "意义感流失",
        "职业认同下降"
      ],
      "whenToUse": "随波逐流做教育、不知道自己的教育哲学是什么、没有内在方向感",
      "steps": [
        "①拿出一张纸，回答以下问题：；- 我认为教育最重要的目的是什么？；- 在我的课堂上，什么是不能妥协的？；- 我想让我教过的学生在10年后还记得我什么？；- 如果我的教育生涯要总结为一句话，是什么？",
        "②不要写'标准答案'，写你的真实想法",
        "③将以上回答整合为一段100字以内的'我的教育宣言'",
        "④贴在教案本第一页/办公桌可见处",
        "⑤当遇到纠结的决策时，问自己：'这个决定是否符合我的教育宣言？'",
        "⑥每学期回顾一次：我的宣言变了吗？有什么想调整的？"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "low",
      "script": "（教育宣言示例）'我相信每个孩子都有自己的节奏。我的工作是创造一个安全的空间，让他们敢尝试、敢犯错、敢做自己。我无法改变所有，但我可以守护我眼前的这一个。'",
      "prohibition": "不要抄袭别人的宣言（别人的话再漂亮也没有力量）；不要写得又高又大（宣言是给自己用的，不是给人看的）；不要在写出后束之高阁（日常使用才有效）",
      "timePerSession": "30-45分钟",
      "duration": "首次撰写30-45分钟；每学期回顾修订1次",
      "expectedEffect": "凝练个人教育信念，作为日常教学决策的内在指南针",
      "effectNote": "凝练个人教育信念，作为日常教学决策的内在指南针",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "意义感知",
        "效能信心"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "贡献清单",
      "attributions": [
        "意义感流失",
        "效能感不足"
      ],
      "whenToUse": "觉得自己的付出不被看见、感觉做的一切都没有意义、想要被认可",
      "steps": [
        "①拿出一张纸，写下以下问题的答案（要求具体、有细节）：；- 这个学期/今年，有哪些学生因为你而发生了积极的变化？（哪怕是一个很小的变化）；- 有哪些家长因为你而与孩子的关系改善了？；- 有哪些同事因为你的帮助而解决了问题？；- 你在班级/年级/学校层面做了什么有意义的贡献？",
        "②写下你的'隐性贡献'（那些别人看不到但你做了的事）：；- 情绪劳动：安抚了多少次崩溃的孩子？；- 预防性工作：防了多少次'可能的危机'？；- 幕后工作：做了多少没人知道但重要的事？",
        "③读一遍你的清单，对镜子里的自己说：'这些，都是我做的。'",
        "④挑出清单里最触动你的1-2条，写成便签放在笔筒里"
      ],
      "stepDetails": [],
      "form": "framework",
      "severity": "low",
      "script": "对自己'这个孩子因为我的坚持没有辍学——这件事没有人给我发奖状，但它是真实的。'\n对自己'我不是没有贡献，我只是没有被系统性地看到。没关系，我自己看到。'",
      "prohibition": "不要拿自己的贡献和别人比（'XX老师带出了竞赛冠军'←你的贡献模式不同）；不要在感觉特别差的时候勉强做（情绪极低时做不了客观的贡献评估）；不要做完就忘（把贡献清单放在可以看到的地方）",
      "timePerSession": "15-20分钟",
      "duration": "意义感低落时或每季度1次",
      "expectedEffect": "通过客观列举自己的贡献和影响，建立基于事实的自我价值感",
      "effectNote": "通过客观列举自己的贡献和影响，建立基于事实的自我价值感",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "意义感知",
        "效能信心"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "危机响应三步流程",
      "attributions": [
        "情绪耗竭"
      ],
      "whenToUse": "学生出现自伤/暴力/严重心理危机时头脑空白、不知道该做什么",
      "steps": [
        "第一步·确保安全（0-5分钟）：",
        "□ 移除危险物品（刀具/药物/尖锐物品等）",
        "□ 确保有至少2个成年人在场",
        "□ 如果涉及人身伤害，立即拨打120",
        "□ 通知学校领导和心理老师",
        "第二步·稳定情绪（5-30分钟）：",
        "□ 保持冷静的语气（语速慢、声音低）",
        "□ 使用'我在这里''你不是一个人'等安全感语言",
        "□ 不评判（不说'你怎么能这样'）",
        "□ 不承诺保密（涉及安全时必须上报）",
        "□ 陪伴在安全距离内（不强行身体接触）",
        "第三步·转介与记录（30分钟-2小时）：",
        "□ 联系家长（方式根据情况，先与领导确认）",
        "□ 转介学校心理老师或外部专业机构",
        "□ 撰写事件记录（只写客观事实，不加主观猜测）",
        "□ 后续跟进计划（谁在什么时间做什么）",
        "□ 同时关注自己的情绪反应（危机后你自己也需要照顾）"
      ],
      "stepDetails": [],
      "form": "checklist",
      "severity": "low",
      "script": "对学生'我在这里。你不是一个人。'\n'无论发生了什么，我们先确保安全。'\n对领导/家长'目前学生安全已确保，接下来我们需要做XX。'",
      "prohibition": "不要一个人处理（必须有第二个成年人）；不要承诺保密；不要在危机中讲道理/说教；不要处理完就觉得自己没事（替代性创伤是真实存在的）",
      "timePerSession": "根据危机严重程度",
      "duration": "危机发生时立即使用",
      "expectedEffect": "掌握标准化的危机响应流程，在紧急情况下有章可循、不慌乱",
      "effectNote": "掌握标准化的危机响应流程，在紧急情况下有章可循、不慌乱",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心",
        "情绪状态"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "家长会标准化流程",
      "attributions": [
        "家长沟通压力",
        "任务过载"
      ],
      "whenToUse": "每次家长会都重新准备、要么准备过度要么准备不足、会后效果不佳",
      "steps": [
        "会前准备清单：",
        "□ 确定本次家长会的核心目标（不超过3个）",
        "□ 收集每个学生的3个亮点+1个成长建议（提前1周准备）",
        "□ 准备班级整体情况简报（1页纸，图表为主）",
        "□ 准备家长提问常见问题Q&A",
        "□ 教室布置：座位围成圆圈/小组（不排排坐）、学生作品展示",
        "□ 提前3天发通知（含议程+需要家长提前准备的内容）",
        "□ 准备签到和简易茶歇；会中流程：",
        "①开场：用1个温暖的故事或数据开始（3分钟）",
        "②班级整体情况（5分钟）",
        "③主题分享（15-20分钟，不超时）",
        "④小组讨论/互动环节（15分钟）",
        "⑤个别交流时间（自由形式）",
        "⑥结束语：感谢+下一步行动邀请（2分钟）；会后跟进：",
        "□ 会后24小时内发送简短感谢信息",
        "□ 记录家长个别诉求并逐一回复",
        "□ 下周一班会分享家长会的收获（给学生）"
      ],
      "stepDetails": [],
      "form": "checklist",
      "severity": "medium",
      "script": "（开场）'谢谢各位家长在百忙中来到这里。今晚我们不是来检阅的，我们是来合作的。'\n（结束）'今天我们讨论了XX。接下来我会做XX，也邀请各位家长尝试XX。我们一起。'",
      "prohibition": "不要超时（承诺几点结束就几点结束）；不要在全班场合讨论个别学生的问题（私聊）；不要在家长会上告状（让家长带着'任务'离开，不是带着'罪状'离开）",
      "timePerSession": "准备期2-3天碎片时间",
      "duration": "每学期初制定模板后按模板执行",
      "expectedEffect": "建立家长会标准操作流程，大幅减少准备焦虑，提升会议效果",
      "effectNote": "建立家长会标准操作流程，大幅减少准备焦虑，提升会议效果",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心",
        "角色边界"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "每日自我照顾检查清单",
      "attributions": [
        "自我关怀不足",
        "精力耗尽与躯体疲劳"
      ],
      "whenToUse": "忙于照顾所有人却忘了照顾自己、一天下来发现自己没吃没喝没上厕所",
      "steps": [
        "☐ 今天喝水了吗？（目标：1.5L/天，约8杯）",
        "☐ 今天按时吃饭了吗？（至少早+午+适当加餐）",
        "☐ 今天上厕所了吗？（忙起来会忘，别憋）",
        "☐ 今天站起来活动了吗？（久坐不超过1小时）",
        "☐ 今天做了一次深呼吸吗？（至少1次有意识的深呼吸）",
        "☐ 今天对自己说过一句好话吗？（至少1句）",
        "☐ 今天笑了吗？（找一件好笑的事）",
        "☐ 今天和至少1个人有过非工作交流吗？；这些看起来基础到可笑，但当工作量达到一定强度时，最先被牺牲的就是它们。；打印一份贴在办公桌上，每天下午4点打勾。"
      ],
      "stepDetails": [],
      "form": "checklist",
      "severity": "low",
      "script": "对自己'我先保证自己活着，再谈教育别人。'\n对自己'喝水和回微信不冲突。我可以一边喝水一边回。'",
      "prohibition": "不要觉得'这些太基本了不需要检查'（正是因为基本才容易被忽略）；不要只在状态差时才用（预防是最好的照顾）；不要因为某天没完成就放弃",
      "timePerSession": "每次1分钟",
      "duration": "每天上午+下午各检查1次",
      "expectedEffect": "通过简单的每日检查清单确保基本自我照顾不被忽略",
      "effectNote": "通过简单的每日检查清单确保基本自我照顾不被忽略",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心",
        "精力耗尽"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    },
    {
      "name": "每周复盘六问",
      "attributions": [
        "意义感流失",
        "效能感不足"
      ],
      "whenToUse": "一周结束不知道这周做了什么、重复犯同样的错误、没有学习没有成长",
      "steps": [
        "①这周我完成了什么？（列3-5件事，不管大小）",
        "②这周什么做得特别好？（至少1件，分析为什么做得好）",
        "③这周什么可以做得不一样？（不是'错了'，是'可以更好'）",
        "④这周我学到了什么？（1个新的认识/技能/洞察）",
        "⑤这周有什么事消耗了我？下周可以减少或改变吗？",
        "⑥下周我最想聚焦的一件事是什么？；写完六问后，给自己的一句总结：'这周告诉我……'；格式不重要，持续才重要。坚持10周，你会看到明显的成长轨迹。"
      ],
      "stepDetails": [],
      "form": "checklist",
      "severity": "low",
      "script": "（总结本周）'这周告诉我：当我把最重要的事放在早晨做时，效率明显更高。下周保持。'\n（总结本周）'这周告诉我：不是所有家长的诉求都需要立即回应。有些需要先和领导沟通再回复。'",
      "prohibition": "不要让复盘变成自我批评大会（关注学习≠关注错误）；不要只在'不好的一周'才做复盘（好的一周也值得分析为什么好）；不要每次写长篇（六问简短即可）",
      "timePerSession": "15-20分钟",
      "duration": "每周五下午或周日晚",
      "expectedEffect": "通过结构化每周复盘，将经验转化为学习，避免'忙了一周等于白忙'",
      "effectNote": "通过结构化每周复盘，将经验转化为学习，避免'忙了一周等于白忙'",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心"
      ],
      "evidenceSource": "个人成长三库文档（2026-07-27 版）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": "",
      "contraindications": []
    }
  ],
  "keywords": [
    {
      "core": [
        "撑不住",
        "快崩溃",
        "干不下去"
      ],
      "expanded": [
        "太累了",
        "不想干了",
        "想辞职"
      ],
      "exclude": [],
      "category": "职业倦怠",
      "scale": "教师自我成长五问自评",
      "tool": "478呼吸法",
      "risk": "orange",
      "description": "教师表达强烈疲惫或职业倦怠"
    },
    {
      "core": [
        "睡不好",
        "失眠",
        "睡不着"
      ],
      "expanded": [
        "入睡困难",
        "早醒",
        "睡眠质量差"
      ],
      "exclude": [],
      "category": "睡眠问题",
      "scale": "教师六维深度评估",
      "tool": "睡前数字日落",
      "risk": "yellow",
      "description": "教师表达睡眠困扰"
    },
    {
      "core": [
        "焦虑",
        "紧张",
        "心慌"
      ],
      "expanded": [
        "害怕",
        "慌",
        "心跳加速",
        "担忧"
      ],
      "exclude": [],
      "category": "焦虑紧张",
      "scale": "教师自我成长五问自评",
      "tool": "478呼吸法",
      "risk": "yellow",
      "description": "教师表达急性焦虑或紧张"
    },
    {
      "core": [
        "没意思",
        "没意义",
        "白干了"
      ],
      "expanded": [
        "不值得",
        "例行公事",
        "找不到意义"
      ],
      "exclude": [],
      "category": "意义流失",
      "scale": "教师六维深度评估",
      "tool": "教育初心回溯",
      "risk": "orange",
      "description": "教师表达工作意义感流失"
    },
    {
      "core": [
        "什么都是我的责任",
        "推给我"
      ],
      "expanded": [
        "责任全在我",
        "没人帮我分担"
      ],
      "exclude": [],
      "category": "角色边界",
      "scale": "教师自我成长五问自评",
      "tool": "责任边界思维",
      "risk": "yellow",
      "description": "教师表达责任边界模糊或过度负责"
    },
    {
      "core": [
        "家长群",
        "被投诉",
        "家长沟通"
      ],
      "expanded": [
        "家长总找我",
        "下班还发消息",
        "家长难搞"
      ],
      "exclude": [],
      "category": "家长沟通压力",
      "scale": "教师六维深度评估",
      "tool": "家长预期管理话术",
      "risk": "yellow",
      "description": "教师表达家长沟通压力"
    },
    {
      "core": [
        "我不配",
        "运气好而已",
        "冒名顶替"
      ],
      "expanded": [
        "我不够格",
        "被高估"
      ],
      "exclude": [],
      "category": "冒名顶替",
      "scale": "教师自我成长五问自评",
      "tool": "自我关怀休息",
      "risk": "yellow",
      "description": "教师表达冒名顶替感受"
    },
    {
      "core": [
        "完美主义",
        "还不够好",
        "再改改"
      ],
      "expanded": [
        "怕做不好",
        "不敢开始",
        "反复检查"
      ],
      "exclude": [],
      "category": "完美主义",
      "scale": "教师自我成长五问自评",
      "tool": "完美主义去魅",
      "risk": "yellow",
      "description": "教师表达完美主义倾向"
    },
    {
      "core": [
        "被AI取代",
        "AI焦虑"
      ],
      "expanded": [
        "人工智能",
        "跟不上技术"
      ],
      "exclude": [],
      "category": "AI焦虑",
      "scale": "教师自我成长五问自评",
      "tool": "",
      "risk": "yellow",
      "description": "教师表达 AI 带来的职业焦虑"
    },
    {
      "core": [
        "没人帮",
        "孤立",
        "一个人扛"
      ],
      "expanded": [
        "没人商量",
        "只能自己扛",
        "找不到人说"
      ],
      "exclude": [],
      "category": "支持缺失",
      "scale": "教师自我成长五问自评",
      "tool": "同伴支持二人组",
      "risk": "yellow",
      "description": "教师表达缺少支持来源"
    },
    {
      "core": [
        "都是我的错",
        "我不好",
        "自责"
      ],
      "expanded": [
        "我教得不好",
        "我太差劲"
      ],
      "exclude": [],
      "category": "过度自责",
      "scale": "教师自我成长五问自评",
      "tool": "归因重构三步法",
      "risk": "yellow",
      "description": "教师表达过度自责"
    },
    {
      "core": [
        "职业倦怠",
        "倦怠"
      ],
      "expanded": [
        "burnout",
        "被掏空",
        "情绪耗尽"
      ],
      "exclude": [],
      "category": "职业倦怠",
      "scale": "教师自我成长五问自评",
      "tool": "倦怠信号自查表",
      "risk": "orange",
      "description": "教师表达职业倦怠信号"
    },
    {
      "core": [
        "失控",
        "要爆发",
        "崩溃"
      ],
      "expanded": [
        "发火",
        "情绪上来",
        "冲动"
      ],
      "exclude": [],
      "category": "情绪失控",
      "scale": "教师自我成长五问自评",
      "tool": "STOP技术",
      "risk": "orange",
      "description": "教师表达情绪濒临失控"
    }
  ],
  "defaultLevelName": "状态良好",
  "defaultMessage": "本次评估未发现需要重点干预的信号，当前状态整体稳定，保持现有节奏即可。"
}
