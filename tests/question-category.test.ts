import { describe, expect, it } from 'vitest'
import type { H3Event } from 'h3'
import { chatMessages } from '../server/db/schema'
import {
  MAX_QUESTION_KEYWORDS,
  QUESTION_CATEGORIES,
  QUESTION_CATEGORY_CLASS_SYSTEM,
  QUESTION_CATEGORY_LABELS,
  QUESTION_CATEGORY_MORAL_EDUCATION,
  QUESTION_CATEGORY_OTHER,
  QUESTION_CATEGORY_RULES,
  QUESTION_CATEGORY_SELF_GROWTH,
  QUESTION_CATEGORY_SOURCES,
  QUESTION_CATEGORY_STUDENT_INDIVIDUAL,
  QUESTION_CATEGORY_STUDENT_LEARNING,
  classifyByRules,
  classifyQuestion,
  isQuestionCategory,
  normalizeQuestionConfidence,
  normalizeQuestionKeywords,
  type QuestionCategory
} from '../server/domain/question-category'

/** 一类一条典型提问：必须命中对应分类（看板 W2/W3 的六类口径）。 */
const CATEGORY_SAMPLES: Array<{ category: QuestionCategory, text: string }> = [
  { category: QUESTION_CATEGORY_MORAL_EDUCATION, text: '班里有学生打架，还在宿舍抽烟，学校要给处分，我该怎么教育他？' },
  { category: QUESTION_CATEGORY_CLASS_SYSTEM, text: '班级纪律很差，我想重新制定班级公约，班干部也要调整，座位怎么排比较好？' },
  { category: QUESTION_CATEGORY_STUDENT_LEARNING, text: '小明最近上课走神，作业经常不交，考试前特别焦虑，错题也不整理。' },
  { category: QUESTION_CATEGORY_STUDENT_INDIVIDUAL, text: '孩子情绪很低落，被同学孤立，还沉迷手机游戏，最近有点厌学。' },
  { category: QUESTION_CATEGORY_SELF_GROWTH, text: '我最近压力大，快撑不住了，想学点家校沟通话术，也想参加班级管理培训。' },
  { category: QUESTION_CATEGORY_OTHER, text: '平台的账号登录不上，数据导出怎么用？' }
]

/** schema 列声明长度（Drizzle 列对象上的 length）；拿不到时返回 undefined。 */
function columnLength(column: unknown): number | undefined {
  return (column as { length?: number }).length
}

describe('提问分类常量（看板 W2/W3 口径）', () => {
  it('恰好 6 个分类，取值与看板口径一致', () => {
    expect(QUESTION_CATEGORIES).toHaveLength(6)
    expect(QUESTION_CATEGORIES).toEqual([
      '学生学习问题',
      '学生个体问题',
      '班级系统建设',
      '自我成长赋能',
      '德育类问题',
      '其他类'
    ])
    expect(new Set(QUESTION_CATEGORIES).size).toBe(6)
  })

  it('分类中文标签与分类一一对应且非空，isQuestionCategory 只认这 6 个词', () => {
    for (const category of QUESTION_CATEGORIES) {
      expect(QUESTION_CATEGORY_LABELS[category]).toBeTruthy()
      expect(isQuestionCategory(category)).toBe(true)
    }
    expect(isQuestionCategory('学习问题')).toBe(false)
    expect(isQuestionCategory('')).toBe(false)
    expect(isQuestionCategory(null)).toBe(false)
  })

  it('分类与来源取值都能装进 chat_messages 的 varchar 列（与 schema 一致）', () => {
    const categoryLength = columnLength(chatMessages.questionCategory)
    const sourceLength = columnLength(chatMessages.questionCategorySource)
    expect(categoryLength).toBe(40)
    expect(sourceLength).toBe(20)
    for (const category of QUESTION_CATEGORIES) {
      expect([...category].length).toBeLessThanOrEqual(categoryLength!)
    }
    for (const source of QUESTION_CATEGORY_SOURCES) {
      expect([...source].length).toBeLessThanOrEqual(sourceLength!)
    }
  })
})

