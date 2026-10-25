# 多 Key 支持设计（目标版本 1.1.0）

| 项 | 值 |
| --- | --- |
| 状态 | 待评审（方案 B 已选定） |
| 基线 | 1.0.12（单 key） |
| 本文档位置 | `docs/DESIGN-multi-key.md`（每次改方案只改这里，不再整篇贴进对话） |
| 上游 | workbuddy2api-hub v1.7.32 @ `http://127.0.0.1:8788` |

---

## 0. 本轮核查结论（先回答六个问题）

### 0.1 换模型会不会影响上下文？——不会（暂定不改历史会话）

- 切换模型在 DSH 里只是往会话追加一条事件：`dsh-api-session-controller/lib/index.js:313` `selectForNextRequest(agent, selection)` → `agent.session.append("model/selection", selection)`。
- 该事件的投影只维护「上次用过的 / 下次要用的」两个槽：`dsh-api-session-controller/lib/types/model-selection-projection.js` 的 `applyModelSelectionProjection` → `{ lastUsed, pending }`，并在 `request/header` 里记录本次请求实际用的 `config.provider / model / reasoningEffort`。
- **不删消息、不重建会话、不重置上下文**。历史消息全部留在会话里，下一个请求换新模型继续读同一份上下文。
- 唯一例外：新模型的上下文窗口更小，DSH 自己的压缩逻辑可能触发一次压缩（与插件无关，任何模型切换都一样）。
- 结论：**不改历史会话的模型**。插件不重写已有会话的 `model/selection`，只在路由消失时让用户重选。

### 0.2 `/usage` 能不能按 key 过滤？——不能，但 `/usage/analytics` 直接给 per-key

- `wb_proxy.py:784 range_query()` 只认 `range` / `since` / `until`；全文件没有 `query.get("key")`；实测 `/usage?range=today&key=<id>` 与不带 `key` 的结果完全一致（静默忽略）。
- `GET /usage/analytics?range=today|week|month`（`wb_proxy.py:19040` → `compute_usage_analytics`）返回 `keys[]`，每行字段实测：`key, name, realm, enabled, source, window, all_time, window_models, all_models, realms, last_at, models, models_other, cross_realm`；顶层还有 `window:{since,until}`、`realm:"all"`、`usd_cny`、`summary`、`accounts`、`models`。
- 该接口属 panel route（`wb_proxy.py:18574`），需要 `X-Panel-Token`。
- 必须过滤合成桶：`__no_key__`（没带 key 的请求）、`__unknown_key__`、`__before_keys__`（`wb_proxy.py:6594-6596`，`source:"bucket"`）。实测 `keys[]` 里 5 行 = 3 个真 key + 2 个桶。
- 三个 key 的 `/v1/models` 都返回 19 条、`models` 白名单都是 0（不限制）→ per-key 模型集必须用各自 key 当 Bearer 去拉。

### 0.3 客户端能不能读到「当前会话用的是哪个 provider/model」？——能

- 插槽本身不给上下文：`dsh-client-ui-sidebar/lib/client.js:403` 只是 `renderSlot("sidebar.footer.action", { wide })`。
- `uiSession` 服务：`dsh-client-ui-session/lib/client.js:798` `super(ctx, "uiSession")`，`:801` `this.current = createBindingSource(...)`，`:916` 用 `this.current.value.key` 拿当前会话 id，`:1050` `createBindingSource` 返回 `{ value, listeners, getSnapshot, subscribe }`。
- `modelDirectories` 服务：`dsh-client-ui-model-selection/lib/client.js:999` `super(ctx, "modelDirectories")`，`:1025` `directoryFor(sessionId)`，`:940-980` 快照结构 `{ current:{provider,model,reasoningEffort}, routable, groups, failures, status, pending, error }`；标准订阅写法 `:1153` `useSyncExternalStore(directory.subscribe, directory.getSnapshot)`。
- `routable === false` 正是「当前选中的 provider/model 已不在目录里」，用来实现「主 key 被删 → 请重新选择模型」。
- 切会话只是换快照来源，**不额外发请求**。
- 映射规则：快照里的 `provider` 就是 providerId = 我们的 `routeKey`（`workbuddy2api-hub` / `workbuddy2api-hub-<slug>`）；非该前缀（以及 `stepfun` 等）算「非网关模型」。

### 0.4 性能实测（真实 hub，2026-10-25，pwd 已改，脚本从状态文件读）

测时 2026-10-25 14:1x，账号池正在变化（`/health` 报 480 个账号、359 就绪；`/accounts` 返回 308 行）：

