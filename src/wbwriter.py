# -*- coding: utf-8 -*-
"""
wbwriter.py —— 生成两类东西

  1) agent_text()  : 「给 WorkBuddy 直接执行的任务书」
                     用户把它整段复制、粘进自己正在用的 WorkBuddy 对话框，
                     WorkBuddy 就会**在本机**去取凭据、探测工具落点、备份、写配置、真发一次请求验证。
                     这份文本刻意不含任何本机专属值（不写绝对路径、不写死 token），
                     因此是通用的：发给谁机子上的 WorkBuddy 都能用。
  2) manual_lines(): 手填自定义模型用的逐行字段（每行一键复制），本机专用，含模型清单。

配套的凭据载体是 <用户主目录>/.wbbridge/credential.local.json —— 由 wbsrv 解析成功后落盘，
WorkBuddy 会话里读它**不需要管理员权限**（这是绕开 WinError 740 的关键）。
"""
import json
import os

from wbresolve import LOCAL_PROXY_BASE, LOCAL_PROXY_KEY
import wbsites
# 模型名 / 倍率 / 上下限这几个小工具挪到了 wbtargets（那边按目标出生动文案要用），
# 这里重新导出一份，别的地方照旧 import 不受影响。
from wbtargets import _mul, _k, _auto_split

CRED_REL = (".wbbridge", "credential.local.json")
PROVIDER = "workbuddy"          # 第三方工具里的提供方别名
OPENAI_PROTOCOL = "openai"      # 上游只认流式


# ---------------------------------------------------------------- 选模型

def pick_models(models, k=8):
    """挑模型：客户端名单内 + 有倍率 + 不是 auto 三档分身，按倍率从低到高（省积分优先）"""
    pool = [m for m in models
            if m.get("inCliRoster") and m.get("creditMultiplier") is not None
            and not m["id"].startswith(("fast-model", "balanced-model", "deep-model"))]
    if not pool:
        pool = [m for m in models if m.get("creditMultiplier") is not None]
    seen, out = set(), []
    for m in pool:
        if m["id"] in seen:
            continue
        seen.add(m["id"])
        out.append(m)
    out.sort(key=lambda m: (m["creditMultiplier"] if m["creditMultiplier"] is not None else 1e9, m["id"]))
    return out[:k]


def recommended_ids(res, k=6):
    return [m["id"] for m in pick_models(res.get("models", []), k)]


# ---------------------------------------------------------------- 凭据落盘

def credential_payload(res, port):
    """
    给 WorkBuddy 读的凭据文件。这里**只放本机值，且只放 WorkBuddy 有权限读的东西**
    （都在用户主目录下，中等完整性令牌就能读，不需要提权）。
    """
    models = res.get("models", [])
    picks = pick_models(models, 12)
    return {
        "_source": "WBBridgeConfig.exe 解析结果",
        "generated_at": res["generatedAt"],
        "account": {
            "nickname": res["account"].get("nickname") or "",
            "domain": res["account"].get("domain") or "",
        },
        "endpoints": {
            "base_url": res["endpoints"]["baseUrl"],
            "chat_completions": res["endpoints"]["baseUrl"] + "/v2/chat/completions",
        },
        "credential": {
            "type": "JWT accessToken",
            "access_token": res["credential"]["accessToken"],
            "expires_at": res["credential"].get("expiresAt"),
            "dynamic": True,
        },
        "local_proxy": {
            "enabled": bool(port),
            "base": "http://127.0.0.1:%d/v1" % port if port else "",
            "anthropic_base": "http://127.0.0.1:%d" % port if port else "",
            "api_key": LOCAL_PROXY_KEY,
            "port": port or 0,
            "note": "本机桥：同时接受 OpenAI 与 Anthropic 两种协议；WorkBuddy 会话/第三方工具访问它不需要登录态。",
        },
        "provider_alias": PROVIDER,
        "models": [
            {"id": m["id"], "name": m["upstreamName"], "multiplier": m["creditMultiplier"],
             "context_window": m["contextWindow"], "max_output": m["maxTokens"],
             "in_roster": m["inCliRoster"]}
            for m in models
        ],
        "recommended": [m["id"] for m in picks],
        "constraints": {
            "streaming_only": True,
            "note": "上游仅接受 stream:true 的 Chat Completions 请求；非流会返回 11101。",
        },
    }


