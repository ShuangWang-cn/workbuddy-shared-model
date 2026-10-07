# -*- coding: utf-8 -*-
"""
wbanthropic.py —— Anthropic Messages API ↔ WorkBuddy OpenAI 上游 的双向协议桥

为什么需要它：Claude Code 走的是 Anthropic 协议（POST /v1/messages，返回 Anthropic 自己的 SSE 事件），
而 WorkBuddy 上游是 OpenAI 的 Chat Completions。两边事件格式完全不一样，
所以 Claude Code 的 ANTHROPIC_BASE_URL 只能指向本机这台桥，不能直接写上游地址。

做的事：
  * 请求方向：Anthropic shape → OpenAI shape（system / tools / messages 都转）
  * 响应方向：OpenAI SSE 事件 → Anthropic SSE 事件（text_delta / input_json_delta / usage 都转）
非流请求也顺手支持（攒完整再返回）。
"""
import json

import urllib.request

EVENTS = ("message_start", "content_block_start", "content_block_delta",
          "content_block_stop", "message_delta", "message_stop")


# ------------------------------------------------------------------ 请求：Anthropic → OpenAI

def anthropic_to_openai(body):
    """把 Anthropic 请求体转成 OpenAI 请求体；上游只认 stream:true"""
    msgs = []
    system = body.get("system")
    if isinstance(system, str) and system.strip():
        msgs.append({"role": "system", "content": system})
    elif isinstance(system, list):
        for b in system:
            if isinstance(b, dict) and b.get("type") == "text":
                msgs.append({"role": "system", "content": b.get("text", "")})

    for m in body.get("messages") or []:
        if not isinstance(m, dict):
            continue
        role = m.get("role") or "user"
        content = m.get("content")
        if isinstance(content, str):
            msgs.append({"role": role, "content": content})
        elif isinstance(content, list):
            # 文本块 + 工具结果块
            parts, tool_calls = [], []
            for b in content:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "text":
                    parts.append({"type": "text", "text": b.get("text", "")})
                elif b.get("type") == "image":
                    src = b.get("source") or {}
                    data = src.get("data") or ""
                    parts.append({"type": "image_url",
                                  "image_url": {"url": "data:%s;base64,%s" % (src.get("media_type", "image/png"), data)}})
                elif b.get("type") == "tool_use":
                    tool_calls.append({"id": b.get("id"), "type": "function",
                                       "function": {"name": b.get("name"),
                                                    "arguments": json.dumps(b.get("input") or {})}})
                elif b.get("type") == "tool_result":
                    msgs.append({"role": "tool", "tool_call_id": b.get("tool_use_id"),
                                 "content": _tr(b.get("content"))})
            if tool_calls:
                msgs.append({"role": "assistant", "content": parts or "", "tool_calls": tool_calls})
            else:
                msgs.append({"role": role, "content": parts})
        else:
            msgs.append({"role": role, "content": str(content or "")})

    if msgs and msgs[-1]["role"] == "assistant":
        pass  # 允许末尾是 assistant（会变回 prefilled assistant）

    oai = {
        "model": body.get("model") or "hy3",
        "messages": msgs,
        "stream": True,
    }
    if body.get("max_tokens") is not None:
        oai["max_tokens"] = body["max_tokens"]
    if body.get("temperature") is not None:
        oai["temperature"] = body["temperature"]
    if body.get("top_p") is not None:
        oai["top_p"] = body["top_p"]
    tools = []
    for t in body.get("tools") or []:
        if not isinstance(t, dict):
            continue
        tools.append({
            "type": "function",
            "function": {
                "name": t.get("name"),
                "description": t.get("description") or "",
                "parameters": t.get("input_schema") or {"type": "object", "properties": {}},
            },
        })
    if tools:
        oai["tools"] = tools
    if body.get("tool_choice"):
        tc = body["tool_choice"]
        if isinstance(tc, dict) and tc.get("type") == "tool" and tc.get("name"):
            oai["tool_choice"] = {"type": "function", "function": {"name": tc["name"]}}
    return oai


def _tr(c):
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "".join(x.get("text", "") for x in c if isinstance(x, dict))
    return str(c or "")


# ------------------------------------------------------------------ 响应：OpenAI SSE → Anthropic SSE