| 接口 | 是否随账号数变化 | 实测耗时（3 次） | 响应体积 |
| --- | --- | --- | --- |
| `GET /v1/models`（`bendi`，绑 2 个号） | 否 | 9.3 / 8.5 / 8.4 ms | 19 个模型，小 |
| `GET /v1/models`（`others`，绑 1 个号） | 否 | 18.9 / 14.7 / 9.6 ms | 19 个模型 |
| `GET /v1/models`（`pool-cn`，绑 **188** 个号） | 否 | 7.7 / 5.9 / 20.6 ms | 19 个模型 |
| `GET /accounts` | 是（全量固定） | 358 / 320 / 290 ms | **4.2 MB**（308 行） |
| `GET /usage/analytics?range=today` | 是（全量固定） | 845 / 238 / 334 ms | **5.3 MB**（5 个 key 行） |
| `GET /v1/balance-summary` | 否 | 8.7 / 16.1 / 15.2 ms | 小 |
| `GET /usage?range=today` | 是（全量固定） | 267 / 14.7 / 15.4 ms | 46 KB |
| `POST /panel/login` | 否 | 106 ms | 小 |
| `GET /settings` + `/settings/reveal` | 否 | < 20 ms | 小 |

`/v1/models` 与账号数无关的依据：`wb_proxy.py:18804` `_get_v1_models()` 走 `fetch_models(realm)` 的 realm 级目录缓存 + `model_entry()`，不遍历账号池；只有 `wb_settings.filter_models_by_key`（默认 off）和 `wb_settings.models_only_available`（默认 off）才会二次过滤，后者才逐模型查池。

**由此得三条预算规则**：
1. **自动拉取很便宜**（每 key 一次 ~10 ms、19 条模型）。`pool-cn` 绑 188 个号也照拉，性能无影响。
2. `/accounts` 与 `/usage/analytics` 是重接口且**与 key 无关**：每轮刷新各拉 **1 次**，所有 key 共用，绝不按 key 重复拉。
3. per-key 余额用**已拉到的** `/accounts` 在本地求和，零额外请求。

### 0.5 主 key 余额怎么算（第一行两个数据）

- **主 key 余额** = 该 key 绑定的账号在 `/accounts` 里的 `credits.remain` 之和。实测 `bendi` 绑 2 个号，两个都 `enabled`，`credits.remain` 合计 **3768.05**。
- **全局值** = `GET /v1/balance-summary` 的 `balance`（realm 级）。同一时刻实测 **588,777.91 credit**（`accounts_enabled: 190`、`accounts_with_credit_data: 190`）。
- 两者差两个数量级是正常的：全局是整个号池 190 个号的合计，主 key 只能路由到自己绑的那 2 个号。**并排显示时要在 tooltip 里标清「全局 = 号池合计」，否则容易被理解成 bug。**
- 展示口径（已定）：第一行写成 `主key余额 3768.05 ｜ 全局 588,777.91（190 号）`——全局后面必须带号数，否则两个数字差 150 倍看着像 bug。号数取 `/v1/balance-summary` 的 `accounts_enabled`，缺该字段时退回 `/accounts` 里 `credits.remain > 0` 的行数。
- 性能：求和是对已拉到的列表做 O(绑定数) 遍历，**主 key 绑多少号都一样**；成本永远是那一份 `/accounts`（体积/耗时见 0.4，每轮 1 次，可 60s 缓存）。
- 主 key 绑定的账号被删/禁用：只统计仍存在的账号，缺失时该数字显示 `—` 并在 tooltip 标「绑定账号 1/2 不可用」。
- 主 key **一个号都没绑**（已定）：`主key余额` 显示 `—`，全局值照常显示，tooltip 标「主 key 未绑定账号」。

### 0.6 `allowedModels` 进与不进有什么影响？

| | 写进 `allowedModels` | 不写 |
| --- | --- | --- |
| 主会话模型选择器 | 无影响（本来就不受它限制） | 无影响 |
| subagent / Agent Teams 成员 | 允许显式选到该 `provider/model` | 走继承：子会话沿用父会话已选路由；全新会话在 `enabled:true` 时只能从白名单里选 → **新 key 的模型选不到** |
| 未开启时（`enabled:false`，默认） | 整段策略不生效，写不写都一样 | 同左 |
| 风险 | `enabled:true` 且 `allowedModels` 为空会抛 `enabled subagent model selection requires at least one allowed model`；重复路由抛 `subagent model selection repeats route` | 无 |

- 依据：`dsh-tool-subagent/lib/model-selection-settings.js:40-45`（`enabled` 默认 `false`、`allowedModels` 默认 `[]`，两者都 `volatile`）、`dsh-tool-subagent/lib/index.js:543-557` `selectForSession()`、`assertAllowedModelRoutes`。
- 结论：**默认不动 `allowedModels`**（多数人没开这个开关）；设置页给一个显式按钮「把已同步的 key 路由写入子代理白名单」，只在用户开启子代理模型选择时提示。写入是追加式、去重、保留用户手工添加的其它路由。

---

## 1. 现状梳理（1.0.12）

