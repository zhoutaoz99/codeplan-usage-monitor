# Claude Code、Codex 与 OpenCode Go 订阅用量实时监控：浏览器实现方案

> 文档版本：1.0  
> 更新日期：2026-07-10  
> 目标平台：Chrome / Chromium 浏览器，Manifest V3  
> 目标形态：浏览器扩展 + 本地聚合网页（Side Panel 或独立 Dashboard）

---

## 1. 项目目标

开发一个浏览器端用量聚合工具，在同一个页面中自动展示：

- Claude Code 订阅套餐的当前使用进度、重置时间和额外用量余额；
- Codex 订阅套餐的当前限额、剩余额度、重置时间和额外 Credits；
- OpenCode Go 的 5 小时、每周、每月用量；
- 各平台最后更新时间、数据来源和采集状态；
- 历史用量曲线、消耗速度和预计耗尽时间；
- 低余额、即将耗尽、额度重置和采集失败提醒。

本方案主要面向个人用户或小团队，第一版以**浏览器本地运行**为主，不要求搭建服务器，也不上传各平台的登录 Cookie。

---

## 2. 核心结论

推荐采用以下结构：

```text
┌──────────────────────────────────────────┐
│ Extension Dashboard / Side Panel         │
│ 三个平台用量卡片、趋势图、告警和设置       │
└───────────────────┬──────────────────────┘
                    │
          chrome.runtime messaging
                    │
┌───────────────────▼──────────────────────┐
│ Manifest V3 Service Worker               │
│ 调度、标签页管理、快照存储、告警、状态机    │
└───────┬───────────────────────┬──────────┘
        │                       │
  已打开页面监听          后台非活动标签页轮询
        │                       │
┌───────▼───────────────────────▼──────────┐
│ Provider Collectors                      │
│ Claude / Codex / OpenCode Go             │
│ DOM 读取 → 解析 → 标准化 → 可信度检查       │
└──────────────────────────────────────────┘
```

### 2.1 推荐采集优先级

1. **页面可见 DOM 数据**：默认方案；
2. **页面内嵌 JSON 或稳定语义属性**：如果页面公开呈现且结构稳定；
3. **官方公开 API**：平台未来提供时优先切换；
4. **站点私有接口**：仅作为可选实验功能，默认关闭；
5. **手动录入**：页面变化或登录失效时的兜底方式。

### 2.2 为什么不直接读取 Cookie

扩展不应申请 `cookies`、`webRequest` 或 `debugger` 权限来提取身份信息。更安全的方式是：

- 用户在正常浏览器标签页中登录官方站点；
- 扩展创建一个非活动标签页打开官方用量页面；
- 官方页面自行使用已有登录状态完成加载；
- 内容脚本只读取页面已经显示的额度数字；
- 解析完成后关闭临时标签页。

这样可以避免在扩展代码或远程服务器中保存平台 Session、OAuth Token 或 Cookie。

---

## 3. “实时监控”的实际定义

纯浏览器扩展无法做到服务器意义上的 24 小时绝对实时监控。

Chrome 的后台 Service Worker 会被挂起，`chrome.alarms` 也可能被延迟；设备休眠时闹钟不会唤醒设备。浏览器关闭后，扩展不会继续采集。

本项目中的“实时”定义为：

| 场景 | 更新方式 | 建议延迟 |
|---|---|---:|
| 用户正在打开官方用量页 | `MutationObserver` 监听 DOM | 约 0.5～2 秒 |
| 浏览器运行但官方页面未打开 | 后台非活动标签页轮询 | 2～5 分钟 |
| 用户打开聚合 Dashboard | 立即刷新全部平台 | 立即触发 |
| 浏览器从休眠中恢复 | 执行一次补偿刷新 | 恢复后触发 |
| 浏览器完全关闭 | 无法采集 | 下次启动后补偿 |

不建议低于 1 分钟持续轮询。额度页面通常不是秒级变化，过高频率只会增加站点压力、触发风控，并降低浏览器续航。

---

## 4. 三个平台的数据特征

## 4.1 Claude Code 订阅套餐

Anthropic 官方说明，Pro、Max、Team 或按席位 Enterprise 用户可以在 Claude 的 **Settings > Usage** 页面查看：

- 当前 5 小时 Session 已使用进度；
- 当前 Session 剩余时间或重置时间；
- 每周总限额；
- 部分套餐中的 Opus 独立周限额；
- Usage Credits、月度支出或余额信息。

