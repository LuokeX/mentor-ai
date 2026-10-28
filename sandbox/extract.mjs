/**
 * 资料文本抽取：txt / md / docx。
 *
 * docx 只读 word/document.xml 的文本节点，不执行宏、不解析图片、不展开外部关系；
 * ZIP 读取只支持普通（非 ZIP64）格式，遇到异常结构直接返回可读错误。
 */
import { inflateRawSync } from 'node:zlib'
import { SandboxError } from './workspaces.mjs'

const MAX_EXTRACT_CHARS = 200_000

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function readZipEntry(buffer, entryName) {
  const eocd = findEndOfCentralDirectory(buffer)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  const entryCount = buffer.readUInt16LE(eocd + 10)
  let offset = centralOffset
  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014B50) {
      throw new SandboxError(415, 'INVALID_ZIP', 'DOCX 文件结构不完整')
    }
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    if (name === entryName) {
      if (compressedSize === 0xFFFFFFFF || uncompressedSize === 0xFFFFFFFF || localOffset === 0xFFFFFFFF) {
        throw new SandboxError(415, 'ZIP64_UNSUPPORTED', '暂不支持 ZIP64 格式的 DOCX')
      }
      if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034B50) {
        throw new SandboxError(415, 'INVALID_ZIP', 'DOCX 文件结构不完整')
      }
      const localNameLength = buffer.readUInt16LE(localOffset + 26)
      const localExtraLength = buffer.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + localNameLength + localExtraLength
      const data = buffer.subarray(dataStart, dataStart + compressedSize)
      if (data.length !== compressedSize) throw new SandboxError(415, 'INVALID_ZIP', 'DOCX 文件结构不完整')
      if (method === 0) return Buffer.from(data)
      if (method === 8) {
        try {
          return inflateRawSync(data)
        } catch {
          throw new SandboxError(415, 'INVALID_ZIP', 'DOCX 文件结构不完整')
        }
      }
      throw new SandboxError(415, 'UNSUPPORTED_COMPRESSION', 'DOCX 使用了不支持的压缩方式')
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  throw new SandboxError(415, 'DOCX_TEXT_MISSING', 'DOCX 文件缺少正文')
}

function findEndOfCentralDirectory(buffer) {
  const min = Math.max(0, buffer.length - 22 - 65535)
  for (let offset = buffer.length - 22; offset >= min; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054B50) return offset
  }
  throw new SandboxError(415, 'INVALID_ZIP', 'DOCX 文件结构不完整')
}

function xmlToText(xml) {
  return decodeEntities(
    xml
      .replace(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g, '')
      .replace(/<w:delText[^>]*>[\s\S]*?<\/w:delText>/g, '')
      .replace(/<w:tab\b[^>]*\/>/g, '\t')
      .replace(/<w:(?:br|cr)\b[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
  )
}

function normalizeText(text) {
  const cleaned = text
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (cleaned.length <= MAX_EXTRACT_CHARS) return { text: cleaned, truncated: false }
  return { text: `${cleaned.slice(0, MAX_EXTRACT_CHARS)}\n\n[内容过长，已截断]`, truncated: true }
}

export function extractText(fileName, buffer) {
  const extension = String(fileName).toLowerCase().split('.').pop() || ''
  if (extension === 'txt' || extension === 'md' || extension === 'markdown') {
    return normalizeText(new TextDecoder('utf-8', { fatal: false }).decode(buffer))
  }
  if (extension === 'docx') {
    const xml = readZipEntry(buffer, 'word/document.xml').toString('utf8')
    return normalizeText(xmlToText(xml))
  }
  throw new SandboxError(415, 'UNSUPPORTED_FILE_TYPE', '仅支持 txt / md / docx 资料')
}
