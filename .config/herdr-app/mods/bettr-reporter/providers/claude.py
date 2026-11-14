"""Claude Code hook payloads to neutral subagent and activity events."""
import re
import time

from . import classify as rules
from .common import (IMAGE_CHARS, activity, add, adds, agent, clean_text, encrypted, interrupted_before, item_time,
                     message, message_before, named, obj, parse, prompt_fields, session, short, size, skill_sizes,
                     tool_label, tool_name, tool_sizes, transcript, transcript_tail, WAIT_SECONDS, WAIT_STEP)

SPAWN_TOOLS = {"Agent", "Task"}
EDIT_TOOLS = {"Edit", "MultiEdit", "Write", "NotebookEdit"}


def model_label(model):
    return re.sub(r"-\d{8}$", "", re.sub(r"^claude-", "", model))


def normalize(event):
    kind = event.get("hook_event_name")
    if kind == "SessionStart":
        return [session("session.start", event, keepAgents=event.get("source") == "compact")]
    if kind == "PostCompact":
        # Only the Context label changes: the reporter reads the new boundary from the transcript.
        wait_for_boundary(transcript(event), time.time())
        return [session("session.compact", event)]
    if kind == "UserPromptSubmit":
        fields = prompt_fields(event.get("prompt"))
        return interrupted_before(event, turn_verdict) + [session("session.prompt", event, **fields)] \
            if fields is not None else []
    if kind == "SessionEnd":
        return [session("session.end", event)]
    if kind in {"Stop", "StopFailure"}:
        return [session("turn.end", event, outcome="done" if kind == "Stop" else "failed",
                        reply=clean_text(event.get("last_assistant_message")))]
    agent_type = short(event.get("agent_type"), 120)
    if kind == "SubagentStart":
        return [agent("agent.start", event, event.get("agent_id"), type=agent_type)]
    if kind == "SubagentStop":
        return [agent("agent.stop", event, event.get("agent_id"), outcome="done", type=agent_type,
                      effort=short(obj(event.get("effort")).get("level"), 40))]
    if kind == "PostToolUse":
        return tool_events(event, agent_type) + said_before(event) + activity_events(event)
    if kind == "PostToolUseFailure":
        # The user stopped the agent: no Stop event follows, so end the turn here.
        stopped = event.get("is_interrupt") and not event.get("agent_id")
        return said_before(event) + activity_events(event) \
            + ([session("turn.end", event, outcome="interrupted")] if stopped else [])
    return []


def tool_events(event, agent_type):
    """Correlate tool metadata by returned agent ID, never by launch order."""
    events = []
    if event.get("agent_id"):
        # This effort belongs to the agent that called the tool, not its child.
        effort = short(obj(event.get("effort")).get("level"), 40)
        if effort:
            events.append(agent("agent.meta", event, event["agent_id"], type=agent_type, effort=effort))
    tool = tool_name(event)
    inputs, result = obj(event.get("tool_input")), obj(event.get("tool_response"))
    if tool in SPAWN_TOOLS:
        models = result.get("modelsUsed")
        model = short(models[-1] if isinstance(models, list) and models else result.get("resolvedModel"), 120)
        meta = agent("agent.meta", event, result.get("agentId"), type=short(inputs.get("subagent_type"), 120),
                     name=short(inputs.get("name"), 120),
                     description=short(inputs.get("description") or result.get("description"), 300),
                     model=model, modelLabel=model_label(model))
        # The launch response is evidence of a real, user-requested agent.
        events.append({**meta, "create": True})
        if result.get("status") == "completed":
            events.append(agent("agent.stop", event, result.get("agentId"), outcome="done"))
    elif tool == "TaskStop" and result.get("task_type") in (None, "", "local_agent"):
        # A stopped agent sends no SubagentStop. Unknown IDs (shells) are ignored.
        task = result.get("task_id") or inputs.get("task_id")
        events.append(agent("agent.stop", event, task, outcome="interrupted"))
    return events


