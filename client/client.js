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
      openDashboard: '打开面板',
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
      mainKeyBalance: '主 key 余额',
      footerMainDeleted: '主 key 已删除',
      footerAllKeys: '全部 key：',
      reselectHint: '当前会话的模型已失效，请在模型选择器里重新选择',
      keysTitle: 'Key 列表',
      foldOpen: '点击展开模型列表',
      foldClose: '点击收起模型列表',
      keysEmpty: '网关里还没有 API Key（先在 hub 面板里创建一个）',
      mainKeyDeletedHint: '已停止同步；重新指定一个主 key 后会自动恢复',
      keyMain: '主 key',
      keyMissing: '已消失',
      keyDeleted: '已删除',
      keyAccounts: '账号',
      keyModels: '模型',
      pullNow: '立即拉取',
      selectAll: '全选',
      selectNone: '全不选',
      syncSelection: '同步勾选',
      setMain: '设为主 key',
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
      detailTitle: '用量详情',
      close: '关闭',
      currentSession: '当前会话',
      keyDetail: '各 key 用量',
      totalRow: '总计',
      colCost: '等价',
      allAccounts: '全部账号',
      noSession: '未使用网关模型',
      accountUnit: '号',
      emptyKeyModels: '这条 key 还没拉到模型',
      badgeOpen: '打开 WorkBuddy Hub 用量详情',
      realmLabel: '版本',
      realmCn: '国内版',
      realmIntl: '国际版',
      apiKeySourceLabel: 'API Key 来源',
      apiKeyFromConfig: '手动填写',
      apiKeyFromCredentials: '凭据库',
      apiKeyFromPanel: '面板自动获取',
      apiKeyMissing: '未配置',
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
      openDashboard: 'Open panel',
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
      mainKeyBalance: 'Main key',
      footerMainDeleted: 'main key deleted',
      footerAllKeys: 'All keys:',
      reselectHint: 'This session model is gone — pick a model again',
      keysTitle: 'API keys',
      foldOpen: 'click to expand the model list',
      foldClose: 'click to collapse the model list',
      keysEmpty: 'No API key on the gateway yet (create one in the hub panel)',
      mainKeyDeletedHint: 'Sync stopped; pick another main key to resume',
      keyMain: 'main',
      keyMissing: 'missing',
      keyDeleted: 'deleted',
      keyAccounts: 'accounts',
      keyModels: 'models',
      pullNow: 'pull now',
      selectAll: 'all',
      selectNone: 'none',
      syncSelection: 'copy selection',
      setMain: 'set main',
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
      detailTitle: 'Usage detail',
      close: 'Close',
      currentSession: 'Current session',
      keyDetail: 'Usage by key',
      totalRow: 'Total',
      colCost: 'Cost',
      allAccounts: 'All accounts',
      noSession: 'Not using a hub model',
      accountUnit: 'accts',
      emptyKeyModels: 'No models pulled for this key yet',
      badgeOpen: 'Open WorkBuddy Hub usage',
      realmLabel: 'Version',
      realmCn: 'China',
      realmIntl: 'Global',
      apiKeySourceLabel: 'API key source',
      apiKeyFromConfig: 'Manual',
      apiKeyFromCredentials: 'Credential store',
      apiKeyFromPanel: 'Auto from panel',
      apiKeyMissing: 'Not set',
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
        padding: '0 6px',
        minHeight: '18px',
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


    /* ------------------------------ 样式注入 ----------------------------- */

    // 照 dsh-token-usage-stats 的做法：CSS 运行时挂一个 <style>，用
    // data-plugin-css 打标签防重复；不引构建工具，也不污染全局。
    const CSS_TAG_ID = `${NS}/client.js`

    const CSS = [
      "/* 侧边栏徽标：字体与颜色完全照 dsh-token-usage-stats 的写法（font:inherit + label-secondary） */",
      ".wbhub_badge{order:9999;flex:1 0 100%;box-sizing:border-box;width:100%;min-width:0;min-height:36px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border:none;border-radius:8px;align-items:center;gap:7px;margin-bottom:4px;padding:6px 8px;text-decoration:none;display:flex;text-align:left}",
      ".wbhub_badge:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".wbhub_badge:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2563eb);outline-offset:-2px}",
      ".wbhub_badgeRail{border-radius:50%;justify-content:center;flex:0 0 auto;width:36px;height:36px;margin-bottom:0;padding:0}",
      "[class*=footerActions]{flex-wrap:wrap}",
      ".wbhub_glyph{flex:none;display:block}",
      ".wbhub_badgeBody{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1 1 auto;line-height:1.3}",
      ".wbhub_badgeTitle{display:flex;align-items:baseline;gap:6px;min-width:0;font-size:12px;font-weight:600;color:inherit}",
      ".wbhub_badgeName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      // 第一行那串「该 key 余额 / 总余额」跟下面「今日 / 本周」的数字同一套格式：
      // 11px、label-tertiary、等宽 + tabular-nums，只把字重降回常规（标题行本是 600）。
      ".wbhub_badgeValue{margin-left:auto;flex:none;font-size:11px;font-weight:400;line-height:15px;color:var(--dsw-alias-label-tertiary,#8b8b93);font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}",
      ".wbhub_badgeBody .wbhub_usageRow{grid-template-columns:26px 1fr;gap:4px;font-size:11px;line-height:15px}",
      ".wbhub_badgeBody .wbhub_usageLabel{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b8b93)}",
      ".wbhub_badgeBody .wbhub_usageNums{grid-template-columns:minmax(44px,1fr) minmax(42px,1fr) minmax(50px,1fr);gap:4px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8b8b93)}",
      ".wbhub_num{font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}",
      "/* 弹窗 */",
      ".wbhub_popMask{position:fixed;inset:0;z-index:80;background:0 0}",
      ".wbhub_pop{position:fixed;z-index:81;box-sizing:border-box;width:min(440px,calc(100vw - 16px));max-height:min(72vh,560px);overflow:auto;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(120,120,130,.28));border-radius:12px;box-shadow:0 14px 36px rgba(0,0,0,.18);padding:12px 14px;display:flex;flex-direction:column;gap:10px}",
      ".wbhub_popHead{display:flex;align-items:center;gap:8px}",
      ".wbhub_popTitle{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e8e8ea)}",
      ".wbhub_popClose{margin-left:auto;flex:none;width:24px;height:24px;padding:0;line-height:1;font-size:16px;font-family:inherit;color:var(--dsw-alias-label-secondary,#9a9aa2);background:0 0;border:none;border-radius:6px;cursor:pointer}",
      ".wbhub_popClose:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,140,.16));color:var(--dsw-alias-label-primary,#e8e8ea)}",
      ".wbhub_detail{display:flex;flex-direction:column;gap:12px;padding:14px 16px 16px;font-size:13px;color:var(--dsw-alias-label-primary,#e8e8ea);box-sizing:border-box;max-height:min(70vh,640px);overflow:auto}",
      ".wbhub_detailHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}",
      ".wbhub_detailHead .wbhub_sectionHead{margin-right:auto}",
      ".wbhub_sectionHead{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#9a9aa2)}",
      ".wbhub_metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:10px}",
      ".wbhub_metric{display:flex;flex-direction:column;gap:2px;min-width:0;padding:9px 11px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));border-radius:10px;background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.03))}",
      ".wbhub_metricLabel{font-size:11px;color:var(--dsw-alias-label-secondary,#9a9aa2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".wbhub_metricValue{font-size:17px;font-weight:600;line-height:1.25;color:var(--dsw-alias-label-primary,#e8e8ea);font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}",
      ".wbhub_metricUnit{margin-left:3px;font-size:11px;font-weight:400;color:var(--dsw-alias-label-tertiary,#8b8b93)}",
      ".wbhub_usage{display:flex;flex-direction:column;gap:5px}",
      ".wbhub_usageRow{display:grid;grid-template-columns:34px 1fr;align-items:baseline;gap:6px;font-size:12px;line-height:17px}",
      ".wbhub_usageLabel{color:var(--dsw-alias-label-secondary,#9a9aa2);white-space:nowrap}",
      ".wbhub_usageNums{display:grid;grid-template-columns:minmax(58px,1fr) minmax(56px,1fr) minmax(62px,1fr);align-items:baseline;gap:8px;justify-items:end;color:var(--dsw-alias-label-primary,#e8e8ea);font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}",
      ".wbhub_num{text-align:right;white-space:nowrap}",
      ".wbhub_usageTable{display:flex;flex-direction:column;gap:2px}",
      ".wbhub_usageHead{display:grid;grid-template-columns:34px 1fr;gap:6px;padding-bottom:2px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8b8b93)}",
      ".wbhub_usageHead .wbhub_usageNums{color:var(--dsw-alias-label-tertiary,#8b8b93)}",
      ".wbhub_usageItem{display:flex;flex-direction:column;gap:1px;padding:7px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,140,.18))}",
      ".wbhub_usageItem:first-of-type{border-top:0;padding-top:2px}",
      ".wbhub_usageTitle{display:flex;align-items:center;gap:6px;min-width:0;font-size:12px}",
      ".wbhub_usageName{font-weight:600;color:var(--dsw-alias-label-primary,#e8e8ea);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".wbhub_usageMeta{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b8b93);white-space:nowrap}",
      ".wbhub_usageTotal{display:flex;flex-direction:column;gap:1px;margin-top:2px;padding-top:7px;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,140,.32))}",
      ".wbhub_keyList{display:flex;flex-direction:column}",
      ".wbhub_keyRow{display:grid;grid-template-columns:9px minmax(0,1fr) auto;align-items:center;gap:9px;padding:7px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));font-size:12px}",
      ".wbhub_keyRow:first-child{border-top:0;padding-top:0}",
      ".wbhub_keyDot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary,#6f6f78)}",
      ".wbhub_keyDotOn{background:var(--dsw-alias-brand-primary,#4d8dff)}",
      ".wbhub_keyMain{min-width:0}",
      ".wbhub_keyName{color:var(--dsw-alias-label-primary,#e8e8ea);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".wbhub_keyMeta{margin-left:6px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8b8b93);white-space:nowrap}",
      ".wbhub_keyNums{justify-self:end;color:var(--dsw-alias-label-secondary,#9a9aa2);font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap}",
      ".wbhub_detailNote{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#9a9aa2)}",
      ".wbhub_footActions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;align-items:center;padding-top:2px}",

      "/* 设置页 */",
      ".wbhub_panel{display:flex;flex-direction:column;gap:14px;font-size:13px;color:var(--dsw-alias-label-primary,#e8e8ea)}",
      ".wbhub_form{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px 14px;align-items:start}",
      ".wbhub_field{display:flex;flex-direction:column;gap:4px;min-width:0}",
      ".wbhub_fieldLabel{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary,#9a9aa2)}",
      ".wbhub_fieldHint{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,#8b8b93)}",
      ".wbhub_actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}",
      ".wbhub_stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:8px 10px}",
      ".wbhub_chips{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin:0}",
      ".wbhub_chips > span:not(.wbhub_chipsLabel){padding:0 4px!important}",
      ".wbhub_chipsLabel{font-size:11px;color:var(--dsw-alias-label-secondary,#a1a1a8);flex:0 0 auto;margin-right:1px}",
      ".wbhub_notice{display:flex;flex-wrap:wrap;align-items:center;gap:6px}",
      ".wbhub_keyCard{display:flex;flex-direction:column;gap:8px;min-width:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));border-radius:10px;background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.03))}",
      ".wbhub_keyHead{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}",
      ".wbhub_keyTitle{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e8e8ea)}",
      ".wbhub_keyMasked{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b8b93);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}",
      ".wbhub_keyKeyActions{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:6px;flex:1 1 100%}",
      ".wbhub_setMain{margin-right:auto}",
      ".wbhub_keyFoot{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8b8b93)}",
      ".wbhub_keyFold{align-items:center;gap:4px;margin:0;padding:1px 5px;font:inherit;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#9a9aa2);background:0 0;border:none;border-radius:6px;cursor:pointer;display:inline-flex}",
      ".wbhub_keyFold:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#e8e8ea)}",
      ".wbhub_keyFold:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2563eb);outline-offset:-2px}",
      ".wbhub_keyFoldArrow{font-size:9px;line-height:1}",
      ".wbhub_tableWrap{min-width:0;overflow-x:auto}",
      ".wbhub_table{width:100%;border-collapse:collapse;font-size:12px}",
      ".wbhub_table th{text-align:left;white-space:nowrap;padding:6px 8px;font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary,#9a9aa2);border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12))}",
      ".wbhub_table td{padding:6px 8px;vertical-align:middle;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12))}",
      ".wbhub_table tbody tr:last-child td{border-bottom:0}",
      ".wbhub_colCheck{width:28px}",
      ".wbhub_colNum{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,#e8e8ea)}",
      ".wbhub_colEfforts{white-space:nowrap}",
      ".wbhub_cellName{display:flex;flex-direction:column;gap:2px;min-width:0}",
      ".wbhub_cellId{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b8b93);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}",
      ".wbhub_tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:3px}",
    ].join('\n')

    /**
     * 把插件样式挂到 document.head，只挂一次。
     *
     * 单测跑在 node:vm 里、没有 DOM，这时直接返回 false，不让样式把 apply 拖崩。
     * @returns 这次是否真的插入了。
     */
    function injectStyles() {
      if (typeof document === 'undefined' || document === null) return false
      if (typeof document.createElement !== 'function' || typeof document.querySelector !== 'function') return false
      try {
        const selector = `style[data-plugin-css="${CSS_TAG_ID}"]`
        if (document.querySelector(selector) !== null) return false
        const tag = document.createElement('style')
        tag.dataset.pluginCss = CSS_TAG_ID
        tag.textContent = CSS
        const host = document.head ?? document.documentElement
        if (host === null || host === undefined || typeof host.appendChild !== 'function') return false
        host.appendChild(tag)
        return true
      } catch (error) {
        console.warn(`[${NS}] 样式注入失败`, error)
        return false
      }
    }

    /* ------------------------------ 公共小件 ----------------------------- */

    /**
     * 徽标图标：一枚钱包轮廓。
     *
     * 用钱包而不是柱状图——这一格讲的是「还剩多少额度」，不是「用了多少」。
     * @param props.size - 边长（像素）。
     */
    function HubGlyph(props) {
      const size = Number(props?.size) > 0 ? Number(props.size) : 16
      return h(
        'svg',
        {
          className: 'wbhub_glyph',
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('rect', {
          x: 1.6,
          y: 3.4,
          width: 12.8,
          height: 9.4,
          rx: 2.2,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
        }),
        h('path', { d: 'M1.6 6.6h12.8', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
        h('circle', { cx: 11.1, cy: 9.5, r: 1.05, fill: 'currentColor' }),
      )
    }

    /**
     * 贴着徽标上沿弹出来的副窗（不是居中模态）。
     *
     * 位置由徽标自己量出来的 `getBoundingClientRect()` 给出：`anchor` 记「左边距」
     * 与「距窗口底边多少」，宽态/收起态都能贴住按钮。点外面那层透明遮罩即关闭。
     * @param props.open - 是否展开。
     * @param props.onClose - 关闭回调。
     * @param props.title - 标题。
     * @param props.closeLabel - 关闭按钮的无障碍文案。
     * @param props.anchor - `{ left, bottom }`，缺省贴在左下角。
     */
    function HubOverlay(props) {
      if (props.open !== true) return null
      const close = typeof props.onClose === 'function' ? props.onClose : () => {}
      const anchor = props.anchor ?? null
      const style =
        anchor === null || anchor === undefined
          ? { left: '8px', bottom: '56px' }
          : {
              left: `${Math.max(8, Math.round(Number(anchor.left) || 0))}px`,
              bottom: `${Math.max(8, Math.round(Number(anchor.bottom) || 0))}px`,
            }
      return h(
        'div',
        { className: 'wbhub_popMask', onClick: close },
        h(
          'div',
          {
            className: 'wbhub_pop',
            role: 'dialog',
            'aria-modal': 'false',
            style,
            onClick: (event) => {
              if (typeof event?.stopPropagation === 'function') event.stopPropagation()
            },
          },
          h(
            'div',
            { className: 'wbhub_popHead' },
            h('strong', { className: 'wbhub_popTitle' }, props.title),
            h(
              'button',
              { type: 'button', className: 'wbhub_popClose', 'aria-label': props.closeLabel, onClick: close },
              '×',
            ),
          ),
          props.children,
        ),
      )
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

    /**
     * 「当前会话用的是哪个 provider」的小发布订阅。
     *
     * 侧边栏插槽本身只给 `wide`，拿不到会话；真正的来源是客户端的两个服务：
     *   - `uiSession.current`：`getSnapshot().value.key` 是当前会话 id；
     *   - `modelDirectories.directoryFor(sessionId)`：`getSnapshot().current.provider`
     *     是当前会话选的 providerId（就是我们写进去的 routeKey），
     *     `routable === false` 表示这个 provider/模型已经不在目录里了。
     * 两个都快照、都订阅：切会话只换内存快照，**不发任何请求**。
     */
    const providerState = { value: '', routable: true, listeners: new Set() }

    /** 写入当前 provider（值没变就不通知，避免 15 秒轮询把徽标刷成抖动）。 */
    function setProviderState(next) {
      const value = typeof next?.value === 'string' ? next.value : ''
      const routable = next?.routable !== false
      if (providerState.value === value && providerState.routable === routable) return
      providerState.value = value
      providerState.routable = routable
      for (const listener of providerState.listeners) listener()
    }

    /** 读当前 provider 快照（纯函数，测试里可直接调）。 */
    function providerSnapshot() {
      return { value: providerState.value, routable: providerState.routable }
    }

    /** 组件里读当前 provider。 */
    function useCurrentProvider() {
      const [state, setState] = useState(providerSnapshot())
      useEffect(() => {
        const listener = () => setState(providerSnapshot())
        providerState.listeners.add(listener)
        return () => providerState.listeners.delete(listener)
      }, [])
      return state.value
    }

    /**
     * 把 `uiSession` / `modelDirectories` 接上（宿主没有这两个服务时静默跳过）。
     * @param ctx - 客户端上下文。
     * @returns 解绑函数（拿不到服务时返回 undefined）。
     */
    function attachProviderSource(ctx) {
      if (typeof ctx?.inject !== 'function') return undefined
      return ctx.inject(['uiSession', 'modelDirectories'], (scope) => {
        const uiSession = scope.uiSession
        const directories = scope.modelDirectories
        if (uiSession === undefined || directories === undefined) return undefined
        let directory = null
        let offDirectory = null
        const publish = () => {
          const snapshot = directory === null ? null : directory.getSnapshot()
          setProviderState({
            value: snapshot?.current?.provider ?? '',
            routable: snapshot?.routable !== false,
          })
        }
        const read = () => {
          let sessionId = ''
          try {
            sessionId = uiSession.current?.getSnapshot?.()?.value?.key ?? ''
          } catch {
            sessionId = ''
          }
          const next = sessionId === '' || typeof directories.directoryFor !== 'function' ? null : directories.directoryFor(sessionId)
          if (next !== directory) {
            if (typeof offDirectory === 'function') offDirectory()
            directory = next ?? null
            offDirectory =
              directory === null || typeof directory.subscribe !== 'function' ? null : directory.subscribe(() => publish())
          }
          publish()
        }
        const offSession = typeof uiSession.current?.subscribe === 'function' ? uiSession.current.subscribe(() => read()) : null
        read()
        return () => {
          if (typeof offSession === 'function') offSession()
          if (typeof offDirectory === 'function') offDirectory()
        }
      })
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
    /** realm 是网关的「版本」：cn 国内版、intl 国际版，其余原样显示。 */
    function realmText(snapshot, t) {
      const realm = snapshot?.health?.realm
      if (realm === '' || realm === undefined || realm === null) return '—'
      if (realm === 'cn') return t('realmCn')
      if (realm === 'intl') return t('realmIntl')
      return String(realm)
    }

    /** API Key 从哪来：手填 / 凭据库 / 面板自动取。cached 只是内存里还留着同一把。 */
    function apiKeySourceText(source, t) {
      if (source === 'config') return t('apiKeyFromConfig')
      if (source === 'credentials' || source === 'cached') return t('apiKeyFromCredentials')
      if (source === 'panel') return t('apiKeyFromPanel')
      return t('apiKeyMissing')
    }

    /**
     * 一条 key 的模型表当前是展开还是收起。
     * 没点过时主 key 展开、其余收起；点过一次就完全照 folded 记的选择走。
     * @param {object} folded - 形如 { [hubKeyId]: boolean } 的显式选择
     * @param {object} key - keyProjections() 里的一条
     * @returns {boolean} true 表示摊开
     */
    function keyFoldOpen(folded, key) {
      const chosen = folded === null || folded === undefined ? undefined : folded[key?.hubKeyId]
      if (chosen === undefined) return key?.isMain === true
      return chosen === true
    }

    /**
     * 「已同步 N 个模型」里的 N：取主 key 那条路由的条数。
     *
     * `snapshot.lastSyncCount` 是**所有 key 路由加起来的**条数（每条 key 写一条 provider，
     * 三条各 6 / 1 / 6 就是 13），而同一行右边写的是主 key 的 `routeKey`、分母是单条 key
     * 的模型目录总数（19）——拿合计当分子，两边都对不上。主 key 不在网关里时（被删了）
     * 回落到合计值，总比不显示强。
     */
    function syncedModelCount(snapshot) {
      const main = keyListOf(snapshot).find((key) => key.isMain === true)
      if (main !== undefined && main !== null) return Number(main.lastSyncCount) || 0
      return Number(snapshot?.lastSyncCount) || 0
    }

    /**
     * 「已同步 N/M 模型」里的 N：所有 key 真正写进 DSH 的模型**并集**（按 id 去重）。
     *
     * 每条 key 一条 provider 路由，同一条模型经常被好几条 key 同时勾上——把各自路由的
     * 条数加起来（6 + 1 + 6 = 13）会把重复的算好几遍，比「DSH 的模型选择器里实际能选到
     * 几个」偏大。真正能选到的是并集：勾上的、且没下架的。
     *
     * `snapshot.lastSyncCount` 正好就是那个「加起来」的数（`syncRoutesToDsh()` 里
     * `count += routeModels.length`），所以只有老宿主没给 `models` 时才拿它兜底。
     */
    function syncedModelCount(snapshot) {
      const ids = new Set()
      for (const key of keyListOf(snapshot)) {
        const models = Array.isArray(key?.models) ? key.models : []
        for (const model of models) {
          if (model === null || model === undefined) continue
          if (model.enabled === false || model.retired === true) continue
          if (typeof model.id === 'string' && model.id !== '') ids.add(model.id)
        }
      }
      if (ids.size > 0) return ids.size
      return Number(snapshot?.lastSyncCount) || 0
    }

    /**
     * tokens 用 k/M/B 缩写，一律保留两位小数（1234 → 1.23k）。
     * 三位数以下原样输出——整数个 token 加 `.00` 只是噪声。
     */
    function formatNumber(value) {
      const number = Number(value) || 0
      if (number >= 1e9) return `${(number / 1e9).toFixed(2)}B`
      if (number >= 1e6) return `${(number / 1e6).toFixed(2)}M`
      if (number >= 1e3) return `${(number / 1e3).toFixed(2)}k`
      // 用户要求「所有数字都保留两位小数」：三位数以下也补 .00，整列才对得齐
  return number.toFixed(2)
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
      // 每条 key 的模型表默认只在主 key 上摊开，其余收起来，免得三份表一路铺到底。
      const [folded, setFolded] = useState({})

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

      /** 勾掉 / 勾上某一条 key 下的某个模型（只影响这一条 key）。 */
      const toggleModel = async (key, row) => {
        await post(
          'keys/selection',
          { hubKeyId: key.hubKeyId, id: row.id, enabled: row.enabled !== true },
          `model:${key.hubKeyId}:${row.id}`,
        )
      }

      /** 改某一条 key 下某个模型的思考档位（同样只影响这一条 key）。 */
      const toggleEffort = async (key, row, level) => {
        const current = Array.isArray(row.selectedEfforts) ? row.selectedEfforts : row.efforts
        const next = current.includes(level) ? current.filter((item) => item !== level) : [...current, level]
        // 至少留一个正档：全裁掉的话 pi-ai 会拒绝这份档案，整条路由都注册不上。
        if (next.filter((item) => item !== 'off').length === 0) return
        await post(
          'keys/selection',
          { hubKeyId: key.hubKeyId, id: row.id, efforts: next },
          `effort:${key.hubKeyId}:${row.id}`,
        )
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
          { className: 'wbhub_form' },
          h(
            'label',
            { className: 'wbhub_field' },
            h('span', { className: 'wbhub_fieldLabel' }, t('baseUrl')),
            h('input', {
              style: styles.input,
              value: form.baseUrl ?? '',
              placeholder: 'http://127.0.0.1:8788',
              spellCheck: false,
              onChange: (event) => patch({ baseUrl: event.target.value }),
            }),
            h('span', { className: 'wbhub_fieldHint' }, t('baseUrlHint')),
          ),
          h(
            'label',
            { className: 'wbhub_field' },
            h('span', { className: 'wbhub_fieldLabel' }, t('pwd')),
            h('input', {
              style: styles.input,
              type: 'password',
              value: form.pwd ?? '',
              placeholder: snapshot?.pwdConfigured === true ? '••••••' : 'admin',
              autoComplete: 'off',
              onChange: (event) => patch({ pwd: event.target.value }),
            }),
            h('span', { className: 'wbhub_fieldHint' }, t('pwdHint')),
          ),
          h(
            'label',
            { className: 'wbhub_field' },
            h('span', { className: 'wbhub_fieldLabel' }, t('tab')),
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
          { className: 'wbhub_form' },
          h(
            'label',
            { className: 'wbhub_field' },
            h('span', { className: 'wbhub_fieldLabel' }, t('apiKey')),
            h('input', {
              style: styles.input,
              type: 'password',
              value: form.apiKey ?? '',
              placeholder: snapshot?.apiKeySource === '' ? 'REQUIRED' : snapshot?.apiKeyEnv ?? '',
              autoComplete: 'off',
              onChange: (event) => patch({ apiKey: event.target.value }),
            }),
            h('span', { className: 'wbhub_fieldHint' }, t('apiKeyHint')),
          ),
          h(
            'label',
            { className: 'wbhub_field' },
            h('span', { className: 'wbhub_fieldLabel' }, t('interval')),
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
          { className: 'wbhub_actions' },
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
                { className: 'wbhub_stats' },
                h(Stat, { label: t('balance'), value: snapshot.balance === null || snapshot.balance === undefined ? '—' : `${snapshot.balance.balance} ${snapshot.balance.unit}` }),
                h(Stat, { label: t('modelsEnabled'), value: `${snapshot.counts?.enabled ?? 0}/${snapshot.counts?.total ?? 0}` }),
                h(Stat, { label: t('avgRate'), value: snapshot.averageRate > 0 ? `×${snapshot.averageRate}` : '—' }),
                h(Stat, { label: t('accounts'), value: `${snapshot.accounts?.ready ?? 0}/${snapshot.accounts?.total ?? 0}` }),
                h(Stat, { label: t('loginState'), value: snapshot.loggedIn === true ? t('loggedIn') : t('loggedOut') }),
                h(Stat, { label: t('realmLabel'), value: realmText(snapshot, t) }),
                h(Stat, { label: t('apiKeySourceLabel'), value: apiKeySourceText(snapshot.apiKeySource, t) }),
              ),
              snapshot.usage === null || snapshot.usage === undefined
                ? null
                : h(
                    'div',
                    { className: 'wbhub_chips' },
                    h('span', { className: 'wbhub_chipsLabel' }, t('usageToday')),
                    h(Badge, null, `${t('requests')} ${formatNumber(snapshot.usage.requests)}`),
                    h(Badge, null, `${t('errors')} ${formatNumber(snapshot.usage.errors)}${snapshot.usage.errorRate > 0 ? ` (${snapshot.usage.errorRate}%)` : ''}`),
                    h(Badge, null, `${t('tokens')} ${formatNumber(snapshot.usage.totalTokens)}`),
                    h(Badge, null, `${t('creditUnit')} ${snapshot.usage.credit}`),
                    h(Badge, null, `${t('cacheHit')} ${snapshot.usage.cacheHitRate}%`),
                    h(Badge, null, `${t('cost')} ¥${snapshot.usage.costCny}`),
                  ),
              snapshot.apiKeySource === '' || snapshot.pwdIsDefault === true
                ? h(
                    'div',
                    { className: 'wbhub_notice' },
                    snapshot.apiKeySource === '' ? h(Badge, { style: { color: palette.warn } }, t('noApiKey')) : null,
                    snapshot.pwdIsDefault === true ? h(Badge, { style: { color: palette.warn } }, t('pwdDefault')) : null,
                  )
                : null,
              snapshot.lastSyncAt > 0
                ? h(
                    'div',
                    { style: styles.row },
                    h('span', { style: styles.hint }, `${t('synced')} ${timeAgo(snapshot.lastSyncAt, t)} · ${syncedModelCount(snapshot)}/${snapshot.counts?.total ?? snapshot.lastSyncCount} ${t('models')}`),
                    h('span', { style: styles.hint }, `${t('routeKey')}: ${snapshot.routeKey}`),
                    h('span', { style: styles.hint }, `${t('pluginVersion')} ${snapshot.pluginVersion}`),
                  )
                : null,
            )

      /* ------------------------------ 模型表 ------------------------------ */

      /**
       * 一条 key 自己的模型表。
       *
       * 勾选状态是按 key 存的（`key.selection`），所以开关必须带 `hubKeyId`
       * 打到 `/keys/selection`；全局的 `/selection` 只改主 key，多 key 下会改错人。
       * @param key - `keyProjections()` 里的一条投影。
       */
      const modelTable = (key) => {
        const rows = sortRowsByName(Array.isArray(key.models) ? key.models : [])
        if (rows.length === 0) {
          return h('div', { className: 'wbhub_keyFoot' }, loading ? t('loading') : t('emptyKeyModels'))
        }
        return h(
          'div',
          { className: 'wbhub_tableWrap' },
          h(
            'table',
            { className: 'wbhub_table' },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                h('th', { className: 'wbhub_colCheck' }, t('enabled')),
                h('th', null, t('model')),
                h('th', null, t('rate')),
                h('th', null, t('context')),
                h('th', null, t('output')),
                h('th', null, t('efforts')),
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
                    { className: 'wbhub_colCheck' },
                    h('input', {
                      type: 'checkbox',
                      checked: row.enabled === true,
                      disabled: busy !== '',
                      onChange: () => toggleModel(key, row),
                      'aria-label': `${key.name} ${row.id}`,
                    }),
                  ),
                  h(
                    'td',
                    null,
                    h(
                      'div',
                      { className: 'wbhub_cellName' },
                      h('span', null, row.name),
                      h('span', { className: 'wbhub_cellId' }, row.id),
                      h(
                        'div',
                        { className: 'wbhub_tags' },
                        row.vision === true ? h(Badge, null, 'vision') : null,
                        row.tools === true ? h(Badge, null, 'tools') : null,
                        row.retired === true
                          ? h(
                              'span',
                              { style: { ...styles.badge, color: palette.warn, gap: '6px' } },
                              t('retired'),
                              // 「立即移除」动的是 retired 宽限期表，那张表跟着主 key 走。
                              key.isMain === true
                                ? h(
                                    'button',
                                    {
                                      type: 'button',
                                      style: { ...styles.button, padding: '0 6px', fontSize: '10px' },
                                      onClick: () => post('retire', { id: row.id }, `retire:${row.id}`),
                                    },
                                    t('removeNow'),
                                  )
                                : null,
                            )
                          : null,
                        Array.isArray(snapshot?.newModels) && snapshot.newModels.includes(row.id)
                          ? h(Badge, { style: { color: palette.accent } }, t('newModels'))
                          : null,
                      ),
                    ),
                  ),
                  h('td', { className: 'wbhub_colNum' }, row.rateText === '' ? '—' : row.rateText),
                  h('td', { className: 'wbhub_colNum' }, row.contextWindow > 0 ? formatNumber(row.contextWindow) : '—'),
                  h('td', { className: 'wbhub_colNum' }, row.maxTokens > 0 ? formatNumber(row.maxTokens) : '—'),
                  h(
                    'td',
                    { className: 'wbhub_colEfforts' },
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
                                onClick: () => toggleEffort(key, row, level),
                                style: {
                                  ...styles.badge,
                                  cursor: 'pointer',
                                  font: 'inherit',
                                  // 用主题色自身的透明度混色：深浅两套主题下都不会出现「浅底浅字」。
                                  background: active
                                    ? `color-mix(in srgb, ${palette.accent} 18%, transparent)`
                                    : 'transparent',
                                  color: active ? palette.accent : palette.muted,
                                  borderColor: active ? palette.accent : palette.line,
                                  padding: '1px 7px',
                                },
                              },
                              level,
                            )
                          }),
                        )
                      : h('span', { className: 'wbhub_keyFoot' }, '—'),
                  ),
                ),
              ),
            ),
          ),
        )
      }

      /* ------------------------------ Key 列表 ----------------------------- */
      // 网关里每条 key 都是独立身份：自己的模型集、自己的勾选、自己的用量。
      // 所以模型表也挂在每条 key 下面，一个开关只影响它自己那一行。
      const keyRows = keyListOf(snapshot)
      // 没点过就按「主 key 展开、其余收起」算，点过一次就记住选择。
      const isKeyOpen = (key) => keyFoldOpen(folded, key)
      const toggleKey = (key) => setFolded((prev) => ({ ...prev, [key.hubKeyId]: !isKeyOpen(key) }))
      // 去掉「Key 列表」标题后，这层再套一张卡片就只剩空边框了；
      // 每条 key 自己就是一张卡，外面只需要一个纵向排列的容器。
      const keyCard = h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        snapshot?.mainKeyMissing === true
          ? h(
              'div',
              { style: { ...styles.banner('error'), alignItems: 'center' } },
              h('span', null, t('footerMainDeleted')),
              h('span', { className: 'wbhub_fieldHint' }, t('mainKeyDeletedHint')),
            )
          : null,
        keyRows.length === 0
          ? h('div', { className: 'wbhub_keyFoot' }, t('keysEmpty'))
          : keyRows.map((key) =>
              h(
                'div',
                { key: key.hubKeyId, className: 'wbhub_keyCard' },
                h(
                  'div',
                  { className: 'wbhub_keyHead' },
                  h(
                    'span',
                    { className: 'wbhub_keyTitle', style: key.missing === true ? { color: palette.err } : undefined },
                    key.name,
                  ),
                  h('span', { className: 'wbhub_keyMasked' }, key.masked),
                  key.isMain === true ? h(Badge, null, t('keyMain')) : null,
                  key.missing === true
                    ? h(Badge, null, key.deleted === true ? t('keyDeleted') : t('keyMissing'))
                    : null,
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'wbhub_keyFold',
                      'aria-expanded': isKeyOpen(key) === true,
                      onClick: () => toggleKey(key),
                    },
                    h('span', { className: 'wbhub_keyFoldArrow', 'aria-hidden': 'true' }, isKeyOpen(key) ? '▾' : '▸'),
                    `${t('keyAccounts')} ${key.accounts ?? 0} · ${t('keyModels')} ${key.counts?.enabled ?? 0}/${key.counts?.total ?? 0} · ${isKeyOpen(key) === true ? t('foldClose') : t('foldOpen')}`,
                  ),
                  h(
                    'span',
                    { className: 'wbhub_keyKeyActions' },
                    key.isMain === true
                      ? null
                      : h(
                          'span',
                          { className: 'wbhub_setMain' },
                          h(
                            Button,
                            { onClick: () => post('keys/main', { hubKeyId: key.hubKeyId }, 'main'), disabled: busy !== '' },
                            t('setMain'),
                          ),
                        ),
                    h(
                      Button,
                      { onClick: () => post('keys/pull', { hubKeyId: key.hubKeyId }, 'pull'), disabled: busy !== '' },
                      t('pullNow'),
                    ),
                    h(
                      Button,
                      { onClick: () => post('bulk', { hubKeyId: key.hubKeyId, enabled: true }, 'bulk'), disabled: busy !== '' },
                      t('selectAll'),
                    ),
                    h(
                      Button,
                      { onClick: () => post('bulk', { hubKeyId: key.hubKeyId, enabled: false }, 'bulk'), disabled: busy !== '' },
                      t('selectNone'),
                    ),
                    h(
                      Button,
                      { onClick: () => post('keys/sync-selection', { from: key.hubKeyId }, 'sync'), disabled: busy !== '' },
                      t('syncSelection'),
                    ),
                  ),
                ),
                isKeyOpen(key) === true ? modelTable(key) : null,
                key.lastError !== undefined && key.lastError !== ''
                  ? h('span', { style: { color: palette.err, fontSize: '11px' } }, key.lastError)
                  : null,
                key.lastSyncError !== undefined && key.lastSyncError !== ''
                  ? h('span', { style: { color: palette.warn, fontSize: '11px' } }, key.lastSyncError)
                  : null,
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
        { className: 'wbhub_panel', style: styles.wrap, 'data-dsh-plugin': NS },
        head,
        errorBanner,
        alerts,
        noticeBanner,
        pendingBanner,
        syncError,
        connectionCard,
        overview,
        keyCard,
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

    /** 快照里的 key 列表（老宿主没有 `keys` 时是空数组）。 */
    function keyListOf(snapshot) {
      return Array.isArray(snapshot?.keys) ? snapshot.keys : []
    }

    /** 按 providerId（= 我们写进 DSH 的 routeKey）找回那条 key。 */
    function keyByProvider(snapshot, provider) {
      if (typeof provider !== 'string' || provider === '') return null
      return keyListOf(snapshot).find((key) => key?.routeKey === provider) ?? null
    }

    /** 主 key：徽标在没有「当前会话 key」时的落点。 */
    function mainKeyOf(snapshot) {
      return keyListOf(snapshot).find((key) => key?.isMain === true) ?? null
    }

    /**
     * 徽标第一行的两个余额。
     *
     * `main` 是主 key 绑定账号在网关里还存着的积分之和（可能只有几百），
     * `global` 是整个 realm 的额度（可能是几十万）——两个数量级不同的数字
     * 放在一起必须带号数，否则看着像 bug。
     */
    function balanceLines(snapshot, key = null) {
      // 余额按 key 算：后端在每条 key 上给了 `balance`（该 key 绑定账号的 credits.remain
      // 之和）。没传 key、或老宿主没给这个字段时，退回主 key 的那份。
      const target = key ?? mainKeyOf(snapshot)
      const detail = target?.balance ?? snapshot?.mainKeyBalance ?? null
      const remain = Number(detail?.remain)
      const global = snapshot?.balance ?? null
      return {
        main: target?.missing === true ? 'deleted' : Number.isFinite(remain) ? formatCredit(remain) : '—',
        mainAccounts: Number(detail?.bound) || (Number.isFinite(Number(target?.accounts)) ? Number(target.accounts) : 0),
        mainName: typeof target?.name === 'string' ? target.name : '',
        global: global === null || global === undefined ? '—' : formatCredit(global.balance),
        globalAccounts: Number(global?.accountsEnabled) || 0,
      }
    }

    /**
     * 把一份用量快照算成可读文本。
     *
     * @param snapshot - 宿主 `/state` 返回的快照。
     * @param window - `today` 取主窗口，`week` 取本周。
     * @param key - 指定 key（徽标按当前会话的 key 取数）；缺省读全局槽位。
     */
    function footerSummary(snapshot, window = 'today', key = null) {
      const perKey = window === 'week' ? snapshot?.usageWeekByKey : snapshot?.usageByKey
      const scoped =
        key !== null && key !== undefined && perKey !== null && typeof perKey === 'object'
          ? perKey[key.hubKeyId] ?? null
          : null
      const usage = scoped ?? ((window === 'week' ? snapshot?.usageWeek : snapshot?.usage) ?? null)
      const hasBalance = snapshot?.balance !== null && snapshot?.balance !== undefined
      return {
        balance: hasBalance ? formatCredit(snapshot.balance.balance) : '—',
        tokens: usage === null || usage === undefined ? '—' : formatNumber(usage.totalTokens),
        credit: usage === null || usage === undefined ? '—' : formatCredit(usage.credit),
        cost: usage === null || usage === undefined ? '—' : formatCny(usage.costCny),
        // 老宿主（< 1.0.3）没有 usageRange，那时拉的是不过滤的全量窗口，
        // 所以缺省标 'all' 而不是 'today'——数字是什么就说什么。
        range: normalizeRangeLabel(window === 'week' ? 'week' : snapshot?.usageRange),
        scoped: scoped !== null && scoped !== undefined,
        keyName: typeof key?.name === 'string' ? key.name : '',
      }
    }
    /**
     * 侧边栏底部的 WorkBuddy 徽标。
     *
     * 三行：`<当前 key 名> 该 key 余额 / 总余额`、`今日 tokens 积分 等价`、
     * `本周` 同三项。数字跟着「当前会话用的那条 key」走，会话没走网关模型时
     * 回落主 key；口径与网关看板一致（tokens 用 k/M/B 缩写，积分与等价金额两位小数）。
     *
     * 点徽标弹出的是贴着它上沿的副窗，不是居中模态：再点一下、点外面或按 × 收起。
     */
    function HubFooter(props) {
      const t = props.t ?? ((key) => zh[key] ?? key)
      const { snapshot, error } = useStore()
      const [open, setOpen] = useState(false)
      const [opening, setOpening] = useState(false)
      const [anchor, setAnchor] = useState(null)
      const currentProvider = useCurrentProvider()
      const wide = props.wide === true

      const current = keyByProvider(snapshot, currentProvider) ?? mainKeyOf(snapshot)
      const summary = footerSummary(snapshot, 'today', current)
      const week = footerSummary(snapshot, 'week', current)
      const balances = balanceLines(snapshot, current)
      // 老宿主（< 1.0.5）没有 usageWeek：这一行干脆不画，别拿今日的数冒充本周。
      const hasWeek =
        current !== null && current !== undefined
          ? current.usageWeek !== null && current.usageWeek !== undefined
          : snapshot?.usageWeek !== null && snapshot?.usageWeek !== undefined
      const tone = error !== '' || snapshot === null ? palette.faint : snapshot.health?.ok === true ? palette.ok : palette.err
      const keys = keyListOf(snapshot)
      // 当前会话选的 provider 是我们写进去的，但模型已经不在目录里了：
      // 这是「主 key 被删」或「这条 key 的模型全被取消勾选」，只能让用户重选。
      const stale = currentProvider !== '' && keyByProvider(snapshot, currentProvider) !== null && providerState.routable === false
      const mainBalanceText = balances.main === 'deleted' ? t('footerMainDeleted') : balances.main
      const providerLabel = current !== null && current !== undefined ? current.name : t('noSession')
      // 徽标第一行写哪条 key：跟着会话走；会话没走网关就写主 key 的名字。
      const badgeName =
        current !== null && current !== undefined && typeof current.name === 'string' && current.name !== ''
          ? current.name
          : t('footerLabel')

      /** 三个数（tokens / 积分 / 等价）：三列等宽、各自右对齐。 */
      const usageNums = (item) =>
        h(
          'span',
          { className: 'wbhub_usageNums' },
          h('span', { className: 'wbhub_num' }, item.tokens),
          h('span', { className: 'wbhub_num' }, item.credit),
          h('span', { className: 'wbhub_num' }, item.cost),
        )

      const usageRow = (label, item) =>
        h(
          'div',
          { className: 'wbhub_usageRow' },
          h('span', { className: 'wbhub_usageLabel' }, label),
          usageNums(item),
        )

      /**
       * 一条 key 的今日/本周用量。
       *
       * **不回落全局**：这条 key 没数据就是「—」，拿全站的数冒充单 key 会误导。
       */
      const keyUsage = (usage) =>
        usage === null || usage === undefined
          ? { tokens: '—', credit: '—', cost: '—' }
          : {
              tokens: formatNumber(usage.totalTokens),
              credit: formatCredit(usage.credit),
              cost: formatCny(usage.costCny),
            }

      /** 一块「标签 + 大数字」。 */
      const metric = (label, value, unit) =>
        h(
          'div',
          { className: 'wbhub_metric' },
          h('span', { className: 'wbhub_metricLabel' }, label),
          h(
            'span',
            { className: 'wbhub_metricValue' },
            value,
            unit === undefined || unit === '' ? null : h('span', { className: 'wbhub_metricUnit' }, unit),
          ),
        )

      /** 列标题：tokens / 积分 / 等价，与下面的数字列同宽。 */
      const usageHead = h(
        'div',
        { className: 'wbhub_usageHead' },
        h('span', { className: 'wbhub_usageLabel' }, ''),
        h(
          'span',
          { className: 'wbhub_usageNums' },
          h('span', { className: 'wbhub_num' }, t('tokensUnit')),
          h('span', { className: 'wbhub_num' }, t('creditUnit')),
          h('span', { className: 'wbhub_num' }, t('colCost')),
        ),
      )

      /**
       * 弹窗里的「各 key 用量」：一条 key 一段，末尾总计。
       *
       * 每段是 `/usage/analytics` 里网关按 API Key 分好的 `window`，一个数都不加工；
       * 总计直接用 `/usage` 的整域汇总（网关「数据看板」顶部那行就是它）。
       * 2026-10-25 实测：三条 key 的 window 相加与整域 tokens / credit / ¥ 差都是 0，
       * 两种口径等价——那就别再自己加，网关给什么显示什么。
       */
      const usageTable = h(
        'div',
        { className: 'wbhub_usageTable' },
        usageHead,
        ...keys.map((key) =>
          h(
            'div',
            { key: key.hubKeyId, className: 'wbhub_usageItem' },
            h(
              'div',
              { className: 'wbhub_usageTitle' },
              h('span', {
                className: `wbhub_keyDot${key.hubKeyId === current?.hubKeyId ? ' wbhub_keyDotOn' : ''}`,
              }),
              h('span', { className: 'wbhub_usageName' }, key.name),
              h('span', { className: 'wbhub_usageMeta' }, `${t('keyAccounts')} ${key.accounts ?? 0}`),
            ),
            usageRow(t('rangeToday'), keyUsage(key.usage)),
            key.usageWeek === null || key.usageWeek === undefined
              ? null
              : usageRow(t('rangeWeek'), keyUsage(key.usageWeek)),
          ),
        ),
        h(
          'div',
          { className: 'wbhub_usageTotal' },
          h('div', { className: 'wbhub_usageTitle' }, h('span', { className: 'wbhub_usageName' }, t('totalRow'))),
          usageRow(t('rangeToday'), keyUsage(snapshot?.usage)),
          snapshot?.usageWeek === null || snapshot?.usageWeek === undefined
            ? null
            : usageRow(t('rangeWeek'), keyUsage(snapshot?.usageWeek)),
        ),
      )

      const openDashboard = async () => {
        if (opening) return
        setOpening(true)
        const result = await requestJson('dashboard-url')
        setOpening(false)
        if (result.ok && typeof result.data?.url === 'string') {
          window.open(result.data.url, '_blank', 'noopener,noreferrer')
        }
      }

      /** 点徽标：量出自己在屏幕上的位置，副窗贴着上沿弹。 */
      const toggle = (event) => {
        if (open === true) {
          setOpen(false)
          return
        }
        const rect =
          event !== null && event !== undefined && typeof event.currentTarget?.getBoundingClientRect === 'function'
            ? event.currentTarget.getBoundingClientRect()
            : null
        const viewport = typeof window !== 'undefined' && Number(window.innerHeight) > 0 ? Number(window.innerHeight) : 800
        setAnchor(
          rect === null
            ? null
            : { left: Number(rect.left) || 0, bottom: Math.max(8, viewport - (Number(rect.top) || 0) + 6) },
        )
        setOpen(true)
      }

      const badge = h(
        'button',
        {
          type: 'button',
          className: wide ? 'wbhub_badge' : 'wbhub_badge wbhub_badgeRail',
          'aria-label': t('badgeOpen'),
          'aria-haspopup': 'dialog',
          'aria-expanded': open === true,
          onClick: toggle,
        },
        // 图标沿用主题色（`currentColor`）：跟着 hover 一起变亮，不用另配一套。
        h(HubGlyph, { size: wide ? 15 : 18 }),
        wide
          ? h(
              'span',
              { className: 'wbhub_badgeBody' },
              h(
                'span',
                { className: 'wbhub_badgeTitle' },
                h('span', { className: 'wbhub_badgeName' }, badgeName),
                h('span', { className: 'wbhub_badgeValue' }, `${mainBalanceText} / ${balances.global}`),
              ),
              usageRow(t('rangeToday'), summary),
              hasWeek === true ? usageRow(t('rangeWeek'), week) : null,
            )
          : null,
      )

      const detail = h(
        'div',
        { className: 'wbhub_detail' },
        h(
          'div',
          { className: 'wbhub_detailHead' },
          h('span', { className: 'wbhub_sectionHead' }, t('currentSession')),
          h('span', { className: 'wbhub_keyName' }, providerLabel),
          h('span', {
            className: 'wbhub_keyDot',
            style: { background: tone },
            title: snapshot === null || error !== '' ? t('loadFailed') : snapshot.health?.ok === true ? t('health') : t('loadFailed'),
          }),
        ),
        h(
          'div',
          { className: 'wbhub_metrics' },
          metric(`${badgeName} ${t('footerBalance')}`, mainBalanceText, t('creditUnit')),
          metric(t('allAccounts'), balances.global, t('creditUnit')),
        ),
        keys.length === 0
          ? null
          : h(
              'div',
              null,
              h('div', { className: 'wbhub_sectionHead' }, t('keyDetail')),
              usageTable,
            ),
        stale === true ? h('div', { className: 'wbhub_detailNote' }, t('reselectHint')) : null,
        error !== '' ? h('div', { className: 'wbhub_detailNote', style: { color: palette.err } }, error) : null,
        typeof snapshot?.baseUrl === 'string' && snapshot.baseUrl !== ''
          ? h('div', { className: 'wbhub_detailNote' }, snapshot.baseUrl)
          : null,
        h(
          'div',
          { className: 'wbhub_footActions' },
          h(Button, { primary: true, onClick: openDashboard, disabled: opening === true }, opening === true ? '…' : t('openDashboard')),
          h(Button, { onClick: () => setOpen(false) }, t('close')),
        ),
      )

      const overlay = h(
        HubOverlay,
        {
          open,
          anchor,
          onClose: () => setOpen(false),
          title: `${t('footerLabel')} · ${t('detailTitle')}`,
          closeLabel: t('close'),
        },
        detail,
      )

      return h(react.Fragment, null, badge, overlay)
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

      // 样式先挂上：下面两个插槽随时可能立刻渲染，晚一步就是一片没样式的原生控件。
      injectStyles()

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${NS}: dictionaries`)

      // 侧边栏插槽拿不到会话，只能从客户端服务里读当前 provider（拿不到就静默跳过）。
      safeEffect(ctx, 'provider-source', () => attachProviderSource(ctx))

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
    exports.__keyListOf = keyListOf
    exports.__keyByProvider = keyByProvider
    exports.__mainKeyOf = mainKeyOf
    exports.__balanceLines = balanceLines
    exports.__providerSnapshot = providerSnapshot
    exports.__setProviderState = setProviderState
    exports.__attachProviderSource = attachProviderSource
    exports.__css = CSS
    exports.__injectStyles = injectStyles
    exports.__HubGlyph = HubGlyph
    exports.__HubOverlay = HubOverlay
    exports.__keyFoldOpen = keyFoldOpen
    exports.__syncedModelCount = syncedModelCount
    exports.__realmText = realmText
    exports.__apiKeySourceText = apiKeySourceText
    return module.exports
  },
})
