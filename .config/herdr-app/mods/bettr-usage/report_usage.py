#!/usr/bin/env python3
"""Save agents' plan usage for the bettr-usage mod.

    python3 -I report_usage.py <agent>         As an agent hook, with the hook's JSON on stdin.
    python3 -I report_usage.py --now [agent…]  Refresh now (all known agents by default).

It replaces ~/.cache/bettr/usage/<agent>.json atomically with:

    {"agent": "codex", "name": "Codex", "updatedAt": <epoch s>,
     "windows": [{"label": "5-hour", "used": <0-100>, "resetsAt": <epoch s> | null}]}

To add an agent, add a reader to READERS: reader(hook, forced) returns the windows, or None
to keep the last snapshot. `forced` is True for --now: the person asked, so get fresh data even
if that costs more than a hook should. The script prints nothing to stdout and always exits 0,
so it can never change what the agent does.
"""
import datetime
import hashlib
import json
import math
import os
import re
import sys
import time
import unicodedata
from pathlib import Path

try:
    import fcntl
except ImportError:  # Windows: no lock, so parallel hooks can each ask once.
    fcntl = None

CACHE = Path.home() / ".cache" / "bettr" / "usage"
# When Claude's usage was last asked for and may be asked for next. Outside CACHE, which the
# sidebar watches, so an attempt does not redraw it.
GATE = CACHE.parent / "usage-claude.json"
NAMES = {"claude": "Claude Code", "codex": "Codex"}
REWRITE_S = 60  # An unchanged snapshot gets a new updatedAt about once a minute at most.
# The usage endpoint limits requests per account and sends `Retry-After: 0`, so pace ourselves.
# Hooks ask every 2 minutes at most. After failures in a row they wait 2, 4, 8, then 15 minutes:
# a short 429 costs no extra wait, a long one costs about 4 requests an hour.
INTERVAL_S = 120
MAX_WAIT_S = 900
CLICK_GAP_S = 30  # A click asks at once, even while hooks wait, but not twice in 30 s.
TIMEOUT_S = 10  # Per agent, so --now stays inside Herdr's 30 s exec limit.
# A hook reads this much of the end of a Codex rollout. Codex saves its limits after each model
# response, so a rollout with none there (an API-key login) has none: do not read it all on each tool call.
SCAN_BYTES = 4 << 20
SYSTEM_CAS = "/etc/ssl/cert.pem"


def epoch(value):
    """Epoch seconds from a number or an ISO 8601 string, else None."""
    if isinstance(value, str):
        try:
            # Python 3.9 parses only 3 or 6 fraction digits, so pad or cut them to 6.
            value = re.sub(r"\.(\d+)", lambda m: "." + (m.group(1) + "000000")[:6], value.replace("Z", "+00:00"), count=1)
            value = datetime.datetime.fromisoformat(value).timestamp()
        except ValueError:
            return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return value


def window(label, used, resets_at):
    used = epoch(used)  # Same check: a finite number.
    return None if used is None else {"label": label, "used": max(0, min(100, used)), "resetsAt": epoch(resets_at)}


def label_for(minutes):
    return {300: "5-hour", 10080: "Weekly"}.get(minutes) or (f"{minutes // 60}h" if isinstance(minutes, int) else "Limit")


# --- Claude Code: no hook carries rate limits, so ask the usage endpoint that /usage uses. ---

def claude_login():
    """Claude Code's credentials folder and macOS Keychain item, by Claude Code's own rule: a set
    CLAUDE_SECURESTORAGE_CONFIG_DIR (else CLAUDE_CONFIG_DIR) adds a hash of the folder to the name."""
    secure = os.environ.get("CLAUDE_SECURESTORAGE_CONFIG_DIR")
    chosen = secure if secure is not None else os.environ.get("CLAUDE_CONFIG_DIR")
    folder = unicodedata.normalize("NFC", chosen or str(Path.home() / ".claude"))
    suffix = f"-{hashlib.sha256(folder.encode()).hexdigest()[:8]}" if chosen else ""
    return Path(folder), f"Claude Code-credentials{suffix}"


def claude_token():
    folder, service = claude_login()
    raw = None
    if sys.platform == "darwin":
        import subprocess
        result = subprocess.run(["/usr/bin/security", "find-generic-password", "-s", service, "-w"],
                                capture_output=True, text=True, timeout=5)
        raw = result.stdout if result.returncode == 0 else None
    if not raw:  # Linux, or a Keychain that cannot be read.
        path = folder / ".credentials.json"
        raw = path.read_bytes() if path.exists() else None
    oauth = (json.loads(raw) if raw else {}).get("claudeAiOauth") or {}
    # Never refresh an expired token: rotating it would sign Claude Code out. Claude refreshes it itself.
    if (epoch(oauth.get("expiresAt")) or 0) / 1000 <= time.time():
        return None
    return oauth.get("accessToken")


