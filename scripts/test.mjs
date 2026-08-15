/**
 * Host-half smoke test: mounts the plugin against a fake ctx (fake settings /
 * credentials services, fake webServer), mocks the provider endpoint by
 * patching globalThis.fetch, and exercises the /api/dsh-balance route family.
 * Uses a temporary DSH_HOME so the real ~/.dsh/balance store is never touched.
 *
 * Run: node scripts/test.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

// Isolate the store BEFORE importing the plugin.
const tmpHome = mkdtempSync(join(tmpdir(), 'dsh-balance-test-'))
process.env.DSH_HOME = tmpHome

const mod = await import(new URL('../lib/index.js', import.meta.url))
const { apply } = mod

// ---------------------------------------------------------------- fakes
const fetchCalls = []
let nextFetch = null

globalThis.fetch = async (url, options) => {
  fetchCalls.push({ url, options })
  return nextFetch
}

const fakeSettings = {
  get: (ns) => (ns === 'llm-deepseek'
    ? { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: 'https://api.deepseek.com' }
    : undefined),
}
const fakeCredentials = {
  resolve: async (ref) => (ref === 'DEEPSEEK_API_KEY' ? { value: 'sk-test-key' } : undefined),
}

const routes = []
const fakeCtx = {
  get: (name) => (name === 'settings' ? fakeSettings : name === 'credentials' ? fakeCredentials : undefined),
  effect: (fn) => { fn(); return () => {} },
  webServer: { register: (route) => { routes.push(route); return () => {} } },
  systemPrompt: { section: () => () => {} },
}

apply(fakeCtx)

// ---------------------------------------------------------------- helpers
async function call(route, { method = 'GET', url, headers = {}, body = null } = {}) {
  const request = {
    method,
    url: url ?? route.path,
    headers: { host: '127.0.0.1:3080', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
    [Symbol.asyncIterator]: async function* () {
      if (body !== null) yield Buffer.from(body)
    },
  }
  let status = 0
  let payload = Buffer.alloc(0)
  const response = Object.assign(new EventEmitter(), {
    writeHead: (code) => { status = code },
    write: (chunk) => { payload = Buffer.concat([payload, Buffer.from(chunk)]) },
    destroy: () => {},
    end: (data) => {
      if (data !== undefined) payload = Buffer.from(data)
      response.emit('end')
    },
  })
  const done = new Promise((resolve) => response.once('end', resolve))
  await route.handler(request, response)
  await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 2000))])
  let json = null
  try { json = JSON.parse(payload.toString('utf8')) } catch { /* binary */ }
  return { status, json }
}

const settingsRoute = routes.find((r) => r.path === '/api/dsh-balance/settings')
const valueRoute = routes.find((r) => r.path === '/api/dsh-balance/value')

const results = []
function check(label, condition) {
  results.push({ label, ok: condition === true })
  console.log(`${condition === true ? 'PASS' : 'FAIL'}  ${label}`)
}

// 1. default settings
let r = await call(settingsRoute)
check('GET settings defaults to floatingWindow=true', r.status === 200 && r.json.floatingWindow === true)

// 2. toggle off, then on
r = await call(settingsRoute, { method: 'PUT', body: JSON.stringify({ floatingWindow: false }) })
check('PUT toggles floatingWindow off', r.status === 200 && r.json.floatingWindow === false)
r = await call(settingsRoute)
check('toggle persisted', r.json.floatingWindow === false)
r = await call(settingsRoute, { method: 'PUT', body: JSON.stringify({ floatingWindow: true }) })
check('PUT toggles floatingWindow back on', r.status === 200 && r.json.floatingWindow === true)

// 3. balance fetch with a mocked DeepSeek endpoint
nextFetch = { ok: true, status: 200, json: async () => ({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '75.43', granted_balance: '0.00', topped_up_balance: '75.43' }] }) }
r = await call(valueRoute)
check('GET value parses DeepSeek balance', r.status === 200 && r.json.ok === true && r.json.provider === 'DeepSeek' && r.json.currency === 'CNY' && r.json.balances[0].label === '总余额' && r.json.balances[0].value === '75.43')
check('bearer header carries resolved key', fetchCalls[0].options.headers.authorization === 'Bearer sk-test-key')

// 4. cached on repeat (no second fetch)
const callsBefore = fetchCalls.length
r = await call(valueRoute)
check('second GET served from cache', r.json.ok === true && fetchCalls.length === callsBefore)

// 5. force bypasses cache
r = await call(valueRoute, { url: '/api/dsh-balance/value?force=1' })
check('force=1 refetches', fetchCalls.length === callsBefore + 1)

// 6. provider auth failure surfaces as ok:false
nextFetch = { ok: false, status: 401, json: async () => ({ error: { message: 'Authentication Fails' } }) }
r = await call(valueRoute, { url: '/api/dsh-balance/value?force=1' })
check('HTTP 401 surfaces as ok:false with status', r.status === 200 && r.json.ok === false && String(r.json.error).includes('401'))

// 7. non-loopback origin rejected
{
  const request = {
    method: 'GET',
    url: settingsRoute.path,
    headers: { host: '192.168.1.5:3080', origin: 'http://192.168.1.5:3080' },
    socket: { remoteAddress: '192.168.1.5' },
    [Symbol.asyncIterator]: async function* () {},
  }
  let status = 0
  const response = { writeHead: (code) => { status = code }, end: () => {} }
  await settingsRoute.handler(request, response)
  check('non-loopback origin rejected', status === 403)
}

// cleanup
rmSync(tmpHome, { recursive: true, force: true })
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed > 0 ? 1 : 0)
