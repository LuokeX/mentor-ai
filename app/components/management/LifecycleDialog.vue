<script setup lang="ts">
defineProps<{
  open: boolean
  action: string
  targetName?: string
  confirmLabel?: string
  loading?: boolean
  reasonRequired?: boolean
}>()
const emit = defineEmits<{
  close: []
  confirm: [reason: string, toUserId?: string]
}>()

const reason = ref('')
const toUserId = ref('')
</script>

<template>
  <UModal :open="open" @close="emit('close')">
    <template #header>
      <h3 class="text-lg font-semibold">{{ action }}</h3>
    </template>
    <div class="space-y-4 p-4">
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
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton variant="outline" @click="emit('close')">取消</UButton>
        <UButton color="primary" :loading="loading" @click="emit('confirm', reason, toUserId || undefined)">
          {{ confirmLabel || '确认' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>