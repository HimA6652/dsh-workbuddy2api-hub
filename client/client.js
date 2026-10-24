window.__ModuleLoader__.load({
  id: 'dsh-workbuddy2api-hub',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    /**
     * dsh-workbuddy2api-hub 的前端部分。
     *
     * 两处挂载：
     *   - `settings.section`：完整面板（连接配置、模型勾选、策略、告警）；
     *   - `sidebar.footer.action`：一个额度小徽标，随时能看到还剩多少。
     *
     * 两个插槽是两个独立的 React 根，所以它们共享本模块里的一个轻量 store：
     * 谁先挂载谁启动轮询，都卸载了就停掉，避免后台空转。
     */

    const react = require('react')
    const h = react.createElement
    const useState = react.useState
    const useEffect = react.useEffect
    const useMemo = react.useMemo

    /**
     * UI 基础组件。DSH 并没有稳定的 primitives 包（不同发行版里可能不存在），
     * 所以这里只在拿得到的时候借它的按钮/开关，拿不到就用原生元素——绝不能因为
     * 一个 require 失败导致整块设置页白屏。
     */
    let primitives = null
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    } catch {
      primitives = null
    }

    const NS = 'workbuddy2api-hub'
    const API_BASE = 'workbuddy2api-hub/api/'
    const POLL_MS = 15000
    const API_TIMEOUT_MS = 15000

    /** 中英文案。key 尽量语义化，改文案不用改组件。 */
    const zh = {
      nav: 'WorkBuddy Hub',
      footerLabel: 'WorkBuddy',
      title: 'WorkBuddy Hub',
      subtitle: '把本地 workbuddy2api-hub 的模型接到 DSH',
      connection: '连接',
      baseUrl: '服务地址',
      baseUrlHint: '默认 http://127.0.0.1:8788',
      pwd: '面板密码（pwd）',
      pwdHint: '只用于换取面板会话，不会写进对话请求',
      tab: '默认页签',
      apiKey: 'API Key',
      apiKeyHint: '对话请求用；留空则尝试从面板自动获取',
      interval: '轮询间隔（秒）',
      save: '保存并刷新',
      test: '测试连接',
      testing: '正在测试…',
      openDashboard: '打开看板',
      refresh: '刷新',
      clear: '移除 DSH 路由',
      clearConfirm: '会从 llm-pi-ai 里删掉本插件写入的路由，并停止自动同步。继续？',
      saved: '已保存',
      testOk: '连接正常',
      loadFailed: '读取状态失败',
      models: '模型',
      model: '模型',
      rate: '倍率',
      context: '上下文',
      output: '输出上限',
      efforts: '思考档位',
      enabled: '启用',
      all: '全选',
      none: '全不选',
      enableNew: '启用新模型',
      newModels: '新上架',
      retired: '已下架',
      removeNow: '立即移除',
      policy: '策略',
      newModelPolicy: '新上架模型',
      policySelect: '自动勾选',
      policyIgnore: '先不勾选',
      retireHours: '下架宽限期（小时）',
      lowCredits: '低额度阈值',
      autoApiKey: '自动从面板取 API Key',
      health: '服务',
      accounts: '账号',
      ready: '就绪',
      needRelogin: '需重登',
      expired: '已过期',
      balance: '额度',
      usageToday: '今日',
      footerBalance: '积分余额',
      footerApiCost: 'API 等价',
      rangeToday: '今日',
      rangeWeek: '本周',
      rangeMonth: '本月',
      rangeAll: '累计',
      tokensUnit: 'tokens',
      creditUnit: '积分',
      requests: '请求',
      errors: '错误',
      tokens: 'Token',
      cost: '花费',
      synced: '已同步',
      notSynced: '未同步',
      noModels: 'hub 还没返回任何模型',
      noApiKey: '没有可用 API Key（面板密码不能当 Bearer 用）',
      loginState: '面板会话',
      loggedIn: '已登录',
      loggedOut: '未登录',
      autoSynced: '自动同步到 DSH',
      disabledSync: '自动同步已关闭',
      dismiss: '知道了',
      unsupported: '当前 hub 版本不支持该接口',
      unknownError: '未知错误',
      loading: '加载中…',
      pwdDefault: 'hub 仍在使用默认密码',
      pendingSync: '同步被宿主事务推迟，下一次刷新会补做',
      pluginVersion: '插件',
      routeKey: '路由键',
      modelsEnabled: '已启用',
      avgRate: '平均倍率',
      cacheHit: '缓存命中',
      reasons: '告警',
    }

    const en = {
      nav: 'WorkBuddy Hub',
      footerLabel: 'WB credit',
      title: 'WorkBuddy Hub',
      subtitle: 'Bridge a local workbuddy2api-hub into DSH',
      connection: 'Connection',
      baseUrl: 'Service URL',
      baseUrlHint: 'Default http://127.0.0.1:8788',
      pwd: 'Panel password (pwd)',
      pwdHint: 'Used only to open a panel session',
      tab: 'Default tab',
      apiKey: 'API key',
      apiKeyHint: 'Used for chat requests; leave blank to reuse the panel key',
      interval: 'Poll interval (s)',
      save: 'Save and refresh',
      test: 'Test connection',
      testing: 'Testing…',
      openDashboard: 'Open dashboard',
      refresh: 'Refresh',
      clear: 'Remove DSH route',
      clearConfirm: 'Remove the route written by this plugin and stop syncing?',
      saved: 'Saved',
      testOk: 'Connection works',
      loadFailed: 'Failed to read state',
      models: 'Models',
      model: 'Model',
      rate: 'Rate',
      context: 'Context',
      output: 'Max output',
      efforts: 'Reasoning',
      enabled: 'Enabled',
      all: 'Select all',
      none: 'Select none',
      enableNew: 'Enable new models',
      newModels: 'New',
      retired: 'Retired',
      removeNow: 'Remove now',
      policy: 'Policy',
      newModelPolicy: 'New models',
      policySelect: 'Select automatically',
      policyIgnore: 'Leave unselected',
      retireHours: 'Retire grace (hours)',
      lowCredits: 'Low credit threshold',
      autoApiKey: 'Fetch API key from panel',
      health: 'Service',
      accounts: 'Accounts',
      ready: 'ready',
      needRelogin: 'relogin',
      expired: 'expired',
      balance: 'Credit',
      usageToday: 'Today',
      footerBalance: 'Credits',
      footerApiCost: 'API equiv.',
      rangeToday: 'Today',
      rangeWeek: 'This week',
      rangeMonth: 'This month',
      rangeAll: 'Total',
      tokensUnit: 'tokens',
      creditUnit: 'credits',
      requests: 'Requests',
      errors: 'Errors',
      tokens: 'Tokens',
      cost: 'Cost',
      synced: 'synced',
      notSynced: 'not synced',
      noModels: 'hub returned no models',
      noApiKey: 'No API key available (the panel token is not a bearer token)',
      loginState: 'Panel session',
      loggedIn: 'signed in',
      loggedOut: 'signed out',
      autoSynced: 'Syncing into DSH',
      disabledSync: 'Sync disabled',
      dismiss: 'Got it',
      unsupported: 'This hub version does not expose that endpoint',
      unknownError: 'Unknown error',
      loading: 'Loading…',
      pwdDefault: 'hub still uses the default password',
      pendingSync: 'Sync was deferred by a host transaction; the next refresh retries',
      pluginVersion: 'Plugin',
      routeKey: 'Route key',
      modelsEnabled: 'enabled',
      avgRate: 'Average rate',
      cacheHit: 'Cache hit',
      reasons: 'Alerts',
    }

    /* ------------------------------- 配色 ------------------------------- */

    // 主题令牌用 DSH 真正注册的那套 `--dsw-alias-*`（不是早期的 `--dsh-*`）。
    // 名字写错时 var() 会静默走兜底值：兜底是给深色主题写的浅灰字，
    // 一旦用户切到浅色主题，就变成「浅灰字 + 白底」——看着像没渲染出来。
    // 所以这里必须用真名，兜底只是最后一道保险。
    const palette = {
      text: 'var(--dsw-alias-label-primary, #e8e8ea)',
      muted: 'var(--dsw-alias-label-secondary, #9a9aa2)',
      faint: 'var(--dsw-alias-state-idle-primary, #6f6f78)',
      line: 'var(--dsw-alias-border-l1, rgba(255,255,255,0.12))',
      lineStrong: 'var(--dsw-alias-border-l2, rgba(255,255,255,0.22))',
      card: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,0.03))',
      card2: 'var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.06))',
      accent: 'var(--dsw-alias-brand-primary, #4d8dff)',
      ok: 'var(--dsw-alias-state-success-primary, #4ec9a5)',
      warn: 'var(--dsw-alias-state-warn-primary, #d9a441)',
      err: 'var(--dsw-alias-state-error-primary, #e0605f)',
    }

    const styles = {
      wrap: { display: 'flex', flexDirection: 'column', gap: '14px', color: palette.text, fontSize: '13px' },
      card: {
        border: `1px solid ${palette.line}`,
        borderRadius: '10px',
        background: palette.card,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      },
      header: { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' },
      h1: { fontSize: '15px', fontWeight: 600, margin: 0 },
      sub: { color: palette.muted, fontSize: '12px' },
      row: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
      field: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '180px', flex: '1 1 180px' },
      label: { fontSize: '12px', color: palette.muted },
      // 次要提示也用 label-secondary：state-idle 在浅色主题下对比度太低，
      // 11px 的字再用它就看不清了（用户就是这么发现的）。
      hint: { fontSize: '11px', color: palette.muted },
      input: {
        background: palette.card2,
        border: `1px solid ${palette.line}`,
        borderRadius: '7px',
        color: palette.text,
        padding: '7px 9px',
        fontSize: '13px',
        font: 'inherit',
        width: '100%',
        boxSizing: 'border-box',
      },
      button: {
        background: palette.card2,
        border: `1px solid ${palette.line}`,
        borderRadius: '7px',
        color: palette.text,
        padding: '6px 11px',
        fontSize: '12px',
        cursor: 'pointer',
        font: 'inherit',
      },
      buttonPrimary: {
        background: palette.accent,
        border: `1px solid ${palette.accent}`,
        borderRadius: '7px',
        color: '#fff',
        padding: '6px 11px',
        fontSize: '12px',
        cursor: 'pointer',
        font: 'inherit',
      },
      badge: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '1px 7px',
        borderRadius: '999px',
        border: `1px solid ${palette.line}`,
        fontSize: '11px',
        color: palette.muted,
        whiteSpace: 'nowrap',
      },
      table: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' },
      th: {
        textAlign: 'left',
        padding: '6px 8px',
        color: palette.muted,
        fontWeight: 500,
        borderBottom: `1px solid ${palette.line}`,
        whiteSpace: 'nowrap',
      },
      td: { padding: '6px 8px', borderBottom: `1px solid ${palette.line}`, verticalAlign: 'middle' },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '11px' },
      banner: (tone) => ({
        border: `1px solid ${tone === 'error' ? palette.err : tone === 'warning' ? palette.warn : palette.line}`,
        background: tone === 'error' ? 'rgba(224,96,95,0.10)' : tone === 'warning' ? 'rgba(217,164,65,0.10)' : palette.card2,
        borderRadius: '8px',
        padding: '8px 10px',
        fontSize: '12px',
        color: palette.text,
        display: 'flex',
        gap: '8px',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
      }),
      dot: (ok) => ({
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: ok ? palette.ok : palette.err,
        display: 'inline-block',
      }),
    }

    /* ------------------------------ 网络层 ------------------------------ */

    /**
     * 把插件内的相对路径解析成带 baseURI 前缀的路径。
     *
     * DSH 可能挂在子路径下（`/app`），所以不能写死 `/workbuddy2api-hub/api/...`；
     * 必须经过 `document.baseURI`。同时要保留 `?hours=` 这类查询串——
     * 只取 pathname 会把它丢掉。
     * @param path - 接口相对路径。
     * @returns 可直接 fetch 的路径。
     */
    function apiPath(path) {
      const cleaned = String(path).replace(/^\/+/, '')
      const url = new URL(API_BASE + cleaned, document.baseURI)
      return `${url.pathname}${url.search}`
    }

    /**
     * 带超时的 fetch。
     *
     * 用 `AbortSignal.timeout`（现代浏览器/Electron 都有）；拿不到就不带超时，
     * 至少不会因为一个缺少的 API 直接把整块 UI 打死。
     * @returns 可用于 fetch 的 signal。
     */
    function timeoutSignal(ms) {
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        return AbortSignal.timeout(ms)
      }
      return undefined
    }

    /**
     * 请求本插件的宿主接口。
     *
     * 返回值永远是一个对象：网络错误、超时、非 JSON 响应都折成
     * `{ ok: false, error }`，调用处不需要 try/catch。
     * @param path - 接口相对路径。
     * @param options.method - HTTP 方法。
     * @param options.body - 请求体（会 JSON 序列化）。
     * @param options.headers - 额外请求头。
     * @returns `{ ok, data, error, notModified }`。
     */
    async function requestJson(path, options = {}) {
      const method = options.method ?? 'GET'
      const init = { method, headers: { ...(options.headers ?? {}) }, credentials: 'same-origin' }
      const signal = timeoutSignal(API_TIMEOUT_MS)
      if (signal !== undefined) init.signal = signal
      if (options.body !== undefined) {
        init.headers['content-type'] = 'application/json'
        init.body = JSON.stringify(options.body)
      }
      let response
      try {
        response = await fetch(apiPath(path), init)
      } catch (error) {
        const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError'
        return {
          ok: false,
          error: timeout
            ? `接口超时（${API_TIMEOUT_MS / 1000} 秒没有响应）`
            : `无法连接 DSH 宿主：${error?.message ?? '网络错误'}`,
        }
      }
      if (response.status === 304) {
        return { ok: true, notModified: true, data: options.previous, etag: response.headers.get('etag') ?? '' }
      }
      let payload
      try {
        payload = await response.json()
      } catch {
        return { ok: false, error: `宿主返回了非 JSON 内容（HTTP ${response.status}）` }
      }
      if (!response.ok || payload?.ok === false) {
        return { ok: false, error: payload?.error ?? `HTTP ${response.status}`, data: payload }
      }
      return { ok: true, data: payload, etag: response.headers.get('etag') ?? '' }
    }

    /* ------------------------------ 共享状态 ---------------------------- */

    /**
     * 两个 React 根之间的最小发布订阅。
     *
     * 谁挂载谁订阅；订阅者归零就停掉轮询。`etag` 让「什么都没变」的那一轮
     * 只花一个 304 的往返——快照本身有十几 KB，15 秒一轮全量拉太浪费。
     */
    const store = (() => {
      const listeners = new Set()
      let snapshot = null
      let error = ''
      let loading = true
      let etag = ''
      let timer = 0
      let inflight = null

      const emit = () => {
        for (const listener of listeners) {
          try {
            listener()
          } catch {
            // 单个订阅者渲染出错不该影响另一个根。
          }
        }
      }

      const set = (next) => {
        snapshot = next
        error = ''
        loading = false
        emit()
      }

      const fail = (message) => {
        error = message
        loading = false
        emit()
      }

      const load = async (force = false) => {
        if (inflight !== null) return inflight
        inflight = (async () => {
          const result = await requestJson('state', {
            headers: force || etag === '' ? {} : { 'if-none-match': etag },
            previous: snapshot,
          })
          if (result.ok) {
            if (result.notModified !== true && result.data !== undefined) {
              set({ ...result.data })
              // 宿主用「快照正文的 sha1 前 16 位」当 ETag，下一轮带上它就能拿到 304。
              etag = typeof result.etag === 'string' ? result.etag : ''
            } else {
              loading = false
              emit()
            }
          } else {
            fail(result.error ?? '未知错误')
          }
          inflight = null
          return result
        })()
        return inflight
      }

      const start = () => {
        if (timer !== 0) return
        load(true)
        timer = setInterval(() => {
          if (typeof document !== 'undefined' && document.hidden === true) return
          load(false)
        }, POLL_MS)
      }

      const stop = () => {
        if (listeners.size > 0) return
        if (timer !== 0) {
          clearInterval(timer)
          timer = 0
        }
      }

      return {
        get: () => ({ snapshot, error, loading }),
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
            if (listeners.size === 0) stop()
          }
        },
        start,
        reload: () => load(true),
        set,
        fail,
      }
    })()

    /** 订阅 store 的 hook。 */
    function useStore() {
      const [, force] = useState(0)
      useEffect(() => {
        const unsubscribe = store.subscribe(() => force((value) => value + 1))
        store.start()
        return unsubscribe
      }, [])
      return store.get()
    }

    /** 按钮：优先用宿主的 primitives，拿不到就原生。 */
    function Button(props) {
      const Component = primitives?.Button
      const { primary, children, ...rest } = props
      if (typeof Component === 'function') {
        return h(Component, { ...rest, variant: primary ? 'primary' : 'secondary' }, children)
      }
      return h('button', { ...rest, type: 'button', style: primary ? styles.buttonPrimary : styles.button }, children)
    }

    /** 小徽标。 */
    function Badge(props) {
      return h('span', { style: { ...styles.badge, ...(props.style ?? {}) }, title: props.title }, props.children)
    }

    /** 一行「标签：值」。 */
    function Stat(props) {
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '84px' } },
        h('span', { style: styles.hint }, props.label),
        h('span', { style: { fontSize: '13px', fontWeight: 600 } }, props.value),
      )
    }

    /** 数字格式化：大数用 k/M，方便一屏放下。 */
    function formatNumber(value) {
      const number = Number(value) || 0
      if (number >= 1e9) return `${Math.round(number / 1e8) / 10}B`
      if (number >= 1e6) return `${Math.round(number / 1e5) / 10}M`
      if (number >= 1e3) return `${Math.round(number / 1e2) / 10}k`
      return String(number)
    }

    /** 相对时间：刚刚 / N 分钟前 / N 小时前。 */
    function timeAgo(timestamp, t) {
      const value = Number(timestamp) || 0
      if (value <= 0) return ''
      const diff = Date.now() - value
      if (diff < 60000) return '刚刚'
      if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
      if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
      return new Date(value).toLocaleString()
    }

    /**
     * 模型行按名称排序，规则与宿主的 `sortModels` 一致：
     * 忽略大小写、数字按数值比较（`GLM-5.2` 在 `GLM-5.10` 前），同名按 id 兜底。
     *
     * 宿主已经排过一次序，这里再排一次是为了「宿主还没热更新 / 老版本宿主」时
     * 表格也不会按 hub 的原始顺序乱放。
     * @param rows - 设置页的模型行。
     * @returns 排好序的新数组。
     */
    function sortRowsByName(rows) {
      const key = (row) => String(row?.name ?? row?.id ?? '').toLocaleLowerCase()
      return Array.isArray(rows)
        ? rows.slice().sort((left, right) =>
            key(left).localeCompare(key(right), undefined, { numeric: true, sensitivity: 'base' }) ||
            String(left?.id ?? '').localeCompare(String(right?.id ?? ''), undefined, { numeric: true }))
        : []
    }

    /* ------------------------------ 面板组件 ---------------------------- */

    /**
     * 设置页里的主面板。
     * @param props.t - 翻译函数（由插槽注入）。
     */
    function HubPanel(props) {
      const t = props.t ?? ((key) => zh[key] ?? key)
      const { snapshot, error, loading } = useStore()
      const [draft, setDraft] = useState(null)
      const [busy, setBusy] = useState('')
      const [notice, setNotice] = useState('')
      const [probe, setProbe] = useState(null)

      // 快照回来后把表单同步成服务端状态；用户正在输入时（draft 已被改过）不覆盖。
      const serverKey = snapshot === null ? '' : `${snapshot.baseUrl}|${snapshot.tab}|${snapshot.intervalSeconds}|${snapshot.policy?.newModelPolicy}|${snapshot.policy?.retireHours}|${snapshot.policy?.thresholds?.lowCredits}`

      const form = draft ?? {
        baseUrl: snapshot?.baseUrl ?? '',
        pwd: '',
        tab: snapshot?.tab ?? 'gateway',
        apiKey: '',
        intervalSeconds: snapshot?.intervalSeconds ?? 120,
        newModelPolicy: snapshot?.policy?.newModelPolicy ?? 'select',
        retireHours: snapshot?.policy?.retireHours ?? 24,
        lowCredits: snapshot?.policy?.thresholds?.lowCredits ?? 50,
        autoApiKey: snapshot?.policy?.autoApiKey !== false,
      }

      const patch = (next) => setDraft({ ...form, ...next })

      const post = async (path, body, label) => {
        setBusy(label)
        setNotice('')
        const result = await requestJson(path, { method: 'POST', body })
        setBusy('')
        if (result.ok && result.data !== undefined) {
          store.set({ ...result.data })
          return true
        }
        setNotice(result.error ?? t('unknownError'))
        return false
      }

      const save = async () => {
        const body = {
          baseUrl: form.baseUrl,
          tab: form.tab,
          intervalSeconds: Number(form.intervalSeconds) || 120,
          autoApiKey: form.autoApiKey,
          policy: {
            newModelPolicy: form.newModelPolicy,
            retireHours: Number(form.retireHours) || 0,
            thresholds: { lowCredits: Number(form.lowCredits) || 0 },
          },
        }
        if (typeof form.pwd === 'string' && form.pwd !== '') body.pwd = form.pwd
        if (typeof form.apiKey === 'string' && form.apiKey !== '') body.apiKey = form.apiKey
        const ok = await post('config', body, 'save')
        if (ok) {
          setDraft(null)
          setNotice(t('saved'))
        }
      }

      const test = async () => {
        setBusy('test')
        const body = { baseUrl: form.baseUrl }
        if (typeof form.pwd === 'string' && form.pwd !== '') body.pwd = form.pwd
        const result = await requestJson('test', { method: 'POST', body })
        setBusy('')
        if (!result.ok) {
          setProbe({ ok: false, message: result.error ?? t('unknownError') })
          return
        }
        setProbe(
          result.data?.ok === true
            ? { ok: true, message: `${t('testOk')}：${result.data.baseUrl ?? form.baseUrl}` }
            : { ok: false, message: result.data?.failure?.message ?? t('unknownError') },
        )
      }

      const openDashboard = async () => {
        setBusy('dashboard')
        const result = await requestJson('dashboard-url')
        setBusy('')
        if (!result.ok || typeof result.data?.url !== 'string') {
          setNotice(result.error ?? t('unknownError'))
          return
        }
        window.open(result.data.url, '_blank', 'noopener,noreferrer')
      }

      const clearRoute = async () => {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(t('clearConfirm'))) {
          return
        }
        await post('clear', { confirm: true }, 'clear')
      }

      const toggleModel = async (row) => {
        await post('selection', { id: row.id, enabled: row.enabled !== true }, `model:${row.id}`)
      }

      const toggleEffort = async (row, level) => {
        const current = Array.isArray(row.selectedEfforts) ? row.selectedEfforts : row.efforts
        const next = current.includes(level) ? current.filter((item) => item !== level) : [...current, level]
        // 至少留一个正档：全裁掉的话 pi-ai 会拒绝这份档案，整条路由都注册不上。
        if (next.filter((item) => item !== 'off').length === 0) return
        await post('selection', { id: row.id, efforts: next }, `effort:${row.id}`)
      }

      const head = h(
        'div',
        { style: styles.header },
        h('h3', { style: styles.h1 }, t('title')),
        h('span', { style: styles.sub }, t('subtitle')),
        snapshot === null
          ? null
          : h(
              'span',
              { style: { ...styles.badge, marginLeft: 'auto' } },
              h('span', { style: styles.dot(snapshot.health?.ok === true && snapshot.lastError === '') }),
              snapshot.health?.ok === true ? t('health') : t('loadFailed'),
            ),
      )

      /* 出错时把最要紧的一句放最上面：连不上 / 密码错 / 限流都要能立刻看见。 */
      const errorBanner =
        error === '' ? null : h('div', { style: styles.banner('error') }, h('strong', null, t('loadFailed')), h('span', null, error))
      const syncError =
        snapshot !== null && typeof snapshot.lastSyncError === 'string' && snapshot.lastSyncError !== ''
          ? h('div', { style: styles.banner('warning') }, h('span', null, snapshot.lastSyncError))
          : null
      const pendingBanner =
        snapshot !== null && snapshot.syncPending === true
          ? h('div', { style: styles.banner('info') }, h('span', null, t('pendingSync')))
          : null
      const noticeBanner = notice === '' ? null : h('div', { style: styles.banner('info') }, h('span', null, notice))

      const alerts =
        Array.isArray(snapshot?.alerts) && snapshot.alerts.length > 0
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
              ...snapshot.alerts.map((alert) =>
                h(
                  'div',
                  { key: alert.key, style: styles.banner(alert.level === 'error' ? 'error' : 'warning') },
                  h('strong', null, alert.title),
                  h('span', { style: { flex: '1 1 200px' } }, alert.detail),
                  h('button', {
                    type: 'button',
                    style: { ...styles.button, padding: '2px 8px' },
                    onClick: () => post('dismiss', { key: alert.key }, `dismiss:${alert.key}`),
                  }, t('dismiss')),
                ),
              ),
            )
          : null

      /* ------------------------------ 连接配置 ------------------------------ */
      const connectionCard = h(
        'section',
        { style: styles.card },
        h('div', { style: styles.row }, h('strong', null, t('connection'))),
        h(
          'div',
          { style: styles.row },
          h(
            'label',
            { style: styles.field },
            h('span', { style: styles.label }, t('baseUrl')),
            h('input', {
              style: styles.input,
              value: form.baseUrl ?? '',
              placeholder: 'http://127.0.0.1:8788',
              spellCheck: false,
              onChange: (event) => patch({ baseUrl: event.target.value }),
            }),
            h('span', { style: styles.hint }, t('baseUrlHint')),
          ),
          h(
            'label',
            { style: styles.field },
            h('span', { style: styles.label }, t('pwd')),
            h('input', {
              style: styles.input,
              type: 'password',
              value: form.pwd ?? '',
              placeholder: snapshot?.pwdConfigured === true ? '••••••' : 'admin',
              autoComplete: 'off',
              onChange: (event) => patch({ pwd: event.target.value }),
            }),
            h('span', { style: styles.hint }, t('pwdHint')),
          ),
          h(
            'label',
            { style: styles.field },
            h('span', { style: styles.label }, t('tab')),
            h(
              'select',
              {
                style: styles.input,
                value: form.tab ?? 'gateway',
                onChange: (event) => patch({ tab: event.target.value }),
              },
              ...(Array.isArray(snapshot?.tabs) ? snapshot.tabs : ['gateway']).map((tab) =>
                h('option', { key: tab, value: tab }, tab),
              ),
            ),
          ),
        ),
        h(
          'div',
          { style: styles.row },
          h(
            'label',
            { style: styles.field },
            h('span', { style: styles.label }, t('apiKey')),
            h('input', {
              style: styles.input,
              type: 'password',
              value: form.apiKey ?? '',
              placeholder: snapshot?.apiKeySource === '' ? 'REQUIRED' : snapshot?.apiKeyEnv ?? '',
              autoComplete: 'off',
              onChange: (event) => patch({ apiKey: event.target.value }),
            }),
            h('span', { style: styles.hint }, t('apiKeyHint')),
          ),
          h(
            'label',
            { style: styles.field },
            h('span', { style: styles.label }, t('interval')),
            h('input', {
              style: styles.input,
              type: 'number',
              min: 30,
              max: 3600,
              value: form.intervalSeconds ?? 120,
              onChange: (event) => patch({ intervalSeconds: event.target.value }),
            }),
          ),
        ),
        h(
          'div',
          { style: styles.row },
          h(Button, { primary: true, onClick: save, disabled: busy !== '' }, busy === 'save' ? '…' : t('save')),
          h(Button, { onClick: test, disabled: busy !== '' }, busy === 'test' ? t('testing') : t('test')),
          h(Button, { onClick: openDashboard, disabled: busy !== '' }, t('openDashboard')),
          h(Button, { onClick: () => store.reload() }, t('refresh')),
          h('span', { style: { flex: '1 1 auto' } }),
          h(Button, { onClick: clearRoute, disabled: busy !== '' }, t('clear')),
        ),
        probe === null
          ? null
          : h('div', { style: styles.banner(probe.ok ? 'info' : 'error') }, h('span', null, probe.message)),
      )

      /* ------------------------------- 概览 -------------------------------- */
      const overview =
        snapshot === null
          ? null
          : h(
              'section',
              { style: styles.card },
              h(
                'div',
                { style: styles.row },
                h(Stat, { label: t('balance'), value: snapshot.balance === null || snapshot.balance === undefined ? '—' : `${snapshot.balance.balance} ${snapshot.balance.unit}` }),
                h(Stat, { label: t('modelsEnabled'), value: `${snapshot.counts?.enabled ?? 0}/${snapshot.counts?.total ?? 0}` }),
                h(Stat, { label: t('avgRate'), value: snapshot.averageRate > 0 ? `×${snapshot.averageRate}` : '—' }),
                h(Stat, { label: t('accounts'), value: `${snapshot.accounts?.ready ?? 0}/${snapshot.accounts?.total ?? 0}` }),
                h(Stat, { label: t('loginState'), value: snapshot.loggedIn === true ? t('loggedIn') : t('loggedOut') }),
                h('span', { style: { flex: '1 1 auto' } }),
                h(Badge, { title: snapshot.baseUrl }, snapshot.health?.realm === '' || snapshot.health?.realm === undefined ? 'hub' : `realm ${snapshot.health.realm}`),
                snapshot.apiKeySource === ''
                  ? h(Badge, { style: { color: palette.warn } }, t('noApiKey'))
                  : h(Badge, null, `key: ${snapshot.apiKeySource}`),
                snapshot.pwdIsDefault === true ? h(Badge, { style: { color: palette.warn } }, t('pwdDefault')) : null,
              ),
              snapshot.usage === null || snapshot.usage === undefined
                ? null
                : h(
                    'div',
                    { style: styles.row },
                    h('span', { style: styles.hint }, t('usageToday')),
                    h(Badge, null, `${t('requests')} ${formatNumber(snapshot.usage.requests)}`),
                    h(Badge, null, `${t('errors')} ${formatNumber(snapshot.usage.errors)}${snapshot.usage.errorRate > 0 ? ` (${snapshot.usage.errorRate}%)` : ''}`),
                    h(Badge, null, `${t('tokens')} ${formatNumber(snapshot.usage.totalTokens)}`),
                    h(Badge, null, `${t('creditUnit')} ${snapshot.usage.credit}`),
                    h(Badge, null, `${t('cacheHit')} ${snapshot.usage.cacheHitRate}%`),
                    h(Badge, null, `${t('cost')} ¥${snapshot.usage.costCny}`),
                  ),
              snapshot.lastSyncAt > 0
                ? h(
                    'div',
                    { style: styles.row },
                    h('span', { style: styles.hint }, `${t('synced')} ${timeAgo(snapshot.lastSyncAt, t)} · ${snapshot.lastSyncCount} ${t('models')}`),
                    h('span', { style: styles.hint }, `${t('routeKey')}: ${snapshot.routeKey}`),
                    h('span', { style: styles.hint }, `${t('pluginVersion')} ${snapshot.pluginVersion}`),
                  )
                : null,
            )

      /* ------------------------------- 模型表 ------------------------------ */
      const rows = Array.isArray(snapshot?.models) ? sortRowsByName(snapshot.models) : []
      const modelCard = h(
        'section',
        { style: styles.card },
        h(
          'div',
          { style: styles.row },
          h('strong', null, t('models')),
          h('span', { style: styles.hint }, `${rows.length}`),
          h('span', { style: { flex: '1 1 auto' } }),
          h(Button, { onClick: () => post('bulk', { enabled: true }, 'bulk') }, t('all')),
          h(Button, { onClick: () => post('bulk', { enabled: false }, 'bulk') }, t('none')),
          Array.isArray(snapshot?.newModels) && snapshot.newModels.length > 0
            ? h(Button, { onClick: () => post('enable-new', {}, 'enable-new') }, `${t('enableNew')} (${snapshot.newModels.length})`)
            : null,
        ),
        rows.length === 0
          ? h('div', { style: styles.hint }, loading ? t('loading') : t('noModels'))
          : h(
              'table',
              { style: styles.table },
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  h('th', { style: styles.th }, ''),
                  h('th', { style: styles.th }, t('model')),
                  h('th', { style: styles.th }, t('rate')),
                  h('th', { style: styles.th }, t('context')),
                  h('th', { style: styles.th }, t('output')),
                  h('th', { style: styles.th }, t('efforts')),
                ),
              ),
              h(
                'tbody',
                null,
                ...rows.map((row) =>
                  h(
                    'tr',
                    { key: row.id, style: row.retired === true ? { opacity: 0.55 } : undefined },
                    h(
                      'td',
                      { style: { ...styles.td, width: '26px' } },
                      h('input', {
                        type: 'checkbox',
                        checked: row.enabled === true,
                        disabled: busy !== '',
                        onChange: () => toggleModel(row),
                        'aria-label': row.id,
                      }),
                    ),
                    h(
                      'td',
                      { style: styles.td },
                      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, h('span', null, row.name),
                        h('span', { style: { ...styles.hint, ...styles.mono } }, row.id),
                      ),
                      h(
                        'div',
                        { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '3px' } },
                        row.vision === true ? h(Badge, null, 'vision') : null,
                        row.tools === true ? h(Badge, null, 'tools') : null,
                        row.retired === true
                          ? h(
                              'span',
                              { style: { ...styles.badge, color: palette.warn, gap: '6px' } },
                              t('retired'),
                              h('button', {
                                type: 'button',
                                style: { ...styles.button, padding: '0 6px', fontSize: '10px' },
                                onClick: () => post('retire', { id: row.id }, `retire:${row.id}`),
                              }, t('removeNow')),
                            )
                          : null,
                        Array.isArray(snapshot?.newModels) && snapshot.newModels.includes(row.id)
                          ? h(Badge, { style: { color: palette.accent } }, t('newModels'))
                          : null,
                      ),
                    ),
                    h('td', { style: styles.td }, row.rateText === '' ? '—' : row.rateText),
                    h('td', { style: styles.td }, row.contextWindow > 0 ? formatNumber(row.contextWindow) : '—'),
                    h('td', { style: styles.td }, row.maxTokens > 0 ? formatNumber(row.maxTokens) : '—'),
                    h(
                      'td',
                      { style: styles.td },
                      Array.isArray(row.efforts) && row.efforts.length > 0
                        ? h(
                            'div',
                            { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } },
                            ...row.efforts.map((level) => {
                              const active =
                                Array.isArray(row.selectedEfforts) ? row.selectedEfforts.includes(level) : true
                              return h(
                                'button',
                                {
                                  key: level,
                                  type: 'button',
                                  disabled: busy !== '',
                                  onClick: () => toggleEffort(row, level),
                                  style: {
                                    ...styles.badge,
                                    cursor: 'pointer',
                                    font: 'inherit',
                                    // 用主题色自身的透明度混色：深浅两套主题下都不会出现「浅底浅字」。
                                    background: active ? `color-mix(in srgb, ${palette.accent} 18%, transparent)` : 'transparent',
                                    color: active ? palette.accent : palette.muted,
                                    borderColor: active ? palette.accent : palette.line,
                                    padding: '1px 7px',
                                  },
                                },
                                level,
                              )
                            }),
                          )
                        : h('span', { style: styles.hint }, '—'),
                    ),
                  ),
                ),
              ),
            ),
      )

      /* ------------------------------- 策略 -------------------------------- */
      const policyCard = h(
        'section',
        { style: styles.card },
        h('div', { style: styles.row }, h('strong', null, t('policy'))),
        h(
          'div',
          { style: styles.row },
          h(
            'label',
            { style: styles.field },
            h('span', { style: styles.label }, t('newModelPolicy')),
            h(
              'select',
              {
                style: styles.input,
                value: form.newModelPolicy ?? 'select',
                onChange: (event) => patch({ newModelPolicy: event.target.value }),
              },
              h('option', { value: 'select' }, t('policySelect')),
              h('option', { value: 'ignore' }, t('policyIgnore')),
            ),
          ),
          h(
            'label',
            { style: styles.field },
            h('span', { style: styles.label }, t('retireHours')),
            h('input', {
              style: styles.input,
              type: 'number',
              min: 0,
              max: 168,
              value: form.retireHours ?? 24,
              onChange: (event) => patch({ retireHours: event.target.value }),
            }),
          ),
          h(
            'label',
            { style: styles.field },
            h('span', { style: styles.label }, t('lowCredits')),
            h('input', {
              style: styles.input,
              type: 'number',
              min: 0,
              value: form.lowCredits ?? 50,
              onChange: (event) => patch({ lowCredits: event.target.value }),
            }),
          ),
          h(
            'label',
            { style: { ...styles.row, gap: '6px', alignSelf: 'flex-end' } },
            h('input', {
              type: 'checkbox',
              checked: form.autoApiKey !== false,
              onChange: (event) => patch({ autoApiKey: event.target.checked }),
            }),
            h('span', { style: styles.label }, t('autoApiKey')),
          ),
        ),
        h(
          'div',
          { style: styles.row },
          h(Button, { primary: true, onClick: save, disabled: busy !== '' }, t('save')),
          h(
            'span',
            { style: styles.hint },
            snapshot === null
              ? ''
              : `${snapshot.sync === true ? t('autoSynced') : t('disabledSync')} · ${snapshot.providerEntry} / ${snapshot.routeKey}`,
          ),
        ),
      )

      return h(
        'div',
        { style: styles.wrap, 'data-dsh-plugin': NS },
        head,
        errorBanner,
        alerts,
        noticeBanner,
        pendingBanner,
        syncError,
        connectionCard,
        overview,
        modelCard,
        policyCard,
      )
    }

    /** 把窗口名收进 today/week/month/all 四档；缺省当全量（老宿主的行为）。 */
    function normalizeRangeLabel(value) {
      const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
      if (raw === 'week' || raw === 'w') return 'week'
      if (raw === 'month' || raw === 'm') return 'month'
      if (raw === 'today' || raw === 'day' || raw === '1d') return 'today'
      return 'all'
    }

    /** 积分一律两位小数：40.919999999999916 → 40.92。 */
    function formatCredit(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return '—'
      return (Math.round(number * 100) / 100).toFixed(2)
    }

    /** 人民币：6.2451 → ¥6.25。 */
    function formatCny(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return '—'
      return `¥${(Math.round(number * 100) / 100).toFixed(2)}`
    }

    /**
     * 徽标上的四个数字（纯函数，便于测试）。
     *
     * 语义按 hub 的口径来：`balance.balance` 是账号池剩余积分；
     * `usage.totalTokens` / `usage.credit` / `usage.costCny` 是
     * **`/usage?range=` 窗口内**的用量——`credit` 是上游逐行给的，不是估的；
     * `costCny` 才是按 OpenRouter 价折算的「API 等价花费」。
     */
    /**
     * 把一份用量快照算成可读文本。
     *
     * @param snapshot - 宿主 `/state` 返回的快照。
     * @param window - `today` 取 `usage`（主窗口），`week` 取 `usageWeek`。
     */
    function footerSummary(snapshot, window = 'today') {
      const usage = (window === 'week' ? snapshot?.usageWeek : snapshot?.usage) ?? null
      const hasBalance = snapshot?.balance !== null && snapshot?.balance !== undefined
      return {
        balance: hasBalance ? formatCredit(snapshot.balance.balance) : '—',
        tokens: usage === null ? '—' : formatNumber(usage.totalTokens),
        credit: usage === null ? '—' : formatCredit(usage.credit),
        cost: usage === null ? '—' : formatCny(usage.costCny),
        // 老宿主（< 1.0.3）没有 usageRange，那时拉的是不过滤的全量窗口，
        // 所以缺省标 'all' 而不是 'today'——数字是什么就说什么。
        range: normalizeRangeLabel(window === 'week' ? 'week' : snapshot?.usageRange),
      }
    }

    /**
     * 侧边栏底部的徽标：WorkBuddy · 积分余额 · 今日 tokens · 今日积分 · API 等价花费。
     *
     * 侧边栏展开时（`wide`）两行放全五项；收起时只留状态点 + 积分余额 +
     * 今日积分，其余进 `title`（鼠标悬停可读，也方便复制）。
     * 点一下打开 hub 看板——比让用户自己去找设置页再点按钮顺手。
     */
    function HubFooter(props) {
      const t = props.t ?? ((key) => zh[key] ?? key)
      const { snapshot, error } = useStore()
      const [opening, setOpening] = useState(false)

      const summary = footerSummary(snapshot)
      const week = footerSummary(snapshot, 'week')
      // 老宿主（< 1.0.5）没有 usageWeek：这一行干脆不画，别拿今日的数冒充本周。
      const hasWeek = snapshot?.usageWeek !== null && snapshot?.usageWeek !== undefined
      const rangeKey = summary.range === 'today' ? 'rangeToday' : summary.range === 'week' ? 'rangeWeek' : summary.range === 'month' ? 'rangeMonth' : 'rangeAll'
      const tone = error !== '' || snapshot === null ? palette.faint : snapshot.health?.ok === true ? palette.ok : palette.err

      /**
       * 一行用量：`今日 tokens 72.3M · 积分 61.41 · API 等价 ¥10.39`。
       *
       * 主窗口和本周共用同一个格式函数。早先主窗口拆成三行、本周挤成一行，
       * 悬停框里两块长得不一样，读起来像两份不同的数据；现在两行同构，
       * 只有开头的窗口名不同。
       */
      const usageLine = (label, item) =>
        `${label} ${t('tokensUnit')} ${item.tokens} · ${t('creditUnit')} ${item.credit} · ${t('footerApiCost')} ${item.cost}`

      const title = [
        `${t('footerLabel')} · ${t('footerBalance')} ${summary.balance}`,
        usageLine(t(rangeKey), summary),
        hasWeek ? usageLine(t('rangeWeek'), week) : '',
        error !== '' ? error : snapshot?.baseUrl ?? '',
      ]
        .filter((line) => line !== '')
        .join('\n')

      /**
       * 一行「窗口名在左、三个数字在右」。
       *
       * 左标签固定宽度对齐（今日 / 本周都是两个字，靠 `minWidth` 兜住英文的
       * Today / This week），右侧 `marginLeft: auto` 把三个数字顶到最右，
       * 两行数字因此上下对齐、一眼能比出今日与本周的差距。
       */
      const usageRow = (label, item) =>
        h(
          'span',
          {
            style: {
              display: 'flex',
              alignItems: 'baseline',
              gap: '8px',
              paddingLeft: '14px',
              fontSize: '11px',
              lineHeight: '15px',
              whiteSpace: 'nowrap',
            },
          },
          h('span', { style: { color: palette.muted, minWidth: '44px' } }, label),
          h(
            'span',
            { style: { marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: '5px', ...styles.mono, color: palette.text } },
            h('span', null, item.tokens),
            h('span', { style: { color: palette.faint } }, '·'),
            h('span', null, item.credit),
            h('span', { style: { color: palette.faint } }, '·'),
            h('span', null, item.cost),
          ),
        )

      const open = async () => {
        if (opening) return
        setOpening(true)
        const result = await requestJson('dashboard-url')
        setOpening(false)
        if (result.ok && typeof result.data?.url === 'string') {
          window.open(result.data.url, '_blank', 'noopener,noreferrer')
        }
      }

      if (props.wide === true) {
        return h(
          'button',
          {
            type: 'button',
            onClick: open,
            title,
            style: {
              ...styles.button,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: '2px',
              padding: '6px 8px',
              textAlign: 'left',
            },
          },
          h(
            'span',
            { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
            h('span', { style: styles.dot(tone === palette.ok) }),
            h('span', { style: { color: palette.text, fontWeight: 600 } }, t('footerLabel')),
            h('span', { style: { marginLeft: 'auto', ...styles.mono, color: palette.text } }, summary.balance),
          ),
          // 第二、三行：窗口名贴左（两行左边缘对齐），三个数字贴右（右边缘也对齐）。
          usageRow(t(rangeKey), summary),
          hasWeek ? usageRow(t('rangeWeek'), week) : null,
        )
      }

      return h(
        'button',
        {
          type: 'button',
          onClick: open,
          title,
          style: {
            ...styles.button,
            padding: '4px 2px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1px',
            background: 'transparent',
            border: 'none',
          },
        },
        h('span', { style: styles.dot(tone === palette.ok) }),
        // 收起态只有 ~48px：余额 + 今日积分各一行，其余看 title。
        h('span', { style: { fontSize: '11px', color: palette.text, ...styles.mono } }, summary.balance),
        h('span', { style: { fontSize: '9px', color: palette.muted, ...styles.mono } }, summary.credit),
      )
    }

    /* ------------------------------- 插件入口 ---------------------------- */

    /**
     * 包一层 try/catch 的 effect：某一块挂不上（比如宿主版本没有这个插槽）
     * 只影响这一块，不要牵连另一块。
     */
    function safeEffect(ctx, label, factory) {
      try {
        ctx.effect(factory, `${NS}: ${label}`)
      } catch (error) {
        // 记录到控制台即可：UI 里放一条「这块没加载」反而干扰用户。
        console.warn(`[${NS}] ${label} 挂载失败`, error)
      }
    }

    /** 插件主体。 */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${NS}: dictionaries`)

      safeEffect(ctx, 'settings.section', () =>
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'workbuddy-hub',
              order: 46,
              label: () => t('nav'),
              locale: NS,
              inject: () => ({ t }),
            },
            (props) => h(HubPanel, { ...props, t }),
          ),
        ),
      )

      safeEffect(ctx, 'sidebar.footer.action', () =>
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            {
              name: 'sidebar.footer.action',
              id: 'workbuddy-hub-quota',
              order: 51,
              label: () => t('footerLabel'),
              locale: NS,
              inject: () => ({ t }),
            },
            (props) => h(HubFooter, { ...props, t }),
          ),
        ),
      )
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    exports.NS = NS
    exports.__store = store
    exports.__apiPath = apiPath
    exports.__requestJson = requestJson
    exports.__dicts = { zh, en }
    exports.__palette = palette
    exports.__styles = styles
    exports.__HubPanel = HubPanel
    exports.__HubFooter = HubFooter
    exports.__sortRowsByName = sortRowsByName
    exports.__footerSummary = footerSummary
    return module.exports
  },
})
