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
      icon="i-lucide-clipboard-pen-line"
      :label="feedback.title"
      color="primary"
      size="xl"
      class="fixed bottom-20 left-1/2 z-40 -translate-x-1/2 shadow-xl print:hidden md:bottom-6 md:h-14 md:px-8 md:text-base"
      :aria-label="`打开${feedback.title}`"
    />
  </UTooltip>
</template>