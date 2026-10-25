/**
 * `lib/hub.js` 的单元测试。
 *
 * 这一层是纯函数，所以测试也是纯的：不启 HTTP、不碰文件系统。
 * 覆盖重点是「hub 给的东西长什么样 → DSH 需要它长什么样」的翻译规则，
 * 以及每一条错误分支是否都落到了能读懂的文案上。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEFAULT_BASE_URL,
  DEFAULT_PWD,
  DEFAULT_TAB,
  DSH_THINKING_LEVELS,
  MAIN_API_KEY_ENV,
  MAIN_ROUTE_KEY,
  TABS,
  allocateRouteKey,
  apiKeyEnvFor,
  buildDashboardUrl,
  buildRouteModels,
  canonicalJson,
  clampEfforts,
  classifyFailure,
  compareModelsByName,
  computeAlerts,
  copySelection,
  isSyntheticUsageRow,
  keyRowsOf,
  keySlug,
  mainKeyBalance,
  modelDisplayName,
  modelLabel,
  modelRateSuffix,
  modelRateValue,
  modelRate,
  modelReasoningEfforts,
  normalizeBaseUrl,
  normalizeHubKeyRow,
  normalizePwd,
  normalizeTab,
  normalizeUsageRange,
  pickKeyUsage,
  seedSelection,
  summarizeAnalyticsWindow,
  usageQuery,
  USAGE_RANGES,
  pickBaseUrl,
  pollIntervalMs,
  rateText,
  reconcileModels,
  retryAfterSeconds,
  routeConfigMatches,
  sortModels,
  summarizeAccounts,
  summarizeBalance,
  summarizeHealth,
  summarizePanelStatus,
  summarizeUsage,
  toEpochMs,
  toModelProfile,
  toModelRow,
} from '../lib/hub.js'

/** `/v1/models` 里真实的一条（实测自 workbuddy2api-hub v1.7.32）。 */
const HY4 = {
  id: 'hy4-preview',
  object: 'model',
  name: 'Hy4 preview',
  description: 'flagship',
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
  reasoning_efforts: ['high'],
  reasoning_default_effort: 'high',
  reasoning_can_disable: false,
  always_reasoning: true,
  credits: 'x0.29',
  vendor: 'j',
}

const HY3 = {
  id: 'hy3',
  name: 'Hy3',
  supports_images: false,
  supports_tool_calls: true,
  supports_reasoning: true,
  context_length: 192000,
  max_output_tokens: 64000,
  reasoning_efforts: ['high', 'low'],
  reasoning_can_disable: true,
  credits: 'x0.15',
}

const FLASH = {
  id: 'deepseek-v4.1-flash',
  name: 'DS Flash',
  supports_images: false,
  supports_reasoning: false,
  input_modalities: ['text'],
  context_length: 1000000,
  max_output_tokens: 32000,
  credits: 'x0.08',
}

/* ------------------------------- 地址与参数 ------------------------------ */

test('normalizeBaseUrl：把浏览器地址栏里复制来的东西收干净', () => {
  assert.equal(normalizeBaseUrl(DEFAULT_BASE_URL), 'http://127.0.0.1:8788')
  // 用户给的原始形态：带 pwd 与 tab 参数、带尾斜杠。
  assert.equal(
    normalizeBaseUrl('http://127.0.0.1:8788/?pwd=admin&tab=gateway'),
    'http://127.0.0.1:8788',
    '查询串必须被丢掉：pwd/tab 只是 dashboard.html 的前端参数，不属于服务地址',
  )
  assert.equal(normalizeBaseUrl('127.0.0.1:8788'), 'http://127.0.0.1:8788', '缺 scheme 要补 http://')
  assert.equal(normalizeBaseUrl('  http://127.0.0.1:8788///  '), 'http://127.0.0.1:8788')
  assert.equal(normalizeBaseUrl('https://hub.example.com'), 'https://hub.example.com', 'https 不能被改成 http')
  assert.equal(normalizeBaseUrl('http://example.com/hub/'), 'http://example.com/hub', '子路径要保留')
  assert.equal(normalizeBaseUrl('http://127.0.0.1:8788/#hash'), 'http://127.0.0.1:8788')
  assert.equal(normalizeBaseUrl('ftp://example.com'), '', '只接受 http/https')
  assert.equal(normalizeBaseUrl(''), '')
  assert.equal(normalizeBaseUrl(null), '')
  assert.equal(normalizeBaseUrl(8788), '')
})

test('normalizePwd / normalizeTab', () => {
  assert.equal(normalizePwd(DEFAULT_PWD), 'admin')
  assert.equal(normalizePwd('  admin  '), 'admin')
  assert.equal(normalizePwd('a b'), 'a b', '密码中间的空格是合法字符，不能裁')
  assert.equal(normalizePwd(undefined), 'admin')
  assert.equal(normalizePwd(12345), 'admin')

  assert.equal(normalizeTab('gateway'), 'gateway')
  assert.equal(normalizeTab('  ANALYTICS '), 'analytics')
  assert.equal(normalizeTab('nope'), DEFAULT_TAB, '非法页签要退回默认，否则看板会落到空页签')
  assert.equal(normalizeTab(null), DEFAULT_TAB)
  assert.equal(normalizeTab('nope', 'logs'), 'logs')
  assert.equal(normalizeTab('nope', 'also-nope'), DEFAULT_TAB)
  assert.deepEqual([...TABS].length, 7)
})

