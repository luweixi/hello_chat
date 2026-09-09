import removeConsole from 'vite-plugin-remove-console'

export default defineNuxtConfig({
  // 与真实使用日期对齐，避免 Nuxt 版本特性变更警告
  compatibilityDate: '2026-09-09',

  // 聊天面板依赖 shiki 高亮、Element Plus 等浏览器端库，采用客户端渲染保持原 SPA 行为，
  // 服务端路由（Nitro /api/chat）不受影响，仍提供流式接口
  ssr: false,

  // 沿用原 Vite 工程的 src/ 目录结构（app.vue 在 src/ 下）
  srcDir: 'src',

  devServer: {
    // 保持原开发地址：http://localhost:8000
    port: 8000,
  },

  app: {
    head: {
      title: 'AI 流式对话',
    },
  },

  // 全局样式（原先在 main.js 中手动 import）
  css: ['element-plus/dist/index.css', 'x-markdown-vue/style', '~/assets/styles/base.css'],

  vite: {
    plugins: [
      // 生产构建去除 console，保留 error/warn/info（与改造前行为一致）
      removeConsole({ exclude: ['error', 'warn', 'info'] }),
    ],
  },

  routeRules: {
    // 流式接口函数时长上限（Vercel Hobby 最高 60s，真实模型长回复需要；本地 node-server 下不生效）
    '/api/chat': { maxDuration: 60 },
  },
})
