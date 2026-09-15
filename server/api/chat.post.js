// Nitro 服务端路由：POST /api/chat（对应前端 useChat 默认请求的 /api/chat 路径）
// 由 Nuxt 前后端一体提供，开发与生产同源，无需代理。
// 两种模式自动切换：
//   1. 未配置 OPENAI_API_KEY（演示模式）→ 只依赖 Node 原生 API 手工构造 SSE，
//      返回内置流式演示回复（零配置、零模型成本）。
//   2. 配置了 OPENAI_API_KEY → 调用真实大模型（gpt-4o-mini）。
// 说明：Nitro 由 rollup 构建期整体打包，ai / @ai-sdk/openai 可直接静态导入。

import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
} from 'ai'
import { openai } from '@ai-sdk/openai'

// 模型 id 抽成常量，需要更换模型时只改这里
const MODEL = 'gpt-4o-mini'
const SYSTEM_PROMPT = '你是一个简洁、专业的助手。'

// 演示模式回复（按 1~3 字分块，逐块推送模拟逐字流式效果）
const DEMO_CHUNKS = [
  '你好！',
  '我是',
  ' AI ',
  '助手，',
  '当前',
  '运行在',
  '演示',
  '模式',
  '（未配置',
  ' OPENAI',
  '_API_',
  'KEY）。',
  '\n\n',
  '这是一段',
  '**流式',
  '渲染**',
  '演示',
  '回复：\n\n',
  '- 文本',
  '逐字',
  '出现\n',
  '- Markdown',
  '正常',
  '渲染\n',
  '- 代码块',
  '语法',
  '高亮\n\n',
  '```js\n',
  "console.log('hello nuxt!')",
  '\n```\n\n',
  '### ',
  '接入真实',
  '模型\n\n',
  '将 OPENAI',
  '_API_KEY',
  ' 配置为',
  '环境变量',
  '即可。',
]

// 演示用问题卡数据（复刻 ZCode 的 AskUserQuestion 交互）：
// 以 UI Message Stream 的 data-question 自定义 chunk 推送，
// 前端 useChat 会把它落到 message.parts 的 { type: 'data-question', id, data } 上。
const DEMO_QUESTIONS = [
  {
    id: 'mirror-strategy',
    tag: '镜像策略',
    question:
      '推送代码前，是否要把 package-lock.json 里的依赖下载地址从国内镜像 npmmirror 换成官方 npmjs.org？',
    options: [
      {
        key: 'keep',
        label: '先按原样推送',
        recommended: true,
        description:
          '不改动 lockfile，直接推送触发部署。npmmirror 海外一般可用只是可能较慢；若安装阶段失败，我再一键替换 registry 推第二版。改动最小。',
      },
      {
        key: 'swap',
        label: '推送前先换 registry',
        description:
          '把 lockfile 中 929 个依赖地址全部替换为 registry.npmjs.org 再推送，海外构建更稳更快。代价是之后你在国内本地 npm install 会走官方源、速度变慢。',
      },
    ],
    allowCustom: true,
  },
  {
    id: 'build-cache',
    tag: '构建缓存',
    question: '是否同时开启 Vercel 的构建缓存以加速后续部署？',
    options: [
      {
        key: 'on',
        label: '开启',
        recommended: true,
        description: '复用上次安装的 node_modules 与构建产物，后续部署通常快 30 秒以上。',
      },
      {
        key: 'off',
        label: '关闭',
        description: '每次部署全量重装重建，最慢但结果最可复现，适合排查缓存污染问题。',
      },
    ],
    allowCustom: true,
  },
]

// 问题回答的前缀约定：前端提交问题卡后，以该前缀把答案作为普通用户消息发回
const ANSWER_PREFIX = '【问题回答】'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 把整段文本按 1~3 字切块，模拟逐字流式
const splitText = (text) => text.match(/[\s\S]{1,3}/g) || []

/**
 * 演示流由「事件序列」驱动：每个事件 = 一个 UIMessage chunk + 可选的推送前延时。
 * chunk 结构与 AI SDK 服务端产物一致：
 * start → start-step → text-start → text-delta... → text-end → finish-step → finish，
 * 其中可插入 data-question 自定义 chunk（问题卡）。
 */
function textEvents(id, chunks) {
  const events = [{ chunk: { type: 'text-start', id } }]
  for (const delta of chunks) {
    events.push({ chunk: { type: 'text-delta', id, delta }, delay: 60 })
  }
  events.push({ chunk: { type: 'text-end', id } })
  return events
}

const headEvents = () => [{ chunk: { type: 'start' } }, { chunk: { type: 'start-step' } }]
const tailEvents = () => [
  { chunk: { type: 'finish-step' } },
  { chunk: { type: 'finish', finishReason: 'stop' } },
]

// 取最后一条用户消息的纯文本（UIMessage 的文本在 parts 的 type === 'text' 上）
function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') {
      return (messages[i].parts || [])
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')
    }
  }
  return ''
}

