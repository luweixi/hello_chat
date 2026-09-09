<script setup>
import { computed, ref } from 'vue'
// 需求文档约定：@ai-sdk/vue 只负责数据（发请求、接 SSE、维护 messages/status/error）
// 注意：Chat 类在当前版本已废弃（@deprecated），useChat 是官方推荐 API（见 README 版本说明）
import { useChat } from '@ai-sdk/vue'
// 仅用这两个组件做气泡与输入框，样式体系与 Element Plus 一致
import { BubbleList, XSender } from 'vue-element-plus-x'
// Markdown 流式渲染组件（渲染交给它，不关心数据来源）
import { MarkdownRenderer } from 'x-markdown-vue'

// 无参调用：默认 transport 直连 POST /api/chat（Nuxt 前后端一体，由 Nitro 服务端路由处理，见 server/api/chat.post.js）
const { messages, status, error, sendMessage, stop, clearError } = useChat()

// XSender v2 不支持 v-model，必须通过 ref.getModelValue() 取值、ref.clear() 清空（见 README 版本说明）
const senderRef = ref(null)
const bubbleListRef = ref(null)

const isStreaming = computed(() => status.value === 'submitted' || status.value === 'streaming')

/**
 * UIMessage[] → BubbleList list 的映射（核心链路第 5 步）
 * - useChat 的 message 是 parts 数组结构（文本在 type === 'text' 的 part.text 上），
 *   BubbleList 需要扁平的 content 字符串，因此先按 type 过滤再拼接
 * - BubbleList 的 item 没有官方 role 字段，这里自行扩展 placement 表达左右位置：
 *   用户消息靠右（end）、助手消息靠左（start），符合需求文档「用户右对齐、助手左对齐」
 */
const bubbles = computed(() =>
  messages.value.map((message) => ({
    key: message.id,
    placement: message.role === 'user' ? 'end' : 'start',
    content: message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(''),
  })),
)

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

    <!-- 空状态：欢迎语 -->
    <div v-if="!bubbles.length" class="chat-panel__empty">
      <el-icon class="chat-panel__empty-icon" :size="44" color="var(--color-primary, #2f88f6)">
        <ChatLineRound />
      </el-icon>
      <h2 class="chat-panel__empty-title">你好，我是 AI 助手</h2>
      <p class="chat-panel__empty-desc">在下方输入消息，开始对话吧（支持 Markdown 与代码高亮）</p>
    </div>

    <!-- 气泡列表：内置智能滚动（autoScroll，流式更新时自动跟随、上滑后不打扰），无需自写滚动逻辑 -->
    <BubbleList
      v-else
      ref="bubbleListRef"
      class="chat-panel__list"
      :list="bubbles"
      auto-scroll
      max-height="100%"
    >
      <!-- #content 插槽接 MarkdownRenderer：BubbleList 不直接渲染字符串，渲染职责分离 -->
      <template #content="{ item }">
        <MarkdownRenderer :markdown="item.content" enable-animate />
      </template>
    </BubbleList>

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

/* 列表区：flex 列 + min-height: 0 保证内部滚动，XSender 固定在底部 */
.chat-panel__list {
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
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
