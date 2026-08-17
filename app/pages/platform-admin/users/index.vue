<script setup lang="ts">
definePageMeta({ layout: 'default' })
</script>

<template>
  <UserAccountsPanel
    title="全部账户"
    description="查看并管理所有学校的教师与心理专员账号，可编辑资料、启停、移交和重新邀请。"
    list-endpoint="/api/v1/platform-admin/users"
    show-school
  />
</template>