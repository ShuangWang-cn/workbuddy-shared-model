# -*- coding: utf-8 -*-
"""
wbtargets.py —— 「AI 配置指令」按**目标程序**分页，每页一份**可执行**的配置说明书

老王 2026-10-04 定的口径：
  解析 WorkBuddy 的共享信息（base_url / key / 模型清单 / 倍率）→ 统计好关键字段 →
  再写清楚「这个目标程序在本机哪、配置文件是哪个、长什么样、怎么改、改完怎么验」。
  **核心是接手那个 AI 工具能看懂、并且真的能配好**，不是把信息罗列完就完事。

每页文本的固定骨架（谁改这段就照这个骨架走，别漏章节）：
  0. 任务一句话 + 前置（要不要先把本机桥开着）
  一、真实值（只准用这些，一律不准自己编）
  二、这个程序的落点（先自己探，探不到就如实报，不许编路径）
  三、要写进去的东西（**整份文件内容**，不是片段）
  四、写入步骤（按顺序做，第 4 步起要真跑）
  五、这个工具的坑（照做，别踩）
  六、红线

字段格式一律按官方为准，2026-10-04 逐条核对过：
  opencode  1.2.16（本机实测 + 官方 providers 页）
  codex     openai/codex docs/config.md（官方原文：wire_api 合法值 chat / responses，缺省 chat；
            env_key 是「环境变量名」不是密钥本身；openai / ollama / lmstudio 是保留名；
            TOML 根键必须写在各表之前）
  claude    code.claude.com docs/en/settings + docs/en/env-vars（env 块是 ordinary key；
            ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL / ANTHROPIC_SMALL_FAST_MODEL；
            settings.json 是严格 JSON，注释和尾逗号会让整个文件报错）
  continue  Continue 官方 json-reference（models[] 里 provider 固定 openai，apiBase / apiKey，
            title 必填）＋ 新版默认走 /responses、不兼容时要 useResponsesApi:false
"""
import json
import os
from datetime import datetime, timezone

PROVIDER = "workbuddy"          # 第三方工具里的提供方别名（沿用，别改，改了要重配一批）


# ---------------------------------------------------------------- 小工具

def _mul(m):
    """倍率 -> x0.11 / x0.08 / -"""
    v = m.get("creditMultiplier")
    if v is None:
        return "-"
    return "x%.2f" % v


def _mul_bare(m):
    """倍率 -> 0.11 / 0.00 / -（给「显示名×倍率」这种拼名用，倍率串本身别再带 x，会拼成 ×x0.11）"""
    v = m.get("creditMultiplier")
    if v is None:
        return "-"
    return "%.2f" % v


