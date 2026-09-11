// 小鲸鱼桌面挂件 —— Electron 主进程
// 思路：不重写插件前后端。
//   - 后端：shim 一个 DSH 插件 ctx（webServer/credentials），直接 import 原插件 lib/index.js，
//     它注册的全部 /dsh-whale/* 路由（余额/尺寸/音效/图片/记账/widget.js）原样生效。
//   - 前端：插件自己的 widget.js 路由把 WIDGET_JS 原样吐出，页面只是透明 HTML + 一行 script。
//   - 桌面化：全屏(工作区)透明置顶窗口 + 点击穿透（preload.cjs 按命中区域动态开关）。
import { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell } from 'electron'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = __dirname
const IS_PACKAGED = app.isPackaged
// 插件已打进包内（vendor/）：安装版资源和运行数据分离
const PLUGIN_DIR = path.join(APP_DIR, 'vendor', 'dsh-whale-widget')
// 运行时根目录：打包后安装目录只读 → 数据/配置/记忆全落 %APPDATA%\whale-desktop；
// 开发模式沿用项目内目录（config.json / data / userdata）
const RUNTIME_DIR = IS_PACKAGED ? path.join(app.getPath('appData'), 'whale-desktop') : APP_DIR
const DATA_DIR = path.join(RUNTIME_DIR, 'data')          // DSH_HOME：size/账本文件落这里
const CONFIG_FILE = path.join(RUNTIME_DIR, 'config.json') // DEEPSEEK_API_KEY 等
const USERDATA_DIR = RUNTIME_DIR // 安装版 localStorage 同落 %APPDATA%；开发版同项目目录

function getAutostart() {
  try {
    return !!JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).autostart
  } catch (err) {
    return false
  }
}

// 单实例：避免双击启动出两头鲸
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  main()
}

function main() {
  app.on('second-instance', () => {})
  app.on('before-quit', stopAudioMonitor)
  app.setPath('userData', USERDATA_DIR) // 必须在 ready 前设置

  app.setAppUserModelId('com.whale.desktop') // setLoginItemSettings 前置要求
  app.whenReady().then(() => boot())
  app.on('window-all-closed', () => {}) // 托盘退出才真正退出
}

// —— 配置：首次运行生成模板，用户填 DEEPSEEK_API_KEY ——
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  } catch (err) {
    const tpl = { DEEPSEEK_API_KEY: '', DEEPSEEK_PLATFORM_TOKEN: '', autostart: false }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(tpl, null, 2), 'utf8')
    return tpl
  }
}
const appConfig = loadConfig() // 启动时生成模板（实际读取走 credentials.resolve 热加载）

// —— 开机自启（写入 HKCU Run，electron.exe + 应用目录）——
function setAutostart(v) {
  try {
    const cfg = loadConfig()
    cfg.autostart = !!v
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8')
  } catch (err) {}
  app.setLoginItemSettings({ openAtLogin: !!v, path: process.execPath, args: [APP_DIR] })
}

// —— shim DSH ctx，让原插件 apply() 直接跑起来 ——
const routes = []
const cleanupFns = []
const ctx = {
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
    tapIndex() {
      return () => {} // 注入 script 由我们自己的页面负责
    },
  },
  credentials: {
    // 每次都重新读文件：改 config.json 后点一下鲸鱼即可生效，无需重启
    async resolve(name) {
      const cfg = loadConfig()
      const v = (cfg && cfg[name]) || process.env[name]
      return v ? { value: String(v) } : null
    },
  },
  on() {
    return () => {} // 会话事件（DSH 专属），桌面版无会话 → 空监听
  },
  effect(fn) {
    cleanupFns.push(fn)
  },
}

// 插件路径是 DSH_HOME 感知的：size/账本文件写入我们自己的 DATA_DIR
process.env.DSH_HOME = DATA_DIR
fs.mkdirSync(DATA_DIR, { recursive: true })

let win = null
let tray = null
let server = null
let setupWin = null
let serverPort = 0
let audioMonitor = null
let audioActive = false
let lastAudioPeakAt = 0
let selfAudioUntil = 0 // 鲸鱼自发音效（点击鸭子声/彩蛋语音）期间暂停音乐检测，避免听成音乐

