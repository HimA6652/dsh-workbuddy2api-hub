# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。

## [1.2.2] - 2026-10-25

维护版本：文案与措辞清理，行为与 1.2.1 完全一致，只动了文档。

## [1.2.1] - 2026-10-25

维护版本。

### 调整

- **主 key 的认领只看凭据，不看名字。** 原来的顺序是「凭据明文比对 → 按 key 名认领 → 第一条启用」，
  中间那步在别人的机器上并不存在。现在只留「凭据明文比对（升级用户原本在用的那条）→ 第一条启用」。
  顺带堵掉一个隐患：名字是用户随时能改的自由文本，拿它当身份，会出现「改了名字主 key 就换人」。
- **文档、mock 与测试夹具的样例数据统一命名规范。** key 名统一写成 `key-a` / `key-b` / `key-c`，
  标识写成 `0000000000a1` / `0000******00a1`，金额与账号数用虚构值，示例与断言跟着调整。

### 修掉

- **发版脚本在干净工作树上会中断。** `git add -A` 之后如果没有任何改动，`git commit` 会失败，
  把后面的打标签与推送一起带走。现在先判空，空则跳过提交、标签与推送照常走。
- **发版脚本认不出正则写法的版本断言。** `tests/host.test.mjs` 的 `PLUGIN_VERSION` 断言已改成正则，
  脚本原来只认字面量、找不到就报错，现在识别并跳过改写。

### 没变

- 运行时行为、接口、配置项、包体积（仍是 8 个文件）都没动；`npm test` 108 个测试全绿。

## [1.2.0] - 2026-10-25

侧边栏徽标与设置页改造：徽标改成点开弹窗，模型清单并进各自的 key。

### 侧边栏徽标

- 嵌入方式对齐 `dsh-token-usage-stats`：一条 `font:inherit` 的 root 按钮，取色全走
  `--dsw-alias-*` 令牌；宽态 `36px` 高、带文字，收起态 `36×36` 圆形只留图标。
  图标是内联 SVG，`fill: currentColor`，跟着 hover 一起变亮。
- 徽标本身排三行：第一行「当前会话那条 key 的名字 + 该 key 余额 / 整域余额」，第二行
  `今日`、第三行 `本周`，右半边是 `tokens / 积分 / 等价` 三列；三列等宽
  （`grid-template-columns` 三个 `minmax(…,1fr)` + `justify-items: end`），同一个指标
  在所有位置占同一列，切 key 时数字不会左右跳。
- 余额跟着会话走：`keys[]` 每条新增 `balance`——后端拿 `/accounts` 里这条 key 绑定的账号
  `credits.remain` 求和（纯内存，不额外发请求）；账号不在 `/accounts` 里时给 `null`，
  不瞎报 0。会话用的不是网关模型时回落主 key。
- **不再用 `title` 做悬停提示**（原来那是一段 `\n` 拼接的多行文本）。改成点击弹出一个
  **贴着徽标上沿的副窗**（`position: fixed`，位置由 `getBoundingClientRect()` 现算），
  点遮罩或右上角 `×` 关闭；不再用宿主的居中 `Modal`，也不再从徽标直接跳浏览器窗口。
- 副窗内容是「各 key 用量」表：列标题 `tokens / 积分 / 等价`，每条 key 一段（名字 + `账号 N`）
  再跟 `今日`、`本周` 两行，末尾一行 `总计`；上方两个格子放「这条 key 的余额」与
  「全部账号」，底部是「打开面板」「关闭」。原来弹窗里那两块今日/本周已删（徽标上已经有了）。
- **全部数字都是网关原样给的，本地只做两件事**：换算成两位小数、算 `errors / requests` 的成功率。
  每条 key 的 `requests / tokens / credit / cost_cny` 来自 `/usage/analytics` 里网关按 API Key
  分好的 `window`（就是面板「数据看板 → 用量明细 → 按 API Key」那张表），「总计」直接取
  `/usage` 的整域汇总（面板顶部那行）。2026-10-25 实测三条 key 的 window 相加与整域
  tokens / credit / ¥ 差都是 0，两种口径等价，所以不自己求和、网关给什么显示什么。