def gate(change):
    """Run change(state, now) on Claude's request times under a lock, and save what it changed.
    Parallel tool calls start their hooks at the same moment; the lock lets only one of them ask."""
    CACHE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with open(os.open(GATE, os.O_RDWR | os.O_CREAT, 0o600), "r+") as handle:
        if fcntl:
            fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            state = json.loads(handle.read() or "{}")
        except ValueError:
            state = {}
        # Keep only numbers: a damaged file must not stop or flood the requests.
        state = {k: v for k, v in state.items() if isinstance(v, (int, float)) and epoch(v) is not None} \
            if isinstance(state, dict) else {}
        before = dict(state)
        result = change(state, time.time())
        if state != before:
            handle.seek(0)
            handle.truncate()
            json.dump(state, handle)
    return result


def claim(forced):
    """Take the next request if it is due. Until settle() plans the next one, hooks wait at least
    the normal interval, so a missing token or a killed process cannot cause a burst."""
    def change(state, now):
        due = state.get("last", 0) + CLICK_GAP_S if forced else state.get("next", 0)
        if now < due:
            return False
        state.update(last=now, next=max(state.get("next", 0), now + INTERVAL_S))
        return True
    return gate(change)


def settle(ok, retry_after=0):
    """Plan the next hook request: the normal interval after a success; after failures in a row
    2, 4, 8, then 15 minutes, or longer when the server asks for it."""
    def change(state, now):
        failures = 0 if ok else min(int(state.get("failures", 0)), 8) + 1
        wait = min(INTERVAL_S * 2 ** max(failures - 1, 0), MAX_WAIT_S)
        state.update(failures=failures, next=now + max(wait, min(retry_after, 3600)))
    gate(change)


def tls_context():
    """Python from python.org has no CA certificates until its "Install Certificates" step has run.
    Then all HTTPS fails, so use the certificates that macOS includes."""
    import ssl
    context = ssl.create_default_context()
    if not context.cert_store_stats()["x509_ca"] and os.path.exists(SYSTEM_CAS):
        context.load_verify_locations(SYSTEM_CAS)
    return context


def claude(_hook, forced):
    if not claim(forced):  # Hooks fire on every tool call; nearly all of them stop here.
        return None
    token = claude_token()
    if not token:
        return None
    import urllib.error
    import urllib.request  # ~60 ms to load, so only when a request is due.
    request = urllib.request.Request("https://api.anthropic.com/api/oauth/usage", headers={
        "Authorization": f"Bearer {token}",
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "bettr-usage",
    })
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S, context=tls_context()) as response:
            usage = json.load(response)
    except urllib.error.HTTPError as error:
        retry = error.headers.get("Retry-After", "")
        settle(False, int(retry) if retry.isdigit() else 0)
        raise
    except Exception:  # Offline, timed out, or not JSON.
        settle(False)
        raise
    settle(True)
    rows = [("5-hour", usage.get("five_hour")), ("Weekly", usage.get("seven_day"))]
    return [w for label, item in rows if isinstance(item, dict)
            and (w := window(label, item.get("utilization"), item.get("resets_at")))]


# --- Codex: hooks read the rate limits Codex saved in the rollout; --now asks Codex's app-server. ---

def codex_windows(limits):
    """Windows from a Codex rate-limit snapshot: rollout (snake_case) or app-server (camelCase)."""
    windows = []
    for item in (limits.get("primary"), limits.get("secondary")):
        if isinstance(item, dict):
            field = lambda snake, camel: item.get(snake, item.get(camel))
            w = window(label_for(field("window_minutes", "windowDurationMins")),
                       field("used_percent", "usedPercent"), field("resets_at", "resetsAt"))
            if w:
                windows.append(w)
    return windows


def reverse_lines(path, limit=None):
    """Read backward in 64 KiB chunks; the newest usage event is usually in the last one.
    With `limit`, stop after about that many bytes."""
    with path.open("rb") as stream:
        position = stream.seek(0, 2)
        stop = max(0, position - limit) if limit else 0
        tail = b""
        while position > stop:
            size = min(position, 65536)
            position -= size
            stream.seek(position)
            lines = (stream.read(size) + tail).split(b"\n")
            tail = lines[0]
            yield from reversed(lines[1:])
        if tail and not position:  # Not the cut line where a limited read stopped.
            yield tail


