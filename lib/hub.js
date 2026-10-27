/**
 * dsh-workbuddy2api-hub 的纯函数层。
 *
 * 这个文件刻意不含 cordis、不含网络、不读文件：所有「把 hub 的字段翻译成 DSH 的字段」
 * 的规则都集中在这里，于是测试可以不启动 DSH、不起 HTTP 服务器，直接把各种畸形响应
 * 喂进来验证。参考项目 dsh-workbuddy2api-panel 的 `lib/panel.js` 是同一套分层，
 * 它也是那个仓库里测试覆盖最厚的文件。
 *
 * hub 的字段名与参考项目（workbuddy2api-panel）并不完全一致，这里两套都认：
 *   - 上下文：`context_length` / `max_input_tokens` / `context_windows`
 *   - 输出上限：`max_output_tokens` / `max_completion_tokens`
 *   - 思考档位：`reasoning_efforts` + `reasoning_can_disable`（hub）
 *               `supported_efforts` + `can_disable_thinking`（参考面板）
 *   - 单价：`credits`（形如 `"x0.29"`）/ `credit_rate` / `rate`
 */

/** hub 默认监听地址（本地部署，端口 8788）。 */
export const DEFAULT_BASE_URL = 'http://127.0.0.1:8788'

/** 面板默认密码。hub 首次启动时就是 `admin`，并会在看板上标注「用的是默认密码」。 */
export const DEFAULT_PWD = 'admin'

/** 看板默认页签。 */
export const DEFAULT_TAB = 'gateway'

/**
 * hub 看板支持的页签名单。
 *
 * 来源是 `dashboard.html` 里的 `var TABS = [...]`；`?tab=` 只是前端深链参数，
 * 服务端不解析它，所以这里必须自己挡住非法值——否则「打开看板」会落到一个空页签。
 */
export const TABS = ['gateway', 'accounts', 'tasks', 'analytics', 'agents', 'settings', 'logs']

/** llm-pi-ai 认可的思考档位（顺序即选择器里的显示顺序）。 */
export const DSH_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** 至少一个「非 off」档才算合法：pi-ai 会拒绝只有 off 的档案。 */
const POSITIVE_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']

/**
 * 归一 hub 根地址。
 *
 * 用户的输入形态很杂：`127.0.0.1:8788`、`http://127.0.0.1:8788/`、
 * `http://127.0.0.1:8788/?pwd=admin&tab=gateway`（直接从浏览器地址栏复制）。
 * 这里把「缺少 scheme」「多余的斜杠 / 查询串 / 片段」都收干净，只留下 origin + 可选子路径，
 * 让后面拼 `/v1`、`/health` 时不会出现 `//v1`。
 * @param value - 用户输入。
 * @returns 归一后的地址；无法解析时返回空串。
 */
