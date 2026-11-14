"""Provider-neutral reducer for the `bettr.activity` labels (mods/bettr-activity/SCHEMA.md).

It keeps activity entries in the order they happened, grouped by prompt, and
merges a step with the one just before it when they are the same kind of work.
The log is published as one index label plus one label per turn, so an event
re-sends only what changed. It has no provider-specific logic.
"""
import bisect

from providers.common import dump

LABEL = "bettr.activity"
VERSION = 4
MAX_TURNS, MAX_ENTRIES, MAX_REPLY, MAX_ITEMS, MAX_FILES = 300, 60, 2000, 30, 20
# A label is one command-line argument to `hc`; Linux allows 128 KiB for one.
# The index and each turn are kept under this many UTF-8 bytes.
MAX_BYTES = 100_000
# A prompt this long after the open turn's last step starts a new turn: the
# agent was interrupted without a stop event, so this is not steering.
STALE_TURN = 15 * 60
# Async tool hooks can finish just after the turn's stop event. Their steps
# still belong to that turn.
LATE = 5
KINDS = {"run", "edit", "read", "search", "web", "agent", "ask", "tool", "steer", "notice", "message"}
RESULTS = {"ok", "failed", "interrupted", "started"}
OUTCOMES = {"done", "failed", "interrupted"}
ENTRY_KEYS = {"kind", "tool", "label", "text", "result", "detail", "items", "files", "repeat", "from", "at"}
HEADING_KEYS = ("id", "prompt", "source", "from", "startedAt", "endedAt", "outcome")
BODY_KEYS = ("entries", "dropped", "reply")
# Never merged: each is its own message.
SINGLE = {"steer", "notice", "message"}
# Merged whatever tool made them: Grep and Glob are both searches.
BY_KIND = {"read", "search", "edit"}
# Composite tool calls (scripts that call other tools) are a fallback only.
DIRECT_KINDS = {"run", "edit", "read", "search"}


def size(value):
    return len(dump(value).encode())


def open_turn(state):
    turns = state["turns"]
    return turns[-1] if turns and "endedAt" not in turns[-1] else None


def close(state, at, outcome):
    turn = open_turn(state)
    if turn is None:
        return False
    turn.update(endedAt=at, outcome=outcome)
    return True


def last_step(turn):
    return max([turn["startedAt"], *(entry["at"] for entry in turn["entries"])])


def clean(entry):
    if not isinstance(entry, dict) or entry.get("kind") not in KINDS:
        return None
    entry = {key: value for key, value in entry.items() if key in ENTRY_KEYS}
    if entry.get("result") not in RESULTS:
        entry.pop("result", None)
    return entry


def merge_files(old, new):
    files = {path: [path, added, removed, op] for path, added, removed, op in old}
    for path, added, removed, op in new:
        if path not in files:
            files[path] = [path, added, removed, op]
            continue
        current = files[path]
        if isinstance(added, int) or isinstance(current[1], int):
            current[1] = (current[1] or 0) + (added or 0)
            current[2] = (current[2] or 0) + (removed or 0)
        if op == "deleted":
            current[3] = "deleted"
        elif current[3] == "deleted":
            current[3] = "modified"
    return list(files.values())


def same_step(last, entry):
    if last is None or entry["kind"] in SINGLE:
        return False
    keys = ("kind", "label") if entry["kind"] in BY_KIND else ("kind", "tool", "label")
    return all(last.get(key) == entry.get(key) for key in keys)


def add(turn, entry, at):
    """Add one step at its event time, or fold it into the step just before it.

    Hooks can finish out of order (an async hook waits for the transcript), so
    a step older than the newest is put in its place. Only the newest step
    merges: reads join reads, searches join searches (counted), edits join
    edits, and the same command again counts as a repeat.
    """
    entry["at"] = at
    entries = turn["entries"]
    if entries and at < entries[-1]["at"]:
        entries.insert(bisect.bisect_right([item["at"] for item in entries], at), entry)
    elif not same_step(entries[-1] if entries else None, entry):
        entries.append(entry)
    else:
        last = entries[-1]
        if entry["kind"] in {"read", "search"}:
            known = last.get("items", [])
            last.update(items=(known + [item for item in entry.get("items", []) if item not in known])[:MAX_ITEMS],
                        at=at)
            if entry["kind"] == "search":
                last["repeat"] = last.get("repeat", 1) + 1
                last["detail"] = entry.get("detail", last.get("detail"))
        elif entry["kind"] == "edit":
            last.update(files=merge_files(last.get("files", []), entry.get("files", []))[:MAX_FILES], at=at)
        else:
            # The same command again (a test rerun): keep its latest result.
            for key in ("result", "detail"):
                last.pop(key, None)
            last.update({key: value for key, value in entry.items() if key != "kind"},
                        repeat=last.get("repeat", 1) + 1)
    if len(entries) > MAX_ENTRIES:
        del entries[0]
        turn["dropped"] = turn.get("dropped", 0) + 1


def new_turn(state, prompt, at):
    """A turn with a session-unique ID: its label name, stable while older turns are pruned."""
    state["next"] = state.get("next", 1) + 1
    return {"id": state["next"] - 1, "prompt": prompt, "startedAt": at, "entries": []}


