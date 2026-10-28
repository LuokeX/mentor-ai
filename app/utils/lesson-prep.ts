/**
 * 首页 AI 助手「备课」模式的前端常量。
 *
 * 模板只负责把结构化提示填入输入框；真正的输出结构由服务端
 * assistant_lesson_prep 提示词与 buildLessonPrepFormatInstruction 约束。
 */
export type AssistantMode = 'chat' | 'lesson_prep'

export interface LessonPrepTemplate {
  key: 'learning_profile' | 'competition' | 'class_meeting'
  label: string
  description: string
  prompt: string
}

export const LESSON_PREP_TEMPLATES: LessonPrepTemplate[] = [
  {
    key: 'learning_profile',
    label: '学情 / 班情信息表',
    description: '先补班级与学情，再做个性化设计',
    prompt: `请根据下面的学情与班情信息，为我设计一份完整的教学设计。信息不完整的地方请先按合理假设补全，并在方案末尾列出需要我确认的信息。
【学段】小学 / 初中 / 高中：
【学科】：
【年级】：
【教材版本】：
【课题】：
【课时】：
【班级人数】：
【学生基础与特点】：
【希望采用的教学方式】项目化学习 / 小组合作 / 其他：
【本次备课最想解决的问题】：`
  },
  {
    key: 'competition',
    label: '赛课设计',
    description: '按赛课 / 评优课标准出完整方案',
    prompt: `请按赛课 / 评优课的标准，为我设计一份教学设计，包含课题、学情分析、教学目标、教学重难点、教学准备、教学过程（分环节、时间分配、教师活动、学生活动、设计意图）、板书设计、作业设计、评价量表、教学反思与常见问题，并补充设计亮点和可能的评委追问与答辩要点。
【学段】：
【学科】：
【年级】：
【课题】：
【课时】：
【赛课要求或评分标准】：`
  },
  {
    key: 'class_meeting',
    label: '班会课设计',
    description: '主题班会 / 德育活动完整流程',
    prompt: `请为我设计一节主题班会课，包含班会主题、背景与学情、班会目标、重难点、课前准备、活动流程（分环节、时间、教师引导、学生活动、设计意图）、课后延伸与跟进、效果评价方式。
【年级】：
【班会主题】：
【班级当前情况】：
【希望解决的核心问题】：
【时长】：`
  }
]
