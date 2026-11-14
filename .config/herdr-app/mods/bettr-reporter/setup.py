#!/usr/bin/env python3
"""Check or install the agent reporter (Subagents, Activity, Context) and its hooks.

    setup.py status [machine]    print the state as JSON
    setup.py install [machine]   install or update, then print the new state

Without a machine it works on this computer, and also merges the usage bars' hooks
(mods/bettr-usage/hooks) when that mod is installed. After copying the folders by hand
or from Herdr's gallery, `python3 -I ~/.config/herdr-app/mods/bettr-reporter/setup.py
install` sets up all the hooks. With a machine, this file's own code runs there through
`hc exec`, with the package files sent inline: nothing else needs to be on that machine.
The Layout dialog (bettr-chrome) and scripts/install.py both use it.
"""
import datetime
from fnmatch import fnmatchcase
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

AGENTS = ("claude", "codex")
SETTINGS = {"claude": ".claude/settings.json", "codex": ".codex/hooks.json"}
CONFIG = ".config/herdr-app"
INSTALLED = f"{CONFIG}/mods/bettr-reporter"
# Merged on this computer only: the usage bars read local files.
USAGE = f"{CONFIG}/mods/bettr-usage"
# Files of a mod folder that are not installed: tests, docs, caches, and the type stubs and
# editor config that Herdr writes into a mod folder itself.
SKIP = ("test_*", "*.test.js", "*.md", "*.d.ts", "jsconfig.json", "*.pyc", ".*")
EXEC_SECONDS = 60


def package_files(root):
    """The files to install from a mod folder, relative to it."""
    return sorted(path.relative_to(root).as_posix() for path in root.rglob("*")
                  if path.is_file() and "__pycache__" not in path.parts
                  and not any(fnmatchcase(path.name, pattern) for pattern in SKIP))


def identity(hook):
    """What makes a hook this package's: its script (folder and file) and arguments.
    An edited interpreter or option (`python3.12`, `-B`) is still the same hook."""
    words = hook.get("command").split() if isinstance(hook.get("command"), str) else []
    at = next((index for index, word in enumerate(words) if word.endswith(".py")), None)
    return None if at is None else ("/".join(words[at].replace("\\", "/").split("/")[-2:]), *words[at + 1:])


def identities(settings):
    return {identity(hook) for groups in settings.get("hooks", {}).values() for group in groups
            for hook in group.get("hooks", [])} - {None}


def merge_hooks(existing, fragment):
    """Add this package's hooks, or update them in place.

    A hook is identified by `identity`. When the package changes a hook's
    command, options or matcher, the installed copy is replaced, not
    duplicated. Other hooks are never changed.
    """
    hooks = existing.setdefault("hooks", {})
    for event, groups in fragment["hooks"].items():
        target = hooks.setdefault(event, [])
        for group in groups:
            ours = {identity(hook) for hook in group["hooks"]} - {None}
            home = next((entry for entry in target if entry.get("matcher") == group.get("matcher")
                         and any(identity(hook) in ours for hook in entry.get("hooks", []))), None)
            kept = []
            for entry in target:
                current = entry.get("hooks", [])
                others = [hook for hook in current if identity(hook) not in ours]
                if entry is home:
                    entry["hooks"] = others + [dict(hook) for hook in group["hooks"]]
                elif len(others) != len(current):
                    if not others:
                        continue  # This entry held only an outdated copy of our hook.
                    entry["hooks"] = others
                kept.append(entry)
            if home is None:
                kept.append({**group, "hooks": [dict(hook) for hook in group["hooks"]]})
            target[:] = kept
    return existing


def hook_fragments(*folders):
    """{agent: [fragment, ...]} from each folder's hooks/<agent>.json that exists."""
    return {agent: [json.loads((folder / "hooks" / f"{agent}.json").read_bytes()) for folder in folders
                    if (folder / "hooks" / f"{agent}.json").is_file()] for agent in AGENTS}


def plan_hooks(fragments, agents=None):
    """Each agent's hook state on this machine, and the settings writes that merge `fragments`.

    States: "current", "old" (some of our hooks there, but different), "missing", or "absent"
    when the agent's folder (~/.claude, ~/.codex) is not there; absent agents are left alone.
    Writes are {agent: (path, bytes)}, only for `agents` when given. Invalid JSON raises here,
    before anything is written.
    """
    states, writes = {}, {}
    for agent in AGENTS:
        path = Path.home() / SETTINGS[agent]
        if not path.parent.is_dir():
            states[agent] = "absent"
            continue
        existing = json.loads(path.read_bytes()) if path.is_file() else {}
        merged, ours = json.loads(json.dumps(existing)), set()
        for fragment in fragments[agent]:
            merged = merge_hooks(merged, fragment)
            ours |= identities(fragment)
        states[agent] = "current" if merged == existing else "old" if identities(existing) & ours else "missing"
        if states[agent] != "current" and (not agents or agent in agents):
            writes[agent] = (path, (json.dumps(merged, indent=2) + "\n").encode())
    return states, writes