| 维度 | 现状 |
| --- | --- |
| provider | 只有一条：`routeKey = workbuddy2api-hub`、`apiKeyEnv = WORKBUDDY2API_HUB_API_KEY` |
| 凭据 | 一条：`config.apiKey` → credentials 同名引用 → 面板 `/settings` + `/settings/reveal` 三级来源 |
| 模型集 | 单份：`lastModelIds` / `retired` / `selection` / `lastSyncAt` / `lastSyncError` / `lastSyncCount` 全在状态顶层 |
| 刷新 | `intervalSeconds`（默认 120）轮询：`/health` → `/panel/status` → 必要时 login → `/v1/models` → `/v1/balance-summary` → `/usage?range=` → `/usage?range=week` → `/accounts` → 解析 Key → reconcile → 写 DSH |
| 徽标 | 单 key：余额 / 今日 tokens·积分·API 等价 / 本周同三项 |
| 状态文件 | `~/.dsh/profiles/<profile>/workbuddy2api-hub.json` |

---

## 2. 候选方案对比

| | A. 单 provider + 模型子集 | **B. 一 key 一 provider 一凭据**（选定） | C. 多 key 共用一份凭据 |
| --- | --- | --- | --- |
| DSH 里能否按 key 分模型 | 不能（同一 provider 只能挂一份 `apiKeyEnv`） | 能 | 不能 |
| 会话选模型时能否区分 key | 不能 | 能（provider 名就是 key 名） | 不能 |
| 单 key 失效影响面 | 全部模型一起挂 | 只有该 key 的 provider | 全部 |
| 迁移成本 | 低 | 中（新增 keys[]、per-key 状态） | 低 |
| 与 1.0.12 兼容 | 好 | 好（顶层字段保留为主 key 镜像） | 好 |
| 结论 | 否 | **采用** | 否 |

---

## 3. 推荐方案

### 3.1 标识与命名（创建后不可变）

- **主 key 冻结**：网关里名为 `bendi` 的 key 永远用 `routeKey = workbuddy2api-hub`、`apiKeyEnv = WORKBUDDY2API_HUB_API_KEY`。理由：已有会话、`agent-default-model`、`subagent-model-selection-settings.allowedModels` 都指向它，改了就断。
- 其它 key：`routeKey = workbuddy2api-hub-<slug>`、`apiKeyEnv = WORKBUDDY2API_HUB_API_KEY_<SLUG>`；`slug` = key 名转小写、非字母数字换 `-`、去首尾 `-`、截断 24 字符。
- 名字冲突（两个 key 都叫 `pool`）：第二个追加 key id 前 4 位 → `workbuddy2api-hub-pool-9f2a`（**用户已确认可接受**）。
- `displayName` 用网关里给 key 起的名字（不用上游账号昵称——一个 key 可能绑近 200 个号）。
- `routeKey` / `apiKeyEnv` 一经写入状态就不再改：改名只改 `displayName`。

### 3.2 状态结构

```jsonc
{
  "baseUrl": "http://127.0.0.1:8788",
  "pwd": "…",
  "tab": "gateway",
  "intervalSeconds": 120,
  "maxKeys": 10,
  "mainKeyId": "ae84c129b249",      // 主 key 的 hubKeyId
  "mainKeyMissing": false,          // 主 key 在网关里消失 → true
  "keys": [
    {
      // ← 持久化（只有这几项是用户意图）
      "hubKeyId": "ae84c129b249",
      "name": "bendi",
      "masked": "91d3******0a86",
      "routeKey": "workbuddy2api-hub",
      "apiKeyEnv": "WORKBUDDY2API_HUB_API_KEY",
      "pull": "auto",               // auto | manual
      // 勾选：{ 模型 id: { enabled, efforts } }，空对象 = 全选；
      // 用对象而不是数组，是因为每个模型还要记思考档位（efforts）。
      "selection": {
        "hy3": { "enabled": true },
        "glm-5.3-flash": { "enabled": false, "efforts": { "high": "high" } }
      },
      // ← 投影（每轮重算，写盘只为 UI 立即显示）
      "lastModelIds": [], "retired": {}, "lastSyncAt": 0,
      "lastSyncError": "", "lastSyncCount": 0, "source": "panel"
    }
  ],
  // 顶层保留 1.0.12 字段做「主 key 镜像」，供回滚
  "selection": {}, "lastModelIds": [], "retired": {}, "lastSyncAt": 0,
  "lastSyncError": "", "lastSyncCount": 0, "sync": true
}
```

### 3.3 发现与凭据同步（每轮刷新）

1. `GET /settings` → `api_keys[]`（`id` / `name` / `masked` / `enabled` / `source` / `models` / `accounts`）。
2. 新出现的 key：`GET /settings/reveal?id=` 取明文 → 写进 credentials（`apiKeyEnv`）→ 建 `state.keys[]` 条目，`pull` 默认 `manual`（主 key 除外），`selection` 默认 `{}`（= 全选，等价于每条 `{ enabled: true }`）。
3. 已存在且 `masked` 变化（网关键轮换/重新生成）→ 重取明文并覆盖凭据。
4. 已存在且 `masked` 未变 → **不取明文**（省一次请求，也少一次明文进内存）。
5. **不提供删除按钮**：网关里删掉/停用（`enabled:false`）→ 下一轮自动从 `providers` 里摘掉该路由，`state.keys[]` 里标 `missing` 并保留条目（凭据保留，便于恢复）。「被删」与「从未存在」用 `/settings.deleted_api_keys[]`（实测存在该字段，当前为空）区分：命中它才叫删除，否则算新发现。
6. 超过 `maxKeys`（默认 10）→ 多余的标 `skipped`，不建路由，UI 提示。