class _Msg(object):
    """一次回复累积器，边收 OpenAI 事件边吐 Anthropic 事件"""

    def __init__(self, model):
        self.model = model
        self.text = []
        self.tool_calls = {}     # idx -> {id, name, args, block_index}
        self.input_tokens = 0
        self.output_tokens = 0
        self.finish = None
        self.block_seq = 0

    # ---- 收一个 OpenAI 增量事件，返回要发的 Anthropic 事件列表
    def feed(self, d):
        ev = []
        ch = d.get("choices") or [None]
        c0 = ch[0] if ch else None
        delta = (c0 or {}).get("delta") or {}

        if d.get("usage"):
            u = d["usage"] or {}
            self.input_tokens = u.get("prompt_tokens") or self.input_tokens
            self.output_tokens = u.get("completion_tokens") or self.output_tokens

        # hy3 等推理模型的正文在 reasoning_content 里、delta.content 恒为空串，
        # 只读 content 会把正文全丢光 —— 两边都收（内容合并成一个文本块，
        # 不发 thinking 块以免客户端对缺少 signature 的 thinking 报错）。
        text = (delta.get("content") or "") + (delta.get("reasoning_content") or "")
        if text:
            if self._need_text_block():
                ev.append({"event": "content_block_start",
                           "data": {"type": "content_block_start", "index": 0,
                                    "content_block": {"type": "text", "text": ""}}})
                self.block_seq = 1
            ev.append({"event": "content_block_delta",
                       "data": {"type": "content_block_delta", "index": 0,
                                "delta": {"type": "text_delta", "text": text}}})

        for tc in delta.get("tool_calls") or []:
            i = tc.get("index") or 0
            t = self.tool_calls.setdefault(i, {"id": tc.get("id") or "", "name": "", "args": "", "emitted": False})
            if tc.get("id"):
                t["id"] = tc["id"]
            if (tc.get("function") or {}).get("name"):
                t["name"] = tc["function"]["name"]
            if (tc.get("function") or {}).get("arguments"):
                t["args"] += tc["function"]["arguments"]

        if (c0 or {}).get("finish_reason"):
            self.finish = c0["finish_reason"]
        return ev

    def _need_text_block(self):
        return not self.text and not self.tool_calls and self.block_seq == 0

    # ---- 收一条 usage-only 事件
    def feed_usage(self, usage):
        u = usage or {}
        self.input_tokens = u.get("prompt_tokens") or self.input_tokens
        self.output_tokens = u.get("completion_tokens") or self.output_tokens

    # ---- 收 tool_calls 完整块（非流/流末尾都用得上）
    def flush_tool_calls(self):
        ev = []
        idx = 1 if self.text else 0
        for i, t in sorted(self.tool_calls.items()):
            if not t["name"]:
                continue
            if not t["emitted"]:
                t["emitted"] = True
                ev.append({"event": "content_block_start",
                           "data": {"type": "content_block_start", "index": idx,
                                    "content_block": {"type": "tool_use", "id": t["id"] or "toolu_%d" % i,
                                                      "name": t["name"], "input": {}}}})
                ev.append({"event": "content_block_delta",
                           "data": {"type": "content_block_delta", "index": idx,
                                    "delta": {"type": "input_json_delta", "partial_json": t["args"] or ""}}})
                ev.append({"event": "content_block_stop",
                           "data": {"type": "content_block_stop", "index": idx}})
            idx += 1
        return ev

    # ---- 收完，返回收尾事件
    def finish_events(self, force=False):
        """
        结束事件。**只有真的收到 finish_reason（或 force=True，用于流末尾兜底）才吐**，
        否则每个 SSE 分组都会发一遍 message_stop，客户端会看到 20+ 个重复结束事件。
        """
        ev = []
        if self.finish is None and not force:
            return ev
        # self.text 是累积列表（恒真）/block_seq 记块起止，任一成立都要关掉文本块，
        # 否则客户端收不到 content_block_stop。
        if self.text or self.block_seq > 0:
            ev.append({"event": "content_block_stop", "data": {"type": "content_block_stop", "index": 0}})
        ev += self.flush_tool_calls()
        reason = {"tool_calls": "tool_use", "stop": "end_turn", "length": "max_tokens"}.get(self.finish, "end_turn")
        ev.append({"event": "message_delta", "data": {
            "type": "message_delta",
            "delta": {"stop_reason": reason, "stop_sequence": None},
            "usage": {"output_tokens": self.output_tokens or 1},
        }})
        ev.append({"event": "message_stop", "data": {"type": "message_stop"}})
        return ev

    def id(self):
        return "msg_01WbBridge"

    def model(self):
        return self.model

    def usage(self):
        if not self.input_tokens:
            self.input_tokens = max(1, len(json.dumps(self.text, ensure_ascii=False)) // 3)
        return {"input_tokens": self.input_tokens, "output_tokens": self.output_tokens or 1}


def openai_chunk_to_events(chunk_lines, model, force_finish=False):
    """
    把上游 SSE 的若干行（已去掉 data: 前缀）喂进去，返回 [(event, data_dict), ...]
    只在事件发生时返回，没事件就返回 []。
    """
    out = []
    msg = _Msg(model)
    for raw in chunk_lines:
        raw = raw.strip()
        if not raw or not raw.startswith("{"):
            continue
        try:
            d = json.loads(raw)
        except Exception:
            continue
        if d.get("type") == "usage":
            msg.feed_usage(d.get("usage") or {})
            continue
        out += msg.feed(d)
    # force_finish 只在「整条流读完后」由调用方传一次，避免每个 SSE 分组都吐一组
    # message_delta + message_stop（客户端会看到 20+ 个重复结束事件）。
    for e in msg.finish_events(force=force_finish):
        out.append(e)
    return out


def openai_nonstream_to_anthropic(payload_obj, model, input_tokens_guess=0):
    """非流模式：直接构造一个 Anthropic message 对象"""
    content = []
    if payload_obj.get("content"):
        content.append({"type": "text", "text": payload_obj["content"]})
    tool_calls = payload_obj.get("tool_calls") or []
    for t in tool_calls:
        content.append({"type": "tool_use", "id": t.get("id") or "toolu_x",
                        "name": (t.get("function") or {}).get("name"),
                        "input": _safe_json((t.get("function") or {}).get("arguments"))})
    if not content:
        content.append({"type": "text", "text": ""})
    return {
        "id": "msg_01WbBridge", "type": "message", "role": "assistant",
        "model": model, "content": content,
        "stop_reason": payload_obj.get("finish_reason") or "end_turn",
        "stop_sequence": None,
        "usage": {"input_tokens": input_tokens_guess, "output_tokens": payload_obj.get("usage", {}).get("completion_tokens", 1) or 1},
    }


def _safe_json(s):
    try:
        return json.loads(s or "{}")
    except Exception:
        return {}
