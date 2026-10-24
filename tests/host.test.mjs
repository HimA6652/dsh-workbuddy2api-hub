/**
 * 宿主侧契约：`apply()` 向 cordis 要了什么、注册了什么、清理时做了什么。
 *
 * 全部用 tests/helpers.mjs 里的假 ctx，不启动 DSH —— 插件对宿主的所有依赖都收敛在
 * `ctx.get` / `ctx.inject` / `ctx.effect` / `webServer.register` 四个调用上。
 */

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { apply, constants, name } from '../lib/index.js'
import {
  makeCtx,
  makeRequest,
  makeResponse,
  startMockHub,
  stopMockHub,
  waitFor,
} from './helpers.mjs'

/**
 * 打一次注册好的插件路由。
 * @param ctx - `apply()` 挂过的假上下文。
 * @param options - 透传给 `makeRequest`。
 * @returns `{ status, headers, body, raw }`。
 */
async function hit(ctx, options = {}) {
  const route = ctx.__routes[0]
  assert.ok(route !== undefined, '路由没注册')
  const request = makeRequest(options)
  const response = makeResponse()
  await route.handler(request, response)
  let body
  try {
    body = response.text === '' ? undefined : JSON.parse(response.text)
  } catch {
    body = response.text
  }
  return { status: response.status, headers: response.headers, body, raw: response }
}

/**
 * 装一个插件实例并等首次启动跑完（启动是 fire-and-forget 的 promise）。
 * @param options - `{ config, ctx }`。
 * @returns `{ ctx, server, base }`。
 */
async function mount({ config = {}, ctxOptions = {}, hubOptions = {} } = {}) {
  const { server, base } = await startMockHub(hubOptions)
  const ctx = await makeCtx(ctxOptions)
  try {
    // stateDir 钉在临时目录：否则没有 settings 的 ctx 会退回真实 profile 目录，
    // 测试之间互相污染（还会读到用户机器上真在用的状态文件）。
    apply(ctx, { baseUrl: base, pwd: 'admin', stateDir: ctx.__dir, ...config })
    // 启动完成 = 已经拉到模型清单，或者已经明确报出失败原因。
    await waitFor(async () => {
      const result = await hit(ctx, { url: '/workbuddy2api-hub/api/state' })
      return (result.body?.counts?.total ?? 0) > 0 || (result.body?.lastSyncError ?? '') !== ''
    })
  } catch (error) {
    ctx.__dispose()
    await stopMockHub(server)
    throw error
  }
  return { ctx, server, base }
}

describe('插件标识与常量', () => {
  test('name 必须与 cordis.patch.yml 里的 id 一致', () => {
    assert.equal(name, 'workbuddy-hub')
  })

  test('默认值就是用户给的本地地址 / admin / gateway', () => {
    assert.equal(constants.DEFAULT_BASE_URL, 'http://127.0.0.1:8788')
    assert.equal(constants.DEFAULT_PWD, 'admin')
    assert.equal(constants.DEFAULT_TAB, 'gateway')
    assert.equal(constants.DEFAULT_ROUTE_KEY, 'workbuddy2api-hub')
    assert.equal(constants.DEFAULT_API_KEY_ENV, 'WORKBUDDY2API_HUB_API_KEY')
    assert.equal(constants.DEFAULT_PROVIDER_ENTRY, 'llm-pi-ai')
    assert.equal(constants.PLUGIN_VERSION, '1.0.10')
  })

  test('tab 白名单与 hub 的 TABS 一致', () => {
    assert.deepEqual(constants.TABS, [
      'gateway',
      'accounts',
      'tasks',
      'analytics',
      'agents',
      'settings',
      'logs',
    ])
  })
})

