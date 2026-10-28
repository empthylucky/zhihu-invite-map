#!/usr/bin/env node
/**
 * 接口路径探测器
 *
 * 猜 body 格式是最没效率的做法。先用 GET 把路径打一遍，看状态码就能分类：
 *
 *   200  路径存在，GET 可读           —— 拿到数据了，直接分析结构
 *   405  路径存在，但不接受 GET       —— **最有价值的信号**，说明真正的写入端点是它，换 POST 再试
 *   404  路径不存在                   —— 别再试了，名字错了
 *   403  存在但签名/权限不够          —— 检查 x-zse-96、cookie、referer
 *   400 MalformRequestException      —— 路由层就拒了，跟 body 无关，换路径而不是换格式
 *
 * 用法:
 *   node probe.mjs 2098203045251265565 invitees invitations auto_invite settings
 *   node probe.mjs --host api.zhihu.com 2098... invitees
 *
 * 靠 405 定位到 /questions/{id}/invitations 存在、而 /questions/{id}/settings 不存在，
 * 省掉了十几轮瞎猜。
 */

import { ZhihuInvite } from './invite.mjs'

const LABEL = {
  200: '✅ 存在且可读',
  401: '🔒 未登录',
  403: '🔒 权限/签名',
  404: '  不存在',
  405: '👉 存在！换 POST',
  400: '⚠️  路由层拒绝',
}

const z = ZhihuInvite.fromEnv()

const argv = process.argv.slice(2)
let host = 'https://www.zhihu.com'
const hIdx = argv.indexOf('--host')
if (hIdx !== -1) {
  host = argv[hIdx + 1].startsWith('http') ? argv[hIdx + 1] : `https://${argv[hIdx + 1]}`
  argv.splice(hIdx, 2)
}

const [questionId, ...segments] = argv
if (!questionId) {
  console.error('用法: node probe.mjs <question_id> <路径片段...>')
  process.exit(1)
}

const paths = segments.length
  ? segments.map((s) => `/api/v4/questions/${questionId}/${s}`)
  : [
      'invitees',
      'invitations',
      'invitations/batch',
      'auto_invite',
      'recommendation_invitees',
      'recommend_invitees',
      'invitation-candidates',
      'invitees/search?q=a&offset=0',
    ]

for (const p of paths) {
  const url = host + p
  try {
    const headers = z._headers(url, null)
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(25000) })
    const t = await r.text()
    let name = ''
    try {
      name = JSON.parse(t)?.error?.name ?? ''
    } catch {
      /* HTML 错误页 */
    }
    const tag = name ? `400 ${name}` : (LABEL[r.status] ?? String(r.status))
    console.log(`${String(r.status).padEnd(4)} ${tag.padEnd(22)} ${p.padEnd(42)} ${t.slice(0, 90).replace(/\s+/g, ' ')}`)
  } catch (e) {
    console.log(`ERR  ${e.message.slice(0, 20).padEnd(22)} ${p}`)
  }
  await new Promise((r) => setTimeout(r, 2500)) // 别打太快
}
