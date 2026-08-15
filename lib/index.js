/**
 * dsh-balance — host half. Owns the plugin store (~/.dsh/balance/settings.json,
 * the floating-window master switch), the /api/dsh-balance route family
 * (settings GET/PUT, balance fetch) and the system-prompt announcement.
 *
 * Unlike the earlier dynamic-prototype, a real host plugin has unrestricted
 * Node — the balance fetch is a plain `fetch` with a Bearer header resolved
 * through the credentials seam (env > ~/.dsh/.credentials.yaml > .env), with
 * the provider plan derived from the configured base URL. Zero runtime
 * dependencies: `lib/` is the shipped artifact copied from `src/`.
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** Stable cordis plugin name. */
export const name = 'balance'

/** Services required before the balance surfaces can mount. */
export const inject = ['webServer', 'systemPrompt']

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const BALANCE_GUIDANCE = '本机已安装 dsh-balance 插件（模型账户余额悬浮窗）：右下角悬浮窗实时展示模型账户余额（每 60 秒刷新，可手动刷新/收起/关闭）；设置页在「设置 → 插件 → 模型余额悬浮窗」，带「显示余额悬浮窗」总开关；支持 DeepSeek / 硅基流动 / Moonshot / OpenRouter 余额接口（按 baseURL 自动识别）。查询走 host 端 fetch，密钥经 credentials 服务解析，仅显示余额数字与错误信息，不会泄露密钥。用户提到「模型余额 / 账户余额 / 余额悬浮窗」时即指本插件，请据此协作。'

/** Cache TTL for balance fetches (manual refresh bypasses it). */
const CACHE_TTL_MS = 30000

/** Per-fetch timeout. */
const REQUEST_TIMEOUT_MS = 20000

const DEFAULT_SETTINGS = { floatingWindow: true, apiKey: '' }

const CREDENTIAL_FALLBACK = 'DEEPSEEK_API_KEY'
const DEFAULT_BASE_URL = 'https://api.deepseek.com'

/** Root directory of the plugin-owned store (DSH_HOME honored). */
function balanceHome() {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'balance')
}

function settingsFile() {
  return join(balanceHome(), 'settings.json')
}

