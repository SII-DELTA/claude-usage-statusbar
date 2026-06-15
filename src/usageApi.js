'use strict';

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { l10n } = require('vscode');

// Claude Code 在系统密钥库中存储凭证时使用的服务名（macOS Keychain / libsecret 通用）。
const KEYCHAIN_SERVICE = 'Claude Code-credentials';

/** 把一段 JSON 文本解析成 OAuth 凭证对象；失败或无 accessToken 返回 null。 */
function parseCreds(text) {
  try {
    const json = JSON.parse(String(text).trim());
    const oauth = json.claudeAiOauth || json;
    if (oauth && oauth.accessToken) return oauth;
  } catch (_) {
    /* ignore */
  }
  return null;
}

/**
 * 从操作系统密钥库读取凭证（best-effort，任何失败都返回 null）。
 *  - macOS：Keychain 通用密码（security find-generic-password）
 *  - Linux：Secret Service / libsecret（secret-tool lookup）
 *  - Windows：凭证默认存为 ~/.claude/.credentials.json 文件，由 readCredentials 的文件分支覆盖。
 */
function readFromKeystore() {
  try {
    if (process.platform === 'darwin') {
      const out = execFileSync(
        'security',
        ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
        { encoding: 'utf8' }
      );
      return parseCreds(out);
    }
    if (process.platform === 'linux') {
      // GNOME Keyring / KWallet 等通过 freedesktop Secret Service 暴露；
      // secret-tool 来自 libsecret-tools，未安装或未命中时抛错被吞掉。
      const out = execFileSync(
        'secret-tool',
        ['lookup', 'service', KEYCHAIN_SERVICE],
        { encoding: 'utf8' }
      );
      return parseCreds(out);
    }
  } catch (_) {
    /* 落到上层报错 */
  }
  return null;
}

/**
 * 读取 Claude Code 的 OAuth 凭证。
 * 优先读 ~/.claude/.credentials.json（Linux/Windows 默认、部分 macOS 安装方式），
 * 其次读操作系统密钥库（macOS Keychain / Linux libsecret）。
 * 返回包含 accessToken / expiresAt / subscriptionType 等字段的对象。
 */
function readCredentials() {
  // 1) 凭证文件
  const credFile = path.join(os.homedir(), '.claude', '.credentials.json');
  try {
    if (fs.existsSync(credFile)) {
      const oauth = parseCreds(fs.readFileSync(credFile, 'utf8'));
      if (oauth) return oauth;
    }
  } catch (_) {
    /* 落到下一种方式 */
  }

  // 2) 操作系统密钥库
  const fromStore = readFromKeystore();
  if (fromStore) return fromStore;

  const err = new Error(
    l10n.t('Claude Code credentials not found. Run `claude` in a terminal to log in first.')
  );
  err.code = 'NO_CREDS';
  throw err;
}

/**
 * 共享缓存文件：把最近一次成功拿到的用量原始响应写到这里，
 * 让其他客户端（其他 VSCode 窗口 / 脚本 / 状态栏工具）直接读取，
 * 避免大家各自去打那个有限流的 /api/oauth/usage 接口。
 */
const CACHE_FILE = path.join(os.homedir(), '.claude', 'usage-cache.json');
const CACHE_VERSION = 1;

/**
 * 把一次成功的用量响应原样写入共享缓存文件（原子写：先写临时文件再 rename）。
 * 任何失败都吞掉——缓存写不进去不应影响状态栏的正常渲染。
 * @param {object} data getUsage 返回的原始 JSON
 * @param {number} [atMs] 抓取时间（毫秒），默认现在
 * @returns {boolean} 是否写入成功
 */
