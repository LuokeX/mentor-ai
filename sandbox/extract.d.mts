export interface ExtractTextResult {
  text: string
  truncated: boolean
}

export function extractText(fileName: string, buffer: Buffer): ExtractTextResult
