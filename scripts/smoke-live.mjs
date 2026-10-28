#!/usr/bin/env node
/**
 * 对真实运行的 workbuddy2api-hub 做一次**只读**联调。
 *
 * 用途：装好插件之前先确认「地址对不对、密码对不对、能不能拿到模型」。
 * 这里只发 GET 请求，不改 hub 上任何东西，也不碰本机 DSH 的配置与凭据：
 *   - 不写 llm-pi-ai 的 providers（ctx 里没有 settings 服务，写入会自然跳过）
 *   - 不读 hub 上的明文 API Key（`autoApiKey: false`）
 *   - 状态文件丢在系统临时目录
 *
 * 用法：
 *   node scripts/smoke-live.mjs
 *   node scripts/smoke-live.mjs --url http://127.0.0.1:8788 --pwd <面板密码>
 *   node scripts/smoke-live.mjs --state ~/.dsh/profiles/desktop/workbuddy2api-hub.json
 *
 * 不给 `--pwd` 时会从插件的状态文件里读（插件设置页里改过的密码就存在那儿），
 * 因为面板密码一旦改过就不再是默认的 `admin`。
 *   node scripts/smoke-live.mjs --json
 *
 * 退出码：0 一切正常 / 2 连不上 / 3 密码不对或没有权限 / 4 其它（含超时）。
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, constants } from '../lib/index.js'

/**
 * 解析命令行参数。
 * @param argv - `process.argv.slice(2)`。
 * @returns 选项对象。
 */
function parseArgs(argv) {
  const options = {
    baseUrl: constants.DEFAULT_BASE_URL,
    pwd: constants.DEFAULT_PWD,
    tab: constants.DEFAULT_TAB,
    json: false,
    waitMs: 15000,
    pwdSource: 'default',
    statePath: '',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') {
      options.json = true
      continue
    }
    const value = argv[index + 1]
    if (arg === '--url' || arg === '--base-url') {
      options.baseUrl = value
      index += 1
    } else if (arg === '--pwd' || arg === '--password') {
      options.pwd = value
      options.pwdSource = 'arg'
      index += 1
    } else if (arg === '--state') {
      options.statePath = value
      index += 1
    } else if (arg === '--tab') {
      options.tab = value
      index += 1
    } else if (arg === '--wait') {
      options.waitMs = Number(value) || options.waitMs
      index += 1
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    }
  }
  return options
}

/**
 * 造一个「只有 webServer」的假宿主。
 *
 * 真宿主里有 settings / credentials，这里故意不给：只读检查不应该有能力去写配置
 * 或读凭据——拿不到服务，插件自己会退化成「只看不写」。
 * @returns 假 ctx。
 */
function makeReadOnlyCtx() {
  const routes = []
  const effects = []
  const disposers = []
  const ctx = {
    get: () => undefined,
    inject: (_names, callback) => callback(ctx),
    effect: (factory, label) => {
      effects.push(label)
      const dispose = factory()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    webServer: {
      register: (route) => {
        routes.push(route)
        return () => {}
      },
    },
  }
  return { ctx, routes, effects, disposers }
}

/**
 * 打一次插件接口。
 * @param routes - 注册到的路由表。
 * @param path - 相对路径，例如 `/state`。
 * @returns 解析后的 JSON。
 */
async function callRoute(routes, path) {
  const route = routes[0]
  if (route === undefined) throw new Error('插件没有注册任何路由')
  const url = `/workbuddy2api-hub/api${path}`
  const request = {
    method: 'GET',
    url,
    headers: { host: '127.0.0.1' },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {},
  }
  const response = {
    status: 0,
    headers: {},
    chunks: [],
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value
    },
    getHeader(name) {
      return this.headers[String(name).toLowerCase()]
    },
    writeHead(status, headers) {
      this.status = status
      for (const [name, value] of Object.entries(headers ?? {})) this.setHeader(name, value)
      return this
    },
    end(chunk) {
      if (chunk !== undefined) this.chunks.push(String(chunk))
      this.text = this.chunks.join('')
    },
  }
  await route.handler(request, response)
  const text = response.text ?? ''
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`接口 ${path} 返回了非 JSON（HTTP ${response.status}）：${text.slice(0, 120)}`)
  }
}

