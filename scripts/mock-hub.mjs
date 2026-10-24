#!/usr/bin/env node
/**
 * workbuddy2api-hub 的本地替身，只实现本插件用到的那几个接口。
 *
 * 为什么要有个 mock：真实 hub 是个 Python 服务（`wb_proxy.py`，`Server: wb-proxy/x.y.z`），
 * 测试里既不能假设它开着，也不能让它 5 次/60 秒的登录限流把跑测试的人锁掉。这里按
 * 实测到的响应形状伪造一份，于是「地址错了 / 密码错了 / 被限流 / 没 API Key / 没有模型」
 * 这些分支都能在 CI 里稳定复现。
 *
 * 用法：
 *   node scripts/mock-hub.mjs --port 8799
 *   node scripts/mock-hub.mjs --fail-auth        # 密码永远不对（401）
 *   node scripts/mock-hub.mjs --no-api-key       # 面板里没有可用 API Key
 *   node scripts/mock-hub.mjs --empty            # 模型列表为空
 *   node scripts/mock-hub.mjs --slow 3000        # 每个请求延迟 3 秒（测超时）
 *   node scripts/mock-hub.mjs --no-panel-auth    # 面板不要求密码
 */

import { createServer } from 'node:http'

/**
 * 解析命令行参数。
 * @param argv - `process.argv.slice(2)`。
 * @returns 选项对象。
 */
function parseArgs(argv) {
  const options = {
    port: 8799,
    password: 'admin',
    failAuth: false,
    noApiKey: false,
    empty: false,
    noPanelAuth: false,
    slowMs: 0,
    quiet: false,
    apiKey: 'mock-api-key-0001',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--port') options.port = Number(argv[(index += 1)]) || options.port
    else if (arg === '--password') options.password = argv[(index += 1)] ?? options.password
    else if (arg === '--fail-auth') options.failAuth = true
    else if (arg === '--no-api-key') options.noApiKey = true
    else if (arg === '--empty') options.empty = true
    else if (arg === '--no-panel-auth') options.noPanelAuth = true
    else if (arg === '--slow') options.slowMs = Number(argv[(index += 1)]) || 0
    else if (arg === '--quiet') options.quiet = true
  }
  return options
}

/** 与真实 hub 一致的模型条目形状（`/v1/models` 的 data 元素）。 */
function modelList() {
  return [
    {
      id: 'hy4-preview',
      object: 'model',
      owned_by: 'workbuddy',
      name: 'Hy4 preview',
      description: 'Mock flagship model',
      capabilities: { vision: true, tool_calls: true, reasoning: true },
      supports_vision: true,
      supports_images: true,
      supports_tool_calls: true,
      supports_reasoning: true,
      input_modalities: ['text', 'image'],
      context_length: 960000,
      max_input_tokens: 960000,
      max_output_tokens: 64000,
      max_completion_tokens: 64000,
      context_windows: [300000, 600000, 960000],
      reasoning_efforts: ['high'],
      reasoning_default_effort: 'high',
      reasoning_can_disable: false,
      always_reasoning: true,
      credits: 'x0.29',
      vendor: 'j',
    },
    {
      id: 'hy3',
      object: 'model',
      name: 'Hy3',
      capabilities: { vision: true, tool_calls: true, reasoning: true },
      supports_images: true,
      supports_tool_calls: true,
      supports_reasoning: true,
      context_length: 192000,
      max_output_tokens: 64000,
      reasoning_efforts: ['low', 'high'],
      reasoning_default_effort: 'high',
      reasoning_can_disable: true,
      credits: 'x0.15',
      vendor: 'j',
    },
    {
      id: 'deepseek-v4.1-flash',
      object: 'model',
      name: 'DeepSeek V4.1 Flash',
      capabilities: { vision: false, tool_calls: true, reasoning: false },
      supports_images: false,
      supports_tool_calls: true,
      supports_reasoning: false,
      input_modalities: ['text'],
      context_length: 1000000,
      max_output_tokens: 32000,
      credits: 'x0.08',
      vendor: 'deepseek',
    },
  ]
}

