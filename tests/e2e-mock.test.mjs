/**
 * 端到端测试：真的起一个 HTTP 服务当 hub，真的用 fetch 打过去。
 *
 * 跑的不是真 hub（那是 Python 服务，测试里没法假设它开着），而是
 * `scripts/mock-hub.mjs` —— 它按实测到的响应形状与鉴权语义复刻，于是
 * 「登录换 Token → 用 Token 读管理接口 → 写 llm-pi-ai 配置」这条主链路
 * 在 CI 里能被完整验证，包括 401 / 429 / 连不上这些分支。
 */

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { constants } from '../lib/index.js'
import { call, makeCtx, makeRequest, makeResponse, startMockHub, stopMockHub, waitFor } from './helpers.mjs'

const { HubRuntime, handle, DEFAULT_ROUTE_KEY } = constants

/** 直接调用插件路由并检查 HTTP 状态。 */
async function expectCall(runtime, options) {
  const result = await call(handle, runtime, options)
  return result
}

describe('主链路：登录 → 读接口 → 写 llm-pi-ai 配置', () => {
  let server
  let base

  before(async () => {
    ;({ server, base } = await startMockHub())
  })
  after(async () => {
    await stopMockHub(server)
  })

  test('start() 之后模型、额度、用量、账号都拿到了', async () => {
    const ctx = await makeCtx()
    const runtime = new HubRuntime(ctx, { baseUrl: base, pwd: 'admin' })
    await runtime.start()
    try {
      assert.equal(runtime.lastSyncError, '', '正常链路不该有错误')
      assert.equal(runtime.health.ok, true)
      assert.equal(runtime.health.apiKeyRequired, true, 'mock hub 要求 API Key')
      assert.equal(runtime.panel.passwordRequired, true)
      assert.equal(runtime.session.loggedIn, true, 'pwd 换到了面板 Token')

      const snapshot = runtime.snapshot()
      assert.equal(snapshot.counts.total, 3)
      assert.equal(snapshot.counts.enabled, 3)
      assert.deepEqual(
        snapshot.models.map((row) => row.id),
        ['deepseek-v4.1-flash', 'hy3', 'hy4-preview'],
        '按模型名称排序',
      )
      assert.equal(snapshot.models.at(-1).vision, true)
      assert.equal(snapshot.balance.balance, 3712.57)
      assert.equal(snapshot.usageRange, 'today', '默认拉今日窗口')
      assert.equal(snapshot.usage.requests, 441)
      // 徽标第三行要本周，所以刷新时固定多拉一份 week
      assert.equal(snapshot.usageWeek.requests, 1207, '本周用量与今日分开存')
      assert.equal(snapshot.accounts.total, 2)
      assert.equal(snapshot.apiKeySource, 'panel', '没配 apiKey 时从面板自动取第一个 Key')
      assert.equal(snapshot.loggedIn, true)
      assert.equal(snapshot.pwdConfigured, true)
      assert.equal(snapshot.pwd, undefined, '快照里绝不能出现密码明文')
    } finally {
      ctx.__dispose()
    }
  })

  test('API Key 被写进 credentials，且不进状态文件', async () => {
    const ctx = await makeCtx()
    const runtime = new HubRuntime(ctx, { baseUrl: base })
    await runtime.start()
    try {
      assert.equal(ctx.__credentials.get('WORKBUDDY2API_HUB_API_KEY'), 'mock-api-key-0001')
      const state = runtime.state
      const text = JSON.stringify(state)
      assert.equal(text.includes('mock-api-key-0001'), false, '明文 Key 绝不能落进状态对象')
      // 面板密码是另一回事：用户在设置页改过之后重启还得在，所以要持久化。
      // 真正的要求是「密码不冒充 API Key」——credentials 里只有那一把 Key。
      assert.deepEqual([...ctx.__credentials.keys()], ['WORKBUDDY2API_HUB_API_KEY'])
    } finally {
      ctx.__dispose()
    }
  })

  test('同步写进 llm-pi-ai 的路由形状正确', async () => {
    const ctx = await makeCtx()
    const runtime = new HubRuntime(ctx, { baseUrl: base })
    await runtime.start()
    try {
      const entry = ctx.__entries.find((row) => row.ns === 'llm-pi-ai')
      const route = entry.value.providers[DEFAULT_ROUTE_KEY]
      assert.ok(route !== undefined, '必须在 providers 下写出路由')
      assert.equal(route.baseURL, `${base}/v1`)
      assert.equal(route.api, 'openai-completions')
      assert.equal(route.apiKeyEnv, 'WORKBUDDY2API_HUB_API_KEY')
      assert.equal(route.compat.supportsReasoningEffort, true, '不显式 true 的话局域网地址会丢思考档位')
      assert.equal(route.compat.thinkingFormat, 'openai')
      assert.equal(route.models.length, 3)

      const hy4 = route.models.find((model) => model.id === 'hy4-preview')
      assert.equal(hy4.contextWindow, 960000)
      assert.equal(hy4.maxTokens, 64000)
      assert.deepEqual(hy4.input, ['text', 'image'])
      assert.deepEqual(hy4.reasoningEfforts, { high: 'high' }, 'always_reasoning 的模型不给 off 档')
      assert.equal(hy4.name, 'Hy4 preview ×0.29', '模型名要带倍率，否则选择器里看不出来')

      const hy3 = route.models.find((model) => model.id === 'hy3')
      assert.deepEqual(hy3.reasoningEfforts, { off: 'off', low: 'low', high: 'high' })
      assert.equal(hy3.name, 'Hy3 Free', 'x0.00 的免费模型标 Free')

      const flash = route.models.find((model) => model.id === 'deepseek-v4.1-flash')
      assert.equal(flash.reasoningEfforts, false, '不支持思考的模型明确写 false')
      assert.equal('input' in flash, false)

      assert.equal(runtime.snapshot().lastSyncCount, 3)
      assert.ok(runtime.snapshot().lastSyncAt > 0)
    } finally {
      ctx.__dispose()
    }
  })

  test('第二轮内容没变就不再写配置（避免每轮重注册模型）', async () => {
    const ctx = await makeCtx()
    const runtime = new HubRuntime(ctx, { baseUrl: base })
    await runtime.start()
    try {
      const before = ctx.__mutations.length
      assert.ok(before > 0)
      const result = await runtime.refresh({ sync: true })
      assert.equal(result.ok, true)
      assert.equal(ctx.__mutations.length, before, '内容相同不该再写一次')
      assert.equal(runtime.snapshot().lastSyncCount, 3)
    } finally {
      ctx.__dispose()
    }
  })

  test('取消勾选模型 → 配置里少掉它；再全选 → 回来', async () => {
    const ctx = await makeCtx()
    const runtime = new HubRuntime(ctx, { baseUrl: base })
    await runtime.start()
    try {
      await runtime.run(() => runtime.select('hy3', { enabled: false }))
      await runtime.run(() => runtime.refresh({ sync: true }))
      let entry = ctx.__entries.find((row) => row.ns === 'llm-pi-ai')
      assert.deepEqual(
        entry.value.providers[DEFAULT_ROUTE_KEY].models.map((model) => model.id),
        ['deepseek-v4.1-flash', 'hy4-preview'],
      )

      await runtime.run(() => runtime.bulk(true))
      await runtime.run(() => runtime.refresh({ sync: true }))
      entry = ctx.__entries.find((row) => row.ns === 'llm-pi-ai')
      assert.equal(entry.value.providers[DEFAULT_ROUTE_KEY].models.length, 3)
    } finally {
      ctx.__dispose()
    }
  })

  test('hub 下架模型 → 先进宽限期（仍可用、标记 retired），不是立刻消失', async () => {
    const ctx = await makeCtx()
    const runtime = new HubRuntime(ctx, { baseUrl: base, retireHours: 24 })
    await runtime.start()
    try {
      // hub 侧把 hy3 拿掉，模拟账号失效导致模型下架。
      const response = await fetch(`${base}/mock/models/remove?id=hy3`)
      assert.equal(response.status, 200)

      await runtime.run(() => runtime.refresh({ sync: true }))
      const snapshot = runtime.snapshot()
      assert.equal(snapshot.counts.total, 3, '宽限期内还留在清单里')
      assert.equal(snapshot.counts.retired, 1)
      assert.equal(snapshot.retired.length, 1)
      assert.equal(snapshot.retired[0].id, 'hy3')
      assert.ok(snapshot.retired[0].expiresAt > Date.now(), '要给出到期时间')
      // 宽限期内的模型仍然写进配置，正在跑的会话不会突然选不到模型。
      const entry = ctx.__entries.find((row) => row.ns === 'llm-pi-ai')
      assert.equal(entry.value.providers[DEFAULT_ROUTE_KEY].models.length, 3)

      // 用户点「立即移除」→ 这次真的不写了。
      await runtime.run(() => runtime.retireNow('hy3'))
      const after = ctx.__entries.find((row) => row.ns === 'llm-pi-ai')
      assert.deepEqual(
        after.value.providers[DEFAULT_ROUTE_KEY].models.map((model) => model.id),
        ['deepseek-v4.1-flash', 'hy4-preview'],
      )

      await fetch(`${base}/mock/reset`)
    } finally {
      ctx.__dispose()
    }
  })
})

