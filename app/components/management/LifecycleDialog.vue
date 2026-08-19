<script setup lang="ts">
// 所有归档/恢复/毕业等生命周期操作后端均强制事由 ≥10 字，默认必须填写；
// 仅个别删除确认（如删除未激活邀请）后端不要求事由，由调用处显式传 :reason-required="false"
const props = withDefaults(defineProps<{
  open: boolean
  action: string
  targetName?: string
  confirmLabel?: string
  loading?: boolean
  reasonRequired?: boolean
}>(), {
  reasonRequired: true,
})
const emit = defineEmits<{
  close: []
  confirm: [reason: string, toUserId?: string]
}>()

const reason = ref('')
const toUserId = ref('')
const canConfirm = computed(() => props.reasonRequired === false || reason.value.trim().length >= 10)

watch(() => props.open, open => {
  if (open) {
    reason.value = ''
    toUserId.value = ''
  }
})
</script>

<template>
  <UModal :open="open" @update:open="value => { if (!value) emit('close') }">
    <template #header>
      <h3 class="text-lg font-semibold">{{ action }}</h3>
    </template>
    <template #body>
      <div class="space-y-4">
        <p v-if="targetName" class="text-sm text-gray-600">
          确认对 <span class="font-medium">{{ targetName }}</span> 执行 {{ action }} 操作？
        </p>
        <div v-if="reasonRequired !== false">
          <label class="block text-sm font-medium text-gray-700 mb-1">操作事由</label>
          <UTextarea v-model="reason" placeholder="请输入操作事由（至少10个字符）" :rows="3" />
        </div>
        <div v-if="action === '移交负责人'" class="mt-3">
          <label class="block text-sm font-medium text-gray-700 mb-1">目标负责人</label>
          <UInput v-model="toUserId" placeholder="输入目标用户 ID" />
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton variant="outline" @click="emit('close')">取消</UButton>
        <UButton color="primary" :loading="loading" :disabled="!canConfirm" @click="emit('confirm', reason.trim(), toUserId || undefined)">
          {{ confirmLabel || '确认' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
