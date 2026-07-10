# CodePlan Usage Monitor

一个完全本地运行的 Chrome / Chromium Manifest V3 扩展，用于在 Side Panel 聚合 Claude、Codex 和 OpenCode Go 的套餐用量。

它不需要服务器：浏览器只在用户明确授权的官方页面上读取已经显示的用量文本和进度条。不会读取或保存 Cookie、Token、聊天内容、Prompt、代码、完整 HTML，也不会执行远程下发的解析脚本。

## 本地运行

```bash
npm install
npm run build
```

打开 `chrome://extensions`，打开“开发者模式”，选择“加载已解压的扩展程序”，然后选择本项目的 `dist` 目录。

点击扩展图标打开 Side Panel，按平台点击“连接”。浏览器会单独请求对应站点的可选访问权限，并打开官方用量页面；在该页正常登录后，扩展会自动保存经过验证的真实用量页地址。

OpenCode Go 需要先在当前标签打开自己工作区的 Go 页面（地址包含 `/workspace/wrk_…/go`），再在 Side Panel 点击“连接”。扩展会从该地址保存工作区 ID，供后续定时刷新使用。

## 功能

- Claude、Codex、OpenCode Go 分别授权、连接和暂停。
- Service Worker 每 1 分钟检查一次；每次后台采集都会创建非活动的官方用量页，采集完成立即关闭，避免复用可能已过期的页面数据。
- 打开的用量页面通过 `MutationObserver` 去抖同步；手动刷新和浏览器启动时也会补偿刷新。
- 低余额、数据过期通知；连续采集异常按 5 / 15 / 30 分钟退避。
- 最新快照保存在 `chrome.storage.local`，历史保存在 IndexedDB：原始数据 7 天、15 分钟聚合 30 天、小时聚合 180 天、日聚合长期保留。
- 低可信度或解析失败绝不覆盖上一次有效数据。

## 开发与验证

```bash
npm test
npx tsc --noEmit
npm run build
```

测试夹具位于 `src/collectors/*/fixtures`，覆盖各平台的脱敏常规页面和登录失效页。真实站点页面结构可能变化；当解析器不能确认结构时，面板会保留旧数据并显示相应状态。

## 权限边界

清单只包含 `alarms`、`storage`、`scripting`、`tabs`、`notifications`、`sidePanel`，以及以下逐项可选站点权限：

- `https://claude.ai/*`
- `https://chatgpt.com/*`
- `https://opencode.ai/*`

不包含 `<all_urls>`、`cookies`、`webRequest`、`debugger` 或 `history`。在面板中“断开并撤销页面访问”可移除单个平台的 Host 权限；设置页可一键清除全部本地数据。
