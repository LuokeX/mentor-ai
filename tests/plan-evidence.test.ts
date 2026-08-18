import { describe, expect, it } from 'vitest'
import { sanitizeEvidenceFilename, validatePlanEvidence } from '../server/domain/plan-evidence'

describe('plan action evidence', () => {
  it('accepts supported files by signature instead of extension', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    expect(validatePlanEvidence(png, 'image/png')).toMatchObject({ ok: true, kind: 'image' })
    expect(validatePlanEvidence(Buffer.from('not a png'), 'image/png')).toEqual({
      ok: false,
      message: '文件内容与声明格式不一致'
    })
  })

  it('recognizes mp4 and blocks oversized evidence', () => {
    const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.alloc(8)])
    expect(validatePlanEvidence(mp4, 'video/mp4')).toMatchObject({ ok: true, kind: 'video' })
    const oversized = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024)])
    expect(validatePlanEvidence(oversized, 'image/jpeg')).toEqual({
      ok: false,
      message: '单张图片不能超过 5 MB'
    })
  })

  it('removes paths and unsafe characters from filenames', () => {
    expect(sanitizeEvidenceFilename('../学生观察<>.jpg')).toBe('学生观察__.jpg')
    expect(sanitizeEvidenceFilename('C:\\temp\\record.mp4')).toBe('record.mp4')
  })
})