### 3.4 拉取策略（1.2.0 已删除，见 §8.1）

| key | 默认 | 行为 |
| --- | --- | --- |
| 主 key | `auto` | 每轮轮询都拉 `/v1/models` |
| 其它 key | **`manual`** | **发现时自动拉一次**（拿到模型清单、写好路由），此后不进轮询；用户点「立即拉取」再拉一次，结果缓存 **60 秒**（同会话内重复点不重复请求）；UI 显示「上次拉取 12:03」 |
| 用户手动改成 `auto` 的 key | `auto` | 与主 key 一样每轮拉 |

- 「发现即拉一次」与「默认 manual」是两件事：前者保证新 key 一出现就能在 DSH 里选到模型，后者保证常驻轮询只跑主 key。`pool-cn`（绑 188 号）首次发现拉一次即可，实测 5–21 ms，无性能影响（0.4）。
- auto 模式错峰：第 `i` 个 auto key 延迟 `i × 1.5s`，避免同一秒并发多个请求。
- 手动拉取的 60s 缓存只缓存 `/v1/models` 结果，不吃 `/accounts`；`/accounts` 的 60s 缓存是另一套（见 3.10），两者互不影响。
- 依据 0.4：单次 `~10 ms`，即使 10 个 key 全 auto，一轮也就 +100 ms。

### 3.5 每个 key 的模型集

```
perKeyModels = GET /v1/models (Bearer = 该 key)
             ∩ api_keys[i].models（非空时才是白名单，实测三个 key 都是 0 = 不限制）
             ∩ selection（空对象 = 全选；显式 enabled:false 才排除）
```

- **默认全选**（用户确认）：新 key 首次拉取即全量，不做「只勾几个」的意外裁剪。
- 模型名带倍率后缀（`Hy3 Free` / `Kimi-K3 ×1.62`），与 1.0.9+ 一致。
- `reconcileModels` 的宽限期逻辑（`retireHours` 默认 24）按 key 独立。

### 3.6 写 DSH 与「主 key 被删」

- **每个可用的 key 写一条路由**（跳过 `missing` / `skipped` / `conflict` 的 key；`manual` 且从未拉过的 key 也跳过）。路由形状与 1.0.12 单 key 完全一致：`{ displayName, api: 'openai-completions', baseURL: `${base}/v1`, apiKeyEnv, compat:{supportsReasoningEffort:true,thinkingFormat:'openai'}, models }`，`models` 用该 key 自己的模型集（3.5）。
- 写之前用 `routeConfigMatches` 深比较，没变化不写盘（沿用 1.0.12）；该轮所有路由的变化合成**一次** `settings.mutate`（`set` 各 provider + `unset` 被摘掉的路由）。
- `snapshot()` 新增字段：`keys[]`（每项含 `hubKeyId/name/masked/routeKey/apiKeyEnv/pull/selection/models/status/lastSyncAt/lastSyncError/lastSyncCount/isMain`）、`mainKeyId`、`mainKeyMissing`、`mainKeyBalance`、`balance`、`usage`、`usageWeek`、`usageByKey`、`accountsMeta`。`/state` 的 ETag 覆盖这些字段。
- **主 key 从网关消失**（用户明确要求）：
  1. 删除 `providers['workbuddy2api-hub']` → 路由消失，会话里的模型解析失败（pi-ai 抛 `has no configured model`，选择器 `routable === false`）。
  2. `state.mainKeyMissing = true`。
  3. **绝不把别的 key 提上来顶替**（名字/凭据都不换）。
  4. 徽标第一行显示「主 key 已删除」。
  5. 设置页红条：`主 key（bendi）已从网关删除；当前会话需要重新选择模型`，并提供「重新指定主 key」下拉（列出网关现有 key）。
  6. 会话侧：模型选择器进入「重新选择模型」状态——由 DSH 的 `routable:false` 自然触发，插件只负责删路由，不伪造替代项。

### 3.7 侧边栏徽标（三行）（1.2.0 改成三行 + 点击副窗、数字按 key 拆，见 §8.2）

```
● WorkBuddy   主key余额 3768.05 ｜ 全局 588,777.91（190 号）   ← 第一行（两个数据）
今日   42.8M tokens · 40.92 积分 · ¥6.25
本周   249.9M tokens · 456.27 积分 · ¥29.51
```