需要特别注意：

> Claude 网页、Claude Desktop 和 Claude Code 的使用可能计入同一套餐使用池。因此，浏览器页面显示的是账户或套餐级用量，不一定能够精确拆分为“仅 Claude Code 消耗”。

Dashboard 中应显示：

```text
Claude Plan Usage
而不是：
Claude Code 独占用量
```

除非官方页面明确提供了 Claude Code 单独维度。

### 建议采集字段

```ts
interface ClaudeUsage {
  session5h?: QuotaWindow;
  weeklyAllModels?: QuotaWindow;
  weeklyOpus?: QuotaWindow;
  usageCredits?: MoneyBalance;
  planName?: string;
}
```

### 推荐采集方式

- Host：`https://claude.ai/*`
- 首次连接时引导用户打开 `Settings > Usage`
- 扩展记录实际页面 URL，避免硬编码可能变化的路由
- 内容脚本根据标题、标签和进度条语义解析
- 页面处于打开状态时通过 `MutationObserver` 实时更新
- 页面未打开时由后台标签页轮询

### 解析时必须考虑

- 中文、英文、日文等界面语言；
- 页面使用 `used` 百分比还是 `remaining` 百分比；
- “5 hours”“weekly”“Opus”“all models”等标签变化；
- 重置时间可能是绝对时间，也可能是“3 小时 20 分钟后”；
- Usage Credits 可能未启用，因此字段允许为空；
- 页面可能只展示进度条，不展示绝对 Token 或请求数。

---

## 4.2 Codex 订阅套餐

OpenAI 官方说明，用户接近或达到 Codex 限额时，可以在 **Codex Usage 页面或限额横幅**中查看当前状态；部分套餐还可以查看或购买 Credits。

还需要注意，部分 ChatGPT 套餐中的 Codex 与其他 Agent 类功能可能共享用量池。若页面显示的是共享池，Dashboard 必须原样标记为：

```text
Agentic shared usage
```

而不能推断为 Codex 独占用量。

### 建议采集字段

```ts
interface CodexUsage {
  primaryWindow?: QuotaWindow;
  secondaryWindow?: QuotaWindow;
  credits?: MoneyBalance;
  reserveResets?: number;
  planName?: string;
  scope: "codex" | "agentic_shared" | "unknown";
}
```

### 推荐采集方式

- Host：`https://chatgpt.com/*`
- 首次连接时引导用户进入 Codex Usage 页面
- 保存用户当前可访问的真实 Usage URL
- 优先读取 Usage 页面
- 若 Usage 页面不可访问，可读取 Codex 页面中可见的限额横幅
- 不硬编码套餐限额，因为额度、模型费率和共享池规则可能调整

### 解析时必须考虑

- 页面可能显示剩余百分比，也可能只显示 Credits；
- Plus、Pro、Business、Enterprise 等计划展示字段不同；
- 工作区切换后，用量主体可能变化；
- 页面可能存在个人工作区和团队工作区；
- “剩余 Credits”和“套餐内用量百分比”必须分开存储；
- 推荐奖励产生的额外重置次数应单独显示，不要折算为百分比。

---

## 4.3 OpenCode Go

OpenCode 官方文档说明，Go 当前按美元价值设置多个限额窗口，并可以在 Console 中跟踪当前使用情况。

截至本文更新日期，官方文档列出的限额为：

| 窗口 | 当前官方说明中的限额 |
|---|---:|
| 5 小时 | 12 美元使用额度 |
| 每周 | 30 美元使用额度 |
| 每月 | 60 美元使用额度 |

官方同时说明这些限额可能调整。因此，扩展可以把以上数值作为**初始参考值**，但最终应以 Console 页面实时展示的数据为准。

当前公开的使用页面为：

```text
https://console.opencode.ai/zen/go/v1/usage
```

### 建议采集字段

```ts
interface OpenCodeGoUsage {
  fiveHour?: QuotaWindow;
  weekly?: QuotaWindow;
  monthly?: QuotaWindow;
  zenBalance?: MoneyBalance;
  useBalanceEnabled?: boolean;
  workspaceName?: string;
}
```

### 推荐采集方式

