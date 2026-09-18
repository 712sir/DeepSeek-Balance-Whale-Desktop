import assert from 'node:assert/strict'

const port = process.env.CDP_PORT || '9230'
const pages = await (await fetch('http://127.0.0.1:' + port + '/json')).json()
const page = pages.find((item) => item.type === 'page' && !String(item.url || '').includes('/setup'))
if (!page) throw new Error('page target missing')
const socket = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  const waiter = pending.get(message.id)
  if (waiter) {
    pending.delete(message.id)
    if (message.error) waiter.reject(new Error(message.error.message || 'CDP request failed'))
    else waiter.resolve(message.result)
  }
}
await new Promise((resolve) => { socket.onopen = resolve })
function request(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const result = await request('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed')
  return result.result.value
}
async function inspect() {
  return evaluate(`(async () => {
    const widgetResponse = await fetch('/dsh-whale/widget.js', { cache: 'no-store' })
    const widgetText = await widgetResponse.text()
    const root = document.querySelector('.dshwv-root')
    const pop = document.querySelector('.dshwv-pop')
    const image = document.querySelector('.dshwv-img')
    return {
      ready: document.readyState,
      desktopMode: window.__dshWhaleDesktop === true,
      widgetStatus: widgetResponse.status,
      widgetLength: widgetText.length,
      root: root && root.className,
      image: image && image.src,
      popOpen: !!(pop && pop.classList.contains('dshwv-pop-open')),
      bubbleText: pop && pop.textContent,
      testState: window.__whaleTest || null
    }
  })()`)
}

const initial = await inspect()
assert.equal(initial.ready, 'complete')
assert.equal(initial.desktopMode, true)
assert.equal(initial.widgetStatus, 200)
assert.ok(initial.widgetLength > 100000)
assert.match(initial.root || '', /dshwv-root/)

await evaluate("window.dispatchEvent(new CustomEvent('whale-audio-state', { detail: { playing: true } }))")
await new Promise((resolve) => setTimeout(resolve, 700))
const music = await inspect()
assert.match(music.root || '', /dshwv-music/)
assert.match(music.image || '', /image-headphones\.png/)
assert.equal(music.popOpen, true)
assert.match(music.bubbleText || '', /哼哼/)

await evaluate(`(async () => {
  const pop = document.querySelector('.dshwv-pop')
  for (let i = 0; i < 5; i++) {
    pop.click()
    await new Promise((resolve) => setTimeout(resolve, 350))
  }
})()`)
const tsun = await inspect()
assert.match(tsun.root || '', /dshwv-tsun/)
assert.match(tsun.image || '', /image-tsun\.png/)
assert.match(tsun.bubbleText || '', /杂鱼/)

await request('Page.reload', { ignoreCache: true })
await new Promise((resolve) => setTimeout(resolve, 1800))
await evaluate(`(() => {
    const nativeFetch = window.fetch.bind(window)
    window.__whaleTest = { balanceReads: 0, balances: [] }
    window.fetch = function (input, init) {
      const url = String(input && input.url ? input.url : input)
      if (url.includes('/dsh-whale/balance.json')) {
        window.__whaleTest.balanceReads++
        const totalBalance = window.__whaleTest.balanceReads === 1 ? 10 : 9.4
        window.__whaleTest.balances.push(totalBalance)
        return Promise.resolve(new Response(JSON.stringify({
          ok: true, totalBalance, currency: 'CNY', todayUsage: 0.6,
          todayUsageCurrency: 'CNY', usageLabel: '已观测消费', isPeak: false
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      return nativeFetch(input, init)
    }
  })()`)
const beforeEat = await inspect()
const clickPoint = await evaluate(`(() => {
  const rect = document.querySelector('.dshwv-img').getBoundingClientRect()
  const x = rect.left + rect.width * 0.52
  const y = rect.top + rect.height * 0.62
  return { x, y }
})()`)
for (let i = 0; i < 2; i++) {
  await request('Input.dispatchMouseEvent', { type: 'mousePressed', x: clickPoint.x, y: clickPoint.y, button: 'left', clickCount: 1 })
  await request('Input.dispatchMouseEvent', { type: 'mouseReleased', x: clickPoint.x, y: clickPoint.y, button: 'left', clickCount: 1 })
  await new Promise((resolve) => setTimeout(resolve, 700))
}
await new Promise((resolve) => setTimeout(resolve, 1200))
const eat = await inspect()
assert.match(eat.root || '', /dshwv-eat/)
assert.match(eat.image || '', /image-eat\.png/)
assert.match(eat.bubbleText || '', /狂吃 token/)

console.log(JSON.stringify({ initial, music, tsun, beforeEat, eat }, null, 2))
socket.close()
