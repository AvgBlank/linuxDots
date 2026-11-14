"""Codex hook payloads and rollout items to neutral subagent, activity and context events."""
import json
import os
from pathlib import Path
import re

from . import classify as rules
from .common import (activity, add, adds, agent, clean_text, encrypted, interrupted_before, item_time, message,
                     message_before, named, obj, prompt_fields, session, short, size, skill_sizes, tool_label, tool_name,
                     tool_sizes, transcript)

SPAWN_TOOLS = {"Agent", "spawn_agent"}
SHELL_TOOLS = {"exec_command", "shell", "local_shell", "container.exec", "shell_command"}


def readable(text):
    """Multi-agent v2 encrypts task messages. Drop opaque tokens; keep prose."""
    return text if text and (" " in text or len(text) <= 40) else ""


def task_label(path):
    """`/root/fix_auth_bug` -> `fix auth bug`."""
    leaf = path.rstrip("/").rsplit("/", 1)[-1] if isinstance(path, str) else ""
    return " ".join(re.split(r"[_\-]+", leaf)).strip()


def state_database():
    home = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
    found = [(int(match.group(1)), path) for path in home.glob("state_*.sqlite")
             if (match := re.fullmatch(r"state_(\d+)\.sqlite", path.name))]
    return max(found)[1] if found else None


def thread_fields(agent_id):
    """Read the child's nickname, task name, and effort from Codex's local thread table.

    The hooks do not carry these in multi-agent v2. The database is opened read-only,
    and any failure leaves the fields out.
    """
    path = state_database()
    if not agent_id or path is None:
        return {}
    from contextlib import closing  # Only for subagent start and stop events.
    import sqlite3
    try:
        with closing(sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True, timeout=0.5)) as db:
            row = db.execute("SELECT agent_nickname, agent_path, reasoning_effort FROM threads WHERE id = ?",
                             (agent_id,)).fetchone()
    except sqlite3.Error:
        return {}
    if not row:
        return {}
    nickname, task, effort = row
    return dict(name=short(nickname, 120), description=short(task_label(task), 300), effort=short(effort, 40))


# Rollout items that are the agent's work in a turn.
WORK_ITEMS = {"function_call", "function_call_output", "custom_tool_call", "custom_tool_call_output",
              "local_shell_call", "reasoning"}


def turn_verdict(item):
    """For `ended_at`: Codex writes a `turn_aborted` event when the user stops a turn."""
    payload = obj(item.get("payload"))
    if item.get("type") == "event_msg" and payload.get("type") == "turn_aborted":
        done = payload.get("completed_at")
        return float(done) if isinstance(done, (int, float)) and done > 0 else item_time(item) or True
    if item.get("type") == "response_item" and (payload.get("type") in WORK_ITEMS or (
            payload.get("type") == "message" and payload.get("role") == "assistant")):
        return False
    return None


def normalize(event):
    kind = event.get("hook_event_name")
    if kind in {"SessionStart", "UserPromptSubmit", "SessionEnd", "Stop"} and event.get("agent_id"):
        return []  # A child thread's own session events must not reset its parent.
    if kind == "SessionStart":
        return [session("session.start", event, keepAgents=event.get("source") == "compact")]
    if kind == "UserPromptSubmit":
        fields = prompt_fields(event.get("prompt"))
        return interrupted_before(event, turn_verdict) + [session("session.prompt", event, **fields)] \
            if fields is not None else []
    if kind == "SessionEnd":
        return [session("session.end", event)]
    if kind == "Stop":
        return [session("turn.end", event, outcome="done", reply=clean_text(event.get("last_assistant_message")))]
    agent_type = short(event.get("agent_type"), 120)
    # The lifecycle and request hooks report the child's active model.
    model = short(event.get("model"), 120)
    if kind == "SubagentStart":
        return [agent("agent.start", event, event.get("agent_id"), type=agent_type, model=model,
                      **thread_fields(event.get("agent_id")))]
    if kind == "SubagentStop":
        return [agent("agent.stop", event, event.get("agent_id"), outcome="done", type=agent_type, model=model,
                      **thread_fields(event.get("agent_id")))]
    if kind == "PostModelRequest" and event.get("agent_id"):
        return [agent("agent.meta", event, event["agent_id"], type=agent_type, model=model)]
    if kind == "PostToolUse":
        return spawn_events(event) + said_before(event) + activity_events(event)
    return []


CALLS = {"function_call", "custom_tool_call", "local_shell_call", "web_search_call"}
OUTPUTS = {"function_call_output", "custom_tool_call_output"}


