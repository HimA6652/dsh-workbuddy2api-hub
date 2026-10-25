/**
 * 前端 bundle 的契约：ModuleLoader 形状、插槽注册、网络层容错。
 *
 * 不启动 DSH、不开浏览器：把 `client/client.js` 丢进 `node:vm` 里跑，
 * 用假的 `window.__ModuleLoader__`、`document`、`fetch` 观察它到底做了什么。
 * 这里覆盖的三件事出问题都会让「设置页整块空白」，是最值得钉住的部分。
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT_FILE = join(HERE, '..', 'client', 'client.js')

/**
 * 最小的 React 替身。
 *
 * 只提供本文件用得到的东西：`createElement` 生成普通对象，hooks 返回可预测的值。
 * 真正的渲染交给 DSH 宿主，这里只验证组件是函数、能拿到注入的 `t`。
 * @returns React 形状的对象。
 */
function fakeReact() {
  return {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: 'Fragment',
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useMemo: (factory) => factory(),
    useCallback: (fn) => fn,
    useRef: (initial) => ({ current: initial }),
  }
}

/**
 * 在 vm 里加载前端 bundle。
 * @param options.fetchImpl - 假 fetch。
 * @param options.baseURI - `document.baseURI`。
 * @param options.primitives - 是否提供 `@deepseek-ai/dsh-client-ui-primitives`。
 * @returns `{ id, exports, requests, sandbox }`。
 */
async function loadClient({ fetchImpl, baseURI = 'http://127.0.0.1:60881/', primitives = false } = {}) {
  const source = await readFile(CLIENT_FILE, 'utf8')
  const requests = []
  let captured = null
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(options) {
          captured = options
        },
      },
      open() {},
    },
    document: { baseURI, hidden: false },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    AbortSignal,
    // vm 的新 context 只有 ECMAScript 内建，`URL` 这类要显式喂进去，
    // 否则 `apiPath()` 会以「URL is not defined」炸掉（浏览器里当然有）。
    URL,
    URLSearchParams,
    fetch: async (url, init) => {
      requests.push({ url, init })
      if (typeof fetchImpl !== 'function') throw new Error('测试没有配 fetch')
      return fetchImpl(url, init)
    },
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(source, sandbox, { filename: CLIENT_FILE })
  assert.ok(captured !== null, 'bundle 没有调用 window.__ModuleLoader__.load')
  const require = (id) => {
    if (id === 'react') return fakeReact()
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      if (primitives === false) throw new Error('宿主没装这个包')
      return primitives
    }
    throw new Error(`bundle 要了一个不该要的模块：${id}`)
  }
  const exports = captured.factory(require)
  return { id: captured.id, exports, requests, sandbox }
}

/** 组装一个够用的假 ctx：locale + effect + 两个插槽。 */
function fakeCtx() {
  const registered = []
  const dictionaries = []
  const effects = []
  const ctx = {
    locale: {
      bind: (ns) => (key) => {
        const entry = dictionaries.find((item) => item.ns === ns)
        const dict = entry?.dict?.zh ?? {}
        return dict[key] ?? key
      },
      register: (ns, dict) => {
        dictionaries.push({ ns, dict })
      },
    },
    effect: (factory, label) => {
      effects.push(label)
      factory()
    },
    slots: {
      inject: (name, callback) => callback(),
      register: (options, Component) => {
        registered.push({ options, Component })
        return Component
      },
    },
  }
  return { ctx, registered, dictionaries, effects }
}

describe('ModuleLoader 形状', () => {
  test('id 与包名一致，inject 只要 slots 和 locale', async () => {
    const { id, exports } = await loadClient()
    assert.equal(id, 'dsh-workbuddy2api-hub')
    // vm 里的数组原型与主 realm 不同，展开一下再比，免得 deepStrictEqual 判原型不等。
    assert.deepEqual([...exports.inject], ['slots', 'locale'])
    assert.equal(exports.NS, 'workbuddy2api-hub')
  })

  test('只依赖 react：宿主没有 primitives 包也不该炸', async () => {
    const { exports } = await loadClient({ primitives: false })
    assert.equal(typeof exports.apply, 'function')
  })

  test('primitives 在的时候会用它（Button 走宿主组件）', async () => {
    const used = []
    const primitives = {
      Button: (props) => {
        used.push(props)
        return { type: 'host-button', props }
      },
    }
    const { exports } = await loadClient({ primitives })
    const { ctx } = fakeCtx()
    exports.apply(ctx)
    assert.ok(used.length === 0, '没渲染之前不该调用宿主组件')
    assert.equal(typeof exports.__HubPanel, 'function')
  })
})

