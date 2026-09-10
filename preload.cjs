// 小鲸鱼桌面挂件 —— 点击穿透控制（渲染进程侧）
// 原理：窗口默认 setIgnoreMouseEvents(true, {forward:true})，鼠标事件照样转发进页面；
// 这里实时判定光标是否落在「应该拦截」的区域（鲸鱼像素/打开的菜单/气泡/菜单按钮），
// 是 → 关穿透（事件归窗口），否 → 开穿透（点击直达桌面）。
// 命中检测逻辑与原插件自身的 isWhaleHit 保持同一套 610×610 alpha 映射（含左右镜像）。
//
// 健壮性（v1.1.2）：事件监听在脚本顶层立即挂载，不依赖 window load 事件——
// 个别实例中 load 晚于 preload 执行甚至不触发时，旧实现会导致监听挂不上、
// 鲸鱼永远全穿透（点不动/拖不动）。另配合主进程 400ms 光标轮询（cursor-pos）兜底。
const { ipcRenderer } = require('electron')

let ignoring = true
let hitCanvas = null
let hitReady = false

function setIgnore(v) {
  if (v !== ignoring) {
    ignoring = v
    ipcRenderer.send('set-ignore', v)
  }
}

function pointInRect(px, py, r) {
  return r && r.width > 0 && r.height > 0 &&
    px >= r.left && px <= r.right && py >= r.top && py <= r.bottom
}

function ensureHitCanvas() {
  if (hitCanvas) return
  const c = document.createElement('canvas')
  c.width = 610
  c.height = 610
  const probe = new Image()
  probe.onload = () => {
    try {
      // 与插件 setupHitTest 一致：拉伸到 610×610，镜像时 x 反向
      c.getContext('2d').drawImage(probe, 0, 0, 610, 610)
      hitReady = true
      hitCanvas = c
    } catch (err) {}
  }
  probe.onerror = () => {}
  probe.src = '/dsh-whale/image.png?v=hit'
  hitCanvas = c // 占位防重入，onload 前 hitReady=false 走矩形兜底
}

function isInteractive(px, py) {
  if (typeof px !== 'number' || typeof py !== 'number' || !isFinite(px) || !isFinite(py)) return false
  ensureHitCanvas() // 惰性准备命中图（不依赖 load 事件）
  // 1) 打开的菜单（设置面板）
  const menu = document.querySelector('.dshwv-menu')
  if (menu && menu.classList.contains('dshwv-menu-open')) {
    if (pointInRect(px, py, menu.getBoundingClientRect())) return true
  }
  // 2) 菜单按钮（鲸鱼右上角 26×26，平时透明悬停才显示，但必须可悬停）
  const btn = document.querySelector('.dshwv-menu-btn')
  if (btn && pointInRect(px, py, btn.getBoundingClientRect())) return true
  // 3) 打开的气泡（余额/台词/消耗金额泡泡）
  const bub = document.querySelector('.dshwv-bubble')
  if (bub && bub.classList.contains('dshwv-bubble-open')) {
    if (pointInRect(px, py, bub.getBoundingClientRect())) return true
  }
  // 4) 鲸鱼本体：alpha 像素级（透明像素不拦截，直接点穿桌面）
  const img = document.querySelector('.dshwv-img')
  if (img) {
    const r = img.getBoundingClientRect()
    if (pointInRect(px, py, r)) {
      if (!hitReady) return true // 命中图未就绪时整矩形兜底，避免鲸鱼点不到
      let lx = ((px - r.left) / r.width) * 610
      let ly = ((py - r.top) / r.height) * 610
      if (lx < 0 || ly < 0 || lx >= 610 || ly >= 610) return false
      const root = document.querySelector('.dshwv-root')
      if (root && root.classList.contains('dshwv-left')) lx = 610 - lx
      try {
        const d = hitCanvas.getContext('2d').getImageData(Math.floor(lx), Math.floor(ly), 1, 1).data
        return d[3] > 10
      } catch (err) {
        return true
      }
    }
  }
  return false
}

function recheck(px, py) {
  if (typeof px !== 'number' || px < 0) {
    setIgnore(true)
    return
  }
  setIgnore(!isInteractive(px, py))
}

let lastX = -1
let lastY = -1

// —— 事件监听：顶层立即挂载，不依赖 load ——
window.addEventListener('mousemove', (e) => {
  lastX = e.clientX
  lastY = e.clientY
  recheck(lastX, lastY)
})

document.addEventListener('mouseleave', () => {
  lastX = -1
  lastY = -1
  setIgnore(true) // 光标离开窗口 → 恢复穿透
})

// —— 主进程光标轮询兜底（400ms，坐标有变化才判定；forward/事件链失效时仍可点）——
let lastPollX = -1
let lastPollY = -1
ipcRenderer.on('cursor-pos', (e, { x, y }) => {
  if (x === lastPollX && y === lastPollY) return
  lastPollX = x
  lastPollY = y
  recheck(Math.round(x / window.devicePixelRatio), Math.round(y / window.devicePixelRatio))
})

// —— DOM 观察器：气泡/菜单开合、镜像切换时，用光标当前位置重新判定 ——
function armObservers() {
  const mo = new MutationObserver(() => {
    if (lastX >= 0) recheck(lastX, lastY)
  })
  const targets = ['.dshwv-root', '.dshwv-menu', '.dshwv-bubble', '.dshwv-menu-btn']
  const watch = () => {
    for (const sel of targets) {
      const el = document.querySelector(sel)
      if (el) mo.observe(el, { attributes: true, attributeFilter: ['class'] })
    }
  }
  // 挂件 DOM 是页面脚本创建，稍后再挂观察器
  setTimeout(watch, 500)
  new MutationObserver(() => { if (lastX >= 0) recheck(lastX, lastY) })
    .observe(document.body, { childList: true })
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', armObservers)
} else {
  armObservers()
}

// 初始：默认穿透（等鼠标事件/轮询再开）
setIgnore(true)
