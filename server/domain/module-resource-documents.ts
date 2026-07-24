import { createHash } from 'node:crypto'

export interface ModuleResourceChunkInput {
  chunkIndex: number
  heading: string | null
  content: string
  tokenEstimate: number
}

export function normalizeModuleResourceContent(value: string) {
  return value.replace(/\r\n?/g, '\n').replace(/\0/g, '').trim()
}

export function checksumModuleResourceContent(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function chunkModuleResourceDocument(raw: string, maxChars = 1200): ModuleResourceChunkInput[] {
  const content = normalizeModuleResourceContent(raw)
  if (!content) return []
  const paragraphs = content.split(/\n{2,}/).map(item => item.trim()).filter(Boolean)
  const chunks: ModuleResourceChunkInput[] = []
  let heading: string | null = null
  let buffer = ''

  const push = () => {
    const value = buffer.trim()
    if (!value) return
    chunks.push({
      chunkIndex: chunks.length,
      heading,
      content: value,
      tokenEstimate: Math.ceil(value.length / 2)
    })
    buffer = ''
  }

  for (const paragraph of paragraphs) {
    const headingMatch = paragraph.match(/^#{1,6}\s+(.+)$/m)
    if (headingMatch?.[1] && paragraph.length < 300) heading = headingMatch[1].trim()
    if (paragraph.length > maxChars) {
      push()
      for (let start = 0; start < paragraph.length; start += maxChars - 120) {
        buffer = paragraph.slice(start, start + maxChars)
        push()
      }
      continue
    }
    if (buffer && buffer.length + paragraph.length + 2 > maxChars) push()
    buffer += `${buffer ? '\n\n' : ''}${paragraph}`
  }
  push()
  return chunks
}