test('normalizeUsageRange：hub 只认 range，不认 hours', () => {
  assert.deepEqual([...USAGE_RANGES], ['today', 'week', 'month', 'all'])
  assert.equal(normalizeUsageRange(undefined), 'today', '默认今日')
  assert.equal(normalizeUsageRange(''), 'today')
  assert.equal(normalizeUsageRange('TODAY'), 'today')
  assert.equal(normalizeUsageRange(' day '), 'today')
  assert.equal(normalizeUsageRange('1d'), 'today')
  assert.equal(normalizeUsageRange('w'), 'week')
  assert.equal(normalizeUsageRange('MONTH'), 'month')
  assert.equal(normalizeUsageRange('m'), 'month')
  assert.equal(normalizeUsageRange('total'), 'all')
  assert.equal(normalizeUsageRange('hours=24'), 'today', '传错参数名退回今日，别把全量历史当今日')
  assert.equal(normalizeUsageRange('6'), 'today')

  assert.equal(usageQuery('today'), '/usage?range=today')
  assert.equal(usageQuery('week'), '/usage?range=week')
  assert.equal(usageQuery('month'), '/usage?range=month')
  assert.equal(usageQuery('all'), '/usage', 'all 不带参数：hub 侧不过滤')
  assert.equal(usageQuery(undefined), '/usage?range=today')
  assert.equal(usageQuery('nope'), '/usage?range=today')
})

test('buildDashboardUrl：只带页签，密码永远不拼进链接', () => {
  assert.equal(buildDashboardUrl('http://127.0.0.1:8788', 'gateway'), 'http://127.0.0.1:8788/?tab=gateway')
  assert.equal(buildDashboardUrl('http://127.0.0.1:8788/', 'accounts'), 'http://127.0.0.1:8788/?tab=accounts')
  // 页签不合法就落回默认的 gateway；地址无效给空串。
  assert.equal(buildDashboardUrl('http://127.0.0.1:8788', 'nope'), 'http://127.0.0.1:8788/?tab=gateway')
  assert.equal(buildDashboardUrl('http://127.0.0.1:8788', 'LOGS'), 'http://127.0.0.1:8788/?tab=logs')
  assert.equal(buildDashboardUrl('', 'gateway'), '')
})

/* -------------------------------- 错误分类 ------------------------------- */

test('classifyFailure：四类失败必须分得清', () => {
  const unreachable = classifyFailure({ status: 0, text: 'fetch failed' })
  assert.equal(unreachable.kind, 'unreachable')
  assert.match(unreachable.message, /连不上 hub/)
  assert.match(unreachable.message, /启动/, '文案要告诉用户去确认服务起没起')

  const timeout = classifyFailure({ status: 0, text: '请求超时（8000ms）' })
  assert.equal(timeout.kind, 'timeout')
  assert.match(timeout.message, /超时/)

  const auth = classifyFailure({ status: 401, text: 'invalid panel password', body: { error: 'invalid panel password' } })
  assert.equal(auth.kind, 'auth')
  assert.match(auth.message, /pwd/)
  assert.match(auth.message, /invalid panel password/)

  assert.equal(classifyFailure({ status: 403 }).kind, 'auth')

  const limited = classifyFailure({
    status: 429,
    body: { error: 'too many login attempts, please wait 42s' },
  })
  assert.equal(limited.kind, 'rate-limited')
  assert.match(limited.message, /42 秒/)

  const missing = classifyFailure({ status: 404, text: '' })
  assert.equal(missing.kind, 'http')
  assert.match(missing.message, /版本/)

  const broken = classifyFailure({ status: 502, text: 'bad gateway' })
  assert.match(broken.message, /hub 内部错误/)

  assert.match(classifyFailure({}).message, /连不上 hub/)
})

test('retryAfterSeconds：从限流文案里抠秒数', () => {
  assert.equal(retryAfterSeconds('too many login attempts, please wait 42s'), 42)
  assert.equal(retryAfterSeconds('try again in 5 seconds'), 5)
  assert.equal(retryAfterSeconds('wait 999999s'), 3600, '上限一小时，别让前端等一个荒唐的数')
  assert.equal(retryAfterSeconds('no digits here'), 0)
  assert.equal(retryAfterSeconds(undefined), 0)
})

/* -------------------------------- 模型翻译 ------------------------------- */