def write_credential(res, port, root=None):
    """把凭据写到 <用户主目录>/.wbbridge/credential.local.json，返回绝对路径（失败返回 ''）"""
    try:
        d = os.path.join(root or os.path.expanduser("~"), CRED_REL[0])
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, CRED_REL[1])
        with open(p, "w", encoding="utf-8") as f:
            json.dump(credential_payload(res, port), f, ensure_ascii=False, indent=2)
        return p
    except Exception:
        return ""


# ---------------------------------------------------------------- AI 任务书

def agent_text(res, port=0):
    """输出「给 AI 工具 A 拿去配置另一个 AI 工具 B 的自定义模型」的那一段话。

    2026-10-04 老王定的口径（照此实现，别再自作主张加别的板块）：
      * 这个功能首先是「解析 WorkBuddy 的关键信息（配置模型必配的那几样）」，
        最后加一句让接手方去问用户「要配到本机哪个 AI 程序上」；
      * **不再特指「由 WorkBuddy 去执行第三方工具的配置动作」** —— 那条路还不完善；
      * **不再列「DSH / Claude Code / Codex 的落点探测」** 那一套（老王明确不要）；
      * 具体举例（哪个工具配哪个工具）**不写进文本里**，只留通用问法。
    逻辑：信息交给 AI 工具 A → 用户跟 A 对话 → A 去配置 AI 工具 B 的自定义模型。
    """
    st = res.get("stats", {})
    exp = res["credential"].get("expiresAt") or "未知"
    token = res["credential"]["accessToken"]
    base = res["endpoints"]["baseUrl"]

    L = []
    A = L.append

    A("下面是本机 WorkBuddy 的登录信息，是配置自定义模型**必配**的那几样东西。")
    A("你拿着这些，去帮我把它配进**你要用的那个 AI 程序**（下面把它的名字直接写出来）。")
    A("")
    A("> ⚠ 这一段里有明文密钥，只在本机这几样工具之间传，**别发到公开场合、别贴公开对话**。")
    A("")
    A("## 一、配置模型必配的信息")
    A("")
    A("**1. 接口地址（Base URL）**")
    A("")
    A("```")
    A(base + "/v2")
    A("```")
    A("")
    A("聊天接口完整地址：`%s/v2/chat/completions`；上游**只接受流式请求**（非流会报 11101）。" % base)
    A("")
    A("**2. 密钥（Key）**")
    A("")
    A("填进任何工具时，**只填这一串本身，别自己加 `Bearer ` 前缀**——")
    A("多数工具会自己补 `Bearer `，你再补一层就成 `Bearer Bearer ...` 直接 401。")
    A("")
    A("```")
    A(token)
    A("```")
    A("")
    A("**3. 花的是哪个号 / 什么时候断**")
    A("")
    A("- 账号：%s" % (res["account"].get("nickname") or "(本机 WorkBuddy 账号)"))
    A("- 这个 key 到 **%s** 过期（WorkBuddy 一换登录态它就跟着变，变了要重新解析）" % exp)
    A("")
    A("**4. 模型清单（可用 %s 个）**" % st.get("inRoster"))
    A("")
    A("下面只列**填了能用**的那批（上游开给客户端的 id）。目录里另外 %s 个"
      % ((st.get("total") or 0) - (st.get("inRoster") or 0)))
    A("客户端界面里根本看不到，填进去多半报「模型不存在」，这份就不列它们，免得你选错。")
    A("填模型时**填 id，不填显示名**。倍率从低到高排，越靠前越省。")
    A("")
    A("| 模型ID | 模型名称（显示名·倍率） | 输入 | 输出 | 图片 | 思考 |")
    A("|---|---|---|---|---|---|")
    for m in [x for x in res.get("models", []) if x.get("inCliRoster")]:
        A("| `%s` | %s | %s | %s | %s | %s |"
          % (m["id"],
             "%s·%s" % (m.get("displayName") or m.get("upstreamName") or "-", _mul(m)),
             _k(m.get("contextWindow")), _k(m.get("maxTokens")),
             "✓" if m.get("supportsImages") else "✗",
             "✓" if m.get("reasoning") else "✗"))
    A("")
    A("## 二、接下来你怎么走")
    A("")
    A("**以上是模型配置信息。请先问用户：要配置到本机哪一个 AI 程序上？**")
    A("")
    A("**先问清楚：你要配的那个 AI 程序，到底是哪一款？**（DSH / Codex / Claude Code /")
    A("OpenCode / Hermes / Cursor 都行，也可能是你自己写的别的程序。）用户说什么就是什么，")
    A("**不要自己猜**。")
    A("")
    A("确认了是哪一款，就按**那一款自己的规矩**去配，别拿别的工具的写法硬套。")
    A("配上之后做三件事：")
    A("")
    A("1. **只准用上面这一段里的真实值**（地址、密钥、模型 ID），上面没给的别自己编、别拿示例顶；")
    A("2. **改那个程序的配置文件之前，先把原文件复制一份留着**（改坏了能还原）；")
    A("3. **配完真发一次请求验通不通**，把**真实结果**告诉我 —— HTTP 状态码是多少、")
    A("   返回内容的前几十个字是什么，原样贴给我。**不要只回一句「配置成功」**；")
    A("   不通就如实说不通在哪（是地址不对、密钥不对，还是模型 ID 不存在）。")
    A("")
    A("## 三、红线")
    A("")
    A("- 不碰 WorkBuddy 自己的安装目录、配置、插件；")
    A("- 第三方程序的配置：该改的改，别的别顺手碰，不在本机留备份以外的东西；")
    A("- 不改注册表、不装软件、不开新服务占端口；")
    A("- 拿不到就是拿不到，如实说，别猜别编。")
    A("")
    A("---")
    A("")
    A("（以上由 WBBridgeConfig.exe 解析本机 WorkBuddy 登录态后生成。）")
    A("")
    return "\n".join(L)


