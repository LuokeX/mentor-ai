<script setup lang="ts">
import {
  CEND_GRADE_OPTIONS,
  CEND_REGION_OPTIONS,
  CEND_ROLE_OPTIONS,
  CEND_SUBJECT_OPTIONS,
  CEND_TEACHING_YEAR_OPTIONS,
  CEND_TEXTBOOK_OTHER,
  CEND_TEXTBOOK_VERSION_OPTIONS,
  CEND_TEXTBOOK_VERSION_VALUES,
  type CendProfileForm
} from '~/utils/cend-profile'

const props = defineProps<{
  form: CendProfileForm
  phone?: string
  showPhone?: boolean
}>()

/**
 * 教材版本：下拉里选预设版本；选「其他」后由补充输入框写全称。
 * 选择「其他」时 form.textbookVersion 可能暂时为空，因此选择状态必须独立保存，
 * 不能从 form.textbookVersion 反推（否则选「其他」会立即回退成未选择）。
 * 历史数据里可能存着任意文本，未命中选择项时按「其他」回显，避免静默丢值。
 */
const textbookChoice = ref('')
const textbookCustom = ref('')

function syncTextbookFromForm() {
  const value = props.form.textbookVersion
  if (!value) {
    // 已经选了「其他」但还没输入全称：保留选择状态，不要回退成空。
    if (textbookChoice.value === CEND_TEXTBOOK_OTHER) return
    textbookChoice.value = ''
    textbookCustom.value = ''
    return
  }
  if (CEND_TEXTBOOK_VERSION_VALUES.includes(value)) {
    textbookChoice.value = value
    textbookCustom.value = ''
    return
  }
  textbookChoice.value = CEND_TEXTBOOK_OTHER
  textbookCustom.value = value
}

watch(() => props.form.textbookVersion, syncTextbookFromForm, { immediate: true })

function selectTextbook(value: string) {
  textbookChoice.value = value
  if (value === CEND_TEXTBOOK_OTHER) {
    props.form.textbookVersion = textbookCustom.value
    return
  }
  textbookCustom.value = ''
  props.form.textbookVersion = value
}

function updateTextbookCustom(value: string) {
  textbookCustom.value = value
  props.form.textbookVersion = value
}

const isOtherTextbook = computed(() => textbookChoice.value === CEND_TEXTBOOK_OTHER)
</script>

<template>
  <div class="grid gap-4 sm:grid-cols-2">
    <UFormField label="昵称">
      <UInput v-model="form.nickname" maxlength="120" class="w-full" />
    </UFormField>
    <UFormField v-if="showPhone !== false" label="绑定手机号">
      <UInput :model-value="phone || ''" disabled class="w-full" />
    </UFormField>
    <UFormField label="学科（可多选）" class="sm:col-span-2">
      <USelectMenu v-model="form.subjects" :items="CEND_SUBJECT_OPTIONS" multiple value-key="value" class="w-full" :ui="{ content: 'z-[130]' }" />
    </UFormField>
    <UFormField label="年级（可多选）" class="sm:col-span-2">
      <USelectMenu v-model="form.grades" :items="CEND_GRADE_OPTIONS" multiple value-key="value" class="w-full" :ui="{ content: 'z-[130]' }" />
    </UFormField>
    <UFormField label="教材版本">
      <USelect
        :model-value="textbookChoice"
        :items="CEND_TEXTBOOK_VERSION_OPTIONS"
        placeholder="请选择"
        class="w-full"
        :ui="{ content: 'z-[130]' }"
        @update:model-value="selectTextbook"
      />
      <UInput
        v-if="isOtherTextbook"
        :model-value="textbookCustom"
        maxlength="160"
        placeholder="请填写教材版本全称"
        class="mt-2 w-full"
        @update:model-value="updateTextbookCustom"
      />
    </UFormField>
    <UFormField label="学校所在地区">
      <USelect v-model="form.region" :items="CEND_REGION_OPTIONS" placeholder="请选择" class="w-full" :ui="{ content: 'z-[130]' }" />
    </UFormField>
    <UFormField label="教龄">
      <USelect v-model="form.teachingYears" :items="CEND_TEACHING_YEAR_OPTIONS" placeholder="请选择" class="w-full" :ui="{ content: 'z-[130]' }" />
    </UFormField>
    <UFormField label="除上课外还承担哪些角色" class="sm:col-span-2">
      <USelectMenu v-model="form.roles" :items="CEND_ROLE_OPTIONS" multiple value-key="value" class="w-full" :ui="{ content: 'z-[130]' }" />
    </UFormField>
  </div>
</template>