/** Read and validate the settings document. */
function readSettings() {
  try {
    const raw = JSON.parse(readFileSync(settingsFile(), 'utf8'))
    return {
      floatingWindow: raw.floatingWindow !== false,
      apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** Atomic write: temp file + rename on the same volume. */
function writeSettings(settings) {
  mkdirSync(balanceHome(), { recursive: true })
  const tmp = settingsFile() + '.tmp'
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n')
  renameSync(tmp, settingsFile())
}

/** Mask a key for display: sk-…abcd (never the full value). */
function maskKey(key) {
  if (typeof key !== 'string' || key.length === 0) return ''
  if (key.length <= 8) return '••••••'
  return key.slice(0, 3) + '…' + key.slice(-4)
}

/**
 * Resolve the API key to use: the plugin-local key (explicitly entered in the
 * settings page) wins; the credentials seam (env / ~/.dsh/.credentials.yaml /
 * .env) is the fallback for deployments where the web profile does not mount
 * a credentials provider.
 */
async function resolveKey(credentialsService, refName) {
  const local = readSettings().apiKey
  if (local.length > 0) return { key: local, source: 'local' }
  if (credentialsService !== undefined) {
    try {
      const hit = await credentialsService.resolve(refName)
      if (hit !== undefined && hit !== null && typeof hit.value === 'string' && hit.value.length > 0) {
        return { key: hit.value, source: 'credentials' }
      }
    } catch (error) { /* fall through to failure */ }
  }
  return undefined
}

/** The settings projection sent to the browser — never contains the key. */
function settingsProjection() {
  const settings = readSettings()
  return {
    floatingWindow: settings.floatingWindow,
    apiKeySet: settings.apiKey.length > 0,
    apiKeyPreview: maskKey(settings.apiKey),
  }
}

function hostOf(value) {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(String(value))
  if (match === null) return ''
  return match[1].split(':')[0].toLowerCase()
}

/**
 * Pick the balance endpoint + parser for the configured base URL. Every
 * returned object must contain ONLY lossless JSON values (no undefined
 * properties, no Date/class instances) — it crosses the RPC boundary.
 */
function providerPlan(baseURL) {
  const host = hostOf(baseURL)
  if (/deepseek\.com$/i.test(host)) {
    return {
      name: 'DeepSeek',
      path: '/user/balance',
      parse: (payload) => {
        const infos = (payload !== null && payload !== undefined && Array.isArray(payload.balance_infos)) ? payload.balance_infos : []
        const first = infos[0]
        if (first === undefined || payload.is_available !== true) return { ok: false, error: 'DeepSeek 余额不可用' }
        const out = {
          ok: true,
          provider: 'DeepSeek',
          currency: typeof first.currency === 'string' ? first.currency : '',
          balances: [
            { label: '总余额', value: first.total_balance },
            { label: '充值余额', value: first.topped_up_balance },
            { label: '赠送余额', value: first.granted_balance },
          ].filter((item) => item.value !== undefined),
        }
        if (infos.length > 1) out.note = '多币种账户，仅显示第一币种'
        return out
      },
    }
  }
  if (/siliconflow\.cn$/i.test(host)) {
    return {
      name: '硅基流动',
      path: '/v1/user/info',
      parse: (payload) => {
        const data = payload !== null && payload !== undefined ? payload.data : undefined
        if (data === undefined || data === null) return { ok: false, error: '硅基流动返回异常' }
        const value = data.totalBalance !== undefined ? data.totalBalance : data.balance
        return { ok: true, provider: '硅基流动', currency: 'CNY', balances: [{ label: '余额', value }] }
      },
    }
  }
  if (/moonshot\.(cn|ai)$/i.test(host)) {
    return {
      name: 'Moonshot',
      path: '/v1/users/me/balance',
      parse: (payload) => {
        const data = payload !== null && payload !== undefined ? payload.data : undefined
        if (data === undefined || data === null) return { ok: false, error: 'Moonshot 返回异常' }
        return {
          ok: true,
          provider: 'Moonshot',
          currency: 'CNY',
          balances: [
            { label: '可用余额', value: data.available_balance },
            { label: '现金余额', value: data.cash_balance },
            { label: '赠送余额', value: data.voucher_balance },
          ].filter((item) => item.value !== undefined),
        }
      },
    }
  }
  if (/openrouter\.ai$/i.test(host)) {
    return {
      name: 'OpenRouter',
      path: '/api/v1/credits',
      parse: (payload) => {
        const data = payload !== null && payload !== undefined ? payload.data : undefined
        if (data === undefined || data === null) return { ok: false, error: 'OpenRouter 返回异常' }
        return {
          ok: true,
          provider: 'OpenRouter',
          currency: 'USD',
          balances: [
            { label: '总额度', value: data.total_credits },
            { label: '已使用', value: data.total_usage },
          ].filter((item) => item.value !== undefined),
        }
      },
    }
  }
  return undefined
}

/**
 * Loopback literal check plus browser same-origin markers — the pairing
 * routes' fence. These endpoints read credentials and control UI state, so
 * LAN-exposed dsh web deployments must not serve them.
 */
function isLoopbackRequest(request) {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL('http://' + host)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** One JSON response. */
function writeJson(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  response.end(payload)
}

/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = chunk
    size += buffer.length
    if (size > 64 * 1024) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Build the route family around one shared balance fetch (cache + inflight dedupe). */
function makeRoutes(services) {
  const settingsService = services.settingsService
  const credentialsService = services.credentialsService
  let cache = null
  let inflight = null

  async function fetchBalance(force) {
    const now = Date.now()
    if (!force && cache !== null && now - cache.at < CACHE_TTL_MS) return cache.data
    if (inflight !== null) return inflight
    inflight = (async () => {
      try {
        let refName = CREDENTIAL_FALLBACK
        let baseURL = DEFAULT_BASE_URL
        if (settingsService !== undefined) {
          try {
            const deepseek = settingsService.get('llm-deepseek')
            if (deepseek !== null && typeof deepseek === 'object') {
              if (typeof deepseek.apiKeyEnv === 'string' && deepseek.apiKeyEnv.length > 0) refName = deepseek.apiKeyEnv
              if (typeof deepseek.baseURL === 'string' && deepseek.baseURL.length > 0) baseURL = deepseek.baseURL
            }
          } catch (error) { /* keep defaults */ }
        }
        const plan = providerPlan(baseURL)
        if (plan === undefined) {
          const data = { ok: false, error: '暂不支持该接口的余额查询: ' + hostOf(baseURL) }
          cache = { at: now, data }
          return data
        }
        const resolved = await resolveKey(credentialsService, refName)
        if (resolved === undefined) {
          const data = { ok: false, error: '未找到 API key: ' + refName + '（在「设置 → 插件 → 模型余额悬浮窗」填写，或配置 ' + refName + ' 环境变量）' }
          cache = { at: now, data }
          return data
        }
        const key = resolved.key
        const url = baseURL.replace(/\/+$/, '') + plan.path
        const response = await fetch(url, {
          headers: { authorization: 'Bearer ' + key },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        if (!response.ok) {
          let detail = ''
          try {
            const parsed = await response.json()
            detail = (parsed !== null && parsed !== undefined && parsed.error !== undefined && parsed.error.message !== undefined) ? String(parsed.error.message) : ''
          } catch (error) { /* keep status-only */ }
          const data = { ok: false, error: '余额接口 HTTP ' + response.status + (detail.length > 0 ? ': ' + detail.slice(0, 160) : '') }
          cache = { at: now, data }
          return data
        }
        const payload = await response.json()
        const data = plan.parse(payload)
        data.updatedAt = new Date().toISOString()
        cache = { at: Date.now(), data }
        return data
      } catch (error) {
        const data = { ok: false, error: (error !== null && error !== undefined && error.message) ? error.message : String(error) }
        cache = { at: Date.now(), data }
        return data
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  return [
    {
      kind: 'exact',
      path: '/api/dsh-balance/settings',
      handler: async (request, response) => {
        if (!isLoopbackRequest(request)) {
          writeJson(response, 403, { error: 'untrusted origin' })
          return
        }
        if (request.method === 'GET') {
          const projection = settingsProjection()
          const resolved = await resolveKey(credentialsService, 'DEEPSEEK_API_KEY')
          projection.keySource = resolved === undefined ? 'none' : resolved.source
          writeJson(response, 200, projection)
          return
        }
        if (request.method === 'PUT') {
          const body = await readJsonBody(request)
          if (body === undefined) {
            writeJson(response, 400, { error: 'invalid JSON body' })
            return
          }
          const current = readSettings()
          let apiKey = current.apiKey
          if (body.apiKey !== undefined) {
            if (typeof body.apiKey !== 'string' || body.apiKey.length > 200) {
              writeJson(response, 400, { error: 'invalid apiKey' })
              return
            }
            apiKey = body.apiKey.trim()
          }
          const next = {
            floatingWindow: body.floatingWindow !== undefined ? body.floatingWindow === true : current.floatingWindow,
            apiKey,
          }
          writeSettings(next)
          const projection = settingsProjection()
          const resolved = await resolveKey(credentialsService, 'DEEPSEEK_API_KEY')
          projection.keySource = resolved === undefined ? 'none' : resolved.source
          writeJson(response, 200, projection)
          return
        }
        response.writeHead(405, { allow: 'GET, PUT' })
        response.end()
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-balance/value',
      handler: async (request, response) => {
        if (!isLoopbackRequest(request)) {
          writeJson(response, 403, { error: 'untrusted origin' })
          return
        }
        if (request.method !== 'GET') {
          response.writeHead(405, { allow: 'GET' })
          response.end()
          return
        }
        let force = false
        try {
          const query = new URL(request.url ?? '/', 'http://localhost').searchParams
          force = query.get('force') === '1'
        } catch (error) { /* keep non-forced */ }
        const data = await fetchBalance(force)
        writeJson(response, 200, data)
      },
    },
  ]
}

/**
 * Mount the settings store routes, the balance fetch, and the announcement.
 * @param {object} ctx - host plugin context carrying webServer/systemPrompt.
 */
export function apply(ctx) {
  const services = {
    settingsService: ctx.get('settings'),
    credentialsService: ctx.get('credentials'),
  }

  ctx.effect(() => {
    const routes = makeRoutes(services)
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-balance: routes')

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'plugin:dsh-balance',
    order: 152,
    text: BALANCE_GUIDANCE,
  }), 'dsh-balance: announcement')
}