async function boot() {
  // import 原插件（ESM），跑 apply(ctx) 完成全部路由注册
  const pluginUrl = pathToFileURL(path.join(PLUGIN_DIR, 'lib', 'index.js')).href
  const plugin = await import(pluginUrl)
  plugin.apply(ctx)

  server = http.createServer(handleRequest)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  serverPort = server.address().port

  const { workArea } = screen.getPrimaryDisplay()

  win = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    show: false,
    transparent: true, // 窗口透明 → 页面透明处直接露出桌面
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: false, // 本地可信内容，preload 与页面同上下文，方便命中检测
      nodeIntegration: false,
      sandbox: false,
    },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true }) // 默认全穿透
  win.setMenuBarVisibility(false)

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools()
    }
  })

  // 截图自检模式：WHALE_SCREENSHOT=<路径> 时启动几秒后抓一张页面图
  const shotPath = process.env.WHALE_SCREENSHOT
  if (shotPath) {
    win.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage()
          fs.writeFileSync(shotPath, img.toPNG())
          console.log('[whale] screenshot saved:', shotPath)
        } catch (err) {
          console.error('[whale] screenshot failed:', err)
        }
      }, 5000)
    })
  }

  // 页面重载后补发当前音频状态（audioActive 未翻转时不会再有新事件）
  win.webContents.on('did-finish-load', () => {
    if (audioActive && win && !win.isDestroyed()) {
      win.webContents.send('audio-state', { playing: true, peak: 0 })
    }
  })

  await win.loadURL(`http://127.0.0.1:${serverPort}/`)
  win.showInactive() // 不抢当前窗口焦点

  makeTray()
  startAudioMonitor()
  // 首启引导：没配 key 时弹配置窗（填完自动刷新余额）
  if (!loadConfig().DEEPSEEK_API_KEY) openSetupWindow()
  console.log(`[whale] running at http://127.0.0.1:${serverPort} (routes: ${routes.length})`)

  // 兜底光标轮询：preload 事件链万一失效（load 竞态、Windows forward 钩子失活等），页面仍能拿到光标位置判定穿透。
  // 注意：screen.getCursorScreenPoint() 返回 DIP（物理像素 ÷ 缩放），页面 CSS px == DIP ÷ zoomFactor，
  // 所以这里直接换算成窗口内 CSS 坐标，preload 侧无需再做任何缩放（150% 缩放下旧实现再除 dpr 会算错）。
  setInterval(() => {
    if (!win || win.isDestroyed()) return
    const p = screen.getCursorScreenPoint()
    const b = win.getBounds()
    let zf = 1
    try { zf = win.webContents.getZoomFactor() || 1 } catch (err) {}
    win.webContents.send('cursor-pos', {
      x: Math.round((p.x - b.x) / zf),
      y: Math.round((p.y - b.y) / zf),
    })
  }, 200)
}