test('modelRate / rateText / modelDisplayName', () => {
  assert.equal(modelRate(HY4), 0.29, 'hub 的 credits 是 "x0.29" 这种形态')
  assert.equal(modelRate({ rate: 1.5 }), 1.5)
  assert.equal(modelRate({ price: '¥0.5' }), 0.5)
  assert.equal(modelRate({ credits: 'free' }), null)
  assert.equal(modelRate(null), null)

  assert.equal(rateText(0.29), '×0.29')
  assert.equal(rateText(null), '')
  assert.equal(rateText(0), '')

  assert.equal(modelDisplayName(HY4), 'Hy4 preview')
  assert.equal(modelDisplayName({ id: 'x' }), 'x')
  assert.equal(modelDisplayName({}), '未命名模型')
})

test('modelRateValue / modelRateSuffix / modelLabel：倍率要出现在选择器里', () => {
  // 0 是有效值：hub 对免费模型给的是 "x0.00"，必须和「没声明」区分开。
  assert.equal(modelRateValue(HY4), 0.29)
  assert.equal(modelRateValue({ credits: 'x0.00' }), 0)
  assert.equal(modelRateValue({ rate: 0 }), 0)
  assert.equal(modelRateValue({ credits: 'free' }), 0, '字面量 free 也是 0')
  assert.equal(modelRateValue({}), null)
  assert.equal(modelRateValue(null), null)
  // modelRate 保持老语义：0 不算「有倍率」，设置页那列原本靠它。
  assert.equal(modelRate({ credits: 'x0.00' }), null)

  assert.equal(modelRateSuffix(HY4), '×0.29')
  assert.equal(modelRateSuffix({ credits: 'x0.00' }), 'Free')
  assert.equal(modelRateSuffix({ credits: 'free' }), 'Free')
  assert.equal(modelRateSuffix({ id: 'nope' }), '', '没声明倍率就什么都不加，不谎报免费')

  assert.equal(modelLabel(HY4), 'Hy4 preview ×0.29')
  assert.equal(modelLabel({ id: 'hy3', name: 'Hy3', credits: 'x0.00' }), 'Hy3 Free')
  assert.equal(modelLabel({ id: 'bare' }), 'bare')
  assert.equal(modelLabel({}), '未命名模型')
})

test('modelReasoningEfforts：三种语义（false / undefined / 档位对象）', () => {
  // always_reasoning 的模型不给 off 档。
  assert.deepEqual(modelReasoningEfforts(HY4), { high: 'high' })
  // 声明可关闭的模型给 off，且档位按 DSH 的顺序排（low 在 high 前）。
  assert.deepEqual(modelReasoningEfforts(HY3), { off: 'off', low: 'low', high: 'high' })
  // 声明支持思考但没给档位：留给作者默认（不写字段），而不是写死 false。
  assert.equal(modelReasoningEfforts({ supports_reasoning: true }), undefined)
  assert.equal(modelReasoningEfforts({}), false, '明确不支持思考的模型要写 false')
  // 不是 DSH 认得的档位名一律丢掉。
  assert.deepEqual(modelReasoningEfforts({ reasoning_efforts: ['ultra', 'HIGH'] }), { high: 'high' })
  assert.equal(modelReasoningEfforts({ reasoning_efforts: [] }), false)
  // 参考项目的字段名也要认。
  assert.deepEqual(modelReasoningEfforts({ supported_efforts: ['low'], can_disable_thinking: true }), {
    off: 'off',
    low: 'low',
  })
  for (const level of Object.keys(modelReasoningEfforts(HY3))) {
    assert.ok(DSH_THINKING_LEVELS.includes(level), `${level} 必须是 pi-ai 认得的档位`)
  }
})

test('clampEfforts：只剩 off 时必须退回全量（否则 pi-ai 会整条路由拒绝）', () => {
  const full = { off: 'off', low: 'low', high: 'high' }
  assert.deepEqual(clampEfforts(full, ['high']), { off: 'off', high: 'high' })
  assert.deepEqual(clampEfforts(full, []), full, '没勾选就当作不裁剪')
  assert.deepEqual(clampEfforts(full, ['off']), full, '裁剪后只剩 off → 退回全量')
  assert.deepEqual(clampEfforts(full, ['low', 'high']), full)
  assert.equal(clampEfforts(false, ['high']), false)
  assert.equal(clampEfforts(undefined, ['high']), undefined)
})

