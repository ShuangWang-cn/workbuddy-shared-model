# -*- coding: utf-8 -*-
"""
wbresolve.py —— WorkBuddy 本地凭据解析核心（Python 版）

把 WorkBuddy 桌面端存在本机磁盘上的加密凭据解出明文 accessToken，
再拉上游模型目录，得出「第三方 AI 工具手动配置 / 自动生成配置」所需的全部字段。

原理（与 dsh-connect-workbuddy 插件、以及 WorkBuddy 5.6.0+ 客户端一致）：
  1. 凭据文件里 accessToken / refreshToken / nickname 等并不是明文，
     而是 {"$wbEncrypted":1,"envelope":"<base64>"} 信封。
  2. 信封 = {suite, keyId, nonce, authTag, ciphertext}。
  3. 解密密钥由 WorkBuddy 自身的 Electron 内部绑定导出：
        ELECTRON_RUN_AS_NODE=1 时执行 WorkBuddy.exe -e "<js>"，
        调用 process._linkedBinding('electron_browser_workbuddy_storage').loggerGet()
        拿到 {atRestSecretKey: "<base64>"}，取 SHA-256 的前 32 字节当 AES-256 密钥。
  4. AES-256-GCM 解密，AAD 由 WB-AAD\0 + suite + keyId 等拼出来，tag 长度 16。
"""
import base64
import hashlib
import json
import os
import string
import time
import struct
import subprocess
import sys
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# ---------------------------------------------------------------- 常量

# 定位 WorkBuddy.exe 靠「扫」，不靠写死路径——这台机器在 D 盘、那台在 C 盘、还有人装到 %LOCALAPPDATA%
# 每一项都是通用位置（不含任何具体盘符/用户名），磁盘上真有才认。
APP_CANDIDATES = [
    r"{LOCALAPPDATA}\WorkBuddy\WorkBuddy.exe",
    r"{LOCALAPPDATA}\Programs\WorkBuddy\WorkBuddy.exe",
    r"{LOCALAPPDATA}\Programs\*\WorkBuddy\WorkBuddy.exe",
    r"{LOCALAPPDATA}\Programs\*\WorkBuddy*\WorkBuddy.exe",
    r"{LOCALAPPDATA}\Programs\*\WorkBuddy*\WorkBuddy\WorkBuddy.exe",
    r"{PROGRAMFILES}\WorkBuddy\WorkBuddy.exe",
    r"{PROGRAMFILES}\*\WorkBuddy*\WorkBuddy.exe",
    r"{PROGRAMFILESX86}\WorkBuddy\WorkBuddy.exe",
    r"{PROGRAMFILESX86}\*\WorkBuddy*\WorkBuddy.exe",
    r"{USERPROFILE}\AppData\Local\WorkBuddy\WorkBuddy.exe",
    r"{USERPROFILE}\AppData\Local\Programs\WorkBuddy\WorkBuddy.exe",
]

# 最后兜底：常见盘符根（有就认，没有就跳过）
APP_FALLBACK_ROOTS = [r"{DRIVE}\WorkBuddy\WorkBuddy.exe" for _ in "CDE"]


def _expand(p):
    v = p
    v = v.replace("{LOCALAPPDATA}", os.environ.get("LOCALAPPDATA") or "")
    v = v.replace("{PROGRAMFILES}", os.environ.get("ProgramFiles") or "")
    v = v.replace("{PROGRAMFILESX86}", os.environ.get("ProgramFiles(x86)") or "")
    v = v.replace("{USERPROFILE}", os.path.expanduser("~"))
    return v

AUTH_REL = ("CodeBuddyExtension", "Data", "Public", "auth", "workbuddy-desktop.info")

# 客户端本地硬编码（来自 WorkBuddy app.asar）：每日限免额度用完后自动切付费线
PAID_LINES = [
    {"freeId": "hy3", "paidId": "hy3-x", "displayName": "Hy3"},
    {"freeId": "hy4", "paidId": "hy4-x", "displayName": "Hy4"},
]

# 本地代理（老 wbbridge 套件里的 OpenAI 兼容代理）
LOCAL_PROXY_BASE = "http://127.0.0.1:18790/v1"
LOCAL_PROXY_KEY = "wb-local"


