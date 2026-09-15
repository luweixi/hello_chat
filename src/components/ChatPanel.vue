<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
// 需求文档约定：@ai-sdk/vue 只负责数据（发请求、接 SSE、维护 messages/status/error）
// 注意：Chat 类在当前版本已废弃（@deprecated），useChat 是官方推荐 API（见 README 版本说明）
import { useChat } from '@ai-sdk/vue'
// 仅用这两个组件做气泡与输入框，样式体系与 Element Plus 一致
import { BubbleList, XSender } from 'vue-element-plus-x'
// Markdown 流式渲染组件（渲染交给它，不关心数据来源）
import { MarkdownRenderer } from 'x-markdown-vue'
import { ElMessage } from 'element-plus'
import { CopyDocument, RefreshRight, Timer } from '@element-plus/icons-vue'
import QuestionCard from './QuestionCard.vue'
import ConversationRail from './ConversationRail.vue'

// 无参调用：默认 transport 直连 POST /api/chat（Nuxt 前后端一体，由 Nitro 服务端路由处理，见 server/api/chat.post.js）
// regenerate 用于「重新生成」最后一条助手回复
const { messages, status, error, sendMessage, regenerate, stop, clearError } = useChat()

// XSender v2 不支持 v-model，必须通过 ref.getModelValue() 取值、ref.clear() 清空（见 README 版本说明）
const senderRef = ref(null)
// 消息列表外层包裹：scroll 事件在捕获阶段监听内部滚动容器，用于侧栏横条的 active 判定
const listWrapRef = ref(null)

const isStreaming = computed(() => status.value === 'submitted' || status.value === 'streaming')

// 与后端约定的问题回答前缀保持一致（server/api/chat.post.js 的 ANSWER_PREFIX）
const ANSWER_PREFIX = '【问题回答】'

/**
 * UIMessage[] → BubbleList list 的映射（核心链路第 5 步）
 * - useChat 的 message 是 parts 数组结构（文本在 type === 'text' 的 part.text 上），
 *   BubbleList 需要扁平的 content 字符串，因此先按 type 过滤再拼接
 * - parts 原样透传给 #content 插槽：文本 part 走 MarkdownRenderer，
 *   data-question part 走 QuestionCard（问题卡），不再丢弃非文本 part
 * - BubbleList 的 item 没有官方 role 字段，这里自行扩展 placement 表达左右位置：
 *   用户消息靠右（end）、助手消息靠左（start），符合需求文档「用户右对齐、助手左对齐」
 */
const bubbles = computed(() =>
  messages.value.map((message) => ({
    key: message.id,
    role: message.role,
    placement: message.role === 'user' ? 'end' : 'start',
    content: message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(''),
    parts: message.parts,
  })),
)

const lastAssistantKey = computed(() => {
  for (let i = messages.value.length - 1; i >= 0; i -= 1) {
    if (messages.value[i].role === 'assistant') return messages.value[i].id
  }
  return ''
})

/* ---------------- 问题卡状态 ---------------- */

// questionPartId -> { status: 'pending' | 'submitted' | 'ignored', answers }
const questionStates = ref({})

function questionStateFor(partId) {
  return questionStates.value[partId] || { status: 'pending' }
}

// 全会话最后一个 data-question part 的 id；仅当它仍未决时对应卡片可交互
const interactiveQuestionId = computed(() => {
  for (let i = messages.value.length - 1; i >= 0; i -= 1) {
    const parts = messages.value[i].parts || []
    for (let j = parts.length - 1; j >= 0; j -= 1) {
      if (parts[j].type === 'data-question') {
        return questionStateFor(parts[j].id).status === 'pending' ? parts[j].id : ''
      }
    }
  }
  return ''
})

// 提交答案：记录卡片状态，并把答案作为普通用户消息发回（后端演示流据此续答）
function handleQuestionSubmit(partId, answers) {
  questionStates.value[partId] = { status: 'submitted', answers }
  const text = `${ANSWER_PREFIX}${answers.map((a) => `${a.tag || a.question}：${a.answer}`).join('；')}`
  sendMessage({ text })
}

function handleQuestionIgnore(partId) {
  questionStates.value[partId] = { status: 'ignored' }
}

/* ---------------- 会话侧栏横条 ---------------- */

const railItems = computed(() => {
  const items = []
  for (let i = 0; i < messages.value.length; i += 1) {
    const message = messages.value[i]
    if (message.role !== 'user') continue
    const question = message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
    const reply = messages.value[i + 1]
    const answerExcerpt =
      reply && reply.role === 'assistant'
        ? reply.parts
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80)
        : ''
    items.push({
      key: message.id,
      question: question.slice(0, 60) || '（空消息）',
      answerExcerpt,
    })
  }
  return items
})

const activeKey = ref('')

