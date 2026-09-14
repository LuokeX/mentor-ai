/**
 * 手机端键盘状态：是否弹出（covered）与键盘遮挡高度（inset）。
 *
 * 浏览器行为（Chrome 108 起 Android 与 iOS 一致，默认只压缩「可视视口」）：
 *  - 键盘以浮层出现，压缩可视视口，布局视口不变；
 *  - 为了让贴在页面底部的输入框露出来，浏览器还会向下平移可视视口（offsetTop > 0），
 *    此时 position: fixed 的底部菜单会被一起拖到键盘上方——看起来就是「菜单自己上去了」；
 *  - 因此 nuxt.config.ts 显式声明 interactive-widget=resizes-content：Android 上布局视口直接
 *    收缩（fixed 元素仍落在键盘上方，所以布局层必须在键盘弹出时隐藏底部菜单），
 *    iOS 不支持该声明，仍按可视视口差值补偿。代码对三种行为都做了判定，改配置也不会失效。
 *
 * 判定要点（避免键盘收起后状态残留、界面缩不回去）：
 *  1. 键盘量级的变化必须 ≥120px，地址栏/工具栏的几十像素差异一律忽略；
 *  2. 当前没有输入框在焦点上时，一律按「无键盘」处理；
 *  3. 输入框失焦（收起键盘的常见路径）清零并进入宽限期，避免陈旧读数把状态填回来；
 *     焦点在输入框之间切换时不当作「收起键盘」。
 */
const KEYBOARD_MIN_INSET = 120
/** 键盘弹出时浏览器会平移可视视口把输入框顶上来：这个位移本身就是键盘在弹的信号。 */
const KEYBOARD_MIN_PAN = 40
/** 键盘收起后浏览器不一定补发事件，尺寸变化后再兜底复算一次。 */
const RECHECK_DELAY_MS = 350
/** 失焦清零后的宽限期：期间忽略差值，避免陈旧读数把状态填回来。 */
const RESET_GRACE_MS = 600
/** 焦点离开输入框后的观察窗口：期间焦点若落到另一个输入框，按「键盘仍在」处理。 */
const FOCUS_SETTLE_MS = 150
/** 捏合缩放会把 offsetTop/height 一起改掉，缩放期间不参与键盘判定。 */
const MAX_UNZOOMED_SCALE = 1.05

export interface KeyboardViewportInput {
  /** 当前是否有输入框在焦点上。 */
  focused: boolean
  /** 布局视口高度（window.innerHeight）。 */
  layoutHeight: number
  /** 输入框获得焦点时的布局视口高度：resizes-content 下键盘会把它压小。 */
  focusLayoutHeight: number
  /** 可视视口高度（visualViewport.height）；浏览器不支持时为 null。 */
  visualHeight: number | null
  /** 可视视口向下平移量（visualViewport.offsetTop）。 */
  visualOffsetTop: number
  /** 可视视口缩放比例（visualViewport.scale）。 */
  visualScale: number
}

export interface KeyboardViewportState {
  /** 底部是否被键盘挡住（布局层据此隐藏底部菜单）。 */
  covered: boolean
  /** 键盘在可视区域下方占掉的高度（px），用于把对话面板底部对齐到键盘上沿。 */
  inset: number
}

/** 纯计算：从视口读数判定键盘状态，便于单元测试覆盖各浏览器分支。 */
export function resolveKeyboardViewport(input: KeyboardViewportInput): KeyboardViewportState {
  if (!input.focused) return { covered: false, inset: 0 }
  const hasVisual = input.visualHeight !== null
  // 捏合缩放会同时改掉可视视口的高度和位移，这两项在缩放期间不可信；
  // 布局视口是否被键盘压缩与缩放无关，仍然保留。
  const zoomed = input.visualScale > MAX_UNZOOMED_SCALE
  const panned = hasVisual && !zoomed
    ? Math.max(0, Math.round(input.visualOffsetTop))
    : 0
  // resizes-visual：布局视口不变，被键盘压缩掉的高度记在可视视口上（平移部分已单独计入）
  const visualShrink = hasVisual && !zoomed
    ? Math.round(input.layoutHeight - (input.visualHeight as number) - panned)
    : 0
  // resizes-content：布局视口本身被压缩，可视视口差值接近 0
  const layoutShrink = input.focusLayoutHeight > 0
    ? Math.round(input.focusLayoutHeight - input.layoutHeight)
    : 0
  const covered = visualShrink >= KEYBOARD_MIN_INSET
    || layoutShrink >= KEYBOARD_MIN_INSET
    || panned >= KEYBOARD_MIN_PAN
  if (!covered) return { covered: false, inset: 0 }
  // 面板高度按 calc(100dvh - base - inset) 计算：resizes-content 下 dvh 已收缩，inset 取 0
  return { covered: true, inset: Math.max(visualShrink, 0) }
}

