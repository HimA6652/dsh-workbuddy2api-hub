# dsh-workbuddy2api-hub

把本地跑的 [workbuddy2api-hub](https://github.com/ardeyouxipianyi/workbuddy2api-hub) 接进 DSH 桌面端。

装上之后：hub 上的模型会出现在 DSH 的模型列表里（带上下文窗口、图片输入、思考档位），侧边栏底部常驻一个徽标显示积分余额和今日/本周用量，设置页里多一块面板管连接。

```
本地 workbuddy2api-hub (:8788)  ←  X-Panel-Token  ─┐
      └─ /v1（OpenAI 兼容）      ←  Bearer Key ────┤
                                                    ├─→  本插件（DSH 宿主侧）
DSH 设置页 / 侧边栏  ←  /workbuddy2api-hub/api/*  ──┘        └─→  llm-pi-ai providers.workbuddy2api-hub
```

## 功能

- **连接面板**：服务地址、面板密码、默认页签、轮询间隔；「测试连接」「立即同步」「打开看板」「清空同步」。
- **模型同步**：把 `/v1/models` 写进 `llm-pi-ai` 的 `providers.workbuddy2api-hub`，每个模型带上 `contextWindow` / `maxTokens` / 图片输入 / 思考档位；按模型名称排序（不区分大小写、数字按数值），设置页表格与写进 DSH 的顺序一致。
- **增量与容错**：模型下架先进宽限期（默认 24 小时，可一键立即移除），回来能复活；内容没变就不写配置，避免每次轮询都触发一次配置更新；配置冲突自动重取 revision 重试。
- **余额与用量**：`/v1/balance-summary` 的 credit 余额，`/usage?range=today` 的请求数 / 失败数 / tokens / credit / API 等价花费 / 缓存命中。
- **侧边栏徽标**：展开态三行——`● WorkBuddy … 3715.39` / `今日 72.3M · 61.41 · ¥10.39` / `本周 260.7M · 465.43 · ¥31.17`；窗口名贴左、三个数字贴右，依次是 tokens / 积分消耗 / API 等价花费。悬停能看完整数字和连接地址，点一下直接打开 hub 看板。
- **告警**：连不上、密码错、登录被限流、缺 API Key、额度低于阈值、账号需要重登——都能「知道了」消掉 24 小时。
- **不崩**：hub 没开、密码错、超时、返回 HTML、返回半截 JSON，插件都只把它变成一段中文提示；`/state` 永远返回 200，前端永远有东西可渲染。

## 为什么不是「填个地址就行」

读 hub 的源码并实测之后，有三件事必须先说清楚，否则接进去就是一堆 401：

| 参数 | 真实作用 | 不要误解成 |
| --- | --- | --- |
| `pwd` | 面板密码（默认 `admin`）。`POST /panel/login` 换一个 `X-Panel-Token`，之后所有管理接口带这个头 | 它不是 API Key：`Authorization: Bearer <面板 Token>` 一律 **401** |
| `tab` | 纯前端页签深链（`dashboard.html` 读 `?tab=`，白名单 `gateway/accounts/tasks/analytics/agents/settings/logs`） | 不是 API 参数，服务端不认 |
| `?pwd=admin` | 同上，只是面板自己的便利参数，服务端不处理 | 不代表鉴权已经完成 |

所以插件分两条腿走路：

1. **管理面**用 `pwd` 换面板 Token，读 `/health`、`/panel/status`、`/v1/models`、`/v1/balance-summary`、`/usage`、`/accounts`、`/settings`；
2. **对话面**必须有一个真正的 API Key（DSH 调 `/v1/chat/completions` 时走 `Authorization: Bearer`）。Key 的取法三级：配置里写了 `apiKey` → 写进 DSH 凭据库；凭据库里已有同名的 → 直接用；都没有 → 用面板 Token 读 `/settings` + `/settings/reveal?id=<keyId>` 取第一个启用的 Key。

拿不到 Key 时插件**不会**硬写一条注定 401 的路由，而是把「缺少 hub API Key」挂到告警里，等你填。

## 安装

前置：

- Node.js ≥ 20（`node -v` 看一眼）
- 本地 `workbuddy2api-hub` 已经跑起来，浏览器能打开 `http://127.0.0.1:8788`
- DSH 桌面端能正常打开

**不需要 `npm install`**：本包没有运行时依赖（`@deepseek-ai/*` 全是 `peerDependencies`，由 DSH 自己提供），也没有打包步骤——`client/client.js` 就是可以直接加载的 `window.__ModuleLoader__` bundle。

最快的一条路是从 npm 装（装进 profile，不用 clone）：

```bash
cd ~/.dsh/profiles/desktop
npm i dsh-workbuddy2api-hub
```

然后重启 DSH 桌面端。想用仓库里的安装脚本（会同时登记 `dsh.profile.bundles`，更稳）就走下面三步：

```bash
# 1. 克隆到任意目录
git clone https://github.com/HimA6652/dsh-workbuddy2api-hub.git
cd dsh-workbuddy2api-hub

# 2. 先确认 hub 通不通（只读，不改任何东西）
node scripts/smoke-live.mjs

# 3. 挂进桌面端 profile（默认 ~/.dsh/profiles/desktop）
node scripts/install-local.mjs

# 4. 重启 DSH 桌面端
```

重启后：**设置 → workbuddy2api-hub** → 确认地址/密码 → 「测试连接」→「立即同步」→ 模型出现在 **设置 → 模型** 里，provider 名 `workbuddy2api-hub`。

`install-local.mjs` 只做三件事，都可逆：在 profile 的 `package.json` 里加一条 `file:` 依赖、往 `dsh.profile.bundles` 追加一个名字、在 `node_modules/` 下建一个指向本仓库的链接（Windows 用 junction，不需要管理员权限）。改之前会备份 `package.json`；`--dry-run` 只看不做，`--uninstall` 原样退回。

仓库里没有任何凭据：`pwd` 与 API Key 都在**你自己机器**上填，不进代码、不进 git。

### 其他安装方式

装好了 DSH CLI 的机器上，也可以直接让它从 GitHub 拉（本包声明了 `dsh.bundle`，安装时不需要构建）：

```bash
dsh plugin --profile desktop add github:HimA6652/dsh-workbuddy2api-hub
```

自己维护索引源的话，把仓库地址加进 **设置 → 插件 → Discover → Index sources** 也可以。

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
| `stateDir` | 空 | 状态文件目录。默认跟 profile 同级（`workbuddy2api-hub.json`） |

`baseUrl` / `pwd` / `tab` 三个字段按「显式字段指纹」判定：YAML 里改了值就覆盖状态，没改就保留你在设置页里最后改的值——所以「改配置即生效」和「UI 改动不被重启抹掉」不会打架。

## 错误处理

所有失败都折成一句话写进 `lastError`，同时决定要不要出告警：

| 情况 | 面板上看到的 | 还会做什么 |
| --- | --- | --- |
| 服务没开 / 端口不通 | 连不上 hub（fetch failed）：确认本地服务已启动（默认 http://127.0.0.1:8788） | 冷启动 60 秒内每 15 秒重试，之后指数退避 |
| 8 秒没响应 | 连不上 hub（请求超时） | 同上 |
| 密码错 | 面板密码（pwd）不对 | 出 `auth` 告警，不反复猛撞 |
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
| GET | `/state` | 全量快照（带 `ETag`，前端用 `If-None-Match` 拿 304） |
| GET | `/usage?range=today` | 只刷用量（`range` 取 `today` / `week` / `month` / `all`） |
| GET | `/accounts` | 只刷账号 |
| GET | `/dashboard-url` | 看板深链（含 `pwd`），**只给本机** |
| POST | `/config` | 改地址 / 密码 / 页签 / 间隔 / API Key |
| POST | `/selection` `/bulk` `/enable-new` | 勾选模型、全选/全不选、新模型默认策略 |
| POST | `/refresh` `/test` `/policy` `/dismiss` `/retire` `/clear` | 同步、探测、策略、消警、立即移除、清空同步 |

写接口有三道闸：只接受本机来源（`127.0.0.1` / `::1` / `::ffff:127.0.0.1`）、`sec-fetch-site` 必须是 `same-origin` 或 `none` 且 `Origin` 与 `Host` 一致、`content-type` 必须是 JSON。响应不带任何 CORS 头——这样同机网页用 `no-cors` 的简单请求也打不进写接口。

## 安全与隐私

- **API Key** 只进 DSH 凭据库和内存，**绝不**写状态文件，也**绝不**出现在 `/state` 里（连掩码都不给）。
- **面板密码**会存进 profile 的状态文件 `workbuddy2api-hub.json`（明文，重启后要靠它继续登录）。它只是 hub 的面板密码，不等于 API Key；如果你的 hub 用了别的重要密码，建议给面板单独设一个。
- `/dashboard-url` 会返回带 `pwd` 的深链，所以它只对本机开放。
- 插件对 hub 只做 GET 和 `/panel/login`，不碰任何写入接口。

## 排错

**设置页没有这一块**：插件没加载。看 DSH 启动日志里有没有 `workbuddy-hub`；确认装完之后重启过；确认 `~/.dsh/profiles/<profile>/node_modules/dsh-workbuddy2api-hub` 这个链接存在。

**插件列表里显示「异常」「包不可用」**：那个链接指着的地方没了。最常见的原因是 profile 的依赖被写成了一个临时目录（例如 `.../tmp/...`），临时目录一清就断。看一眼：

```bash
node -e "const p=require(process.env.HOME+'/.dsh/profiles/desktop/package.json');console.log(p.dependencies['dsh-workbuddy2api-hub'])"
ls -l ~/.dsh/profiles/desktop/node_modules/dsh-workbuddy2api-hub
```

依赖应当指向仓库或已发布包的目录；指到 `tmp/` 之类的路径就重跑一次 `node scripts/install-local.mjs`（**必须从仓库根目录跑**，脚本会拒绝从 `node_modules/` 或 `tmp/` 下的副本执行），然后重启 DSH。

**面板显示「连不上 hub」**：先在浏览器打开 `http://127.0.0.1:8788`。打不开就是服务没起——本插件只负责连，不负责启动。

**「还没有可用的 hub API Key」**：hub 的 `/settings` 里没有启用的 Key，或者你关了 `autoApiKey`。去 hub 的「设置 → API Key」建一个，或在插件设置页填进去。

**模型没出现在「设置 → 模型」**：看 `lastSyncError`；确认 `sync: true`；确认 provider 名是 `workbuddy2api-hub`（没有把你原来的 `wb` 覆盖掉）。

**想彻底退回去**：`node scripts/install-local.mjs --uninstall`，重启 DSH。状态文件想一起删就删 `~/.dsh/profiles/<profile>/workbuddy2api-hub.json`。

## 开发

```bash
npm test                                # 87 个测试，跑在假宿主 + 假 hub 上，不需要起 DSH
node scripts/mock-hub.mjs --port 8789   # 起一个假 hub，用来手工点界面
node scripts/smoke-live.mjs --json      # 对真实 hub 做只读联调
npm run check                           # 确认没有把凭据/本机路径写进仓库
```

目录：

- `lib/hub.js`：纯函数层（地址归一化、模型档案、用量汇总、退避、告警），无网络、无 cordis，测试覆盖最厚。
- `lib/index.js`：宿主插件（`name` / `apply`）；`HubSession` 管登录与 Token，`HubRuntime` 管刷新与写配置。
- `client/client.js`：已构建的 ModuleLoader bundle（设置页分区 + 侧边栏徽标），测试用 `node:vm` 加载。
- `scripts/mock-hub.mjs`：复刻真实 hub 的鉴权语义（面板 Token 能读管理接口、Bearer 只认 API Key、60 秒 5 次失败返 429）。

改 UI 时注意：颜色一律用 DSH 注册的主题令牌 `--dsw-alias-*`（`label-primary`、`label-secondary`、`bg-layer-1/2`、`border-l1/l2`、`brand-primary`、`state-*`），不要写死色值——否则深色主题能看、浅色主题就成了「浅灰字压白底」。在哪能看到当前有哪些令牌：DSH 里打开开发者工具，看 `:root` 上的 CSS 变量。`tests/client.test.mjs` 里有两条测试盯着这件事。

改代码需要的细节（调试出口、主题令牌清单、假 hub 复刻的鉴权语义、刷新退避规则、发版流程、市场收录模板）都在 [docs/MAINTAINER.md](docs/MAINTAINER.md) —— README 这里只留使用者需要知道的部分。

### 与上游的关系

目录结构和「与 DSH 对接的方式」参照 [dsh-workbuddy2api-panel](https://github.com/jerry9692/dsh-workbuddy2api-panel)：宿主侧只碰 cordis 注入的服务，不 import 任何 `@deepseek-ai/*` 运行时包（各版本导出名会变）；前端是一个可被直接加载的 `window.__ModuleLoader__` bundle，没有打包步骤。

## 许可

MIT。图标、模型清单、额度数据都来自你本地的 workbuddy2api-hub，本项目只是读它。