describe('apply()：插槽与字典', () => {
  test('注册设置页分区与侧边栏徽标两块', async () => {
    const { exports } = await loadClient()
    const { ctx, registered } = fakeCtx()
    exports.apply(ctx)
    assert.equal(registered.length, 2)
    const [section, footer] = registered
    assert.equal(section.options.name, 'settings.section')
    assert.equal(section.options.id, 'workbuddy-hub')
    assert.equal(section.options.locale, 'workbuddy2api-hub')
    assert.equal(typeof section.Component, 'function')
    assert.equal(footer.options.name, 'sidebar.footer.action')
    assert.equal(footer.options.id, 'workbuddy-hub-quota')
    assert.equal(typeof footer.Component, 'function')
  })

  test('label 是函数，返回本地化文案（不是硬编码中文）', async () => {
    const { exports } = await loadClient()
    const { ctx, registered } = fakeCtx()
    exports.apply(ctx)
    const [section, footer] = registered
    const nav = section.options.label()
    const footerLabel = footer.options.label()
    assert.equal(typeof nav, 'string')
    assert.ok(nav.length > 0)
    assert.ok(footerLabel.length > 0)
    assert.notEqual(nav, 'nav', '取不到翻译时兜底也应该有字')
    const injected = section.options.inject()
    assert.equal(typeof injected.t, 'function')
  })

  test('中文与英文字典的键完全一致（漏译会在界面上留英文）', async () => {
    const { exports } = await loadClient()
    const zh = Object.keys(exports.__dicts.zh).sort()
    const en = Object.keys(exports.__dicts.en).sort()
    assert.deepEqual(zh, en)
  })

  test('字典真的注册给了宿主', async () => {
    const { exports } = await loadClient()
    const { ctx, dictionaries, effects } = fakeCtx()
    exports.apply(ctx)
    const entry = dictionaries.find((item) => item.ns === 'workbuddy2api-hub')
    assert.ok(entry !== undefined, '没有注册字典')
    assert.equal(typeof entry.dict.zh, 'object')
    assert.equal(typeof entry.dict.en, 'object')
    assert.ok(effects.some((label) => label.startsWith('workbuddy2api-hub')), 'effect 标签要带前缀，方便宿主排查')
  })

  test('单块插槽挂不上时不影响另一块', async () => {
    const { exports } = await loadClient()
    const { ctx, registered } = fakeCtx()
    ctx.slots.inject = (name, callback) => {
      if (name === 'settings.section') throw new Error('宿主没有这个插槽')
      callback()
    }
    exports.apply(ctx)
    assert.equal(registered.length, 1)
    assert.equal(registered[0].options.name, 'sidebar.footer.action')
  })
})

