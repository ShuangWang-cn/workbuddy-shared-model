# WorkBuddy Credits Bridge

[English](README.md) | [简体中文](README.zh-CN.md)

> **Let any AI tool spend your WorkBuddy credits.**
> Connect DeepSeek Harness, OpenCode, Cursor, Cline and more to your WorkBuddy
> account so they run on the same credits you already have.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows-blue.svg)](README.md)

---

## The problem

You have WorkBuddy credits. But they only work inside WorkBuddy's own window.
So you end up switching back and forth between WorkBuddy and whatever AI tool
you actually prefer writing in.

**This bridge removes that limitation.** It reads the WorkBuddy account
already signed in on your computer and shares those credits with other AI
tools — including the ones with no official WorkBuddy integration at all.

```
  DeepSeek Harness┐
  OpenCode           ├──►  this bridge  ──►  WorkBuddy credits
  Cursor / Cline     ┘      (runs locally)      (your own account)
```

Nothing is uploaded. Your credentials never leave your machine.

---

## Supported tools

| Tool | Status |
|---|---|
| **DeepSeek Harness** | ✅ Verified working |
| **OpenCode** | ✅ Verified working |
| Other OpenAI-compatible tools | 🔧 Adaptable — see the *General* tab in the app |

---

## Why not just use a script

Because the hard part is not the API call — it is everything around it:
credential format, the exact request headers the endpoint expects, streaming
behaviour, per-model capability metadata, and the fact that each AI tool stores
its configuration in a completely different place and format.

The app handles all of that and hands you a configuration guide you can paste
straight into an AI assistant, which then sets everything up and **sends a
real request to verify it actually works**.

For DeepSeek Harness it also ships a plugin, so your credits keep working
without this tool running at all.

---

## Quick start

Requires Windows and Python 3.10+.

```bash
pip install pyinstaller pywebview cryptography
cd src
python -m PyInstaller "workbuddy共享模型.spec" --noconfirm
```

> Do **not** add `--clean` — it can trigger bulk-delete protection and hang the build.

Then run `dist/workbuddy共享模型.exe`, click **"开始解析"** (Parse), and copy the
guide for your target tool into an AI assistant.

See [docs/使用说明.md](docs/使用说明.md) for the full walkthrough and FAQ.

---

## Interface stability

This project relies on WorkBuddy's internal client interface, which carries
**no public stability guarantee** and may change without notice. If an upstream
change breaks it, pull the latest release.

---

## Disclaimer

Personal-use project. **Not affiliated with or endorsed by Tencent.**

Use it only with **your own account**. You are responsible for complying with
the WorkBuddy / CodeBuddy terms of service.

---

## License

[MIT](LICENSE) © 2026