describe('插件 HTTP 接口', () => {
  let server
  let base

  before(async () => {
    ;({ server, base } = await startMockHub())
  })
  after(async () => {
    await stopMockHub(server)
  })

  /** 造一个已经连上的 runtime。 */
  async function connected() {
    const ctx = await makeCtx()
    const runtime = new HubRuntime(ctx, { baseUrl: base })
    await runtime.start()
    return { ctx, runtime }
  }

  test('GET /state 返回快照，并用 ETag 支持 304', async () => {
    const { ctx, runtime } = await connected()
    try {
      const first = await expectCall(runtime, { url: `/workbuddy2api-hub/api/state` })
      assert.equal(first.status, 200)
      assert.equal(first.body.ok, true)
      assert.equal(first.body.counts.total, 3)
      const etag = first.headers.etag
      assert.match(etag, /^"[0-9a-f]{16}"$/)

      const second = await expectCall(runtime, {
        url: `/workbuddy2api-hub/api/state`,
        headers: { 'if-none-match': etag },
      })
      assert.equal(second.status, 304)
      assert.equal(second.raw.text, '', '304 不该带正文')

      // 状态一变，ETag 必须换，否则前端会一直拿到旧快照。
      await runtime.run(() => runtime.setPolicy({ retireHours: 12 }))
      const third = await expectCall(runtime, {
        url: `/workbuddy2api-hub/api/state`,
        headers: { 'if-none-match': etag },
      })
      assert.equal(third.status, 200)
      assert.notEqual(third.headers.etag, etag)
    } finally {
      ctx.__dispose()
    }
  })

  test('GET /dashboard-url 给出带 pwd 与 tab 的深链（仅本机）', async () => {
    const { ctx, runtime } = await connected()
    try {
      const result = await expectCall(runtime, { url: `/workbuddy2api-hub/api/dashboard-url` })
      assert.equal(result.status, 200)
      assert.equal(result.body.url, `${base}/?pwd=admin&tab=gateway`)
      assert.equal(result.body.tab, 'gateway')

      const remote = await expectCall(runtime, {
        url: `/workbuddy2api-hub/api/dashboard-url`,
        remoteAddress: '192.168.1.20',
      })
      assert.equal(remote.status, 403, '带密码的链接不能给非本机')
      assert.equal(JSON.stringify(remote.body).includes('admin'), false)
    } finally {
      ctx.__dispose()
    }
  })

  test('GET /usage 与 /accounts 可用', async () => {
    const { ctx, runtime } = await connected()
    try {
      const today = await expectCall(runtime, { url: `/workbuddy2api-hub/api/usage?range=today` })
      assert.equal(today.status, 200)
      assert.equal(today.body.range, 'today')
      assert.equal(today.body.usage.requests, 441)
      assert.equal(runtime.usageRange, 'today')

      // all = 不带 range，拿全量历史
      const all = await expectCall(runtime, { url: `/workbuddy2api-hub/api/usage?range=all` })
      assert.equal(all.body.range, 'all')
      assert.equal(all.body.usage.requests, 1813)
      assert.equal(runtime.usageRange, 'all')

      // 非法值退回 today，不会把空参数透给 hub
      const bad = await expectCall(runtime, { url: `/workbuddy2api-hub/api/usage?range=nope` })
      assert.equal(bad.body.range, 'today')
      assert.equal(bad.body.usage.requests, 441)

      // week 走自己的槽位，不会把 today 的数字顶掉
      const week = await expectCall(runtime, { url: `/workbuddy2api-hub/api/usage?range=week` })
      assert.equal(week.body.range, 'week')
      assert.equal(week.body.usage.requests, 1207)
      assert.equal(runtime.usage.requests, 441, 'today 槽位没被 week 覆盖')
      assert.equal(runtime.usageWeek.requests, 1207)

      const accounts = await expectCall(runtime, { url: `/workbuddy2api-hub/api/accounts` })
      assert.equal(accounts.status, 200)
      assert.equal(accounts.body.accounts.total, 2)
    } finally {
      ctx.__dispose()
    }
  })

  test('POST 写接口的三道闸', async () => {
    const { ctx, runtime } = await connected()
    try {
      const good = await expectCall(runtime, {
        method: 'POST',
        url: `/workbuddy2api-hub/api/policy`,
        body: { retireHours: 6 },
      })
      assert.equal(good.status, 200)
      assert.equal(good.body.policy.retireHours, 6)

      const crossSite = await expectCall(runtime, {
        method: 'POST',
        url: `/workbuddy2api-hub/api/policy`,
        headers: { 'sec-fetch-site': 'cross-site' },
        body: { retireHours: 1 },
      })
      assert.equal(crossSite.status, 403, '跨站页面不能改配置')

      const foreignOrigin = await expectCall(runtime, {
        method: 'POST',
        url: `/workbuddy2api-hub/api/policy`,
        headers: { origin: 'https://evil.example' },
        body: { retireHours: 1 },
      })
      assert.equal(foreignOrigin.status, 403)

      const remote = await expectCall(runtime, {
        method: 'POST',
        url: `/workbuddy2api-hub/api/policy`,
        remoteAddress: '10.0.0.5',
        body: { retireHours: 1 },
      })
      assert.equal(remote.status, 403, '只允许本机写')

      const wrongType = await expectCall(runtime, {
        method: 'POST',
        url: `/workbuddy2api-hub/api/policy`,
        headers: { 'content-type': 'text/plain' },
        body: { retireHours: 1 },
      })
      assert.equal(wrongType.status, 415)

      // 同源页面（浏览器的正常请求）应当通过。
      const sameSite = await expectCall(runtime, {
        method: 'POST',
        url: `/workbuddy2api-hub/api/policy`,
        headers: { 'sec-fetch-site': 'same-origin' },
        body: { retireHours: 8 },
      })
      assert.equal(sameSite.status, 200)
      assert.equal(runtime.state.retireHours, 8)
    } finally {
      ctx.__dispose()
    }
  })

  test('POST /config 改地址与密码后立即重连', async () => {
    const other = await startMockHub()
    const ctx = await makeCtx()
    const runtime = new HubRuntime(ctx, { baseUrl: base })
    await runtime.start()
    try {
      const result = await expectCall(runtime, {
        method: 'POST',
        url: `/workbuddy2api-hub/api/config`,
        body: { baseUrl: `${other.base}/`, pwd: 'admin', tab: 'logs' },
      })
      assert.equal(result.status, 200)
      assert.equal(result.body.baseUrl, other.base, '尾斜杠与查询串被归一掉')
      assert.equal(result.body.tab, 'logs')
      assert.equal(runtime.session.baseUrl, other.base)
      assert.equal(runtime.lastSyncError, '')
      assert.equal(runtime.snapshot().counts.total, 3)
    } finally {
      ctx.__dispose()
      await stopMockHub(other.server)
    }
  })

  test('POST /test 用给定地址探一次，不改状态', async () => {
    const other = await startMockHub({ empty: true })
    const { ctx, runtime } = await connected()
    try {
      const before = runtime.base
      const ok = await expectCall(runtime, {
        method: 'POST',
        url: `/workbuddy2api-hub/api/test`,
        body: { baseUrl: other.base, pwd: 'admin' },
      })
      assert.equal(ok.status, 200)
      assert.equal(ok.body.ok, true)
      assert.equal(ok.body.models, 0, '空模型列表也要报「连上了」')
      assert.equal(runtime.base, before, '探测不该改当前地址')
    } finally {
      ctx.__dispose()
      await stopMockHub(other.server)
    }
  })

  test('未知接口返回 404 而不是崩掉', async () => {
    const { ctx, runtime } = await connected()
    try {
      const result = await expectCall(runtime, { url: `/workbuddy2api-hub/api/nope` })
      assert.equal(result.status, 404)
      assert.match(result.body.error, /未知接口/)
    } finally {
      ctx.__dispose()
    }
  })

  test('POST /clear 需要 confirm', async () => {
    const { ctx, runtime } = await connected()
    try {
      const refused = await expectCall(runtime, {
        method: 'POST',
        url: `/workbuddy2api-hub/api/clear`,
        body: {},
      })
      assert.equal(refused.status, 400)

      const cleared = await expectCall(runtime, {
        method: 'POST',
        url: `/workbuddy2api-hub/api/clear`,
        body: { confirm: true },
      })
      assert.equal(cleared.status, 200)
      const entry = ctx.__entries.find((row) => row.ns === 'llm-pi-ai')
      assert.equal(entry.value.providers[DEFAULT_ROUTE_KEY], undefined, '清掉配置要卸载路由')
    } finally {
      ctx.__dispose()
    }
  })
})