describe('apply()：向宿主注册什么', () => {
  test('注册一个前缀路由 + 三个 effect', async () => {
    const ctx = await makeCtx({ noSettings: true, noCredentials: true })
    try {
      apply(ctx, { baseUrl: 'http://127.0.0.1:1', stateDir: ctx.__dir })
      assert.equal(ctx.__routes.length, 1, '只该有一条路由')
      assert.equal(ctx.__routes[0].kind, 'prefix')
      assert.equal(ctx.__routes[0].path, '/workbuddy2api-hub/api')
      assert.deepEqual(
        ctx.__effects.map((effect) => effect.label),
        ['workbuddy-hub: startup', 'workbuddy-hub: polling', 'workbuddy-hub: routes'],
      )
    } finally {
      ctx.__dispose()
    }
  })

  test('宿主没有 webServer 时安静退出，不抛', async () => {
    const ctx = await makeCtx({ noSettings: true, noCredentials: true })
    // 缺 webServer：`ctx.inject` 的回调不会被执行。
    const withoutWebServer = { ...ctx, get: () => undefined, inject: () => undefined }
    apply(withoutWebServer, { baseUrl: 'http://127.0.0.1:1' })
    assert.equal(ctx.__routes.length, 0)
    assert.equal(ctx.__effects.length, 0)
  })

  test('清理是幂等的：宿主卸载插件时重复调用也不抛', async () => {
    const ctx = await makeCtx({ noSettings: true, noCredentials: true })
    apply(ctx, { baseUrl: 'http://127.0.0.1:1', stateDir: ctx.__dir })
    ctx.__dispose()
    assert.doesNotThrow(() => ctx.__dispose())
    assert.equal(ctx.__routes.length, 0, '路由要跟着摘掉')
  })
})

describe('装好之后就能用', () => {
  test('GET /state 走通整条链路：登录、模型、额度、用量', async () => {
    const { ctx, server } = await mount({ ctxOptions: { noSettings: true, noCredentials: true } })
    try {
      const result = await hit(ctx, { url: '/workbuddy2api-hub/api/state' })
      assert.equal(result.status, 200)
      assert.match(result.headers['content-type'], /application\/json/)
      assert.equal(result.body.ok, true)
      assert.equal(result.body.counts.total, 3)
      assert.equal(result.body.balance.balance, 3712.57)
      // 默认窗口是 today（hub 只认 range，不认 hours）
      assert.equal(result.body.usageRange, 'today')
      assert.equal(result.body.usage.requests, 441)
      // 徽标第三行要本周，宿主刷新时固定多拉一次 week
      assert.equal(result.body.usageWeek.requests, 1207)
      assert.equal(result.body.models[0].id, 'deepseek-v4.1-flash')
      assert.equal(result.body.pwd, undefined, '快照里不带密码')
    } finally {
      ctx.__dispose()
      await stopMockHub(server)
    }
  })

  test('配置里的 tab 非法时退回 gateway（深链参数不能乱传）', async () => {
    const { ctx, server } = await mount({
      config: { tab: 'not-a-tab' },
      ctxOptions: { noSettings: true, noCredentials: true },
    })
    try {
      const result = await hit(ctx, { url: '/workbuddy2api-hub/api/state' })
      assert.equal(result.body.tab, 'gateway')
      const link = await hit(ctx, { url: '/workbuddy2api-hub/api/dashboard-url' })
      assert.match(link.body.url, /\?pwd=admin&tab=gateway$/)
    } finally {
      ctx.__dispose()
      await stopMockHub(server)
    }
  })

  test('hub 挂在不可达地址：/state 仍返回 200 与明确文案', async () => {
    const ctx = await makeCtx({ noSettings: true, noCredentials: true, dir: undefined })
    try {
      apply(ctx, { baseUrl: 'http://127.0.0.1:1', stateDir: ctx.__dir })
      await waitFor(async () => {
        const result = await hit(ctx, { url: '/workbuddy2api-hub/api/state' })
        return typeof result.body?.lastSyncError === 'string' && result.body.lastSyncError !== ''
      })
      const result = await hit(ctx, { url: '/workbuddy2api-hub/api/state' })
      assert.equal(result.status, 200, 'hub 掉线不能让面板接口挂掉')
      assert.match(result.body.lastSyncError, /连不上 hub/)
      assert.equal(result.body.counts.total, 0)
    } finally {
      ctx.__dispose()
    }
  })

  test('外机发来的请求拿不到看板深链，也写不了要（只有本机能改）', async () => {
    const { ctx, server } = await mount({ ctxOptions: { noSettings: true, noCredentials: true } })
    try {
      const remote = { remoteAddress: '192.168.1.20' }
      const link = await hit(ctx, {
        url: '/workbuddy2api-hub/api/dashboard-url',
        ...remote,
      })
      assert.equal(link.status, 403, '带 pwd 的深链只给本机')

      const write = await hit(ctx, {
        method: 'POST',
        url: '/workbuddy2api-hub/api/bulk',
        body: { enabled: false },
        headers: { 'sec-fetch-site': 'same-origin' },
        ...remote,
      })
      assert.equal(write.status, 403)
      assert.match(write.body.error, /只允许本机/)
    } finally {
      ctx.__dispose()
      await stopMockHub(server)
    }
  })

  test('未知接口回 404，拼错的路径不会打到宿主其它路由', async () => {
    const { ctx, server } = await mount({ ctxOptions: { noSettings: true, noCredentials: true } })
    try {
      const result = await hit(ctx, { url: '/workbuddy2api-hub/api/nope' })
      assert.equal(result.status, 404)
      assert.match(result.body.error, /未知接口 GET \/nope/)
    } finally {
      ctx.__dispose()
      await stopMockHub(server)
    }
  })
})