test('toModelProfile：只写有值的字段，绝不写 0 / NaN', () => {
  const profile = toModelProfile(HY4)
  assert.deepEqual(profile, {
    id: 'hy4-preview',
    name: 'Hy4 preview ×0.29',
    contextWindow: 960000,
    maxTokens: 64000,
    input: ['text', 'image'],
    reasoningEfforts: { high: 'high' },
  })

  const textOnly = toModelProfile(FLASH)
  assert.deepEqual(textOnly, {
    id: 'deepseek-v4.1-flash',
    name: 'DS Flash ×0.08',
    contextWindow: 1000000,
    maxTokens: 32000,
    reasoningEfforts: false,
  })
  assert.equal('input' in textOnly, false, '不支持图片的模型不写 input')

  // 缺上下文/输出上限时直接不写这两个键：写 0 会让整条 provider 路由校验失败。
  const bare = toModelProfile({ id: 'bare', context_length: 0, max_output_tokens: 'nope' })
  assert.deepEqual(bare, { id: 'bare', name: 'bare', reasoningEfforts: false })
  assert.equal('contextWindow' in bare, false)
  assert.equal('maxTokens' in bare, false)

  // 认 max_input_tokens / max_completion_tokens 两个别名。
  const alias = toModelProfile({ id: 'alias', max_input_tokens: 32000, max_completion_tokens: 4096 })
  assert.equal(alias.contextWindow, 32000)
  assert.equal(alias.maxTokens, 4096)

  assert.equal(toModelProfile({}), undefined, '没有 id 的条目直接丢掉')
  assert.equal(toModelProfile(null), undefined)

  // 用户裁剪了档位。
  assert.deepEqual(toModelProfile(HY3, { efforts: ['low'] }).reasoningEfforts, { off: 'off', low: 'low' })
})

test('buildRouteModels：按名称排序、跳过被关掉的模型', () => {
  const models = [HY4, HY3, FLASH]
  assert.deepEqual(
    buildRouteModels(models, {}).map((profile) => profile.id),
    ['deepseek-v4.1-flash', 'hy3', 'hy4-preview'],
    'DeepSeek V4.1 Flash < Hy3 < Hy4 preview',
  )
  assert.deepEqual(
    buildRouteModels(models, { hy3: { enabled: false } }).map((profile) => profile.id),
    ['deepseek-v4.1-flash', 'hy4-preview'],
  )
  // 名称排序与倍率无关：便宜的不再自动排前面。
  const unknown = [
    { id: 'z', name: 'z' },
    { id: 'a', name: 'a', credits: '0.1' },
    { id: 'b', name: 'b', credits: '0.9' },
  ]
  assert.deepEqual(
    buildRouteModels(unknown, {}).map((profile) => profile.id),
    ['a', 'b', 'z'],
  )
  assert.deepEqual(buildRouteModels(null, {}), [])
  assert.deepEqual(buildRouteModels([{ name: 'no-id' }], {}), [], '没有 id 的条目不会进配置')
})

test('sortModels：按名称排序，不区分大小写、数字按数值', () => {
  const rows = [
    { id: 'gpt-10', name: 'GPT-10' },
    { id: 'hy3', name: 'hy3' },
    { id: 'alpha', name: 'Alpha' },
    { id: 'gpt-9', name: 'GPT-9' },
    { id: 'zulu' },
    { id: 'alpha-2', name: 'alpha' },
  ]
  assert.deepEqual(
    sortModels(rows).map((row) => row.id),
    ['alpha', 'alpha-2', 'gpt-9', 'gpt-10', 'hy3', 'zulu'],
    '大小写同权、9 在 10 前、同名按 id、没有名字时用 id',
  )
  assert.deepEqual(sortModels(null), [])
  assert.notEqual(sortModels(rows), rows, '返回新数组')
})

test('sortModels：名称相同按 id，缺 name 用 id 兜底', () => {
  const rows = [
    { id: 'b', name: 'same' },
    { id: 'a', name: 'same' },
    { id: 'c' },
  ]
  // 没有 name 的条目拿 id 当名字，所以 'c' 排在 'same' 前面。
  assert.deepEqual(sortModels(rows).map((row) => row.id), ['c', 'a', 'b'])
  assert.equal(compareModelsByName({ id: 'x', name: 'B' }, { id: 'y', name: 'a' }) > 0, true)
})

test('toModelRow：设置页要显示的字段', () => {
  const row = toModelRow(HY3, { hy3: { enabled: false, efforts: ['high'] } })
  assert.equal(row.id, 'hy3')
  assert.equal(row.name, 'Hy3')
  assert.equal(row.rate, 0.15)
  assert.equal(row.rateText, '×0.15')
  assert.equal(row.contextWindow, 192000)
  assert.equal(row.vision, false)
  assert.equal(row.tools, true)
  assert.equal(row.reasoning, true)
  assert.deepEqual(row.efforts, ['off', 'low', 'high'])
  assert.equal(row.enabled, false)
  assert.deepEqual(row.selectedEfforts, ['high'])
  assert.equal(row.retired, false)

  const retired = toModelRow({ ...HY4, retired: true, retiredAt: 123 }, {})
  assert.equal(retired.retired, true)
  assert.equal(retired.retiredAt, 123)
})

/* -------------------------------- 响应摘要 ------------------------------- */

