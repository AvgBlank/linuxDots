#!/usr/bin/env python3
"""Publish native agent hook events through Herdr's existing terminal sync.

`providers/<agent>.py` turns one agent's hook payload into neutral events.
This file applies them to the `bettr.subagents` label state (SCHEMA.md), and
`activity.py` applies them to the `bettr.activity` label state
(mods/bettr-activity/SCHEMA.md), and `context.py` reads the transcript into the
`bettr.context` label (mods/bettr-context/SCHEMA.md). None has provider-specific
logic. Everything is local: no network or model requests. macOS and Linux only.
"""
import os
import sys

try:
    import fcntl
except ImportError:  # Windows: the reporter does nothing there.
    fcntl = None

if __name__ == "__main__" and (fcntl is None or not os.environ.get("HC_TERMINAL_ID")):
    # Nothing to publish outside a Herdr terminal: answer before the slower imports.
    sys.stdin.buffer.read()
    print("{}")
    sys.exit(0)

import hashlib  # noqa: E402
import importlib  # noqa: E402
import json  # noqa: E402
from pathlib import Path  # noqa: E402
import re  # noqa: E402
import time  # noqa: E402

HERE = Path(__file__).resolve().parent
# `python3 -I` leaves this folder off sys.path. No bytecode: Herdr reloads a mod when its folder changes.
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
sys.dont_write_bytecode = True

import activity  # noqa: E402
import context  # noqa: E402
from providers.common import HC_SECONDS, LOCK_SECONDS, dump  # noqa: E402

LABEL = "bettr.subagents"
VERSION = 2
FIELDS = ("type", "name", "description", "model", "modelLabel", "effort")
ROW_KEYS = {"id", "status", "startedAt", "endedAt", "updatedAt", *FIELDS}
# Cache files of terminals unused for this long are removed when a session starts.
CACHE_DAYS = 14


def adapter(provider):
    """providers/<provider>.py, or None."""
    if not isinstance(provider, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,31}", provider) \
            or not (HERE / "providers" / f"{provider}.py").is_file():
        return None
    module = importlib.import_module(f"providers.{provider}")
    return module if hasattr(module, "normalize") else None


def find(state, agent_id):
    return next((row for row in state["agents"] if row["id"] == agent_id), None)


def apply_fields(row, fields):
    changed = {key: value for key, value in fields.items() if key in FIELDS and row.get(key) != value}
    row.update(changed)
    return bool(changed)


def interrupt_working(state, now):
    """Mark working rows interrupted. Return whether any row changed."""
    working = [row for row in state["agents"] if row["status"] == "working"]
    for row in working:
        row.update(status="interrupted", endedAt=now, updatedAt=now)
    return bool(working)


def step(state, event, provider, now):
    """Apply one neutral event. Return (state, changed)."""
    kind, session, agent_id = event.get("type") or "", event.get("session"), event.get("agent")
    if not session:
        return state, False
    if state and state["sessionId"] != session:
        # Late events from an old conversation must not replace the current one.
        # A child may report under its own session ID; accept it only when this
        # parent already lists that child.
        child = kind.startswith("agent.") and session == agent_id and find(state, agent_id)
        if kind in {"session.start", "session.prompt"}:
            state = None
        elif not child:
            return state, False
    fresh = not state or state.get("provider") != provider
    if fresh:
        state = {"version": VERSION, "provider": provider, "sessionId": session, "agents": []}
    if kind in {"session.start", "session.prompt", "session.end"}:
        ended = kind == "session.end"
        changed = fresh or state.get("ended", False) != ended
        state["ended"] = ended
        if ended or (kind == "session.start" and not event.get("keepAgents")):
            changed = interrupt_working(state, now) or changed
        return state, changed
    if not agent_id or kind not in {"agent.start", "agent.stop", "agent.meta"}:
        return state, False
    row, fields = find(state, agent_id), event.get("fields") or {}
    if row is None:
        # Only a start, or a launch response, proves an agent exists. Stops and
        # metadata for unknown IDs come from internal helpers or killed shells.
        if kind == "agent.stop" or (kind == "agent.meta" and not event.get("create")):
            return state, False
        row = {"id": agent_id, "type": "Subagent", "status": "working", "startedAt": now}
        state["agents"].append(row)
        changed = True
    else:
        changed = False
    if kind == "agent.start" and row["status"] != "working":
        # The same agent was resumed: a new run.
        row.update(status="working", startedAt=now)
        row.pop("endedAt", None)
        changed = True
    elif kind == "agent.stop" and row["status"] == "working" and event.get("outcome") in activity.OUTCOMES:
        row.update(status=event["outcome"], endedAt=now)
        changed = True
    changed = apply_fields(row, fields) or changed
    if changed:
        row["updatedAt"] = now
        if kind != "agent.meta":
            state["ended"] = False
    return state, changed


def valid(state):
    """A cached state of this version, or None."""
    ok = isinstance(state, dict) and state.get("version") == VERSION and isinstance(state.get("agents"), list) \
        and isinstance(state.get("sessionId"), str)
    return state if ok else None