# ---------------------------------------------------------------- 工具函数

def _lp(s: bytes) -> bytes:
    """length-prefixed field（大端 u32 + 内容）"""
    return struct.pack(">I", len(s)) + s


def aad_bytes(key_id: str, suite: int) -> bytes:
    """
    构造 AES-GCM 的 AAD。
    注意：开头的结构版本号和结尾的 framing code 在客户端里都是**单字节**，不是 4 字节整数，
    这里曾经栽过跟头（写成 u32 后 InvalidTag）。
    """
    return (
        b"WB-AAD\0"
        + b"\x01"                      # structure version（单字节）
        + _lp(b"WBEV1")                # format id
        + _lp(b"sym-v1")               # scheme
        + struct.pack(">I", suite)     # suite（4 字节）
        + _lp(key_id.encode("utf-8"))  # keyId
        + b"\x02"                      # framing code（单字节）
        + b"\x00"                      # 两个占位（单字节）
        + b"\x00"
    )


def _b64d(x):
    if isinstance(x, str):
        return base64.b64decode(x)
    if isinstance(x, (bytes, bytearray)):
        return base64.b64decode(bytes(x))
    raise ValueError("bad base64 field")


def open_envelope(wrap, key: bytes) -> str:
    """解一个信封字段；本来就是明文则返回原文"""
    if not isinstance(wrap, dict) or wrap.get("$wbEncrypted") != 1:
        return wrap if isinstance(wrap, str) and wrap else ""
    env = json.loads(_b64d(wrap.get("envelope")).decode("utf-8"))
    kid = hashlib.sha256(key).hexdigest()[:16]
    if str(env.get("keyId")) != kid:
        raise ValueError("信封 keyId 与本地密钥不匹配（WorkBuddy 版本变了？）")
    aad = aad_bytes(str(env.get("keyId")), int(env.get("suite", 0)))
    plain = AESGCM(key).decrypt(_b64d(env.get("nonce")), _b64d(env.get("ciphertext")) + _b64d(env.get("authTag")), aad)
    return plain.decode("utf-8")


def parse_rate(v):
    """从 'x0.79 credits' / 'x0.05' 里抠出倍率数字"""
    if not isinstance(v, str):
        return None
    import re
    m = re.search(r"x\s*([0-9]*\.?[0-9]+)", v, re.I)
    if not m:
        return None
    try:
        n = float(m.group(1))
    except ValueError:
        return None
    return n if n >= 0 and n < 1000 else None


def base_of(domain: str) -> str:
    return "https://www.workbuddy.ai" if "workbuddy.ai" in (domain or "") else "https://copilot.tencent.com"


