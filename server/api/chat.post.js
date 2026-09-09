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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 构造演示模式的 UIMessage 流（chunk 结构与 AI SDK 服务端产物一致：
 * start → start-step → text-start → text-delta... → text-end → finish-step → finish）。
 * 每次 pull 推送一个 chunk，借助流的背压机制自然形成逐字节奏。
 */
function createDemoStream() {
  const textId = 'demo-text-1'
  let step = 0
  let closed = false
  return new ReadableStream({
    async pull(controller) {
      if (closed) return
      if (step === 0) {
        step = 1
        controller.enqueue({ type: 'start' })
        return
      }
      if (step === 1) {
        step = 2
        controller.enqueue({ type: 'start-step' })
        return
      }
      if (step === 2) {
        step = 3
        controller.enqueue({ type: 'text-start', id: textId })
        return
      }
      const index = step - 3
      if (index < DEMO_CHUNKS.length) {
        step += 1
        await sleep(60)
        controller.enqueue({ type: 'text-delta', id: textId, delta: DEMO_CHUNKS[index] })
        return
      }
      if (index === DEMO_CHUNKS.length) {
        step += 1
        controller.enqueue({ type: 'text-end', id: textId })
        return
      }
      if (index === DEMO_CHUNKS.length + 1) {
        step += 1
        controller.enqueue({ type: 'finish-step' })
        return
      }
      closed = true
      controller.enqueue({ type: 'finish', finishReason: 'stop' })
      controller.close()
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
function createDemoResponse() {
  const encoder = new TextEncoder()
  const sseStream = new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
    },
  })
  return new Response(createDemoStream().pipeThrough(sseStream), {
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
    return createDemoResponse()
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