- 徽标第一行那串「该 key 余额 / 总余额」与下面两行数字同一套字体：11px、`label-tertiary`、
  等宽 + `tabular-nums`，只把字重降回常规。
- 数字统一两位小数：`72.30M`、`1.20k`、`¥10.39`、`2841.06`；k/M/B 缩写保留尾零，
  三位数以下也补 `.00`（`999.00`），整列才对得齐。
- 样式改成一次性注入 `<style data-plugin-css="dsh-workbuddy2api-hub/client.js">`，与参考插件
  同一套做法（幂等，重复 `apply` 不会插第二份）。
- 装了别的 footer 插件时不会跟它挤成一人一半：徽标带 `order: 9999`（`sidebar.footer.action`
  是按 order 升序渲染的 list 槽），再让宿主那行 `flex-wrap: wrap` 并让徽标
  `flex: 1 0 100%` 独占整行——别的插件在上、我们在下，再多插件也始终排最后。
  收起态是圆形图标，不参与换行；宿主若改了类名，换行规则自动失效、退化成纯 order 排序。

### 设置页

- 模型清单从「一张全局表」改成**每条 key 一份**：勾选、思考档位、全选/全不选、立即拉取、
  同步勾选、设为主 key 都挂在各自的 key 卡片下面，互不影响。勾选请求也从全局 `/selection`
  改成带 `hubKeyId` 的 `/keys/selection`。
- 连接区改成 CSS grid：标签、输入框、提示文字左端对齐且等宽，窄窗口自动折成一列。
- 「立即移除」（retired 模型）只在主 key 那一份里给——retired 宽限期表跟着主 key 走。
- 概览里原来贴在右边的两个小圆角标签（`realm cn`、`key: credentials`）改成和「面板会话」
  同样的格子，依次排在它后面，文案换成中文、口径跟网关对齐：`realm` → **版本**
  （`cn` 写「国内版」、`intl` 写「国际版」，别的值原样显示），`apiKeySource` →
  **API Key 来源**（手动填写 / 凭据库 / 面板自动获取 / 未配置）。缺 Key 时的告警徽标保留。
- 概览那排格子改成 `auto-fit` 网格（`minmax(112px, 1fr)`、`8px × 10px` 间距），七项按窗口宽度
  自动铺满；「今日」那行徽标收窄（`padding: 0 4px`、间距 4px），左端与下面「已同步」那行对齐，
  告警徽标移到单独一行，不再跟数字抢位置。
- 每条 key 的折叠提示并进头部那一个按钮（`账号 2 · 模型 6/19 · 点击展开模型列表`），
  收起时不再多画一行说明。
- 同步那行的模型数改成 `6/19 模型`：分子是**所有 key 真正写进 DSH 的模型并集**
  （按 id 去重，未勾选与 `retired` 都不算），分母是网关给的模型总数。
  它既不该用 `snapshot.lastSyncCount`——那是 `syncRoutesToDsh()` 里
  `count += routeModels.length` 逐条累加出来的，同一条模型被几条 key 都勾上就重复计几次
  （实测 6 + 1 + 6 = 13）；也不该只取主 key 那条。DSH 的模型选择器里实际能选到的是并集：
  主 key 启 1/2/3、另两条启 2/3/4 和 1/5，能选到的是 1/2/3/4/5 共 5 个，不是 3+4+2=9。
- 每条 key 的模型表可以折叠：主 key 那份默认摊开，其余默认收起；卡片头那行
  「账号 N · 模型 6/19」就是开关（带 ▸/▾ 箭头），收起时同一行补一句「点击展开模型列表」，
  不再另起一行说明。点过之后记住选择。
- 去掉「Key 列表」那行主标题，连同副标题和 `3 / 10` 计数——每条 key 卡片自己已经
  说得清楚，标题只占地方。外层那层带边框的 `section` 也一起删，否则标题一走它就成了
  「空框套实框」。
