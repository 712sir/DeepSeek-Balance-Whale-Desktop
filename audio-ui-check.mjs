const port = process.env.CDP_PORT || '9230'
const pages = await (await fetch('http://127.0.0.1:' + port + '/json')).json()
const page = pages.find((item) => item.type === 'page')
if (!page) throw new Error('page target missing')
const socket = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  const resolve = pending.get(message.id)
  if (resolve) { pending.delete(message.id); resolve(message.result) }
}
await new Promise((resolve) => { socket.onopen = resolve })
function request(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++nextId
    pending.set(id, resolve)
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function inspect() {
  const result = await request('Runtime.evaluate', {
    expression: `(async () => {
      const widgetResponse = await fetch('/dsh-whale/widget.js', { cache: 'no-store' })
      const widgetText = await widgetResponse.text()
      return {
      ready: document.readyState,
      html: document.documentElement?.outerHTML?.slice(0, 500),
      scriptSrc: document.querySelector('script')?.src,
      widgetStatus: widgetResponse.status,
      widgetLength: widgetText.length,
      root: document.querySelector('.dshwv-root')?.className,
      image: document.querySelector('.dshwv-img')?.src,
      musicText: document.querySelector('.dshwv-music-bubble')?.textContent
      }
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  return result.result.value
}
if (process.env.TEST_LYRICS === '1') {
  await request('Runtime.evaluate', { expression: "window.dispatchEvent(new CustomEvent('whale-audio-state', { detail: { playing: false } })); setTimeout(() => window.dispatchEvent(new CustomEvent('whale-audio-state', { detail: { playing: true } })), 100);" })
  await new Promise((resolve) => setTimeout(resolve, 700))
}
console.log('before', JSON.stringify(await inspect()))
await new Promise((resolve) => setTimeout(resolve, 5000))
console.log('after', JSON.stringify(await inspect()))
process.exit(0)
