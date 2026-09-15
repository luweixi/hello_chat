# AI 流式对话（Nuxt 4 + Element Plus + AI SDK）

一个能一键跑起来的**最小全栈对话模板**：用户在输入框发消息，后端调用大模型，响应以 SSE 流式返回，前端逐字渲染成 Markdown 气泡。无登录、无数据库、无多会话管理。

## 技术栈

| 层                | 技术                                        | 版本（实测）                                |
| ----------------- | ------------------------------------------- | ------------------------------------------- |
| 工程              | **Nuxt 4**（前后端一体，Nitro 服务端路由）  | nuxt 4.5.2 / vite 8.2.2 / vue 3.5.42        |
| 渲染模式          | 客户端渲染（`ssr: false`）                  | 与原 SPA 行为一致                            |
| UI                | Element Plus（全量注册，中文界面）          | 2.14.5                                      |
| 气泡与滚动        | vue-element-plus-x                          | 2.0.3                                       |
| Markdown 流式渲染 | x-markdown-vue                              | 0.0.203 / shiki 3.23.0 / shiki-stream 0.1.4 |
| 前端数据流        | @ai-sdk/vue（useChat）                      | 4.0.93                                      |
| 后端（流式接口）  | ai + @ai-sdk/openai（Nitro 路由）           | 7.0.93 / 4.0.60                             |
| 运行环境          | Node ≥ 22.12（Nuxt 4 要求，`.nvmrc` 已约束） | —                                           |

> **关于代码高亮**：x-markdown-vue 的代码块语法高亮是**流式增量高亮**，由可选依赖 `shiki` 与 `shiki-stream` 提供（二者缺失时静默降级为无高亮纯文本，不满足验收标准），因此本项目已显式安装这两个包。

前后端一体：`/api/chat` 由 Nuxt 的 **Nitro 服务端路由**（`server/api/chat.post.js`）提供，开发与生产同源，无需代理与跨域配置，也**不再需要独立的 Express 后端**。

## 启动步骤

1. 检查 Node 版本 ≥ 22.12：

   ```bash
   node -v
   ```

2. 安装依赖：

   ```bash
   npm i
   ```

3. 配置 API Key（**只进服务端，严禁写进任何前端代码**）：

   ```bash
   cp .env.example .env   # Windows 下可手动复制文件后重命名为 .env
   ```

   编辑 `.env`，填入 `OPENAI_API_KEY=sk-xxx`。

   > 不填也可以：服务端会自动切成内置**演示模式**，无需 Key 即可体验完整流式对话（见下文）。

4. 启动（单命令，前后端一体）：

   ```bash
   npm run dev
   ```

5. 打开 <http://localhost:8000>，即可开始对话。

## 版本说明（重要：与需求文档假设的差异，均以实际安装版本为准）

编写前已按需求文档要求先核实 `node_modules` 实际版本与类型声明，发现以下 API 与需求文档中的假设不一致，**本模板以实际 API 为准**：

| 需求文档假设                                      | 实际（实测版本）                                                                                    | 处理                                                                                                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v6+ 用 `new Chat({ api })` 类                     | `Chat` 类在 @ai-sdk/vue@4.0.93 已标记 `@deprecated`，`useChat` composable 是官方推荐 API            | 用 `useChat()`（来自 `@ai-sdk/vue`）；无参调用即使用默认 transport，POST `/api/chat`                                                                             |
| 服务端必须用 `result.toUIMessageStreamResponse()` | 该方法在 ai@7.0.93 已标记 deprecated（下个大版本删除），官方推荐 `toUIMessageStream` + 响应构造函数 | 用 `toUIMessageStream({ stream: result.stream })` + `createUIMessageStreamResponse`（返回 web Response，Nitro 原生支持流式响应），产出同一套 UI Message SSE 协议 |
| `convertToModelMessages(messages)` 同步调用       | 在 ai@7 中是**异步函数**                                                                             | 已 `await`                                                                                                                                                      |
| 后端用 Express 双轨             | 改造成 Nuxt 后由单个 Nitro 路由承担（`server/api/chat.post.js`），删除 Express 与 Vercel Function | 开发、生产同一套代码                                                                                                                              |
| `<XSender v-model="input">`                       | XSender v2 无 `modelValue` prop                                                                      | `ref.getModelValue()` 取值（返回 `{ text, html, ... }`）、`ref.clear()` 清空；`@submit` / `@cancel` 均无参数                                                    |
| BubbleList 每项含 `role` 字段                     | `role` 非官方类型字段（官方类型为 `key/content/placement/...`）                                     | 映射时自行扩展 `placement`（user→`end` 靠右、assistant→`start` 靠左），效果与右/左对齐一致                                                                      |
| 引入 `vue-element-plus-x` 的样式文件              | v2.0.3 为 ESM 分包，组件样式随 import 自动引入，无独立 `style/index.css` 入口                       | 无需手写样式引入                                                                                                                                                |
| —                                                 | BubbleList 内置滚动（`autoScroll`）                                                                  | 未自写滚动逻辑                                                                                                                                                  |

