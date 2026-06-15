# Claude Code Usage

Show your Claude Code subscription usage in the VSCode status bar — the same data as `claude.ai/settings/usage`. The UI is bilingual and follows your VSCode display language (English / 简体中文).

状态栏显示 Claude Code 订阅用量，数据与 `claude.ai/settings/usage` 一致。界面跟随 VSCode 显示语言自动切换中英文。

Status bar (logo = current session, second number = weekly):

```
 85% (3h17m) ·  97% (6d19h)
```

Hover for full details: current session (5h), weekly (7d · all models), per-model weekly (Opus / Sonnet), reset times, and extra usage. Click to refresh.

悬浮查看明细：当前会话、每周（全模型）、各模型每周、重置时间、额外用量。点击刷新。

## How it works / 工作原理

Calls the Anthropic OAuth usage endpoint:

```
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <accessToken>
anthropic-beta: oauth-2025-04-20
User-Agent: claude-code/<version>
```

Returns `five_hour` / `seven_day` / `seven_day_opus` / `seven_day_sonnet`, each with `utilization` (used %) and `resets_at`. The extension shows the remaining %.

**Credentials** are read locally, in order: `~/.claude/.credentials.json` (the default on Linux/Windows and some macOS installs), then the OS keystore — macOS Keychain or Linux Secret Service / libsecret (`secret-tool`), both under the service name `Claude Code-credentials`. Used only to call the usage endpoint; nothing is sent anywhere else.

> Linux keystore lookup requires `secret-tool` (package `libsecret-tools`). On Windows, Claude Code stores credentials in the file above, which is read directly.

凭证仅在本机读取,按顺序:`~/.claude/.credentials.json`(Linux/Windows 默认、部分 macOS 安装方式),再到系统密钥库 —— macOS Keychain 或 Linux Secret Service / libsecret(`secret-tool`),服务名均为 `Claude Code-credentials`。只用于请求用量接口,不会上传任何第三方。Linux 密钥库读取需要 `secret-tool`(`libsecret-tools` 包)。

## Shared cache / 共享缓存

Every successful response is written verbatim to `~/.claude/usage-cache.json` so other clients (extra VSCode windows, status-bar scripts, etc.) can read it directly instead of each calling the rate-limited endpoint. On auto-refresh the extension reuses this file when it's younger than `refreshInterval`; a manual refresh always fetches fresh. The file is written atomically (temp file + rename) with mode `0600`.

每次成功拿到用量后会把**原始响应**写入 `~/.claude/usage-cache.json`，其他客户端可直接读取，避免各自重复请求有限流的接口。自动刷新时若该文件比 `refreshInterval` 还新就直接复用；手动刷新则强制拉取最新。文件采用原子写入（临时文件 + rename），权限 `0600`。

```jsonc
{
  "version": 1,
  "source": "claude-usage-statusbar",
  "fetched_at": "2026-06-12T09:15:42.126Z",   // ISO 抓取时间
  "fetched_at_ms": 1781255742126,              // 毫秒时间戳，便于判新鲜度
  "data": { /* /api/oauth/usage 的原始 JSON：five_hour / seven_day / … */ }
}
```

## Settings / 配置项

| Setting | Default | |
| --- | --- | --- |
| `claudeUsage.refreshInterval` | `300` | Auto-refresh seconds (min 180). |
| `claudeUsage.show` | `sessionWeekly` | `session` / `sessionWeekly`. |
| `claudeUsage.resetStyle` | `relative` | `relative` (4h25m) / `clock` (Fri 11:59 AM). |

Command: `Claude Usage: Refresh now`.

## Build / 构建

```bash
npm install
npm run build:icons   # regenerate icons/claude-usage.woff (only if you edit the logo)
npm run package       # produce the .vsix
```

## Install / 安装

```bash
code --install-extension claude-usage-statusbar-1.0.0.vsix
```

Reload the window after installing so the custom icon font loads.
安装后请重载窗口，使自定义图标字体生效。

## Notes / 说明

- Some model windows (e.g. Sonnet) may be unused this week; they have no reset time and the tooltip omits the reset line for them.
- The endpoint is rate-limited; on 429 the extension keeps the last good values and notes it in the tooltip.
- If you see "credentials not found / expired", run `claude` in a terminal to log in.