function startAudioMonitor() {
  if (process.platform !== 'win32') return
  const monitorPath = path.join(APP_DIR, 'audio-monitor.ps1')
  if (!fs.existsSync(monitorPath)) {
    console.warn('[whale-audio] monitor script not found:', monitorPath)
    return
  }
  audioMonitor = spawn('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', monitorPath,
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let pending = ''
  audioMonitor.stdout.setEncoding('utf8')
  audioMonitor.stdout.on('data', (chunk) => {
    pending += chunk
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() || ''
    for (const line of lines) {
      if (Date.now() < selfAudioUntil) continue // 自发音效期间冻结检测状态
      try {
        const data = JSON.parse(line)
        const peak = Number(data.peak) || 0
        if (peak >= 0.012) lastAudioPeakAt = Date.now()
        const playing = peak >= 0.012 || (audioActive && Date.now() - lastAudioPeakAt < 900)
        if (playing !== audioActive) {
          audioActive = playing
          if (win && !win.isDestroyed()) win.webContents.send('audio-state', { playing, peak })
        }
      } catch (err) {}
    }
  })
  audioMonitor.stderr.on('data', (chunk) => {
    const message = String(chunk).trim()
    if (message) console.warn('[whale-audio]', message)
  })
  audioMonitor.on('error', (err) => console.warn('[whale-audio] monitor failed:', err.message))
  audioMonitor.on('exit', (code) => {
    audioMonitor = null
    if (audioActive) {
      audioActive = false
      if (win && !win.isDestroyed()) win.webContents.send('audio-state', { playing: false, peak: 0 })
    }
    if (code !== 0) console.warn('[whale-audio] monitor exited:', code)
  })
}

function stopAudioMonitor() {
  if (audioMonitor && !audioMonitor.killed) audioMonitor.kill()
  audioMonitor = null
}

// —— 请求分发：把请求按 pathname 精确匹配给插件注册的路由 ——
function handleRequest(req, res) {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname
  if (pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(INDEX_HTML)
    return
  }
  if (pathname === '/setup') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(SETUP_HTML)
    return
  }
  if (pathname === '/dsh-whale/image-headphones.png') {
    return serveAsset(path.join(PLUGIN_DIR, 'assets', 'DSniang1-headphones.png'), 'image/png', res)
  }
  if (pathname === '/dsh-whale/image-tsun.png') {
    return serveAsset(path.join(PLUGIN_DIR, 'assets', 'DSniang1-tsun.png'), 'image/png', res)
  }
  if (pathname === '/dsh-whale/tsun.mp3') {
    return serveAsset(path.join(PLUGIN_DIR, 'assets', 'tsun.mp3'), 'audio/mpeg', res)
  }
  if (pathname === '/dsh-whale/image-eat.png') {
    return serveAsset(path.join(PLUGIN_DIR, 'assets', 'DSniang1-eat.png'), 'image/png', res)
  }
  if (pathname === '/dsh-whale/eat.mp3') {
    return serveAsset(path.join(PLUGIN_DIR, 'assets', 'eat.mp3'), 'audio/mpeg', res)
  }
  const route = routes.find((r) => r.kind === 'exact' && r.path === pathname)
  if (route) {
    try {
      route.handler(req, res)
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('route error: ' + String((err && err.message) || err))
    }
    return
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('not found')
}

function serveAsset(filePath, contentType, res) {
  try {
    const body = fs.readFileSync(filePath)
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' })
    res.end(body)
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('asset unavailable')
  }
}

// —— 桌面页面：透明背景，只引插件自己的 widget.js（前端零改写） ——
const INDEX_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>whale</title>
<style>
  html, body {
    margin: 0; padding: 0;
    background: transparent !important; /* 抠掉背景：页面全透明，只留鲸鱼 */
    overflow: hidden;
  }
</style>
</head>
<body>
<script defer src="/dsh-whale/widget.js"></script>
</body>
</html>
`

// —— 首次配置窗：普通窗口（进任务栏），静态本地页，独立于透明鲸鱼窗口 ——
const SETUP_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>小鲸鱼挂件 · 首次配置</title>
<style>
  body { font-family: "Microsoft YaHei", sans-serif; background:#f5f6f8; margin:0; padding:26px 32px; color:#1f2329; }
  h2 { margin:0 0 6px; font-size:18px; }
  .sub { color:#646a73; font-size:12px; margin-bottom:16px; line-height:1.6; }
  label { font-size:13px; font-weight:600; display:block; margin-bottom:6px; }
  input { width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid #c9cdd4; border-radius:6px; font-size:13px; background:#fff; }
  input:focus { outline:none; border-color:#4d6bfe; }
  .hint { font-size:11px; color:#8f959e; margin-top:5px; }
  .err { color:#d83931; font-size:12px; min-height:16px; margin-top:4px; }
  .row { margin-top:12px; }
  .btn { margin-top:16px; padding:9px 0; width:100%; border:none; border-radius:6px; background:#4d6bfe; color:#fff; font-size:14px; cursor:pointer; }
  .btn:hover { background:#3f5cf0; }
  a { color:#4d6bfe; text-decoration:none; }
  .later { margin-top:10px; text-align:center; font-size:12px; }
</style>
</head>
<body>
<h2>欢迎使用小鲸鱼挂件 🐳</h2>
<div class="sub">小鲸鱼需要你的 DeepSeek API Key 才能显示余额。<br>Key 只写入本机配置文件，不会上传到任何地方。</div>
<label for="key">DeepSeek API Key</label>
<input id="key" type="text" placeholder="sk-..." spellcheck="false">
<div class="hint">没有 Key？去 <a id="getkey" href="#">platform.deepseek.com → API Keys</a> 免费创建</div>
<div class="err" id="err"></div>
<div class="row">
  <label for="token">DeepSeek Platform Token（可选）</label>
  <input id="token" type="text" placeholder="留空即可（默认「记账」用量模式）">
  <div class="hint">填了之后余额下方的「今日已用」改按「实时·令牌」模式统计</div>
</div>
<button class="btn" id="save">保存并开始使用</button>
<div class="later"><a href="#" id="later">稍后再说（之后右键托盘鲸鱼 → 配置 API Key）</a></div>
<script>
  const { ipcRenderer, shell } = require('electron')
  document.getElementById('getkey').onclick = (e) => { e.preventDefault(); shell.openExternal('https://platform.deepseek.com/api_keys') }
  document.getElementById('save').onclick = () => {
    const key = document.getElementById('key').value.trim()
    if (!key) { document.getElementById('err').textContent = '请先粘贴你的 API Key（sk- 开头）'; return }
    ipcRenderer.send('save-key', { key, token: document.getElementById('token').value.trim() })
  }
  document.getElementById('later').onclick = (e) => { e.preventDefault(); ipcRenderer.send('setup-cancel') }
  document.getElementById('key').focus()
</script>
</body>
</html>
`

function openSetupWindow() {
  if (setupWin && !setupWin.isDestroyed()) { setupWin.show(); setupWin.focus(); return }
  setupWin = new BrowserWindow({
    width: 460,
    height: 470,
    resizable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    title: '小鲸鱼挂件 · 首次配置',
    // 静态本地页 + 需要 ipcRenderer，此窗口单独开 nodeIntegration（鲸鱼窗口不受影响）
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false },
  })
  setupWin.on('closed', () => { setupWin = null })
  setupWin.loadURL(`http://127.0.0.1:${serverPort}/setup`)

  // 自检：WHALE_SETUP_SCREENSHOT=<路径> 时抓一张配置窗截图
  const shotPath = process.env.WHALE_SETUP_SCREENSHOT
  if (shotPath) {
    setupWin.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const img = await setupWin.webContents.capturePage()
          fs.writeFileSync(shotPath, img.toPNG())
          console.log('[whale] setup screenshot saved:', shotPath)
        } catch (err) {
          console.error('[whale] setup screenshot failed:', err)
        }
      }, 1500)
    })
  }
  console.log('[whale] setup window opened')
}

