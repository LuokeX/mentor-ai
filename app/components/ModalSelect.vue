<script setup lang="ts">
import { computed, useAttrs } from 'vue'

defineOptions({ inheritAttrs: false })

type SelectValue = string | number | boolean | null | undefined
type SelectItem = SelectValue | Record<string, unknown>

const props = withDefaults(defineProps<{
  modelValue?: SelectValue
  modelModifiers?: Record<string, boolean>
  items?: SelectItem[] | SelectItem[][]
  valueKey?: string
  labelKey?: string
  placeholder?: string
  disabled?: boolean
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
}>(), {
  valueKey: 'value',
  labelKey: 'label',
  size: 'md'
})

const emit = defineEmits<{
  'update:modelValue': [value: SelectValue]
  change: [event: Event]
  blur: [event: FocusEvent]
  focus: [event: FocusEvent]
}>()

const attrs = useAttrs()

const options = computed(() => {
  const source = props.items || []
  const flat = source.flatMap((item) => Array.isArray(item) ? item : [item])

  return flat
    .filter((item) => !(isObjectItem(item) && ['label', 'separator'].includes(String(item.type))))
    .map((item) => {
      const value = isObjectItem(item) ? item[props.valueKey] as SelectValue : item
      const label = isObjectItem(item) ? item[props.labelKey] ?? value : item

      return {
        value,
        key: stringifyValue(value),
        label: String(label ?? ''),
        disabled: Boolean(isObjectItem(item) && item.disabled)
      }
    })
})

const selectAttrs = computed(() => {
  const { class: _class, ...rest } = attrs
  return rest
})

const selectClass = computed(() => [
  'block rounded-md border border-default bg-default text-highlighted shadow-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-75',
  sizeClass.value,
  attrs.class
])

const sizeClass = computed(() => {
  if (props.size === 'xs') return 'h-7 px-2 text-xs'
  if (props.size === 'sm') return 'h-8 px-2.5 text-sm'
  if (props.size === 'lg') return 'h-11 px-3.5 text-base'
  if (props.size === 'xl') return 'h-12 px-4 text-base'
  return 'h-9 px-3 text-sm'
})

const selectedKey = computed({
  get: () => stringifyValue(props.modelValue),
  set: (key: string) => {
    const option = options.value.find((item) => item.key === key)
    let value = option ? option.value : key

    if (props.modelModifiers?.trim && typeof value === 'string') value = value.trim()
    if (props.modelModifiers?.number && value !== '' && value != null) value = Number(value)
    if (props.modelModifiers?.nullable && value === '') value = null
    if (props.modelModifiers?.optional && value === '') value = undefined

    emit('update:modelValue', value)
  }
})

function isObjectItem(item: SelectItem): item is Record<string, unknown> {
  return typeof item === 'object' && item !== null
}

function stringifyValue(value: SelectValue) {
  return value == null ? '' : String(value)
}

function onChange(event: Event) {
  selectedKey.value = (event.target as HTMLSelectElement).value
  emit('change', event)
}
</script>

<template>
  <select
    v-bind="selectAttrs"
    :value="selectedKey"
    :disabled="disabled"
    :class="selectClass"
    @change="onChange"
    @blur="emit('blur', $event)"
    @focus="emit('focus', $event)"
  >
    <option v-if="placeholder && selectedKey === ''" value="" disabled>
      {{ placeholder }}
    </option>
    <option v-for="item in options" :key="item.key" :value="item.key" :disabled="item.disabled">
      {{ item.label }}
    </option>
  </select>
</template>
