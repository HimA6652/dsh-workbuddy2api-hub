# 维护者笔记

README 面向使用者（装、配、排错）。这里放**改代码时才会用到**的东西：调试入口、主题令牌、假 hub 的语义、刷新退避的实现细节、发版流程、市场收录步骤。

本机相关的路径、端口、备份清单不写在这里 —— 那些在仓库外的 `NOTES.local.md`（已被 `.gitignore` 忽略）。

## client/client.js 的调试出口

bundle 末尾挂了一串 `exports.__*`，只为测试和手工排查用，宿主不依赖它们：

| 出口 | 用途 |
| --- | --- |
| `__store` | 模块内的发布订阅 store：`get()` / `subscribe(fn)` / `start()` / `reload()` / `set(snapshot)` / `fail(message)` |
| `__apiPath(path)` | 拼出插件接口的真实路径（会带上 `document.baseURI` 的部署前缀） |
| `__requestJson` | HTTP 封装：超时、304 复用、非 JSON 容错 |
| `__dicts` | `{ zh, en }` 两套字典，测「两种语言键集合一致」 |
| `__palette` / `__styles` | 主题令牌与样式对象，测「不许写死颜色」 |
| `__HubPanel` / `__HubFooter` | 两个 React 组件本体，可直接调用拿元素树 |
| `__sortRowsByName` / `__footerSummary` | 表格排序与徽标取值（含 `—` 兜底） |
| `__css` / `__injectStyles()` | 插件自己那套 CSS 与注入函数（注入是幂等的，重复调用不会插第二份 `<style>`） |
| `__HubGlyph` / `__HubOverlay` | 徽标图标（内联 SVG）与**副窗外壳**：`{ open, onClose, anchor, title, closeLabel }`，`anchor` 是点击时 `getBoundingClientRect()` 现算出来的 `{ left, bottom }`。**不再用宿主 `Modal`**——它是居中模态，会压住整个侧边栏；这里要的是从底栏长出来的轻量副窗，点遮罩或 `×` 关闭 |
| `__keyFoldOpen` | 折叠默认值：没点过按 `isMain`（主 key 摊开、其余收起），点过照表里记录 |
| `__realmText` / `__apiKeySourceText` | 概览两格的中文口径（`cn` → 国内版、`credentials` → 凭据库…），值抄的是网关界面自己的叫法 |
| `__syncedModelCount` | 同步行那个分子：遍历 `keys[].models` 按 `id` 收进 `Set`，取**所有 key 启用模型的并集**。`enabled:false` 与 `retired:true` 不算；拿不到 `models` 才回落 `snapshot.lastSyncCount`。**别改回 `lastSyncCount`**——那是 `syncRoutesToDsh()` 里 `count += routeModels.length` 逐条累加，同一条模型被几条 key 勾上会重复计 |
| `__keyListOf` / `__keyByProvider` / `__mainKeyOf` / `__balanceLines` | key 列表、按 providerId 找 key、主 key、余额行的取值函数 |
| `__providerSnapshot` / `__setProviderState` / `__attachProviderSource` | 当前会话 provider 的模块内状态，测「切会话时徽标跟着换数」用 |

测试里用 `node:vm` 把 `client.js` 丢进 `runInNewContext`，沙箱只需补 `URL` / `URLSearchParams` / `document` / `fetch` / 定时器 / `AbortSignal`。假 React 的 `createElement` 返回 `{ type, props, children }`，所以 `__HubFooter({ t, wide: true })` 能直接断言行结构和文案，不用起浏览器。

几处踩过的坑：

- **假 React 要有 `Fragment`**：`__HubFooter` 返回的是 `h(react.Fragment, null, badge, overlay)`，沙箱漏了 `Fragment` 会得到 undefined type。
- **断言 children 数量前先过滤 `null`**：`h('div', p, a, b, cond ? c : null)` 会产生 `null` 项（徽标收起态就是 `[glyph, null]`）。
- **断言整行文字要先展平**：`node.children.join('')` 对嵌套节点只能得到 `[object Object]`，得写个递归 `flatten()` 再 `join('')`。

## 数字从哪来（别自己造）

徽标与副窗里每个数都能指回一个上游字段，改代码时别在这里加聚合：

