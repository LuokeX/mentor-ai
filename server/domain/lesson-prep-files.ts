/**
 * 备课资料文件名的纯校验（不依赖数据库/runner，便于单测）。
 * 真正的文件内容与临时目录由 sandbox-runner 再校验一次。
 */
export const LESSON_PREP_MAX_FILE_BYTES = 20 * 1024 * 1024
export const LESSON_PREP_SUPPORTED_EXTENSIONS = ['txt', 'md', 'markdown', 'docx'] as const

export function lessonPrepFileExtension(name: string): string {
  return String(name).toLowerCase().split('.').pop() || ''
}

/** 文件名只保留 basename；拒绝路径分隔符、控制字符、. / .. 与过长名称。 */
export function validateLessonPrepFileName(name: string): string {
  if (typeof name !== 'string') throw createError({ statusCode: 400, message: '文件名不合法' })
  const trimmed = name.normalize('NFC').trim()
  if (!trimmed || trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\') || /[\u0000-\u001f]/.test(trimmed)) {
    throw createError({ statusCode: 400, message: '文件名不合法' })
  }
  if (trimmed.length > 120) throw createError({ statusCode: 400, message: '文件名过长' })
  if (trimmed.startsWith('.upload-')) throw createError({ statusCode: 400, message: '文件名不合法' })
  if (!(LESSON_PREP_SUPPORTED_EXTENSIONS as readonly string[]).includes(lessonPrepFileExtension(trimmed))) {
    throw createError({ statusCode: 415, message: '资料仅支持 txt / md / docx' })
  }
  return trimmed
}
