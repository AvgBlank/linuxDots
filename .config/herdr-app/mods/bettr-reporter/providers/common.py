"""Small helpers that keep adapter output bounded, well typed and free of credentials."""
from datetime import datetime
import json
import os
import re
import time

# Agents stop a hook after HOOK_SECONDS (the "timeout" in hooks/*.json). Its steps
# share that time so that the hook ends on its own: the transcript wait, then the
# state lock (taken by LOCK_SECONDS after the start), then `hc`. One second is
# left for Python itself.
HOOK_SECONDS = 5
HC_SECONDS = 1
LOCK_SECONDS = HOOK_SECONDS - 1 - HC_SECONDS
WAIT_SECONDS, WAIT_STEP = LOCK_SECONDS - 1, 0.25

# Text is cleaned and redacted within this many characters; more is never published.
MAX_TEXT = 4096
MAX_DETAIL = 300


def short(value, limit):
    return " ".join(value.split())[:limit] if isinstance(value, str) else ""


def obj(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return {}
    return value if isinstance(value, dict) else {}


def parse(raw):
    """One JSON line (text or bytes) as a dict, or None."""
    try:
        item = json.loads(raw)
    except ValueError:  # Includes UnicodeDecodeError.
        return None
    return item if isinstance(item, dict) else None


def dump(value):
    """Compact JSON, as published in a label."""
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


# ---------------------------------------------------------------- credentials

# Each pattern keeps group 1 and replaces the rest of its match with `…`. A name
# starts only where a word starts (`(?<![\w-])`), which keeps every scan linear.
SECRET_NAME = (r"(?:[\w-]*(?:token|secret|password|passwd|credential)s?"
               r"|(?:[\w-]*[_-])?(?:api[_-]?key|key|pat|pwd|auth))")
SECRET_VALUE = r"""(?:"[^"]*"|'[^']*'|[^\s"'<>|&;]+)"""
SECRETS = [re.compile(pattern, re.I) for pattern in (
    rf"""((?<![\w-]){SECRET_NAME}["']?\s*[=:]\s*){SECRET_VALUE}""",       # API_KEY=x, "token": "x", --password=x
    rf"""((?<![\w-])--?{SECRET_NAME}\s+){SECRET_VALUE}""",                # --token x
    rf"""(\bauthorization\s*:\s*(?:[\w-]+\s+)?){SECRET_VALUE}""",           # Authorization: <any scheme> x
    r"""(\b(?:bearer|basic)\s+)[\w.~+/=-]+""",                             # Bearer x
    r"""(\b(?:set-)?cookie\s*:\s*)[^"'\n]+""",                             # Cookie: a=b; c=d
    r"""((?<![\w+.-])[a-z][\w+.-]*://)[^\s/@"']+(?=@)""",                  # scheme://user:password@host
    r"""((?<![\w-])(?:-u|--user)\s+)[^\s:"']+:[^\s"']+""",                # curl -u user:password
    r"""((?<![\w-])(?:sk-|[rs]k_(?:live|test)_|gh[opsur]_|github_pat_|xox[abprs]-|glpat-|AKIA|ASIA))[\w-]{8,}""",
)]


def redact(text):
    """Hide values that look like credentials before text is published."""
    for pattern in SECRETS:
        text = pattern.sub(lambda match: match.group(1) + "…", text)
    return text


def clean_text(text):
    """Agent or user text (a reply, a message) bounded and redacted, or None."""
    return redact(text[:MAX_TEXT]) if isinstance(text, str) else None


# ---------------------------------------------------------------- neutral events

def tool_name(event):
    """The tool name without a namespace prefix such as `multi_agent.`."""
    tool = event.get("tool_name")
    return tool.rsplit(".", 1)[-1] if isinstance(tool, str) else ""


def session(kind, event, **extra):
    return {"type": kind, "session": short(event.get("session_id"), 200), **extra}


def agent(kind, event, agent_id, outcome=None, **fields):
    """An agent event. Absent fields are dropped, so they never overwrite known values."""
    result = {**session(kind, event), "agent": short(agent_id, 200),
              "fields": {key: value for key, value in fields.items() if value is not None and value != ""}}
    if outcome:
        result["outcome"] = outcome
    return result


def first_line(text, limit=120):
    """The first non-empty line of a prompt, for a turn heading."""
    if not isinstance(text, str):
        return ""
    line = next((line for line in text[:MAX_TEXT].splitlines() if line.strip()), "")
    return short(redact(line), limit)


def prompt_fields(text):
    """A turn's heading. Messages the harness sends as prompts become short notices.

    `<task-notification>…<summary>Agent "x" finished</summary>` gives its summary;
    `<agent-message from="id">` gives the sender's ID, for the panel to name.
    `<command-name>/x</command-name>` is a slash command the user typed. A
    prompt that is only a `<system-reminder>` starts no turn: None.
    """
    if not isinstance(text, str):
        return {"prompt": ""}
    # Harness tags are at the start; a long pasted prompt is not scanned in full.
    stripped = text.lstrip()[:8192]
    if not re.match(r"<[a-z][\w-]*[\s>]", stripped):
        return {"prompt": first_line(text)}
    # Text after the tagged blocks is the user's own words.
    rest = re.sub(r"(?s)<([a-z][\w-]*)\b[^>]*>.*?</\1>", "", stripped).strip()
    if rest and not rest.startswith("<"):
        return {"prompt": first_line(rest)}
    command = re.search(r"<command-name>(.*?)</command-name>", stripped, re.S)
    if command:
        args = re.search(r"<command-args>(.*?)</command-args>", stripped, re.S)
        return {"prompt": first_line(f"{command.group(1)} {args.group(1) if args else ''}")}
    summary = re.search(r"<summary>(.*?)</summary>", stripped, re.S)
    sender = re.match(r'<agent-message\s+from="([^"]+)"', stripped)
    tag = re.match(r"<([a-z][\w-]*)", stripped).group(1)
    if tag == "system-reminder" and not summary:
        return None
    fields = {"prompt": first_line(summary.group(1)) if summary else "", "source": "notice"}
    if sender:
        fields["from"] = short(sender.group(1), 200)
    elif not summary:
        fields["prompt"] = tag.replace("-", " ").capitalize()
    return fields


def named(entry, tool):
    """Tag a tool step with the agent's tool name. The panel's verb table names it."""
    if entry and entry.get("kind") != "run" and tool:
        entry["tool"] = short(tool, 80)
    return entry


def activity(event, entry, composite=False):
    if not entry:
        return []
    result = {**session("activity", event), "entry": entry}
    if composite:
        result["composite"] = True
    return [result]


def message(event, text):
    """An activity event for the agent's text between tool calls."""
    return activity(event, {"kind": "message", "text": redact(text)} if text else None)


# ---------------------------------------------------------------- transcripts

TAIL_BYTES = 1 << 20
MAX_MESSAGE = 800


def transcript(event):
    """The main agent's transcript path from a hook event, or None for a subagent's event."""
    path = event.get("transcript_path")
    return path if isinstance(path, str) and path and not event.get("agent_id") else None


def transcript_tail(path):
    """The last lines of a JSONL transcript, newest last. Read-only and bounded."""
    if not isinstance(path, str) or not path.endswith(".jsonl") or not os.path.isfile(path):
        return []
    try:
        with open(path, "rb") as handle:
            size = handle.seek(0, os.SEEK_END)
            handle.seek(max(0, size - TAIL_BYTES))
            lines = handle.read().decode("utf-8", "ignore").splitlines()
    except OSError:
        return []
    return lines[1:] if size > TAIL_BYTES else lines


def epoch(stamp):
    """ISO 8601 text as epoch seconds, or None. Python 3.9 parses only 3 or 6
    fraction digits, so they are padded or cut to 6."""
    if not isinstance(stamp, str):
        return None
    stamp = re.sub(r"\.(\d+)", lambda match: "." + (match.group(1) + "000000")[:6], stamp.replace("Z", "+00:00"), 1)
    try:
        return datetime.fromisoformat(stamp).timestamp()
    except ValueError:
        return None


def item_time(item):
    """An item's `timestamp` as epoch seconds, or None."""
    return epoch(item.get("timestamp"))


# How many items before a new prompt are searched for how the last turn ended.
END_SEARCH = 200


def ended_at(path, verdict):
    """When the last turn ended, if the transcript says so, else None.

    The agent sends no stop event when the user interrupts it, so a prompt
    after an interrupt would look like steering. Walking back from the end,
    `verdict(item)` is None to skip an item, False when the turn is still
    working, or, when the item marks a turn's end, its time in epoch seconds
    (True when the item has no time).
    """
    for raw in reversed(transcript_tail(path)[-END_SEARCH:]):
        item = parse(raw)
        found = verdict(item) if item is not None else None
        if found is not None:
            return found if found is not False else None
    return None


def interrupted_before(event, verdict):
    """A turn.end for a main-agent turn the user interrupted before this prompt."""
    at = None if event.get("agent_id") else ended_at(event.get("transcript_path"), verdict)
    if at is None:
        return []
    return [session("turn.end", event, outcome="interrupted", **({} if at is True else {"at": at}))]


def message_before(path, tool_id, find, text_of, is_boundary, wait=WAIT_SECONDS):
    """The agent's text written just before tool call `tool_id`.

    `find(item)` is true for the item that made the call. Walking back from it,
    `text_of(item)` gives text to keep and `is_boundary(item)` stops the walk
    (an earlier tool call or a user message). Other items are skipped. The
    agent can write the call after the hook starts, so this waits for it; the
    hooks that call this are async, so waiting does not slow the agent.
    """
    if not isinstance(tool_id, str) or not tool_id:
        return ""
    # The call's item; the call's result, later in the file, also names the ID.
    deadline = time.monotonic() + wait
    while True:
        lines = transcript_tail(path)
        at = next((index for index in range(len(lines) - 1, -1, -1)
                   if tool_id in lines[index] and (item := parse(lines[index])) and find(item)), None)
        if at is not None or not lines or time.monotonic() >= deadline:
            break
        time.sleep(WAIT_STEP)
    if at is None:
        return ""
    parts = list(reversed(text_of(parse(lines[at]))))  # Text in the same item, before the call.
    for raw in reversed(lines[:at]):
        item = parse(raw)
        if item is None:
            continue
        if is_boundary(item):
            break
        parts.extend(reversed(text_of(item)))
    text = "\n\n".join(part.strip() for part in reversed(parts) if part.strip())
    return text[:MAX_MESSAGE].rstrip() + ("…" if len(text) > MAX_MESSAGE else "")


# ---------------------------------------------------------------- context operations

# About what one image costs in context, in characters (tokens × 3.5).
IMAGE_CHARS = 1600 * 7 // 2


def size(value):
    """About how many characters a value adds to context. Images count a fixed amount."""
    if isinstance(value, str):
        return len(value)
    if isinstance(value, list):
        return sum(size(item) for item in value)
    if isinstance(value, dict):
        if value.get("type") in {"image", "input_image"}:
            return IMAGE_CHARS
        if isinstance(value.get("text"), str):
            return len(value["text"])
        if "content" in value and len(value) <= 3:
            return size(value["content"])
        return len(json.dumps(value, ensure_ascii=False))
    return 0 if value is None else len(str(value))


def add(category, chars, part=""):
    """A context operation (context.py): `chars` of text in `category`, under sub-row `part`."""
    return ["add", category, chars, part or ""]


def adds(category, sizes):
    """One `add` per sub-row of a {part: chars} dict."""
    return [add(category, chars, part) for part, chars in sizes.items()]


def encrypted(value):
    """About the size of the text behind encrypted base64 (thinking, reasoning)."""
    return len(value) * 3 // 4 if isinstance(value, str) else 0


def tool_label(name):
    """A tool's sub-row: its name without a namespace, or `server: tool` for an MCP tool."""
    if not isinstance(name, str) or not name:
        return "Tools"
    if name.startswith("mcp__"):
        _, server, tool = (name.split("__", 2) + ["", ""])[:3]
        return f"{server}: {tool}"
    return name.rsplit(".", 1)[-1]


def tool_sizes(tools):
    """{sub-row: chars} for a list of tool schemas."""
    sizes = {}
    for tool in tools if isinstance(tools, list) else []:
        if isinstance(tool, dict):
            label = tool_label(tool.get("name"))
            sizes[label] = sizes.get(label, 0) + size(tool)
    return sizes


SKILL_ENTRY = re.compile(r"- (\S+?): ")


def skill_sizes(text):
    """{skill name: chars} for a skill list: entries are `- name: description`
    lines, with any lines that follow. Other text (headings, notes) is `Instructions`."""
    sizes, current = {}, None
    for line in text.splitlines(keepends=True) if isinstance(text, str) else []:
        entry = SKILL_ENTRY.match(line)
        if entry:
            current = entry.group(1)
        elif line.startswith("#"):
            current = None
        name = current or "Instructions"
        sizes[name] = sizes.get(name, 0) + len(line)
    return sizes
