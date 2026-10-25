/**
 * dsh-workbuddy2api-hub —— 宿主侧插件。
 *
 * 职责四件事：
 *   1. 连接本地 workbuddy2api-hub：`http://127.0.0.1:8788` + 面板密码（`pwd`）+ 页签（`tab`）；
 *   2. 用面板密码换 `X-Panel-Token`，读 hub 的 `/v1/models`、`/usage`、`/accounts`、
 *      `/v1/balance-summary`；
 *   3. 把 hub 的模型写进 llm-pi-ai 路由配置，让 DSH 的模型选择器直接出现带倍率、
 *      带上下文窗口、带思考档位的模型，并在 hub 变动后自动重写；
 *   4. 对外暴露一组 HTTP 接口，供设置页卡片展示额度/用量，并提供「打开看板」深链。
 *
 * 设计约束（都是踩过的坑，来自参考项目 dsh-workbuddy2api-panel）：
 *   - 不 import 任何 @deepseek-ai/* 运行时包。宿主加载失败会直接 exit 1，
 *     而这些包在不同版本间的导出名会变，所以只依赖 cordis 注入的服务对象。
 *   - 不做构建。宿主只要求 `main` 能被 import，所以这里就是纯 ESM。
 *   - API Key 走 credentials 服务（与 llm-pi-ai 的 `apiKeyEnv` 同一个引用名），
 *     不落盘明文；面板 Token 只存在内存，进程重启即失效重登。
 *   - 任何网络失败都降级成一条状态文本，绝不向外抛异常（宿主不能因为 hub 没开而崩）。
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import {
  DEFAULT_BASE_URL,
  DEFAULT_MAX_KEYS,
  DEFAULT_PWD,
  DEFAULT_TAB,
  MAIN_API_KEY_ENV,
  MAIN_ROUTE_KEY,
  TABS,
  allocateRouteKey,
  apiKeyEnvFor,
  buildDashboardUrl,
  buildRouteModels,
  classifyFailure,
  computeAlerts,
  copySelection,
  keyRowsOf,
  mainKeyBalance,
  modelRate,
  normalizeBaseUrl,
  normalizePwd,
  normalizeTab,
  normalizeUsageRange,
  pickKeyUsage,
  pollIntervalMs,
  reconcileModels,
  retryAfterSeconds,
  routeConfigMatches,
  seedSelection,
  sortModels,
  summarizeAccounts,
  summarizeAnalyticsWindow,
  summarizeBalance,
  summarizeHealth,
  summarizePanelStatus,
  summarizeUsage,
  toModelRow,
  toEpochMs,
  usageQuery,
} from './hub.js'

/** cordis 插件名，需与 cordis.patch.yml 里的 `id` 一致。 */
export const name = 'workbuddy-hub'

/**
 * 插件版本，随快照返回，方便在设置页确认加载的是哪一份代码。
 *
 * 直接从 package.json 读：参考项目里这里写死过版本号，之后包一路升版，
 * 设置页却一直显示旧版本，排查时被误导过一次。
 */
const PLUGIN_VERSION = (() => {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return typeof manifest.version === 'string' && manifest.version !== '' ? manifest.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

/** hub API Key 在 credentials 里的引用名，也是 llm-pi-ai 路由的 apiKeyEnv。 */
const DEFAULT_API_KEY_ENV = MAIN_API_KEY_ENV

/** llm-pi-ai 插件的 entry id（profile 里的插件实例标识）。 */
const DEFAULT_PROVIDER_ENTRY = 'llm-pi-ai'

/**
 * 写进 llm-pi-ai 的路由键名（主 key 用的那一条）。
 *
 * 刻意不用参考项目的 `workbuddy2api`，也不用本机既有的 `wb`：这两条可能已经在用户的
 * cordis.patch.yml 里手写过，插件接管别人的路由键会覆盖掉用户自己的模型清单。
 */
const DEFAULT_ROUTE_KEY = MAIN_ROUTE_KEY

/** 状态文件默认值。注意：不含 pwd 之外的任何凭据（pwd 由配置显式提供）。 */
const DEFAULT_STATE = {
  /** hub 根地址，如 http://127.0.0.1:8788。 */
  baseUrl: DEFAULT_BASE_URL,
  /** 面板密码。用户明确给了 `pwd=admin`，就按配置存；也允许在设置页覆盖。 */
  pwd: DEFAULT_PWD,
  /** 看板默认页签。 */
  tab: DEFAULT_TAB,
  /** 是否把 hub 模型同步写进 DSH（用户可关）。 */
  sync: true,
  /** 后台轮询间隔，秒。 */
  intervalSeconds: 120,
  /** llm-pi-ai 的 entry id 与路由键。 */
  providerEntry: DEFAULT_PROVIDER_ENTRY,
  routeKey: DEFAULT_ROUTE_KEY,
  apiKeyEnv: DEFAULT_API_KEY_ENV,
  /** 用户对每个模型的选择：{ [modelId]: { enabled, efforts } }。 */
  selection: {},
  lastSyncAt: 0,
  lastSyncCount: 0,
  lastSyncError: '',
  /** 用量统计窗口：today / week / month / all（hub 的 `/usage` 只认 range）。 */
  usageRange: 'today',
  /** 上一轮同步的模型 id 清单，用来判断新增/下架。 */
  lastModelIds: [],
  /** hub 已下架、但还在宽限期内的模型：`{ [id]: { at, model } }`。 */
  retired: {},
  /** 下架宽限期（小时）。 */
  retireHours: 24,
  /** hub 新上架模型的默认处理：`select` 自动勾选 / `ignore` 不勾选。 */
  newModelPolicy: 'select',
  /** 告警阈值。 */
  thresholds: { lowCredits: 50, unreachablePolls: 5 },
  /** 告警去重：`{ [key]: 上次提示时间戳 }`。 */
  dismissed: {},
  /** 面板会话可用时，自动取用面板里已有的 API Key（存进 credentials，不落状态文件）。 */
  autoApiKey: true,
  /** 上一次生效的「显式配置指纹」，用来判断用户在 YAML 里改了地址/密码。 */
  appliedConfig: '',
  /**
   * 多 key：`[{ hubKeyId, name, masked, routeKey, apiKeyEnv, selection,
   * lastModelIds, lastSyncAt, lastSyncCount, lastSyncError }]`。
   *
   * 只有这几项落盘：`hubKeyId/name/masked` 是网关侧事实，`routeKey/apiKeyEnv`
   * 建好之后**永远不改**（改了就等于让用户已选中的会话丢模型），`selection`
   * 是用户的显式选择，`lastModelIds/lastSync*` 是增量判断与提示的基准。
   * 模型清单、额度、用量全是投影，每轮重算，不落盘。
   */
  keys: [],
  /** 主 key 的 id（网关 `api_keys[].id`）。空表示还没决定/还没发现。 */
  mainKeyId: '',
  /** 主 key 在网关里消失了（被删或禁用），徽标与设置页要据此提示。 */
  mainKeyMissing: false,
  /** 最多同步几条 key（插件侧自我保护；网关本身不限数量）。 */
  maxKeys: DEFAULT_MAX_KEYS,
}

/** 单次 hub 请求的超时。本地服务 8 秒足够，超时即视为不可达。 */
const REQUEST_TIMEOUT_MS = 8000

/** 登录接口单独的超时：密码校验要跑 PBKDF2，比普通读接口慢。 */
const LOGIN_TIMEOUT_MS = 12000

/**
 * 定位状态文件所在目录。
 *
 * 优先用配置里的 `stateDir`（测试与便携安装用得上：可以钉在任意目录），
 * 其次放 profile 目录（和 cordis.patch.yml 同级），这样多 profile 之间互不干扰；
 * settings 服务不可用时退回 `~/.dsh/profiles/<DSH_PROFILE|desktop>`。
 * @param ctx - 宿主上下文。
 * @param config - 插件配置。
 * @returns 状态目录的绝对路径。
 */
function stateDirOf(ctx, config) {
  const override = typeof config?.stateDir === 'string' ? config.stateDir.trim() : ''
  if (override !== '') return resolve(override)
  try {
    const documentPath = ctx.get('settings')?.documentPath
    if (typeof documentPath === 'string' && documentPath !== '') return dirname(documentPath)
  } catch {
    // settings 还没就绪，走下面的兜底路径。
  }
  const profile = process.env.DSH_PROFILE
  if (typeof profile === 'string' && profile !== '') return join(homedir(), '.dsh', 'profiles', profile)
  return join(homedir(), '.dsh', 'profiles', 'desktop')
}

/** 等一会儿（毫秒）。 */
function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

/** 把任意异常压成一行可展示的错误文本。 */
function errorText(error) {
  if (error === null || error === undefined) return '未知错误'
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * 读状态文件；文件缺失或损坏都退回默认值（插件不能因为一个坏文件就起不来）。
 * @param ctx - 宿主上下文。
 * @returns 状态对象。
 */
async function loadState(ctx, config) {
  const file = join(stateDirOf(ctx, config), 'workbuddy2api-hub.json')
  try {
    const text = await readFile(file, 'utf8')
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULT_STATE }
    const merged = { ...DEFAULT_STATE, ...parsed }
    merged.selection = parsed.selection !== null && typeof parsed.selection === 'object' ? parsed.selection : {}
    merged.thresholds = { ...DEFAULT_STATE.thresholds, ...(parsed.thresholds ?? {}) }
    merged.retired = parsed.retired !== null && typeof parsed.retired === 'object' ? parsed.retired : {}
    return merged
  } catch {
    return { ...DEFAULT_STATE }
  }
}

/**
 * 原子写状态文件：先写临时文件再 rename，避免轮询写入时被读到半个文件。
 * @param ctx - 宿主上下文。
 * @param state - 要保存的状态。
 * @returns 实际写入的文本。
 */
async function saveState(ctx, config, state) {
  const dir = stateDirOf(ctx, config)
  const file = join(dir, 'workbuddy2api-hub.json')
  await mkdir(dir, { recursive: true })
  const text = serializeState(state)
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, text, 'utf8')
  await rename(temp, file)
  return text
}

/**
 * 状态对象的磁盘格式。
 *
 * 写盘前比较用它：内容没变就不写，省掉「每 2 分钟一次」的无效写入。
 * @param state - 状态对象。
 * @returns 要写进文件（以及用于比较）的字符串。
 */
function serializeState(state) {
  return `${JSON.stringify(state, null, 2)}\n`
}

/**
 * 读一个凭据引用。
 *
 * credentials 服务的 `resolve` 会按「进程环境 → 凭据库」的顺序取值，
 * 因此用户在设置页里填的 Key 和 `set WORKBUDDY2API_HUB_API_KEY=...` 都生效。
 * @param ctx - 宿主上下文。
 * @param ref - 引用名。
 * @param options.waitMs - 最多等多久（DSH 刚启动时凭据服务可能还没注册）。
 * @returns Key 明文，或空串。
 */
async function readCredential(ctx, ref, options = {}) {
  const deadline = Date.now() + Math.max(0, Number(options.waitMs) || 0)
  for (;;) {
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      try {
        const resolved = await credentials.resolve(ref)
        const value = typeof resolved === 'string' ? resolved : resolved?.value
        if (typeof value === 'string' && value !== '') return value
        // 服务可用、但确实没有这个 key：不用再等，直接看环境变量兜底。
        break
      } catch {
        // 凭据库刚启动、还没 hydrate 完时 resolve 会抛：当作「还没准备好」继续等。
      }
    }
    // DSH 刚启动时凭据服务可能还没注册（`ctx.get('credentials')` 是 undefined）。
    // 这时候直接发请求会光着发出去，被 hub 401，用户看到「鉴权失败」——
    // 而实际上只是还没读到。给它一点时间，别把时序问题报成配置问题。
    if (Date.now() >= deadline) break
    await sleep(120)
  }
  const fromEnv = process.env[ref]
  return typeof fromEnv === 'string' ? fromEnv : ''
}

/**
 * 写一个凭据引用。
 * @param ctx - 宿主上下文。
 * @param ref - 引用名。
 * @param value - 明文。
 * @returns 是否写成功（credentials 不可用时不抛异常，交给调用方决定降级）。
 */
async function writeCredential(ctx, ref, value) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined || typeof credentials.set !== 'function') return false
  await credentials.set(ref, value)
  return true
}

/**
 * 一次 hub HTTP 调用的极薄封装。
 *
 * 返回 `{ status, ok, body, text, timeoutMs }`；网络错误时 `status` 为 0，
 * 这样上层用同一套 {@link classifyFailure} 就能分类，不需要 try/catch 满天飞。
 * @param url - 完整 URL。
 * @param options - `method`、`headers`、`body`、`timeoutMs`。
 * @returns 响应摘要。
 */