describe('失败路径：连不上 / 密码错 / 被限流 / 没 Key', () => {
  test('连不上 hub：报明确提示，不抛异常', async () => {
    const ctx = await makeCtx()
    // 1 号端口基本不可能有人监听。
    const runtime = new HubRuntime(ctx, { baseUrl: 'http://127.0.0.1:1' })
    try {
      await runtime.start()
      assert.equal(runtime.failureKind, 'unreachable')
      assert.match(runtime.lastSyncError, /连不上 hub/)
      assert.match(runtime.lastSyncError, /8788|启动/, '要提示用户去确认服务起没起')
      const snapshot = runtime.snapshot()
      assert.equal(snapshot.counts.total, 0)
      // 单次连不上先不弹告警（服务偶尔重启不该吵人），连续失败到阈值才提醒。
      assert.equal(snapshot.alerts.some((alert) => alert.key === 'unreachable'), false)
      // 状态文件照旧可读，插件不会因为 hub 掉线而崩。
      const again = await runtime.refresh({ sync: true })
      assert.equal(again.ok, false)
      assert.equal(runtime.consecutiveFailures, 2)
      for (let index = 0; index < 3; index += 1) await runtime.refresh({ sync: true })
      assert.equal(runtime.consecutiveFailures, 5)
      assert.ok(
        runtime.snapshot().alerts.some((alert) => alert.key === 'unreachable'),
        '连续失败到阈值后要给出告警',
      )
    } finally {
      ctx.__dispose()
    }
  })

  test('密码错：报鉴权失败，且不反复重试把用户锁死', async () => {
    const { server, base } = await startMockHub()
    const ctx = await makeCtx()
    const runtime = new HubRuntime(ctx, { baseUrl: base, pwd: 'wrong-password' })
    try {
      await runtime.start()
      assert.equal(runtime.failureKind, 'auth')
      assert.match(runtime.lastSyncError, /pwd/)
      assert.equal(runtime.session.loggedIn, false)
      const alerts = runtime.alerts()
      assert.equal(alerts[0].key, 'auth')
    } finally {
      ctx.__dispose()
      await stopMockHub(server)
    }
  })

  test('被限流：429 文案带等待秒数，退避下限被抬高', async () => {
    const { server, base } = await startMockHub()
    const ctx = await makeCtx()
    const runtime = new HubRuntime(ctx, { baseUrl: base, pwd: 'wrong-password' })
    try {
      // 先 start()：只有它才会把 session 指到 mock 地址。
      // 直接在这个之前调 session.login() 会按默认地址打到用户本机真正在跑的服务。
      await runtime.start()
      assert.equal(runtime.failureKind, 'auth', '密码错先报鉴权失败')

      // hub 的限流是 60 秒 5 次，start() 已经用掉一次，再撞四次就把窗口填满。
      for (let index = 0; index < 4; index += 1) await runtime.session.login()
      const sixth = await runtime.session.login()
      assert.equal(sixth.ok, false)
      assert.equal(sixth.failure.kind, 'rate-limited')
      assert.match(sixth.failure.message, /秒/)

      await runtime.refresh({ sync: true })
      assert.equal(runtime.failureKind, 'rate-limited')
      assert.ok(runtime.retryFloorSeconds >= 1, '要按 hub 建议抬高退避下限')
    } finally {
      ctx.__dispose()
      await stopMockHub(server)
    }
  })

  test('面板里没有 API Key：模型照样列出来，但不写路由并给出告警', async () => {
    const { server, base } = await startMockHub({ noApiKey: true })
    const ctx = await makeCtx()
    const runtime = new HubRuntime(ctx, { baseUrl: base })
    try {
      await runtime.start()
      const snapshot = runtime.snapshot()
      assert.equal(snapshot.counts.total, 3, '没 Key 也要能看到模型清单')
      assert.equal(snapshot.apiKeySource, '')
      assert.match(snapshot.lastSyncError, /API Key/)
      const entry = ctx.__entries.find((row) => row.ns === 'llm-pi-ai')
      assert.equal(
        entry.value.providers[DEFAULT_ROUTE_KEY],
        undefined,
        '写了也是「一选就 401」，不如不写，让用户先看到告警',
      )
      assert.ok(snapshot.alerts.some((alert) => alert.key === 'api-key'))
    } finally {
      ctx.__dispose()
      await stopMockHub(server)
    }
  })

  test('用户在设置页填了 apiKey：优先用配置的，且写进 credentials', async () => {
    const { server, base } = await startMockHub({ noApiKey: true })
    const ctx = await makeCtx()
    const runtime = new HubRuntime(ctx, { baseUrl: base })
    await runtime.start()
    try {
      await runtime.run(() => runtime.configure({ apiKey: 'typed-by-user' }))
      assert.equal(ctx.__credentials.get('WORKBUDDY2API_HUB_API_KEY'), 'typed-by-user')
      assert.equal(runtime.apiKeySource, 'credentials')
      const result = await runtime.run(() => runtime.refresh({ sync: true }))
      assert.equal(result.ok, true)
      const entry = ctx.__entries.find((row) => row.ns === 'llm-pi-ai')
      assert.equal(entry.value.providers[DEFAULT_ROUTE_KEY].models.length, 3)
    } finally {
      ctx.__dispose()
      await stopMockHub(server)
    }
  })

  test('配置里的 apiKey 优先于面板自动获取', async () => {
    const { server, base } = await startMockHub()
    const ctx = await makeCtx()
    const runtime = new HubRuntime(ctx, { baseUrl: base, apiKey: 'from-yaml' })
    try {
      await runtime.start()
      assert.equal(runtime.apiKeySource, 'config')
      assert.equal(ctx.__credentials.get('WORKBUDDY2API_HUB_API_KEY'), 'from-yaml')
    } finally {
      ctx.__dispose()
      await stopMockHub(server)
    }
  })
})

