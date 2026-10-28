# Changelog

按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 组织，版本号跟 `package.json` 走。
每条只写**用户能感知的行为变化**和**会咬人的坑**；实现细节在 [docs/MAINTAINER.md](https://github.com/HimA6652/dsh-workbuddy2api-hub/blob/main/docs/MAINTAINER.md)。

## [1.4.1] - 2026-10-28

维护版本：对着网关 1.10.0 把用到的每个接口逐字段核了一遍，没有破坏性变化，行为和 1.4.0 完全一致。

### 改掉

- README 的适用版本行从「实测 v1.8.x」改成「实测 v1.8、v1.10」——本机网关已经跑到 1.10.0 了。

### 核过的地方

七个接口的字段全部还在，没有改名也没有删：`/accounts`、`/settings`、`/usage`、`/usage/analytics`、`/v1/models`、`/v1/balance-summary`、`/health`。`/usage/analytics` 的 `keys[]` 里，三条真 key 的 `key` 仍然是网关的 key id，两个合成桶仍然以 `__` 开头；账号的 `credits` 有 118 条是 `null`（照旧跳过），`ready` 本来就由插件自己算，网关不提供这个字段。

## [1.4.0] - 2026-10-27

### 删掉

- 设置页顶部那排告警条，以及它背后整套东西：`/dismiss` 接口、`snapshot.alerts` 字段、`thresholds` 配置（`lowCredits` / `unreachablePolls`）和每条右边的「知道了」按钮。
- 告警原本提示六件事：连不上、密码错、被限流、缺 API Key、额度偏低、账号失效或即将过期。这些状态本身都还在，只是不再单独弹一条：连接问题看设置页顶部那行原因，额度看概览「额度」格，Key 来源看「API Key 来源」格，可用账号看「账号」格（`ready / total`）。

升级：状态文件里的 `dismissed` 与 `thresholds` 两个字段下次保存时会被清掉，其余字段不动；`cordis.patch.yml` 里留着 `thresholds` 也不会报错，只是不再读取。

## [1.3.3] - 2026-10-27

### 修掉

- 发布包里混进了一个编辑期间的备份副本（`lib/` 目录下与主文件同名的 `*.bak-*` 文件）。打包白名单已从「整个目录」改成「逐个文件」，以后目录里再多出任何东西都不会进包。

升级：1.3.2 发出去的包带着那份副本，装到 1.3.3 会被替换掉。功能与 1.3.2 完全一致，配置项、状态文件、接口都没有变化。

## [1.3.2] - 2026-10-27

修掉「宽限期形同虚设」。

- **模型下架后本该留 24 小时，实际只顶住一轮轮询。** 网关把模型撤掉时，插件会把它标成
  `retired` 继续留在清单里，等 `retireHours` 到了才真正移除——但记着下架时间的那张表
  每轮都被重建，第二轮就认不出它了。结果是模型直接消失、勾选跟着丢，只剩 30 秒的余地。
  现在这张表跨轮保留，下架时间不被重置，到期才移除；中途回来照旧复活。
- 补了一条回归测试：让模型连续多轮不出现，断言它一直在清单里、下架时间还是第一次那个。
  把 `lib/hub.js` 退回修复前跑，这条与原来那条都会红。

升级：配置项、状态文件、接口都没有变化。**已经因为这个 bug 在同一轮里消失掉的模型找不回来**
（当时没记下它的下架时间），它再出现时按新模型处理，由 `newModelPolicy` 决定勾不勾。

## [1.3.1] - 2026-10-26

对 1.8.0 的网关核了一遍接口，没有需要跟着改的地方，只补了三处一直缺的。

- **同步行能看见网关版本。** 接的是哪一版 hub 现在直接显示在「已同步 … · 路由键 … · 插件」
  那行末尾。这个值取响应头 `Server: wb-proxy/1.8.0`——`/health` 的响应体从 1.7.x 到 1.8.x
  都没给过 `version`，只能从那儿捞；捞不到画 `—`。
- **账号条数到容量线会提醒。** `/accounts` 一次返回全部账号、没有分页，按 key 的余额是在本地
  按账号求和的。到 500 条时给一条提示，说清这是容量线不是错误——真到那一步，刷新开销会跟着涨，
  万一网关以后改成分页，余额合计会静默偏小。
- README 的「适用 workbuddy2api-hub」从「实测 v1.7.x」改成「实测 v1.8.x」。

配置项、状态文件、接口都没有变化。

## [1.3.0] - 2026-10-26

侧边栏徽标不再跟着会话换数，恒定显示主 key。

- **徽标与副窗固定用主 key 的数据。** 原先说好「会话选的是哪条 key 的模型，徽标就显示那条
  key 的余额和用量」，实际做不到：读「当前会话用的哪个 provider」要碰宿主的内部服务，拿不到
  就静默回落主 key，表现上就是这功能不存在。现在直接固定主 key——第一行写主 key 名字与
  「该 key 余额 / 整域余额」，今日、本周两项照旧，只是不再随会话变。
- 副窗顶部那行标签从「当前会话」改成「主 key」；「各 key 用量」表里那个实心点标的是主 key。
- 主 key 被删除时的提示改由 `mainKeyMissing` 判断，措辞从「当前会话的模型已失效」改成
  「主 key 已被删除，请在模型选择器里重新选择模型」。

配置项、状态文件、接口都没有变化；数字仍全部来自网关，本地只做两位小数与
`errors / requests`。

## [1.2.2] - 2026-10-25

只有文档：整理 1.2.1 那段说明的措辞。代码与 1.2.1 完全一致，升上来不用动任何东西。

## [1.2.1] - 2026-10-25

两条修正，日常用法不变。

- **主 key 的认领不再看名字。** 原来「凭据里存的明文比对」没命中时，还会按 key 名再认领一次；
  那个兜底写在一个具体名字上，改个名字主 key 就换人了。现在只认「凭据明文比对 → 第一条启用」。
- **修发版脚本两处中断。** 工作树没有可提交内容时，`git commit` 失败会把后面的打标签与推送
  一起带走；另外它认不出 `PLUGIN_VERSION` 改成正则写法的断言。两处都改了，只影响发版流程。

状态文件、配置项、接口与包内容都没变。

## [1.2.0] - 2026-10-25

界面改造：侧边栏徽标点开看详情，模型清单拆到每条 key 各自名下。

### 侧边栏徽标

- **悬停提示改成了点击弹副窗。** 原来鼠标停在徽标上弹一段多行文本；现在点一下，在徽标正上方
  打开一块小面板，点遮罩或右上角 `×` 关闭。里面是「各 key 用量」表——每条 key 一段
  （名字 + 账号数，再跟今日、本周两行），末尾一行总计，底部是「打开面板」。
- **徽标本身三行**：第一行是当前会话那条 key 的名字和「该 key 余额 / 整域余额」，第二行
  `今日`、第三行 `本周`，右边 `tokens / 积分 / 等价` 三列右对齐。数字跟着当前会话用的
  provider 走；用的不是网关模型时回落主 key。
- **余额能按 key 拆了。** `/v1/balance-summary` 只给整域，插件改成把这条 key 绑定的账号在
  `/accounts` 里的余额相加。账号查不到时显示 `—`，不报 0。
- 所有数字保留两位小数（`72.30M`、`¥10.39`）。数字全部是网关原样给的，本地只做两位小数
  和 `errors / requests` 的成功率。
- 装了别的 footer 插件时不再跟它挤成一人一半：徽标独占一行，别的插件在上、我们在下。

### 设置页

- **模型清单从一张全局表改成每条 key 一份。** 勾选、思考档位、全选 / 全不选、立即拉取、
  同步勾选、设为主 key 都挂在各自的 key 卡片下，互不影响。
- 每条 key 的模型表可折叠（主 key 默认展开）。卡片头那行「账号 2 · 模型 6/19」就是开关。
- 连接区改成等宽网格，窄窗口自动折成一列；概览那七项按窗口宽度自动铺满。
- `realm cn`、`key: credentials` 两个英文小标签换成中文格子：**版本**（国内版 / 国际版）、
  **API Key 来源**（手动填写 / 凭据库 / 面板自动获取 / 未配置），口径跟网关面板一致。
- 同步那行的 `6/19 模型` 改成取**所有 key 已启用模型的并集**（按 id 去重，未勾选与已下架的
  不算）。原来那个数是各条 key 路由条数相加，同一条模型被两条 key 都勾上就会重复计数。

### 删掉

- **「打开面板时带上密码」。** 配置项 `dashboardIncludePwd`、设置页那个开关、`/dashboard-url`
  响应里的 `includePwd` 一并删掉，深链永远只带 `?tab=`。`?pwd=` 会留在地址栏和浏览器历史里，
  还会被 hub 以明文写进 `logs/service.log`。
- **「自动拉取 / 手动拉取」开关。** 所有 key 每轮都拉：实测一条 key 绑 1 个账号和绑一百多个
  账号，拉模型清单都在 `15 ms` 上下（抖动 `3–32 ms`），账号数只影响全量接口的响应体大小。
  留着开关只会让人记「这条 key 为什么没模型」。

### 升级

- 老状态文件不用迁移，多余的 `pull` 字段读进来直接忽略。`POST /keys/pull-mode` 已删（返回
  404），`POST /keys/pull` 保留作排障用的手动重拉（60 秒节流）。
- 模型参数（`contextWindow` / `maxTokens` / 思考档位）继续照抄上游 `/v1/models`，不做本地改写。
- 设置页里有按 `dashboardIncludePwd` 传值的旧脚本，服务端会忽略，不报错。

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
