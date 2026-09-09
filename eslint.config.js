import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'
import globals from 'globals'

export default [
  { name: 'app/files-to-lint', files: ['**/*.{js,mjs,jsx,vue}'] },
  {
    name: 'app/files-to-ignore',
    ignores: ['**/dist/**', '**/dist-ssr/**', '**/coverage/**', '**/.nuxt/**', '**/.output/**'],
  },
  // 服务端（Nitro 路由）运行在 Node 环境，与前端浏览器环境分开声明全局变量；
  // defineEventHandler / createError / readBody 等由 Nitro 自动导入，在浏览器环境变量之外补充声明
  {
    name: 'app/node-server',
    files: ['server/**/*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    name: 'app/nitro-auto-imports',
    files: ['server/**/*.js', 'nuxt.config.js'],
    languageOptions: {
      globals: {
        defineEventHandler: 'readonly',
        createError: 'readonly',
        readBody: 'readonly',
      },
    },
  },
  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  // Nuxt / Nitro 自动导入的全局函数：defineNuxtConfig、defineNuxtPlugin 等
  {
    name: 'app/nuxt-auto-imports',
    files: ['**/*.{js,mjs,vue}', 'nuxt.config.js'],
    languageOptions: {
      globals: {
        defineNuxtConfig: 'readonly',
        defineNuxtPlugin: 'readonly',
      },
    },
  },
  skipFormatting,
]
