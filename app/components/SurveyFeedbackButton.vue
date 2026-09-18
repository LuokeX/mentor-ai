<script setup lang="ts">
interface SurveyFeedbackConfig {
  initialized: boolean
  enabled: boolean
  title: string
  url: string | null
}

const { data } = await useFetch<SurveyFeedbackConfig>('/api/v1/settings/survey-feedback')

const feedback = computed(() => (data.value?.enabled && data.value?.url)
  ? { url: data.value.url, title: data.value.title || '调研反馈' }
  : null)

/**
 * 默认展开状态随窗口宽度：桌面与平板横屏（≥1024px，与导航同一断点）默认展开，
 * 手机竖屏/横屏（<1024px）默认收起成右侧窄把手。点击箭头仍可手动收起/展开，跨断点时回到该宽度默认值。
 * 不使用悬停，避免鼠标设备上「悬停展开 + 点击收起」互相打架。
 */
const expanded = ref(false)

onMounted(() => {
  const media = window.matchMedia('(min-width: 1024px)')
  const sync = () => {
    expanded.value = media.matches
  }
  sync()
  media.addEventListener('change', sync)
  onBeforeUnmount(() => media.removeEventListener('change', sync))
})
</script>

<template>
  <div
    v-if="feedback"
    class="fixed right-0 top-1/2 z-40 flex -translate-y-1/2 items-stretch transition-transform duration-200 print:hidden"
    :class="expanded ? 'translate-x-0' : 'translate-x-[calc(100%-1.25rem)]'"
  >
    <button
      type="button"
      class="grid h-14 w-5 shrink-0 self-center place-items-center rounded-l-lg bg-[var(--ui-primary)] text-white"
      :aria-expanded="expanded"
      :aria-label="expanded ? '收起调研反馈' : '展开调研反馈'"
      @click="expanded = !expanded"
    >
      <UIcon :name="expanded ? 'i-lucide-chevron-right' : 'i-lucide-chevron-left'" class="size-3.5" />
    </button>
    <a
      :href="feedback.url || undefined"
      target="_blank"
      rel="noopener noreferrer"
      class="flex flex-col items-center gap-2 bg-[var(--ui-primary)] px-2 py-3 text-white"
      :aria-label="`打开${feedback.title}`"
    >
      <UIcon name="i-lucide-clipboard-pen-line" class="size-5" />
      <span class="text-sm font-medium tracking-widest [writing-mode:vertical-rl]">{{ feedback.title }}</span>
    </a>
  </div>
</template>