- 第一行：`主key余额` = 主 key 绑定账号 `credits.remain` 之和、`全局` = `/v1/balance-summary` 的 `balance`（含号数）；口径与缺失处置**全部见 0.5**，本节只管排版。
- 第二 / 三行沿用 1.0.5 的 `usageRow`（左标签、右数字组，`marginLeft:auto` 右对齐）。
- tooltip：先列当前会话所用的那个 key 的数据，再换行列出**全部 key**（每 key 一行，`●` 标当前，`manual` 未拉取的显示 `—（未拉取）`）。
- 当前会话用的不是网关模型（`stepfun`/`others`/内置模型）→ 第一行与 tooltip 的「当前」按 **主 key** 显示。
- 切会话不新增请求（数据来自已有快照）。

### 3.8 勾选与「同步到其他 key」

- 设置页每个 key 一块：模型表（勾选）+ `pull` 切换 + 「立即拉取」+ 「同步勾选到其他 key」。
- 同步语义（用户要求）：把**当前 key 的勾选结果**复制给选中的其它 key（多选），只覆盖这些 key 里「也存在的模型 id」，不存在的忽略，空选不复制。
- 全选/全不选/反选按钮与 hub 看板一致。

### 3.9 用量数据源（per key）

| 档 | 来源 | 精度 | 代价 |
| --- | --- | --- | --- |
| T1 | `/usage/analytics?range=today` 的 `keys[].window`（只取 `source === 'panel'` 的行） | 精确，按 key 直接给 | 每轮 1 次，耗时与体积见 0.4（全 key 共用） |
| T2 | `/usage?range=` 的 `by_model` × 每 key 的模型集反查归属 | 近似（一个模型挂了多个 key 时分不清） | 每轮 1 次（本来就在拉） |
| T3 | 全局 `/usage` | 只做兜底 | 0 |

- `keys[]` 行里合成桶的 `name` 是 `(无 key)` / `(未知 key)`、`source` 是 `bucket`，一律按 `source` 过滤，别按名字过滤。

- 余额**不能按 key 拆**（`/v1/balance-summary` 是 realm 级、`/accounts` 是账号级，key↔账号多对多）→ 只有主 key 余额（0.5）和全局值。
- `/usage/analytics` 失败时降级到 T2，再失败到 T3 并在 tooltip 标「近似」。

### 3.10 每轮请求预算

| 请求 | 次数 | 说明 |
| --- | --- | --- |
| `/health`、`/panel/status` | 各 1 | 已登录时 `/panel/status` 也照打（判断密码是否仍是默认） |
| `/panel/login` | 0–1 | 仅在无 token 或 401 时 |
| `/settings` | 1 | 发现 key |
| `/settings/reveal` | 仅新增/`masked` 变化 | 平时 0 |
| `/v1/models` | auto key 各 1 | 每 key ~10 ms |
| `/v1/balance-summary` | 1 | 全局值 |
| `/usage?range=today`、`?range=week` | 各 1 | 徽标二/三行（主 key 或全局） |
| `/usage/analytics` | 1 | per-key 用量 |
| `/accounts` | 1（或 0，命中 60s 缓存时） | 主 key 余额求和；缓存 TTL 60s，与手动拉取的模型缓存互不相干 |

---

## 4. 涉及文件与改动点

| 文件 | 改动 |
| --- | --- |
| `lib/hub.js` | 新增 `keySlug()`、`routeKeyFor()`、`apiKeyEnvFor()`、`uniqueRouteKey()`、`mainKeyBalance(accounts, boundIds)`、`pickKeyUsage(analyticsRows, hubKeyId)`、`isSyntheticUsageRow(row)`；`buildRouteModels` 支持传入单 key 的模型数组；`summarizeUsage` 增加 per-key 视图 |
| `lib/index.js` | `DEFAULT_STATE` 增 `keys/mainKeyId/mainKeyMissing/maxKeys`；`migrateState()`（5 节一次性迁移）；`reconcileKeys()`（3.3 六步）；`refresh()` 改为「一次取共用数据 → 逐 key 处理」；`resolveApiKey` 改成按 key；`syncModelsToDsh` 合成一次 mutate 写 N 条路由；`snapshot()` 按 3.6 字段清单输出；新接口 `POST /keys/pull`、`POST /keys/pull-mode`、`POST /keys/selection`、`POST /keys/sync-selection`、`POST /keys/main`；`GET /dashboard-url` 不变 |
| `client/client.js` | 设置页新增「Key 列表」卡片（每 key 一块，3.8）；徽标第一行改双数据 + tooltip 全 key（3.7）；订阅 `uiSession` + `modelDirectories` 定位当前会话的 key；`routable:false` 时显示「重新选择模型」提示 |
| `scripts/mock-hub.mjs` | 造 3 个 key（`bendi`/`others`/`pool-cn`）+ `/settings/reveal` + `/usage/analytics` + 可配置账号数（2 / 1 / 188）+ `/mock/keys/add|remove|disable` + `deleted_api_keys` |
| `scripts/smoke-live.mjs` | 多 key 只读体检（key 数、每 key 模型数、主 key 余额、per-key 用量） |
| `tests/*.test.mjs` | 见第 6 节 |
| `package.json` | `version` → `1.1.0`（`tests/host.test.mjs` 的 `PLUGIN_VERSION` 断言同步） |
| `README.md` / `CHANGELOG.md` | 多 key 配置表、迁移说明、1.1.0 条目 |