def said_before(event):
    """The main thread's commentary just before this tool call, from the rollout file.

    Codex writes `message` items (role `assistant`) before the `function_call`
    whose `call_id` is the hook's `tool_use_id`. An earlier call, its output, or
    a user message ends the search.
    """
    if event.get("agent_id"):
        return []
    tool_id = event.get("tool_use_id")

    def payload(item):
        return obj(item.get("payload")) if item.get("type") == "response_item" else {}

    def calls(item):
        return payload(item).get("call_id") == tool_id and payload(item).get("type") in CALLS

    def text_of(item):
        data = payload(item)
        if data.get("type") != "message" or data.get("role") != "assistant":
            return []
        content = data.get("content")
        return [part["text"] for part in content if isinstance(part, dict)
                and part.get("type") == "output_text" and isinstance(part.get("text"), str)] \
            if isinstance(content, list) else []

    def boundary(item):
        data = payload(item)
        return data.get("type") in CALLS | OUTPUTS or (data.get("type") == "message" and data.get("role") == "user")

    text = message_before(event.get("transcript_path"), tool_id, calls, text_of, boundary)
    return message(event, text)


def spawn_events(event):
    if tool_name(event) not in SPAWN_TOOLS:
        return []
    # Multi-agent v1 returns `agent_id`; v2 returns only a task path, so this
    # is ignored there and the thread table supplies the same fields.
    inputs, result = obj(event.get("tool_input")), obj(event.get("tool_response"))
    # The tool event's common `model` is the parent's; never copy it to the child.
    meta = agent("agent.meta", event, result.get("agent_id"), type=short(inputs.get("agent_type"), 120),
                 name=short(result.get("nickname") or inputs.get("task_name"), 120),
                 description=short(inputs.get("description") or readable(short(inputs.get("message"), 300)), 300),
                 effort=short(inputs.get("reasoning_effort"), 40))
    return [{**meta, "create": True}]


# ---------------------------------------------------------------- activity

def raw_text(value, *keys):
    """A tool input or response as text: a plain string, or one of `keys` in an object."""
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except ValueError:
            return value
        value = parsed
    if isinstance(value, dict):
        for key in keys:
            if isinstance(value.get(key), str):
                return value[key]
        return json.dumps(value)
    return value if isinstance(value, str) else ""


def shell_command(inputs):
    command = inputs.get("cmd") or inputs.get("command")
    if isinstance(command, list) and all(isinstance(part, str) for part in command):
        # ["bash", "-lc", "<script>"] runs the script; anything else is the command.
        if len(command) == 3 and command[1] in {"-c", "-lc"}:
            return command[2]
        import shlex  # Rare: most commands are a string.
        return shlex.join(command)
    return command if isinstance(command, str) else ""


def shell_result(response):
    """ok, failed, or None from an exec response's exit code."""
    output = raw_text(response, "output", "aggregated_output", "stdout", "formatted_output")
    data = obj(response)
    code = data.get("exit_code", data.get("exitCode", obj(data.get("metadata")).get("exit_code")))
    if not isinstance(code, int):
        # The header comes before the command's own output, which can contain the same words.
        found = re.search(r"(?:Exit code|exit_code|Process exited with code)[:=\s]+(-?\d+)", output or "")
        code = int(found.group(1)) if found else None
    return None if code is None else "ok" if code == 0 else "failed"


def activity_events(event):
    """One activity entry per main-thread tool call. Child threads are not logged."""
    if event.get("agent_id"):
        return []
    tool, cwd = tool_name(event), event.get("cwd") or ""
    inputs, response = obj(event.get("tool_input")), event.get("tool_response")
    if event.get("tool_name") in SHELL_TOOLS or tool in SHELL_TOOLS:
        # The full name first: `container.exec` is a shell, not code mode (`exec`).
        return activity(event, rules.shell_entry(shell_command(inputs), shell_result(response)))
    if tool == "exec":
        # Code mode: one script that calls several tools. Used only when Codex
        # does not also report the nested calls (see the reducer).
        code = raw_text(event.get("tool_input"), "code", "source", "input", "script")
        calls = rules.code_mode_calls(code)
        result = shell_result(response) if len(calls) == 1 else None
        events = []
        for nested, argument in calls:
            entry = named(nested_entry(nested, argument, result, cwd), nested)
            events += activity(event, entry, composite=True)
        return events
    return activity(event, named(entry_for(tool, inputs, event.get("tool_input"), response, cwd), tool))


def nested_entry(tool, argument, result, cwd):
    if tool == "exec_command":
        return rules.shell_entry(argument, result)
    if tool == "apply_patch":
        files = rules.patch_files(argument, cwd)
        return rules.entry("edit", files=files) if files else None
    return entry_for(tool, {}, "", "", cwd)


