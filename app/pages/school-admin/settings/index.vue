<script setup lang="ts">
const { data: settings } = await useFetch('/api/v1/school-admin/settings')
</script>
<template>
  <ManagementPage title="学校设置" description="管理学校配置">
    <div class="space-y-4 p-4 border border-gray-200 rounded-lg">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><label class="block text-sm font-medium text-gray-700">求助电话</label><span class="text-sm text-gray-900">{{ settings?.helpPhone || '—' }}</span></div>
        <div><label class="block text-sm font-medium text-gray-700">转介确认时限(分钟)</label><span class="text-sm text-gray-900">{{ settings?.referralAckMinutes || '5' }}</span></div>
        <div><label class="block text-sm font-medium text-gray-700">转介升级时限(分钟)</label><span class="text-sm text-gray-900">{{ settings?.referralEscalationMinutes || '15' }}</span></div>
        <div><label class="block text-sm font-medium text-gray-700">AI数据模式</label><span class="text-sm text-gray-900">{{ settings?.aiDataMode || '—' }}</span></div>
      </div>
    </div>
  </ManagementPage>
</template>