import { marked } from 'marked'

marked.setOptions({ breaks: true, gfm: true })

/**
 * 渲染结果缓存：模板里以函数形式调用（`v-html="useMarkdown(text)"`），组件每次重渲染都会重新求值。
 * 没有缓存时同一段文本会被反复解析（流式期间还会对不断变长的文本全量重解析），
 * 展开引用来源、点击反馈按钮等无关更新也会连带重算。
 */
const markdownCache = new Map<string, string>()
const MARKDOWN_CACHE_LIMIT = 50

export function useMarkdown(text: string): string {
  if (!text) return ''
  const cached = markdownCache.get(text)
  if (cached !== undefined) return cached
  const html = marked.parse(text) as string
  if (markdownCache.size >= MARKDOWN_CACHE_LIMIT) {
    const oldest = markdownCache.keys().next().value
    if (oldest !== undefined) markdownCache.delete(oldest)
  }
  markdownCache.set(text, html)
  return html
}
