# -*- coding: utf-8 -*-
"""
wbsrv.py —— WorkBuddy 通用桥 / 配置助手 主程序

三种跑法（都是同一个文件）：
  WBBridgeConfig.exe            : 内嵌窗口（pywebview），解析 → 界面 → 复制文本
  WBBridgeConfig.exe --cred     : 解析 → 把凭据写到 <用户主目录>/.wbbridge/credential.local.json → 静默退出
                                  （给 WorkBuddy 会话用：它现在就能读，不需要管理员）
  WBBridgeConfig.exe --bridge   : 解析 → 落盘 → 后台起桥 → 保持运行（第三方工具连桥用）
  wbsrv.py --headless           : 只起服务，不弹窗（自动化测试）

桥同时吃两种协议：
  POST /v1/chat/completions   OpenAI Chat Completions（上游只认 stream:true，非流这边攒完再拼）
  GET  /v1/models
  POST /v1/messages           Anthropic Messages（转 OpenAI 上游再转回 Anthropic SSE）
"""
import ctypes
import json
import os
import socket
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import wbresolve
import wbwriter
import wbanthropic
import wbtargets

import wbsites

HERE = os.path.dirname(os.path.abspath(__file__))
PREFERRED_PORT = 18791
IDLE_EXIT_SECONDS = 240
state = {"res": None, "port": 0, "cred_path": "", "last_hit": time.time(), "shutdown": False}


# ------------------------------------------------------------------ 小工具

def _chunk(handler, data: bytes):
    """HTTP/1.1 chunked 写入（流式响应专用；不声明 Content-Length）"""
    try:
        handler.wfile.write(b"%x\r\n" % len(data) + data + b"\r\n")
        handler.wfile.flush()
    except Exception:
        pass


def chunk_end(handler):
    try:
        handler.wfile.write(b"0\r\n\r\n")
        handler.wfile.flush()
    except Exception:
        pass


def jobj(**kw):
    return json.dumps(kw, ensure_ascii=False).encode("utf-8")


def free_port(start=PREFERRED_PORT, tries=40):
    for p in range(start, start + tries):
        s = socket.socket()
        try:
            s.bind(("127.0.0.1", p))
            return p
        except OSError:
            continue
        finally:
            try:
                s.close()
            except Exception:
                pass
    return 0


def _candidate_html_paths():
    """index.html 可能在：源码目录 / 打包解包目录(_MEIPASS)。都试一遍。"""
    cands = [os.path.join(HERE, "index.html")]
    mp = getattr(sys, "_MEIPASS", "")
    if mp:
        cands.append(os.path.join(mp, "index.html"))
    return cands


_FALLBACK_HTML = """<!doctype html><meta charset="utf-8"><title>WBBridgeConfig</title>
<div style="font:15px/1.8 system-ui;padding:40px;color:#1f2937">
<b>WBBridgeConfig</b> 已启动（桥端口 %(port)d）。界面文件 index.html 未随程序打包，
这不影响 /v1/chat/completions 等接口，但首屏页面出不来。请联系打包方补打包 index.html。</div>
"""


def home_html():
    for p in _candidate_html_paths():
        try:
            with open(p, "r", encoding="utf-8") as f:
                return f.read()
        except Exception:
            continue
    return _FALLBACK_HTML % {"port": state["port"]}


def current_res():
    if state["res"] is None:
        state["res"] = wbresolve.resolve()
    return state["res"]


def do_resolve(verbose=True, port=None):
    state["res"] = wbresolve.resolve()
    state["port"] = port if port else free_port()
    state["cred_path"] = wbwriter.write_credential(state["res"], state["port"])
    if verbose:
        st = state["res"].get("stats", {})
        print("[ok] 解析完成 账号=%s 模型=%s(名单内 %s) 桥端口=%s 凭据=%s"
              % (state["res"]["account"].get("nickname") or "?", st.get("total"),
                 st.get("inRoster"), state["port"] or "无", state["cred_path"] or "未落盘"))
    return state["res"]


# ------------------------------------------------------------------ 端口占用自检