describe('网络层', () => {
  test('api 路径带 baseURI 前缀，查询串不能丢', async () => {
    const { exports } = await loadClient()
    assert.equal(exports.__apiPath('state'), '/workbuddy2api-hub/api/state')
    assert.equal(exports.__apiPath('/state'), '/workbuddy2api-hub/api/state')
    assert.equal(exports.__apiPath('usage?range=today'), '/workbuddy2api-hub/api/usage?range=today')
  })

  test('宿主挂在子路径下时也要对（不能写死绝对路径）', async () => {
    const { exports } = await loadClient({ baseURI: 'http://127.0.0.1:60881/app/' })
    assert.equal(exports.__apiPath('state'), '/app/workbuddy2api-hub/api/state')
  })

  test('304 复用上一份快照，不重复解析', async () => {
    const { exports } = await loadClient({
      fetchImpl: async () => ({
        status: 304,
        ok: false,
        headers: new Map([['etag', '"deadbeefdeadbeef"']]),
        json: async () => {
          throw new Error('304 不该读 body')
        },
      }),
    })
    const result = await exports.__requestJson('state', { previous: { counts: { total: 3 } } })
    assert.equal(result.ok, true)
    assert.equal(result.notModified, true)
    assert.deepEqual(result.data, { counts: { total: 3 } })
    assert.equal(result.etag, '"deadbeefdeadbeef"')
  })

  test('连不上宿主时给中文提示，不抛异常', async () => {
    const { exports } = await loadClient({
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    const result = await exports.__requestJson('state')
    assert.equal(result.ok, false)
    assert.match(result.error, /无法连接 DSH 宿主/)
  })

  test('超时被识别成超时，而不是普通网络错误', async () => {
    const { exports } = await loadClient({
      fetchImpl: async () => {
        const error = new Error('timed out')
        error.name = 'TimeoutError'
        throw error
      },
    })
    const result = await exports.__requestJson('state')
    assert.equal(result.ok, false)
    assert.match(result.error, /超时/)
  })

  test('宿主回了 HTML（比如代理错误页）也不崩', async () => {
    const { exports } = await loadClient({
      fetchImpl: async () => ({
        status: 502,
        ok: false,
        headers: new Map(),
        json: async () => {
          throw new SyntaxError('Unexpected token <')
        },
      }),
    })
    const result = await exports.__requestJson('state')
    assert.equal(result.ok, false)
    assert.match(result.error, /非 JSON/)
  })

  test('宿主用 ok:false 表达业务失败时，取它的 error 文案', async () => {
    const { exports } = await loadClient({
      fetchImpl: async () => ({
        status: 200,
        ok: true,
        headers: new Map(),
        json: async () => ({ ok: false, error: '只允许本机访问' }),
      }),
    })
    const result = await exports.__requestJson('bulk', { method: 'POST', body: { ids: [] } })
    assert.equal(result.ok, false)
    assert.match(result.error, /只允许本机/)
  })

  test('POST 会带 content-type 并序列化 body', async () => {
    const { exports, requests } = await loadClient({
      fetchImpl: async () => ({
        status: 200,
        ok: true,
        headers: new Map(),
        json: async () => ({ ok: true }),
      }),
    })
    await exports.__requestJson('config', { method: 'POST', body: { baseUrl: 'http://127.0.0.1:8788' } })
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, '/workbuddy2api-hub/api/config')
    assert.equal(requests[0].init.method, 'POST')
    assert.equal(requests[0].init.headers['content-type'], 'application/json')
    assert.deepEqual(JSON.parse(requests[0].init.body), { baseUrl: 'http://127.0.0.1:8788' })
    assert.equal(requests[0].init.credentials, 'same-origin')
  })
})

describe('共享 store', () => {
  test('set 会通知订阅者，退订后不再通知', async () => {
    const { exports } = await loadClient()
    const store = exports.__store
    let hits = 0
    const unsubscribe = store.subscribe(() => {
      hits += 1
    })
    store.set({ counts: { total: 1 } })
    assert.equal(hits, 1)
    assert.deepEqual(store.get().snapshot, { counts: { total: 1 } })
    unsubscribe()
    store.set({ counts: { total: 2 } })
    assert.equal(hits, 1)
  })

  test('fail 之后能读到错误文案，再 set 会被清掉', async () => {
    const { exports } = await loadClient()
    const store = exports.__store
    store.fail('连不上 hub')
    assert.equal(store.get().error, '连不上 hub')
    assert.equal(store.get().loading, false)
    store.set({ counts: { total: 0 } })
    assert.equal(store.get().error, '')
  })
})

describe('配色：必须用 DSH 真正注册的主题令牌', () => {
  // 曾经的 bug：palette 写了 `--dsh-text-primary`（这个名字在 DSH 0.2.1 里不存在），
  // var() 静默走兜底，而兜底是给深色主题写的浅灰字 —— 用户切到浅色主题后
  // 设置页变成「浅灰字 + 白底」，看着像整块没渲染。这里把令牌名钉死。
  test('每个颜色都是 --dsw-alias-* 令牌（带兜底值）', async () => {
    const { exports } = await loadClient()
    const palette = exports.__palette
    assert.ok(Object.keys(palette).length >= 8)
    for (const [name, value] of Object.entries(palette)) {
      assert.match(value, /^var\(--dsw-alias-[a-z0-9-]+,\s*.+\)$/, `palette.${name} 必须是主题令牌：${value}`)
    }
  })

  test('正文颜色与卡片表面都挂在令牌上，没有写死深色值', async () => {
    const { exports } = await loadClient()
    const palette = exports.__palette
    const styles = exports.__styles
    assert.equal(styles.wrap.color, palette.text)
    assert.equal(styles.h1.color, undefined, '标题应继承正文颜色')
    assert.equal(styles.input.background, palette.card2)
    assert.equal(styles.button.background, palette.card2)
    assert.equal(styles.banner('info').background, palette.card2)
    assert.equal(styles.table.color, undefined)
    // 深色主题专用的半透明白/黑会让浅色主题发灰。
    // `var(--token, rgba(...))` 里的兜底不算：先把兜底剥掉，再看剩下有没有写死的底色。
    const flat = JSON.stringify(styles, (key, value) => (typeof value === 'function' ? value('info') : value))
    const withoutFallbacks = flat.replace(/,\s*rgba\([^)]*\)\)/g, ')')
    assert.equal(/rgba\(255,255,255|rgba\(0,0,0/.test(withoutFallbacks), false, `样式里还有写死的深色底：${withoutFallbacks}`)
  })
})

describe('模型表排序', () => {
  // hub 返回的顺序是按它自己的账号权重来的，看着很乱；宿主那边排过一次，
  // 这里再兜一次底，保证宿主没热更新时表格也不乱。
  test('按名称排序：忽略大小写、数字按数值、同名按 id', async () => {
    const { exports } = await loadClient()
    const sorted = exports.__sortRowsByName([
      { id: 'glm-5.10', name: 'GLM-5.10' },
      { id: 'hy4-preview', name: 'Hy4 preview' },
      { id: 'glm-5.2', name: 'GLM-5.2' },
      { id: 'kimi-k3-1' },
      { id: 'b', name: 'Alpha' },
      { id: 'a', name: 'alpha' },
    ])
    assert.deepEqual([...sorted.map((row) => row.id)], ['a', 'b', 'glm-5.2', 'glm-5.10', 'hy4-preview', 'kimi-k3-1'])
  })

  test('不修改入参、非数组返回空数组', async () => {
    const { exports } = await loadClient()
    const input = [{ id: 'z', name: 'Z' }, { id: 'a', name: 'A' }]
    const sorted = exports.__sortRowsByName(input)
    assert.notEqual(sorted, input)
    assert.deepEqual([...input.map((row) => row.id)], ['z', 'a'])
    assert.deepEqual([...exports.__sortRowsByName(null)], [])
  })
})

/**
 * 多 key 快照：徽标的所有数字都从这里来。
 *
 * 两条 key（主 key `key-a` + `key-c`），三个窗口的用量都给全，
 * 免得某条断言其实读到的是全局兜底值。
 */
function multiSnapshot() {
  const keyaToday = { totalTokens: 72300000, credit: 61.41, costCny: 10.39 }
  const keyaWeek = { totalTokens: 260700000, credit: 465.43, costCny: 31.17 }
  const poolToday = { totalTokens: 213, credit: 0, costCny: 0 }
  const poolWeek = { totalTokens: 639, credit: 0, costCny: 0 }
  return {
    baseUrl: 'http://127.0.0.1:8788',
    health: { ok: true },
    balance: { balance: 3731.61, accountsEnabled: 190 },
    mainKeyBalance: { remain: 2841.06, bound: 2, found: 2, enabled: 2, missing: 0 },
    mainKeyId: 'keya0001',
    mainKeyMissing: false,
    keys: [
      {
        hubKeyId: 'keya0001',
        name: 'key-a',
        routeKey: 'workbuddy2api-hub',
        isMain: true,
        accounts: 2,
        balance: { remain: 2841.06, bound: 2, found: 2, enabled: 2, missing: 0 },
        usage: keyaToday,
        usageWeek: keyaWeek,
      },
      {
        hubKeyId: 'keyc0001',
        name: 'key-c',
        routeKey: 'workbuddy2api-hub-key-c',
        isMain: false,
        accounts: 2,
        balance: { remain: 88.5, bound: 2, found: 2, enabled: 2, missing: 0 },
        usage: poolToday,
        usageWeek: poolWeek,
      },
    ],
    usageByKey: { keya0001: keyaToday, keyc0001: poolToday },
    usageWeekByKey: { keya0001: keyaWeek, keyc0001: poolWeek },
    // 整域数故意和主 key 不同，用来证明弹窗的「总计」是按各 key 相加、不是整域口径
    usage: { totalTokens: 80000000, credit: 70, costCny: 12 },
    usageWeek: { totalTokens: 300000000, credit: 500, costCny: 35 },
    usageRange: 'today',
  }
}

// 一行「今日 / 本周」右半边是三个数字格，按顺序取文字。
function numsOf(row) {
  return row.children[1].children.map((node) => node.children.join(''))
}

describe('侧边栏徽标：三行数字', () => {
  test('footerSummary 把余额/今日 tokens/今日积分/API 等价算成可读文本', async () => {
    const { exports } = await loadClient()
    const summary = exports.__footerSummary({
      balance: { balance: 3693.4242 },
      usage: { totalTokens: 42765524, credit: 40.919999999999916, costCny: 6.245129849 },
      usageRange: 'today',
    })
    assert.equal(summary.balance, '3693.42')
    assert.equal(summary.tokens, '42.77M', 'tokens 也保留两位小数')
    assert.equal(summary.credit, '40.92')
    assert.equal(summary.cost, '¥6.25')
    assert.equal(summary.range, 'today')
  })

  test('数字一律两位小数：k/M/B 缩写也不去掉尾零', async () => {
    const { exports } = await loadClient()
    const num = (value) =>
      exports.__footerSummary({ usage: { totalTokens: value, credit: 1, costCny: 1 } }).tokens
    assert.equal(num(999), '999.00', '整数也补两位，全列统一')
    assert.equal(num(1234), '1.23k')
    assert.equal(num(1200), '1.20k', '尾零要留着，否则同一列参差不齐')
    assert.equal(num(72300000), '72.30M')
    assert.equal(num(260700000), '260.70M')
    assert.equal(num(1234567890), '1.23B')
  })

  test('快照还没到 / 字段缺失时不抛错，显示占位符', async () => {
    const { exports } = await loadClient()
    const empty = exports.__footerSummary(null)
    assert.deepEqual(
      { ...empty },
      { balance: '—', tokens: '—', credit: '—', cost: '—', range: 'all', scoped: false, keyName: '' },
    )

    const noUsage = exports.__footerSummary({ balance: { balance: 0 } })
    assert.equal(noUsage.balance, '0.00', '余额 0 是有效值，不能当缺失')
    assert.equal(noUsage.tokens, '—')
  })

  test('两个语言包都带了徽标与用量表的标签', async () => {
    const { exports } = await loadClient()
    for (const dict of [exports.__dicts.zh, exports.__dicts.en]) {
      for (const key of [
        'footerLabel',
        'footerBalance',
        'footerApiCost',
        'rangeToday',
        'rangeWeek',
        'rangeMonth',
        'rangeAll',
        'tokensUnit',
        'creditUnit',
        'keyDetail',
        'totalRow',
        'colCost',
        'keyAccounts',
      ]) {
        assert.equal(typeof dict[key], 'string', key)
        assert.notEqual(dict[key], '', key)
      }
      assert.equal(dict.usage24h, undefined, '旧的「近 24 小时」标签要清掉')
      assert.equal(dict.dashboardPwd, undefined, '「打开面板时带上密码」整条功能已删')
    }
    assert.equal(exports.__dicts.zh.footerLabel, 'WorkBuddy')
    assert.equal(exports.__dicts.zh.rangeToday, '今日')
    assert.equal(exports.__dicts.zh.rangeAll, '累计')
    assert.equal(exports.__dicts.zh.totalRow, '总计')
    assert.equal(exports.__dicts.zh.colCost, '等价')
    assert.equal(exports.__dicts.en.totalRow, 'Total')

    // 窗口名要如实反映：老宿主没有 usageRange 时是「全量」，不能标成今日
    assert.equal(exports.__footerSummary({ usage: { totalTokens: 1, credit: 0, costCny: 0 } }).range, 'all')
    assert.equal(exports.__footerSummary({ usageRange: 'week' }).range, 'week')
    assert.equal(exports.__footerSummary({ usageRange: 'MONTH' }).range, 'month')
    assert.equal(exports.__footerSummary({ usageRange: 'nope' }).range, 'all')
  })

  test('展开态三行：key 名 + 该 key 余额/总余额、今日、本周，数字各自右对齐', async () => {
    const { exports } = await loadClient()
    const zh = exports.__dicts.zh
    const t = (key) => zh[key] ?? key

    // 当前会话用的是主 key 的路由，所以取主 key 的余额与用量。
    exports.__setProviderState({ value: 'workbuddy2api-hub', routable: true })
    exports.__store.set(multiSnapshot())

    const tree = exports.__HubFooter({ t, wide: true })
    assert.equal(tree.type, 'Fragment', '徽标与弹窗是兄弟节点，不是一个空壳')
    const badge = tree.children[0]
    assert.equal(badge.type, 'button')
    assert.equal(badge.props.className, 'wbhub_badge')
    assert.equal(badge.props.title, undefined, '不再用悬停提示')
    assert.equal(badge.props['aria-haspopup'], 'dialog')

    const [glyph, body] = badge.children
    assert.equal(glyph.type, exports.__HubGlyph, '图标在左，和参考插件一致')
    assert.equal(body.props.className, 'wbhub_badgeBody')

    // 第一行：key 名 + 「该 key 余额 / 总余额」
    const [nameNode, valueNode] = body.children[0].children
    assert.equal(nameNode.children.join(''), 'key-a', '第一行写当前 key 的名字')
    assert.equal(valueNode.children.join(''), '2841.06 / 3731.61')

    // 第二、三行：窗口名在左，三个数字在右，两行同构
    const rowOf = (index) => body.children[index]
    assert.equal(rowOf(1).props.className, 'wbhub_usageRow')
    assert.equal(rowOf(1).children[0].children.join(''), t('rangeToday'))
    assert.deepEqual(numsOf(rowOf(1)), ['72.30M', '61.41', '¥10.39'])
    assert.equal(rowOf(2).children[0].children.join(''), t('rangeWeek'))
    assert.deepEqual(numsOf(rowOf(2)), ['260.70M', '465.43', '¥31.17'])

    // 三列等宽 + 等宽字体，数字才能上下对齐
    assert.match(exports.__css, /\.wbhub_usageNums\{[^}]*grid-template-columns:[^}]*justify-items:end/)
  })

  test('切到别的 key 的会话：余额与今日/本周都换成那条 key 的数', async () => {
    const { exports } = await loadClient()
    const zh = exports.__dicts.zh
    const t = (key) => zh[key] ?? key

    exports.__setProviderState({ value: 'workbuddy2api-hub-key-c', routable: true })
    exports.__store.set(multiSnapshot())

    const tree = exports.__HubFooter({ t, wide: true })
    const body = tree.children[0].children[1]
    const [nameNode, valueNode] = body.children[0].children
    assert.equal(nameNode.children.join(''), 'key-c', '名字跟着会话走')
    assert.equal(valueNode.children.join(''), '88.50 / 3731.61', '余额也按这条 key 算，不是主 key 的 2841.06')
    assert.deepEqual(numsOf(body.children[1]), ['213.00', '0.00', '¥0.00'])
    assert.deepEqual(numsOf(body.children[2]), ['639.00', '0.00', '¥0.00'])

    // 会话用的不是网关模型（provider 为空）：回落主 key
    exports.__setProviderState({ value: 'some-other-provider', routable: true })
    const fallback = exports.__HubFooter({ t, wide: true })
    const fallbackBody = fallback.children[0].children[1]
    assert.equal(fallbackBody.children[0].children[0].children.join(''), 'key-a')
    assert.equal(fallbackBody.children[0].children[1].children.join(''), '2841.06 / 3731.61')
  })

  test('点击出副窗：贴着徽标上沿，不再用悬停 title；各 key 用量表照图排', async () => {
    const { exports } = await loadClient()
    const zh = exports.__dicts.zh
    const t = (key) => zh[key] ?? key

    exports.__setProviderState({ value: 'workbuddy2api-hub', routable: true })
    exports.__store.set(multiSnapshot())

    const tree = exports.__HubFooter({ t, wide: true })
    const overlay = tree.children[1]
    assert.equal(overlay.type, exports.__HubOverlay, '弹窗外壳可单独测')
    assert.equal(overlay.children[0].props.className, 'wbhub_detail')

    // 外壳本身：点遮罩关闭；从没打开过就不渲染任何东西
    assert.equal(exports.__HubOverlay({ open: false }), null)
    const pop = exports.__HubOverlay({ open: true, anchor: { left: 12, bottom: 96 }, title: 'x', closeLabel: '关闭' })
    assert.equal(pop.props.className, 'wbhub_popMask')
    const card = pop.children[0]
    assert.equal(card.props.className, 'wbhub_pop')
    assert.equal(card.props.style.left, '12px', '副窗贴着徽标左沿')
    assert.equal(card.props.style.bottom, '96px', '往上弹，不是居中')
    assert.equal(card.children[0].props.className, 'wbhub_popHead')
    assert.equal(card.children[0].children[1].props.className, 'wbhub_popClose')

    const detail = tree.children[1].children[0]
    // 1) 当前会话 + 2) 两个余额格子（不再有今日/本周两行）
    assert.equal(detail.children[0].props.className, 'wbhub_detailHead')
    const metrics = detail.children[1]
    assert.equal(metrics.props.className, 'wbhub_metrics')
    assert.equal(metrics.children.length, 2)
    assert.equal(metrics.children[0].children[0].children.join(''), 'key-a 积分余额')

    // 3) 各 key 用量：列标题 + 每条 key 一段 + 总计
    const block = detail.children[2]
    assert.equal(block.children[0].children.join(''), t('keyDetail'))
    const table = block.children[1]
    assert.equal(table.props.className, 'wbhub_usageTable')

    const head = table.children[0]
    assert.equal(head.props.className, 'wbhub_usageHead')
    assert.deepEqual(numsOf(head), [t('tokensUnit'), t('creditUnit'), t('colCost')])

    const first = table.children[1]
    assert.equal(first.props.className, 'wbhub_usageItem')
    const title = first.children[0]
    assert.equal(title.props.className, 'wbhub_usageTitle')
    assert.equal(title.children[1].children.join(''), 'key-a')
    assert.equal(title.children[2].children.join(''), '账号 2')
    assert.equal(first.children[1].children[0].children.join(''), t('rangeToday'))
    assert.deepEqual(numsOf(first.children[1]), ['72.30M', '61.41', '¥10.39'])
    assert.deepEqual(numsOf(first.children[2]), ['260.70M', '465.43', '¥31.17'])

    const second = table.children[2]
    assert.equal(second.children[0].children[1].children.join(''), 'key-c')

    const total = table.children[3]
    assert.equal(total.props.className, 'wbhub_usageTotal')
    assert.equal(total.children[0].children[0].children.join(''), t('totalRow'))
    // 总计直接用 /usage 的整域汇总（夹具里是 80.00M / 70.00），不是上面两条 key 相加的 72.30M
    assert.deepEqual(numsOf(total.children[1]), ['80.00M', '70.00', '¥12.00'], '总计读网关整域数')
    assert.deepEqual(numsOf(total.children[2]), ['300.00M', '500.00', '¥35.00'])

    // 4) 底部两个按钮：打开面板 / 关闭
    const actions = detail.children[6]
    assert.equal(actions.props.className, 'wbhub_footActions')
    assert.equal(actions.children.length, 2)
  })

  test('主 key 被删：徽标直接写已删除，弹窗提示重选模型', async () => {
    const { exports } = await loadClient()
    const zh = exports.__dicts.zh
    const t = (key) => zh[key] ?? key

    const snapshot = multiSnapshot()
    snapshot.mainKeyMissing = true
    snapshot.keys[0].missing = true
    exports.__setProviderState({ value: 'workbuddy2api-hub', routable: false })
    exports.__store.set(snapshot)

    const tree = exports.__HubFooter({ t, wide: true })
    const body = tree.children[0].children[1]
    assert.equal(body.children[0].children[1].children.join(''), `${t('footerMainDeleted')} / 3731.61`)

    const detail = tree.children[1].children[0]
    const notes = detail.children.filter((node) => node !== null && node.props.className === 'wbhub_detailNote')
    assert.ok(
      notes.some((node) => node.children.join('').includes(t('reselectHint'))),
      '模型已经不可用，要提示重选',
    )
  })

  test('没有 usageWeek 的老宿主不画本周行，也不拿今日数冒充本周', async () => {
    const { exports } = await loadClient()
    const zh = exports.__dicts.zh
    const t = (key) => zh[key] ?? key

    const snapshot = multiSnapshot()
    delete snapshot.usageWeek
    delete snapshot.usageWeekByKey
    for (const key of snapshot.keys) delete key.usageWeek
    exports.__setProviderState({ value: 'workbuddy2api-hub', routable: true })
    exports.__store.set(snapshot)

    const tree = exports.__HubFooter({ t, wide: true })
    const body = tree.children[0].children[1]
    assert.equal(body.children.length, 3)
    assert.equal(body.children[2], null, '本周那一行整个不画')

    const table = tree.children[1].children[0].children[2].children[1]
    assert.equal(table.children[1].children[2], null, '各 key 用量里也不画本周')
    assert.equal(table.children[3].children[2], null, '总计也不画本周')
  })

  test('收起态只留 36×36 圆形图标，没有文字', async () => {
    const { exports } = await loadClient()
    const zh = exports.__dicts.zh
    const t = (key) => zh[key] ?? key

    exports.__setProviderState({ value: 'workbuddy2api-hub', routable: true })
    exports.__store.set(multiSnapshot())

    const tree = exports.__HubFooter({ t, wide: false })
    const badge = tree.children[0]
    assert.equal(badge.props.className, 'wbhub_badge wbhub_badgeRail')
    assert.equal(badge.children.length, 2)
    assert.equal(badge.children[1], null, 'rail 里没有文字，只有图标')
    assert.match(exports.__css, /\.wbhub_badgeRail\{[^}]*width:36px;height:36px/)
  })

  test('样式：徽标贴底换行、三列数字等宽、副窗不是居中模态', async () => {
    const { exports } = await loadClient()
    assert.match(exports.__css, /\.wbhub_badge\{[^}]*flex:1 0 100%/, 'footer 里独占一行')
    assert.match(exports.__css, /\[class\*=footerActions\]\{flex-wrap:wrap\}/)
    assert.match(exports.__css, /\.wbhub_num\{text-align:right/)
    assert.match(exports.__css, /\.wbhub_pop\{position:fixed/)
    assert.equal(exports.__css.includes('.wbhub_modal'), false, '旧的居中模态样式已删')
    assert.equal(exports.__css.includes('.wbhub_overlay'), false, '旧的遮罩样式已删')
    assert.equal(exports.__injectStyles(), false, '没有 document 时静默跳过')
  })
  test('每条 key 的模型表：主 key 默认摊开，其余收起，点过就照记录走', async () => {
    const { exports } = await loadClient()
    const open = exports.__keyFoldOpen
    assert.equal(open({}, { hubKeyId: 'k1', isMain: true }), true, '主 key 没点过就是摊开的')
    assert.equal(open({}, { hubKeyId: 'k2', isMain: false }), false, '其它 key 没点过是收起的')
    assert.equal(open(undefined, { hubKeyId: 'k3', isMain: true }), true, '状态还没建立时按默认算')
    assert.equal(open({ k1: false }, { hubKeyId: 'k1', isMain: true }), false, '主 key 也能手动收起')
    assert.equal(open({ k2: true }, { hubKeyId: 'k2', isMain: false }), true, '非主 key 也能手动摊开')
    assert.equal(open({}, {}), false, '缺字段时当收起处理，不炸')
    assert.match(exports.__css, /\.wbhub_keyFold\{/, '折叠按钮的样式要在')
    assert.match(exports.__css, /\.wbhub_keyFoldArrow\{/, '折叠箭头也要有样式')
  })

  test('已同步模型数取所有 key 的并集去重，不是各条路由条数相加', async () => {
    const { exports } = await loadClient()
    const model = (id, extra = {}) => ({ id, enabled: true, retired: false, ...extra })

    // 用户给的例子：A 启 1/2/3、B 启 2/3/4、C 启 1/5 → 合成 1/2/3/4/5，共 5 个。
    // 各条路由加起来是 3 + 4 + 2 = 9，那是「按 key 重复计数」，不是能选到的模型数。
    const snapshot = {
      lastSyncCount: 9,
      counts: { total: 19 },
      keys: [
        { hubKeyId: 'A', isMain: true, lastSyncCount: 3, models: [model('1'), model('2'), model('3')] },
        { hubKeyId: 'B', isMain: false, lastSyncCount: 4, models: [model('2'), model('3'), model('4')] },
        { hubKeyId: 'C', isMain: false, lastSyncCount: 2, models: [model('1'), model('5')] },
      ],
    }
    assert.equal(exports.__syncedModelCount(snapshot), 5, '1/2/3/4/5 去重后是 5 个')

    // 没勾的、下架的都不算；两条 key 勾了同一个模型只算一次。
    const mixed = {
      lastSyncCount: 99,
      keys: [
        { models: [model('glm-5.3'), model('hy3', { enabled: false })] },
        { models: [model('glm-5.3'), model('kimi-k3', { retired: true }), model('step-5-preview')] },
      ],
    }
    assert.equal(exports.__syncedModelCount(mixed), 2, 'glm-5.3 只算一次，hy3 没勾、kimi-k3 下架都不算')

    // 一条都没勾（或老宿主没给 models）时退回宿主记的条数，别显示 0 骗人。
    assert.equal(exports.__syncedModelCount({ lastSyncCount: 13, keys: [] }), 13, '没有 keys 时回落到合计')
    assert.equal(exports.__syncedModelCount({ keys: [{ models: [] }], lastSyncCount: 4 }), 4)
    assert.equal(exports.__syncedModelCount(null), 0)
  })

  test('版本与 API Key 来源：中文口径跟网关一致（cn=国内版 / intl=国际版）', async () => {
    const { exports } = await loadClient()
    const zh = exports.__dicts.zh
    const en = exports.__dicts.en
    const t = (key) => zh[key] ?? key

    assert.equal(exports.__realmText({ health: { realm: 'cn' } }, t), '国内版')
    assert.equal(exports.__realmText({ health: { realm: 'intl' } }, t), '国际版')
    assert.equal(exports.__realmText({ health: { realm: 'beta' } }, t), 'beta', '没见过的版本原样显示')
    assert.equal(exports.__realmText({ health: {} }, t), '—')
    assert.equal(exports.__realmText(null, t), '—')

    assert.equal(exports.__apiKeySourceText('config', t), '手动填写')
    assert.equal(exports.__apiKeySourceText('credentials', t), '凭据库')
    assert.equal(exports.__apiKeySourceText('cached', t), '凭据库')
    assert.equal(exports.__apiKeySourceText('panel', t), '面板自动获取')
    assert.equal(exports.__apiKeySourceText('', t), '未配置')

    const keys = [
      'realmLabel',
      'realmCn',
      'realmIntl',
      'apiKeySourceLabel',
      'apiKeyFromConfig',
      'apiKeyFromCredentials',
      'apiKeyFromPanel',
      'apiKeyMissing',
    ]
    for (const key of keys) {
      assert.equal(typeof zh[key], 'string', `zh 缺 ${key}`)
      assert.equal(typeof en[key], 'string', `en 缺 ${key}`)
    }
    assert.equal(en.realmCn, 'China')
    assert.equal(en.realmIntl, 'Global')
  })

})