---

## 5. 兼容与迁移

- **迁移只在 `state.keys` 不存在时执行一次**：用当前生效的 API Key 反查是哪个面板 key（凭据里已有明文 → 与 `/settings/reveal` 比对；**这是唯一豁免 3.3 第 4 步「`masked` 未变不取明文」的场景**，只跑一次），找到就把它设为主 key，`routeKey` / `apiKeyEnv` 保持 1.0.12 原值；找不到就把 `bendi` 设为主 key。迁移后立刻写回 v2 状态，不会重跑。
- 顶层 `selection` / `lastModelIds` / `retired` / `lastSyncAt` / `lastSyncError` / `lastSyncCount` / `sync` **保留并继续写入**（= 主 key 镜像），这样回滚到 1.0.12 时行为不变、已有会话不断。
- 回滚到 1.0.12：其它 key 的 `providers.workbuddy2api-hub-*` 变成孤儿路由（旧版不刷新、也不会删），模型仍可选，只是不再更新。文档里给出「一键清理孤儿路由」的手工命令。
- 凭据命名冲突：`WORKBUDDY2API_HUB_API_KEY_<SLUG>` 若已被用户手填成别的值 → 不覆盖，标 `conflict` 并在设置页提示。

---

## 6. 测试点

1. 命名：`bendi`→`workbuddy2api-hub`；`pool-cn`→`workbuddy2api-hub-pool-cn`；同名冲突→追加 id 前 4 位；slug 处理中文/空格/超长。
2. 发现同步：新增 key 自动建条目 + 取明文 + 写凭据；`masked` 变→重取；`masked` 未变→不取；删除→摘路由留条目；`enabled:false`→摘路由；超 `maxKeys`→`skipped`。
3. 拉取：主 key auto 进轮询；其余 manual 不进；手动拉取 60s 内第二次点击不发请求；auto 错峰间隔。
4. 模型集：默认全选（`seedSelection`）；`copySelection` 只在「同步勾选」时用，且目标 key 独有的模型保留它自己的勾选；白名单非空时再取交集；模型名带倍率；`retired` 宽限期按 key 独立。
5. 主 key 删除：删 `providers['workbuddy2api-hub']`、`mainKeyMissing:true`、**不新增替代路由**、徽标文案、`/state` 字段。
6. 徽标：第一行两数据（主 key 余额求和 + 全局）；缺号显示 `—`；三行结构；tooltip 全 key + `●`；非网关模型回落主 key；切会话不发新请求。
7. 用量：T1 命中 per-key；analytics 失败降级 T2/T3 并标「近似」；合成桶被过滤。
8. 迁移：v1 状态 → v2 一次迁移；顶层镜像同步；回滚后 1.0.12 仍能读。
9. 错误：/settings 401 → 重新登录一次；reveal 404 → 该 key 标 `no-secret`；网络失败不清空已有路由。

---

## 7. 待确认问题

已全部关闭，无待用户决定项。下表保留结论与依据，便于回溯：

| # | 问题 | 结论 | 依据 |
| --- | --- | --- | --- |
| 1 | 换模型是否要顺带改历史会话 | **不改** | 0.1（不影响上下文） |
| 2 | `pool-cn` 是否自动拉 | **~~发现时拉一次，之后归 `manual` 不再轮询~~（8.1 已推翻：现在一律每轮都拉）** | 3.4 + 0.4（5–21 ms，与账号数无关） |
| 3 | 徽标第一行口径 | **主 key 绑号余额之和 + 全局值** | 0.5 |
| 4 | 非主 key 默认拉取方式 | **~~`manual`~~（8.1 已推翻：没有 auto/manual 之分）** | 3.4 |
| 5 | 是否写 `allowedModels` | **默认不写**，设置页给显式按钮 | 0.6 |
| 6 | 同名消歧 | **追加 id 前 4 位** | 3.1 |
| 7 | `maxKeys` 默认 10 是否够 | **够** | 网关侧无 key 数量上限（`wb_*.py` 无 `max_keys` 类逻辑，`/settings.limits` 只有积分/日限额），现有 3 个；10 只是插件侧自我保护，且本身是状态里的可配置项 |
| 8 | 主 key 未绑任何账号时第一行显示什么 | **`主key余额 —`，全局照常，tooltip 标「主 key 未绑定账号」** | 0.5 末条 |
| 9 | 子代理白名单是否默认勾选 | **默认不勾** | 0.6（默认不写 `allowedModels`） |
| 10 | 第一行「全局」是否带号数 | **带**：`全局 588,777.91（190 号）` | 0.5（两数量级差异需要解释，否则像 bug） |