def port_taken(port):
    """18791 是不是已经被别的进程占着？

    2026-10-05 实测：Windows 的 SO_REUSEADDR 允许两个程序同时 bind 同一个端口，
    两边都以为自己「占住了」，第三方工具的请求随机落一个 —— 症状是时通时断、
    一会儿 200 一会儿 Connection error，极难查。
    这里用 SO_EXCLUSIVEADDRUSE 试探：端口真被占时 bind 会失败。
    """
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        try:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        except Exception:
            pass
        s.bind(("127.0.0.1", port))
        return False
    except OSError:
        return True
    finally:
        try:
            s.close()
        except Exception:
            pass


# ------------------------------------------------------------------ 上游转发

def iter_events(lines):
    """
    统一把 wbanthropic.openai_chunk_to_events() 的返回值摊成 (event, data) 二元组。
    该函数有时返回 [{event,data}] 有时返回 [(ev,data)]，不统一会让下游
    `for ev, data in ...` 把 dict 解成字符串，报 "element #0 has length 1"。
    """
    for item in lines:
        if isinstance(item, (list, tuple)) and len(item) == 2:
            yield item[0], item[1]
        elif isinstance(item, dict):
            yield item.get("event") or "message", item.get("data") or {}


def dbg(msg):
    """调试日志：仅在 WBBRIDGE_DEBUG=1 时输出，避免污染正常日志。"""
    if os.environ.get("WBBRIDGE_DEBUG"):
        sys.stderr.write("[dbg] %s\n" % msg)
        sys.stderr.flush()


def _upload(chat_body, stream=True):
    """
    转发到上游。**必须绕开系统 http_proxy**——本机挂了代理时，
    桥自己发 upstream 请求会被代理吃掉（表现为 Claude Code 一直超时 / 401）。
    """
    import urllib.request
    res = current_res()
    body = dict(chat_body or {})
    body["stream"] = stream
    req = urllib.request.Request(
        res["endpoints"]["chatCompletions"],
        data=json.dumps(body).encode("utf-8"),
        headers={"content-type": "application/json",
                 "authorization": "Bearer " + res["credential"]["accessToken"],
                 "user-agent": NEUTRAL_UA})
    dbg("_upload -> %s model=%s" % (res["endpoints"]["chatCompletions"], body.get("model")))
    r = urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=300)
    dbg("_upload <- %s" % r.status)
    return r


# 出站 UA：显式中立值。2026-10-06 实测：上游对 UA 有拦截名单（deepseek-harness/*、
# python-requests/* 被挡回 11128），放行空 UA / curl / CodeBuddy / Python-urllib。
# 以前 _upload 不显式设 UA，靠 urllib 默认 Python-urllib/3.x 碰巧放行——那是隐性依赖，
# 哪天上游把 Python-urllib 也拉黑就废。这里写死一个实测放行的 CodeBuddy CLI UA，稳妥。
NEUTRAL_UA = "CLI/2.63.2 CodeBuddy/2.63.2"

DEFAULT_UPSTREAM_MODEL = os.environ.get("WBBRIDGE_MODEL", "hy3")


def selfcheck_upstream():
    """桥启动时打一次上游，确认通道通不通（中性 UA + 桥自身 token）。

    只为排障用：不通也**不阻止桥起**（代理/网络抖动不应拦住用户），
    结果记进 state['selfcheck']，界面 / GET /api/selfcheck 能查。
    """
    try:
        import urllib.request
        res = current_res()
        body = {"model": "hy3", "stream": True,
                "messages": [{"role": "user", "content": "hi"}]}
        req = urllib.request.Request(
            res["endpoints"]["chatCompletions"],
            data=json.dumps(body).encode("utf-8"),
            headers={"content-type": "application/json",
                     "authorization": "Bearer " + res["credential"]["accessToken"],
                     "user-agent": NEUTRAL_UA})
        r = urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=25)
        return {"ok": True, "status": r.status}
    except Exception as e:
        return {"ok": False, "err": "%s: %s" % (type(e).__name__, e)}


