import { describe, expect, it } from 'vitest'
import { inflateRawSync } from 'node:zlib'
import { buildLessonPlanDocx, markdownToWordXml } from '../server/domain/lesson-plan-docx'

/** 读取本地文件头形式的 ZIP 条目（导出器不写 data descriptor）。 */
function readZipEntry(zip: Buffer, target: string): Buffer {
  let offset = 0
  while (offset + 30 <= zip.length) {
    if (zip.readUInt32LE(offset) !== 0x04034B50) break
    const compression = zip.readUInt16LE(offset + 8)
    const compressedSize = zip.readUInt32LE(offset + 18)
    const nameLength = zip.readUInt16LE(offset + 26)
    const extraLength = zip.readUInt16LE(offset + 28)
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')
    const dataStart = offset + 30 + nameLength + extraLength
    const data = zip.subarray(dataStart, dataStart + compressedSize)
    if (name === target) return compression === 8 ? inflateRawSync(data) : Buffer.from(data)
    offset = dataStart + compressedSize
  }
  throw new Error(`ZIP 中缺少 ${target}`)
}

const sampleMarkdown = `# 五年级主题班会：课堂公约

**班会目标**：学生能说出 *3 条* 可观察的课堂约定。

## 一、活动流程

| 环节 | 时间 | 教师活动 |
| --- | --- | --- |
| 导入 | 5 分钟 | 呈现班级日志 |
| 共创 | 20 分钟 | 组织小组讨论 |

- 第一条约定
- 第二条约定

1. 先分组
2. 再表决

> 班主任做设计与兜底。

\`\`\`
const a = 1 < 2
\`\`\`

---

需要确认的信息：班级人数。`

describe('备课方案 DOCX 导出', () => {
  it('生成合法的 ZIP/DOCX，包含核心部件', () => {
    const docx = buildLessonPlanDocx({
      title: '五年级主题班会：课堂公约',
      markdown: sampleMarkdown,
      exportedAt: new Date('2026-10-28T02:00:00Z')
    })
    expect(docx.subarray(0, 4).toString('hex')).toBe('504b0304')
    for (const entry of ['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'word/document.xml']) {
      expect(readZipEntry(docx, entry).length).toBeGreaterThan(0)
    }
  })

  it('标题、表格、列表与引用都进入 document.xml', () => {
    const xml = readZipEntry(buildLessonPlanDocx({
      title: '五年级主题班会：课堂公约',
      markdown: sampleMarkdown,
      exportedAt: new Date('2026-10-28T02:00:00Z')
    }), 'word/document.xml').toString('utf8')
    expect(xml).toContain('五年级主题班会：课堂公约')
    expect(xml).toContain('<w:tbl>')
    expect(xml).toContain('导入')
    expect(xml).toContain('5 分钟')
    expect(xml).toContain('第一条约定')
    expect(xml).toContain('1. 先分组')
    expect(xml).toContain('班主任做设计与兜底')
    expect(xml).toContain('导出于')
    expect(xml).toContain('班主任助理智能平台')
  })

  it('文本一律 XML 转义，原始 HTML 不会进入文档', () => {
    const xml = markdownToWordXml('# 标题\n\n<script>alert(1)</script>', '标题')
    expect(xml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(xml).not.toContain('<script>alert(1)</script>')
  })

  it('保留粗体、斜体与行内代码', () => {
    const xml = markdownToWordXml('**粗体** *斜体* `代码`', '标题')
    expect(xml).toContain('<w:b/>')
    expect(xml).toContain('<w:i/>')
    expect(xml).toContain('Consolas')
    expect(xml).toContain('粗体')
    expect(xml).toContain('斜体')
    expect(xml).toContain('代码')
  })

  it('标题层级使用不同字号', () => {
    const xml = markdownToWordXml('# 一级\n\n## 二级\n\n### 三级', '标题')
    expect(xml).toContain('<w:sz w:val="32"/>')
    expect(xml).toContain('<w:sz w:val="28"/>')
    expect(xml).toContain('<w:sz w:val="24"/>')
  })

  it('回答没有 H1 时用会话标题补一个文档标题', () => {
    const xml = markdownToWordXml('这是一段没有标题的正文。', '我的备课方案')
    expect(xml).toContain('我的备课方案')
    expect(xml).toContain('这是一段没有标题的正文')
  })
})
