<script setup>
/**
 * 交互式问题卡（复刻 ZCode 的 AskUserQuestion 提示框）：
 * - 服务端以 data-question 自定义 chunk 推送问题数据，本组件负责渲染与交互
 * - 支持多题分页（‹ n / N ›）、编号选项 + 推荐标记 + 描述、自定义回答输入
 * - 键盘操作：Tab 进入卡片，上下键移动光标，回车 / 空格选中，输入框内回车提交自定义回答
 * - 三态：pending 可交互 / submitted 只读并高亮所选项 / ignored 置灰
 */
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowLeft, ArrowRight, InfoFilled } from '@element-plus/icons-vue'

const props = defineProps({
  // part.data.questions：[{ id, tag, question, options: [{ key, label, description, recommended }], allowCustom }]
  questions: { type: Array, required: true },
  // 父组件维护的卡片状态：{ status: 'pending' | 'submitted' | 'ignored', answers: [{ questionId, answer }] }
  state: { type: Object, default: () => ({ status: 'pending' }) },
  // 仅「最新一条未决问题」为 true；更早的问题卡强制只读
  interactive: { type: Boolean, default: false },
})
const emit = defineEmits(['submit', 'ignore'])

const rootRef = ref(null)
const customInputRef = ref(null)
const currentIndex = ref(0)
// 键盘光标行：0 ~ options.length-1 为选项行，options.length 为自定义输入行
const cursor = ref(0)
// 每题的选择：questionId -> { kind: 'option', key, label } | { kind: 'custom', text }
const selections = ref({})
// 自定义输入框草稿：questionId -> string
const customDrafts = ref({})

const status = computed(() => props.state?.status || 'pending')
const isPending = computed(() => status.value === 'pending')
const canOperate = computed(() => isPending.value && props.interactive)
const current = computed(() => props.questions[currentIndex.value])
const rowCount = computed(() => current.value.options.length + 1)
const allAnswered = computed(() => props.questions.every((q) => selections.value[q.id]))

// 卡片变为可交互时自动聚焦，让键盘操作即刻可用（流式期间输入框本就禁用发送，不会抢输入）
watch(
  canOperate,
  (active) => {
    if (active) nextTick(() => rootRef.value?.focus())
  },
  { immediate: true },
)

watch(currentIndex, () => {
  cursor.value = 0
  const id = current.value.id
  if (!(id in customDrafts.value)) customDrafts.value[id] = ''
})

function isSelectedOption(questionId, key) {
  const sel = selections.value[questionId]
  return sel?.kind === 'option' && sel.key === key
}

function isSelectedCustom(questionId) {
  return selections.value[questionId]?.kind === 'custom'
}

function selectOption(index) {
  if (!canOperate.value) return
  const option = current.value.options[index]
  selections.value[current.value.id] = { kind: 'option', key: option.key, label: option.label }
  cursor.value = index
}

function selectCustom(text) {
  if (!canOperate.value) return
  selections.value[current.value.id] = { kind: 'custom', text }
  cursor.value = current.value.options.length
}

function goPage(step) {
  const next = currentIndex.value + step
  if (next < 0 || next >= props.questions.length) return
  currentIndex.value = next
}

function onKeydown(e) {
  if (!canOperate.value) return
  // 输入框内只处理回车提交自定义回答，其余按键（含空格打字）交还输入框
  if (e.target.tagName === 'INPUT') {
    if (e.key === 'Enter') {
      const draft = (customDrafts.value[current.value.id] || '').trim()
      if (draft) {
        selectCustom(draft)
        e.preventDefault()
      }
    }
    return
  }
  if (e.key === 'ArrowDown') {
    cursor.value = (cursor.value + 1) % rowCount.value
    e.preventDefault()
  } else if (e.key === 'ArrowUp') {
    cursor.value = (cursor.value - 1 + rowCount.value) % rowCount.value
    e.preventDefault()
  } else if (e.key === 'Enter' || e.key === ' ') {
    if (cursor.value < current.value.options.length) {
      selectOption(cursor.value)
    } else {
      nextTick(() => customInputRef.value?.focus())
    }
    e.preventDefault()
  }
}

function handleSubmit() {
  if (!canOperate.value || !allAnswered.value) return
  const answers = props.questions.map((q) => {
    const sel = selections.value[q.id]
    return {
      questionId: q.id,
      tag: q.tag,
      question: q.question,
      answer: sel.kind === 'option' ? sel.label : sel.text,
    }
  })
  emit('submit', answers)
}

// 只读态（submitted / ignored）下每题的答案文本
function answerOf(question) {
  const hit = (props.state?.answers || []).find((a) => a.questionId === question.id)
  return hit?.answer || ''
}
</script>

