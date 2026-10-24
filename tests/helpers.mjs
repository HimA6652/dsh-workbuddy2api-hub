/**
 * 测试脚手架：一套最小的假 cordis 上下文 + 假的 node http 请求/响应。
 *
 * 这些测试**不启动 DSH**，只把插件当成普通 ESM 模块加载。理由：真起 DSH 要拉起整个
 * web 应用、要一个 profile、还要几秒钟的加载，CI 里既慢又不稳；而插件对宿主的所有依赖
 * 都收敛在 ctx.get / ctx.inject / ctx.effect / webServer.register 四个调用上，
 * 用假的替身覆盖这四点，就等于覆盖了插件与宿主之间的全部契约。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createMockHub } from '../scripts/mock-hub.mjs'

/**
 * 造一个假的宿主上下文。
 * @param options.documentPath - 假 settings 的 documentPath（决定状态文件落哪）。
 * @param options.credentials - 初始凭据表 `{ ref: value }`。
 * @param options.settingsEntries - 假 settings.describe() 返回的配置行。
 * @param options.noCredentials - 为 true 时 `ctx.get('credentials')` 返回 undefined。
 * @param options.noSettings - 为 true 时 `ctx.get('settings')` 返回 undefined。
 * @returns 假 ctx（挂在 `__` 上的字段供断言用）。
 */
export async function makeCtx(options = {}) {
  const dir = options.dir ?? (await mkdtemp(join(tmpdir(), 'wb-hub-test-')))
  const documentPath = options.documentPath ?? join(dir, 'cordis.patch.yml')
  const credentials = new Map(Object.entries(options.credentials ?? {}))
  /** describe() 返回的配置行；mutate 时同步更新，模拟宿主的真实行为。 */
  const entries = options.settingsEntries ?? [{ ns: 'llm-pi-ai', revision: 1, value: { providers: {} } }]

  const mutations = []
  const conflicts = []
  let revision = 2

  const settings = {
    documentPath,
    describe() {
      return entries.map((entry) => ({ ...entry }))
    },
    async mutate(ns, ops, expected) {
      const entry = entries.find((item) => item.ns === ns)
      if (entry === undefined) throw new Error(`no such namespace: ${ns}`)
      if (Number.isFinite(expected) && expected !== entry.revision) {
        const error = new Error(`settings: ${ns} revision conflict`)
        error.name = 'SettingsConflictError'
        conflicts.push(ns)
        throw error
      }
      mutations.push({ ns, ops })
      for (const op of ops) applyOp(entry.value, op)
      entry.revision = revision
      revision += 1
      return { revision: entry.revision }
    },
  }

  const credentialsService = {
    async resolve(ref) {
      const value = credentials.get(ref)
      return value === undefined ? undefined : { value }
    },
    async set(ref, value) {
      credentials.set(ref, value)
    },
  }

  const routes = []
  const effects = []
  const webServer = {
    register(route) {
      if (routes.some((item) => item.kind === route.kind && item.path === route.path)) {
        throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
      }
      routes.push(route)
      return () => {
        const index = routes.indexOf(route)
        if (index >= 0) routes.splice(index, 1)
      }
    },
  }

  const ctx = {
    __dir: dir,
    __documentPath: documentPath,
    __credentials: credentials,
    __entries: entries,
    __mutations: mutations,
    __conflicts: conflicts,
    __routes: routes,
    __effects: effects,
    get(name) {
      if (name === 'settings') return options.noSettings === true ? undefined : settings
      if (name === 'credentials') return options.noCredentials === true ? undefined : credentialsService
      if (name === 'webServer') return webServer
      return undefined
    },
    inject(names, callback) {
      // 真实 cordis 会等这些服务就绪再回调，并把注入的服务挂到子上下文上
      // （插件里写的是 `webCtx.webServer.register(...)`）。这里照做。
      const missing = names.filter((item) => ctx.get(item) === undefined)
      if (missing.length > 0) return undefined
      const child = {}
      for (const key of Object.keys(ctx)) child[key] = ctx[key]
      for (const item of names) child[item] = ctx.get(item)
      return callback(child)
    },
    effect(factory, label) {
      const dispose = factory()
      effects.push({ label, dispose })
      return dispose
    },
  }

  /** 收尾：跑掉所有 dispose，避免测试进程挂着定时器。 */
  ctx.__dispose = () => {
    for (const effect of effects.reverse()) {
      try {
        effect.dispose?.()
      } catch {
        // 收尾失败不影响断言。
      }
    }
  }

  return ctx
}

