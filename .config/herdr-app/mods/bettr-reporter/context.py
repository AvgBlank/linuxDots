"""What fills the agent's context window, from its local transcript.

Provider-neutral: `providers/<agent>.py` turns one transcript item into
operations (below), and this file keeps the sums and writes the
`bettr.context` label (mods/bettr-context/SCHEMA.md). The total comes from the
agent's own token count; the rows are estimates from character counts,
scaled to that total. Everything is local: no network or model requests.

An adapter gives:
- `context_path(event)`: the transcript of the main agent, or None.
- `BOUNDARY`: bytes found in a compaction item's line, and
  `is_boundary(item)` to confirm the item.
- `PINNED`: bytes found in lines whose operations stay through compaction
  (they can be before the newest compaction).
- `RESERVED`: tokens the agent keeps free for compaction, or None.
- `context_window(model)`: the window size for a model, or None.
- `context_ops(item, calls)`: a list of operations. `calls` maps tool call
  IDs to tool names; the adapter adds to it and reads from it.

Operations (`providers/common.py` builds them):
- `["reset", info]`: a compaction. Added sums start again. `info` holds its
  facts, each None when the agent does not record it: `at` (epoch), `trigger`
  ("auto" or "manual"), `before` and `after` (context tokens), `took` (seconds).
  An adapter gives them with `compaction(item)` too. When `after` is None, the
  next `usage` (the first request after) gives it; `USAGE` (optional) is bytes
  found in lines that can give it, to fill older compactions on a first read.
- `["add", category, chars, part]`: text in context. `part` names a sub-row
  (a message kind, tool, skill or agent), or is "" for none.
- `["pin", category, {part: chars}]`: the current size of a category that
  stays through compaction (the system prompt, tool schemas). It replaces
  the category's earlier pin.
- `["usage", tokens]`: the exact context size after the last request.
- `["model", name]` and `["window", tokens]`.
- `["sent", epoch]`: when an item that sends the next request (a prompt, a
  tool result) was written.
- `["cache", {id, model, read, write, uncached, ttl}]`: one API request's
  cache figures in tokens. `id` names the request, so a repeat is counted
  once. `write` is None when the agent does not report cache writes; then no
  misses are found. `ttl` (seconds) is the lifetime of what it wrote, or None.

Cache misses: the prompt of each request starts with the previous one, so a
request reads from cache what the previous request read plus what it wrote.
When it reads less, the difference (`lost`) is a miss. Of what the request
wrote, up to `lost` tokens are `rewritten`: the previous prompt had them cached.
After a compaction nothing is rewritten: the new prompt is a summary, not the
old content. The miss keeps only facts found in the transcript before it: a
compaction, a model change, or an idle time longer than the TTL. It names no cause.
"""
import os

from providers.common import dump, parse

LABEL = "bettr.context"
VERSION = 1
# The cache's format and the adapters' mapping. Raise it when either changes, so the
# next event reads the transcript again from the newest compaction.
READER = 6
# Code and JSON give fewer characters per token than prose; rows are scaled to the exact total.
CHARS_PER_TOKEN = 3.5
# Rows in display order. Text no row explains goes to Messages' `Other` part.
CATEGORIES = {"messages": "Messages", "tools": "Tools", "skills": "Skills", "memory": "Memory files",
              "agents": "Custom agents", "system": "System prompt", "mcp": "MCP instructions"}
MAX_PARTS, MAX_CALLS = 40, 400
# Anthropic caches no prompt prefix shorter than this, so a smaller difference is no miss.
MIN_LOST = 1024
MAX_MISSES = 20
MAX_LOG = 20
# A first read of a larger transcript starts this far from the end.
MAX_FIRST_READ = 64 << 20


def fresh(provider, session, path):
    return {"version": VERSION, "reader": READER, "provider": provider, "sessionId": session, "path": path, "offset": 0,
            "inode": None, "added": {}, "pinned": {}, "calls": {},
            "used": None, "model": None, "window": None, "compactions": 0, "label": None, "log": [], "pending": False,
            "cache": {"requests": 0, "read": 0, "written": 0, "rewritten": 0, "uncached": 0, "since": None, "writes": False,
                      "id": None, "sent": None, "last": None, "compacted": False, "misses": []}}


def valid(state):
    ok = isinstance(state, dict) and state.get("version") == VERSION and state.get("reader") == READER
    return state if ok else None


