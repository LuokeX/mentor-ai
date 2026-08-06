// learning_problem 模块向导输入（v4.2.0）
// 数据来源：
//   1. docs/2026_07_27_家校沟通与合作-工具库、评估库、专业知识库0722/学习问题模块-工具库、评估库、专业知识库/
//      - 学习问题智能辅导系统-测量量表精华版.xlsx（量表 01-07、09 结果判读与路由、10 全量题项库）
//      - 学习问题智能辅导系统-工具库-更新版.xlsx（F/A/S/C/H 五阶段 57 个工具）
//      - 学习问题智能辅导系统-专业术语通俗解读.xlsx（49 条术语）
// 说明：量表 08（基础信息·访谈·家校表单）为结构化采集表单，未提炼为量表；
//       源文档中量表页的 F 编号与工具库 F 编号存在错位（学业情绪/依恋），以量表名称为准对接。
import type { WizardInput } from '../../shared/business-wizard'

export const LEARNING_PROBLEM_WIZARD_INPUT: WizardInput = {
  "module": "learning_problem",
  "version": "4.2.0",
  "sourceRef": "学习问题 2.0 三库文档（2026-07-27 版）",
  "defaults": {
    "schoolSection": "all",
    "targetAudience": "teacher",
    "formType": "observation",
    "triggerMethod": "manual",
    "frequency": "per_case",
    "resultVisibility": "teacher_only",
    "responsibleRole": "班主任",
    "dataSensitivity": "sensitive",
    "sourceType": "proprietary",
    "evidenceLevel": "B",
    "redLineScope": "module",
    "redLineActions": "停止常规建议输出；通知心理专员；记录事件",
    "redLineRecovery": "专业评估确认风险解除后",
    "redLineOwner": "心理专员"
  },
  "computedVariables": [],
  "optionGroups": [
    {
      "id": "SNAP_4",
      "name": "SNAP四点频率",
      "options": [
        {
          "label": "完全没有",
          "score": 0
        },
        {
          "label": "偶尔（每周1-2次）",
          "score": 1
        },
        {
          "label": "经常（每周3-4次）",
          "score": 2
        },
        {
          "label": "几乎每天",
          "score": 3
        }
      ]
    },
    {
      "id": "MOTIVE_7",
      "name": "动机七点认同",
      "options": [
        {
          "label": "完全不符合",
          "score": 1
        },
        {
          "label": "比较不符合",
          "score": 2
        },
        {
          "label": "有点不符合",
          "score": 3
        },
        {
          "label": "中立",
          "score": 4
        },
        {
          "label": "有点符合",
          "score": 5
        },
        {
          "label": "比较符合",
          "score": 6
        },
        {
          "label": "完全符合",
          "score": 7
        }
      ]
    },
    {
      "id": "RATING_5",
      "name": "课堂表现五点",
      "options": [
        {
          "label": "差",
          "score": 1
        },
        {
          "label": "较弱",
          "score": 2
        },
        {
          "label": "一般",
          "score": 3
        },
        {
          "label": "较好",
          "score": 4
        },
        {
          "label": "优",
          "score": 5
        }
      ]
    }
  ],
  "scales": [
    {
      "name": "SNAP-IV注意力筛查",
      "role": "入口筛查",
      "shortName": "SNAP-IV筛查",
      "description": "注意力与多动筛查量表（SNAP-IV 精华版），教师与家长双评，筛查注意缺陷/多动-冲动倾向，用于学校筛查而非临床诊断。",
      "minutes": 10,
      "prerequisites": [],
      "triggerConditions": [],
      "usageTiming": "低中段（1-2·3-4年级）筛查首选，5-6年级亦可",
      "reAssessmentIntervalDays": 30,
      "applicableGrades": [
        1,
        2,
        3,
        4,
        5,
        6
      ],
      "sourceType": "adapted",
      "formType": "observation",
      "postAssessmentActions": "阳性结果须结合深度访谈与课堂观察交叉核实，必要时转介专业机构评估",
      "contraindications": "量表仅作筛查预警，不作临床诊断；结论不能单独作为干预或转介依据",
      "dimensionDefs": [
        {
          "name": "注意缺陷",
          "calcMethod": "mean",
          "weight": 1,
          "description": "注意缺陷子量表（9题）",
          "highInterpretation": "注意缺陷阳性项≥6项（得分≥2）提示注意缺陷倾向",
          "lowInterpretation": "注意无明显缺陷信号"
        },
        {
          "name": "多动-冲动",
          "calcMethod": "mean",
          "weight": 1,
          "description": "多动-冲动子量表（9题）",
          "highInterpretation": "多动-冲动阳性项≥6项（得分≥2）提示多动-冲动倾向",
          "lowInterpretation": "无多动-冲动信号"
        }
      ],
      "questions": [
        {
          "text": "很难持续专注于功课或需要动脑的任务",
          "dimension": "注意缺陷",
          "optionGroup": "SNAP_4",
          "reverse": false
        },
        {
          "text": "别人对他说话时，似乎没在听",
          "dimension": "注意缺陷",
          "optionGroup": "SNAP_4",
          "reverse": false
        },
        {
          "text": "不按指示把事情做完（非对抗行为）",
          "dimension": "注意缺陷",
          "optionGroup": "SNAP_4",
          "reverse": false
        },
        {
          "text": "难以有条理地完成功课或活动",
          "dimension": "注意缺陷",
          "optionGroup": "SNAP_4",
          "reverse": false
        },
        {
          "text": "回避、不喜欢或勉强做需持续动脑的任务",
          "dimension": "注意缺陷",
          "optionGroup": "SNAP_4",
          "reverse": false
        },
        {
          "text": "遗失学习或活动所需的物品",
          "dimension": "注意缺陷",
          "optionGroup": "SNAP_4",
          "reverse": false
        },
        {
          "text": "容易被无关刺激分散注意力",
          "dimension": "注意缺陷",
          "optionGroup": "SNAP_4",
          "reverse": false
        },
        {
          "text": "日常生活中显得健忘",
          "dimension": "注意缺陷",
          "optionGroup": "SNAP_4",
          "reverse": false
        },
        {
          "text": "在细节上粗心，难以维持注意力",
          "dimension": "注意缺陷",
          "optionGroup": "SNAP_4",
          "reverse": false
        },
        {
          "text": "坐着手脚动个不停或在座位上扭动",
          "dimension": "多动-冲动",
          "optionGroup": "SNAP_4",
          "reverse": false
        },
        {
          "text": "在需要坐好的场合（教室）离开座位",
          "dimension": "多动-冲动",
          "optionGroup": "SNAP_4",
          "reverse": false
        },
        {
          "text": "在不合适的场合跑来跑去或爬上爬下",
          "dimension": "多动-冲动",
          "optionGroup": "SNAP_4",
          "reverse": false
        },
        {
          "text": "难以安静地玩耍或参加休闲活动",
          "dimension": "多动-冲动",
          "optionGroup": "SNAP_4",
          "reverse": false
        },
        {
          "text": "像被\"马达驱动\"一样停不下来",
          "dimension": "多动-冲动",
          "optionGroup": "SNAP_4",
          "reverse": false
        },
        {
          "text": "说话过多",
          "dimension": "多动-冲动",
          "optionGroup": "SNAP_4",
          "reverse": false
        },
        {
          "text": "问题尚未问完就抢着回答",
          "dimension": "多动-冲动",
          "optionGroup": "SNAP_4",
          "reverse": false
        },
        {
          "text": "难以按顺序等待（如排队）",
          "dimension": "多动-冲动",
          "optionGroup": "SNAP_4",
          "reverse": false
        },
        {
          "text": "打断或侵扰别人（插嘴、打扰游戏）",
          "dimension": "多动-冲动",
          "optionGroup": "SNAP_4",
          "reverse": false
        }
      ]
    },
    {
      "name": "学习策略量表",
      "role": "深度诊断",
      "shortName": "学习策略",
      "description": "学习策略量表（MAI/LASSI 精华版），评估认知策略与元认知策略使用水平，定位策略缺失点。",
      "minutes": 10,
      "prerequisites": [
        "SNAP-IV注意力筛查"
      ],
      "triggerConditions": [
        {
          "targetType": "dimension",
          "target": "注意缺陷",
          "comparator": "低于或等于",
          "value": 1.5,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "多动-冲动",
          "comparator": "低于或等于",
          "value": 1.5,
          "join": "且"
        }
      ],
      "triggerNote": "学生\"努力但效率低\"、不会预习复习、笔记差或元认知弱，且注意力问题不占主导时建议做",
      "usageTiming": "3-4·5-6年级为主；低段重习惯由教师/家长代评",
      "reAssessmentIntervalDays": 60,
      "applicableGrades": [
        3,
        4,
        5,
        6
      ],
      "sourceType": "adapted",
      "formType": "self_report",
      "targetAudience": "student",
      "postAssessmentActions": "结合学业成绩分析区分\"知识落差\"与\"策略落差\"，转入学科策略辅导",
      "dimensionDefs": [
        {
          "name": "认知-复述精细加工",
          "calcMethod": "mean",
          "weight": 1,
          "description": "复述与精细加工策略（4题）",
          "highInterpretation": "复述/精细加工策略缺失，靠死记硬背",
          "lowInterpretation": "有复述与精细加工策略"
        },
        {
          "name": "认知-组织",
          "calcMethod": "mean",
          "weight": 1,
          "description": "组织策略（4题）",
          "highInterpretation": "不会提纲/思维导图等组织策略",
          "lowInterpretation": "能有效组织信息"
        },
        {
          "name": "元认知-计划",
          "calcMethod": "mean",
          "weight": 1,
          "description": "计划策略（4题）",
          "highInterpretation": "学习前无目标无计划",
          "lowInterpretation": "学习前有计划"
        },
        {
          "name": "元认知-监控",
          "calcMethod": "mean",
          "weight": 1,
          "description": "监控策略（4题）",
          "highInterpretation": "边学边查意识弱，学完不知会不会",
          "lowInterpretation": "能自我监控理解"
        },
        {
          "name": "元认知-调节资源",
          "calcMethod": "mean",
          "weight": 1,
          "description": "调节与资源策略（4题）",
          "highInterpretation": "不会换方法、不求助、不用错题本",
          "lowInterpretation": "能调节方法善用资源"
        }
      ],
      "questions": [
        {
          "text": "我会通过反复朗读或抄写帮助记忆",
          "dimension": "认知-复述精细加工",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "我会用自己的话解释难点",
          "dimension": "认知-复述精细加工",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "我会把新知识和旧知识联系起来",
          "dimension": "认知-复述精细加工",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "我会举例子或打比方帮助理解",
          "dimension": "认知-复述精细加工",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "我会用提纲或思维导图整理内容",
          "dimension": "认知-组织",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "我会把材料分成几个部分来理解",
          "dimension": "认知-组织",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "我会抓住重点和关键词",
          "dimension": "认知-组织",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "我会比较不同内容的异同",
          "dimension": "认知-组织",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "学习前我会先想清楚目标和步骤",
          "dimension": "元认知-计划",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "我会为任务安排时间",
          "dimension": "元认知-计划",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "我会把大任务拆成小步骤",
          "dimension": "元认知-计划",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "我会预估完成任务需要的时间",
          "dimension": "元认知-计划",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "学习时我会检查自己是否走神",
          "dimension": "元认知-监控",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "阅读时我会边读边问自己懂没懂",
          "dimension": "元认知-监控",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "我会及时发现理解错误并回头重看",
          "dimension": "元认知-监控",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "我会根据难度调整学习方法",
          "dimension": "元认知-监控",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "学完我会自测是否真正掌握",
          "dimension": "元认知-调节资源",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "遇到困难我会换一种方法再试",
          "dimension": "元认知-调节资源",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "我会主动向老师或同学求助",
          "dimension": "元认知-调节资源",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "我会用错题本或复习资料巩固",
          "dimension": "元认知-调节资源",
          "optionGroup": "FREQ_5",
          "reverse": true
        }
      ]
    },
    {
      "name": "学习动机量表",
      "role": "深度诊断",
      "shortName": "学习动机",
      "description": "学习动机量表（SDT/AMS 精华版），区分自主动机（内在/认同）与外控动机，识别无动机风险。",
      "minutes": 5,
      "prerequisites": [
        "SNAP-IV注意力筛查"
      ],
      "triggerConditions": [
        {
          "targetType": "dimension",
          "target": "注意缺陷",
          "comparator": "低于或等于",
          "value": 1.5,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "多动-冲动",
          "comparator": "低于或等于",
          "value": 1.5,
          "join": "且"
        }
      ],
      "triggerNote": "学生厌学、被动学习、目标模糊或缺乏内驱力时建议做",
      "usageTiming": "5-6年级为主，动机问题高段突出；3-4年级亦可评估",
      "reAssessmentIntervalDays": 60,
      "applicableGrades": [
        3,
        4,
        5,
        6
      ],
      "sourceType": "adapted",
      "formType": "self_report",
      "targetAudience": "student",
      "postAssessmentActions": "无动机或外控动机明显时先点燃动力，再谈学习方法与策略",
      "dimensionDefs": [
        {
          "name": "内在动机",
          "calcMethod": "mean",
          "weight": 1,
          "description": "内在动机（3题）",
          "highInterpretation": "内在动机不足，学习完全依赖外部推动",
          "lowInterpretation": "有内在学习兴趣"
        },
        {
          "name": "认同调节",
          "calcMethod": "mean",
          "weight": 1,
          "description": "认同调节（3题）",
          "highInterpretation": "对学习价值认同不足",
          "lowInterpretation": "认同学习价值"
        },
        {
          "name": "外在调节",
          "calcMethod": "mean",
          "weight": 1,
          "description": "外在调节（3题）",
          "highInterpretation": "为奖励/惩罚而学，外控主导",
          "lowInterpretation": "外控压力小"
        },
        {
          "name": "无动机",
          "calcMethod": "mean",
          "weight": 1,
          "description": "无动机（3题）",
          "highInterpretation": "无动机明显，学习失去意义感",
          "lowInterpretation": "无明显无动机信号"
        }
      ],
      "questions": [
        {
          "text": "因为学习本身让我感到有趣",
          "dimension": "内在动机",
          "optionGroup": "MOTIVE_7",
          "reverse": true
        },
        {
          "text": "因为我喜欢探索新东西",
          "dimension": "内在动机",
          "optionGroup": "MOTIVE_7",
          "reverse": true
        },
        {
          "text": "因为解决难题让我有成就感",
          "dimension": "内在动机",
          "optionGroup": "MOTIVE_7",
          "reverse": true
        },
        {
          "text": "因为学习对我实现目标很重要",
          "dimension": "认同调节",
          "optionGroup": "MOTIVE_7",
          "reverse": true
        },
        {
          "text": "因为我想成为有知识有能力的人",
          "dimension": "认同调节",
          "optionGroup": "MOTIVE_7",
          "reverse": true
        },
        {
          "text": "因为掌握本领对将来有用",
          "dimension": "认同调节",
          "optionGroup": "MOTIVE_7",
          "reverse": true
        },
        {
          "text": "为了避免被批评或惩罚而学",
          "dimension": "外在调节",
          "optionGroup": "MOTIVE_7",
          "reverse": false
        },
        {
          "text": "为了获得奖励或表扬而学",
          "dimension": "外在调节",
          "optionGroup": "MOTIVE_7",
          "reverse": false
        },
        {
          "text": "因为家长/老师要求必须学",
          "dimension": "外在调节",
          "optionGroup": "MOTIVE_7",
          "reverse": false
        },
        {
          "text": "我不清楚学习到底有什么用",
          "dimension": "无动机",
          "optionGroup": "MOTIVE_7",
          "reverse": false
        },
        {
          "text": "学不学对我都无所谓",
          "dimension": "无动机",
          "optionGroup": "MOTIVE_7",
          "reverse": false
        },
        {
          "text": "我学不进去也懒得管",
          "dimension": "无动机",
          "optionGroup": "MOTIVE_7",
          "reverse": false
        }
      ]
    },
    {
      "name": "学业情绪量表",
      "role": "深度诊断",
      "shortName": "学业情绪",
      "description": "学业情绪量表（AEQ 精华版），评估积极/消极学业情绪，识别情绪性学习困难。",
      "minutes": 5,
      "prerequisites": [
        "SNAP-IV注意力筛查"
      ],
      "triggerConditions": [
        {
          "targetType": "dimension",
          "target": "注意缺陷",
          "comparator": "达到或超过",
          "value": 1.5,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "多动-冲动",
          "comparator": "达到或超过",
          "value": 1.5,
          "join": "且"
        }
      ],
      "triggerNote": "学生一提学习就烦、慌或怕，或与注意力问题同时出现时建议做",
      "usageTiming": "全学段，低段由教师/家长观察代评",
      "reAssessmentIntervalDays": 30,
      "applicableGrades": [
        1,
        2,
        3,
        4,
        5,
        6
      ],
      "sourceType": "adapted",
      "formType": "self_report",
      "targetAudience": "student",
      "postAssessmentActions": "消极情绪偏多时优先疏导情绪，情绪性困难常被误认为态度差",
      "dimensionDefs": [
        {
          "name": "积极情绪",
          "calcMethod": "mean",
          "weight": 1,
          "description": "积极情绪（享受/希望/自豪，6题）",
          "highInterpretation": "积极学业情绪不足",
          "lowInterpretation": "积极情绪充足"
        },
        {
          "name": "消极情绪",
          "calcMethod": "mean",
          "weight": 1,
          "description": "消极情绪（焦虑/无聊/羞耻，6题）",
          "highInterpretation": "消极情绪频繁，堵住学习",
          "lowInterpretation": "消极情绪少"
        }
      ],
      "questions": [
        {
          "text": "听懂课时我感到开心",
          "dimension": "积极情绪",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "解决难题让我愉悦",
          "dimension": "积极情绪",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "我相信自己能学好",
          "dimension": "积极情绪",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "我对进步充满期待",
          "dimension": "积极情绪",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "取得好成绩我为自己骄傲",
          "dimension": "积极情绪",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "掌握新技能我有成就感",
          "dimension": "积极情绪",
          "optionGroup": "FREQ_5",
          "reverse": true
        },
        {
          "text": "考试前我会紧张不安",
          "dimension": "消极情绪",
          "optionGroup": "FREQ_5",
          "reverse": false
        },
        {
          "text": "怕考不好让我担心",
          "dimension": "消极情绪",
          "optionGroup": "FREQ_5",
          "reverse": false
        },
        {
          "text": "上课时常觉得枯燥没意思",
          "dimension": "消极情绪",
          "optionGroup": "FREQ_5",
          "reverse": false
        },
        {
          "text": "觉得作业单调乏味",
          "dimension": "消极情绪",
          "optionGroup": "FREQ_5",
          "reverse": false
        },
        {
          "text": "成绩差时觉得自己不行",
          "dimension": "消极情绪",
          "optionGroup": "FREQ_5",
          "reverse": false
        },
        {
          "text": "出错时怕被同学笑话",
          "dimension": "消极情绪",
          "optionGroup": "FREQ_5",
          "reverse": false
        }
      ]
    },
    {
      "name": "依恋关系评估",
      "role": "深度诊断",
      "shortName": "依恋评估",
      "description": "依恋关系评估量表（IPPA 精简＋师生依恋观察），评估亲子依恋安全性，识别回避/矛盾/紊乱风险。",
      "minutes": 5,
      "prerequisites": [
        "SNAP-IV注意力筛查"
      ],
      "triggerConditions": [
        {
          "targetType": "dimension",
          "target": "注意缺陷",
          "comparator": "达到或超过",
          "value": 1.5,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "多动-冲动",
          "comparator": "达到或超过",
          "value": 1.5,
          "join": "且"
        }
      ],
      "triggerNote": "孩子不愿求助、情绪易波动、师生或亲子冲突较多时建议做",
      "usageTiming": "全学段，低中段重点看分离焦虑与求助回避",
      "reAssessmentIntervalDays": 60,
      "applicableGrades": [
        1,
        2,
        3,
        4,
        5,
        6
      ],
      "sourceType": "adapted",
      "formType": "observation",
      "postAssessmentActions": "判定为不安全依恋时优先修复亲子关系，再谈学业支持",
      "dimensionDefs": [
        {
          "name": "安全-亲近",
          "calcMethod": "mean",
          "weight": 1,
          "description": "亲近维度（3题）",
          "highInterpretation": "与父母亲近不足",
          "lowInterpretation": "与父母亲近良好"
        },
        {
          "name": "安全-依赖",
          "calcMethod": "mean",
          "weight": 1,
          "description": "依赖维度（3题）",
          "highInterpretation": "遇到困难不愿向父母求助",
          "lowInterpretation": "能安心依赖父母"
        },
        {
          "name": "安全-安全感",
          "calcMethod": "mean",
          "weight": 1,
          "description": "安全感维度（3题）",
          "highInterpretation": "对父母支持缺乏安全感",
          "lowInterpretation": "对父母有安全感"
        },
        {
          "name": "风险项",
          "calcMethod": "mean",
          "weight": 1,
          "description": "风险项（回避/矛盾/紊乱，3题）",
          "highInterpretation": "回避/矛盾/紊乱倾向明显",
          "lowInterpretation": "无显著风险信号"
        }
      ],
      "questions": [
        {
          "text": "遇到困难时愿意主动找父母说",
          "dimension": "安全-亲近",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "喜欢和父母一起做事情",
          "dimension": "安全-亲近",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "和父母分开一段时间后想念他们",
          "dimension": "安全-亲近",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "受委屈时找父母能平静下来",
          "dimension": "安全-依赖",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "做重要决定会参考父母意见",
          "dimension": "安全-依赖",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "在新环境会先看父母反应再行动",
          "dimension": "安全-依赖",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "我相信父母会支持我",
          "dimension": "安全-安全感",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "犯错后不怕被父母嫌弃",
          "dimension": "安全-安全感",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "我觉得父母是可靠的",
          "dimension": "安全-安全感",
          "optionGroup": "AGREE_5",
          "reverse": true
        },
        {
          "text": "有事宁愿憋着也不告诉父母",
          "dimension": "风险项",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "怕和父母亲近会受伤",
          "dimension": "风险项",
          "optionGroup": "AGREE_5",
          "reverse": false
        },
        {
          "text": "对父母的承诺将信将疑",
          "dimension": "风险项",
          "optionGroup": "AGREE_5",
          "reverse": false
        }
      ]
    },
    {
      "name": "课堂观察评定",
      "role": "专项/情境",
      "shortName": "课堂观察",
      "description": "课堂观察评定量表（CBRS 精简10维），班主任连续1-2周课堂观察的结构化评定。",
      "minutes": 5,
      "prerequisites": [
        "SNAP-IV注意力筛查"
      ],
      "triggerConditions": [
        {
          "targetType": "dimension",
          "target": "注意缺陷",
          "comparator": "达到或超过",
          "value": 1.5,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "多动-冲动",
          "comparator": "达到或超过",
          "value": 1.5,
          "join": "且"
        }
      ],
      "triggerNote": "需要连续 1-2 周观察课堂与课间行为、交叉核实筛查结果时建议做",
      "usageTiming": "全学段，低段行为观察权重更高；建议每周汇总一次",
      "reAssessmentIntervalDays": 30,
      "applicableGrades": [
        1,
        2,
        3,
        4,
        5,
        6
      ],
      "sourceType": "adapted",
      "formType": "observation",
      "responsibleRole": "班主任/学科教师",
      "postAssessmentActions": "任单维≤2 时重点干预，总均分<3 时持续观察并给予课堂支持",
      "dimensionDefs": [
        {
          "name": "课堂参与",
          "calcMethod": "mean",
          "weight": 1,
          "description": "课堂参与维度（3题）",
          "highInterpretation": "课堂投入、举手发言少",
          "lowInterpretation": "课堂参与积极"
        },
        {
          "name": "学业表现",
          "calcMethod": "mean",
          "weight": 1,
          "description": "学业表现维度（3题）",
          "highInterpretation": "听讲理解、笔记、作业提交弱",
          "lowInterpretation": "学业表现良好"
        },
        {
          "name": "社会情绪",
          "calcMethod": "mean",
          "weight": 1,
          "description": "社会情绪维度（4题）",
          "highInterpretation": "合作、守规、坚持、情绪稳定差",
          "lowInterpretation": "社会情绪良好"
        }
      ],
      "questions": [
        {
          "text": "课堂任务投入度",
          "dimension": "课堂参与",
          "optionGroup": "RATING_5",
          "reverse": true
        },
        {
          "text": "注意力持续性",
          "dimension": "课堂参与",
          "optionGroup": "RATING_5",
          "reverse": true
        },
        {
          "text": "主动举手/发言",
          "dimension": "课堂参与",
          "optionGroup": "RATING_5",
          "reverse": true
        },
        {
          "text": "听讲理解（跟得上进度）",
          "dimension": "学业表现",
          "optionGroup": "RATING_5",
          "reverse": true
        },
        {
          "text": "笔记/记录习惯",
          "dimension": "学业表现",
          "optionGroup": "RATING_5",
          "reverse": true
        },
        {
          "text": "同伴合作表现",
          "dimension": "社会情绪",
          "optionGroup": "RATING_5",
          "reverse": true
        },
        {
          "text": "遵守课堂规则",
          "dimension": "社会情绪",
          "optionGroup": "RATING_5",
          "reverse": true
        },
        {
          "text": "面对困难的坚持",
          "dimension": "社会情绪",
          "optionGroup": "RATING_5",
          "reverse": true
        },
        {
          "text": "情绪稳定性",
          "dimension": "社会情绪",
          "optionGroup": "RATING_5",
          "reverse": true
        },
        {
          "text": "作业按时提交",
          "dimension": "学业表现",
          "optionGroup": "RATING_5",
          "reverse": true
        }
      ]
    },
    {
      "name": "成绩趋势与学科诊断",
      "role": "专项/情境",
      "shortName": "成绩趋势",
      "description": "学业成绩趋势与学科诊断速查：记录近3次成绩、对比班级均值，自动标记薄弱/偏科/下滑。",
      "minutes": 5,
      "prerequisites": [
        "SNAP-IV注意力筛查"
      ],
      "triggerConditions": [
        {
          "targetType": "dimension",
          "target": "注意缺陷",
          "comparator": "低于或等于",
          "value": 1.5,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "多动-冲动",
          "comparator": "低于或等于",
          "value": 1.5,
          "join": "且"
        }
      ],
      "triggerNote": "学生出现成绩下滑、偏科或\"努力但成绩差\"时建议做",
      "usageTiming": "全学段；按学科录入近3次成绩与班级均值",
      "reAssessmentIntervalDays": 90,
      "applicableGrades": [
        1,
        2,
        3,
        4,
        5,
        6
      ],
      "formType": "checklist",
      "postAssessmentActions": "任一科第3次低于其他科均值≥15分标注偏科；≥3科连续下滑优先排查家庭/情绪因素",
      "dimensionDefs": [
        {
          "name": "薄弱学科",
          "calcMethod": "mean",
          "weight": 1,
          "description": "单科薄弱/偏科信号（5题）",
          "highInterpretation": "存在薄弱或偏科学科",
          "lowInterpretation": "无偏科信号"
        },
        {
          "name": "整体趋势",
          "calcMethod": "mean",
          "weight": 1,
          "description": "多科下滑系统性风险（1题）",
          "highInterpretation": "多科同时下滑，系统性风险",
          "lowInterpretation": "无系统性下滑"
        }
      ],
      "questions": [
        {
          "text": "语文近3次成绩低于班级均值或连续下滑",
          "dimension": "薄弱学科",
          "optionGroup": "YES_NO",
          "reverse": false
        },
        {
          "text": "数学近3次成绩低于班级均值或连续下滑",
          "dimension": "薄弱学科",
          "optionGroup": "YES_NO",
          "reverse": false
        },
        {
          "text": "英语近3次成绩低于班级均值或连续下滑",
          "dimension": "薄弱学科",
          "optionGroup": "YES_NO",
          "reverse": false
        },
        {
          "text": "科学/综合近3次成绩低于班级均值或连续下滑",
          "dimension": "薄弱学科",
          "optionGroup": "YES_NO",
          "reverse": false
        },
        {
          "text": "其他学科近3次成绩低于班级均值或连续下滑",
          "dimension": "薄弱学科",
          "optionGroup": "YES_NO",
          "reverse": false
        },
        {
          "text": "3科及以上连续下滑，存在系统性风险",
          "dimension": "整体趋势",
          "optionGroup": "YES_NO",
          "reverse": false
        }
      ]
    }
  ],
  "attributions": [
    {
      "name": "注意缺陷/多动冲动倾向",
      "description": "SNAP-IV 筛查显示注意缺陷或多动-冲动阳性项≥6项（得分≥2），提示 ADHD 样表现，需专业评估确认。",
      "highSign": "任一组（师/家）≥6项≥2分；走神、坐不住、冲动抢答",
      "typicalTrigger": "神经发育层面因素，常与执行功能薄弱相关",
      "action": "结合课堂观察交叉核实，与家长沟通后转介专业评估",
      "weight": 1.3,
      "tags": [
        "cognition",
        "attention"
      ]
    },
    {
      "name": "执行功能薄弱",
      "description": "大脑前额叶\"总指挥\"能力弱：抑制控制、工作记忆、认知灵活不足，表现为拖拉、丢三落四、钻牛角尖。",
      "highSign": "拖拉、丢三落四、难以切换思路",
      "typicalTrigger": "执行功能发育未成熟或缺乏针对性训练",
      "action": "开展认知训练（注意力/记忆/执行功能）并配合课堂支持",
      "weight": 1.2,
      "tags": [
        "cognition",
        "executive"
      ]
    },
    {
      "name": "学习策略不足",
      "description": "认知策略与元认知策略使用水平低（总均分≤2.5），\"努力但效率低\"，知识会但方法差。",
      "highSign": "不会预习复习、笔记差、不会组织信息",
      "typicalTrigger": "策略缺失中段起显，缺方法训练",
      "action": "按策略剖面补对应策略（复述/组织/计划/监控/调节）",
      "weight": 1.2,
      "tags": [
        "strategy",
        "cognition"
      ]
    },
    {
      "name": "元认知缺失",
      "description": "\"对自己怎么学\"的觉察和调控不足：不会计划、不监控理解、不调节方法，学完不知道自己会不会。",
      "highSign": "学完不知道自己会不会、一变就不会",
      "typicalTrigger": "缺少元认知训练，教师带问不足",
      "action": "用元认知提问清单训练计划-监控-调节",
      "weight": 1.2,
      "tags": [
        "strategy",
        "metacognition"
      ]
    },
    {
      "name": "工作记忆容量不足",
      "description": "大脑\"临时桌面\"太小，听一句忘一句，边听边记困难。",
      "highSign": "听讲跟不上、记不住多步指令",
      "typicalTrigger": "工作记忆容量小，信息超载",
      "action": "任务拆小步、给书面提示、减少记忆负担",
      "weight": 1.1,
      "tags": [
        "cognition"
      ]
    },
    {
      "name": "学习动机缺失（无动机）",
      "description": "无动机明显（≥4分）：不清楚学习有什么用、学不学无所谓，最危险的动机状态。",
      "highSign": "「学这干嘛」「学不学无所谓」",
      "typicalTrigger": "长期外部控制、意义感缺失",
      "action": "先点燃动力（HERO 活动包），再谈方法",
      "weight": 1.3,
      "tags": [
        "motivation"
      ]
    },
    {
      "name": "外控动机主导",
      "description": "为奖励/惩罚而学，外在调节高于内在动机，一旦外部控制消失学习即停。",
      "highSign": "没人催就不学、为表扬而学",
      "typicalTrigger": "长期奖励惩罚驱动形成外控",
      "action": "逐步把\"要我学\"变\"我要学\"，给选择权",
      "weight": 1.1,
      "tags": [
        "motivation"
      ]
    },
    {
      "name": "学业情绪困扰",
      "description": "消极学业情绪（焦虑/无聊/羞耻）偏多（消极≥3.0）或积极情绪不足（积极≤2.5），情绪性学习困难。",
      "highSign": "一提学习就烦/慌/怕",
      "typicalTrigger": "长期挫败、评价压力、课堂无趣",
      "action": "优先疏导情绪（团体辅导/家长指导），再谈策略",
      "weight": 1.3,
      "tags": [
        "emotion"
      ]
    },
    {
      "name": "考试焦虑",
      "description": "考试前紧张不安、怕考不好，焦虑情绪影响正常发挥。",
      "highSign": "考前紧张、怕考不好、越想越慌",
      "typicalTrigger": "评价压力、家长期待、负性经验",
      "action": "焦虑疏导+家长沟通降低评价压力",
      "weight": 1.1,
      "tags": [
        "emotion",
        "anxiety"
      ]
    },
    {
      "name": "自我效能感不足",
      "description": "\"觉得我不行\"：效能感低，成绩差时归因于自己能力不行，出现习得性无助。",
      "highSign": "「我就是学不会」、放弃尝试",
      "typicalTrigger": "长期失败经验累积且缺少归因引导",
      "action": "设计必然成功的最小任务，归因从能力转向方法",
      "weight": 1.3,
      "tags": [
        "motivation",
        "efficacy"
      ]
    },
    {
      "name": "希望感缺失",
      "description": "\"没有盼头\"：缺少目标和路径感，学习没有奔头。",
      "highSign": "「学不学都差不多」",
      "typicalTrigger": "目标模糊、看不到努力与结果的联系",
      "action": "目标阶梯+路径思维训练（HERO 希望感活动）",
      "weight": 1.1,
      "tags": [
        "motivation",
        "hope"
      ]
    },
    {
      "name": "韧性不足",
      "description": "\"摔了爬不起来\"：面对困难容易放弃，抗挫能力弱。",
      "highSign": "一遇难题就放弃、受挫后长时间消沉",
      "typicalTrigger": "缺乏抗挫训练与支持性反馈",
      "action": "抗挫训练+认知重评，设置\"有挑战但可达\"的任务",
      "weight": 1.1,
      "tags": [
        "motivation",
        "resilience"
      ]
    },
    {
      "name": "学业差距与偏科",
      "description": "某科或某知识点长期薄弱、明显落后于其他（低于均值≥10或连续下滑），含知识断层与偏科模式。",
      "highSign": "偏科、低于班级均值、连续下滑",
      "typicalTrigger": "知识断层滚雪球、三年级断层、策略落差",
      "action": "学业差距分析定位断层点，分学科补策略",
      "weight": 1.2,
      "tags": [
        "academic"
      ]
    },
    {
      "name": "三年级知识断层",
      "description": "三年级学业难度骤升导致成绩和心理集中滑坡：不是孩子退步，是认知要求跳级。",
      "highSign": "三年级突然下滑、偏科显现",
      "typicalTrigger": "抽象思维要求提升、前置知识断层",
      "action": "重点查知识断层与策略缺口，专项补漏",
      "weight": 1.1,
      "tags": [
        "academic"
      ]
    },
    {
      "name": "课堂参与不足",
      "description": "课堂任务投入、举手发言、听讲理解不足（课堂观察总均分<3或单维≤2）。",
      "highSign": "上课不投入、不举手、跟不上",
      "typicalTrigger": "任务难度不匹配、归属感不足、注意力问题",
      "action": "课堂支持策略（任务分层/即时反馈/正向看见）",
      "weight": 1.2,
      "tags": [
        "behavior",
        "classroom"
      ]
    },
    {
      "name": "依恋不安全倾向",
      "description": "亲子依恋安全性不足：风险项反向均分≥3.5，回避/矛盾/紊乱倾向，关系底座不稳学习难稳。",
      "highSign": "不愿求助、情绪易炸、师生/亲子冲突多",
      "typicalTrigger": "养育环境风险、亲子冲突频发",
      "action": "依恋修复亲子活动+家校沟通，先补关系再补学习",
      "weight": 1.2,
      "tags": [
        "relation",
        "attachment"
      ]
    },
    {
      "name": "师生关系紧张",
      "description": "师生关系影响课堂归属与求助意愿，学生怕老师、不敢问。",
      "highSign": "怕老师、换老师后表现差异大",
      "typicalTrigger": "批评式互动、课堂归属感不足",
      "action": "创造课堂正向被看见的机会，重建师生联结",
      "weight": 1.1,
      "tags": [
        "relation"
      ]
    },
    {
      "name": "同伴关系边缘化",
      "description": "被同伴排斥或边缘化，课堂回避、不敢表达，影响学习投入。",
      "highSign": "被孤立、不敢发言、回避集体活动",
      "typicalTrigger": "同伴排斥、社交技能不足",
      "action": "同伴支持配对+合作任务设计",
      "weight": 1.1,
      "tags": [
        "relation",
        "peer"
      ]
    },
    {
      "name": "家庭养育环境风险",
      "description": "家庭结构、养育方式、屏幕时间、亲子冲突等风险因素参与学习问题（高控制/高压、屏幕过量等）。",
      "highSign": "高控制高压、屏幕过量、亲子冲突频发",
      "typicalTrigger": "养育方式不当、家庭冲突、陪伴缺失",
      "action": "家庭生态画像+家长指导，先建家校关系",
      "weight": 1.2,
      "tags": [
        "family"
      ]
    },
    {
      "name": "班级系统生态问题",
      "description": "问题涉及班级整体：学风、群体焦虑、纪律、关系生态（班级生态图五维风险）。",
      "highSign": "班级整体纪律差、群体焦虑、关系生态失衡",
      "typicalTrigger": "班级规则与关系系统未建立",
      "action": "学校干预方案（课堂支持/同伴支持/心育工程）",
      "weight": 1.1,
      "tags": [
        "system",
        "class"
      ]
    },
    {
      "name": "项目小组协作障碍",
      "description": "项目化小组角色缺位、任务分工不清、协作摩擦（个体vs系统因素未区分）。",
      "highSign": "小组推诿、掉队、协作摩擦",
      "typicalTrigger": "角色匹配不当、分工不清、动力不足",
      "action": "差异化设计+角色匹配，降低协作摩擦",
      "weight": 1.1,
      "tags": [
        "system",
        "project"
      ]
    },
    {
      "name": "元系统思维薄弱",
      "description": "六力特色思维层问题：信息归类混乱/逻辑链条断裂/反思调控缺失，\"一听就懂、一做就错\"。",
      "highSign": "逻辑乱、不会拆解问题、反思缺失",
      "typicalTrigger": "思维教学不足、缺少结构化训练",
      "action": "元系统思维训练课程（归类-链条-反思）",
      "weight": 1.1,
      "tags": [
        "cognition",
        "thinking"
      ]
    }
  ],
  "evidences": [
    {
      "attribution": "注意缺陷/多动冲动倾向",
      "scale": "SNAP-IV注意力筛查",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "注意缺陷",
          "comparator": "达到或超过",
          "value": 2,
          "join": "且"
        }
      ],
      "weight": 3,
      "description": "教师/家长任一注意缺陷阳性项≥6项（≥2分）提示注意缺陷倾向"
    },
    {
      "attribution": "注意缺陷/多动冲动倾向",
      "scale": "SNAP-IV注意力筛查",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "多动-冲动",
          "comparator": "达到或超过",
          "value": 2,
          "join": "且"
        }
      ],
      "weight": 3,
      "description": "教师/家长任一动-冲动阳性项≥6项（≥2分）提示多动-冲动倾向"
    },
    {
      "attribution": "注意缺陷/多动冲动倾向",
      "scale": "SNAP-IV注意力筛查",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "注意缺陷",
          "comparator": "达到或超过",
          "value": 1.5,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "注意缺陷维度出现需要关注的信号"
    },
    {
      "attribution": "注意缺陷/多动冲动倾向",
      "scale": "SNAP-IV注意力筛查",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "多动-冲动",
          "comparator": "达到或超过",
          "value": 1.5,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "多动-冲动维度出现需要关注的信号"
    },
    {
      "attribution": "执行功能薄弱",
      "scale": "SNAP-IV注意力筛查",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "多动-冲动",
          "comparator": "达到或超过",
          "value": 2,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "多动冲动明显常提示抑制控制等执行功能弱"
    },
    {
      "attribution": "执行功能薄弱",
      "scale": "SNAP-IV注意力筛查",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "注意缺陷",
          "comparator": "达到或超过",
          "value": 2,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "注意缺陷明显常提示工作记忆/注意控制弱"
    },
    {
      "attribution": "学习策略不足",
      "scale": "学习策略量表",
      "conditions": [
        {
          "targetType": "total",
          "target": "",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 3,
      "description": "策略总均分≤2.5，策略使用薄弱（反向计分后≥3.5）"
    },
    {
      "attribution": "学习策略不足",
      "scale": "学习策略量表",
      "conditions": [
        {
          "targetType": "total",
          "target": "",
          "comparator": "达到或超过",
          "value": 2.5,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "策略总均分处于中等偏下（反向计分后≥2.5）"
    },
    {
      "attribution": "元认知缺失",
      "scale": "学习策略量表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "元认知-计划",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "元认知-监控",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "元认知-调节资源",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "元认知策略（计划/监控/调节）薄弱"
    },
    {
      "attribution": "元认知缺失",
      "scale": "学习策略量表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "元认知-计划",
          "comparator": "达到或超过",
          "value": 2.5,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "元认知-监控",
          "comparator": "达到或超过",
          "value": 2.5,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "元认知-调节资源",
          "comparator": "达到或超过",
          "value": 2.5,
          "join": "且"
        }
      ],
      "weight": 1,
      "description": "元认知策略出现需要关注的信号"
    },
    {
      "attribution": "工作记忆容量不足",
      "scale": "学习策略量表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "元认知-监控",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "边学边查能力弱，常与工作记忆容量不足相关"
    },
    {
      "attribution": "学习动机缺失（无动机）",
      "scale": "学习动机量表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "无动机",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 3,
      "description": "无动机≥4，动机风险（按文档判读标准）"
    },
    {
      "attribution": "学习动机缺失（无动机）",
      "scale": "学习动机量表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "无动机",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "无动机维度出现需要关注的信号"
    },
    {
      "attribution": "外控动机主导",
      "scale": "学习动机量表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "外在调节",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "外在调节≥4，外控动机明显（文档：外在>内在→动机风险）"
    },
    {
      "attribution": "外控动机主导",
      "scale": "学习动机量表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "外在调节",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1.2,
      "description": "外控动机出现需要关注的信号"
    },
    {
      "attribution": "学业情绪困扰",
      "scale": "学业情绪量表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "消极情绪",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 3,
      "description": "消极情绪≥3.0，情绪性学习困难（按文档判读标准）"
    },
    {
      "attribution": "学业情绪困扰",
      "scale": "学业情绪量表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "积极情绪",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "积极情绪≤2.5（反向计分后≥3.5），积极情绪不足"
    },
    {
      "attribution": "考试焦虑",
      "scale": "学业情绪量表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "消极情绪",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "消极情绪偏高，含焦虑成分明显"
    },
    {
      "attribution": "考试焦虑",
      "scale": "学业情绪量表",
      "conditions": [
        {
          "targetType": "question",
          "target": "7",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "「考试前我会紧张不安」频繁出现（反向计分后≥4）"
    },
    {
      "attribution": "自我效能感不足",
      "scale": "学业情绪量表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "积极情绪",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 2.5,
      "description": "积极情绪不足，含「我相信自己能学好」等效能信号偏低"
    },
    {
      "attribution": "自我效能感不足",
      "scale": "学业情绪量表",
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
      "description": "「我相信自己能学好」明显偏低（反向计分后≥4）"
    },
    {
      "attribution": "希望感缺失",
      "scale": "学习动机量表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "内在动机",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "内在动机不足（反向计分后≥4），学习缺乏兴趣与奔头"
    },
    {
      "attribution": "韧性不足",
      "scale": "课堂观察评定",
      "conditions": [
        {
          "targetType": "question",
          "target": "8",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "「面对困难的坚持」差（反向计分后≥4），抗挫弱"
    },
    {
      "attribution": "学业差距与偏科",
      "scale": "成绩趋势与学科诊断",
      "conditions": [
        {
          "targetType": "total",
          "target": "",
          "comparator": "达到或超过",
          "value": 1,
          "join": "且"
        }
      ],
      "weight": 3,
      "description": "任一学科低于均值或连续下滑，薄弱预警"
    },
    {
      "attribution": "学业差距与偏科",
      "scale": "成绩趋势与学科诊断",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "薄弱学科",
          "comparator": "达到或超过",
          "value": 0.6,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "3科及以上薄弱/偏科，需系统归因"
    },
    {
      "attribution": "三年级知识断层",
      "scale": "成绩趋势与学科诊断",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "薄弱学科",
          "comparator": "达到或超过",
          "value": 0.6,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "多科薄弱常对应知识断层（含三年级现象）"
    },
    {
      "attribution": "三年级知识断层",
      "scale": "成绩趋势与学科诊断",
      "conditions": [
        {
          "targetType": "total",
          "target": "",
          "comparator": "达到或超过",
          "value": 1,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "存在薄弱或下滑信号，优先排查断层"
    },
    {
      "attribution": "课堂参与不足",
      "scale": "课堂观察评定",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "课堂参与",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 3,
      "description": "课堂参与≤2.5（反向计分后≥3.5），投入与发言不足"
    },
    {
      "attribution": "课堂参与不足",
      "scale": "课堂观察评定",
      "conditions": [
        {
          "targetType": "total",
          "target": "",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "总均分<3（反向计分后≥3），整体需关注"
    },
    {
      "attribution": "依恋不安全倾向",
      "scale": "依恋关系评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "风险项",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 3,
      "description": "风险项反向均分≥3.5，回避/矛盾/紊乱倾向"
    },
    {
      "attribution": "依恋不安全倾向",
      "scale": "依恋关系评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "风险项",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "依恋风险项出现需要关注的信号"
    },
    {
      "attribution": "师生关系紧张",
      "scale": "课堂观察评定",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "社会情绪",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "社会情绪维度弱（反向计分后≥3.5），师生互动与情绪稳定差"
    },
    {
      "attribution": "同伴关系边缘化",
      "scale": "课堂观察评定",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "社会情绪",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "社会情绪维度出现需要关注的信号，同伴合作弱"
    },
    {
      "attribution": "家庭养育环境风险",
      "scale": "依恋关系评估",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "风险项",
          "comparator": "达到或超过",
          "value": 3,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "依恋风险项偏高，提示家庭养育环境存在风险因素"
    },
    {
      "attribution": "班级系统生态问题",
      "scale": "课堂观察评定",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "社会情绪",
          "comparator": "达到或超过",
          "value": 4,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "社会情绪单维≤2（反向计分后≥4），需重点干预"
    },
    {
      "attribution": "项目小组协作障碍",
      "scale": "课堂观察评定",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "课堂参与",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 1.5,
      "description": "课堂参与弱可能外溢到小组协作（近似信号）"
    },
    {
      "attribution": "元系统思维薄弱",
      "scale": "学习策略量表",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "认知-组织",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "weight": 2,
      "description": "组织策略弱（反向计分后≥3.5），提纲/思维导图等结构化思维不足"
    }
  ],
  "levels": [
    {
      "name": "高风险-建议转介评估",
      "scale": "SNAP-IV注意力筛查",
      "redLine": true,
      "redLineAction": "停止常规建议输出；转介心理教师或专业机构评估（家长知情同意后）；同步年级组",
      "notificationTemplate": "[教师姓名]老师的学习问题评估触发高风险红线（SNAP-IV 阳性提示），请尽快登录系统查看转介处置要求。",
      "conditions": [
        {
          "targetType": "dimension",
          "target": "注意缺陷",
          "comparator": "达到或超过",
          "value": 2,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "多动-冲动",
          "comparator": "达到或超过",
          "value": 2,
          "join": "且"
        }
      ],
      "teacherMessage": "SNAP-IV 筛查提示该生可能存在注意缺陷或多动-冲动样表现（任一组≥6项≥2分）。本量表仅作筛查预警，不作临床诊断：请先结合课堂观察交叉核实，并与家长沟通后转介心理教师或专业机构进一步评估，同步开展认知剖面分析。",
      "resultNote": "ADHD 样表现提示，需专业评估确认，不宜直接下结论",
      "escalationCondition": "连续两次筛查阳性或伴随明显行为安全风险",
      "escalationTarget": "心理教师/专业评估机构（家长知情同意后）",
      "reAssessTrigger": "4-8周后复评追踪变化",
      "interventionTools": [
        "认知功能Profile分析表"
      ],
      "interventionActions": [
        "转介专业评估；开展认知功能剖面分析；同步家长沟通"
      ]
    },
    {
      "name": "中高-情绪与关系干预",
      "scale": "学业情绪量表",
      "redLine": false,
      "conditions": [
        {
          "targetType": "dimension",
          "target": "消极情绪",
          "comparator": "达到或超过",
          "value": 3,
          "join": "或"
        },
        {
          "targetType": "dimension",
          "target": "积极情绪",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "teacherMessage": "学业情绪评估显示消极情绪偏多（焦虑/无聊/羞耻）或积极情绪明显不足，可能存在情绪性学习困难。请优先疏导情绪（团体辅导、家长指导），再谈学习策略与方法，避免把情绪问题当成态度问题处理。",
      "resultNote": "情绪性学习困难信号，需情绪疏导优先",
      "escalationCondition": "情绪困扰持续2周以上或伴随行为退缩",
      "escalationTarget": "心理教师",
      "reAssessTrigger": "30天后复评",
      "interventionTools": [
        "心育工程团体辅导方案"
      ],
      "interventionActions": [
        "转介心理教师评估情绪状态；开展团体辅导或家长指导"
      ]
    },
    {
      "name": "中-策略与学业支持",
      "scale": "学习策略量表",
      "redLine": false,
      "conditions": [
        {
          "targetType": "total",
          "target": "",
          "comparator": "达到或超过",
          "value": 3.5,
          "join": "且"
        }
      ],
      "teacherMessage": "学习策略评估显示策略使用薄弱（总均分≤2.5）。建议从计划、监控等元认知策略入手，配合学科辅导策略开展专项支持，避免只加练习量。",
      "resultNote": "策略缺失定位，需专项策略辅导",
      "escalationCondition": "干预4周无改善或伴随成绩持续下滑",
      "escalationTarget": "教研组长",
      "reAssessTrigger": "30天后复评",
      "interventionTools": [
        "学科辅导策略手册"
      ],
      "interventionActions": [
        "开展学科策略辅导；结合错题管理与预习复习训练"
      ]
    },
    {
      "name": "中低-学业薄弱预警",
      "scale": "成绩趋势与学科诊断",
      "redLine": false,
      "conditions": [
        {
          "targetType": "total",
          "target": "",
          "comparator": "达到或超过",
          "value": 1,
          "join": "且"
        }
      ],
      "teacherMessage": "成绩趋势显示存在薄弱或下滑信号（低于班级均值或连续下滑）。请结合归因进一步定位是知识断层、策略缺失还是其他因素；多科同时下滑时优先排查家庭与情绪因素。",
      "resultNote": "学业薄弱/偏科预警，需归因定位",
      "escalationCondition": "多科同时下滑（≥3科）或持续两个阶段无改善",
      "escalationTarget": "年级组长",
      "reAssessTrigger": "期中/期末复评",
      "interventionTools": [
        "学业能力差距分析表"
      ],
      "interventionActions": [
        "开展学业差距分析；排查家庭与情绪因素"
      ]
    }
  ],
  "tools": [
    {
      "name": "学生学习问题咨询清单",
      "whenToUse": "班主任接到学生问题主诉或观察到异常表现，需系统、客观收集信息时（流程起点）",
      "steps": [
        "取得家长知情同意，约定30-40分钟访谈时间；",
        "按\"成长背景→家庭养育→学校环境→生活习惯\"四模块逐项提问并记录；",
        "每模块提炼3-4个核心回答与异常信号；",
        "访谈后24小时内整理\"问题主诉摘要\"（含持续时间、严重程度初判）；",
        "将摘要移交归因环节。"
      ],
      "form": "checklist",
      "severity": "medium",
      "attributions": [
        "注意缺陷/多动冲动倾向",
        "学习动机缺失（无动机）",
        "学业情绪困扰"
      ],
      "script": "我们分四个模块一起梳理孩子的情况：成长背景、家庭养育、学校环境、生活习惯，每个模块我都会记下关键信息。",
      "timePerSession": "单次30-40分钟",
      "expectedEffect": "产出：学生问题咨询记录单",
      "effectNote": "按\"成长背景—家庭养育—学校环境—生活习惯\"四模块逐项提问并填写，每模块含3-4个核心问题；访谈前取得家长知情同意。",
      "outputArtifact": "学生问题咨询记录单",
      "collaborativeTools": [
        "班级观察记录表",
        "家庭养育环境访谈提纲",
        "学习问题归因矩阵"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "班级观察记录表",
      "whenToUse": "需对学生课堂与课间行为进行连续、客观记录时（建议连续观察1-2周）",
      "steps": [
        "确定连续观察周期（建议1-2周）；",
        "每日按\"注意力/任务完成/同伴互动/情绪行为\"四维打点；",
        "同步记录典型事件（时间+情境+具体行为）；",
        "每周汇总行为频率与趋势，避免凭印象判断；",
        "异常频次标注，与访谈线索交叉印证。"
      ],
      "form": "worksheet",
      "severity": "medium",
      "attributions": [
        "课堂参与不足",
        "师生关系紧张"
      ],
      "script": "这一周我们每天用四维打点记录课堂和课间行为，周末我们一起看频率和趋势。",
      "duration": "连续1-2周",
      "expectedEffect": "产出：班级观察周报",
      "effectNote": "按\"注意力/任务完成/同伴互动/情绪行为\"四维每日打点记录，附典型事件描述；每周汇总行为频率与趋势，避免仅凭印象判断。",
      "outputArtifact": "班级观察周报",
      "collaborativeTools": [
        "学生学习问题咨询清单",
        "依恋类型识别对照表"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [
        "课堂参与",
        "学业表现",
        "社会情绪"
      ],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "家庭养育环境访谈提纲",
      "whenToUse": "怀疑家庭因素（养育方式、家庭冲突、屏幕时间）参与学习问题时",
      "steps": [
        "约定家长访谈时间（电话或面谈约30分钟）；",
        "覆盖家庭结构、养育方式、学习环境、作息与屏幕管理四块；",
        "开放式与封闭式结合，保持非评判语气；",
        "标记风险因素（家庭冲突/高控制/屏幕过量等）；",
        "形成家庭生态画像，移交家庭归因。"
      ],
      "form": "checklist",
      "severity": "low",
      "attributions": [
        "家庭养育环境风险"
      ],
      "script": "我们只是想多了解孩子在家的情况，不是评判谁对谁错，您怎么方便怎么说。",
      "timePerSession": "约30分钟",
      "expectedEffect": "产出：家庭养育环境画像",
      "effectNote": "结构化家长访谈，覆盖家庭结构、养育方式、学习环境、作息与屏幕管理；开放式+封闭式问题结合，避免评判语气。",
      "outputArtifact": "家庭养育环境画像",
      "collaborativeTools": [
        "学习问题归因矩阵",
        "家庭支持指导方案模板"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "注意力筛查量表（SNAP-IV）",
      "whenToUse": "学生存在注意力分散、多动冲动、作业拖延等表现时；或作为事实呈现基线筛查",
      "steps": [
        "家长与教师分别独立评定18项ADHD症状（0-3分）；",
        "汇总两组得分，比较家校一致性；",
        "判定：任一组≥2分项目≥6项提示需进一步评估；",
        "每4-8周复评追踪变化；",
        "阳性结果移交认知剖面分析。"
      ],
      "form": "worksheet",
      "severity": "medium",
      "attributions": [
        "注意缺陷/多动冲动倾向",
        "执行功能薄弱"
      ],
      "script": "这份量表只是筛查工具，不做诊断，老师和家长各评一次，我们看看两边的看法。",
      "duration": "每4-8周复评一次",
      "expectedEffect": "产出：SNAP-IV得分与倾向判定",
      "effectNote": "由家长+教师分别评定18项ADHD症状频率（0-3分）；任一组≥阈值（如≥2分项目≥6项）提示需进一步评估；可每4-8周复评追踪变化。",
      "outputArtifact": "SNAP-IV得分与倾向判定",
      "collaborativeTools": [
        "认知功能Profile分析表",
        "认知训练资源包",
        "课堂行为支持计划（BSP）"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [
        "注意缺陷",
        "多动-冲动"
      ],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "元系统思维水平评估",
      "whenToUse": "需评估结构化思考、元认知能力或\"思维教学\"适配度时",
      "steps": [
        "按学段选择任务形态：1-2年级用分类游戏，3-4年级用思维导图，5-6年级用问题拆解；",
        "学生完成信息归类、逻辑链、自我监控三类任务；",
        "教师按三维（归类/链条/反思）评分；",
        "给出等级（优/中/待提升）；",
        "输出思维薄弱点清单，转思维障碍归因。"
      ],
      "form": "worksheet",
      "severity": "low",
      "attributions": [
        "元系统思维薄弱"
      ],
      "script": "我们用几个小任务看看你是怎么想的：怎么归类信息、怎么搭逻辑链、怎么检查自己的思考。",
      "expectedEffect": "产出：思维水平等级与薄弱点清单",
      "effectNote": "通过思维导图展示、问题拆解任务、自我监控问答等任务，评估\"信息归类/逻辑链条/反思调控\"三维水平，给出等级。",
      "outputArtifact": "思维水平等级与薄弱点清单",
      "collaborativeTools": [
        "元系统思维障碍归因",
        "元系统思维训练课程包"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [
        "认知-组织",
        "元认知-监控"
      ],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "项目化学习参与度观察",
      "whenToUse": "学生在项目化学习中出现参与度低、角色缺位、协作困难时",
      "steps": [
        "每次项目活动按\"任务投入/同伴协作/成果贡献/反思表达\"四维记录；",
        "量表评分+关键事件描述；",
        "个体表现与小组整体对比；",
        "阶段汇总参与度趋势；",
        "协作异常转小组障碍分析。"
      ],
      "form": "worksheet",
      "severity": "low",
      "attributions": [
        "项目小组协作障碍"
      ],
      "script": "每次项目活动结束后，我们按四个维度记一下每个同学的参与情况。",
      "expectedEffect": "产出：项目参与度档案",
      "effectNote": "按\"任务投入/同伴协作/成果贡献/反思表达\"四维记录每次项目活动表现，可用量表+事件记录，聚焦小组动力学。",
      "outputArtifact": "项目参与度档案",
      "collaborativeTools": [
        "项目化小组协作障碍分析表",
        "项目化学习差异化设计"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "五家课程适应性记录",
      "whenToUse": "需发现学生优势领域、匹配\"五家课程\"（艺术家/文学家/科学家/活动家/运动家）时",
      "steps": [
        "记录学生在艺术家/文学家/科学家/活动家/运动家五类课程中的兴趣、投入与表现；",
        "对照多元智能维度标记优势与短板；",
        "形成优势-短板矩阵；",
        "关联效能感与乐观感的优势发现路径；",
        "转个性化匹配。"
      ],
      "form": "worksheet",
      "severity": "low",
      "attributions": [
        "自我效能感不足"
      ],
      "script": "我们找一找你在哪类课程里最亮眼——每个孩子都有自己行的那块。",
      "expectedEffect": "产出：五家课程适应档案",
      "effectNote": "记录学生在五类课程中的兴趣、投入与表现，对照多元智能维度标记优势与短板，作为效能感与乐观感的优势发现路径。",
      "outputArtifact": "五家课程适应档案",
      "collaborativeTools": [
        "五家课程个性化匹配表",
        "五家课程成长档案"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "学习动机量表",
      "whenToUse": "学生呈现厌学、被动学习、目标模糊、缺乏内驱力时",
      "steps": [
        "施测动机题项并计分；",
        "分别计算内在动机（兴趣/成就感）与外在动机（奖励/评价）占比；",
        "识别动机缺失类型（无动机/外控/内控）；",
        "对高段重点解读目标模糊与倦怠信号；",
        "结果转 HERO 希望感与活动包。"
      ],
      "form": "worksheet",
      "severity": "medium",
      "attributions": [
        "学习动机缺失（无动机）",
        "外控动机主导"
      ],
      "script": "这份问卷想了解你学习时心里是怎么想的，没有对错，按真实感受选就行。",
      "expectedEffect": "产出：动机类型与内外动机比",
      "effectNote": "评估内在动机（兴趣/成就感）与外在动机（奖励/评价）占比，识别动机缺失类型（无动机/外控/内控）。",
      "outputArtifact": "动机类型与内外动机比",
      "collaborativeTools": [
        "HERO四维评估雷达图",
        "HERO心理资本建设活动包"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [
        "内在动机",
        "无动机",
        "外在调节"
      ],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "学习策略量表（MAI）",
      "whenToUse": "学生\"努力但效率低\"、不会预习复习、笔记差、元认知弱时",
      "steps": [
        "评定认知策略（复述/精细加工/组织）与元认知策略（计划/监控/调节）；",
        "定位策略缺失点；",
        "对中高段结合学科成绩分析\"知识vs策略\"两类落差；",
        "输出学习策略剖面；",
        "转学业差距与学科策略。"
      ],
      "form": "worksheet",
      "severity": "medium",
      "attributions": [
        "学习策略不足",
        "元认知缺失"
      ],
      "script": "这些问题看看你平时是怎么学习的：怎么记、怎么理、怎么安排自己。",
      "expectedEffect": "产出：学习策略剖面",
      "effectNote": "评估认知策略（复述/精细加工/组织）与元认知策略（计划/监控/调节）使用情况，定位策略缺失点。",
      "outputArtifact": "学习策略剖面",
      "collaborativeTools": [
        "学业能力差距分析表",
        "学科辅导策略手册",
        "个性化辅导记录表"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [
        "认知-复述精细加工",
        "认知-组织",
        "元认知-计划",
        "元认知-监控",
        "元认知-调节资源"
      ],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "HERO心理资本量表（PCQ）",
      "whenToUse": "需全面评估希望感/效能感/韧性/乐观四维心理资源，或作为心理归因基线时",
      "steps": [
        "四维（希望/效能/韧性/乐观）各若干题项计分；",
        "生成四维得分与雷达图数据；",
        "识别最薄弱维度作为干预优先级；",
        "对低段用图示化解读，高段用自评讨论；",
        "数据移交 HERO 雷达图。"
      ],
      "form": "worksheet",
      "severity": "medium",
      "attributions": [
        "希望感缺失",
        "自我效能感不足",
        "韧性不足"
      ],
      "script": "我们看看你心里四块\"电池\"的电量：有盼头、觉得自己行、摔了能起、往好处想。",
      "expectedEffect": "产出：HERO四维得分",
      "effectNote": "四维各若干题项，5点或6点计分；生成四维得分与雷达图数据，识别最薄弱维度作为干预优先级。",
      "outputArtifact": "HERO四维得分",
      "collaborativeTools": [
        "HERO四维评估雷达图",
        "HERO心理资本建设活动包",
        "HERO心理资本成长档案"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "依恋安全量表（Kerns）",
      "whenToUse": "学生存在关系焦虑、求助回避、考试焦虑、师生/亲子冲突时",
      "steps": [
        "评定亲子依恋亲近/依赖/安全感三维；",
        "判定安全/回避/焦虑矛盾/紊乱倾向；",
        "结合教师对师生关系的观察交叉验证；",
        "低中段重点看分离焦虑与求助回避；",
        "结果转依恋类型识别。"
      ],
      "form": "worksheet",
      "severity": "medium",
      "attributions": [
        "依恋不安全倾向"
      ],
      "script": "这些问题关于你和家人的相处方式，答案没有好坏，按真实感受选。",
      "expectedEffect": "产出：依恋类型倾向判定",
      "effectNote": "评估亲子依恋安全性（亲近/依赖/安全感），判定安全/回避/焦虑矛盾/紊乱倾向；结合教师对师生关系的观察交叉验证。",
      "outputArtifact": "依恋类型倾向判定",
      "collaborativeTools": [
        "依恋类型识别对照表",
        "依恋修复亲子活动指南",
        "家校沟通日志模板"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [
        "安全-亲近",
        "安全-依赖",
        "安全-安全感",
        "风险项"
      ],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "学习问题归因矩阵",
      "whenToUse": "事实呈现信息收集完成后，需对\"四维×人群\"系统定位核心成因时",
      "steps": [
        "以\"认知神经/学业能力/心理资本/关系生态\"为列、\"学生个人/项目制小组/班级系统\"为行建矩阵；",
        "逐格标注是否存在问题及强度（高/中/低）；",
        "高亮高发维度（行/列合计最高处）；",
        "区分核心成因与次要成因；",
        "输出带强度标注的归因矩阵，转精确定位。"
      ],
      "form": "framework",
      "severity": "medium",
      "attributions": [
        "学业差距与偏科",
        "学习策略不足",
        "学业情绪困扰"
      ],
      "script": "我们把四维×人群的格子逐个过一遍，标出高/中/低，看哪个格子最满。",
      "expectedEffect": "产出：归因矩阵",
      "effectNote": "以\"认知神经/学业能力/心理资本/关系生态\"为列、\"学生个人/项目制小组/班级系统\"为行，逐格标注是否存在问题及强度，一眼锁定高发维度。",
      "outputArtifact": "归因矩阵",
      "collaborativeTools": [
        "分析决策树",
        "三方协作行动计划表",
        "班级系统生态分析图"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "分析决策树",
      "whenToUse": "需按\"排除→鉴别→定位\"逻辑标准化判定成因类型时",
      "steps": [
        "从\"是否智力/环境剥夺\"判断起点；",
        "逐层排除：神经发育障碍→心理/环境因素；",
        "每节点按分支规则给出判定标准；",
        "记录判定路径与排除依据；",
        "输出归因结论，转分维度确认。"
      ],
      "form": "framework",
      "severity": "medium",
      "attributions": [
        "注意缺陷/多动冲动倾向"
      ],
      "script": "我们按排除法一层层判断：先排除智力与环境因素，再看神经发育，最后看心理与环境。",
      "expectedEffect": "产出：归因判定路径与结论",
      "effectNote": "从\"是否智力/环境剥夺→是否神经发育障碍→是否心理/环境因素\"逐层判断，每节点给出分支规则与判定标准，避免主观误判。",
      "outputArtifact": "归因判定路径与结论",
      "collaborativeTools": [
        "认知功能Profile分析表",
        "学业能力差距分析表",
        "HERO四维评估雷达图",
        "依恋类型识别对照表"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "成因分析鱼骨图模板",
      "whenToUse": "问题成因复杂、多因素交织，需向家长/学生可视化展示因果时",
      "steps": [
        "以\"人/法/环/物+四维\"为鱼骨分支；",
        "将各成因填入对应分支；",
        "标注主因与次因；",
        "用可视化图向家长/学生说明因果；",
        "结论转方案撰写。"
      ],
      "form": "framework",
      "severity": "medium",
      "attributions": [
        "家庭养育环境风险",
        "学业情绪困扰"
      ],
      "script": "我们把可能的原因画成一张鱼骨图，标出主因和次因，这样家长一看就明白。",
      "expectedEffect": "产出：成因鱼骨图",
      "effectNote": "以\"人/法/环/物+四维\"为鱼骨分支，将各成因填入对应分支并标注主次，形成可沟通的原因图。",
      "outputArtifact": "成因鱼骨图",
      "collaborativeTools": [
        "学生个人干预方案模板"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "认知功能Profile分析表",
      "whenToUse": "SNAP-IV或其他线索提示认知功能问题时，需细化注意力/记忆/执行功能剖面",
      "steps": [
        "汇集SNAP-IV、作业表现、教师观察等认知数据；",
        "绘制注意力、工作记忆、执行功能（抑制/灵活/计划）、加工速度剖面；",
        "对比同龄常模，标注低于阈值维度；",
        "对低年级强调\"发育未成熟vs迟缓\"鉴别；",
        "输出认知剖面图，转认知训练与课堂配合。"
      ],
      "form": "worksheet",
      "severity": "medium",
      "attributions": [
        "执行功能薄弱",
        "注意缺陷/多动冲动倾向"
      ],
      "script": "我们把注意力、记忆、执行功能画成一张剖面图，和同龄常模比一比。",
      "expectedEffect": "产出：认知功能剖面图",
      "effectNote": "将注意力、工作记忆、执行功能（抑制/灵活/计划）、加工速度等测评结果绘成剖面，对比同龄常模，标注低于阈值的维度。",
      "outputArtifact": "认知功能剖面图",
      "collaborativeTools": [
        "注意力筛查量表（SNAP-IV）",
        "认知训练资源包",
        "课堂行为支持计划（BSP）"
      ],
      "prerequisiteTools": [
        "注意力筛查量表（SNAP-IV）"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [
        "注意缺陷",
        "多动-冲动"
      ],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "学业能力差距分析表",
      "whenToUse": "需量化各学科实际水平与期望水平的差距、识别知识断层与偏科模式时",
      "steps": [
        "列出各学科成绩、年级百分位、知识点掌握度；",
        "计算实际与期望水平差距值；",
        "标注知识断层点与偏科模式（中年级重点查三年级断层）；",
        "结合策略量表区分\"知识落差\"与\"策略落差\"；",
        "输出学业差距表，转学科策略与辅导。"
      ],
      "form": "worksheet",
      "severity": "medium",
      "attributions": [
        "学业差距与偏科",
        "三年级知识断层"
      ],
      "script": "我们把每科的实际水平和期望水平摆在一起，看看差距在哪、断在哪。",
      "expectedEffect": "产出：学业差距表",
      "effectNote": "列出各学科成绩、年级百分位、知识点掌握度，计算差距值并标注断层点；结合策略量表定位\"知识\"与\"策略\"两类落差。",
      "outputArtifact": "学业差距表",
      "collaborativeTools": [
        "学习策略量表（MAI）",
        "学科辅导策略手册",
        "个性化辅导记录表"
      ],
      "prerequisiteTools": [
        "学习策略量表（MAI）"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [
        "薄弱学科"
      ],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "HERO四维评估雷达图",
      "whenToUse": "PCQ数据生成后，需直观呈现四维心理资本强弱并定位最弱维度时",
      "steps": [
        "以PCQ四维得分为数据绘制雷达图；",
        "叠加同龄常模参考圈；",
        "定位圈内显著凹陷维度（优先干预）；",
        "对低段用成长语言解读，高段用目标讨论；",
        "输出HERO雷达图，转活动包与成长档案。"
      ],
      "form": "worksheet",
      "severity": "medium",
      "attributions": [
        "希望感缺失",
        "自我效能感不足",
        "韧性不足"
      ],
      "script": "这张雷达图显示你四块\"电池\"的电量，凹陷最深的那个就是我们优先要充的。",
      "expectedEffect": "产出：HERO雷达图",
      "effectNote": "以PCQ四维得分为数据绘制雷达图，叠加同龄常模参考圈，圈内显著凹陷处即优先干预维度。",
      "outputArtifact": "HERO雷达图",
      "collaborativeTools": [
        "HERO心理资本量表（PCQ）",
        "HERO心理资本建设活动包",
        "HERO心理资本成长档案"
      ],
      "prerequisiteTools": [
        "HERO心理资本量表（PCQ）"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "依恋类型识别对照表",
      "whenToUse": "需根据行为特征快速判定依恋类型，或印证依恋量表结果时",
      "steps": [
        "列出安全/回避/焦虑矛盾/紊乱四型特征；",
        "对照学生行为逐条勾选匹配度；",
        "结合依恋量表结果印证；",
        "说明该类型对学习的影响（如焦虑型→考试焦虑）；",
        "输出依恋类型判定，转修复与沟通。"
      ],
      "form": "checklist",
      "severity": "medium",
      "attributions": [
        "依恋不安全倾向",
        "师生关系紧张"
      ],
      "script": "我们对照四类依恋特征逐条勾选，看看孩子最贴近哪一类。",
      "expectedEffect": "产出：依恋类型判定",
      "effectNote": "列出安全/回避/焦虑矛盾/紊乱四型的行为特征、神经基础与对学习的影响对照，按学生表现逐条勾选匹配度最高的类型。",
      "outputArtifact": "依恋类型判定",
      "collaborativeTools": [
        "依恋安全量表（Kerns）",
        "依恋修复亲子活动指南",
        "家校沟通日志模板"
      ],
      "prerequisiteTools": [
        "依恋安全量表（Kerns）"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [
        "风险项"
      ],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "元系统思维障碍归因",
      "whenToUse": "思维评估显示思维水平待提升，需定位\"思维层\"问题根源时",
      "steps": [
        "读取思维水平等级与薄弱点；",
        "区分\"信息归类混乱/逻辑链条断裂/反思调控缺失\"类型；",
        "关联对应学业与行为表现；",
        "形成思维层面归因结论；",
        "转思维训练与进度追踪。"
      ],
      "form": "framework",
      "severity": "medium",
      "attributions": [
        "元系统思维薄弱"
      ],
      "script": "我们定位一下是归类乱、链条断还是反思缺，再对症训练。",
      "expectedEffect": "产出：思维障碍类型与对应表现",
      "effectNote": "区分\"信息归类混乱/逻辑链条断裂/反思调控缺失\"等思维障碍类型，关联其对应的学业与行为表现，形成思维层面归因。",
      "outputArtifact": "思维障碍类型与对应表现",
      "collaborativeTools": [
        "元系统思维水平评估",
        "元系统思维训练课程包",
        "元系统思维训练进度表"
      ],
      "prerequisiteTools": [
        "元系统思维水平评估"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [
        "认知-组织",
        "元认知-监控"
      ],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "项目化小组协作障碍分析表",
      "whenToUse": "项目化观察显示小组协作问题时，需分析小组动力学层面成因时",
      "steps": [
        "读取小组参与度记录；",
        "从角色匹配/任务分工/同伴关系/动力水平/教师支持五维分析；",
        "区分个体因素与系统因素；",
        "定位协作摩擦主因；",
        "转差异化设计与项目辅导。"
      ],
      "form": "worksheet",
      "severity": "medium",
      "attributions": [
        "项目小组协作障碍"
      ],
      "script": "我们从五个维度看小组卡在哪：角色、分工、关系、动力、支持。",
      "expectedEffect": "产出：小组协作障碍诊断",
      "effectNote": "从角色匹配/任务分工/同伴关系/动力水平/教师支持五维分析小组障碍，区分个体因素与系统因素。",
      "outputArtifact": "小组协作障碍诊断",
      "collaborativeTools": [
        "项目化学习参与度观察",
        "项目化学习差异化设计",
        "项目化学习辅导记录"
      ],
      "prerequisiteTools": [
        "项目化学习参与度观察"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "班级系统生态分析图",
      "whenToUse": "问题涉及班级整体（学风/群体焦虑/纪律/关系生态）时",
      "steps": [
        "从班级氛围、规则系统、同伴生态、师生关系、心理资本分布五维绘制生态图；",
        "标注系统层风险点与优势点；",
        "对照归因矩阵班级行；",
        "形成班级系统归因；",
        "转学校方案与氛围监测。"
      ],
      "form": "framework",
      "severity": "medium",
      "attributions": [
        "班级系统生态问题"
      ],
      "script": "我们把班级的五维画成生态图，标出风险点和优势点。",
      "expectedEffect": "产出：班级生态图",
      "effectNote": "从班级氛围、规则系统、同伴生态、师生关系、心理资本分布五维绘制生态图，标注系统层面的风险点与优势点。",
      "outputArtifact": "班级生态图",
      "collaborativeTools": [
        "学习问题归因矩阵",
        "学校干预方案模板",
        "班级氛围变化监测表"
      ],
      "prerequisiteTools": [
        "学习问题归因矩阵"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "学生个人干预方案模板",
      "whenToUse": "归因完成、核心成因明确，需撰写学生侧可执行干预方案时",
      "steps": [
        "读取归因结论，按\"认知训练/心理资本/学习策略/元系统思维\"四模块填写措施；",
        "每项措施须对应一条归因结论（可回溯）；",
        "明确执行人、频率、单次时长；",
        "设定评估节点（如第4/8/10周）；",
        "班主任、家长、学生（高段）签字确认，转落地记录。"
      ],
      "form": "framework",
      "severity": "medium",
      "attributions": [
        "注意缺陷/多动冲动倾向",
        "学习策略不足",
        "学业情绪困扰"
      ],
      "script": "方案里的每一项措施都对应一条归因结论，签字后我们按节点执行。",
      "expectedEffect": "产出：学生个人干预方案",
      "effectNote": "按\"认知训练/心理资本/学习策略/元系统思维\"四模块填写具体措施、执行人、频率、评估节点；每项措施须对应一条归因结论。",
      "outputArtifact": "学生个人干预方案",
      "collaborativeTools": [
        "个性化辅导记录表",
        "学习习惯21天追踪表"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "家庭支持指导方案模板",
      "whenToUse": "关系生态或家庭因素为成因之一，需给家长可执行方案时",
      "steps": [
        "读取关系/家庭成因，分\"养育方式/依恋修复/环境优化/家校协同\"四块；",
        "语言通俗、步骤可操作，避免专业术语；",
        "低段给\"陪读示范\"动作，高段给\"协商式沟通\"话术；",
        "列出家长每周可完成的具体任务；",
        "转沟通与关系反馈。"
      ],
      "form": "framework",
      "severity": "medium",
      "attributions": [
        "家庭养育环境风险",
        "依恋不安全倾向"
      ],
      "script": "这份方案里的任务都是家长每周能完成的，语言都很通俗，照着做就行。",
      "expectedEffect": "产出：家庭支持方案",
      "effectNote": "含养育方式调整、依恋修复活动、家庭环境优化、家校协同四块；语言通俗、步骤可操作，避免专业术语。",
      "outputArtifact": "家庭支持方案",
      "collaborativeTools": [
        "家校沟通日志模板",
        "“三通工程”家校沟通模板",
        "依恋关系改善反馈表"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "学校干预方案模板",
      "whenToUse": "需在课堂与学校层面落实差异化支持、同伴支持、心育工程时",
      "steps": [
        "读取班级生态与个体归因；",
        "分\"课堂支持(BSP)/同伴支持/心育工程/项目化·五家适配\"五块；",
        "明确学科教师、心理老师、班主任分工；",
        "设定学校端时间节点；",
        "转课堂落地与氛围监测。"
      ],
      "form": "framework",
      "severity": "medium",
      "attributions": [
        "班级系统生态问题",
        "课堂参与不足"
      ],
      "script": "我们把学校端的支持分成五块，每块明确谁来做、什么时候做。",
      "expectedEffect": "产出：学校干预方案",
      "effectNote": "含课堂支持(BSP)、同伴关系支持、心育工程支持、项目化/五家适配五块，明确学科教师/心理老师/班主任分工。",
      "outputArtifact": "学校干预方案",
      "collaborativeTools": [
        "课堂行为支持计划（BSP）",
        "同伴支持配对方案",
        "心育工程团体辅导方案",
        "班级氛围变化监测表"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "三方协作行动计划表",
      "whenToUse": "三方方案就绪，需统一时间轴、明确分工与节点时",
      "steps": [
        "整合学生/家庭/学校三方方案；",
        "以10周为周期划分阶段（启动/深化/中期评估/固化/复盘）；",
        "列明每阶段核心任务、执行方式、责任人；",
        "形成统一时间轴总控表；",
        "转进度追踪与复盘。"
      ],
      "form": "worksheet",
      "severity": "medium",
      "attributions": [
        "课堂参与不足",
        "学业情绪困扰"
      ],
      "script": "我们把三方方案放进同一张时间轴，每个阶段谁做什么都写清楚。",
      "duration": "10周周期",
      "expectedEffect": "产出：三方协作10周行动计划",
      "effectNote": "以10周为周期划分阶段（启动/深化/中期评估/固化/复盘），列明每阶段核心任务、执行方式、责任人；作为总控表。",
      "outputArtifact": "三方协作10周行动计划",
      "collaborativeTools": [
        "三方协作进度追踪表",
        "三方联合复盘会议模板"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "认知训练资源包",
      "whenToUse": "认知功能剖面显示注意力/工作记忆/执行功能落后，需训练材料时",
      "steps": [
        "读取认知剖面落后维度；",
        "选取对应训练卡（注意力Stroop/数字追踪、工作记忆N-back、执行功能计划/抑制）；",
        "基于神经可塑性，每日10-15分钟；",
        "低中段以游戏化为主，高段可加自我监控；",
        "记录训练数据，转课堂配合与习惯。"
      ],
      "form": "exercise",
      "severity": "medium",
      "attributions": [
        "执行功能薄弱",
        "注意缺陷/多动冲动倾向"
      ],
      "script": "大脑像肌肉，越练越强。每天10-15分钟，坚持几周就能看到变化。",
      "timePerSession": "每日10-15分钟",
      "duration": "连续数周",
      "expectedEffect": "产出：训练任务包+训练记录",
      "effectNote": "含注意力（Stroop/数字追踪）、工作记忆（N-back/背数）、执行功能（计划/抑制）系列训练卡与记录表；基于神经可塑性，每日10-15分钟。",
      "outputArtifact": "训练任务包+训练记录",
      "collaborativeTools": [
        "课堂行为支持计划（BSP）",
        "学习习惯21天追踪表"
      ],
      "prerequisiteTools": [
        "认知功能Profile分析表"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [
        "注意缺陷",
        "多动-冲动"
      ],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "HERO心理资本建设活动包",
      "whenToUse": "PCQ/HERO雷达显示某维度薄弱，需对应活动资源时",
      "steps": [
        "读取HERO雷达最弱维度；",
        "按H/E/R/O选取对应主题活动（希望=目标阶梯+路径思维；韧性=抗挫+认知重评）；",
        "明确每项活动目标、步骤、时长；",
        "低段用绘本/游戏，高段用讨论/写作；",
        "转团体辅导与成长档案。"
      ],
      "form": "exercise",
      "severity": "medium",
      "attributions": [
        "希望感缺失",
        "自我效能感不足",
        "韧性不足"
      ],
      "script": "哪块\"电池\"没电就先充哪块：目标阶梯、抗挫训练、认知重评，挑对应的做。",
      "expectedEffect": "产出：分维度活动方案",
      "effectNote": "按H/E/R/O四维分装主题活动（如希望感=目标阶梯+路径思维；韧性=抗挫训练+认知重评），每项含目标、步骤、时长。",
      "outputArtifact": "分维度活动方案",
      "collaborativeTools": [
        "心育工程团体辅导方案",
        "HERO心理资本成长档案"
      ],
      "prerequisiteTools": [
        "HERO四维评估雷达图"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "依恋修复亲子活动指南",
      "whenToUse": "判定为不安全依恋，需结构化亲子互动修复时",
      "steps": [
        "读取依恋类型；",
        "安排每周1-2次亲子活动（共读/情绪分享/合作游戏）；",
        "强调\"无评价陪伴+一致回应\"；",
        "提供活动指引与观察要点；",
        "记录互动质量，转家校沟通与关系反馈。"
      ],
      "form": "framework",
      "severity": "medium",
      "attributions": [
        "依恋不安全倾向"
      ],
      "script": "陪伴时只陪伴、不评价，回应要一致——孩子感受到安全，才敢靠近。",
      "duration": "每周1-2次亲子活动",
      "expectedEffect": "产出：亲子活动指南+观察记录",
      "effectNote": "提供每周1-2次亲子活动（共读/情绪分享/合作游戏），强调\"无评价陪伴+一致回应\"，附活动指引与观察要点。",
      "outputArtifact": "亲子活动指南+观察记录",
      "collaborativeTools": [
        "家校沟通日志模板",
        "依恋关系改善反馈表"
      ],
      "prerequisiteTools": [
        "依恋类型识别对照表"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [
        "风险项",
        "安全-亲近"
      ],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "学科辅导策略手册",
      "whenToUse": "学业差距分析定位知识断层或偏科，需分学科差异化策略时",
      "steps": [
        "读取学业断层与偏科；",
        "按学科（语/数/英）调取分册策略（预习复习/错题管理/概念图/费曼法）；",
        "标注每策略适用情境；",
        "低段重识字与口算，高段重抽象与综合；",
        "转辅导落地与习惯。"
      ],
      "form": "framework",
      "severity": "medium",
      "attributions": [
        "学业差距与偏科",
        "学习策略不足",
        "三年级知识断层"
      ],
      "script": "按学科调取对应策略：预习复习、错题管理、概念图、费曼法，选适合情境的用。",
      "expectedEffect": "产出：分学科策略清单",
      "effectNote": "语文/数学/英语等分册，含预习复习法、错题管理、概念图、费曼法等策略及适用情境，可按学科调取。",
      "outputArtifact": "分学科策略清单",
      "collaborativeTools": [
        "个性化辅导记录表",
        "学习习惯21天追踪表"
      ],
      "prerequisiteTools": [
        "学业能力差距分析表"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [
        "薄弱学科"
      ],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "元系统思维训练课程包",
      "whenToUse": "思维障碍归因定位思维障碍，需结构化思维训练课程时",
      "steps": [
        "读取思维障碍类型；",
        "选取对应微课+练习（归类/逻辑链/反思表）；",
        "按6-8周递进，按段调难度（低段游戏→高段抽象）；",
        "设思维水平复评节点；",
        "转进度追踪与习惯养成卡。"
      ],
      "form": "exercise",
      "severity": "medium",
      "attributions": [
        "元系统思维薄弱",
        "元认知缺失"
      ],
      "script": "六到八周，每周一个微课加练习：归类、链条、反思，一步步递进。",
      "duration": "6-8周递进",
      "expectedEffect": "产出：思维训练课程包",
      "effectNote": "系列微课+练习（信息归类/逻辑链/反思表），6-8周递进；可个体或全班实施，附思维水平复评节点。",
      "outputArtifact": "思维训练课程包",
      "collaborativeTools": [
        "元系统思维训练进度表",
        "元系统思维习惯养成卡"
      ],
      "prerequisiteTools": [
        "元系统思维障碍归因"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [
        "认知-组织",
        "元认知-计划",
        "元认知-监控"
      ],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "项目化学习差异化设计",
      "whenToUse": "项目化小组分析显示小组协作/能力分化问题，需适配任务难度与角色时",
      "steps": [
        "读取小组障碍；",
        "提供任务分层（基础/进阶/挑战）与角色分工模板；",
        "按成员能力匹配角色并设进阶路径；",
        "降低协作摩擦；",
        "转项目辅导与成果展示。"
      ],
      "form": "framework",
      "severity": "medium",
      "attributions": [
        "项目小组协作障碍"
      ],
      "script": "任务分三层、角色按能力匹配，每个人都能上手还有进阶路径。",
      "expectedEffect": "产出：差异化项目任务单",
      "effectNote": "提供任务分层（基础/进阶/挑战）与角色分工模板，按成员能力匹配角色并设进阶路径，降低协作摩擦。",
      "outputArtifact": "差异化项目任务单",
      "collaborativeTools": [
        "项目化学习辅导记录",
        "项目化学习成果展示"
      ],
      "prerequisiteTools": [
        "项目化小组协作障碍分析表"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "心育工程主题活动方案",
      "whenToUse": "需通过团体活动促进心理资本建设与关系修复时",
      "steps": [
        "按主题选取团体辅导方案（挫折/情绪/合作/自我认识）；",
        "明确目标、流程、物料、时长；",
        "适配班会或心育课；",
        "低段重游戏体验，高段重讨论反思；",
        "转团体辅导执行与习惯日记。"
      ],
      "form": "framework",
      "severity": "medium",
      "attributions": [
        "学业情绪困扰",
        "考试焦虑"
      ],
      "script": "按主题选方案：挫折、情绪、合作、自我认识，目标流程物料时长都备好了。",
      "expectedEffect": "产出：团体活动方案",
      "effectNote": "分主题团体辅导方案（挫折教育/情绪管理/合作沟通/自我认识），含目标、流程、物料、时长，适配班会或心育课。",
      "outputArtifact": "团体活动方案",
      "collaborativeTools": [
        "心育工程团体辅导方案",
        "心育工程习惯日记"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "五家课程个性化匹配表",
      "whenToUse": "五家课程记录显示优势领域，需将优势导入学业规划与自信构建时",
      "steps": [
        "读取五家课程优势领域；",
        "将优势匹配课程、岗位、展示机会；",
        "形成\"以优带弱\"规划；",
        "低段重兴趣自信，高段重领导力；",
        "转个人方案与成长档案。"
      ],
      "form": "worksheet",
      "severity": "medium",
      "attributions": [
        "自我效能感不足"
      ],
      "script": "孩子在哪块最行，就把课程、岗位和展示机会往那边配，用优势带短板。",
      "expectedEffect": "产出：五家匹配矩阵与规划",
      "effectNote": "将学生优势（艺术家/文学家/科学家/活动家/运动家）与课程、岗位、展示机会匹配，形成\"以优带弱\"的规划。",
      "outputArtifact": "五家匹配矩阵与规划",
      "collaborativeTools": [
        "学生个人干预方案模板",
        "五家课程成长档案"
      ],
      "prerequisiteTools": [
        "五家课程适应性记录"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "个性化辅导记录表",
      "whenToUse": "每次实施学生侧干预（认知训练/策略指导等）后，需标准化记录时",
      "steps": [
        "每次学生侧干预后记录日期、内容、学生反应、完成度；",
        "标注下次调整点；",
        "每周汇总；",
        "作为方案动态调整依据；",
        "阶段末交复评与习惯。"
      ],
      "form": "worksheet",
      "severity": "medium",
      "attributions": [
        "学习策略不足",
        "学业差距与偏科"
      ],
      "script": "每次辅导后五分钟记下内容、反应、完成度和下次调整点，一周一汇总。",
      "expectedEffect": "产出：辅导记录（周/阶段）",
      "effectNote": "记录日期、干预内容、学生反应、完成度、下次调整；每周汇总，作为方案动态调整依据。",
      "outputArtifact": "辅导记录（周/阶段）",
      "collaborativeTools": [
        "学习习惯21天追踪表"
      ],
      "prerequisiteTools": [
        "学生个人干预方案模板"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "项目化学习辅导记录",
      "whenToUse": "项目制小组干预实施过程中，需追踪个体与小组进展时",
      "steps": [
        "项目活动后记录个体投入、角色完成、协作表现；",
        "记录教师支持动作；",
        "关联小组障碍改善；",
        "阶段汇总；",
        "转成果展示与进度追踪。"
      ],
      "form": "worksheet",
      "severity": "medium",
      "attributions": [
        "项目小组协作障碍"
      ],
      "script": "每次项目活动后记录个体与小组表现，还有我们教师自己做了什么支持。",
      "expectedEffect": "产出：项目辅导记录",
      "effectNote": "记录每次项目活动的个体投入、角色完成、协作表现与教师支持动作，关联小组障碍改善情况。",
      "outputArtifact": "项目辅导记录",
      "collaborativeTools": [
        "项目化学习成果展示",
        "三方协作进度追踪表"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "家校沟通日志模板",
      "whenToUse": "需与家长保持定期沟通、同步进展与问题，避免信息断层时",
      "steps": [
        "约定每2周1次家校沟通；",
        "每次记录主题、共识、待办、下次时间；",
        "使用标准化结构；",
        "确保三方信息同步；",
        "转三通工程与进度追踪。"
      ],
      "form": "checklist",
      "severity": "medium",
      "attributions": [
        "依恋不安全倾向",
        "家庭养育环境风险"
      ],
      "script": "每两周一次，记下主题、共识、待办和下次时间，三方都能看到进展。",
      "duration": "每2周1次",
      "expectedEffect": "产出：家校沟通日志",
      "effectNote": "每次沟通记录主题、共识、待办、下次时间；建议每2周1次，使用标准化结构，便于三方追踪。",
      "outputArtifact": "家校沟通日志",
      "collaborativeTools": [
        "“三通工程”家校沟通模板",
        "三方协作进度追踪表"
      ],
      "prerequisiteTools": [
        "家庭支持指导方案模板"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [
        "风险项"
      ],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "“三通工程”家校沟通模板",
      "whenToUse": "依托六力\"三通工程\"开展家校共育活动（家长会/亲子活动）需统一话术与流程时",
      "steps": [
        "依托三通工程发起家长会/亲子活动；",
        "使用统一流程与话术模板；",
        "对齐共育目标；",
        "强化家庭端依恋支持；",
        "转沟通日志与关系反馈。"
      ],
      "form": "script",
      "severity": "medium",
      "attributions": [
        "家庭养育环境风险"
      ],
      "script": "家长会怎么开、亲子活动怎么邀、共育目标怎么对齐，模板里都有现成话术。",
      "expectedEffect": "产出：家校共育沟通包",
      "effectNote": "提供家长会流程、亲子活动邀请与反馈、共育目标对齐模板，强化家校一致性与依恋修复的家庭端支持。",
      "outputArtifact": "家校共育沟通包",
      "collaborativeTools": [
        "家校沟通日志模板",
        "依恋关系改善反馈表"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "家长指导手册（分主题）",
      "whenToUse": "家长需针对特定问题（注意力/作业/情绪/屏幕）自助操作时",
      "steps": [
        "按主题（注意力/作业/情绪/屏幕）调取分册；",
        "家长阅读可操作步骤与话术；",
        "低段给\"陪读示范\"，高段给\"自主协商\"；",
        "家长在家自助操作；",
        "转沟通与家长观察反馈。"
      ],
      "form": "framework",
      "severity": "medium",
      "attributions": [
        "家庭养育环境风险",
        "学业情绪困扰"
      ],
      "script": "这一册讲\"作业拖拉怎么办\"，里面是可操作的步骤和话术，照着做就行。",
      "expectedEffect": "产出：分主题家长指南",
      "effectNote": "按主题分册（如\"作业拖拉怎么办\"\"考试焦虑家长应对\"），提供可操作步骤与话术，降低家长专业门槛。",
      "outputArtifact": "分主题家长指南",
      "collaborativeTools": [
        "家校沟通日志模板",
        "家长观察反馈表"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "教师课堂支持策略卡",
      "whenToUse": "学科教师需在课堂即时应用差异化支持策略时（快速查阅）",
      "steps": [
        "按问题类型检索策略卡（任务分层/提示/即时反馈/座位）；",
        "课堂即时应用；",
        "附课堂行为支持计划对接说明；",
        "记录应用效果；",
        "转辅导记录与习惯。"
      ],
      "form": "checklist",
      "severity": "medium",
      "attributions": [
        "课堂参与不足",
        "注意缺陷/多动冲动倾向"
      ],
      "script": "一页纸策略卡：任务分层、提示策略、即时反馈、座位分组，按问题类型直接查。",
      "expectedEffect": "产出：课堂策略卡",
      "effectNote": "一页式策略卡（任务分层/提示策略/即时反馈/座位分组），按问题类型检索即用，附课堂行为支持计划对接说明。",
      "outputArtifact": "课堂策略卡",
      "collaborativeTools": [
        "个性化辅导记录表",
        "学习习惯21天追踪表"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [
        "课堂参与",
        "学业表现",
        "社会情绪"
      ],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "课堂行为支持计划（BSP）",
      "whenToUse": "学生在课堂出现显著行为问题（离座/打断/冲动），需结构化行为干预时",
      "steps": [
        "读取行为问题（离座/打断/冲动）；",
        "做ABC（前因-行为-后果）分析；",
        "制定支持策略（前排就座/任务分解/即时反馈/正强化）；",
        "设定数据记录方式；",
        "低中段为主，转学校方案与习惯。"
      ],
      "form": "framework",
      "severity": "high",
      "attributions": [
        "注意缺陷/多动冲动倾向",
        "执行功能薄弱"
      ],
      "script": "我们先分析行为的前因后果，再定支持策略——不是罚，是帮。",
      "expectedEffect": "产出：课堂行为支持计划+行为数据",
      "effectNote": "明确目标行为、前因-行为-后果(ABC)分析、支持策略（前排就座/任务分解/即时反馈/正强化）、数据记录方式。",
      "outputArtifact": "课堂行为支持计划+行为数据",
      "collaborativeTools": [
        "学校干预方案模板",
        "学习习惯21天追踪表"
      ],
      "prerequisiteTools": [
        "认知功能Profile分析表"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [
        "多动-冲动"
      ],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "同伴支持配对方案",
      "whenToUse": "学生同伴关系边缘化/被排斥，需结构化同伴支持时",
      "steps": [
        "识别同伴边缘化学生；",
        "选择友好成熟同伴结对；",
        "设计合作学习任务与正向互动；",
        "定期评估关系改善；",
        "转学校方案与关系反馈。"
      ],
      "form": "framework",
      "severity": "medium",
      "attributions": [
        "同伴关系边缘化"
      ],
      "script": "我们找一位友善成熟的同伴结对，一起完成合作任务，定期看关系有没有改善。",
      "expectedEffect": "产出：同伴配对方案",
      "effectNote": "选择友好、成熟同伴结对，设计合作学习任务与正向互动机会，定期评估同伴关系改善。",
      "outputArtifact": "同伴配对方案",
      "collaborativeTools": [
        "学校干预方案模板",
        "依恋关系改善反馈表",
        "班级氛围变化监测表"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "三方协作进度追踪表",
      "whenToUse": "三方行动计划启动后，需统一追踪学生/家庭/学校三方执行进度时",
      "steps": [
        "对照三方行动计划；",
        "逐阶段勾选完成度；",
        "标注延误与风险；",
        "作为复盘与调整输入；",
        "转记录与复盘。"
      ],
      "form": "worksheet",
      "severity": "medium",
      "attributions": [
        "学业差距与偏科",
        "学习策略不足"
      ],
      "script": "三方各阶段的完成度逐项勾选，延误和风险标出来，复盘时一目了然。",
      "expectedEffect": "产出：进度追踪看板",
      "effectNote": "对照三方行动计划，逐阶段勾选完成度、标注延误与风险，作为复盘与调整输入。",
      "outputArtifact": "进度追踪看板",
      "collaborativeTools": [
        "个性化辅导记录表",
        "家校沟通日志模板",
        "三方联合复盘会议模板"
      ],
      "prerequisiteTools": [
        "三方协作行动计划表"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "心育工程团体辅导方案",
      "whenToUse": "需通过团体辅导落实HERO建设或关系修复（个体或班级层面）时",
      "steps": [
        "基于心育工程/活动包方案落地；",
        "记录团体过程、成员参与、关键事件；",
        "低段重体验，高段重表达；",
        "收集心理资本提升证据；",
        "转成长档案与习惯日记。"
      ],
      "form": "framework",
      "severity": "medium",
      "attributions": [
        "学业情绪困扰",
        "考试焦虑",
        "希望感缺失"
      ],
      "script": "团体辅导过程中记录成员参与和关键事件，作为心理资本提升的证据。",
      "expectedEffect": "产出：团体辅导执行记录",
      "effectNote": "基于心育工程方案落地执行，记录团体过程、成员参与、关键事件，作为心理资本提升证据。",
      "outputArtifact": "团体辅导执行记录",
      "collaborativeTools": [
        "HERO心理资本成长档案",
        "心育工程习惯日记"
      ],
      "prerequisiteTools": [
        "心育工程主题活动方案"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "元系统思维训练进度表",
      "whenToUse": "思维训练课程实施期间，需阶段追踪思维水平变化时",
      "steps": [
        "课程实施期间按周记录训练完成度；",
        "记录思维任务表现与反思质量；",
        "配合思维水平复评节点；",
        "标注卡点；",
        "转习惯养成卡与辅导记录。"
      ],
      "form": "worksheet",
      "severity": "medium",
      "attributions": [
        "元系统思维薄弱"
      ],
      "script": "每周记一次训练完成度、任务表现和反思质量，卡点标出来。",
      "expectedEffect": "产出：思维训练进度",
      "effectNote": "按周记录训练完成度、思维任务表现、反思质量，配合思维水平复评节点。",
      "outputArtifact": "思维训练进度",
      "collaborativeTools": [
        "元系统思维习惯养成卡",
        "个性化辅导记录表"
      ],
      "prerequisiteTools": [
        "元系统思维训练课程包"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [
        "认知-组织",
        "元认知-监控"
      ],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "五家课程参与跟踪表",
      "whenToUse": "学生参与五家课程期间，需追踪优势发展与自信构建时",
      "steps": [
        "记录五家课程参与频次、角色、成果；",
        "追踪自我效能变化；",
        "关联学业表现；",
        "阶段汇总；",
        "转成长档案与自评。"
      ],
      "form": "worksheet",
      "severity": "medium",
      "attributions": [
        "自我效能感不足"
      ],
      "script": "记下参与频次、角色和成果，看自我效能感有没有跟着涨。",
      "expectedEffect": "产出：五家参与跟踪",
      "effectNote": "记录五家课程参与频次、角色、成果与自我效能变化，关联学业表现。",
      "outputArtifact": "五家参与跟踪",
      "collaborativeTools": [
        "五家课程成长档案",
        "学生自我评价周报"
      ],
      "prerequisiteTools": [
        "五家课程个性化匹配表"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "学习习惯21天追踪表",
      "whenToUse": "干预见效后，需将学习行为固化为习惯（前额叶自动化）时",
      "steps": [
        "选定1-3个习惯（时间管理/预习复习/专注/笔记/错题）；",
        "制作每日打卡表；",
        "连续21天以上打卡+每周自查；",
        "低中段以外部打卡为主，高段加自我监控；",
        "转自评与复盘。"
      ],
      "form": "worksheet",
      "severity": "low",
      "attributions": [
        "学习策略不足",
        "执行功能薄弱"
      ],
      "script": "先选1-3个习惯，每天打卡、每周自查，连续21天让好行为\"长\"在身上。",
      "duration": "连续21天以上",
      "expectedEffect": "产出：21天习惯打卡表",
      "effectNote": "选定1-3个习惯（时间管理/预习复习/专注/笔记/错题），每日打卡+每周自查，连续21天以上建立神经通路。",
      "outputArtifact": "21天习惯打卡表",
      "collaborativeTools": [
        "学生自我评价周报",
        "三方联合复盘会议模板"
      ],
      "prerequisiteTools": [
        "个性化辅导记录表"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [
        "元认知-计划",
        "元认知-调节资源"
      ],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "HERO心理资本成长档案",
      "whenToUse": "心理资本干预后，需持续记录四维心理资源成长轨迹时",
      "steps": [
        "定期（4/8/10周）记录PCQ复评得分；",
        "记录关键事件与成长叙事；",
        "绘制心理资本成长曲线；",
        "低段用图示，高段用自评；",
        "转团体辅导与复盘。"
      ],
      "form": "worksheet",
      "severity": "low",
      "attributions": [
        "希望感缺失",
        "自我效能感不足",
        "韧性不足"
      ],
      "script": "四块\"电池\"的电量变化记下来，4、8、10周各复评一次，画成成长曲线。",
      "duration": "4/8/10周复评",
      "expectedEffect": "产出：心理资本成长档案",
      "effectNote": "定期（4/8/10周）记录PCQ复评得分、关键事件、成长叙事，形成可视化的心理资本成长曲线。",
      "outputArtifact": "心理资本成长档案",
      "collaborativeTools": [
        "心育工程团体辅导方案",
        "三方联合复盘会议模板"
      ],
      "prerequisiteTools": [
        "HERO心理资本建设活动包"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "依恋关系改善反馈表",
      "whenToUse": "依恋修复活动实施后，需双向反馈关系质量变化时",
      "steps": [
        "学生与家长/教师分别评价安全感、信任、求助意愿；",
        "双向对照；",
        "识别关系改善信号；",
        "低段重依恋安全感，高段重自主信任；",
        "转沟通与氛围监测。"
      ],
      "form": "worksheet",
      "severity": "low",
      "attributions": [
        "依恋不安全倾向"
      ],
      "script": "孩子和家长各自评安全感、信任、求助意愿，两边对照着看变化。",
      "expectedEffect": "产出：关系改善反馈",
      "effectNote": "学生与家长/教师分别评价安全感、信任、求助意愿变化，双向对照，识别关系改善信号。",
      "outputArtifact": "关系改善反馈",
      "collaborativeTools": [
        "家校沟通日志模板",
        "“三通工程”家校沟通模板",
        "班级氛围变化监测表"
      ],
      "prerequisiteTools": [
        "依恋修复亲子活动指南"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [
        "风险项",
        "安全-依赖"
      ],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "班级氛围变化监测表",
      "whenToUse": "班级系统干预后，需定期监测整体氛围与生态改善时",
      "steps": [
        "从安全感/归属感/参与度/同伴生态/规则认同五维月度测评；",
        "绘制班级氛围趋势；",
        "标注改善与风险；",
        "阶段汇总；",
        "转同伴支持与复盘。"
      ],
      "form": "worksheet",
      "severity": "low",
      "attributions": [
        "班级系统生态问题"
      ],
      "script": "每个月从五个维度测一次班级氛围，画成趋势，看改善和风险。",
      "duration": "月度测评",
      "expectedEffect": "产出：班级氛围监测报告",
      "effectNote": "从安全感/归属感/参与度/同伴生态/规则认同五维定期（月度）测评，绘制班级氛围趋势。",
      "outputArtifact": "班级氛围监测报告",
      "collaborativeTools": [
        "同伴支持配对方案",
        "三方联合复盘会议模板"
      ],
      "prerequisiteTools": [
        "学校干预方案模板"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "学生自我评价周报",
      "whenToUse": "习惯养成期，需培养学生元认知与自我监控习惯时",
      "steps": [
        "每周学生自评习惯执行、困难、收获与下周目标；",
        "训练反思调控（元系统思维）；",
        "教师批阅反馈；",
        "高段为主，低段由家长代评；",
        "转辅导记录与复盘。"
      ],
      "form": "worksheet",
      "severity": "low",
      "attributions": [
        "元认知缺失"
      ],
      "script": "每周自己评：习惯执行得怎么样、遇到什么困难、下周目标是什么。",
      "duration": "每周一次",
      "expectedEffect": "产出：学生自评周报",
      "effectNote": "每周由学生自评习惯执行、困难、收获与下周目标，训练反思调控（元系统思维），教师批阅反馈。",
      "outputArtifact": "学生自评周报",
      "collaborativeTools": [
        "个性化辅导记录表",
        "三方联合复盘会议模板"
      ],
      "prerequisiteTools": [
        "学习习惯21天追踪表"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [
        "元认知-监控",
        "元认知-调节资源"
      ],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "家长观察反馈表",
      "whenToUse": "家庭端需反馈学生行为变化、方案执行与家庭氛围时",
      "steps": [
        "家长每周记录居家行为、情绪、作业、亲子互动；",
        "附困惑与建议；",
        "回传班主任；",
        "低段重陪读，高段重自主；",
        "转沟通与关系反馈。"
      ],
      "form": "worksheet",
      "severity": "low",
      "attributions": [
        "家庭养育环境风险"
      ],
      "script": "这一周在家里的情绪、作业、亲子互动有什么变化，记下来回传给我。",
      "duration": "每周一次",
      "expectedEffect": "产出：家长观察反馈",
      "effectNote": "家长每周记录学生居家行为、情绪、作业、亲子互动变化，附困惑与建议，回传班主任。",
      "outputArtifact": "家长观察反馈",
      "collaborativeTools": [
        "家校沟通日志模板",
        "家长指导手册（分主题）",
        "依恋关系改善反馈表"
      ],
      "prerequisiteTools": [
        "家长指导手册（分主题）"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "教师效果评估表",
      "whenToUse": "阶段末需由教师评估干预效果与方案适配度时",
      "steps": [
        "阶段末从认知/学业/心理/关系/习惯五维评估变化；",
        "评价方案可行性；",
        "列出需调整项；",
        "作为复评与再归因输入；",
        "转复评与复盘。"
      ],
      "form": "worksheet",
      "severity": "low",
      "attributions": [
        "学业差距与偏科",
        "学习策略不足"
      ],
      "script": "阶段末从五个维度评估变化幅度，方案可行性怎么样、哪里要调整。",
      "expectedEffect": "产出：教师效果评估",
      "effectNote": "从认知/学业/心理/关系/习惯五维评估变化幅度、方案可行性、需调整项，作为复评与再归因输入。",
      "outputArtifact": "教师效果评估",
      "collaborativeTools": [
        "三方联合复盘会议模板"
      ],
      "prerequisiteTools": [
        "个性化辅导记录表"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "三方联合复盘会议模板",
      "whenToUse": "10周周期末或阶段关键节点，需学生/家庭/学校联合复盘时",
      "steps": [
        "周期末或关键节点召开三方复盘；",
        "按\"成效回顾-归因验证-问题复盘-下一阶段\"流程；",
        "明确各方发言与决议；",
        "形成纪要；",
        "转方案迭代与复评。"
      ],
      "form": "framework",
      "severity": "medium",
      "attributions": [
        "学业差距与偏科",
        "学业情绪困扰"
      ],
      "script": "我们按\"成效回顾→归因验证→问题复盘→下一阶段\"四步走，把决议写进纪要。",
      "expectedEffect": "产出：复盘会议纪要",
      "effectNote": "提供复盘流程（成效回顾-归因验证-问题复盘-下一阶段），明确各方发言与决议，形成闭环。",
      "outputArtifact": "复盘会议纪要",
      "collaborativeTools": [
        "三方协作进度追踪表"
      ],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "元系统思维习惯养成卡",
      "whenToUse": "思维训练后，需将结构化思考固化为日常习惯时",
      "steps": [
        "每日/每周\"归类-链条-反思\"三步思维卡；",
        "微任务打卡；",
        "配合思维训练进度；",
        "低段重示范，高段重自主；",
        "转习惯与自评。"
      ],
      "form": "checklist",
      "severity": "low",
      "attributions": [
        "元系统思维薄弱",
        "元认知缺失"
      ],
      "script": "每天三步微任务：归类、链条、反思，打卡养成结构化思考的习惯。",
      "expectedEffect": "产出：思维习惯卡",
      "effectNote": "每日/每周思维习惯卡（归类-链条-反思三步），微任务打卡，配合思维训练进度。",
      "outputArtifact": "思维习惯卡",
      "collaborativeTools": [
        "学习习惯21天追踪表",
        "学生自我评价周报"
      ],
      "prerequisiteTools": [
        "元系统思维训练进度表"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [
        "认知-组织",
        "元认知-监控"
      ],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "项目化学习成果展示",
      "whenToUse": "项目结题，需以成果作为正向反馈与习惯固化时",
      "steps": [
        "项目结题组织成果展示（海报/路演/作品）；",
        "强化成就感与效能感；",
        "作为正向强化事件；",
        "记录展示过程；",
        "转自评与成长档案。"
      ],
      "form": "framework",
      "severity": "low",
      "attributions": [
        "自我效能感不足",
        "项目小组协作障碍"
      ],
      "script": "把成果晒出来：海报、路演、作品都行，让成就感成为坚持的动力。",
      "expectedEffect": "产出：成果展示记录",
      "effectNote": "组织学生展示项目成果（海报/路演/作品），强化成就感与效能感，作为习惯养成的正向强化事件。",
      "outputArtifact": "成果展示记录",
      "collaborativeTools": [
        "学生自我评价周报",
        "HERO心理资本成长档案"
      ],
      "prerequisiteTools": [
        "项目化学习辅导记录"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "五家课程成长档案",
      "whenToUse": "长期追踪学生在五家课程中的成长与优势发展时",
      "steps": [
        "汇集五家课程作品、评价、展示与效能变化；",
        "形成成长轨迹；",
        "支撑以优带弱规划；",
        "阶段更新；",
        "转自评与成长档案。"
      ],
      "form": "worksheet",
      "severity": "low",
      "attributions": [
        "自我效能感不足"
      ],
      "script": "把作品、评价、展示和效能变化都收进来，形成孩子的成长轨迹。",
      "expectedEffect": "产出：五家成长档案",
      "effectNote": "汇集五家课程作品、评价、展示与效能变化，形成成长轨迹，支撑以优带弱的持续规划。",
      "outputArtifact": "五家成长档案",
      "collaborativeTools": [
        "学生自我评价周报",
        "HERO心理资本成长档案"
      ],
      "prerequisiteTools": [
        "五家课程个性化匹配表"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    },
    {
      "name": "心育工程习惯日记",
      "whenToUse": "心理习惯（积极归因/情绪调节/挫折恢复）养成期，需日记式追踪时",
      "steps": [
        "每日记录情绪事件、应对方式、积极发现；",
        "训练乐观归因与韧性；",
        "教师定期批阅；",
        "低段重情绪命名，高段重认知重评；",
        "转成长档案与复盘。"
      ],
      "form": "worksheet",
      "severity": "low",
      "attributions": [
        "学业情绪困扰",
        "韧性不足"
      ],
      "script": "每天记一件事：发生了什么、我怎么应对的、今天有什么积极发现。",
      "duration": "每日记录",
      "expectedEffect": "产出：心育习惯日记",
      "effectNote": "每日记录情绪事件、应对方式、积极发现，训练乐观归因与韧性，教师定期批阅。",
      "outputArtifact": "心育习惯日记",
      "collaborativeTools": [
        "HERO心理资本成长档案",
        "三方联合复盘会议模板"
      ],
      "prerequisiteTools": [
        "心育工程团体辅导方案"
      ],
      "alternativeTools": [],
      "advancedTools": [],
      "dimensions": [],
      "evidenceSource": "学习问题智能辅导系统-工具库-更新版（2026-07-27）",
      "stepDetails": [],
      "contraindications": [],
      "crossModuleTags": [],
      "prohibition": "不用于替代危机处置；涉及安全风险时优先走转介流程",
      "preparation": "",
      "materials": "",
      "outcomeIndicator": "",
      "failureCriteria": ""
    }
  ],
  "keywords": [
    {
      "core": [
        "走神",
        "分心",
        "坐不住",
        "多动"
      ],
      "expanded": [
        "注意力不集中",
        "上课走神",
        "静不下来"
      ],
      "exclude": [],
      "category": "注意力",
      "scale": "SNAP-IV注意力筛查",
      "tool": "注意力筛查量表（SNAP-IV）",
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "注意力与多动信号，引导 SNAP-IV 筛查"
    },
    {
      "core": [
        "ADHD",
        "多动症",
        "注意缺陷"
      ],
      "expanded": [],
      "exclude": [],
      "category": "注意力",
      "scale": "SNAP-IV注意力筛查",
      "matchMode": "exact",
      "risk": "orange",
      "description": "ADHD 相关表述，引导筛查并提示专业评估"
    },
    {
      "core": [
        "作业拖拉",
        "拖延",
        "不交作业",
        "磨蹭"
      ],
      "expanded": [
        "作业总是不交",
        "拖着不做"
      ],
      "exclude": [],
      "category": "学习行为",
      "scale": "课堂观察评定",
      "tool": "班级观察记录表",
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "作业与学习行为信号"
    },
    {
      "core": [
        "偏科",
        "瘸腿",
        "成绩下滑",
        "退步"
      ],
      "expanded": [
        "越来越差",
        "跟不上"
      ],
      "exclude": [],
      "category": "学业表现",
      "scale": "成绩趋势与学科诊断",
      "tool": "学业能力差距分析表",
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "成绩薄弱与偏科信号"
    },
    {
      "core": [
        "三年级",
        "突然变差",
        "断层"
      ],
      "expanded": [],
      "exclude": [],
      "category": "学业表现",
      "scale": "成绩趋势与学科诊断",
      "tool": "学业能力差距分析表",
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "三年级现象与知识断层信号"
    },
    {
      "core": [
        "听不懂",
        "记不住",
        "学不会"
      ],
      "expanded": [
        "讲了也不会",
        "一变就不会"
      ],
      "exclude": [],
      "category": "学习策略",
      "scale": "学习策略量表",
      "tool": "学习策略量表（MAI）",
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "策略缺失信号"
    },
    {
      "core": [
        "不想学",
        "没兴趣",
        "厌学",
        "敷衍"
      ],
      "expanded": [
        "懒得学",
        "提不起劲"
      ],
      "exclude": [],
      "category": "学习动机",
      "scale": "学习动机量表",
      "tool": "学习动机量表",
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "学习动机缺失信号"
    },
    {
      "core": [
        "考试紧张",
        "考试焦虑",
        "怕考试"
      ],
      "expanded": [
        "考前睡不着",
        "考砸了"
      ],
      "exclude": [],
      "category": "学业情绪",
      "scale": "学业情绪量表",
      "tool": "心育工程主题活动方案",
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "考试焦虑信号"
    },
    {
      "core": [
        "我就是学不会",
        "我很笨",
        "没救了"
      ],
      "expanded": [
        "再努力也没用",
        "放弃了"
      ],
      "exclude": [],
      "category": "自我效能",
      "scale": "学习动机量表",
      "tool": "HERO心理资本量表（PCQ）",
      "matchMode": "fuzzy",
      "risk": "orange",
      "description": "习得性无助与效能感不足信号"
    },
    {
      "core": [
        "和爸妈关系",
        "不跟爸妈说",
        "怕父母",
        "亲子"
      ],
      "expanded": [
        "和家里闹矛盾"
      ],
      "exclude": [],
      "category": "亲子关系",
      "scale": "依恋关系评估",
      "tool": "依恋安全量表（Kerns）",
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "亲子依恋相关信号"
    },
    {
      "core": [
        "上课状态",
        "课堂表现",
        "听讲"
      ],
      "expanded": [
        "上课不听",
        "课堂纪律"
      ],
      "exclude": [],
      "category": "课堂行为",
      "scale": "课堂观察评定",
      "tool": "班级观察记录表",
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "课堂行为观察信号"
    },
    {
      "core": [
        "被孤立",
        "没朋友",
        "同伴排斥"
      ],
      "expanded": [
        "被同学欺负",
        "不敢交朋友"
      ],
      "exclude": [],
      "category": "同伴关系",
      "tool": "同伴支持配对方案",
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "同伴关系问题信号"
    },
    {
      "core": [
        "怕老师",
        "和老师关系"
      ],
      "expanded": [
        "不敢问老师"
      ],
      "exclude": [],
      "category": "师生关系",
      "tool": "依恋类型识别对照表",
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "师生关系紧张信号"
    },
    {
      "core": [
        "家庭",
        "父母吵架",
        "家里影响"
      ],
      "expanded": [
        "家里没人管",
        "家长太严"
      ],
      "exclude": [],
      "category": "家庭环境",
      "tool": "家庭养育环境访谈提纲",
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "家庭因素参与学习问题信号"
    },
    {
      "core": [
        "小组",
        "项目",
        "合作困难"
      ],
      "expanded": [
        "组里推诿",
        "没人干活"
      ],
      "exclude": [],
      "category": "六力特色",
      "tool": "项目化学习参与度观察",
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "项目化小组协作问题信号"
    },
    {
      "core": [
        "思维乱",
        "逻辑不清",
        "不会思考"
      ],
      "expanded": [
        "一听就懂一做就错"
      ],
      "exclude": [],
      "category": "六力特色",
      "scale": "学习策略量表",
      "tool": "元系统思维水平评估",
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "元系统思维薄弱信号"
    },
    {
      "core": [
        "手机",
        "屏幕",
        "晚睡",
        "睡眠"
      ],
      "expanded": [
        "玩手机",
        "熬夜"
      ],
      "exclude": [],
      "category": "生活习惯",
      "tool": "家庭养育环境访谈提纲",
      "matchMode": "fuzzy",
      "risk": "yellow",
      "description": "生活习惯风险因素"
    }
  ],
  "defaultLevelName": "暂无明显信号",
  "defaultMessage": "本次评估暂未发现需要重点干预的学习问题信号，当前状态相对平稳，建议保持现有节奏，持续观察课堂表现与成绩趋势。"
}