- key 卡的按钮行：「设为主 key」贴左（DOM 顺序也放最前，Tab 焦点跟着从左到右），
  立即拉取 / 全选 / 全不选 / 同步勾选靠右——`justify-content: flex-end` 配首项
  `margin-right: auto`，整行独占一行，窄窗口照旧换行。主 key 自己那张没有「设为主 key」，
  四个按钮一起靠右。

### 删除

- 「打开面板时带上密码」整条删掉：配置项 `dashboardIncludePwd`、设置页那个复选框、
  `/dashboard-url` 响应里的 `includePwd`、`buildDashboardUrl()` 的 `pwd` 参数一并删掉。
  深链永远只带 `?tab=`——`?pwd=` 会进地址栏、浏览器历史，还会被 hub 以明文写进
  `logs/service.log`，本来就不该留一个能把它打开的开关。老前端再 POST 这个字段会被忽略。
- **删掉「自动拉取 / 手动拉取」开关**，所有 key 每轮都拉。实测依据（每 key 打
  `/v1/models`，19 个模型各 5 次取中位）：1 个账号 `7.8 ms`、2 个账号 `14.8 ms`、
  **一百多个账号 `15.4 ms`**，抖动都在 `3–32 ms`。账号数只影响 `/accounts`、
  `/usage/analytics` 这类全量接口的响应体大小（4.4 MB / 5.5 MB，每轮各拉一次，
  与 key 数无关），不影响这一跳的耗时。留着开关只会让人记「这条 key 为什么没模型」。
- 随之删除：`POST /keys/pull-mode`（现在返回 404）、`snapshot().keys[].pull` 字段、
  `PULL_MODES` / `normalizePullMode()` / `DEFAULT_KEY_PULL`。`POST /keys/pull` 保留，
  作为排障用的手动重拉（60 秒节流）。

### 兼容

- 老状态文件不用迁移：多出来的 `pull` 字段读进来直接忽略。
- 模型参数（`contextWindow` / `maxTokens` / 思考档位）继续照抄上游 `/v1/models`，
  不做任何本地改写。

## [1.1.1] - 2026-10-25

删掉 `package.json` 里一条指向本包的 `dependencies`。

- `1.0.11` 那次把 `@deepseek-ai/cordis` 标成 optional 时，`dependencies` 里顺手多出一行
  `"dsh-workbuddy2api-hub": "^1.0.10"`——本包依赖它自己。这与 README、各版 Release 说明里
  「不需要 `npm install`，本包没有运行时依赖」直接冲突。
- 现在整块 `dependencies` 都已删除，包只声明 `peerDependencies`（全部 optional）。
- 实测这条声明的影响：`^1.0.10` 恰好被顶层的 1.x 满足，所以
  `npm i dsh-workbuddy2api-hub@1.1.0` 只装 1 个包、没有嵌套副本；但只要主版本跨过 `1.x`
  （发 2.0.0），它就会让 npm 在包里再装一份 1.x 的旧自己。
- 无运行时行为变更，不用动配置或状态文件。

## [1.1.0] - 2026-10-25

从「一条 key」扩到「网关里有几条 key 就同步几条」，每条 key 各自一条 provider 路由、一条凭据。

- **一 key ↔ 一条路由 ↔ 一条凭据**。主 key 冻结为 `workbuddy2api-hub` / `WORKBUDDY2API_HUB_API_KEY`
  （已有会话、`agent-default-model`、`allowedModels` 都指向它，改了就断）；其余 key 用
  `workbuddy2api-hub-<名字>` / `WORKBUDDY2API_HUB_API_KEY_<名字>`。路由键建好就不再变，
  所以改网关里的 key 名字、换倍率都不会让会话里选中的模型消失。
- **拉取策略**：主 key 常驻自动；其余 key 默认 `manual`，只有点「立即拉取」才去问网关，
  新发现的 key 当轮拉一次（否则界面上是一片空白）。`maxKeys` 默认 10，超出的只读不写。