- Host：`https://console.opencode.ai/*`
- 默认轮询公开的 Go Usage 页面
- 读取三个窗口的已用金额、限额、剩余金额和重置时间
- Zen Balance 与 Go 套餐额度分开显示
- “Use balance”开启状态单独展示，防止套餐用完后产生意外余额消费

---

## 5. 扩展总体架构

建议采用以下技术栈：

```text
TypeScript
React
Vite
Chrome Manifest V3
IndexedDB / Dexie
Zod
ECharts 或 Recharts
Vitest
Playwright
```

### 5.1 模块划分

```text
codeplan-monitor/
├── src/
│   ├── background/
│   │   ├── service-worker.ts
│   │   ├── scheduler.ts
│   │   ├── tab-runner.ts
│   │   └── notification.ts
│   ├── collectors/
│   │   ├── base.ts
│   │   ├── claude/
│   │   │   ├── collector.ts
│   │   │   ├── parser.ts
│   │   │   └── fixtures/
│   │   ├── codex/
│   │   │   ├── collector.ts
│   │   │   ├── parser.ts
│   │   │   └── fixtures/
│   │   └── opencode-go/
│   │       ├── collector.ts
│   │       ├── parser.ts
│   │       └── fixtures/
│   ├── content/
│   │   ├── bootstrap.ts
│   │   ├── dom-observer.ts
│   │   └── page-bridge.ts
│   ├── dashboard/
│   │   ├── App.tsx
│   │   ├── ProviderCard.tsx
│   │   └── HistoryChart.tsx
│   ├── storage/
│   │   ├── database.ts
│   │   └── repository.ts
│   ├── shared/
│   │   ├── schema.ts
│   │   ├── messages.ts
│   │   └── time.ts
│   └── options/
├── manifest.json
├── package.json
└── vite.config.ts
```

---

## 6. Manifest V3 权限设计

推荐使用可选 Host 权限，让用户按平台逐个授权。

```json
{
  "manifest_version": 3,
  "name": "CodePlan Usage Monitor",
  "version": "0.1.0",
  "description": "Monitor Claude, Codex and OpenCode Go plan usage.",
  "permissions": [
    "alarms",
    "storage",
    "scripting",
    "tabs",
    "notifications",
    "sidePanel"
  ],
  "optional_host_permissions": [
    "https://claude.ai/*",
    "https://chatgpt.com/*",
    "https://console.opencode.ai/*"
  ],
  "background": {
    "service_worker": "service-worker.js",
    "type": "module"
  },
  "side_panel": {
    "default_path": "dashboard.html"
  },
  "action": {
    "default_title": "CodePlan Usage Monitor"
  },
  "options_ui": {
    "page": "options.html",
    "open_in_tab": true
  }
}
```

### 不建议申请的权限

```text
cookies
webRequest
debugger
history
<all_urls>
```

这些权限不是 DOM 用量采集所必需的，并会显著扩大安全风险和商店审核难度。

---

## 7. Provider Collector 统一接口

每个平台实现相同接口，Dashboard 不直接理解各平台页面结构。

```ts
export type ProviderId =
  | "claude"
  | "codex"
  | "opencode_go";

export interface CollectorContext {
  url: string;
  document: Document;
  locale?: string;
  collectedAt: string;
}

export interface ParseResult {
  provider: ProviderId;
  status:
    | "ok"
    | "partial"
    | "auth_required"
    | "page_not_ready"
    | "parser_mismatch"
    | "blocked";
  snapshots: QuotaSnapshot[];
  parserVersion: string;
  confidence: number;
  diagnostics?: {
    matchedLabels?: string[];
    missingFields?: string[];
    pageFingerprint?: string;
  };
}

export interface ProviderCollector {
  id: ProviderId;
  matches(url: URL): boolean;
  isUsagePage(document: Document, url: URL): boolean;
  parse(context: CollectorContext): ParseResult;
}
```

---

## 8. 统一数据模型

