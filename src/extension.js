'use strict';

const vscode = require('vscode');
const { l10n } = vscode;
const { getUsageShared } = require('./usageApi');

let statusBarItem;
let timer = null;
let lastGood = null; // { data, at: Date }

const LOGO = '$(claude-logo)';

function activate(context) {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'claudeUsage.refresh';
  statusBarItem.text = `${LOGO} $(sync~spin)`;
  statusBarItem.tooltip = l10n.t('Fetching Claude Code usage…');
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeUsage.refresh', () => refresh(true))
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeUsage')) {
        scheduleTimer();
        refresh(false);
      }
    })
  );

  refresh(false);
  scheduleTimer();
}

function deactivate() {
  if (timer) clearInterval(timer);
}

function cfg() {
  return vscode.workspace.getConfiguration('claudeUsage');
}

function scheduleTimer() {
  if (timer) clearInterval(timer);
  let sec = cfg().get('refreshInterval', 300);
  if (typeof sec !== 'number' || sec < 180) sec = 180;
  timer = setInterval(() => refresh(false), sec * 1000);
}

async function refresh(manual) {
  if (manual) statusBarItem.text = `${LOGO} $(sync~spin)`;
  try {
    // 自动刷新时优先复用其他客户端/窗口刚写入共享缓存的新鲜结果，
    // 在一个刷新周期内不重复打有限流的接口；手动点击则强制拉取最新。
    let sec = cfg().get('refreshInterval', 300);
    if (typeof sec !== 'number' || sec < 180) sec = 180;
    const maxAgeMs = manual ? 0 : sec * 1000;
    const res = await getUsageShared({ maxAgeMs });
    lastGood = { data: res.data, at: new Date(res.fetchedAtMs) };
    render(res.data, null);
  } catch (err) {
    render(lastGood ? lastGood.data : null, err);
    if (manual && err && err.code !== 'RATE_LIMIT') {
      vscode.window.showWarningMessage(
        l10n.t('Failed to fetch Claude usage: {0}', err.message)
      );
    }
  }
}

// ---------- 渲染 ----------

function remaining(util) {
  const u = typeof util === 'number' ? util : 0;
  return Math.max(0, Math.min(100, Math.round(100 - u)));
}

/** 紧凑相对时长（状态栏 + tooltip 通用）：4h25m / 3d / 12m */
function shortRel(ms) {
  if (ms <= 0) return l10n.t('now');
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return h % 24 > 0 ? `${d}d${h % 24}h` : `${d}d`;
  if (h > 0) return `${h}h${m % 60}m`;
  return `${m}m`;
}

/** 状态栏时钟风格：Fri 11:59 AM */
function clockOf(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d
    .toLocaleString(undefined, {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    .replace(',', '');
}

function resetText(w) {
  if (!w || !w.resets_at) return '';
  const style = cfg().get('resetStyle', 'relative');
  if (style === 'clock') return clockOf(w.resets_at);
  const ms = new Date(w.resets_at).getTime();
  if (isNaN(ms)) return '';
  return shortRel(ms - Date.now());
}

/** tooltip 绝对时间：06/05 19:19；无效返回 null */
function clockTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function windowBlock(title, w) {
  if (!w) return `**${title}**\n\n${l10n.t('Not active')}\n`;
  const rem = remaining(w.utilization);
  const used = Math.round(w.utilization || 0);
  let s =
    `**${title}**\n\n` +
    l10n.t('Remaining `{0}%` · Used {1}%', String(rem), String(used)) +
    '\n';
  // 仅当存在有效重置时间时才显示（修复未使用窗口的 “重置：—（）”）
  const time = clockTime(w.resets_at);
  if (time) {
    const rel = shortRel(new Date(w.resets_at).getTime() - Date.now());
    s += '\n' + l10n.t('Resets: {0} ({1} left)', time, rel) + '\n';
  }
  return s;
}

function buildTooltip(data, err) {
  const md = new vscode.MarkdownString();
  md.supportThemeIcons = true;
  md.isTrusted = true;

  let s = `### ${l10n.t('Claude Code Usage')}\n\n`;
  if (data) {
    s += windowBlock(`$(clock) ${l10n.t('Current session (5h)')}`, data.five_hour) + '\n';
    s += windowBlock(`$(calendar) ${l10n.t('Weekly (7d · all models)')}`, data.seven_day) + '\n';
    if (data.seven_day_opus)
      s += windowBlock(l10n.t('Weekly · Opus'), data.seven_day_opus) + '\n';
    if (data.seven_day_sonnet)
      s += windowBlock(l10n.t('Weekly · Sonnet'), data.seven_day_sonnet) + '\n';
    if (data.extra_usage && data.extra_usage.is_enabled) {
      const eu = data.extra_usage;
      const used = eu.used_credits != null ? eu.used_credits : '?';
      s +=
        (eu.monthly_limit != null
          ? l10n.t('Extra usage: {0} / {1} credits', String(used), String(eu.monthly_limit))
          : l10n.t('Extra usage: {0} credits', String(used))) + '\n\n';
    }
  } else {
    s += l10n.t('No data') + '\n\n';
  }

  s += '---\n\n';
  const stamp = lastGood
    ? lastGood.at.toLocaleTimeString(undefined, { hour12: false })
    : '—';
  s += l10n.t('Updated {0}', stamp);
  if (err) s += `  ·  ⚠ ${err.message}`;
  s += '\n\n' + l10n.t('_Click the status bar to refresh_');

  md.appendMarkdown(s);
  return md;
}

function render(data, err) {
  if (!data) {
    statusBarItem.text = `${LOGO} $(warning)`;
    statusBarItem.tooltip = buildTooltip(null, err);
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.warningBackground'
    );
    return;
  }

  const show = cfg().get('show', 'sessionWeekly');
  const remS = remaining(data.five_hour && data.five_hour.utilization);
  const remW = data.seven_day ? remaining(data.seven_day.utilization) : null;

  // Claude logo 即代表当前会话用量；每周用量跟在 “·” 之后
  const parts = [];
  let curr = `${remS}%`;
  const rS = resetText(data.five_hour);
  if (rS) curr += ` (${rS})`;
  parts.push(curr);

  if (show !== 'session' && remW !== null) {
    let week = `${remW}%`;
    const rW = resetText(data.seven_day);
    if (rW) week += ` (${rW})`;
    parts.push(week);
  }
  statusBarItem.text = `${LOGO} ${parts.join(' · ')}`;
  statusBarItem.tooltip = buildTooltip(data, err);

  const low = remW === null ? remS : Math.min(remS, remW);
  if (low <= 5) {
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  } else if (low <= 15) {
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    statusBarItem.backgroundColor = undefined;
  }
}

module.exports = { activate, deactivate };
