<script setup lang="ts">
definePageMeta({ layout: 'default' })
const route = useRoute()
const schoolId = route.params.id as string
</script>

<template>
  <UserAccountsPanel
    title="账号管理"
    description="查看并管理该学校的教师与心理专员账号。"
    list-endpoint="/api/v1/platform-admin/users"
    can-invite
    :invite-school-id="schoolId"
    :extra-query="() => ({ schoolId })"
  />
</template>