def turn_verdict(item):
    """For `ended_at`: Claude writes `[Request interrupted by user…]` and a
    `turn_duration` line when a turn stops; work is an assistant item or a tool result."""
    if item.get("type") == "system" and item.get("subtype") == "turn_duration":
        return item_time(item) or True
    if item.get("type") == "assistant":
        return False
    if item.get("type") == "user":
        content = obj(item.get("message")).get("content")
        for block in content if isinstance(content, list) else []:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_result":
                return False
            if block.get("type") == "text" and str(block.get("text")).startswith("[Request interrupted by user"):
                return item_time(item) or True
    return None


def blocks(item, kind):
    content = obj(item.get("message")).get("content") if item.get("type") == "assistant" else None
    return [block for block in content if isinstance(block, dict) and block.get("type") == kind] \
        if isinstance(content, list) else []


def said_before(event):
    """The main agent's text just before this tool call, from the local transcript.

    The text is in the assistant item that holds the `tool_use`, or in the
    items just before it. An earlier `tool_use` or a user item ends the search.
    """
    if event.get("agent_id"):
        return []
    tool_id = event.get("tool_use_id")

    def calls(item):
        uses = blocks(item, "tool_use")
        return any(block.get("id") == tool_id for block in uses)

    def text_of(item):
        content = obj(item.get("message")).get("content") if item.get("type") == "assistant" else None
        out = []
        for block in content if isinstance(content, list) else []:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use":
                if block.get("id") == tool_id:
                    break
                out = []  # Text before an earlier call in the same item belongs to that call.
            elif block.get("type") == "text" and isinstance(block.get("text"), str):
                out.append(block["text"])
        return out

    def boundary(item):
        return item.get("type") == "user" or bool(blocks(item, "tool_use"))

    text = message_before(event.get("transcript_path"), tool_id, calls, text_of, boundary)
    return message(event, text)


def activity_events(event):
    """One activity entry for a main-agent tool call. Subagents' own work is not logged."""
    if event.get("agent_id"):
        return []
    tool, cwd = event.get("tool_name"), event.get("cwd") or ""
    if not isinstance(tool, str):
        return []
    inputs, result = obj(event.get("tool_input")), obj(event.get("tool_response"))
    failed = event.get("hook_event_name") == "PostToolUseFailure"
    outcome = "interrupted" if event.get("is_interrupt") or result.get("interrupted") \
        else "failed" if failed else "ok"
    return activity(event, named(entry_for(tool, inputs, result, outcome, cwd), tool))