## 8. 1.2.0 的调整（推翻 3.4、3.7 与部分 3.6）

### 8.1 拉取策略：不再分 `auto` / `manual`

3.4 那一套「主 key 自动、其余手动、60 秒缓存」在 1.2.0 删除。依据是本文件 0.4 已经量到的结论
——每 key 一次 `/v1/models`，**耗时与绑定账号数无关**（1 号 `7.8 ms` / 2 号 `14.8 ms` /
188 号 `15.4 ms`，抖动 3–32 ms），账号数只撑大全量接口的响应体（`/accounts` 4.4 MB、
`/usage/analytics` 5.5 MB，每轮各拉一次，与 key 数无关）。

所以 1.2.0 起**每条 key 每轮都拉**：`refresh()` 的 key 循环无条件调用 `refreshKeyModels()`，
`POST /keys/pull-mode`、`snapshot().keys[].pull`、`PULL_MODES` / `normalizePullMode()` /
`DEFAULT_KEY_PULL` 一并删除。`POST /keys/pull` 保留为排障用的手动重拉（60 秒节流）。
老状态文件里残留的 `pull` 字段读进来直接忽略，不需要迁移。

### 8.2 徽标：`title` 悬停 → 点击副窗，两行又回到三行

3.7 的「三行 + `title` 悬停提示」整个换掉，改成对齐 `dsh-token-usage-stats` 的写法：

- 一条 root 按钮（`font:inherit` + `--dsw-alias-label-secondary`），高 36px；收起态
  36×36 圆形只留图标；图标是内联 SVG，`fill: currentColor`。
- **不再用 `title`**：点击弹出贴着徽标上沿的**副窗**（`position: fixed`，位置由
  `event.currentTarget.getBoundingClientRect()` 现算，`bottom` 取视口高减按钮上沿），
  点遮罩或右上角 `×` 关闭。没有用宿主 `Modal`——它是居中模态，压住整个侧边栏，
  而这里要的是「从底栏长出来」的轻量副窗。
- 展开态最终仍是**三行**（1.2.0 中途曾收到两行，用户要求改回来）：
  第一行「当前会话那条 key 的名字 + **该 key 余额 / 整域余额**」，第二行 `今日`、
  第三行 `本周`，右半边是 `tokens / 积分 / 等价` 三列。三列用
  `grid-template-columns: minmax(44px,1fr) minmax(42px,1fr) minmax(50px,1fr)` +
  `justify-items: end`，同一指标在所有位置占同一列，切 key 时数字不左右跳。
- **余额必须按 key 拆**：`snapshot.keys[]` 新增 `balance`（`keyProjections()` 里
  `mainKeyBalance(this.accountsRaw, key.accounts)`）。`/v1/balance-summary` 是整域汇总、
  拆不到 key，只能拿已经拉到的 `/accounts` 里这条 key 绑定账号的 `credits.remain` 求和
  ——纯内存，不额外发请求；账号不在 `/accounts` 里时返回 `remain: null`（前端显示占位），
  不能报 0。会话用的不是网关模型时回落主 key。
- 副窗内容是「各 key 用量」表（用户给的样式）：一行列标题 `tokens / 积分 / 等价`，
  每条 key 一段「名字 + `账号 N`」再跟 `今日`、`本周` 两行，末尾一行 `总计`
  **直接取 `/usage` 的整域汇总**（面板「数据看板」顶部那行就是它），不自己求和——
  2026-10-25 实测三条 key 的 `window` 相加与整域 tokens / credit / ¥ 差都是 0，两种口径等价，
  网关给什么就显示什么；
  上方两个格子放「这条 key 的余额」与「全部账号」，底部「打开面板」「关闭」。
  原来塞在弹窗里的今日/本周两块删掉（徽标上已经有了），不做重复展示。
- 数字统一两位小数（`72.30M` / `1.20k` / `¥10.39` / `1435.83`），k/M/B 缩写保留尾零。
- **数据全是网关原样给的**，本地只做两件事：换两位小数、算 `errors / requests` 的成功率。
  每条 key 的那四个数来自 `/usage/analytics` 里 gateway 按 API Key 分好的 `window`
  （= 面板「数据看板 → 用量明细 → 按 API Key」那张表），「总计」来自 `/usage`。
- 徽标第一行那串「该 key 余额 / 总余额」与下面两行数字同一套字体：11px、`label-tertiary`、
  等宽 + `tabular-nums`，只把字重降回常规（标题行本是 600）。
- 样式一次性注入 `<style data-plugin-css="dsh-workbuddy2api-hub/client.js">`，幂等。

### 8.3 设置页：模型表并进各自的 key

3.5 / 3.8 的「一张全局模型表 + 每条 key 的勾选同步」改成**每条 key 一份模型表**：
勾选、思考档位、全选/全不选、立即拉取、同步勾选、设为主 key 都在各自卡片下，
勾选请求从全局 `/selection` 改成带 `hubKeyId` 的 `/keys/selection`。
「立即移除」（retired）只在主 key 那一份里给，因为 retired 宽限期表跟着主 key 走。
连接区改成 CSS grid 对齐（标签/输入框/提示左端对齐且等宽，窄窗口折成一列）。