describe('后台轮询与清理', () => {
  test('轮询按配置间隔排队，卸载后不再排新的、也不留定时器', async () => {
    const { server, base } = await startMockHub()
    const ctx = await makeCtx({ noSettings: true, noCredentials: true })
    const originalSetTimeout = globalThis.setTimeout
    const originalClearTimeout = globalThis.clearTimeout
    const scheduled = []
    globalThis.setTimeout = (fn, ms, ...rest) => {
      // 只接管轮询那种长定时器；fetch/undici 自己的短定时器必须原样放行，
      // 否则它们永远不触发，`sleep()` 之类的等待会一起卡住。
      if (!(ms >= 30000)) return originalSetTimeout(fn, ms, ...rest)
      // 形状要够像 Timeout：undici 内部会调 `.unref()`，不给会直接抛。
      const handle = {
        fn,
        ms,
        cleared: false,
        unref() {
          return handle
        },
        ref() {
          return handle
        },
        hasRef() {
          return false
        },
        refresh() {
          return handle
        },
      }
      scheduled.push(handle)
      return handle
    }
    globalThis.clearTimeout = (handle) => {
      if (handle !== undefined && handle !== null && 'cleared' in handle) {
        handle.cleared = true
        return
      }
      originalClearTimeout(handle)
    }
    // 定时器被接管后 waitFor 用的也是 setTimeout，这里用接管前的原版来等待。
    const sleep = (ms) => new Promise((resolve) => originalSetTimeout(resolve, ms))
    const until = async (predicate, timeoutMs = 5000) => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (predicate()) return true
        await sleep(25)
      }
      return false
    }
    try {
      apply(ctx, { baseUrl: base, pwd: 'admin', intervalSeconds: 120, stateDir: ctx.__dir })
      await sleep(20)
      assert.equal(scheduled.length, 1, 'tick 先排一次')
      assert.ok(scheduled[0].ms >= 30000, '间隔有 30 秒下限，别把 hub 当心跳包打')

      // 手动跑一轮：refresh 结束后 finally 里会再 tick 一次。
      scheduled[0].fn()
      assert.equal(await until(() => scheduled.length >= 2), true, '一轮跑完要接着排下一轮')

      const timer = scheduled.at(-1)
      ctx.__dispose()
      assert.equal(timer.cleared, true, '卸载要清掉定时器')
      const count = scheduled.length
      timer.fn()
      await sleep(300)
      assert.equal(scheduled.length, count, '已停止的轮询不该再排新的')
    } finally {
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
      ctx.__dispose()
      await stopMockHub(server)
    }
  })
})