describe('classifyByRules（纯函数，规则优先）', () => {
  it.each(CATEGORY_SAMPLES)('$category 至少一条规则命中', ({ category, text }) => {
    const hit = classifyByRules(text)
    expect(hit).not.toBeNull()
    expect(hit!.category).toBe(category)
    expect(hit!.keywords.length).toBeGreaterThan(0)
  })

  it('关键词必须原样出现在提问里且不超过上限', () => {
    for (const { text } of CATEGORY_SAMPLES) {
      const hit = classifyByRules(text)!
      expect(hit.keywords.length).toBeLessThanOrEqual(MAX_QUESTION_KEYWORDS)
      for (const keyword of hit.keywords) expect(text.includes(keyword), `关键词 ${keyword} 不在原文里`).toBe(true)
    }
  })

  it('未命中任何规则时返回 null', () => {
    expect(classifyByRules('今天天气不错，谢谢老师。')).toBeNull()
    expect(classifyByRules('')).toBeNull()
    expect(classifyByRules('   ')).toBeNull()
  })

  it('命中多个分类时按词表优先级返回靠上的分类', () => {
    // 德育类在词表最前：一个同时含「打架」与「成绩」的提问归德育类
    expect(classifyByRules('两个孩子打架，成绩也下滑了，我该怎么处理？')!.category).toBe(QUESTION_CATEGORY_MORAL_EDUCATION)
    // 班级系统建设先于学生学习问题：纪律与作业同时出现时归班级系统建设
    expect(classifyByRules('班级纪律很差，作业也收不齐，怎么抓？')!.category).toBe(QUESTION_CATEGORY_CLASS_SYSTEM)
  })

  it('规则词表覆盖全部 6 类、词不为空且在词表内不重复', () => {
    expect(QUESTION_CATEGORY_RULES.map(rule => rule.category).sort()).toEqual([...QUESTION_CATEGORIES].sort())
    const seen = new Set<string>()
    for (const rule of QUESTION_CATEGORY_RULES) {
      expect(rule.keywords.length).toBeGreaterThan(0)
      for (const keyword of rule.keywords) {
        expect(keyword.trim().length).toBeGreaterThan(0)
        expect(seen.has(keyword), `规则词重复：${keyword}`).toBe(false)
        seen.add(keyword)
      }
    }
  })
})

describe('normalizeQuestionKeywords（防编造 + 最小披露）', () => {
  it('只保留原样来自提问的词，并去重', () => {
    expect(normalizeQuestionKeywords(['成绩', '编造词', '成绩'], '这次考试成绩下滑，我很担心')).toEqual(['成绩'])
  })

  it('丢弃非字符串、空串、过长与含换行的词', () => {
    expect(normalizeQuestionKeywords(['成绩', 42, null, '', '  '], '这次考试成绩')).toEqual(['成绩'])
    expect(normalizeQuestionKeywords(['一'.repeat(21)], '一'.repeat(21))).toEqual([])
    expect(normalizeQuestionKeywords(['第一行\n第二行'], '第一行\n第二行')).toEqual([])
  })

  it('丢弃含电话/邮箱/姓名的词（关键词是明文列，不落个人信息）', () => {
    const text = '王老师你好，请让家长联系13800138000或parent@example.com，这次考试成绩下滑'
    expect(normalizeQuestionKeywords(['王老师', '13800138000', 'parent@example.com', '成绩'], text)).toEqual(['成绩'])
  })

  it('最多保留 5 个，保持模型输出顺序', () => {
    const text = '成绩作业考试复习预习错题'
    expect(normalizeQuestionKeywords(['成绩', '作业', '考试', '复习', '预习', '错题'], text)).toEqual(['成绩', '作业', '考试', '复习', '预习'])
  })
})

describe('normalizeQuestionConfidence（置信度归一）', () => {
  it('接受 0-100 整数与 0-1 小数，非法值返回 null', () => {
    expect(normalizeQuestionConfidence(85)).toBe(85)
    expect(normalizeQuestionConfidence(0.8)).toBe(80)
    expect(normalizeQuestionConfidence(1)).toBe(100)
    expect(normalizeQuestionConfidence(0)).toBe(0)
    expect(normalizeQuestionConfidence(120)).toBeNull()
    expect(normalizeQuestionConfidence('high')).toBeNull()
    expect(normalizeQuestionConfidence(undefined)).toBeNull()
    expect(normalizeQuestionConfidence(Number.NaN)).toBeNull()
  })
})

describe('classifyQuestion 降级契约', () => {
  const fakeEvent = {} as H3Event

  it('本地模式命中规则直接返回 rule，不调用模型', async () => {
    const result = await classifyQuestion(fakeEvent, { text: '班级纪律很差，怎么制定班级公约？', localMode: true })
    expect(result.source).toBe('rule')
    expect(result.category).toBe(QUESTION_CATEGORY_CLASS_SYSTEM)
    expect(result.confidence).toBeNull()
  })

  it('本地模式未命中规则直接降级「其他类」+ unknown', async () => {
    const result = await classifyQuestion(fakeEvent, { text: '今天天气不错，谢谢老师。', localMode: true })
    expect(result).toEqual({ category: QUESTION_CATEGORY_OTHER, source: 'unknown', keywords: [], confidence: null })
  })

  it('非本地模式但模型不可用时（单测环境无运行时配置）降级为「其他类」+ unknown，不抛错', async () => {
    const result = await classifyQuestion(fakeEvent, { text: '今天天气不错，谢谢老师。', localMode: false })
    expect(result).toEqual({ category: QUESTION_CATEGORY_OTHER, source: 'unknown', keywords: [], confidence: null })
  })
})