function writeUsageCache(data, atMs) {
  if (!data || typeof data !== 'object') return false;
  const at = atMs || Date.now();
  // 只保留有数据的窗口：丢掉顶层值为 null 的字段
  // （tangelo / iguana_necktie / seven_day_opus 等账号没启用的窗口）。
  // 注意只删顶层 null：seven_day_sonnet（对象，仅 resets_at 为 null）等仍保留。
  const compact = {};
  for (const k of Object.keys(data)) {
    if (data[k] !== null) compact[k] = data[k];
  }
  const payload = {
    version: CACHE_VERSION,
    source: 'claude-usage-statusbar',
    fetched_at: new Date(at).toISOString(),
    fetched_at_ms: at,
    data: compact,
  };
  const tmp = `${CACHE_FILE}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(tmp, CACHE_FILE);
    return true;
  } catch (_) {
    try {
      fs.unlinkSync(tmp);
    } catch (_) {
      /* ignore */
    }
    return false;
  }
}

/**
 * 读取共享缓存文件。
 * @returns {{ data: object, fetchedAtMs: number, ageMs: number } | null}
 *   解析失败 / 文件不存在 / 结构不对时返回 null。
 */
function readUsageCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (!raw || typeof raw !== 'object' || !raw.data) return null;
    const fetchedAtMs =
      typeof raw.fetched_at_ms === 'number'
        ? raw.fetched_at_ms
        : Date.parse(raw.fetched_at) || 0;
    return {
      data: raw.data,
      fetchedAtMs,
      ageMs: Math.max(0, Date.now() - fetchedAtMs),
    };
  } catch (_) {
    return null;
  }
}

/**
 * 带共享缓存的用量获取：优先复用其他客户端刚写过的新鲜结果，否则再去打接口。
 * 拿到新数据后会写回共享缓存。
 * @param {object} [opts]
 * @param {number} [opts.maxAgeMs=0] 共享缓存在该时长内视为新鲜并直接复用；0 表示不复用、强制请求
 * @returns {Promise<{ data: object, fromCache: boolean, fetchedAtMs: number }>}
 */
async function getUsageShared(opts) {
  const maxAgeMs = (opts && opts.maxAgeMs) || 0;

  if (maxAgeMs > 0) {
    const cached = readUsageCache();
    if (cached && cached.ageMs <= maxAgeMs) {
      return {
        data: cached.data,
        fromCache: true,
        fetchedAtMs: cached.fetchedAtMs,
      };
    }
  }

  const data = await getUsage();
  const at = Date.now();
  writeUsageCache(data, at);
  return { data, fromCache: false, fetchedAtMs: at };
}

// User-Agent 用的 claude-code 版本号。实测 /api/oauth/usage 不校验该值
// （乱填 0.0.0、甚至完全不带都返回 200），所以用一个固定常量即可，无需探测本机版本。
const CLIENT_VERSION = '2.0.0';

/** expiresAt 可能是毫秒或秒，统一归一化为毫秒。0/缺失视为不检查。 */
function expiresAtMs(creds) {
  let t = creds.expiresAt;
  if (!t) return 0;
  if (t < 1e12) t = t * 1000; // 秒 -> 毫秒
  return t;
}

/**
 * 调用 Anthropic OAuth 用量接口，返回原始 JSON：
 * {
 *   five_hour:        { utilization, resets_at },
 *   seven_day:        { utilization, resets_at },
 *   seven_day_opus:   { utilization, resets_at } | null,
 *   seven_day_sonnet: { utilization, resets_at } | null,
 *   extra_usage:      { is_enabled, monthly_limit, used_credits, utilization }
 * }
 */
function getUsage() {
  return new Promise((resolve, reject) => {
    let creds;
    try {
      creds = readCredentials();
    } catch (e) {
      return reject(e);
    }

    const exp = expiresAtMs(creds);
    if (exp && Date.now() > exp) {
      const e = new Error(
        l10n.t('Claude Code login expired. Run `claude` in a terminal to log in again.')
      );
      e.code = 'EXPIRED';
      return reject(e);
    }

    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/api/oauth/usage',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': `claude-code/${CLIENT_VERSION}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          const code = res.statusCode;
          if (code === 200) {
            try {
              resolve(JSON.parse(body));
            } catch (_) {
              reject(new Error(l10n.t('Failed to parse usage response')));
            }
          } else if (code === 429) {
            const e = new Error(
              l10n.t('Rate limited (429). Increase the refresh interval.')
            );
            e.code = 'RATE_LIMIT';
            reject(e);
          } else if (code === 401 || code === 403) {
            const e = new Error(
              l10n.t('Authentication failed; credentials may be invalid. Please log in again.')
            );
            e.code = 'AUTH';
            reject(e);
          } else {
            reject(new Error(l10n.t('Usage API returned HTTP {0}', String(code))));
          }
        });
      }
    );

    req.on('error', (e) => reject(e));
    req.setTimeout(15000, () =>
      req.destroy(new Error(l10n.t('Usage API request timed out')))
    );
    req.end();
  });
}

module.exports = {
  getUsage,
  getUsageShared,
  writeUsageCache,
  readUsageCache,
  readCredentials,
  CACHE_FILE,
};