```ts
export type UsageUnit =
  | "percent"
  | "usd"
  | "credits"
  | "requests"
  | "tokens"
  | "vendor_native";

export type WindowKind =
  | "rolling_5h"
  | "weekly"
  | "monthly"
  | "credits"
  | "reserve_reset"
  | "unknown";

export interface QuotaSnapshot {
  id: string;
  provider: "claude" | "codex" | "opencode_go";

  accountKey?: string;
  workspaceKey?: string;
  planName?: string;

  quotaKey: string;
  displayName: string;
  windowKind: WindowKind;

  used?: number;
  limit?: number;
  remaining?: number;
  usedPercent?: number;
  remainingPercent?: number;
  unit: UsageUnit;

  resetsAt?: string;
  periodStartedAt?: string;

  scope:
    | "account"
    | "workspace"
    | "shared_pool"
    | "product"
    | "unknown";

  source: "visible_dom" | "embedded_data" | "manual";
  confidence: number;
  parserVersion: string;
  fetchedAt: string;

  rawTextHash?: string;
}
```

### 8.1 百分比规范

内部统一存储：

```text
usedPercent
remainingPercent
```

如果页面只给出其中一个，则计算另一个：

```ts
remainingPercent = 100 - usedPercent;
```

但只有在页面明确是 0～100% 线性进度时才允许计算。

### 8.2 时间规范

- 数据库存储 UTC ISO 8601；
- UI 按用户浏览器时区显示；
- 相对时间必须转换为绝对时间；
- 同时保留原始文本的哈希，方便排查解析变化；
- 不保存完整页面 HTML。

---

## 9. 后台采集流程

```text
chrome.alarms 触发
        │
        ▼
检查平台是否启用、是否已授权 Host
        │
        ▼
检查是否已有该平台的正常标签页
     ┌──┴───┐
     │      │
    有      无
     │      │
注入采集脚本  创建 inactive 临时标签页
     │      │
     └──┬───┘
        ▼
等待 SPA 完成渲染
        │
        ▼
内容脚本执行 Collector
        │
        ▼
结构校验 + 可信度校验
        │
        ▼
保存最新快照和历史快照
        │
        ▼
执行告警规则
        │
        ▼
关闭扩展创建的临时标签页
```

---

## 10. Scheduler 实现

```ts
const ALARM_NAME = "refresh-all-providers";

async function ensureRefreshAlarm(): Promise<void> {
  const alarm = await chrome.alarms.get(ALARM_NAME);

  if (!alarm) {
    await chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: 1,
      periodInMinutes: 3
    });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureRefreshAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureRefreshAlarm();
  void refreshAllProviders({ reason: "browser_startup" });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    void refreshAllProviders({ reason: "scheduled" });
  }
});

void ensureRefreshAlarm();
```

必须在 Service Worker 每次启动时检查闹钟是否存在，不能假设闹钟始终可靠保留。

---

## 11. 后台非活动标签页采集

```ts
interface TabCollectionOptions {
  provider: ProviderId;
  url: string;
  timeoutMs?: number;
}

export async function collectInBackgroundTab(
  options: TabCollectionOptions
): Promise<ParseResult> {
  const tab = await chrome.tabs.create({
    url: options.url,
    active: false
  });

  if (!tab.id) {
    throw new Error("Unable to create collection tab");
  }

  try {
    await waitUntilTabComplete(tab.id, options.timeoutMs ?? 25_000);

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content-bootstrap.js"]
    });

    const result = results[0]?.result as ParseResult | undefined;

    if (!result) {
      throw new Error("Collector returned no result");
    }

    return result;
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => undefined);
  }
}
```

### 11.1 标签页复用

为避免闪烁和重复加载：

1. 先查找已有匹配标签页；
2. 如果已有标签页，直接发送 `COLLECT_NOW`；
3. 只有不存在时才创建临时标签页；
4. 只关闭扩展自己创建的标签页；
5. 同一 Provider 同时只能运行一个采集任务；
6. 使用互斥锁避免闹钟、手动刷新和页面监听重复执行。

---

## 12. DOM 解析策略

不要主要依赖压缩后的 CSS Class，例如：

```text
.css-1a2b3c
.x7f82
```

这些选择器极易变化。

推荐依次使用：

1. `aria-label`、`role`、`data-testid` 等语义属性；
2. 标题和附近标签文本；
3. 进度条的 `aria-valuenow`、`aria-valuemax`；
4. 页面内公开展示的 JSON 数据；
5. 文本正则作为兜底。

### 12.1 通用进度条解析

