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
      color="primary"
      size="lg"
      square
      :aria-label="`打开${feedback.title}`"
      class="fixed bottom-20 right-4 z-40 shadow-lg md:bottom-6 md:right-6 print:hidden"
    />
  </UTooltip>
</template>