# dsh-workbuddy2api-hub

[![CI](https://github.com/HimA6652/dsh-workbuddy2api-hub/actions/workflows/ci.yml/badge.svg)](https://github.com/HimA6652/dsh-workbuddy2api-hub/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-workbuddy2api-hub)](https://www.npmjs.com/package/dsh-workbuddy2api-hub)
[![node](https://img.shields.io/badge/node-20%20%7C%2022%20%7C%2024-informational)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

把本地跑的 [workbuddy2api-hub](https://github.com/ardeyouxipianyi/workbuddy2api-hub) 接进 DSH 桌面端：hub 上的模型直接出现在模型选择器里（带上下文窗口、图片输入、思考档位），侧边栏底部常驻一个徽标显示余额和今日/本周用量。

不用再手写 `cordis.patch.yml` 里那段 `providers` 配置，也不用在 hub 上新出模型之后手动改 yaml——插件每轮轮询自己写。

| | |
| --- | --- |
| 适用 workbuddy2api-hub | 1.x（实测 v1.7.x）。依赖的接口在「依赖的面板接口」一节 |
| 适用 DSH | 桌面端 profile。`@deepseek-ai/*` 全部是 `peerDependencies`，由 DSH 自己提供，不随包安装 |
| 与本项目的关系 | 客户端插件。只读 hub 的管理接口和 `/v1/models`，不调任何写入接口 |
| 运行时依赖 | 无。没有打包步骤，`client/client.js` 就是可直接加载的 `__ModuleLoader__` bundle |

---

## 它解决什么

读 hub 源码并实测之后，有三件事必须先说清楚，否则接进去就是一堆 401：

| 参数 | 真实作用 | 别当成 |
| --- | --- | --- |
| `pwd` | 面板密码（默认 `admin`）。`POST /panel/login` 换一个 `X-Panel-Token`，之后所有管理接口带这个头 | 不是 API Key。`Authorization: Bearer <面板 Token>` 一律 **401** |
| `tab` | 纯前端页签深链（`dashboard.html` 读 `?tab=`，白名单 `gateway/accounts/tasks/analytics/agents/settings/logs`） | 不是 API 参数，服务端不认 |
| `?pwd=admin` | 面板自己的便利参数 | 不代表鉴权已经完成，服务端不处理 |

所以插件分两条腿走路：

1. **管理面**用 `pwd` 换面板 Token，读 `/health`、`/panel/status`、`/v1/models`、`/v1/balance-summary`、`/usage`、`/accounts`、`/settings`；
2. **对话面**必须有一个真正的 API Key（DSH 调 `/v1/chat/completions` 时走 `Authorization: Bearer`）。取法三级：配置里写了 `apiKey` → 写进 DSH 凭据库；凭据库里已有同名引用 → 直接用；都没有 → 用面板 Token 读 `/settings` + `/settings/reveal?id=<keyId>`，取第一个启用的 Key。

拿不到 Key 时插件**不会**硬写一条注定 401 的路由，而是把「缺少 hub API Key」挂进告警，等你填。

## 安装

前置：Node.js ≥ 20；本地 `workbuddy2api-hub` 已启动，浏览器能打开 `http://127.0.0.1:8788`；DSH 桌面端能正常打开。

装好了 DSH CLI 的机器上一条命令（本包声明了 `dsh.bundle`，安装时不需要构建）：

```bash
dsh plugin --profile desktop add dsh-workbuddy2api-hub
```

然后重启 DSH。重启后进 **设置 → workbuddy2api-hub**，确认地址与密码 → 「测试连接」→「保存并刷新」，模型会出现在 **设置 → 模型**，provider 名 `workbuddy2api-hub`。

### 其他安装方式

从 npm 直接装进 profile（不登记 `dsh.profile.bundles`）：

```bash
cd ~/.dsh/profiles/desktop
npm i dsh-workbuddy2api-hub
```

或者克隆后用仓库里的安装脚本（会顺带登记 `dsh.profile.bundles`，更稳，也可 `--uninstall` 退回）：

```bash
git clone https://github.com/HimA6652/dsh-workbuddy2api-hub.git
cd dsh-workbuddy2api-hub
node scripts/smoke-live.mjs     # 先确认 hub 通不通（只读，不改任何东西）
node scripts/install-local.mjs  # 挂进 ~/.dsh/profiles/desktop
```

`install-local.mjs` 只做三件事，都可逆：在 profile 的 `package.json` 里加一条 `file:` 依赖、往 `dsh.profile.bundles` 追加一个名字、在 `node_modules/` 下建一个指向本仓库的链接（Windows 用 junction，不需要管理员权限）。改之前备份 `package.json`，`--dry-run` 只看不做。

自己维护索引源的话，把仓库地址加进 **设置 → 插件 → Discover → Index sources** 也行。

## 使用

### 模型同步

把 `/v1/models` 写进 `llm-pi-ai` 的 `providers.workbuddy2api-hub`，每个模型带上 `contextWindow` / `maxTokens` / 图片输入 / 思考档位。按模型名排序（不区分大小写、数字按数值），设置页表格与写进 DSH 的顺序一致。模型名后面直接带网关倍率（`GLM-5.1 ×0.79`），免费模型标 `Free`——倍率写不进名字，选择器里就看不见。

模型下架先进宽限期（默认 24 小时，可一键立即移除），回来能复活；内容没变就不写配置，避免每次轮询都触发一次配置更新；配置冲突自动重取 revision 重试。

### 多 key

网关里有几条 API Key 就同步几条 provider：一个 key ↔ 一条 provider 路由 ↔ 一条凭据引用。主 key 固定 `workbuddy2api-hub`，其余 `workbuddy2api-hub-<名字>`。

路由键建好就不再变，所以网关里改 key 的名字、换倍率，都不会让会话里已经选中的模型消失。网关里删掉某条 key → 那条路由自动撤掉；删掉的是主 key → 徽标显示「主 key 已删除」、会话提示重新选模型，**不会拿别的 key 偷偷顶替**。

每条 key 每轮都拉模型清单（实测与绑定账号数无关），设置页里各自一份模型开关，模型多的那几条默认收起，点卡片头上那行「账号 N · 模型 6/19」展开。同步那行的分子是**所有 key 启用模型的并集去重**（同一条模型被几条 key 都勾上只算一次），分母是网关给的模型总数。

### 侧边栏徽标

展开态三行：第一行是当前会话那条 key 的名字和「该 key 余额 / 整域余额」，第二行 `今日`、第三行 `本周`，右半边 `tokens / 积分 / 等价` 三列等宽右对齐。收起态是 `36×36` 圆形图标。

**数字跟着当前会话用的那条 key 走**：会话选的是 key-c 的模型，名字、余额和用量就都换成 key-c 的，切会话自动切。会话用的不是网关模型时回落主 key。

**点一下出副窗**：贴着徽标上沿弹出，内容是「各 key 用量」表（每条 key 一段「名字 + 账号 N」，再跟今日、本周两行，末尾 `总计`），上面两个格子是「这条 key 的余额」与「全部账号」，底部「打开面板」「关闭」。点遮罩或右上角 `×` 关闭。没有悬停提示，也不会一点就跳窗口。

所有数字两位小数（`72.30M`、`¥10.39`），全部来自网关：每条 key 的用量取 `/usage/analytics` 的按 API Key 分组（面板「用量明细 → 按 API Key」那张表），`总计` 取 `/usage` 的整域汇总。插件在本地只做两件事——保留两位小数、算 `errors / requests`。

余额拆不到 key 的只有 `/v1/balance-summary`（整域汇总），所以每条 key 的余额由后端拿 `/accounts` 里**这条 key 绑定的账号**求和得出（纯内存，不额外发请求）。账号没出现在 `/accounts` 里时显示 `—`，不报 0。

### 告警与容错

连不上、密码错、登录被限流、缺 API Key、额度低于阈值、账号需要重登——都能「知道了」消掉 24 小时。

hub 没开、密码错、超时、返回 HTML、返回半截 JSON，插件都只把它变成一段中文提示：`/state` 永远返回 200，前端永远有东西可渲染。

## 配置

改 profile 的 `cordis.patch.yml`（或本仓库的 `cordis.patch.yml` 作为默认值）。只改配置就能换地址/密码，不用改代码：

```yaml
- id: workbuddy-hub
  name: dsh-workbuddy2api-hub
  config:
    baseUrl: http://127.0.0.1:8788   # 换机器就改成 http://192.168.1.10:8788
    pwd: admin                        # 面板密码
    tab: gateway                      # 打开面板时落在哪个页签
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
| `maxKeys` | `10` | 最多同步几条网关 key（1–50）。超出的只读不写，避免一次刷出几十个 provider |
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

## 依赖的面板接口

插件对 hub 只发 GET 和 `POST /panel/login`：

| 接口 | 用途 |
| --- | --- |
| `POST /panel/login` | 用 `pwd` 换 `X-Panel-Token` |
| `GET /health` `/panel/status` | 探活、账号就绪数 |
| `GET /v1/models` | 模型清单（含倍率、上下文、思考档位） |
| `GET /v1/balance-summary` | 整域额度 |
| `GET /usage?range=` | 整域用量（`today` / `week` / `month` / `all`） |
| `GET /usage/analytics?range=` | 按 API Key 分组的用量 |
| `GET /accounts` | 账号清单（余额按 key 绑定的账号求和用） |
| `GET /settings`、`GET /settings/reveal?id=` | 缺 Key 时自动取用 |

### 插件对宿主暴露的接口

宿主侧注册一个前缀路由 `/workbuddy2api-hub/api`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/state` | 全量快照（带 `ETag`，前端用 `If-None-Match` 拿 304） |
| GET | `/usage?range=today` | 只刷用量（`range` 取 `today` / `week` / `month` / `all`） |
| GET | `/accounts` | 只刷账号 |
| GET | `/dashboard-url` | 面板深链（只带 `tab`），**只给本机** |
| POST | `/config` | 改地址 / 密码 / 页签 / 间隔 / API Key |
| POST | `/selection` `/bulk` `/enable-new` | 勾选模型、全选/全不选、新模型默认策略（带 `hubKeyId` 就只作用于那条 key） |
| POST | `/keys/selection` `/keys/sync-selection` | 单独改某条 key 的勾选 / 把一条 key 的勾选同步到别的 key |
| POST | `/keys/main` | 指定哪条 key 是主 key（只换身份，不改它已有的路由键） |
| POST | `/keys/pull` | 立刻重拉某条 key 的模型（排障用，60 秒节流） |
| POST | `/refresh` `/test` `/policy` `/dismiss` `/retire` `/clear` | 同步、探测、策略、消警、立即移除、清空同步 |

写接口有三道闸：只接受本机来源（`127.0.0.1` / `::1` / `::ffff:127.0.0.1`）、`sec-fetch-site` 必须是 `same-origin` 或 `none` 且 `Origin` 与 `Host` 一致、`content-type` 必须是 JSON。响应不带任何 CORS 头——同机网页用 `no-cors` 的简单请求也打不进写接口。

## 安全与隐私

- **API Key** 只进 DSH 凭据库和内存，不写状态文件，也不出现在 `/state` 里（连掩码都不给）。
- **面板密码**会明文存进 profile 的状态文件 `workbuddy2api-hub.json`——重启后要靠它继续登录。它只是 hub 的面板密码，不等于 API Key；如果 hub 用了别的重要密码，建议给面板单独设一个。
- **深链永远不拼密码**，只有 `?tab=`。原因很具体：hub 会把收到的请求行原样写进自己的 `logs/service.log`，`GET /?pwd=…` 因此会在磁盘上留一份明文。进面板手输一次，token 存在标签页里，同一标签页内不会再问。
- 插件对 hub 只做 GET 和 `/panel/login`。

## 已知限制

- **只连能直连的 hub。** `baseUrl` 换机器要自己保证网络可达，插件不做代理、不管启动。
- **面板密码是本机明文的**（见上）。介意的话给 hub 面板单独设一个不重要的密码。
- **余额与用量都受 hub 自己的统计窗口限制。** 今日/本周的切换点在网关那侧，插件不重新切；网关某个接口出错时那几格显示 `—`，不拿旧值冒充。
- **`/accounts` 里查不到的账号不计入余额**，只影响那条 key 的余额显示，不影响模型同步。
- **模型参数照抄上游。** `contextWindow` / `maxTokens` / 思考档位都以 `/v1/models` 给的值为准，插件不改写。
- **多 key 上限 `maxKeys`（默认 10）。** 超出的只读不写，避免一次在 DSH 里刷出几十个 provider。
- 桌面端与 Web 端共用一套 profile 机制，但本插件只在桌面端实测过。

## 排错

**设置页没有这一块**：插件没加载。看 DSH 启动日志里有没有 `workbuddy-hub`；确认装完之后重启过（宿主对 client bundle 是启动时快照，刷新页面拿不到新代码）；确认 `~/.dsh/profiles/<profile>/node_modules/dsh-workbuddy2api-hub` 这个链接存在。

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

下面这些命令要 clone 仓库才能用——npm 包里只有运行时代码（`lib/`、`client/`、`cordis.patch.yml`），`scripts/`、`tests/`、`docs/` 只在仓库里。

```bash
git clone https://github.com/HimA6652/dsh-workbuddy2api-hub.git
cd dsh-workbuddy2api-hub
npm test                                # 108 个测试，跑在假宿主 + 假 hub 上，不需要起 DSH
node scripts/mock-hub.mjs --port 8789   # 起一个假 hub，用来手工点界面
node scripts/smoke-live.mjs --json      # 对真实 hub 做只读联调
npm run check                           # 发布前自查
```

目录：

- `lib/hub.js`：纯函数层（地址归一化、模型档案、用量汇总、退避、告警），无网络、无 cordis，测试覆盖最厚。
- `lib/index.js`：宿主插件（`name` / `apply`）；`HubSession` 管登录与 Token，`HubRuntime` 管刷新与写配置。
- `client/client.js`：已构建的 ModuleLoader bundle（设置页分区 + 侧边栏徽标），测试用 `node:vm` 加载。
- `scripts/mock-hub.mjs`：复刻真实 hub 的鉴权语义（面板 Token 能读管理接口、Bearer 只认 API Key、60 秒 5 次失败返 429）。

改 UI 时注意：颜色一律用 DSH 注册的主题令牌 `--dsw-alias-*`（`label-primary`、`label-secondary`、`bg-layer-1/2`、`border-l1/l2`、`brand-primary`、`state-*`），不要写死色值——否则深色主题能看、浅色主题就成了「浅灰字压白底」。在哪能看到当前有哪些令牌：DSH 里打开开发者工具，看 `:root` 上的 CSS 变量。`tests/client.test.mjs` 里有测试盯着这件事。

调试出口、主题令牌清单、假 hub 复刻的鉴权语义、刷新退避规则、发版流程、市场收录模板都在 [docs/MAINTAINER.md](https://github.com/HimA6652/dsh-workbuddy2api-hub/blob/main/docs/MAINTAINER.md) —— README 这里只留使用者需要知道的部分。那份文档只在仓库里，不随 npm 包发出去。

### 与上游的关系

目录结构和「与 DSH 对接的方式」参照 [dsh-workbuddy2api-panel](https://github.com/jerry9692/dsh-workbuddy2api-panel)：宿主侧只碰 cordis 注入的服务，不 import 任何 `@deepseek-ai/*` 运行时包（各版本导出名会变）；前端是一个可被直接加载的 `window.__ModuleLoader__` bundle，没有打包步骤。

## 许可

MIT。图标、模型清单、额度数据都来自你本地的 workbuddy2api-hub，本项目只是读它。
