# Changelog

All notable changes to this extension are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [1.0.0]

### Added
- Status bar item showing Claude Code subscription usage (current 5h session and
  weekly 7d remaining), matching `claude.ai/settings/usage`.
- Hover tooltip with full detail: current session, weekly (all models),
  per-model weekly (Opus / Sonnet), reset times, and extra usage.
- Click to refresh; configurable auto-refresh interval (min 180s).
- Shared cache at `~/.claude/usage-cache.json` so multiple clients/windows can
  reuse a recent response instead of each calling the rate-limited endpoint.
- Bilingual UI (English / 简体中文) via VSCode l10n.
- Credential reading from `~/.claude/.credentials.json`, the macOS Keychain, and
  the Linux Secret Service (libsecret) keyring.
- Settings: `refreshInterval`, `show`, `resetStyle`.
