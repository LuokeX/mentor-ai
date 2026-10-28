import type { Ref } from 'vue'

export interface LessonWorkspaceFile {
  name: string
  size: number
  updatedAt?: number
}

/**
 * 备课资料工作区（前端状态）。
 *
 * 只负责创建/复用工作区、上传/删除/列出文件；工作区与会话的绑定由服务端在发消息时完成。
 * 文件内容不进入前端持久化，刷新页面后由会话详情给出 workspaceId，再重新列出文件。
 */
export function useLessonWorkspace(enabled: Ref<boolean>) {
  const toast = useToast()
  const workspaceId = ref<string | null>(null)
  const files = ref<LessonWorkspaceFile[]>([])
  const uploading = ref(false)
  const supportedTypes = ['txt', 'md', 'markdown', 'docx']
  const maxFileBytes = 20 * 1024 * 1024

  function reset() {
    workspaceId.value = null
    files.value = []
  }

  function errorMessage(error: unknown, fallback: string): string {
    const data = (error as { data?: { message?: unknown } })?.data
    if (data && typeof data.message === 'string' && data.message.trim()) return data.message.trim()
    return fallback
  }

  async function ensureWorkspace(sessionId?: string): Promise<string> {
    if (!enabled.value) throw new Error('资料上传暂未开放')
    if (workspaceId.value) return workspaceId.value
    const result = await $fetch<{ workspaceId: string }>('/api/v1/chat/lesson-prep/workspaces', {
      method: 'POST',
      body: { sessionId }
    })
    workspaceId.value = result.workspaceId
    return result.workspaceId
  }

  async function refreshFiles() {
    if (!workspaceId.value || !enabled.value) return
    try {
      const result = await $fetch<{ files: LessonWorkspaceFile[] }>(
        `/api/v1/chat/lesson-prep/workspaces/${workspaceId.value}/files`
      )
      files.value = Array.isArray(result.files) ? result.files : []
    } catch (error) {
      const statusCode = (error as { statusCode?: number })?.statusCode
      if (statusCode === 404 || statusCode === 410) reset()
    }
  }

  async function loadWorkspace(id: string | null | undefined) {
    if (!enabled.value || !id) {
      reset()
      return
    }
    workspaceId.value = id
    await refreshFiles()
  }

  async function uploadFiles(list: FileList | File[], sessionId?: string) {
    if (!enabled.value) return
    const selected = Array.from(list)
    if (!selected.length) return
    uploading.value = true
    let uploadedCount = 0
    try {
      const id = await ensureWorkspace(sessionId)
      for (const file of selected) {
        const extension = file.name.toLowerCase().split('.').pop() || ''
        if (!supportedTypes.includes(extension)) {
          toast.add({ title: '不支持的文件类型', description: `${file.name}：仅支持 txt / md / docx`, color: 'warning' })
          continue
        }
        if (file.size > maxFileBytes) {
          toast.add({ title: '文件过大', description: `${file.name} 超过 20MB`, color: 'warning' })
          continue
        }
        const response = await fetch(`/api/v1/chat/lesson-prep/workspaces/${id}/files`, {
          method: 'POST',
          headers: {
            'x-file-name': encodeURIComponent(file.name),
            'content-type': file.type || 'application/octet-stream'
          },
          body: file
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { message?: string } | null
          toast.add({ title: '上传失败', description: payload?.message || file.name, color: 'error' })
          continue
        }
        const uploaded = await response.json() as { name: string, size: number }
        files.value = [...files.value.filter(item => item.name !== uploaded.name), { name: uploaded.name, size: uploaded.size }]
        uploadedCount += 1
      }
      if (uploadedCount) toast.add({ title: '资料已加入备课工作区', color: 'success' })
    } catch (error) {
      toast.add({ title: '上传失败', description: errorMessage(error, '请稍后重试'), color: 'error' })
    } finally {
      uploading.value = false
    }
  }

  async function removeFile(name: string) {
    if (!workspaceId.value) return
    try {
      await $fetch(`/api/v1/chat/lesson-prep/workspaces/${workspaceId.value}/files`, {
        method: 'DELETE',
        query: { name }
      })
      files.value = files.value.filter(item => item.name !== name)
    } catch (error) {
      toast.add({ title: '删除失败', description: errorMessage(error, '请稍后重试'), color: 'error' })
    }
  }

  function setWorkspace(id: string | null | undefined) {
    workspaceId.value = id || null
    if (!workspaceId.value) files.value = []
  }

  return {
    workspaceId,
    files,
    uploading,
    supportedTypes,
    maxFileBytes,
    ensureWorkspace,
    loadWorkspace,
    refreshFiles,
    uploadFiles,
    removeFile,
    setWorkspace,
    reset
  }
}
