<script setup>
// Nuxt 入口组件（app.vue），已替代原 index.html + src/main.js；
// 全局样式由 nuxt.config 的 css 数组引入，Element Plus 注册在 src/plugins/element-plus.js
import ChatPanel from '@/components/ChatPanel.vue'
</script>

<template>
  <div class="app">
    <header class="app__header">
      <el-icon class="app__logo" :size="22" color="var(--color-primary, #2f88f6)">
        <ChatDotRound />
      </el-icon>
      <h1 class="app__title">AI 流式对话</h1>
      <span class="app__subtitle">Nuxt 4 + Element Plus + AI SDK 流式对话模板</span>
    </header>
    <main class="app__main">
      <ChatPanel />
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.app__header {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 48px;
  padding: 0 16px;
  background: #fff;
  border-bottom: 1px solid var(--color-border, #e5e7eb);
}

.app__logo {
  padding: 4px;
  border-radius: 6px;
  background: var(--color-primary-light, #e8f3ff);
}

.app__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text, #1f2937);
}

.app__subtitle {
  font-size: 12px;
  color: var(--color-text-muted, #9ca3af);
}

.app__main {
  flex: 1;
  min-height: 0;
  display: flex;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
}
</style>
