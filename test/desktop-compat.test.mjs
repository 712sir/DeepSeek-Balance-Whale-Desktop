import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const projectRoot = path.resolve(import.meta.dirname, '..')
const widgetRoot = path.join(projectRoot, 'vendor', 'dsh-whale-widget')

test('v0.3.1 package and desktop compatibility hooks are present', () => {
  const desktopPkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
  const pkg = JSON.parse(fs.readFileSync(path.join(widgetRoot, 'package.json'), 'utf8'))
  const main = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8')
  const preload = fs.readFileSync(path.join(projectRoot, 'preload.cjs'), 'utf8')
  const widget = fs.readFileSync(path.join(widgetRoot, 'assets', 'whale-widget.js'), 'utf8')

  assert.equal(desktopPkg.version, '1.4.0')
  assert.equal(pkg.version, '0.3.1')
  assert.ok(fs.existsSync(path.join(widgetRoot, 'lib', 'accounting.mjs')))
  assert.match(main, /pluginModule\.default \|\| pluginModule/)
  assert.match(main, /window\.__dshWhaleDesktop = true/)
  assert.match(preload, /\.dshwv-pop/)
  assert.match(preload, /whaleImg\.currentSrc \|\| whaleImg\.src/)
  for (const surface of ['dshwv-gifmask', 'dshwv-fontmenu', 'dshwv-rgbmenu', 'dshwv-slotlist']) {
    assert.ok(preload.includes(surface), 'missing click-through surface ' + surface)
  }
  assert.match(widget, /var dshwDesktopMode = window\.__dshWhaleDesktop === true/)
  assert.match(widget, /function triggerTsun\(\)/)
  assert.match(widget, /function triggerEat\(\)/)
  assert.match(widget, /function setAudioPlaying\(playing\)/)
})

test('legacy ledger migrates without losing historical totals', async () => {
  const accountingUrl = pathToFileURL(path.join(widgetRoot, 'lib', 'accounting.mjs')).href
  const { observeBalance, balanceSummary } = await import(accountingUrl)
  const ledger = {
    date: '2026-09-12',
    lastBalance: 7.82,
    todayUsage: 0.32,
    history: { '2026-09-11': 21.01 },
  }

  observeBalance(ledger, { at: Date.parse('2026-09-16T08:00:00+08:00'), balance: 10, currency: 'CNY', scope: 'desktop' })
  observeBalance(ledger, { at: Date.parse('2026-09-16T09:00:00+08:00'), balance: 9.25, currency: 'CNY', scope: 'desktop' })
  observeBalance(ledger, { at: Date.parse('2026-09-16T10:00:00+08:00'), balance: 12.25, currency: 'CNY', scope: 'desktop' })

  assert.deepEqual(ledger.accounting.legacyHistory, { '2026-09-11': 21.01 })
  const summary = balanceSummary(ledger, '2026-09-16')
  assert.equal(summary.observedDecrease, 0.75)
  assert.equal(summary.observedIncrease, 3)
  assert.equal(summary.needsReview, true)
})

test('plugin applies to the desktop shim and registers the v0.3.1 routes', async (t) => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-desktop-test-'))
  t.after(() => fs.rmSync(tempHome, { recursive: true, force: true }))
  const ledgerPath = path.join(tempHome, '.dshw-usage.json')
  fs.writeFileSync(ledgerPath, JSON.stringify({
    date: '2026-09-12', lastBalance: 7.82, todayUsage: 0.32,
    history: { '2026-09-11': 21.01 }, lastCurrency: 'CNY',
  }))
  const previousDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = tempHome
  t.after(() => {
    if (previousDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousDshHome
  })

  const previousFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).includes('api.deepseek.com/user/balance')) {
      return new Response(JSON.stringify({
        is_available: true,
        balance_infos: [{ currency: 'CNY', total_balance: '7.50' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    throw new Error('unexpected fetch: ' + url)
  }
  t.after(() => { globalThis.fetch = previousFetch })

  const routes = []
  const effects = []
  const connection = { requestRejection: () => false }
  const ctx = {
    webServer: {
      register(route) { routes.push(route); return () => {} },
      tapIndex() { return () => {} },
    },
    credentials: { async resolve(name) { return name === 'DEEPSEEK_API_KEY' ? { value: 'test-key' } : null } },
    connection,
    get(name) { return name === 'connection' ? connection : null },
    on() { return () => {} },
    effect(fn) { effects.push(fn) },
  }

  const pluginUrl = pathToFileURL(path.join(widgetRoot, 'lib', 'index.js')).href + '?test=' + Date.now()
  const module = await import(pluginUrl)
  const plugin = module.default || module
  plugin.apply(ctx)

  const paths = new Set(routes.map((route) => route.path))
  assert.ok(routes.length >= 20)
  for (const required of [
    '/dsh-whale/widget.js',
    '/dsh-whale/balance.json',
    '/dsh-whale/balance-adjustments.json',
    '/dsh-whale/api-models.json',
    '/dsh-whale/bubble.json',
    '/dsh-whale/audio.json',
  ]) assert.ok(paths.has(required), 'missing route ' + required)
  assert.ok(effects.length > 0)

  const balanceRoute = routes.find((route) => route.path === '/dsh-whale/balance.json')
  const response = {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(statusCode, headers = {}) { this.statusCode = statusCode; this.headers = headers },
    end(chunk = '') { this.body += String(chunk) },
  }
  await balanceRoute.handler({ url: '/dsh-whale/balance.json?refresh=1', headers: { host: '127.0.0.1:3000' } }, response)
  const payload = JSON.parse(response.body)
  assert.equal(response.statusCode, 200)
  assert.equal(payload.ok, true)
  assert.equal(payload.totalBalance, 7.5)
  assert.ok(fs.existsSync(ledgerPath + '.before-recharge-fix.bak'))
  const migrated = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
  assert.deepEqual(migrated.accounting.legacyHistory, { '2026-09-11': 21.01 })
})