// 以「最后一条越过列表上 1/3 线的提问锚点」为当前提问
function updateActiveKey() {
  const wrap = listWrapRef.value
  if (!wrap) return
  const rect = wrap.getBoundingClientRect()
  const threshold = rect.top + rect.height / 3
  let active = ''
  wrap.querySelectorAll('[data-msg-id]').forEach((el) => {
    if (el.getBoundingClientRect().top <= threshold) active = el.getAttribute('data-msg-id')
  })
  if (active) activeKey.value = active
}

function jumpToMessage(key) {
  const el = listWrapRef.value?.querySelector(`[data-msg-id="${key}"]`)
  if (!el) return
  activeKey.value = key
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

watch(
  () => messages.value.length,
  () => nextTick(updateActiveKey),
)

/* ---------------- 工作计时器 ---------------- */

const roundStart = ref(null)
const elapsed = ref(0)
let timerId = null

watch(isStreaming, (streaming) => {
  if (streaming) {
    roundStart.value = Date.now()
    elapsed.value = 0
    timerId = setInterval(() => {
      elapsed.value = Math.floor((Date.now() - roundStart.value) / 1000)
    }, 1000)
  } else if (timerId) {
    clearInterval(timerId)
    timerId = null
    if (roundStart.value) elapsed.value = Math.floor((Date.now() - roundStart.value) / 1000)
  }
})

onBeforeUnmount(() => {
  if (timerId) clearInterval(timerId)
})

const workedText = computed(() =>
  elapsed.value < 60
    ? `${elapsed.value} 秒`
    : `${Math.floor(elapsed.value / 60)} 分 ${elapsed.value % 60} 秒`,
)

/* ---------------- 空状态建议卡片 ---------------- */

const SUGGESTIONS = [
  '演示：部署到 Vercel 前要注意什么？',
  '写一段 Nuxt 4 快速上手说明',
  '给我一个代码高亮示例',
]

function sendSuggestion(text) {
  if (isStreaming.value) return
  sendMessage({ text })
}

/* ---------------- 消息操作条 ---------------- */

async function copyContent(content) {
  try {
    await navigator.clipboard.writeText(content)
    ElMessage.success('已复制到剪贴板')
  } catch {
    ElMessage.error('复制失败，请手动选择文本')
  }
}

function handleRegenerate() {
  if (isStreaming.value) return
  regenerate()
}

/* ---------------- 发送 / 停止 ---------------- */

function handleSubmit() {
  // 流式进行中禁止重复发送
  if (isStreaming.value) return
  const { text } = senderRef.value?.getModelValue() || {}
  const trimmed = (text || '').trim()
  if (!trimmed) return
  sendMessage({ text: trimmed })
  senderRef.value?.clear() // 发送成功后清空输入框
}

function handleCancel() {
  // 立刻中断生成，已生成内容保留在 messages 中（stop 只中止请求，不清理历史）
  stop()
}
</script>

<template>
  <div class="chat-panel">
    <!-- 左侧会话横条：fixed 定位脱离卡片，hover 摘要、点击跳转 -->
    <ConversationRail :items="railItems" :active-key="activeKey" @jump="jumpToMessage" />

    <!-- 错误提示：useChat 的 error 非空时展示（关闭时同步清空 error 状态） -->
    <el-alert
      v-if="error"
      class="chat-panel__alert"
      type="error"
      title="出错了"
      :description="error.message"
      show-icon
      closable
      @close="clearError"
    />

    <!-- 空状态：欢迎语 + 建议卡片（第一条即可体验问题卡） -->
    <div v-if="!bubbles.length" class="chat-panel__empty">
      <el-icon class="chat-panel__empty-icon" :size="44" color="var(--color-primary, #2f88f6)">
        <ChatLineRound />
      </el-icon>
      <h2 class="chat-panel__empty-title">你好，我是 AI 助手</h2>
      <p class="chat-panel__empty-desc">在下方输入消息，开始对话吧（支持 Markdown 与代码高亮）</p>
      <div class="chat-panel__suggestions">
        <button
          v-for="suggestion in SUGGESTIONS"
          :key="suggestion"
          type="button"
          class="chat-panel__suggestion"
          @click="sendSuggestion(suggestion)"
        >
          {{ suggestion }}
        </button>
      </div>
    </div>

    <!-- 气泡列表：内置智能滚动（autoScroll，流式更新时自动跟随、上滑后不打扰），无需自写滚动逻辑 -->
    <div v-else ref="listWrapRef" class="chat-panel__list" @scroll.capture="updateActiveKey">
      <BubbleList :list="bubbles" auto-scroll max-height="100%">
        <!-- #content 插槽按 parts 顺序渲染：文本走 MarkdownRenderer，data-question 走问题卡 -->
        <template #content="{ item }">
          <!-- 用户提问锚点：侧栏横条跳转与 active 判定依赖它 -->
          <div v-if="item.role === 'user'" class="msg-anchor" :data-msg-id="item.key"></div>
          <div class="msg-body">
            <template v-for="(part, index) in item.parts" :key="index">
              <MarkdownRenderer
                v-if="part.type === 'text' && part.text"
                :markdown="part.text"
                enable-animate
              />
              <QuestionCard
                v-else-if="part.type === 'data-question' && part.data?.questions"
                :questions="part.data.questions"
                :state="questionStateFor(part.id)"
                :interactive="part.id === interactiveQuestionId"
                @submit="(answers) => handleQuestionSubmit(part.id, answers)"
                @ignore="handleQuestionIgnore(part.id)"
              />
            </template>
            <!-- 助手消息操作条：hover 气泡时浮现 -->
            <div v-if="item.role === 'assistant' && item.content" class="msg-actions">
              <button
                type="button"
                class="msg-actions__btn"
                title="复制"
                @click="copyContent(item.content)"
              >
                <el-icon><CopyDocument /></el-icon>
              </button>
              <button
                v-if="item.key === lastAssistantKey"
                type="button"
                class="msg-actions__btn"
                title="重新生成"
                @click="handleRegenerate"
              >
                <el-icon><RefreshRight /></el-icon>
              </button>
            </div>
          </div>
        </template>
      </BubbleList>
    </div>

    <!-- 工作计时器：流式期间走秒，结束后冻结保留到下一轮 -->
    <div v-if="roundStart" class="chat-panel__timer">
      <span v-if="isStreaming" class="chat-panel__timer-dot"></span>
      <el-icon :size="14"><Timer /></el-icon>
      <span>已工作 {{ workedText }}</span>
    </div>

    <!-- 输入框：loading 期间显示「停止」按钮并触发 @cancel -->
    <XSender
      ref="senderRef"
      class="chat-panel__sender"
      :loading="isStreaming"
      placeholder="输入消息，Enter 发送，Shift+Enter 换行"
      submit-type="enter"
      @submit="handleSubmit"
      @cancel="handleCancel"
    />
  </div>
</template>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  max-width: 900px;
  height: 100%;
  min-height: 0;
  background: #fff;
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: var(--radius, 10px);
  box-shadow: var(--shadow, 0 2px 12px rgba(15, 23, 42, 0.06));
  box-sizing: border-box;
}