```ts
interface ProgressValue {
  usedPercent?: number;
  remainingPercent?: number;
}

export function parseProgressBar(
  root: ParentNode
): ProgressValue | undefined {
  const bars = Array.from(
    root.querySelectorAll<HTMLElement>(
      '[role="progressbar"], progress'
    )
  );

  for (const bar of bars) {
    const now = Number(
      bar.getAttribute("aria-valuenow") ??
      (bar instanceof HTMLProgressElement ? bar.value : NaN)
    );

    const max = Number(
      bar.getAttribute("aria-valuemax") ??
      (bar instanceof HTMLProgressElement ? bar.max : 100)
    );

    if (
      Number.isFinite(now) &&
      Number.isFinite(max) &&
      max > 0
    ) {
      const usedPercent = Math.min(100, Math.max(0, now / max * 100));
      return {
        usedPercent,
        remainingPercent: 100 - usedPercent
      };
    }
  }

  return undefined;
}
```

### 12.2 多语言标签映射

```ts
const LABELS = {
  fiveHour: [
    "5 hour",
    "five hour",
    "5-hour",
    "5 小时",
    "5時間"
  ],
  weekly: [
    "weekly",
    "week",
    "每周",
    "每週",
    "週間"
  ],
  monthly: [
    "monthly",
    "month",
    "每月",
    "月間"
  ],
  remaining: [
    "remaining",
    "left",
    "剩余",
    "剩餘",
    "残り"
  ],
  reset: [
    "reset",
    "resets",
    "重置",
    "リセット"
  ]
};
```

标签映射应通过扩展版本发布，不允许从远程服务器下载并执行新的解析代码。远程服务器可以下发纯数据配置，但不能下发 JavaScript。

---

## 13. SPA 页面监听

Claude、ChatGPT 和 OpenCode Console 都可能是单页应用。页面 URL 完成加载时，真正的用量组件可能还没有渲染。

```ts
export function observeUsagePage(
  collect: () => void
): () => void {
  let timer: number | undefined;

  const schedule = () => {
    if (timer) {
      window.clearTimeout(timer);
    }

    timer = window.setTimeout(() => {
      collect();
    }, 500);
  };

  const observer = new MutationObserver(schedule);

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "aria-valuenow",
      "aria-valuemax",
      "data-state"
    ]
  });

  window.addEventListener("popstate", schedule);
  window.addEventListener("hashchange", schedule);

  schedule();

  return () => {
    observer.disconnect();
    window.removeEventListener("popstate", schedule);
    window.removeEventListener("hashchange", schedule);
  };
}
```

必须加入去抖和数据哈希判断，避免 DOM 高频变化导致重复写入。

---

## 14. 页面就绪判断

每个平台 Collector 应实现自己的就绪条件：

```ts
function waitForUsageContent(
  predicate: () => boolean,
  timeoutMs = 20_000
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (predicate()) {
      resolve();
      return;
    }

    const timeout = window.setTimeout(() => {
      observer.disconnect();
      reject(new Error("Usage page timed out"));
    }, timeoutMs);

    const observer = new MutationObserver(() => {
      if (predicate()) {
        window.clearTimeout(timeout);
        observer.disconnect();
        resolve();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  });
}
```

状态判定顺序：

```text
登录页 → auth_required
验证码或风险验证页 → blocked
用量页骨架屏 → page_not_ready
页面已加载但字段匹配失败 → parser_mismatch
部分字段成功 → partial
全部关键字段成功 → ok
```

---

## 15. 解析可信度与防错机制

DOM 解析最危险的问题不是“失败”，而是“成功解析出错误数字”。

建议为每次结果计算可信度：

```text
+0.30 匹配到正确页面标题
+0.20 匹配到窗口名称
+0.20 找到进度条语义属性
+0.15 找到重置时间
+0.10 百分比范围合法
+0.05 页面指纹属于已测试版本
```

### 可信度处理

| 可信度 | 行为 |
|---:|---|
| ≥ 0.85 | 正常展示 |
| 0.65～0.84 | 展示并标记“可能不完整” |
| 0.40～0.64 | 不覆盖上次有效数据，提示重新确认 |
| < 0.40 | 标记解析器失效 |

### 其他校验规则

- 百分比必须位于 0～100；
- `remaining = limit - used` 时不允许出现明显负数；
- 重置时间不能无理由早于当前时间；
- 新快照与旧快照差异异常时先标记，不立即覆盖；
- 额度重置前后允许百分比突然回升；
- 页面语言变化不能导致 `used` 和 `remaining` 反转；
- 不同 Provider 的页面结果不能互相写入。

---

## 16. 本地存储方案

建议分层存储：

