<script setup lang="ts">
/**
 * 看板页头的「数据范围面包屑 + 口径 + 敏感能力」摘要（四个看板页共用）。
 *
 * 面包屑即全局下钻状态（学校 › 年级 › 班级）：层级可点回退，状态存在 URL 查询里，
 * 因此四个看板页与浏览器刷新看到的是同一套筛选（见 useDashboardFilters）。
 *
 * 徽标口径对齐原型：
 * - 个体明细默认关闭（未开通 `view_sensitive`）→「仅聚合视图」；
 * - 平台后台按校方开通后 →「个体明细需事由授权」，提示每次查看都要填事由换 15 分钟授权。
 */
import type { DashboardContext } from '#shared/dashboard'

const props = defineProps<{ context: DashboardContext | null | undefined }>()

const { grade, classIds, resetToSchool, drillToGradeLevel } = useDashboardFilters()

const gradeLabel = computed(() => {
  if (grade.value === '') return ''
  return props.context?.grades.find(item => item.grade === grade.value)?.label ?? `${grade.value} 年级`
})

const selectedClasses = computed(() => (props.context?.classes ?? []).filter(item => classIds.value.includes(item.id)))
const classLabel = computed(() => {
  if (!classIds.value.length) return ''
  if (selectedClasses.value.length === 1) return selectedClasses.value[0]!.name
  return `${classIds.value.length} 个班级`
})

/** 班级数：下钻到年级时按该年级统计，下钻到班级时按已选班级统计。 */
const classCountLabel = computed(() => {
  if (!props.context) return ''
  if (classIds.value.length) return `已选 ${classIds.value.length} 个班级`
  if (grade.value !== '') {
    const gradeScope = props.context.grades.find(item => item.grade === grade.value)
    return `${gradeScope?.classCount ?? 0} 个班级`
  }
  return `${props.context.classCount} 个班级`
})
</script>

<template>
  <span v-if="context">
    <span class="mx-1.5 text-slate-300">|</span>
    数据范围：
    <button
      type="button"
      class="font-medium"
      :class="grade === '' ? 'text-slate-700' : 'text-emerald-700 hover:underline'"
      :disabled="grade === ''"
      @click="resetToSchool"
    >
      {{ context.sectionLabel }}
    </button>
    <template v-if="grade !== ''">
      <span class="mx-1 text-slate-300">›</span>
      <button
        type="button"
        class="font-medium"
        :class="classIds.length ? 'text-emerald-700 hover:underline' : 'text-slate-700'"
        :disabled="!classIds.length"
        @click="drillToGradeLevel"
      >
        {{ gradeLabel }}
      </button>
    </template>
    <template v-if="classLabel">
      <span class="mx-1 text-slate-300">›</span>
      <span class="font-medium text-slate-700">{{ classLabel }}</span>
    </template>
    <span class="mx-1.5 text-slate-300">|</span>{{ classCountLabel }}
    <template v-if="context.line === 'moral'">
      <span class="mx-1.5 text-slate-300">|</span>
      <span class="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">{{ context.lineLabel }}</span>
    </template>
    <span class="mx-1.5 text-slate-300">|</span>
    <span
      class="rounded px-1.5 py-0.5 text-xs font-medium"
      :class="context.canViewIndividual ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'"
    >{{ context.canViewIndividual ? '个体明细需事由授权' : '仅聚合视图' }}</span>
  </span>
</template>