def _reg_apps():
    """从卸载表里找 WorkBuddy（比猜盘符靠谱，装在哪个盘都能认出来）"""
    try:
        import winreg
    except Exception:
        return []
    out = []
    roots = ((winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
             (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
             (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"))
    for root, sub in roots:
        try:
            k = winreg.OpenKey(root, sub)
        except Exception:
            continue
        i = 0
        while True:
            try:
                sub2 = winreg.EnumKey(k, i)
                i += 1
            except OSError:
                break
            try:
                s = winreg.OpenKey(k, sub2)
                try:
                    name = winreg.QueryValueEx(s, "DisplayName")[0]
                except Exception:
                    name = ""
                if "workbuddy" not in str(name).lower():
                    continue
                try:
                    di = winreg.QueryValueEx(s, "DisplayIcon")[0]
                except Exception:
                    di = ""
                try:
                    il = winreg.QueryValueEx(s, "InstallLocation")[0]
                except Exception:
                    il = ""
                if isinstance(di, str) and di.strip() and os.path.isfile(di.strip().strip('"')):
                    out.append(di.strip().strip('"'))
                if il:
                    cand = os.path.join(il, "WorkBuddy.exe")
                    out.append(cand)
            except Exception:
                pass
        try:
            winreg.CloseKey(k)
        except Exception:
            pass
    return out


def _drive_letters():
    """拿系统里所有**逻辑盘**的盘符（本地盘 / U盘 / 映射盘都算），不写死任何字母。

    GetLogicalDrives 不是往 buffer 里写字符串，而是**直接返回一个位掩码**（bit i = 第 i 个字母盘），
    早先按字符串解析结果是 A~Z 一整条，全抖出来白扫一遍。
    """
    if os.name != "nt":
        return list(string.ascii_uppercase)
    try:
        import ctypes
        mask = ctypes.windll.kernel32.GetLogicalDrives()
        if not mask:
            raise ValueError("GetLogicalDrives 返回 0")
        return [chr(ord("A") + i) for i in range(26) if mask & (1 << i)]
    except Exception:
        return list(string.ascii_uppercase)


def _drive_paths():
    """装在工作盘根目录下的情况（D:\\WorkBuddy\\WorkBuddy.exe 只是其中一种）——
    把系统里每个盘的根目录都试一遍：以前写死 C/D/E/F/M 只有这台机器认得，
    别人装到别的盘就找不到。现在盘符由系统给，别人电脑自带认得。"""
    out = []
    for d in _drive_letters():
        root = "%s:\\" % d
        if not os.path.isdir(root):
            continue
        out.append(root + "WorkBuddy\\WorkBuddy.exe")
        out.append(root + "WorkBuddy\\app\\WorkBuddy.exe")
    return out


def find_app():
    """扫通用位置找 WorkBuddy.exe；含通配符的用 glob 展开。找不到返回 ''。"""
    import glob
    for p in _reg_apps():
        if os.path.isfile(p):
            return p
    cands = list(APP_CANDIDATES) + _drive_paths()
    seen = set()
    for tpl in cands:
        p = _expand(tpl)
        if not p:
            continue
        if "*" in p:
            hit = [x for x in glob.glob(p) if os.path.isfile(x)]
            hit.sort(key=len)
            for h in hit:
                if h not in seen:
                    seen.add(h)
                    return h
        elif p not in seen and os.path.isfile(p):
            seen.add(p)
            return p
    return ""


def find_auth():
    local = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Local")
    return os.path.join(local, *AUTH_REL)


class ElevationRequired(RuntimeError):
    """标准用户环境下缺少 SeCreateTokenPrivilege，Electron 起沙箱子进程被拒（WinError 740）"""


def is_admin() -> bool:
    """当前进程是不是「管理员权限」在跑（高完整性令牌 IntegrityLevel >= 0x2000）"""
    if os.name != "nt":
        return False
    try:
        import ctypes
        token = ctypes.windll.advapi32.OpenProcessToken(-4, 0x0008)  # -4=当前进程, TOKEN_QUERY
        class _TI(ctypes.Structure):
            _fields_ = [("TokenType", ctypes.c_int),
                        ("ImpersonateLevel", ctypes.c_int),
                        ("IntegrityLevel", ctypes.c_int)]
        ti = _TI()
        ctypes.windll.advapi32.GetTokenInformation(token, 18, ctypes.byref(ti),
                                                   ctypes.sizeof(ti), ctypes.byref(ctypes.c_long()))
        ctypes.windll.kernel32.CloseHandle(token)
        return ti.IntegrityLevel >= 0x2000
    except Exception:
        return False


ELEVATE_HINT = (
    "还差一步权限 —— 读 WorkBuddy 的密钥必须要有管理员权限，\n"
    "这是 Windows 定的规矩，不是本程序能绕过去的。\n\n"
    "正常情况下：本程序已经做成「双击就是管理员」，双击后系统会问你一句\n"
    "「是否允许运行」，你点「是」就行，之后一切都顺。\n\n"
    "如果没看到那个提问（说明你电脑把 UAC 提示关了，或者公司电脑锁了），就：\n"
    "    1) 关掉本窗口，右键 WBBridgeConfig.exe → 以管理员身份运行；\n"
    "    2) 想以后再也不用管：右键 exe → 属性 → 兼容性 → 勾「以管理员身份运行此程序」。\n"
)

ADMIN_HINT = (
    "提示：现在是以普通权限在跑的，读 WorkBuddy 密钥有可能被系统拦下。\n"
    "建议点下面的「用管理员重开」，弹一下窗点「是」就好，之后一直顺。"
)


def _at_rest_key(exe: str) -> bytes:
    """借 WorkBuddy 自身的 Electron 内部绑定导出主密钥"""
    code = ("try{process.stdout.write(process._linkedBinding('electron_browser_workbuddy_storage')"
            ".loggerGet())}catch(e){process.exitCode=3;process.stderr.write(String((e&&e.message)||e))}")
    env = dict(os.environ)
    env["ELECTRON_RUN_AS_NODE"] = "1"
    env.pop("PYTHONPATH", None)
    try:
        cp = subprocess.run([exe, "-e", code], env=env, capture_output=True, timeout=60)
    except OSError as e:
        if getattr(e, "winerror", None) == 740 or "740" in str(e) or "需要提升" in str(e):
            raise ElevationRequired(ELEVATE_HINT)
        raise
    if cp.returncode != 0 or not cp.stdout:
        raise RuntimeError("取主密钥失败：%s（WorkBuddy 可能没装在该路径，或版本不支持）" %
                           (cp.stderr.decode("utf-8", "replace")[:200] or "空输出"))
    secret = json.loads(cp.stdout.decode("utf-8", "replace")).get("atRestSecretKey", "")
    if not secret:
        raise RuntimeError("主密钥为空")
    return hashlib.sha256(secret.encode("utf-8")).digest()


# ---------------------------------------------------------------- 主流程

def resolve(include_models: bool = True):
    """返回结构化结果 dict；异常直接抛，由 GUI 捕获显示

    顺带给出 timings（分段耗时），用来**自证这趟是真解、真联网**：
        timings.total    —— 整个解析
        timings.decrypt  —— 借 WorkBuddy 自己的 exe 导出主密钥、解开信封
        timings.net      —— 拿解出来的 token 现发一次上游 /models 的往返
    如果 net 恒为 0，说明根本没联网、模型就是从本机别处扒来的。
    """
    _t_start = time.time()
    exe = find_app()
    auth_file = find_auth()
    if not os.path.isfile(auth_file):
        raise FileNotFoundError("找不到凭据文件：\n%s\n（先打开 WorkBuddy 桌面端并登录一次）" % auth_file)
    if not exe:
        raise FileNotFoundError("找不到 WorkBuddy.exe，请把 D:\\WorkBuddy\\WorkBuddy.exe 路径告诉我")

    with open(auth_file, "r", encoding="utf-8") as f:
        doc = json.load(f)
    auth = doc.get("auth", doc) or {}
    acc = doc.get("account", doc) or {}

    _t_decrypt = time.time()
    key = _at_rest_key(exe)

    def plain(v):
        try:
            return open_envelope(v, key)
        except Exception:
            return ""

    access_token = auth.get("accessToken")
    access_token = access_token if isinstance(access_token, str) and access_token.startswith("eyJ") else plain(access_token)
    refresh = auth.get("refreshToken")
    refresh = refresh if isinstance(refresh, str) and refresh.startswith("eyJ") else (plain(refresh) if refresh else "")
    if not access_token:
        raise RuntimeError("解出 accessToken 为空（WorkBuddy 版本升级改了加密格式，需要更新本工具）")

    domain = auth.get("domain") or "www.workbuddy.cn"
    base = base_of(domain)
    exp = auth.get("expiresAt") or 0
    exp_ms = exp if exp > 0xE8D4A51000 else exp * 1000

    out = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "appPath": exe,
        "authFile": auth_file,
        "account": {
            "nickname": plain(acc.get("nickname")),
            "uid": plain(acc.get("uid")),
            "domain": domain,
        },
        "endpoints": {
            "baseUrl": base,
            "chatCompletions": base + "/v2/chat/completions",
            "tokenRefresh": base + "/v2/plugin/auth/token/refresh",
            "modelCatalog": base + "/v2/enterprises/personal/models",
        },
        "credential": {
            "accessToken": access_token,
            "hasRefreshToken": bool(refresh),
            "expiresAtMs": exp_ms,
            "expiresAt": datetime.fromtimestamp(exp_ms / 1000).isoformat() if exp_ms else None,
        },
    }

    if not include_models:
        out["models"] = []
        return out

    import urllib.request as _u
    _t_net = time.time()
    req = _u.Request(base + "/v2/enterprises/personal/models", headers={
        "content-type": "application/json",
        "authorization": "Bearer " + access_token,
    })
    with _u.urlopen(req, timeout=30) as r:
        j = json.loads(r.read().decode("utf-8"))
    _net_cost = time.time() - _t_net
    data = (j.get("data") or {})
    raw = data.get("models") or []

    # 只取 name === "cli" 的那个 agent 的名单（插件 selectCliModels 就是这么干的；
    # 早期版本把所有 agent 的 models 都合并了，结果比 DSH 里看到的模型多一截）
    cli_ids, cli_roster = None, []
    for a in (data.get("agents") or []):
        if isinstance(a, dict) and a.get("name") == "cli" and isinstance(a.get("models"), list):
            cli_ids = [x for x in a["models"] if isinstance(x, str)]
            break
    for m in raw:
        if m.get("disabled") is True:
            continue  # 上游显式禁用的，插件里也不出现
        if not isinstance(m.get("id"), str) or not m.get("id"):
            continue
        if m.get("maxInputTokens", 0) <= 0 or m.get("maxOutputTokens", 0) <= 0:
            continue  # 纯图片模型
        cli_roster.append(m["id"])
    roster = set(cli_ids if cli_ids else cli_roster)

    models = []
    for m in raw:
        if m.get("disabled") is True or not isinstance(m.get("id"), str) or not m.get("id"):
            continue
        if m.get("maxInputTokens", 0) <= 0 or m.get("maxOutputTokens", 0) <= 0:
            continue  # 纯图片模型
        if str(m["id"]).startswith(("auto", "fast-model", "balanced-model", "deep-model")):
            continue  # auto 那几档是客户端本地分身，WorkBuddy 界面里也不列，剔掉
        models.append({
            "id": m.get("id"),
            "upstreamName": m.get("name") or m.get("id"),
            "displayName": m.get("name") or m.get("id"),
            "creditMultiplier": parse_rate(m.get("credits")),
            "creditsRaw": m.get("credits"),
            "contextWindow": m.get("maxInputTokens"),
            "maxTokens": m.get("maxOutputTokens"),
            "supportsImages": m.get("disabledMultimodal") is not True and m.get("supportsImages") is True,
            "reasoning": m.get("reasoning") or m.get("effort") or None,
            "descriptionZh": m.get("descriptionZh"),
            "inCliRoster": m.get("id") in roster,
            "tier": None,
        })

    for line in PAID_LINES:
        for m in models:
            if m["id"] == line["freeId"]:
                m["tier"] = "每日限免（额度用完切 %s）" % line["paidId"]
            elif m["id"] == line["paidId"]:
                m["tier"] = "付费线（%s 限免用完后走这里）" % line["freeId"]

    seen = {}
    for m in models:
        n = seen.get(m["upstreamName"], 0) + 1
        seen[m["upstreamName"]] = n
        if n > 1:
            short = m["id"].split("-")[-1]
            m["displayName"] = "%s (%s)" % (m["upstreamName"], short)

    models.sort(key=lambda x: (x["creditMultiplier"] if x["creditMultiplier"] is not None else 1e9, x["id"]))
    out["models"] = models
    out["timings"] = {
        "total": round(time.time() - _t_start, 3),
        "decrypt": round(time.time() - _t_decrypt, 3),
        "net": round(_net_cost if include_models else 0.0, 3),
    }
    out["stats"] = {
        "total": len(models),
        "inRoster": sum(1 for m in models if m["inCliRoster"]),
        "freeTier": [l["freeId"] for l in PAID_LINES],
        "rosterCount": len(roster),
        "cliRoster": cli_ids or [],
    }
    return out


if __name__ == "__main__":
    r = resolve()
    if "--json" in sys.argv:
        print(json.dumps(r, ensure_ascii=False, indent=2))
    else:
        print(json.dumps(r, ensure_ascii=False, indent=2)[:4000])
        print("\n[ok] 账号=%s 模型=%s 推荐=%s" % (
            r["account"].get("nickname"), len(r.get("models", [])),
            [m["id"] for m in r.get("models", []) if m.get("inCliRoster")][:6]))