function hasFocusedEditable() {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return false
  return active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable
}

export function useKeyboardInset() {
  const inset = useState('keyboard-inset', () => 0)
  /** 底部是否被键盘挡住：布局层用它把底部菜单藏到键盘后面。 */
  const covered = useState('keyboard-covered', () => false)
  let recheckTimer: ReturnType<typeof setTimeout> | null = null
  let blurTimer: ReturnType<typeof setTimeout> | null = null
  let graceUntil = 0
  /** 输入框获得焦点时的布局视口高度，作为 resizes-content 下识别键盘的基准。 */
  let focusLayoutHeight = 0

  function apply() {
    if (Date.now() < graceUntil) return
    const viewport = window.visualViewport
    const state = resolveKeyboardViewport({
      focused: hasFocusedEditable(),
      layoutHeight: Math.round(window.innerHeight),
      focusLayoutHeight,
      visualHeight: viewport ? Math.round(viewport.height) : null,
      visualOffsetTop: viewport ? viewport.offsetTop : 0,
      visualScale: viewport ? viewport.scale : 1
    })
    covered.value = state.covered
    inset.value = state.inset
  }

  function scheduleRecheck(delay = RECHECK_DELAY_MS) {
    if (recheckTimer) clearTimeout(recheckTimer)
    recheckTimer = setTimeout(apply, delay)
  }

  /** 输入框失焦等明确信号：清零并进入宽限期，确保键盘收起后界面一定恢复。 */
  function reset() {
    covered.value = false
    inset.value = 0
    focusLayoutHeight = 0
    graceUntil = Date.now() + RESET_GRACE_MS
    scheduleRecheck(RESET_GRACE_MS + 50)
  }

  /** 焦点进入输入框：记录键盘弹出前的布局视口高度，作为 resizes-content 下的判定基准。 */
  function onFocusIn() {
    if (blurTimer) {
      clearTimeout(blurTimer)
      blurTimer = null
    }
    // 键盘已经弹出时保持原基准（切换输入框不能把压缩后的高度当成基准）
    if (!covered.value) focusLayoutHeight = Math.round(window.innerHeight)
    scheduleRecheck()
  }

  /** 焦点离开：可能是真的收起键盘，也可能只是切到另一个输入框，等一拍再判断。 */
  function onFocusOut() {
    if (blurTimer) clearTimeout(blurTimer)
    blurTimer = setTimeout(() => {
      blurTimer = null
      if (!hasFocusedEditable()) reset()
    }, FOCUS_SETTLE_MS)
  }

  /** 旋转屏幕会整体重排：用新的布局视口高度重新取基准，避免旧基准被当成「键盘压缩」。 */
  function onViewportReset() {
    focusLayoutHeight = hasFocusedEditable() ? Math.round(window.innerHeight) : 0
    scheduleRecheck(2 * RECHECK_DELAY_MS)
  }

  /** 在布局层调用一次，绑定 visualViewport 与窗口尺寸监听。 */
  function bindKeyboardInset() {
    onMounted(() => {
      const viewport = window.visualViewport
      apply()
      viewport?.addEventListener('resize', apply)
      viewport?.addEventListener('scroll', apply)
      window.addEventListener('resize', apply)
      window.addEventListener('orientationchange', onViewportReset)
      document.addEventListener('focusin', onFocusIn)
      document.addEventListener('focusout', onFocusOut)
      onBeforeUnmount(() => {
        viewport?.removeEventListener('resize', apply)
        viewport?.removeEventListener('scroll', apply)
        window.removeEventListener('resize', apply)
        window.removeEventListener('orientationchange', onViewportReset)
        document.removeEventListener('focusin', onFocusIn)
        document.removeEventListener('focusout', onFocusOut)
        if (recheckTimer) clearTimeout(recheckTimer)
        if (blurTimer) clearTimeout(blurTimer)
      })
    })
  }

  return { inset, covered, reset, bindKeyboardInset }
}