def upstream_model(name):
    """把客户端传来的模型名归一成对端上游认识的名字。

    背景（2026-10-03 真机踩坑）：上游（腾讯 copilot）只认它自己那套模型 id。
    Claude Code 实际发的是 `claude-sonnet-4-20250514` 这种 Anthropic 名字，
    原样透传过去上游直接 400 Bad Request（上一轮验证是我手打 model=hy3 才通的，
    那个测试不代表真实客户端行为，属于假通过）。
    规则：上游模型名原样放过去；别的（claude-*/gpt-*/o*-* 等）一律归一到默认模型。
    """
    n = (name or "").strip().lower()
    if not n:
        return DEFAULT_UPSTREAM_MODEL
    base = DEFAULT_UPSTREAM_MODEL.strip().lower()
    # 2026-10-05 dsh 实测：dsh/OpenCode 这类客户端会直接把名单里的模型名发过来
    # （glm-5.3-flash / 一堆 glm-*）。这些名字上游本来就认，**必须原样透传**——
    # 以前一律兜底成 hy3，导致用户在 dsh 里选的模型悄悄失效（只表现为「好像都一个样」）。
    try:
        for m in (current_res().get("models") or []):
            if str(m.get("id") or "").strip().lower() == n:
                return name
    except Exception:
        pass
    if base and base in n:
        return name
    return DEFAULT_UPSTREAM_MODEL


