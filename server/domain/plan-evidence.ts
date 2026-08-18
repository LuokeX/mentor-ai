const EVIDENCE_TYPES = {
  'image/jpeg': { kind: 'image', maxBytes: 5 * 1024 * 1024 },
  'image/png': { kind: 'image', maxBytes: 5 * 1024 * 1024 },
  'image/webp': { kind: 'image', maxBytes: 5 * 1024 * 1024 },
  'video/mp4': { kind: 'video', maxBytes: 15 * 1024 * 1024 },
  'video/webm': { kind: 'video', maxBytes: 15 * 1024 * 1024 }
} as const

export type PlanEvidenceMimeType = keyof typeof EVIDENCE_TYPES

function hasSignature(buffer: Buffer, mimeType: PlanEvidenceMimeType) {
  if (mimeType === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  if (mimeType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (mimeType === 'image/webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  if (mimeType === 'video/mp4') return buffer.subarray(4, 8).toString('ascii') === 'ftyp'
  return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
}

export function sanitizeEvidenceFilename(filename: string) {
  const base = filename.replaceAll('\\', '/').split('/').pop() || 'evidence'
  return base.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '_').trim().slice(0, 180) || 'evidence'
}

export function validatePlanEvidence(buffer: Buffer, mimeType: PlanEvidenceMimeType) {
  const config = EVIDENCE_TYPES[mimeType]
  if (!config) return { ok: false as const, message: '不支持的证据文件格式' }
  if (!buffer.length) return { ok: false as const, message: '证据文件不能为空' }
  if (buffer.length > config.maxBytes) {
    return { ok: false as const, message: config.kind === 'image' ? '单张图片不能超过 5 MB' : '单个视频不能超过 15 MB' }
  }
  if (!hasSignature(buffer, mimeType)) return { ok: false as const, message: '文件内容与声明格式不一致' }
  return { ok: true as const, kind: config.kind, byteSize: buffer.length }
}