async function requestJson(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : REQUEST_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const headers = { accept: 'application/json', ...(options.headers ?? {}) }
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body,
      signal: controller.signal,
    })
    const text = await response.text()
    let body
    try {
      body = JSON.parse(text)
    } catch {
      body = undefined
    }
    return { status: response.status, ok: response.ok, body, text, timeoutMs }
  } catch (error) {
    const aborted = error?.name === 'AbortError' || error?.name === 'TimeoutError'
    return {
      status: 0,
      ok: false,
      body: undefined,
      text: aborted ? `请求超时（${timeoutMs}ms）` : errorText(error),
      timeoutMs,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 面板会话：管 `pwd` → `X-Panel-Token` 的换取、缓存与失效重登。
 *
 * hub 的面板 Token 只接受 `X-Panel-Token` 头（`wb_proxy.py` 的 `_panel_token()`，
 * 刻意不支持 query string），且**不能**当 `Authorization: Bearer` 用——
 * `identify_key` 只认配置的 API Key。所以这里分成两套凭据：
 * 面板 Token 用于管理接口，API Key 用于 `/v1` 推理接口。
 */
class HubSession {
  /**
   * @param options - `baseUrl`、`pwd`、`timeoutMs`。
   */
  constructor(options = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl) || DEFAULT_BASE_URL
    this.pwd = normalizePwd(options.pwd)
    this.timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : REQUEST_TIMEOUT_MS
    /** 面板 Token，只在内存里。 */
    this.token = ''
    /** 登录失败的种类（供告警使用）。 */
    this.lastFailure = null
  }

  /** 改地址/密码后必须丢掉旧 Token，否则会拿着别的实例的 Token 去请求。 */
  configure(options = {}) {
    const base = normalizeBaseUrl(options.baseUrl)
    const pwd = normalizePwd(options.pwd)
    if (base !== '' && base !== this.baseUrl) {
      this.baseUrl = base
      this.token = ''
    }
    if (pwd !== this.pwd) {
      this.pwd = pwd
      this.token = ''
    }
    if (Number(options.timeoutMs) > 0) this.timeoutMs = Number(options.timeoutMs)
  }

  /** 是否已经拿到面板 Token。 */
  get loggedIn() {
    return this.token !== ''
  }

  /** 免鉴权的一次 GET，用于 `/health`、`/panel/status`。 */
  async publicGet(pathname, options = {}) {
    return requestJson(`${this.baseUrl}${pathname}`, { timeoutMs: options.timeoutMs ?? this.timeoutMs })
  }

  /**
   * 用面板密码换 Token。
   *
   * 失败要分清三种：密码错（401，别重试，会触发限流）、被限流（429，等 Ns）、
   * 连不上（status 0）。hub 的限流是 60 秒内 5 次失败，所以这里绝不自动重试登录。
   * @returns `{ ok, token, failure }`。
   */
  async login() {
    const result = await requestJson(`${this.baseUrl}/panel/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: this.pwd }),
      timeoutMs: LOGIN_TIMEOUT_MS,
    })
    if (result.status === 200 && typeof result.body?.token === 'string' && result.body.token !== '') {
      this.token = result.body.token
      this.lastFailure = null
      return { ok: true, token: this.token, usingDefaultPassword: result.body.using_default_password === true }
    }
    const failure = classifyFailure(result)
    this.lastFailure = failure
    this.token = ''
    return { ok: false, failure }
  }

  /**
   * 带面板 Token 的 GET；Token 过期（401/403）自动重登一次。
   *
   * 只重登一次是刻意的：密码真错了的话，第二次一定还是 401，继续试只会把
   * 面板限流撞满（5 次/60 秒）。
   * @param pathname - 路径 + 查询串。
   * @param options - `timeoutMs`、`allowAnonymous`。
   * @returns 响应摘要。
   */
  async authGet(pathname, options = {}) {
    const headers = this.token === '' ? {} : { 'x-panel-token': this.token }
    let result = await requestJson(`${this.baseUrl}${pathname}`, {
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      headers,
    })
    if (result.status === 401 || result.status === 403) {
      if (options.allowAnonymous === true && this.token === '') return result
      const relogin = await this.login()
      if (!relogin.ok) return { ...result, status: result.status, text: relogin.failure?.message ?? result.text }
      result = await requestJson(`${this.baseUrl}${pathname}`, {
        timeoutMs: options.timeoutMs ?? this.timeoutMs,
        headers: { 'x-panel-token': this.token },
      })
    }
    return result
  }

  /**
   * 带 API Key 的 GET（`Authorization: Bearer`）。
   *
   * 多 key 场景下每个 key 的模型清单可能不同（网关支持按 key 限制模型），
   * 所以必须用**该 key 自己的明文**去问 `/v1/models`，不能拿面板 Token 代劳。
   * 401 时不做任何重试：key 错了就是错了，重试只会放大日志。
   * @param pathname - 路径 + 查询串。
   * @param apiKey - 该 key 的明文。
   * @param options - `timeoutMs`。
   * @returns 响应摘要。
   */
  async bearerGet(pathname, apiKey, options = {}) {
    const key = typeof apiKey === 'string' ? apiKey.trim() : ''
    const headers = key === '' ? {} : { authorization: `Bearer ${key}` }
    return requestJson(`${this.baseUrl}${pathname}`, {
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      headers,
    })
  }
}

/**
 * 把 hub 模型写进 llm-pi-ai 的 provider 路由。
 *
 * 写的是 profile patch 里的 volatile 字段（`providers` 整棵是 `z.dict(...).volatile()`），
 * llm-pi-ai 监听 `loader/volatile-update` 后自行重注册模型，所以不需要重启 DSH。
 *
 * 关键点：`compat.supportsReasoningEffort` 必须显式置 true。pi-ai 默认按 URL
 * 猜这个能力，`127.0.0.1` / 局域网 IP 会被判成「不支持 reasoning_effort」，
 * 于是思考档位静默失效——hub 的 `reasoning_efforts` 就白同步了。
 * @param settings - settings 服务。
 * @param entryId - llm-pi-ai 的 entry id。
 * @param ops - mutate 操作数组。
 * @param revision - 期望的 revision。
 * @returns 实际使用的 revision。
 */
async function mutateWithRetry(settings, entryId, ops, revision) {
  try {
    await settings.mutate(entryId, ops, revision)
    return revision
  } catch (error) {
    const text = errorText(error)
    if (!/revision|conflict|stale|并发/i.test(text)) throw error
    const fresh = settings.describe().find((row) => row.ns === entryId)
    if (fresh === undefined || fresh.revision === revision) throw error
    await settings.mutate(entryId, ops, fresh.revision)
    return fresh.revision
  }
}

/**
 * 组装写进 llm-pi-ai 的 provider 目标配置。
 * @param base - hub 根地址。
 * @param apiKeyEnv - 凭据引用名。
 * @param routeModels - 模型档案数组。
 * @param displayName - 选择器里显示的 provider 名（多 key 时用网关里的 key 名）。
 * @returns provider 配置对象。
 */
function buildRouteTarget(base, apiKeyEnv, routeModels, displayName = 'WorkBuddy Hub') {
  return {
    displayName: typeof displayName === 'string' && displayName !== '' ? displayName : 'WorkBuddy Hub',
    api: 'openai-completions',
    baseURL: `${base}/v1`,
    apiKeyEnv,
    compat: { supportsReasoningEffort: true, thinkingFormat: 'openai' },
    models: routeModels,
  }
}

/**
 * 把若干条 key 的模型一次性写进 llm-pi-ai。
 *
 * 每条 key 一条路由、一条凭据，互不共享：这样「A key 的模型集」与「B key 的
 * 模型集」不会互相顶掉，用户删掉某条 key 也只影响它自己那条路由。
 * 所有改动合成**一次** mutate —— 逐条 mutate 会撞 revision，而且每次都触发
 * llm-pi-ai 全量重注册。
 * @param ctx - 宿主上下文。
 * @param state - 当前状态（提供 providerEntry）。
 * @param entries - `[{ routeKey, apiKeyEnv, displayName, models, selection }]`。
 * @param baseUrl - 运行期真正连通的地址。
 * @returns `{ count, at, skipped, routes }`。
 */
async function syncRoutesToDsh(ctx, state, entries, baseUrl) {
  const settings = ctx.get('settings')
  if (settings === undefined) throw new Error('settings 服务不可用，无法写入模型')
  const entryId = state.providerEntry !== '' ? state.providerEntry : DEFAULT_PROVIDER_ENTRY
  const descriptor = settings.describe().find((row) => row.ns === entryId)
  if (descriptor === undefined) throw new Error(`找不到插件配置 "${entryId}"（llm-pi-ai 是否已启用？）`)
  // 用运行期的「当前地址」而不是 state.baseUrl：改过地址但没刷新时，
  // 写错会让 DSH 的请求打到连不上的地方。
  const base = normalizeBaseUrl(typeof baseUrl === 'string' && baseUrl !== '' ? baseUrl : state.baseUrl)
  if (base === '') throw new Error('hub 地址无效')

  const ops = []
  const routes = []
  let count = 0
  let changed = false
  for (const entry of Array.isArray(entries) ? entries : []) {
    const routeKey = typeof entry?.routeKey === 'string' && entry.routeKey !== '' ? entry.routeKey : DEFAULT_ROUTE_KEY
    const apiKeyEnv = typeof entry?.apiKeyEnv === 'string' && entry.apiKeyEnv !== '' ? entry.apiKeyEnv : DEFAULT_API_KEY_ENV
    const routeModels = buildRouteModels(entry?.models, entry?.selection)
    if (routeModels.length === 0) {
      routes.push({ routeKey, count: 0, skipped: true, empty: true })
      continue
    }
    const target = buildRouteTarget(base, apiKeyEnv, routeModels, entry?.displayName)
    const current = descriptor.value?.providers?.[routeKey]
    const unchanged = routeConfigMatches(current, target)
    if (!unchanged) {
      changed = true
      for (const [key, value] of Object.entries(target)) {
        ops.push({ op: 'set', path: ['providers', routeKey, key], value })
      }
    }
    count += routeModels.length
    routes.push({ routeKey, count: routeModels.length, skipped: unchanged })
  }
  if (count === 0) throw new Error('没有勾选任何模型（在设置页至少勾一个）')
  if (changed) await mutateWithRetry(settings, entryId, ops, descriptor.revision)
  return { count, at: changed ? Date.now() : state.lastSyncAt > 0 ? state.lastSyncAt : Date.now(), skipped: !changed, routes }
}

/**
 * 从 llm-pi-ai 配置里删掉若干条路由（key 被删/被禁用时用）。
 * @param ctx - 宿主上下文。
 * @param state - 当前状态。
 * @param routeKeys - 要删的路由键数组。
 * @returns 实际删掉的数量。
 */
async function removeRoutesFromDsh(ctx, state, routeKeys) {
  const settings = ctx.get('settings')
  if (settings === undefined) return 0
  const entryId = state.providerEntry !== '' ? state.providerEntry : DEFAULT_PROVIDER_ENTRY
  const descriptor = settings.describe().find((row) => row.ns === entryId)
  if (descriptor === undefined) return 0
  const providers = descriptor.value?.providers ?? {}
  const ops = []
  for (const routeKey of Array.isArray(routeKeys) ? routeKeys : []) {
    if (typeof routeKey !== 'string' || routeKey === '') continue
    if (providers[routeKey] === undefined) continue
    ops.push({ op: 'unset', path: ['providers', routeKey] })
  }
  if (ops.length === 0) return 0
  await mutateWithRetry(settings, entryId, ops, descriptor.revision)
  return ops.length
}

/**
 * 同步模型到 DSH。
 * @param ctx - 宿主上下文。
 * @param state - 当前状态。
 * @param models - hub 模型条目数组（已含宽限期里的下架模型）。
 * @param baseUrl - 运行期真正连通的地址。
 * @returns `{ count, at, skipped }`。
 */
async function syncModelsToDsh(ctx, state, models, baseUrl) {
  const settings = ctx.get('settings')
  if (settings === undefined) throw new Error('settings 服务不可用，无法写入模型')
  const entryId = state.providerEntry !== '' ? state.providerEntry : DEFAULT_PROVIDER_ENTRY
  const routeKey = state.routeKey !== '' ? state.routeKey : DEFAULT_ROUTE_KEY
  const descriptor = settings.describe().find((row) => row.ns === entryId)
  if (descriptor === undefined) throw new Error(`找不到插件配置 "${entryId}"（llm-pi-ai 是否已启用？）`)
  const routeModels = buildRouteModels(models, state.selection)
  if (routeModels.length === 0) throw new Error('没有勾选任何模型（在设置页至少勾一个）')
  // 用运行期的「当前地址」而不是 state.baseUrl：改过地址但没刷新时，
  // 写错会让 DSH 的请求打到连不上的地方。
  const base = normalizeBaseUrl(typeof baseUrl === 'string' && baseUrl !== '' ? baseUrl : state.baseUrl)
  if (base === '') throw new Error('hub 地址无效')
  const apiKeyEnv = state.apiKeyEnv !== '' ? state.apiKeyEnv : DEFAULT_API_KEY_ENV
  const target = buildRouteTarget(base, apiKeyEnv, routeModels)
  // 内容没变就别写：写一次会让 llm-pi-ai 重新注册整条路由的全部模型，
  // 每 2 分钟白做一遍既浪费也可能打扰正在跑的会话。
  const current = descriptor.value?.providers?.[routeKey]
  if (routeConfigMatches(current, target)) {
    return { count: routeModels.length, at: state.lastSyncAt > 0 ? state.lastSyncAt : Date.now(), skipped: true }
  }
  const ops = Object.entries(target).map(([key, value]) => ({
    op: 'set',
    path: ['providers', routeKey, key],
    value,
  }))
  await mutateWithRetry(settings, entryId, ops, descriptor.revision)
  return { count: routeModels.length, at: Date.now(), skipped: false }
}

/**
 * 从已存在的 llm-pi-ai 路由里读出 hub 地址，用于首次安装时自动接管。
 *
 * 用户之前手写过 `providers.workbuddy2api-hub.baseURL`（或参考项目的
 * `providers.workbuddy2api.baseURL`），那就是最可信的地址来源。
 * @param ctx - 宿主上下文。
 * @param state - 当前状态（提供 providerEntry / routeKey）。
 * @returns `{ baseUrl, apiKeyEnv }`，读不到返回 null。
 */
function readExistingRoute(ctx, state) {
  const settings = ctx.get('settings')
  if (settings === undefined || typeof settings.describe !== 'function') return null
  const entryId = state.providerEntry !== '' ? state.providerEntry : DEFAULT_PROVIDER_ENTRY
  const keys = [state.routeKey, DEFAULT_ROUTE_KEY, 'workbuddy2api', 'wb'].filter(
    (key) => typeof key === 'string' && key !== '',
  )
  const descriptor = settings.describe().find((row) => row.ns === entryId)
  for (const key of keys) {
    const route = descriptor?.value?.providers?.[key]
    if (route === null || typeof route !== 'object') continue
    const baseUrl = normalizeBaseUrl(typeof route.baseURL === 'string' ? route.baseURL : '')
    if (baseUrl === '') continue
    return {
      baseUrl,
      apiKeyEnv: typeof route.apiKeyEnv === 'string' ? route.apiKeyEnv : '',
      routeKey: key,
    }
  }
  return null
}

/**
 * 插件运行期状态：内存缓存 + 磁盘状态，全部操作串行化。
 *
 * 轮询、HTTP 请求、写盘三条路径会同时进来，用一条 promise 链保证不并发写
 * 同一份状态文件、也不会两次 mutate 撞上同一个 revision。
 */
class HubRuntime {
  /**
   * @param ctx - 宿主上下文。
   * @param config - 插件配置（cordis.patch.yml 里的 config）。
   */
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config ?? {}
    this.state = { ...DEFAULT_STATE }
    /** hub 原始模型（含宽限期里的下架模型）。 */
    this.rawModels = []
    /** 打过 UI 标记的模型。 */
    this.models = []
    this.health = null
    this.panel = null
    this.balance = null
    this.usage = null
    /** 本周用量：徽标第三行要，与 `usage`（主窗口，默认今日）分开存。 */
    this.usageWeek = null
    this.accounts = null
    this.modelsFetchedAt = 0
    this.overviewFetchedAt = 0
    this.usageFetchedAt = 0
    /** 用量窗口名：`today` / `week` / `month` / `all`（hub 只认 range）。 */
    this.usageRange = 'today'
    this.busy = Promise.resolve()
    /** 进程启动时刻：冷启动窗口内失败要快试，别退避到 4 分钟。 */
    this.bootedAt = Date.now()
    this.lastSyncError = ''
    /** 失败种类（auth / unreachable / timeout / rate-limited / http）。 */
    this.failureKind = ''
    /** 连续失败次数，用来算退避间隔。 */
    this.consecutiveFailures = 0
    /** 被限流时建议的等待秒数（本次退避的下限）。 */
    this.retryFloorSeconds = 0
    /** 被 HMR 事务挡掉、等下一次 HTTP 请求补做的同步。 */
    this.pendingSync = false
    /** 上次真正写进磁盘的内容，用来跳过「什么都没变」的写盘。 */
    this.lastPersisted = ''
    /** API Key 来源：`config` / `panel` / `credentials` / ``。 */
    this.apiKeySource = ''
    /** 上一次写进 credentials 的值，避免每轮重复写。 */
    this.persistedApiKey = ''
    /** 每条 key 的模型（含宽限期里的下架模型）：`hubKeyId → models[]`。 */
    this.keyModels = new Map()
    /** 每条 key 的运行期投影：`hubKeyId → { pulledAt, apiKeySource, lastError, skipped, usage }`。 */
    this.keyInfo = new Map()
    /** 每条 key 的明文，只在内存里（绝不落状态文件）。 */
    this.keySecrets = new Map()
    /** 明文来自哪里（config / credentials / panel）：只用于设置页展示。 */
    this.keySources = new Map()
    /** 最近一次 `/usage/analytics` 的 `keys[]`（per-key 用量的唯一精确来源）。 */
    this.analyticsKeys = []
    /** `/usage/analytics` 的窗口信息。 */
    this.analyticsWindow = null
    /** 原始 `/accounts` 响应：主 key 余额要在本地按绑定账号求和。 */
    this.accountsRaw = null
    /** 主 key 绑定账号的余额合计，`{ bound, found, enabled, missing, remain }`。 */
    this.mainKeyBalance = null
    this.newModels = []
    this.lastRemoved = []
    this.disposed = false
    this.session = new HubSession({ baseUrl: DEFAULT_BASE_URL, pwd: DEFAULT_PWD })
  }

  /**
   * 写盘，内容没变就跳过。
   * @returns 是否真的写了。
   */
  async persist() {
    const text = serializeState(this.state)
    if (text === this.lastPersisted) return false
    await saveState(this.ctx, this.config, this.state)
    this.lastPersisted = text
    return true
  }

  /** 把操作排进串行队列。 */
  run(task) {
    const next = this.busy.then(task, task)
    this.busy = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  /** 归一路径用的当前地址。 */
  get base() {
    return normalizeBaseUrl(this.state.baseUrl) || DEFAULT_BASE_URL
  }

  /** 面板密码。 */
  get pwd() {
    return normalizePwd(this.state.pwd)
  }

  /** 看板页签。 */
  get tab() {
    return normalizeTab(this.state.tab)
  }

  /** 主 key 的状态条目（没有就返回 null）。 */
  get mainKey() {
    const keys = Array.isArray(this.state.keys) ? this.state.keys : []
    return keys.find((key) => key.hubKeyId === this.state.mainKeyId) ?? null
  }

  /** 按 id 找 key 条目。 */
  keyStateOf(hubKeyId) {
    const keys = Array.isArray(this.state.keys) ? this.state.keys : []
    return keys.find((key) => key.hubKeyId === hubKeyId) ?? null
  }

  /**
   * 把 1.0.x 的单 key 状态升成多 key 状态。
   *
   * 只在 `state.keys` 不是数组（老文件）时补一条「主 key」占位：它的
   * `routeKey` / `apiKeyEnv` 直接继承顶层值，`hubKeyId` 先留空，等这一轮从
   * `/settings` 拿到真实 id 再认领——这样用户已选中的会话模型不会因为升级而丢。
   * 顶层 `routeKey` / `apiKeyEnv` / `selection` 保留不动，回滚到 1.0.12 也能用。
   */
  migrateState() {
    if (Array.isArray(this.state.keys)) return
    const legacyRouteKey = this.state.routeKey !== '' ? this.state.routeKey : DEFAULT_ROUTE_KEY
    const legacyApiKeyEnv = this.state.apiKeyEnv !== '' ? this.state.apiKeyEnv : DEFAULT_API_KEY_ENV
    this.state.keys = [
      {
        hubKeyId: '',
        name: '主 key',
        masked: '',
        routeKey: legacyRouteKey,
        apiKeyEnv: legacyApiKeyEnv,
        selection: this.state.selection !== null && typeof this.state.selection === 'object' ? this.state.selection : {},
        lastModelIds: Array.isArray(this.state.lastModelIds) ? this.state.lastModelIds : [],
        retired: this.state.retired !== null && typeof this.state.retired === 'object' ? this.state.retired : {},
        lastSyncAt: this.state.lastSyncAt,
        lastSyncCount: this.state.lastSyncCount,
        lastSyncError: '',
      },
    ]
    this.migrated = true
  }

  /** 明文的读缓存：只在内存，进程重启后重新向面板要。 */
  cacheSecret(hubKeyId, value) {
    if (typeof value === 'string' && value !== '') this.keySecrets.set(hubKeyId, value)
  }

  /**
   * 取一条 key 的明文。
   *
   * 顺序：配置里的 `apiKey`（只对主 key 生效）→ credentials 里的同名引用 →
   * 面板 `/settings/reveal?id=`。拿到就写进 credentials，让 llm-pi-ai 自己也能读；
   * 明文只在内存与凭据库里，**绝不进状态文件**。
   * @param key - key 状态条目。
   * @returns 明文；拿不到返回空串。
   */
  async keySecret(key) {
    if (key === null) return ''
    const cached = this.keySecrets.get(key.hubKeyId)
    if (typeof cached === 'string' && cached !== '') {
      if (!this.keySources.has(key.hubKeyId)) this.keySources.set(key.hubKeyId, 'cached')
      return cached
    }
    // `hubKeyId === ''` 是「网关里查不到 key、但用户自己填了一把」的手动主 key。
    const isMain = key.hubKeyId === '' || key.hubKeyId === this.state.mainKeyId
    if (isMain && typeof this.config?.apiKey === 'string' && this.config.apiKey.trim() !== '') {
      const value = this.config.apiKey.trim()
      this.apiKeySource = 'config'
      this.keySources.set(key.hubKeyId, 'config')
      this.cacheSecret(key.hubKeyId, value)
      // 用户显式写在配置里的 Key 也落一份到凭据库：别的工具/下一次启动能直接复用，
      // 但状态文件里永远只有引用名，没有明文。
      if (value !== this.persistedApiKey) {
        try {
          await writeCredential(this.ctx, apiKeyEnvFor(key.routeKey ?? MAIN_ROUTE_KEY), value)
          this.persistedApiKey = value
        } catch (error) {
          void error
        }
      }
      return value
    }
    const stored = await readCredential(this.ctx, key.apiKeyEnv, { waitMs: isMain ? 1500 : 0 })
    if (stored !== '') {
      if (isMain) this.apiKeySource = 'credentials'
      this.keySources.set(key.hubKeyId, 'credentials')
      this.cacheSecret(key.hubKeyId, stored)
      return stored
    }
    if (this.state.autoApiKey !== true || this.panel === null || key.hubKeyId === '') return ''
    const reveal = await this.session.authGet(`/settings/reveal?id=${encodeURIComponent(key.hubKeyId)}`)
    const value = typeof reveal.body?.key === 'string' ? reveal.body.key : ''
    if (value === '') return ''
    if (isMain) this.apiKeySource = 'panel'
    this.keySources.set(key.hubKeyId, 'panel')
    this.cacheSecret(key.hubKeyId, value)
    if (value !== this.persistedApiKey) {
      try {
        await writeCredential(this.ctx, key.apiKeyEnv, value)
        this.persistedApiKey = value
      } catch (error) {
        void error
      }
    }
    return value
  }

  /**
   * 网关里一条 key 都查不到时的手动主 key。
   *
   * 场景：网关还没建 key，但用户在设置页（或 profile 的凭据库）自己填了一把。
   * 1.0.x 就是这个行为；不保留的话「填了 Key 也永远不生效」，用户会以为插件坏了。
   * @returns 归一后的行；没有任何可用的 Key 时返回 null。
   */
  async manualKeyRow() {
    const configured = typeof this.config?.apiKey === 'string' ? this.config.apiKey.trim() : ''
    const stored =
      configured === '' ? await readCredential(this.ctx, DEFAULT_API_KEY_ENV, { waitMs: 800 }) : ''
    if (configured === '' && stored === '') return null
    return {
      hubKeyId: '',
      name: '手动填写的 Key',
      masked: '',
      enabled: true,
      source: 'manual',
      realm: '',
      models: [],
      accounts: [],
    }
  }

  /**
   * 认领主 key：先按凭据明文比对（升级用户原本就在用的那条），
   * 对不上就退回第一条启用的 key。**不认名字**——名字是用户随时能改的自由文本，
   * 拿它当身份会让「改了名字主 key 就换人」这种事故悄悄发生。
   * @param rows - `/settings.api_keys` 归一后的行。
   * @returns 选中的 key id（找不到返回空串）。
   */
  async pickMainKeyId(rows) {
    const list = Array.isArray(rows) ? rows : []
    if (list.length === 0) return ''
    const legacy = Array.isArray(this.state.keys) ? this.state.keys : []
    const candidateEnv =
      legacy.find((key) => key.hubKeyId === '')?.apiKeyEnv ??
      (this.state.apiKeyEnv !== '' ? this.state.apiKeyEnv : DEFAULT_API_KEY_ENV)
    const stored = await readCredential(this.ctx, candidateEnv, { waitMs: 800 })
    if (stored !== '') {
      for (const row of list) {
        const reveal = await this.session.authGet(`/settings/reveal?id=${encodeURIComponent(row.hubKeyId)}`)
        const value = typeof reveal.body?.key === 'string' ? reveal.body.key : ''
        if (value !== '' && value === stored) {
          this.cacheSecret(row.hubKeyId, value)
          return row.hubKeyId
        }
      }
    }
    const enabled = list.find((row) => row.enabled)
    return enabled !== undefined ? enabled.hubKeyId : list[0].hubKeyId
  }

  /**
   * 把 `/settings.api_keys` 对齐到 `state.keys`。
   *
   * 语义（对应设计文档 3.3）：
   *   - 新 key：分配 `routeKey` / `apiKeyEnv`（建好之后永不改），默认 `manual`，
   *     但**发现这一轮会拉一次**，否则用户第一次看到的就是一片空模型；
   *   - 老 key：只更新 `name` / `masked` / `enabled`，标识与勾选原样保留；
   *   - 消失的 key：路由要删掉，凭据保留（用户可能还要用别的工具），
   *     `deleted_api_keys` 里能查到就标成「被删」，否则标「未知」；
   *   - 主 key 消失：`mainKeyMissing = true`，**不提别的 key 上位**。
   * @param rows - `/settings.api_keys` 归一后的行。
   * @param deletedIds - `/settings.deleted_api_keys` 里的 id。
   * @returns `{ added, removedRoutes, truncated, freshIds }`。
   */
  reconcileKeys(rows, deletedIds = []) {
    const previous = Array.isArray(this.state.keys) ? this.state.keys : []
    const limit = Math.max(1, Math.min(Number(this.state.maxKeys) || DEFAULT_MAX_KEYS, 50))
    const list = (Array.isArray(rows) ? rows : []).slice(0, limit)
    const truncated = Math.max(0, (Array.isArray(rows) ? rows.length : 0) - list.length)
    // 空 id 是手动主 key（网关里查不到），别把它当成「已消失的 key」。
    const byId = new Map(previous.map((key) => [key.hubKeyId, key]))
    const taken = previous.map((key) => key.routeKey).filter((key) => typeof key === 'string' && key !== '')
    const freshIds = []
    const added = []
    const next = []
    for (const row of list) {
      const existing = byId.get(row.hubKeyId)
      if (existing !== undefined) {
        next.push({
          ...existing,
          name: row.name,
          masked: row.masked,
          enabled: row.enabled,
          accounts: row.accounts,
        })
        continue
      }
      const isMain = row.hubKeyId === this.state.mainKeyId
      const routeKey = taken.includes(MAIN_ROUTE_KEY) && !isMain
        ? allocateRouteKey(row.name, row.hubKeyId, taken, false)
        : allocateRouteKey(row.name, row.hubKeyId, taken, isMain)
      taken.push(routeKey)
      added.push(row.hubKeyId)
      freshIds.push(row.hubKeyId)
      next.push({
        hubKeyId: row.hubKeyId,
        name: row.name,
        masked: row.masked,
        enabled: row.enabled,
        accounts: row.accounts,
        routeKey,
        apiKeyEnv: apiKeyEnvFor(routeKey),
        selection: {},
        lastModelIds: [],
        retired: {},
        lastSyncAt: 0,
        lastSyncCount: 0,
        lastSyncError: '',
      })
    }
    const keep = new Set(next.map((key) => key.hubKeyId))
    const removed = previous.filter((key) => key.hubKeyId !== '' && !keep.has(key.hubKeyId))
    // 手动主 key（空 id）被丢掉时，它的主路由也要摘掉，否则留下一条谁也用不上的僵尸模型。
    const droppedManual = previous.find((key) => key.hubKeyId === '' && !keep.has(''))
    const deleted = new Set(Array.isArray(deletedIds) ? deletedIds : [])
    const removedRoutes = []
    for (const key of removed) {
      removedRoutes.push(key.routeKey)
      this.keyModels.delete(key.hubKeyId)
      this.keyInfo.set(key.hubKeyId, {
        ...(this.keyInfo.get(key.hubKeyId) ?? {}),
        missing: true,
        deleted: deleted.has(key.hubKeyId),
        pulledAt: 0,
        lastError: deleted.has(key.hubKeyId) ? '这条 key 已在网关里被删除' : '这条 key 已不在网关的 key 列表里',
      })
    }
    this.state.keys = next
    if (droppedManual !== undefined && typeof droppedManual.routeKey === 'string' && droppedManual.routeKey !== '') {
      removedRoutes.push(droppedManual.routeKey)
    }
    const mainExists = next.some((key) => key.hubKeyId === this.state.mainKeyId)
    this.state.mainKeyMissing = this.state.mainKeyId !== '' && !mainExists
    // 主 key 消失时，它的路由也必须删掉——留着就是「一选就 401」的僵尸模型。
    if (this.state.mainKeyMissing) {
      const mainRoute = previous.find((key) => key.hubKeyId === this.state.mainKeyId)?.routeKey ?? MAIN_ROUTE_KEY
      if (!removedRoutes.includes(mainRoute)) removedRoutes.push(mainRoute)
    }
    return { added, removedRoutes, truncated, freshIds }
  }

  /**
   * 用某条 key 自己的明文拉它的模型清单。
   * @param key - key 状态条目。
   * @returns 模型条数；失败返回 0 并记在 `keyInfo` 上。
   */
  async refreshKeyModels(key) {
    const info = { ...(this.keyInfo.get(key.hubKeyId) ?? {}) }
    const secret = await this.keySecret(key)
    if (secret === '') {
      info.lastError = '拿不到这条 key 的明文（面板未登录，或 key 已被删）'
      info.apiKeySource = ''
      this.keyInfo.set(key.hubKeyId, info)
      return 0
    }
    const result = await this.session.bearerGet('/v1/models', secret)
    if (!result.ok) {
      info.lastError = classifyFailure(result).message
      this.keyInfo.set(key.hubKeyId, info)
      return 0
    }
    const list = modelListOf(result.body)
    if (list === null) {
      info.lastError = 'hub 的 /v1/models 返回内容不是 OpenAI 模型列表（缺少 data 数组）'
      this.keyInfo.set(key.hubKeyId, info)
      return 0
    }
    const now = Date.now()
    const firstSync = !Array.isArray(key.lastModelIds) || key.lastModelIds.length === 0
    const reconciled = reconcileModels(
      list,
      { lastIds: key.lastModelIds, models: this.keyModels.get(key.hubKeyId) ?? [], retired: key.retired ?? {} },
      now,
      Math.max(0, Number(this.state.retireHours) || 0) * 3600000,
    )
    key.retired = reconciled.retired
    key.lastModelIds = list.map((model) => model?.id).filter((id) => typeof id === 'string' && id !== '')
    key.selection = seedSelection(reconciled.models, key.selection)
    if (!firstSync && this.state.newModelPolicy === 'ignore') {
      for (const id of reconciled.added) key.selection[id] = { enabled: false }
    }
    this.keyModels.set(key.hubKeyId, sortModels(reconciled.models))
    info.pulledAt = now
    info.lastError = ''
    info.apiKeySource = this.keySources.get(key.hubKeyId) ?? ''
    info.added = reconciled.added
    info.skipped = false
    this.keyInfo.set(key.hubKeyId, info)
    return reconciled.models.length
  }

  /**
   * 拉 `/usage/analytics` 的 per-key 用量。
   *
   * 这个接口一次给所有 key 的数据（5 MB 量级），所以按窗口缓存 55 秒：
   * 轮询间隔 30 秒时不会每轮都重拉一遍。
   * @param range - 窗口名。
   * @returns `keys[]` 数组。
   */
  async refreshAnalytics(range) {
    const wanted = normalizeUsageRange(range)
    this.analyticsCache = this.analyticsCache ?? new Map()
    const cached = this.analyticsCache.get(wanted)
    if (cached !== undefined && Date.now() - cached.at < 55000) {
      this.analyticsKeys = cached.rows
      this.analyticsWindow = cached.window
      return cached.rows
    }
    const result = await this.session.authGet(`/usage/analytics?range=${wanted}`)
    if (!result.ok || result.body === undefined) return this.analyticsKeys
    const rows = Array.isArray(result.body?.keys) ? result.body.keys : []
    const window = summarizeAnalyticsWindow(result.body)
    this.analyticsCache.set(wanted, { at: Date.now(), rows, window })
    this.analyticsKeys = rows
    this.analyticsWindow = window
    this.analyticsRange = wanted
    return rows
  }

  /** 当前会话/徽标要用的 per-key 用量：`{ [hubKeyId]: usage }`。 */
  usageByKey(range) {
    const wanted = normalizeUsageRange(range)
    this.usageCache = this.usageCache ?? new Map()
    return this.usageCache.get(wanted) ?? {}
  }

  /** 拼出要写进 DSH 的路由清单。 */
  keyEntries() {
    const entries = []
    for (const key of Array.isArray(this.state.keys) ? this.state.keys : []) {
      if (key.hubKeyId !== '' && key.hubKeyId === this.state.mainKeyId && this.state.mainKeyMissing) continue
      const models = this.keyModels.get(key.hubKeyId) ?? []
      if (models.length === 0) continue
      entries.push({
        routeKey: key.routeKey,
        apiKeyEnv: key.apiKeyEnv,
        displayName: key.name,
        models,
        selection: key.selection,
      })
    }
    return entries
  }

  /**
   * 按 key 改一个字段（`selection` 等），并落盘。
   * @param hubKeyId - key id。
   * @param patch - 改动。
   * @returns 是否找到该 key。
   */
  async updateKey(hubKeyId, patch) {
    const key = this.keyStateOf(hubKeyId)
    if (key === null) return false
    Object.assign(key, patch)
    await this.persist()
    return true
  }

  /**
   * 立刻重拉一条 key 的模型清单（全自动拉取之外的手动补救，排障用）。
   *
   * 60 秒内重复点不再打网关：这个按钮的语义是「现在就要」，不是「连点连打」。
   * @param hubKeyId - 目标 key。
   * @returns `{ ok, models, error }`。
   */
  async pullKey(hubKeyId) {
    const key = this.keyStateOf(this.targetKeyId(hubKeyId))
    if (key === null) return { ok: false, models: 0, error: '找不到这条 key' }
    const info = this.keyInfo.get(key.hubKeyId) ?? {}
    const pulledAt = Number(info.pulledAt) || 0
    if (Date.now() - pulledAt < 60000 && (this.keyModels.get(key.hubKeyId) ?? []).length > 0) {
      return { ok: true, models: (this.keyModels.get(key.hubKeyId) ?? []).length, error: '', cached: true }
    }
    const count = await this.refreshKeyModels(key)
    if (key.hubKeyId === this.state.mainKeyId) {
      this.rawModels = this.keyModels.get(key.hubKeyId) ?? []
      this.models = sortModels(this.rawModels)
      this.state.selection = key.selection ?? {}
      this.state.lastModelIds = key.lastModelIds ?? []
      this.state.retired = key.retired ?? {}
    }
    await this.persist()
    if (this.state.sync !== false) await this.resync()
    const failure = this.keyInfo.get(key.hubKeyId)?.lastError ?? ''
    return { ok: count > 0, models: count, error: failure }
  }

  /**
   * 重新指定主 key（人工介入，唯一会改 `mainKeyId` 的入口）。
   *
   * 不换 `routeKey`/`apiKeyEnv`：标识一改，凭据引用就要跟着搬，
   * 搬错一次就是「模型全在、一选就 401」。主 key 只决定「谁的数据进徽标第一行」。
   * @param hubKeyId - 目标 key。
   * @returns 是否改成功。
   */
  async setMainKey(hubKeyId) {
    const key = this.keyStateOf(hubKeyId)
    if (key === null) return false
    this.state.mainKeyId = key.hubKeyId
    this.state.mainKeyMissing = false
    this.rawModels = this.keyModels.get(key.hubKeyId) ?? []
    this.models = sortModels(this.rawModels)
    this.state.selection = key.selection ?? {}
    this.state.lastModelIds = key.lastModelIds ?? []
    this.state.retired = key.retired ?? {}
    await this.persist()
    return true
  }

  /**
   * 把一条 key 的勾选复制到其它 key。
   *
   * `copySelection` 只复制「双方都有的模型」：不同 key 看到的模型集可能不同，
   * 照搬会把对方不存在的 id 写进 selection；目标 key 独有的模型保留它自己的勾选。
   * @param fromId - 源 key。
   * @param toIds - 目标 key（缺省为除源之外的全部）。
   * @returns 复制到了几条 key。
   */
  async syncSelection(fromId, toIds) {
    const from = this.keyStateOf(this.targetKeyId(fromId))
    if (from === null) return 0
    const targets = Array.isArray(this.state.keys) ? this.state.keys : []
    const wanted = Array.isArray(toIds) && toIds.length > 0 ? new Set(toIds) : null
    let count = 0
    for (const key of targets) {
      if (key.hubKeyId === from.hubKeyId) continue
      if (wanted !== null && !wanted.has(key.hubKeyId)) continue
      const models = this.keyModels.get(key.hubKeyId) ?? []
      if (models.length === 0) continue
      key.selection = copySelection(from.selection ?? {}, models, key.selection ?? {})
      if (key.hubKeyId === this.state.mainKeyId) this.state.selection = key.selection
      count += 1
    }
    await this.persist()
    if (this.state.sync !== false) await this.resync()
    return count
  }

  /**
   * 把 cordis.patch.yml 里的显式配置合进状态。
   *
   * 语义（这是「只改配置就能换地址/密码」这条验收标准的实现）：
   *   - 配置里**显式写了**的字段，其值参与指纹；
   *   - 指纹变了（用户在 YAML 里改过）→ 覆盖状态里的同名值；
   *   - 指纹没变 → 保留状态里的值，于是「在设置页里改的」不会重启后被抹掉。
   * @param config - 插件配置。
   */
  applyConfig(config) {
    const source = config !== null && typeof config === 'object' ? config : {}
    const explicit = {}
    const baseUrl = normalizeBaseUrl(typeof source.baseUrl === 'string' ? source.baseUrl : '')
    if (baseUrl !== '') explicit.baseUrl = baseUrl
    if (typeof source.pwd === 'string' && source.pwd.trim() !== '') explicit.pwd = normalizePwd(source.pwd)
    if (typeof source.tab === 'string' && source.tab.trim() !== '') explicit.tab = normalizeTab(source.tab)
    const fingerprint = JSON.stringify(explicit)
    if (Object.keys(explicit).length > 0 && fingerprint !== this.state.appliedConfig) {
      Object.assign(this.state, explicit)
      this.state.appliedConfig = fingerprint
    }
    // 非指纹类配置每次都生效（它们是行为开关，不是「用户最后一次选择」）。
    if (typeof source.sync === 'boolean') this.state.sync = source.sync
    if (Number(source.intervalSeconds) >= 30) {
      this.state.intervalSeconds = Math.min(Math.floor(Number(source.intervalSeconds)), 3600)
    }
    if (typeof source.providerEntry === 'string' && source.providerEntry !== '') {
      this.state.providerEntry = source.providerEntry
    }
    if (typeof source.routeKey === 'string' && source.routeKey !== '') this.state.routeKey = source.routeKey
    if (typeof source.apiKeyEnv === 'string' && source.apiKeyEnv !== '') this.state.apiKeyEnv = source.apiKeyEnv
    if (typeof source.usageRange === 'string' && source.usageRange.trim() !== '') {
      this.state.usageRange = normalizeUsageRange(source.usageRange)
    }
    if (typeof source.autoApiKey === 'boolean') this.state.autoApiKey = source.autoApiKey
    if (source.newModelPolicy === 'select' || source.newModelPolicy === 'ignore') {
      this.state.newModelPolicy = source.newModelPolicy
    }
    if (Number(source.retireHours) >= 0) {
      this.state.retireHours = Math.min(Math.floor(Number(source.retireHours)), 168)
    }
    if (source.thresholds !== null && typeof source.thresholds === 'object') {
      const next = { ...this.state.thresholds }
      if (Number(source.thresholds.lowCredits) >= 0) next.lowCredits = Number(source.thresholds.lowCredits)
      if (Number(source.thresholds.unreachablePolls) > 0) {
        next.unreachablePolls = Math.floor(Number(source.thresholds.unreachablePolls))
      }
      this.state.thresholds = next
    }
    if (Number(source.maxKeys) >= 1) {
      this.state.maxKeys = Math.min(Math.floor(Number(source.maxKeys)), 50)
    }
    this.session.configure({ baseUrl: this.base, pwd: this.pwd })
  }

  /** 首次装载：读盘 + 按配置拉一次数据。 */
  async start() {
    this.state = await loadState(this.ctx, this.config)
    this.lastPersisted = serializeState(this.state)
    this.applyConfig(this.config)
    this.migrateState()
    // 老用户手写过路由：地址和 apiKeyEnv 都是现成的，首次安装时直接接过来。
    const hasExplicitBase = typeof this.config?.baseUrl === 'string' && this.config.baseUrl.trim() !== ''
    if (!hasExplicitBase && normalizeBaseUrl(this.state.baseUrl) === '') {
      const existing = readExistingRoute(this.ctx, this.state)
      if (existing !== null) this.state.baseUrl = existing.baseUrl
    }
    this.session.configure({ baseUrl: this.base, pwd: this.pwd })
    await this.persist()
    await this.refresh({ sync: true }).catch(() => undefined)
  }

  /**
   * 补做一次被推迟的同步。
   *
   * 插件在配置变更事务里被重新加载时，`settings.mutate` 会抛
   * "HMR transactions cannot be nested"，而 AsyncLocalStorage 的上下文会
   * 传染给这次加载里创建的所有定时器——也就是说后台轮询从此写不进配置。
   * HTTP 请求处理函数跑在干净上下文里，所以把补同步挂在 `/state` 上。
   * @returns 有补做就返回 true。
   */
  async flushPendingSync() {
    if (!this.pendingSync) return false
    await this.run(() => this.refresh({ sync: true }))
    return true
  }

  /**
   * 拉取 hub 数据（健康 → 面板状态 → 登录 → 模型/额度/用量/账号），必要时同步模型。
   * @param options - `sync`：是否顺带写 DSH 配置；`usageRange`：用量窗口（默认 `today`）。
   * @returns 摘要 `{ ok, models, synced, error }`。
   */
  async refresh(options = {}) {
    const base = this.base
    if (base === '') return this.fail('还没有配置 hub 地址')
    this.session.configure({ baseUrl: base, pwd: this.pwd })
    const startFailure = this.consecutiveFailures

    // 1) `/health` 免鉴权：先确认「服务活着」，这一步不消耗额度、也不触发登录限流。
    const healthResult = await this.session.publicGet('/health')
    if (!healthResult.ok) {
      this.health = null
      this.panel = null
      return this.fail(classifyFailure(healthResult).message, classifyFailure(healthResult).kind)
    }
    this.health = summarizeHealth(healthResult.body)

    // 2) `/panel/status` 也免鉴权：能读到「要不要密码」「面板里有没有 API Key」。
    const statusResult = await this.session.publicGet('/panel/status')
    this.panel = statusResult.ok ? summarizePanelStatus(statusResult.body) : null

    // 3) 面板会话。密码确实是错的（401）就不再试第二次——hub 是 5 次/60 秒限流，
    //    继续硬试会把用户锁在外面。被限流（429）则记下建议等待时间。
    if (this.panel === null || this.panel.passwordRequired || this.panel.passwordIsDefault) {
      const login = await this.session.login()
      if (!login.ok) {
        const failure = login.failure ?? { kind: 'auth', message: '面板登录失败' }
        if (failure.kind === 'rate-limited') {
          this.retryFloorSeconds = retryAfterSeconds(login.failure?.message ?? '') || 60
        }
        this.health = this.health
        return this.fail(failure.message, failure.kind)
      }
      this.retryFloorSeconds = 0
    }

    // 4) 列出网关里的所有 key（面板接口），并把它对齐到 state.keys。
    //    旧版只管一条 key；现在 key 是配置的主体，所以这一步必须在拉模型之前。
    const settingsResult = await this.session.authGet('/settings')
    if (!settingsResult.ok) {
      const failure = classifyFailure(settingsResult)
      return this.fail(failure.message, failure.kind)
    }
    let keyRows = keyRowsOf(settingsResult.body)
    // 网关里没有 key，但用户自己填过一把 → 当作手动主 key（1.0.x 的老路）。
    if (keyRows.length === 0) {
      const manual = await this.manualKeyRow()
      if (manual !== null) keyRows = [manual]
    }
    const deletedIds = (Array.isArray(settingsResult.body?.deleted_api_keys) ? settingsResult.body.deleted_api_keys : [])
      .map((row) => (typeof row === 'string' ? row : row?.id))
      .filter((id) => typeof id === 'string' && id !== '')
    // 主 key 未定时先认领一个：按凭据明文比对 → 第一条启用的 key（不认名字）。
    if (this.state.mainKeyId === '' && keyRows.length > 0) {
      this.state.mainKeyId = await this.pickMainKeyId(keyRows)
    }
    // 老状态文件里的占位条目（hubKeyId 为空）认领真实 id，路由键保持不变。
    const claiming = (Array.isArray(this.state.keys) ? this.state.keys : []).find((key) => key.hubKeyId === '')
    if (claiming !== undefined && this.state.mainKeyId !== '') {
      claiming.hubKeyId = this.state.mainKeyId
      const secret = this.keySecrets.get('')
      if (typeof secret === 'string' && secret !== '') this.cacheSecret(claiming.hubKeyId, secret)
    }
    const plan = this.reconcileKeys(keyRows, deletedIds)

    // 5) 每条 key 用自己的明文问自己的 `/v1/models`：网关支持按 key 限制模型，
    //    所以「一份清单打天下」在这里是错的。
    //
    //    一律每轮都拉。实测量过：一条 key 绑 1 个账号和绑一百多个账号，
    //    `/v1/models` 的中位耗时都是 15 ms 上下（抖动 3–32 ms），跟账号数无关——
    //    这个接口只回模型清单，不遍历账号。所以「手动拉取」这个开关没有存在理由，
    //    1.1.2 起删掉，用户少一个要想的选项。
    for (const key of Array.isArray(this.state.keys) ? this.state.keys : []) {
      await this.refreshKeyModels(key)
    }

    // 6) 额度 / 账号 / 用量。per-key 用量只有 `/usage/analytics` 能给，
    //    `/usage` 不认 `key` 参数（实测静默忽略）。
    const primaryRange = normalizeUsageRange(options.usageRange ?? this.state.usageRange ?? 'today')
    await this.refreshBalance()
    await this.refreshUsage(primaryRange)
    // 徽标第三行要「本周」，所以无论主窗口是什么都多拉一次；主窗口就是 week 时不用重复。
    if (primaryRange !== 'week') await this.refreshUsage('week')
    await this.refreshAccounts()
    this.usageCache = this.usageCache ?? new Map()
    const rows = await this.refreshAnalytics(primaryRange)
    const perKey = {}
    for (const key of Array.isArray(this.state.keys) ? this.state.keys : []) {
      const usage = pickKeyUsage(rows, key.hubKeyId)
      if (usage === null) continue
      perKey[key.hubKeyId] = usage
      this.keyInfo.set(key.hubKeyId, { ...(this.keyInfo.get(key.hubKeyId) ?? {}), usage })
    }
    this.usageCache.set(primaryRange, perKey)
    if (primaryRange !== 'week') {
      const weekRows = await this.refreshAnalytics('week')
      const weekPerKey = {}
      for (const key of Array.isArray(this.state.keys) ? this.state.keys : []) {
        const usage = pickKeyUsage(weekRows, key.hubKeyId)
        if (usage !== null) weekPerKey[key.hubKeyId] = usage
      }
      this.usageCache.set('week', weekPerKey)
    }

    const mainKey = this.mainKey
    // 主 key 余额 = 它绑定的账号在网关里还存着多少（用已拉到的 /accounts 本地求和）。
    this.mainKeyBalance = mainKey === null ? null : mainKeyBalance(this.accountsRaw, mainKey.accounts)

    // 7) 顶层字段保持「主 key 的镜像」：设置页表格、告警与 1.0.x 客户端都读这些。
    const mainModels = mainKey === null || this.state.mainKeyMissing ? [] : (this.keyModels.get(mainKey.hubKeyId) ?? [])
    this.rawModels = mainModels
    this.models = sortModels(mainModels)
    if (mainKey !== null) {
      this.state.selection = mainKey.selection ?? {}
      this.state.lastModelIds = mainKey.lastModelIds ?? []
      this.state.retired = mainKey.retired ?? {}
      this.apiKeySource = this.keyInfo.get(mainKey.hubKeyId)?.apiKeySource ?? this.apiKeySource
    }
    this.newModels = plan.added
    // 拿不到任何 key 的明文（只读体检、面板里没 key、凭据库还没建）时，
    // 面板 Token 照样读得出模型清单。清单要显示出来，但路由不写——
    // 写了也是「一选就 401」，先让用户看到告警。
    if (this.keyEntries().length === 0 && this.rawModels.length === 0) {
      const listed = await this.session.authGet('/v1/models')
      const list = listed.ok ? modelListOf(listed.body) : null
      if (list !== null && list.length > 0) {
        this.rawModels = list
        this.models = sortModels(list)
        this.state.selection = seedSelection(list, this.state.selection)
      }
    }
    this.lastRemoved = plan.removedRoutes
    this.modelsFetchedAt = Date.now()
    this.lastSyncError = ''
    this.failureKind = ''
    this.consecutiveFailures = 0
    this.retryFloorSeconds = 0

    // 8) 消失的 key（含主 key）先把路由摘掉：留着就是「一选就 401」的僵尸模型。
    if (plan.removedRoutes.length > 0) {
      try {
        await removeRoutesFromDsh(this.ctx, this.state, plan.removedRoutes)
      } catch (error) {
        if (errorText(error).includes('HMR transactions cannot be nested')) this.pendingSync = true
      }
    }

    const entries = this.keyEntries()
    let synced = 0
    if (this.state.sync !== false && options.sync !== false) {
      if (entries.length === 0) {
        this.state.lastSyncError = this.state.mainKeyMissing
          ? '主 key 已不在网关里，已停止同步（在设置页重新指定一个主 key）'
          : '还没有可用的 hub API Key，暂不写入模型（面板 Token 不能当 Bearer 用）'
        this.lastSyncError = this.state.lastSyncError
      } else {
        try {
          const result = await syncRoutesToDsh(this.ctx, this.state, entries, base)
          synced = result.count
          this.state.lastSyncAt = result.at
          this.state.lastSyncCount = result.count
          this.state.lastSyncError = ''
          this.pendingSync = false
          for (const route of result.routes) {
            const key = (this.state.keys ?? []).find((item) => item.routeKey === route.routeKey)
            if (key === undefined) continue
            key.lastSyncAt = result.at
            key.lastSyncCount = route.count
            key.lastSyncError = route.empty === true ? '这条 key 没有勾选任何模型' : ''
          }
        } catch (error) {
          const text = errorText(error)
          if (text.includes('HMR transactions cannot be nested')) {
            // 宿主正在应用配置变更，这次写不进去。留给下一次 HTTP 请求补做，
            // 不把这个内部错误当成用户能理解的问题展示。
            this.pendingSync = true
            this.state.lastSyncError = ''
            this.lastSyncError = ''
          } else {
            this.pendingSync = false
            this.state.lastSyncError = text
            this.lastSyncError = text
          }
        }
      }
    } else if (this.state.sync === false) {
      // 关掉自动同步也要落盘：lastModelIds / retired 是「新模型策略」和
      // 「下架宽限」的基准，丢了会让重启后所有模型都被当成首次导入。
      this.state.lastSyncError = ''
    }
    void startFailure
    await this.persist()
    return {
      ok: true,
      models: entries.reduce((sum, entry) => sum + entry.models.length, 0),
      keys: entries.length,
      synced,
      error: this.lastSyncError,
      truncated: plan.truncated,
    }
  }

  /**
   * 记录一次失败：错误同时写进内存状态和磁盘状态。
   *
   * 只写内存字段会让设置页读到空错误（snapshot 读的是 state.lastSyncError），
   * 用户就看不到「pwd 不对」这种最需要看到的提示。
   * @param message - 给用户看的错误文本。
   * @param kind - 失败种类。
   * @returns `{ ok: false, error }`，方便调用处直接 return。
   */
  async fail(message, kind = '') {
    this.lastSyncError = message
    this.failureKind = kind
    this.state.lastSyncError = message
    this.consecutiveFailures += 1
    this.models = []
    await this.persist()
    return { ok: false, error: message, kind }
  }

  /** 拉额度汇总（跨账号）。 */
  async refreshBalance() {
    const result = await this.session.authGet('/v1/balance-summary')
    if (!result.ok || result.body === undefined) return undefined
    this.balance = summarizeBalance(result.body)
    this.overviewFetchedAt = Date.now()
    return this.balance
  }

  /**
   * 拉用量快照。
   *
   * hub 的 `/usage` 只认 `range`（today/week/month/all），**不认 `hours`**：
   * 传 `?hours=24` 会被静默忽略，返回的是不过滤的全量历史。所以这里按
   * 窗口名请求，默认 `today`——侧边栏徽标要的就是「今日」。
   */
  async refreshUsage(range) {
    const wanted = normalizeUsageRange(range)
    const result = await this.session.authGet(usageQuery(wanted))
    if (!result.ok || result.body === undefined) {
      // `/usage` 是 panel route；面板没开密码时也许本来就不需要鉴权，
      // 这里失败就降级，不影响模型与额度。
      return undefined
    }
    const summary = summarizeUsage(result.body, 12)
    this.usageFetchedAt = Date.now()
    if (wanted === 'week') {
      // 徽标第三行固定要本周，与主窗口分开存，主窗口调成 month/all 也不会把它顶掉。
      this.usageWeek = summary
      return summary
    }
    this.usage = summary
    this.usageRange = wanted
    return summary
  }

  /** 拉账号池（保留原始响应：主 key 余额要在本地按绑定账号求和）。 */
  async refreshAccounts() {
    const result = await this.session.authGet('/accounts')
    if (!result.ok || result.body === undefined) return undefined
    this.accountsRaw = result.body
    this.accounts = summarizeAccounts(result.body, Date.now())
    return this.accounts
  }

  /**
   * 解析 `/v1` 推理接口要用的 API Key。
   *
   * 三条来源，优先级从高到低：
   *   1. 配置里的 `apiKey`（写进 credentials，引用名 = `apiKeyEnv`）；
   *   2. credentials 里已经存在的同引用名 Key（用户以前填过）；
   *   3. 面板会话可用时，从 `/settings` + `/settings/reveal?id=` 取第一个启用的 Key。
   * 明文只进 credentials 与本进程内存，**绝不写进状态文件**。
   */
  async resolveApiKey() {
    const ref = this.state.apiKeyEnv !== '' ? this.state.apiKeyEnv : DEFAULT_API_KEY_ENV
    if (typeof this.config?.apiKey === 'string' && this.config.apiKey.trim() !== '') {
      const value = this.config.apiKey.trim()
      if (value !== this.persistedApiKey) {
        try {
          await writeCredential(this.ctx, ref, value)
          this.persistedApiKey = value
        } catch (error) {
          // credentials 不可用时保留在内存里，至少本次会话能跑。
          void error
        }
      }
      this.apiKeySource = 'config'
      return value
    }
    const stored = await readCredential(this.ctx, ref, { waitMs: 1500 })
    if (stored !== '') {
      this.apiKeySource = 'credentials'
      return stored
    }
    if (this.state.autoApiKey !== true || this.panel === null) {
      this.apiKeySource = ''
      return ''
    }
    const settingsResult = await this.session.authGet('/settings')
    const keys = Array.isArray(settingsResult.body?.api_keys) ? settingsResult.body.api_keys : []
    const candidate = keys.find((item) => item?.enabled !== false && typeof item?.id === 'string' && item.id !== '')
    if (candidate === undefined) {
      this.apiKeySource = ''
      return ''
    }
    const reveal = await this.session.authGet(`/settings/reveal?id=${encodeURIComponent(candidate.id)}`)
    const value = typeof reveal.body?.key === 'string' ? reveal.body.key : ''
    if (value === '') {
      this.apiKeySource = ''
      return ''
    }
    if (value !== this.persistedApiKey) {
      try {
        await writeCredential(this.ctx, ref, value)
        this.persistedApiKey = value
      } catch (error) {
        void error
      }
    }
    this.apiKeySource = 'panel'
    return value
  }

  /**
   * 给模型打上展示用标记（已下架）。
   * @param models - 原始模型数组。
   * @returns 新数组，不修改入参。
   */
  decorate(models) {
    return (Array.isArray(models) ? models : []).map((model) =>
      model?.retired === true ? model : { ...model },
    )
  }

  /**
   * 拼出每条 key 的投影（不含任何明文）。
   *
   * 徽标、设置页 Key 列表、以及「当前会话用的是哪条 key」全靠这个数组：
   * 前端拿到 `provider` 后按 `routeKey` 反查即可，切会话不需要额外请求。
   * @returns 投影数组。
   */
  keyProjections() {
    const primary = normalizeUsageRange(this.usageRange)
    const usagePrimary = this.usageByKey(primary)
    const usageWeek = this.usageByKey('week')
    const keys = Array.isArray(this.state.keys) ? this.state.keys : []
    return keys.map((key) => {
      const info = this.keyInfo.get(key.hubKeyId) ?? {}
      const models = this.keyModels.get(key.hubKeyId) ?? []
      const rows = models.map((model) => toModelRow(model, key.selection))
      const counts = { total: rows.length, enabled: 0, retired: 0 }
      for (const row of rows) {
        if (row.enabled) counts.enabled += 1
        if (row.retired === true) counts.retired += 1
      }
      const isMain = key.hubKeyId !== '' && key.hubKeyId === this.state.mainKeyId
      return {
        hubKeyId: key.hubKeyId,
        name: key.name,
        masked: key.masked,
        routeKey: key.routeKey,
        apiKeyEnv: key.apiKeyEnv,
        enabled: key.enabled !== false,
        isMain,
        missing: info.missing === true,
        deleted: info.deleted === true,
        accounts: Array.isArray(key.accounts) ? key.accounts.length : 0,
        // 这条 key 绑定账号的余额合计。`/v1/balance-summary` 是整域汇总、拆不到 key，
        // 只能拿 `/accounts` 里每个账号的 `credits.remain` 自己求和（纯内存，不额外发请求）。
        // 徽标第一行写的是「当前会话那条 key 的余额 / 整域余额」，两边分母都取账号级之和，
        // 不能一边用整域额度凑；会话切到别的 key 时也得跟着换，所以该值按 key 投影。
        balance: mainKeyBalance(this.accountsRaw, key.accounts),
        counts,
        models: rows,
        pulledAt: Number(info.pulledAt) || 0,
        apiKeySource: typeof info.apiKeySource === 'string' ? info.apiKeySource : '',
        lastError: typeof info.lastError === 'string' ? info.lastError : '',
        lastSyncAt: Number(key.lastSyncAt) || 0,
        lastSyncCount: Number(key.lastSyncCount) || 0,
        lastSyncError: typeof key.lastSyncError === 'string' ? key.lastSyncError : '',
        usage: usagePrimary[key.hubKeyId] ?? null,
        usageWeek: usageWeek[key.hubKeyId] ?? null,
      }
    })
  }

  /** 当前该提示的告警。 */
  alerts() {
    const list = computeAlerts({
      now: Date.now(),
      lastError: this.lastSyncError || this.state.lastSyncError,
      failureKind: this.failureKind,
      consecutiveFailures: this.consecutiveFailures,
      balance: this.balance,
      accounts: this.accounts,
      apiKeyPresent: this.apiKeySource !== '' || this.health?.apiKeyRequired === false,
      thresholds: this.state.thresholds,
      dismissed: this.state.dismissed,
    })
    // 主 key 被删不是「同步失败」，而是「会话里的模型已经不可用了」，
    // 必须单独出一条，不然用户只看到别处还正常、以为没事。
    if (this.state.mainKeyMissing === true) {
      const dismissed = this.state.dismissed ?? {}
      const at = Number(dismissed['main-key-missing'])
      const fresh = !Number.isFinite(at) || Date.now() - at > 24 * 3600 * 1000
      if (fresh) {
        list.unshift({
          key: 'main-key-missing',
          level: 'error',
          title: '主 key 已不在网关里',
          detail: '已在 DSH 里删掉主路由。请到网关重新建一个同名 key，或在设置页把别的 key 指定为主 key。',
        })
      }
    }
    return list
  }

  /**
   * 拼给前端的状态快照。
   *
   * 不含任何凭据明文：`pwd` 只回一个布尔，Token 与 API Key 完全不出现。
   * @returns 可 JSON 化的状态对象。
   */
  snapshot() {
    const rows = this.models.map((model) => toModelRow(model, this.state.selection))
    const counts = { total: rows.length, enabled: 0, retired: 0 }
    let rateSum = 0
    for (const row of rows) {
      if (row.enabled) counts.enabled += 1
      if (row.retired === true) counts.retired += 1
      rateSum += Number(row.rate) || 0
    }
    return {
      pluginVersion: PLUGIN_VERSION,
      baseUrl: this.base,
      tab: this.tab,
      tabs: [...TABS],
      pwdConfigured: this.pwd !== '',
      pwdIsDefault: this.pwd === DEFAULT_PWD,
      health: this.health,
      panel: this.panel,
      loggedIn: this.session.loggedIn,
      apiKeyEnv: this.state.apiKeyEnv,
      apiKeySource: this.apiKeySource,
      providerEntry: this.state.providerEntry,
      routeKey: this.state.routeKey,
      sync: this.state.sync !== false,
      intervalSeconds: this.state.intervalSeconds,
      counts,
      averageRate: rows.length > 0 ? Math.round((rateSum / rows.length) * 1000) / 1000 : 0,
      models: rows,
      /**
       * 多 key 投影。前端只读这个数组：一条 key 一块卡片、徽标按当前会话
       * 用的 provider 反查对应 key 的用量，都不需要再发额外请求。
       */
      keys: this.keyProjections(),
      mainKeyId: this.state.mainKeyId,
      mainKeyMissing: this.state.mainKeyMissing === true,
      mainKeyBalance: this.mainKeyBalance,
      usageByKey: this.usageByKey(normalizeUsageRange(this.usageRange)),
      usageWeekByKey: this.usageByKey('week'),
      maxKeys: Number(this.state.maxKeys) || DEFAULT_MAX_KEYS,
      analyticsWindow: this.analyticsWindow,
      lastSyncAt: this.state.lastSyncAt,
      lastSyncCount: this.state.lastSyncCount,
      lastSyncError: this.state.lastSyncError,
      syncPending: this.pendingSync,
      lastError: this.lastSyncError,
      failureKind: this.failureKind,
      consecutiveFailures: this.consecutiveFailures,
      modelsFetchedAt: this.modelsFetchedAt,
      overviewFetchedAt: this.overviewFetchedAt,
      usageFetchedAt: this.usageFetchedAt,
      usageRange: normalizeUsageRange(this.usageRange),
      balance: this.balance,
      usage: this.usage,
      usageWeek: this.usageWeek,
      accounts: this.accounts,
      alerts: this.alerts(),
      newModels: Array.isArray(this.newModels) ? this.newModels : [],
      retired: Object.entries(this.state.retired ?? {}).map(([id, entry]) => ({
        id,
        at: Number(entry?.at) || 0,
        expiresAt: toEpochMs(Number(entry?.at) || 0) + Math.max(0, Number(this.state.retireHours) || 0) * 3600000,
      })),
      policy: {
        newModelPolicy: this.state.newModelPolicy,
        retireHours: Number(this.state.retireHours) || 0,
        thresholds: { ...this.state.thresholds },
        autoApiKey: this.state.autoApiKey !== false,
      },
      runtime: {
        node: process.version,
        bootedAt: this.bootedAt,
      },
    }
  }

  /**
   * 更新配置（地址 / 密码 / 页签 / 同步开关 / 间隔 / API Key）。
   * @param patch - 前端提交的字段。
   * @returns 快照。
   */
  async configure(patch) {
    let reconnect = false
    if (patch !== null && typeof patch === 'object') {
      if (typeof patch.baseUrl === 'string') {
        const next = normalizeBaseUrl(patch.baseUrl)
        if (next !== '' && next !== this.base) {
          this.state.baseUrl = next
          reconnect = true
        }
      }
      if (typeof patch.pwd === 'string' && patch.pwd.trim() !== '') {
        const next = normalizePwd(patch.pwd)
        if (next !== this.pwd) {
          this.state.pwd = next
          reconnect = true
        }
      }
      if (typeof patch.tab === 'string' && patch.tab.trim() !== '') {
        this.state.tab = normalizeTab(patch.tab, this.state.tab)
      }
      if (typeof patch.sync === 'boolean') this.state.sync = patch.sync
      if (typeof patch.usageRange === 'string' && patch.usageRange.trim() !== '') {
        this.state.usageRange = normalizeUsageRange(patch.usageRange)
      }
      if (Number.isFinite(Number(patch.intervalSeconds)) && Number(patch.intervalSeconds) >= 30) {
        this.state.intervalSeconds = Math.min(Math.floor(Number(patch.intervalSeconds)), 3600)
      }
      if (typeof patch.autoApiKey === 'boolean') this.state.autoApiKey = patch.autoApiKey
      if (typeof patch.apiKey === 'string' && patch.apiKey.trim() !== '') {
        const ref = this.state.apiKeyEnv !== '' ? this.state.apiKeyEnv : DEFAULT_API_KEY_ENV
        const value = patch.apiKey.trim()
        const written = await writeCredential(this.ctx, ref, value)
        if (!written) throw new Error('credentials 服务不可用，无法保存 API Key')
        this.persistedApiKey = value
        this.apiKeySource = 'credentials'
        reconnect = true
      }
      if (patch.policy !== null && typeof patch.policy === 'object') await this.setPolicy(patch.policy)
    }
    if (reconnect) {
      // 换地址/密码必须丢 Token，并立刻重连一次，否则用户看到的是旧状态。
      this.session.configure({ baseUrl: this.base, pwd: this.pwd })
    }
    await this.persist()
    return this.snapshot()
  }

  /**
   * 改策略（新模型默认、宽限期、告警阈值）。
   * @param patch - 只处理出现的字段。
   * @returns 快照。
   */
  async setPolicy(patch) {
    const body = patch ?? {}
    if (body.newModelPolicy === 'select' || body.newModelPolicy === 'ignore') {
      this.state.newModelPolicy = body.newModelPolicy
    }
    if (Number(body.retireHours) >= 0) {
      this.state.retireHours = Math.min(Math.floor(Number(body.retireHours)), 168)
    }
    const thresholds = body.thresholds
    if (thresholds !== null && typeof thresholds === 'object') {
      const next = { ...this.state.thresholds }
      if (Number(thresholds.lowCredits) >= 0) next.lowCredits = Number(thresholds.lowCredits)
      if (Number(thresholds.unreachablePolls) > 0) {
        next.unreachablePolls = Math.floor(Number(thresholds.unreachablePolls))
      }
      this.state.thresholds = next
    }
    await this.persist()
    return this.snapshot()
  }

  /** 关掉一条告警，24 小时内不再提示。 */
  async dismissAlert(key) {
    if (typeof key !== 'string' || key === '') return this.snapshot()
    this.state.dismissed = { ...this.state.dismissed, [key]: Date.now() }
    await this.persist()
    return this.snapshot()
  }

  /** 把「没指定 key」归一成主 key id。 */
  targetKeyId(hubKeyId) {
    if (typeof hubKeyId === 'string' && hubKeyId !== '') return hubKeyId
    return this.state.mainKeyId
  }

  /**
   * 勾选/取消某条 key 下的一个模型，或裁剪它的思考档位。
   *
   * 每条 key 有自己的 `selection`：网关允许不同 key 看到不同模型，
   * 所以勾选不可能是全局一份。
   * @param id - 模型 id。
   * @param choice - `{ enabled, efforts }`。
   * @param hubKeyId - 目标 key（缺省为主 key）。
   * @returns 快照。
   */
  async select(id, choice, hubKeyId) {
    if (typeof id !== 'string' || id === '') return this.snapshot()
    const key = this.keyStateOf(this.targetKeyId(hubKeyId))
    if (key === null) return this.snapshot()
    const selection = { ...(key.selection ?? {}) }
    const current = selection[id] ?? { enabled: true }
    const next = { ...current }
    if (typeof choice?.enabled === 'boolean') next.enabled = choice.enabled
    if (Array.isArray(choice?.efforts)) {
      next.efforts = choice.efforts.filter((level) => typeof level === 'string')
    } else if (choice?.efforts === null) {
      delete next.efforts
    }
    selection[id] = next
    key.selection = selection
    if (key.hubKeyId === this.state.mainKeyId) this.state.selection = selection
    await this.persist()
    if (this.state.sync !== false) await this.resync()
    return this.snapshot()
  }

  /** 全选/全不选（按 key）。 */
  async bulk(enabled, hubKeyId) {
    const key = this.keyStateOf(this.targetKeyId(hubKeyId))
    if (key === null) return this.snapshot()
    const selection = { ...(key.selection ?? {}) }
    for (const model of this.keyModels.get(key.hubKeyId) ?? []) {
      const id = model?.id
      if (typeof id !== 'string' || id === '') continue
      selection[id] = { ...(selection[id] ?? {}), enabled: enabled === true }
    }
    key.selection = selection
    if (key.hubKeyId === this.state.mainKeyId) this.state.selection = selection
    await this.persist()
    if (this.state.sync !== false) await this.resync()
    return this.snapshot()
  }

  /**
   * 把这一轮新上架的模型全部勾上（按 key）。
   * 用在 `newModelPolicy: ignore` 之后：那些模型先被自动取消勾选，用户点一下补回来。
   */
  async enableNew(hubKeyId) {
    const key = this.keyStateOf(this.targetKeyId(hubKeyId))
    if (key === null) return this.snapshot()
    const added = this.keyInfo.get(key.hubKeyId)?.added ?? []
    const selection = { ...(key.selection ?? {}) }
    for (const id of added) {
      if (typeof id !== 'string' || id === '') continue
      selection[id] = { ...(selection[id] ?? {}), enabled: true }
    }
    key.selection = selection
    if (key.hubKeyId === this.state.mainKeyId) this.state.selection = selection
    await this.persist()
    if (this.state.sync !== false) await this.resync()
    return this.snapshot()
  }

  /** 立即移除一个已下架的模型（不等宽限期，按 key）。 */
  async retireNow(id, hubKeyId) {
    if (typeof id !== 'string' || id === '') return this.snapshot()
    const key = this.keyStateOf(this.targetKeyId(hubKeyId))
    if (key === null) return this.snapshot()
    if (key.retired?.[id] !== undefined) {
      const next = { ...key.retired }
      delete next[id]
      key.retired = next
    }
    const list = (this.keyModels.get(key.hubKeyId) ?? []).filter((model) => model?.id !== id)
    this.keyModels.set(key.hubKeyId, list)
    // 同步清掉「上一轮见过」的记录，否则下一轮会把刚移除的模型当成新下架又捡回来。
    key.lastModelIds = (key.lastModelIds ?? []).filter((item) => item !== id)
    if (key.hubKeyId === this.state.mainKeyId) {
      this.rawModels = list
      this.models = sortModels(list)
      this.state.retired = key.retired ?? {}
      this.state.lastModelIds = key.lastModelIds ?? []
    }
    await this.resync()
    return this.snapshot()
  }

  /** 按当前选择重写 DSH 配置（不重新拉 hub）。 */
  async resync() {
    const entries = this.keyEntries()
    if (entries.length === 0) {
      if (this.state.mainKeyMissing === true) {
        this.state.lastSyncError = '主 key 已不在网关里，已停止同步（在设置页重新指定一个主 key）'
        this.lastSyncError = this.state.lastSyncError
      }
      await this.persist()
      return this.snapshot()
    }
    try {
      const result = await syncRoutesToDsh(this.ctx, this.state, entries, this.base)
      this.state.lastSyncAt = result.at
      this.state.lastSyncCount = result.count
      this.state.lastSyncError = ''
      this.lastSyncError = ''
      for (const route of result.routes) {
        const key = (this.state.keys ?? []).find((item) => item.routeKey === route.routeKey)
        if (key === undefined) continue
        key.lastSyncAt = result.at
        key.lastSyncCount = route.count
        key.lastSyncError = route.empty === true ? '这条 key 没有勾选任何模型' : ''
      }
    } catch (error) {
      this.state.lastSyncError = errorText(error)
      this.lastSyncError = this.state.lastSyncError
    }
    await this.persist()
    return this.snapshot()
  }

  /**
   * 清除插件写进 llm-pi-ai 的所有路由（每条 key 一条）。
   *
   * 用 unset 而不是写空对象：写空对象会在配置里留下一个空壳路由，
   * llm-pi-ai 仍然会注册它（只是没有模型），卸载后看着更糊涂。
   * @returns 新快照。
   */
  async clearConfig() {
    const settings = this.ctx.get('settings')
    const entryId = this.state.providerEntry !== '' ? this.state.providerEntry : DEFAULT_PROVIDER_ENTRY
    const routeKeys = (Array.isArray(this.state.keys) ? this.state.keys : [])
      .map((key) => key.routeKey)
      .filter((routeKey) => typeof routeKey === 'string' && routeKey !== '')
    const legacy = this.state.routeKey !== '' ? this.state.routeKey : DEFAULT_ROUTE_KEY
    if (!routeKeys.includes(legacy)) routeKeys.push(legacy)
    if (settings !== undefined) {
      const descriptor = settings.describe().find((row) => row.ns === entryId)
      if (descriptor !== undefined) {
        const ops = routeKeys
          .filter((routeKey) => descriptor.value?.providers?.[routeKey] !== undefined)
          .map((routeKey) => ({ op: 'unset', path: ['providers', routeKey] }))
        if (ops.length > 0) await mutateWithRetry(settings, entryId, ops, descriptor.revision)
      }
    }
    // 清完就停手，否则下一轮轮询又会把它写回去。
    this.state.sync = false
    this.state.keys = []
    this.state.mainKeyId = ''
    this.state.mainKeyMissing = false
    this.state.selection = {}
    this.state.lastModelIds = []
    this.state.retired = {}
    this.state.lastSyncAt = 0
    this.state.lastSyncCount = 0
    this.state.lastSyncError = ''
    this.keyModels.clear()
    this.keyInfo.clear()
    this.keySecrets.clear()
    this.keySources.clear()
    this.rawModels = []
    this.models = []
    this.newModels = []
    this.accountsRaw = null
    this.mainKeyBalance = null
    this.analyticsKeys = []
    this.analyticsWindow = null
    this.analyticsCache = new Map()
    this.usageCache = new Map()
    this.balance = null
    this.usage = null
    this.usageWeek = null
    this.accounts = null
    this.health = null
    this.panel = null
    this.modelsFetchedAt = 0
    this.overviewFetchedAt = 0
    this.usageFetchedAt = 0
    this.usageRange = 'today'
    this.lastSyncError = ''
    this.failureKind = ''
    this.session.token = ''
    await this.persist()
    return this.snapshot()
  }


  /**
   * 探测一次连接（不改变已保存的配置）。
   * @param overrides - `{ baseUrl, pwd }`。
   * @returns `{ ok, health, panel, loggedIn, failure }`。
   */
  async probe(overrides = {}) {
    const base = normalizeBaseUrl(overrides.baseUrl) || this.base
    const session = new HubSession({ baseUrl: base, pwd: normalizePwd(overrides.pwd ?? this.pwd) })
    const healthResult = await session.publicGet('/health')
    if (!healthResult.ok) {
      return { ok: false, baseUrl: base, failure: classifyFailure(healthResult) }
    }
    const health = summarizeHealth(healthResult.body)
    const statusResult = await session.publicGet('/panel/status')
    const panel = statusResult.ok ? summarizePanelStatus(statusResult.body) : null
    let loggedIn = false
    let usingDefaultPassword = false
    if (panel !== null && (panel.passwordRequired || panel.passwordIsDefault)) {
      const login = await session.login()
      if (!login.ok) {
        return { ok: false, baseUrl: base, health, panel, loggedIn: false, failure: login.failure }
      }
      loggedIn = true
      usingDefaultPassword = login.usingDefaultPassword === true
    }
    // 「连上了」和「能用」是两件事：顺手用当前会话读一次模型列表。
    // 面板密码对但 API Key 缺失时，这一步能提前暴露问题，而不是等用户选模型时 401。
    const listResult = await session.authGet('/v1/models')
    if (!listResult.ok) {
      return { ok: false, baseUrl: base, health, panel, loggedIn, usingDefaultPassword, failure: classifyFailure(listResult) }
    }
    const list = modelListOf(listResult.body)
    if (list === null) {
      return { ok: false, baseUrl: base, health, panel, loggedIn, usingDefaultPassword, failure: { kind: 'payload', message: 'hub 的 /v1/models 返回内容不是 OpenAI 模型列表（缺少 data 数组）' } }
    }
    return { ok: true, baseUrl: base, health, panel, loggedIn, usingDefaultPassword, models: list.length }
  }

  /** 打开看板用的深链：只带页签，密码不进 URL、也不进快照。 */
  dashboardUrl() {
    return buildDashboardUrl(this.base, this.tab)
  }

  /** 释放资源：停掉后台轮询后调用。 */
  dispose() {
    this.disposed = true
    this.session.token = ''
  }
}

/**
 * 从 `/v1/models` 的响应里取出模型数组。
 *
 * hub 走的是 OpenAI 形状（`data`），但同类面板也有把清单放在 `models` 下的，
 * 两种都认，避免因为容器名不同就判定「版本不匹配」。
 * @param body - 已解析的响应体。
 * @returns 模型数组；形状不认识时返回 `null`。
 */
function modelListOf(body) {
  if (Array.isArray(body?.data)) return body.data
  if (Array.isArray(body?.models)) return body.models
  return null
}

/**
 * 读请求体并解析 JSON。
 * @param request - node http 请求。
 * @param limit - 字节上限，防止被超大 body 打爆内存。
 * @returns 解析后的对象（空 body 返回 `{}`）。
 */
async function readJsonBody(request, limit = 64 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  const parsed = JSON.parse(text)
  return parsed !== null && typeof parsed === 'object' ? parsed : {}
}

/** 写 JSON 响应。 */
function sendJson(response, status, payload) {
  const text = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(text)
}

/**
 * 请求是否来自本机。
 *
 * 宿主的 `/api/*` 有会话鉴权，但 `webServer.register` 注册的路由不在那层中间件
 * 之后（插件路由天然是公开的）。本插件只提供只读数据 + 几个会发起网络请求的
 * 接口（探测/测试），所以对非本机来源直接关掉写接口，避免把宿主变成 SSRF 跳板。
 * @param request - node http 请求。
 * @returns 是否为本机回环地址。
 */
function isLoopback(request) {
  const address = request.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * 写请求是否来自「同一个页面」。
 *
 * 只判回环地址是拦不住浏览器里其它网站的：同机页面向 `127.0.0.1` 发
 * `fetch(..., {mode:'no-cors', headers:{'content-type':'text/plain'}})` 属于
 * 简单请求，浏览器不发预检，`remoteAddress` 也是 127.0.0.1 —— 于是任何网页
 * 都能把 hub 地址改成攻击者的服务器，插件下一轮就会把密码发过去。
 *
 * 三道闸一起用：
 *   1. `Sec-Fetch-Site` 只允许 `same-origin` / `none`（现代浏览器都会带）；
 *   2. 有 `Origin` 就必须和 `Host` 一致（同源页面 POST 也会带 Origin）；
 *   3. 写接口只收 `application/json`（跨站发这个类型会触发预检，而我们不返回 CORS 头）。
 * 非浏览器客户端（curl、测试、脚本）三者都可以没有，靠回环地址这一层兜住。
 * @param request - node http 请求。
 * @returns 是否可信。
 */
function isSameOriginWrite(request) {
  const site = String(request.headers['sec-fetch-site'] ?? '')
  if (site !== '' && site !== 'same-origin' && site !== 'none') return false
  const origin = String(request.headers.origin ?? '')
  if (origin === '') return true
  let parsed
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  const host = String(request.headers.host ?? '')
  return host !== '' && parsed.host === host
}

/**
 * 写请求的 content-type 是否可接受。
 * @param request - node http 请求。
 * @returns 是否可接受。
 */
function hasJsonContentType(request) {
  const type = String(request.headers['content-type'] ?? '').toLowerCase()
  return type === '' || type.startsWith('application/json')
}

/**
 * 插件入口。
 * @param ctx - 宿主上下文。
 * @param config - 插件配置（cordis.patch.yml 里的 config）。
 */
export function apply(ctx, config) {
  ctx.inject(['webServer'], (webCtx) => {
    const runtime = new HubRuntime(webCtx, config)

    webCtx.effect(() => {
      runtime.start().catch((error) => {
        // 启动失败只记录，不抛：宿主不会因为 hub 没开而崩。
        runtime.lastSyncError = errorText(error)
        runtime.failureKind = 'startup'
      })
      return () => runtime.dispose()
    }, 'workbuddy-hub: startup')

    // 后台轮询：hub 模型/额度变了，DSH 里的模型列表跟着变。
    // 用递归 setTimeout 而不是 setInterval：间隔在用户改设置后能立刻生效，
    // 而且上一轮还没跑完时不会叠加请求。
    webCtx.effect(() => {
      let timer
      let stopped = false
      const tick = () => {
        if (stopped) return
        // 连续失败时指数退避，别在 hub 掉线时每 2 分钟硬撞。
        // 冷启动窗口内失败（刚装、刚改地址、重启后凭据还没就绪）要快试，
        // 否则指数退避会让一次瞬时 401 挂满 4 分钟才自愈。
        // 被限流（429）时抬到 hub 建议的等待时间以上。
        const coldStart = Date.now() - runtime.bootedAt < 60000
        const backedOff = pollIntervalMs(runtime.state.intervalSeconds, runtime.consecutiveFailures, {
          floorSeconds: runtime.retryFloorSeconds,
        })
        const interval = coldStart && runtime.consecutiveFailures > 0 ? Math.min(15000, backedOff) : backedOff
        timer = setTimeout(() => {
          if (stopped) return
          runtime
            .run(() => runtime.refresh({ sync: true }))
            .catch(() => undefined)
            .finally(() => tick())
        }, interval)
        timer.unref?.()
      }
      tick()
      return () => {
        stopped = true
        clearTimeout(timer)
      }
    }, 'workbuddy-hub: polling')

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'prefix',
          path: '/workbuddy2api-hub/api',
          // 把 promise 返回出去：宿主不使用它，但测试可以直接 await 一次请求结束。
          handler: (request, response) =>
            handle(runtime, request, response).catch((error) => {
              sendJson(response, 500, { ok: false, error: errorText(error) })
            }),
        }),
      'workbuddy-hub: routes',
    )
  })
}

/**
 * 路由分发。所有写操作都排进 runtime 的串行队列，避免并发改配置。
 * @param ctx - 宿主上下文。
 * @param runtime - 运行期实例。
 * @param request - node http 请求。
 * @param response - node http 响应。
 */
async function handle(runtime, request, response) {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const route = url.pathname.replace(/^\/workbuddy2api-hub\/api/, '') || '/'
  const method = (request.method ?? 'GET').toUpperCase()

  if (method !== 'GET') {
    if (!isLoopback(request)) {
      sendJson(response, 403, { ok: false, error: '只允许本机发起写操作' })
      return
    }
    if (!isSameOriginWrite(request)) {
      sendJson(response, 403, { ok: false, error: '拒绝跨站请求：写接口只接受同源页面调用' })
      return
    }
    if (!hasJsonContentType(request)) {
      sendJson(response, 415, { ok: false, error: '写接口只接受 application/json' })
      return
    }
  }

  if (method === 'GET' && route === '/state') {
    // 前端每 15 秒轮询一次，正好用来补做被 HMR 事务挡掉的同步。
    await runtime.flushPendingSync()
    const text = JSON.stringify({ ok: true, ...runtime.snapshot() })
    // 完整快照约 10~30KB，而 15 秒一轮里绝大多数时候什么都没变。
    // 用 ETag + 304 把「没变」的那一轮压成一个空响应。
    const etag = `"${createHash('sha1').update(text).digest('hex').slice(0, 16)}"`
    if (String(request.headers['if-none-match'] ?? '') === etag) {
      response.writeHead(304, { etag, 'cache-control': 'no-cache' })
      response.end()
      return
    }
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-cache',
      etag,
    })
    response.end(text)
    return
  }

  if (method === 'GET' && route === '/dashboard-url') {
    // 这个接口可能回带 pwd 的深链，所以单独一个接口、且只给本机：
    // 放进 /state 会让密码每 15 秒跟着快照走一遍（还会进 ETag）。
    // 链接里永远只有 tab —— 密码不进 URL，进面板手输一次。
    if (!isLoopback(request)) {
      sendJson(response, 403, { ok: false, error: '只允许本机读取看板链接' })
      return
    }
    sendJson(response, 200, { ok: true, url: runtime.dashboardUrl(), tab: runtime.tab })
    return
  }

  if (method === 'GET' && route === '/usage') {
    // `range=today|week|month|all`——hub 只认 range，不认 hours。
    const range = normalizeUsageRange(url.searchParams.get('range'))
    await runtime.run(() => runtime.refreshUsage(range))
    const usage = range === 'week' ? runtime.usageWeek : runtime.usage
    sendJson(response, 200, {
      ok: usage !== null,
      fetchedAt: runtime.usageFetchedAt,
      range,
      usage,
    })
    return
  }

  if (method === 'GET' && route === '/accounts') {
    await runtime.run(() => runtime.refreshAccounts())
    sendJson(response, 200, {
      ok: runtime.accounts !== null,
      accounts: runtime.accounts,
      balance: runtime.balance,
    })
    return
  }

  if (method === 'POST' && route === '/config') {
    const body = await readJsonBody(request)
    const snapshot = await runtime.run(async () => {
      await runtime.configure(body)
      // 同步之后再取快照，否则前端拿到的是刷新前的旧状态（看不到本次同步结果）。
      if (body.refresh !== false) await runtime.refresh({ sync: true })
      return runtime.snapshot()
    })
    sendJson(response, 200, { ok: true, ...snapshot })
    return
  }

  if (method === 'POST' && route === '/selection') {
    const body = await readJsonBody(request)
    const snapshot = await runtime.run(() => runtime.select(body.id, body, body.hubKeyId))
    sendJson(response, 200, { ok: true, ...snapshot })
    return
  }

  if (method === 'POST' && route === '/bulk') {
    const body = await readJsonBody(request)
    const snapshot = await runtime.run(() => runtime.bulk(body.enabled === true, body.hubKeyId))
    sendJson(response, 200, { ok: true, ...snapshot })
    return
  }

  if (method === 'POST' && route === '/enable-new') {
    const body = await readJsonBody(request)
    const snapshot = await runtime.run(() => runtime.enableNew(body.hubKeyId))
    sendJson(response, 200, { ok: true, ...snapshot })
    return
  }

  if (method === 'POST' && route === '/refresh') {
    const body = await readJsonBody(request)
    const result = await runtime.run(() =>
      runtime.refresh({
        sync: body.sync !== false,
        usageRange: body.usageRange ?? body.hours,
        keyId: typeof body.hubKeyId === 'string' && body.hubKeyId !== '' ? body.hubKeyId : undefined,
      }),
    )
    sendJson(response, 200, { ok: result.ok === true, result, ...runtime.snapshot() })
    return
  }

  if (method === 'POST' && route === '/policy') {
    const body = await readJsonBody(request)
    const snapshot = await runtime.run(async () => {
      await runtime.setPolicy(body)
      return runtime.snapshot()
    })
    sendJson(response, 200, { ok: true, ...snapshot })
    return
  }

  if (method === 'POST' && route === '/dismiss') {
    const body = await readJsonBody(request)
    const snapshot = await runtime.run(() => runtime.dismissAlert(body.key))
    sendJson(response, 200, { ok: true, ...snapshot })
    return
  }

  if (method === 'POST' && route === '/retire') {
    const body = await readJsonBody(request)
    const snapshot = await runtime.run(() => runtime.retireNow(body.id, body.hubKeyId))
    sendJson(response, 200, { ok: true, ...snapshot })
    return
  }

  if (method === 'POST' && route === '/clear') {
    const body = await readJsonBody(request)
    if (body.confirm !== true) {
      sendJson(response, 400, { ok: false, error: '需要 confirm: true' })
      return
    }
    const snapshot = await runtime.run(() => runtime.clearConfig())
    sendJson(response, 200, { ok: true, ...snapshot })
    return
  }

  if (method === 'POST' && route === '/keys/pull') {
    const body = await readJsonBody(request)
    const result = await runtime.run(() => runtime.pullKey(body.hubKeyId))
    sendJson(response, 200, { ok: result.ok === true, result, ...runtime.snapshot() })
    return
  }

  if (method === 'POST' && route === '/keys/selection') {
    const body = await readJsonBody(request)
    const snapshot = await runtime.run(() => runtime.select(body.id, body, body.hubKeyId))
    sendJson(response, 200, { ok: true, ...snapshot })
    return
  }

  if (method === 'POST' && route === '/keys/sync-selection') {
    const body = await readJsonBody(request)
    const count = await runtime.run(() => runtime.syncSelection(body.from, body.to))
    sendJson(response, 200, { ok: true, copied: count, ...runtime.snapshot() })
    return
  }

  if (method === 'POST' && route === '/keys/main') {
    const body = await readJsonBody(request)
    const changed = await runtime.run(() => runtime.setMainKey(body.hubKeyId))
    if (!changed) {
      sendJson(response, 404, { ok: false, error: '没有这条 key' })
      return
    }
    sendJson(response, 200, { ok: true, ...runtime.snapshot() })
    return
  }

  if (method === 'POST' && route === '/test') {
    const body = await readJsonBody(request)
    const result = await runtime.run(() => runtime.probe(body))
    sendJson(response, 200, { ok: result.ok === true, ...result })
    return
  }

  sendJson(response, 404, { ok: false, error: `未知接口 ${method} ${route}` })
}

/** 供测试与文档使用的常量。 */
export const constants = {
  DEFAULT_BASE_URL,
  DEFAULT_PWD,
  DEFAULT_TAB,
  DEFAULT_API_KEY_ENV,
  DEFAULT_PROVIDER_ENTRY,
  DEFAULT_ROUTE_KEY,
  MAIN_ROUTE_KEY,
  MAIN_API_KEY_ENV,
  DEFAULT_MAX_KEYS,
  PLUGIN_VERSION,
  TABS,
  REQUEST_TIMEOUT_MS,
  LOGIN_TIMEOUT_MS,
  DEFAULT_STATE,
  buildRouteTarget,
  HubSession,
  HubRuntime,
  // 测试用：把路由器单独拿出来，可以在不起 cordis 的情况下请求它。
  handle,
  normalizeBaseUrl,
  normalizePwd,
  normalizeTab,
  classifyFailure,
  retryAfterSeconds,
  modelRate,
}
