"""Project picker and worktree slots for the Herdr app, run in an extras popup.

Usage: helper.py project | helper.py wt root|1|2|3   (cwd: the focused pane's folder)
       helper.py equalize <tab>   (no popup: gives every pane of the tab the same area)
"""

import json
import os
import random
import re
import subprocess
import sys
from pathlib import Path

HOME = Path.home()
STATE = HOME / ".config/herdr-app/data/extras/worktree-slots.json"
OLD_STATE = HOME / ".config/herdr/worktree-slots.json"
FZF = ["fzf", "--no-height", "--layout=reverse", "--border=none", "--no-multi"]
FZF_ENV = dict(os.environ, FZF_DEFAULT_OPTS="", FZF_DEFAULT_OPTS_FILE="")


def out(*cmd, cwd=None):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr.strip() or f"{cmd[0]} failed")
    return r.stdout


def herdr(command, **args):
    out("herdr-app", "do", command, json.dumps(args))


def pick(rows, prompt, header=""):
    r = subprocess.run(FZF + [f"--prompt={prompt}> ", f"--header={header}"],
                       input="\n".join(rows) + "\n", text=True,
                       stdout=subprocess.PIPE, env=FZF_ENV)
    return r.stdout.strip() if r.returncode == 0 else None


def inside(path, folder):
    return path == folder or path.startswith(folder.rstrip("/") + "/")


def open_dir(folder):
    """Show the space already working in folder, else make one there."""
    folder = str(Path(folder).resolve())
    cwd = {t["address"]: t.get("cwd") or "" for t in json.loads(out("hc", "ls", "--json"))["terminals"]}
    for space in json.loads(out("herdr-app", "ls"))["spaces"]:
        if space.get("machine"):
            continue
        # A space for a project inside this folder is that project's: picking ~/projects isn't picking it.
        own = str(Path(space["folder"]).resolve()) if space.get("folder") else ""
        if own and own != folder and inside(own, folder):
            continue
        dirs = [space.get("folder") or ""] + [cwd.get(t["terminal"], "")
                                               for tab in space["tabs"] for t in tab["terminals"]]
        if any(d and inside(str(Path(d).resolve()), folder) for d in dirs):
            return herdr("space.select", id=space["id"])
    herdr("space.new", folder=folder)  # unnamed: Herdr names it after the folder or repo


def project():
    dirs = set()
    for root, depth in ((HOME, 1), (HOME / "projects", 1), (HOME / "organizations", 2)):
        for d in range(1, depth + 1):
            dirs.update(str(p) for p in root.glob("*/" * d))
    choice = pick(sorted(d.rstrip("/") for d in dirs), "Herdr project")
    if choice:
        open_dir(choice)


def worktrees(cwd):
    """(primary checkout, [linked worktrees]) for the repo around cwd."""
    blocks = out("git", "-C", cwd, "worktree", "list", "--porcelain").strip().split("\n\n")
    items = []
    for block in blocks:
        info = dict((line.split(" ", 1) + [""])[:2] for line in block.splitlines())
        items.append({"path": info["worktree"], "branch": info.get("branch", "").removeprefix("refs/heads/"),
                      "bare": "bare" in info, "prunable": "prunable" in info})
    if not items or items[0]["bare"]:
        raise RuntimeError("Worktree slots need a non-bare repository checkout.")
    return items[0]["path"], [i for i in items[1:] if not i["prunable"]]


def create(primary, branch):
    branch = branch or f"worktree-{random.randbytes(2).hex()}"
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", branch).strip("-")
    path = HOME / ".herdr/worktrees" / Path(primary).name / slug
    exists = subprocess.run(["git", "-C", primary, "show-ref", "--verify", "--quiet",
                             f"refs/heads/{branch}"]).returncode == 0
    out("git", "-C", primary, "worktree", "add", *([str(path), branch] if exists
                                                    else ["-b", branch, str(path), "HEAD"]))
    return str(path)