def prune(rows):
    """Keep every active row, plus the last 16 finished rows, in a stable order."""
    active = sorted((row for row in rows if row["status"] == "working"), key=lambda row: row["startedAt"])
    finished = sorted((row for row in rows if row["status"] != "working"),
                      key=lambda row: row.get("endedAt") or row["updatedAt"], reverse=True)[:16]
    return [{key: value for key, value in row.items() if key in ROW_KEYS} for row in (active + finished)[:64]]


def reduce(state, events, provider, now):
    """Apply neutral events to the subagent state. Return it, or None when nothing changed."""
    state = valid(state)
    changed = False
    for neutral in events:
        state, did = step(state, neutral, provider, now)
        changed = changed or did
    if not changed or state is None:
        return None
    state["updatedAt"] = now
    state["agents"] = prune(state["agents"])
    return state


def apply(states, events, provider, now):
    """Apply neutral events to both labels' states. Return {label: new state} for those that changed."""
    changed = {LABEL: reduce(states.get(LABEL), events, provider, now),
               activity.LABEL: activity.update(states.get(activity.LABEL), events, provider, now)}
    return {label: state for label, state in changed.items() if state is not None}


def published(states):
    """What each state published. Take it before `apply`, which changes states in place."""
    return {LABEL: dump(states[LABEL]) if states.get(LABEL) is not None else None,
            activity.LABEL: activity.snapshot(states.get(activity.LABEL))}


def changes(before, after):
    """Labels to send: the changed values. `before` is from `published`; `after` is
    what `apply` returned. The activity log compares only its index, its newest
    turn, and removed turns."""
    pairs = {}
    if LABEL in after and dump(after[LABEL]) != before[LABEL]:
        pairs[LABEL] = dump(after[LABEL])
    if activity.LABEL in after:
        pairs.update(activity.changes(before[activity.LABEL], after[activity.LABEL]))
    return pairs


def hc():
    """The `hc` command: on PATH, or where Herdr installs it (an app's PATH can lack ~/.local/bin)."""
    import shutil
    return shutil.which("hc") or str(Path.home() / ".local/bin/hc")


def publish(terminal, pairs):
    # Arguments go directly to hc; no shell, prompts, or extra terminals.
    import subprocess  # Only when a label changed.
    result = subprocess.run([hc(), "label", terminal, *(f"{key}={value}" for key, value in pairs.items())],
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=HC_SECONDS)
    if result.returncode:
        raise RuntimeError(f"hc label failed: {result.stderr.decode(errors='replace').strip()[:200]}")


def load(path):
    try:
        return json.loads(path.read_bytes())
    except (FileNotFoundError, ValueError):
        return None


def write_atomic(path, state):
    """Replace `path` with `state` as JSON; a reader never sees a partial file."""
    temporary = path.with_name(f".{path.name}.{os.getpid()}")  # Writers of one path hold its lock.
    try:
        with open(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as output:
            json.dump(state, output)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def forget_old(folder, now):
    for path in folder.glob("*"):
        try:
            if path.is_file() and now - path.stat().st_mtime > CACHE_DAYS * 86400:
                path.unlink()
        except OSError:
            pass


def take(lock, deadline):
    """Lock a terminal's state, or raise when the hook's time is up."""
    while True:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            os.utime(lock.name)  # A lock in use is never old, so `forget_old` keeps it.
            return
        except BlockingIOError:
            if time.monotonic() >= deadline:
                raise TimeoutError("another hook held the state lock too long") from None
            time.sleep(0.02)


def record(event, provider, terminal, folder, send=publish):
    # The event's time is when the hook started: hooks can reach the lock out of order.
    now, started = time.time(), time.monotonic()
    module = adapter(provider)
    if not terminal or fcntl is None or module is None or not isinstance(event, dict):
        return
    # Normalize before the lock: an adapter can wait for the agent's transcript.
    events = module.normalize(event)
    if not events:
        return
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    if any(item.get("type") == "session.start" for item in events):
        forget_old(folder, now)
    key = hashlib.sha256((os.environ.get("HC_SESSION", "") + ":" + terminal).encode()).hexdigest()
    paths = {LABEL: folder / f"{key}.json", activity.LABEL: folder / f"{key}.activity.json",
             context.LABEL: folder / f"{key}.context.json"}
    with (folder / f"{key}.lock").open("a") as lock:
        # Separate agents can finish together. Hold the lock through publication
        # so an older snapshot can never overwrite a newer label.
        take(lock, started + LOCK_SECONDS)
        states = {label: load(path) for label, path in paths.items()}
        before = published(states)
        changed = apply(states, events, provider, now)
        pairs = changes(before, changed)
        # The context label is read from the transcript, not built from events.
        measured = context.update(states[context.LABEL], event, events, provider, module)
        if measured is not None:
            pairs[context.LABEL] = measured["label"]
            changed[context.LABEL] = measured
        if pairs:
            # Send first: when sending fails, the saved state still matches the
            # labels, so the next event sends this change again.
            send(terminal, pairs)
        for label, state in changed.items():
            write_atomic(paths[label], activity.stored(state) if label == activity.LABEL else state)


if __name__ == "__main__":
    try:
        record(json.load(sys.stdin.buffer), sys.argv[1], os.environ.get("HC_TERMINAL_ID"),
               Path.home() / ".cache/bettr/reporter")
    except Exception as error:
        # Observing a subagent must never block it or inject model instructions.
        print(f"bettr-reporter: {error}", file=sys.stderr)
    print("{}")