def entry_for(tool, inputs, raw_input, response, cwd):
    if tool == "apply_patch":
        files = rules.patch_files(raw_text(raw_input, "input", "patch"), cwd)
        return rules.entry("edit", files=files) if files else None
    if tool in {"web__run", "web_search", "search_query", "open"}:
        query = next((inputs.get(key) for key in ("query", "q", "url") if isinstance(inputs.get(key), str)), "")
        return rules.entry("web", f"web: {query}".strip() if query else "the web")
    if tool == "view_image":
        return rules.entry("read", items=[rules.relative(inputs.get("path"), cwd)])
    if tool == "spawn_agent":
        return rules.entry("agent", task_label(inputs.get("task_name")) or "a subagent",
                           result="started")
    if tool == "followup_task":
        return rules.entry("agent", task_label(inputs.get("target")) or "an agent")
    if tool in {"interrupt_agent", "close_agent"}:
        return rules.entry("agent", task_label(inputs.get("target")) or "an agent",
                           result="interrupted")
    if tool in {"request_user_input", "request_user_input_async"}:
        questions = inputs.get("questions")
        first = questions[0] if isinstance(questions, list) and questions and isinstance(questions[0], dict) else {}
        return rules.entry("ask", first.get("title") or first.get("question") or "a question")
    if tool.startswith("mcp__"):
        return rules.entry("tool", tool_label(tool))
    return rules.entry("tool") if tool else None


# Context (see context.py). Codex writes the whole input of each request to its
# rollout, a `compacted` item at each compaction (its `replacement_history` is
# the new input), and `token_count` events with the window size.
BOUNDARY = b'"type":"compacted"'
# Lines that can give the context size after a compaction (its first request).
USAGE = b'"type":"token_count"'
PINNED = ()
RESERVED = None
context_path = transcript


def context_window(_model):
    return None  # Each token_count event gives it.


def is_boundary(item):
    return item.get("type") == "compacted"


def compaction(item):
    """A compaction's facts: when, and the context before (the compaction request's input).
    Codex records no trigger or duration; the size after is the next request's."""
    usage = obj(obj(obj(item.get("payload")).get("latest_token_usage_record")).get("usage"))
    before = usage.get("input_tokens")
    return {"at": item_time(item), "trigger": None, "took": None, "after": None,
            "before": before if isinstance(before, int) and not isinstance(before, bool) and before > 0 else None}


def developer_category(text):
    if text.startswith("<skills_instructions>"):
        return "skills", ""
    if text.startswith("<") or text.startswith("You are"):
        return "system", ""
    return "messages", "Developer"


def user_category(text):
    if text.startswith("# AGENTS.md instructions"):
        return "memory", ""
    if text.startswith("<environment_context>") or text.startswith("<app-context>"):
        return "system", ""
    return "messages", "User"


def response_ops(payload, calls):
    kind = payload.get("type")
    if kind == "message":
        content = payload.get("content") if isinstance(payload.get("content"), list) else []
        text = "".join(block.get("text") for block in content
                       if isinstance(block, dict) and isinstance(block.get("text"), str))
        role = payload.get("role")
        category, part = developer_category(text) if role == "developer" \
            else user_category(text) if role == "user" else ("messages", "Assistant")
        if category == "skills":
            return adds("skills", skill_sizes(text))
        return [add(category, size(content), part)]
    if kind == "additional_tools":
        return adds("tools", tool_sizes(payload.get("tools")))
    if kind in {"function_call", "custom_tool_call"}:
        part = tool_label(payload.get("name"))
        if isinstance(payload.get("call_id"), str):
            calls[payload["call_id"]] = part
        return [add("messages", size(payload.get("arguments") or payload.get("input")), part)]
    if kind in {"function_call_output", "custom_tool_call_output"}:
        return [add("messages", size(payload.get("output")), calls.get(payload.get("call_id"), "Tools"))]
    if kind in {"reasoning", "compaction"}:
        # Encrypted; the decoded size stands in for the text.
        return [add("messages", encrypted(payload.get("encrypted_content")),
                    "Thinking" if kind == "reasoning" else "Summary")]
    if kind == "agent_message":
        return [add("messages", size(payload.get("content") or payload.get("message")), "Agents")]
    return []


def context_ops(item, calls):
    kind, payload = item.get("type"), obj(item.get("payload"))
    if kind == "compacted":
        ops = [["reset", compaction(item)]]
        for entry in payload.get("replacement_history") or []:
            if isinstance(entry, dict):
                ops += response_ops(entry, calls)
        return ops
    if kind == "response_item":
        return response_ops(payload, calls)
    if kind == "turn_context":
        return [["model", payload.get("model")]]
    if kind == "event_msg" and payload.get("type") == "token_count":
        info = obj(payload.get("info"))
        last = obj(info.get("last_token_usage"))
        used = sum(last.get(key) for key in ("input_tokens", "output_tokens") if isinstance(last.get(key), int))
        window = info.get("model_context_window")
        ops = [["usage", used]] + ([["window", window]] if isinstance(window, int) else [])
        read, sent = last.get("cached_input_tokens"), last.get("input_tokens")
        if isinstance(read, int) and isinstance(sent, int) and sent > 0:
            # Codex reports cache reads only, not writes: `write` is None, so no misses are found.
            # The same event can come twice; the running total names the request.
            total = obj(info.get("total_token_usage")).get("total_tokens")
            ops += [["sent", item_time(item)], ["cache", {"id": total, "model": None, "read": read, "write": None,
                                  "uncached": max(0, sent - read), "ttl": None}]]
        return ops
    return []
