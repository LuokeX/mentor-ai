import type { WizardInput } from '../../shared/business-wizard'

// class_system 模块向导输入（v4.0.0 打样数据，业务填写向导 → 编译生成 test-data 与库内三库）
export const CLASS_SYSTEM_WIZARD_INPUT: WizardInput = {
  "module": "class_system",
  "version": "4.0.0",
  "sourceRef": "班级系统建设手册v1",
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
    "redLineActions": "停止常规建议输出；提示转入学生个体问题模块；通知年级组长；记录安全事件",
    "redLineRecovery": "完成全班关系筛查且年级组长确认无欺凌情形",
    "redLineOwner": "年级组长"
  },
  "computedVariables": [
    {
      "name": "系统均分",
      "scale": "班级五系统速评",
      "expression": "均分"
    }
  ],
  "optionGroups": [],
  "scales": [
    {
      "name": "班级五系统速评",
      "role": "入口筛查",
      "shortName": "五系统速评",
      "description": "每个系统三道题，定位当前最需要建设的班级子系统。反向计分：得分越高表示越薄弱。",
      "minutes": 5,
      "prerequisites": [],
      "exclusives": [],
      "triggerConditions": [],
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "目标系统",
          "calcMethod": "mean",
          "weight": 1,
          "description": "目标系统维度",
          "highInterpretation": "目标未被学生理解或未转化为可观察里程碑",
          "lowInterpretation": "目标清晰且已落地"
        },
        {
          "name": "权力系统",
          "calcMethod": "mean",
          "weight": 1,
          "description": "权力系统维度",
          "highInterpretation": "岗位职责不清，事务集中在教师身上",
          "lowInterpretation": "学生分工稳定运转"
        },
        {
          "name": "情感系统",
          "calcMethod": "mean",
          "weight": 1,
          "description": "情感系统维度",
          "highInterpretation": "活动脱离学生真实需要且缺少复盘",
          "lowInterpretation": "活动有回应、有复盘"
        },
        {
          "name": "规范系统",
          "calcMethod": "mean",
          "weight": 1,
          "description": "规范系统维度",
          "highInterpretation": "规则停留在墙上，混乱后难以恢复",
          "lowInterpretation": "环境与规则支持秩序"
        },
        {
          "name": "关系系统",
          "calcMethod": "mean",
          "weight": 1,
          "description": "关系系统维度",
          "highInterpretation": "冲突难以修复，缺少同伴互助",
          "lowInterpretation": "关系稳定，学生被听见"
        }
      ],
      "questions": [
        {
          "text": "学生清楚本班共同目标以及为什么要实现它。",
          "dimension": "目标系统",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "班级目标已转化为本学期可观察的里程碑。",
          "dimension": "目标系统",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "日常活动和评价与班级目标保持一致。",
          "dimension": "目标系统",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "班干部岗位职责清楚且能稳定运转。",
          "dimension": "权力系统",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "班级事务能够由学生参与分工，而非全部由教师承担。",
          "dimension": "权力系统",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "班级日常关键节点有明确的执行流程。",
          "dimension": "权力系统",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "班级活动能够回应学生真实需要。",
          "dimension": "情感系统",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "活动结束后会进行简短复盘并形成改进。",
          "dimension": "情感系统",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "多数学生都有参与和承担责任的机会。",
          "dimension": "情感系统",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "班级空间和信息布置能够支持秩序与学习。",
          "dimension": "规范系统",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "班级规则由师生共同理解而非只贴在墙上。",
          "dimension": "规范系统",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "出现混乱时能够快速恢复稳定节奏。",
          "dimension": "规范系统",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "学生普遍感到被尊重、被听见。",
          "dimension": "关系系统",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "学生冲突能够被及时处理并修复关系。",
          "dimension": "关系系统",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "班级中存在稳定的互助和同伴支持。",
          "dimension": "关系系统",
          "optionGroup": "AGREE_5",
          "reverse": true
        }
      ]
    },
    {
      "name": "班级能量场问卷",
      "role": "深度诊断",
      "shortName": "能量场",
      "description": "五大系统整体偏弱、或师生关系维度突出时，再往下测班级能量场",
      "minutes": 4,
      "frequency": "per_case",
      "prerequisites": [
        "班级五系统速评"
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
          "target": "关系系统",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "或"
        }
      ],
      "triggerNote": "五大系统整体偏弱、或师生关系维度突出时，再往下测班级能量场",
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "秩序能量",
          "calcMethod": "mean",
          "weight": 1,
          "description": "秩序能量维度",
          "highInterpretation": "秩序需要教师持续在场维持",
          "lowInterpretation": "秩序可自主维持"
        },
        {
          "name": "学习能量",
          "calcMethod": "mean",
          "weight": 1,
          "description": "学习能量维度",
          "highInterpretation": "学习投入依赖外部推动",
          "lowInterpretation": "学习氛围自发"
        },
        {
          "name": "联结能量",
          "calcMethod": "mean",
          "weight": 1,
          "description": "联结能量维度",
          "highInterpretation": "学生之间缺少正向联结",
          "lowInterpretation": "同伴联结紧密"
        }
      ],
      "questions": [
        {
          "text": "我不在教室时，班级秩序仍能维持。",
          "dimension": "秩序能量",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "课间到上课的过渡不需要我反复提醒。",
          "dimension": "秩序能量",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "多数学生在自习时能自主投入。",
          "dimension": "学习能量",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "学生会主动追问自己不懂的问题。",
          "dimension": "学习能量",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "学生之间会自发互相帮助。",
          "dimension": "联结能量",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "新转入的学生能较快融入集体。",
          "dimension": "联结能量",
          "optionGroup": "AGREE_5",
          "reverse": true
        }
      ]
    },
    {
      "name": "堰塞湖四信号自查",
      "role": "专项/情境",
      "shortName": "堰塞湖自查",
      "description": "班级层面预警自查：情绪、冲突、需求、声音四类信号被截断时，问题会在水面下蓄积，最终以突发方式爆发。信号频率越高越需要及时疏解。",
      "minutes": 3,
      "frequency": "per_case",
      "prerequisites": [
        "班级五系统速评"
      ],
      "exclusives": [],
      "triggerConditions": [
        {
          "targetType": "average",
          "target": "",
          "comparator": "达到或超过",
          "value": 3.2,
          "join": "且"
        }
      ],
      "triggerNote": "五系统速评均分 ≥ 3.2 时建议做一次堰塞湖自查，排查班级是否有被截断的信号",
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "截断信号",
          "calcMethod": "mean",
          "weight": 1,
          "description": "四类截断信号的总体频率，越高越接近爆发临界",
          "highInterpretation": "信号频繁被截断，堰塞湖蓄积风险高",
          "lowInterpretation": "信号有正常表达出口"
        }
      ],
      "questions": [
        {
          "text": "最近两周，班级里学生或家长的情绪被反复压制、没有表达出口的频率？",
          "dimension": "截断信号",
          "optionGroup": "FREQ_5",
          "reverse": false
        },
        {
          "text": "最近两周，班级冲突被掩盖或回避、没有正式解决路径的频率？",
          "dimension": "截断信号",
          "optionGroup": "FREQ_5",
          "reverse": false
        },
        {
          "text": "最近两周，学生或家长的真实需求提出后长期得不到回应的频率？",
          "dimension": "截断信号",
          "optionGroup": "FREQ_5",
          "reverse": false
        },
        {
          "text": "最近两周，班级里部分学生的声音完全听不到、被边缘化的频率？",
          "dimension": "截断信号",
          "optionGroup": "FREQ_5",
          "reverse": false
        }
      ]
    },
    {
      "name": "大型活动组织专项评估",
      "role": "专项/情境",
      "description": "班级组织大型活动（运动会、汇演、外出实践等）前的专项评估。",
      "minutes": 6,
      "prerequisites": [
        "班级五系统速评"
      ],
      "triggerConditions": [
        {
          "targetType": "dimension",
          "target": "权力系统",
          "comparator": "达到或超过",
          "value": 3.2,
          "join": "且"
        }
      ],
      "triggerNote": "权力系统维度偏高时才需要做大型活动专项评估",
      "questions": [
        {
          "text": "活动目标在开始前已经明确传达给所有参与者。",
          "dimension": "组织分工",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "各岗位分工在活动前已经落实到具体的人。",
          "dimension": "组织分工",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "活动现场的秩序基本由既定规则维持。",
          "dimension": "秩序系统",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "参与者对活动流程的熟悉程度足够。",
          "dimension": "秩序系统",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "活动中的突发情况能在现场快速处理。",
          "dimension": "秩序系统",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "活动结束后有复盘和资料归档。",
          "dimension": "组织分工",
          "optionGroup": "AGREE_5",
          "reverse": false
        }
      ]
    }
  ],
  "attributions": [
    {
      "name": "目标系统未落地",
      "description": "班级目标没有被学生理解，或没有转化为可观察的阶段性成果。",
      "highSign": "学生说不出班级目标；目标只贴在墙上",
      "typicalTrigger": "目标由教师单方面制定且缺少里程碑拆解",
      "action": "把本学期目标拆成三个可观察的里程碑，与学生共同确认第一个",
      "weight": 1.1,
      "tags": [
        "class_system",
        "goal"
      ]
    },
    {
      "name": "权力系统缺位",
      "description": "班级事务过度集中在教师身上，学生岗位职责不清或无法稳定运转。",
      "highSign": "所有事都要教师亲自过问；班干部形同虚设",
      "typicalTrigger": "岗位设置缺少职责说明和交接流程",
      "action": "选一个日常事务，写清责任人、执行步骤、异常处理和复盘时间，试行一周",
      "weight": 1.2,
      "tags": [
        "class_system",
        "org"
      ]
    },
    {
      "name": "情感系统空转",
      "description": "班级活动没有回应学生真实需要，或缺少复盘导致无法沉淀。",
      "highSign": "活动办完就结束，学生参与度低",
      "typicalTrigger": "活动主题由教师指定且无复盘环节",
      "action": "在下一次活动后加一个十分钟复盘，让学生说出一个保留动作和一个调整动作",
      "weight": 1,
      "tags": [
        "class_system",
        "activity"
      ]
    },
    {
      "name": "规范系统薄弱",
      "description": "班级规则和空间布置无法支撑稳定的学习秩序。",
      "highSign": "规则只贴在墙上；混乱后难以恢复",
      "typicalTrigger": "规则由教师单方制定，缺少共同理解",
      "action": "挑一条最常被违反的规则，和学生一起重新表述成可观察的行为标准",
      "weight": 1,
      "tags": [
        "class_system",
        "environment"
      ]
    },
    {
      "name": "关系系统受损",
      "description": "学生之间的冲突难以修复，缺少稳定的同伴支持结构。",
      "highSign": "冲突反复发生；存在被孤立的学生",
      "typicalTrigger": "缺少冲突处理流程和同伴互助机制",
      "action": "建立一个固定的冲突修复流程，并在下一次冲突时完整走一遍",
      "weight": 1.3,
      "tags": [
        "class_system",
        "relation"
      ]
    },
    {
      "name": "堰塞湖蓄积风险",
      "description": "情绪、冲突、需求、声音四类信号被截断，问题在水面下蓄积，存在突发爆发的风险。",
      "highSign": "班级表面平静但氛围压抑；小事突然引爆；部分学生长期沉默",
      "typicalTrigger": "缺少情绪出口、冲突解决路径、需求回应机制和公平的表达通道",
      "action": "本周内为被截断的信号打开一个具体出口（情绪疏导会/冲突修复/需求征集/声音通道），并在两周内复评",
      "weight": 1.5,
      "tags": [
        "class_system",
        "warning",
        "dam"
      ]
    }
  ],
  "evidences": [
    {
      "attribution": "目标系统未落地",
      "scale": "班级五系统速评",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "目标系统",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "目标系统得分处于高位，目标未被学生理解或未落地"
    },
    {
      "attribution": "目标系统未落地",
      "scale": "班级五系统速评",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "目标系统",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "目标系统存在待建设的环节"
    },
    {
      "attribution": "权力系统缺位",
      "scale": "班级五系统速评",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "权力系统",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "权力系统得分处于高位，事务过度集中在教师身上"
    },
    {
      "attribution": "权力系统缺位",
      "scale": "班级五系统速评",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "权力系统",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "权力系统存在待建设的环节"
    },
    {
      "attribution": "情感系统空转",
      "scale": "班级五系统速评",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "情感系统",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "情感系统得分处于高位，活动缺少回应与复盘"
    },
    {
      "attribution": "情感系统空转",
      "scale": "班级五系统速评",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "情感系统",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "情感系统存在待建设的环节"
    },
    {
      "attribution": "规范系统薄弱",
      "scale": "班级五系统速评",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "规范系统",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "规范系统得分处于高位，秩序难以自主恢复"
    },
    {
      "attribution": "规范系统薄弱",
      "scale": "班级五系统速评",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "规范系统",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "规范系统存在待建设的环节"
    },
    {
      "attribution": "关系系统受损",
      "scale": "班级五系统速评",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "关系系统",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 3,
      "description": "关系系统得分处于高位，冲突难以修复"
    },
    {
      "attribution": "关系系统受损",
      "scale": "班级五系统速评",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "关系系统",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "关系系统存在待建设的环节"
    },
    {
      "attribution": "规范系统薄弱",
      "scale": "班级能量场问卷",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "秩序能量",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "能量场问卷显示秩序需要教师持续在场维持"
    },
    {
      "attribution": "权力系统缺位",
      "scale": "班级能量场问卷",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "秩序能量",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "秩序对教师在场的依赖提示权力系统缺位"
    },
    {
      "attribution": "关系系统受损",
      "scale": "班级能量场问卷",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "联结能量",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "能量场问卷显示学生之间缺少正向联结"
    },
    {
      "attribution": "情感系统空转",
      "scale": "班级能量场问卷",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "学习能量",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "学习投入依赖外部推动，活动未能激发内驱"
    },
    {
      "attribution": "堰塞湖蓄积风险",
      "scale": "堰塞湖四信号自查",
      "conditions": [
        {
          "targetType": "question",
          "target": "1",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "情绪被反复压制，缺少表达出口"
    },
    {
      "attribution": "堰塞湖蓄积风险",
      "scale": "堰塞湖四信号自查",
      "conditions": [
        {
          "targetType": "question",
          "target": "2",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "冲突被掩盖或回避，缺少正式解决路径"
    },
    {
      "attribution": "堰塞湖蓄积风险",
      "scale": "堰塞湖四信号自查",
      "conditions": [
        {
          "targetType": "question",
          "target": "3",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "需求提出后长期得不到回应"
    },
    {
      "attribution": "堰塞湖蓄积风险",
      "scale": "堰塞湖四信号自查",
      "conditions": [
        {
          "targetType": "question",
          "target": "4",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "部分学生的声音完全听不到"
    }
  ],
  "levels": [
    {
      "name": "危机干预",
      "redLine": true,
      "scale": "班级五系统速评",
      "conditions": [
        {
          "targetType": "average",
          "target": "",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "teacherMessage": "班级整体信号已达到危机水平，常规建设手段已不足以应对。请立即联系年级组长与心理专员，暂停非必要的活动安排。",
      "redLineAction": "联系年级组长与心理专员，暂停非必要活动",
      "notificationTemplate": "[教师姓名]老师在班级系统评估中触发红线，请尽快登录系统查看处置要求。",
      "resultNote": "班级系统整体处于危机水平，需立即干预"
    },
    {
      "name": "秩序奠基",
      "conditions": [
        {
          "targetType": "average",
          "target": "",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "teacherMessage": "班级各系统信号整体偏弱，处于「秩序奠基」阶段。建议先稳住基本秩序，从推荐工具中选一项本周落地。",
      "resultNote": "均分 ≥ 4 分：班级系统信号弱，处于秩序奠基期"
    },
    {
      "name": "关系激活",
      "conditions": [
        {
          "targetType": "average",
          "target": "",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "teacherMessage": "班级正在从「秩序奠基」走向「关系激活」，信号集中在「${主要归因}」。建议重点建设师生与同伴联结，两周后复评。",
      "resultNote": "均分 ≥ 3.5 分：班级处于关系激活期"
    },
    {
      "name": "制度自转",
      "conditions": [
        {
          "targetType": "average",
          "target": "",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "teacherMessage": "班级已进入「制度自转」，事务分工与规则开始自主运转。建议把个别化做法沉淀为可复用机制，两周后复评。",
      "resultNote": "均分 ≥ 3 分：班级处于制度自转期"
    }
  ],
  "tools": [
    {
      "name": "班级目标里程碑拆解表",
      "attributions": [
        "目标系统未落地"
      ],
      "whenToUse": "学生说不出班级目标，或目标只停留在口号",
      "steps": [
        "和学生一起用一句话说清本学期班级要成为什么样",
        "把这句话拆成三个可观察的里程碑",
        "为第一个里程碑写清完成标准和检查时间",
        "贴在教室并每两周对照一次"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "我们这学期只做好一件事，你们觉得应该是哪一件？",
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
      "script": "我们这学期只做好一件事，你们觉得应该是哪一件？",
      "prohibition": "不要由教师单方面宣布目标",
      "timePerSession": "一节班会",
      "duration": "每学期一次",
      "expectedEffect": "学生能复述目标和第一个里程碑",
      "effectNote": "把抽象目标转成可观察的阶段成果",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "目标系统"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "班级系统建设手册 第2章",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "随机抽问三名学生能说出目标",
      "failureCriteria": "两周后仍无人能复述",
      "contraindications": []
    },
    {
      "name": "班级事务 SOP 卡",
      "attributions": [
        "权力系统缺位"
      ],
      "whenToUse": "班级事务过度集中在教师身上",
      "steps": [
        "选一个每天都发生的事务（如晨检、放学清扫）",
        "写清责任人、执行步骤、异常处理和复盘时间",
        "让学生试运行三天，教师只观察不介入",
        "第四天复盘，只调整卡住的那一步"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "这件事从明天起由你负责，遇到处理不了的情况再来找我。",
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
      "script": "这件事从明天起由你负责，遇到处理不了的情况再来找我。",
      "prohibition": "不要同时铺开多个 SOP；一次只做一项",
      "timePerSession": "30 分钟",
      "duration": "每两周新增一项",
      "expectedEffect": "该事务连续一周无需教师介入",
      "effectNote": "把日常事务转成学生可独立执行的流程",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "权力系统"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "班级系统建设手册 第3章",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "连续 5 天无需教师提醒",
      "failureCriteria": "试运行三天内出现两次以上中断",
      "contraindications": []
    },
    {
      "name": "十分钟班级微复盘",
      "attributions": [
        "情感系统空转",
        "堰塞湖蓄积风险"
      ],
      "whenToUse": "活动办完就结束，经验无法沉淀",
      "steps": [
        "活动结束当天，留出十分钟",
        "每人说一个「下次要保留的动作」",
        "每人说一个「下次要调整的动作」",
        "教师只记录不评价，把结果贴在班级角"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "今天我们只讨论一件事：哪个环节帮助大家更稳定，哪个环节明天需要调整。",
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
      "script": "今天我们只讨论一件事：哪个环节帮助大家更稳定，哪个环节明天需要调整。",
      "prohibition": "教师不要在复盘中先发表意见",
      "timePerSession": "10 分钟",
      "duration": "每次活动后",
      "expectedEffect": "形成至少两条下次可执行的改进",
      "effectNote": "把活动经验转成可重复的改进",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "情感系统"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "班级系统建设手册 第4章",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "产出 >= 2 条具体改进",
      "failureCriteria": "学生只说「挺好的」",
      "contraindications": []
    },
    {
      "name": "规则共构工作坊",
      "attributions": [
        "规范系统薄弱",
        "堰塞湖蓄积风险"
      ],
      "whenToUse": "规则只贴在墙上，学生不认同",
      "steps": [
        "挑一条最常被违反的规则",
        "让学生说出这条规则存在的理由，教师补充缺失的部分",
        "一起把规则改写成可观察的行为描述",
        "约定试行两周后复盘"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "这条规则不是为了限制大家，而是为了让学习和相处更可预期。我们先试行三天再复盘。",
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
      "script": "这条规则不是为了限制大家，而是为了让学习和相处更可预期。我们先试行三天再复盘。",
      "prohibition": "不要一次重构全部规则",
      "timePerSession": "一节班会",
      "duration": "每月一条",
      "expectedEffect": "该规则违反次数下降 50% 以上",
      "effectNote": "把规则从教师要求转成共同约定",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "规范系统"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "班级系统建设手册 第5章",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "两周内违反次数明显下降",
      "failureCriteria": "两周后无变化",
      "contraindications": []
    },
    {
      "name": "冲突修复四步法",
      "attributions": [
        "关系系统受损",
        "堰塞湖蓄积风险"
      ],
      "whenToUse": "学生冲突反复发生且难以修复",
      "steps": [
        "分开双方，各自说清「发生了什么」，只说事实",
        "各自说「我当时的感受」，不评价对方",
        "各自说「我希望接下来怎样」",
        "共同确认一个可执行的下一步，并约定检查时间"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "我们先不讨论谁对谁错，先把事实说清楚。",
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
      "severity": "high",
      "evidenceLevel": "A",
      "script": "我们先不讨论谁对谁错，先把事实说清楚。",
      "prohibition": "不要在全班面前处理个体冲突",
      "timePerSession": "20 分钟",
      "duration": "按需",
      "expectedEffect": "同类冲突复发率下降",
      "effectNote": "建立可重复的冲突处理流程",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "关系系统"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "修复式实践在班级管理中的应用",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "双方均能说出对方的诉求",
      "failureCriteria": "任一方拒绝进入流程",
      "contraindications": [
        {
          "condition": "冲突涉及肢体伤害或欺凌",
          "type": "block",
          "description": "涉及安全事件须优先启动应急流程而非同伴调解",
          "alternative": "启动校园安全应急预案并通知年级组长"
        }
      ]
    },
    {
      "name": "同伴互助配对表",
      "attributions": [
        "关系系统受损"
      ],
      "whenToUse": "班级缺少稳定的同伴支持结构",
      "steps": [
        "按学习和性格互补原则做两两配对",
        "给每对一个具体的互助任务，如每天互查作业",
        "每周收一次简短反馈，只问「这周互相帮到了什么」",
        "两周后按反馈调整配对"
      ],
      "stepDetails": [
        {
          "keyTip": "这一步决定后面能不能走下去",
          "scriptTemplate": "你们两个这周互相提醒一下，周五我来听听你们互相帮到了什么。",
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
      "evidenceLevel": "C",
      "script": "你们两个这周互相提醒一下，周五我来听听你们互相帮到了什么。",
      "prohibition": "不要把配对当成优生帮差生的单向安排",
      "timePerSession": "20 分钟",
      "duration": "每月调整一次",
      "expectedEffect": "被孤立学生数量下降",
      "effectNote": "建立可持续的同伴互助关系",
      "outputArtifact": "一次执行记录",
      "collaborativeTools": [],
      "dimensions": [
        "关系系统"
      ],
      "reAssessmentIntervalDays": 30,
      "evidenceSource": "同伴支持机制实务",
      "crossModuleTags": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "preparation": "准备记录表",
      "materials": "记录表",
      "outcomeIndicator": "80% 配对能说出互助内容",
      "failureCriteria": "半数配对无实际互动",
      "contraindications": []
    }
  ],
  "keywords": [
    {
      "core": [
        "班级乱",
        "管不住",
        "纪律差"
      ],
      "expanded": [
        "课堂混乱",
        "说话没人听"
      ],
      "exclude": [],
      "category": "秩序问题",
      "scale": "班级五系统速评",
      "tool": "规则共构工作坊",
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "教师表达班级秩序失控"
    },
    {
      "core": [
        "班干部",
        "岗位",
        "分工"
      ],
      "expanded": [
        "没人干活",
        "都要我自己来"
      ],
      "exclude": [],
      "category": "组织问题",
      "scale": "班级五系统速评",
      "tool": "班级事务 SOP 卡",
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "教师表达班级事务过度集中"
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
      "exclude": [],
      "category": "关系冲突",
      "scale": "班级能量场问卷",
      "tool": "冲突修复四步法",
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "班级内出现同伴冲突"
    },
    {
      "core": [
        "被孤立",
        "没朋友",
        "不合群"
      ],
      "expanded": [
        "没人跟他玩",
        "排挤"
      ],
      "exclude": [],
      "category": "同伴排斥",
      "scale": "班级能量场问卷",
      "tool": "同伴互助配对表",
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "出现学生被孤立的信号"
    }
  ],
  "defaultLevelName": "文化引领",
  "defaultMessage": "班级已进入「文化引领」阶段，各系统自主运转，保持现有节奏、关注文化建设即可。"
}