def cache_request(cache, request):
    """Add one request's figures; record a miss when it read less than the previous request left."""
    if request.get("id") is not None and request["id"] == cache["id"]:
        return
    cache["id"] = request.get("id")
    read, write, uncached = (request.get(key) or 0 for key in ("read", "write", "uncached"))
    cache["requests"] += 1
    cache["read"] += read
    cache["written"] += write
    cache["uncached"] += uncached
    cache["since"] = cache["since"] or cache["sent"]
    if request.get("write") is None:
        return
    cache["writes"] = True
    last, sent = cache["last"], cache["sent"]
    if last and last["read"] + last["write"] - read >= MIN_LOST:
        miss = {"at": sent, "lost": last["read"] + last["write"] - read}
        if cache["compacted"]:
            miss["compaction"] = True
        else:
            miss["rewritten"] = min(miss["lost"], write)
            cache["rewritten"] += miss["rewritten"]
        if last["model"] and request.get("model") and last["model"] != request["model"]:
            miss["models"] = [last["model"], request["model"]]
        if last["sent"] and sent and last["ttl"] and sent - last["sent"] > last["ttl"]:
            miss.update(idle=round(sent - last["sent"]), ttl=last["ttl"])
        cache["misses"] = (cache["misses"] + [miss])[-MAX_MISSES:]
    # The TTL that matters is that of the newest write.
    ttl = request.get("ttl") if write else (last or {}).get("ttl")
    cache["last"] = {"read": read, "write": write, "model": request.get("model"), "sent": sent, "ttl": ttl}
    cache["compacted"] = False


def log_compaction(state, info):
    """Keep a compaction's facts, newest last; `pending` waits for the size after it."""
    info = info if isinstance(info, dict) else {}
    entry = {key: info.get(key) for key in ("at", "trigger", "before", "after", "took")}
    state["log"] = (state["log"] + [entry])[-MAX_LOG:]
    state["pending"] = entry["after"] is None


def apply(state, ops, module):
    for op in ops:
        kind = op[0]
        if kind == "reset":
            state.update(added={}, used=None)
            state["compactions"] += 1
            state["cache"]["compacted"] = True
            log_compaction(state, op[1] if len(op) > 1 else None)
        elif kind == "sent" and isinstance(op[1], (int, float)):
            state["cache"]["sent"] = op[1]
        elif kind == "cache" and isinstance(op[1], dict):
            cache_request(state["cache"], op[1])
        elif kind == "add" and op[2] > 0:
            parts = state["added"].setdefault(op[1], {})
            parts[op[3]] = parts.get(op[3], 0) + op[2]
        elif kind == "pin":
            state["pinned"][op[1]] = op[2]
        elif kind == "usage" and op[1] > 0:
            state["used"] = op[1]
            if state["pending"]:
                state["log"][-1]["after"] = op[1]
                state["pending"] = False
        elif kind == "model" and isinstance(op[1], str) and op[1]:
            state["model"] = op[1]
            state["window"] = module.context_window(op[1]) or state["window"]
        elif kind == "window" and op[1] > 0:
            state["window"] = op[1]


def line_at(data, index):
    """The whole line that holds byte `index`, and where it starts."""
    start = data.rfind(b"\n", 0, index) + 1
    end = data.find(b"\n", index)
    return data[start:end if end >= 0 else len(data)], start


def first_read(state, handle, size, module):
    """Find the newest compaction, apply pinned lines before it, and return where to read from."""
    begin = max(0, size - MAX_FIRST_READ)
    handle.seek(begin)
    data = handle.read(size - begin)
    boundaries = []
    at = data.find(module.BOUNDARY)
    while at >= 0:
        line, start = line_at(data, at)
        item = parse(line)
        if item is not None and module.is_boundary(item):
            boundaries.append(start)
        at = data.find(module.BOUNDARY, start + len(line) + 1)
    start = boundaries[-1] if boundaries else (data.find(b"\n") + 1 if begin else 0)
    # The boundary line itself counts the newest compaction when it is read.
    state["compactions"] = max(0, len(boundaries) - 1)
    # Older compactions only go to the log; the size after one is its first request's.
    for at, end in zip(boundaries, boundaries[1:]):
        item = parse(line_at(data, at)[0])
        if item is None or not hasattr(module, "compaction"):
            continue
        log_compaction(state, module.compaction(item))
        marker = getattr(module, "USAGE", None)
        found = data.find(marker, at, end) if state["pending"] and marker else -1
        while found >= 0 and state["pending"]:
            line, line_start = line_at(data, found)
            used = [op[1] for op in module.context_ops(parse(line) or {}, {}) if op[0] == "usage" and op[1] > 0]
            if used:
                state["log"][-1]["after"] = used[0]
                state["pending"] = False
            found = data.find(marker, line_start + len(line) + 1, end)
    state["pending"] = False
    for marker in module.PINNED:
        at = data.rfind(marker, 0, start)
        if at >= 0:
            item = parse(line_at(data, at)[0])
            if item is not None:
                apply(state, module.context_ops(item, state["calls"]), module)
    return begin + start


