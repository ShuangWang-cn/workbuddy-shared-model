# -*- coding: utf-8 -*-
"""
wbsites.py —— 第三方 AI 工具的「落点规则表」

这里一条规则都不写死在本机路径上，只写**相对定位规则**：
  * 用 %USERPROFILE% / $HOME / ~ 这类变量，或让执行方自己 ls / dir 找；
  * 找不到就跳过并报告，绝不猜路径、绝不写机器专属的绝对路径。

AI 拿到这份表之后，是「自己在本机逐条探测」还是「先探测再挑一条」，由执行方决定。
"""
import os

# 每条规则：
#   key        工具标识
#   title      中文名
#   protocol   openai / anthropic
#   files      相对定位表达式（给 AI 当 grep 目标用，都是通用写法）
#   probe      通用探测命令（Windows / POSIX 各一）
#   how        改法说明
#   verify     验证命令（通用）
SITES = [
    {
        "key": "dsh", "title": "DSH（deepseek-harness / cordis）", "protocol": "openai",
        "files_win": r"%USERPROFILE%\.dsh\profiles\*\cordis.patch.yml",
        "files_pos": r"~/.dsh/profiles/*/cordis.patch.yml",
        "probe": "Windows: dir /s /b %USERPROFILE%\\.dsh\\profiles\\*\\cordis.patch.yml\n"
                 "POSIX:   ls ~/.dsh/profiles/*/cordis.patch.yml",
        "how": "只清点这个文件在不在（只读）。**不读、不写、不改、不备份、不给改法。**",
        "verify": "存在与否由第 2 步直接报给你，不需要额外验证。",
    },
    {
        "key": "codex", "title": "Codex CLI（含桌面版）", "protocol": "openai",
        "files_win": r"%USERPROFILE%\.codex\config.toml",
        "files_pos": r"~/.codex/config.toml",
        "probe": "Windows: dir %USERPROFILE%\\.codex\\config.toml\nPOSIX:   ls ~/.codex/config.toml",
        # ⚠️ 实测踩坑（2026-10-03 真机）：Codex **桌面版**（ChatGPT.exe/Codex.exe，Microsoft Store 版）
        # 只要扫到 config.toml 里出现 [model_providers.workbuddy] 且 wire_api 不是 "responses"，
        # 客户端会直接拒绝启动并报：
        #   failed to load gateway configuration: ... wire_api = "chat" is no longer supported
        # 即使改成 "responses" 也照样连不通——上游 copilot.tencent.com/v2 **没有 /responses 端点（404）**，
        # 且 /chat/completions 只收流式（非流回 11101）。所以这段 provider 对桌面版是纯毒药。
        # 桌面版本来靠 base_url = http://127.0.0.1:15721/v1 + auth.json 的 PROXY_MANAGED 登录态，
        # 网关进程没起才会报「无法连接到你的网关」——那是另一回事，把应用开起来即可。
        # 本工具只做「只读清点」：告诉你机器上这个文件在不在，**绝不读写它、更不给改法**。
        # 各家工具怎么接 WorkBuddy 由用户自己按当下的资料弄，我们不趟这趟浑水。
        "how": "只清点这个文件在不在（只读）。**不读、不写、不改、不备份、不给改法。**",
        "verify": "存在与否由第 2 步直接报给你，不需要额外验证。",
    },
    {
        "key": "claude", "title": "Claude Code", "protocol": "anthropic",
        # 两个候选都可能：Windows 版 Claude Code 有的版本放 %APPDATA%\claude，有的放 ~/.claude
        "files_win": r"%APPDATA%\claude\settings.json|~\.claude\settings.json",
        "files_pos": r"~/.claude/settings.json|~/.config/claude/settings.json",
        "probe": "Windows: dir %APPDATA%\\claude\\settings.json && dir %USERPROFILE%\\.claude\\settings.json\n"
                 "POSIX:   ls ~/.claude/settings.json",
        "how": "只清点这个文件在不在（只读）。**不读、不写、不改、不备份、不给改法。**",
        "verify": "存在与否由第 2 步直接报给你，不需要额外验证。",
    },
    {
        "key": "opencode", "title": "OpenCode", "protocol": "openai",
        "files_win": r"~\.config\opencode\opencode.json|~\.config\opencode\opencode.jsonc"
                     r"|%APPDATA%\opencode\opencode.jsonc",
        "files_pos": r"~/.config/opencode/opencode.json|~/.config/opencode/opencode.jsonc",
        "probe": "Windows: dir /s /b %APPDATA%\\opencode\\opencode.json*\n"
                 "POSIX:   ls ~/.config/opencode/opencode.json*",
        "how": "只清点这个文件在不在（只读）。**不读、不写、不改、不备份、不给改法。**",
        "verify": "存在与否由第 2 步直接报给你，不需要额外验证。",
    },
    {
        "key": "hermes", "title": "Hermes", "protocol": "openai",
        "files_win": r"%USERPROFILE%\.hermes\config.yaml",
        "files_pos": r"~/.hermes/config.yaml",
        "probe": "Windows: dir /s /b %USERPROFILE%\\.hermes\\config.yaml\n"
                 "POSIX:   ls ~/.hermes/config.yaml",
        "how": "只清点这个文件在不在（只读）。**不读、不写、不改、不备份、不给改法。**",
        "verify": "存在与否由第 2 步直接报给你，不需要额外验证。",
    },
    {
        "key": "cursor", "title": "Cursor（桌面 IDE）", "protocol": "openai",
        "files_win": r"%APPDATA%\Cursor\User\settings.json|~\.cursor\settings.json",
        "files_pos": r"~/.config/Cursor/User/settings.json",
        "probe": "Windows: dir %APPDATA%\\Cursor\\User\\settings.json\n"
                 "POSIX:   ls ~/.config/Cursor/User/settings.json",
        "how": "只清点这个文件在不在（只读）。**不读、不写、不改、不备份、不给改法。**",
        "verify": "存在与否由第 2 步直接报给你，不需要额外验证。",
    },
]


def detect_sites():
    """
    本机探测：只用来在界面上显示「这几个工具在你机器上哪个文件在不在」，
    给 AI 文本当参考。返回 [(规则, 本机绝对路径, 是否存在, 里面是否已经有 workbuddy 字样), ...]
    找不到的一律 marked 存在=False，绝不替它编一个路径。
    """
    out = []
    for s in SITES:
        rel = s["files_win"] if os.name == "nt" else s["files_pos"]
        # 多个候选用 | 隔开；每个候选再展开 %VAR% / ~ 以及通配符
        found = ""
        for tok in rel.split("|"):
            for c in _expand(tok.strip()):
                if not c:
                    continue
                if "*" in c:
                    import glob
                    hit = [p for p in glob.glob(c) if os.path.isfile(p)]
                    if hit:
                        hit.sort(key=len)
                        found = hit[0]
                        break
                elif os.path.isfile(c):
                    found = c
                    break
            if found:
                break
        entry = dict(s)
        entry["path"] = found
        entry["exists"] = bool(found)
        entry["hasWorkbuddy"] = False
        entry["size"] = 0
        if found:
            try:
                entry["size"] = os.path.getsize(found)
                with open(found, "r", encoding="utf-8", errors="ignore") as f:
                    entry["hasWorkbuddy"] = "workbuddy" in f.read().lower()
            except Exception:
                pass
        out.append(entry)
    return out


def _expand(rel):
    """把 %VAR%/~ 展开成一个（可能多个）候选路径；通配符原样保留交给调用方 glob"""
    v = os.path.expandvars(rel)
    if v.startswith("~"):
        v = os.path.expanduser("~") + v[1:]
    return [v]