export function normalizeBaseUrl(value) {
  if (typeof value !== 'string') return ''
  let text = value.trim()
  if (text === '') return ''
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `http://${text}`
  let parsed
  try {
    parsed = new URL(text)
  } catch {
    return ''
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
  if (parsed.hostname === '') return ''
  // 只保留 pathname，丢掉 query/hash：`?pwd=` 是前端便利参数，不属于服务地址。
  const path = parsed.pathname.replace(/\/+$/, '')
  return `${parsed.protocol}//${parsed.host}${path}`
}

/**
 * 归一面板密码。
 *
 * 只裁掉首尾空白：密码中间的空格是合法字符，全裁会把用户的密码改坏。
 * @param value - 配置里读到的密码。
 * @returns 密码字符串（非字符串输入退回默认密码）。
 */
export function normalizePwd(value) {
  if (typeof value !== 'string') return DEFAULT_PWD
  return value.trim()
}

/**
 * 归一页签，非法值退回兜底页签。
 * @param value - 候选页签。
 * @param fallback - 兜底页签。
 * @returns 白名单内的页签。
 */
export function normalizeTab(value, fallback = DEFAULT_TAB) {
  const safeFallback = TABS.includes(fallback) ? fallback : DEFAULT_TAB
  if (typeof value !== 'string') return safeFallback
  const tab = value.trim().toLowerCase()
  return TABS.includes(tab) ? tab : safeFallback
}

/** `/usage` 支持的统计窗口。`all` 表示不带参数（hub 侧不过滤，即全量历史）。 */
export const USAGE_RANGES = ['today', 'week', 'month', 'all']

/**
 * 归一用量统计窗口。
 *
 * hub 的 `/usage` 只认 `range` / `since` / `until` 三个参数
 * （`wb_proxy.py:784 range_query()`），传 `hours=` 会被**静默忽略**、退化成
 * 全量窗口——这一点害我们之前一直标着「近 24 小时」却在看历史总额。
 * `wb_proxy.py:747 range_window()` 的取值：`today|day|1d` → 本地零点；
 * `week|w` → 本周一；`month|m` → 本月一号；未知/空 → 不过滤。
 * @param value - 用户输入或查询参数。
 * @returns 归一后的窗口名，无法识别时回退 `today`。
 */
export function normalizeUsageRange(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (raw === '') return 'today'
  if (raw === 'day' || raw === '1d') return 'today'
  if (raw === 'w') return 'week'
  if (raw === 'm') return 'month'
  if (raw === 'total' || raw === 'none') return 'all'
  return USAGE_RANGES.includes(raw) ? raw : 'today'
}

/**
 * 拼 `/usage` 的请求路径。
 * @param range - 任意窗口名（会先归一）。
 */
export function usageQuery(range) {
  const wanted = normalizeUsageRange(range)
  return wanted === 'all' ? '/usage' : `/usage?range=${wanted}`
}

/**
 * 拼「打开看板」的深链。
 *
 * 只带页签：`http://127.0.0.1:8788/?tab=gateway`。密码**永远不拼进 URL**——
 * 它会进浏览器地址栏与历史，还会被 hub 以明文写进自己的 `logs/service.log`
 * （`GET /?pwd=…` 原样落盘）。进面板在页面上输一次即可。
 * @param base - 已归一的根地址。
 * @param tab - 页签。
 * @returns 完整 URL；地址无效时返回空串。
 */
export function buildDashboardUrl(base, tab) {
  const root = normalizeBaseUrl(base)
  if (root === '') return ''
  const url = new URL(root.endsWith('/') ? root : `${root}/`)
  url.searchParams.set('tab', normalizeTab(tab))
  return url.toString()
}

/**
 * 把一次失败的 HTTP 结果翻译成人话。
 *
 * 三类必须能分清，因为用户的处置完全不同：
 *   - 连不上 / 超时 → 去看服务起没起（不是密码问题）；
 *   - 401 / 403 → `pwd` 不对或 Token 失效；
 *   - 429 → 登录试太多次，要等，别继续试。
 * @param result - `{ status, text, body }`（`status` 为 0 表示网络层失败）。
 * @returns `{ kind, message, status }`。
 */
export function classifyFailure(result) {
  const status = Number(result?.status) || 0
  const raw = typeof result?.text === 'string' ? result.text : ''
  const detail = typeof result?.body?.error === 'string' ? result.body.error : ''
  const hint = detail !== '' ? detail : raw
  if (status === 0) {
    const timeout = /超时|timeout|abort/i.test(raw)
    return {
      kind: timeout ? 'timeout' : 'unreachable',
      status,
      message: timeout
        ? `hub 请求超时：${hint || '服务没有在预期时间内响应'}`
        : `连不上 hub（${hint || 'connection refused'}）：确认 workbuddy2api-hub 已启动、端口正确`,
    }
  }
  if (status === 401 || status === 403) {
    return {
      kind: 'auth',
      status,
      message: `hub 鉴权失败：面板密码（pwd）不对，或会话已过期${hint === '' ? '' : `（${hint}）`}`,
    }
  }
  if (status === 429) {
    const wait = retryAfterSeconds(hint)
    return {
      kind: 'rate-limited',
      status,
      message: `hub 登录尝试过于频繁${wait > 0 ? `，请等 ${wait} 秒` : ''}：密码错太多次会触发 60 秒限流`,
    }
  }
  if (status === 404) {
    return {
      kind: 'http',
      status,
      message: `hub 上找不到这个接口（404）：服务版本可能与本插件不匹配${hint === '' ? '' : `（${hint}）`}`,
    }
  }
  if (status >= 500) {
    return {
      kind: 'http',
      status,
      message: `hub 内部错误（${status}）${hint === '' ? '' : `：${hint}`}`,
    }
  }
  return { kind: 'http', status, message: `hub 返回 ${status}${hint === '' ? '' : `：${hint}`}` }
}

/**
 * 从限流提示里抠出「还有多少秒」。
 * @param text - 形如 `too many login attempts, please wait 42s`。
 * @returns 秒数（抠不到返回 0）。
 */
export function retryAfterSeconds(text) {
  if (typeof text !== 'string') return 0
  const match = /wait\s+(\d+)\s*s|(\d+)\s*s(?:ec(?:onds?)?)?\b/i.exec(text)
  if (match === null) return 0
  const value = Number(match[1] ?? match[2])
  return Number.isFinite(value) && value > 0 ? Math.min(Math.round(value), 3600) : 0
}

/**
 * 单价的展示文本。
 * @param rate - 数字倍率。
 * @returns 形如 `×0.29`；无值返回空串。
 */
export function rateText(rate) {
  const value = Number(rate)
  if (!Number.isFinite(value) || value <= 0) return ''
  return `×${Math.round(value * 1000) / 1000}`
}

/**
 * 解析模型单价（hub 用「倍率」计费，`credits: "x0.29"` 表示 ×0.29）。
 *
 * 和 {@link modelRate} 的区别：这里 **0 也算有效值**。hub 对免费模型给的是
 * `credits: "x0.00"`，要把它和「压根没声明倍率」区分开，否则选择器里
 * 免费模型只能显示空后缀。
 * @param model - hub 的模型条目。
 * @returns 非负倍率；没声明或解析不到返回 null。
 */
export function modelRateValue(model) {
  if (model === null || typeof model !== 'object') return null
  const candidates = [model.credits, model.credit_rate, model.rate, model.price, model.price_rate]
  for (const raw of candidates) {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw
    if (typeof raw !== 'string') continue
    const text = raw.trim()
    if (/^(free|免费|零|none)$/i.test(text)) return 0
    const match = /(\d+(?:\.\d+)?)/.exec(text)
    if (match === null) continue
    const value = Number(match[1])
    if (Number.isFinite(value) && value >= 0) return value
  }
  return null
}

/**
 * 解析模型单价（hub 用「倍率」计费，`credits: "x0.29"` 表示 ×0.29）。
 * @param model - hub 的模型条目。
 * @returns 正数倍率，解析不到（含 0）返回 null。
 */
export function modelRate(model) {
  const value = modelRateValue(model)
  return value !== null && value > 0 ? value : null
}

/**
 * 模型名后面的倍率后缀。
 * @param model - hub 的模型条目。
 * @returns 付费模型 `×0.29`，免费模型 `Free`，没声明倍率返回空串。
 */
export function modelRateSuffix(model) {
  const value = modelRateValue(model)
  if (value === null) return ''
  if (value <= 0) return 'Free'
  return rateText(value)
}

/**
 * 模型在选择器里显示的名字：展示名 + 倍率后缀。
 *
 * 选择器只显示 `name` 字段，倍率不落到名字里就永远看不见，所以这里拼进去；
 * `id` 保持原样，路由与计费都靠它。
 * @param model - hub 的模型条目。
 * @returns 形如 `GLM-5.1 ×0.79` / `Hy3 Free`。
 */
export function modelLabel(model) {
  const base = modelDisplayName(model)
  const suffix = modelRateSuffix(model)
  return suffix === '' ? base : `${base} ${suffix}`
}

/**
 * 模型的展示名。
 * @param model - hub 的模型条目。
 * @returns 名称（缺失时退回 id）。
 */
export function modelDisplayName(model) {
  const name = typeof model?.name === 'string' ? model.name.trim() : ''
  if (name !== '') return name
  const id = typeof model?.id === 'string' ? model.id.trim() : ''
  return id !== '' ? id : '未命名模型'
}

/**
 * 模型支持的思考档位。
 *
 * 返回值有三种语义（与 pi-ai 的 `reasoningEfforts` 字段一一对应）：
 *   - `false`：明确不支持思考，选择器里不出现档位；
 *   - `undefined`：没声明，交给作者默认（不写这个字段）；
 *   - 对象：`{ off, low, high, ... }`，键是档位名、值是线上的写法。
 * @param model - hub 的模型条目。
 * @returns `false` / `undefined` / 档位对象。
 */
export function modelReasoningEfforts(model) {
  const declared = Array.isArray(model?.reasoning_efforts)
    ? model.reasoning_efforts
    : Array.isArray(model?.supported_efforts)
      ? model.supported_efforts
      : []
  const levels = []
  for (const raw of declared) {
    if (typeof raw !== 'string') continue
    const level = raw.trim().toLowerCase()
    if (level === '' || level === 'off' || level === 'minimal') continue
    if (!POSITIVE_LEVELS.includes(level)) continue
    if (!levels.includes(level)) levels.push(level)
  }
  // 档位按 DSH 的顺序排，避免 hub 给的顺序把「高」排到「低」前面。
  levels.sort((left, right) => POSITIVE_LEVELS.indexOf(left) - POSITIVE_LEVELS.indexOf(right))
  const canDisable = model?.reasoning_can_disable === true || model?.can_disable_thinking === true
  const alwaysThinking = model?.always_reasoning === true
  const efforts = {}
  if (canDisable && !alwaysThinking) efforts.off = 'off'
  for (const level of levels) efforts[level] = level
  if (levels.length === 0) {
    // 没给任何正档：如果声明了支持思考就留空（用作者默认），否则明确关掉。
    const supported = model?.supports_reasoning === true || model?.capabilities?.reasoning === true
    return supported ? undefined : false
  }
  return efforts
}

/**
 * 按用户在设置页的选择裁剪思考档位。
 *
 * 裁剪后如果只剩 `off`，必须退回「全支持」——因为 pi-ai 会拒绝
 * 「非空但全是 off」的档案，整条路由会因此注册失败。
 * @param efforts - {@link modelReasoningEfforts} 的结果。
 * @param selected - 用户勾选的档位列表。
 * @returns 裁剪后的结果。
 */
export function clampEfforts(efforts, selected) {
  if (efforts === false || efforts === undefined) return efforts
  if (!Array.isArray(selected) || selected.length === 0) return efforts
  const kept = {}
  for (const [level, wire] of Object.entries(efforts)) {
    if (level === 'off' || selected.includes(level)) kept[level] = wire
  }
  if (!Object.keys(kept).some((level) => level !== 'off')) return efforts
  return kept
}

/**
 * 把一个 hub 模型翻译成 llm-pi-ai 的模型档案。
 *
 * 只写「有值」的字段：pi-ai 对 `contextWindow` / `maxTokens` 有正整数校验，
 * 塞一个 0 或 NaN 进去会让整条 provider 路由校验失败，连带所有模型一起消失。
 * @param model - hub 的模型条目。
 * @param options.efforts - 用户勾选的档位。
 * @returns 模型档案；id 缺失时返回 undefined。
 */
export function toModelProfile(model, options = {}) {
  if (model === null || typeof model !== 'object') return undefined
  const id = typeof model.id === 'string' ? model.id.trim() : ''
  if (id === '') return undefined
  const profile = { id, name: modelLabel(model) }
  const context = Number(model.context_length ?? model.max_input_tokens)
  if (Number.isFinite(context) && context > 0) profile.contextWindow = Math.round(context)
  const maxTokens = Number(model.max_output_tokens ?? model.max_completion_tokens)
  if (Number.isFinite(maxTokens) && maxTokens > 0) profile.maxTokens = Math.round(maxTokens)
  if (supportsImages(model)) profile.input = ['text', 'image']
  const efforts = clampEfforts(modelReasoningEfforts(model), options.efforts)
  if (efforts !== undefined) profile.reasoningEfforts = efforts
  return profile
}

/**
 * 模型是否收图。
 * @param model - hub 的模型条目。
 * @returns 是否支持图片输入。
 */
function supportsImages(model) {
  if (model?.supports_images === true || model?.supports_vision === true) return true
  if (model?.capabilities?.vision === true) return true
  return Array.isArray(model?.input_modalities) && model.input_modalities.includes('image')
}

/**
 * 模型名排序的比较器：先按显示名（忽略大小写、数字按数值），同名再按 id。
 *
 * 设置页的表格与写进 llm-pi-ai 的 `models` 共用这一个比较器：用户在设置页里看到的
 * 第一行，就是模型选择器里的第一项。倍率只用来展示，不参与排序。
 * @param left - 模型条目。
 * @param right - 模型条目。
 * @returns 比较结果。
 */
export function compareModelsByName(left, right) {
  const leftName = modelDisplayName(left).toLocaleLowerCase()
  const rightName = modelDisplayName(right).toLocaleLowerCase()
  if (leftName !== rightName) {
    return leftName.localeCompare(rightName, undefined, { numeric: true, sensitivity: 'base' })
  }
  return String(left?.id ?? '').localeCompare(String(right?.id ?? ''), undefined, { numeric: true })
}

/**
 * 按用户选择组装写进 llm-pi-ai 的 `models` 数组。
 *
 * 排序：按模型名称（不区分大小写），与设置页表格同一顺序。
 * hub 只有一个域（没有参考项目的 `cn:` / `global:` 前缀），所以不需要按域分组。
 * @param models - hub 的模型数组。
 * @param selection - `{ [id]: { enabled, efforts } }`。
 * @returns 模型档案数组。
 */
export function buildRouteModels(models, selection) {
  const rows = Array.isArray(models) ? models : []
  const picked = []
  for (const model of rows) {
    const id = typeof model?.id === 'string' ? model.id.trim() : ''
    if (id === '') continue
    const choice = selection?.[id]
    if (choice !== undefined && choice.enabled === false) continue
    const profile = toModelProfile(model, { efforts: choice?.efforts })
    if (profile !== undefined) picked.push({ profile, model })
  }
  picked.sort((left, right) => compareModelsByName(left.model, right.model))
  return picked.map((item) => item.profile)
}

/**
 * 按名称给模型排序（不区分大小写，数字按数值比较）。
 *
 * 设置页的表格与写进 llm-pi-ai 的 `models` 用同一个顺序：用户在设置页里看到的
 * 第一行，就是模型选择器里的第一项。
 * @param models - 模型条目数组。
 * @returns 排好序的新数组（不改入参）。
 */
export function sortModels(models) {
  return Array.isArray(models) ? models.slice().sort(compareModelsByName) : []
}

/**
 * 把模型整理成设置页要渲染的一行。
 * @param model - hub 的模型条目。
 * @param selection - `{ [id]: { enabled, efforts } }`。
 * @returns 展示行。
 */
export function toModelRow(model, selection) {
  const id = typeof model?.id === 'string' ? model.id : ''
  const choice = selection?.[id]
  const efforts = modelReasoningEfforts(model)
  const levels = efforts === false || efforts === undefined ? [] : Object.keys(efforts)
  const rate = modelRate(model)
  return {
    id,
    name: modelDisplayName(model),
    description: typeof model?.description === 'string' ? model.description : '',
    vendor: typeof model?.vendor === 'string' ? model.vendor : '',
    rate,
    rateText: modelRateSuffix(model),
    contextWindow: Number(model?.context_length ?? model?.max_input_tokens) || 0,
    maxTokens: Number(model?.max_output_tokens ?? model?.max_completion_tokens) || 0,
    vision: supportsImages(model),
    tools: model?.supports_tool_calls === true || model?.capabilities?.tool_calls === true,
    reasoning: levels.length > 0,
    efforts: levels,
    defaultEffort:
      typeof model?.reasoning_default_effort === 'string' ? model.reasoning_default_effort : '',
    enabled: choice?.enabled !== false,
    selectedEfforts: Array.isArray(choice?.efforts) ? choice.efforts : null,
    retired: model?.retired === true,
    retiredAt: Number(model?.retiredAt) || 0,
  }
}

/**
 * 从响应头 `Server: wb-proxy/1.8.0 Python/3.13.14` 里取网关版本。
 *
 * `/health` 的响应体从 1.7.x 到 1.8.x 都没有 `version` 字段（两版 `_get_health()`
 * 逐字相同），版本只出现在这个头里，所以只能从这儿捡。
 * @param value - `Server` 头的值。
 * @returns 版本号（例如 `1.8.0`）；认不出返回空串。
 */
export function hubVersionFromServer(value) {
  if (typeof value !== 'string' || value === '') return ''
  const matched = /wb-proxy\/([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)/.exec(value)
  return matched === null ? '' : matched[1]
}

/**
 * 整理 `/health`。
 * @param body - hub 响应体。
 * @param headers - 响应头（键已小写）；`body` 没给版本时用其中的 `server` 兜底。
 * @returns 摘要或 null。
 */
export function summarizeHealth(body, headers = null) {
  if (body === null || typeof body !== 'object') return null
  const ok = body.ok !== false
  // 版本有两个来源。`/health` 从 1.7.x 到 1.8.x 的响应体里都没有 `version`
  // （`_get_health()` 两版逐字相同），真实值在响应头 `Server: wb-proxy/1.8.0`，
  // 所以 body 没给就回落到那里；两个都没有才是空串。
  const fromBody = typeof body.version === 'string' ? body.version : ''
  const fromHeader = hubVersionFromServer(headers?.server)
  return {
    ok,
    realm: typeof body.realm === 'string' ? body.realm : '',
    accounts: Number(body.accounts) || 0,
    accountsReady: Number(body.accounts_ready) || 0,
    apiKeyRequired: body.api_key_required === true,
    version: fromBody !== '' ? fromBody : fromHeader,
  }
}

/**
 * 整理 `/panel/status`。
 * @param body - hub 响应。
 * @returns 摘要或 null。
 */
export function summarizePanelStatus(body) {
  if (body === null || typeof body !== 'object') return null
  return {
    passwordRequired: body.panel_password_required === true,
    passwordIsDefault: body.panel_password_is_default === true,
    authenticated: body.authenticated === true,
    apiKeySet: body.api_key_set === true,
  }
}

/**
 * 整理 `/v1/balance-summary`。
 * @param body - hub 响应。
 * @returns 摘要或 null。
 */
export function summarizeBalance(body) {
  if (body === null || typeof body !== 'object') return null
  const balance = Number(body.balance)
  return {
    balance: Number.isFinite(balance) ? Math.round(balance * 100) / 100 : 0,
    unit: typeof body.unit === 'string' ? body.unit : '',
    realm: typeof body.realm === 'string' ? body.realm : '',
    accountsEnabled: Number(body.accounts_enabled) || 0,
    accountsWithCreditData: Number(body.accounts_with_credit_data) || 0,
    updatedAt: toEpochMs(body.updated_at),
  }
}

/**
 * 整理 `/accounts`（账号池）。
 *
 * 只留「会让人动手」的信息：哪个账号要重登、哪个在冷却、哪个快过期、谁在低额度。
 * 完整账号对象里有 uid 和域名字段，没有展示价值，不进快照。
 * @param body - hub 响应。
 * @param now - 当前时间戳（毫秒），用于算过期天数。
 * @returns 摘要或 null。
 */
export function summarizeAccounts(body, now = Date.now()) {
  const list = Array.isArray(body?.accounts) ? body.accounts : Array.isArray(body) ? body : null
  if (list === null) return null
  const summary = {
    total: list.length,
    enabled: 0,
    ready: 0,
    needRelogin: 0,
    inCooldown: 0,
    expired: 0,
    totalCredits: 0,
    accounts: [],
  }
  for (const account of list) {
    if (account === null || typeof account !== 'object') continue
    const enabled = account.enabled !== false
    const tokenExpired = account.tokenExpired === true
    const needRelogin = account.needRelogin === true
    const inCooldown = account.inCooldown === true
    const credits = Number(account?.credits?.remain)
    if (enabled) summary.enabled += 1
    if (enabled && !tokenExpired && !needRelogin && !inCooldown) summary.ready += 1
    if (needRelogin) summary.needRelogin += 1
    if (inCooldown) summary.inCooldown += 1
    if (tokenExpired) summary.expired += 1
    const daysLeft = countdownDays(account.expiresAt, now)
    if (Number.isFinite(credits)) summary.totalCredits += credits
    summary.accounts.push({
      nickname: typeof account.nickname === 'string' ? account.nickname : '',
      realm: typeof account.realm === 'string' ? account.realm : '',
      platform: typeof account.platform === 'string' ? account.platform : '',
      enabled,
      ready: enabled && !tokenExpired && !needRelogin && !inCooldown,
      tokenExpired,
      needRelogin,
      inCooldown,
      credits: Number.isFinite(credits) ? Math.round(credits * 100) / 100 : null,
      expiresAt: toEpochMs(account.expiresAt),
      expiresIn: typeof account.expiresIn === 'string' ? account.expiresIn : '',
      daysLeft,
      weight: Number(account.weight) || 1,
    })
  }
  summary.totalCredits = Math.round(summary.totalCredits * 100) / 100
  return summary
}

/**
 * 距离某个时间点还有几天（向上取整，已过期返回负数）。
 * @param expiresAt - 秒/毫秒时间戳。
 * @param now - 当前时间戳。
 * @returns 天数；无值返回 null。
 */
function countdownDays(expiresAt, now) {
  const stamp = toEpochMs(expiresAt)
  if (stamp <= 0) return null
  return Math.ceil((stamp - now) / 86400000)
}

/**
 * 整理 `/usage`。
 *
 * `by_model` 是对象，按花费排序后只留前若干个：一个开了 20 个模型的 hub
 * 会把整个快照撑到几十 KB，而设置页只画一张前 N 的条形图。
 * @param body - hub 响应。
 * @param limit - `by_model` 最多保留几条。
 * @returns 摘要或 null。
 */
export function summarizeUsage(body, limit = 12) {
  if (body === null || typeof body !== 'object') return null
  const requests = Number(body.requests) || 0
  const errors = Number(body.errors) || 0
  const totalTokens = Number(body.total_tokens) || 0
  const cachedTokens = Number(body.cached_tokens) || 0
  const byModel = []
  const source = body.by_model !== null && typeof body.by_model === 'object' ? body.by_model : {}
  for (const [id, entry] of Object.entries(source)) {
    if (entry === null || typeof entry !== 'object') continue
    byModel.push({
      id,
      requests: Number(entry.requests) || 0,
      credit: round2(Number(entry.credit) || 0),
      costCny: round2(Number(entry.cost_cny) || 0),
      totalTokens: Number(entry.total_tokens) || 0,
    })
  }
  byModel.sort((left, right) => right.costCny - left.costCny || right.requests - left.requests)
  return {
    requests,
    errors,
    errorRate: requests > 0 ? Math.round((errors / requests) * 1000) / 10 : 0,
    promptTokens: Number(body.prompt_tokens) || 0,
    completionTokens: Number(body.completion_tokens) || 0,
    reasoningTokens: Number(body.reasoning_tokens) || 0,
    cachedTokens,
    totalTokens,
    cacheHitRate: totalTokens > 0 ? Math.round((cachedTokens / totalTokens) * 1000) / 10 : 0,
    credit: round2(Number(body.credit) || 0),
    costCny: round2(Number(body.cost_cny) || 0),
    started: toEpochMs(body.started),
    byModel: byModel.slice(0, Math.max(1, Number(limit) || 12)),
  }
}

/** 保留两位小数。 */
function round2(value) {
  return Math.round(value * 100) / 100
}

/**
 * 稳定的 JSON 序列化（对象键递归排序）。
 *
 * 用来比较「现有路由配置」和「目标路由配置」是否等价：直接 `JSON.stringify`
 * 会被键序影响，于是同样的内容会被判成不同，每轮都白写一次配置。
 * @param value - 任意可 JSON 化的值。
 * @returns 键序稳定的字符串。
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  const keys = Object.keys(value).sort()
  const parts = []
  for (const key of keys) {
    if (value[key] === undefined) continue
    parts.push(`${JSON.stringify(key)}:${canonicalJson(value[key])}`)
  }
  return `{${parts.join(',')}}`
}

/**
 * 现有路由配置是否已经等于目标配置。
 *
 * 只遍历 target 的键：现有配置里可能还有用户手动加的 `headers`、`timeoutMs`
 * 之类字段，插件不该因为它们存在就判定「不一致」并反复重写。
 * @param current - 当前配置。
 * @param target - 目标配置。
 * @returns 是否等价。
 */
export function routeConfigMatches(current, target) {
  if (current === null || typeof current !== 'object') return false
  for (const key of Object.keys(target)) {
    if (canonicalJson(current[key]) !== canonicalJson(target[key])) return false
  }
  return true
}

/**
 * 秒 / 毫秒 / 字符串三种时间戳统一成毫秒。
 * @param value - 时间戳。
 * @returns 毫秒时间戳；无效返回 0。
 */
export function toEpochMs(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return 0
    // hub 用秒（`updated_at: 1792760426.5`），DSH 侧用毫秒：小于 1e12 的当秒。
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value)
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) return toEpochMs(numeric)
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

/**
 * 算下一轮轮询的间隔。
 *
 * 连续失败时指数退避（间隔翻倍，最多 5 次翻倍、上限 30 分钟），
 * 既不会在 hub 掉线时每 2 分钟硬撞一次，也不会退避到「用户改好了要等半小时」。
 * @param baseSeconds - 基础间隔（秒）。
 * @param failures - 连续失败次数。
 * @param options.floorSeconds - 间隔下限（秒），被限流时抬高。
 * @returns 毫秒间隔。
 */
export function pollIntervalMs(baseSeconds, failures, options = {}) {
  const base = Math.max(30, Number(baseSeconds) || 120)
  const count = Math.max(0, Math.floor(Number(failures) || 0))
  const backoff = Math.min(base * 2 ** Math.min(count, 5), 1800)
  const floor = Math.max(0, Number(options.floorSeconds) || 0)
  return Math.max(backoff, floor, 15) * 1000
}

/**
 * 对齐「本轮模型清单」与「上一轮的记录」。
 *
 * 解决两个真实场景：
 *   1. hub 抖一下、`/v1/models` 少返回了几个模型 —— 直接删会让 DSH 里的模型
 *      瞬间消失、正在跑的会话选不到模型。所以下架的模型先进宽限期（默认 24h），
 *      期间仍然保留在清单里（标记 `retired`），到期才真正移除；
 *   2. 模型回来了（网络恢复或账号重新可用）—— 从宽限期里复活，不该重复提醒。
 * @param list - 本轮 hub 返回的模型数组。
 * @param previous.lastIds - 上一轮的模型 id 数组。
 * @param previous.models - 上一轮「打过标记」的模型数组。
 * @param previous.retired - 宽限期表 `{ [id]: { at, model } }`。
 * @param now - 当前时间戳。
 * @param graceMs - 宽限期毫秒数。
 * @returns `{ models, retired, added, removed }`。
 */
export function reconcileModels(list, previous, now = Date.now(), graceMs = 24 * 3600000) {
  const current = (Array.isArray(list) ? list : []).filter(
    (model) => typeof model?.id === 'string' && model.id !== '',
  )
  const currentIds = new Set(current.map((model) => model.id))
  const lastIds = Array.isArray(previous?.lastIds) ? previous.lastIds : []
  const previousModels = new Map()
  for (const model of Array.isArray(previous?.models) ? previous.models : []) {
    if (typeof model?.id === 'string' && model.id !== '') previousModels.set(model.id, model)
  }
  // 1) 先继承上一轮的宽限期表：这张表要活过「基线被重写」这件事。lastModelIds
  //    每轮都会被重新赋值成当轮清单（lib/index.js），原实现只从「本轮消失的
  //    lastIds」重建表，于是同一模型连续消失两轮（30s 就够）就会被当成从未存
  //    在过——24h 宽限期实际只生效一轮。这里先把上一轮的 retired 接过来，再合并
  //    本轮新消失的；已经在表里的保留原 at，不重置 24h。
  const keptRetired = {}
  for (const [id, entry] of Object.entries(previous?.retired ?? {})) {
    if (currentIds.has(id)) continue
    keptRetired[id] = entry
  }
  const models = current.map((model) => ({ ...model }))
  const added = current
    .map((model) => model.id)
    .filter((id) => lastIds.length > 0 && !lastIds.includes(id))
  // 2) 上一轮有、本轮没有的模型：进宽限期。
  const removed = []
  for (const id of lastIds) {
    if (currentIds.has(id)) continue
    removed.push(id)
    if (keptRetired[id] === undefined) {
      keptRetired[id] = { at: now, model: previousModels.get(id) ?? { id } }
    }
  }
  // 3) 宽限期内的模型继续留在清单里（标记 retired），到期才真正消失。
  for (const [id, entry] of Object.entries(keptRetired)) {
    const at = Number(entry?.at) || 0
    if (graceMs > 0 && now - at < graceMs) {
      models.push({ ...(entry?.model ?? { id }), id, retired: true, retiredAt: at })
    } else {
      delete keptRetired[id]
    }
  }
  return { models, retired: keptRetired, added, removed }
}

/**
 * `/accounts` 一条都不分页，一次就把全部账号吐回来；插件的按 key 余额靠它本地
 * 求和（`mainKeyBalance`），所以条数涨到某个量级之后，刷新一次的开销和「将来
 * 网关改成分页、这里静默只拿到第一页」的风险都会变大。到线给一条容量提示。
 */
export const ACCOUNTS_SOFT_LIMIT = 500

/**
 * 生成要提示给用户的告警。
 *
 * 每条告警都有稳定 key，前端可以「关掉这条」——`dismissed[key]` 记 24 小时内不再提示，
 * 否则一条「hub 连不上」会每分钟在设置页闪一次，用户只能把插件卸载掉。
 * @param input - 上下文。
 * @returns 告警数组 `[{ key, level, title, detail }]`。
 */
export function computeAlerts(input) {
  const alerts = []
  const now = Number(input?.now) || Date.now()
  const dismissed = input?.dismissed ?? {}
  const thresholds = input?.thresholds ?? {}
  const seen = (key) => {
    const at = Number(dismissed?.[key]) || 0
    return at > 0 && now - at < 86400000
  }
  const push = (key, level, title, detail) => {
    if (seen(key)) return
    alerts.push({ key, level, title, detail })
  }
  const failures = Number(input?.consecutiveFailures) || 0
  const limit = Number(thresholds.unreachablePolls) > 0 ? Number(thresholds.unreachablePolls) : 5
  if (input?.failureKind === 'auth') {
    push('auth', 'error', '面板密码不对', input?.lastError || '请检查 pwd 配置或设置页里的密码。')
  } else if (input?.failureKind === 'rate-limited') {
    push('rate-limited', 'warning', '登录被限流', input?.lastError || '密码错太多次，等一分钟再试。')
  } else if (failures >= limit) {
    push(
      'unreachable',
      'error',
      '连不上 workbuddy2api-hub',
      input?.lastError || '确认本地服务已启动（默认 http://127.0.0.1:8788）。',
    )
  }
  if (input?.apiKeyPresent === false) {
    push(
      'api-key',
      'warning',
      '缺少 hub API Key',
      '面板密码只能管理看板；真实对话需要 API Key。可在设置页填入，或让插件从面板自动获取。',
    )
  }
  const balance = Number(input?.balance?.balance)
  const low = Number(thresholds.lowCredits)
  if (Number.isFinite(balance) && Number.isFinite(low) && low > 0 && balance < low) {
    push('low-credits', 'warning', '额度偏低', `当前额度 ${balance}，低于阈值 ${low}。`)
  }
  const accounts = input?.accounts
  if (accounts !== null && typeof accounts === 'object') {
    if (Number(accounts.needRelogin) > 0) {
      push('relogin', 'warning', '有账号需要重新登录', `${accounts.needRelogin} 个账号的登录态失效了。`)
    }
    if (Number(accounts.expired) > 0) {
      push('expired', 'error', '有账号已过期', `${accounts.expired} 个账号的订阅过期了。`)
    }
    const soon = (Array.isArray(accounts.accounts) ? accounts.accounts : []).filter(
      (item) => Number.isFinite(item?.daysLeft) && item.daysLeft >= 0 && item.daysLeft <= 3,
    )
    if (soon.length > 0) {
      push('expiring', 'warning', '账号即将过期', `${soon.length} 个账号 3 天内到期。`)
    }
    const total = Number(accounts.total) || 0
    if (total >= ACCOUNTS_SOFT_LIMIT) {
      push(
        'accounts-large',
        'warning',
        '账号数到容量提示线',
        `网关里有 ${total} 个账号（提示线 ${ACCOUNTS_SOFT_LIMIT}）。/accounts 一次返回全量、没有分页，` +
          '按 key 的余额是在本地按账号求和算出来的——条数再涨，刷新开销会跟着涨，' +
          '万一网关以后改成分页，余额合计会静默偏小。',
      )
    }
  }
  return alerts
}

/**
 * 从候选里挑出一个可用地址（保留给「多地址」扩展与测试用）。
 * @param candidates - 候选地址列表。
 * @param fallback - 兜底地址。
 * @returns 第一个能归一的地址。
 */
export function pickBaseUrl(candidates, fallback = DEFAULT_BASE_URL) {
  for (const candidate of Array.isArray(candidates) ? candidates : [candidates]) {
    const normalized = normalizeBaseUrl(candidate)
    if (normalized !== '') return normalized
  }
  return normalizeBaseUrl(fallback) || DEFAULT_BASE_URL
}

/* ------------------------------------------------------------------ *
 * 多 key：标识、凭据、余额与 per-key 用量
 *
 * 一 key ↔ 一 provider 路由 ↔ 一条凭据引用。这三样一旦定了就不能改：
 * routeKey 是 DSH 配置里的键名，apiKeyEnv 是凭据库里的引用名，改了等于
 * 把用户已经选中模型的会话打断（DSH 按 provider id 解析模型）。
 * ------------------------------------------------------------------ */

/** 主 key 固定的路由键。1.0.x 单 key 版本写的就是这个名字，不能变。 */
export const MAIN_ROUTE_KEY = 'workbuddy2api-hub'

/** 主 key 固定的凭据引用名（= llm-pi-ai 路由的 apiKeyEnv）。 */
export const MAIN_API_KEY_ENV = 'WORKBUDDY2API_HUB_API_KEY'

/** 插件侧自我保护上限：网关本身不限 key 数量，这里只是防止一次写几百条路由。 */
export const DEFAULT_MAX_KEYS = 10

/**
 * 把 key 名字压成可做标识的片段。
 *
 * 网关允许中文名与各种符号，而 `routeKey` / 凭据引用名只能是稳定的 ASCII：
 * 名字里没有可用字符时退回 key id 前 8 位，保证「同名不同 key」也不会撞。
 * @param name - 网关里给 key 起的名字。
 * @param id - key id。
 * @returns 小写、连字符分隔的片段。
 */
export function keySlug(name, id = '') {
  const raw = typeof name === 'string' ? name.trim().toLowerCase() : ''
  const cleaned = raw
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '')
  if (cleaned !== '') return cleaned
  const fromId = String(id ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 8)
  return fromId !== '' ? fromId : 'key'
}

