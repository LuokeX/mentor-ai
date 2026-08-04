import type { WizardInput } from '../../shared/business-wizard'

// student_case 模块向导输入（v4.0.0 打样数据，业务填写向导 → 编译生成 test-data 与库内三库）
export const STUDENT_CASE_WIZARD_INPUT: WizardInput = {
  "module": "student_case",
  "version": "4.0.0",
  "sourceRef": "学生个体问题手册v1",
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
    "redLineActions": "停止常规建议输出；展示危机求助指引；创建安全事件；生成转介工单；通知心理专员",
    "redLineRecovery": "心理专员完成评估并在系统中标记为「已处置」",
    "redLineOwner": "心理专员"
  },
  "computedVariables": [
    {
      "name": "筛查总分",
      "scale": "学生个体问题快速筛查",
      "expression": "总分"
    }
  ],
  "optionGroups": [],
  "scales": [
    {
      "name": "学生个体问题快速筛查",
      "role": "入口筛查",
      "shortName": "五类筛查",
      "description": "从学业、行为、情绪、社交和适应五类表现进行教育场景筛查，不构成医学诊断。",
      "minutes": 6,
      "prerequisites": [],
      "exclusives": [],
      "triggerConditions": [],
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "学业表现",
          "calcMethod": "mean",
          "weight": 1,
          "description": "学业表现维度",
          "highInterpretation": "学业表现持续下降且常规支持无效",
          "lowInterpretation": "学业表现稳定"
        },
        {
          "name": "行为表现",
          "calcMethod": "mean",
          "weight": 1,
          "description": "行为表现维度",
          "highInterpretation": "冲动或对抗行为频繁且难以预测",
          "lowInterpretation": "行为表现可控"
        },
        {
          "name": "情绪状态",
          "calcMethod": "mean",
          "weight": 1,
          "description": "情绪状态维度",
          "highInterpretation": "持续低落焦虑且影响日常功能",
          "lowInterpretation": "情绪状态平稳"
        },
        {
          "name": "同伴社交",
          "calcMethod": "mean",
          "weight": 1,
          "description": "同伴社交维度",
          "highInterpretation": "冲突或孤立反复发生且修复无效",
          "lowInterpretation": "同伴关系稳定"
        },
        {
          "name": "适应状况",
          "calcMethod": "mean",
          "weight": 1,
          "description": "适应状况维度",
          "highInterpretation": "出现拒学、躯体化且持续四周以上",
          "lowInterpretation": "适应良好"
        }
      ],
      "questions": [
        {
          "text": "学习表现近期出现持续且明显的下降。",
          "dimension": "学业表现",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "完成作业、听课或考试受到明显影响。",
          "dimension": "学业表现",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "已有常规支持措施没有带来改善。",
          "dimension": "学业表现",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "冲动、对抗或规则破坏行为频繁出现。",
          "dimension": "行为表现",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "行为已经明显影响本人或同伴的学习。",
          "dimension": "行为表现",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "行为发生的场景和诱因较难预测。",
          "dimension": "行为表现",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "持续出现低落、焦虑、易怒或明显退缩。",
          "dimension": "情绪状态",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "情绪变化已经影响日常功能。",
          "dimension": "情绪状态",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "学生很难表达或调节当前感受。",
          "dimension": "情绪状态",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "与同伴的冲突、排斥或孤立反复发生。",
          "dimension": "同伴社交",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "学生缺少稳定的同伴支持。",
          "dimension": "同伴社交",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "常规关系修复方式效果有限。",
          "dimension": "同伴社交",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "在转班、家庭变化或重要事件后持续难以适应。",
          "dimension": "适应状况",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "出现明显躯体不适、拒学或回避。",
          "dimension": "适应状况",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "问题持续四周以上且没有改善趋势。",
          "dimension": "适应状况",
          "optionGroup": "AGREE_5",
          "reverse": false
        }
      ]
    },
    {
      "name": "EBRCA 结构化观察记录",
      "role": "深度诊断",
      "shortName": "EBRCA",
      "description": "五类问题整体偏重、或情绪维度突出时，再做 EBRCA 深度归因",
      "minutes": 8,
      "prerequisites": [
        "学生个体问题快速筛查"
      ],
      "exclusives": [],
      "triggerConditions": [
        {
          "targetType": "average",
          "target": "",
          "comparator": "达到或超过",
          "value": 3.2,
          "join": "且"
        },
        {
          "targetType": "dimension",
          "target": "情绪状态",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "或"
        }
      ],
      "triggerNote": "五类问题整体偏重、或情绪维度突出时，再做 EBRCA 深度归因",
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "诱因清晰度",
          "calcMethod": "mean",
          "weight": 1,
          "description": "诱因清晰度维度",
          "highInterpretation": "诱因不明确，行为难以预防",
          "lowInterpretation": "诱因清晰可干预"
        },
        {
          "name": "功能影响",
          "calcMethod": "mean",
          "weight": 1,
          "description": "功能影响维度",
          "highInterpretation": "已明显影响学习与生活功能",
          "lowInterpretation": "功能影响有限"
        },
        {
          "name": "既有支持有效性",
          "calcMethod": "mean",
          "weight": 1,
          "description": "既有支持有效性维度",
          "highInterpretation": "已尝试的支持基本无效",
          "lowInterpretation": "既有支持有效"
        }
      ],
      "questions": [
        {
          "text": "行为发生前的情境难以识别。",
          "dimension": "诱因清晰度",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "同样的情境下行为反应不一致。",
          "dimension": "诱因清晰度",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "该表现已影响学生完成日常学习任务。",
          "dimension": "功能影响",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "该表现已影响学生与他人的正常互动。",
          "dimension": "功能影响",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "已尝试的座位调整、谈话等措施没有带来改善。",
          "dimension": "既有支持有效性",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "家庭配合的支持措施没有带来改善。",
          "dimension": "既有支持有效性",
          "optionGroup": "AGREE_5",
          "reverse": false
        }
      ]
    }
  ],
  "attributions": [
    {
      "name": "情绪调节困难",
      "description": "学生持续出现低落、焦虑或退缩，且难以表达和调节当前感受。",
      "highSign": "持续低落或易怒；很难说清自己的感受",
      "typicalTrigger": "可能与家庭变化、同伴关系或学业压力相关",
      "action": "本周做一次低压力谈话，从可观察事实开始，不贴标签",
      "weight": 1.4,
      "tags": [
        "student_case",
        "emotion"
      ]
    },
    {
      "name": "行为调控困难",
      "description": "冲动、对抗或规则破坏行为频繁出现，且诱因难以预测。",
      "highSign": "行为频繁且场景不可预测；已影响他人学习",
      "typicalTrigger": "可能与执行功能、情绪调节或环境刺激相关",
      "action": "完成一周 ABC 结构化观察，记录行为前情境、行为本身和行为后结果",
      "weight": 1.3,
      "tags": [
        "student_case",
        "behavior"
      ]
    },
    {
      "name": "同伴关系受损",
      "description": "与同伴的冲突、排斥或孤立反复发生，缺少稳定的支持关系。",
      "highSign": "被孤立或反复冲突；常规修复方式无效",
      "typicalTrigger": "社交技能不足或班级关系结构问题",
      "action": "安排一次结构化的同伴配对活动，并观察互动质量",
      "weight": 1.2,
      "tags": [
        "student_case",
        "social"
      ]
    },
    {
      "name": "学业功能下降",
      "description": "学业表现持续下降，且已有常规支持措施没有带来改善。",
      "highSign": "成绩持续下滑；作业和听课明显受影响",
      "typicalTrigger": "可能是学习问题模块的信号，需要交叉评估",
      "action": "转入学习问题模块做三层诊断，区分行为、认知与关系层面的卡点",
      "weight": 1,
      "tags": [
        "student_case",
        "academic"
      ]
    },
    {
      "name": "适应障碍信号",
      "description": "出现拒学、躯体化或明显回避，且持续四周以上没有改善趋势。",
      "highSign": "拒学、躯体不适、明显回避；持续四周以上",
      "typicalTrigger": "重大生活事件或长期压力累积",
      "action": "整理时间线与已尝试措施，启动专业会商流程",
      "weight": 1.5,
      "tags": [
        "student_case",
        "adapt",
        "crisis"
      ]
    }
  ],
  "evidences": [
    {
      "attribution": "情绪调节困难",
      "scale": "学生个体问题快速筛查",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "情绪状态",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 3,
      "description": "情绪维度处于高位，已影响日常功能"
    },
    {
      "attribution": "情绪调节困难",
      "scale": "学生个体问题快速筛查",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "情绪状态",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "情绪维度出现需要关注的信号"
    },
    {
      "attribution": "行为调控困难",
      "scale": "学生个体问题快速筛查",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "行为表现",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 3,
      "description": "行为维度处于高位，行为频繁且难以预测"
    },
    {
      "attribution": "行为调控困难",
      "scale": "学生个体问题快速筛查",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "行为表现",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "行为维度出现需要关注的信号"
    },
    {
      "attribution": "同伴关系受损",
      "scale": "学生个体问题快速筛查",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "同伴社交",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "同伴社交维度处于高位，冲突或孤立反复发生"
    },
    {
      "attribution": "同伴关系受损",
      "scale": "学生个体问题快速筛查",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "同伴社交",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "同伴社交出现需要关注的信号"
    },
    {
      "attribution": "学业功能下降",
      "scale": "学生个体问题快速筛查",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "学业表现",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "学业维度处于高位且常规支持无效"
    },
    {
      "attribution": "学业功能下降",
      "scale": "学生个体问题快速筛查",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "学业表现",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "学业表现出现下降"
    },
    {
      "attribution": "适应障碍信号",
      "scale": "学生个体问题快速筛查",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "适应状况",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 3.5,
      "description": "适应维度处于高位，出现拒学或躯体化信号"
    },
    {
      "attribution": "适应障碍信号",
      "scale": "学生个体问题快速筛查",
      "conditions": [
        {
          "targetType": "question",
          "target": "15",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "问题已持续四周以上且无改善趋势"
    },
    {
      "attribution": "适应障碍信号",
      "scale": "学生个体问题快速筛查",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "适应状况",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "适应状况出现需要关注的信号"
    },
    {
      "attribution": "行为调控困难",
      "scale": "EBRCA 结构化观察记录",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "诱因清晰度",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "结构化观察显示行为诱因不清晰，难以预防"
    },
    {
      "attribution": "适应障碍信号",
      "scale": "EBRCA 结构化观察记录",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "功能影响",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 3,
      "description": "结构化观察显示功能影响已经明显"
    },
    {
      "attribution": "情绪调节困难",
      "scale": "EBRCA 结构化观察记录",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "既有支持有效性",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "已尝试的支持措施基本无效，需要升级支持层级"
    },
    {
      "attribution": "同伴关系受损",
      "scale": "EBRCA 结构化观察记录",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "功能影响",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "功能影响已波及正常互动"
    }
  ],
  "levels": [
    {
      "name": "L3 专业会商",
      "scale": "学生个体问题快速筛查",
      "conditions": [
        {
          "targetType": "total",
          "target": "",
          "comparator": "达到或超过",
          "value": 52,
          "join": "且"
        }
      ],
      "redLine": true,
      "redLineAction": "立即阻断常规建议输出，展示危机求助指引，生成转介工单通知心理专员",
      "teacherMessage": "本次筛查结果达到 L3 专业会商层级，最突出的是「${主要归因}」。请整理时间线、已尝试措施和效果，并启动转介流程。在专业介入前，保持日常陪伴和安全环境。",
      "resultNote": "多个维度同时处于高位，已达到专业会商层级，请整理材料并启动转介。",
      "escalationTarget": "心理专员",
      "notificationTemplate": "[学生]个体问题评估触发红线：出现拒学与情绪功能受损。请尽快介入。"
    },
    {
      "name": "L2 年级协同",
      "scale": "学生个体问题快速筛查",
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
      "teacherMessage": "本次筛查结果为 L2 年级协同层级，主要归因是「${主要归因}」，同时「${次要归因}」也需要关注。建议整理协同材料并与年级组共同制定支持方案。",
      "resultNote": "问题已超出单个教师可独立处理的范围，建议启动年级协同。",
      "escalationCondition": "连续两次 L2",
      "escalationTarget": "年级组长",
      "reAssessTrigger": "14天后复评"
    },
    {
      "name": "L1 教师关注",
      "conditions": [
        {
          "targetType": "total",
          "target": "",
          "comparator": "达到或超过",
          "value": 25,
          "join": "且"
        }
      ],
      "teacherMessage": "学生当前信号以关注为主，建议按推荐工具做日常支持，两周后复评。",
      "resultNote": "总分处于关注区间，暂不需要年级协同"
    }
  ],
  "tools": [
    {
      "name": "ABC 结构化观察记录",
      "attributions": [
        "行为调控困难"
      ],
      "whenToUse": "行为频繁且诱因难以识别时",
      "steps": [
        "连续一周，每次行为发生时记录三栏：A 发生前情境 / B 可观察行为 / C 行为后结果",
        "只记录看到的，不写推测和评价",
        "一周后统计最高频的 A 和 C",
        "针对最高频的 A 做一次环境调整并观察变化"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "我注意到你最近有些变化，我想先了解你的感受。你可以只说一点点。",
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
      "script": "我注意到你最近有些变化，我想先了解你的感受。你可以只说一点点。",
      "prohibition": "不要在记录中使用诊断性词汇；不要向学生展示记录表",
      "timePerSession": "每次 2 分钟",
      "duration": "连续 7 天",
      "expectedEffect": "识别出至少一个可干预的诱因",
      "effectNote": "把模糊印象转成可分析的行为数据",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "行为表现"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "应用行为分析在班级中的实践",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "一周内记录 >= 8 次",
      "failureCriteria": "一周记录不足 3 次",
      "contraindications": []
    },
    {
      "name": "低压力谈话框架",
      "attributions": [
        "情绪调节困难"
      ],
      "whenToUse": "学生情绪明显但难以表达时",
      "steps": [
        "选一个不被打扰、非正式的场合",
        "从一个具体的观察事实开始，不问「你怎么了」",
        "给出选择而非追问：「你可以只说一点点，也可以先不说」",
        "结束时明确下一次可以找你的时间和方式"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "我注意到你这两天午休都一个人待着。你可以只说一点点，不需要马上解释清楚。",
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
      "form": "script",
      "severity": "medium",
      "evidenceLevel": "B",
      "script": "我注意到你这两天午休都一个人待着。你可以只说一点点，不需要马上解释清楚。",
      "prohibition": "不要在其他学生在场时进行；不要承诺保密后又告知他人",
      "timePerSession": "10 分钟",
      "duration": "每周一次",
      "expectedEffect": "学生愿意做出任何程度的表达",
      "effectNote": "在不施压的前提下建立表达通道",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "情绪状态"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "学生个体支持手册 第3章",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "学生做出回应（包括沉默但未回避）",
      "failureCriteria": "连续两次学生完全回避",
      "contraindications": []
    },
    {
      "name": "同伴联结重建方案",
      "attributions": [
        "同伴关系受损"
      ],
      "whenToUse": "学生被孤立或同伴冲突反复发生",
      "steps": [
        "找一个该学生擅长的领域，设计一个需要合作的小任务",
        "为其匹配一到两位关系中性的同学",
        "任务完成后公开肯定该学生的具体贡献",
        "两周后观察自然互动是否增加"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "这件事你最在行，你带着他们两个一起弄，周五给大家看看。",
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
      "script": "这件事你最在行，你带着他们两个一起弄，周五给大家看看。",
      "prohibition": "不要公开点明该学生「需要帮助」",
      "timePerSession": "一周",
      "duration": "每两周一轮",
      "expectedEffect": "自然互动频次增加",
      "effectNote": "通过结构化任务重建同伴关系",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "同伴社交"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "同伴关系干预实务",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "两周内出现自发互动",
      "failureCriteria": "两轮后无变化（升级至 L2）",
      "contraindications": []
    },
    {
      "name": "三级支持决策卡",
      "attributions": [
        "适应障碍信号"
      ],
      "whenToUse": "需要判断由教师支持、年级协同还是专业会商",
      "steps": [
        "整理问题的起止时间线和关键事件",
        "列出已尝试的支持措施和各自效果",
        "对照三级标准判断当前层级",
        "按层级准备对应材料并启动流程"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "目前我们先基于观察事实协同支持，不做标签判断，重点是看哪些支持对学生有效。",
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
      "severity": "high",
      "script": "目前我们先基于观察事实协同支持，不做标签判断，重点是看哪些支持对学生有效。",
      "prohibition": "不得在材料中写入诊断性结论",
      "timePerSession": "30 分钟",
      "duration": "每次层级变化时",
      "expectedEffect": "形成一份可交接的支持材料",
      "effectNote": "让支持层级的判断有据可依",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "适应状况"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "学生个体支持手册 第6章",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "材料包含时间线、措施和效果三部分",
      "failureCriteria": "无法回忆已尝试过哪些措施",
      "contraindications": []
    },
    {
      "name": "学业交叉评估转介单",
      "attributions": [
        "学业功能下降"
      ],
      "whenToUse": "学业下降是最突出的表现时",
      "steps": [
        "确认学业下降已持续四周以上",
        "记录哪些科目、哪些环节受影响最明显",
        "在学习问题模块完成三层诊断",
        "按三层诊断结果匹配教学支架"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "我们关注的不只是分数，而是他在学习过程中遇到了什么困难。",
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
      "severity": "low",
      "evidenceLevel": "B",
      "script": "我们关注的不只是分数，而是他在学习过程中遇到了什么困难。",
      "prohibition": "不要在未做三层诊断前直接安排补课",
      "timePerSession": "15 分钟",
      "duration": "按需",
      "expectedEffect": "定位到行为、认知或关系层面的具体卡点",
      "effectNote": "把学业问题转到学习问题模块做精准诊断",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "学业表现"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "跨模块协同指引",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "完成学习问题模块的三层诊断",
      "failureCriteria": "诊断结果无明确主导层面",
      "contraindications": []
    },
    {
      "name": "危机转介操作卡",
      "attributions": [
        "适应障碍信号"
      ],
      "whenToUse": "出现拒学、躯体化或自伤相关信号",
      "steps": [
        "确保学生当下处于安全环境并有人陪伴",
        "立即联系校内心理专员，说明观察到的具体事实",
        "同步通知年级组长和家长",
        "完整记录时间线，不做任何诊断性表述"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "我现在需要请专业老师一起来看看，我会一直陪着你。",
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
      "script": "我现在需要请专业老师一起来看看，我会一直陪着你。",
      "prohibition": "严禁班主任自行判断风险等级；严禁延迟上报；严禁在学生面前讨论转介",
      "timePerSession": "立即",
      "duration": "按需",
      "expectedEffect": "在 24 小时内建立专业支持连接",
      "effectNote": "确保危机情形被专业力量及时接住",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "适应状况"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "校园心理危机干预规范",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "2 小时内完成专员联系",
      "failureCriteria": "超过 24 小时未建立联系",
      "contraindications": [
        {
          "condition": "学生已在专业干预中",
          "type": "warn",
          "description": "避免重复动员造成学生压力",
          "alternative": "与心理专员确认现有干预方案后再行动"
        }
      ]
    }
  ],
  "keywords": [
    {
      "core": [
        "不想活",
        "想死",
        "活着没意思"
      ],
      "expanded": [
        "结束生命",
        "生无可恋",
        "不如死了"
      ],
      "exclude": [
        "不想活了（玩笑）"
      ],
      "category": "自杀意念",
      "scale": "学生个体问题快速筛查",
      "tool": "危机转介操作卡",
      "matchMode": "exact",
      "risk": "red",
      "description": "任一命中即走危机流程，不分时段和模块"
    },
    {
      "core": [
        "自伤",
        "划手",
        "伤害自己"
      ],
      "expanded": [
        "割腕",
        "弄伤自己"
      ],
      "exclude": [],
      "category": "自伤行为",
      "scale": "学生个体问题快速筛查",
      "tool": "危机转介操作卡",
      "matchMode": "exact",
      "risk": "red",
      "description": "自伤相关表达，立即走危机流程"
    },
    {
      "core": [
        "不想上学",
        "不肯来",
        "请假很多"
      ],
      "expanded": [
        "拒学",
        "逃学",
        "装病"
      ],
      "exclude": [],
      "category": "拒学信号",
      "scale": "学生个体问题快速筛查",
      "tool": "三级支持决策卡",
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "出现拒学相关信号"
    },
    {
      "core": [
        "被欺负",
        "被孤立",
        "没人跟他玩"
      ],
      "expanded": [
        "被排挤",
        "被针对"
      ],
      "exclude": [],
      "category": "同伴排斥",
      "scale": "EBRCA 结构化观察记录",
      "tool": "同伴联结重建方案",
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "出现同伴排斥信号"
    },
    {
      "core": [
        "情绪不好",
        "很低落",
        "爱哭"
      ],
      "expanded": [
        "不说话",
        "躲着人",
        "发脾气"
      ],
      "exclude": [],
      "category": "情绪信号",
      "scale": "学生个体问题快速筛查",
      "tool": "低压力谈话框架",
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "出现情绪相关信号"
    }
  ],
  "defaultLevelName": "L1 教师支持",
  "defaultMessage": "本次筛查结果为 L1 教师支持层级，主要落在「${主要归因}」。处理重点是先做教育场景下的结构化观察，区分表现、诱因和已尝试支持，不做标签判断。"
}
