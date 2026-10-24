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

describe('侧边栏徽标：五项数字', () => {
  test('footerSummary 把余额/今日 tokens/今日积分/API 等价算成可读文本', async () => {
    const { exports } = await loadClient()
    const summary = exports.__footerSummary({
      balance: { balance: 3693.4242 },
      usage: { totalTokens: 42765524, credit: 40.919999999999916, costCny: 6.245129849 },
      usageRange: 'today',
    })
    assert.equal(summary.balance, '3693.42')
    assert.equal(summary.tokens, '42.8M')
    assert.equal(summary.credit, '40.92')
    assert.equal(summary.cost, '¥6.25')
    assert.equal(summary.range, 'today')
  })

  test('快照还没到 / 字段缺失时不抛错，显示占位符', async () => {
    const { exports } = await loadClient()
    const empty = exports.__footerSummary(null)
    assert.deepEqual({ ...empty }, { balance: '—', tokens: '—', credit: '—', cost: '—', range: 'all' })

    const noUsage = exports.__footerSummary({ balance: { balance: 0 } })
    assert.equal(noUsage.balance, '0.00', '余额 0 是有效值，不能当缺失')
    assert.equal(noUsage.tokens, '—')
  })

  test('两个语言包都带了徽标的五个标签', async () => {
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
      ]) {
        assert.equal(typeof dict[key], 'string', key)
        assert.notEqual(dict[key], '', key)
      }
      assert.equal(dict.usage24h, undefined, '旧的「近 24 小时」标签要清掉')
    }
    assert.equal(exports.__dicts.zh.footerLabel, 'WorkBuddy')
    assert.equal(exports.__dicts.zh.rangeToday, '今日')
    assert.equal(exports.__dicts.zh.rangeAll, '累计')

    // 窗口名要如实反映：老宿主没有 usageRange 时是「全量」，不能标成今日
    assert.equal(exports.__footerSummary({ usage: { totalTokens: 1, credit: 0, costCny: 0 } }).range, 'all')
    assert.equal(exports.__footerSummary({ usageRange: 'week' }).range, 'week')
    assert.equal(exports.__footerSummary({ usageRange: 'MONTH' }).range, 'month')
    assert.equal(exports.__footerSummary({ usageRange: 'nope' }).range, 'all')
  })

  test('展开态第二、三行：窗口名贴左，三个数字贴右', async () => {
    const { exports } = await loadClient()
    const zh = exports.__dicts.zh
    const t = (key) => zh[key] ?? key

    exports.__store.set({
      baseUrl: 'http://127.0.0.1:8788',
      health: { ok: true },
      balance: { balance: 3731.61 },
      usage: { totalTokens: 49942298, credit: 45.57, costCny: 7.21 },
      usageWeek: { totalTokens: 119260000, credit: 118.44, costCny: 17.88 },
      usageRange: 'today',
    })

    const tree = exports.__HubFooter({ t, wide: true })
    assert.equal(tree.type, 'button')
    const [row1, rowToday, rowWeek] = tree.children

    // 第一行：状态点 + WorkBuddy + 积分余额
    const head = row1.children.map((node) => (typeof node === 'string' ? node : node.children.join('')))
    assert.deepEqual(head, ['', 'WorkBuddy', '3731.61'])

    // 每个数据行 = [左标签, 右侧数字组]，数字组里是「值 · 值 · 值」
    const flatten = (node) => (typeof node === 'string' ? node : node.children.map(flatten).flat(Infinity))
    for (const [row, label, expected] of [
      [rowToday, '今日', ['49.9M', '·', '45.57', '·', '¥7.21']],
      [rowWeek, '本周', ['119.3M', '·', '118.44', '·', '¥17.88']],
    ]) {
      const [left, right] = row.children
      assert.deepEqual(flatten(left), [label], '窗口名贴左')
      assert.deepEqual(flatten(right), expected, '三个数字贴右')
      assert.equal(row.props.style.alignItems, 'baseline')
      assert.equal(right.props.style.marginLeft, 'auto', '右侧数字顶到最右，两行才对得齐')
      assert.equal(left.props.style.minWidth, '44px', '左标签留固定宽度，中文两个字才不抖')
    }
  })

  test('悬停框里今日与本周格式统一', async () => {
    const { exports } = await loadClient()
    const t = (key) => exports.__dicts.zh[key] ?? key
    exports.__store.set({
      baseUrl: 'http://127.0.0.1:8788',
      health: { ok: true },
      balance: { balance: 3715.39 },
      usage: { totalTokens: 72300000, credit: 61.41, costCny: 10.39 },
      usageWeek: { totalTokens: 260700000, credit: 465.43, costCny: 31.17 },
      usageRange: 'today',
    })
    const lines = exports.__HubFooter({ t, wide: true }).props.title.split('\n')
    assert.deepEqual(lines, [
      'WorkBuddy · 积分余额 3715.39',
      '今日 tokens 72.3M · 积分 61.41 · API 等价 ¥10.39',
      '本周 tokens 260.7M · 积分 465.43 · API 等价 ¥31.17',
      'http://127.0.0.1:8788',
    ])
    // 同构：把窗口名换成占位、把数字换成占位，两行必须一字不差
    const shape = (line) => line.replace(/^(今日|本周)/, '<窗口>').replace(/[0-9][0-9.]*[KMB]?/g, '<数>')
    assert.equal(shape(lines[1]), shape(lines[2]))
    assert.equal(shape(lines[1]), '<窗口> tokens <数> · 积分 <数> · API 等价 ¥<数>')
    // 收起态共用同一个 title，不该有两套文案
    exports.__store.set({ balance: { balance: 1 }, usage: { totalTokens: 1, credit: 1, costCny: 1 }, usageRange: 'today' })
    const narrow = exports.__HubFooter({ t, wide: false }).props.title.split('\n')
    assert.equal(narrow[1], '今日 tokens 1 · 积分 1.00 · API 等价 ¥1.00')
  })

  test('没有 usageWeek 的老宿主不画第三行，也不拿今日数冒充本周', async () => {
    const { exports } = await loadClient()
    const t = (key) => exports.__dicts.zh[key] ?? key
    exports.__store.set({
      balance: { balance: 1 },
      usage: { totalTokens: 1000, credit: 1, costCny: 0.5 },
      usageRange: 'today',
    })
    const tree = exports.__HubFooter({ t, wide: true })
    // React 把 null 子节点渲染成空，这里也照这个口径数行数。
    assert.equal(tree.children.filter((node) => node !== null && node !== undefined).length, 2, '只有标题行 + 今日行')
    assert.equal(tree.children.at(-1), null, '第三行位置是 null，不是拿今日数据顶替')
    assert.equal(exports.__footerSummary({ usageWeek: { totalTokens: 1, credit: 2, costCny: 3 } }, 'week').range, 'week')
  })
})