test('summarizeHealth / summarizePanelStatus / summarizeBalance', () => {
  assert.deepEqual(
    summarizeHealth({ ok: true, realm: 'cn', accounts: 2, accounts_ready: 2, api_key_required: true }),
    { ok: true, realm: 'cn', accounts: 2, accountsReady: 2, apiKeyRequired: true, version: '' },
  )
  assert.equal(summarizeHealth(null), null)
  assert.equal(summarizeHealth({ ok: false }).ok, false)

  assert.deepEqual(
    summarizePanelStatus({
      panel_password_required: true,
      panel_password_is_default: true,
      authenticated: false,
      api_key_set: false,
    }),
    { passwordRequired: true, passwordIsDefault: true, authenticated: false, apiKeySet: false },
  )
  assert.equal(summarizePanelStatus('nope'), null)

  const balance = summarizeBalance({
    balance: 3712.5678,
    unit: 'credit',
    realm: 'cn',
    accounts_enabled: 2,
    accounts_with_credit_data: 2,
    updated_at: 1792760426.5,
  })
  assert.equal(balance.balance, 3712.57)
  assert.equal(balance.updatedAt, 1792760426500, '秒级时间戳要换算成毫秒')
  assert.equal(summarizeBalance({}).balance, 0)
  assert.equal(summarizeBalance(undefined), null)
})

test('summarizeAccounts：谁要重登、谁在冷却、还剩几天', () => {
  const now = Date.UTC(2026, 9, 24)
  const summary = summarizeAccounts(
    {
      accounts: [
        {
          nickname: '🐾',
          realm: 'cn',
          platform: 'CLI',
          enabled: true,
          expiresAt: Math.floor(now / 1000) + 27 * 86400,
          credits: { remain: 1347.331 },
        },
        {
          nickname: 'b',
          enabled: true,
          needRelogin: true,
          inCooldown: true,
          expiresAt: Math.floor(now / 1000) + 2 * 86400,
          credits: { remain: 88.5 },
        },
        { nickname: 'c', enabled: false, tokenExpired: true },
      ],
    },
    now,
  )
  assert.equal(summary.total, 3)
  assert.equal(summary.enabled, 2)
  assert.equal(summary.ready, 1, '要重登+冷却中的账号不算 ready')
  assert.equal(summary.needRelogin, 1)
  assert.equal(summary.inCooldown, 1)
  assert.equal(summary.expired, 1)
  assert.equal(summary.totalCredits, 1435.83)
  assert.equal(summary.accounts[0].daysLeft, 27)
  assert.equal(summary.accounts[1].ready, false)
  assert.equal(summary.accounts[2].credits, null)

  // 也接受裸数组。
  assert.equal(summarizeAccounts([{ enabled: true }]).total, 1)
  assert.equal(summarizeAccounts(null), null)
  assert.equal(summarizeAccounts({}), null)
})

test('summarizeUsage：比率与 by_model 排序', () => {
  const usage = summarizeUsage({
    requests: 1813,
    errors: 38,
    prompt_tokens: 187393318,
    completion_tokens: 1493328,
    reasoning_tokens: 753366,
    cached_tokens: 179497887,
    total_tokens: 188886646,
    credit: 405.25,
    cost_cny: 20.968,
    started: 1792760426,
    by_model: {
      hy3: { requests: 613, credit: 104.75, cost_cny: 5.768, total_tokens: 38886646 },
      'hy4-preview': { requests: 1200, credit: 300.5, cost_cny: 15.2, total_tokens: 150000000 },
    },
  })
  assert.equal(usage.errorRate, 2.1, '38/1813 ≈ 2.1%')
  assert.equal(usage.cacheHitRate, 95, '179497887/188886646 ≈ 95%')
  assert.equal(usage.byModel[0].id, 'hy4-preview', '按花费降序')
  assert.equal(usage.byModel.length, 2)

  const many = { by_model: {} }
  for (let index = 0; index < 20; index += 1) many.by_model[`m${index}`] = { cost_cny: index }
  assert.equal(summarizeUsage(many, 5).byModel.length, 5, 'by_model 要截断，别把快照撑大')
  assert.equal(summarizeUsage(many, 0).byModel.length, 12, 'limit 非法时退回 12')
  assert.equal(summarizeUsage(null), null)
})

/* ------------------------------ 配置比对与时间 ----------------------------- */

test('canonicalJson / routeConfigMatches', () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }), '键序不影响结果')
  assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}')
  assert.equal(canonicalJson([{ y: 1, x: 2 }]), '[{"x":2,"y":1}]')
  assert.equal(canonicalJson(null), 'null')

  const target = { displayName: 'wb', models: [{ id: 'a' }] }
  assert.equal(routeConfigMatches({ ...target }, target), true)
  // 现有多出来的字段不该触发重写。
  assert.equal(routeConfigMatches({ ...target, timeoutMs: 30000, headers: { a: '1' } }, target), true)
  assert.equal(routeConfigMatches({ ...target, models: [{ id: 'b' }] }, target), false)
  assert.equal(routeConfigMatches(null, target), false)
})

test('toEpochMs：秒 / 毫秒 / 字符串', () => {
  assert.equal(toEpochMs(1792760426), 1792760426000)
  assert.equal(toEpochMs(1792760426.5), 1792760426500)
  assert.equal(toEpochMs(1792760426000), 1792760426000)
  assert.equal(toEpochMs('1792760426'), 1792760426000)
  assert.equal(toEpochMs('2026-10-24T00:00:00Z'), Date.UTC(2026, 9, 24))
  assert.equal(toEpochMs(0), 0)
  assert.equal(toEpochMs(-5), 0)
  assert.equal(toEpochMs('nope'), 0)
  assert.equal(toEpochMs(null), 0)
})