- **勾选按 key 独立**，新模型默认全选；新增「把这条 key 的勾选同步给别的 key」
  （只覆盖双方都有的模型，目标 key 独有的模型保留它自己的勾选）。
- **侧边栏徽标改三行**：第一行「主 key 余额 + 整域余额」（余额没法按 key 拆，网关的
  `/v1/balance-summary` 是整域汇总，所以用 key 绑定的账号余额之和），第二三行是今日 /
  本周的 `tokens · 积分 · API 等价花费`，并且**跟着当前会话用的那条 key 走**——
  直接读 `uiSession` + `modelDirectories` 的快照，切会话不发任何请求。悬停列出全部 key，
  `●` 标当前。
- **主 key 被删**（网关里没了）：撤掉主路由、`state.mainKeyMissing = true`、徽标第一行
  显示「主 key 已删除」、会话里的模型不可用时提示重新选择——**不拿别的 key 顶替**。
  告警里单独出一条「主 key 已不在网关里」，不会混进同步失败的文案。
- 用量按 key 拆开来自 `/usage/analytics`（`/usage` 没有 key 参数，传了也被忽略）；
  合成桶（`__no_key__` / `__unknown_key__`）不算任何 key。
- 设置页新增「Key 列表」卡片：名字 / 掩码 / 绑定账号数 / 启用模型数 / 拉取方式切换 /
  立即拉取 / 全选全不选 / 同步勾选 / 设为主 key，每条 key 的错误就显示在自己那一行。
- 新接口：`POST /keys/pull`、`/keys/pull-mode`、`/keys/selection`、`/keys/sync-selection`、
  `/keys/main`；`/selection`、`/bulk`、`/enable-new`、`/retire`、`/refresh` 支持 `hubKeyId`。
- 升级迁移：老状态文件的 `selection` / `lastModelIds` / `retired` 会被整条搬进「主 key」，
  顶层字段继续写（= 主 key 镜像），回滚到 1.0.12 行为不变、已有会话不断。

## [1.0.12] - 2026-10-24

「打开看板」不再默认把面板密码塞进 URL。

- 新增配置项 `dashboardIncludePwd`，**默认 `false`**：深链只带 `?tab=`，密码不再进地址栏、
  浏览器历史、也不被 hub 写进自己的访问日志（hub 会把整条请求行原样落到 `logs/service.log`，
  `GET /?pwd=…` 因此会留一份明文）。想要「进去不用再输密码」可以显式打开。
- 设置页新增「打开看板时带上密码」开关，带一句说明；`GET /dashboard-url` 的响应多一个
  `includePwd` 字段，方便前端确认当前策略。
- `buildDashboardUrl(base, pwd, tab, { includePwd })` 增加第四个参数；纯函数层保持
  「不传就是带密码」的老行为，由插件按配置决定。

## [1.0.11] - 2026-10-24

装插件不再顺带拉一份用不上的 `@deepseek-ai/cordis`。

- `@deepseek-ai/cordis` 那条 peerDependency 标成 optional：插件一行 `@deepseek-ai/*` 都没 import
  （`apply(ctx)` 用的是宿主传进来的 ctx），留着它只会让 `npm i dsh-workbuddy2api-hub` 多装一份副本
  ——cordis 本来由 DSH 自己提供。现在装完 `node_modules` 里只有插件本身。

## [1.0.10] - 2026-10-24

发版一条命令同时落到 npm 与 GitHub Release，npm 包里只留运行时代码。

- `npm run release <x.y.z>` 现在会自己发 npm：先查登录态与版本号是否已被占用，再 `npm publish`，
  最后才提交、打标签、推送（npm 失败就停，不会留「GitHub 有标签、npm 没版本」的半成品）。
  `--no-publish` 只发 GitHub，`--dry-run` 只跑到测试。
- npm 包从 15 个文件瘦到 8 个（约 60 kB）：只含 `lib/`、`client/`、`cordis.patch.yml` 与
  README / CHANGELOG / LICENSE。`scripts/`、`tests/`、`docs/`、`.github/` 只在仓库里。