/** 按 settings 的 op 语义改值（只实现 `set` / `unset`，与插件实际用到的子集一致）。 */
function applyOp(root, op) {
  const path = Array.isArray(op?.path) ? op.path.map(String) : []
  if (path.length === 0) return
  if (op.op === 'unset') {
    let cursor = root
    for (const key of path.slice(0, -1)) {
      if (cursor === null || typeof cursor !== 'object') return
      cursor = cursor[key]
    }
    if (cursor !== null && typeof cursor === 'object') delete cursor[path.at(-1)]
    return
  }
  if (op.op !== 'set') return
  let cursor = root
  for (const key of path.slice(0, -1)) {
    if (cursor[key] === null || typeof cursor[key] !== 'object') cursor[key] = {}
    cursor = cursor[key]
  }
  cursor[path.at(-1)] = op.value
}

/**
 * 假请求对象，只带插件真正会读的字段。
 * @param options - `method`、`url`、`headers`、`body`、`remoteAddress`。
 */
export function makeRequest(options = {}) {
  const body = options.body === undefined ? '' : JSON.stringify(options.body)
  const headers = {}
  for (const [key, value] of Object.entries(options.headers ?? {})) headers[key.toLowerCase()] = value
  if (body !== '' && headers['content-type'] === undefined) headers['content-type'] = 'application/json'
  const request = {
    method: options.method ?? 'GET',
    url: options.url ?? '/',
    headers,
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
  }
  // 插件用 `for await (const chunk of request)` 读 body。
  request[Symbol.asyncIterator] = async function* iterate() {
    if (body !== '') yield Buffer.from(body, 'utf8')
  }
  return request
}

/**
 * 假响应对象：把 status / headers / body 收集起来。
 */
export function makeResponse() {
  const response = {
    status: 0,
    headers: {},
    text: '',
    finished: false,
    writeHead(status, headers) {
      response.status = status
      Object.assign(response.headers, headers ?? {})
      return response
    },
    end(chunk) {
      if (chunk !== undefined) response.text += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      response.finished = true
    },
  }
  return response
}

/**
 * 请求一次插件路由。
 * @param handler - 插件的 handle 函数。
 * @param ctx - 假上下文。
 * @param runtime - 运行期实例。
 * @param options - 透传给 {@link makeRequest}。
 * @returns `{ status, headers, body }`，body 已 JSON.parse（解析失败时保留原文）。
 */
export async function call(handler, runtime, options = {}) {
  const request = makeRequest(options)
  const response = makeResponse()
  await handler(runtime, request, response)
  let body
  try {
    body = response.text === '' ? undefined : JSON.parse(response.text)
  } catch {
    body = response.text
  }
  return { status: response.status, headers: response.headers, body, raw: response }
}

/** 轮询直到条件成立（最多 `timeoutMs` 毫秒）。 */
export async function waitFor(predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() > deadline) throw new Error('waitFor 超时')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

/**
 * 起一个 mock hub 并监听随机端口。
 * @param options - 透传给 {@link createMockHub}。
 * @returns `{ server, base }`，`base` 形如 `http://127.0.0.1:53211`。
 */
export async function startMockHub(options = {}) {
  const server = createMockHub({ quiet: true, ...options })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { server, base: `http://127.0.0.1:${port}` }
}

/** 关掉 mock hub（幂等）。 */
export async function stopMockHub(server) {
  if (server === undefined || server === null) return
  await new Promise((resolve) => server.close(resolve))
}