def wt(slot):
    primary, linked = worktrees(os.getcwd())
    if slot == "root":
        return open_dir(primary)
    if not STATE.exists():
        STATE.parent.mkdir(parents=True, exist_ok=True)
        STATE.write_text(OLD_STATE.read_text() if OLD_STATE.exists() else "{}")
    # ponytail: no lock; two windows assigning the same slot at once can race.
    state = json.loads(STATE.read_text())
    live = {i["path"] for i in linked}
    slots = {k: v for k, v in state.get(f"{primary}/.git", {}).items() if v in live}
    if slot not in slots:
        free = [i for i in linked if i["path"] not in slots.values()]
        rows = [f"{i['branch'] or Path(i['path']).name}\t{i['path']}" for i in free]
        choice = pick(rows + ["+ Create a new worktree…"], f"Worktree {slot}",
                      "Choose a checkout or create one · Esc cancels")
        if not choice:
            return
        if choice.startswith("+ "):
            slots[slot] = create(primary, input("Branch name [Enter picks one]: ").strip())
        else:
            slots[slot] = choice.split("\t")[1]
        state[f"{primary}/.git"] = slots
        STATE.write_text(json.dumps(state))
    open_dir(slots[slot])


def core(*calls, on=None):
    """Calls on herdr-core's API (hc connect: JSON-RPC lines), after its hello; their results in order."""
    lines = [{"jsonrpc": "2.0", "id": 0, "method": "hello", "params": {}}]
    lines += [{"jsonrpc": "2.0", "id": i + 1, "method": m, "params": {**p, **({"on": on} if on else {})}} for i, (m, p) in enumerate(calls)]
    r = subprocess.run(["hc", "connect"], input="".join(json.dumps(x) + "\n" for x in lines), capture_output=True, text=True, timeout=10)
    replies = {x.get("id"): x for x in (json.loads(line) for line in r.stdout.splitlines() if line.strip())}
    for i in range(1, len(calls) + 1):
        if "error" in replies.get(i, {"error": "no reply"}):
            raise RuntimeError(str(replies.get(i, {}).get("error", "no reply from herdr-core")))
    return [replies[i]["result"] for i in range(1, len(calls) + 1)]


def leaves(node):
    kids = node.get("children") if node.get("type") in ("row", "column") else None
    return sum(map(leaves, kids)) if kids else 1


def even(node):
    """Every pane the same area, as the TUI's equalize: each split's children weighted by how many panes they hold."""
    kids = node.get("children") if node.get("type") in ("row", "column") else None
    if not kids:
        return
    if all("px" not in (k.get("size") or {}) for k in kids):
        total = leaves(node)
        for k in kids:
            k["size"] = {"weight": round(leaves(k) / total, 6)}
    for k in kids:
        even(k)


def equalize(tab):
    """The tab's splits live in herdr-core's "herdr-app" document (no app command resizes panes): rewrite their weights."""
    machine, _, local = tab.rpartition("/")
    for _ in range(3):
        (doc,) = core(("doc.get", {"name": "herdr-app"}), on=machine or None)
        value = doc["value"]
        found = [c for s in value.get("spaces", []) for c in s.get("tabs", []) if c.get("id") == local]
        if not found:
            raise RuntimeError(f"no tab {tab}")
        even(found[0]["root"])
        try:
            core(("doc.set", {"name": "herdr-app", "value": value, "version": doc["version"]}), on=machine or None)
            return
        except RuntimeError as error:
            if "conflict" not in str(error):
                raise
    raise RuntimeError("the layout kept changing; try again")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "equalize":
        try:
            equalize(sys.argv[2])
        except (OSError, RuntimeError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
            print(error, file=sys.stderr)
            sys.exit(1)
        sys.exit(0)
    try:
        if sys.argv[1:] == ["project"]:
            project()
        elif len(sys.argv) == 3 and sys.argv[1] == "wt" and sys.argv[2] in ("root", "1", "2", "3"):
            wt(sys.argv[2])
        else:
            raise ValueError(__doc__.strip().splitlines()[-1])
    except (KeyboardInterrupt, EOFError):
        pass
    except (OSError, RuntimeError, ValueError, KeyError) as error:
        print(f"extras: {error}", file=sys.stderr)
        input("Press Enter to close.")
        sys.exit(1)