def step(state, event, provider, now):
    """Apply one neutral event that happened at `now`. Return (state, changed)."""
    kind, session = event.get("type") or "", event.get("session")
    if not session:
        return state, False
    if state and state["sessionId"] != session:
        if kind not in {"session.start", "session.prompt"}:
            return state, False
        state = None
    fresh = not state or state.get("provider") != provider
    if fresh:
        state = {"version": VERSION, "provider": provider, "sessionId": session, "turns": [], "next": 1}
    if kind == "session.start":
        return state, (not event.get("keepAgents") and close(state, now, "interrupted")) or fresh
    if kind == "session.end":
        return state, close(state, now, "interrupted") or fresh
    if kind == "session.prompt":
        turn = open_turn(state)
        if turn is not None and now - last_step(turn) < STALE_TURN:
            # A message sent while the agent works steers the open turn.
            note = {"kind": "notice" if event.get("source") == "notice" else "steer",
                    "label": event.get("prompt") or "", "from": event.get("from")}
            add(turn, clean({key: value for key, value in note.items() if value}), now)
            return state, True
        if turn is not None:
            close(state, last_step(turn), "interrupted")  # It stopped at its last step.
        turn = new_turn(state, event.get("prompt") or "", now)
        if event.get("source") == "notice":
            turn["source"] = "notice"
            if isinstance(event.get("from"), str) and event["from"]:
                turn["from"] = event["from"][:200]
        state["turns"].append(turn)
        return state, True
    if kind == "turn.end":
        outcome = event.get("outcome") if event.get("outcome") in OUTCOMES else "done"
        turn = open_turn(state)
        reply = event.get("reply")
        if turn is None:
            return state, False
        if isinstance(reply, str) and reply.strip():
            reply = reply.strip()
            turn["reply"] = reply if len(reply) <= MAX_REPLY else reply[:MAX_REPLY].rstrip() + "…"
        # An interrupt found in the transcript has its own time: the turn did not run until now.
        at = event.get("at")
        end = min(now, max(at, last_step(turn))) if isinstance(at, (int, float)) and not isinstance(at, bool) else now
        return state, close(state, end, outcome)
    if kind != "activity":
        return state, False
    entry = clean(event.get("entry"))
    if entry is None:
        return state, False
    if event.get("composite"):
        if state.get("direct"):
            return state, False
    elif entry["kind"] in DIRECT_KINDS:
        state["direct"] = True
    turn = open_turn(state)
    if turn is None:
        last = state["turns"][-1] if state["turns"] else None
        if last is not None and now <= last["endedAt"] + LATE:
            turn = last  # A step reported just after the stop event.
        else:
            # Work without a prompt, for example after a background agent reports.
            turn = new_turn(state, "", now)
            state["turns"].append(turn)
    add(turn, entry, now)
    return state, True


def heading(turn):
    return {key: turn[key] for key in HEADING_KEYS if key in turn}


def body(turn):
    return {key: turn[key] for key in BODY_KEYS if turn.get(key)}


def index(state):
    return {"version": VERSION, "provider": state["provider"], "sessionId": state["sessionId"],
            "turns": [heading(turn) for turn in state["turns"]]}


def prune(state):
    """Keep the session within MAX_TURNS, and each label within MAX_BYTES."""
    turns = state["turns"]
    del turns[:-MAX_TURNS]
    # Only the newest turn grows; older turns were checked when they were newest.
    while turns and turns[-1]["entries"] and size(body(turns[-1])) > MAX_BYTES:
        del turns[-1]["entries"][0]
        turns[-1]["dropped"] = turns[-1].get("dropped", 0) + 1
    while len(turns) > 1 and size(index(state)) > MAX_BYTES:
        del turns[0]
    return state


def stored(state):
    """What the cache keeps: every turn's heading, and the newest turn's body.
    Only the newest turn changes; older bodies were sent when they were newest."""
    return {**state, "turns": [heading(turn) for turn in state["turns"][:-1]] + state["turns"][-1:]}


def snapshot(state):
    """What a state published, taken before an event changes the state in place.

    Finished turns never change, so only the index and the newest turn's value
    are kept, with every turn ID. An older cache was published as the single
    `bettr.activity` label.
    """
    if not isinstance(state, dict) or state.get("version") != VERSION:
        return {"labels": {LABEL: dump(state)} if state is not None else {}, "ids": [], "newest": None,
                "session": None}
    turns = state["turns"]
    labels = {LABEL: dump(index(state))}
    if turns:
        labels[f"{LABEL}.{turns[-1]['id']}"] = dump(body(turns[-1]))
    return {"labels": labels, "ids": [turn["id"] for turn in turns], "newest": turns[-1]["id"] if turns else None,
            "session": (state["provider"], state["sessionId"])}


def changes(before, state):
    """Labels to send after an event: changed values, and `""` for removed turns."""
    ids = {turn["id"] for turn in state["turns"]}
    published = set(before["ids"])
    # A new session reuses turn IDs: none of its turns were published.
    same = before["session"] == (state["provider"], state["sessionId"])
    known = published if same else set()
    old = before["labels"] if same else {LABEL: before["labels"].get(LABEL)}
    newest = before["newest"] if same else None
    pairs = {}
    value = dump(index(state))
    if old.get(LABEL) != value:
        pairs[LABEL] = value
    for turn in state["turns"]:
        # The turn that was newest, and any turn this event added.
        if turn["id"] not in known or turn["id"] == newest:
            key, value = f"{LABEL}.{turn['id']}", dump(body(turn))
            if old.get(key) != value:
                pairs[key] = value
    pairs.update({f"{LABEL}.{turn_id}": "" for turn_id in published - ids})
    return pairs


def update(state, events, provider, now):
    """Apply neutral events. Return the new state, or None when nothing changed."""
    if not isinstance(state, dict) or state.get("version") != VERSION or not isinstance(state.get("turns"), list):
        state = None
    changed = False
    for event in events:
        state, did = step(state, event, provider, now)
        changed = changed or did
    if not changed or state is None:
        return None
    return prune(state)
