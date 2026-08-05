import type { WizardInput } from '../../shared/business-wizard'

// home_school 模块向导输入（v4.2.0：评估量表V2.0 30 题六维 + 红线检查 R1-R8 + 六维归因 + 五级干预体系）
// 业务素材：docs/家校沟通与合作test0730-AI入口/（评估量表V2.0 / 归因库 / 干预方案库 / 关联关系表）
// 计分方向：V2.0 量表为正向计分（评分越高=家校关系越健康），与旧版 v4.0.0 反向语义相反，reverse 全部不设。
export const HOME_SCHOOL_WIZARD_INPUT: WizardInput = {
  "module": "home_school",
  "version": "4.2.0",
  "sourceRef": "家校沟通与合作test0730-AI入口（评估量表V2.0/归因库/干预方案库/关联关系表）",
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
    "redLineRecovery": "经学校危机响应组评估确认风险解除后",
    "redLineOwner": "德育主任"
  },
  "computedVariables": [
    {
      "name": "沟通健康均分",
      "scale": "家校沟通六维评估",
      "expression": "均分"
    }
  ],
  "optionGroups": [],
  "scales": [
    {
      "name": "家校沟通六维评估",
      "role": "入口筛查",
      "shortName": "六维评估",
      "description": "面向班主任/年级组的六维诊断评估（评估量表V2.0）：沟通质量、角色边界、教育一致性、信任关系、参与效能、危机响应，每维 5 题共 30 题。正向计分：评分越高=家校关系越健康；常模参考均分 4.0，低于常模需关注。",
      "minutes": 10,
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
          "description": "双向性/及时性：信息能否顺畅及时触达并得到确认",
          "highInterpretation": "建立稳定固定的沟通渠道与联系节奏，重要信息送达有确认流程",
          "lowInterpretation": "信息传递滞后或失真，家长被动等待通知，沟通氛围紧张、问题被掩盖",
          "normMean": 4
        },
        {
          "name": "角色边界",
          "calcMethod": "mean",
          "weight": 1,
          "description": "职责清晰度：家长是否越界打扰、过度介入、不守公共渠道规则",
          "highInterpretation": "沟通时段与响应预期明确，家校职责分工清晰，家长尊重教师专业空间",
          "lowInterpretation": "非工作时间频繁打扰，过度介入班级事务或替教师做决策，公开渠道发布越界言论",
          "normMean": 4
        },
        {
          "name": "教育一致性",
          "calcMethod": "mean",
          "weight": 1,
          "description": "价值观/规则协调：家校理念与规则是否一致、能否形成合力",
          "highInterpretation": "教育理念与规则充分对齐，分歧先私下达成共识，家庭配合有可操作指引",
          "lowInterpretation": "家校要求互相矛盾，家长在孩子面前否定教师，理念冲突导致学校安排无法落地",
          "normMean": 4
        },
        {
          "name": "信任关系",
          "calcMethod": "mean",
          "weight": 1,
          "description": "尊重/心理安全感：家长是否相信教师出于孩子利益做判断并履约",
          "highInterpretation": "以小事守信积累信任，重大事项透明告知，冲突时先确认善意动机",
          "lowInterpretation": "互相猜疑、任何举措都被解读为不怀好意，约定形同虚设，危机时对立激化",
          "normMean": 4
        },
        {
          "name": "参与效能",
          "calcMethod": "mean",
          "weight": 1,
          "description": "实际效果与感知：家长配合能否转化为实际教育行动并见到效果",
          "highInterpretation": "建议具体可执行有期限并约定反馈节点，对微小进步及时肯定，形成跟踪闭环",
          "lowInterpretation": "口头答应但无行动，问题反复出现，配合缺乏持续性与闭环，教师单方面费力",
          "normMean": 4
        },
        {
          "name": "危机响应",
          "calcMethod": "mean",
          "weight": 1,
          "description": "突发事件协同：危机时刻能否冷静理性配合处置、事后共同复盘",
          "highInterpretation": "提前约定危机联络人与应急流程，危机中先共情给确定性再谈事实，事后共同复盘",
          "lowInterpretation": "危机时情绪失控指责教师，拒绝配合处置或撒手不管，危机后无复盘、问题周期性重演",
          "normMean": 4
        }
      ],
      "questions": [
        {
          "text": "我与这位家长能够顺畅、及时地交流孩子的在校情况",
          "dimension": "沟通质量",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "这位家长会主动向我反馈孩子在家中的表现与变化",
          "dimension": "沟通质量",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "我与这位家长沟通时氛围轻松，双方都能坦诚表达",
          "dimension": "沟通质量",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "这位家长能够清晰表达自己对教育的期望与诉求",
          "dimension": "沟通质量",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "当我有重要信息需要传达时，能够确保有效送达并得到确认",
          "dimension": "沟通质量",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "这位家长能在合适的时间联系我，不打扰我的休息与非工作时间",
          "dimension": "角色边界",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "这位家长尊重我在教学与班级事务上的专业主导权",
          "dimension": "角色边界",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "这位家长能把握参与的尺度，不过度介入班级内部事务",
          "dimension": "角色边界",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "这位家长与我的交往保持恰当的职业距离，不越界",
          "dimension": "角色边界",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "这位家长理解并配合学校在家长群、家委会等渠道上的规则",
          "dimension": "角色边界",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "这位家长认同并接纳学校的教育理念与要求",
          "dimension": "教育一致性",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "这位家长尊重我的专业判断与教学决策",
          "dimension": "教育一致性",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "即使存在分歧，这位家长也能配合执行学校的统一安排",
          "dimension": "教育一致性",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "这位家长在孩子面前维护学校与教师的权威，不唱反调",
          "dimension": "教育一致性",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "这位家长在家庭教育中能与学校要求保持一致、形成合力",
          "dimension": "教育一致性",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "我信任这位家长在孩子教育上的判断力",
          "dimension": "信任关系",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "我相信这位家长会履行与学校达成的约定",
          "dimension": "信任关系",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "我认为这位家长诚实可靠、言出必行",
          "dimension": "信任关系",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "即使有分歧，我仍相信这位家长的出发点是为孩子好",
          "dimension": "信任关系",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "我相信这位家长会优先把孩子利益放在首位",
          "dimension": "信任关系",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "当我提出建议时，这位家长会积极回应而非敷衍",
          "dimension": "参与效能",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "这位家长能将我的反馈转化为实际的教育行动",
          "dimension": "参与效能",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "孩子出现问题时，这位家长能及时配合解决",
          "dimension": "参与效能",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "这位家长重视并采纳我给出的教育建议",
          "dimension": "参与效能",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "这位家长在家庭教育中的配合能见到实际改善效果",
          "dimension": "参与效能",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "当孩子出现突发状况时，这位家长能保持冷静、理性沟通",
          "dimension": "危机响应",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "这位家长在危机时刻愿意配合学校的处置安排",
          "dimension": "危机响应",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "这位家长不会在危机中情绪化地指责或推诿责任",
          "dimension": "危机响应",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "这位家长能在危机后与我共同复盘、落实预防措施",
          "dimension": "危机响应",
          "optionGroup": "AGREE_5"
        },
        {
          "text": "这位家长信任学校在危机处理中的专业性，不激化矛盾",
          "dimension": "危机响应",
          "optionGroup": "AGREE_5"
        }
      ]
    },
    {
      "name": "家校沟通红线检查",
      "role": "红线检查",
      "shortName": "红线检查",
      "description": "按干预方案库 R1-R8 红线清单逐项勾选（否=0/是=1），任一命中即触发五级危机干预熔断：停止常规方案，转危机响应流程。",
      "minutes": 2,
      "prerequisites": [
        "家校沟通六维评估"
      ],
      "exclusives": [],
      "triggerConditions": [
        {
          "targetType": "average",
          "target": "",
          "comparator": "低于或等于",
          "value": 4,
          "join": "且"
        }
      ],
      "triggerNote": "六维评估均分低于 4.0（出现风险迹象）时建议做红线检查，逐项核对 R 类红线；健康家庭可不做",
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "红线风险",
          "calcMethod": "sum",
          "weight": 1,
          "description": "R1-R8 红线命中项数，任一命中即触发五级危机干预",
          "highInterpretation": "命中红线项数越多，危机程度越高",
          "lowInterpretation": "未命中任何红线"
        }
      ],
      "questions": [
        {
          "text": "近期出现法律途径对抗（起诉、向主管部门举报等）",
          "dimension": "红线风险",
          "optionGroup": "YES_NO"
        },
        {
          "text": "学生出现自伤倾向或相关风险信号",
          "dimension": "红线风险",
          "optionGroup": "YES_NO"
        },
        {
          "text": "家长在公开媒体（网络平台、媒体等）发布攻击性内容",
          "dimension": "红线风险",
          "optionGroup": "YES_NO"
        },
        {
          "text": "家校夹击导致学生出现严重适应障碍",
          "dimension": "红线风险",
          "optionGroup": "YES_NO"
        },
        {
          "text": "家长对教师或学校人员发出人身安全威胁",
          "dimension": "红线风险",
          "optionGroup": "YES_NO"
        },
        {
          "text": "家校沟通已完全断绝（沟通渠道全部失效）",
          "dimension": "红线风险",
          "optionGroup": "YES_NO"
        },
        {
          "text": "家长提出强制转学或退学要求",
          "dimension": "红线风险",
          "optionGroup": "YES_NO"
        },
        {
          "text": "多名家长联合对学校施压",
          "dimension": "红线风险",
          "optionGroup": "YES_NO"
        }
      ]
    }
  ],
  "attributions": [
    {
      "name": "沟通质量薄弱",
      "description": "家校信息通道不畅：传递滞后或失真，重要事项无法及时触达家长，沟通氛围紧张、问题被掩盖。",
      "highSign": "重要信息送达无确认；家长被动等待通知，缺乏主动反馈；双方回避或防御性表达",
      "typicalTrigger": "缺少稳定固定的沟通渠道与联系节奏；教师很少主动发起正向沟通，只在出问题时联系",
      "action": "建立每周固定反馈节奏，重要信息送达需家长确认；先做一次与问题无关的正向接触，再谈需要讨论的问题",
      "weight": 1.1,
      "tags": [
        "home_school",
        "communication"
      ]
    },
    {
      "name": "角色边界问题",
      "description": "家长越界或分工不明：非工作时间频繁打扰、过度介入班级事务、公开渠道发布越界言论，教师边界被持续侵蚀。",
      "highSign": "非工作时间频繁联系；替教师做决策或过度参与教学；在家长群等公开空间发布越界言论",
      "typicalTrigger": "开学初未约定沟通时段、渠道与响应预期；家校职责分工不清，家长焦虑驱动越界代劳",
      "action": "与家长明确沟通时段、渠道与响应预期，厘清家校职责分工；越界时温和表达专业主导权，不越界也不让家长越界",
      "weight": 1.1,
      "tags": [
        "home_school",
        "boundary"
      ]
    },
    {
      "name": "教育一致性冲突",
      "description": "家校理念与规则冲突：要求互相矛盾，孩子在两端被拉扯；家长在孩子面前否定教师，学校安排难以落地。",
      "highSign": "家长在孩子面前唱反调；对学校既有安排公开质疑；理念分歧导致家庭配合缺位",
      "typicalTrigger": "开学初未就教育理念、规则与期望对齐；分歧处理不当升级为公开否定",
      "action": "出现分歧先私下沟通达成共识，再统一对孩子口径；为家长提供可操作的家庭配合指引，降低执行门槛",
      "weight": 1,
      "tags": [
        "home_school",
        "consistency"
      ]
    },
    {
      "name": "信任关系薄弱",
      "description": "家长不相信教师出于孩子利益做判断：互相猜疑、任何举措都被解读为不怀好意，约定形同虚设，危机时对立激化。",
      "highSign": "经常私下求证、预设恶意解读动机；家长不履约，约定形同虚设；任何建议都被质疑",
      "typicalTrigger": "过往承诺未兑现或信息不透明；冲突中双方归因偏差，把对方行为往最坏方向解读",
      "action": "选一件小事明确承诺并按时兑现，用可验证的行为重建信任；重大事项主动告知并说明缘由；冲突时先确认善意动机再处理问题",
      "weight": 1.3,
      "tags": [
        "home_school",
        "trust"
      ]
    },
    {
      "name": "参与效能不足",
      "description": "家长参与停留在口头：建议停留在纸面，问题反复出现，配合缺乏持续性与闭环，教师单方面费力难见效。",
      "highSign": "口头答应但无行动；孩子问题反复出现；家长参与度低，约定难以落实",
      "typicalTrigger": "建议大而泛、无期限无反馈节点；家长精力有限或对处理方式不认同",
      "action": "把建议拆到一周内能完成的最小动作，明确做什么、什么时候、怎么反馈；对微小进步及时肯定，建立家校配合跟踪闭环",
      "weight": 1,
      "tags": [
        "home_school",
        "cooperation"
      ]
    },
    {
      "name": "危机响应风险",
      "description": "危机协同能力不足：危机时情绪失控、指责推诿，拒绝配合处置或撒手不管，危机后无复盘、问题周期性重演，存在升级为 R 类红线（5级）的风险。",
      "highSign": "危机时情绪化指责或推诿；拒绝配合处置；危机后不参与复盘、预防措施不落地",
      "typicalTrigger": "未提前约定危机联络人与应急响应流程；家长对学校处置缺乏信任，危机中先对抗再沟通",
      "action": "提前与家长约定危机联络人与应急响应流程；危机中先共情、给确定性再谈事实与方案；事后共同复盘并沉淀预防措施",
      "weight": 1.3,
      "tags": [
        "home_school",
        "crisis"
      ]
    }
  ],
  "evidences": [
    {
      "attribution": "沟通质量薄弱",
      "scale": "家校沟通六维评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "沟通质量",
          "comparator": "低于或等于",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "沟通质量维度进入风险区间，信息通道不畅"
    },
    {
      "attribution": "沟通质量薄弱",
      "scale": "家校沟通六维评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "沟通质量",
          "comparator": "低于或等于",
          "value": 2,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "沟通质量维度明显偏低，信息通道严重不畅"
    },
    {
      "attribution": "角色边界问题",
      "scale": "家校沟通六维评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "角色边界",
          "comparator": "低于或等于",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "角色边界维度进入风险区间，越界或分工不明"
    },
    {
      "attribution": "角色边界问题",
      "scale": "家校沟通六维评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "角色边界",
          "comparator": "低于或等于",
          "value": 2,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "角色边界维度明显偏低，越界持续或角色错乱"
    },
    {
      "attribution": "教育一致性冲突",
      "scale": "家校沟通六维评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "教育一致性",
          "comparator": "低于或等于",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "教育一致性维度进入风险区间，理念或规则出现冲突"
    },
    {
      "attribution": "教育一致性冲突",
      "scale": "家校沟通六维评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "教育一致性",
          "comparator": "低于或等于",
          "value": 2,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "教育一致性维度明显偏低，理念深层冲突或公开否定"
    },
    {
      "attribution": "信任关系薄弱",
      "scale": "家校沟通六维评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "信任关系",
          "comparator": "低于或等于",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "信任关系维度进入风险区间，信任开始动摇"
    },
    {
      "attribution": "信任关系薄弱",
      "scale": "家校沟通六维评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "信任关系",
          "comparator": "低于或等于",
          "value": 2,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "信任关系维度明显偏低，信任崩塌、预设恶意"
    },
    {
      "attribution": "参与效能不足",
      "scale": "家校沟通六维评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "参与效能",
          "comparator": "低于或等于",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "参与效能维度进入风险区间，共同行动难以落实"
    },
    {
      "attribution": "参与效能不足",
      "scale": "家校沟通六维评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "参与效能",
          "comparator": "低于或等于",
          "value": 2,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "参与效能维度明显偏低，参与产生负效应"
    },
    {
      "attribution": "危机响应风险",
      "scale": "家校沟通六维评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "危机响应",
          "comparator": "低于或等于",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "危机响应维度进入风险区间，危机协同能力不足"
    },
    {
      "attribution": "危机响应风险",
      "scale": "家校沟通六维评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "危机响应",
          "comparator": "低于或等于",
          "value": 2,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "危机响应维度明显偏低，危机中对抗或推诿、存在升级红线风险"
    }
  ],
  "levels": [
    {
      "name": "5级·极重（危机干预）",
      "scale": "家校沟通红线检查",
      "conditions": [
        {
          "targetType": "question",
          "target": "1",
          "comparator": "达到或超过",
          "value": 1,
          "join": "或"
        },
        {
          "targetType": "question",
          "target": "2",
          "comparator": "达到或超过",
          "value": 1,
          "join": "或"
        },
        {
          "targetType": "question",
          "target": "3",
          "comparator": "达到或超过",
          "value": 1,
          "join": "或"
        },
        {
          "targetType": "question",
          "target": "4",
          "comparator": "达到或超过",
          "value": 1,
          "join": "或"
        },
        {
          "targetType": "question",
          "target": "5",
          "comparator": "达到或超过",
          "value": 1,
          "join": "或"
        },
        {
          "targetType": "question",
          "target": "6",
          "comparator": "达到或超过",
          "value": 1,
          "join": "或"
        },
        {
          "targetType": "question",
          "target": "7",
          "comparator": "达到或超过",
          "value": 1,
          "join": "或"
        },
        {
          "targetType": "question",
          "target": "8",
          "comparator": "达到或超过",
          "value": 1,
          "join": "或"
        }
      ],
      "redLine": true,
      "redLineAction": "班主任不再单独面对家长，只做信息汇总；保护学生与教师安全，控制信息传播；必要时联系法律顾问或警方",
      "teacherMessage": "本次评估触发 5 级·极重（危机干预）：R 类红线已命中，核心风险是「${主要归因}」。请立即启动危机响应组——校长/分管校长指挥，德育主任现场协调，心理团队全员介入；班主任不再单独面对家长，只做信息汇总；遵守不独处、全留痕、不升级三原则，保护安全优先、控制损害，必要时联系法律顾问或警方。",
      "resultNote": "R 类红线命中，已熔断转五级危机干预：保护安全优先，控制损害，班主任不单独应对。",
      "escalationTarget": "校长/分管校长（全系统应急响应）",
      "notificationTemplate": "[班级]家校沟通触发 5 级危机干预（R 类红线命中），班主任停止单独沟通，启动全系统应急响应。",
      "interventionTools": [
        "E 级保护通道操作卡"
      ],
      "interventionActions": [
        "停止教师单独沟通，班主任只做信息汇总",
        "保护学生与教师安全，控制信息传播",
        "全程留痕，必要时联系法律顾问或警方"
      ]
    },
    {
      "name": "4级·重度（强化干预）",
      "scale": "家校沟通六维评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "沟通质量",
          "comparator": "低于或等于",
          "value": 2,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "角色边界",
          "comparator": "低于或等于",
          "value": 2,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "教育一致性",
          "comparator": "低于或等于",
          "value": 2,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "信任关系",
          "comparator": "低于或等于",
          "value": 2,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "参与效能",
          "comparator": "低于或等于",
          "value": 2,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "危机响应",
          "comparator": "低于或等于",
          "value": 2,
          "join": "或"
        },
        {
          "targetType": "average",
          "target": "",
          "comparator": "低于或等于",
          "value": 2.5,
          "join": "或"
        }
      ],
      "redLine": false,
      "teacherMessage": "本次评估判为 4 级·重度（强化干预），主要归因是「${主要归因}」。请组建强化干预组：心理团队+德育主任+管理层多方协作，班主任作为信息枢纽但不再单独面对家长；每周一次多方协作会，BPS 深度归因并形成家校关系诊断报告，班主任容器状态纳入评估；全程留痕。",
      "resultNote": "多维度进入重度风险（4级），强化干预组接管：班主任不再单独应对，多方协作全程留痕。",
      "escalationCondition": "出现 R 类红线或连续两次 4 级",
      "escalationTarget": "德育主任/管理层",
      "reAssessTrigger": "2周后六维复评",
      "interventionTools": [
        "沟通容器修复计划",
        "事实边界记录表"
      ],
      "interventionActions": [
        "组建强化干预组（心理团队+德育主任+管理层），班主任不再单独面对家长",
        "每周一次多方协作会，产出家校关系诊断报告",
        "全程留痕，班主任容器状态每周评估"
      ]
    },
    {
      "name": "3级·中度（定向干预）",
      "scale": "家校沟通六维评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "沟通质量",
          "comparator": "低于或等于",
          "value": 3,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "角色边界",
          "comparator": "低于或等于",
          "value": 3,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "教育一致性",
          "comparator": "低于或等于",
          "value": 3,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "信任关系",
          "comparator": "低于或等于",
          "value": 3,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "参与效能",
          "comparator": "低于或等于",
          "value": 3,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "危机响应",
          "comparator": "低于或等于",
          "value": 3,
          "join": "或"
        },
        {
          "targetType": "average",
          "target": "",
          "comparator": "低于或等于",
          "value": 3,
          "join": "或"
        }
      ],
      "redLine": false,
      "teacherMessage": "本次评估判为 3 级·中度（定向干预），主要归因是「${主要归因}」。由心理教师主导专业介入，班主任负责日常执行，年级组长协调资源：先做 BPS 归因和容器评估，再走信任修复；处理重点不是先说服家长，而是先稳住情绪和事实边界。",
      "resultNote": "多维度进入中度风险（3级），心理教师+班主任+年级组长三方协同定向干预。",
      "escalationCondition": "连续两次 3 级或出现 O 类叠加",
      "escalationTarget": "心理教师/年级组长",
      "reAssessTrigger": "2周后六维复评",
      "interventionTools": [
        "先跟后带话术卡",
        "定期反馈节奏表"
      ],
      "interventionActions": [
        "心理教师主导 BPS 归因并评估容器状态，班主任提供日常观察数据",
        "由年级组长陪同完成一次家校沟通并记录沟通纪要",
        "每周固定反馈节奏，稳定信息通道"
      ]
    },
    {
      "name": "2级·轻度（普及干预）",
      "scale": "家校沟通六维评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "沟通质量",
          "comparator": "低于或等于",
          "value": 4,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "角色边界",
          "comparator": "低于或等于",
          "value": 4,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "教育一致性",
          "comparator": "低于或等于",
          "value": 4,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "信任关系",
          "comparator": "低于或等于",
          "value": 4,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "参与效能",
          "comparator": "低于或等于",
          "value": 4,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "危机响应",
          "comparator": "低于或等于",
          "value": 4,
          "join": "或"
        },
        {
          "targetType": "average",
          "target": "",
          "comparator": "低于或等于",
          "value": 3.6,
          "join": "或"
        }
      ],
      "redLine": false,
      "teacherMessage": "本次评估判为 2 级·轻度（普及干预），主要归因是「${主要归因}」。由班主任主导、年级组长支持：明确家校分工，用针对性沟通调整策略，修补信任小缺口；建立每周反馈节奏，跟进约定履行情况。",
      "resultNote": "家校关系出现轻度磨损（2级），班主任主导+年级组长支持，针对性沟通调整策略。",
      "escalationCondition": "连续两次 2 级或出现 O 类触发",
      "escalationTarget": "年级组长",
      "reAssessTrigger": "4周后六维复评",
      "interventionTools": [
        "最小请求约定法",
        "承诺兑现清单"
      ],
      "interventionActions": [
        "明确家校分工并签署三方协议，年级组长见证",
        "两周内完成一次针对性沟通，修补信任小缺口",
        "建立每周反馈节奏，跟进约定履行情况"
      ]
    },
    {
      "name": "红线检查通过",
      "scale": "家校沟通红线检查",
      "conditions": [
        {
          "targetType": "question",
          "target": "1",
          "comparator": "低于或等于",
          "value": 0,
          "join": "且"
        },
        {
          "targetType": "question",
          "target": "2",
          "comparator": "低于或等于",
          "value": 0,
          "join": "且"
        },
        {
          "targetType": "question",
          "target": "3",
          "comparator": "低于或等于",
          "value": 0,
          "join": "且"
        },
        {
          "targetType": "question",
          "target": "4",
          "comparator": "低于或等于",
          "value": 0,
          "join": "且"
        },
        {
          "targetType": "question",
          "target": "5",
          "comparator": "低于或等于",
          "value": 0,
          "join": "且"
        },
        {
          "targetType": "question",
          "target": "6",
          "comparator": "低于或等于",
          "value": 0,
          "join": "且"
        },
        {
          "targetType": "question",
          "target": "7",
          "comparator": "低于或等于",
          "value": 0,
          "join": "且"
        },
        {
          "targetType": "question",
          "target": "8",
          "comparator": "低于或等于",
          "value": 0,
          "join": "且"
        }
      ],
      "redLine": false,
      "teacherMessage": "红线检查未命中任何 R 类红线，当前未发现需要危机干预的信号，可按常规节奏继续家校沟通；保持留痕与定期评估，出现红线信号时立即复评。",
      "resultNote": "R1-R8 红线全部未命中，未触发危机熔断。",
      "escalationCondition": "任一 R 类红线命中",
      "escalationTarget": "危机响应组（全系统应急）",
      "reAssessTrigger": "出现红线信号时立即复评"
    }
  ],
  "tools": [
    {
      "name": "先跟后带话术卡",
      "attributions": [
        "角色边界问题"
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
        "沟通质量薄弱"
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
        "角色边界问题"
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
      "failureCriteria": "连续两次未完成（改用承诺兑现清单）",
      "contraindications": []
    },
    {
      "name": "定期反馈节奏表",
      "attributions": [
        "信任关系薄弱"
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
        "沟通质量"
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
        "危机响应风险"
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
      "scale": "家校沟通红线检查",
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
      "scale": "家校沟通六维评估",
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
      "scale": "家校沟通六维评估",
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
      "scale": "家校沟通六维评估",
      "tool": "承诺兑现清单",
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "家校信任关系薄弱"
    }
  ],
  "defaultLevelName": "1级·关注（基础预防）",
  "defaultMessage": "当前家校关系处于 1 级·关注水平：六维度均分健康，未触发分级干预，未命中 R 类红线。保持基础预防——每周固定反馈、主动分享正面信息、及时回应；每月做一次沟通质量自检，出现红线信号时立即复评。"
}