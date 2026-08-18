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
</script>

<template>
  <UTooltip v-if="feedback" :text="feedback.title">
    <UButton
      :to="feedback.url"
      target="_blank"
      rel="noopener noreferrer"
      color="primary"
      size="xl"
      class="fixed right-4 top-1/2 z-40 -translate-y-1/2 shadow-xl print:hidden md:right-6"
      :aria-label="`打开${feedback.title}`"
    >
      <span class="flex flex-col items-center gap-2 py-2 pr-1 pl-1.5">
        <UIcon name="i-lucide-clipboard-pen-line" class="size-5" />
        <span class="text-sm font-medium tracking-widest [writing-mode:vertical-rl]">{{ feedback.title }}</span>
      </span>
    </UButton>
  </UTooltip>
</template>