def entry_for(tool, inputs, result, outcome, cwd):
    if tool == "Bash":
        if result.get("backgroundTaskId") and outcome == "ok":
            outcome = "started"  # Runs in the background; its result is not known yet.
        return rules.shell_entry(inputs.get("command"), outcome)
    if tool in EDIT_TOOLS:
        if outcome != "ok":
            return None  # A failed edit changed nothing.
        path = rules.relative(inputs.get("file_path") or inputs.get("notebook_path"), cwd)
        if not path:
            return None
        if tool == "NotebookEdit":
            return rules.entry("edit", files=[[path, None, None, "modified"]])
        if tool == "Write" and result.get("type") == "create":
            content = inputs.get("content") if isinstance(inputs.get("content"), str) else ""
            return rules.entry("edit", files=[[path, len(content.splitlines()), 0, "created"]])
        added, removed = rules.hunk_counts(result.get("structuredPatch"))
        return rules.entry("edit", files=[[path, added, removed, "modified"]])
    failed = "failed" if outcome == "failed" else None
    if tool == "Read":
        return rules.entry("read", items=[rules.relative(inputs.get("file_path"), cwd)])
    if tool in {"Grep", "Glob"}:
        pattern = inputs.get("pattern") if isinstance(inputs.get("pattern"), str) else ""
        where = rules.relative(inputs.get("path"), cwd) or inputs.get("glob") or ""
        return rules.entry("search", items=[short(pattern, 80)] if pattern else None,
                           detail=f"{pattern} in {where}" if where else None)
    if tool == "WebFetch":
        url = inputs.get("url") if isinstance(inputs.get("url"), str) else ""
        return rules.entry("web", re.sub(r"^https?://(?:[^/?#@]*@)?([^/?#]+).*", r"\1", url) or "a page",
                           result=failed, detail=url)
    if tool == "WebSearch":
        return rules.entry("web", f"web: {inputs.get('query') or ''}".strip(), result=failed)
    if tool in SPAWN_TOOLS:
        status = result.get("status")
        state = "started" if status == "async_launched" else "failed" if outcome == "failed" else "ok"
        return rules.entry("agent", inputs.get("description") or inputs.get("name") or "a subagent", result=state)
    if tool == "TaskStop":
        if result.get("task_type") not in (None, "", "local_agent"):
            return None
        return rules.entry("agent", result.get("command") or "an agent", result="interrupted")
    if tool == "SendMessage":
        return rules.entry("agent", inputs.get("summary") or inputs.get("to") or "an agent")
    if tool == "AskUserQuestion":
        questions = inputs.get("questions")
        question = questions[0].get("question") if isinstance(questions, list) and questions \
            and isinstance(questions[0], dict) else ""
        return rules.entry("ask", question or "a question")
    if tool == "Skill":
        return rules.entry("tool", f"skill {inputs.get('skill') or ''}".strip())
    if tool == "ExitPlanMode":
        return rules.entry("tool", "a plan")
    if tool.startswith("mcp__"):
        return rules.entry("tool", tool_label(tool), result=failed)
    return rules.entry("tool", result="failed" if outcome == "failed" else None)


# Context (see context.py). Claude writes a compaction as a `compact_boundary`
# system item, and the system prompt and tool schemas as `api-request-shape`
# items, only when they change. These are internal formats: an item that does
# not match is skipped, and its text is left in Messages' Other part.
BOUNDARY = b'"subtype":"compact_boundary"'
PINNED = (b'"type":"api-request-shape"',)
# Claude Code keeps about this many tokens free for its automatic compaction.
RESERVED = 33_000
# Every Claude 5 model (`claude-<family>-5…`) has a 1M window, as does a model ID that ends
# in `[1m]`. Older models get 200K.
LARGE_WINDOW = re.compile(r"claude-[a-z]+-5(?:\D|$)|\[1m\]")
context_path = transcript


def context_window(model):
    return 1_000_000 if LARGE_WINDOW.search(model) else 200_000


def is_boundary(item):
    return item.get("type") == "system" and item.get("subtype") == "compact_boundary"


# A boundary written this long before the PostCompact hook started is from an older compaction.
BOUNDARY_AGE = 120


def wait_for_boundary(path, started, wait=WAIT_SECONDS):
    """Wait until the transcript has the boundary of the compaction that just ended.

    The hook can start before Claude Code writes the boundary. The hook is async, so waiting does not slow the agent.
    """
    deadline = time.monotonic() + wait
    while True:
        # Only the newest boundary counts.
        item = next((item for raw in reversed(transcript_tail(path)) if "compact_boundary" in raw
                     and (item := parse(raw)) and is_boundary(item)), None)
        at = item_time(item) if item else None
        if at is not None and at >= started - BOUNDARY_AGE:
            return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(WAIT_STEP)


def compaction(item):
    """A compaction's facts from its boundary item: when, how it started, context before and after."""
    meta = obj(item.get("compactMetadata"))
    count = lambda value: value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None
    took = meta.get("durationMs")
    return {"at": item_time(item), "trigger": meta.get("trigger") if meta.get("trigger") in ("auto", "manual") else None,
            "before": count(meta.get("preTokens")), "after": count(meta.get("postTokens")),
            "took": took / 1000 if isinstance(took, (int, float)) and not isinstance(took, bool) and took > 0 else None}


