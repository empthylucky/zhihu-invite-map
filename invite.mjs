#!/usr/bin/env node
/**
 * 知乎「邀请回答」接口地图
 *
 * 读接口全部实测可用（web cookie + x-zse-96 v2 签名）。
 * 写接口也全部可用 —— 关键是字段名：web 用 member_hash，不是安卓的 people_ids。
 * 详见 README 第零节。
 *
 * 用法：
 *   ZHIHU_COOKIE_FILE=auth/zhihu-cookie.json node invite.mjs recommend <question_id>
 *   node invite.mjs candidates <question_id>
 *   node invite.mjs search <question_id> 关键词
 *   node invite.mjs invited <question_id>
 *   node invite.mjs auto <question_id>
 *   node invite.mjs invite <question_id> <member_hash>[,<member_hash>...]
 *
 * cookie 文件格式：每行一个值。第 1 行 z_c0，第 2 行 d_c0（必填，缺了签名过不了）。
 * 也可以用环境变量 ZHIHU_Z_C0 / ZHIHU_D_C0。
 */

import fs from 'node:fs'
import { signRequest } from './zse-signer.mjs'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const WWW = 'https://www.zhihu.com'
const API = 'https://api.zhihu.com'

export class ZhihuError extends Error {
  constructor(status, payload) {
    const e = payload?.error ?? {}
    super(`${status} ${e.name ?? 'Error'}: ${e.message ?? JSON.stringify(payload).slice(0, 120)}`)
    this.name = 'ZhihuError'
    this.status = status
    this.code = e.code
    this.zhihuName = e.name
    this.payload = payload
  }
}

export class ZhihuInvite {
  /**
   * @param {Record<string,string>} cookies 至少要有 z_c0 和 d_c0
   */
  constructor(cookies) {
    if (!cookies?.z_c0) throw new Error('缺少 z_c0')
    if (!cookies?.d_c0) throw new Error('缺少 d_c0 —— x-zse-96 签不出来')
    this.cookies = cookies
    this.cookieHeader = Object.entries(cookies)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }

  /** 从「每行一个值」的导出文件加载：第 1 行 z_c0，第 2 行 d_c0，之后可选 */
  static fromFile(path) {
    const lines = fs
      .readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    return new ZhihuInvite({ z_c0: lines[0], d_c0: lines[1] })
  }

  /** 从 JSON 加载：{"cookies":{"z_c0":...,"d_c0":...}} 或直接 {"z_c0":...} */
  static fromJsonFile(path) {
    const j = JSON.parse(fs.readFileSync(path, 'utf8'))
    return new ZhihuInvite(j.cookies ?? j)
  }

  static fromEnv() {
    const f = process.env.ZHIHU_COOKIE_FILE
    if (f) return fs.existsSync(f) && f.endsWith('.json') ? ZhihuInvite.fromJsonFile(f) : ZhihuInvite.fromFile(f)
    return new ZhihuInvite({ z_c0: process.env.ZHIHU_Z_C0, d_c0: process.env.ZHIHU_D_C0 })
  }

  _headers(url, bodyStr) {
    const h = {
      'user-agent': UA,
      accept: 'application/json, text/plain, */*',
      referer: `${WWW}/`,
      origin: WWW,
      cookie: this.cookieHeader,
      'x-requested-with': 'fetch',
      'x-zse-93': '101_3_3.0',
      'x-zse-96': signRequest(url, this.cookies.d_c0, bodyStr),
    }
    if (bodyStr != null) h['content-type'] = 'application/json'
    if (this.cookies._xsrf) h['x-xsrf-token'] = this.cookies._xsrf
    return h
  }

