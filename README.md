# dsh-workbuddy2api-hub

把本地跑的 [workbuddy2api-hub](https://github.com/ardeyouxipianyi/workbuddy2api-hub) 接进 DSH 桌面端：设置页里一块面板管连接（地址 / 密码 / 页签），一次同步就把 hub 上的模型连同上下文窗口、思考档位、倍率写进 DSH 的 `llm-pi-ai`，侧边栏常驻显示额度与连接状态。

仿 [dsh-workbuddy2api-panel](https://github.com/jerry9692/dsh-workbuddy2api-panel) 的结构与对接方式写成，依赖面完全相同：宿主侧只碰 cordis 注入的服务，不 import 任何 `@deepseek-ai/*` 运行时包；前端是一个已经构建好的 `window.__ModuleLoader__` bundle，宿主直接加载，不需要打包步骤。

```
本地 workbuddy2api-hub (:8788)  ←  X-Panel-Token  ─┐
      └─ /v1（OpenAI 兼容）      ←  Bearer Key ────┤
                                                    ├─→  本插件（DSH 宿主侧）
DSH 设置页 / 侧边栏  ←  /workbuddy2api-hub/api/*  ──┘        └─→  llm-pi-ai providers.workbuddy2api-hub
```

## 为什么不是「填个地址就行」

读 hub 的源码和实测行为，有三件事必须说清楚，否则接进去就是一堆 401：

| 参数 | 真实作用 | 不要误解成 |
| --- | --- | --- |
| `pwd` | 面板密码（默认 `admin`）。`POST /panel/login` 换一个 `X-Panel-Token`，之后所有管理接口带这个头 | 它不是 API Key：`Authorization: Bearer <面板 Token>` 一律 **401** |
| `tab` | 纯前端页签深链（`dashboard.html` 读 `?tab=`，白名单 `gateway/accounts/tasks/analytics/agents/settings/logs`） | 不是 API 参数，服务端不认 |
| `?pwd=admin` | 同上，只是面板自己的便利参数，服务端不处理 | 不代表鉴权已经完成 |

所以插件分两条腿走路：

1. **管理面**用 `pwd` 换面板 Token，读 `/health`、`/panel/status`、`/v1/models`、`/v1/balance-summary`、`/usage`、`/accounts`、`/settings`；
2. **对话面**必须有一个真正的 API Key（DSH 调 `/v1/chat/completions` 时走 `Authorization: Bearer`）。Key 的取法三级：配置里写了 `apiKey` → 写进 DSH 凭据库；凭据库里已有同名的 → 直接用；都没有 → 用面板 Token 读 `/settings` + `/settings/reveal?id=<keyId>` 取第一个启用的 Key。

拿不到 Key 时插件**不会**硬写一条注定 401 的路由，而是把「缺少 hub API Key」挂到告警里，等你填。

## 功能

- **连接面板**：服务地址、面板密码、默认页签、轮询间隔；「测试连接」「立即同步」「打开看板」「清空同步」。
- **模型同步**：把 `/v1/models` 写进 `llm-pi-ai` 的 `providers.workbuddy2api-hub`，每个模型带上 `contextWindow` / `maxTokens` / 图片输入 / 思考档位；按模型名称排序（不区分大小写、数字按数值），设置页表格与写进 DSH 的顺序一致。
- **增量与容错**：模型下架先进宽限期（默认 24 小时，可一键立即移除），回来能复活；内容没变就不写配置（`canonicalJson` 比较，避免每次轮询都触发一次 volatile 更新）；配置冲突（`SettingsConflictError`）自动重取 revision 重试。
- **余额与用量**：`/v1/balance-summary` 的 credit 余额，`/usage?range=today` 的请求数 / 失败数 / tokens / credit / API 等价花费 / 缓存命中。注意 hub 只认 `range`（`today`/`week`/`month`/`all`），`hours=` 会被静默忽略；侧边栏徽标第一行 `WorkBuddy` + 积分余额，第二行 `今日 49.9M · 45.57 · ¥7.21`、第三行 `本周 248.1M · 455.45 · ¥29.30`（窗口名贴左、三个数贴右，依次是 tokens / 积分 / API 等价；本周是日历周，周一起算），点一下直接打开 hub 看板（深链带 `pwd` 与 `tab`）。
- **告警**：连不上（连续失败到阈值）、密码错、登录被限流、缺 Key、额度低于阈值、账号需要重登、登录态过期——都能「知道了」消掉 24 小时。
- **不崩**：hub 没开、密码错、超时、返回 HTML、返回半截 JSON，插件都只把它变成一段中文提示；`/state` 永远返回 200，前端永远有东西可渲染。

## 安装

前置：Node.js ≥ 20（`node -v` 看一眼）、本地 `workbuddy2api-hub` 已经跑起来（默认 `http://127.0.0.1:8788`）、DSH 桌面端能正常打开。

**不需要 `npm install`**：本包没有运行时依赖（`@deepseek-ai/*` 全是 `peerDependencies`，由 DSH 自己提供），也没有打包步骤——`client/client.js` 就是可以直接加载的 `window.__ModuleLoader__` bundle。

```bash
# 1. 放到任意目录，例如 E:\DeepseekHarnessWorkspace\dsh-workbuddy2api-hub
git clone <本仓库地址> dsh-workbuddy2api-hub
cd dsh-workbuddy2api-hub

# 2. 先确认 hub 通不通（只读，不改任何东西）
node scripts/smoke-live.mjs

# 3. 挂进桌面端 profile（默认 ~/.dsh/profiles/desktop）
node scripts/install-local.mjs

# 4. 重启 DSH 桌面端
```

> 仓库里没有任何凭据：`pwd` 与 API Key 都在**你本机**的 DSH 设置页 / 凭据库里填写，不进代码、不进 git。

`install-local.mjs` 只做三件事，都可逆：在 profile 的 `package.json` 里加一条 `file:` 依赖、往 `dsh.profile.bundles` 追加一个名字、在 `node_modules/` 下建一个指向本仓库的链接（Windows 用 junction，不需要管理员）。改之前会备份 `package.json`，`--dry-run` 只看不做，`--uninstall` 原样退回。

重启后：**设置 → workbuddy2api-hub** → 确认地址/密码 → 「测试连接」→「立即同步」→ 模型出现在 **设置 → 模型** 里，provider 名 `workbuddy2api-hub`。

## 配置

改 profile 的 `cordis.patch.yml`（或本仓库的 `cordis.patch.yml` 作为默认值）。**只改配置就能换地址/密码，不用改代码**：

```yaml
- id: workbuddy-hub
  name: dsh-workbuddy2api-hub
  config:
    baseUrl: http://127.0.0.1:8788   # 换机器就改成 http://192.168.1.10:8788
    pwd: admin                        # 面板密码
    tab: gateway                      # 打开看板时落在哪个页签
```

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8788` | 服务地址。从浏览器地址栏整条粘进来也行（`?pwd=…&tab=…` 会被剥掉），缺协议自动补 `http://` |
| `pwd` | `admin` | 面板密码。只用于换 Token，不会被当成 API Key |
| `tab` | `gateway` | 深链页签，白名单外的值退回 `gateway` |
| `apiKey` | 空 | 可选。写了就存进 DSH 凭据库（引用名见 `apiKeyEnv`），不落状态文件 |
| `apiKeyEnv` | `WORKBUDDY2API_HUB_API_KEY` | DSH 凭据库里的引用名 |
| `providerEntry` | `llm-pi-ai` | 写到哪个 settings 的 ns 下 |
| `routeKey` | `workbuddy2api-hub` | 写进 `providers.<routeKey>`。**故意不叫 `wb`**，免得覆盖你已有的路由 |
| `intervalSeconds` | `120` | 轮询间隔，下限 30、上限 3600；连续失败会指数退避到 30 分钟 |
| `sync` | `true` | 关掉就只看数据、不写模型 |
| `autoApiKey` | `true` | 缺 Key 时是否允许从面板 `/settings/reveal` 自动取 |
| `newModelPolicy` | `select` | hub 上新出的模型默认勾选（`select`）还是先不写（`ignore`） |
| `retireHours` | `24` | 模型下架后的宽限期 |
| `thresholds.lowCredits` | `100` | 余额低于它就告警；`0` 关掉 |
| `thresholds.unreachablePolls` | `5` | 连续失败几次才报「连不上」 |
| `stateDir` | 空 | 状态文件目录。默认跟 profile 同级（`workbuddy2api-hub.json`），测试/便携场景可钉死 |

`baseUrl` / `pwd` / `tab` 三个字段用「显式字段指纹」判定：YAML 里改了值 → 覆盖状态；没改 → 保留你在设置页里最后改的值。所以「改配置即生效」和「UI 改动不被重启抹掉」不会打架。

## 错误处理

所有失败都走 `classifyFailure()` 折成一句话，写进 `lastError`，同时决定要不要出告警：

| 情况 | 面板上看到的 | 还会做什么 |
| --- | --- | --- |
| 服务没开 / 端口不通 | 连不上 hub（fetch failed）：确认本地服务已启动（默认 http://127.0.0.1:8788） | 冷启动 60 秒内每 15 秒重试，之后指数退避 |
| 8 秒没响应 | 连不上 hub（请求超时）：… | 同上 |
| 密码错 | 面板密码（pwd）不对：… | 出 `auth` 告警，不反复猛撞 |
| 60 秒内错 5 次 | 面板登录被限流，N 秒后再试 | 轮询间隔抬到 hub 建议的等待时间以上 |
| 404 | 服务版本可能与本插件不匹配（HTTP 404） | — |
| 5xx | hub 内部错误（HTTP 500） | — |
| 返回 HTML | 返回了非 JSON 内容 | — |
| 缺 API Key | 还没有可用的 hub API Key，暂不写入模型 | 出 `api-key` 告警，不写注定 401 的路由 |

`/state` 无论如何都是 200 + 一份完整快照，前端不会因为一次失败白屏。

## 插件接口

宿主侧注册一个前缀路由 `/workbuddy2api-hub/api`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/state` | 全量快照（含 `ETag`，前端带 `If-None-Match` 拿 304） |
| GET | `/usage?range=today` | 只刷用量（`range` 取 `today` / `week` / `month` / `all`） |
| GET | `/accounts` | 只刷账号 |
| GET | `/dashboard-url` | 看板深链（含 `pwd`），**只给本机** |
| POST | `/config` | 改地址/密码/页签/间隔/API Key |
| POST | `/selection` `/bulk` `/enable-new` | 勾选模型、全选/全不选、新模型默认策略 |
| POST | `/refresh` `/test` `/policy` `/dismiss` `/retire` `/clear` | 同步、探测、策略、消警、立即移除、清空同步 |

写接口有三道闸：只接受本机来源（`127.0.0.1`/`::1`/`::ffff:127.0.0.1`）、`sec-fetch-site` 必须是 `same-origin`/`none` 且 `Origin` 与 `Host` 一致、`content-type` 必须是 JSON。响应不带任何 CORS 头。这样同机网页用 `no-cors` 的简单请求也打不进写接口。

## 安全和隐私

- 面板密码存在 profile 的状态文件里（`workbuddy2api-hub.json`，需要重启后继续登录）——如果你不想让它落盘，就在设置页里每次手动填。
- API Key 只进 DSH 凭据库和内存，**绝不**写状态文件，也**绝不**出现在 `/state` 里（连掩码都不给）。
- `/dashboard-url` 会返回带 `pwd` 的深链，所以它只对本机开放。
- 插件不碰 hub 的写入接口，所有请求都是 GET + `/panel/login`。

## 开发

```bash
npm test                # 86 个测试，全部跑在假宿主 + 假 hub 上，不需要起 DSH
node scripts/mock-hub.mjs --port 8789   # 起一个假的 hub，用来手工点界面
node scripts/smoke-live.mjs --json      # 对真实 hub 做只读联调
```

- `lib/hub.js`：纯函数层（归一化、模型档案、汇总、退避、告警），没有网络、没有 cordis，测试覆盖最厚。
- `lib/index.js`：宿主插件（`name` / `apply`），`HubSession` 管登录与 Token，`HubRuntime` 管刷新与写配置。
- `client/client.js`：已构建的 ModuleLoader bundle（设置页分区 + 侧边栏徽标），测试用 `node:vm` 加载。
- `scripts/mock-hub.mjs`：复刻真实 hub 的鉴权语义（面板 Token 能读、Bearer 只认 API Key、60 秒 5 次失败 429）。

### 配色：只能用 `--dsw-alias-*`

UI 全部走 DSH 注册的主题令牌，不写死颜色——否则深色主题能看、浅色主题就成了「浅灰字 + 白底」：

| 用途 | 令牌 |
| --- | --- |
| 正文 / 标题 | `--dsw-alias-label-primary` |
| 次要文字、表头、提示 | `--dsw-alias-label-secondary` |
| 卡片边框、表格线 | `--dsw-alias-border-l1` / `--dsw-alias-border-l2` |
| 卡片 / 输入框 / 按钮底色 | `--dsw-alias-bg-layer-1` / `--dsw-alias-bg-layer-2` |
| 主色、成功、警告、错误 | `--dsw-alias-brand-primary` / `--dsw-alias-state-success-primary` / `--dsw-alias-state-warn-primary` / `--dsw-alias-state-error-primary` |

想确认当前 DSH 暴露了哪些令牌：`cordis_inspect_query platform=client provider=Theme method=listTokens`。
`tests/client.test.mjs` 里有两条测试盯着这件事（palette 必须全是 `--dsw-alias-*`、样式里不许出现写死的深色底）。

## 排错

**设置页没有这一块**：插件没加载。看 DSH 启动日志里有没有 `workbuddy-hub`；确认 `install-local.mjs` 之后重启过；确认 `~/.dsh/profiles/<profile>/node_modules/dsh-workbuddy2api-hub` 这个链接存在。

**面板显示「连不上 hub」**：先在浏览器打开 `http://127.0.0.1:8788/?pwd=admin&tab=gateway`。打不开就是服务没起，本插件只负责连，不负责启动。

**「还没有可用的 hub API Key」**：hub 的 `/settings` 里没有启用的 Key，或者你关了 `autoApiKey`。去 hub 的「设置 → API Key」建一个，或在插件设置页填进去。

**模型没出现在「设置 → 模型」**：看 `lastSyncError`；确认 `sync: true`；确认 provider 名是 `workbuddy2api-hub`（不是把你原来的 `wb` 覆盖了）。

**想彻底退回去**：`node scripts/install-local.mjs --uninstall`，重启 DSH。状态文件想一起删就 `rm ~/.dsh/profiles/<profile>/workbuddy2api-hub.json`。

## 许可

MIT。图标、模型清单、额度数据都来自你本地的 workbuddy2api-hub，本项目只是读它。