### `chrome.storage.local`

保存：

- 平台开关；
- 授权状态；
- 首次连接时记录的 Usage URL；
- 最后有效快照；
- 告警设置；
- 页面语言和解析器版本；
- Dashboard 偏好。

### IndexedDB

保存：

- 历史快照；
- 每小时聚合；
- 每日聚合；
- 解析诊断；
- 告警历史。

不要把所有 2～5 分钟快照长期放在 `chrome.storage.local` 中。

### 建议保留策略

```text
原始快照：7 天
15 分钟聚合：30 天
1 小时聚合：180 天
每日聚合：永久或由用户设置
```

---

## 17. Dashboard 设计

推荐使用 Chrome Side Panel，也可以提供独立扩展页面：

```text
chrome-extension://<extension-id>/dashboard.html
```

### 17.1 总览卡片

```text
Claude
5 小时窗口        剩余 63%       14:20 重置
每周全部模型      剩余 41%       周一 08:00 重置
每周 Opus         剩余 76%       周一 08:00 重置
数据范围：Claude 账户共享用量
更新：1 分钟前
```

```text
Codex
Agentic 共享池     剩余 35%
Credits            $8.20
储备重置           1 次
更新：2 分钟前
```

```text
OpenCode Go
5 小时             $8.40 / $12
每周               $17.20 / $30
每月               $31.70 / $60
Zen Balance         $12.00
Use Balance         已关闭
更新：30 秒前
```

### 17.2 状态颜色

| 状态 | 条件 |
|---|---|
| 正常 | 剩余大于 50% |
| 注意 | 剩余 20%～50% |
| 危险 | 剩余小于 20% |
| 已耗尽 | 剩余接近 0 |
| 过期 | 超过两个轮询周期未更新 |
| 登录失效 | 页面进入登录页 |
| 解析失败 | 页面变化导致字段无法确认 |

### 17.3 必须展示的数据说明

每个卡片应显示：

- 数据范围；
- 数据来源；
- 最后刷新时间；
- 解析器可信度；
- 是否为估算；
- 是否来自共享额度池。

---

## 18. 消耗速度和预计耗尽

```ts
export function calculateBurnRate(
  previous: QuotaSnapshot,
  current: QuotaSnapshot
): number | undefined {
  if (
    previous.remainingPercent == null ||
    current.remainingPercent == null
  ) {
    return undefined;
  }

  const elapsedHours =
    (Date.parse(current.fetchedAt) -
      Date.parse(previous.fetchedAt)) /
    3_600_000;

  if (elapsedHours <= 0) {
    return undefined;
  }

  const consumed =
    previous.remainingPercent -
    current.remainingPercent;

  if (consumed <= 0) {
    return 0;
  }

  return consumed / elapsedHours;
}
```

### 注意事项

滚动窗口中的旧用量会逐步释放，因此：

```text
预计耗尽时间 ≠ 官方承诺
```

应在 UI 中标记为“趋势估算”，并建议采用最近 30～60 分钟的加权平均，而不是仅用两个点。

---

## 19. 告警系统

建议支持：

- 剩余低于 50%、20%、10%；
- 按当前速度预计 1 小时内耗尽；
- 额度已经重置；
- Usage Credits 或 Zen Balance 开始被消耗；
- OpenCode Go 的 `Use balance` 被开启；
- 登录失效；
- 解析器失效；
- 数据超过 10 分钟未更新。

### 去重规则

同一窗口同一级别的告警，在以下条件前不重复发送：

- 剩余比例重新高于阈值；
- 额度完成重置；
- 用户手动清除告警；
- 经过配置的冷却时间。

---

## 20. 首次连接流程

每个平台采用单独授权。

```text
点击“连接 Claude”
        │
请求 claude.ai Host 权限
        │
打开 Claude Settings > Usage
        │
用户正常登录或确认账户
        │
扩展读取页面并显示预览
        │
用户确认“这是我的用量页面”
        │
保存 Usage URL 和页面指纹
```

Codex 和 OpenCode Go 使用相同流程。

首次连接时应明确提示：

- 扩展读取哪些页面；
- 扩展保存哪些字段；
- 不会读取聊天内容、Prompt、代码和 Cookie；
- 用户可随时撤销 Host 权限并清除数据。

---

## 21. 私有接口模式