test('pollIntervalMs：指数退避，上限 30 分钟', () => {
  assert.equal(pollIntervalMs(120, 0), 120000)
  assert.equal(pollIntervalMs(120, 1), 240000)
  assert.equal(pollIntervalMs(120, 2), 480000)
  assert.equal(pollIntervalMs(120, 5), 1800000, '退避上限')
  assert.equal(pollIntervalMs(120, 50), 1800000, '失败再多次也不会超过上限')
  assert.equal(pollIntervalMs(5, 0), 30000, '基础间隔最小 30 秒')
  assert.equal(pollIntervalMs(120, 0, { floorSeconds: 600 }), 600000, '被限流时抬到建议等待时间')
  assert.equal(pollIntervalMs('x', 'y'), 120000, '非法输入退回默认 120 秒')
})

/* ------------------------------ 宽限期与告警 ----------------------------- */

test('reconcileModels：下架进宽限期、回来能复活、到期才真删', () => {
  const now = 1_000_000_000_000
  const graceMs = 24 * 3600 * 1000

  // 第一轮：模型全新，不产生 added（没有上一轮可比较）。
  const first = reconcileModels([HY4, HY3], { lastIds: [], models: [], retired: {} }, now, graceMs)
  assert.equal(first.models.length, 2)
  assert.deepEqual(first.added, [])

  // 第二轮：hy3 消失 → 进宽限期，但仍留在清单里并打 retired 标记。
  const second = reconcileModels([HY4], { lastIds: ['hy4-preview', 'hy3'], models: [HY4, HY3], retired: {} }, now, graceMs)
  assert.deepEqual(second.removed, ['hy3'])
  assert.equal(second.models.length, 2)
  const retiredRow = second.models.find((model) => model.id === 'hy3')
  assert.equal(retiredRow.retired, true, '宽限期内要标 retired，前端才能提示却仍可用')
  assert.equal(second.retired.hy3.at, now)

  // 第三轮：宽限期内又没出现 → 继续保留。
  const third = reconcileModels(
    [HY4],
    { lastIds: ['hy4-preview', 'hy3'], models: second.models, retired: second.retired },
    now + 3600_000,
    graceMs,
  )
  assert.equal(third.models.length, 2)
  assert.equal(third.retired.hy3.at, now, '保留原来的下架时间，不要重置宽限期')

  // 第四轮：宽限期到期 → 真正移除。
  const expired = reconcileModels(
    [HY4],
    { lastIds: ['hy4-preview', 'hy3'], models: third.models, retired: third.retired },
    now + graceMs + 1,
    graceMs,
  )
  assert.equal(expired.models.length, 1)
  assert.equal(expired.retired.hy3, undefined)

  // 复活：宽限期内回来了，标记清除、不重复提醒。
  const revived = reconcileModels(
    [HY4, HY3],
    { lastIds: ['hy4-preview'], models: second.models, retired: second.retired },
    now + 7200_000,
    graceMs,
  )
  assert.equal(revived.models.every((model) => model.retired !== true), true)
  assert.equal(revived.retired.hy3, undefined)
  assert.deepEqual(revived.added, ['hy3'], '重新出现的模型算本轮新增')

  // graceMs = 0 等于立刻删。
  const immediate = reconcileModels([HY4], { lastIds: ['hy4-preview', 'hy3'], models: [HY4, HY3], retired: {} }, now, 0)
  assert.equal(immediate.models.length, 1)

  // 非法输入不炸。
  assert.deepEqual(reconcileModels(null, null, now, graceMs).models, [])
  assert.deepEqual(reconcileModels([{ name: 'no id' }], {}, now, graceMs).models, [])
})

test('computeAlerts：四类告警 + 已读抑制', () => {
  const auth = computeAlerts({ failureKind: 'auth', lastError: 'hub 鉴权失败' })
  assert.equal(auth[0].key, 'auth')
  assert.equal(auth[0].level, 'error')

  const limited = computeAlerts({ failureKind: 'rate-limited', lastError: '限流' })
  assert.equal(limited[0].key, 'rate-limited')

  const unreachable = computeAlerts({ consecutiveFailures: 5, lastError: '连不上' })
  assert.equal(unreachable[0].key, 'unreachable')

  assert.deepEqual(computeAlerts({ consecutiveFailures: 4 }), [], '没到阈值就别吵')

  const noKey = computeAlerts({ apiKeyPresent: false })
  assert.equal(noKey[0].key, 'api-key')

  const low = computeAlerts({ balance: { balance: 10 }, thresholds: { lowCredits: 100 } })
  assert.equal(low[0].key, 'low-credits')

  const accounts = computeAlerts({
    accounts: { needRelogin: 1, expired: 1, accounts: [{ daysLeft: 2 }] },
  })
  assert.deepEqual(
    accounts.map((alert) => alert.key),
    ['relogin', 'expired', 'expiring'],
  )

  // 关掉的告警 24 小时内不再出现。
  const now = 1_000_000_000_000
  const dismissed = computeAlerts({ now, failureKind: 'auth', dismissed: { auth: now - 1000 } })
  assert.deepEqual(dismissed, [])
  const again = computeAlerts({ now, failureKind: 'auth', dismissed: { auth: now - 25 * 3600 * 1000 } })
  assert.equal(again[0].key, 'auth', '超过 24 小时要重新提醒')

  // 阈值可配。
  assert.equal(computeAlerts({ consecutiveFailures: 2, thresholds: { unreachablePolls: 2 } })[0].key, 'unreachable')
  // 空输入不炸。
  assert.deepEqual(computeAlerts({}), [])
  assert.deepEqual(computeAlerts(null), [])
})