def codex_rollout(hook):
    path = hook.get("transcript_path")
    if not isinstance(path, str) or not path:
        root = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex") / "sessions"
        path = max(root.rglob("*.jsonl"), key=lambda p: p.stat().st_mtime, default=None)
        if path is None:
            return None
    for line in reverse_lines(Path(path), SCAN_BYTES):
        if b'"rate_limits"' not in line:
            continue
        try:
            event = json.loads(line)
        except (ValueError, UnicodeDecodeError):
            continue  # Includes a record that Codex is still writing.
        payload = event.get("payload") or {}
        limits = payload.get("rate_limits")
        if payload.get("type") != "token_count" or not isinstance(limits, dict):
            continue
        if limits.get("limit_id") not in (None, "codex"):
            continue
        windows = codex_windows(limits)
        if windows:
            return windows
    return None


def codex_app_server():
    """One `account/rateLimits/read` over a short-lived `codex app-server` (JSON-RPC on stdio).
    Codex handles its own login and token refresh."""
    import subprocess
    import threading
    server = subprocess.Popen(["codex", "app-server"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL, text=True)
    timer = threading.Timer(TIMEOUT_S, server.kill)
    timer.start()
    try:
        def send(message):
            server.stdin.write(json.dumps(message) + "\n")
            server.stdin.flush()

        def reply(request_id):
            for line in server.stdout:
                message = json.loads(line)
                if message.get("id") == request_id:
                    if "error" in message:
                        raise RuntimeError(f"codex app-server: {message['error']}")
                    return message.get("result") or {}
            raise RuntimeError("codex app-server closed without a reply")

        send({"id": 1, "method": "initialize", "params": {"clientInfo": {"name": "bettr-usage", "version": "1"}}})
        reply(1)
        send({"method": "initialized"})
        send({"id": 2, "method": "account/rateLimits/read", "params": {"excludeResetCreditDetails": True}})
        result = reply(2)
    finally:
        timer.cancel()
        server.kill()
        server.wait()
    limits = (result.get("rateLimitsByLimitId") or {}).get("codex") or result.get("rateLimits")
    return codex_windows(limits) if isinstance(limits, dict) else None


def codex(hook, forced):
    return codex_app_server() if forced else codex_rollout(hook)


READERS = {"claude": claude, "codex": codex}


def unchanged(agent, windows):
    """The saved snapshot shows the same windows and is under a minute old."""
    try:
        saved = json.loads((CACHE / f"{agent}.json").read_bytes())
        return saved["windows"] == windows and time.time() - saved["updatedAt"] < REWRITE_S
    except (OSError, ValueError, KeyError, TypeError):
        return False


def save(agent, windows):
    """Replace the agent's snapshot atomically; the sidebar never reads a partial file."""
    CACHE.mkdir(mode=0o700, parents=True, exist_ok=True)
    snapshot = {"agent": agent, "name": NAMES.get(agent, agent.title()), "updatedAt": time.time(), "windows": windows}
    temporary = CACHE / f".{agent}.{os.getpid()}"
    try:
        with open(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as handle:
            json.dump(snapshot, handle)
        os.replace(temporary, CACHE / f"{agent}.json")
    finally:
        if temporary.exists():
            temporary.unlink()


def report(agent, hook, forced):
    reader = READERS.get(agent)
    if reader is None:
        raise ValueError(f"unknown agent {agent!r}; known: {', '.join(READERS)}")
    windows = reader(hook, forced)
    # The sidebar watches the snapshot files: an unchanged one is not rewritten on every tool call.
    if windows and (forced or not unchanged(agent, windows)):
        save(agent, windows)


def main():
    args = sys.argv[1:]
    if "--now" in args:
        # One agent's failure (not installed, signed out, offline) must not stop the others.
        for agent in [a for a in args if a != "--now"] or list(READERS):
            try:
                report(agent, {}, forced=True)
            except Exception as error:
                print(f"bettr-usage: {agent}: {error}", file=sys.stderr)
        return
    try:
        hook = json.load(sys.stdin.buffer)
    except ValueError:
        hook = {}
    report(args[0] if args else "", hook if isinstance(hook, dict) else {}, forced=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # A usage bar must never break the agent's turn.
        print(f"bettr-usage: {error}", file=sys.stderr)