def read(state, path, module):
    """Read new transcript lines. Return False when the file cannot be read."""
    try:
        with open(path, "rb") as handle:
            stat = os.fstat(handle.fileno())
            if state["inode"] != stat.st_ino or stat.st_size < state["offset"]:
                state.update(fresh(state["provider"], state["sessionId"], path))
                state["inode"] = stat.st_ino
                state["offset"] = first_read(state, handle, stat.st_size, module)
            handle.seek(state["offset"])
            data = handle.read(stat.st_size - state["offset"])
    except OSError:
        return False
    # The agent can be writing the last line; read only whole lines.
    end = data.rfind(b"\n") + 1
    for line in data[:end].splitlines():
        item = parse(line)
        if item is not None:
            apply(state, module.context_ops(item, state["calls"]), module)
    state["offset"] += end
    if len(state["calls"]) > MAX_CALLS:
        state["calls"] = dict(list(state["calls"].items())[-MAX_CALLS:])
    return True


def sub_rows(chars, tokens, extra=0):
    """The largest sub-rows, then `Other` (the rest, plus `extra` tokens), sharing `tokens`."""
    named = sorted(((name, value) for name, value in chars.items() if name), key=lambda pair: pair[1], reverse=True)
    share = tokens / (sum(chars.values()) or 1)
    rest = sum(value for _, value in named[MAX_PARTS:]) + chars.get("", 0)
    parts = [{"label": name, "tokens": round(value * share)} for name, value in named[:MAX_PARTS]]
    parts.append({"label": "Other", "tokens": round(rest * share) + extra})
    return [part for part in parts if part["tokens"] > 0] if named else []


def cache_summary(cache):
    """The label's `cache` field, or None before the first request."""
    if not cache["requests"]:
        return None
    value = {"requests": cache["requests"], "read": cache["read"], "uncached": cache["uncached"],
             "since": cache["since"] and round(cache["since"])}
    if cache["writes"]:
        value.update(written=cache["written"], rewritten=cache["rewritten"], misses=[{key: round(item) if isinstance(item, float) else item
                                                         for key, item in miss.items()} for miss in cache["misses"]])
    return {key: item for key, item in value.items() if item is not None}


def summary(state, module):
    """The label value: rows in tokens, scaled so they add up to the exact total."""
    chars = {}
    for sums in (state["added"], state["pinned"]):
        for key, parts in sums.items():
            for name, value in parts.items():
                chars.setdefault(key, {})[name] = chars.get(key, {}).get(name, 0) + value
    total = sum(sum(parts.values()) for parts in chars.values()) / CHARS_PER_TOKEN
    used = state["used"]
    scale = min(1.0, used / total) / CHARS_PER_TOKEN if used and total else 1 / CHARS_PER_TOKEN
    tokens = {key: round(sum(parts.values()) * scale) for key, parts in chars.items()}
    known = sum(value for key, value in tokens.items() if key in CATEGORIES)
    # What the rows cannot explain is mostly text the agent adds to messages
    # (reminders, hook output), so it is part of Messages' Other, as Claude counts it.
    unexplained = max(0, used - known) if used else 0
    if unexplained:
        chars.setdefault("messages", {}).setdefault("", 0)
    rows = []
    for key, label in CATEGORIES.items():
        extra = unexplained if key == "messages" else 0
        count = tokens.get(key, 0) + extra
        if count > 0:
            row = {"key": key, "label": label, "tokens": count}
            parts = sub_rows(chars[key], tokens.get(key, 0), extra) if chars.get(key) else []
            rows.append({**row, "parts": parts} if parts else row)
    known += unexplained
    value = {"version": VERSION, "provider": state["provider"], "sessionId": state["sessionId"],
             "used": used or known, "exact": bool(used), "window": state["window"],
             "reserved": getattr(module, "RESERVED", None), "model": state["model"],
             "compactions": state["compactions"], "rows": rows, "cache": cache_summary(state["cache"]),
             "log": [{key: (round(item) if key == "at" else round(item, 1)) if isinstance(item, float) else item
                      for key, item in entry.items() if item is not None}
                     for entry in state["log"]] or None}
    return {key: item for key, item in value.items() if item is not None}


def update(state, event, events, provider, module):
    """Read the transcript named by this hook event. Return the new state, or None when the label is the same."""
    path = module.context_path(event) if hasattr(module, "context_path") else None
    session = event.get("session_id")
    if not isinstance(path, str) or not path or not isinstance(session, str):
        return None
    state = valid(state)
    starts = any(item.get("type") in {"session.start", "session.prompt"} for item in events)
    if state and state["sessionId"] != session and not starts:
        return None  # A late event from an old conversation.
    if not state or state["sessionId"] != session or state["path"] != path or state["provider"] != provider:
        state = fresh(provider, session, path)
    if not read(state, path, module):
        return None
    value = dump(summary(state, module))
    if value == state["label"]:
        return None
    state["label"] = value
    return state