/**
 * 演示模式状态机：按最后一条用户消息决定本轮回复形态。
 * - 以【问题回答】开头 → 针对问题卡答案的续答
 * - 含「部署 / deploy」 → 先输出引子文本，再推 data-question 问题卡后收尾
 * - 其余 → 原始 DEMO_CHUNKS 演示回复
 */
function buildDemoEvents(messages) {
  const text = lastUserText(messages)
  const textId = 'demo-text-1'

  if (text.startsWith(ANSWER_PREFIX)) {
    const answer = text.slice(ANSWER_PREFIX.length).trim()
    return [
      ...headEvents(),
      ...textEvents(
        textId,
        splitText(
          `收到你的选择：${answer}。\n\n` +
            '已按该方案继续执行：\n\n' +
            '- 校验配置并推送代码\n' +
            '- 触发部署并等待构建完成\n' +
            '- 构建成功后回报访问地址\n\n' +
            '（演示模式：以上为模拟续答，配置 OPENAI_API_KEY 后由真实模型接管。）',
        ),
      ),
      ...tailEvents(),
    ]
  }

  if (/部署|deploy/i.test(text)) {
    const userCount = messages.filter((message) => message.role === 'user').length
    return [
      ...headEvents(),
      ...textEvents(
        textId,
        splitText(
          '其余配置（`engines.node`、`.nvmrc`、无 postinstall）都没有问题。\n\n' +
            '在给出最终方案前，有一个选择需要你定：',
        ),
      ),
      // 自定义 data chunk：前端 DefaultChatTransport 按 type 识别为 data part
      {
        chunk: {
          type: 'data-question',
          id: `dq-${userCount}`,
          data: { questions: DEMO_QUESTIONS },
        },
      },
      ...tailEvents(),
    ]
  }

  return [...headEvents(), ...textEvents(textId, DEMO_CHUNKS), ...tailEvents()]
}

/**
 * 按事件序列构造演示模式的 UIMessage 流。
 * 每次 pull 推送一个 chunk，借助流的背压机制自然形成逐字节奏。
 */
function createDemoStream(events) {
  let index = 0
  return new ReadableStream({
    async pull(controller) {
      if (index >= events.length) {
        controller.close()
        return
      }
      const event = events[index]
      index += 1
      if (event.delay) await sleep(event.delay)
      controller.enqueue(event.chunk)
    },
  })
}

// 与 AI SDK 的 UI Message SSE 响应头保持一致。注意：x-vercel-ai-ui-message-stream 是
// AI SDK 的流协议标识（名字带 vercel 前缀，但与 Vercel 部署无关），前端
// DefaultChatTransport 必须靠它识别流协议，缺失会导致 useChat 无法解析——不可删除。
const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache',
  connection: 'keep-alive',
  'x-vercel-ai-ui-message-stream': 'v1',
  'x-accel-buffering': 'no',
}

/**
 * 手工把 UIMessage chunk 流编码为 SSE 格式的 web Response（data: {...}\n\n），
 * 等效于 createUIMessageStreamResponse，但不引入 ai 包运行时加载。
 */
function createDemoResponse(messages) {
  const encoder = new TextEncoder()
  const sseStream = new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
    },
  })
  return new Response(createDemoStream(buildDemoEvents(messages)).pipeThrough(sseStream), {
    status: 200,
    headers: SSE_HEADERS,
  })
}

// 真实模型路径：streamText 产出 UI Message 专属 SSE 流
async function streamRealModel(messages, signal) {
  const result = streamText({
    model: openai(MODEL),
    system: SYSTEM_PROMPT,
    // UIMessage[] 必须经 convertToModelMessages 转成 ModelMessage[] 才能进 streamText（异步，需 await）
    messages: await convertToModelMessages(messages),
    // 前端点「停止」时 fetch 断开触发 signal，OpenAI 上游请求随即中止，避免继续消耗 token
    abortSignal: signal,
    onError: (error) => {
      // 用户主动停止导致的中止属正常流程，静默处理；其余错误记录日志
      if (error.name === 'AbortError') return
      console.error('[chat] 流式生成失败:', error.message)
    },
  })

  // createUIMessageStreamResponse 返回 web Response（Nitro 原生支持流式响应），
  // 是 ai@7 中已弃用的 result.toUIMessageStreamResponse() 的替代方式
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  })
}

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, message: '仅支持 POST 请求' })
  }

  const body = await readBody(event).catch(() => null)
  const messages = body?.messages
  if (!Array.isArray(messages)) {
    throw createError({ statusCode: 400, message: '参数错误：messages 必须是数组' })
  }

  // 演示模式：未配置 Key 时直接走内置演示流（零配置、零模型成本）
  if (!process.env.OPENAI_API_KEY) {
    return createDemoResponse(messages)
  }

  try {
    // 前端点「停止」时 fetch 断开 → signal 触发 abort → 中止 OpenAI 上游请求（Node 20.4+ 的 IncomingMessage 自带 signal）
    const signal = event.node?.req?.signal
    return await streamRealModel(messages, signal)
  } catch (error) {
    console.error('[chat] 处理请求失败:', error)
    throw createError({
      statusCode: 500,
      message: error?.message || '大模型调用失败，请检查 OPENAI_API_KEY 配置',
    })
  }
})