- **修掉一个会改坏用户 profile 的坑**：`package.json` 里原来有个 `"install": "node scripts/install-local.mjs"`
  ——`install` 是 npm 的生命周期钩子，任何人 `npm i dsh-workbuddy2api-hub` 都会自动执行它，
  把「装包的那个人」的 profile 依赖改指向包自己所在的目录。已改名 `npm run link` / `npm run link:dry` /
  `npm run unlink`，生命周期钩子不再存在。
- README 里 `docs/MAINTAINER.md` 的链接改用 GitHub 绝对地址（npm 包页里相对链接点不开）。

## [1.0.9] - 2026-10-24

模型选择器里能直接看到每个模型的倍率了。

- 写进 `llm-pi-ai` 的模型名改成「展示名 + 倍率」：付费模型形如 `GLM-5.1 ×0.79`，
  网关标 `x0.00`（或字面量 `free`）的免费模型形如 `Hy3 Free`；`id` 不变，路由与计费不受影响。
- 没声明倍率的模型不加后缀，不谎报免费。
- 设置页模型表的「倍率」列同样显示 `Free`，原先免费模型显示的是 `—`。

## [1.0.8] - 2026-10-24

插件在列表里显示「异常」「包不可用」的那个坑：`scripts/install-local.mjs` 把自己**所在**的
目录写进 DSH profile 的 `package.json`，从临时目录（如 `tmp/verify/...`）的运行副本执行时，
profile 就被指到了一个随时会被清掉的路径——清掉之后插件立刻加载失败。

- `scripts/install-local.mjs` 拒绝从 `node_modules/` 或 `tmp/` 下的副本执行，并提示必须从仓库根目录运行。
- README 排错段补了这一症状的定位与修复：查 profile 依赖指向 + `node_modules` 链接，重跑安装脚本后重启。

## [1.0.7] - 2026-10-24

首个发布到 npm 的版本：`npm i dsh-workbuddy2api-hub`，不用 clone 也不用构建。

- `package.json` 补发布配置：`files` 白名单（`lib`、`client`、`scripts`、`docs` 与三份文档，
  测试与临时目录不进包，整包 15 个文件 / 75 kB）、`publishConfig` 指到公共 registry、
  `prepublishOnly` 在发布前强制跑 `check-secrets` 与全部测试——凭据或坏代码进不了 npm。
- 维护者向内容搬到 `docs/MAINTAINER.md`（调试出口、主题令牌、假 hub 的鉴权语义、
  刷新与退避规则、发版流程、市场收录模板），README 只留使用者需要的部分并加了指向链接。
- 本机路径、端口、备份与凭据位置写进仓库外的 `NOTES.local.md`，并加进 `.gitignore`。
- 发版自动化：`npm run release <version>` 一条命令完成改版本、自检、测试、提交、打标签、
  推送；标签一推由 GitHub Actions 用 `GITHUB_TOKEN` 建 Release，正文取自本文件对应小节。

## [1.0.6] - 2026-10-24

悬停框里「今日」和「本周」的写法统一，README 改成给外部读者看的版本。

- 悬停框（`title`）原本把今日拆成三行、本周挤成一行，同一份数据在同一个框里长得
  不一样，读起来像两份东西。现在两行同构：
  `今日 tokens 72.3M · 积分 61.41 · API 等价 ¥10.39` /
  `本周 tokens 260.7M · 积分 465.43 · API 等价 ¥31.17`，只有开头的窗口名不同。
- 收起态与展开态共用同一个 `title`，不再有两套文案。
- README 清理：去掉维护者视角的内容（本机路径示例、`cordis_inspect_query` 这类
  内部工具名、插件市场 PR 的收录步骤），补上侧边栏徽标长什么样、`npm run check`
  命令；「面板密码不落盘」的说法改为如实描述（它确实存在状态文件里）。
- 测试 +1（悬停框两行同构、收起态同一套文案），共 87 条。

## [1.0.5] - 2026-10-24

徽标加一行「本周」，两行数据左标签贴左、三个数字贴右。