def write_all(writes, log=print):
    """Write (path, bytes) pairs atomically; existing files are backed up first.

    A link (for example into a dotfiles repository) is written through to its
    target, and a replaced file keeps its permissions.
    """
    backup = None
    for index, (destination, content) in enumerate(writes):
        target, mode = destination.resolve(), None
        if target.exists():
            if backup is None:
                state = Path.home() / ".local/state/bettr/backups"
                state.mkdir(parents=True, exist_ok=True)
                prefix = datetime.datetime.now().strftime("%Y%m%d-%H%M%S-")
                backup = Path(tempfile.mkdtemp(prefix=prefix, dir=state))
            saved = backup / f"{index}-{target.name}"
            shutil.copy2(target, saved)
            with (backup / "paths.txt").open("a") as manifest:
                manifest.write(f"{saved.name}\t{target}\n")
            mode = target.stat().st_mode & 0o777
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".bettr-", dir=target.parent)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(content)
            if mode is not None:
                os.chmod(temporary, mode)
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        log(f"Installed {destination}")
    return backup


def apply(files, fragments, install=False, hooks=True, agents=None):
    """Compare (and with install, update) this machine's copy with `files` ({name: bytes})
    and its agent settings with the hook `fragments` (see plan_hooks).

    Returns {state, files, agents, backup}; state is "current", "old" (installed but
    different) or "missing".
    """
    base = Path.home() / INSTALLED
    changed = [name for name, data in files.items()
               if not (base / name).is_file() or (base / name).read_bytes() != data]
    file_state = "missing" if not (base / "report.py").is_file() else "old" if changed else "current"
    writes = [(base / name, files[name]) for name in changed] if install else []
    agent_states, hook_writes = plan_hooks(fragments, agents)
    if install and hooks:
        for agent, write in hook_writes.items():
            writes.append(write)
            agent_states[agent] = "current"
    backup = write_all(writes, log=lambda line: print(line, file=sys.stderr)) if writes else None
    if install:
        file_state = "current"
    hooked = [s for s in agent_states.values() if s != "absent"]
    overall = file_state if file_state != "current" else "old" if any(s != "current" for s in hooked) else "current"
    return {"state": overall, "files": file_state, "agents": agent_states, "backup": str(backup) if backup else None}


def run(mode, machine=None, hooks=True, agents=None, root=Path(__file__).resolve().parent):
    """Run `apply` here, or on `machine` through hc, and return its result."""
    files = {name: (root / name).read_bytes() for name in package_files(root)}
    options = {"files": files, "install": mode == "install", "hooks": hooks, "agents": agents}
    if not machine:
        return apply(**options, fragments=hook_fragments(root, Path.home() / USAGE))
    options["fragments"] = hook_fragments(root)
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from report import hc
    script = f"_REMOTE = {options!r}\n".encode() + (root / "setup.py").read_bytes()
    try:
        done = subprocess.run([hc(), "exec", "--on", machine, "-i", "--", "python3", "-"],
                              input=script, capture_output=True, check=False, timeout=EXEC_SECONDS)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"{machine} did not answer within {EXEC_SECONDS} seconds") from None
    stdout, stderr = (stream.decode("utf-8", "replace") for stream in (done.stdout, done.stderr))
    if done.returncode != 0:
        text = (stderr or stdout).strip()
        try:
            text = json.loads(text)["error"]["message"]  # hc reports its own failures as JSON
        except (ValueError, KeyError, TypeError):
            pass
        raise RuntimeError(text or f"hc exec failed ({done.returncode})")
    sys.stderr.write(stderr)
    return json.loads(stdout.strip().splitlines()[-1])


def main():
    if len(sys.argv) not in (2, 3) or sys.argv[1] not in ("status", "install"):
        sys.exit(__doc__)
    try:
        result = run(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else None)
    except Exception as error:  # noqa: BLE001 - the caller shows the message
        sys.exit(str(error).splitlines()[-1] if str(error) else type(error).__name__)
    print(json.dumps(result))


if __name__ == "__main__":
    if "_REMOTE" in globals():
        print(json.dumps(apply(**_REMOTE)))  # noqa: F821 - set by run() on the other machine
    else:
        main()
