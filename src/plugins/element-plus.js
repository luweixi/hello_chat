import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

// 原 src/main.js 的入口逻辑迁移为 Nuxt 插件（全量注册 Element Plus + 中文界面 + 图标）
// 全局 CSS 已移入 nuxt.config 的 css 数组，这里只保留组件注册
export default defineNuxtPlugin((nuxtApp) => {
  const app = nuxtApp.vueApp

  app.use(ElementPlus, { locale: zhCn })

  // 图标全量注册
  for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(name, component)
  }
})
