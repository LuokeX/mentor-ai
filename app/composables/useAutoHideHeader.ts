/**
 * 移动/平板端顶部导航与底部菜单的自动收起。
 *
 * 只在小屏（<1024px，与 Tailwind 的 lg 断点一致）启用；桌面端恒为显示。
 * 小屏进页面默认收起：只留底部中央的悬浮按钮，点一下才滑出顶栏与底部菜单，
 * 滑出 6 秒后自动收起；任何方向的滚动也立即收起（不再「向上滑就显示」）。
 * 滚动来源有两处，都通过 reportScroll 上报：
 *  - 布局层监听 window 滚动（方案、信息中心等可滚动页面）；
 *  - 首页对话页监听消息区滚动（页面本身几乎不滚动）。
 *
 * 顶栏与底部菜单都是浮层：显示/收起只改变浮层位移，不改变页面留白，避免挤压正在阅读的内容。
 */
const MIN_DELTA = 8
/** 点悬浮按钮滑出导航后，多久自动收起（毫秒）。 */
const AUTO_HIDE_MS = 6000

export function useAutoHideHeader() {
  const hidden = useState('auto-hide-header', () => false)
  /** 当前是否处于小屏（只有小屏才允许收起）。 */
  const enabled = useState('auto-hide-header-enabled', () => false)
  let lastY = 0
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  function clearHideTimer() {
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  }

  /** 立即收起（并取消已排队的自动收起）。 */
  function hide() {
    clearHideTimer()
    if (enabled.value) hidden.value = true
  }

  /** 滑出顶栏与底部菜单，并在 AUTO_HIDE_MS 后自动收起。 */
  function reveal() {
    if (!enabled.value) return
    hidden.value = false
    clearHideTimer()
    hideTimer = setTimeout(() => {
      hideTimer = null
      hidden.value = true
    }, AUTO_HIDE_MS)
  }

  /**
   * 上报一次滚动位置：任何方向、只要真的滚动了就收起导航。
   * maxY 传入当前容器可滚动的最大值：贴底时的位置变化可能不是用户滚动（浮层收起会让面板长高、
   * 贴底容器被浏览器回调），此时只同步位置、不切换显示状态，避免来回闪。
   */
  function reportScroll(y: number, maxY?: number) {
    if (!enabled.value) return
    const next = Math.max(0, Math.round(y))
    const delta = next - lastY
    lastY = next
    if (maxY !== undefined && next >= Math.round(maxY) - 4) return
    if (Math.abs(delta) >= MIN_DELTA) hide()
  }

  /** 预置：初始化监听并保持与断点同步，重复调用不会重复绑定。 */
  function bindAutoHideHeader() {
    onMounted(() => {
      const media = window.matchMedia('(min-width: 1024px)')
      const sync = () => {
        enabled.value = !media.matches
        // 小屏进页面默认收起：只留悬浮按钮，导航点一下才滑出；桌面端恒显示
        hidden.value = enabled.value
        clearHideTimer()
        lastY = Math.max(0, Math.round(window.scrollY))
      }
      const onWindowScroll = () => reportScroll(window.scrollY, document.documentElement.scrollHeight - window.innerHeight)
      sync()
      media.addEventListener('change', sync)
      window.addEventListener('scroll', onWindowScroll, { passive: true })
      onBeforeUnmount(() => {
        clearHideTimer()
        media.removeEventListener('change', sync)
        window.removeEventListener('scroll', onWindowScroll)
      })
    })
  }

  return { hidden, enabled, reportScroll, reveal, hide, bindAutoHideHeader }
}