.chat-panel__alert {
  flex: none;
  margin: 12px 16px 0;
}

.chat-panel__empty {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
}

.chat-panel__empty-icon {
  padding: 12px;
  border-radius: 50%;
  background: var(--color-primary-light, #e8f3ff);
}

.chat-panel__empty-title {
  margin: 0;
  font-size: 18px;
  color: var(--color-text, #1f2937);
}

.chat-panel__empty-desc {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-muted, #9ca3af);
}

.chat-panel__suggestions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 8px;
}

.chat-panel__suggestion {
  padding: 8px 14px;
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 999px;
  background: #fff;
  font-size: 13px;
  color: #4b5563;
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s;
}

.chat-panel__suggestion:hover {
  color: var(--color-primary, #2f88f6);
  border-color: var(--color-primary, #2f88f6);
}

/* 列表区：flex 列 + min-height: 0 保证内部滚动，XSender 固定在底部 */
.chat-panel__list {
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
}

/* BubbleList 根节点撑满包裹层，滚动仍由其内部容器负责 */
.chat-panel__list > :deep(*) {
  height: 100%;
  min-height: 0;
}

/* 提问锚点：零高度，仅用于跳转定位与 active 判定 */
.msg-anchor {
  height: 0;
  scroll-margin-top: 12px;
}

.msg-actions {
  display: flex;
  gap: 4px;
  margin-top: 4px;
  opacity: 0;
  transition: opacity 0.15s;
}

.msg-body:hover .msg-actions {
  opacity: 1;
}

.msg-actions__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-muted, #9ca3af);
  cursor: pointer;
}

.msg-actions__btn:hover {
  background: var(--color-bg, #eef1f5);
  color: var(--color-primary, #2f88f6);
}

/* 工作计时器行 */
.chat-panel__timer {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  font-size: 12px;
  color: var(--color-text-muted, #9ca3af);
}

.chat-panel__timer-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-primary, #2f88f6);
  animation: timer-pulse 1s ease-in-out infinite;
}

@keyframes timer-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.chat-panel__sender {
  flex: none;
  border-top: 1px solid var(--color-border, #e5e7eb);
}

/* XSender 内部输入框区域留白（组件内部结构，用 :deep 穿透） */
.chat-panel__sender :deep(.x-sender) {
  padding: 8px 16px 12px;
}
</style>