  async request(method, path, { body, form, host = WWW, timeout = 25000 } = {}) {
    const url = path.startsWith('http') ? path : host + path
    const bodyStr = form != null ? new URLSearchParams(form).toString() : body != null ? JSON.stringify(body) : null
    const headers = this._headers(url, bodyStr)
    if (form != null) headers['content-type'] = 'application/x-www-form-urlencoded'

    const res = await fetch(url, {
      method,
      headers,
      body: bodyStr ?? undefined,
      signal: AbortSignal.timeout(timeout),
    })
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      /* 可能是 HTML 错误页 */
    }
    if (!res.ok) throw new ZhihuError(res.status, json ?? { error: { message: text.slice(0, 120) } })
    if (json?.error) throw new ZhihuError(res.status, json)
    return json
  }

  // ───────────── 读：全部实测可用 ─────────────

  /**
   * 推荐可邀请的人。实测 200。
   * 注意路径是 recommendation_invitees（带 ation），
   * 不是 recommend_invitees —— 后者也返回 200 但字段结构不同，是另一个早期接口。
   */
  recommend(questionId, { offset = 0, limit = 40 } = {}) {
    return this.request(
      'GET',
      `/api/v4/questions/${questionId}/recommendation_invitees?offset=${offset}&limit=${limit}`,
    )
  }

  /** 邀请候选人（带 topic_contributions，能看出对方在话题下的产出）。实测 200，返回数组。 */
  candidates(questionId) {
    return this.request('GET', `/api/v4/questions/${questionId}/invitation-candidates`)
  }

  /** 按关键词搜可邀请的人。实测 200。 */
  search(questionId, q, { offset = 0, limit = 40 } = {}) {
    return this.request(
      'GET',
      `/api/v4/questions/${questionId}/invitees/search?q=${encodeURIComponent(q)}&offset=${offset}&limit=${limit}`,
    )
  }

  /** 已邀请过的人。实测 200，没邀请过返回 []。 */
  invited(questionId) {
    return this.request('GET', `/api/v4/questions/${questionId}/invitees`)
  }

  /**
   * 「委托刘看山」自动邀请的状态。GET 和 POST 都返回 200（同一份状态，POST 就是开关）。
   * status: open 表示自动邀请正在跑。
   */
  autoInvite(questionId, { enable = false } = {}) {
    const p = `/api/v4/questions/${questionId}/auto_invite`
    return this.request(enable ? 'POST' : 'GET', p)
  }

  // ───────────── 写：可用 ─────────────

  /**
   * 邀请指定的人。实测可用，返回 { success: true }。
   *
   * 字段是 member_hash，不是 people_ids。
   * people_ids 是安卓端反编译 smali 里的字段（@Field("people_ids")），web 用的是 member_hash。
   * 用错字段会返回 400 MalformRequestException —— 那个错长得像权限问题，其实只是「我不认识这个字段」。
   *
   * member_hash 就是 recommendation_invitees 返回里 member.id 那个 32 位 hex。
   */
  invite(questionId, memberHash, src = 'normal') {
    return this.request('POST', `/api/v4/questions/${questionId}/invitees`, {
      body: { member_hash: memberHash, src },
    })
  }

  /** 一次邀请多个。逐个发，中间留间隔。 */
  async inviteMany(questionId, memberHashes, { gapMs = 3000 } = {}) {
    const out = []
    for (const h of memberHashes) {
      try {
        out.push({ member_hash: h, ok: true, res: await this.invite(questionId, h) })
      } catch (e) {
        out.push({ member_hash: h, ok: false, error: e.message })
      }
      if (gapMs) await new Promise((r) => setTimeout(r, gapMs))
    }
    return out
  }

  /** 取消邀请某个人。 */
  uninvite(questionId, memberHash) {
    return this.request('DELETE', `/api/v4/questions/${questionId}/invitees/${memberHash}`)
  }
}

// ───────────── CLI ─────────────

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())

if (isMain) {
  const [cmd, qid, arg] = process.argv.slice(2)
  if (!cmd || !qid) {
    console.error('用法: node invite.mjs <recommend|candidates|search|invited|auto|invite> <question_id> [参数]')
    process.exit(1)
  }
  const z = ZhihuInvite.fromEnv()

  const run = async () => {
    switch (cmd) {
      case 'recommend': {
        const j = await z.recommend(qid)
        // one_button_invite / left_invitation / paging 在顶层；名单在 data，是个数组
        console.log(
          `一键邀请: ${j.one_button_invite}  禁止邀请: ${j.is_forbid_invite}  剩余额度: ${j.left_invitation}  候选总数: ${j.paging?.totals}`,
        )
        const list = Array.isArray(j.data) ? j.data : (j.data?.recommend_invite ?? j.recommend_invite ?? [])
        for (const it of list) {
          const m = it.member ?? it
          console.log(`  ${it.is_invited ? '✓' : ' '} ${m.id}  ${m.name}`)
        }
        break
      }
      case 'candidates': {
        const list = await z.candidates(qid)
        for (const it of list) {
          const m = it.member ?? it
          console.log(`  ${m.id}  ${m.name}`)
        }
        break
      }
      case 'search': {
        const j = await z.search(qid, arg ?? '')
        for (const it of j.data ?? []) {
          const m = it.member ?? it
          console.log(`  ${m.id}  ${m.name}`)
        }
        break
      }
      case 'invited': {
        const list = await z.invited(qid)
        if (!list.length) console.log('  还没邀请过任何人')
        // /invitees 返回的是扁平成员对象，没有 .member 包装
        for (const it of list) {
          const m = it.member ?? it
          console.log(`  ${m.id}  ${m.name}`)
        }
        break
      }
      case 'auto': {
        console.log(JSON.stringify(await z.autoInvite(qid), null, 2))
        break
      }
      case 'invite': {
        const hashes = String(arg ?? '').split(',').map((s) => s.trim()).filter(Boolean)
        if (!hashes.length) {
          console.error('用法: node invite.mjs invite <question_id> <member_hash>[,<member_hash>...]')
          process.exitCode = 1
          break
        }
        for (const r of await z.inviteMany(qid, hashes)) {
          console.log(`${r.ok ? '✅' : '❌'} ${r.member_hash}  ${r.ok ? JSON.stringify(r.res) : r.error}`)
        }
        break
      }
      default:
        console.error(`未知命令: ${cmd}`)
        process.exit(1)
    }
  }
  run().catch((e) => {
    console.error(`❌ ${e.message}`)
    process.exit(1)
  })
}
