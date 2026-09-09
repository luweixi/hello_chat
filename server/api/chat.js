// Nitro 服务端路由：处理 /api/chat 的非 POST 请求（chat.post.js 已注册 POST，
// 这里避免方法不匹配时回退到 SPA 页面，显式返回 405）
export default defineEventHandler(() => {
  throw createError({ statusCode: 405, message: '仅支持 POST 请求' })
})
