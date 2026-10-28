# 知乎「邀请回答」接口地图

实测记录：作者本人的账号（web cookie + `x-zse-96` v2 签名）在 2026-10 对知乎邀请回答相关接口做了一次完整测绘。

**结论先放这里：读接口全部可用，写接口全部关闭。** 关闭方式不是在参数上校验，而是在路由层直接拒绝 —— 所以想靠调格式绕过是没有出路的。

如果你是想给知乎问题拉回答的人，直接看[第五节](#五那到底该怎么办)那段，能省你两天。

---

## 一、完整接口表

来自知乎安卓端反编译：

```smali
# com/zhihu/android/api/b/s.smali  (.source "InviteeService.java")
```

对照实测结果：

| 方法 | 路径 | 参数 | 实测 |
|---|---|---|---|
| `GET` | `/api/v4/questions/{qid}/recommendation_invitees` | `offset` `limit` | ✅ 200 |
| `GET` | `/api/v4/questions/{qid}/recommend_invitees` | `offset` `limit` | ✅ 200（早期接口，结构不同） |
| `GET` | `/api/v4/questions/{qid}/invitation-candidates` | — | ✅ 200 |
| `GET` | `/api/v4/questions/{qid}/invitees/search` | `q` `offset` `limit` | ✅ 200 |
| `GET` | `/api/v4/questions/{qid}/invitees` | — | ✅ 200（已邀请名单，没邀请过是 `[]`） |
| `GET` | `/api/v4/questions/{qid}/auto_invite` | — | ✅ 200 |
| `POST` | `/api/v4/questions/{qid}/auto_invite` | — | ✅ 200 |
| `POST` | `/api/v4/questions/{qid}/invitees` | `@FormUrlEncoded` `people_ids` | ❌ 400 |
| `POST` | `/api/v4/questions/{qid}/invitations` | — | ❌ 400 |
| `POST` | `/api/v4/questions/{qid}/invitations/batch` | — | ❌ 400 |
| `DELETE` | `/api/v4/questions/{qid}/invitees/{member_id}` | — | ❌ 400 |

`recommendation_invitees` 和 `recommend_invitees` 是两个不同的接口，别搞混。带 `ation` 的那个才是现在用的，返回体长这样：

```json
{
  "one_button_invite": true,
  "is_forbid_invite": false,
  "left_invitation": 15,
  "paging": { "is_end": false, "totals": 39 },
  "data": {
    "invited": [],
    "last_invite": [],
    "friend_invite": [],
    "recommend_invite": [
      { "is_invited": false, "member": { "id": "9872d4...", "name": "菜梦" }, "reasons": [...] }
    ]
  }
}
```

---

## 二、写接口是怎么死的

我试过的所有组合，全部返回同一个错误：

```json
{ "error": { "message": "请求错误", "code": 400, "name": "MalformRequestException" } }
```

排除过的变量：

- **body 格式** — `application/json` 的 `{"people_ids":[...]}`、`{"people_ids":"..."}`、`{"people_id":"..."}`；`x-www-form-urlencoded` 的 `people_ids=X`；空 body。**四种结果完全一样。**
- **`src` 字段** — 文档提到有 `src`，试了 `invite_page` / `question` / `invite` / `normal` / `answer_editor` / `invite_answer` / `question_invite` / `invitee` / `answer_invite` / `QuestionPage` / `web` / 空值。全部一样。
- **签名方式** — 签名带 body、签名不带 body、签名为空串。全部一样。
- **host** — `www.zhihu.com/api/v4/...` 和 `api.zhihu.com/...`，全部一样。
- **额外 header** — 加 `x-api-version: 3.0.91`，一样。

关键判据是**空 body 和带 body 报同一个错**：

> 空 body 也报 `MalformRequestException`，说明请求在解析 body 之前的中间件层就被拒了。参数格式根本不是瓶颈。

另一个关键判据是 `DELETE /invitees/{member_id}` **也报同样的 400**。删除不需要任何 body。它和「body 格式错」这个假设是互斥的。

### 对照组：证明不是我的问题

往 `/questions/{qid}/answers` 发一个空 JSON：

```json
HTTP 422
{ "error": { "code": 4000, "name": "UnprocessableError", "message": "请求错误" } }
```

**422 而不是 400。** 这是个业务校验错误（内容不能为空），说明签名、cookie、`x-zse-96`、POST 方法全都正常工作 —— 服务端读到了我的请求，只是内容不合格。

而且同一个 cookie 打 `POST /api/v4/questions/{qid}/auto_invite` → **200**。所以 `api.zhihu.com` 上的写操作对 web cookie 也是开放的，卡住的只有 `invitees` 这条路由。

### 所以结论是

`invitees` 的写路由只对**安卓客户端 / OAuth 应用**开放，web session 进不去。这可能是有意的（防脚本批量邀请），也可能是 web 端压根不提供手动邀请（见下一节）。

---

## 三、其实知乎早就在帮你邀请了

`auto_invite` 返回的东西很说明问题：

```json
{
  "status": "open",
  "title": "已成功委托刘看山",
  "description": "已有 401 人浏览，为你持续邀请中",
  "avatar": "https://pic2.zhimg.com/80/v2-85ef...t.jpg"
}
```

刘看山是知乎的吉祥物。「委托刘看山」就是知乎官方的**自动邀请**服务 —— 平台自己按算法挑人推荐你的问题，不需要你一个个点。

这个服务默认是开着的。`one_button_invite: true` 也是这个意思。

也就是说：**我一直想手写的那个功能，官方已经提供了，而且在我折腾接口的这几天它一直在跑**。那个问题有 401 次浏览。

只不过 401 浏览之后仍然是 0 个回答。有人看，没人答。这跟接口没有关系了。

---

## 四、`405` 是个好东西

这次测绘最值钱的收获不是接口表，是找接口的办法。

猜 body 格式是最没效率的。**先用 GET 打一遍路径，看状态码分类**：

| 状态码 | 含义 |
|---|---|
| `200` | 路径存在且可读 |
| `405` | **路径存在，但不接受 GET** → 真正的写入端点就是它，换 POST |
| `404` | 路径不存在，名字错了，别再试 |
| `403` | 存在，但签名/权限不够 |
| `400 Malform` | 路由层就拒了，跟 body 无关 |

`405` 是这里面信息量最大的一个 —— 它替你确认了路径拼写正确，只是方法不对。

靠这个我十分钟内就区分开了：

```
405  /questions/{qid}/invitations          ← 存在
404  /questions/{qid}/settings             ← 不存在
404  /questions/{qid}/invitee_suggestion   ← 不存在
```

比逐个猜 body 格式快一个数量级。`probe.mjs` 就是干这个的。

---

## 五、那到底该怎么办

如果你真的想给一个问题拉到回答：

1. **别碰邀请接口。** 走不通，我在第二节列了全部排除变量，你可以直接跳过这两天。
2. **去看 `auto_invite` 是不是开着。** 大概率开着的。
3. **`left_invitation: 15` 这个数字** 说明还有 15 个额度。额度在消耗，只是没转化成回答。
4. **问题本身值不值得答，比邀请谁更重要。** 401 浏览 0 回答，问题不在分发，在题目。

第 4 条是我自己的数据教我的。

---

## 六、用

```bash
# cookie：每行一个值，第 1 行 z_c0，第 2 行 d_c0
# d_c0 缺了签不出 x-zse-96
export ZHIHU_COOKIE_FILE=./cookie.txt

node invite.mjs recommend  2098203045251265565   # 推荐邀请名单 + 剩余额度
node invite.mjs candidates 2098203045251265565   # 候选人（带话题产出）
node invite.mjs search     2098203045251265565 王 # 按名字搜
node invite.mjs invited    2098203045251265565   # 已邀请过谁
node invite.mjs auto       2098203045251265565   # 委托刘看山的状态

# 这个会失败，留在这里是为了让你能自己验一遍
node invite.mjs invite     2098203045251265565 9872d430...
```

```bash
# 探测任意路径
node probe.mjs 2098203045251265565 invitees invitations auto_invite settings
node probe.mjs --host api.zhihu.com 2098203045251265565 invitees
```

零依赖，只要 Node 18+（用了内置 `fetch`）。

---

## 七、来源

- `hytcyjb/yjboAntiCompilation` — 知乎 3.3.1 反编译，`smali/com/zhihu/android/api/b/s.smali` 是 `InviteeService` 的接口声明原文
- `DracoUnion/BookerDownloadTool` — `doc/zhihu_api.md`，全站端点清单
- `RickZhao/ZhiHu-Pro` — `Zhihu.Common/Net/QuestionApi.cs`，`people_ids` 的 form 拼法
- `oovm/ZhihuLink` — `invitation-candidates` 这个端点最早在这里看到
- `zse-signer.mjs` — `x-zse-96` v2 签名，移植自 zhihu-plus-plus

---

## 八、一句话

我花了两天想打开一扇门，最后发现门一直是开的，只是里面没人。

真正挡住回答量的从来不是接口。
