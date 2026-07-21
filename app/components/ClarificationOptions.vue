<script setup lang="ts">
const props = defineProps<{
  question: string
  options: string[]
  round: number
  selectedOption?: string  // 传入时表示该轮已完成，组件变为只读展示
}>()

const emit = defineEmits<{
  select: [option: string]
  done: []
}>()

const localSelected = ref<string | null>(null)
const effectiveSelected = computed(() => props.selectedOption || localSelected.value)
const isLocked = computed(() => Boolean(props.selectedOption))
</script>

<template>
  <div class="mt-4 flex items-start gap-3">
    <div class="grid size-8 shrink-0 place-items-center rounded-xl border border-violet-100 bg-white text-violet-700 shadow-sm">
      <UIcon name="i-lucide-help-circle" class="size-4" />
    </div>
    <div class="min-w-0 max-w-[88%] sm:max-w-[82%]">
      <p class="mb-1.5 text-[11px] text-slate-400">
        赋能助手 · 追问第{{ round }}轮
        <span v-if="isLocked" class="ml-1 text-emerald-600">· 已选择</span>
      </p>
      <div class="rounded-2xl rounded-tl-md border border-violet-100 bg-violet-50/70 p-5">
        <p class="text-sm leading-6 text-slate-700">{{ question }}</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <button
            v-for="(option, idx) in options"
            :key="idx"
            :disabled="isLocked || localSelected !== null"
            class="rounded-xl border px-4 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed"
            :class="effectiveSelected === option
              ? 'border-emerald-400 bg-emerald-50 text-emerald-700 shadow-sm'
              : isLocked
                ? 'border-slate-100 bg-slate-50 text-slate-300'
                : 'border-slate-200 bg-white text-slate-600 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700'"
            @click="localSelected = option; emit('select', option)"
          >
            {{ option }}
          </button>
          <button
            v-if="!isLocked"
            :disabled="localSelected !== null"
            class="rounded-xl border border-dashed border-slate-300 px-4 py-2 text-sm font-medium text-slate-400 transition-all hover:border-slate-400 hover:bg-slate-50 hover:text-slate-600 disabled:cursor-not-allowed"
            @click="emit('done')"
          >
            没有补充了，开始分析
          </button>
        </div>
      </div>
    </div>
  </div>
</template>