# 知乎「邀请回答」接口地图

实测记录：作者本人的账号（web cookie + `x-zse-96` v2 签名）在 2026-10 对知乎邀请回答相关接口做了一次完整测绘。

**结论：读接口全部可用，写接口也完全可用。**

上一版这份文档写的是「写接口全部关闭」。**那是错的。** 我错了三天，错因值得写在最前面。

---

## 零、我错在哪

我试了三天、三十多种组合，全都返回同一个：

```json
{"error": {"message": "请求错误", "code": 400, "name": "MalformRequestException"}}
```

于是我下了个结论：写路由只对安卓客户端或 OAuth 开放，web 会话进不去。

**真因是一个字段名。**

```diff
- {"people_ids": ["8e00e59b3b7bd216942a59ccdd03d24e"]}                    → 400
+ {"member_hash": "8e00e59b3b7bd216942a59ccdd03d24e", "src": "normal"}    → 200 {"success": true}
```

`people_ids` 这个字段名来自安卓端反编译的 smali 注解。**安卓用 `people_ids`，web 用 `member_hash`。** 两个客户端，两套字段。

`MalformRequestException` 不是「你没权限」，是「我不认识你这个字段」。它长得像权限错误，所以很容易被误判成权限问题——我就误判了。

### 怎么才查出来的

不再猜。开一个真浏览器，让页面自己去发那条请求，把请求录下来。

沙箱里开浏览器的两个坑：

- node `spawn` → `EPERM`（管道被禁）
- 直接 `Start-Process msedge` → `FATAL: mojo platform_channel.cc Check failed: 拒绝访问 (0x5)`（命名管道被禁）

两个都要放开文件沙箱才能过。过了之后走 CDP：

```bash
msedge --headless=new --remote-debugging-port=9333 --user-data-dir=<某个工作目录>
```

然后在 node 里连 `http://127.0.0.1:9333/json/list` 拿 `webSocketDebuggerUrl`，用全局 `WebSocket` 走 CDP。

**录请求要用 CDP 的 `Network.requestWillBeSent`，不要用 JS 钩子。** 钩子只能看到 `fetch`/`XMLHttpRequest`，SPA 内部分层会把它绕过去。

还有：知乎的 HTML 页面有一层 `zh-zse-ck` 挑战，直接抓页面会 403。真浏览器跑完那段混淆脚本后会种一个 `__zse_ck` cookie。但**写接口并不强制要求它**——实测去掉也能通。

---

## 一、邀请回答（写）—— 可用

```http
POST https://www.zhihu.com/api/v4/questions/{question_id}/invitees
content-type: application/json
x-zse-93: 101_3_3.0
x-zse-96: 2.0_<签名>
x-requested-with: fetch
x-xsrf-token: <_xsrf>

{"member_hash": "<member.id 那串 32 位 hex>", "src": "normal"}
```

返回 `{"success": true}`。

- `member_hash` 就是 `recommendation_invitees` 返回里 `member.id` 那个值
- `src` 实测填 `normal` 可用
- **`x-zst-81` 不是必须的**（浏览器会带，服务端不强制）
- 额度：`left_invitation` 每次减一，可以为负
- 取消邀请：`DELETE /api/v4/questions/{qid}/invitees/{member_hash}`

---

## 二、改问题 / 绑话题（写）—— 能用，但话题格式未知

真实接口不是 `/api/v4/questions/{id}`，是：

```http
POST https://www.zhihu.com/api/v4/content/publish
content-type: application/json
```

```json
{
  "action": "question",
  "data": {
    "publish": { "traceId": "<uuid>" },
    "title": { "title": "<当前标题>" },
    "reason": { "reason": "补充话题" },
    "extra_info": { "include": "topics", "publisher": "pc" },
    "draft": { "contentId": "<question_id>", "isPublished": true },
    "topic": { "topics": [] }
  }
}
```

返回 `{"code": 0, "message": "success"}`。

两点注意：

1. **网页端的「修改理由」是弹窗里选一个选项**（标点或格式错误 / 不构成提问 / 包含主观判断 / 缺乏可信来源 / 其他），选「其他」之后才出现一个自由文字输入框，占位符是「请输入修改理由（必填）」。那段文字就是 `reason.reason`。接口层不校验取值。
2. **`topic.topics` 的格式我还没解开。** 传 `{id, name}`、`{id: "字符串", name}`、搜索接口返回的完整话题对象、只传 `name`，全都返回 `code: 0` 但话题列表仍然是空的。传纯 id 字符串数组返回 `code: 2`（校验失败）。解开了欢迎告诉我。

