# 小鲸鱼桌面挂件（whale-desktop）

DeepSeek 余额小鲸鱼（[DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)）的桌面版：

> 📖 完整移植过程、方案选型与踩坑记录见 [移植教程.md](移植教程.md)（面向「教别人做同类移植」的教学文档）
透明置顶悬浮在屏幕右下角，**只有鲸鱼本体和它弹出的菜单/气泡能收到鼠标，其余全部穿透直达桌面**。

## 效果预览

![小鲸鱼效果图](screenshots/效果图.png)

## v1.4.0 更新

- 完整同步上游 `dsh-whale-widget v0.3.1`：充值/余额校正、8 位小数账本、模块化泡泡、
  自定义角色与音效、多厂商 API 和多窗口额度。
- 保留桌面版音乐形态、傲娇彩蛋、狂吃 token 彩蛋、DPI 点击修复与透明区域点击穿透。
- 新版 22 个路由接入桌面同源信任校验；旧账本首次成功写入时自动生成
  `.dshw-usage.json.before-recharge-fix.bak`。
- 移除已下线的 `DEEPSEEK_PLATFORM_TOKEN` 配置入口；已有配置文件中的旧字段不会被主动删除。

## 一键安装（给别人用）

> 📥 下载最新安装包：[GitHub Releases](https://github.com/712sir/DeepSeek-Balance-Whale-Desktop/releases/latest)

把 `dist\DeepSeekWhale Setup 1.4.0.exe` 发给对方，双击 → 安装完成自动弹出鲸鱼，无需 Node/Electron 环境。

1. **双击安装包**：标准安装向导——可选安装路径（默认 `%LOCALAPPDATA%\Programs\DeepSeekWhale\`）、
   勾选桌面快捷方式、勾选**开机自启**（默认开，装完可随时在托盘菜单改），装完自动启动
2. **首次启动弹窗填 Key**：装完第一次运行会自动弹出「首次配置」小窗口，粘贴对方的
   DeepSeek API Key → 「保存并开始使用」，余额立即显示（Key 只写本机，不上传）
   ——以后想换 Key：右键托盘鲸鱼 → 「配置 API Key…」重新弹窗
3. **退出**：右键托盘鲸鱼图标 → 「退出」（挂件不走任务栏，只能从托盘退）

> ⚠️ 安装包未签名（个人项目），首次运行若 Windows SmartScreen 弹「未知发布者」，
> 点「更多信息 → 仍要运行」即可。正式分发可配代码签名证书消除该提示。
> 静默安装（运维批量部署）：`DeepSeekWhale Setup 1.4.0.exe /S`（自定义目录加 `/D=路径`；静默模式不动开机自启）

## 原理（上游 v0.3.1 + 桌面兼容层）

```
Electron 透明窗口（铺满主屏工作区、置顶、不进任务栏）
  └─ 页面：透明 HTML + 一行 <script src="/dsh-whale/widget.js">
        └─ widget.js = 上游 assets/whale-widget.js + 桌面模式/彩蛋适配
  └─ 后端：shim 一个 DSH 插件 ctx（webServer/credentials）
        └─ 直接 import 上游 lib/index.js 跑 default.apply(ctx)
            22 个路由（余额/记账校正/API 模型/角色/音效/泡泡等）全部挂载
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
  "autostart": false
}
```

改完**点一下鲸鱼**立即生效（无需重启）。上游 v0.3.x 已统一使用小鲸鱼记账，不再需要
`DEEPSEEK_PLATFORM_TOKEN`。
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

### 吃 token 彩蛋 🪙

余额**快速下降**时触发：约一个轮询周期（60s）内单次下降 **≥ ¥0.5**（折合消耗速度 ≳ ¥30/小时），
判定「狂吃 token」：

- 形象切换为「狂吃 token」图，气泡全程显示 `啊呜~狂吃 token 中~`，播放投币音效。
- 彩蛋期间**优先级最高**：点击鲸鱼/气泡无反应、不弹余额、不弹消耗泡泡；
  音乐开/停不切换形象；余额变动只后台记账，不打扰演出。
- 10 秒后自动恢复原型；若音乐还在播放，会接回耳机形象和哼唱气泡。
- 与傲娇彩蛋互斥：任一彩蛋演出期间，另一个不会触发。

> 触发阈值与时长是 `vendor\dsh-whale-widget\assets\whale-widget.js` 顶部的 `EAT_THRESHOLD`（默认 0.5）/ `EAT_MS`（默认 10000），
> 想更灵敏就调低阈值。素材位于 `vendor\dsh-whale-widget\assets\`（`DSniang1-eat.png` / `eat.mp3`），
> 换素材直接替换同名文件即可。

### 数据文件

| 路径 | 内容 |
|------|------|
| `data\.dshw-size.json` | 大小/音效/菜单设置 |
| `data\.dshw-usage.json` | 新版小鲸鱼账本（余额下降/充值分开观测，8 位小数） |
| `data\.dshw-usage.json.before-recharge-fix.bak` | 首次迁移旧账本时自动生成的只写一次备份 |
| `data\.dshw-api.json` | 自定义 API 模型与额度配置（不保存密钥原文） |
| `data\.dshw-bubble.json` | 模块化泡泡配置 |
| `data\whale-roles\` / `data\whale-audio\` | 自定义角色与音效资源 |
| `userdata\` | localStorage（鲸鱼位置记忆 `dshw-pos`） |
| `config.json` | API Key + 开机自启开关 |

> 安装版以上全部位于 `%APPDATA%\whale-desktop\`（安装目录只读，运行数据分离）。

## 打包发布（开发者）

```powershell
npm run build        # → dist\DeepSeekWhale Setup 1.4.0.exe（NSIS 一键安装包）
npm test             # 静态兼容、账本迁移与路由集成测试
npm run start        # 开发模式运行（不打包）
```

- 安装包 = 发行版 Electron 运行时 + `vendor\dsh-whale-widget\`（上游 v0.3.1 完整发布包）；
  `main.js` / `preload.cjs` / `assets/whale-widget.js` 含桌面兼容层与桌面版特有素材
- 构建依赖 `.npmrc` 里的 npmmirror 镜像（electron 二进制 + electron-builder 工具链，国内必配）
- 打包后运行数据与开发模式分离（`%APPDATA%\whale-desktop\` vs 项目目录），
  **单实例锁也互不相同 → 开发版和安装版可以同时各出一头鲸**，测试时二选一
- 原插件更新：获取明确 tag 的完整包 → 合入 `vendor\dsh-whale-widget\` → 重放桌面兼容层 →
  跑测试与打包验证。⚠️ **别直接覆盖 vendor**：里面还有桌面补丁与特有素材，见下节。

## 与原插件的差异

- **上游基线（v1.4.0）**：vendor 已完整同步 `dsh-whale-widget v0.3.1`（tag `d2b0a1c`），包含
  充值/余额校正、原子账本写入、模块化泡泡、自定义角色/音效、34 个厂商模板与多窗口额度。
- **桌面初始化**：上游前端默认只在 DSH 聊天页挂载；桌面壳通过 `window.__dshWhaleDesktop` 显式启用，
  不伪造聊天输入框。
- **路由信任栅栏**：桌面 shim 实现 `connection.requestRejection()`，只接受同源
  `127.0.0.1/localhost` 请求；HTTP 服务仍仅绑定环回地址和随机端口。
- **每轮对话消耗**：依赖 DSH 会话事件流，桌面版无会话 → `last-turn.json` 恒返回空，
  此功能自然静默；余额校正、自定义 API、模块化泡泡、角色/音效、拖拽吸附等其余功能可用
- **窗口=桌面**：原插件吸附在「浏览器窗口」边缘，这里吸附在「屏幕工作区」边缘
- **音乐状态（v1.2.0）**：桌面版特有——监听系统默认输出设备的音量峰值，
  放歌时换耳机形象 + 哼唱气泡（原插件听不到系统音乐）；自己的点击音效/彩蛋语音会先通知
  主进程冻结检测，不会把自己听成音乐
- **傲娇彩蛋（v1.2.1）**：桌面版特有——2.5 秒内连点 5 次触发，见「傲娇彩蛋」一节
- **吃 token 彩蛋（v1.3.0）**：桌面版特有——60s 窗口内余额单次下降 ≥ ¥0.5 触发「狂吃 token」形象 +
  台词气泡 + 投币音效，10s 后恢复，见「吃 token 彩蛋」一节
- **哼唱 Q 弹修复（v1.3.1）**：哼唱（耳机）形态下点按鲸鱼没有任何 Q 弹反馈——`dshwv-hum` 摆动动画的
  优先级高于 inline transform，把按压压扁完全盖掉了。改为按压期间挂起摆动动画（压扁生效），
  松开后等回弹过渡播完再恢复摆动；hum 的 0% 关键帧即中性姿态，两端切换零跳变
- **单实例锁修复（v1.3.1）**：`requestSingleInstanceLock()` 曾早于 `setPath('userData')` 执行，
  锁落在默认 userData 目录 → 开发版与安装版共用一把锁、无法同时运行（与本页「两端可同时各出一头鲸」
  的说明相悖）。改为先定位 userData 再取锁，开发版跑 `D:\study\whale-desktop`、安装版跑
  `%APPDATA%\whale-desktop`，各持一把锁
- **升级流程**：从上游 tag 导出完整包，合入 vendor 后重新移植桌面模式、点击穿透与三个桌面状态，
  再运行 `npm test`、`node audio-ui-check.mjs` 和 Windows 打包；不要只替换 `lib/index.js`
- **点击/移动修复（v1.1.2）**：preload 监听器改为顶层立即挂载，不再依赖 window load；主进程增加光标轮询兜底，修复偶发全穿透导致的点击和拖动失效。
- **点击修复（v1.2.2）**：150% 缩放下光标轮询坐标换算错误（屏幕 DIP 再除以 dpr 导致错位），
  窗口永远保持全穿透 → 鲸鱼点不动。改为主进程直接换算窗口内 CSS 坐标，preload 原样使用；
  轮询 400ms → 200ms，Windows forward 鼠标转发钩子失活时兜底依然可靠。
- **位置持久化**：旧版 v:3 本地补丁已移除，改用上游 0.3.1 的锚点夹紧、非法距离落盘自愈和
  尺寸就绪后二次校正；桌面版只保留 200ms 光标轮询与 DPI 坐标修复

## 许可与素材

- **代码**：上游插件为 **MIT**（见 `vendor\dsh-whale-widget\LICENSE`）；本桌面外壳（`main.js` /
  `preload.cjs` / 打包配置等）沿用同一许可使用与分发。
- **美术素材不在 MIT 范围内**：`vendor\dsh-whale-widget\assets\` 下的图片 / 动图 / 音效由上游维护者
  提供或用 AI 工具生成，按 **as-is** 随插件分发，**仅供运行本插件使用、不授予再许可**；
  逐项来源、元数据清理说明与 takedown 方式见上游
  [PROVENANCE.md](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/blob/main/PROVENANCE.md)。
- 本安装包把 `vendor\`（**含 assets**）一并打包分发，用途限于运行该插件；上游若调整素材授权，
  本项目同步移除或替换对应素材。
- **桌面版特有素材**（`DSniang1-tsun.png` / `DSniang1-eat.png` / `tsun.mp3` / `eat.mp3`）同样不声明原创、
  不授予再许可，仅供本桌面版运行。
- 本移植是独立衍生作品，未向上游提交代码（上游 issue #82 中维护者已回复知悉）。

## 排障

- **启动后只有黑窗口/报 `does not provide an export named 'BrowserWindow'`**：
  环境里有 `ELECTRON_RUN_AS_NODE=1`（会让 electron.exe 冒充纯 Node 运行）。
  start 脚本已防御性清掉它；若手动运行 electron，先 `set ELECTRON_RUN_AS_NODE=`
- **余额显示「未配置」**：config.json 里填 `DEEPSEEK_API_KEY` 后点一下鲸鱼
- **npm install 慢/失败**：本项目 `.npmrc` 已配 npmmirror 镜像（electron 二进制 + npm 包）
- **鲸鱼不见了**：重启后位置恢复靠 `userdata\` 里的 localStorage；清空该目录即回到默认右下角
