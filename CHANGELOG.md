# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