test('pickBaseUrl', () => {
  assert.equal(pickBaseUrl(['', ' 127.0.0.1:8788 ']), 'http://127.0.0.1:8788')
  assert.equal(pickBaseUrl([]), DEFAULT_BASE_URL)
  assert.equal(pickBaseUrl(null), DEFAULT_BASE_URL)
  assert.equal(pickBaseUrl(['', 'http://x']), 'http://x')
})

/* ------------------------------ 多 key ------------------------------ */

test('keySlug / allocateRouteKey / apiKeyEnvFor：一 key 一路由一凭据', () => {
  assert.equal(keySlug('bendi'), 'bendi')
  assert.equal(keySlug('Pool-CN'), 'pool-cn')
  assert.equal(keySlug('  a  b  '), 'a-b', '连续符号折叠成一个连字符')
  assert.equal(keySlug('中文名字', 'abcd1234ef'), 'abcd1234', '中文名用 id 前 8 位兜底，不能拼出空 slug')
  assert.equal(keySlug('', ''), 'key')

  // 主 key 恒定，不跟着名字走——否则改个名就把会话里的模型搞没了。
  assert.equal(allocateRouteKey('bendi', 'bendi0001', [], true), MAIN_ROUTE_KEY)
  assert.equal(allocateRouteKey('Pool CN', 'poolcn001'), 'workbuddy2api-hub-pool-cn')
  // 撞名：先加 id 前 4 位，再撞加序号。
  assert.equal(
    allocateRouteKey('pool-cn', 'abcd9999', ['workbuddy2api-hub-pool-cn']),
    'workbuddy2api-hub-pool-cn-abcd',
  )
  assert.equal(
    allocateRouteKey('pool-cn', 'abcd9999', ['workbuddy2api-hub-pool-cn', 'workbuddy2api-hub-pool-cn-abcd']),
    'workbuddy2api-hub-pool-cn-abcd-2',
  )

  assert.equal(apiKeyEnvFor(MAIN_ROUTE_KEY), MAIN_API_KEY_ENV)
  assert.equal(apiKeyEnvFor('workbuddy2api-hub-pool-cn'), 'WORKBUDDY2API_HUB_API_KEY_POOL_CN')
  assert.equal(apiKeyEnvFor('workbuddy2api-hub-x'), 'WORKBUDDY2API_HUB_API_KEY_X')
})

test('normalizeHubKeyRow / keyRowsOf', () => {
  assert.equal(normalizeHubKeyRow(null), null)
  assert.equal(normalizeHubKeyRow({ name: 'x' }), null, '没有 id 的行直接丢掉')
  const row = normalizeHubKeyRow({
    id: ' bendi0001 ',
    name: ' bendi ',
    masked: 'bend******0001',
    enabled: false,
    accounts: ['a', 'b', 3],
    models: ['hy3'],
  })
  assert.equal(row.hubKeyId, 'bendi0001')
  assert.equal(row.name, 'bendi')
  assert.equal(row.enabled, false, 'enabled:false 才是关，缺字段算开')
  assert.deepEqual(row.accounts, ['a', 'b'], '非字符串的账号 id 滤掉')
  assert.deepEqual(row.models, ['hy3'])
  assert.equal(normalizeHubKeyRow({ id: 'x' }).name, 'key-x', '没名字时用 id 兜底')

  const rows = keyRowsOf({ api_keys: [{ id: 'a', name: 'A' }, { name: 'no-id' }, null] })
  assert.deepEqual(rows.map((item) => item.hubKeyId), ['a'])
  assert.deepEqual(keyRowsOf(null), [])
  assert.deepEqual(keyRowsOf({}), [])
})

