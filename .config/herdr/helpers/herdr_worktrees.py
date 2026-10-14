"""Persistent, repository-local worktree shortcuts for Herdr 0.9.4."""

import os
import subprocess
import sys
import time
from pathlib import Path

from herdr import api_socket_path, context, read_state, request, save_state, slot_lock


def repository():
    pane = context()
    workspace = request("workspace.get", workspace_id=pane["workspace_id"])["workspace"]
    membership = workspace.get("worktree") or {}
    cwd = (membership.get("checkout_path") or pane.get("foreground_cwd")
           or pane.get("cwd"))
    if not cwd:
        raise RuntimeError("Cannot find this workspace's repository directory.")
    # Git lists the primary checkout first, even when invoked in a linked one.
    result = subprocess.run(
        ["git", "-C", cwd, "worktree", "list", "--porcelain", "-z"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10,
    )
    if result.returncode:
        raise RuntimeError(os.fsdecode(result.stderr).strip())
    primary = result.stdout.split(b"\0\0", 1)[0].split(b"\0")
    if not primary or not primary[0].startswith(b"worktree ") or b"bare" in primary:
        raise RuntimeError("Worktree shortcuts require a non-bare repository checkout.")
    root = str(Path(os.fsdecode(primary[0][9:])).resolve())
    return root


def assignments(state, repo_key, worktrees):
    previous = state.get(repo_key, {})
    if not isinstance(previous, dict):
        previous = {}
    live = {item["path"] for item in worktrees
            if item["is_linked_worktree"] and not item["is_prunable"]}
    slots = {key: value for key, value in previous.items()
             if key in ("1", "2", "3") and isinstance(value, str) and value in live}
    state[repo_key] = slots
    return slots


def choose_worktree(slot, worktrees, occupied):
    available = [item for item in worktrees
                 if item["is_linked_worktree"] and not item["is_prunable"]
                 and item["path"] not in occupied]
    rows = []
    for index, item in enumerate(available, start=1):
        label = item.get("branch") or item["label"]
        opened = "open" if item.get("open_workspace_id") else "closed"
        rows.append(f"{index}\t{label}  [{opened}]  {item['path']}")
    rows.append("0\tCreate a new worktree…")
    # Explicit options prevent shell fzf defaults from changing this popup's
    # input/output protocol or opening a second terminal/tmux popup.
    env = dict(os.environ, FZF_DEFAULT_OPTS="", FZF_DEFAULT_OPTS_FILE="")
    result = subprocess.run(
        ["fzf", "--no-height", "--layout=reverse", "--border=none",
         "--delimiter=\t", "--with-nth=2..", "--no-multi",
         f"--prompt=Worktree {slot}> ",
         "--header=Choose a checkout or create one · Esc / Ctrl+C cancel"],
        input="\n".join(rows) + "\n", text=True,
        stdout=subprocess.PIPE, env=env,
    )
    if result.returncode in (1, 130, -2):
        return None
    if result.returncode:
        raise RuntimeError(f"Worktree picker failed (fzf exit {result.returncode}).")
    index = int(result.stdout.split("\t", 1)[0])
    if index:
        return {"path": available[index - 1]["path"]}
    branch = input("Branch name [Enter lets Herdr choose]: ").strip()
    return {"branch": branch} if branch else {}


def switch(slot):
    root = repository()
    if slot == "root":
        listing = request("worktree.list", cwd=root, timeout=30)
        source = listing["source"]
        workspace_id = source.get("source_workspace_id")
        if not workspace_id:
            workspace_id = request("workspace.create", cwd=root, focus=False)["workspace"]["workspace_id"]
        request("workspace.focus", workspace_id=workspace_id)
        return

    state_file = Path(api_socket_path()).parent / "worktree-slots.json"
    with slot_lock(name="worktree-slots", deadline=time.monotonic() + 5):
        listing = request("worktree.list", cwd=root, timeout=30)
        source = listing["source"]
        state = read_state(state_file)
        slots = assignments(state, source["repo_key"], listing["worktrees"])
        target = slots.get(slot)
        occupied = set(slots.values())
        save_state(state_file, state)

    choice = {"path": target} if target else choose_worktree(slot, listing["worktrees"], occupied)
    if choice is None:
        return

    # Never hold the assignment lock while the user is choosing or typing.
    with slot_lock(name="worktree-slots", deadline=time.monotonic() + 5):
        listing = request("worktree.list", cwd=root, timeout=30)
        state = read_state(state_file)
        slots = assignments(state, source["repo_key"], listing["worktrees"])
        if slot in slots:
            choice = {"path": slots[slot]}
        elif choice.get("path") in slots.values():
            raise RuntimeError("That checkout was assigned to another slot. Try again.")
        creating = "path" not in choice
        print("Creating worktree…" if creating else "Opening worktree…", flush=True)
        result = request("worktree.create" if creating else "worktree.open",
                         cwd=root, focus=False, timeout=60, **choice)
        slots[slot] = result["worktree"]["path"]
        # Persist before focusing: changing workspaces may dismiss this popup.
        save_state(state_file, state)
    request("workspace.focus", workspace_id=result["workspace"]["workspace_id"])


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2 or sys.argv[1] not in ("root", "1", "2", "3"):
            raise ValueError("Usage: herdr_worktrees.py root|1|2|3")
        switch(sys.argv[1])
    except (KeyboardInterrupt, EOFError):
        pass
    except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired) as error:
        print(f"Herdr worktree: {error}", file=sys.stderr)
        if sys.stdin.isatty():
            try:
                input("Press Enter to close.")
            except (KeyboardInterrupt, EOFError):
                pass
        sys.exit(1)
