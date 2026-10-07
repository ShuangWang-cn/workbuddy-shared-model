# -*- coding: utf-8 -*-
"""
wbsrv 全接口覆盖测试：起真服务 + 逐个打接口跑一遍。
对齐新界面（解析首屏 + AI 执行文本 / 手动字段两 Tab）。
接口清单（GET）：/  /api/status  /api/manual  /api/sites  /v1/models
接口清单（POST）：/api/agent  /api/manual_text  /api/save  /api/restart-admin
                  /v1/chat/completions  /v1/messages
"""
import json
import os
import re
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wbsrv
from http.client import HTTPConnection

srv = wbsrv.ThreadingHTTPServer(("127.0.0.1", 0), wbsrv.H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

FAIL = []
TMP = []


def check(name, cond, extra=""):
    print("%-32s %s %s" % (name, "PASS" if cond else "FAIL", extra))
    if not cond:
        FAIL.append(name)


def get(path):
    try:
        c = HTTPConnection("127.0.0.1", PORT, timeout=60)
        c.request("GET", path)
        r = c.getresponse()
        code, raw = r.status, r.read()
        c.close()
        return code, raw.decode("utf-8", "replace")
    except Exception as e:
        return -1, "HTTPERR %s: %s" % (type(e).__name__, e)


def post(path, body=""):
    try:
        c = HTTPConnection("127.0.0.1", PORT, timeout=60)
        c.request("POST", path, body=body.encode("utf-8"), headers={"content-type": "application/json"})
        r = c.getresponse()
        code, raw = r.status, r.read()
        c.close()
        return code, raw.decode("utf-8", "replace")
    except Exception as e:
        return -1, "HTTPERR %s: %s" % (type(e).__name__, e)


print("=== 服务端口 %d ===\n" % PORT)

# 1 界面
st, b = get("/")
check("GET / 返回界面",
      st == 200 and "解析" in b and "agent" in b and ".tab-panel" in b,
      "%d 字节" % len(b))

# 2 状态 / 解析
st, b = get("/api/status")
j = json.loads(b)
check("GET /api/status", j["ok"] and j["data"]["models"], "模型 %d 个" % len(j["data"]["models"]))
D = j["data"]
check("  · 账号有值", bool(D["account"]["nickname"]), D["account"]["nickname"])
check("  · 有有效期", bool(D["credential"].get("expiresAt")), D["credential"]["expiresAt"][:16])
check("  · 模型字段完整", all({"id", "upstreamName", "creditMultiplier", "inCliRoster"} <= set(m)
                            for m in D["models"]))
check("  · 名单内数量 > 0", D["stats"]["inRoster"] > 0, str(D["stats"]["inRoster"]))
check("  · 落点探测非空的 >= 1", sum(1 for s in D["sites"] if s["exists"]) >= 1,
      str(sum(1 for s in D["sites"] if s["exists"])) + " 个")
check("  · 返回了本地桥端口", isinstance(D["port"], int) and D["port"] > 0, str(D["port"]))

# 3 手动字段
st, b = get("/api/manual")
r1 = json.loads(b)["rows"]
check("GET /api/manual", len(r1) >= 5 and any("copilot" in x[1] for x in r1), "%d 行" % len(r1))
check("  · 有提供方名称字段", any("提供方" in x[0] for x in r1))
check("  · 有模型 ID 字段", any("模型" in x[0] and "ID" in x[0] for x in r1))
check("  · 直连是 token（Bearer eyJ…）", any("Bearer eyJ" in x[1] for x in r1),
      [x[1][:18] for x in r1 if "eyJ" in x[1]][:1])

# 4 落点清单
st, b = get("/api/sites")
check("GET /api/sites", json.loads(b)["ok"])

# 5 模型清单（OpenAI 兼容）
st, b = get("/v1/models")
names = [x["id"] for x in json.loads(b)["data"]]
check("GET /v1/models", st == 200 and names, "%d 个: %s" % (len(names), names[:4]))

# 6 AI 执行文本（核心产物）
st, b = post("/api/agent")
ja = json.loads(b)
check("POST /api/agent", ja["ok"] and len(ja["body"]) > 2000, "%d 字符" % len(ja.get("body", "")))
txt = ja.get("body", "")
check("  · 含取凭据指引", ".wbbridge" in txt or "credential" in txt)
check("  · 含落点探测表", "cordis.patch.yml" in txt and "config.toml" in txt)
check("  · 含 Anthropic 走桥提醒", "本机桥" in txt or "本地桥" in txt)
check("  · 含流式坑位提醒", "stream" in txt)
check("  · 无真实绝对路径", not re.search(r"[A-Za-z]:\\Users\\[^\s`）)，。]+", txt))
# 任务书里可以有 `eyJ...abcd` 这种打码示例，但不能有完整 token
TOKEN = wbsrv.current_res()["credential"]["accessToken"]
check("  · 无完整明文 token", TOKEN not in txt, "token 长度 %d" % len(TOKEN))
check("  · 写入任务书文件", os.path.isfile(ja.get("path", "")), ja.get("path", ""))

# 7 手动文本
st, b = post("/api/manual_text")
check("POST /api/manual_text", json.loads(b)["ok"] and len(json.loads(b)["body"]) > 200)

# 8 保存（POST body 决定扩展名）
st, b = post("/api/save", "# 测试落盘 hello")
js = json.loads(b)
check("POST /api/save（md）", js["ok"] and os.path.isfile(js["path"]), js.get("path"))
if js["ok"]:
    TMP.append(js["path"])
    with open(js["path"], "r", encoding="utf-8") as f:
        check("  · 落盘内容非空", len(f.read()) > 5)

# 9 OpenAI 兼容端点（真转发上游，stream=true 才能过）
st, b = post("/v1/chat/completions",
             json.dumps({"model": "hy3", "stream": True,
                         "messages": [{"role": "user", "content": "hi"}]}, ensure_ascii=False))
check("POST /v1/chat/completions", st == 200 and "data:" in b and "content" in b, "%d 字节" % len(b))
check("  · 是标准 OpenAI SSE", b.count("data: {") > 3 and "[DONE]" in b)

# 10 Anthropic 兼容端点
st, b = post("/v1/messages",
             json.dumps({"model": "hy3", "max_tokens": 32,
                         "messages": [{"role": "user", "content": "hi"}]}, ensure_ascii=False))
check("POST /v1/messages", st == 200 and "message_start" in b, "%d 字节" % len(b))
# 按 event: 行计数（event 行 + 同名的 data 行各一次，直接 str.count 会翻倍）
n_start = len(re.findall(r"^event: message_start$", b, re.M))
n_stop = len(re.findall(r"^event: message_stop$", b, re.M))
n_delta = len(re.findall(r"^event: content_block_delta$", b, re.M))
check("  · Anthropic 事件序列完整",
      n_start == 1 and n_delta >= 1 and n_stop == 1,
      "message_start=%d content_block_delta=%d message_stop=%d" % (n_start, n_delta, n_stop))

# 11 404
st, b = get("/api/not-exist")
check("GET 未知路径 404", st == 404)

for p in TMP:
    try:
        os.remove(p)
    except Exception:
        pass

print()
print("=== 失败项：%s ===" % (FAIL if FAIL else "无"))
srv.shutdown()
sys.exit(1 if FAIL else 0)