- 展开态现在是三行：`● WorkBuddy … 3729.25` / `今日 49.9M · 45.57 · ¥7.21` /
  `本周 248.1M · 455.45 · ¥29.30`。窗口名贴左（`minWidth: 44px`，中英文都不抖），
  三个数字用 `marginLeft: auto` 顶到最右，两行上下对齐，一眼能比出今日与本周的差距。
- 宿主每次刷新固定多拉一次 `range=week`，存在 `usageWeek` 槽位；`usage`（主窗口，默认
  `today`）不动，所以把 `usageRange` 配成 `month`/`all` 也不会把本周数据顶掉。
- 快照新增 `usageWeek`；`GET /api/usage?range=week` 走同一个槽位。老宿主没有
  `usageWeek` 时前端**不画第三行**，绝不拿今日的数冒充本周。
- **口径说明**：hub 的「本周」是**日历周**，从本周一 00:00 起（`wb_proxy.py:747
  range_window()`：`_local_midnight(days_back=tm_wday)`），不是「近 7 天」；源码注释
  明确说滚动别名 `7d`/`30d` 故意不提供。真要近七天可以用 `range=custom&since=<epoch>`
  自己算窗口。
- 测试 +2（徽标两行的左右对齐结构、老宿主不画第三行）+ 宿主/e2e 的 `usageWeek` 断言，
  共 86 条。

## [1.0.4] - 2026-10-24

徽标第二行不再堆标签，改成「窗口 + 三个数字」。

- 展开态第二行：`今日 49.9M · 45.57 · ¥7.21`——窗口名只在最前面标一次，后面三个数
  靠 `·` 分隔，不再写三份「今日 tokens / 今日积分 / API 等价」。11px 的侧边栏宽度本来就
  放不下三份标签，挤在一起只会换行、更难读。
- 三个数字各自是什么，仍然写在 `title` 里（悬停可读：余额、tokens、积分、API 等价、错误或地址）。
- 删掉 `HubFooter` 里的 `item(label, value)` 小助手（三份标签都去掉后没人用了）。
- 测试 +1：直接渲染 `__HubFooter({ wide: true })` 断言第二行正好 6 个子节点
  （窗口名 + 三个数字 + 两个分隔点），共 85 条。

## [1.0.3] - 2026-10-24

侧边栏徽标改成五项，并修掉一个「参数名传错」的旧 bug。

- 徽标（展开态）现在显示：`WorkBuddy` · `积分余额` · `今日 tokens` · `今日积分` · `API 等价`；
  收起态（约 48px）只留状态点 + 积分余额 + 今日积分，完整四项放进 `title` 悬停可读。
- **修 bug**：hub 的 `/usage` 只认 `range` / `since` / `until`（`wb_proxy.py:784 range_query()`），
  传 `hours=` 会被静默忽略、退化成**全量历史**——所以以前标着「近 24 小时」的数字其实是累计总额。
  现在按 `range=today` 请求，与看板「今日」口径一致。
- 新增 `normalizeUsageRange(value)` / `usageQuery(range)` / `USAGE_RANGES`：`today`（默认）/
  `week` / `month` / `all`，非法值退回 `today`；`all` 不带参数（hub 侧不过滤）。
- 快照字段 `usageHours` 换成 `usageRange`；插件接口 `GET /api/usage?range=today|week|month|all`。
- 设置页用量行新增「积分」徽标，标签由「近 24 小时」改为「今日」。
- 新增 `footerSummary(snapshot)` 纯函数（导出 `__footerSummary` 便于测试）：积分两位小数、
  tokens 走 K/M/B、金额 `¥0.00`；余额 0 视为有效值而不是缺失。
- 测试 +4（`normalizeUsageRange`/`usageQuery`、`footerSummary` 正常态与缺失态、双语标签），共 84 条。

## [1.0.2] - 2026-10-24

模型列表改成按名称排序。

- 新增 `sortModels(models)` / `compareModelsByName(left, right)`：按模型的显示名排序，
  忽略大小写、数字按数值比较（`GPT-9` 在 `GPT-10` 前面），同名按 id 兜底，保证顺序稳定。
