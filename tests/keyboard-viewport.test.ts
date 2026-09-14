import { describe, expect, it } from 'vitest'
import { resolveKeyboardViewport } from '../app/composables/useKeyboardInset'

/** 键盘弹出前的基准读数：布局视口 800、可视视口同高、未缩放。 */
const idle = {
  layoutHeight: 800,
  focusLayoutHeight: 800,
  visualHeight: 800,
  visualOffsetTop: 0,
  visualScale: 1
}

describe('resolveKeyboardViewport', () => {
  it('没有输入框在焦点上时一律按无键盘处理', () => {
    expect(resolveKeyboardViewport({ focused: false, ...idle, visualHeight: 500 })).toEqual({ covered: false, inset: 0 })
  })

  it('resizes-visual：可视视口被压缩，判定为键盘遮挡并给出遮挡高度', () => {
    expect(resolveKeyboardViewport({ focused: true, ...idle, visualHeight: 500 })).toEqual({ covered: true, inset: 300 })
  })

  it('resizes-visual + 浏览器平移：可视视口差值接近 0，靠平移量仍能判定键盘在弹', () => {
    const state = resolveKeyboardViewport({ focused: true, ...idle, visualHeight: 500, visualOffsetTop: 300 })
    expect(state.covered).toBe(true)
    expect(state.inset).toBe(0)
  })

  it('resizes-content：布局视口被压缩、可视视口差值为 0，靠焦点基准高度判定', () => {
    const state = resolveKeyboardViewport({ focused: true, ...idle, layoutHeight: 560, visualHeight: 560 })
    expect(state.covered).toBe(true)
    // dvh 已随布局视口收缩，面板不再额外减 inset
    expect(state.inset).toBe(0)
  })

  it('地址栏/工具栏收起造成的几十像素差异不算键盘', () => {
    expect(resolveKeyboardViewport({ focused: true, ...idle, layoutHeight: 760, visualHeight: 760 })).toEqual({ covered: false, inset: 0 })
  })

  it('捏合缩放期间的位移不参与键盘判定', () => {
    const state = resolveKeyboardViewport({ focused: true, ...idle, visualHeight: 500, visualOffsetTop: 300, visualScale: 2 })
    expect(state.covered).toBe(false)
    expect(state.inset).toBe(0)
  })

  it('浏览器不支持 visualViewport 时，只有布局视口收缩才判定键盘', () => {
    expect(resolveKeyboardViewport({ focused: true, ...idle, visualHeight: null })).toEqual({ covered: false, inset: 0 })
    expect(resolveKeyboardViewport({ focused: true, ...idle, visualHeight: null, layoutHeight: 500 })).toEqual({ covered: true, inset: 0 })
  })
})