/** 等启动那一次刷新结束。 */
async function waitForState(routes, waitMs) {
  const deadline = Date.now() + waitMs
  let last = null
  while (Date.now() < deadline) {
    const state = await callRoute(routes, '/state')
    last = state
    if ((state.counts?.total ?? 0) > 0 || (state.lastSyncError ?? '') !== '') return state
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  return last
}

/** 把一行「标签 + 值」对齐输出。 */
function line(label, value) {
  return `${label.padEnd(12, ' ')} ${value}`
}

/** 主流程。 */
/**
 * 从插件的状态文件里读面板密码：密码改过之后就不再是默认的 `admin` 了。
 * @param options - 命令行选项。
 * @returns 是否读到了密码（密码本身不打印）。
 */
async function loadStatePwd(options) {
  if (options.pwdSource === 'arg') return false
  const profile = process.env.DSH_PROFILE || 'desktop'
  const candidates = [
    options.statePath,
    join(homedir(), '.dsh', 'profiles', profile, 'workbuddy2api-hub.json'),
  ].filter((item) => typeof item === 'string' && item !== '')
  for (const path of candidates) {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'))
      const pwd = typeof parsed?.pwd === 'string' ? parsed.pwd : ''
      if (pwd !== '') {
        options.pwd = pwd
        options.pwdSource = 'state'
        return true
      }
    } catch {
      // 没装过插件就没有状态文件，用默认密码继续试。
    }
  }
  return false
}
async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log('用法：node scripts/smoke-live.mjs [--url http://127.0.0.1:8788] [--pwd <面板密码>] [--state <状态文件>] [--tab gateway] [--json] [--wait 15000]')
    return 0
  }

  // 密码改过之后就不再是 admin 了；从插件状态文件里取，省得每次手动传。
  await loadStatePwd(options)

  const stateDir = await mkdtemp(join(tmpdir(), 'wb-hub-smoke-'))
  const { ctx, routes, disposers } = makeReadOnlyCtx()
  try {
    apply(ctx, {
      baseUrl: options.baseUrl,
      pwd: options.pwd,
      tab: options.tab,
      stateDir,
      autoApiKey: false,
      intervalSeconds: 3600,
    })
    // apply 里启动是 fire-and-forget，这里等它把 /state 填上内容。
    const state = await waitForState(routes, options.waitMs)
    const failureKind = state?.failureKind ?? ''
    const report = {
      baseUrl: state?.baseUrl ?? options.baseUrl,
      tab: state?.tab ?? options.tab,
      healthy: state?.health?.ok === true,
      accounts_ready: state?.health?.accountsReady ?? 0,
      // 登录态看会话本身：`/panel/status` 是登录前抓的，天生是 false。
      loggedIn: state?.loggedIn === true,
      usingDefaultPassword: state?.panel?.passwordIsDefault === true,
      apiKeySource: state?.apiKeySource ?? '',
      apiKeyReady: (state?.apiKeySource ?? '') !== '',
      models: (state?.models ?? []).map((model) => ({
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        efforts: model.efforts,
        rate: model.rateText,
        enabled: model.enabled,
      })),
      counts: state?.counts ?? { total: 0, enabled: 0, retired: 0 },
      keys: (state?.keys ?? []).map((key) => ({
        name: key.name,
        isMain: key.isMain === true,
        pull: key.pull,
        accounts: key.accounts,
        models: key.counts?.total ?? 0,
        missing: key.missing === true,
      })),
      mainKeyBalance: state?.mainKeyBalance ?? null,
      balance: state?.balance ?? null,
      usage: state?.usage ?? null,
      usageWeek: state?.usageWeek ?? null,
      accounts: state?.accounts ?? null,
      lastError: state?.lastError ?? '',
      lastSyncError: state?.lastSyncError ?? '',
      failureKind,
    }

    if (options.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(`dsh-workbuddy2api-hub ${constants.PLUGIN_VERSION} — 只读联调`)
      console.log(line('服务地址', report.baseUrl))
      console.log(line('看板页签', report.tab))
      console.log(line('健康检查', report.healthy ? `ok（账号就绪 ${report.accounts_ready}）` : `失败（${report.lastError || '未知'}）`))
      console.log(line('面板登录', report.loggedIn ? '成功' : '失败'))
      if (report.usingDefaultPassword) console.log(line('提醒', '面板还在用默认密码 admin，建议改掉'))
      console.log(line('API Key', report.apiKeyReady ? `就绪（来源：${report.apiKeySource}）` : '缺失（/v1 会 401）'))
      console.log(line('模型', `${report.counts.total} 个（启用 ${report.counts.enabled}，宽限 ${report.counts.retired}）`))
      if (Array.isArray(report.keys) && report.keys.length > 0) {
        const names = report.keys.map((key) => `${key.name}${key.isMain ? '(主)' : ''}`).join(' / ')
        console.log(line('网关 key', `${report.keys.length} 条：${names}（只读体检不取明文，所以模型按面板会话读）`))
      }
      for (const model of report.models) {
        const details = [model.contextWindow ? `${model.contextWindow} ctx` : 'ctx 未知', model.rate].filter((part) => part !== '')
        if (model.efforts.length > 0) details.push(model.efforts.join('/'))
        console.log(`  - ${model.id}（${details.join('，')}）`)
      }
      if (report.mainKeyBalance !== null && report.mainKeyBalance?.remain !== null) {
        console.log(
          line(
            '主 key 余额',
            `${report.mainKeyBalance.remain} credit（绑了 ${report.mainKeyBalance.bound} 个号，找到 ${report.mainKeyBalance.found} 个）`,
          ),
        )
      }
      if (report.balance !== null) {
        console.log(line('余额', `${report.balance.balance} ${report.balance.unit}`.trim()))
      }
      if (report.usage !== null) {
        const rangeLabel = state?.usageRange === 'all' ? '全量' : state?.usageRange === 'week' ? '本周' : state?.usageRange === 'month' ? '本月' : '今日'
        console.log(
          line(
            rangeLabel,
            `${report.usage.requests} 次请求 / 失败 ${report.usage.errors} / ${report.usage.totalTokens} tokens / ${report.usage.credit} credit / ¥${report.usage.costCny}`,
          ),
        )
      }
      // 徽标第三行要本周；宿主 1.0.5 起固定多拉这一份。
      if (report.usageWeek !== null && report.usageWeek !== undefined) {
        console.log(
          line(
            '本周',
            `${report.usageWeek.requests} 次请求 / ${report.usageWeek.totalTokens} tokens / ${report.usageWeek.credit} credit / ¥${report.usageWeek.costCny}`,
          ),
        )
      }
      if (report.accounts !== null) {
        console.log(line('账号', `${report.accounts.total} 个（可用 ${report.accounts.ready}，需重登 ${report.accounts.needRelogin}）`))
      }
      if (report.lastError !== '') console.log(line('最后错误', report.lastError))
    }

    if (state === null || state === undefined) return 4
    if (failureKind === 'unreachable') return 2
    if (failureKind === 'auth') return 3
    if (failureKind === 'timeout') return 4
    // 连得上但没有 API Key：这不算插件失败，只是 /v1 用不了。
    return report.healthy ? 0 : 4
  } finally {
    // 先停轮询与状态写入，再删临时目录：否则刚写的状态文件会让 rmdir 撞 ENOTEMPTY。
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // 清理失败不影响结论。
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
    await rm(stateDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error(`联调脚本自己出错了：${error?.message ?? error}`)
    process.exitCode = 4
  })