页面通常会调用内部 JSON 接口加载用量数据。理论上可以通过页面主环境调用这些接口，从而比 DOM 解析更稳定、更快。

但不建议把它作为默认方案，原因包括：

- 接口未公开，可能随时变化；
- 可能受站点服务条款限制；
- 认证、CSRF、Cookie 和工作区上下文更复杂；
- 容易扩大扩展权限；
- Chrome 商店审核风险更高；
- 可能触发平台风控。

如确实需要实验：

1. 只在用户本地启用；
2. 不记录、上传或导出认证头；
3. 不绕过登录、验证码或权限校验；
4. 不自动发现和扫描全部网络请求；
5. 私有接口失败后立即回退到 DOM；
6. UI 明确标记“实验性数据源”；
7. 每个平台单独开关，默认关闭。

---

## 22. 安全边界

### 必须做到

- 最小化 Host 权限；
- 不读取聊天正文；
- 不读取项目代码；
- 不读取 Cookie；
- 不上传完整 HTML；
- 不把 Session Token 写入存储；
- 不执行服务器下发的 JavaScript；
- 所有解析器代码随扩展版本发布；
- 临时标签页采集结束后关闭；
- 日志中对账户名、余额和工作区 ID 脱敏；
- 提供“一键清除全部本地数据”。

### 可选服务器同步

如未来需要跨设备展示，可同步标准化后的快照：

```json
{
  "provider": "opencode_go",
  "quotaKey": "rolling_5h",
  "remainingPercent": 70,
  "resetsAt": "2026-07-10T15:00:00Z",
  "fetchedAt": "2026-07-10T12:03:00Z"
}
```

不要同步：

```text
Cookie
Authorization
CSRF Token
完整页面 HTML
聊天内容
Prompt
代码内容
浏览器 LocalStorage
```

服务器同步必须提供端到端加密或至少 TLS、用户鉴权、数据隔离和删除接口。

---

## 23. 页面变化与解析器维护

建议建立 HTML Fixture 测试机制。

每个平台保留经过脱敏的最小页面片段：

```text
collectors/claude/fixtures/en-v1.html
collectors/claude/fixtures/zh-v1.html
collectors/codex/fixtures/en-v1.html
collectors/opencode-go/fixtures/en-v1.html
```

测试内容：

- 页面正常；
- 页面缺少重置时间；
- 页面语言变化；
- 登录失效；
- 骨架屏；
- 多工作区；
- 额度已耗尽；
- 额度刚重置；
- 进度条仅含样式、不含文本；
- `used` 与 `remaining` 两种表述。

### 页面指纹

可以根据以下内容生成指纹：

```text
页面标题
关键标题文本
关键元素标签名
关键 aria 属性名
```

不要包含账户名、余额、用量数字或完整 HTML。

当线上页面指纹未知时：

1. 保留旧有效数据；
2. 状态设为 `parser_mismatch`；
3. 提示用户打开官方用量页；
4. 提供“复制脱敏诊断信息”按钮；
5. 不上传页面内容，除非用户明确授权。

---

## 24. 刷新策略建议

| Provider | 默认周期 | 页面打开时 | 失败退避 |
|---|---:|---:|---:|
| Claude | 3 分钟 | DOM 变化立即刷新 | 5、15、30 分钟 |
| Codex | 3 分钟 | DOM 变化立即刷新 | 5、15、30 分钟 |
| OpenCode Go | 2 分钟 | DOM 变化立即刷新 | 5、15、30 分钟 |

其他规则：

- 用户点击 Dashboard 时可立即刷新；
- 额度低于 20% 时可以把周期缩短到 1 分钟；
- 连续失败后使用指数退避；
- 出现登录页后停止自动开标签页，等待用户处理；
- 检测到验证码后至少暂停 30 分钟；
- 不允许多个窗口同时轮询同一 Provider。

---

## 25. 开发里程碑

### Phase 1：本地 MVP

- Manifest V3；
- Side Panel；
- 三个平台手动连接；
- 后台标签页采集；
- DOM Parser；
- 最新快照；
- 手动刷新；
- 登录失效提示。

### Phase 2：自动化和历史

- `chrome.alarms`；
- MutationObserver；
- IndexedDB；
- 历史趋势；
- 消耗速度；
- 额度重置识别；
- 浏览器通知。

### Phase 3：可靠性

