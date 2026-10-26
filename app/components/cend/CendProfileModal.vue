<script setup lang="ts">
import { emptyCendProfileForm, type CendProfileForm } from '~/utils/cend-profile'

interface CendMeProfile extends CendProfileForm {
  completedAt: string | null
}

interface CendMe {
  user: { id: string, nickname: string, phone: string }
  profile: CendMeProfile | null
}

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: [reward: number]
}>()

const toast = useToast()
const { refresh } = useAuth()
const { refresh: refreshCendBalance } = useCendBalance()
const form = reactive<CendProfileForm>(emptyCendProfileForm())
const loading = ref(false)
const saving = ref(false)
const errorMessage = ref('')

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const data = await $fetch<CendMe>('/api/v1/cend/me')
    const profile = data.profile
    Object.assign(form, {
      nickname: profile?.nickname || data.user.nickname,
      subjects: profile?.subjects ?? [],
      grades: profile?.grades ?? [],
      textbookVersion: profile?.textbookVersion ?? '',
      region: profile?.region ?? '',
      teachingYears: profile?.teachingYears ?? '',
      roles: profile?.roles ?? []
    })
  } catch (error: any) {
    errorMessage.value = error?.data?.message || error?.message || '资料加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function close() {
  if (saving.value) return
  emit('update:open', false)
}

async function save() {
  if (!form.nickname.trim()) {
    errorMessage.value = '请填写昵称'
    return
  }
  saving.value = true
  errorMessage.value = ''
  try {
    const result = await $fetch<{ reward: number }>('/api/v1/cend/profile', {
      method: 'PATCH',
      body: {
        nickname: form.nickname.trim(),
        subjects: form.subjects,
        grades: form.grades,
        textbookVersion: form.textbookVersion.trim() || null,
        region: form.region || null,
        teachingYears: form.teachingYears || null,
        roles: form.roles
      }
    })
    await Promise.all([refresh(), refreshCendBalance()])
    toast.add({
      title: result.reward > 0 ? `资料已保存，获得 ${result.reward} 积分` : '资料已保存',
      color: 'success'
    })
    emit('saved', result.reward)
    emit('update:open', false)
  } catch (error: any) {
    errorMessage.value = error?.data?.message || error?.message || '保存失败，请稍后重试'
  } finally {
    saving.value = false
  }
}

watch(() => props.open, (open) => {
  if (open) void load()
}, { immediate: true })
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-950/40 px-4 py-6 sm:items-center"
      role="presentation"
      @click.self="close"
    >
      <div
        class="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cend-profile-modal-title"
      >
        <header class="relative border-b border-slate-100 px-6 py-5">
          <button
            type="button"
            class="absolute right-4 top-4 grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="关闭"
            :disabled="saving"
            @click="close"
          >
            <UIcon name="i-lucide-x" class="size-5" />
          </button>
          <h2 id="cend-profile-modal-title" class="pr-10 text-xl font-semibold text-slate-800">完善个人资料，获得 200 积分奖励</h2>
          <p class="mt-1 text-sm text-slate-500">提交即得 200 积分，部分选项可跳过，后续可在个人设置修改。</p>
        </header>

        <div class="max-h-[65vh] overflow-y-auto px-6 py-5">
          <div class="mb-4 flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span aria-hidden="true">🎁</span>
            <span>提交即得 <strong>+200 积分</strong> · 一次性任务，后续修改不再重复发放</span>
          </div>
          <div v-if="errorMessage" class="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {{ errorMessage }}
          </div>
          <div v-if="loading" class="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
            <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
            正在加载资料…
          </div>
          <CendProfileFields v-else :form="form" :show-phone="false" />
        </div>

        <footer class="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          <UButton color="neutral" variant="ghost" :disabled="saving" @click="close">跳过</UButton>
          <UButton :loading="saving" :disabled="loading" @click="save">保存提交</UButton>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