/**
 * 本周一 00:00 的本地时间戳串（与真实 hub 的 `range=week` 口径一致：
 * `_local_midnight(days_back=tm_wday)`，即日历周、周一起算，不是「近 7 天」）。
 */
function weekStartStamp() {
  const now = new Date()
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
  const pad = (value) => String(value).padStart(2, '0')
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())} 00:00:00`
}

/**
 * 起一个 HTTP 服务。
 * @param options - {@link parseArgs} 的结果。
 * @returns node http server。
 */
export function createMockHub(options = {}) {
  const config = { port: 0, password: 'admin', apiKey: 'mock-api-key-0001', ...options }
  const state = {
    models: config.empty === true ? [] : modelList(),
    apiKeyPresent: config.noApiKey !== true,
    balance: 3712.57,
    /** 面板 Token → 签发时间。 */
    tokens: new Map(),
    /** 失败登录时间戳，用来模拟 5 次/60 秒的限流。 */
    failures: [],
  }

  const server = createServer((request, response) => {
    const delay = Number(config.slowMs) || 0
    const run = () => handle(request, response, config, state)
    if (delay > 0) setTimeout(run, delay)
    else run()
  })

  server.on('clientError', (_error, socket) => {
    // 客户端提前断开（比如插件超时 abort）不该把 mock 弄挂。
    try {
      socket.destroy()
    } catch {
      // 已经关了。
    }
  })

  return server
}

/** 写 JSON 响应。 */
function send(response, status, payload, headers = {}) {
  const text = JSON.stringify(payload)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers })
  response.end(text)
}

/** 读请求体。 */
async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

/**
 * 一个请求的完整处理。
 * @param request - node http 请求。
 * @param response - node http 响应。
 * @param config - 配置。
 * @param state - 可变状态（测试可以改它来模拟 hub 侧变化）。
 */
async function handle(request, response, config, state) {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const path = url.pathname
  const method = (request.method ?? 'GET').toUpperCase()

  /* -------------------------- mock 控制接口 -------------------------- */

  if (path === '/mock/state') {
    send(response, 200, {
      models: state.models.map((model) => model.id),
      apiKeyPresent: state.apiKeyPresent,
      balance: state.balance,
      tokens: state.tokens.size,
    })
    return
  }
  if (path === '/mock/reset') {
    state.models = config.empty === true ? [] : modelList()
    state.apiKeyPresent = config.noApiKey !== true
    state.balance = 3712.57
    state.tokens.clear()
    state.failures.length = 0
    send(response, 200, { ok: true })
    return
  }
  if (path === '/mock/models/remove') {
    const id = url.searchParams.get('id') ?? ''
    state.models = state.models.filter((model) => model.id !== id)
    send(response, 200, { ok: true, models: state.models.map((model) => model.id) })
    return
  }
  if (path === '/mock/models/add') {
    const id = url.searchParams.get('id') ?? 'mock-new-model'
    state.models.push({
      id,
      object: 'model',
      name: id,
      supports_images: false,
      supports_tool_calls: true,
      supports_reasoning: false,
      input_modalities: ['text'],
      context_length: 128000,
      max_output_tokens: 16000,
      credits: 'x0.5',
    })
    send(response, 200, { ok: true, models: state.models.map((model) => model.id) })
    return
  }
  if (path === '/mock/credits') {
    state.balance = Number(url.searchParams.get('balance') ?? '12.5')
    send(response, 200, { ok: true, balance: state.balance })
    return
  }
  if (path === '/mock/keys') {
    state.apiKeyPresent = url.searchParams.get('present') !== '0'
    send(response, 200, { ok: true, present: state.apiKeyPresent })
    return
  }

  /* ----------------------------- 公开接口 ---------------------------- */

  if (path === '/health') {
    send(response, 200, {
      ok: true,
      realm: 'cn',
      accounts: 2,
      accounts_ready: 2,
      // 真实 hub 的 /health 里这个字段恒为 true：它表达的是「/v1 需要 API Key」，
      // 与「现在配了几个 Key」无关（实测 api_key_set:false 时它依然是 true）。
      api_key_required: true,
    })
    return
  }

  if (path === '/panel/status') {
    const presented = request.headers['x-panel-token']
    send(response, 200, {
      panel_password_required: config.noPanelAuth !== true,
      panel_password_is_default: config.password === 'admin',
      authenticated: typeof presented === 'string' && state.tokens.has(presented),
      api_key_set: state.apiKeyPresent,
    })
    return
  }

  if (path === '/panel/login' && method === 'POST') {
    if (config.failAuth === true) {
      state.failures.push(Date.now())
      send(response, 401, { ok: false, error: 'invalid panel password' })
      return
    }
    const body = await readBody(request)
    const now = Date.now()
    // 真实 hub 的限流：60 秒内 5 次失败 → 429。先判限流再判密码，与实测一致。
    state.failures = state.failures.filter((at) => now - at < 60000)
    if (state.failures.length >= 5) {
      const wait = Math.max(1, Math.ceil((60000 - (now - state.failures[0])) / 1000))
      send(response, 429, { ok: false, error: `too many login attempts, please wait ${wait}s` })
      return
    }
    if (typeof body.password !== 'string' || body.password !== config.password) {
      state.failures.push(now)
      send(response, 401, { ok: false, error: 'invalid panel password' })
      return
    }
    const token = `mock-token-${state.tokens.size + 1}-${Math.random().toString(36).slice(2, 10)}`
    state.tokens.set(token, now)
    send(response, 200, { ok: true, token, using_default_password: config.password === 'admin' })
    return
  }

  if (path === '/panel/logout' && method === 'POST') {
    const token = String(request.headers['x-panel-token'] ?? '')
    state.tokens.delete(token)
    send(response, 200, { ok: true })
    return
  }

  /* ------------------------------ 面板接口 --------------------------- */

  const token = String(request.headers['x-panel-token'] ?? '')
  const authenticated = config.noPanelAuth === true || state.tokens.has(token)
  const bearer = String(request.headers.authorization ?? '').replace(/^Bearer\s+/i, '')

  /**
   * 需要鉴权的接口。真实 hub 的 `_key_ok()` 第一行是 `_panel_ok()`，
   * 所以面板 Token 能过；`Authorization: Bearer` 只认 API Key。
   */
  const requireAccess = () => {
    if (authenticated) return true
    if (bearer !== '' && bearer === config.apiKey) return true
    send(response, 401, { ok: false, error: 'panel password required' })
    return false
  }

  if (path === '/v1/models') {
    if (!requireAccess()) return
    send(response, 200, { object: 'list', data: state.models })
    return
  }

  if (path === '/v1/balance-summary') {
    if (!requireAccess()) return
    send(response, 200, {
      balance: state.balance,
      unit: 'credit',
      realm: 'cn',
      accounts_enabled: 2,
      accounts_with_credit_data: 2,
      updated_at: Date.now() / 1000,
    })
    return
  }

  if (path === '/v1/chat/completions') {
    if (!requireAccess()) return
    send(response, 200, {
      id: 'mock-completion',
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
    return
  }

  if (path === '/usage') {
    if (!requireAccess()) return
    // 真实 hub 只认 `range`（today/week/month，未知值=不过滤），`hours` 被忽略。
    // mock 照着做：today 返今日子集、week 返本周子集、其余返全量，方便测试区分。
    const range = String(url.searchParams.get('range') ?? '').trim().toLowerCase()
    const today = range === 'today' || range === 'day' || range === '1d'
    const week = range === 'week' || range === 'w'
    const totals = today
      ? { requests: 441, errors: 9, prompt_tokens: 42100000, completion_tokens: 380000,
          reasoning_tokens: 210000, cached_tokens: 39000000, total_tokens: 42765524,
          credit: 40.92, cost_cny: 6.2451 }
      : week
      ? { requests: 1207, errors: 21, prompt_tokens: 118300000, completion_tokens: 960000,
          reasoning_tokens: 480000, cached_tokens: 112000000, total_tokens: 119260000,
          credit: 118.44, cost_cny: 17.8802 }
      : { requests: 1813, errors: 38, prompt_tokens: 187393318, completion_tokens: 1493328,
          reasoning_tokens: 753366, cached_tokens: 179497887, total_tokens: 188886646,
          credit: 405.25, cost_cny: 20.968 }
    const byModel = today
      ? {
          'hy4-preview': { requests: 300, credit: 32.4, cost_cny: 4.6, total_tokens: 30000000 },
          hy3: { requests: 141, credit: 8.52, cost_cny: 1.6451, total_tokens: 12765524 },
        }
      : week
      ? {
          'hy4-preview': { requests: 820, credit: 92.1, cost_cny: 13.9, total_tokens: 90000000 },
          hy3: { requests: 387, credit: 26.34, cost_cny: 3.9802, total_tokens: 29260000 },
        }
      : {
          'hy4-preview': { requests: 1200, credit: 300.5, cost_cny: 15.2, total_tokens: 150000000 },
          hy3: { requests: 613, credit: 104.75, cost_cny: 5.768, total_tokens: 38886646 },
        }
    send(response, 200, {
      ...totals,
      started: Date.now() / 1000 - 3600,
      since: today
        ? new Date().toISOString().slice(0, 10) + ' 00:00:00'
        : week
        ? weekStartStamp()
        : '2026-10-23 14:56:58',
      by_model: byModel,
    })
    return
  }

  if (path === '/accounts') {
    if (!requireAccess()) return
    send(response, 200, {
      accounts: [
        {
          uid: 'mock-uid-1',
          nickname: '🐾',
          domain: 'www.codebuddy.cn',
          realm: 'cn',
          platform: 'CLI',
          product: 'workbuddy',
          enabled: true,
          tasksEnabled: true,
          weight: 1,
          disabledModels: [],
          source: 'oauth',
          expiresAt: Math.floor(Date.now() / 1000) + 27 * 86400,
          expiresIn: '27 days',
          tokenExpired: false,
          needRelogin: false,
          inCooldown: false,
          credits: { remain: 1347.33, used: 665.67, size: 2013 },
        },
        {
          uid: 'mock-uid-2',
          nickname: 'second',
          realm: 'cn',
          platform: 'CLI',
          enabled: true,
          expiresAt: Math.floor(Date.now() / 1000) + 2 * 86400,
          expiresIn: '2 days',
          tokenExpired: false,
          needRelogin: false,
          inCooldown: false,
          credits: { remain: 88.5 },
        },
      ],
    })
    return
  }

  if (path === '/settings') {
    if (!requireAccess()) return
    send(response, 200, {
      panel_password_is_default: config.password === 'admin',
      api_key_set: state.apiKeyPresent,
      api_keys: state.apiKeyPresent
        ? [
            {
              id: 'mockkey01',
              name: 'local',
              masked: 'mock******0001',
              enabled: true,
              source: 'panel',
              created_at: '2026/10/19 11:49',
            },
          ]
        : [],
      limits: {},
    })
    return
  }

  if (path === '/settings/reveal') {
    if (!requireAccess()) return
    const id = url.searchParams.get('id') ?? ''
    if (id === '' || state.apiKeyPresent !== true) {
      send(response, 404, { error: 'no such key' })
      return
    }
    send(response, 200, { id, key: config.apiKey })
    return
  }

  if (path === '/' || path === '/dashboard.html') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>WorkBuddy 用量看板</title><p>mock dashboard</p>')
    return
  }

  send(response, 404, { error: `no such endpoint: ${path}` })
}

/* -------------------------- 命令行入口 -------------------------- */

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('mock-hub.mjs')) {
  const options = parseArgs(process.argv.slice(2))
  const server = createMockHub(options)
  server.listen(options.port, '127.0.0.1', () => {
    if (options.quiet !== true) {
      console.log(`mock-hub listening on http://127.0.0.1:${options.port} (pwd=${options.password})`)
    }
  })
  const stop = () => server.close(() => process.exit(0))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

export { parseArgs, modelList }
