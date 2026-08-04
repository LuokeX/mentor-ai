import type { WizardInput } from '../../shared/business-wizard'

// self_growth 模块向导输入（v4.0.0 打样数据，业务填写向导 → 编译生成 test-data 与库内三库）
export const SELF_GROWTH_WIZARD_INPUT: WizardInput = {
  "module": "self_growth",
  "version": "4.0.0",
  "sourceRef": "自我成长赋能手册v1",
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
      "scale": "班主任状态五问",
      "expression": "总分"
    }
  ],
  "optionGroups": [
    {
      "id": "cg-1",
      "name": "状态程度五点",
      "options": [
        {
          "label": "完全没有",
          "score": 1
        },
        {
          "label": "偶尔有",
          "score": 2
        },
        {
          "label": "有时有",
          "score": 3
        },
        {
          "label": "经常有",
          "score": 4
        },
        {
          "label": "几乎总是",
          "score": 5
        }
      ]
    }
  ],
  "scales": [
    {
      "name": "班主任状态五问",
      "role": "入口筛查",
      "shortName": "状态五问",
      "description": "回顾最近一周的真实状态，3 分钟完成，系统按六色给出提示。",
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
          "description": "情绪状态维度",
          "highInterpretation": "情绪耗竭风险高，可能伴随躯体症状",
          "lowInterpretation": "情绪状态良好，具备较好的自我调节能力"
        },
        {
          "name": "角色边界",
          "calcMethod": "mean",
          "weight": 1,
          "description": "角色边界维度",
          "highInterpretation": "责任边界模糊，倾向于独自承接全部问题",
          "lowInterpretation": "职责边界清晰"
        },
        {
          "name": "意义感知",
          "calcMethod": "mean",
          "weight": 1,
          "description": "意义感知维度",
          "highInterpretation": "意义感流失，需重点关注",
          "lowInterpretation": "意义感充足"
        },
        {
          "name": "效能信心",
          "calcMethod": "mean",
          "weight": 1,
          "description": "效能信心维度",
          "highInterpretation": "对处理复杂问题缺乏信心",
          "lowInterpretation": "效能感稳定"
        },
        {
          "name": "同伴支持",
          "calcMethod": "mean",
          "weight": 1,
          "description": "同伴支持维度",
          "highInterpretation": "困难长期无人分担",
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
          "text": "这一周，我有多少次感到「什么都是我的责任」？",
          "dimension": "角色边界",
          "optionGroup": "FREQ_5",
          "reverse": false
        },
        {
          "text": "这一周，有多少次我觉得「当班主任是值得的」？",
          "dimension": "意义感知",
          "optionGroup": "cg-1",
          "reverse": true
        },
        {
          "text": "遇到让我头疼的学生或家长问题时，我对自己能处理好多有信心？",
          "dimension": "效能信心",
          "optionGroup": "FREQ_5",
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
      "name": "教师心理资本与状态深度评估",
      "role": "深度诊断",
      "shortName": "HERO深评",
      "description": "状态五问总分达到需支持档位（17 分及以上）时建议做深度评估",
      "minutes": 8,
      "frequency": "per_case",
      "prerequisites": [
        "班主任状态五问"
      ],
      "exclusives": [],
      "triggerConditions": [
        {
          "targetType": "total",
          "target": "",
          "comparator": "达到或超过",
          "value": 17,
          "join": "且"
        }
      ],
      "triggerNote": "状态五问总分达到需支持档位（17 分及以上）时建议做深度评估",
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "希望",
          "calcMethod": "mean",
          "weight": 1,
          "description": "希望维度",
          "highInterpretation": "对目标路径有清晰规划",
          "lowInterpretation": "看不到可行路径"
        },
        {
          "name": "效能信心",
          "calcMethod": "mean",
          "weight": 1,
          "description": "效能信心维度",
          "highInterpretation": "相信自己能应对挑战",
          "lowInterpretation": "对自身能力持续怀疑"
        },
        {
          "name": "韧性",
          "calcMethod": "mean",
          "weight": 1,
          "description": "韧性维度",
          "highInterpretation": "受挫后能较快恢复",
          "lowInterpretation": "受挫后长时间难以恢复"
        },
        {
          "name": "乐观",
          "calcMethod": "mean",
          "weight": 1,
          "description": "乐观维度",
          "highInterpretation": "对未来持积极预期",
          "lowInterpretation": "倾向于预期负面结果"
        }
      ],
      "questions": [
        {
          "text": "面对当前的班级难题，我能想出不止一条可行的解决路径。",
          "dimension": "希望",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "我对这个学期想达成的目标有清晰的推进计划。",
          "dimension": "希望",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "即使遇到从未处理过的家校冲突，我也相信自己能处理好。",
          "dimension": "效能信心",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "我有信心影响班上最难带的那几个学生。",
          "dimension": "效能信心",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "被家长质疑或投诉后，我能较快恢复工作状态。",
          "dimension": "韧性",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "工作中的挫折不会长时间影响我的生活。",
          "dimension": "韧性",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "我倾向于相信班级的情况会慢慢变好。",
          "dimension": "乐观",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "遇到问题时，我更多想到的是机会而不是麻烦。",
          "dimension": "乐观",
          "optionGroup": "AGREE_5",
          "reverse": true
        }
      ]
    },
    {
      "name": "教师危机风险自查",
      "role": "红线检查",
      "description": "状态五问总分达到需支持档位后，逐项自查高危信号，勾选频率越高越需要立即干预。",
      "minutes": 3,
      "prerequisites": [
        "班主任状态五问"
      ],
      "triggerConditions": [
        {
          "targetType": "total",
          "target": "",
          "comparator": "达到或超过",
          "value": 17,
          "join": "且"
        }
      ],
      "triggerNote": "状态五问总分达到 17 分及以上时，建议做一次危机风险自查",
      "questions": [
        {
          "text": "最近一周，入睡困难或早醒的情况有多频繁？",
          "dimension": "高危信号",
          "optionGroup": "FREQ_5",
          "reverse": false
        },
        {
          "text": "最近一周，上班前感到难以承受、不想面对工作的频率？",
          "dimension": "高危信号",
          "optionGroup": "FREQ_5",
          "reverse": false
        },
        {
          "text": "最近一周，出现情绪失控或想对身边人发火的次数？",
          "dimension": "高危信号",
          "optionGroup": "FREQ_5",
          "reverse": false
        },
        {
          "text": "最近一周，注意力无法集中、做事丢三落四的频率？",
          "dimension": "高危信号",
          "optionGroup": "FREQ_5",
          "reverse": false
        },
        {
          "text": "最近一周，对工作完全提不起兴趣的频率？",
          "dimension": "高危信号",
          "optionGroup": "FREQ_5",
          "reverse": false
        },
        {
          "text": "最近一周，是否出现过伤害自己的念头？",
          "dimension": "高危信号",
          "optionGroup": "FREQ_5",
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
        "pressure"
      ]
    },
    {
      "name": "角色边界失守",
      "description": "教师把超出职责范围的责任持续揽在自己身上，导致负荷不可控。",
      "highSign": "认为「什么都是我的责任」、难以拒绝额外要求、下班后仍在处理班务",
      "typicalTrigger": "学校分工不清或教师自我期待过高",
      "action": "做一次职责边界盘点，把当前压力拆成可控制、可影响、暂时不可控三类，只推进可控的一项",
      "weight": 1.1,
      "tags": [
        "self_growth",
        "boundary"
      ]
    },
    {
      "name": "意义感流失",
      "description": "教师对班主任工作的价值感知下降，是需要重点关注的信号。",
      "highSign": "反复怀疑工作的价值、对学生的进步不再有反应",
      "typicalTrigger": "长期付出未获反馈，或经历重大挫败事件",
      "action": "记录一件本周确实因为你而变好的小事，并找一位同伴讲给他听",
      "weight": 1.4,
      "tags": [
        "self_growth",
        "meaning"
      ]
    },
    {
      "name": "效能感不足",
      "description": "教师对自己处理复杂问题的能力缺乏信心，容易回避而非应对。",
      "highSign": "遇到难题先想到「我搞不定」、倾向于上交问题",
      "typicalTrigger": "缺少可复用的方法储备或成功经验",
      "action": "选一个最小的难题，用一个具体工具完整走一遍并记录结果",
      "weight": 1,
      "tags": [
        "self_growth",
        "efficacy"
      ]
    },
    {
      "name": "支持系统缺失",
      "description": "教师遇到困难时缺少可求助的同伴或制度通道，独自消化问题。",
      "highSign": "独自消化问题、不主动求助、认为求助等于无能",
      "typicalTrigger": "教研组协作弱或校内缺少同伴支持机制",
      "action": "本周找一位同事做一次 20 分钟的结构化复盘，只说事实、感受和需要的支持",
      "weight": 1.1,
      "tags": [
        "self_growth",
        "support"
      ]
    }
  ],
  "evidences": [
    {
      "attribution": "情绪耗竭",
      "scale": "班主任状态五问",
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
      "description": "疲惫题项处于高位，情绪资源已被大量消耗"
    },
    {
      "attribution": "情绪耗竭",
      "scale": "班主任状态五问",
      "conditions": [
        {
          "targetType": "question",
          "target": "1",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "疲惫题项高于常模均值，处于早期消耗阶段"
    },
    {
      "attribution": "角色边界失守",
      "scale": "班主任状态五问",
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
      "description": "频繁出现「什么都是我的责任」的感受"
    },
    {
      "attribution": "角色边界失守",
      "scale": "班主任状态五问",
      "conditions": [
        {
          "targetType": "question",
          "target": "2",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "责任边界开始模糊"
    },
    {
      "attribution": "意义感流失",
      "scale": "班主任状态五问",
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
      "attribution": "意义感流失",
      "scale": "班主任状态五问",
      "conditions": [
        {
          "targetType": "question",
          "target": "3",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "意义感出现波动"
    },
    {
      "attribution": "效能感不足",
      "scale": "班主任状态五问",
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
      "description": "面对复杂问题时效能信心不足"
    },
    {
      "attribution": "效能感不足",
      "scale": "班主任状态五问",
      "conditions": [
        {
          "targetType": "question",
          "target": "4",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "效能信心有所下降"
    },
    {
      "attribution": "支持系统缺失",
      "scale": "班主任状态五问",
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
      "attribution": "支持系统缺失",
      "scale": "班主任状态五问",
      "conditions": [
        {
          "targetType": "question",
          "target": "5",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "支持来源不够稳定"
    },
    {
      "attribution": "情绪耗竭",
      "scale": "班主任状态五问",
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
      "weight": 2,
      "description": "疲惫与意义感同时告急，是情绪耗竭的核心信号"
    },
    {
      "attribution": "效能感不足",
      "scale": "教师心理资本与状态深度评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "效能信心",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "HERO 效能维度偏低"
    },
    {
      "attribution": "情绪耗竭",
      "scale": "教师心理资本与状态深度评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "韧性",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "HERO 韧性维度偏低，受挫后恢复困难"
    },
    {
      "attribution": "意义感流失",
      "scale": "教师心理资本与状态深度评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "希望",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "HERO 希望维度偏低，看不到可行路径"
    },
    {
      "attribution": "意义感流失",
      "scale": "教师心理资本与状态深度评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "乐观",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "HERO 乐观维度偏低"
    }
  ],
  "levels": [
    {
      "name": "需转介",
      "scale": "班主任状态五问",
      "conditions": [
        {
          "targetType": "question",
          "target": "1",
          "comparator": "达到或超过",
          "value": 5,
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
      "redLineAction": "立即阻断常规建议输出，展示求助指引，生成转介工单通知心理专员",
      "teacherMessage": "评估显示，您在「${主要归因}」上的信号已经处于需要重点关注的位置。系统已暂停常规建议并生成转介工单，心理专员会与您联系。在此之前，请优先照顾好自己的基本作息。",
      "resultNote": "疲惫与意义感同时处于高位，已暂停常规建议并生成转介工单。",
      "escalationTarget": "心理专员",
      "notificationTemplate": "[教师姓名]老师在自我成长评估中触发红线：疲惫与意义感同时告急。请尽快登录系统查看工单。"
    },
    {
      "name": "需关注",
      "scale": "教师心理资本与状态深度评估",
      "conditions": [
        {
          "targetType": "average",
          "target": "",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "redLine": false,
      "teacherMessage": "本次评估的主要归因是「${主要归因}」，同时「${次要归因}」也需要一并关注。建议本周内安排一次支持性沟通，并从推荐工具中选一项今天就能开始的动作。",
      "resultNote": "心理资本多个维度处于低位，建议本周内安排一次支持性沟通。",
      "escalationCondition": "连续两次深评仍为红色",
      "escalationTarget": "年级组长",
      "reAssessTrigger": "14天后复评"
    },
    {
      "name": "关注",
      "scale": "教师心理资本与状态深度评估",
      "conditions": [
        {
          "targetType": "average",
          "target": "",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "redLine": false,
      "teacherMessage": "本次评估提示「${主要归因}」值得关注，尚未到需要外部介入的程度，建议先用推荐工具自主调整。",
      "resultNote": "心理资本出现波动，建议做针对性调整。",
      "escalationCondition": "连续两次深评均分未下降",
      "escalationTarget": "年级组长",
      "reAssessTrigger": "30天后复评"
    }
  ],
  "tools": [
    {
      "name": "三分钟补能法",
      "attributions": [
        "情绪耗竭"
      ],
      "whenToUse": "感到情绪即将失控、疲惫难以恢复时",
      "steps": [
        "离开当前情境，找一个不被打扰的空间",
        "做三轮缓慢呼吸，吸气 4 秒、呼气 6 秒",
        "给当下的情绪命名，不评价",
        "选一个 5 分钟内能完成的最小行动"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "现在先停三分钟，这三分钟只属于你自己。",
          "successCriteria": "完成本步骤描述的动作"
        },
        {
          "successCriteria": "完成本步骤描述的动作"
        },
        {
          "successCriteria": "完成本步骤描述的动作"
        },
        {
          "successCriteria": "完成本步骤描述的动作"
        }
      ],
      "form": "exercise",
      "severity": "medium",
      "script": "现在先停三分钟，这三分钟只属于你自己。",
      "prohibition": "不用于替代危机处置；出现自伤念头或持续失眠时须转介心理专员",
      "timePerSession": "3 分钟",
      "duration": "每日 1-2 次，连续 7 天",
      "expectedEffect": "单次可下降 1-2 分主观压力值",
      "effectNote": "快速降低主观压力，恢复对当下的控制感",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "情绪状态"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "Kabat-Zinn 正念减压研究；教师群体适应性改编（2023）",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "主观压力值下降 >= 1 分",
      "failureCriteria": "连续使用 3 次后主观压力值未下降",
      "contraindications": []
    },
    {
      "name": "压力三分法盘点表",
      "attributions": [
        "角色边界失守"
      ],
      "whenToUse": "感到「什么都是我的责任」、任务无法排序时",
      "steps": [
        "列出当前所有让你焦虑的事项，不做筛选",
        "逐项标记为「我能控制」「我能影响」「暂时不可控」",
        "暂时不可控的一栏整体划掉，本周不再想它",
        "从「我能控制」里只挑一项，写清今天的第一步"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "这件事我会在核实后回复，目前先按约定步骤处理。",
          "successCriteria": "完成本步骤描述的动作"
        },
        {
          "successCriteria": "完成本步骤描述的动作"
        },
        {
          "successCriteria": "完成本步骤描述的动作"
        },
        {
          "successCriteria": "完成本步骤描述的动作"
        }
      ],
      "form": "worksheet",
      "severity": "medium",
      "evidenceLevel": "C",
      "script": "这件事我会在核实后回复，目前先按约定步骤处理。",
      "prohibition": "不要在盘点时同步处理事项，先列完再动手",
      "timePerSession": "20 分钟",
      "duration": "每周一次",
      "expectedEffect": "待处理事项减少三分之一以上",
      "effectNote": "把弥散的压力转成可操作的清单",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "角色边界"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "教师职业压力管理实务手册",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "「暂时不可控」栏目占比 >= 30%",
      "failureCriteria": "连续两周无法把任何事项归入「我能控制」",
      "contraindications": []
    },
    {
      "name": "同伴结构化复盘",
      "attributions": [
        "支持系统缺失"
      ],
      "whenToUse": "长期独自承接问题、缺少可求助对象时",
      "steps": [
        "约一位信任的同事，明确只谈 20 分钟",
        "按「事实—感受—我需要的支持」三段说，不要求对方给答案",
        "请对方复述一遍你说的事实，确认没有偏差",
        "约定下一次复盘时间"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "我最近在这个问题上消耗比较大，想请你帮我一起看一下事实和下一步，不需要马上给答案。",
          "successCriteria": "完成本步骤描述的动作"
        },
        {
          "successCriteria": "完成本步骤描述的动作"
        },
        {
          "successCriteria": "完成本步骤描述的动作"
        },
        {
          "successCriteria": "完成本步骤描述的动作"
        }
      ],
      "form": "framework",
      "severity": "high",
      "script": "我最近在这个问题上消耗比较大，想请你帮我一起看一下事实和下一步，不需要马上给答案。",
      "prohibition": "不要在复盘中评价第三方同事或学生",
      "timePerSession": "20 分钟",
      "duration": "每两周一次",
      "expectedEffect": "形成至少一个可定期复盘的同伴关系",
      "effectNote": "建立稳定的同伴支持通道",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "同伴支持"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "教师同伴支持机制研究",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "连续两次完成复盘约定",
      "failureCriteria": "两次邀约均未成行",
      "contraindications": []
    },
    {
      "name": "意义锚点记录",
      "attributions": [
        "意义感流失"
      ],
      "whenToUse": "反复怀疑工作价值、对学生进步不再有反应时",
      "steps": [
        "每天下班前写一句：今天有一件事因为我而不一样",
        "不追求重大事件，一句问候、一次等待都算",
        "连续记录七天后回看，圈出最触动你的三条",
        "把其中一条讲给一位同事听"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "我今天注意到他主动帮同学捡了书，这在两周前是没有的。",
          "successCriteria": "完成本步骤描述的动作"
        },
        {
          "successCriteria": "完成本步骤描述的动作"
        },
        {
          "successCriteria": "完成本步骤描述的动作"
        },
        {
          "successCriteria": "完成本步骤描述的动作"
        }
      ],
      "form": "exercise",
      "severity": "high",
      "script": "我今天注意到他主动帮同学捡了书，这在两周前是没有的。",
      "prohibition": "不要把这个练习变成工作总结",
      "timePerSession": "3 分钟",
      "duration": "每日一次，连续 7 天",
      "expectedEffect": "意义感知题项得分改善 1 分以上",
      "effectNote": "重建工作意义的可见证据",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "意义感知"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "积极心理学教师干预研究",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "七天内完成 >= 5 次记录",
      "failureCriteria": "连续三天无法写出任何一条",
      "contraindications": []
    },
    {
      "name": "最小成功案例复演",
      "attributions": [
        "效能感不足"
      ],
      "whenToUse": "遇到难题先想到「我搞不定」时",
      "steps": [
        "回忆一件你处理得还不错的类似事件",
        "写出当时你具体做了哪三步",
        "把这三步套用到当前难题上，标出需要调整的部分",
        "只执行第一步，执行后记录效果"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "上次遇到类似情况我是先做了这一步，这次也从这里开始。",
          "successCriteria": "完成本步骤描述的动作"
        },
        {
          "successCriteria": "完成本步骤描述的动作"
        },
        {
          "successCriteria": "完成本步骤描述的动作"
        },
        {
          "successCriteria": "完成本步骤描述的动作"
        }
      ],
      "form": "framework",
      "severity": "low",
      "evidenceLevel": "C",
      "script": "上次遇到类似情况我是先做了这一步，这次也从这里开始。",
      "prohibition": "不要拿他人的成功案例替代自己的",
      "timePerSession": "15 分钟",
      "duration": "按需",
      "expectedEffect": "形成一条可复用的处理路径",
      "effectNote": "把已有经验转成可复用的方法",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "效能信心"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "焦点解决短期干预教师应用",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "写出至少三步可执行动作",
      "failureCriteria": "回忆不起任何成功案例（此时改用 SG_RX_003）",
      "contraindications": []
    },
    {
      "name": "危机求助指引卡",
      "attributions": [
        "意义感流失"
      ],
      "whenToUse": "出现持续失眠、自伤念头或强烈无意义感时",
      "steps": [
        "停止当前所有非必要工作",
        "联系校内心理专员，说明当前状态",
        "如存在即时危险，拨打 110 或 120",
        "告知一位可信任的家人或朋友当前情况"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "我现在的状态需要一些专业支持，想请你帮我联系一下心理专员。",
          "successCriteria": "完成本步骤描述的动作"
        },
        {
          "successCriteria": "完成本步骤描述的动作"
        },
        {
          "successCriteria": "完成本步骤描述的动作"
        },
        {
          "successCriteria": "完成本步骤描述的动作"
        }
      ],
      "form": "checklist",
      "severity": "crisis",
      "evidenceLevel": "A",
      "script": "我现在的状态需要一些专业支持，想请你帮我联系一下心理专员。",
      "prohibition": "不得由班主任自行承担危机处置；不得延迟转介",
      "timePerSession": "10 分钟",
      "duration": "按需",
      "expectedEffect": "在 24 小时内建立专业支持连接",
      "effectNote": "确保教师知道向谁求助、怎么求助",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "意义感知"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "校园心理危机干预规范",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "完成一次专业联系",
      "failureCriteria": "24 小时内未建立任何联系",
      "contraindications": [
        {
          "condition": "当事人已在专业干预中",
          "type": "warn",
          "description": "已有专业支持时避免重复动员造成压力",
          "alternative": "与专员确认现有干预方案"
        }
      ]
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
      "exclude": [
        "累死了（玩笑）"
      ],
      "category": "职业倦怠",
      "scale": "班主任状态五问",
      "tool": "三分钟补能法",
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "教师表达强烈疲惫或职业倦怠"
    },
    {
      "core": [
        "什么都是我的事",
        "推给我"
      ],
      "expanded": [
        "责任全在我",
        "没人帮我分担"
      ],
      "exclude": [],
      "category": "边界失守",
      "scale": "班主任状态五问",
      "tool": "压力三分法盘点表",
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "教师表达责任边界模糊"
    },
    {
      "core": [
        "没意思",
        "不值得",
        "白干了"
      ],
      "expanded": [
        "当班主任有什么用",
        "figured"
      ],
      "exclude": [],
      "category": "意义流失",
      "scale": "班主任状态五问",
      "tool": "意义锚点记录",
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "教师表达工作意义感流失"
    },
    {
      "core": [
        "没人商量",
        "只能自己扛"
      ],
      "expanded": [
        "找不到人说",
        "孤立无援"
      ],
      "exclude": [],
      "category": "支持缺失",
      "scale": "班主任状态五问",
      "tool": "同伴结构化复盘",
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "教师表达缺少支持来源"
    }
  ],
  "defaultLevelName": "状态良好",
  "defaultMessage": "本次评估未发现需要重点干预的信号，当前状态整体稳定，保持现有节奏即可。"
}