## 核心链路

```
浏览器 (Nuxt 客户端)                    同源 POST            Nuxt/Nitro 服务端                  OpenAI
┌──────────────────────┐   fetch + SSE ────────────────────▶ ┌───────────────────────┐   ┌──────────┐
│ useChat()            │      (无代理、无跨域)                 │ server/api/chat.post.js│──▶│ openai() │
│ (默认 transport)      │                                     │ convertToModelMessages │   │ streamText│
│ messages 响应式更新   │ ◀──────────── SSE ─────────────────│ toUIMessageStream      │◀──└──────────┘
└──────────────────────┘   (data: {...}\n\n)                  │ createUIMessageStream- │
       │                                                     │ Response (web Response)│
       │                                                     └───────────────────────┘
       │  computed 映射 UIMessage.parts[] → { key, placement, content }
       ▼
 BubbleList(:list + #content 插槽) + MarkdownRenderer(enable-animate)
       │
       ▼
消息逐字流式渲染成 Markdown 气泡（代码块 Shiki 高亮）
```

1. 浏览器端 `useChat()` 用默认 transport 向同源 `/api/chat` 发送 UIMessage 数组
2. Nitro 路由用 `convertToModelMessages` 转成 `ModelMessage[]`，交给 `streamText`
3. `toUIMessageStream` 把文本流封装为 UI Message SSE 流，`createUIMessageStreamResponse` 直接返回流式 web Response
4. 前端 `messages` 响应式更新，`computed` 扁平化 parts 文本，驱动 `BubbleList` + `MarkdownRenderer` 增量渲染

「停止」链路：点击停止 → `stop()` 中止前端请求 → Nitro 侧 `req.signal` 触发 → `streamText` 的 `abortSignal` 中止 OpenAI 上游请求；已生成内容保留在 `messages` 中。

**演示模式**：未配置 `OPENAI_API_KEY` 时，Nitro 路由用手工构造的 UIMessage chunk 流（`ReadableStream` + 背压逐字推送）返回同协议 SSE，前端逐字渲染出内置演示回复——零配置、零模型成本，体验与真实模型一致。

## ZCode 对话能力复刻

在基础流式对话之上，复刻了 ZCode 客户端的几项对话交互能力：

| 能力 | 说明 | 实现位置 |
| ---- | ---- | -------- |
| **交互式问题卡** | agent 需要决策时弹出问题卡：tag 胶囊 + 问题文本 + 多题分页（‹ n / N ›）+ 编号选项（含推荐标记与描述）+ 自定义回答输入；支持 Tab / 上下键移动光标、回车 / 空格选中；「忽略 / 提交」两种结束方式，结束后转只读摘要 | `QuestionCard.vue` + 服务端 `data-question` chunk |
| **会话侧栏横条** | 视口左侧固定一列短横线，每条用户提问一根；当前视口内的提问高亮（加深加长）；hover 浮出摘要卡（提问 + 回复摘录）；点击跳转到对应提问 | `ConversationRail.vue` |
| **工作计时器** | 消息区底部「已工作 X 分 X 秒」，流式期间走秒（带呼吸圆点），结束后冻结保留到下一轮 | `ChatPanel.vue` |
| **建议卡片** | 空状态提供 3 个一键发送的提问芯片，第一条即触发问题卡演示 | `ChatPanel.vue` |
| **消息操作条** | 助手气泡 hover 浮现「复制」「重新生成」（仅最后一条） | `ChatPanel.vue` |

