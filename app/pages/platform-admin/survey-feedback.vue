<script setup lang="ts">
definePageMeta({ layout: 'default' })

interface SurveyFeedbackConfig {
  initialized: boolean
  enabled: boolean
  title: string
  url: string | null
}

const toast = useToast()
const { data, refresh } = await useFetch<SurveyFeedbackConfig>('/api/v1/settings/survey-feedback')

const enabled = ref(true)
const title = ref('调研反馈')
const url = ref('')

watch(data, (value) => {
  if (!value) return
  enabled.value = value.enabled
  title.value = value.title
  url.value = value.url ?? ''
}, { immediate: true })

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await $fetch('/api/v1/platform-admin/survey-feedback', {
      method: 'PATCH',
      body: {
        enabled: enabled.value,
        title: title.value.trim() || '调研反馈',
        url: url.value.trim() || null,
      },
    })
    toast.add({ title: '配置已保存', description: '所有页面右下角反馈按钮将立即生效。', color: 'success' })
    refresh()
  } catch (error: any) {
    toast.add({ title: '保存失败', description: error?.data?.message || '请稍后重试', color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ManagementPage title="调研反馈" description="管理所有页面右下角的调研反馈入口：问卷链接、显示文案与开关。">
    <div class="mt-6 flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold text-gray-900">反馈入口设置</h2>
        <p class="mt-1 text-sm text-gray-500">
          关闭开关或清空链接后，各页面右下角的调研反馈按钮将不再显示。
        </p>
      </div>
      <UButton color="primary" size="sm" icon="i-lucide-save" :loading="saving" @click="save">保存配置</UButton>
    </div>

    <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium text-gray-700">启用反馈按钮</p>
          <USwitch v-model="enabled" color="primary" />
        </div>
        <p class="mt-0.5 text-xs text-gray-400">关闭后所有页面不再显示调研反馈入口</p>
      </div>

      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p class="text-sm font-medium text-gray-700">按钮提示文案</p>
        <p class="mt-0.5 text-xs text-gray-400">悬停按钮时显示的提示，默认「调研反馈」</p>
        <UInput v-model="title" class="mt-2 w-full" maxlength="40" placeholder="调研反馈" />
      </div>

      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
        <p class="text-sm font-medium text-gray-700">问卷链接</p>
        <p class="mt-0.5 text-xs text-gray-400">
          填写问卷星等调研问卷的完整链接（https:// 开头）。清空后隐藏按钮。
        </p>
        <UInput v-model="url" class="mt-2 w-full" placeholder="https://v.wjx.cn/vm/..." />
      </div>
    </div>
  </ManagementPage>
</template>