def _k(n):
    """token 数 -> 192K / 64K / -"""
    try:
        n = int(n)
    except (TypeError, ValueError):
        return "-"
    if n <= 0:
        return "-"
    if n >= 1000000:
        return "%dM" % (n // 1000000)
    if n >= 1000:
        return "%dK" % (n // 1000)
    return str(n)


def _auto_split(mid):
    """自动分身（快速/均衡/极致/自动）：不是真模型，别摆进清单"""
    return str(mid).startswith(("fast-model", "balanced-model", "deep-model", "auto"))


def _nice_name(m):
    """显示名 + 该模型的身份注解（免费额度这类），跟老王定的叫法保持一致。

    上游给的数据只有显示名，注解得自己补；目前就 hy3 / hy3-x 这一对有讲究
    （hy3 是每日限免的免费额度，用完切 hy3-x 那条付费线，见 wbresolve 的 tier）。
    """
    n = (m.get("displayName") or m.get("upstreamName") or str(m["id"])).strip()
    i = str(m["id"])
    if i == "hy3":
        return n + "（免费额度）"
    if i == "hy3-x":
        return n + "（限免后付费）"
    return n


def _roster(res):
    """名单内的（客户端界面列得出来、填了能用的那批）"""
    return [m for m in res.get("models", []) if m.get("inCliRoster")]


def _picks(models, n=6):
    """推荐位：名单内 + 有倍率 + 不是自动分身，按倍率从低到高（越前越省）"""
    pool = [m for m in models
            if m.get("inCliRoster") and m.get("creditMultiplier") is not None
            and not _auto_split(m["id"])]
    return sorted(pool, key=lambda x: (x["creditMultiplier"], x["id"]))[:n]


# ---------------------------------------------------------------- 公共段落

def _s_real(res):
    """一、真实值"""
    base = res["endpoints"]["baseUrl"]
    token = res["credential"]["accessToken"]
    acc = res["account"] or {}
    exp = res["credential"].get("expiresAt") or "未知"
    ms = _roster(res)
    L = []
    A = L.append
    A("## 一、真实值（下面这些是刚从本机 WorkBuddy 解出来的，只准用这些，一律不准自己编、不准拿示例顶）")
    A("")
    A("| 项 | 值 |")
    A("|---|---|")
    A("| 接口基础地址（base_url） | `%s/v2` |" % base)
    A("| 完整聊天地址（**只给你认路看，别直接填进工具**） | `%s/v2/chat/completions` |" % base)
    A("| 协议 | OpenAI Chat Completions（**只收流式 `stream:true`**，非流上游回 11101） |")
    A("| 密钥（Key） | `%s`（**填进工具时只填这一串，别带 `Bearer ` 前缀**——"
      "多数工具会自己补 `Bearer `，你再补一层就成 `Bearer Bearer ...` 直接 401） |" % token)
    A("| 花的是哪个号 | %s |" % (acc.get("nickname") or "(本机 WorkBuddy 账号)"))
    # 旧版只印一个没标时区的时间串，读者容易当成 UTC；而 generatedAt 那边是 UTC —— 两个时间不同框。
    # wbresolve 给的 expiresAt 是本机本地时间，这里补一句 UTC 换算，免得看错（2026-10-05 二次内测修）。
    exp_utc = ""
    try:
        exp_utc = datetime.fromisoformat(str(exp)).astimezone(timezone.utc) \
            .strftime("%Y-%m-%d %H:%M")
    except Exception:
        exp_utc = ""
    A("| 这个 Key 什么时候断 | %s（**本机本地时间**%s；WorkBuddy 一换登录态它就变，变了要重新解析一次） |"
      % (exp, ("，换成 UTC 是 " + exp_utc) if exp_utc else ""))
    A("| 名单内能用的模型 | %d 个（清单见下表） |" % len(ms))
    A("")
    A("> ⚠ 这一段里是**明文密钥**。就在你自己这台机器这几样工具之间传，**别贴到公开对话、别发到公开场合**。")
    A("")
    A("### 模型清单（填的时候填 ID，不填显示名）")
    A("")
    A("倍率 = 积分消耗倍率，越靠前越省，想省钱就从上面往下挑：")
    A("")
    A("| 模型ID | 显示名（·倍率） | 输入 | 输出 | 图片 | 思考 |")
    A("|---|---|---|---|---|---|")
    for m in sorted(ms, key=lambda x: (x.get("creditMultiplier") if x.get("creditMultiplier") is not None else 1e9,
                                       x["id"])):
        A("| `%s` | %s·%s | %s | %s | %s | %s |"
          % (m["id"], _nice_name(m), _mul(m),
             _k(m.get("contextWindow")), _k(m.get("maxTokens")),
             "✓" if m.get("supportsImages") else "✗",
             "✓" if m.get("reasoning") else "✗"))
    A("")
    # 旧版「列出来的全都已经一并配进去了」—— 这时候还没配呢，语义倒过来了；改成「下面会配」
    A("上面这张表里**列出来的这 %d 个，后面会一并配进去**；用哪个你自己按需要挑，这里不给建议。"
      % len(ms))
    A("")
    A("挑的时候看三样：**倍率**（越前越省）、**能不能看图**（支持图片的不能拿去看图）、")
    A("**上下文窗口**（窗口小的长文容易断）。")
    A("")
    return L


def _s_steps(verify_lines, extra_steps=None):
    """四、写入步骤（verify_lines 是验证命令的若干行；extra_steps 是补充说明）"""
    L = []
    A = L.append
    A("## 四、写入步骤（按顺序做，第 3 步开始必须真跑）")
    A("")
    A("1. **先备份**：把要改的那个配置文件整体复制一份（`<原文件>.bak`），改坏了能还原；")
    A("   **备份完先读一遍原文件**，里面如果**已经有 `%s` 字样**，先停下来告诉我，别重复覆盖。" % PROVIDER)
    A("2. **定位落点**：执行第二步给你的探测命令，把**真实找到的路径**报给我（找不到的如实说找不到，")
    A("   **不许编一个路径出来**，也不许凭印象写一个本机根本没有的文件）。")
    A("3. **写文件**：用整份内容（第三步那份）覆盖式写入。字段一个不许改、不许漏、不许自己造；")
    A("   只准**新增**这一段，不许顺手动别人已经配好的其它配置。")
    A("4. **校验格式**：文件能不能被解析（下面第三步里给了命令就跑，没给就用目标程序自带的配置检查）。")
    A("5. **让配置生效**：按第三步里写的「怎么让它生效」那一条做（重启 / 重载 / 重开终端）。")
    A("6. **真发一次请求验通不通**（这条命令里的 key 已经替你填好了，原样跑）：")
    A("")
    A("```")
    for v in verify_lines:
        A(v)
    A("```")
    A("")
    A("7. **把真实结果原样报给我**：HTTP 状态码是多少、返回内容的前几十个字是什么" +
      "（**明文 Key 整串已经给在上面了，直接拿去配，别打码、别再向我要**）。**不要只回一句「配置成功」**；" +
      "不通就分别说清是地址不对、")
    A("   密钥不对、还是模型 ID 不存在。")
    A("")
    if extra_steps:
        A("补充说明：")
        A("")
        for s in extra_steps:
            A("- " + s)
        A("")
    return L


def _s_redline(res, heads=(), num="六"):
    """红线（默认排在「六」；通用页没有写入步骤那两节，传 num="四"）"""
    L = []
    A = L.append
    # 旧版硬编码「四、红线」，跟 _s_steps 的「四、写入步骤」撞号，
    # 排出来自带页变成 一二三四五四（末节号比前节还小）。改成由调用方给节号（2026-10-05 二次内测修）。
    A("## %s、红线（踩了就是事故）" % num)
    A("")
    for h in heads:
        A("- " + h)
    A("- **不碰 WorkBuddy 自己的安装目录、配置、插件**——我们是它出来的数据，不是它的主人；")
    A("- **不改注册表、不装软件、不开新服务占端口**；")
    A("- **改之前先备份**，改完只留下备份，别的临时文件别往本机乱扔；")
    A("- **拿不到 / 配不上就如实说**，别猜、别编、别拿「大概」「应该是」糊过去。")
    A("")
    A("---")
    A("")
    A("（以上由 本工具 exe 解析本机 WorkBuddy 登录态后生成，%s。）"
      % (res.get("generatedAt") or ""))
    A("")
    return L


def _verify_openai(base, token, model="hy3"):
    """验证命令（单行，cmd / PowerShell / bash 都能直接跑）"""
    return ['curl -s -m 25 -w "\\n<<HTTP %%{http_code}>>" "%s/v2/chat/completions" -H "authorization: Bearer %s" '
            '-H "content-type: application/json" '
            '-d "{\\"model\\":\\"%s\\",\\"stream\\":true,\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":\\"hi\\"}]}"'
            % (base, token, model)]


def _s_task(who, pre=None):
    """0. 任务一句话 + 前置"""
    L = ["# 任务：把本机 WorkBuddy 的登录态，配成 %s 的自定义模型" % who, ""]
    if pre:
        L.append(pre)
        L.append("")
    L.append("## 0. 你要干的事")
    L.append("")
    # 第二处一律用「这个工具」回指 —— 长工具名塞回句子里会套两层括号、读成一坨（2026-10-05 二次内测修）
    L.append("我上面那一段是**本机 WorkBuddy 的真实信息**。请你拿这些信息，")
    L.append("**在我这台机器上**把上面这些信息配进 **我指定的那个第三方 AI 程序**（往那个程序自己的配置文件里写配置、"
             "让它能用、最后真跑一次验证）。")
    L.append("")
    # 旧版写死「按第一到第六步做」，但通用页只有 四 节、其它页是 一二三四五六(七)，
    # 写死必然对不上，AI 会去找不存在的节 —— 改成不数节、只认顺序（2026-10-05 二次内测修）。
    L.append("**照着下面各节的先后顺序做**，做完把**真实结果**报给我。")
    L.append("每一节都照着做，别跳、别自作主张换写法。")
    L.append("")
    return L


# ---------------------------------------------------------------- 二、落点（各目标自己的）

def _probe(who, win_cmd, pos_cmd, cands):
    """二、落点：给探测命令 + 候选（相对定位，不写死本机绝对路径）"""
    L = []
    A = L.append
    A("## 二、%s 的配置文件在哪（**先自己探，不许猜**）" % who)
    A("")
    A("候选位置（%s 系统）：" % ("Windows" if os.name == "nt" else "POSIX"))
    for c in cands:
        A("- " + c)
    A("")
    A("探测命令：")
    A("")
    A("```")
    A(win_cmd)
    A(pos_cmd)
    A("```")
    A("")
    A("**先跑探测，把真实找出来的路径报给我**；一个都找不到就直说找不到，别硬写一个。")
    A("")
    return L


# ---------------------------------------------------------------- 目标：opencode

def build_opencode(res, port):
    base = res["endpoints"]["baseUrl"]
    token = res["credential"]["accessToken"]
    cfg = {
        "$schema": "https://opencode.ai/config.json",
        "model": PROVIDER + "/hy3",
        "provider": {
            PROVIDER: {
                "npm": "@ai-sdk/openai-compatible",
                "name": "WorkBuddy 共享",
                "options": {"baseURL": base + "/v2", "apiKey": token},
                "whitelist": [],
                "models": {},
            }
        },
    }
    wb = cfg["provider"][PROVIDER]
    wb["whitelist"] = [m["id"] for m in _roster(res)]
    for m in _roster(res):
        e = {"name": "%s×%s" % (_nice_name(m), _mul_bare(m))}
        if m.get("supportsImages"):
            e["modalities"] = {"input": ["text", "image"], "output": ["text"]}
        if m.get("contextWindow"):
            e["limit"] = {"context": int(m["contextWindow"]), "output": int(m["maxTokens"] or 0)}
        wb["models"][m["id"]] = e
    body = json.dumps(cfg, ensure_ascii=False, indent=2)

    L = []
    A = L.append
    L += _s_task("OpenCode", pre="> 不用先开本机桥：OpenCode 直连上游就行，" +
                                 "桥开着也无所谓（桥只在你要给 Claude Code 用时才必须）。")
    L += _s_real(res)
    L += _probe("OpenCode",
                r"Windows:  dir /s /b %USERPROFILE%\.config\opencode\opencode.json*",
                r"POSIX:    ls ~/.config/opencode/opencode.json*",
                ["- `~/.config/opencode/opencode.json`（最常见）",
                 "- `~/.config/opencode/opencode.jsonc`（带注释版，同一个格式）",
                 "- **Windows 上就落在 `%USERPROFILE%\.config\opencode\` 底下**（跟 POSIX 的 `~/.config` 是一回事），"
                 "去 `AppData\Roaming\opencode` 找是找不到的，那儿没有"])
    A("## 三、要写进去的东西（**整份文件内容**，直接整体写入）")
    A("")
    A("### 动手前先做两件事（别跳过）")
    A("")
    A("1. **先看一眼装过没有**：把配置文件整份读出来，**里面若已经出现 `workbuddy` 字样，")
    A("   说明这台机器配过了——停下来告诉用户「已配过」，别重复覆盖**。")
    A("2. **先备份**：把原文件复制一份 `opencode.jsonc.bak-<时间戳>`，改坏了能1 分钟回滚。")
    A("")
    A("### 完整文件内容")
    A("")
    A("```json")
    A(body)
    A("```")
    A("")
    A("字段这么理解（照抄就行，解释了你可能更放心）：")
    A("")
    A("- `provider.%s.options.baseURL` —— 接口地址，**只填到 `/v2`，别带 /chat/completions**；" % PROVIDER)
    A("- `provider.%s.options.apiKey` —— 上面那份明文 Key，**原样填，别加 Bearer 以外的东西**；" % PROVIDER)
    A("- `provider.<名字>.whitelist` —— **要写**，16 个模型 ID 原样列进去；")
    A("  ⚠ **它必须写在 `provider.<名字>` 这一层（跟 `models` 同级）**，放进 `options` 里就是废的——")
    A("  放到 `options` 里那16 个模型一个都不亮，得手动一个个点。这条是真踩过的。")
    A("  （有些文档说 opencode 没这一项、可以省，那是不对的：**老王2026-10-07 实测 1.2.16 带 whitelist 能正常用**，")
    A("  照上面这份原样写就行，别自作主张删掉。）")
    A("- `provider.<名字>.models` —— **这是「模型出不出来」的开关，它是个 map，键就是模型 ID**")
    A("  （`models.hy3.name` 写显示名；**只有写进这段的模型才会被 opencode 认**，")
    A("  不写的话 `opencode models workbuddy` 一个都列不出来，跑起来直接报")
    A("  `ProviderModelNotFoundError: providerID workbuddy / modelID hy3`）。")
    A("  **`whitelist` 和 `models` 的键集合必须完全一致**（都是 16 个），不一致会出怪问题。")
    A("- `models.<id>.name` —— 界面上给人看的名字，这里 **显示名 + ×倍率**；")
    A("- `models.<id>.modalities` —— 只有支持图片的才写，写错了反而会被判成不支持；")
    A("- `models.<id>.limit` —— 上下文 / 输出上限；")
    A("- 顶层 `model` —— 开箱即用的默认模型，写 `%s/hy3`。" % PROVIDER)
    A("")
    A("### 怎么让它生效")
    A("")
    A("**把 OpenCode 进程彻底关掉再开**（任务栏托盘里的也退干净——它还跑着的话读的是内存里那份老配置，")
    A("光改文件没用）。Windows 上看残留进程：`tasklist | findstr opencode`。")
    A("")
    _oc_check = (
        'python -c "import json;'
        'd=json.load(open(r\'%%USERPROFILE%%\\.config\\opencode\\opencode.jsonc\',encoding=\'utf-8\');'
        'p=d[\'provider\'][\'@P@\'];'
        'assert len(p[\'models\'])==len(p[\'whitelist\']),\'models/whitelist数量不一致\';'
        'assert set(p[\'models\'])==set(p[\'whitelist\']),\'models/whitelist键不一致\';'
        'assert p[\'options\'][\'baseURL\'].endswith(\'/v2\'),\'baseURL必须只到/v2\';'
        'assert not p[\'options\'][\'apiKey\'].startswith(\'Bearer \'),\'apiKey不能带Bearer前缀\';'
        'print(\'OK models=\', len(p[\'models\']))"'
    ).replace("@P@", PROVIDER)
    L += _s_steps(_verify_openai(base, token),
                 extra_steps=[
                     "**写完先验格式对不对**（把下面路径换成你实际写的那个配置文件路径），"
                     "打印出 `OK models= 16` 才算写对了；报错就回上一步改，别往下走：",
                     "```bash",
                     _oc_check,
                     "```",
                     "再跑一遍看 OpenCode 认不认：`opencode models %s`（应该列出上面那批模型）。" % PROVIDER,
                     "真跑一次看它认不认：`opencode run \"只回两个字：通了\"` —— "
                     "屏幕上真打出那几个字就是通了（stderr 里会显示 `> build · 模型名` 那行）；"
                     "报 `ProviderModelNotFoundError` 就是 `models` 段没写全，补上重启。",
                     "（**无头环境**跑不了 TUI 就用这个取文本："
                     "`opencode run \"只回两个字：通了\" --format json < /dev/null`，"
                     "输出里该出现 `\"text\":\"通了\"`。opencode 不一定在 PATH 里，"
                     "探不到就找 `%USERPROFILE%\\.opencode\\bin\\opencode.exe`。",
                 ])
    A("## 五、OpenCode 这几个坑（照做，别踩）")
    A("")
    A("- **`whitelist` 只能在 `provider.<名字>` 这一层**，放 `options` 里是废的（这条是真踩过：")
    A("  放到 options 里，16 个模型一个都不亮，得手动一个个点）；")
    A("- 只认 `modalities`，你写 `capabilities` 会被静默丢掉；")
    A("- 1.2.16 里自定义 provider 的模型**不会被渲染成 disabled**，所以「灰着」多半不是模型层的问题，")
    A("  是上面那个「开启供应商模型」按钮还没点，或者进程没真正重启；")
    A("- 改完必须**彻底关进程重开**，只关窗口不算；")
    A("- **`429` 不是 Key 坏，是这个模型被限流**（鉴权已过）：换个别模型重试就通，")
    A("  `hy3` 限流最凶，**测 Key 好坏请用 `glm-5.3-flash`**，别拿 hy3 测——容易误判成 Key 失效。")
    A("- **Key 约 30 天会过期**。症状：curl 回 `401/403`，或 `opencode run` 报鉴权错。")
    A("  治法：重跑本工具重新解析，拿新 Key **只改 `provider.%s.options.apiKey` 这一个字段**，")
    A("  别的别动，然后重跑一遍格式校验 + 上游 curl 验一次就行。")
    A("- 上游只收流式，OpenCode 走的是 `@ai-sdk/openai-compatible`，自带流式，不用你操心。")
    A("")
    L += _s_redline(res)
    return "\n".join(L)


# ---------------------------------------------------------------- 目标：DeepSeek Harness（dsh）

def build_dsh(res, port):
    """DeepSeek Harness（桌面版 dsh）—— 走自研 workbuddy-llm 插件，免 exe 常开。

    正确路线（2026-10-07 本机实测跑通）：本工具随 exe 附带 workbuddy-llm 插件，
    把它整体复制到 dsh 桌面版的 node_modules，**并在 dsh 桌面版 profile 的 package.json 里
    把 workbuddy-llm 注册进 `dsh.profile.bundles`（同时加进 `dependencies`）**——dsh 只加载
    bundles 里列出的插件，不注册就不会出现；最后把 WorkBuddy Key 写进本地文件，重启 dsh 即生效。
    **不碰官方市场插件（dsh-connect-workbuddy 等），不改 cordis.patch.yml（注册走 package.json，不是它）。**

    为什么不能手填上游直连：dsh 原生 adapter 把请求头锁死成 deepseek-harness/<版本>，
    上游对此 UA 挡回 code:11128，纯手填上游地址「直连」必死。插件内部用 CodeBuddy UA 转发，绕开这个限制。
    """
    base = res["endpoints"]["baseUrl"]
    token = res["credential"]["accessToken"]
    node_dir = "%USERPROFILE%\\.dsh\\profiles\\desktop\\node_modules\\workbuddy-llm"
    key_file = "%USERPROFILE%\\.wbbuddy\\key"
    L = []
    A = L.append

    L += _s_task("DeepSeek Harness（桌面版）",
                 pre="> 本工具随 exe 附带一个自研插件 `workbuddy-llm`。装进 DeepSeek Harness（以下简称 dsh）后，"
                     "它会在 dsh 进程内起一个本地传话筒，拿本工具产出的 WorkBuddy Key 直连上游。"
                     "**装好一次长期有效，本工具 exe 可以关掉，不用常开。** 下面只做这一件事，"
                     "别去碰机器上任何别的 workbuddy 插件。")
    L += _s_real(res)

    A("## 二、东西落哪儿（先自己探，不许猜）")
    A("")
    A("你要动两个地方，先把目录探明白：")
    A("")
    A("1. **插件装到哪**：dsh 桌面版的插件目录")
    A("   `%s`" % node_dir)
    A("   （注意是 `desktop` profile，不是 `web`；桌面版 `DeepSeek Harness.exe` 走的就是 `desktop`，")
    A("   写到别的 profile 目录 dsh 不读，等于白写。）")
    A("2. **Key 写到哪**：把上面「一、真实值」里的那串**明文 Key** 原样写进文件")
    A("   `%s`" % key_file)
    A("   （插件启动时会读它；也可以设环境变量 `WORKBUDDY_API_KEY`，或写进")
    A("   `%APPDATA%\\dsh-desktop\\harness\\.workbuddy_key`，三选一，插件按这个顺序找。）")
    A("3. **注册写到哪**：dsh 桌面版 profile 的 `package.json`")
    A("   `%USERPROFILE%\\.dsh\\profiles\\desktop\\package.json`")
    A("   （这是 dsh 启动时读取的插件清单。**只复制插件文件夹 dsh 不会加载它**——")
    A("   必须把 `workbuddy-llm` 加进这个文件的 `dsh.profile.bundles` 数组（并在 `dependencies` 里登记），")
    A("   dsh 才会真正加载插件。这步漏了，模型列表就啥也没有。下面第 3 步照做。）")
    A("")
    A("**插件源文件夹在哪**：就在你正在运行的这个 WBBridge 工具 exe 的**同目录**下，")
    A("有个 `workbuddy-llm` 文件夹（本工具发出来时就带着它，和 exe 并排）。")
    A("先确认它存在：")
    A("")
    A("```")
    A('Windows:  dir "%USERPROFILE%\\.dsh\\profiles\\desktop\\node_modules"')
    A("          如果 node_modules 不存在，说明 dsh 桌面版还没真正初始化过；")
    A("          先打开一次 DeepSeek Harness（随便发条消息都行），让它把目录建出来再看。")
    A("```")
    A("")
    A("> ⚠ 你机器上**可能已经有**别的 workbuddy 插件（比如从 dsh 市场装的 `dsh-connect-workbuddy`、")
    A("> `dsh-workbuddy-connect`，或者以前测试留下的备份文件夹）。**那些一律无视、别动、别读、别改。**")
    A("> 本任务只用我们自带的 `workbuddy-llm`，跟它们毫无关系。")
    A("> 我们只改 `desktop\\package.json` 这一个文件（加 bundles 注册），**别手动去改 `cordis.patch.yml`**——")
    A("> 那个文件有两层开关（市场软开关 + patch 硬开关），硬层压软层，UI 点启用都碰不到硬层，")
    A("> 手动改轻则不生效、重则 dsh 起不来。注册插件走 `package.json` 的 `bundles`，不碰它。")
    A("")

    A("## 三、要写进去的东西（三步，照做）")
    A("")
    A("### 第 1 步：复制插件文件夹")
    A("")
    A("**动手前先看一眼有没有装过**：把下面这条跑一下，如果输出里已经出现 `workbuddy-llm`，")
    A("说明这台机器**已经装过了**——**停下来告诉用户「已装过」，别重复覆盖**（乱覆盖容易把能用的弄坏）：")
    A("")
    A("```bash")
    A('dir "%USERPROFILE%\\.dsh\\profiles\\desktop\\node_modules"')
    A("```")
    A("")
    A("确认没装过，再把本工具 exe **同目录**下的 `workbuddy-llm` 文件夹，**整体复制**到：")
    A("")
    A("```")
    A(node_dir + "\\")
    A("```")
    A("")
    A("要求：目标目录里应有 `package.json`、`lib\\index.js`、`cordis.patch.yml` 这几个文件，")
    A("缺一个就是没复制全。如果目标目录已存在旧的 `workbuddy-llm`，先整个删掉再复制，别留混。")
    A("")
    A("### 第 2 步：写 Key 文件")
    A("")
    A("把「一、真实值」里那串**明文 Key** 原样写进：")
    A("")
    A("```")
    A(key_file)
    A("```")
    A("")
    A("**整串原样写，别换行、别加 `Bearer ` 前缀、别加引号**（文件里就只有那一串字符）。")
    A("这串 Key 是动态的，WorkBuddy 一换登录态它就变；变了就重跑一次本工具、把新 Key 覆盖写进这个文件即可。")
    A("")
    A("**写完必须逐项校验（任一不符就是写错了，当场改，别将就）**：")
    A("")
    A("- 文件字节数 == Key 字符串长度（不是差不多，是**正好相等**）；")
    A("- 首字符**不能是 `B`**（说明误带了 `Bearer ` 前缀）；")
    A("- 末字节**不能是 `0x0a`**（说明尾部多打了个换行）；")
    A("- 文件里**不能出现双引号** `\"`。")
    A("")
    A("> ⚠ **若这个文件已存在且旧Key 还能用**，**别直接盖掉**——先解码比一下再决定：")
    A("> 把新旧两串按 base64url 解出payload 段，比 `sub` / `nickname` / `sid` 是否一致；")
    A("> `sid` 相同只是 `iat`/`exp` 不同 → 同一会话两次签发，盖成新的（exp 更晚）没问题；")
    A("> **万一你手抄串了字符，别拿敲错的那串去盖本来能用的旧 Key**——宁可重跑一次本工具重新解析。")
    A("")
    A("### 第 3 步：在 dsh 的 `package.json` 里注册插件（**这步最关键，漏了 dsh 不认**）")
    A("")
    A("打开（或先建好）这个文件：")
    A("")
    A("```")
    A("%USERPROFILE%\\.dsh\\profiles\\desktop\\package.json")
    A("```")
    A("")
    A("确认它的 `dsh.profile.bundles` 数组里**包含 `workbuddy-llm`**，且 `dependencies` 里**登记了它**；")
    A("按下面模板改（保留原有的 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 两个，只追加 `workbuddy-llm`）：")
    A("")
    A("```json")
    A("{")
    A('  "name": "dsh-profile-desktop",')
    A('  "private": true,')
    A('  "dependencies": {')
    A('    "workbuddy-llm": "file:./node_modules/workbuddy-llm"')
    A("  },")
    A('  "dsh": {')
    A('    "profile": {')
    A('      "bundles": [')
    A('        "@deepseek-ai/dsh-base",')
    A('        "@deepseek-ai/dsh-web-app",')
    A('        "workbuddy-llm"')
    A("      ]")
    A("    }")
    A("  }")
    A("}")
    A("```")
    A("")
    A("> 只改这一个文件。`workbuddy-llm` 的 `package.json` 自带 `\"dsh\": {\"bundle\": {\"patch\": ...}}` 声明，")
    A("> 只要它被列进 `bundles`，dsh 启动时就会加载它并把 provider 注册进去；不用你再手改任何别的东西。")
    A("")

    L += _s_steps(
        [
            "# 1) 确认插件文件到位（下面这条应列出 index.js 的路径）",
            'dir "%USERPROFILE%\\.dsh\\profiles\\desktop\\node_modules\\workbuddy-llm\\lib\\index.js"',
            "# 2) 确认 Key 文件存在，且内容 == 一、真实值里的 Key（逐字符比，不该有换行/引号/Bearer）",
            'type "%USERPROFILE%\\.wbbuddy\\key"',
            "# 3) 确认插件已在 dsh 的 package.json 里注册（下面应能看到 workbuddy-llm 出现在 bundles 里）",
            'python -c "import json;d=json.load(open(r\'%USERPROFILE%\\.dsh\\profiles\\desktop\\package.json\'));print(d[\'dsh\'][\'profile\'][\'bundles\'])"',
            "# 4) 彻底退出 dsh（任务栏托盘里的也退干净），再重开 DeepSeek Harness.exe",
            "tasklist | findstr dsh   # 看有没有残留进程，有就结束掉再开",
        ],
        extra_steps=[
            "重开 dsh 后，进 **Settings → Models**（或模型选择列表），应该能看到一个新 provider："
            "**WorkBuddy（国内）**，底下挂着 16 个模型，ID 依次是："
            "`hy3`、`space-bunny`、`hy3-x`、`glm-5.3-flash`、`deepseek-v4.1-flash`、`minimax-m3`、"
            "`hy4-preview`、`deepseek-v4-pro`、`kimi-k2.6`、`kimi-k2.7`、`glm-5v-turbo`、"
            "`kimi-k2.8-preview`、`glm-5.1`、`glm-5.2`、`glm-5.3`、`kimi-k3-1`。"
            "认名字认准 `workbuddy-llm` 就够了，不用手填模型 ID（插件会自己拉真实名单）。"
            "看不到就说明插件没被加载——按这个顺序查：① 第 1 步插件文件夹复制全了没（有 package.json/lib/index.js/cordis.patch.yml 吗）；"
            "② 目录是不是 `desktop` profile（不是 web）；③ **第 3 步注册做了没**——`package.json` 的 `bundles` 里有没有 `workbuddy-llm`，"
            "这一条漏了是模型列表空的最常见原因。",
            "真发一条消息（比如「只回两个字：通了」），把 dsh 返回的原文或报错码"
            "（如 `no_key` / `upstream_error` / `401`）原样报回来，别只说「不行」。",
            "**顺序别搞反：先验上游，再动 dsh。** 把下面 `<Key>` 换成「一、真实值」里那串真实 Key 跑，"
            "把HTTP 状态码和返回开头几十个字报回来（**注意用 `glm-5.3-flash` 这个模型，别用 `hy3`**——"
            "`hy3` 常被限流，看着像失败其实不是）：",
            "```bash",
            'curl -s -o /tmp/wb_r.txt -w "http=%{http_code}" \\',
            '  -H "Authorization: Bearer <Key>" \\',
            '  -H "Content-Type: application/json" \\',
            '  -d \'{"model":"glm-5.3-flash","messages":[{"role":"user","content":"只回两个字：通了"}],"stream":true}\' \\',
            "  %s/v2/chat/completions" % base,
            "head -c 200 /tmp/wb_r.txt",
            "```",
            "**怎么判读（重要，别误判）**：",
            "",
            "- `200` + 返回开头是 `data: {...}` → **真通**，Key 和端点端到端可用；",
            "- `429` → **不是 Key 错**，是**这个模型被限流了**（鉴权已经过了），换一个模型重试拿 200；",
            "- `401` → Key 错了 / 过期了 / 误带了 `Bearer ` 前缀；",
            "- `11101` → 发了非流式请求（上游只收 `stream:true`）。",
            "",
            "**这条不通就别再改 dsh 了**——先解决 Key 本身（过期就重跑本工具重新解析）。"
            "反过来说：这条通了而 dsh 里还是不通，那问题在 dsh 侧的插件加载或注册上。",
            "（极少数 dsh 版本不认手动注册的插件、模型列表死活不出现时，退而走本工具桥："
            "把思路换成在 dsh 里填 `http://127.0.0.1:%d/v2` 且本工具 exe 必须保持运行——"
            "但优先把插件装好注册好，那条是兜底。）" % (port or 18791),
        ])
    A("## 五、DeepSeek Harness 这几个坑（照做，别踩）")
    A("")
    A("- **动手前先备份**：改`package.json` 之前先复制一份 `package.json.bak-<时间戳>`，")
    A("  `Key` 文件已存在也备份一份 `key.bak-<时间戳>`——改坏了能1 分钟回滚，别硬改不备份。")
    A("- **已装过就别重复覆盖**：跑第 1 步那条 `dir` 时若已看到 `workbuddy-llm`，**停下报告用户**，")
    A("  别rm -rf 后重盖——把本来能用的弄坏是最冤的。")
    A("- **只认 workbuddy-llm，别去碰官方市场插件**：机器上若已有 `dsh-connect-workbuddy` 之类，")
    A("  那是借 WorkBuddy 桌面登录态的，开关还分层，容易把你绕晕；本任务一律不用，保持它们原样别动。")
    A("- **别手动改 `cordis.patch.yml`**：它有两层开关，硬层压软层，UI 点启用都碰不到硬层；")
    A("  手动改轻则不生效、重则 dsh 起不来。我们这次完全不碰它。")
    A("- **复制插件要整目录**：只丢 `index.js` 会缺 `package.json` / `cordis.patch.yml` 导致加载失败；")
    A("  目标目录已存在旧的就先整个删掉再复制。")
    A("- **Key 文件里别加 `Bearer ` 前缀、别换行、别加引号**：插件读的就是那串裸 JWT，")
    A("  任何形式的包装都会让它认成无效 Key，发消息报 `no_key` 或 `401`。")
    A("- **改完必须彻底退出 dsh 重开**（托盘也退）：dsh 还跑着就读的是内存里老配置，光复制文件没用。")
    A("- **Key 是动态的**：WorkBuddy 换登录态它就变，变了重跑本工具、把新 Key 覆盖写进 `.wbbuddy\\key` 即可。")
    A("- **上游只收流式**（`stream:true`），非流回 11101，")
    A("  这两点插件都已经自动处理，你不用操心。")
    A("- **`429` 不是 Key 错，是模型被限流**：鉴权已经过了，换个模型（如 `glm-5.3-flash`）重试就通。")
    A("  拿 `hy3` 测容易误判成失败——它限流得最凶。")
    A("")
    A("**排查顺序（照这个顺序查，别乱改）**：")
    A("")
    A("| 现象 | 查什么 |")
    A("|---|---|")
    A("| 模型列表为空 | ① 插件三件套齐不齐 → ② 是不是 `desktop` profile（不是 web）→ ③ **bundles 注册没**（最常被漏）|")
    A("| `no_key` / `401` | Key 格式错（带 `Bearer `/引号/换行）或过期 → 重解析 |")
    A("| `429` | 该模型限流，换个模型试（限流按模型计，不是 Key 问题）|")
    A("| 上游 curl 通、dsh 里不通 | 问题在 dsh 侧（插件没加载/没注册），不是 Key 问题 |")
    A("")
    A("**兜底（极少数 dsh 版本不认手动注册的插件时）**：改在 dsh 里填`http://127.0.0.1:%d/v2`，"
      "且**本工具 exe 必须一直开着**——但优先把插件装好注册好，那条是兜底不是首选。"
    % (port or 18791))
    A("")
    L += _s_redline(res, heads=(
        "**dsh 只加载 `package.json` 的 `dsh.profile.bundles` 里列出的插件**：第 3 步必须把 `workbuddy-llm` "
        "加进这个数组（并在 `dependencies` 登记），光复制文件夹 dsh 不会加载它；",
        "**不手动改 `cordis.patch.yml`**：注册走 `package.json` 的 `bundles`，那个文件两层开关易踩坑，别碰；",
        "**Key 只写进 `%s`（裸 JWT，无前缀无引号无换行）**，不写进 dsh 的配置/登录态文件；" % key_file,
        "**复制插件是整目录覆盖到 `%s`，不改 dsh 其它任何配置**；" % node_dir,
    ))
    return "\n".join(L)





# ---------------------------------------------------------------- 目标：codex

def build_codex(res, port):
    base = res["endpoints"]["baseUrl"]
    token = res["credential"]["accessToken"]
    L = []
    A = L.append
    L += _s_task("Codex CLI（终端版那个 `codex` 命令）",
                 pre="> ⚠ **本配方只给 Codex CLI（终端版）用。Codex 桌面版（ChatGPT.exe / Codex.exe）"
                     "别照抄，见第五节。**")
    L += _s_real(res)
    L += _probe("Codex CLI",
                r"Windows:  dir %USERPROFILE%\.codex\config.toml",
                r"POSIX:    ls ~/.codex/config.toml",
                ["- `~/.codex/config.toml`（`$CODEX_HOME/config.toml`）"])
    A("## 三、要写进去的东西（**只新增/合并这一段，别把整个文件删光重写**）")
    A("")
    A("目标配置文件长这样（TOML）：")
    A("")
    A("```toml")
    A("# —— 这两行是根键，必须写在文件靠前的位置（TOML 规定根键在所有 [表] 之前），")
    A("#    别追加到文件末尾，追加到末尾属于非法位置，codex 起不来")
    A("model = \"hy3\"")
    A("model_provider = \"%s\"" % PROVIDER)
    A("")
    A("[model_providers.%s]" % PROVIDER)
    A("name = \"WorkBuddy 共享\"")
    A("base_url = \"%s/v2\"" % base)
    A("env_key = \"WBBRIDGE_TOKEN\"   # 这是「环境变量的名字」，不是密钥本身")
    A("wire_api = \"chat\"            # 只能 chat；上游没有 /responses（404）")
    A("```")
    A("")
    A("写进去之后，再把密钥塞进那个环境变量（**Windows**）：")
    A("")
    A("```")
    A("setx WBBRIDGE_TOKEN \"%s\"" % token)
    A("```")
    A("")
    A("写进注册表式环境里，**当前这个终端读不到，必须重开一个终端窗口**（PowerShell / cmd 都要重开）。")
    A("POSIX：")
    A("")
    A("```")
    A("export WBBRIDGE_TOKEN=\"<上面那串 Key，去掉 Bearer 前缀>\"")
    A("```")
    A("")
    A("字段这么理解：")
    A("")
    A("- `base_url` 填到 `/v2`，codex 会自己拼 `/chat/completions`（`wire_api = \"chat\"` 时）；")
    A("  写成 `.../v2/chat/completions` 会拼成双份，404；")
    A("- `env_key` 是**环境变量名**，codex 运行时拿它里面的值当 `Bearer` 头；")
    A("- `wire_api = \"chat\"` 是**必须的**：上游只有 `/chat/completions`；")
    A("- 提供方名字**不能叫 `openai` / `ollama` / `lmstudio`**，这三个是保留名（会被当成内置的那个）。")
    A("")
    A("### 怎么让它生效")
    A("")
    A("重开终端窗口（`setx` 之后当前窗口还是旧的），然后再跑 `codex`。")
    A("")
    L += _s_steps(_verify_openai(base, token),
                 extra_steps=["不确定配置有没有被读到，就跑一次 `codex --print config`（或 `codex --show-config`），"
                              "把输出里跟 provider 有关的那几行原样报给我。"])
    A("## 五、Codex 这几个坑（照做，别踩）")
    A("")
    A("- **桌面版是毒药**：Codex 桌面版只要扫到 config.toml 里有 `[model_providers.*]` 且 `wire_api` 不是")
    A("  `\"responses\"`，启动就直接报 `wire_api = \"chat\" is no longer supported` 拒绝起来；改成 `responses` 也照样连不通")
    A("  （上游压根没 /responses）。**所以桌面版别动它的 config.toml**，要用桌面版就让它走本机桥：")
    A("  桥开着的时候 `ANTHROPIC_BASE_URL` / 网关地址填 `http://127.0.0.1:<桥端口>` 那一套（那是 Anthropic 协议）。")
    A("- `env_key` 填的是**变量名**，把它当密钥填进去，codex 会去找一个同名变量，值是空 → 401；")
    A("- `setx` 之后不重开终端，变量还是旧的，会报缺 key；")
    A("- 根键（`model` / `model_provider`）写在 `[xxx]` 表后面 = 语法错，整个文件作废；")
    A("- 上游只收流式，codex 用 chat wire 天然是流式，不用管。")
    A("")
    L += _s_redline(res)
    return "\n".join(L)


# ---------------------------------------------------------------- 目标：claude

def build_claude(res, port):
    base = res["endpoints"]["baseUrl"]
    token = res["credential"]["accessToken"]
    bridge = "http://127.0.0.1:%d" % (port or 18791)
    L = []
    A = L.append
    L += _s_task("Claude Code（`claude` 那个命令行），或者别的吃 Anthropic 协议的程序",
                 pre="> ⚠ **必须先让本机桥开着**：上游 `%s` 只提供 **OpenAI 协议**（`/v2/chat/completions`），"
                     "Anthropic 协议（`v1/messages`）只有**本机桥**这一个口子有。"
                     "所以这一路只能指向桥 `%s`。桥是 本工具 exe 解析完就起着的，"
                     "**桥一关这条路就断**（这个必须跟用户讲清楚）。" % (base, bridge))
    L += _s_real(res)
    L += _probe("Claude Code",
                r"Windows:  dir %USERPROFILE%\.claude\settings.json && dir %APPDATA%\claude\settings.json",
                r"POSIX:    ls ~/.claude/settings.json",
                ["- `~/.claude/settings.json`（用户级，最常见）",
                 "- `%APPDATA%/claude/settings.json`（有些 Windows 版本的 Claude Code 放这儿）"])
    A("## 三、要写进去的东西（**整份文件内容**）")
    A("")
    A("```json")
    A(json.dumps({
        "env": {
            "ANTHROPIC_BASE_URL": bridge,
            "ANTHROPIC_AUTH_TOKEN": "wb-local",
            "ANTHROPIC_MODEL": "hy3",
            "ANTHROPIC_SMALL_FAST_MODEL": "hy3",
        }
    }, ensure_ascii=False, indent=2))
    A("```")
    A("")
    A("字段这么理解：")
    A("")
    A("- `ANTHROPIC_BASE_URL` —— 端点覆盖，**必须指本机桥**（`%s`），别指上游；" % bridge)
    A("- `ANTHROPIC_AUTH_TOKEN` —— 自定义 Authorization 头，**值会自动加 `Bearer ` 前缀**，")
    A("  这里填任意非空串即可（本机桥不校验 token），**不要把上面那串真 Key 填这儿**；")
    A("- `ANTHROPIC_MODEL` / `ANTHROPIC_SMALL_FAST_MODEL` —— 填模型 ID（`hy3` 等，用第一节表格里的 ID）；")
    A("- `settings.json` 是**严格 JSON**：**不许写注释、不许有尾逗号**，写错整个文件会被判成设置错误，")
    A("  claude 起来会报 settings error。**别动文件里其它已有字段**（比如 `includeCoAuthoredBy`）。")
    A("")
    A("### 怎么让它生效")
    A("")
    A("写回文件后**重开 claude**（正在跑的会话会在文件保存时重新应用 env，但新启动才最稳）；")
    A("窗口里跑 `/status` 看 Setting sources 那行，确认 `env` 是从 `~/.claude/settings.json` 读进来的。")
    A("")
    L += _s_steps(['curl -s -o NUL -w "%%{http_code}" "%s" -H "x-api-key: test" -H "anthropic-version: 2023-06-01" '
                  '-H "content-type: application/json" -X POST '
                  '-d "{\\"model\\":\\"hy3\\",\\"max_tokens\\":16,\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":\\"hi\\"}]}"' % bridge],
                 extra_steps=["桥活着没用 `netstat -ano | findstr :%d`（Windows）看端口有没有在监听。" % (port or 18791),
                              "如果报 `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` 相关提示，那是被别的托管环境接管了，"
                              "这时候 settings 里的 ANTHROPIC_BASE_URL 会被忽略——如实告诉我，别硬改。"])
    A("## 五、Claude Code 这几个坑（照做，别踩）")
    A("")
    A("- **只能走本机桥**：上游是 OpenAI 协议，Claude Code 要 Anthropic 协议，直接指上游（")
    A("  `%s`）会 404 / 协议错。" % base)
    A("- **桥不是常驻服务，它跟着 本工具 exe 走**：关掉工具桥就没了，这条路跟着断；")
    A("  想长期用就得让那个工具一直开着。")
    A("- `ANTHROPIC_AUTH_TOKEN` 的**值会自动加 `Bearer `**，所以别再自己写一遍 Bearer，写串真 Key 上去反而被拼成 `Bearer Bearer ...`；")
    A("- settings.json 里写注释 / 尾逗号 = 语法错，整个文件被忽略；")
    A("- 改完没重启就以为生效，是最常见的假成功。")
    A("")
    L += _s_redline(res)
    return "\n".join(L)


# ---------------------------------------------------------------- 目标：continue

def build_continue(res, port):
    base = res["endpoints"]["baseUrl"]
    token = res["credential"]["accessToken"]
    models = _picks(_roster(res), 6)
    entries = []
    for m in models:
        e = {"title": "%s WorkBuddy" % (m.get("displayName") or m["id"]),
             "provider": "openai",
             "model": m["id"],
             "apiBase": base + "/v2",
             "apiKey": token}
        if m.get("supportsImages"):
            e["capabilities"] = {"uploadImage": True}
        entries.append(e)
    L = []
    A = L.append
    L += _s_task("Continue（VS Code / JetBrains 上的那个插件）")
    L += _s_real(res)
    L += _probe("Continue",
                r"Windows:  dir %USERPROFILE%\.continue\config.json",
                r"POSIX:    ls ~/.continue/config.json",
                ["- `~/.continue/config.json`（老版格式，本次就用这份）",
                 "- 只有 `config.yaml` 的话，说明装的是新版：照同样的字段写成 YAML（下面第五节写了对应关系）"])
    A("## 三、要写进去的东西（整份文件内容）")
    A("")
    A("```json")
    A(json.dumps({"models": entries}, ensure_ascii=False, indent=2))
    A("```")
    A("")
    A("字段这么理解：")
    A("")
    A("- `models[].provider` 固定写「openai」（Continue 用它来走 OpenAI 兼容协议，**不是** anthropic）；")
    A("- `apiBase` —— 接口基址，**以 `/v2` 结尾**（跟大多数中转站不一样，咱们这个是 `/v2`）；")
    A("- `apiKey` —— 上面那份明文 Key；")
    A("- `model` —— 第二节表格里的模型 ID；")
    A("- `title` 必填，界面上显示这个名字；名字里带上积分倍率更直观，比如 ` Hy3（免费额度）×0.00`。")
    A("")
    A("### 怎么让它生效")
    A("")
    A("**重启 VS Code / IDE**（Continue 插件不会热读 config.json）。")
    A("")
    L += _s_steps(_verify_openai(base, token),
                 extra_steps=["在 Continue 侧边栏点开模型下拉，看新加的那几个在不在；在就选最省的那个先聊一句。"])
    A("## 五、Continue 这几个坑（照做，别踩）")
    A("")
    A("- **`apiBase` 必须带 `/v2` 结尾**：写成 `.../v2/`（多一个斜杠）或者漏掉 `/v2` 都是 404；")
    A("- 你本来就有个 `config.yaml`（新版），那套是 `schema: v1` 的格式，字段同名：")
    A("  `models: [- name: xxx` / `provider: openai` / `model: hy3` / `apiBase: ...` / `apiKey: ...`；")
    A("  新版默认会走 `/responses`，咱们上游没有 → YAML/JSON 里加 `useResponsesApi: false`；")
    A("- 装了新版却去改 json，插件读的是 yaml，白改；**先探清楚到底有哪个文件**；")
    A("- Continue 内部会往 apiBase 拼 `/chat/completions`，所以这里只填基底，别把完整地址填进去。")
    A("")
    L += _s_redline(res)
    return "\n".join(L)


# ---------------------------------------------------------------- 目标：通用

def build_generic(res, port):
    base = res["endpoints"]["baseUrl"]
    token = res["credential"]["accessToken"]
    L = []
    A = L.append
    # 工具名只给短名，附加条件走 pre 单独成段 —— 塞进句子里会变「配进 任意一个第三方 AI 工具（…）（…）」两层括号
    L += _s_task("任意第三方 AI 工具",
                 pre="（只要能填 API 地址 + Key + 模型名就算；**具体配哪一个下面第 2 节会先问我。**）")
    L += _s_real(res)

    A("## 二、不同工具差在哪，怎么下手")
    A("")
    A("上面那一节是**所有 OpenAI 兼容工具通用**的：地址就这一个、Key 就这一串、")
    A("模型就第一节表格里那 %d 个。**换工具时值一个字都不用改**，变的只有两件事：" % len(_roster(res)))
    A("")
    A("1. **往哪儿写** —— 有的在设置界面里填几个框，有的要改配置文件（各改各的路径）；")
    A("2. **那几个框叫什么名** —— Base URL / API Key / Model / Provider，名字随工具变，")
    A("   **但填进去的值永远是第一节那几个**。")
    A("")
    A("### 按这个顺序走")
    A("")
    A("**先问我一句：要配到本机哪一个 AI 程序上？**")
    A("（**我回答的就是准的，照我说的做，不许自己猜、不许拿别的工具的写法硬套。**）")
    A("")
    A("我回答了之后，**先分清它是哪种协议**，照对应的分支走——这一步分错了，后面填的地址必错一个：")
    A("")
    A("| 这个工具最后发的是哪个路径（**看它实际发什么请求，别按工具名猜**） | 直连地址填什么 | 直连不通换桥，地址填什么 |")
    A("|---|---|---|")
    A("| 发 `/chat/completions` 的（opencode / dsh / Continue / Cursor / Cherry Studio 这类都落在这一条） | `https://copilot.tencent.com/v2` | `http://127.0.0.1:18791/v2`（**末尾 `/v2` 千万别省，省了就是 404**） |")
    A("| 发 `/v1/messages` 的（走 Anthropic 那套，比如 Claude Code——它配的是 `ANTHROPIC_BASE_URL`） | 不用试直连：上游只开 `/chat/completions` 这一条路，Anthropic 路径过去必然 401 / 404，直接取右边 | `http://127.0.0.1:18791`（**不带 `/v2`**——它自己会拼 `/v1/messages`，你多带一个 `/v2` 就拼成 `/v2/v1/messages` 直接 404） |")
    A("**dsh（DeepSeek Harness）的特殊性（2026-10-06 真机踩坑，必须单独说）**：dsh 桌面版发请求时，"
      "会**强制把自己的请求头锁成 `deepseek-harness/<版本>`**，这个头是保留字段、配置里改不掉。"
      "上游对这个头做了拦截（挡回 `code:11128`），所以**纯手填上游地址「直连」在 dsh 上必死**——"
      "它不像 opencode 那样能直连。但 dsh 想不靠桥就用 WorkBuddy，也不用装官方市场插件，"
      "用**本工具自带的 `workbuddy-llm` 插件**就能真直连：")
    A("")
    A("- **装 `workbuddy-llm` 插件（就在本工具 exe 的同一目录里、名为 `workbuddy-llm` 的文件夹，不随这条指令作为附件发送）**：插件在 dsh 进程内持 Key 直连上游，"
      "**免本工具常开、也免装官方市场插件**，装一次长期有效。下面「dsh 装插件」一节有完整步骤；")
    A("")
    A("> 一句话：dsh 上「优先直连」= 优先装本工具带的 `workbuddy-llm` 插件（不用开 exe、不用装官方插件）；"
      "想统一管理多个工具或装不了插件，才走本工具的桥（常开 exe）。**别照通用表格手填上游地址去「直连」dsh**，"
      "那一条在 dsh 上必 11128。")
    A("")
    A("**opencode（OpenCode）的实测结论（2026-10-06 真机跑通的）**：opencode 也落在上面第一条，"
      "直连上游就行、不用桥。但它有个坑只有真跑才暴露——"
      "**光把「地址 + Key + 模型名」填进去是不够的**：opencode 的模型是「不声明就不存在」，"
      "模型必须写进配置文件的 `provider.<名字>.models` 这个 map 里（键就是模型 ID）才会出现；"
      "只写个 `\"model\": \"workbuddy/hy3\"` 或者别的字段，**它连请求都发不出去**，"
      "直接报 `ProviderModelNotFoundError: providerID:\"workbuddy\" modelID:\"hy3\"`，"
      "看着像地址配错了，其实地址一分没错。")
    A("")
    A("- **别写 `whitelist` 这个字段** —— opencode 1.2.16 压根没这项（本机实测："
      "写了它，`opencode models workbuddy` 一个模型都列不出来；换成 `models` map 之后那批模型"
      "立刻全列出来）。所以「模型灰着是不是要手动点开启」那是瞎猜，真因是字段写错了。")
    A("- **它自带真命令行，两条命令验到底**：")
    A("")
    A("  ```bat")
    A("  opencode models workbuddy")
    A("  opencode run \"只回两个字：通了\"")
    A("  ```")
    A("")
    A("  第一条应该列出第一节那批模型 ID（列不出来就是 `models` 段没写）；"
      "第二条应该真把那几个字打出来（stderr 上会有 `> build · hy3` 那行），rc=0。")
    A("- **配置落点**：Windows 是 `%USERPROFILE%\\.config\\opencode\\opencode.json`（带注释的 "
      "`.jsonc` 同格式）；程序本体在 `%USERPROFILE%\\.opencode\\bin\\opencode.exe`。"
      "**改之前把那份配置整份备份**，而且 opencode 顶层**没有 `--config` 参数**，"
      "想拿别的配置试错只能改它真实的那一个文件。")
    A("- **改完必须把 opencode 进程彻底关掉再开**（任务栏托盘里的也退干净），"
      "它还跑着的话读的是内存里那份老配置，光改文件没用。")
    A("")
    A("**dsh（「双击 exe 装的桌面版」）走「装 workbuddy-llm 插件」这条路，步骤照下面做**"
      "（本机已实测跑通，国内模型可用）：")
    A("")
    A("### dsh 装 workbuddy-llm 插件（推荐，免 exe 常开）")
    A("")
    A("`workbuddy-llm` 是**本工具的插件文件夹**，它和本工具的可执行文件（exe）放在**同一个目录**里"
      "（文件夹名就是 `workbuddy-llm`，与 exe 平级，**不随这条指令作为附件发送，用户只发纯文字即可**）。它在 dsh 进程内起一个本地传话筒，拿着 WorkBuddy Key 直连上游，"
      "所以装好一次就长期有效，不用一直开着本工具的 exe。")
    A("")
    A("**安装步骤（在用户本机执行）：**")
    A("")
    A("1. **定位插件文件夹**：在本机直接搜索名为 `workbuddy-llm` 的文件夹即可（它和本工具 exe 平级放在同一目录，"
      "用户没有改过这个文件夹名）。搜到后它就是插件本体；若搜不到，再请用户指出本工具 exe 当前所在位置，"
      "取其同目录里的 `workbuddy-llm` 子文件夹——**全程不要写死任何绝对路径**，用户把工具文件夹改名也不影响；")
    A("2. 把整个 `workbuddy-llm` 文件夹**复制**到 dsh 桌面版的插件目录：")
    A("   `%USERPROFILE%/.dsh/profiles/desktop/node_modules/workbuddy-llm/`")
    A("   （`<用户名>` 不用管，直接用 `%USERPROFILE%` 这个环境变量即可；如果 `node_modules` 不存在就新建；")
    A("   注意是 `%USERPROFILE%/.dsh/profiles/desktop`，**不是** `%APPDATA%/dsh-desktop`，"
      "桌面版（双击 exe 开的）走的是 `desktop` profile）；")
    A("3. 把第一节那整串真 Key 写到 Key 文件：")
    A("   `%APPDATA%/dsh-desktop/harness/.workbuddy_key`")
    A("   （文件里**只放那一串 Key 本身**，不要加引号、不要换行；插件运行时读这个文件）；")
    A("4. **彻底退出 dsh 再重开**（托盘里的也退干净，否则读的是旧配置）；")
    A("5. 打开 dsh 的模型列表，应当出现 **WorkBuddy（国内）** 一组；"
      "挑一个（比如 `Hy3`）发条消息验通。")
    A("   （这批模型 ID 同官方 WorkBuddy 客户端国内版，插件已固化、不用手填。）")
    A("")
    A("- **⚠ 如果复制完重启 dsh、模型列表里没出现 WorkBuddy**：说明 dsh 没有自动识别手动复制的插件"
      "（官方插件是从 dsh 市场装的、市场会写注册表，纯手拖可能不认）。这种情况回告我，"
      "改用「dsh 市场装官方 workbuddy 插件」或「本工具桥」那两条路；")
    A("- **别再去 dsh 设置页手填任何 WorkBuddy 的 Key / 地址**：插件自己管这些，手填反而会把配置搞乱；")
    A("- **插件的 Key 文件 `.workbuddy_key` 别折行、别加引号**：Key 是一长串，写坏就读不出；")
    A("")
    A("**dsh 验通看返回**：发消息后把 dsh 返回的原文（或报错码，比如 `MISSING_CREDENTIAL` / `Connection error`）报回来，"
      "别只说「不行」。看到 `400 status code` 先确认带不带 body——")
    A("**带 body 的 400 看 body 里的 `code`（11101=没开流式 / 11102=模型名不对）；"
      "不带 body 的 400 是本机中间层（代理/桥）回的，跟配置无关。**")
    A("我回答了之后，照这三步做：")
    A("")
    A("1. **找它的落点**：先用常规的探测命令找，找不到就问我要路径，**不许编一个本机没有的路径**；")
    A("2. **按它自己的规矩填** —— 界面有框就填框，要改文件就改文件，")
    A("   填进去的是第一节那几个**真实值**：")
    A("")
    A("   | 这个工具里那个框 | 填什么 |")
    A("   |---|---|")
    A("   | API 地址 / Base URL | `%s/v2` |" % base)
    A("   | API Key | 第一节里那一整串（**别自己补 `Bearer `**——多数工具会自己补前缀，")
    A("     你再补一层就成 `Bearer Bearer ...` 直接 401） |")
    A("   | 协议 | OpenAI Chat Completions，**并且开着流式** |")
    A("   | 模型名 | 第一节表格里的 **ID**（不是显示名，也不是别人转述的名字） |")
    A("")
    A("3. **让它生效，然后真发一次请求验通**：")
    A("")
    A("   - 生效方式按那个工具的规矩来（重启它 / 重载配置 / 重开终端）；")
    # 旧版写「下面那几行原样跑」，但中间夹了换桥条件/间隔/报结果三条，命令其实在文末 —— 改成按位置指
    A("   - **OpenAI 协议的工具（dsh 除外——它已单独走装插件、别按本段去手填直连，否则必 11128）：先按直连配** —— 地址填第一节那串 `%s/v2`，最下面那段代码块里那一行原样跑一次；" % base)
    A("   - **直连不通才换桥**（不通的标准：HTTP 不是 200、返回的是网页、模型不回话、")
    A("     报鉴权错 / 渠道校验没过 / 超时，都算不通）：把地址整个换成 `http://127.0.0.1:18791/v2`")
    A("     —— **Key 和模型一个字都不改，只动地址这一处**，而且**这一串末尾的 `/v2` 千万别省，")
    A("     省了就是 404**，跟上面直连那份长得几乎一样，只是把网址换成本机；换完再真发一次验；")
    A("   - **Anthropic 协议的工具（Claude Code 这类（凡是按 `ANTHROPIC_BASE_URL` 走的））：不用试直连，直接走桥** —— ")
    A("     地址填 `http://127.0.0.1:18791`（**不带 `/v2`**），Key 和模型照旧，")
    A("     然后真发一次验；这一类地址填对了通常一次就通，不通就是地址多带了一个 `/v2` 或者漏了；")
    A("   - **别连着猛发**：一次只验一个模型，**两次请求之间隔 5~10 秒**。"
      "上游对短时间里的密集请求会当成异常访问，轻则限流、重则直接挡回网页（看着像成功其实没跑起来），")
    A("     那样你会把真问题误判成「配置没生效」，白折腾一遍。")
    A("   - 下面这几行我把值都替你填好了，原样跑：")
    A("")
    A("   ```")
    for v in _verify_openai(base, token):
        A(v)
    A("   ```")
    A("")
    A("   - **把真实结果原样报给我**：HTTP 状态码是多少、返回内容的前几十个字是什么；")
    A("     **不要只回一句「配置成功」**。**明文 Key 上面已经整串给全了，直接拿去配，")
    A("     别打码、别拆解、也别再回头向我要一遍**；")
    A("     不通就分别说是地址不对、密钥不对，还是模型 ID 上游没开。")
    A("")
    A("## 三、几条硬规矩（照着做就不会出事）")
    A("")
    A("- **优先直连，不通才换桥**：OpenAI 协议的工具先填 `%s/v2`，工具自己会拼 `/chat/completions`；填完整地址、多带一层 `/v2` 会 404；" % base)
    A("  **Anthropic 协议的工具（Claude Code）例外，不用试直连** —— 上游只收 OpenAI 格式，")
    A("  Anthropic 格式过去必然 401 / 404；")
    A("- **换桥是兜底**：直连真的跑不通时，才把地址换成桥地址，**桥地址看协议**：")
    A("- **桥是「得一直开着 exe」的兜底路线**：桥跑在 本工具 exe 进程里，**这条路线成立的前提就是那个 exe 一直开着**，它一关这条线立刻断，不能当成「配好就永久有效」来交差；  **凡是靠桥才通的（dsh 走桥、Claude Code 走桥都算），回复我时必须原样提醒：这条路必须开着本工具 exe 才成立**。dsh 若装了本工具自带的 workbuddy-llm 插件（或官方 workbuddy 插件）真直连，则不用提醒、也不依赖本工具 exe 常开。")
    A("  OpenAI 协议 → `http://127.0.0.1:18791/v2`（**末尾 `/v2` 别省**，省了 404）；")
    A("  Anthropic 协议 → `http://127.0.0.1:18791`（**不带 `/v2`**）。Key 和模型照旧；")
    A("- **必须流式**：上游只收 `stream: true`。任何把「一次性拿完 / 关掉流式」的选项打开的设置都会挂；")
    A("- **模型只填第一节表格里的 ID** —— 不填显示名，不用别人转述的名字。")
    A("  上游认的是这个 ID，认不出来就是「这个模型没开给你」，换表里另一个。")
    A("")
    A("（换工具换的是「往哪儿写」，不是「写什么」。上面这几条不管换哪个工具都一样。）")
    A("")
    L += _s_redline(res, num="四")   # 通用页只有 一二三四 四节，红线就是「四」
    return "\n".join(L)


# ---------------------------------------------------------------- 装配

# 顺序 = 界面上标签的顺序。
# 2026-10-05 老王拍板：**只留一个「通用」页**，把原来按工具分的那几页全部并进来。
# 理由：换工具变的只是「往哪儿写（界面填框 / 改哪个文件）」，**要填的永远是一样的几个值**，
# 分页反而让人以为每家都得重新找一份说明书。现在这一页就是「所有第三方 AI 工具通用」的那一份。
#
# 下面的 build_opencode / build_dsh（以及 codex / claude / continue 三个）函数留着没删——
# 哪天要回到按工具分页，把它们加回 TARGETS 就能回归，不用重写。
TARGETS = [
    {"key": "generic", "title": "通用（所有第三方 AI 工具）",
     "file": "WorkBuddy接入第三方工具-配置指令.md", "build": build_generic},
    {"key": "deepseek_harness", "title": "DeepSeek Harness",
     "file": "WorkBuddy接入-DeepSeekHarness-配置指令.md", "build": build_dsh},
    {"key": "opencode", "title": "OpenCode",
     "file": "WorkBuddy接入-OpenCode-配置指令.md", "build": build_opencode},
]


def build(key, res, port=0):
    """按目标生成文案；key 不认识就退回第一个"""
    t = next((x for x in TARGETS if x["key"] == key), TARGETS[0])
    return t["build"](res, port)


def titles():
    return [{"key": t["key"], "title": t["title"], "file": t["file"]} for t in TARGETS]