- `buildRouteModels` 与设置页表格共用同一个比较器，所以写进 `llm-pi-ai` 的 `models`
  顺序和设置页看到的一致；原先的「按倍率从便宜到贵」排序已移除，倍率只作为展示字段。
- 没有 `name` 的条目用 id 当名字参与排序，不会因为缺字段被打到末尾。
- 设置页表格在客户端也排了一次序（），宿主还没热更新时也不会按 hub 的原始顺序乱放。
- 因为顺序变了，下一次刷新会把 `providers.workbuddy2api-hub` 重写一次（内容相同也算变更）。

## [1.0.1] - 2026-10-24

修复浅色主题下设置页「字看不清」。

- 配色改用 DSH 真正注册的主题令牌 `--dsw-alias-*`（原先是 `--dsh-*`，这个名字在
  0.2.1-rc.2 里不存在，`var()` 静默走兜底，而兜底是给深色主题写的浅灰字）。
  用户在浅色主题下看到的就是「浅灰字 + 白底」。
- 输入框 / 次级按钮 / 信息条底色改成 `--dsw-alias-bg-layer-2`，不再写死
  `rgba(0,0,0,.18)`、`rgba(255,255,255,.06)` 这类只对深色主题成立的半透明。
- 思考档位选中的高亮色改成 `color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent)`，
  深浅两套主题都不会出现「浅底浅字」。
- 11px 的辅助说明与侧栏额度数字提高对比度（次要文字改用 `label-secondary`）。
- 测试新增 2 条：palette 的每个值必须是 `--dsw-alias-*` 令牌；样式里不许再出现写死的深色底。

## [1.0.0] - 2026-10-24

首个版本。把本地 workbuddy2api-hub 接进 DSH 桌面端。

### 新增

- 设置页分区 `workbuddy2api-hub`：服务地址、面板密码、默认页签、轮询间隔、API Key 的可视化配置；测试连接、立即同步、打开看板、清空同步。
- 侧边栏徽标：credit 余额 + 连接状态点，点击直接打开带 `pwd`/`tab` 的看板深链。
- 模型同步到 `llm-pi-ai` 的 `providers.workbuddy2api-hub`：`contextWindow` / `maxTokens` / 图片输入 / 思考档位 / 倍率排序；内容没变不写盘，`SettingsConflictError` 自动重试。
- 模型下架宽限期（默认 24 小时）与复活；`newModelPolicy` 决定新模型默认是否勾选。
- 余额、用量（请求数 / 失败数 / credit / 缓存命中）、账号状态聚合。
- 六类告警：连不上、密码错、登录限流、缺 API Key、额度偏低、账号需重登/过期；可「知道了」抑制 24 小时。
- 失败分类（`classifyFailure`）：连不上 / 超时 / 鉴权失败 / 限流 / HTTP 错误 / 非 JSON，全部折成中文提示，写进 `lastError`。
- `scripts/mock-hub.mjs`：复刻真实 hub 鉴权语义的假服务（含 60 秒 5 次失败的 429）。
- `scripts/smoke-live.mjs`：对真实 hub 的只读联调（不读明文 Key、不写 DSH 配置）。
- `scripts/install-local.mjs`：把仓库挂进 profile，带备份、`--dry-run`、`--uninstall`。

### 设计决定

- 路由键默认 `workbuddy2api-hub`，不复用 `wb`：装上插件不该改写用户已有的 provider 路由。
- `pwd` 只用来换 `X-Panel-Token`。面板 Token 不能当 Bearer 用（实测 `/v1/chat/completions` 带面板 Token 仍 401），所以真实调用必须落到 API Key 上。
- 缺 API Key 时不写模型路由：写一条注定 401 的 provider 比什么都不写更糟。
- `baseUrl` / `pwd` / `tab` 用显式字段指纹判定：YAML 改了才覆盖，没改就保留设置页里的改动。
- 状态文件放在 profile 目录（`workbuddy2api-hub.json`），`stateDir` 可覆盖；API Key 只进凭据库与内存。
