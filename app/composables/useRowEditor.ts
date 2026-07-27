/**
 * 行内编辑 composable
 *
 * 职责：
 * - 管理单行编辑草稿
 * - 校验、保存、取消
 * - 冲突处理（409 EDIT_CONFLICT）
 */
import type { Capability } from '~~/shared/management'

interface RowEditorOptions<T> {
  /** 保存函数 */
  saveFn: (patch: Partial<T>) => Promise<any>
  /** 保存成功回调 */
  onSaved?: () => void
}

export function useRowEditor<T extends Record<string, any>>(opts: RowEditorOptions<T>) {
  const editingId = ref<string | null>(null)
  const draft = ref<Partial<T>>({})
  const saving = ref(false)
  const conflict = ref(false)

  function startEdit(row: T & { id: string }) {
    editingId.value = row.id
    draft.value = { ...row }
    conflict.value = false
  }

  function cancelEdit() {
    editingId.value = null
    draft.value = {}
    conflict.value = false
  }

  function updateField<K extends keyof T>(field: K, value: T[K]) {
    draft.value = { ...draft.value, [field]: value }
  }

  async function save() {
    if (!editingId.value) return
    saving.value = true
    conflict.value = false
    try {
      await opts.saveFn(draft.value)
      editingId.value = null
      draft.value = {}
      opts.onSaved?.()
    } catch (e: any) {
      if (e?.statusCode === 409 || e?.statusMessage === 'EDIT_CONFLICT') {
        conflict.value = true
      }
      throw e
    } finally {
      saving.value = false
    }
  }

  function isEditing(rowId: string): boolean {
    return editingId.value === rowId
  }

  return {
    editingId: readonly(editingId),
    draft: readonly(draft) as Readonly<Partial<T>>,
    saving: readonly(saving),
    conflict: readonly(conflict),
    startEdit,
    cancelEdit,
    updateField,
    save,
    isEditing,
  }
}