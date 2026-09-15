<script setup lang="ts">
/**
 * 教师端安全转介卡片：量表提交熔断与首页 AI 助手熔断共用同一套结构与措辞。
 *
 * 硬性约束：面向教师的文案不得出现「危机 / 红线 / 预警 / 立即 / 110 / 120」字样。
 * 学校配置的指引由服务端 `resolveCrisisGuide` 兜底，本组件不再做二次过滤。
 */
const props = defineProps<{
  /** 学校配置的转介指引原文（服务端已保证不含禁用字样） */
  guide: string
  /** 首页助手的提示语；量表熔断页不传 */
  message?: string
  /** 校内求助电话（学校设置 help_phone），为空时引导联系心理专员 */
  helpPhone?: string | null
  /** 转介确认时限（分钟） */
  ackMinutes?: number
  /** 转介升级时限（分钟） */
  escalationMinutes?: number
  /** 是否已指派默认心理专员；未指派时直接升级给学校管理员 */
  psychologistAssigned?: boolean
  /** 风险事件编号，可复制用于线下核对 */
  eventId?: string
}>()

const telHref = computed(() => {
  const digits = (props.helpPhone || '').replace(/[^\d+]/g, '')
  return digits ? `tel:${digits}` : ''
})

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

async function copyEventId() {
  if (!props.eventId || !import.meta.client) return
  try {
    await navigator.clipboard.writeText(props.eventId)
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // 复制失败不阻塞展示：编号仍可见，可手动记录
  }
}

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})
</script>

<template>
  <div data-testid="crisis-referral-card" class="rounded-2xl border-2 border-red-200 bg-red-50 p-5 text-red-900">
    <div class="flex gap-3">
      <UIcon name="i-lucide-siren" class="mt-0.5 size-6 shrink-0 text-red-600" />
      <div class="min-w-0 flex-1 space-y-3">
        <div>
          <h3 class="font-semibold">已启动安全转介</h3>
          <p v-if="message" class="mt-1.5 text-sm text-red-800">{{ message }}</p>
        </div>

        <ol class="space-y-2 text-sm text-red-900">
          <li class="flex gap-2">
            <span class="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-white/80 text-[11px] font-semibold">1</span>
            <span v-if="helpPhone">
              拨打校内求助电话
              <a :href="telHref" class="font-semibold underline underline-offset-2">{{ helpPhone }}</a>
            </span>
            <span v-else>联系学校心理专员或值班负责人</span>
          </li>
          <li class="flex gap-2">
            <span class="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-white/80 text-[11px] font-semibold">2</span>
            <span>按学校指引处理：{{ guide }}</span>
          </li>
          <li class="flex gap-2">
            <span class="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-white/80 text-[11px] font-semibold">3</span>
            <span v-if="psychologistAssigned">心理专员已收到通知，通常 {{ ackMinutes ?? 5 }} 分钟内确认；{{ escalationMinutes ?? 15 }} 分钟内未确认将自动升级至学校管理员。</span>
            <span v-else>学校管理员已收到通知，会尽快与您联系。</span>
          </li>
        </ol>

        <div v-if="eventId" class="flex flex-wrap items-center gap-2 text-xs text-red-700">
          <span class="break-all">事件编号：{{ eventId }}</span>
          <UButton size="xs" color="error" variant="ghost" :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'" @click="copyEventId">
            {{ copied ? '已复制' : '复制' }}
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>