// —— 配置窗交互：保存写入 config.json，鲸鱼窗口刷新立即生效 ——
ipcMain.on('self-audio', (event, ms) => {
  // 鲸鱼自发音效开播：冻结检测指定时长（鸭子点击声 ~3s，彩蛋语音 ~4s）
  selfAudioUntil = Math.max(selfAudioUntil, Date.now() + (Number(ms) || 4000))
})
ipcMain.on('save-key', (event, { key, token }) => {
  try {
    const cfg = loadConfig()
    cfg.DEEPSEEK_API_KEY = key
    if (token) cfg.DEEPSEEK_PLATFORM_TOKEN = token
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8')
    if (setupWin && !setupWin.isDestroyed()) setupWin.close()
    if (win && !win.isDestroyed()) win.webContents.reload() // 余额立即刷新
    console.log('[whale] key saved (len=' + key.length + ')')
  } catch (err) {
    console.error('[whale] save key failed:', err)
  }
})
ipcMain.on('setup-cancel', () => {
  if (setupWin && !setupWin.isDestroyed()) setupWin.close()
})

// —— 穿透开关（ipc 由 preload 触发）——
ipcMain.on('set-ignore', (event, v) => {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!!v, { forward: true })
})

// —— 托盘：退出 + 穿透开关 ——
function makeTray() {
  let icon = null
  try {
    icon = nativeImage
      .createFromPath(path.join(PLUGIN_DIR, 'assets', 'DSniang1.png'))
      .resize({ width: 16, height: 16 })
  } catch (err) {}
  tray = new Tray(icon || nativeImage.createEmpty())

  const rebuild = () => {
    const menu = Menu.buildFromTemplate([
      { label: '穿透模式（透明处点击直达桌面）', type: 'checkbox', checked: passThrough, click: (item) => { passThrough = item.checked; win.setIgnoreMouseEvents(passThrough, { forward: true }) } },
      { label: '开机自启', type: 'checkbox', checked: getAutostart(), click: (item) => setAutostart(item.checked) },
      { label: '刷新余额', click: () => win.webContents.reload() },
      { label: '配置 API Key…', click: () => openSetupWindow() },
      { label: '打开配置文件', click: () => shell.openPath(CONFIG_FILE) },
      { type: 'separator' },
      { label: '退出', click: () => { cleanupFns.forEach((fn) => { try { fn() } catch (err) {} }); stopAudioMonitor(); app.quit() } },
    ])
    tray.setContextMenu(menu)
    tray.setToolTip('DeepSeek 小鲸鱼')
  }
  let passThrough = true
  rebuild()
}
