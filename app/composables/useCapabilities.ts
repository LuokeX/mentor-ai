/**
 * 能力解析 composable（前端）
 *
 * 职责：纯粹解释服务端返回的 _capabilities 数组，
 * 不做任何真实权限推断。
 */
import type { Capability } from '~~/shared/management'

export function useCapabilities() {
  function can(required: Capability, capabilities: Capability[]): boolean {
    return capabilities.includes(required)
  }

  function canAny(required: Capability[], capabilities: Capability[]): boolean {
    return required.some((c) => capabilities.includes(c))
  }

  function canAll(required: Capability[], capabilities: Capability[]): boolean {
    return required.every((c) => capabilities.includes(c))
  }

  /** 是否可编辑（edit 或 inline_edit） */
  function canEdit(capabilities: Capability[]): boolean {
    return canAny(['edit', 'inline_edit'], capabilities)
  }

  /** 是否可查看敏感详情 */
  function canViewSensitive(capabilities: Capability[]): boolean {
    return can('view_sensitive', capabilities)
  }

  return { can, canAny, canAll, canEdit, canViewSensitive }
}