- 多语言解析；
- Fixture 测试；
- 页面指纹；
- 可信度评分；
- 解析失败降级；
- 多工作区识别；
- 数据导出。

### Phase 4：可选云同步

- 账户系统；
- 加密快照同步；
- 多设备 Dashboard；
- Telegram、邮件或 Webhook 告警；
- 团队共享只读视图。

---

## 26. MVP 验收标准

### 功能验收

- 三个平台均可单独授权；
- 用户正常登录后，无需复制 Cookie 或 Token；
- Dashboard 能展示至少一个有效用量窗口；
- 3 分钟内自动刷新；
- 打开官方用量页后，页面更新能同步到 Dashboard；
- 浏览器重启后配置和历史仍存在；
- 临时标签页采集完成后自动关闭；
- 用户可一键暂停某个平台；
- 用户可一键删除全部本地数据。

### 安全验收

- Manifest 不包含 `<all_urls>`；
- 不申请 `cookies`、`webRequest`、`debugger`；
- 源码中不存在上传 Cookie 的逻辑；
- 日志不包含认证信息；
- 不执行远程 JavaScript；
- 不保存完整 HTML；
- 不绕过登录或验证码；
- Host 权限可以逐个平台撤销。

### 可靠性验收

- Parser 失败时不覆盖上一次有效数据；
- `used` 与 `remaining` 不会反转；
- 页面语言切换不会崩溃；
- 休眠恢复后会补偿刷新；
- 额度重置后不会误报异常增长；
- 同一告警不会无限重复。

---

## 27. 已知限制

1. 浏览器关闭或设备休眠期间无法持续采集；
2. 三个平台均可能调整页面结构；
3. 没有公开 API 时，DOM Parser 必须持续维护；
4. Claude 套餐用量可能是 Claude 全产品共享，而非 Claude Code 独占；
5. Codex 可能展示 Agentic 共享用量池；
6. OpenCode Go 当前限额可能变化，不能永久硬编码；
7. 页面不同语言、套餐和工作区可能展示不同字段；
8. 平台可能限制自动化访问或要求重新登录；
9. 扩展无法保证官方页面本身始终提供精确的绝对用量；
10. “预计耗尽时间”只能作为趋势估算。

---

## 28. 推荐最终方案

第一版选择：

```text
Chrome Manifest V3 扩展
+ Side Panel Dashboard
+ 可选 Host 权限
+ 后台非活动标签页
+ DOM 语义解析
+ MutationObserver
+ chrome.alarms
+ IndexedDB 历史
+ 本地通知
```

不选择：

```text
服务端保存三方 Cookie
自动登录
长期运行无头浏览器
抓取全部网络请求
依赖未公开接口作为唯一数据源
```

这一方案在自动化程度、安全性、实现成本和可维护性之间比较平衡，适合先做个人本地版，再逐步加入跨设备同步。

---

## 29. 官方资料

1. Anthropic，Usage limit best practices：  
   https://support.claude.com/en/articles/9797557-usage-limit-best-practices

2. Anthropic，How do usage and length limits work：  
   https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work

3. Anthropic，Models, usage, and limits in Claude Code：  
   https://support.claude.com/en/articles/14552983-models-usage-and-limits-in-claude-code

4. OpenAI，Using Codex with your ChatGPT plan：  
   https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan

5. OpenAI，Codex rate card：  
   https://help.openai.com/en/articles/20001106-codex-rate-card

6. OpenCode，Go 文档：  
   https://opencode.ai/docs/go/

7. OpenCode Go Usage Console：  
   https://console.opencode.ai/zen/go/v1/usage

8. Chrome Extensions，Manifest V3：  
   https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3

9. Chrome Extensions，Content scripts：  
   https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts

10. Chrome Extensions，chrome.alarms：  
    https://developer.chrome.com/docs/extensions/reference/api/alarms

11. Chrome Extensions，chrome.storage：  
    https://developer.chrome.com/docs/extensions/reference/api/storage

12. Chrome Extensions，Declare permissions：  
    https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions

---

## 30. 后续可扩展平台

相同架构可以继续加入：

- Cursor；
- Windsurf；
- GitHub Copilot；
- GLM Coding Plan；
- 火山方舟 Coding Plan；
- OpenRouter；
- Kimi Code；
- Gemini Code Assist。

新增平台时只需要实现新的 `ProviderCollector`，不需要修改 Dashboard 的核心数据模型。