### 8.4 概览：两个胶囊变成格子，同步行说清分子分母

原来贴在概览右侧的 `realm cn`、`key: credentials` 两个小圆角标签，改成和「面板会话」
同样的「标题 + 数据」格子排在它后面。文案按网关自己的叫法，不是自创译名——把
`http://127.0.0.1:8788/` 的面板 HTML 抓下来检索过：`realm` 这套在网关界面里一律叫
**「版本」**（`cn` = 国内版、`intl` = 国际版），`apiKeySource` 叫 **「API Key 来源」**
（手动填写 / 凭据库 / 面板自动获取 / 未配置）。

七项改成 `auto-fit` 网格（`minmax(112px, 1fr)`、`8px × 10px` 间距），窗口变窄自动少列多行；
「今日」那行徽标收窄到 `padding: 0 4px`，并去掉左右各 6px 的负外边距——这样它左端与
下面「已同步」那行对齐（原来差 6px，视觉上是缩进去的）。告警徽标（缺 Key / 仍是默认密码）
挪到单独一行，不再跟数字抢宽度。

同步行从 `18 模型` 改成 `6/19 模型`，分子是**所有 key 真正写进 DSH 的模型并集**
（按 id 去重，未勾选与 `retired` 都不算），分母是网关给的模型总数。

这一格改了三版才对，记在这里免得再走回头路：

1. 第一版直接拿 `snapshot.lastSyncCount`——它是 `syncRoutesToDsh()` 里
   `count += routeModels.length` 逐条路由累加出来的，同一条模型被几条 key 都勾上就重复计几次。
   三条 key 6 + 1 + 6 = 13，界面上出现 `13/19`，被当成 bug 问「13 是怎么来的」。
2. 第二版改成取主 key 那条路由的条数——和同一行右边的主 key `routeKey`、单条 key 的分母
   都自洽了，但**还是错的**：DSH 的模型选择器里能选到的是并集。
3. 第三版（现行）：`syncedModelCount(snapshot)` 遍历 `keys[].models` 把 `id` 收进 `Set`。
   主 key A 启 1/2/3、B 启 2/3/4、C 启 1/5 → 显示 5，不是 3、也不是 3+4+2=9。

老宿主没给 `keys[].models`、或主 key 已被删时，才回落到 `lastSyncCount`。

### 8.5 删掉「打开面板时带上密码」

1.0.12 加过一个开关，允许把 `?pwd=<面板密码>` 拼进深链。它默认关着，但留一个「能把它
打开」的开关本身就等于承认密码可以进 URL；而 hub 会把收到的请求行原样写进
`logs/service.log`（`GET /?pwd=…` 明文落盘），浏览器也照样记进历史。1.2.0 把整条链路删掉：

- 配置项 `dashboardIncludePwd`：`DEFAULT_STATE`、`migrateState`、`snapshot()`、
  `POST /config` 四处分支一起删；
- 设置页那个复选框和它的说明文字；
- `GET /dashboard-url` 响应里的 `includePwd` 字段；
- `buildDashboardUrl()` 的 `pwd` 参数（签名从 `(base, pwd, tab, options)` 收成 `(base, tab)`）。

深链永远只有 `?tab=`。老前端再 POST `dashboardIncludePwd` 会被静默忽略——不用报错，
它只是个不再生效的字段。

### 8.6 key 卡：折叠与按钮行

- **折叠**：每条 key 的模型表可折叠。默认值由纯函数 `keyFoldOpen(folded, key)` 给
  ——没点过就按 `isMain`（主 key 摊开、其余收起），点过就照表里的记录。开关就是卡片头上
  那行「账号 N · 模型 6/19」，带 ▸/▾ 箭头；收起时同一行补「点击展开模型列表」，
  不再另起一行写说明。三条 key 各 19 个模型全摊开是 57 行，太长。
- **按钮行**：「设为主 key」贴左，立即拉取 / 全选 / 全不选 / 同步勾选靠右。
  做法是 `justify-content: flex-end` 配首项 `margin-right: auto`，整行 `flex: 1 1 100%`
  独占一行；DOM 顺序也把「设为主 key」放最前，Tab 焦点才会跟视觉一致。主 key 那张卡
  没有「设为主 key」，四个按钮由 `flex-end` 一起靠右。
- **主标题**：「Key 列表」那行（含副标题与 `3 / 10` 计数）删掉。删标题时连外层那层
  `styles.card` 一起删——否则里面每条 key 自己还带边框，就成了「空框套实框」，
  卡片上方会留一条什么都没装的边。

## 9. 未决

原表 #2（`pool-cn` 是否自动拉）、#4（非主 key 默认拉取方式）已被 8.1 推翻：现在没有
auto/manual 之分，每条 key 每轮都拉。其余各条仍然有效。