describe('配置驱动：只改配置就能换地址/密码/页签', () => {
  let first
  let second

  before(async () => {
    first = await startMockHub({ password: 'one' })
    second = await startMockHub({ password: 'two' })
  })
  after(async () => {
    await stopMockHub(first.server)
    await stopMockHub(second.server)
  })

  test('第一次用配置 A，配置改成 B 后重启即生效', async () => {
    const ctx = await makeCtx()
    const runtimeA = new HubRuntime(ctx, { baseUrl: first.base, pwd: 'one', tab: 'gateway' })
    await runtimeA.start()
    assert.equal(runtimeA.base, first.base)
    assert.equal(runtimeA.lastSyncError, '')
    assert.equal(runtimeA.session.pwd, 'one')

    // 模拟用户在 cordis.patch.yml 里把地址、密码、页签都改掉，然后重启 DSH。
    const runtimeB = new HubRuntime(ctx, { baseUrl: second.base, pwd: 'two', tab: 'analytics' })
    await runtimeB.start()
    try {
      assert.equal(runtimeB.base, second.base, '配置里显式写的地址优先')
      assert.equal(runtimeB.pwd, 'two')
      assert.equal(runtimeB.tab, 'analytics')
      assert.equal(runtimeB.lastSyncError, '')
      assert.equal(runtimeB.dashboardUrl(), `${second.base}/?pwd=two&tab=analytics`)
    } finally {
      ctx.__dispose()
    }
  })

  test('配置没改时，设置页里改过的值不会被重启抹掉', async () => {
    const ctx = await makeCtx()
    const config = { baseUrl: first.base, pwd: 'one' }
    const runtime = new HubRuntime(ctx, config)
    await runtime.start()
    try {
      // 用户在设置页里把页签改成 logs、间隔改成 300 秒。
      await runtime.run(() => runtime.configure({ tab: 'logs', intervalSeconds: 300 }))
      assert.equal(runtime.tab, 'logs')

      // 重启：配置一个字都没动。
      const restarted = new HubRuntime(ctx, config)
      await restarted.start()
      assert.equal(restarted.tab, 'logs', '配置指纹没变 → 保留用户最后一次选择')
      assert.equal(restarted.state.intervalSeconds, 300)
    } finally {
      ctx.__dispose()
    }
  })

  test('状态文件落盘 + 重新读取', async () => {
    const ctx = await makeCtx()
    const runtime = new HubRuntime(ctx, { baseUrl: first.base, pwd: 'one' })
    await runtime.start()
    try {
      const { readFile } = await import('node:fs/promises')
      const { join } = await import('node:path')
      const file = join(ctx.__dir, 'workbuddy2api-hub.json')
      const parsed = JSON.parse(await readFile(file, 'utf8'))
      assert.equal(parsed.baseUrl, first.base)
      assert.equal(parsed.pwd, 'one')
      assert.ok(Array.isArray(parsed.lastModelIds))
      assert.equal(JSON.stringify(parsed).includes('mock-api-key'), false, '状态文件里不能有 Key 明文')
    } finally {
      ctx.__dispose()
    }
  })
})

describe('无关宿主也能跑：没有 settings / credentials', () => {
  test('没有 settings 服务时：能连、能读，但同步失败要报明确原因', async () => {
    const { server, base } = await startMockHub()
    const ctx = await makeCtx({ noSettings: true, noCredentials: true })
    // 没有 settings 时 stateDirOf 会退回真实 profile 目录——那里此刻正躺着
    // 用户真实安装写出的状态文件（18 个模型），不钉住就会读到别人的数据。
    const runtime = new HubRuntime(ctx, { baseUrl: base, stateDir: ctx.__dir })
    try {
      await runtime.start()
      assert.equal(runtime.snapshot().counts.total, 3)
      // 面板自动取到的 Key 没法写进凭据库，于是同步被跳过并给出原因。
      assert.equal(runtime.apiKeySource, 'panel')
      assert.match(runtime.snapshot().lastSyncError, /settings 服务不可用/)
      assert.equal(ctx.__mutations.length, 0)
      void makeResponse
      void makeRequest
      void waitFor
    } finally {
      ctx.__dispose()
      await stopMockHub(server)
    }
  })
})
