import type { WizardInput } from '../../shared/business-wizard'

// home_school 模块向导输入（v4.0.0 打样数据，业务填写向导 → 编译生成 test-data 与库内三库）
export const HOME_SCHOOL_WIZARD_INPUT: WizardInput = {
  "module": "home_school",
  "version": "4.0.0",
  "sourceRef": "家校沟通合作手册v1",
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
    "evidenceLevel": "B",
    "redLineScope": "module",
    "redLineActions": "停止单独沟通；启用保护通道；全程留痕；通知年级组长；必要时上报校方",
    "redLineRecovery": "经年级组长评估确认沟通可恢复常规",
    "redLineOwner": "年级组长"
  },
  "computedVariables": [
    {
      "name": "容器强度",
      "scale": "家校沟通六维速查",
      "expression": "维度[角色边界]"
    },
    {
      "name": "风险总分",
      "scale": "家校沟通六维速查",
      "expression": "总分"
    }
  ],
  "optionGroups": [],
  "scales": [
    {
      "name": "家校沟通六维速查",
      "role": "入口筛查",
      "shortName": "六维速查",
      "description": "按六维度框架判断家校沟通状态：沟通质量、参与效能、教育一致性、角色边界（信任关系与危机响应由深度评估承接）。反向计分：得分越高表示状况越差。",
      "minutes": 5,
      "prerequisites": [],
      "exclusives": [],
      "triggerConditions": [],
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "沟通质量",
          "calcMethod": "mean",
          "weight": 1,
          "description": "沟通质量维度",
          "highInterpretation": "出现不尊重、混淆事实与情绪甚至威胁行为",
          "lowInterpretation": "沟通质量可控"
        },
        {
          "name": "参与效能",
          "calcMethod": "mean",
          "weight": 1,
          "description": "参与效能维度",
          "highInterpretation": "家长回应慢、不参与共同行动",
          "lowInterpretation": "参与效能良好"
        },
        {
          "name": "教育一致性",
          "calcMethod": "mean",
          "weight": 1,
          "description": "教育一致性维度",
          "highInterpretation": "家长不认同或不愿执行共同达成的教育行动",
          "lowInterpretation": "教育方向一致"
        },
        {
          "name": "角色边界",
          "calcMethod": "mean",
          "weight": 1,
          "description": "角色边界维度",
          "highInterpretation": "关系无法承受坦诚讨论，边界模糊",
          "lowInterpretation": "角色边界清晰、角色边界充足"
        }
      ],
      "questions": [
        {
          "text": "家长能够及时回应学校的重要沟通。",
          "dimension": "参与效能",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "家长愿意共同讨论并执行已经达成的行动。",
          "dimension": "教育一致性",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "出现分歧后，家长仍愿意继续保持沟通。",
          "dimension": "角色边界",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "家长表达不满时仍能保持基本尊重。",
          "dimension": "沟通质量",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "家长能够区分事实、推测和情绪。",
          "dimension": "沟通质量",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "家长没有出现威胁、公开抹黑或恶意维权行为。",
          "dimension": "沟通质量",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "目前的关系可以承受一次坦诚而具体的讨论。",
          "dimension": "角色边界",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "双方能够在情绪出现时暂停并回到问题解决。",
          "dimension": "角色边界",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "过去的积极沟通经验仍能成为当前关系资源。",
          "dimension": "角色边界",
          "optionGroup": "AGREE_5",
          "reverse": true
        }
      ]
    },
    {
      "name": "家长分型与沟通策略评估",
      "role": "深度诊断",
      "shortName": "家长分型",
      "description": "沟通质量维度偏高时才需要判断家长类型，否则不用做",
      "minutes": 6,
      "prerequisites": [
        "家校沟通六维速查"
      ],
      "exclusives": [],
      "triggerConditions": [
        {
          "targetType": "dimension",
          "target": "沟通质量",
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
      "triggerNote": "沟通质量维度偏高时才需要判断家长类型，否则不用做",
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "焦虑水平",
          "calcMethod": "mean",
          "weight": 1,
          "description": "焦虑水平维度",
          "highInterpretation": "家长处于高焦虑，难以接收复杂信息",
          "lowInterpretation": "情绪相对平稳"
        },
        {
          "name": "控制倾向",
          "calcMethod": "mean",
          "weight": 1,
          "description": "控制倾向维度",
          "highInterpretation": "家长倾向于主导教育方式并质疑学校安排",
          "lowInterpretation": "愿意接受学校专业判断"
        },
        {
          "name": "信任关系",
          "calcMethod": "mean",
          "weight": 1,
          "description": "信任关系维度",
          "highInterpretation": "对学校缺乏基本信任",
          "lowInterpretation": "有较好的信任关系"
        }
      ],
      "questions": [
        {
          "text": "家长在沟通中反复确认同一件事。",
          "dimension": "焦虑水平",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "家长常在非工作时间发来紧急消息。",
          "dimension": "焦虑水平",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "家长会具体指定学校应该如何处理。",
          "dimension": "控制倾向",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "家长对学校既有安排提出较多质疑。",
          "dimension": "控制倾向",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "家长相信教师是出于孩子利益在做判断。",
          "dimension": "信任关系",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "过去的沟通中，家长兑现过共同约定。",
          "dimension": "信任关系",
          "optionGroup": "AGREE_5",
          "reverse": true
        }
      ]
    }
  ],
  "attributions": [
    {
      "name": "沟通冲突升级",
      "description": "家长的表达方式已经越过基本尊重的边界，关系进入对抗状态。",
      "highSign": "出现威胁、公开抹黑或恶意维权；沟通中反复攻击个人",
      "typicalTrigger": "长期诉求未被回应，或某次事件处理让家长感到不被尊重",
      "action": "不在情绪高点解释责任，先记录家长诉求、事实依据和待核实点，并上报年级组长",
      "weight": 1.4,
      "tags": [
        "home_school",
        "conflict"
      ]
    },
    {
      "name": "角色边界不足",
      "description": "当前关系无法承受一次坦诚而具体的讨论，需要先修复再沟通。",
      "highSign": "一说具体问题就情绪激化；过去无积极沟通经验可调用",
      "typicalTrigger": "缺少日常正向接触，只在出问题时联系",
      "action": "本周主动做一次与问题无关的正向接触，只反馈孩子的一个具体进步",
      "weight": 1.2,
      "tags": [
        "home_school",
        "container"
      ]
    },
    {
      "name": "参与效能不足",
      "description": "家长未参与共同行动，导致校内措施缺少家庭侧的配合。",
      "highSign": "不回消息、约定的事没有落实",
      "typicalTrigger": "家长精力有限或不认同学校的处理方式",
      "action": "把请求缩小到一个本周内能完成的具体动作，并明确完成后的反馈方式",
      "weight": 1,
      "tags": [
        "home_school",
        "cooperation"
      ]
    },
    {
      "name": "家长焦虑过载",
      "description": "家长处于高焦虑状态，难以接收和处理复杂信息。",
      "highSign": "反复确认同一件事；非工作时间频繁发来紧急消息",
      "typicalTrigger": "对孩子状况缺乏可控感，信息来源零散",
      "action": "固定一个每周反馈时间点，让家长知道什么时候能拿到什么信息，减少不确定感",
      "weight": 1.1,
      "tags": [
        "home_school",
        "anxiety"
      ]
    },
    {
      "name": "信任关系薄弱",
      "description": "家长不相信教师是出于孩子利益在做判断，任何建议都会被质疑。",
      "highSign": "对学校既有安排提出较多质疑；不认为教师站在孩子一边",
      "typicalTrigger": "过往承诺未兑现或信息不透明",
      "action": "选一件小事，明确承诺并按时兑现，用可验证的行为重建信任",
      "weight": 1.2,
      "tags": [
        "home_school",
        "trust"
      ]
    }
  ],
  "evidences": [
    {
      "attribution": "沟通冲突升级",
      "scale": "家校沟通六维速查",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "沟通质量",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 3,
      "description": "沟通质量维度处于高位，已出现越界表达"
    },
    {
      "attribution": "沟通冲突升级",
      "scale": "家校沟通六维速查",
      "conditions": [
        {
          "targetType": "question",
          "target": "6",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 3,
      "description": "出现威胁、公开抹黑或恶意维权行为"
    },
    {
      "attribution": "沟通冲突升级",
      "scale": "家校沟通六维速查",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "沟通质量",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "沟通质量出现值得关注的变化"
    },
    {
      "attribution": "角色边界不足",
      "scale": "家校沟通六维速查",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "角色边界",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "角色边界无法承受坦诚讨论"
    },
    {
      "attribution": "角色边界不足",
      "scale": "家校沟通六维速查",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "角色边界",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "角色边界承载力下降"
    },
    {
      "attribution": "参与效能不足",
      "scale": "家校沟通六维速查",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "参与效能",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "参与效能维度处于高位，共同行动难以落实"
    },
    {
      "attribution": "参与效能不足",
      "scale": "家校沟通六维速查",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "参与效能",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "参与效能出现下降"
    },
    {
      "attribution": "家长焦虑过载",
      "scale": "家长分型与沟通策略评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "焦虑水平",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "家长焦虑水平偏高，难以处理复杂信息"
    },
    {
      "attribution": "家长焦虑过载",
      "scale": "家长分型与沟通策略评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "焦虑水平",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "家长出现焦虑信号"
    },
    {
      "attribution": "信任关系薄弱",
      "scale": "家长分型与沟通策略评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "信任关系",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "信任关系薄弱，建议先做信任修复"
    },
    {
      "attribution": "沟通冲突升级",
      "scale": "家长分型与沟通策略评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "控制倾向",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "控制倾向强且质疑较多，存在冲突升级风险"
    },
    {
      "attribution": "信任关系薄弱",
      "scale": "家长分型与沟通策略评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "信任关系",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "信任关系需要巩固"
    }
  ],
  "levels": [
    {
      "name": "E 级保护通道",
      "scale": "家校沟通六维速查",
      "conditions": [
        {
          "targetType": "question",
          "target": "6",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "redLine": true,
      "redLineAction": "停止教师单独沟通，转入学校保护通道，全程留痕并由年级组长或校方介入",
      "teacherMessage": "本次评估触发 E 级保护通道，核心问题是「${主要归因}」。请立即停止单独沟通，保存全部记录并当天上报年级组长，后续由学校层面承接。",
      "resultNote": "出现威胁或恶意维权行为，已转入保护通道，请勿单独沟通。",
      "escalationTarget": "年级组长/校方",
      "notificationTemplate": "[班级]家校沟通触发 E 级保护通道，请勿让班主任单独沟通。"
    },
    {
      "name": "D 级高冲突",
      "scale": "家长分型与沟通策略评估",
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
      "teacherMessage": "本次沟通风险等级为 D 级，主要归因是「${主要归因}」，同时需关注「${次要归因}」。建议由年级组长陪同沟通并全程留痕。",
      "resultNote": "家长分型显示焦虑或控制倾向偏高、信任关系薄弱，建议由年级组长陪同沟通。",
      "escalationCondition": "连续两次 D 级",
      "escalationTarget": "年级组长",
      "reAssessTrigger": "7天后复评"
    },
    {
      "name": "C 级需谨慎",
      "scale": "家长分型与沟通策略评估",
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
      "teacherMessage": "本次评估提示沟通存在明显阻力，核心变量是「${主要归因}」。处理重点不是先说服家长，而是先稳住情绪和事实边界，再决定沟通节奏。",
      "resultNote": "家长分型提示沟通存在明显阻力，先稳住情绪和事实边界再决定节奏。",
      "escalationCondition": "连续两次 C 级",
      "escalationTarget": "年级组长",
      "reAssessTrigger": "14天后复评"
    }
  ],
  "tools": [
    {
      "name": "先跟后带话术卡",
      "attributions": [
        "角色边界不足"
      ],
      "whenToUse": "家长有情绪但尚未升级，需要先稳住关系",
      "steps": [
        "先复述家长的担心，用他的原话",
        "表达理解而非认同：「我能感受到您现在很担心」",
        "把话题引向可核实的事实",
        "约定一个具体的下一步和反馈时间"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "我能感受到您现在很担心。我们先把事实逐项核实，再一起决定下一步。",
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
      "script": "我能感受到您现在很担心。我们先把事实逐项核实，再一起决定下一步。",
      "prohibition": "不要在情绪高点解释责任归属；不要承诺未核实的事项",
      "timePerSession": "10 分钟",
      "duration": "按需",
      "expectedEffect": "单次沟通内情绪明显降温",
      "effectNote": "在不认同内容的前提下承接情绪",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "角色边界"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "家校沟通实务手册 第3章",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "家长愿意继续讨论具体事实",
      "failureCriteria": "两次尝试后情绪仍持续升级",
      "contraindications": []
    },
    {
      "name": "事实边界记录表",
      "attributions": [
        "沟通冲突升级"
      ],
      "whenToUse": "沟通开始出现指责和归因争议时",
      "steps": [
        "分三栏记录：家长诉求 / 已核实事实 / 待核实点",
        "每一条都注明时间、在场人和信息来源",
        "待核实点明确由谁在什么时间核实",
        "核实结果书面反馈给家长"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "这一条我需要先向任课老师核实，明天下午三点前给您答复。",
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
      "severity": "high",
      "evidenceLevel": "A",
      "script": "这一条我需要先向任课老师核实，明天下午三点前给您答复。",
      "prohibition": "不要凭记忆回应；不要在未核实前认定责任",
      "timePerSession": "20 分钟",
      "duration": "每次冲突性沟通后",
      "expectedEffect": "争议点从模糊指责收敛为可核实清单",
      "effectNote": "把争议从情绪层面拉回可核实的事实",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "沟通质量"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "家校沟通实务手册 第5章",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "待核实点全部有明确责任人和时限",
      "failureCriteria": "家长拒绝进入事实核实流程",
      "contraindications": []
    },
    {
      "name": "沟通容器修复计划",
      "attributions": [
        "角色边界不足"
      ],
      "whenToUse": "关系只在出问题时才联系，缺少正向经验",
      "steps": [
        "本周主动做一次与问题无关的正向接触",
        "只反馈孩子的一个具体进步，不带任何请求",
        "两周内累计三次正向接触后，再谈需要讨论的问题",
        "每次接触后记录家长的回应变化"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "今天想跟您说件小事，孩子这周主动帮同学讲了一道题。",
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
      "script": "今天想跟您说件小事，孩子这周主动帮同学讲了一道题。",
      "prohibition": "正向接触时不要夹带任何请求或批评",
      "timePerSession": "5 分钟",
      "duration": "每周一次，连续三周",
      "expectedEffect": "家长回应速度和态度改善",
      "effectNote": "重建可承载坦诚讨论的关系基础",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "角色边界"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "家校沟通实务手册 第4章",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "三次接触后家长主动回应",
      "failureCriteria": "三次接触后无任何回应",
      "contraindications": []
    },
    {
      "name": "最小请求约定法",
      "attributions": [
        "参与效能不足"
      ],
      "whenToUse": "家长不回消息或约定的事没有落实",
      "steps": [
        "把原本的请求拆到一周内能完成的最小动作",
        "明确「做什么、什么时候、怎么反馈」三件事",
        "完成后当天给出正向反馈",
        "连续两次完成后再提高一点要求"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "这周只请您做一件事：晚饭后问一句今天数学课听懂了多少，周五告诉我他怎么说。",
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
      "severity": "low",
      "script": "这周只请您做一件事：晚饭后问一句今天数学课听懂了多少，周五告诉我他怎么说。",
      "prohibition": "不要一次提出多项请求",
      "timePerSession": "5 分钟",
      "duration": "每周一次",
      "expectedEffect": "家长完成率提升",
      "effectNote": "把配合请求缩小到可完成的尺度",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "参与效能"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "家校沟通实务手册 第6章",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "连续两周完成约定",
      "failureCriteria": "连续两次未完成（改用 HS_RX_003）",
      "contraindications": []
    },
    {
      "name": "定期反馈节奏表",
      "attributions": [
        "家长焦虑过载"
      ],
      "whenToUse": "家长反复确认同一件事、非工作时间频繁联系",
      "steps": [
        "与家长约定固定的反馈时间点，如每周五下午",
        "明确每次反馈包含哪三项内容",
        "约定非紧急事项统一在反馈时处理",
        "紧急情况的判断标准写清楚"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "我每周五下午会把这三件事同步给您，中间如果有紧急情况我会随时联系。",
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
      "script": "我每周五下午会把这三件事同步给您，中间如果有紧急情况我会随时联系。",
      "prohibition": "不要承诺随时回复；约定后必须自己先遵守",
      "timePerSession": "15 分钟",
      "duration": "约定一次，长期执行",
      "expectedEffect": "非工作时间消息量下降",
      "effectNote": "用可预期的信息节奏降低焦虑",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "焦虑水平"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "家校沟通实务手册 第7章",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "非工作时间消息减少 50%",
      "failureCriteria": "约定后一周内仍频繁越界",
      "contraindications": []
    },
    {
      "name": "承诺兑现清单",
      "attributions": [
        "信任关系薄弱"
      ],
      "whenToUse": "家长不相信教师站在孩子一边",
      "steps": [
        "只承诺一件本周确定能做到的小事",
        "明确完成时间和验证方式",
        "按时完成并主动告知结果",
        "连续兑现三次后再讨论更大的议题"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "这周我会安排他坐到第二排，周五我告诉您效果怎么样。",
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
      "script": "这周我会安排他坐到第二排，周五我告诉您效果怎么样。",
      "prohibition": "不要承诺不在自己权限内的事",
      "timePerSession": "10 分钟",
      "duration": "每周一次，连续三周",
      "expectedEffect": "家长开始接受教师的专业判断",
      "effectNote": "用可验证的行为重建信任",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "信任关系"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "家校信任重建研究",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "连续三次按时兑现",
      "failureCriteria": "任一次未按时兑现（需重新开始）",
      "contraindications": []
    },
    {
      "name": "E 级保护通道操作卡",
      "attributions": [
        "沟通冲突升级"
      ],
      "whenToUse": "家长出现威胁、公开抹黑或恶意维权",
      "steps": [
        "立即停止单独沟通，不再单方回应",
        "完整保存聊天记录、通话记录和相关材料",
        "当天上报年级组长并填写事件说明",
        "后续沟通全部由年级组长或校方主导，教师只提供事实"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "这件事我需要请年级组长一起来处理，我们另约时间当面谈。",
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
      "script": "这件事我需要请年级组长一起来处理，我们另约时间当面谈。",
      "prohibition": "严禁教师单独回应威胁；严禁删除任何沟通记录",
      "timePerSession": "30 分钟",
      "duration": "按需",
      "expectedEffect": "教师退出单独沟通，风险转由学校承接",
      "effectNote": "保护教师并把处置转到学校层面",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "沟通质量"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "校方家校冲突处置规范",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "24 小时内完成上报和留痕",
      "failureCriteria": "教师仍在单独沟通",
      "contraindications": [
        {
          "condition": "事件已进入法律程序",
          "type": "block",
          "description": "进入法律程序后一切沟通由校方法务承接",
          "alternative": "移交校方法务处理"
        }
      ]
    }
  ],
  "keywords": [
    {
      "core": [
        "投诉",
        "举报",
        "找校长"
      ],
      "expanded": [
        "曝光",
        "发到网上",
        "教育局"
      ],
      "exclude": [],
      "category": "冲突升级",
      "scale": "家校沟通六维速查",
      "tool": "E 级保护通道操作卡",
      "matchMode": "exact",
      "risk": "red",
      "description": "家长表达投诉或维权意图，走保护通道"
    },
    {
      "core": [
        "家长不配合",
        "不回消息",
        "不管孩子"
      ],
      "expanded": [
        "联系不上家长",
        "家长不上心"
      ],
      "exclude": [],
      "category": "配合不足",
      "scale": "家校沟通六维速查",
      "tool": "最小请求约定法",
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "家长参与效能不足"
    },
    {
      "core": [
        "家长天天问",
        "一直发消息"
      ],
      "expanded": [
        "半夜发消息",
        "反复确认"
      ],
      "exclude": [],
      "category": "焦虑过载",
      "scale": "家长分型与沟通策略评估",
      "tool": "定期反馈节奏表",
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "家长焦虑水平偏高"
    },
    {
      "core": [
        "家长质疑",
        "不信任",
        "觉得我针对"
      ],
      "expanded": [
        "说我偏心",
        "不相信老师"
      ],
      "exclude": [],
      "category": "信任薄弱",
      "scale": "家长分型与沟通策略评估",
      "tool": "承诺兑现清单",
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "家校信任关系薄弱"
    }
  ],
  "defaultLevelName": "A 级常规沟通",
  "defaultMessage": "当前家校关系状况良好，可按常规节奏沟通。保持日常的正向接触，让角色边界持续有储备。"
}
