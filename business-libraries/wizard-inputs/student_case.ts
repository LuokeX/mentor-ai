import type { WizardInput } from '../../shared/business-wizard'

// ============================================================================
// student_case 模块向导输入（v4.2.0）
// 来源：学生个体问题 2.0 版本文档集（docs/2.0学生个体问题说明文档/）
//   - 合并量表_一键计算器.xlsx：45 题答题卡（Track A 信号筛查 15 题 + Track B 六维能力评估 30 题）、
//     自动计算表（十五型编码权重矩阵、六维 A-E 等级）
//   - 合并量表_5D6D_一表双轨_V1.0.docx：FREQ_5 + SSF 计分口径（5→1.0/4→0.7/3→0.4/2→0.1/1→0.0），
//     编码积分=Σ(权重×SSF)，激活阈值≥5；六维 A≥22/B 18-21/C 13-17/D 8-12/E≤7；交叉验证规则
//   - 学生个体问题_术语库_专业技术说明_V2.0.xlsx：03 五类十五型编码、04 一表双轨评估体系、05 五级响应机制、
//     06 六维能力评估、07 干预技术 T1-T12、08 S0-S5 诊疗流程、09 依恋类型、13 安全红线 SA01-SA07
//   - 班主任干预技术处方库_V1.0.xlsx：① 处方速查表 20 条、② 技术详解卡 T1-T10、⑦ 心智化话术库、⑨ 家校沟通处方
//   - 小学部学生个体问题解决手册_V6.0.docx：三级响应 L1 班级自主/L2 年级协同/L3 中心会商、五级响应时间窗口、
//     转介标准（E1/E2→家庭依恋评估→专业转介、T12 12 周无效→心理教师）、质量红线三条、安全底线四条
//   - 学生个体问题_业务指导手册_V3.0.docx：平台落地口径（预警级别判定、编码激活规则：每题≥3 计触发、
//     触发题权重（3 或 5）累加≥5 激活；六维 A-E 分界）
// 口径统一决策：
//   - 计分统一用 FREQ_5 + SSF 口径（5D6D 文档为准）；六维 D/E 分界 ≤12
//   - 处方库「响应级别 L1-L3（紧急/重点/常规）」是另一套命名，映射为工具 severity（L3→high/L2→medium/L1→low），
//     与五级响应（红/橙/黄/蓝/紫）不混淆
//   - 干预技术以术语库 07 为准（T1 定时器分段法/T2 注意力信号约定/T3 渐进参与计划/T4 三步行为契约/T4+ 关系修复目标/
//     T7 情绪命名与接纳/T8 优势发现日记/T9 社交剧本练习/T10 友谊桥同伴配对/T11 优势锚定法/T11+ 优势验证环节/T12 心智化回应技术），
//     处方库中的 T5/T6/T7-T10 编号按内容对齐到术语库编号；T5/T6 在术语库中也缺失，不编造
//   - 十五型编码信号来源题号以术语库 03「信号来源(题号)」列为准（与一键计算器自动计算表一致）
//   - 能力题（Track B）为「状态越好分越高」，reverse=true 归一为问题分；信号题 reverse=false
// ============================================================================
export const STUDENT_CASE_WIZARD_INPUT: WizardInput = {
  "module": "student_case",
  "version": "4.2.0",
  "sourceRef": "学生个体问题 2.0 文档集（5D6D 一表双轨/处方库 V1.0/术语库 V2.0/手册 V6.0/业务指导手册 V3.0）",
  "defaults": {
    "schoolSection": "all",
    "targetAudience": "teacher",
    "formType": "observation",
    "triggerMethod": "manual",
    "frequency": "per_case",
    "resultVisibility": "teacher_only",
    "responsibleRole": "班主任",
    "dataSensitivity": "highly_sensitive",
    "sourceType": "proprietary",
    "evidenceLevel": "A",
    "redLineScope": "module",
    "redLineActions": "暂停常规评估，立即启动学校安全流程，通知年级组长与德育处，24小时内完成安全评估与安全计划，必要时转心理健康中心",
    "redLineRecovery": "心理健康中心/危机小组专业评估确认安全风险解除后，恢复常规评估与干预流程",
    "redLineOwner": "班主任（联动年级组长、德育处、心理健康中心）"
  },
  "computedVariables": [],
  "optionGroups": [],
  "scales": [
    {
      "name": "信号筛查",
      "role": "入口筛查",
      "shortName": "五维信号筛查",
      "description": "15 题信号型题目（Track A）：教师按频率评定学生问题信号的出现频次（FREQ_5），按映射矩阵将权重（核心 5/关联 3）累加至十五型编码，积分≥5 激活。用于全班普查与学期初筛查，单独可输出初步编码和响应级别。",
      "minutes": 3,
      "prerequisites": [],
      "exclusives": [],
      "triggerConditions": [],
      "usageTiming": "学期初全班普查或速查模式（约 3 分钟）",
      "reAssessmentIntervalDays": 180,
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "安全防护",
          "calcMethod": "sum",
          "weight": 1,
          "description": "体罚/暴力/忽视与被欺凌/排斥等安全信号（纯信号维度，最高优先级）",
          "highInterpretation": "维度总分≥6 标记为安全预警；任一题≥4 分直接触发红色紧急响应",
          "lowInterpretation": "维度总分<6，无安全信号"
        },
        {
          "name": "学会学习",
          "calcMethod": "sum",
          "weight": 1,
          "description": "成绩偏低、作业敷衍、需反复催促等学习信号",
          "highInterpretation": "维度总分≥9（≥2 题触发）标记该维度",
          "lowInterpretation": "维度总分<9，暂不标记"
        },
        {
          "name": "行为适应",
          "calcMethod": "sum",
          "weight": 1,
          "description": "课堂点名、肢体冲突、物品混乱等行为信号",
          "highInterpretation": "维度总分≥9（≥2 题触发）标记该维度",
          "lowInterpretation": "维度总分<9，暂不标记"
        },
        {
          "name": "情绪管理",
          "calcMethod": "sum",
          "weight": 1,
          "description": "不举手、情绪过激、自我否定等情绪信号",
          "highInterpretation": "维度总分≥9（≥2 题触发）标记该维度",
          "lowInterpretation": "维度总分<9，暂不标记"
        },
        {
          "name": "人际关系",
          "calcMethod": "sum",
          "weight": 1,
          "description": "独处、不会加入同伴游戏等社交信号",
          "highInterpretation": "维度总分≥6（≥2 题触发）标记该维度",
          "lowInterpretation": "维度总分<6，暂不标记"
        },
        {
          "name": "家庭环境",
          "calcMethod": "sum",
          "weight": 1,
          "description": "亲子沟通障碍、家庭支持缺位等家庭信号（纯信号维度，无 6D 能力对应）",
          "highInterpretation": "维度总分≥6 标记该维度；E 类编码激活直接触发高响应",
          "lowInterpretation": "维度总分<6，暂不标记"
        }
      ],
      "questions": [
        { "text": "是否有体罚、暴力或忽视迹象", "dimension": "安全防护", "optionGroup": "FREQ_5", "reverse": false },
        { "text": "是否被欺凌或明显排斥", "dimension": "安全防护", "optionGroup": "FREQ_5", "reverse": false },
        { "text": "是否有科目持续低于75分", "dimension": "学会学习", "optionGroup": "FREQ_5", "reverse": false },
        { "text": "作业是否经常不交或敷衍了事", "dimension": "学会学习", "optionGroup": "FREQ_5", "reverse": false },
        { "text": "是否需反复催促才开始学习任务", "dimension": "学会学习", "optionGroup": "FREQ_5", "reverse": false },
        { "text": "是否每天被点名提醒2次及以上", "dimension": "行为适应", "optionGroup": "FREQ_5", "reverse": false },
        { "text": "一周内是否发生肢体冲突", "dimension": "行为适应", "optionGroup": "FREQ_5", "reverse": false },
        { "text": "物品整理是否长期混乱、常丢东西", "dimension": "行为适应", "optionGroup": "FREQ_5", "reverse": false },
        { "text": "是否从不或极少主动举手发言", "dimension": "情绪管理", "optionGroup": "FREQ_5", "reverse": false },
        { "text": "是否有与情境不成比例的强烈情绪", "dimension": "情绪管理", "optionGroup": "FREQ_5", "reverse": false },
        { "text": "是否常说「我不行」「我太笨了」", "dimension": "情绪管理", "optionGroup": "FREQ_5", "reverse": false },
        { "text": "自由活动时间是否通常独自一人", "dimension": "人际关系", "optionGroup": "FREQ_5", "reverse": false },
        { "text": "是否不会用恰当方式加入同伴游戏", "dimension": "人际关系", "optionGroup": "FREQ_5", "reverse": false },
        { "text": "亲子沟通是否存在明显障碍", "dimension": "家庭环境", "optionGroup": "FREQ_5", "reverse": false },
        { "text": "家庭支持是否明显缺位", "dimension": "家庭环境", "optionGroup": "FREQ_5", "reverse": false }
      ]
    },
    {
      "name": "六维能力评估",
      "role": "深度诊断",
      "shortName": "六维评估",
      "description": "30 题能力型题目（Track B，Q16-Q45）：教师按频率评定学生「能做到」的频次（FREQ_5），每维度 5 题求和（满分 25），对照 A-E 等级（A≥22/B 18-21/C 13-17/D 8-12/E≤7），统计 D/E 维度数量与 Track A 编码交叉验证。",
      "minutes": 13,
      "prerequisites": [
        "信号筛查"
      ],
      "exclusives": [],
      "triggerConditions": [
        {
          "targetType": "total",
          "target": "",
          "comparator": "达到或超过",
          "value": 18,
          "join": "且"
        }
      ],
      "triggerNote": "信号筛查出现信号（总分≥18）或需要深度评估时，建议补做后 30 题",
      "usageTiming": "速查模式发现信号后补做，或 L2/L3 级学生深度评估",
      "reAssessmentIntervalDays": 90,
      "applicableGrades": [],
      "applicableSubjects": [],
      "dimensionDefs": [
        {
          "name": "自我意识",
          "calcMethod": "sum",
          "weight": 1,
          "description": "认识自己基本属性、情绪状态、个人优势和局限的能力（基本身份认知、情绪识别、自我评价和错误承认）",
          "highInterpretation": "维度分≥18（原始分≤12，D/E 级）：自我认知严重不足或模糊，需重点关注",
          "lowInterpretation": "维度分≤12（原始分≥18，A/B 级）：自我认知发展良好"
        },
        {
          "name": "社会适应",
          "calcMethod": "sum",
          "weight": 1,
          "description": "遵守规则、完成学校基本作息、参与集体活动的能力（课堂适应、学校规则、集体责任感）",
          "highInterpretation": "维度分≥18（原始分≤12，D/E 级）：经常违反规则或需要大量外部约束，需重点关注",
          "lowInterpretation": "维度分≤12（原始分≥18，A/B 级）：规则遵守与集体适应良好"
        },
        {
          "name": "情绪管理",
          "calcMethod": "sum",
          "weight": 1,
          "description": "识别、表达和调控自身情绪的能力（情绪识别准确性、表达适度性、调节策略有效性）",
          "highInterpretation": "维度分≥18（原始分≤12，D/E 级）：情绪经常失控或调节策略缺失，需重点关注",
          "lowInterpretation": "维度分≤12（原始分≥18，A/B 级）：情绪识别与调节能力良好"
        },
        {
          "name": "人际关系",
          "calcMethod": "sum",
          "weight": 1,
          "description": "建立和维持同伴关系、理解和回应他人社交信号的能力（交友动机、社交技能、冲突处理）",
          "highInterpretation": "维度分≥18（原始分≤12，D/E 级）：经常独自一人或频繁冲突，需重点关注",
          "lowInterpretation": "维度分≤12（原始分≥18，A/B 级）：同伴关系建立与维护良好"
        },
        {
          "name": "学会学习",
          "calcMethod": "sum",
          "weight": 1,
          "description": "掌握学习方法、自我规划和主动求知的能力（学习习惯、方法运用、时间管理）",
          "highInterpretation": "维度分≥18（原始分≤12，D/E 级）：几乎没有学习方法或放弃学习尝试，需重点关注",
          "lowInterpretation": "维度分≤12（原始分≥18，A/B 级）：学习方法与自我规划良好"
        },
        {
          "name": "生涯认知",
          "calcMethod": "sum",
          "weight": 1,
          "description": "对未来、自我发展方向的初步思考和探索意愿（小学阶段以兴趣探索和成长意识为主）",
          "highInterpretation": "维度分≥18（原始分≤12，D/E 级）：兴趣模糊或对未来无所谓，需关注",
          "lowInterpretation": "维度分≤12（原始分≥18，A/B 级）：兴趣探索与成长意识良好"
        }
      ],
      "questions": [
        { "text": "能否准确说出自己的姓名、年龄、性别和所在班级", "dimension": "自我意识", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "能否识别并说出自己当前的情绪状态（开心/生气/难过/害怕）", "dimension": "自我意识", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "能否说出自己的至少2个优点或擅长的事情", "dimension": "自我意识", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "在做错事时能否承认自己的错误，不推卸责任", "dimension": "自我意识", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "对自己的能力是否有基本信心，愿意尝试新任务", "dimension": "自我意识", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "能否遵守课堂基本规则（举手发言、不随意离开座位）", "dimension": "社会适应", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "能否按时完成学校基本作息（准时到校、交作业、值日）", "dimension": "社会适应", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "在小组合作中能否完成分配的任务，配合他人工作", "dimension": "社会适应", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "面对规则变化或临时调课时，能否适应而不表现过度焦虑", "dimension": "社会适应", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "在不同教师的课堂上，行为是否基本一致", "dimension": "社会适应", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "情绪激动时，能否在教师或同伴安抚下逐渐平复", "dimension": "情绪管理", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "能否用语言（而非哭闹/攻击/摔东西）表达情绪需求", "dimension": "情绪管理", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "面对「等一等」或「不可以」时，能否接受而不立即崩溃", "dimension": "情绪管理", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "日常情绪状态是否基本稳定，无明显的大起大落", "dimension": "情绪管理", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "面对挫折时，能否自我安抚或主动求助", "dimension": "情绪管理", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "课间自由活动时，是否有固定的玩伴或朋友", "dimension": "人际关系", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "能否与同学分享文具、玩具或活动空间", "dimension": "人际关系", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "与同学发生冲突时，能否尝试用语言解决而非动手", "dimension": "人际关系", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "能否主动加入或被邀请加入集体活动", "dimension": "人际关系", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "能否理解他人的情绪并做出适当回应", "dimension": "人际关系", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "课堂上能否保持与年级相当的有效注意时间", "dimension": "学会学习", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "能否按步骤独立完成课堂任务", "dimension": "学会学习", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "遇到学习困难时，能否主动提问或寻求帮助", "dimension": "学会学习", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "能否使用至少一种基础学习策略（划线/复述/提纲/笔记）", "dimension": "学会学习", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "对自己的学习效果是否有基本判断（知道哪里会、哪里不会）", "dimension": "学会学习", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "能否说出至少2种常见职业及其基本工作内容", "dimension": "生涯认知", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "是否在角色扮演/游戏/课堂活动中表现出职业兴趣", "dimension": "生涯认知", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "能否清楚说出自己感兴趣的学科或活动", "dimension": "生涯认知", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "能否将当前学习内容与未来想做之事建立简单联系", "dimension": "生涯认知", "optionGroup": "FREQ_5", "reverse": true },
        { "text": "对自己的课余兴趣是否有基本认知，能坚持参与至少一项", "dimension": "生涯认知", "optionGroup": "FREQ_5", "reverse": true }
      ]
    }
  ],
  "attributions": [
    {
      "name": "注意力分散型",
      "description": "课堂走神、玩文具、完不成课堂任务。核心机制是注意力维持困难而非不愿学",
      "highSign": "课堂持续走神，需反复提醒；作业拖拉，完不成课堂任务",
      "typicalTrigger": "需区分发展性注意力波动（低年级正常）与病理性持续注意力缺陷；焦虑型依恋学生的走神可能是过度警觉",
      "action": "用 T1 定时器分段法+关系锚定，或 T2 注意力信号约定开始干预",
      "weight": 1.3,
      "tags": ["学习"]
    },
    {
      "name": "动机缺失型",
      "description": "对学业失去兴趣，不做不交作业。核心机制是内在动机系统被长期挫败感破坏",
      "highSign": "长期不交作业，对任何学科无兴趣",
      "typicalTrigger": "回避型依恋在学业中的典型表现：「反正做不好，不如不做」。不是懒，是习得性无助的自我防御",
      "action": "用 T11 优势锚定法（独立模式）通过优势通道激活学习动机",
      "weight": 1.3,
      "tags": ["学习"]
    },
    {
      "name": "技能不足型",
      "description": "由于识字量、计算能力或学习方法落后导致的学业困难",
      "highSign": "特定科目持续不及格，识字量/计算能力落后",
      "typicalTrigger": "与家庭支持密切相关。E3（支持缺位）学生的 A3 风险显著更高",
      "action": "用 T11 优势锚定（适配学习策略）+ T3 渐进参与（学业版）分级提升",
      "weight": 1,
      "tags": ["学习"]
    },
    {
      "name": "课堂纪律型",
      "description": "课堂讲话、随意走动、不遵守课堂基本规则",
      "highSign": "每天被点名提醒2次及以上",
      "typicalTrigger": "混乱型依恋学生的课堂纪律问题最难用常规行为管理解决——他们不是在挑战规则，是内部没有秩序感",
      "action": "用 T4 三步行为契约（可叠加 T2 信号约定与关系性肯定）",
      "weight": 1,
      "tags": ["行为"]
    },
    {
      "name": "规则习惯型",
      "description": "不按时完成任务、撒谎、物品整理混乱",
      "highSign": "作业长期不交或敷衍，物品经常丢失",
      "typicalTrigger": "回避型依恋在规则面前的典型防御：规则=控制，「遵守规则=被控制=不安全」",
      "action": "用 T4 三步行为契约（量化版：从「一课桌」整理开始）",
      "weight": 1,
      "tags": ["行为"]
    },
    {
      "name": "攻击冲动型",
      "description": "攻击性语言、肢体冲突、破坏物品",
      "highSign": "一周内发生1次以上肢体冲突",
      "typicalTrigger": "混乱型依恋的核心行为表现。攻击不是目的而是求救——对安全连接的极度渴望以扭曲方式表达",
      "action": "用 T4 三步行为契约（增加关系目标）+ T12 心智化回应（不撑不退）",
      "weight": 1.3,
      "tags": ["行为"]
    },
    {
      "name": "焦虑退缩型",
      "description": "过度紧张、回避挑战、恐惧社交。常伴有躯体症状",
      "highSign": "从不主动举手发言，回避社交场合",
      "typicalTrigger": "焦虑型依恋的核心表现。过度寻求安全信号却始终得不到满足→退缩",
      "action": "用 T3 渐进参与计划（安全基地启动优先），辅以 T8 优势发现日记",
      "weight": 1,
      "tags": ["情绪"]
    },
    {
      "name": "情绪调节型",
      "description": "情绪波动剧烈，与情境不成比例的愤怒/哭泣反应。可能与养育中的情绪忽视有关",
      "highSign": "情绪反应与情境不成比例；突然暴躁或崩溃",
      "typicalTrigger": "混乱型依恋的核心情绪表现形式。学生大脑的情绪警报系统长期处于高唤醒状态",
      "action": "用 T7 情绪命名与接纳 + T12 心智化回应（完整版），先稳定再上技术",
      "weight": 1.3,
      "tags": ["情绪"]
    },
    {
      "name": "低自尊型",
      "description": "认为自己不配被爱、不值得成功、做什么都不行",
      "highSign": "常说「我不行」「我太笨了」",
      "typicalTrigger": "所有不安全依恋类型的共同核心。被反复拒绝/忽视的体验内化→「我不值得」的内部工作模型",
      "action": "用 T8 优势发现日记（关系预热+具体到粒度的看见）+ T11 优势锚定法",
      "weight": 1.3,
      "tags": ["情绪"]
    },
    {
      "name": "同伴冲突型",
      "description": "经常与同伴争吵、抢夺、被排斥或参与排挤他人",
      "highSign": "经常与同学冲突或起争执",
      "typicalTrigger": "混乱型依恋的社交表现。对他人的意图高度警惕（过度归因敌意），因为从未体验过可预测的安全关系",
      "action": "用 T12 心智化回应（冲突调解三步），辅以 T4 行为契约（社交版）",
      "weight": 1,
      "tags": ["社交"]
    },
    {
      "name": "社交退缩型",
      "description": "自由活动时间独自一人，不主动接近同伴，但不排斥他人",
      "highSign": "自由活动时间通常独自一人",
      "typicalTrigger": "回避型依恋的社交策略：「与其被拒绝，不如不参与」。自我保护的选择而非能力缺陷",
      "action": "用 T10 友谊桥同伴配对（告知同伴角色重要性），辅以 T9 社交剧本练习",
      "weight": 1,
      "tags": ["社交"]
    },
    {
      "name": "技能缺失型",
      "description": "不会用恰当方式加入游戏或对话。愿意交朋友但不知道方法",
      "highSign": "不会用恰当方式加入同伴游戏",
      "typicalTrigger": "不同于社交退缩——D3 是能力问题而非动机问题。安全型依恋也可能出现 D3",
      "action": "用 T9 社交剧本练习（安全基地预热），辅以 T10 友谊桥提供实践场",
      "weight": 1,
      "tags": ["社交"]
    },
    {
      "name": "亲子紧张型",
      "description": "亲子沟通障碍、频繁冲突，家长教育方式不一致",
      "highSign": "亲子沟通存在明显障碍",
      "typicalTrigger": "不安全依恋的直接体现。家庭中的冲突模式被带入学校——学生对待老师的方式往往是家庭互动的镜像",
      "action": "用家校沟通指南（合作邀请模式+心智化话术·家长版），高年段可让学生参与三方沟通",
      "weight": 1.3,
      "tags": ["家庭"]
    },
    {
      "name": "教养不当型",
      "description": "体罚、言语羞辱、忽视或过度控制。最高安全风险编码",
      "highSign": "存在体罚、暴力或忽视迹象；安全维度≥4",
      "typicalTrigger": "直接对应混乱型依恋的成因。E2 学生大脑中的「安全系统」从未被正常激活过，最高响应级别",
      "action": "立即启动学校安全流程：通知年级组长+德育处，暂停学业干预，启动专业转介机制",
      "weight": 2,
      "tags": ["家庭", "安全"]
    },
    {
      "name": "支持缺位型",
      "description": "家庭对学生的学业、情感支持明显缺失。如留守儿童/单亲家长无力兼顾",
      "highSign": "家庭支持明显缺位",
      "typicalTrigger": "回避型依恋的常见环境成因：「求助也没用」→学会不求助→变成独立但不连接的回避策略",
      "action": "用 T11 优势锚定法（独立·S0 发展）以学校为安全基地，替代部分家庭功能",
      "weight": 1.3,
      "tags": ["家庭"]
    }
  ],
  "evidences": [
    {
      "attribution": "注意力分散型",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "3", "comparator": "达到或超过", "value": 3, "join": "或" },
        { "targetType": "question", "target": "4", "comparator": "达到或超过", "value": 3, "join": "或" },
        { "targetType": "question", "target": "5", "comparator": "达到或超过", "value": 3, "join": "或" },
        { "targetType": "question", "target": "6", "comparator": "达到或超过", "value": 3, "join": "或" },
        { "targetType": "question", "target": "8", "comparator": "达到或超过", "value": 3, "join": "或" }
      ],
      "weight": 1.5,
      "description": "注意力维持困难信号：走神/作业拖拉/需反复催促/物品混乱（关联信号，权重 3 归一 1.5）"
    },
    {
      "attribution": "动机缺失型",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "5", "comparator": "达到或超过", "value": 3, "join": "或" }
      ],
      "weight": 2,
      "description": "需反复催促才开始学习任务（核心信号，权重 5 归一 2）"
    },
    {
      "attribution": "动机缺失型",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "4", "comparator": "达到或超过", "value": 3, "join": "或" }
      ],
      "weight": 1.5,
      "description": "作业不交或敷衍（关联信号，权重 3 归一 1.5）"
    },
    {
      "attribution": "技能不足型",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "3", "comparator": "达到或超过", "value": 3, "join": "或" }
      ],
      "weight": 2,
      "description": "科目持续低于 75 分（核心信号，权重 5 归一 2）"
    },
    {
      "attribution": "课堂纪律型",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "6", "comparator": "达到或超过", "value": 3, "join": "或" }
      ],
      "weight": 2,
      "description": "每天被点名提醒 2 次及以上（核心信号，权重 5 归一 2）"
    },
    {
      "attribution": "规则习惯型",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "4", "comparator": "达到或超过", "value": 3, "join": "或" },
        { "targetType": "question", "target": "8", "comparator": "达到或超过", "value": 3, "join": "或" }
      ],
      "weight": 2,
      "description": "作业长期不交或敷衍、物品整理混乱（核心信号，权重 5 归一 2）"
    },
    {
      "attribution": "攻击冲动型",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "7", "comparator": "达到或超过", "value": 3, "join": "或" }
      ],
      "weight": 2,
      "description": "一周内发生肢体冲突（核心信号，权重 5 归一 2）"
    },
    {
      "attribution": "攻击冲动型",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "10", "comparator": "达到或超过", "value": 3, "join": "或" }
      ],
      "weight": 1.5,
      "description": "与情境不成比例的强烈情绪（关联信号，权重 3 归一 1.5）"
    },
    {
      "attribution": "焦虑退缩型",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "9", "comparator": "达到或超过", "value": 3, "join": "或" }
      ],
      "weight": 2,
      "description": "从不或极少主动举手发言（核心信号，权重 5 归一 2）"
    },
    {
      "attribution": "焦虑退缩型",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "2", "comparator": "达到或超过", "value": 3, "join": "或" },
        { "targetType": "question", "target": "11", "comparator": "达到或超过", "value": 3, "join": "或" },
        { "targetType": "question", "target": "12", "comparator": "达到或超过", "value": 3, "join": "或" }
      ],
      "weight": 1.5,
      "description": "被排斥/自我否定/独处等退缩信号（关联信号，权重 3 归一 1.5）"
    },
    {
      "attribution": "情绪调节型",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "10", "comparator": "达到或超过", "value": 3, "join": "或" }
      ],
      "weight": 2,
      "description": "与情境不成比例的强烈情绪（核心信号，权重 5 归一 2）"
    },
    {
      "attribution": "情绪调节型",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "14", "comparator": "达到或超过", "value": 3, "join": "或" }
      ],
      "weight": 1.5,
      "description": "亲子沟通明显障碍（关联信号，权重 3 归一 1.5）"
    },
    {
      "attribution": "低自尊型",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "11", "comparator": "达到或超过", "value": 3, "join": "或" }
      ],
      "weight": 2,
      "description": "常说「我不行」「我太笨了」（核心信号，权重 5 归一 2）"
    },
    {
      "attribution": "低自尊型",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "9", "comparator": "达到或超过", "value": 3, "join": "或" }
      ],
      "weight": 1.5,
      "description": "从不或极少主动举手发言（关联信号，权重 3 归一 1.5）"
    },
    {
      "attribution": "同伴冲突型",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "2", "comparator": "达到或超过", "value": 3, "join": "或" }
      ],
      "weight": 2,
      "description": "被欺凌或明显排斥（核心信号，权重 5 归一 2）"
    },
    {
      "attribution": "同伴冲突型",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "7", "comparator": "达到或超过", "value": 3, "join": "或" }
      ],
      "weight": 1.5,
      "description": "一周内发生肢体冲突（关联信号，权重 3 归一 1.5）"
    },
    {
      "attribution": "社交退缩型",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "12", "comparator": "达到或超过", "value": 3, "join": "或" }
      ],
      "weight": 2,
      "description": "自由活动时间通常独自一人（核心信号，权重 5 归一 2）"
    },
    {
      "attribution": "社交退缩型",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "13", "comparator": "达到或超过", "value": 3, "join": "或" }
      ],
      "weight": 1.5,
      "description": "不会用恰当方式加入同伴游戏（关联信号，权重 3 归一 1.5）"
    },
    {
      "attribution": "技能缺失型",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "13", "comparator": "达到或超过", "value": 3, "join": "或" }
      ],
      "weight": 2,
      "description": "不会用恰当方式加入同伴游戏（核心信号，权重 5 归一 2）"
    },
    {
      "attribution": "亲子紧张型",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "14", "comparator": "达到或超过", "value": 3, "join": "或" }
      ],
      "weight": 2,
      "description": "亲子沟通存在明显障碍（核心信号，权重 5 归一 2）"
    },
    {
      "attribution": "教养不当型",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "1", "comparator": "达到或超过", "value": 3, "join": "或" }
      ],
      "weight": 2,
      "description": "存在体罚、暴力或忽视迹象（核心信号，权重 5 归一 2）"
    },
    {
      "attribution": "教养不当型",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "15", "comparator": "达到或超过", "value": 3, "join": "或" }
      ],
      "weight": 1.5,
      "description": "家庭支持明显缺位（关联信号，权重 3 归一 1.5）"
    },
    {
      "attribution": "支持缺位型",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "15", "comparator": "达到或超过", "value": 3, "join": "或" }
      ],
      "weight": 2,
      "description": "家庭支持明显缺位（核心信号，权重 5 归一 2）"
    },
    {
      "attribution": "支持缺位型",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "1", "comparator": "达到或超过", "value": 3, "join": "或" }
      ],
      "weight": 1.5,
      "description": "存在体罚、暴力或忽视迹象（关联信号，权重 3 归一 1.5）"
    }
  ],
  "levels": [
    {
      "name": "红色-危机",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "question", "target": "1", "comparator": "达到或超过", "value": 4, "join": "或" },
        { "targetType": "question", "target": "2", "comparator": "达到或超过", "value": 4, "join": "或" }
      ],
      "redLine": true,
      "redLineAction": "暂停常规评估，立即启动学校安全流程，通知年级组长与德育处，24小时内完成安全评估与安全计划",
      "teacherMessage": "本次评估触发红色·紧急响应（安全防护题 1「体罚/暴力/忽视」或题 2「被欺凌/排斥」≥4 分）。请立即：①暂停常规评估与学业干预；②启动学校安全流程，通知年级组长与德育处；③做好家校安全沟通；④24 小时内完成安全评估与安全计划。保持学生处于有人陪伴的安全环境，不让学生独处。转介心理健康中心前请整理观察事实，不写诊断结论。",
      "resultNote": "SAFETY 维度（题1/题2）≥4 分，触发安全红线，需 24 小时内完成安全评估与安全计划",
      "escalationCondition": "安全风险未在 24 小时内解除，或出现自杀/自伤/严重攻击信号",
      "escalationTarget": "心理健康中心/危机小组（心理总监）",
      "reAssessTrigger": "安全计划确认后按危机小组要求复查",
      "notificationTemplate": "[学生个体问题·红色危机] 学生触发安全红线：题1/题2（体罚暴力/被欺凌排斥）≥4 分。已暂停常规评估并启动学校安全流程，请年级组长与德育处 24 小时内介入，通知家长并完成安全评估。",
      "interventionActions": [
        "立即启动学校安全流程，通知年级组长+德育处",
        "暂停常规评估与学业干预，优先安全",
        "家校安全沟通，24小时内完成安全评估与安全计划"
      ]
    },
    {
      "name": "橙色-警告",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "total", "target": "", "comparator": "达到或超过", "value": 45, "join": "且" }
      ],
      "redLine": false,
      "teacherMessage": "本次评估判定为橙色·高响应：≥3 个编码激活，或含 B/C 类编码且六维 D/E 维度≥3。请启动 L3 中心会商（心理教师主导，校领导+年级组长+班主任多角色协同），48 小时内完成 S2 全方位评估并制定综合干预方案，纳入年级组周例会讨论。",
      "resultNote": "≥3 个编码激活或六维 D/E≥3，进入 L3 中心会商",
      "escalationCondition": "多维度持续加重无缓解，或功能严重受损超过 4 周",
      "escalationTarget": "心理教师主导的中心会商（校领导+年级组长+班主任）",
      "reAssessTrigger": "每 2 周复评",
      "interventionActions": [
        "启动 S2 全方位评估（课堂观察/学生访谈/科任交叉/家长沟通/六维评估）",
        "制定综合干预方案，纳入年级组周例会讨论"
      ]
    },
    {
      "name": "黄色-预警",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "total", "target": "", "comparator": "达到或超过", "value": 30, "join": "且" },
        { "targetType": "question", "target": "1", "comparator": "低于或等于", "value": 3, "join": "且" },
        { "targetType": "question", "target": "2", "comparator": "低于或等于", "value": 3, "join": "且" }
      ],
      "redLine": false,
      "teacherMessage": "本次评估判定为黄色·中响应：≥2 个编码激活且无安全信号。请启动 L2 年级协同（年级组长+班主任，必要时心理教师参与），1 周内完成 S2 分层评估并制定组合处方，按双周记录进展。",
      "resultNote": "≥2 个编码激活（无安全信号），启动 L2 年级协同",
      "escalationCondition": "功能受损持续 2-4 周无缓解，或升级为≥3 个编码激活",
      "escalationTarget": "年级组长",
      "reAssessTrigger": "每 2 周复评",
      "interventionActions": [
        "启动 S2 分层评估（六维评估+优势测评）",
        "制定组合干预方案，按双周记录进展"
      ]
    },
    {
      "name": "蓝色-关注",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "total", "target": "", "comparator": "达到或超过", "value": 18, "join": "且" },
        { "targetType": "question", "target": "1", "comparator": "低于或等于", "value": 3, "join": "且" },
        { "targetType": "question", "target": "2", "comparator": "低于或等于", "value": 3, "join": "且" }
      ],
      "redLine": false,
      "teacherMessage": "本次评估判定为蓝色·低风险：仅 1 个编码激活（非 E 类）或六维仅 1 个维度 D/E。请按标准诊疗流程启动 L1 班级自主干预，使用对应干预技术（见处方库），1 个月内完成标准诊疗流程并按月记录进展。",
      "resultNote": "单一信号或单一短板，L1 班级自主干预",
      "escalationCondition": "单一信号持续 1 个月无改善，或转为多个编码激活",
      "escalationTarget": "年级组长（升级 L2 年级协同）",
      "reAssessTrigger": "每 2 周复评",
      "interventionActions": [
        "启动标准诊疗流程（S1→S2→S3→S4）",
        "使用对应编码的干预技术，按月记录进展"
      ]
    },
    {
      "name": "紫色-待观察",
      "scale": "信号筛查",
      "conditions": [
        { "targetType": "total", "target": "", "comparator": "低于或等于", "value": 17, "join": "且" }
      ],
      "redLine": false,
      "teacherMessage": "本次评估判定为紫色·待观察：无编码激活、无能力缺损。请纳入 S0 优势通道：安排优势测评（1-2 年级 50 题版/3-6 年级 20 题版），制定优势发展目标，每学期复查五维筛查一次；后续出现信号则转入 S1-S5 流程。",
      "resultNote": "无明确信号，纳入预防性关注台账与 S0 优势发展路径",
      "escalationCondition": "后续筛查出现维度标记（≥3 个）或编码激活",
      "escalationTarget": "S1→S2 分层评估",
      "reAssessTrigger": "每学期复评",
      "interventionTools": ["优势发展通道（S0）"],
      "interventionActions": [
        "安排优势测评，制定优势发展目标（S0 优势发展路径）",
        "纳入预防性关注台账，每学期末复查五维筛查"
      ]
    }
  ],
  "tools": [
    {
      "name": "学校安全流程响应（E2教养不当）",
      "attributions": ["教养不当型"],
      "whenToUse": "存在体罚、言语羞辱或忽视证据；教养方式极端化；父母间教养严重不一致",
      "steps": [
        "立即启动学校安全流程，暂停学业干预，优先安全",
        "通知年级组长与德育处，24 小时内完成安全评估与安全计划",
        "通过学校正式渠道启动未成年人保护流程，记录具体信号（只记录不推测）",
        "联系心理总监进行安全评估，家校安全沟通"
      ],
      "form": "checklist",
      "severity": "high",
      "script": "我理解您的担心。关于 XX 的情况，我们通过学校正规渠道一起来处理，确保孩子的安全是第一位的。",
      "prohibition": "不要自行联系家长「了解情况」（可能加重家庭暴力）；不要让学生「证明」受伤（二次伤害）；不要承诺保密；不要自行调查或调解家庭内部事务",
      "timePerSession": "立即响应",
      "duration": "24 小时内完成安全评估",
      "expectedEffect": "24 小时内启动响应；安全风险解除",
      "effectNote": "E2 为最高安全风险编码（★★★★★），安全永远先于学业和行为",
      "outputArtifact": "安全事件记录",
      "failureCriteria": "安全风险未解除→持续按红线流程执行，转心理健康中心专业转介",
      "dimensions": ["安全防护"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "小学部学生个体问题解决手册 V6.0 / 术语库 V2.0 SA03-SA04"
    },
    {
      "name": "亲子紧张家校沟通（E1）",
      "attributions": ["亲子紧张型"],
      "whenToUse": "孩子表达对某家长恐惧或不满；家长说「管不了」；在校与家庭行为差异显著",
      "steps": [
        "开场陈述观察到的事实而非结论（不做诊断不贴标签）",
        "呈现 2-3 个可选方案供家长选择（给选项，不给任务）",
        "强调「我们一起」，让家长有掌控感和参与感",
        "用心智化话术·家长版沟通，从「纠错模式」切换到「连接模式」"
      ],
      "form": "script",
      "severity": "medium",
      "script": "我注意到 XX 最近有些变化——[具体描述 1-2 个客观行为]。我想和您一起了解一下，看看我们各自可以怎么帮他。您方便聊聊吗？",
      "prohibition": "不在孩子面前批评其家长；不给家长贴「不合格」标签；不在群聊中讨论学生个人情况；不替孩子「告密」也不帮孩子「隐瞒」",
      "timePerSession": "15-30 分钟",
      "duration": "按需沟通，建立每周固定节奏",
      "expectedEffect": "家长回应率>80%；学生情绪安全感提升",
      "failureCriteria": "家长拒绝沟通→改用书面+给选项模式；关系持续恶化→启动 E2 评估",
      "dimensions": ["家庭环境"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "班主任干预技术处方库 V1.0（① 处方速查表 E1 / ⑨ 家校沟通处方）"
    },
    {
      "name": "三步行为契约·攻击冲动（B3）",
      "attributions": ["攻击冲动型"],
      "whenToUse": "周内发生肢体冲突；常说伤人的话；冲动控制明显弱于同龄",
      "steps": [
        "共定目标：具体可测（如「老师叫我名字时我能站起来」而非「认真听讲」）",
        "明确奖励：首选社会性奖励（自由时间/当小助手/优先选择权），物质奖励辅助",
        "每日复盘：放学 30 秒复盘——做到了吗？为什么？明天怎么调整？",
        "依恋增强版：增加关系目标——「当你沮丧或想发火时，可以来找我，我们一起想办法」"
      ],
      "form": "framework",
      "severity": "medium",
      "script": "这一周，当你感到沮丧或想发火时，可以来找我，我们一起想办法。你愿意来找我，这本身就是最大的进步。",
      "prohibition": "不要在冲突过程中训斥（高唤醒状态下训斥无效）；不要当众羞辱；目标必须具体可测",
      "timePerSession": "5 分钟",
      "duration": "2 周一个周期",
      "expectedEffect": "1 周目标达标率>60%；2 周>80%；冲突频率下降",
      "failureCriteria": "ABC 分析回溯触发原因；目标再分小一半；体动优势→运动释放能量替代攻击",
      "dimensions": ["行为适应"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "班主任干预技术处方库 V1.0（① 处方速查表 B3 / ② 技术详解卡 T4）"
    },
    {
      "name": "注意力分散干预处方（A1）",
      "attributions": ["注意力分散型"],
      "whenToUse": "月内教师多次提醒；作业完成时间远超同龄；课堂切换需反复提醒",
      "steps": [
        "关系锚定（约 30 秒）：蹲下平视——「我就在旁边，做完这一段你可以随时来找我核对」",
        "把任务分成 5-10 分钟小段，每段一个明确目标",
        "用可视化定时器倒计时，完成一段休息 2 分钟，3 段=较大奖励",
        "叠加 T2 注意力信号约定：私下约定暗号，走神时用暗号提醒不做语言批评"
      ],
      "form": "framework",
      "severity": "low",
      "script": "这个暗号是我们俩之间的小秘密——它代表「我知道你在努力，我看到了」。",
      "prohibition": "奖励首选社会性奖励（自由时间/当小助手），物质奖励辅助；定时器必须可视化；暗号必须非惩罚性",
      "timePerSession": "5-10 分钟/段",
      "duration": "每天×2 周",
      "expectedEffect": "1 周作业效率改善；1-2 周走神次数显著下降",
      "failureCriteria": "段长缩短至 3 分钟甚至 1 分钟；确认是否难度超载→先降任务难度",
      "dimensions": ["学会学习"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "班主任干预技术处方库 V1.0（① 处方速查表 A1 / ② 技术详解卡 T1-T2）"
    },
    {
      "name": "动机缺失干预处方（A2）",
      "attributions": ["动机缺失型"],
      "whenToUse": "成功失败均无明显情绪；需反复催促才开始；不主动不求助不逃避",
      "steps": [
        "优势定位：调取优势测评 Top2-3 类型（未测评→安排测评或教师观察法）",
        "优势-问题匹配：用优势通道激活学习动机（如身体动觉型→运动间歇奖励）",
        "叠加 T4 三步行为契约（动机版）：共定目标+社会性奖励+每日复盘",
        "2 周评估：优势通道是否奏效，无效则复查定位或调整匹配路径"
      ],
      "form": "framework",
      "severity": "low",
      "script": "我想和你一起发现你的优点——不是因为你有问题要改正，而是因为我想更多了解你好的那一面。",
      "prohibition": "不把「懒」「不上进」当标签贴给学生；避免纯补偿式「缺啥补啥」干预",
      "timePerSession": "15 分钟",
      "duration": "持续，2 周验证优势假设",
      "expectedEffect": "通过优势通道激活学习动机；2 周内出现主动行为",
      "failureCriteria": "优势定位可能不准→复查测评或观察；任务难度与优势通道不匹配→调整匹配路径",
      "dimensions": ["学会学习"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "班主任干预技术处方库 V1.0（① 处方速查表 A2）"
    },
    {
      "name": "技能不足干预处方（A3）",
      "attributions": ["技能不足型"],
      "whenToUse": "某科持续低于 75 分；基础技能落后；已努力但效果不佳；非广泛性",
      "steps": [
        "确认是否学科基础技能落后（识字量/计算能力/学习方法）",
        "优势锚定学习策略：空间型→思维导图，逻辑型→归纳分析",
        "降任务难度分级：从当前水平+1 级开始，小步胜利",
        "叠加 T3 渐进参与计划（学业版）逐步建立学习信心"
      ],
      "form": "framework",
      "severity": "low",
      "expectedEffect": "4 周内薄弱科目出现改善迹象",
      "failureCriteria": "降任务难度分级→从当前水平+1 级开始；空间型优势→思维导图学习法",
      "dimensions": ["学会学习"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "班主任干预技术处方库 V1.0（① 处方速查表 A3）"
    },
    {
      "name": "课堂纪律干预处方（B1）",
      "attributions": ["课堂纪律型"],
      "whenToUse": "每日被点名提醒多次；行为影响其他同学；对指令选择性听从",
      "steps": [
        "T4 三步行为契约：共定具体可测目标（如「前 15 分钟不讲话」）",
        "明确社会性奖励，低年段当日兑现、高年段延迟至周末",
        "每日复盘 30 秒，记录达标情况",
        "叠加 T2 注意力信号约定，减少语言批评"
      ],
      "form": "framework",
      "severity": "low",
      "expectedEffect": "1 周目标达标率>60%；课堂干扰减少",
      "failureCriteria": "目标再分小一半；问孩子「你想要什么奖励」；ABC 分析回溯",
      "dimensions": ["行为适应"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "班主任干预技术处方库 V1.0（① 处方速查表 B1）"
    },
    {
      "name": "规则习惯干预处方（B2）",
      "attributions": ["规则习惯型"],
      "whenToUse": "作业经常不交/潦草；物品整理混乱常丢东西；时间概念弱常迟到",
      "steps": [
        "T4 三步行为契约：从最易改变的习惯入手（如「一课桌」整理）",
        "优势锚定量化版：逻辑型→计分系统、图表追踪；动觉型→动作化规则",
        "每日复盘+每周奖励",
        "2 周评估达标率，持续调整目标粒度"
      ],
      "form": "framework",
      "severity": "low",
      "expectedEffect": "1 周目标达标率>60%；2 周>80%",
      "failureCriteria": "从物品整理入手→从「一课桌」开始；逻辑型优势→用计分系统、图表追踪",
      "dimensions": ["行为适应"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "班主任干预技术处方库 V1.0（① 处方速查表 B2）"
    },
    {
      "name": "情绪调节干预处方（C2）",
      "attributions": ["情绪调节型"],
      "whenToUse": "周内多次强烈情绪；平复时间远超同龄；情绪后伴随后悔自责",
      "steps": [
        "T7 情绪命名与接纳：命名情绪（「我看到你拳头攥得很紧，是叫「生气」吗？」）",
        "无条件接纳：「谢谢你告诉我。生气或难过是正常的，每个人都会有。」",
        "情绪平复后才进入问题解决",
        "叠加 T12 心智化回应完整版，情绪升级时「不撑不退」保持稳定"
      ],
      "form": "script",
      "severity": "medium",
      "script": "无论你是因为什么有这种感觉，你都可以告诉我。有情绪是正常的，我在这里陪着你。",
      "prohibition": "接纳的是情绪，规范的是行为——「你可以生气，但不可以打人」；不要在情绪爆发时讲道理",
      "timePerSession": "3-5 分钟",
      "duration": "即时/按需",
      "expectedEffect": "即时降低情绪强度；2-4 周开始用语言表达情绪",
      "failureCriteria": "孩子说不出情绪→提供 2-3 选项；情绪升级而不平复→不撑不退保持稳定",
      "dimensions": ["情绪管理"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "班主任干预技术处方库 V1.0（① 处方速查表 C2）"
    },
    {
      "name": "焦虑退缩干预处方（C1）",
      "attributions": ["焦虑退缩型"],
      "whenToUse": "从不/极少主动举手；被点名时明显紧张；回避展示场合；常说「我害怕」",
      "steps": [
        "T3 渐进参与计划：安全基地启动（1-2 分钟非学习闲聊）",
        "第 1 周：老师看向你时保持目光接触",
        "第 2-3 周：心里说答案→对同桌小声说",
        "第 4 周：举手一次（事先约定，老师会叫你）",
        "叠加 T8 优势发现日记积累成功体验"
      ],
      "form": "framework",
      "severity": "low",
      "script": "放轻松，我们只是练习，不是考试。",
      "prohibition": "前两周重点不是「行为达标」而是「建立安全感」；不强迫发言",
      "timePerSession": "即时",
      "duration": "4 周渐进",
      "expectedEffect": "4 周内实现首次举手",
      "failureCriteria": "某阶段停滞>2 周→退回上阶段重建信心；检查环境安全（被嘲笑等）",
      "dimensions": ["情绪管理"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "班主任干预技术处方库 V1.0（① 处方速查表 C1 / ② 技术详解卡 T3）"
    },
    {
      "name": "低自尊干预处方（C3）",
      "attributions": ["低自尊型"],
      "whenToUse": "常说「我不行」「我笨」；拒绝尝试能力范围内的事；对批评异常敏感",
      "steps": [
        "关系预热：「我想和你一起发现你的优点——不是因为你做错了什么」",
        "T8 优势发现日记：每天找 1-2 件「今天做得不错的事」，具体到行为、优先优势领域",
        "累计一周班会上公开肯定（「本周 XX 之星」形式）",
        "连续 4 周后让学生自己写，老师逐步退出",
        "叠加 T11 优势锚定法持续强化"
      ],
      "form": "worksheet",
      "severity": "medium",
      "script": "我注意到你今天把笔借给了同桌，这叫乐于助人——这是你的优点。",
      "prohibition": "避免模糊的「你很棒」（会被不安全依恋学生过滤为安慰）；不要在公开场合与别人比较",
      "timePerSession": "5 分钟",
      "duration": "4 周",
      "expectedEffect": "4 周后自我否定语言明显减少",
      "failureCriteria": "找不出优点→老师说「今天你做的最小一件好事」；全科失败→从非学业优势领域找",
      "dimensions": ["情绪管理"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "班主任干预技术处方库 V1.0（① 处方速查表 C3 / ② 技术详解卡 T6）"
    },
    {
      "name": "同伴冲突干预处方（D1）",
      "attributions": ["同伴冲突型"],
      "whenToUse": "每周处理该生同伴纠纷多次；同伴提名中处于被排斥位置",
      "steps": [
        "T12 冲突调解三步心智化：先各说一句「我觉得……」",
        "听完后把对方的话重述一遍（理解他人心理状态）",
        "连接需求：「除了打架，还有什么办法？」",
        "叠加 T4 行为契约（社交版）：约定替代行为并正强化"
      ],
      "form": "script",
      "severity": "low",
      "script": "你们俩现在都很生气。先各说一句「我觉得……」好吗？……除了打架，还有什么办法？",
      "prohibition": "不做「法官模式」判断对错；不当众点名批评",
      "timePerSession": "10 分钟",
      "duration": "2 周一个周期",
      "expectedEffect": "2 周内冲突频率下降",
      "failureCriteria": "同伴不匹配→换人；双方都退缩→改为三人小组",
      "dimensions": ["人际关系"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "班主任干预技术处方库 V1.0（① 处方速查表 D1 / ⑦ 心智化话术库）"
    },
    {
      "name": "社交退缩干预处方（D2）",
      "attributions": ["社交退缩型"],
      "whenToUse": "自由活动时通常独自一人；小组活动被动参与；自述「没朋友」",
      "steps": [
        "T10 友谊桥同伴配对：安排温和、社交能力中等的同伴（不选最强的）",
        "设计需两人协作的任务，从任务互动过渡到社交互动",
        "每周末分别问双方感受，关注同伴心理状态",
        "叠加 T9 社交剧本练习降低社交启动难度"
      ],
      "form": "framework",
      "severity": "medium",
      "script": "XX 同学需要一个朋友，我想请你帮忙——因为你是我见过最温和、最让人放心的同学。这不是任务，是邀请——你愿意试试看吗？",
      "prohibition": "不选最强的同伴（碾压式配对适得其反）；不要忽视同伴心理状态（防止同伴耗竭）",
      "timePerSession": "持续",
      "duration": "4 周",
      "expectedEffect": "4 周内自由活动出现固定玩伴",
      "failureCriteria": "同伴不匹配→换人（关键：互补而不碾压）；两人都退缩→三人小组降低压力",
      "dimensions": ["人际关系"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "班主任干预技术处方库 V1.0（① 处方速查表 D2 / ② 技术详解卡 T8）"
    },
    {
      "name": "社交技能缺失干预处方（D3）",
      "attributions": ["技能缺失型"],
      "whenToUse": "不会用恰当方式加入游戏；不知轮流分享规则；读不懂同伴表情和语气",
      "steps": [
        "T9 社交剧本练习：安全基地预热（1-2 分钟轻松对话）",
        "设计简短社交剧本（走近小组站 30 秒→等停顿→说「我可以加入吗」）",
        "老师示范→学生练习 3 遍",
        "真实场景观察使用情况，当天反馈",
        "叠加 T10 友谊桥提供实践场"
      ],
      "form": "exercise",
      "severity": "low",
      "script": "放轻松，我们只是练习不是考试。",
      "prohibition": "安全基地预热不是浪费时间——焦虑状态下的练习是「表演」，安全状态下的才是「内化」",
      "timePerSession": "10 分钟",
      "duration": "2 周",
      "expectedEffect": "2 周内开始尝试在真实场景中使用剧本行为",
      "failureCriteria": "记不住台词→缩减为一个核心句；不敢用→先小范围练习（同桌）",
      "dimensions": ["人际关系"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "班主任干预技术处方库 V1.0（① 处方速查表 D3 / ② 技术详解卡 T7）"
    },
    {
      "name": "支持缺位干预处方（E3）",
      "attributions": ["支持缺位型"],
      "whenToUse": "主要养育者缺席或频繁更换；家庭经济压力影响生活；家长明确表示无力配合",
      "steps": [
        "T11 优势锚定法（独立·S0 发展）：调取优势测评 Top2-3 类型",
        "以学校为安全基地：建立稳定可预测的师生关系",
        "为优势领域制定 2-3 个学期发展目标，定期跟踪",
        "叠加 T8 优势发现日记积累成功体验",
        "定期 Q06 月度追踪"
      ],
      "form": "framework",
      "severity": "medium",
      "script": "你在这里是安全的，你可以自由探索。我不会侵入你的空间，但我一直在这里。",
      "prohibition": "不替代家庭做「家庭调解」；不以怜悯或同情姿态对待学生",
      "timePerSession": "15 分钟",
      "duration": "持续（以月为单位）",
      "expectedEffect": "以学校为安全基地；优势领域持续发展",
      "failureCriteria": "通过 S0 优势发展路径替代补偿家庭支持缺失；定期 Q06 月度追踪",
      "dimensions": ["家庭环境"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "班主任干预技术处方库 V1.0（① 处方速查表 E3）"
    },
    {
      "name": "优势发展通道（S0）",
      "attributions": ["技能不足型"],
      "whenToUse": "五维筛查零标记 + 六维评估全 A/B + 学有余力（或超前发展特征）",
      "steps": [
        "S0a 识别：确认五维零标记+六维全 A/B+学有余力特征（10 分钟）",
        "S0b 优势定位：调取优势测评 Top2-3 类型（1-2 年级 50 题版/3-6 年级 20 题版）",
        "S0c 方案制定：T11 独立模式，为每个优势制定 2-3 个学期发展目标，填入优二代成长规划",
        "S0d 月度追踪：每月 Q06 自我探索问卷，关注自我实现和自我升级维度",
        "每学期末复查五维筛查，出现标记→正常转入 S1-S5"
      ],
      "form": "framework",
      "severity": "low",
      "expectedEffect": "优势领域稳步拓展；自我实现/自我升级维度持续上升",
      "effectNote": "S0 是独立路径，不与 S1-S5 连通；两条路径可交替不可并行",
      "failureCriteria": "学期末复查出现五维筛查标记→转入 S1-S5 流程",
      "dimensions": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "术语库 V2.0（08 S0-S5 诊疗流程）/ 小学部学生个体问题解决手册 V6.0"
    },
    {
      "name": "班级情绪安全感建设（班级氛围）",
      "attributions": ["情绪调节型", "焦虑退缩型"],
      "whenToUse": "班级整体情绪安全感偏低；班主任精力透支",
      "steps": [
        "T12 班级层面心智化：每天 1 次「情绪天气」（晴天/多云/小雨/雷雨，30 秒，不点名不追问）",
        "冲突调解三步心智化（看见情绪→理解他人→连接需求）",
        "教师自我心智化复盘：教师稳定本身就是最强的情绪调节信号"
      ],
      "form": "framework",
      "severity": "low",
      "script": "让情绪表达成为班级常态——当情绪表达是「正常的事」，学生才更容易在需要时说出真实情绪。",
      "prohibition": "情绪天气不是筛查工具，不点名不追问；不在全班面前讨论个别学生",
      "timePerSession": "每天 30 秒",
      "duration": "持续",
      "expectedEffect": "班级情绪表达常态化；冲突中自发使用心智化语言",
      "failureCriteria": "持续无效→检查班主任自身心智化水平（Q03 识别/诊断能力）",
      "dimensions": ["情绪管理"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "班主任干预技术处方库 V1.0（① 处方速查表 班级氛围 / ⑦ 心智化话术库）"
    },
    {
      "name": "心智化危机回应（不撑不退）",
      "attributions": ["情绪调节型", "教养不当型"],
      "whenToUse": "自杀/自伤/严重攻击信号；情绪失控反复；心智化缺失是深层因素",
      "steps": [
        "确保学生处于安全环境并有人陪伴，不让学生独处",
        "不撑不退：保持平静语气和稳定身体姿态，不防御、不争吵、不评判",
        "心智化四步回应：看见情绪→命名情绪→接纳情绪→连接需求",
        "安全流程优先：通知心理总监+年级组长+德育处，与危机评估并行"
      ],
      "form": "script",
      "severity": "high",
      "script": "我看到你还是很激动。没关系，我们不急。我就在这里陪着你。",
      "prohibition": "不要在冲突过程中训斥学生（高唤醒状态下训斥无效）；不要让学生独处；不要承诺保密；不用「别想太多」「你要坚强」之类的话",
      "timePerSession": "即时",
      "duration": "至情绪平复",
      "expectedEffect": "即时：情绪强度降低；长期：主动求助增加",
      "failureCriteria": "安全流程优先——心智化回应与危机评估并行；出现自伤信号按 SA01 流程执行",
      "dimensions": ["情绪管理"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "班主任干预技术处方库 V1.0（① 处方速查表 E2/C2 危机 / 术语库 V2.0 13 SA01-SA05）"
    },
    {
      "name": "优势入口+心智化底色（通用叠加）",
      "attributions": ["注意力分散型", "动机缺失型", "技能不足型", "课堂纪律型", "规则习惯型", "攻击冲动型", "焦虑退缩型", "情绪调节型", "低自尊型", "同伴冲突型", "社交退缩型", "技能缺失型", "亲子紧张型", "教养不当型", "支持缺位型"],
      "whenToUse": "所有编码均可叠加 T11 优势锚定 + T12 心智化底色",
      "steps": [
        "为命中编码选择主技术（编码匹配主技术 T1-T8）",
        "用 T11 优势锚定优化技术入口：所有技术经由优势通道进入",
        "所有师生互动以 T12 心智化为底层语言",
        "2 周评估干预效率和关系质量"
      ],
      "form": "framework",
      "severity": "low",
      "expectedEffect": "干预效率和关系质量双重提升",
      "effectNote": "T12 不替代 T1-T11，而是所有技术的「操作系统」",
      "failureCriteria": "T11 失效→优势定位不准；T12 失效→关系地基不稳",
      "dimensions": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "班主任干预技术处方库 V1.0（① 处方速查表 T9/T10 全编码通用）"
    },
    {
      "name": "定时器分段法",
      "attributions": ["注意力分散型"],
      "whenToUse": "A1 注意力分散：作业拖拉、完不成课堂任务、注意力维持困难",
      "steps": [
        "Step 0（依恋增强版·关系锚定，约 30 秒）：蹲下平视——「我就在旁边，做完这一段你可以随时来找我核对」",
        "S1 把任务分成 5-10 分钟小段，每段一个明确目标",
        "S2 用可视化定时器倒计时，让孩子看到剩余时间",
        "S3 完成一段休息 2 分钟，完成 3 段获得较大奖励"
      ],
      "form": "exercise",
      "severity": "low",
      "script": "我就在旁边，做完这一段你可以随时来找我核对。",
      "prohibition": "奖励首选社会性奖励（自由时间、当小助手），物质奖励辅助；定时器必须可视化；Step 0 不替代 Step 1-3",
      "timePerSession": "5-10 分钟/段",
      "duration": "每天×2 周",
      "expectedEffect": "1 周内作业效率明显改善",
      "failureCriteria": "段长缩短至 3 分钟甚至 1 分钟，目标改为「专注完成一段」；仍困难→先确认是否难度超载并降低任务难度",
      "dimensions": ["学会学习"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "术语库 V2.0（07 干预技术 T1）/ 业务指导手册 V3.0（4.1）"
    },
    {
      "name": "注意力信号约定",
      "attributions": ["注意力分散型"],
      "whenToUse": "A1 课堂走神型：上课走神频繁，需反复提醒",
      "steps": [
        "S1 与孩子私下约定专属暗号（手势/桌面卡片翻转/座位微调，无惩罚性）",
        "S2 每次走神用暗号提醒，不做任何语言批评",
        "S3 连续一周走神明显下降后逐步退出暗号",
        "依恋增强版：约定时说明「这个暗号是我们俩之间的小秘密——它代表「我知道你在努力，我看到了」」，退出时明确告知约定一直在"
      ],
      "form": "framework",
      "severity": "low",
      "script": "这个暗号是我们俩之间的小秘密——它代表「我知道你在努力，我看到了」。",
      "prohibition": "暗号的核心是「非惩罚性」——暗号不是「抓到你了」的信号，而是「我注意到你在坚持」的信号",
      "timePerSession": "即时",
      "duration": "1-2 周",
      "expectedEffect": "1-2 周走神次数显著下降",
      "failureCriteria": "暗号太显眼→换更隐蔽方式；走神原因是课程难度远超水平→先降任务难度",
      "dimensions": ["学会学习"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "术语库 V2.0（07 干预技术 T2）/ 业务指导手册 V3.0（4.1）"
    },
    {
      "name": "渐进参与计划",
      "attributions": ["注意力分散型", "焦虑退缩型"],
      "whenToUse": "A1/C1 不敢举手、课堂退缩的学生",
      "steps": [
        "Step 0（依恋增强版·安全基地启动）：与学生进行 1-2 分钟一对一非学习闲聊",
        "第 1 周：老师看向你时保持目光接触",
        "第 2 周：知道答案时在心里说一遍",
        "第 3 周：对同桌小声说出答案",
        "第 4 周：举手一次（事先与老师约定，老师会叫你），每完成一阶段给具体口头表扬"
      ],
      "form": "framework",
      "severity": "low",
      "script": "放轻松，我们只是练习，不是考试。",
      "prohibition": "前两周重点不是「行为达标」而是「建立安全感」；焦虑状态下的社交尝试成功率远低于安全状态",
      "timePerSession": "即时",
      "duration": "4 周渐进",
      "expectedEffect": "4 周内实现首次举手",
      "failureCriteria": "某阶段停滞超过 2 周→退回上一阶段重建信心；仍困难→检查是否存在被同伴嘲笑等环境因素",
      "dimensions": ["情绪管理"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "术语库 V2.0（07 干预技术 T3）/ 业务指导手册 V3.0（4.1）"
    },
    {
      "name": "三步行为契约",
      "attributions": ["课堂纪律型", "规则习惯型", "攻击冲动型"],
      "whenToUse": "B1/B2/B3 课堂纪律、规则习惯、攻击冲动类行为问题",
      "steps": [
        "第一步·共定目标：具体可测（不是「认真听讲」而是「老师叫我名字时我能站起来」）",
        "第二步·明确奖励：首选社会性奖励（额外自由时间/当小助手/优先选择权），物质奖励辅助",
        "第三步·每日复盘：放学最后 2 分钟 30 秒复盘——做到了吗？为什么？明天怎么调整？",
        "依恋增强版：增加关系目标——「这一周当你沮丧或想发火时，可以来找我，我们一起想办法」"
      ],
      "form": "framework",
      "severity": "medium",
      "script": "你愿意来找我，这本身就是最大的进步。你做到了我们约好的事，这让我觉得我们的约定是有力量的。",
      "prohibition": "低年段：老师主导+画图辅助+当日兑现；中年段：师生协商+周奖励；高年段：学生主导起草+同伴见证；不以惩罚为手段",
      "timePerSession": "5 分钟",
      "duration": "2 周一个周期",
      "expectedEffect": "1 周目标达标率>60%；2 周>80%",
      "failureCriteria": "目标再分小一半（一节课→前 15 分钟）；问孩子「你觉得什么奖励有意思」；用 ABC 分析回溯触发和后果",
      "dimensions": ["行为适应"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "术语库 V2.0（07 干预技术 T4）/ 业务指导手册 V3.0（4.2）"
    },
    {
      "name": "关系修复目标",
      "attributions": ["课堂纪律型", "规则习惯型", "攻击冲动型"],
      "whenToUse": "所有行为契约场景中，行为目标反复失败或存在不安全依恋信号时",
      "steps": [
        "在 S4 方案中增设 S4-relation 目标（不单独作为结案标准，与行为目标并列记录）",
        "关系修复≠「让学生喜欢我」＝「让学生感受到这个关系是安全的、可预测的」",
        "以周为周期评估：学生主动发起互动的次数是否上升",
        "行为目标反复失败→先检查关系目标进展（不是技术问题而是关系问题）"
      ],
      "form": "framework",
      "severity": "medium",
      "script": "无论你做什么，我都不会变成伤害你的人——这是我的承诺，不是你的测试。",
      "prohibition": "不因行为挑战而放弃关系连接——混乱型最需要「不被抛弃」的体验",
      "timePerSession": "持续",
      "duration": "以月为单位积累",
      "expectedEffect": "过程性指标：学生感受到关系安全、可预测，进展比行为更根本",
      "failureCriteria": "行为目标反复失败→先检查关系目标进展；关系地基不稳时上层建筑必摇晃",
      "dimensions": ["行为适应"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "术语库 V2.0（07 干预技术 T4+）"
    },
    {
      "name": "情绪命名与接纳",
      "attributions": ["焦虑退缩型", "情绪调节型", "低自尊型"],
      "whenToUse": "C1/C2/C3 所有情绪场景：强烈情绪、情绪崩溃、自我否定",
      "steps": [
        "S1 命名情绪（不先解决问题）：低年级——「我看到你拳头攥得很紧，是叫「生气」吗？」；高年级——「用一个词形容你现在的心情」",
        "S2 接纳情绪：「谢谢你告诉我。生气或难过是正常的，每个人都会有。」",
        "S3 才进入问题解决",
        "依恋增强版：增加无条件接纳表述——「无论你是因为什么有这种感觉，你都可以告诉我。我在这里陪着你」"
      ],
      "form": "script",
      "severity": "medium",
      "script": "无论你是因为什么有这种感觉，你都可以告诉我。有情绪是正常的，我在这里陪着你。",
      "prohibition": "接纳的是情绪，规范的是行为——「你可以生气，但不可以打人」；不因行为好坏而条件性连接（Carl Rogers 无条件积极关注的操作化）",
      "timePerSession": "3-5 分钟",
      "duration": "即时",
      "expectedEffect": "即时降低情绪强度，缩短平复时间（激活前额叶，抑制杏仁核警报）",
      "failureCriteria": "说不出→提供选项（<3 个）；拒绝沟通→不说教不强求，安静陪伴后：「我就在这，你准备好了随时可以找我」",
      "dimensions": ["情绪管理"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "术语库 V2.0（07 干预技术 T7）/ 业务指导手册 V3.0（4.3）"
    },
    {
      "name": "优势发现日记",
      "attributions": ["低自尊型"],
      "whenToUse": "C3 低自尊：常说「我不行」「我笨」，自我否定明显",
      "steps": [
        "启动前调取该生优势测评 Top2-3 类型，优点选择优先从优势领域切入",
        "Step 0（依恋增强版·关系预热）：「我想和你一起发现你的优点——不是因为你做错了什么，而是因为我想更多地了解你好的那一面」",
        "S1 每天找 1-2 件「今天我做得不错的事」，具体到行为",
        "S2 累计一周后在班会上以「本周 XX 之星」等形式公开肯定",
        "S3 连续 4 周后让孩子自己写，老师逐步退出"
      ],
      "form": "worksheet",
      "severity": "medium",
      "script": "我想和你一起发现你的优点——不是因为你做错了什么要改正，而是因为我想更多地了解你好的那一面。",
      "prohibition": "「具体到粒度的看见」对不安全依恋儿童的意义远大于模糊的「你很棒」；优先从优势领域切入",
      "timePerSession": "5 分钟",
      "duration": "4 周",
      "expectedEffect": "4 周后自我否定语言明显减少",
      "failureCriteria": "找不出优点→老师说「今天你做的最小一件好事」；所有科目都失败→从非学业优势领域找起点（值日/助人/运动会/画画）",
      "dimensions": ["情绪管理"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "术语库 V2.0（07 干预技术 T8）/ 业务指导手册 V3.0（4.3）"
    },
    {
      "name": "社交剧本练习",
      "attributions": ["技能缺失型"],
      "whenToUse": "D3 社交技能缺失：不会加入游戏、读不懂社交线索",
      "steps": [
        "Step 0（依恋增强版·安全基地预热）：1-2 分钟轻松对话，让学生感受「此刻我是安全的，这个人不会评判我」",
        "S1 设计简短社交剧本——「走近正在玩的小组，站旁边看 30 秒，等一个自然停顿，说「看起来好好玩，我可以加入吗？」」",
        "S2 老师先做示范表演，再让孩子练习 3 遍",
        "S3 在真实场景中观察使用情况，当天给反馈"
      ],
      "form": "exercise",
      "severity": "low",
      "script": "放轻松，我们只是练习，不是考试。",
      "prohibition": "安全基地预热不是浪费时间，是 T9 效果的最强预测因素之一",
      "timePerSession": "10 分钟",
      "duration": "2 周",
      "expectedEffect": "2 周内开始尝试在真实场景中使用剧本行为",
      "failureCriteria": "记不住台词→缩减为一个核心句；真实场景不敢用→先在小范围内练习（同桌）",
      "dimensions": ["人际关系"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "术语库 V2.0（07 干预技术 T9）/ 业务指导手册 V3.0（4.4）"
    },
    {
      "name": "友谊桥同伴配对",
      "attributions": ["社交退缩型"],
      "whenToUse": "D2 社交退缩：自由活动时间独自一人，不主动接近同伴",
      "steps": [
        "S1 安排性格温和、社交能力中等的同伴坐在旁边（不选最强的——碾压式配对适得其反）",
        "S2 设计需要两人协作才能完成的任务",
        "S3 从「任务导向的互动」自然过渡到「社交导向的互动」",
        "S4 每周末分别问双方感受",
        "依恋增强版：配对前单独沟通同伴——「XX 同学需要一个朋友，我想请你帮忙……这不是任务，是邀请」"
      ],
      "form": "framework",
      "severity": "medium",
      "script": "XX 同学需要一个朋友，我想请你帮忙，因为你是我见过最温和、最让人放心的同学。这不是任务，是邀请——你愿意试试看吗？",
      "prohibition": "不选最强的同伴；不要忽视同伴的心理状态（温和型同伴本质在扮演「微型安全基地」，过度给予无回馈会导致同伴耗竭）",
      "timePerSession": "持续",
      "duration": "4 周",
      "expectedEffect": "4 周内自由活动时间出现固定玩伴",
      "failureCriteria": "同伴不匹配→换人，关键是互补而不碾压；两人都退缩→改为三人小组降低一对一社交压力",
      "dimensions": ["人际关系"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "术语库 V2.0（07 干预技术 T10）/ 业务指导手册 V3.0（4.4）"
    },
    {
      "name": "优势锚定法",
      "attributions": ["注意力分散型", "动机缺失型", "技能不足型", "课堂纪律型", "规则习惯型", "攻击冲动型", "焦虑退缩型", "情绪调节型", "低自尊型", "同伴冲突型", "社交退缩型", "技能缺失型", "亲子紧张型", "教养不当型", "支持缺位型"],
      "whenToUse": "所有编码类型；可作为主技术独立使用（S0 路径），也可作为 T1-T10 的锚点技术搭配使用",
      "steps": [
        "S1 优势定位：从优势测评获取 Top2-3 优势类型（1-2 年级 50 题版/3-6 年级 20 题版），未测评→安排测评或教师观察法",
        "S2 优势-问题匹配：优势类型与问题编码交叉分析，「用优势通道解决弱势问题」",
        "S3 优势嵌入式方案：格式「主技术 T1+优势适配：因该生身体动觉型，将休息奖励改为 1 分钟运动」",
        "S4 验证优势假设：执行 2 周后评估，无效→检查优势定位准确性与匹配合理性，必要时回到 S1"
      ],
      "form": "framework",
      "severity": "low",
      "script": "用优势通道解决弱势问题——同样的技术经由不同优势通道进入，效果差异巨大。",
      "prohibition": "优势锚定法不是替代 T1-T8，而是为它们提供「入口优化」",
      "timePerSession": "15 分钟",
      "duration": "持续",
      "expectedEffect": "同等干预技术经由优势通道进入，效果提升显著；2 周可验证优势假设",
      "failureCriteria": "优势定位不准→重测或观察；优势-问题匹配不合理→回 S1 重定位",
      "dimensions": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "术语库 V2.0（07 干预技术 T11）/ 业务指导手册 V3.0（4.5）"
    },
    {
      "name": "优势验证环节",
      "attributions": ["情绪调节型", "低自尊型", "亲子紧张型"],
      "whenToUse": "不安全依恋学生：优势定位后需要绕过认知防御建立自我确认",
      "steps": [
        "在优势定位后增加优势验证——不告诉学生「你有这个优势」，而是通过具体活动让他「体验」到",
        "例：空间智能→拼装任务让他「做出来」；人类型→帮助小同学完成一件事",
        "任务完成后不急着表扬，问：「你觉得你刚才做了什么让你自己觉得挺厉害？」",
        "引导他自己命名优势体验"
      ],
      "form": "framework",
      "severity": "medium",
      "script": "你觉得你刚才做了什么让你自己觉得挺厉害？",
      "prohibition": "任务完成后不说「你真棒」——不安全依恋学生倾向于质疑语言肯定（「老师只是在安慰我」），但体验无法被否认",
      "timePerSession": "10 分钟",
      "duration": "每次优势活动后",
      "expectedEffect": "体验到的能力感比被告知的更深刻——绕过认知防御直接进入行动层面自我确认",
      "failureCriteria": "学生拒绝参与→先从低压力活动开始，不强迫",
      "dimensions": [],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "术语库 V2.0（07 干预技术 T11+ / 10 优势测评体系 AD08）"
    },
    {
      "name": "心智化回应技术",
      "attributions": ["焦虑退缩型", "情绪调节型", "低自尊型", "社交退缩型", "亲子紧张型"],
      "whenToUse": "C1/C2/C3/D2/E1 优先；所有师生互动底层语言",
      "steps": [
        "S1 看见情绪（识别）：「我看到你攥紧拳头/眼睛红了/声音在发抖……」",
        "S2 命名情绪（表达）：「你现在的感觉，是不是叫「生气」/「委屈」/「害怕」？」（低年级可用 6 张基础情绪卡片）",
        "S3 接纳情绪（调控）：「有这样的感觉是正常的。谢谢你告诉我。」（接纳的是情绪，规范的是行为）",
        "S4 连接需求（心智化升级）：「你觉得刚才那么生气，是因为想要什么？」",
        "班级层面：每天 1 次情绪天气（30 秒）；冲突调解三步心智化；教师自我心智化复盘"
      ],
      "form": "script",
      "severity": "medium",
      "script": "我看到你攥紧了拳头/眼睛红了……你现在的感觉，是不是叫「生气」/「委屈」/「害怕」？有这样的感觉是正常的。谢谢你告诉我。",
      "prohibition": "不评判、不否定、不急于解决问题；接纳的是情绪，规范的是行为——「你可以生气，但不可以打人」",
      "timePerSession": "3-10 分钟",
      "duration": "持续",
      "expectedEffect": "即时：情绪强度降低；短期（2-4 周）：用语言表达情绪；长期（1 学期）：主动求助增加、师生信任增强",
      "failureCriteria": "拒绝沟通→不强求：「我就在这」；说不出情绪→给 2-3 选项；情绪升级→不撑不退保持稳定；持续 12 周无改善→转介心理教师",
      "dimensions": ["情绪管理"],
      "prerequisiteTools": [],
      "alternativeTools": [],
      "advancedTools": [],
      "collaborativeTools": [],
      "crossModuleTags": [],
      "contraindications": [],
      "evidenceSource": "术语库 V2.0（07 干预技术 T12）/ 业务指导手册 V3.0（4.6）"
    }
  ],
  "keywords": [
    {
      "core": ["自杀", "自伤", "不想活", "死了算了", "割", "跳楼", "跳河", "消失", "结束"],
      "expanded": ["结束生命", "生无可恋", "不如死了", "割腕", "不想活了"],
      "exclude": [],
      "category": "安全红线·自杀自伤",
      "scale": "信号筛查",
      "tool": "心智化危机回应（不撑不退）",
      "matchMode": "exact",
      "risk": "red",
      "description": "SA01：学生表现出或表达出自杀意念、自伤行为、死亡愿望或自我毁灭倾向；题1≥4 或谈话/作文/绘画中直接或间接表达→红色(L5)立即响应：不让学生独处、通知心理总监和校领导、通知家长、24 小时内安全计划确认"
    },
    {
      "core": ["打", "杀", "捅", "揍", "报复", "武器", "刀", "爆炸", "攻击"],
      "expanded": ["打死", "杀了", "弄死", "打人", "报复他"],
      "exclude": [],
      "category": "安全红线·严重攻击",
      "scale": "信号筛查",
      "tool": "心智化危机回应（不撑不退）",
      "matchMode": "exact",
      "risk": "red",
      "description": "SA02：学生表现出或表达出对他人的严重攻击意图、暴力行为或持械威胁；题7≥4 或 B3 激活且 SSF≥0.7→红色(L5)：立即隔离保护、联系家长必要时报警、心理总监评估攻击风险"
    },
    {
      "core": ["体罚", "抽", "关", "不给饭吃", "不让睡觉", "锁", "淤青", "恐惧回家", "伤"],
      "expanded": ["被打了", "回家害怕", "身上有伤"],
      "exclude": [],
      "category": "安全红线·虐待忽视",
      "scale": "信号筛查",
      "tool": "学校安全流程响应（E2教养不当）",
      "matchMode": "exact",
      "risk": "red",
      "description": "SA03：学生身上存在体罚、言语羞辱、基本生活照料缺失或性侵害迹象；题1/题15 触发或身体出现不明伤痕→红色(L5)：记录具体信号、通过学校正式渠道启动未成年人保护流程、联系心理总监安全评估"
    },
    {
      "core": ["幻觉", "幻听", "感觉被监视", "完全不吃不睡"],
      "expanded": ["听到奇怪的声音", "觉得有人要害他"],
      "exclude": [],
      "category": "安全红线·心理健康高危",
      "scale": "信号筛查",
      "tool": "学校安全流程响应（E2教养不当）",
      "matchMode": "exact",
      "risk": "red",
      "description": "SA04：E2 编码激活或 SAFETY 维度≥4，学生可能出现严重心理障碍急性表现→红色(L5)：立即上报警报、心理总监评估是否需要精神科转介、家校联动启动保护计划、升级为全校级关注"
    },
    {
      "core": ["失控", "号啕大哭", "尖叫", "摔东西", "自伤", "完全无法正常对话", "眼神空洞"],
      "expanded": ["情绪崩溃", "大哭不止"],
      "exclude": [],
      "category": "安全红线·急性情绪崩溃",
      "scale": "信号筛查",
      "tool": "心智化危机回应（不撑不退）",
      "matchMode": "exact",
      "risk": "orange",
      "description": "SA05：在校期间失控哭泣、尖叫、自我伤害或完全无法沟通的急性情绪危机；C2 激活且 SSF≥0.7 或失控>10 分钟→橙转红(L4→L5)：带离公共空间、一人陪护不围观、T12 不撑不退、平复不了联系家长和心理教师"
    },
    {
      "core": ["打人", "砸东西", "掀桌子", "扔椅子", "冲出去", "对老师动手", "完全不听任何指令"],
      "expanded": ["破坏课堂", "扰乱课堂"],
      "exclude": [],
      "category": "安全红线·扰乱秩序",
      "scale": "信号筛查",
      "tool": "三步行为契约·攻击冲动（B3）",
      "matchMode": "exact",
      "risk": "orange",
      "description": "SA06：行为严重破坏课堂秩序，常规课堂管理完全失效，班级安全受威胁；B3 激活且行为升级或破坏行为持续 15 分钟以上→橙色(L4)升级评估：联系安保带离、通知家长到校、心理教师当天介入评估"
    },
    {
      "core": ["不上学", "不进班", "完全沉默", "寸步不离", "反复确认", "老师不在就崩溃", "攻击", "后悔", "讨好"],
      "expanded": ["不去学校", "不肯进教室", "黏着老师"],
      "exclude": [],
      "category": "安全红线·依恋危机",
      "scale": "信号筛查",
      "tool": "心智化回应技术",
      "matchMode": "exact",
      "risk": "yellow",
      "description": "SA07：不安全依恋学生的依恋需求被严重触发——回避型突然拒绝上学/焦虑型过度黏着/混乱型攻击-躲避交替→黄转橙(L3→L4)：先稳定关系用 T12 不撑不退、不在此阶段施加学业行为要求、以「了解近期变化」而非「告状」方式通知家长、启动依恋关系修复计划"
    }
  ],
  "defaultLevelName": "暂无明显信号",
  "defaultMessage": "本次评估未发现需要重点干预的信号，当前状态相对平稳。建议保持现有节奏，按每学期一次频率复查；若后续出现异常表现，可随时重新评估。"
}