| 显示位置 | 上游来源 | 本地做了什么 |
| --- | --- | --- |
| 徽标第一行「该 key 余额 / 总余额」 | 左：`keys[].balance.remain`（`keyProjections()` 里 `mainKeyBalance(this.accountsRaw, key.accounts)` 求和）；右：`balance.balance`（`/v1/balance-summary` 整域） | 两位小数；账号不在 `/accounts` 里给 `null`，前端画 `—`，**不报 0** |
| 徽标「今日 / 本周」、副窗每条 key 那两行 | `/usage/analytics?range=` 的 `keys[].window`：`requests / errors / prompt_tokens / completion_tokens / total_tokens / credit / cost_cny`（= 面板「用量明细 → 按 API Key」那张表） | `round2` 两位小数；`errorRate = errors / requests` |
| 副窗「总计」 | `/usage?range=` 的整域汇总（`summarizeUsage`，= 面板「数据看板」顶部那行） | 两位小数 |
| 概览「已同步 N/M 模型」 | 分子 `syncedModelCount()`（各 key `models` 的并集去重）、分母 `snapshot.counts.total` | 去重计数 |
| 概览「额度 / 已启用 / 平均倍率 / 账号」 | `balance.balance`、`counts.enabled`、`averageRate`、`accounts.enabled/total` | 四位里只有倍率是网关给的原始浮点 |

实测（几条 key 绑的账号互不重叠）：各 key 的 `window` 相加与整域**三项差都是 0**，
所以「总计」直接取整域、不自己求和。哪天网关允许一个账号挂到多条 key 上，这里就会不等
——那时以整域（面板顶部那行）为准。

## 配色：只能用 `--dsw-alias-*`

DSH 注册的主题令牌都在 `--dsw-alias-*` 前缀下（旧版本教程里常见的 `--dsh-*` 在本机 0.2.1-rc.2 上并不存在）。`var()` 取不到变量时会静默退到兜底值，于是「深色主题写好的浅灰兜底」在浅色主题下就成了浅灰字压白底——踩过一次。

| 用途 | 令牌 |
| --- | --- |
| 正文 / 标题 | `--dsw-alias-label-primary` |
| 次要文字、表头、提示 | `--dsw-alias-label-secondary` |
| 更淡的占位文字 | `--dsw-alias-state-idle-primary` |
| 卡片边框、表格线 | `--dsw-alias-border-l1` / `--dsw-alias-border-l2` |
| 卡片 / 输入框 / 按钮底色 | `--dsw-alias-bg-layer-1` / `--dsw-alias-bg-layer-2` |
| 主色 | `--dsw-alias-brand-primary` |
| 成功 / 警告 / 错误 | `--dsw-alias-state-success-primary` / `-warn-` / `-error-primary` |

想看某个 DSH 版本实际注册了哪些令牌（DSH 内置的只读 inspect 工具）：

```bash
cordis_inspect_query platform=client provider=Theme method=listTokens
```

`tests/client.test.mjs` 有两条测试盯着这件事：palette 的每个值必须是 `var(--dsw-alias-*, 兜底)`，且剥掉兜底后样式里不许出现写死的 `rgba(255,255,255…)` / `rgba(0,0,0…)` 底色。

同理，两个插槽的注册情况也可以直接查：

```bash
cordis_inspect_query platform=client provider=Slots method=listSubTree
```

## 假 hub 复刻了哪些真实语义

`scripts/mock-hub.mjs` 不是随便返回 JSON，它复刻的是真实 hub 的鉴权行为——这些正是最容易写错的地方：

- 面板 Token（`X-Panel-Token`）能读所有管理接口，**但不能当 Bearer 用**：`Authorization: Bearer <panel token>` 一律 401。所以「拿 pwd 当 API Key」这条路走不通，`/v1` 必须有真 API Key。
- 60 秒内 5 次登录失败返回 429，带建议等待秒数。
- `/health` 恒返回 `api_key_required: true`（真实 hub 该字段表达的是「`/v1` 需要 Key」，与配了几把无关）。
- `/usage` 只认 `range` / `since` / `until`，`hours` 被静默忽略（我们曾照着直觉发 `?hours=24`，实际拿到的是全量历史）。
- `/settings/reveal?id=` 是唯一能拿到明文 Key 的接口，缺 `id` 就 404。
- 控制端点 `/mock/state`、`/mock/reset`、`/mock/models/remove`、`/mock/models/add`、`/mock/credits`、`/mock/keys`，用来在测试里模拟「模型下架」「额度见底」；flags：`--port --password --fail-auth --no-api-key --empty --no-panel-auth --slow --quiet`。

## 刷新与退避

