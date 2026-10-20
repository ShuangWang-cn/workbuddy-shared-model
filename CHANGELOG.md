# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Locate `WorkBuddy.exe` when the uninstaller's `DisplayIcon` value carries an icon
  index suffix (e.g. `D:\Program Files\Tencent\WorkBuddy\WorkBuddy.exe,0`). The
  suffix made `os.path.isfile()` fail, so the registry lookup always came back empty;
  an empty `InstallLocation` could likewise produce a bare relative `WorkBuddy.exe`
  candidate.
- Scan `<drive>:\Program Files\<vendor>\WorkBuddy\` as a fallback, so installs outside
  the default directories (e.g. `D:\Program Files\Tencent\WorkBuddy`) are found even
  when the registry lookup yields nothing.

## [1.0.0] — 2026-10-07

First public release.

### Added

- Desktop app that resolves the signed-in WorkBuddy account locally and
  produces a live configuration profile (account, endpoint, credential expiry,
  model catalogue with credit multipliers).
- Per-target configuration guides, generated per app:
  - **DeepSeek Harness** — bundled plugin, no need to keep the app running.
  - **OpenCode** — writes `opencode.jsonc`, connects directly.
  - **General** — field reference and error-mapping table for any other
    OpenAI-compatible tool.
- Local protocol bridge (OpenAI + Anthropic) for tools that need one.
- Model list with credit multipliers, sorted cheapest-first.

### Notes

- Windows only.
- Requires administrator permission: WorkBuddy is an Electron app and reading
  its stored credentials needs elevated access.
- Depends on WorkBuddy's internal client interface, which carries no public
  stability guarantee.