test('mainKeyBalance：主 key 余额 = 它绑定的账号之和', () => {
  const accounts = {
    accounts: [
      { uid: 'u1', enabled: true, credits: { remain: 1347.33 } },
      { uid: 'u2', enabled: true, credits: { remain: 88.5 } },
      { uid: 'u3', enabled: false, credits: { remain: 999 } },
      { uid: 'u4', enabled: true },
    ],
  }
  const sum = mainKeyBalance(accounts, ['u1', 'u2'])
  assert.equal(sum.remain, 1435.83)
  assert.equal(sum.bound, 2)
  assert.equal(sum.found, 2)
  assert.equal(sum.enabled, 2)
  assert.equal(sum.missing, 0)

  // 绑了两个号但只找到一个：missing 要如实算，界面才好提示。
  const partial = mainKeyBalance(accounts, ['u1', 'gone'])
  assert.equal(partial.remain, 1347.33)
  assert.equal(partial.missing, 1)

  // 绑了但账号被停用：不算进余额。
  assert.equal(mainKeyBalance(accounts, ['u3']).remain, null)
  // 没绑号：remain 是 null 而不是 0（0 是「真没余额」）。
  assert.equal(mainKeyBalance(accounts, []).remain, null)
  // 缺数据不炸。
  assert.equal(mainKeyBalance(null, ['u1']).remain, null)
  assert.equal(mainKeyBalance({ accounts: 'nope' }, ['u1']).found, 0)
})

test('pickKeyUsage / isSyntheticUsageRow / summarizeAnalyticsWindow', () => {
  const rows = [
    {
      key: 'bendi0001',
      name: 'bendi',
      source: 'panel',
      window: { requests: 92, errors: 2, total_tokens: 8884081, credit: 12.66, cost_cny: 1.4595 },
      all_time: { requests: 2815, total_tokens: 150000000, credit: 300.5 },
      models: ['hy3', 'hy4-preview'],
    },
    { key: '__no_key__', name: '(无 key)', source: 'bucket', window: { requests: 5 } },
    { key: 'x', name: 'x', source: 'bucket', window: { requests: 1 } },
  ]
  assert.equal(isSyntheticUsageRow(rows[1]), true)
  assert.equal(isSyntheticUsageRow(rows[2]), true, 'source 不是 panel 的一律不算')
  assert.equal(isSyntheticUsageRow(rows[0]), false)
  assert.equal(isSyntheticUsageRow({ key: '', source: 'panel' }), true)
  assert.equal(isSyntheticUsageRow(null), true)

  const usage = pickKeyUsage(rows, 'bendi0001')
  assert.equal(usage.requests, 92)
  assert.equal(usage.errorRate, 2.2)
  assert.equal(usage.totalTokens, 8884081)
  assert.equal(usage.credit, 12.66)
  assert.equal(usage.models, 2, '窗口里没有 models 计数就用 models 数组长度')
  assert.equal(usage.lifetime.requests, 2815)
  assert.equal(pickKeyUsage(rows, '__no_key__'), null, '合成桶永远取不到')
  assert.equal(pickKeyUsage(rows, 'nope'), null)
  assert.equal(pickKeyUsage(rows, ''), null)
  assert.equal(pickKeyUsage(null, 'bendi0001'), null)

  assert.deepEqual(summarizeAnalyticsWindow({ window: { since: 'a', until: 'b' }, realm: 'all' }), {
    since: 'a',
    until: 'b',
    realm: 'all',
  })
  assert.deepEqual(summarizeAnalyticsWindow(null), { since: '', until: '', realm: '' })
})

test('seedSelection / copySelection：默认全选，同步只给两边都有的模型', () => {
  const seeded = seedSelection([{ id: 'hy3' }, { id: 'glm-5.3-flash' }], {})
  assert.deepEqual(seeded, { hy3: { enabled: true }, 'glm-5.3-flash': { enabled: true } })

  // 用户手动取消勾选过的，不能被「默认全选」又勾回来。
  const kept = seedSelection([{ id: 'hy3' }, { id: 'new-one' }], { hy3: { enabled: false, efforts: { high: 'high' } } })
  assert.deepEqual(kept.hy3, { enabled: false, efforts: { high: 'high' } })
  assert.deepEqual(kept['new-one'], { enabled: true })
  assert.deepEqual(seedSelection(null, null), {})
  assert.deepEqual(seedSelection([{ id: '' }, {}, null], {}), {}, '没 id 的模型跳过')

  const copied = copySelection({ hy3: { enabled: false }, 'glm-5.3-flash': { enabled: true } }, [
    { id: 'hy3' },
    { id: 'deepseek-v4.1-flash' },
  ])
  assert.deepEqual(copied, { hy3: { enabled: false }, 'deepseek-v4.1-flash': { enabled: true } }, '目标 key 没有的模型按默认全选')
  // 目标 key 独有的模型：保留它自己以前的勾选，不能被同步悄悄勾回来。
  const keptOwn = copySelection({ hy3: { enabled: false } }, [{ id: 'hy3' }, { id: 'deepseek-v4.1-flash' }], {
    'deepseek-v4.1-flash': { enabled: false, efforts: { high: 'high' } },
  })
  assert.deepEqual(keptOwn, {
    hy3: { enabled: false },
    'deepseek-v4.1-flash': { enabled: false, efforts: { high: 'high' } },
  })
  assert.deepEqual(copySelection(null, [{ id: 'hy3' }]), { hy3: { enabled: true } })
  assert.deepEqual(copySelection(null, null), {})
})