# ---------------------------------------------------------------- 手填字段（本机专用）
# _mul / _k / _auto_split 这三个小工具已经挪到 wbtargets（那边按目标出生动文案要用），
# 上面 import 进来了，旧调用方照旧用，行为一模一样。


def _auto_split(mid):
    """自动分身（快速/均衡/极致/自动）：不是真模型，工具里多半不列，得剔掉"""
    return str(mid).startswith(("fast-model", "balanced-model", "deep-model", "auto"))


def manual_data(res, use_proxy=False, port=0, show_all=False):
    """
    ② 自定义模型配置 —— 按老王填自定义模型时的真实顺序摆，且**说明一律压到一句话**
    （以前说明比值还长，用户先被说明淹没，找不着该填哪格）：

      第一段「供应商」（所有模型共用，一次填完）
        供应商ID → 显示名称 → API 地址/基础URL → API 协议 → API 密钥
      第二段「模型」（一行一个，照 dsh 的写法：模型名称里带倍率）
        模型ID → 模型名称（显示名·x倍率）→ 输入 → 输出 → 能力 → 名单

    返回 {"provider": [{n, label, value, tip, must, secret}, ...],
          "models":  [{id,name,inTok,outTok,img,think,roster,mul,auto,rec,line}, ...],
          "picks":   [{id,name,mul}, ...6 个按倍率从低到高的推荐],
          "stats":   {...}}

    **2026-10-04 老王拍板：模型一律只出「名单内」的，没名单内的不展示。**
    inCliRoster 来自上游 name=="cli" 那个 agent 的 id 白名单 —— 也就是工具界面里
    列得出来、填了能用的那批；目录里另外那些客户端看不到，手填多半报「模型不存在」，
    摆出来只会让人数不清、选错。要查全量时前端带 show_all=1 再要一次。

    **本机专用** —— 带明文 token，别发出去。
    """
    models = res.get("models", [])
    token = res["credential"]["accessToken"]
    base = res["endpoints"]["baseUrl"]
    first = models[0] if models else None
    st = res.get("stats", {})

    # 推荐位：名单内 + 有倍率 + 不是自动分身，按倍率从低到高（越前越省）
    pool = [m for m in models
            if m.get("inCliRoster") and m.get("creditMultiplier") is not None
            and not _auto_split(m["id"])]
    rec = set(m["id"] for m in sorted(pool, key=lambda x: (x["creditMultiplier"], x["id"]))[:6])

    provider = [
        # 老王 2026-10-05 定的：供应商 ID / 显示名称这两行是给人一眼看懂的短值，
        # 再挂一行说明就是废话（相当于你给它起的叫法…/列表里给人看的名字…），删掉只留值本身。
        {"n": 1, "label": "供应商 ID", "value": PROVIDER, "must": True, "secret": False,
         "tip": ""},
        {"n": 2, "label": "供应商显示名称", "value": "WorkBuddy", "must": True, "secret": False,
         "tip": ""},
        {"n": 3, "label": "API 地址（基础 URL）", "value": base + "/v2", "must": True,
         "secret": False,
         "tip": "只填基底，别带 /chat/completions 尾巴；要完整聊天地址再补上 /v2/chat/completions。"},
        # 协议是工具里的下拉框选项，不是让人复制粘贴的东西 —— 老王 2026-10-05 定的：只展示，不给复制。
        {"n": 4, "label": "API 协议", "value": "OpenAI / Chat Completions", "must": True,
         "secret": False, "noCopy": True,
         "tip": "协议是下拉框，选 OpenAI 那项；上游只收流式，填非流式它回 11101。"},
        {"n": 5, "label": "API 密钥（Key）", "value": token, "must": True,
         "secret": True,
         "tip": "本机专用别外传；**有效期到 %s**，WorkBuddy 一换登录态就跟着变。"
                "粘进工具时**只粘这串本身、别自己补 Bearer**——多数工具会自己加前缀，"
                "再补一层就成 `Bearer Bearer ...` 直接 401。"
                % (res["credential"].get("expiresAt") or "未知时间")},
    ]

    shown = [m for m in models if m.get("inCliRoster") or show_all]

    rows = []
    for m in shown:
        name = "%s·%s" % (m.get("displayName") or m.get("upstreamName") or m["id"], _mul(m))
        rows.append({
            "id": m["id"],
            "name": name,
            "inTok": _k(m.get("contextWindow")),
            "outTok": _k(m.get("maxTokens")),
            "img": "✓" if m.get("supportsImages") else "✗",
            "think": "✓" if m.get("reasoning") else "✗",
            # 2026-10-04 老王指出：上游根本没给「工具调用」这个字段，原来这行恒写 ✓ 是假数据，
            # 表格里的「工具调用」列已经撤掉；这里也一并不再产出，免得假信息再流到导出里。
            "roster": "✓" if m.get("inCliRoster") else "",
            "mul": _mul(m),
            "auto": _auto_split(m["id"]),
            "rec": m["id"] in rec,
            "line": "%s\t%s\t输入%s\t输出%s\t图片%s\t思考%s"
                    % (m["id"], name, _k(m.get("contextWindow")), _k(m.get("maxTokens")),
                       "✓" if m.get("supportsImages") else "✗",
                       "✓" if m.get("reasoning") else "✗"),
        })

    picks = [{"id": m["id"], "name": m.get("displayName") or m.get("upstreamName") or m["id"],
              "mul": _mul(m)}
             for m in sorted(pool, key=lambda x: (x["creditMultiplier"], x["id"]))[:6]]

    all_roster = bool(shown) and all(m.get("inCliRoster") for m in shown)

    return {
        "provider": provider,
        "models": rows,
        "picks": picks,
        "allRoster": all_roster,
        "stats": {"total": st.get("total"), "roster": st.get("inRoster"),
                  "shown": len(shown),
                  "hidden": st.get("total", 0) - st.get("inRoster", 0),
                  "recIds": sorted(rec), "rec": len(rec)},
    }


