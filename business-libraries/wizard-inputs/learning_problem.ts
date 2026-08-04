import type { WizardInput } from '../../shared/business-wizard'

// learning_problem 模块向导输入（v4.0.0 打样数据，业务填写向导 → 编译生成 test-data 与库内三库）
export const LEARNING_PROBLEM_WIZARD_INPUT: WizardInput = {
  "module": "learning_problem",
  "version": "4.0.0",
  "sourceRef": "学生学习问题手册v1",
  "defaults": {
    "schoolSection": "all",
    "targetAudience": "teacher",
    "formType": "self_report",
    "triggerMethod": "manual",
    "frequency": "per_case",
    "resultVisibility": "teacher_only",
    "responsibleRole": "班主任",
    "dataSensitivity": "sensitive",
    "sourceType": "proprietary",
    "evidenceLevel": "A",
    "redLineScope": "module",
    "redLineActions": "停止常规建议输出；提示转入学生个体问题模块；通知心理专员；记录事件",
    "redLineRecovery": "完成学生个体问题模块评估且心理专员确认",
    "redLineOwner": "心理专员"
  },
  "computedVariables": [
    {
      "name": "诊断总分",
      "scale": "学生学习问题三层诊断",
      "expression": "总分"
    }
  ],
  "optionGroups": [],
  "scales": [
    {
      "name": "学生学习问题三层诊断",
      "role": "入口筛查",
      "shortName": "三层诊断",
      "description": "从行为、认知和关系三个层面识别学生学习困难的主导因素，不构成学习障碍诊断。",
      "minutes": 5,
      "prerequisites": [],
      "exclusives": [],
      "triggerConditions": [],
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "行为层",
          "calcMethod": "mean",
          "weight": 1,
          "description": "行为层维度",
          "highInterpretation": "学习行为持续失序且外部推动无效",
          "lowInterpretation": "学习行为稳定"
        },
        {
          "name": "认知层",
          "calcMethod": "mean",
          "weight": 1,
          "description": "认知层维度",
          "highInterpretation": "理解停留表面，缺少元认知策略",
          "lowInterpretation": "认知加工顺畅"
        },
        {
          "name": "关系层",
          "calcMethod": "mean",
          "weight": 1,
          "description": "关系层维度",
          "highInterpretation": "师生、同伴或家庭关系明显影响学习投入",
          "lowInterpretation": "关系支持充分"
        }
      ],
      "questions": [
        {
          "text": "学生经常不交或拖延完成作业。",
          "dimension": "行为层",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "课堂上明显走神、分心或做与学习无关的事。",
          "dimension": "行为层",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "考试或测验成绩与实际能力之间存在明显落差。",
          "dimension": "行为层",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "已有提醒或奖励措施对改善学习行为效果有限。",
          "dimension": "行为层",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "学生对核心概念的理解停留在表面，难以迁移或应用。",
          "dimension": "认知层",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "学生在记忆、推理或组织信息方面存在明显困难。",
          "dimension": "认知层",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "学生在独立解决问题时容易卡住，缺少元认知策略。",
          "dimension": "认知层",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "师生关系或课堂归属感对学生的学习动机有明显影响。",
          "dimension": "关系层",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "同伴之间的比较、竞争或排斥影响了学生的学习投入。",
          "dimension": "关系层",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "家庭对学习的支持、期待或冲突明显影响了学生的学业状态。",
          "dimension": "关系层",
          "optionGroup": "AGREE_5",
          "reverse": false
        }
      ]
    },
    {
      "name": "学习动机与学业情绪评估",
      "role": "深度诊断",
      "shortName": "动机情绪",
      "description": "关系层卡点明显或三层整体偏重时，再深入测学习动机",
      "minutes": 6,
      "prerequisites": [
        "学生学习问题三层诊断"
      ],
      "exclusives": [],
      "triggerConditions": [
        {
          "targetType": "dimension",
          "target": "关系层",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        },
        {
          "targetType": "average",
          "target": "",
          "comparator": "达到或超过",
          "value": 3.2,
          "join": "或"
        }
      ],
      "triggerNote": "关系层卡点明显或三层整体偏重时，再深入测学习动机",
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "内在动机",
          "calcMethod": "mean",
          "weight": 1,
          "description": "内在动机维度",
          "highInterpretation": "学习完全依赖外部推动",
          "lowInterpretation": "有内在学习兴趣"
        },
        {
          "name": "学业焦虑",
          "calcMethod": "mean",
          "weight": 1,
          "description": "学业焦虑维度",
          "highInterpretation": "学业焦虑明显影响表现",
          "lowInterpretation": "焦虑水平可控"
        },
        {
          "name": "学业自我效能",
          "calcMethod": "mean",
          "weight": 1,
          "description": "学业自我效能维度",
          "highInterpretation": "认为自己学不会，习得性无助",
          "lowInterpretation": "相信努力有用"
        }
      ],
      "questions": [
        {
          "text": "没有老师或家长督促时，学生几乎不主动学习。",
          "dimension": "内在动机",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "学生学习主要是为了避免被批评。",
          "dimension": "内在动机",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "临近考试时学生出现明显紧张或躯体不适。",
          "dimension": "学业焦虑",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "学生因为怕出错而不敢在课堂上表达。",
          "dimension": "学业焦虑",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "学生认为自己再怎么努力也学不好某些科目。",
          "dimension": "学业自我效能",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "学生把失败归因于自己能力不行而不是方法问题。",
          "dimension": "学业自我效能",
          "optionGroup": "AGREE_5",
          "reverse": false
        }
      ]
    }
  ],
  "attributions": [
    {
      "name": "学习行为失序",
      "description": "学习行为持续失序，且提醒或奖励等外部推动手段效果有限。",
      "highSign": "作业拖延、课堂分心；提醒和奖励都不再有效",
      "typicalTrigger": "可能与执行功能、任务难度或环境干扰相关",
      "action": "完成一周学习行为观察，记录课堂参与、作业完成和测验表现的模式",
      "weight": 1.2,
      "tags": [
        "learning_problem",
        "behavior"
      ]
    },
    {
      "name": "认知加工困难",
      "description": "学生对核心概念的理解停留在表面，缺少可迁移的学习策略。",
      "highSign": "会做原题不会变式；独立解题时容易卡住",
      "typicalTrigger": "缺少元认知策略或前置知识存在断层",
      "action": "试用一项教学支架：从示范、提示、提问、同伴互助中选一项并记录效果",
      "weight": 1.3,
      "tags": [
        "learning_problem",
        "cognition"
      ]
    },
    {
      "name": "关系层影响",
      "description": "师生关系、同伴比较或家庭期待明显影响了学生的学习投入。",
      "highSign": "换老师后表现差异明显；因同伴比较而回避课堂",
      "typicalTrigger": "课堂归属感不足或家庭期待与能力错配",
      "action": "本周创造一次该学生在课堂上被正向看见的机会",
      "weight": 1.2,
      "tags": [
        "learning_problem",
        "relation"
      ]
    },
    {
      "name": "内驱动机不足",
      "description": "学习完全依赖外部推动，学生缺少自主的学习目标。",
      "highSign": "没人督促就不学；学习是为了避免批评",
      "typicalTrigger": "长期外部控制导致自主感缺失",
      "action": "让学生自己选择一项本周的学习任务并定义完成标准",
      "weight": 1.1,
      "tags": [
        "learning_problem",
        "motivation"
      ]
    },
    {
      "name": "习得性无助",
      "description": "学生认为再努力也学不好，把失败归因于能力而非方法。",
      "highSign": "「我就是学不会数学」；放弃尝试",
      "typicalTrigger": "长期失败经验累积且缺少归因引导",
      "action": "设计一个必然能成功的最小任务，并明确把成功归因到具体方法上",
      "weight": 1.4,
      "tags": [
        "learning_problem",
        "efficacy"
      ]
    }
  ],
  "evidences": [
    {
      "attribution": "学习行为失序",
      "scale": "学生学习问题三层诊断",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "行为层",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 3,
      "description": "行为层得分处于高位，学习行为持续失序"
    },
    {
      "attribution": "学习行为失序",
      "scale": "学生学习问题三层诊断",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "行为层",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "行为层出现需要关注的信号"
    },
    {
      "attribution": "学习行为失序",
      "scale": "学生学习问题三层诊断",
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
      "description": "提醒和奖励等外部推动手段已经失效"
    },
    {
      "attribution": "认知加工困难",
      "scale": "学生学习问题三层诊断",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "认知层",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 3,
      "description": "认知层得分处于高位，理解停留在表面"
    },
    {
      "attribution": "认知加工困难",
      "scale": "学生学习问题三层诊断",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "认知层",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "认知层出现需要关注的信号"
    },
    {
      "attribution": "认知加工困难",
      "scale": "学生学习问题三层诊断",
      "conditions": [
        {
          "targetType": "question",
          "target": "7",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "缺少元认知策略，独立解题时容易卡住"
    },
    {
      "attribution": "关系层影响",
      "scale": "学生学习问题三层诊断",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "关系层",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 3,
      "description": "关系层得分处于高位，关系因素明显影响学习"
    },
    {
      "attribution": "关系层影响",
      "scale": "学生学习问题三层诊断",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "关系层",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "关系层出现需要关注的信号"
    },
    {
      "attribution": "内驱动机不足",
      "scale": "学习动机与学业情绪评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "内在动机",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "内在动机维度偏低，学习依赖外部推动"
    },
    {
      "attribution": "内驱动机不足",
      "scale": "学习动机与学业情绪评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "内在动机",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "内在动机出现下降信号"
    },
    {
      "attribution": "习得性无助",
      "scale": "学习动机与学业情绪评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "学业自我效能",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 3,
      "description": "学业自我效能偏低，出现习得性无助信号"
    },
    {
      "attribution": "习得性无助",
      "scale": "学习动机与学业情绪评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "学业自我效能",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "学业自我效能需要关注"
    },
    {
      "attribution": "关系层影响",
      "scale": "学习动机与学业情绪评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "学业焦虑",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "学业焦虑明显，可能与课堂关系或家庭期待相关"
    }
  ],
  "levels": [
    {
      "name": "LP0 危机转介",
      "redLine": true,
      "scale": "学生学习问题三层诊断",
      "conditions": [
        {
          "targetType": "total",
          "target": "",
          "comparator": "达到或超过",
          "value": 38,
          "join": "且"
        }
      ],
      "teacherMessage": "评估显示该生的学习问题已达到需要专业介入的程度，常规教学支持已不足够。请转介心理专员或学习支持中心，并与家长同步情况。",
      "redLineAction": "转介心理专员/学习支持中心并同步年级组",
      "notificationTemplate": "[教师姓名]老师在学生学习问题评估中触发红线，请尽快登录系统查看处置要求。",
      "resultNote": "学习问题达到危机阈值，需立即转介"
    },
    {
      "name": "LP3 系统干预",
      "scale": "学生学习问题三层诊断",
      "conditions": [
        {
          "targetType": "total",
          "target": "",
          "comparator": "达到或超过",
          "value": 38,
          "join": "且"
        }
      ],
      "redLine": false,
      "teacherMessage": "本次诊断结果为 LP3 系统干预层级，主导因素是「${主要归因}」，同时「${次要归因}」也在起作用。这个层级不适合单点施力，建议整合教师、年级和家庭支持，一次只主攻一个层面。",
      "resultNote": "多个层面同时受阻，建议整合教师、年级和家庭支持，制定系统干预计划。",
      "escalationCondition": "连续两次 LP3 或伴随安全风险",
      "escalationTarget": "年级组长",
      "reAssessTrigger": "14天后复评"
    },
    {
      "name": "LP2 深入诊断",
      "scale": "学生学习问题三层诊断",
      "conditions": [
        {
          "targetType": "total",
          "target": "",
          "comparator": "达到或超过",
          "value": 27,
          "join": "且"
        }
      ],
      "redLine": false,
      "teacherMessage": "本次诊断结果为 LP2 深入诊断层级，主导因素落在「${主要归因}」。处理重点不是增加练习量，而是先结合课堂观察做交叉验证，确认卡点在哪一层。",
      "resultNote": "需要进一步诊断，建议结合课堂观察做交叉验证后再匹配工具。",
      "escalationCondition": "连续两次 LP2",
      "escalationTarget": "教研组长",
      "reAssessTrigger": "30天后复评"
    }
  ],
  "tools": [
    {
      "name": "一周学习行为观察表",
      "attributions": [
        "学习行为失序"
      ],
      "whenToUse": "学习行为持续失序但原因不明时",
      "steps": [
        "连续五天记录课堂参与、作业完成和测验表现三项",
        "标出每天状态最好和最差的时段",
        "找出重复出现的模式，如某节课后必然分心",
        "针对最高频的模式做一次环境或任务调整"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "我注意到你在数学课的后半节特别容易走神，我们一起看看能怎么调整。",
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
      "script": "我注意到你在数学课的后半节特别容易走神，我们一起看看能怎么调整。",
      "prohibition": "不要在记录期间同时改变多个变量",
      "timePerSession": "每天 5 分钟",
      "duration": "连续 5 天",
      "expectedEffect": "识别出至少一个可干预的行为模式",
      "effectNote": "找出行为失序的具体模式和时段",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "行为层"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "学习问题智能辅导系统 第2章",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "五天内记录完整",
      "failureCriteria": "记录不足三天",
      "contraindications": []
    },
    {
      "name": "ZPD 教学支架卡",
      "attributions": [
        "认知加工困难"
      ],
      "whenToUse": "学生会做原题但不会变式时",
      "steps": [
        "确定目标和学生当前的实际水平",
        "判断两者之间的最近发展区",
        "从示范、提示、提问、同伴互助中选一种支架",
        "明确退出标准，逐步撤除支架"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "你先看我做一遍，然后我们一起做一遍，最后你自己做一遍。",
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
      "script": "你先看我做一遍，然后我们一起做一遍，最后你自己做一遍。",
      "prohibition": "不要直接给答案；不要跳过示范环节",
      "timePerSession": "一节课",
      "duration": "每周两次",
      "expectedEffect": "学生能独立完成一道变式题",
      "effectNote": "在最近发展区内提供恰当强度的支持",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "认知层"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "维果茨基理论的课堂应用",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "撤除支架后仍能完成",
      "failureCriteria": "三次后仍完全依赖支架",
      "contraindications": []
    },
    {
      "name": "元认知提问清单",
      "attributions": [
        "认知加工困难"
      ],
      "whenToUse": "学生独立解题时容易卡住",
      "steps": [
        "给学生一张固定的四问清单：我要解决什么？我知道什么？我打算怎么做？做完怎么检查？",
        "前三次由教师带着问",
        "之后让学生自己对照清单出声说",
        "两周后撤掉清单，观察是否保留"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "先别急着算，你先说说这道题在问什么。",
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
      "severity": "medium",
      "script": "先别急着算，你先说说这道题在问什么。",
      "prohibition": "不要在学生思考时打断",
      "timePerSession": "10 分钟",
      "duration": "每次作业辅导时",
      "expectedEffect": "学生能自主使用至少两个自我提问",
      "effectNote": "把外部提示内化为自我提问习惯",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "认知层"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "元认知策略教学研究",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "两周后能不看清单自问",
      "failureCriteria": "两周后仍完全依赖提示",
      "contraindications": []
    },
    {
      "name": "课堂正向看见机会设计",
      "attributions": [
        "关系层影响"
      ],
      "whenToUse": "学生因课堂归属感不足而回避学习",
      "steps": [
        "找一个该学生确定能答对的问题",
        "在课堂上点名请他回答",
        "肯定具体的思路而不是笼统说「很好」",
        "连续三次后观察其课堂参与变化"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "刚才他用的这个方法很关键，我们都跟着他的思路走一遍。",
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
      "severity": "medium",
      "evidenceLevel": "B",
      "script": "刚才他用的这个方法很关键，我们都跟着他的思路走一遍。",
      "prohibition": "不要设计明显降低难度的问题让其他学生看出来",
      "timePerSession": "每次 2 分钟",
      "duration": "每周三次，连续两周",
      "expectedEffect": "课堂主动参与次数增加",
      "effectNote": "重建学生与课堂的正向联结",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "关系层"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "课堂归属感与学业投入研究",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "两周内主动举手次数增加",
      "failureCriteria": "两周后无变化",
      "contraindications": []
    },
    {
      "name": "自主任务选择卡",
      "attributions": [
        "内驱动机不足"
      ],
      "whenToUse": "学生完全依赖外部推动才学习",
      "steps": [
        "给出三个难度相近但形式不同的任务选项",
        "让学生自己选一个并说明为什么选它",
        "让学生自己定义「做到什么程度算完成」",
        "完成后只针对他自己定的标准做反馈"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "这三个你挑一个，挑完告诉我你觉得做到什么程度算完成。",
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
      "severity": "low",
      "evidenceLevel": "B",
      "script": "这三个你挑一个，挑完告诉我你觉得做到什么程度算完成。",
      "prohibition": "不要否定学生自定的完成标准",
      "timePerSession": "10 分钟",
      "duration": "每周一次",
      "expectedEffect": "学生开始主动定义学习目标",
      "effectNote": "通过给予选择权恢复自主感",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "内在动机"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "自我决定理论的课堂应用",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "学生能说出选择理由",
      "failureCriteria": "连续两次拒绝选择",
      "contraindications": []
    },
    {
      "name": "归因重塑最小任务",
      "attributions": [
        "习得性无助"
      ],
      "whenToUse": "学生认为「我就是学不会」时",
      "steps": [
        "设计一个该学生必然能完成的最小任务",
        "完成后立刻问：「你觉得这次为什么做到了？」",
        "如果他答「运气好」或「题简单」，引导到具体方法上",
        "连续五次后回看，让他自己总结用过哪些方法"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "这次你先把题目读了两遍才动手，就是这一步让你没掉进坑里。",
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
      "script": "这次你先把题目读了两遍才动手，就是这一步让你没掉进坑里。",
      "prohibition": "不要用「你很聪明」这类能力归因来鼓励",
      "timePerSession": "15 分钟",
      "duration": "每周两次，连续三周",
      "expectedEffect": "学生开始用方法解释成功",
      "effectNote": "把成功归因从能力转向方法",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "学业自我效能"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "归因理论在学业干预中的应用",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "五次内出现方法归因",
      "failureCriteria": "五次后仍归因于运气或难度",
      "contraindications": []
    },
    {
      "name": "系统干预协同方案",
      "attributions": [
        "认知加工困难"
      ],
      "whenToUse": "三个层面同时受阻，单一措施无效时",
      "steps": [
        "召集班主任、任课教师和家长做一次三方会商",
        "基于三层诊断结果确定一个主攻层面",
        "为每一方明确一项具体的支持动作和检查节点",
        "两周后复盘，只调整无效的那一项"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "我们这次不铺开做，只挑一个层面，两周后看效果再决定下一步。",
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
      "severity": "crisis",
      "evidenceLevel": "B",
      "script": "我们这次不铺开做，只挑一个层面，两周后看效果再决定下一步。",
      "prohibition": "不要同时启动超过三项措施",
      "timePerSession": "60 分钟",
      "duration": "每两周复盘一次",
      "expectedEffect": "形成一份三方共同承诺的干预计划",
      "effectNote": "整合多方资源制定系统干预",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "认知层"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "学习困难系统干预实务",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "三方均有明确动作和时限",
      "failureCriteria": "任一方无法承诺具体动作",
      "contraindications": [
        {
          "condition": "疑似存在学习障碍或注意力障碍",
          "type": "warn",
          "description": "教育干预无法替代专业评估",
          "alternative": "建议家长带孩子到专业机构做评估，教育支持同步进行"
        }
      ]
    }
  ],
  "keywords": [
    {
      "core": [
        "成绩下滑",
        "考砸了",
        "退步"
      ],
      "expanded": [
        "越来越差",
        "跟不上"
      ],
      "exclude": [],
      "category": "学业下降",
      "scale": "学生学习问题三层诊断",
      "tool": "一周学习行为观察表",
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "学业表现下降信号"
    },
    {
      "core": [
        "不写作业",
        "拖着不做",
        "交不上"
      ],
      "expanded": [
        "作业总是不交",
        "拖延"
      ],
      "exclude": [],
      "category": "行为失序",
      "scale": "学生学习问题三层诊断",
      "tool": "一周学习行为观察表",
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "学习行为失序信号"
    },
    {
      "core": [
        "听不懂",
        "学不会",
        "不理解"
      ],
      "expanded": [
        "讲了也不会",
        "一变就不会"
      ],
      "exclude": [],
      "category": "认知困难",
      "scale": "学生学习问题三层诊断",
      "tool": "ZPD 教学支架卡",
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "认知层困难信号"
    },
    {
      "core": [
        "不想学",
        "没兴趣",
        "懒得学"
      ],
      "expanded": [
        "不上心",
        "提不起劲"
      ],
      "exclude": [],
      "category": "动机不足",
      "scale": "学习动机与学业情绪评估",
      "tool": "自主任务选择卡",
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "学习动机不足信号"
    },
    {
      "core": [
        "我就是学不会",
        "笨",
        "没救了"
      ],
      "expanded": [
        "再努力也没用",
        "放弃了"
      ],
      "exclude": [],
      "category": "习得性无助",
      "scale": "学习动机与学业情绪评估",
      "tool": "归因重塑最小任务",
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "习得性无助信号"
    }
  ],
  "defaultLevelName": "LP1 教师自主支持",
  "defaultMessage": "本次诊断结果为 LP1 教师自主支持层级，主导因素是「${主要归因}」。当前可由教师通过教学策略调整自主支持，从推荐工具中选一项本周试用并记录效果。"
}
