# WorkBuddy 积分共享桥

[English](README.md) | [简体中文](README.zh-CN.md)

> **让任何 AI 工具都能用上你的 WorkBuddy 积分。**
> 把 DeepSeek Harness、OpenCode、Cursor、Cline 等接上你的 WorkBuddy 账号，
> 用你本来就有���那份额度跑它们。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows-blue.svg)](README.md)

---

## 问题在哪

你有 WorkBuddy 积分，但它只认 WorkBuddy 自己的窗口。
于是你得在 WorkBuddy 和真正顺手写东西的那个 AI 工具之间来回切。

**这座桥就是去掉这个限制的。** 它读出你电脑上已登录的 WorkBuddy 账号，
把那份积分分享给其他 AI 工具——包括那些**官方压根没支持 WorkBuddy** 的工具。

```
  DeepSeek Harness   ┐
  OpenCode           ├──►  这座桥  ──►  WorkBuddy 积分
  Cursor / Cline     ┘     （本地运行）      （你自己的账号）
```

不上传任何数据，你的凭据不出本机。

---

## 支持哪些工具

| 工具 | 状态 |
|---|---|
| **DeepSeek Harness** | ✅ 已实测跑通 |
| **OpenCode** | ✅ 已实测跑通 |
| 其他 OpenAI 兼容类工具 | 🔧 可适配 —— 见工具里的「通用」标签页 |

---

## 为什么不能直接写个脚本

因为难的从来不是那次 API 调用，而是它周围的一切：
凭据格式、接口真正认的那套请求头、流式行为、每个模型的能力信息，
以及每个 AI 工具把配置存在哪儿、存成什么格式。

这些工具全包了，然后给你一段能直接粘给 AI 助手的配置说明——
它照着配完还会**真发一次请求**验证确实通了。

给DeepSeek Harness 还额外配了个插件，装上之后**不用常开这个工具**积分也能用。

---

## 快速开始

需要 Windows + Python 3.10+。

```bash
pip install pyinstaller pywebview cryptography
cd src
python -m PyInstaller "workbuddy共享模型.spec" --noconfirm
```

> **别加 `--clean`** —— 会触发批量删除保护把构建卡死。

然后运行 `dist/workbuddy共享模型.exe`，点「**开始解析**」，
把目标工具的那段说明复制给 AI 助手即可。

完整步骤和常见问题看 [docs/使用说明.md](docs/使用说明.md)。

---

## 接口稳定性

本项目依赖 WorkBuddy 客户端的内部接口，该接口**没有公开的稳定性承诺**，
官方随时可能调整。上游变更导致失效时，请拉取最新版。

---

## 免责声明

个人自用项目，**与腾讯公司无任何关联，非官方产品**。

请仅在**你自己的账号**上使用，并自行确认符合 WorkBuddy / CodeBuddy 的用户协议。

---

## License

[MIT](LICENSE) © 2026