def manual_lines(res, use_proxy=False, port=0):
    """兼容旧调用：把模型清单压成一行一行的文本，给「复制全部」用。"""
    d = manual_data(res, use_proxy, port)
    return [x["value"] for x in d["provider"]] + [""] + [m["line"] for m in d["models"]]


# ---------------------------------------------------------------- 导出入口

TOOLS = [
    {"key": "agent", "title": "AI 配置指令（关键信息 + 一句问话）",
     "file": "WorkBuddy接入第三方工具-指令.md", "lang": "md"},
    {"key": "manual", "title": "自定义模型配置（本机专用，含明文 key）",
     "file": "workbuddy-bridge.json", "lang": "json"},
]


def generate(res, tool_key, port=0):
    if tool_key == "agent":
        body = agent_text(res, port)
        note = "整段复制 → 粘到你正在用的那个 AI 工具对话框里，它会先问你要配到本机哪个 AI 程序上。"
    elif tool_key == "manual":
        body = json.dumps({
            "provider_alias": PROVIDER,
            "base_url": res["endpoints"]["baseUrl"] + "/v2",
            "api_key": res["credential"]["accessToken"],
            "protocol": "openai-chat-completions-stream-only",
            "recommended_models": recommended_ids(res),
            "all_models": [m["id"] for m in res.get("models", []) if m.get("inCliRoster")],
            "account": res["account"],
            "expires_at": res["credential"].get("expiresAt"),
        }, ensure_ascii=False, indent=2)
        note = "本机专用 JSON：含明文 token，别外传。"
    else:
        raise KeyError(tool_key)

    return {
        "key": tool_key,
        "title": next(t["title"] for t in TOOLS if t["key"] == tool_key),
        "file": next(t["file"] for t in TOOLS if t["key"] == tool_key),
        "lang": next(t["lang"] for t in TOOLS if t["key"] == tool_key),
        "note": note,
        "body": body,
    }


def detect_sites():
    return wbsites.detect_sites()