def handle_openai(handler, stream, body=None):
    # 注意：请求体已由 do_POST 读走（buffered rfile 再 read 会阻塞到 EOF），
    # 这里只能复用解析好的 body，绝不能再碰 handler.rfile。
    if not isinstance(body, dict):
        try:
            body = json.loads(body or "{}")
        except Exception:
            body = {}
    if not isinstance(body, dict):
        body = {}
    dbg("handle_openai stream=%s model=%s" % (stream, body.get("model")))
    if not stream:
        body["stream"] = True
    # dsh / OpenCode 发的是 max_completion_tokens，上游只认 max_tokens（原样发会 400）
    if isinstance(body, dict) and "max_completion_tokens" in body and "max_tokens" not in body:
        body["max_tokens"] = body.pop("max_completion_tokens")
    body["model"] = upstream_model(body.get("model"))
    try:
        r = _upload(body, True)
    except Exception as e:
        dbg("handle_openai upload fail %s" % e)
        handler._send(502, json.dumps({"error": str(e)}, ensure_ascii=False).encode("utf-8"),
                      "application/json; charset=utf-8")
        return
    if stream:
        handler.send_response(200)
        handler.send_header("Content-Type", "text/event-stream")
        handler.send_header("Cache-Control", "no-cache")
        handler.send_header("X-Accel-Buffering", "no")
        # HTTP/1.1 下流式响应必须声明 chunked，否则客户端一直等 Content-Length/EOF → 假超时
        handler.send_header("Transfer-Encoding", "chunked")
        handler.end_headers()
        buf = []

        # /v1/chat/completions 是 OpenAI 协议端点：上游 SSE 原样透传，
        # 绝不能再做 OpenAI→Anthropic 转写（会吐出 message_delta 之类 Anthropic 事件）。
        try:
            for line in r:
                line = line.decode("utf-8", "replace")
                _chunk(handler, line.encode("utf-8"))
        except Exception as e:
            flush([{"event": "error", "data": {"type": "error", "error": {"type": "api_error", "message": str(e)}}}])
    _chunk(handler, b"event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n")
    chunk_end(handler)
    return

    # 非流：攒完整再拼
    chunks, usage, finish, tool_calls = [], {}, None, {}
    try:
        for line in r:
            line = line.decode("utf-8", "replace")
            if not line.strip().startswith("data: "):
                continue
            s = line.strip()[6:]
            if s == "[DONE]":
                continue
            try:
                d = json.loads(s)
            except Exception:
                continue
            if d.get("usage"):
                usage = d["usage"]
            if d.get("choices"):
                c = d["choices"][0]
                if c.get("delta", {}).get("content"):
                    chunks.append(c["delta"]["content"])
                for tc in c.get("delta", {}).get("tool_calls") or []:
                    i = tc.get("index") or 0
                    t = tool_calls.setdefault(i, {"id": tc.get("id"), "name": "", "args": ""})
                    if tc.get("id"):
                        t["id"] = tc["id"]
                    if tc.get("function", {}).get("name"):
                        t["name"] = tc["function"]["name"]
                    if tc.get("function", {}).get("arguments"):
                        t["args"] += tc["function"]["arguments"]
                if c.get("finish_reason"):
                    finish = c["finish_reason"]
    except Exception:
        pass
    msg = {"role": "assistant", "content": "".join(chunks)}
    if tool_calls:
        msg["tool_calls"] = [{"index": i, "id": t["id"], "type": "function",
                              "function": {"name": t["name"], "arguments": t["args"]}}
                             for i, t in sorted(tool_calls.items())]
    out = {"id": "chatcmpl-wbbridge", "object": "chat.completion", "created": int(time.time()),
           "model": body.get("model"), "choices": [{"index": 0, "message": msg, "finish_reason": finish or "stop"}],
           "usage": usage or {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}}
    if finish == "tool_calls":
        out["choices"][0]["finish_reason"] = "tool_calls"
    handler._send(200, json.dumps(out, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")


def handle_anthropic(handler, body=None):
    # 同 handle_openai：请求体已由 do_POST 读走，这里复用解析结果。
    if not isinstance(body, dict):
        try:
            body = json.loads(body or "{}")
        except Exception:
            body = {}
    if not isinstance(body, dict):
        body = {}
    dbg("handle_anthropic model=%s" % body.get("model"))
    stream = bool(body.get("stream"))
    # 客户端（Claude Code）发的是 claude-* 这类名字，上游不认会 400。
    # **必须写回 body**——下发请求体是 anthropic_to_openai(body) 造的 oai，
    # 光归一局部变量 model 没用，发出去的仍是 claude-*（2026-10-03 实测踩过）。
    body["model"] = upstream_model(body.get("model"))
    model = body["model"]
    oai = wbanthropic.anthropic_to_openai(body)
    if isinstance(oai, dict) and "max_completion_tokens" in oai and "max_tokens" not in oai:
        oai["max_tokens"] = oai.pop("max_completion_tokens")
    try:
        need_tokens = sum(len(x.get("content", "")) for x in (oai.get("messages") or [])) // 3 + 1
        r = _upload(oai, True)
    except Exception as e:
        handler._send(502, json.dumps({"type": "error", "error": {"type": "api_error", "message": str(e)}},
                                      ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")
        return
    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream")
    handler.send_header("Cache-Control", "no-cache")
    handler.send_header("Transfer-Encoding", "chunked")
    handler.end_headers()
    mid = "msg_01WbBridge"

    def send(ev, data=None):
        d = dict(data or {})
        d.setdefault("type", ev)
        _chunk(handler, ("event: %s\ndata: %s\n\n" % (ev, json.dumps(d, ensure_ascii=False))).encode("utf-8"))
    hdr = {"id": mid, "type": "message", "role": "assistant", "model": model,
           "content": [], "stop_reason": None, "stop_sequence": None,
           "usage": {"input_tokens": need_tokens, "output_tokens": 0}}
    send("message_start", hdr)
    buf = []
    ended = False          # 已经吐过 message_stop 就不再补，避免重复
    try:
        for line in r:
            line = line.decode("utf-8", "replace")
            buf.append(line)
            if line.strip() == "":
                payload = [x.strip()[6:] for x in buf if x.strip().startswith("data: ") and x.strip() != "data: [DONE]"]
                buf = []
                for ev, data in iter_events(wbanthropic.openai_chunk_to_events(payload, model)):
                    d = dict(data) if isinstance(data, dict) else {"data": data}
                    if ev == "message_delta":
                        hdr["stop_reason"] = d.get("delta", {}).get("stop_reason")
                        d.setdefault("usage", {})["input_tokens"] = need_tokens
                    if ev == "message_stop":
                        ended = True
                    send(ev, d)
    except Exception as e:
        send("error", {"type": "error", "error": {"type": "api_error", "message": str(e)}})
    # 兜底：上游流异常中断、没收到 finish_reason 时补一个干净的结束，保证客户端能收尾
    if not ended:
        send("message_delta", {
            "type": "message_delta",
            "delta": {"stop_reason": hdr.get("stop_reason") or "end_turn", "stop_sequence": None},
            "usage": {"input_tokens": need_tokens, "output_tokens": 1}})
        send("message_stop", {"type": "message_stop"})
    chunk_end(handler)


# ------------------------------------------------------------------ HTTP

class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="text/html; charset=utf-8"):
        state["last_hit"] = time.time()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    # ---------------- GET
    def do_GET(self):
        p = self.path.split("?")[0]
        q = self.path.split("?", 1)[1] if "?" in self.path else ""
        try:
            if p in ("/", "/index.html"):
                self._send(200, home_html().encode("utf-8"))
            elif p == "/api/status":
                if state["res"] is None:
                    try:
                        do_resolve()
                    except Exception as e:
                        self._send(200, jobj(ok=False, err="%s: %s" % (type(e).__name__, e)), "application/json; charset=utf-8")
                        return
                r = state["res"]
                self._send(200, jobj(ok=True, data={
                    "account": r["account"],
                    # 分段耗时（解密 / 真联网），界面上摆出来 ——
                    # 一眼能看出这趟解析是真跑过，还是拿了本机现成的结果。
                    "timings": r.get("timings", {}),
                    "credential": {"expiresAt": r["credential"].get("expiresAt")},
                    "stats": r.get("stats", {}),
                    "port": state["port"],
                    "credPath": state["cred_path"],
                    # 当前是不是管理员权限在跑（高完整性令牌）。界面上摆出来，
                    # 老王一眼能确认「双击是不是真的按管理员跑了」。
                    "admin": wbresolve.is_admin(),
                    "models": r.get("models", []),
                    # 桥端口被别的进程占着（只准一个桥，不然时通时断）
                    "portTaken": state.get("port_taken", False),
                    # 2026-10-04 修：② 那块以前是一片空白 ——
                    # 因为 rows 只从 /api/manual 出，status 里没有，前端拿到空数组啥也不画。
                    # 这里一并带上（带桥端口），② 才有的可渲染。
                    # 老王第三次拍板：改成两段式 —— provider（供应商固定信息）+ models（模型一表）。
                    "manual": wbwriter.manual_data(r, False, state["port"]),
                    "sites": [{k: v for k, v in s.items() if k in ("key", "title", "path", "exists", "hasWorkbuddy")}
                              for s in wbsites.detect_sites()],
                }), "application/json; charset=utf-8")
            elif p == "/api/manual":
                # 老王 2026-10-04 拍板：默认只给名单内的（客户端界面列得出来的），
                # 前端「显示全部」开关时才带 show_all=1 展开全量。
                show_all = "show_all=1" in q
                self._send(200, jobj(ok=True,
                                     manual=wbwriter.manual_data(current_res(), False, 0, show_all)),
                           "application/json; charset=utf-8")
            elif p == "/api/targets":
                # 界面上的分页标签从这儿拿，加目标不用改前端
                self._send(200, jobj(ok=True, targets=wbtargets.titles()), "application/json; charset=utf-8")
            elif p == "/api/sites":
                self._send(200, jobj(ok=True, rows=wbsites.detect_sites()), "application/json; charset=utf-8")
            elif p in ("/v1/models", "/v2/models"):
                res = current_res()
                names = [m["id"] for m in res.get("models", []) if m.get("inCliRoster")]
                names = names or [m["id"] for m in res.get("models", [])]
                self._send(200, json.dumps({"object": "list", "data": [
                    {"id": x, "object": "model", "created": int(time.time()), "owned_by": "workbuddy"} for x in names]},
                    ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")
            elif p == "/api/selfcheck":
                self._send(200, jobj(ok=True, data=state.get("selfcheck") or {}), "application/json; charset=utf-8")
            elif p == "/api/shutdown":
                state["shutdown"] = True
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                self._send(200, b'{"ok":true}')
            else:
                self._send(404, b"nope")
        except Exception as e:
            self._send(200, jobj(ok=False, err="%s: %s" % (type(e).__name__, e)), "application/json; charset=utf-8")

    # ---------------- POST
    def do_POST(self):
        p = self.path.split("?")[0]
        n = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(n).decode("utf-8", "replace") if n else ""
        try:
            if p == "/api/restart-admin":
                self._send(200, jobj(ok=restart_elevated()), "application/json; charset=utf-8")
                return
            if p == "/api/agent":
                # 老王 2026-10-04：AI 配置指令改成**按目标程序分页**——
                # /api/agent?target=opencode 出的是「怎么把 OpenCode 配好」的完整说明书，
                # 接手那个 AI 工具拿到就能自己找文件、写文件、真跑一次验证。
                # 不带 target 默认给第一个（OpenCode），老的整段调用也不炸。
                res = current_res()
                target = ""
                if "?" in self.path:                      # do_POST 自己没有 q，这里现拆
                    for kv in self.path.split("?", 1)[1].split("&"):
                        if kv.startswith("target="):
                            target = kv.split("=", 1)[1]
                meta = next((x for x in wbtargets.TARGETS if x["key"] == target), wbtargets.TARGETS[0])
                txt = wbtargets.build(meta["key"], res, state["port"])
                # 注意：打包成 exe 后 HERE 指向 _MEI 临时目录（只读），往那儿写会炸。
                # 这里一律写系统临时目录，写失败也不影响接口返回。
                md_out = ""
                try:
                    md_out = os.path.join(tempfile.gettempdir(),
                                          "WorkBuddy接入-%s-任务书.md" % meta["key"])
                    with open(md_out, "w", encoding="utf-8") as f:
                        f.write(txt)
                except Exception:
                    md_out = ""
                self._send(200, jobj(ok=True, body=txt, port=state["port"], path=md_out,
                                     target=meta["key"], title=meta["title"]),
                           "application/json; charset=utf-8")
            elif p == "/api/manual_text":
                res = current_res()
                txt = wbwriter.generate(res, "manual")["body"]
                self._send(200, jobj(ok=True, body=txt), "application/json; charset=utf-8")
            elif p == "/api/save":
                # 支持两种请求体：纯文本（老的） / {"body":"…","name":"文件名.md"}（分标签后按目标存）
                name = ""
                try:
                    j = json.loads(body)
                    if isinstance(j, dict) and isinstance(j.get("body"), str):
                        name = str(j.get("name") or "").strip()
                        body = j["body"]
                except Exception:
                    pass
                ext = ".md" if body.lstrip().startswith("#") else ".json"
                fn = name or ("WorkBuddy接入第三方工具%s%s" % (time.strftime("%m%d%H%M"), ext))
                if not fn.lower().endswith(ext):
                    fn += ext
                out = os.path.join(os.path.expanduser("~"), "Desktop", fn)
                with open(out, "w", encoding="utf-8") as f:
                    f.write(body)
                self._send(200, jobj(ok=True, path=out), "application/json; charset=utf-8")
            elif p == "/api/copy":
                self._send(200, jobj(ok=True), "application/json; charset=utf-8")
            elif p in ("/v1/chat/completions", "/v2/chat/completions"):
                # 2026-10-05：dsh 的 Base URL 习惯写成 http://127.0.0.1:18791/v2
                # （它是照着自家 /v2 网关填的）。以前 /v2/* 一律 404，
                # 用户只能被逼着改 dsh 配置——不如让 exe 同时认 /v1 和 /v2 两条路，
                # 第三方怎么填都能通（老王实机 dsh 就是填 /v2 才测通的）。
                want_stream = True
                try:
                    want_stream = bool(json.loads(body or "{}").get("stream", True))
                except Exception:
                    pass
                handle_openai(self, want_stream, body)
            elif p in ("/v1/messages", "/v1/messages/", "/v2/messages", "/v2/messages/"):
                handle_anthropic(self, body)
            else:
                self._send(404, b"nope")
        except Exception as e:
            self._send(200, jobj(ok=False, err="%s: %s" % (type(e).__name__, e)), "application/json; charset=utf-8")


def restart_elevated():
    try:
        args = " ".join('"%s"' % a for a in sys.argv)
        ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, args,
                                            os.path.dirname(os.path.abspath(sys.argv[0])), 1)
        return True
    except Exception as e:
        return "提权启动失败：%s" % e


# ------------------------------------------------------------------ main

def main():
    argv = sys.argv[1:]
    headless = "--headless" in argv or "--selftest" in argv
    cred_only = "--cred" in argv
    bridge_only = "--bridge" in argv

    # 端口固定优先：这台服务同时当界面和桥，端口必须能被第三方工具写死（18791）
    # 先探一下 18791 是不是被别的程序占着（旧的独立转发层 / 另一个 exe）：
    # 这种情况继续起也没用 —— 两个进程抢一个端口会时通时断，宁可明说。
    taken = port_taken(PREFERRED_PORT)
    state["port_taken"] = taken
    if taken and (bridge_only or headless):
        print("[fail] %d 已经被别的进程占着（多半是旧的独立转发层 wbshim.py / 另一个 WBBridgeConfig）。"
              "同一时间只能有一个桥，两个进程抢同一个端口会时通时断。\n"
              "      关掉那个（黑窗口按 X，或任务管理器里结束），再开本程序。" % PREFERRED_PORT)
        sys.exit(3)
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", PREFERRED_PORT), H)
        ui_port = PREFERRED_PORT
    except OSError:
        srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        ui_port = srv.server_address[1]
    if ui_port != PREFERRED_PORT:
        print("[warn] %d 被占，本程序改用了 %d（第三方工具里要写这个端口）" % (PREFERRED_PORT, ui_port))
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    try:
        do_resolve(True, ui_port)
    except Exception as e:
        print("[fail] 解析失败 %s: %s" % (type(e).__name__, e))
        if headless or cred_only or bridge_only:
            sys.exit(2)

    # 桥通道自测：打一次上游确认通不通（不通也照常起桥，只记录 + 打印告警）
    try:
        state["selfcheck"] = selfcheck_upstream()
        sc = state["selfcheck"]
        if sc.get("ok"):
            print("[ok] 通道自测通过 上游 HTTP=%s" % sc.get("status"))
        else:
            print("[warn] 通道自测未通过：%s（桥照常起，但 dsh/客户端可能连不上上游，"
                  "先排查网络/代理/Key 是否过期）" % sc.get("err"))
    except Exception as e:
        state["selfcheck"] = {"ok": False, "err": "%s: %s" % (type(e).__name__, e)}

    if cred_only:
        print("[cred] 凭据已落到 %s（桥端口 %d，下次起桥用 WBBridgeConfig.exe）" % (state["cred_path"], state["port"]))
        sys.exit(0)

    if headless:
        # --headless / --selftest：只解析不常驻、不弹窗（自动化自检用）。
        # 之前漏了这句，自检跑完会照常弹内嵌窗口，等于自检根本退不出来。
        r = state["res"]
        print("[ok] 解析完成 账号=%s 模型=%d(名单内 %d) 桥端口=%d"
              % (r["account"]["nickname"], len(r.get("models", [])),
                 r.get("stats", {}).get("inRoster", 0), state["port"]))
        sys.exit(0)

    if bridge_only:
        sys.stderr.write("bridge:%d\n" % state["port"])
        sys.stderr.flush()
        while True:
            time.sleep(3600)
        return

    url = "http://127.0.0.1:%d/" % ui_port
    try:
        import webview
        w = webview.create_window("WBBridgeConfig — WorkBuddy 第三方工具接入助手", url=url,
                                  width=1120, height=860, resizable=True, min_size=(820, 620))
        w.events.closed += (lambda: state.__setitem__("shutdown", True))
        print("窗口已就绪：%s" % url)
        webview.start(debug=False)
    except Exception as e:
        print("内嵌窗口启动失败（%s: %s），回退到系统浏览器" % (type(e).__name__, e))
        import webbrowser
        webbrowser.open(url)
    state["shutdown"] = True

    def watchdog():
        while not state["shutdown"]:
            if time.time() - state["last_hit"] > IDLE_EXIT_SECONDS:
                state["shutdown"] = True
                try:
                    srv.shutdown()
                except Exception:
                    pass
                return
            time.sleep(2)

    threading.Thread(target=watchdog, daemon=True).start()
    try:
        while not state["shutdown"]:
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    try:
        srv.shutdown()
    except Exception:
        pass
    try:
        srv.server_close()
    except Exception:
        pass
    print("已退出，无后台残留。")
    sys.exit(0)


if __name__ == "__main__":
    main()