<template>
  <!-- 已结束态：所有问题紧凑堆叠展示，不再分页 -->
  <div v-if="!isPending" class="qcard qcard--done">
    <div v-for="q in questions" :key="q.id" class="qcard__done-item">
      <span class="qcard__tag">{{ q.tag }}</span>
      <span class="qcard__done-q">{{ q.question }}</span>
      <span v-if="status === 'submitted'" class="qcard__done-a">→ {{ answerOf(q) }}</span>
      <span v-else class="qcard__done-a qcard__done-a--ignored">已忽略</span>
    </div>
  </div>

  <!-- 待回答态：完整交互卡片 -->
  <div
    v-else
    ref="rootRef"
    class="qcard"
    :class="{ 'qcard--inactive': !canOperate }"
    tabindex="-1"
    @keydown="onKeydown"
  >
    <div class="qcard__head">
      <span class="qcard__tag">{{ current.tag }}</span>
      <p class="qcard__question">{{ current.question }}</p>
      <div v-if="questions.length > 1" class="qcard__pager">
        <button
          type="button"
          class="qcard__pager-btn"
          :disabled="currentIndex === 0 || !canOperate"
          aria-label="上一题"
          @click="goPage(-1)"
        >
          <el-icon><ArrowLeft /></el-icon>
        </button>
        <span class="qcard__pager-text">{{ currentIndex + 1 }} / {{ questions.length }}</span>
        <button
          type="button"
          class="qcard__pager-btn"
          :disabled="currentIndex === questions.length - 1 || !canOperate"
          aria-label="下一题"
          @click="goPage(1)"
        >
          <el-icon><ArrowRight /></el-icon>
        </button>
      </div>
    </div>

    <ol class="qcard__options">
      <li v-for="(opt, i) in current.options" :key="opt.key">
        <button
          type="button"
          class="qcard__option"
          :class="{
            'is-selected': isSelectedOption(current.id, opt.key),
            'is-cursor': canOperate && cursor === i,
          }"
          :disabled="!canOperate"
          @click="selectOption(i)"
        >
          <span class="qcard__option-index">{{ i + 1 }}.</span>
          <span class="qcard__option-text">
            <strong>{{ opt.label }}</strong>
            <em v-if="opt.recommended" class="qcard__rec">（推荐）</em>
            <span class="qcard__option-desc">{{ opt.description }}</span>
          </span>
        </button>
      </li>
      <li>
        <div
          class="qcard__option qcard__option--custom"
          :class="{
            'is-selected': isSelectedCustom(current.id),
            'is-cursor': canOperate && cursor === current.options.length,
          }"
        >
          <span class="qcard__option-index">{{ current.options.length + 1 }}.</span>
          <input
            ref="customInputRef"
            v-model="customDrafts[current.id]"
            class="qcard__custom-input"
            type="text"
            placeholder="输入你的回答..."
            :disabled="!canOperate"
            @focus="cursor = current.options.length"
          />
        </div>
      </li>
    </ol>

    <div class="qcard__foot">
      <template v-if="canOperate">
        <span class="qcard__hint">
          <el-icon><InfoFilled /></el-icon>
          使用 Tab / 上下键选择，回车或空格选中
        </span>
        <div class="qcard__foot-btns">
          <el-button size="small" @click="emit('ignore')">忽略</el-button>
          <el-button size="small" type="primary" :disabled="!allAnswered" @click="handleSubmit">
            提交
          </el-button>
        </div>
      </template>
      <span v-else class="qcard__hint">该提问已被更新的问题取代，请回答最新的问题</span>
    </div>
  </div>
</template>

<style scoped>
.qcard {
  margin: 8px 0;
  padding: 14px 16px;
  background: #fafbfc;
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: var(--radius, 10px);
  outline: none;
}

.qcard--inactive {
  opacity: 0.75;
}

.qcard__head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.qcard__tag {
  flex: none;
  margin-top: 1px;
  padding: 2px 8px;
  font-size: 12px;
  color: var(--color-text, #1f2937);
  background: var(--color-bg, #eef1f5);
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 6px;
  white-space: nowrap;
}

.qcard__question {
  flex: 1;
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-text, #1f2937);
}

.qcard__pager {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
  color: var(--color-text-muted, #9ca3af);
}

.qcard__pager-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.qcard__pager-btn:hover:not(:disabled) {
  background: var(--color-bg, #eef1f5);
  color: var(--color-text, #1f2937);
}

.qcard__pager-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.qcard__pager-text {
  font-size: 12px;
  min-width: 32px;
  text-align: center;
}

.qcard__options {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.qcard__option {
  display: flex;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s;
}

.qcard__option:hover:not(:disabled) {
  background: var(--color-bg, #eef1f5);
}

.qcard__option.is-cursor {
  box-shadow: 0 0 0 2px rgba(47, 136, 246, 0.35);
}

.qcard__option.is-selected {
  border-color: var(--color-primary, #2f88f6);
  background: var(--color-primary-light, #e8f3ff);
}

.qcard__option:disabled {
  cursor: not-allowed;
}

.qcard__option-index {
  flex: none;
  font-size: 14px;
  color: var(--color-text-muted, #9ca3af);
  line-height: 1.6;
}

.qcard__option-text {
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-text, #1f2937);
}

.qcard__rec {
  font-style: normal;
  font-weight: 600;
}

.qcard__option-desc {
  color: var(--color-text-muted, #9ca3af);
}

.qcard__option--custom {
  cursor: text;
}

.qcard__custom-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-text, #1f2937);
}

.qcard__custom-input::placeholder {
  color: var(--color-text-muted, #9ca3af);
}

.qcard__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
}

.qcard__hint {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--color-text-muted, #9ca3af);
}

.qcard__foot-btns {
  display: flex;
  gap: 8px;
}

/* 已结束态 */
.qcard--done {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.qcard__done-item {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  font-size: 13px;
  line-height: 1.6;
}

.qcard__done-q {
  color: var(--color-text, #1f2937);
}

.qcard__done-a {
  color: var(--color-primary, #2f88f6);
}

.qcard__done-a--ignored {
  color: var(--color-text-muted, #9ca3af);
}
</style>