**问题卡的协议约定**：服务端在 UI Message SSE 流中插入自定义 chunk `{ type: 'data-question', id, data: { questions: [...] } }`（AI SDK 流协议原生支持 `data-*` 类型），前端 `useChat` 将其落到 `message.parts` 的 `{ type: 'data-question', id, data }` 上，`#content` 插槽按 parts 顺序混排文本与问题卡。提交答案后前端以 `【问题回答】…` 前缀把答案作为普通用户消息发回，演示流据此续答。

**演示触发词**（仅演示模式）：消息中含「部署 / deploy」→ 弹出镜像策略 + 构建缓存两题问题卡；空状态建议卡片第一条等价于该触发词。真实模型模式不弹问题卡，行为与原先一致。

## 三个常见坑

- **`convertToModelMessages` 别漏，且要 `await`**：`UIMessage[]`（parts 结构）必须转换后才能进 `streamText`，否则类型/协议不匹配；ai@7 中该函数已改为异步。
- **必须产出 UI Message 专用 SSE 流**：用 `toUIMessageStream` + `createUIMessageStreamResponse` 封装，不能用 `toTextStreamResponse` 之类的普通文本流，否则 `@ai-sdk/vue` 无法解析。
- **API Key 严禁进客户端**：只允许出现在 `server/` 与 `.env` 中；`.env` 已加入 `.gitignore`，任何前端代码中不得出现 `OPENAI_API_KEY`。

## 技术选型决策说明

| 候选方案                | 取舍                                     | 最终采用                       |
| ----------------------- | ---------------------------------------- | ------------------------------ |
| Nuxt vs Vite+Express    | 需求文档首选 Nuxt，本版本落地 Nuxt       | **Nuxt 4（前后端一体）**       |
| 客户端渲染 vs SSR       | 聊天面板依赖 shiki 等浏览器库，SSR 收益低 | **客户端渲染（ssr: false）**   |
| TypeScript vs 纯 JS     | 内部工程惯例为纯 JS                      | **纯 JS**                      |
| pnpm vs npm             | 内部工程惯例为 npm                       | **npm**                        |
| Node 版本               | Nuxt 4 / AI SDK 7 均要求 Node 22.12+     | **22.12+**                     |
| 登录 / 鉴权 / SSO       | 需求文档明确不要登录                     | **不引入**                     |
| 路由 / Pinia / Mock     | 单页面模板用不到                         | **裁剪**                       |

工程配置（editorconfig / prettier 无分号单引号 / eslint flat config / `@` 别名 / 8000 端口 / VSCode 共享配置）、代码风格（中文注释、中文文案、BEM、显式 import、`handleXxx` 命名）保持团队统一惯例。

## 生产构建与运行

本地构建并预览生产产物（Nitro 默认使用 `node-server` preset）：

```bash
npm run build        # 输出 .output/（客户端静态资源 + Nitro 服务端）
npm run preview      # 或直接 node .output/server/index.mjs
```

生产环境运行同样无需配置 `OPENAI_API_KEY`（演示模式），配置后走真实模型：

| Key 方式 | 说明 |
| -------- | ---- |
| **不配置** | 自动切到内置**演示模式**，返回内置的逐字流式 Markdown 回复（零成本零配置） |
| **配置**   | 走真实大模型（`gpt-4o-mini`） |

注意点：

- `package.json` 的 `engines.node >= 22.12` 约束 Nuxt 4 要求的 Node 运行时
- 本地开发只需 `npm run dev` 单命令（Nuxt 4 前后端一体，不再需要 Express 与 Vite 代理）
- 排查依赖时注意：`ai` 包的 `zod` 是 peerDependency，已显式加入 `dependencies`，安装时**不要**使用 `--legacy-peer-deps`（会跳过 peer 安装导致运行时 `Cannot find package 'zod'`）