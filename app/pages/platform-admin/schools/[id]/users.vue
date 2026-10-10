<script setup lang="ts">
definePageMeta({ layout: 'default' })
const route = useRoute()
const schoolId = route.params.id as string
</script>

<template>
  <UserAccountsPanel
    title="账号管理"
    description="添加、编辑、移交和停用该学校的教师、心理专员及数据驾驶舱角色（德育主任、年级主任）账号。"
    list-endpoint="/api/v1/school-admin/users"
    can-invite
    :invite-school-id="schoolId"
    :extra-query="() => ({ schoolId })"
  />
</template>
