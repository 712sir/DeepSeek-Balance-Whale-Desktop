# 小鲸鱼桌面挂件（whale-desktop）

DeepSeek 余额小鲸鱼（[DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)）的桌面版：

> 📖 完整移植过程、方案选型与踩坑记录见 [移植教程.md](移植教程.md)（面向「教别人做同类移植」的教学文档）
透明置顶悬浮在屏幕右下角，**只有鲸鱼本体和它弹出的菜单/气泡能收到鼠标，其余全部穿透直达桌面**。

## 效果预览

![小鲸鱼效果图](screenshots/效果图.png)

## 一键安装（给别人用）

> 📥 下载最新安装包：[GitHub Releases](https://github.com/712sir/DeepSeek-Balance-Whale-Desktop/releases/latest)

把 `dist\DeepSeekWhale Setup 1.2.2.exe` 发给对方，双击 → 安装完成自动弹出鲸鱼，无需 Node/Electron 环境。

1. **双击安装包**：标准安装向导——可选安装路径（默认 `%LOCALAPPDATA%\Programs\DeepSeekWhale\`）、
   勾选桌面快捷方式、勾选**开机自启**（默认开，装完可随时在托盘菜单改），装完自动启动
2. **首次启动弹窗填 Key**：装完第一次运行会自动弹出「首次配置」小窗口，粘贴对方的
   DeepSeek API Key → 「保存并开始使用」，余额立即显示（Key 只写本机，不上传）
   ——以后想换 Key：右键托盘鲸鱼 → 「配置 API Key…」重新弹窗
3. **退出**：右键托盘鲸鱼图标 → 「退出」（挂件不走任务栏，只能从托盘退）

> ⚠️ 安装包未签名（个人项目），首次运行若 Windows SmartScreen 弹「未知发布者」，
> 点「更多信息 → 仍要运行」即可。正式分发可配代码签名证书消除该提示。
> 静默安装（运维批量部署）：`DeepSeekWhale Setup 1.2.2.exe /S`（自定义目录加 `/D=路径`；静默模式不动开机自启）

## 原理（前端零改写）

```
Electron 透明窗口（铺满主屏工作区、置顶、不进任务栏）
  └─ 页面：透明 HTML + 一行 <script src="/dsh-whale/widget.js">
        └─ widget.js = 原插件 lib/index.js 里的 WIDGET_JS，原样吐出，未改一行
  └─ 后端：shim 一个 DSH 插件 ctx（webServer/credentials）
        └─ 直接 import 原插件 lib/index.js 跑 apply(ctx)
            原插件的 8 个路由（余额/尺寸/音效/图片/记账/last-turn）全部原样生效
```

- **抠背景**：鲸鱼 PNG 本身是 cut-out；页面 html/body 全透明 + 窗口 transparent → 桌面只露出鲸鱼
- **点击穿透**：窗口默认 `setIgnoreMouseEvents(true, {forward:true})`；`preload.cjs` 实时判定光标
  是否落在「鲸鱼像素（alpha 级）/ 菜单按钮 / 打开的菜单 / 打开的气泡」上，命中才拦截鼠标，
  其余区域点击直达桌面。命中检测与原插件 `isWhaleHit` 同一套 610×610 alpha 映射（含左右镜像）
- **拖动吸附**：原插件的拖拽/四边吸附逻辑照常工作——窗口等于整个工作区，鲸鱼可拖到桌面任意位置

## 使用

```powershell
cd D:\study\whale-desktop
npm start
```

### 配置 DeepSeek API Key（显示余额必需）

编辑 `D:\study\whale-desktop\config.json`：

```json
{
  "DEEPSEEK_API_KEY": "sk-你的key",
  "DEEPSEEK_PLATFORM_TOKEN": ""
}
```

改完**点一下鲸鱼**立即生效（无需重启）。`DEEPSEEK_PLATFORM_TOKEN` 可选（「实时·令牌」用量模式用）。
没有 key 时鲸鱼照常出现，点它会提示「未配置 DEEPSEEK_API_KEY」。

> 安装版用户的配置文件在 `%APPDATA%\whale-desktop\config.json`（托盘「打开配置文件」直达）。

### 托盘

右下角托盘鲸鱼图标：穿透开关 / 开机自启 / 刷新余额 / 配置 API Key… / 打开配置文件 / 退出。
「开机自启」写入注册表 Run 键（electron.exe + 应用目录），随系统登录自动出现。

### 音乐状态

Windows 版会监听默认播放设备的音量峰值；检测到音乐播放时，鲸鱼会自动换成耳机形象，
身体轻轻上下摆动，并在气泡里一直显示 `♪ 哼哼~`。系统只读取音量峰值，不读取、不上传音频内容。

- 播放期间：哼唱气泡常驻；点击鲸鱼（或气泡）会弹出余额，约 5 秒后自动回到哼唱。
- 停止播放：约 1 秒后鲸鱼恢复普通形态，气泡回到「点击才显示」的默认行为。

### 傲娇彩蛋 🥚

在 **2.5 秒内连点鲸鱼 5 次**，触发傲娇彩蛋，持续 10 秒：

- 形象切换为傲娇图，气泡全程显示 `杂鱼~杂鱼~`，并播放语音片段。
- 彩蛋期间**优先级最高**：点击鲸鱼/气泡无反应、不弹余额、不弹消耗泡泡；
  音乐开/停不切换形象；余额变动只后台记账，不打扰演出。
- 10 秒后自动恢复原型；若音乐还在播放，会接回耳机形象和哼唱气泡。

> 傲娇图与语音素材位于 `vendor\dsh-whale-widget\assets\`（`DSniang1-tsun.png` / `tsun.mp3`），
> 想换素材直接替换同名文件即可。

### 数据文件

| 路径 | 内容 |
|------|------|
| `data\.dshw-size.json` | 大小/音效/菜单设置 |
| `data\.dshw-usage.json` | 小鲸鱼记账账本（余额差值累计，跨天归档） |
| `userdata\` | localStorage（鲸鱼位置记忆 `dshw-pos`） |
| `config.json` | API Key + 开机自启开关 |

> 安装版以上全部位于 `%APPDATA%\whale-desktop\`（安装目录只读，运行数据分离）。

## 打包发布（开发者）

```powershell
npm run build        # → dist\DeepSeekWhale Setup 1.2.2.exe（NSIS 一键安装包）
npm run start        # 开发模式运行（不打包）
```

- 安装包 = 发行版 Electron 运行时 + `vendor\dsh-whale-widget\`（原插件拷贝），前端后端零改写
- 构建依赖 `.npmrc` 里的 npmmirror 镜像（electron 二进制 + electron-builder 工具链，国内必配）
- 打包后运行数据与开发模式分离（`%APPDATA%\whale-desktop\` vs 项目目录），
  **单实例锁也互不相同 → 开发版和安装版可以同时各出一头鲸**，测试时二选一
- 原插件更新：`git pull` 上游仓库 → 重新拷贝到 `vendor\dsh-whale-widget\` → 重新 `npm run build`

## 与原插件的差异

- **每轮对话消耗**：依赖 DSH 会话事件流，桌面版无会话 → `last-turn.json` 恒返回空，
  此功能自然静默（其余全部功能：余额滚动、今日已用（记账/令牌两模式）、台词、音效、
  拖拽吸附、镜像翻转、Q弹、菜单、峰谷定价全部可用）
- **窗口=桌面**：原插件吸附在「浏览器窗口」边缘，这里吸附在「屏幕工作区」边缘
- **音乐状态（v1.2.0）**：桌面版特有——监听系统默认输出设备的音量峰值，
  放歌时换耳机形象 + 哼唱气泡（原插件听不到系统音乐）；自己的点击音效/彩蛋语音会先通知
  主进程冻结检测，不会把自己听成音乐
- **傲娇彩蛋（v1.2.1）**：桌面版特有——2.5 秒内连点 5 次触发，见「傲娇彩蛋」一节
- **升级**：原插件仓库 `D:\study\DeepSeek-Balance-Whale-Widget` git pull 后重启挂件即生效，
  桌面端零改动
- **点击/移动修复（v1.1.2）**：preload 监听器改为顶层立即挂载，不再依赖 window load；主进程增加光标轮询兜底，修复偶发全穿透导致的点击和拖动失效。
- **点击修复（v1.2.2）**：150% 缩放下光标轮询坐标换算错误（屏幕 DIP 再除以 dpr 导致错位），
  窗口永远保持全穿透 → 鲸鱼点不动。改为主进程直接换算窗口内 CSS 坐标，preload 原样使用；
  轮询 400ms → 200ms，Windows forward 鼠标转发钩子失活时兜底依然可靠。
- **本地补丁（v1.1.2）**：修复上游 issue #55 位置持久化 bug（重启后离边距离丢失、
  自由位被钉回贴角+镜像）——存储升 v:3 记自由轴、恢复时离边距离带进 hOff/vOff。
  当前尚未向上游提交 PR，待整理后再提交；合并后 vendor 重新对齐

## 排障

- **启动后只有黑窗口/报 `does not provide an export named 'BrowserWindow'`**：
  环境里有 `ELECTRON_RUN_AS_NODE=1`（会让 electron.exe 冒充纯 Node 运行）。
  start 脚本已防御性清掉它；若手动运行 electron，先 `set ELECTRON_RUN_AS_NODE=`
- **余额显示「未配置」**：config.json 里填 `DEEPSEEK_API_KEY` 后点一下鲸鱼
- **npm install 慢/失败**：本项目 `.npmrc` 已配 npmmirror 镜像（electron 二进制 + npm 包）
- **鲸鱼不见了**：重启后位置恢复靠 `userdata\` 里的 localStorage；清空该目录即回到默认右下角