/**
 * 给一个新 key 分配路由键。
 *
 * 主 key 永远是 `workbuddy2api-hub`；其余是 `workbuddy2api-hub-<slug>`，
 * 撞名时追加 id 前 4 位，再撞就加序号——标识必须稳定且唯一，否则两条路由
 * 会互相覆盖，用户看到的模型会莫名消失。
 * @param name - key 名字。
 * @param id - key id。
 * @param taken - 已被占用的路由键。
 * @param isMain - 是否主 key。
 * @returns 路由键。
 */
export function allocateRouteKey(name, id, taken = [], isMain = false) {
  if (isMain) return MAIN_ROUTE_KEY
  const used = new Set((Array.isArray(taken) ? taken : []).filter((item) => typeof item === 'string' && item !== ''))
  const base = `${MAIN_ROUTE_KEY}-${keySlug(name, id)}`
  if (!used.has(base)) return base
  const tail = String(id ?? '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 4)
    .toLowerCase()
  const disambiguated = `${base}-${tail === '' ? 'key' : tail}`
  if (!used.has(disambiguated)) return disambiguated
  let index = 2
  while (used.has(`${disambiguated}-${index}`)) index += 1
  return `${disambiguated}-${index}`
}

/**
 * 由路由键推出凭据引用名。
 * @param routeKey - 路由键。
 * @returns 环境变量形态的引用名。
 */
export function apiKeyEnvFor(routeKey) {
  if (routeKey === MAIN_ROUTE_KEY) return MAIN_API_KEY_ENV
  const tail = String(routeKey ?? '')
    .slice(MAIN_ROUTE_KEY.length + 1)
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
  return `${MAIN_API_KEY_ENV}_${tail === '' ? 'KEY' : tail}`
}

/**
 * 归一 `/settings` 里的一行 `api_keys`。
 * @param row - 网关返回的 key 行。
 * @returns `{ hubKeyId, name, masked, enabled, source, models, accounts }`；无法识别返回 null。
 */
export function normalizeHubKeyRow(row) {
  if (row === null || typeof row !== 'object') return null
  const id = typeof row.id === 'string' ? row.id.trim() : ''
  if (id === '') return null
  const name = typeof row.name === 'string' && row.name.trim() !== '' ? row.name.trim() : `key-${id.slice(0, 4)}`
  return {
    hubKeyId: id,
    name,
    masked: typeof row.masked === 'string' ? row.masked : '',
    enabled: row.enabled !== false,
    source: typeof row.source === 'string' ? row.source : 'panel',
    realm: typeof row.realm === 'string' ? row.realm : '',
    models: Array.isArray(row.models) ? row.models.filter((item) => typeof item === 'string') : [],
    accounts: Array.isArray(row.accounts) ? row.accounts.filter((item) => typeof item === 'string') : [],
  }
}

/**
 * 把 `/settings.api_keys` 整理成 key 行数组（保持网关顺序）。
 * @param body - `/settings` 响应体。
 * @returns key 行数组。
 */
export function keyRowsOf(body) {
  const rows = Array.isArray(body?.api_keys) ? body.api_keys : []
  return rows.map((row) => normalizeHubKeyRow(row)).filter((row) => row !== null)
}

/**
 * 主 key 绑定的账号在网关里还存着多少余额。
 *
 * 网关的 `/v1/balance-summary` 是「整个 realm」的汇总，不能按 key 拆；
 * `/accounts` 才是账号级数据，key 行里的 `accounts[]` 给出绑定关系，于是
 * 主 key 的余额 = 它绑定的那些账号的 `credits.remain` 之和。全部用已经拉到的
 * `/accounts` 响应在本地算，不额外发请求。
 * @param accountsBody - `/accounts` 响应体。
 * @param boundIds - 主 key 绑定的账号 uid 列表。
 * @returns `{ bound, found, enabled, missing, remain }`。
 */
export function mainKeyBalance(accountsBody, boundIds) {
  const list = Array.isArray(accountsBody?.accounts)
    ? accountsBody.accounts
    : Array.isArray(accountsBody)
      ? accountsBody
      : []
  const ids = new Set(
    (Array.isArray(boundIds) ? boundIds : []).filter((item) => typeof item === 'string' && item !== ''),
  )
  const result = { bound: ids.size, found: 0, enabled: 0, missing: 0, remain: null }
  if (ids.size === 0) return result
  let sum = 0
  let has = false
  for (const account of list) {
    if (account === null || typeof account !== 'object') continue
    const uid = typeof account.uid === 'string' ? account.uid : ''
    if (uid === '' || !ids.has(uid)) continue
    result.found += 1
    if (account.enabled === false) continue
    result.enabled += 1
    const remain = Number(account?.credits?.remain)
    if (Number.isFinite(remain)) {
      sum += remain
      has = true
    }
  }
  result.missing = Math.max(0, ids.size - result.found)
  if (has) result.remain = round2(sum)
  return result
}

/**
 * `/usage/analytics` 里的合成桶（无 key / 未知 key / 建档前）不算任何一个 key。
 * @param row - `keys[]` 里的一行。
 * @returns 是否是合成行。
 */
export function isSyntheticUsageRow(row) {
  if (row === null || typeof row !== 'object') return true
  if (typeof row.source === 'string' && row.source !== 'panel') return true
  const key = typeof row.key === 'string' ? row.key : ''
  return key === '' || key.startsWith('__')
}

/**
 * 从 `/usage/analytics` 的 `keys[]` 里取某个 key 的用量。
 * @param rows - `keys[]` 数组。
 * @param hubKeyId - key id。
 * @returns 用量摘要，找不到返回 null。
 */
export function pickKeyUsage(rows, hubKeyId) {
  const wanted = typeof hubKeyId === 'string' ? hubKeyId : ''
  if (wanted === '' || !Array.isArray(rows)) return null
  const row = rows.find((item) => !isSyntheticUsageRow(item) && item?.key === wanted)
  if (row === undefined) return null
  const window = row.window !== null && typeof row.window === 'object' ? row.window : {}
  const allTime = row.all_time !== null && typeof row.all_time === 'object' ? row.all_time : {}
  const requests = Number(window.requests) || 0
  const errors = Number(window.errors) || 0
  return {
    requests,
    errors,
    errorRate: requests > 0 ? Math.round((errors / requests) * 1000) / 10 : 0,
    promptTokens: Number(window.prompt_tokens) || 0,
    completionTokens: Number(window.completion_tokens) || 0,
    totalTokens: Number(window.total_tokens) || 0,
    credit: round2(Number(window.credit) || 0),
    costCny: round2(Number(window.cost_cny) || 0),
    models: Number(window.models) || (Array.isArray(row.models) ? row.models.length : 0),
    lifetime: {
      requests: Number(allTime.requests) || 0,
      totalTokens: Number(allTime.total_tokens) || 0,
      credit: round2(Number(allTime.credit) || 0),
    },
  }
}

/**
 * 整理 `/usage/analytics` 的顶层窗口信息。
 * @param body - 响应体。
 * @returns `{ since, until, realm }`。
 */
export function summarizeAnalyticsWindow(body) {
  const window = body?.window !== null && typeof body?.window === 'object' ? body.window : {}
  return {
    since: typeof window.since === 'string' ? window.since : '',
    until: typeof window.until === 'string' ? window.until : '',
    realm: typeof body?.realm === 'string' ? body.realm : '',
  }
}

/**
 * 给新发现的 key 生成默认勾选：全部勾上、全部档位跟随模型默认。
 *
 * 用户要的是「默认全勾选」；显式 `enabled: false` 才不勾（`newModelPolicy: ignore`
 * 时由调用方自己写）。
 * @param models - 该 key 能用的模型数组。
 * @param previous - 该 key 上一轮的 `selection`。
 * @returns 新的 `{ [id]: { enabled, efforts } }`。
 */
export function seedSelection(models, previous) {
  const next = previous !== null && typeof previous === 'object' ? { ...previous } : {}
  for (const model of Array.isArray(models) ? models : []) {
    const id = typeof model?.id === 'string' ? model.id.trim() : ''
    if (id === '') continue
    if (next[id] !== undefined) continue
    next[id] = { enabled: true }
  }
  return next
}

/**
 * 把一条 key 的勾选复制到另一条 key。
 *
 * 双方都有的模型照搬源 key 的勾选；目标 key 独有的模型**保留它自己以前的勾选**
 * （没有就按「默认全选」）——否则用户在 B 上手动取消的模型，会因为同步 A 而被
 * 悄悄勾回来。
 * @param selection - 来源 `{ [id]: { enabled, efforts } }`。
 * @param models - 目标 key 的模型数组。
 * @param previous - 目标 key 原来的 `selection`（可选）。
 * @returns 目标 key 的新 `selection`。
 */
export function copySelection(selection, models, previous) {
  const source = selection !== null && typeof selection === 'object' ? selection : {}
  const own = previous !== null && typeof previous === 'object' ? previous : {}
  const next = {}
  for (const model of Array.isArray(models) ? models : []) {
    const id = typeof model?.id === 'string' ? model.id.trim() : ''
    if (id === '') continue
    const choice = source[id]
    if (choice !== undefined) {
      next[id] = { ...choice }
      continue
    }
    next[id] = own[id] === undefined ? { enabled: true } : { ...own[id] }
  }
  return next
}