---

## 三、读接口（全部可用）

| 方法 | 路径 | 参数 | 实测 |
|---|---|---|---|
| `GET` | `/api/v4/questions/{qid}/recommendation_invitees` | `offset` `limit` | ✅ 200 |
| `GET` | `/api/v4/questions/{qid}/recommend_invitees` | `offset` `limit` | ✅ 200（早期接口，结构不同） |
| `GET` | `/api/v4/questions/{qid}/invitation-candidates` | — | ✅ 200 |
| `GET` | `/api/v4/questions/{qid}/invitees/search` | `q` `offset` `limit` | ✅ 200 |
| `GET` | `/api/v4/questions/{qid}/invitees` | — | ✅ 200（已邀请名单） |
| `GET` | `/api/v4/questions/{qid}/auto_invite` | — | ✅ 200 |
| `POST` | `/api/v4/questions/{qid}/auto_invite` | — | ✅ 200 |

`recommendation_invitees` 和 `recommend_invitees` 是两个不同的接口，别搞混。带 `ation` 的那个才是现在用的：

```json
{
  "one_button_invite": true,
  "is_forbid_invite": false,
  "left_invitation": 15,
  "paging": { "is_end": false, "totals": 39 },
  "data": [ ... 35 条 ... ]
}
```

`one_button_invite` / `left_invitation` / `paging` 在**顶层**，名单在 `data` 里，是个数组。

---

## 四、`405` 是个好东西

找接口别猜 body 格式。**先用 GET 打路径，看状态码分类**：

| 状态码 | 含义 |
|---|---|
| `200` | 路径存在且可读 |
| `405` | **路径存在，但不接受 GET** → 真正的写入端点就是它 |
| `404` | 路径不存在，名字错了 |
| `403` | 存在，但签名/权限不够 |
| `400 Malform` | 路由层就拒了，跟 body 无关 |

靠这个十分钟就能区分：

```
405  /questions/{qid}/invitations          ← 存在
404  /questions/{qid}/topics               ← 不存在
404  /questions/{qid}/settings             ← 不存在
```

`probe.mjs` 就是干这个的。

**但 405 只告诉你「路在哪」，不告诉你「怎么走」。** 字段名还是得看真实请求。

---

## 五、错误码怎么读

- **错误换了种类，才算往前走了一步。** 改问题那次，从「问题必须要有标题」变成「请填写问题修改理由」，说明 payload 形状对了，只差一个字段。
- **错误没变，就是没动。** 三十几个 400 长得一模一样，说明我一直在原地。
- **500 不是进展。** 往邀请接口发裸 JSON 数组会得到 `500 Internal Server Error`——那是服务端拿到类型不对直接崩，不是我走对了。

---

## 六、用

```bash
# cookie：每行一个值，第 1 行 z_c0，第 2 行 d_c0
# d_c0 缺了签不出 x-zse-96
export ZHIHU_COOKIE_FILE=./cookie.txt

node invite.mjs recommend  2099244404653478245      # 推荐邀请名单 + 剩余额度
node invite.mjs candidates 2099244404653478245      # 候选人（带话题产出）
node invite.mjs search     2099244404653478245 王    # 按名字搜
node invite.mjs invited    2099244404653478245      # 已邀请过谁
node invite.mjs auto       2099244404653478245      # 委托刘看山的状态

# 这个现在真的能用
node invite.mjs invite     2099244404653478245 <member_hash>
```

```bash
node probe.mjs 2099244404653478245 invitees invitations auto_invite settings
```

零依赖，只要 Node 18+（用了内置 `fetch`）。

---

## 七、来源

- `hytcyjb/yjboAntiCompilation` — 知乎 3.3.1 反编译，`smali/com/zhihu/android/api/b/s.smali` 是 `InviteeService` 的接口声明原文（**注意：那里面的 `people_ids` 是安卓的字段，web 不是**）
- `DracoUnion/BookerDownloadTool` — `doc/zhihu_api.md`
- `RickZhao/ZhiHu-Pro` — `Zhihu.Common/Net/QuestionApi.cs`
- `oovm/ZhihuLink` — `invitation-candidates`
- `zse-signer.mjs` — `x-zse-96` v2 签名，移植自 zhihu-plus-plus

---

## 八、一句话

我花三天想打开一扇门，最后发现门没锁，是钥匙拿反了。

而且我一度把「钥匙拿反」写成了一份很有说服力的结论——「这扇门只对安卓和 OAuth 开放」。文档写得整齐，推理看着也顺，它就是错的。

**先看真实的请求，再下结论。**