- 宿主每 `intervalSeconds`（默认 120，允许 30–3600）打一轮：`/health` → `/panel/status` →（需要则 `/panel/login`）→ `/v1/models` → `/v1/balance-summary` → `/usage?range=today` → `/usage?range=week` → `/accounts`。
- 连续失败退避（`lib/hub.js` 的 `pollIntervalMs`）：`基础值 × 2^失败次数`，最多翻 5 次、上限 1800 秒；刚启动 60 秒内的失败按 ≤15 秒快试；429 时把 hub 建议的等待当作下限。
- 用递归 `setTimeout` 而不是 `setInterval`：改间隔立刻生效，且上一轮没跑完不会叠请求。定时器都 `.unref()`，不拖住进程退出。
- 前端每 15 秒读一次插件 `/state`（`ETag` + `If-None-Match`，304 就复用上一份），标签页在后台（`document.hidden`）时跳过。
- 徽标是「缓存视图」：最旧数据 = `intervalSeconds` + 15 秒。要秒级实时就点开面板，它自己 5 秒刷一次。

## 发版

```bash
# 1. 先把这一版改了什么写进 CHANGELOG.md 的 `## [1.1.0]` 一节
# 2. 一条命令走完
npm run release 1.1.0
```

`scripts/release.mjs` 依次做：校验版本格式 → 确认 CHANGELOG 有该节 → 工作区必须干净 → 必须在 `main` → 标签不能重名 → 改 `package.json` 与 `tests/host.test.mjs` 的 `PLUGIN_VERSION` 断言 → 跑 `check-secrets` → 预演 Release 正文 → `npm test` → 查 npm 登录态与版本号有没有被占 → `npm publish` → 提交 `chore(release): vX` → `tag -a` → 推 main 与标签。

**一条命令同时落到 npm 和 GitHub Release**。npm 那步失败会直接停下，不会留下「GitHub 有标签、npm 没版本」的半成品；正常走完时 GitHub 那边再等 Actions 跑半分钟。

`--dry-run` 只跑到测试为止（不发 npm、不提交）；`--no-publish` 只发 GitHub；`--no-push` 提交并打标签但不推。

**版本号只让这个脚本改**。手改 `package.json` 里的 `version` 再把改动提上去，会得到一个「有版本号、没标签、没 Release、npm 上也没有」的幽灵版本（1.0.8 与 1.0.9 就这么漏掉的，后来补打了标签）。

**标签一推，Release 自己出现**（`.github/workflows/release.yml`）：Actions 先跑测试，再用 `gh release create` 建 Release，正文来自 `scripts/release-notes.mjs`（CHANGELOG 那一节 + 自动追加的安装段）。用的是 Actions 自带的 `GITHUB_TOKEN`，不需要配任何 secret。只想要正文：

```bash
node scripts/release-notes.mjs v1.1.0 > notes.md
```

## 发布到 npm

`npm run release 1.1.0` 已经把 npm 一起发了，不用再单独 `npm publish`。手动发也不会漏自检：`prepublishOnly` 里挂着 `check-secrets` + 全部测试。

两个坑值得记下（都是 npm 11 的行为，不是本仓库的 bug）：

1. **没有 2FA 的请求发不出去**。用网页登录（`npm login --auth-type=web`）拿到的会话 token 会直接 403：`Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages`。解决办法是在 npmjs.com 建一个 **Granular Access Token**，勾上 **Bypass 2FA**，权限给 Read and write。
2. **首次发布一个新包名会走「暂存发布」**。上传后 registry 先只出现一个占位版本 `0.0.0-stage`（描述是 *Temporary package placeholder for staged publishing*），真正的 `1.0.7` 在后台处理，约几分钟后 `dist-tags.latest` 才指过去。这段窗口里 `npm view` 和包页都可能还是 404，**别以为失败了又重复发**——重复发会得到 `You cannot publish over the previously published versions: 1.0.7`，那反而是「已经上去了」的证据。

查发布结果：

```bash
npm view dsh-workbuddy2api-hub version dist.tarball
curl -s https://registry.npmjs.org/dsh-workbuddy2api-hub | # 看 dist-tags 与 versions
npm pack dsh-workbuddy2api-hub@x.y.z --pack-destination tmp/ && tar -tzf tmp/*.tgz | sort
```

`files` 白名单决定包里有什么：`lib/`、`client/`、`cordis.patch.yml`、README / CHANGELOG / LICENSE，共 8 个文件、约 60 kB。`scripts/`（安装脚本、假 hub、发版脚本）、`tests/`、`docs/`（包括这份笔记）、`.github/` 都只在仓库里——装插件的人用不到，发出去只是让每次 `npm i` 多下一次。

`package.json` 本身一定会进包，所以里面的 `scripts` 字段（`test` / `mock` / `release` 等）在装了包的人眼里是存在的、但文件不在——这些命令只在仓库里跑得动，属于开发用。装一遍验证最实在：

```bash
mkdir -p tmp/verify && cd tmp/verify && npm i dsh-workbuddy2api-hub
node -e "import('dsh-workbuddy2api-hub').then(m=>console.log(m.name, m.constants.PLUGIN_VERSION))"
```

## 插件市场收录

dsh-market 的「发现插件」读的是人工策展目录 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)（`https://awesome-dsh-plugin.com/plugins.json`）。**发布到 GitHub ≠ 能在市场里搜到**，中间隔一次 PR 收录。

门槛（据其 `contributing.md`）：

- `package.json` 声明 `dsh.bundle`，仓库根有 `cordis.patch.yml`（本仓库都有，只声明 `dsh.client` 会被拒）；
- 仓库里是真实可用的代码，不是占位、不是只列依赖的聚合包；
- **仓库创建满 1 天**（CI 自动查；本仓库建于 `2026-10-24 14:41 +0800`，即 10-25 14:41 之后才达标）；
- 仓库加 GitHub topic `dsh-plugin`；
- 描述**必须与代码一致**且不带营销词——夸大是主要打回原因；
- 单开一个 PR，只加**一个文件** `data/plugins/<owner>__<repo>.yml`，同时最多 3 条；README 由脚本生成，禁手改。

条目原文存在 [`market-entry.yml`](market-entry.yml)，四个字段：`url` / `name` / `category` / `description.en`（`description.zh` 可选）。
**没有 `npm:` 字段**——模板里没这个键，npm 信息由站点自己探测。描述里出现 `: `（冒号+空格）要整段加引号，否则 YAML 解析失败。

可选字段：`icon`（GitHub 托管的 png/jpg/jpeg/webp，约 96px 显示）、`tarball`（GitHub Release 的 https `.tgz`；用 `releases/latest/download/<无版本文件名>`，文件名带版本会在下次发版后 404）。
另推荐在仓库根放 `screenshots.json`（1–8 张，路径相对该文件），市场详情页会像 App Store 一样展示。

CI 依次检查：条目数 ≤3 → 抓 `package.json` 验 `dsh.bundle` → 仓库年龄 ≥1 天 → `awesome-lint` 与站点构建（双语一致、分隔符、日期、截图）。失败会在 PR 里指名要改什么，同一分支推修复即可。

提交前先在 `plugins.json` 里搜一下近邻条目（`curl -s https://awesome-dsh-plugin.com/plugins.json | grep -o 'workbuddy[a-z0-9-]*' | sort -u`）。写这条时已有的近邻：

| 条目 | 它做什么 | 与本条的区别 |
| --- | --- | --- |
| `jerry9692/dsh-workbuddy2api-panel` | 读 workbuddy2api-**panel** 的接口同步模型 + 侧边栏额度 | 上游是另一个项目（panel）；本条的 `/panel/login` 换 token、`/usage?range=` 日历周口径、API 等价花费都不在那边 |
| `tearslee/dsh-workbuddy2api` | 托管 workbuddy2api 网关进程并注册模型 | 它管进程、只注册模型；本条不启停网关，另外做面板鉴权与用量徽标 |
| `Yhx888/dsh-free-egg-credits` | 侧边栏看 WorkBuddy/Qoder **账号**积分与签到 | 本条看的是网关**用量**（tokens/积分/API 等价花费），不是账号余额与签到 |

规则里「已覆盖」是平局排序依据、不是既得利益，且分叉只要维护得更好或确实多做了事就可以收录；但描述必须只写真实存在的差异。

## 改代码时的三个坑

- **宿主侧 `lib/*.js` 改完必须重启 DSH**：`cordis-plugin-loader` 用裸 `await import(pkg)`，没有 cache-busting，ESM 缓存会一直给旧模块。
- **`client/client.js` 改完，没开 HMR 就得重启 DSH**：`dsh-client-modules` 在 `reconcilePackage()` 里把 bundle 和 baseline 读进内存，`rev`（mtime/ctime/size 算出的 12 位 hash）也在那一刻定死；HTML 引用的是 `plugins/??<pkg>/client.js&rev=<启动时rev>`，响应头带 `public, max-age=31536000, immutable`。`rebuilt(id)` 是 HMR watch 的注册钩子——**没有 watcher 在跟，就不会有第二次读取**，刷新页面拿到的还是启动时那份。本机实测过：改完刷新页面看不到任何变化，重启才生效。装了 `dsh-client-hmr` 并在 watch 下跑，才会走「重新发布 bundle → 新 `rev`」那条路。
- **`package.json` 的 `scripts` 里别出现 `install` / `postinstall` / `prepublish`**：`install` 是 npm 的生命周期钩子，别人 `npm i` 你这个包时会被自动执行——我们最早那个 `"install": "node scripts/install-local.mjs"` 就因此把**装包人的 profile 依赖**改指向了包自身所在的临时目录，插件列表直接显示「异常 / 包不可用」。安装脚本现在叫 `npm run link`。
