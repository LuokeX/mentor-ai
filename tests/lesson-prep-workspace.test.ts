import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildAgentTools } from '../server/agent/tools/index'
import type { AgentUserContext } from '../server/agent/types'
import { lessonPrepFileExtension, validateLessonPrepFileName } from '../server/domain/lesson-prep-files'

const baseContext: AgentUserContext = {
  schoolId: 'school-1',
  userId: 'user-1',
  sessionId: 'session-1'
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('备课资料文件名', () => {
  it('保留中文与扩展名，规范化大小写', () => {
    expect(validateLessonPrepFileName('五年级学情.md')).toBe('五年级学情.md')
    expect(lessonPrepFileExtension('A.DOCX')).toBe('docx')
  })

  it('拒绝路径穿越与不支持的类型', () => {
    vi.stubGlobal('createError', (options: { statusCode: number, message: string }) => Object.assign(new Error(options.message), options))
    expect(() => validateLessonPrepFileName('../secret.md')).toThrow()
    expect(() => validateLessonPrepFileName('a/b.md')).toThrow()
    expect(() => validateLessonPrepFileName('资料.pdf')).toThrow()
    expect(() => validateLessonPrepFileName('.upload-x.md')).toThrow()
  })
})

describe('Agent 工作区工具暴露', () => {
  const workspaceTools = ['workspace_list_files', 'workspace_read_file', 'workspace_write_file', 'workspace_delete_file']

  it('仅绑定有效工作区时暴露 4 个工作区工具', () => {
    const names = buildAgentTools({ ...baseContext, sandboxWorkspaceId: 'workspace-1' }).map(tool => tool.name)
    for (const name of workspaceTools) expect(names).toContain(name)
  })

  it('没有工作区或选择不带档案时不暴露', () => {
    expect(buildAgentTools(baseContext).map(tool => tool.name)).not.toContain('workspace_list_files')
    expect(buildAgentTools({ ...baseContext, sandboxWorkspaceId: 'workspace-1', withoutRecord: true }).map(tool => tool.name))
      .not.toContain('workspace_list_files')
  })

  it('AI_AGENT_ENABLED_TOOLS 仍可按白名单裁剪', () => {
    const names = buildAgentTools({ ...baseContext, sandboxWorkspaceId: 'workspace-1' }, ['workspace_list_files'])
      .map(tool => tool.name)
    expect(names).toEqual(['workspace_list_files'])
  })
})
