# workbuddy 共享工具（workbuddy-shared-model）

> 把本机 **WorkBuddy** 的模型与积分，接进你常用的第三方 AI 工具。
> 一次配置，长期使用。**支持所有能填「API 地址 + Key」的 AI 软件。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows-blue.svg)](README.md)
[![Language: Python](https://img.shields.io/badge/python-3.10%2B-blue.svg)](src/wbsrv.py)

---

## 这是什么

如果你手里有 WorkBuddy 的积分，却只能花在工作buddy 自己的界面里，
这个工具帮你**把这份额度接到别的 AI 工具上**——比如 DeepSeek Harness、OpenCode，
以及任何支持「自定义 OpenAI 兼容接口」的 AI 软件。

**它是怎么工作的：**

```
你的第三方 AI 软件  ──►  本工具  ──►  WorkBuddy 官方接口
   （dsh / opencode…）      （本地运行）      （用你自己的账号）
```

本工具在你电脑上**读出** WorkBuddy 已登录的账号凭据，
换成一份配置资料，再生成一段**可以交给 AI 助手照着做的安装说明**。
凭据不会经过任何第三方服务器。

**两条路线，按需选择：**

| 路线 | 适用软件 | 是否需要常开本工具 |
|---|---|---|
| **插件模式** | DeepSeek Harness | ❌ 不需要，装一次长期有效 |
| **直连 / 本地桥模式** | OpenCode、Cursor、Cline 等 | 视配置方式而定（直连不需要） |

---

## 已实测跑通的软件

| 软件 | 状态 | 说明 |
|---|---|---|
| **DeepSeek Harness** | ✅ 已验证 | 装配套插件，免常开本工具 |
| **OpenCode** | ✅ 已验证 | 写入 `opencode.jsonc`，直连 |

> **适用范围说明**：本工具的设计目标是**适用于所有支持外部模型的 AI 软件**
> （凡是能填「API 地址 / Base URL + API Key」的地方都可以）。
> 由于各家软件的配置格式差异很大且版本更迭很快，
> 我们目前**完整实测跑通并提供分步说明的是上面两个**——
> 其他软件请参考「通用」页的思路自行适配（界面里切换到「通用」标签页即可拿到字段表与报错对照）。

---

## 快速开始

### 第 1 步 · 编译（可选）

如果你只想用现成的成品，可以跳过这步，从「发布」页下载。

需要 Python 3.10+：

```bash
pip install pyinstaller pywebview cryptography
cd src
python -m PyInstaller "workbuddy共享模型.spec" --noconfirm
```

> ⚠️ **请不要加 `--clean` 参数**（会触发部分环境的批量删除保护而卡住）。
> 成品在 `dist/` 目录下。

### 第 2 步 · 运行

双击 `dist/workbuddy共享模型.exe`。

> **Windows 可能会弹一次「需要管理员权限」——请点「是」。**
> 因为 WorkBuddy 是 Electron 程序，读取其登录凭据需要系统授权。
> 之后可在exe 属性 → 兼容性里勾选「以管理员身份运行」，永久免再弹。

### 第 3 步 · 解析

点「**开始解析 WorkBuddy**」，约半秒出结果。

界面会显示本机账号、接口地址、有效期、以及可用模型清单（含积分倍率）。
**这些数字都是现场从官方接口拉取的实时值**，不是预置的。

### 第 4 步 · 配置你的软件

选一个标签页（DeepSeek Harness / OpenCode / 通用），点「**复制全文**」，
粘贴给对话里的 AI 助手。它会照着说明把配置完成，并**实际发一次请求**验证。

---

## 目录结构

```
workbuddy-shared-model/
├── README.md              本文件（对外说明）
├── LICENSEMIT 许可证
├── .gitignore
├── src/                   主程序源码
│   ├── wbsrv.py             主服务 + 本地桥 + 内嵌窗口（入口）
│   ├── wbresolve.py         凭据解析 + 模型目录获取
│   ├── wbtargets.py         各软件的配置说明生成器
│   ├── wbwriter.py          字段表 / JSON 生成
│   ├── wbanthropic.py       Anthropic ↔ OpenAI 协议转换
│   ├── wbsites.py           第三方软件配置位置探测（只读）
│   ├── index.html           界面
│   └── workbuddy共享模型.spec
│
├── plugin/               DeepSeek Harness 插件
│   ├── package.json
│   ├── cordis.patch.yml
│   └── lib/
│
└── docs/
    └── 使用说明.md用户向的详细用法
```

---

## 常见问题

**Q：需要一直开着这个工具吗？**
A：看情况。DeepSeek Harness 装插件后不需要；OpenCode 直接填官方地址也不需要。
只有当某个软件被配置成走本地桥（`127.0.0.1:18791`）时才需要常开。

**Q：安全吗？会泄露我的账号吗？**
A：所有解析都在你自己的电脑上完成，不上传任何数据。
生成的配置文件里包含你的凭据，**请不要把它提交到代码仓库或分享给别人**。

**Q：为什么界面要管理员权限？**
A：见第 2 步的说明，这是系统限制，工具无法绕过。

**Q：模型列表里的「×0.x」是什么？**
A：积分倍率。数字越小越省。工具会按倍率从低到高排序，方便挑选。

---

## 免责声明

本项目为**个人自用**工具，与腾讯公司无任何关联，非官方产品。

- 本项目**不提供**多账号池管理、不做自动签到刷分、不提供额度对外分发。
- 请仅在**你自己的账号**上使用。
- 使用前请自行确认符合你所使用的 WorkBuddy / CodeBuddy 的用户协议，
  因使用本工具产生的一切后果由使用者自行承担。

**接口稳定性**：本工具依赖 WorkBuddy 客户端的内部接口，
该接口**没有公开的稳定性承诺**，官方随时可能调整。
若上游变更导致失效，请更新到仓库最新版。

---

## License

[MIT](LICENSE) © 2026