def attachment_ops(attachment):
    kind = attachment.get("type")
    if kind == "skill_listing":
        return adds("skills", skill_sizes(attachment.get("content")))
    if kind == "instructions":
        return [add("memory", size(attachment.get("files")))]
    if kind == "mcp_instructions_delta":
        return [add("mcp", size(attachment.get("addedBlocks")))]
    if kind == "agent_listing_delta":
        # One description line per agent type, in the same order: a sub-row each.
        types, lines = attachment.get("addedTypes") or [], attachment.get("addedLines") or []
        if len(types) != len(lines):
            return [add("agents", size(lines))]
        return [add("agents", size(line), name if isinstance(name, str) else "") for name, line in zip(types, lines)]
    if kind == "deferred_tools_delta":
        # Tools loaded on demand (ToolSearch) bring their schema; the rest only a name line.
        loaded = [add("tools", size(item.get("definition")), tool_label(item.get("name")))
                  for item in attachment.get("surfacedDefinitions") or [] if isinstance(item, dict)]
        return loaded + [add("tools", size(attachment.get("addedLines")), "Deferred tool names")]
    if kind in {"file", "edited_text_file", "compact_file_reference"}:
        return [add("messages", size(attachment.get("content") or attachment.get("snippet")), "Files")]
    if kind == "queued_command":
        return [add("messages", size(attachment.get("prompt")), "User")]
    return []


def cache_op(body, usage):
    """One API request's cache figures. Claude writes them again for each content block; `id` dedupes."""
    tokens = lambda key: usage.get(key) if isinstance(usage.get(key), int) else 0
    tiers = obj(usage.get("cache_creation"))
    long, short = tiers.get("ephemeral_1h_input_tokens") or 0, tiers.get("ephemeral_5m_input_tokens") or 0
    return ["cache", {"id": body.get("id"), "model": body.get("model"), "read": tokens("cache_read_input_tokens"),
                      "write": tokens("cache_creation_input_tokens"), "uncached": tokens("input_tokens"),
                      # The TTL of what this request wrote; unknown when it wrote both tiers.
                      "ttl": 3600 if long and not short else 300 if short and not long else None}]


def context_ops(item, calls):
    kind = item.get("type")
    if item.get("isSidechain"):
        return []
    if is_boundary(item):
        return [["reset", compaction(item)]]
    if kind == "api-request-shape":
        shape = obj(item.get("shape"))
        return [["pin", "system", {"": size(shape.get("system"))}], ["pin", "tools", tool_sizes(shape.get("tools"))]]
    if kind == "attachment":
        return attachment_ops(obj(item.get("attachment")))
    if kind not in {"user", "assistant"}:
        return []
    body = obj(item.get("message"))
    # A user item (prompt or tool result) is what sends the next request.
    ops = [["sent", item_time(item)]] if kind == "user" else []
    if kind == "assistant":
        usage = obj(body.get("usage"))
        keys = ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens")
        used = sum(usage.get(key) for key in keys if isinstance(usage.get(key), int))
        if used:
            ops += [["usage", used], ["model", body.get("model")], cache_op(body, usage)]
    who = "Assistant" if kind == "assistant" else "Summary" if item.get("isCompactSummary") else "User"
    content = body.get("content")
    if isinstance(content, str):
        return ops + [add("messages", len(content), who)]
    for block in content if isinstance(content, list) else []:
        if not isinstance(block, dict):
            continue
        block_type = block.get("type")
        if block_type == "text":
            ops.append(add("messages", size(block.get("text")), who))
        elif block_type == "thinking":
            # The text is often not kept; its signature stands in.
            ops.append(add("messages", size(block.get("thinking")) or encrypted(block.get("signature")), "Thinking"))
        elif block_type == "image":
            ops.append(add("messages", IMAGE_CHARS, "Images"))
        elif block_type == "tool_use":
            part = tool_label(block.get("name"))
            if isinstance(block.get("id"), str):
                calls[block["id"]] = part
            ops.append(add("messages", size(block.get("input")), part))
        elif block_type == "tool_result":
            ops.append(add("messages", size(block.get("content")), calls.get(block.get("tool_use_id"), "Tools")))
    return ops
