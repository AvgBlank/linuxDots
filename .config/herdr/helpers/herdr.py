"""Project switching and tmux-style shortcuts for Herdr 0.9.4."""

import errno
import fcntl
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path

def api_socket_path():
    config_home = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    session = os.environ.get("HERDR_SESSION") or "default"
    directory = config_home / "herdr"
    if session != "default":
        directory = directory / "sessions" / session
    return os.environ.get("HERDR_SOCKET_PATH", str(directory / "herdr.sock"))


def request(method, *, timeout=5, deadline=None, **params):
    expires = time.monotonic() + timeout
    if deadline is not None:
        expires = min(expires, deadline)

    def remaining():
        seconds = expires - time.monotonic()
        if seconds <= 0:
            raise TimeoutError(f"Herdr request timed out: {method}")
        return seconds

    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(remaining())
        connection.connect(api_socket_path())
        connection.settimeout(remaining())
        connection.sendall(
            (
                json.dumps({"id": "dotfiles", "method": method, "params": params})
                + "\n"
            ).encode()
        )
        chunks = []
        while True:
            connection.settimeout(remaining())
            chunk = connection.recv(65536)
            if not chunk:
                raise RuntimeError("Herdr closed the socket before sending a response.")
            chunks.append(chunk)
            if b"\n" in chunk:
                break
        reply = json.loads(b"".join(chunks).split(b"\n", 1)[0])
    if "error" in reply:
        raise RuntimeError(reply["error"].get("message", str(reply["error"])))
    return reply["result"]


def context():
    # Shortcut commands inherit ACTIVE_*; ordinary pane processes inherit PANE_ID.
    pane_id = os.environ.get("HERDR_ACTIVE_PANE_ID") or os.environ.get("HERDR_PANE_ID")
    if not pane_id:
        raise RuntimeError("This shortcut requires a Herdr pane.")
    return request("pane.get", pane_id=pane_id)["pane"]


def forward_to_editor(pane, key):
    info = request("pane.process_info", pane_id=pane["pane_id"])["process_info"]
    pattern = r"g?\.?(?:view|l?n?vim?x?|fzf)(?:diff)?(?:-wrapped)?"
    if any(
        re.fullmatch(pattern, Path(process["name"]).name)
        for process in info.get("foreground_processes", [])
    ):
        request("pane.send_keys", pane_id=pane["pane_id"], keys=[key])
        return True
    return False


def project(directory):
    directory = Path(directory).expanduser().resolve(strict=True)
    if not directory.is_dir():
        raise RuntimeError(f"Not a directory: {directory}")
    inside = os.environ.get("HERDR_ENV") == "1"
    try:
        workspaces = request("workspace.list")["workspaces"]
    except OSError as error:
        if inside or error.errno not in (errno.ENOENT, errno.ECONNREFUSED):
            raise
        # Starting the picker outside Herdr also starts its persistent server.
        server = subprocess.Popen(
            ["herdr", "server"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        for _ in range(100):
            try:
                workspaces = request("workspace.list")["workspaces"]
                break
            except (FileNotFoundError, ConnectionRefusedError):
                if server.poll() is not None:
                    raise RuntimeError(
                        "Herdr server failed to start; run herdr to inspect the error."
                    )
                time.sleep(0.05)
        else:
            raise RuntimeError(
                "Timed out starting Herdr; run herdr to inspect the server."
            )

    # Two attached clients can select the same project at once. Refresh the
    # workspace list under a shared lock before deciding whether to create it.
    with slot_lock(name="projects", deadline=time.monotonic() + 5):
        focus_project(directory)
    if not inside:
        os.execvp("herdr", ["herdr"])


def focus_project(directory):
    workspaces = request("workspace.list")["workspaces"]
    # Herdr truncates metadata values to 80 characters; the digest always fits.
    project_id = hashlib.sha256(os.fsencode(directory)).hexdigest()
    workspace = next(
        (
            item
            for item in workspaces
            if item.get("tokens", {}).get("dotfiles_project_id") == project_id
            or item.get("tokens", {}).get("dotfiles_project") == str(directory)
        ),
        None,
    )
    if workspace is None:
        # Adopt workspaces that were created manually for this directory.
        for item in workspaces:
            tokens = item.get("tokens", {})
            if tokens.get("dotfiles_project_id"):
                continue
            legacy_path = tokens.get("dotfiles_project")
            if legacy_path and legacy_path != str(directory)[:80]:
                continue
            panes = request("pane.list", workspace_id=item["workspace_id"])["panes"]
            if any(
                pane.get("cwd") and Path(pane["cwd"]).resolve() == directory
                for pane in panes
            ):
                workspace = item
                break
    if workspace is None:
        workspace = request(
            "workspace.create",
            cwd=str(directory),
            label=(directory.name or str(directory)).replace(".", "_"),
            focus=False,
        )["workspace"]
    workspace_id = workspace["workspace_id"]
    request(
        "workspace.report_metadata",
        workspace_id=workspace_id,
        source="dotfiles",
        tokens={"dotfiles_project_id": project_id, "dotfiles_project": None},
    )
    request("workspace.focus", workspace_id=workspace_id)


def read_state(path):
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except (FileNotFoundError, ValueError):
        return {}


@contextmanager
def slot_lock(*, deadline=None, name="tab-slots"):
    # Status updates and shortcuts share this lock so concurrent invocations
    # cannot assign the same slot or prune a tab another invocation just made.
    path = Path(api_socket_path()).parent / f"{name}.lock"
    with path.open("a") as lock:
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if deadline is not None and time.monotonic() >= deadline:
                    raise TimeoutError(f"Timed out waiting for Herdr {name}.")
                time.sleep(0.01)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def sync_slots(tabs, workspace_ids):
    """Reconcile live tabs while holding slot_lock; retain holes after closes."""
    path = Path(api_socket_path()).parent / "tab-slots.json"
    state = read_state(path)
    changed = False
    for workspace_id in workspace_ids:
        workspace_tabs = [tab for tab in tabs if tab["workspace_id"] == workspace_id]
        previous = state.get(workspace_id, {})
        if not isinstance(previous, dict):
            previous = {}
        slots = {}
        for tab in workspace_tabs:
            number = previous.get(tab["tab_id"])
            if type(number) is int and number > 0 and number not in slots.values():
                slots[tab["tab_id"]] = number
        for tab in workspace_tabs:
            if tab["tab_id"] not in slots:
                number = 1
                while number in slots.values():
                    number += 1
                slots[tab["tab_id"]] = number
        if state.get(workspace_id) != slots:
            state[workspace_id] = slots
            changed = True
    if changed:
        save_state(path, state)
    return state


def order_tabs(tabs, slots):
    # Insert from left to right; all moved tabs come from a later position.
    ordered = sorted(tabs, key=lambda tab: slots[tab["tab_id"]])
    current = list(tabs)
    for index, target in enumerate(ordered):
        source = next(i for i, tab in enumerate(current)
                      if tab["tab_id"] == target["tab_id"])
        if source != index:
            request("tab.move", tab_id=target["tab_id"], insert_index=index)
            current.insert(index, current.pop(source))


def tab(number=None, *, create=True, move=None):
    pane = context()
    workspace_id = pane["workspace_id"]
    with slot_lock(deadline=time.monotonic() + 5):
        tabs = request("tab.list", workspace_id=workspace_id)["tabs"]
        state = sync_slots(tabs, [workspace_id])
        slots = state[workspace_id]
        if move is not None:
            layout = request("pane.layout", pane_id=pane["pane_id"])["layout"]
            tab_id = layout["tab_id"]
            old = slots[tab_id]
            number = old + move
            if number < 1:
                return
            for other_id, slot in list(slots.items()):
                if slot == number:
                    slots[other_id] = old
            slots[tab_id] = number
            save_state(Path(api_socket_path()).parent / "tab-slots.json", state)
            order_tabs(tabs, slots)
            return
        if number is None:
            number = 1
            while number in slots.values():
                number += 1
        target = next((tab for tab in tabs if slots[tab["tab_id"]] == number), None)
        if target is None:
            if not create:
                return
            cwd = pane.get("foreground_cwd") or pane.get("cwd") or str(Path.home())
            target = request("tab.create", workspace_id=workspace_id, cwd=cwd,
                             label=str(number), focus=False)["tab"]
            tabs.append(target)
            slots[target["tab_id"]] = number
            save_state(Path(api_socket_path()).parent / "tab-slots.json", state)
        order_tabs(tabs, slots)
        request("tab.focus", tab_id=target["tab_id"])


def ordered_workspaces(workspaces):
    """Match Herdr's expanded sidebar order, grouping children with parents."""
    groups = {}
    for workspace in workspaces:
        membership = workspace.get("worktree")
        if membership:
            groups.setdefault(membership["repo_key"], []).append(workspace)
    groups = {
        key: members for key, members in groups.items()
        if any(item["worktree"]["is_linked_worktree"] for item in members)
        and any(not item["worktree"]["is_linked_worktree"] for item in members)
    }
    ordered = []
    emitted = set()
    for workspace in workspaces:
        key = (workspace.get("worktree") or {}).get("repo_key")
        if key not in groups:
            ordered.append(workspace)
        elif key not in emitted:
            emitted.add(key)
            ordered.extend(sorted(groups[key], key=lambda item: item["worktree"]["is_linked_worktree"]))
    return ordered


def workspace(number):
    if not 1 <= number <= 9:
        raise ValueError("Workspace number must be between 1 and 9.")
    workspaces = ordered_workspaces(request("workspace.list")["workspaces"])
    if number <= len(workspaces):
        request("workspace.focus", workspace_id=workspaces[number - 1]["workspace_id"])


def number_workspaces(*, deadline):
    # Remember generated prefixes so manual names, including names beginning
    # with numbers, survive renumbering without accumulating prefixes.
    path = Path(api_socket_path()).parent / "workspace-labels.json"
    with slot_lock(name="workspace-labels", deadline=deadline):
        # Read labels under the lock: another client's status update may have
        # renamed them after our session snapshot was taken.
        expires = min(deadline, time.monotonic() + 0.35)
        workspaces = request("workspace.list", timeout=0.15, deadline=expires)["workspaces"]
        previous = read_state(path)
        state = {}
        labels = {}
        pending = []
        for number, item in enumerate(ordered_workspaces(workspaces), start=1):
            workspace_id = item["workspace_id"]
            tracked = previous.get(workspace_id, {})
            if not isinstance(tracked, dict):
                tracked = {}
            name = item["label"]
            if name in tracked.get("labels", []) and isinstance(tracked.get("name"), str):
                name = tracked["name"]
            label = f"{number}: {name}"
            labels[workspace_id] = label
            generated = [label] if item["label"] == label else [item["label"], label]
            state[workspace_id] = {"name": name, "labels": generated}
            if item["label"] != label:
                pending.append((workspace_id, label))
        last = previous.get("__last_workspace__")
        for index, (workspace_id, _) in enumerate(pending):
            if workspace_id == last:
                pending = pending[index + 1:] + pending[:index + 1]
                break
        if last in labels:
            state["__last_workspace__"] = last
        # Give tab process names most of the status update's API budget.
        for workspace_id, label in pending:
            if time.monotonic() >= expires:
                break
            state["__last_workspace__"] = workspace_id
            save_state(path, state)
            try:
                request("workspace.rename", workspace_id=workspace_id, label=label,
                        timeout=0.1, deadline=expires)
                state[workspace_id]["labels"] = [label]
            except (OSError, RuntimeError):
                continue
        if state != previous:
            save_state(path, state)
    return labels


def equalize_layout(node, path=()):
    """Return each split path and ratio needed to give all leaves equal area."""
    if node["type"] == "pane":
        return 1, []
    first_count, first_splits = equalize_layout(node["first"], path + (False,))
    second_count, second_splits = equalize_layout(node["second"], path + (True,))
    ratio = first_count / (first_count + second_count)
    splits = [(path, min(0.9, max(0.1, ratio)))]
    splits.extend(first_splits)
    splits.extend(second_splits)
    return first_count + second_count, splits


def equalize():
    pane = context()
    layout = request("layout.export", pane_id=pane["pane_id"])["layout"]
    _, splits = equalize_layout(layout["root"])
    for path, ratio in splits:
        request("layout.set_split_ratio", tab_id=layout["tab_id"],
                path=list(path), ratio=ratio)


def shortcut(action, argument, key=None):
    pane = context()
    if key and forward_to_editor(pane, key):
        return
    if action == "navigate":
        request("pane.focus_direction", pane_id=pane["pane_id"], direction=argument)
    elif action == "pane":
        layout = request("pane.layout", pane_id=pane["pane_id"])["layout"]
        panes = layout["panes"]
        index = int(argument) - 1
        if index < len(panes):
            request("pane.focus", pane_id=panes[index]["pane_id"])


def process_name(pane, *, deadline=None):
    info = request("pane.process_info", pane_id=pane["pane_id"],
                   timeout=0.2 if deadline is not None else 5,
                   deadline=deadline)["process_info"]
    processes = info.get("foreground_processes", [])
    foreground = [item for item in processes if item["pid"] != info.get("shell_pid")]
    process = next(iter(foreground or processes), None)
    if process:
        return Path(process["name"]).name
    return pane.get("agent") or Path(os.environ.get("SHELL", "zsh")).name


def save_state(state_file, state):
    temporary = state_file.with_suffix(".tmp")
    temporary.write_text(json.dumps(state))
    temporary.replace(state_file)


def status():
    # Leave time for Python startup, state writes, and printing before Herdr's
    # two-second command timeout. Each pane gets at most 200 ms of this budget.
    deadline = time.monotonic() + 1.25
    try:
        # Multiple attached clients run status commands independently. Protect
        # both snapshots and generated tab labels from overlapping updates.
        with slot_lock(name="status", deadline=time.monotonic() + 0.05):
            update_status(deadline)
    except TimeoutError:
        # Another client can do the renaming. Still return this client's label
        # without waiting past Herdr's two-second command timeout.
        workspace_id = os.environ.get("HERDR_ACTIVE_WORKSPACE_ID")
        if workspace_id:
            item = request("workspace.get", workspace_id=workspace_id,
                           timeout=0.2)["workspace"]
            print(f"[{item['label']}]")


def update_status(deadline):
    with slot_lock(deadline=deadline):
        snapshot = request("session.snapshot", timeout=0.25, deadline=deadline)["snapshot"]
        slots = sync_slots(snapshot["tabs"],
                           [workspace["workspace_id"] for workspace in snapshot["workspaces"]])
    workspace_id = os.environ.get("HERDR_ACTIVE_WORKSPACE_ID")
    try:
        workspace_labels = number_workspaces(deadline=deadline)
    except (OSError, RuntimeError):
        # A slow workspace request must not hide the status or stop tab naming.
        workspace_labels = {}
    panes = {pane["pane_id"]: pane for pane in snapshot["panes"]}
    focused_panes = {
        layout["tab_id"]: layout["focused_pane_id"] for layout in snapshot["layouts"]
    }
    # Keep generated names separate from user labels, scoped to this server.
    state_file = Path(api_socket_path()).parent / "auto-tab-labels.json"
    previous = read_state(state_file)
    live_tabs = {tab["tab_id"] for tab in snapshot["tabs"]}
    updated = {key: value for key, value in previous.items() if key in live_tabs}
    candidates = []
    for workspace in snapshot["workspaces"]:
        tabs = [
            tab
            for tab in snapshot["tabs"]
            if tab["workspace_id"] == workspace["workspace_id"]
        ]
        candidates.extend(enumerate(tabs, start=1))
    # Resume after the last attempted tab so slow tabs cannot starve later tabs.
    last = previous.get("__last_tab__")
    for index, (_, tab) in enumerate(candidates):
        if tab["tab_id"] == last:
            candidates = candidates[index + 1:] + candidates[:index + 1]
            break
    if last in live_tabs:
        updated["__last_tab__"] = last
    for position, tab in candidates:
        if time.monotonic() >= deadline:
            break
        tab_id = tab["tab_id"]
        updated["__last_tab__"] = tab_id
        pane = panes.get(focused_panes.get(tab_id))
        if not pane:
            continue
        # A label changed by the user stops automatic naming for this tab.
        tracked = previous.get(tab_id, [])
        if isinstance(tracked, str):
            tracked = [tracked]
        if not isinstance(tracked, list):
            tracked = []
        number = slots[tab["workspace_id"]][tab_id]
        # Numeric default labels use tab position, not the stable API number.
        automatic = tab["label"] in tracked or tab["label"] in (str(position), str(number))
        if not automatic:
            updated.pop(tab_id, None)
            continue
        try:
            name = f"{number}: {process_name(pane, deadline=deadline)}"
            if tab["label"] != name:
                # Record both sides before renaming. A timeout or another pane
                # disappearing must not make our generated label look manual.
                updated[tab_id] = [tab["label"], name]
                save_state(state_file, updated)
                request("tab.rename", tab_id=tab_id, label=name,
                        timeout=0.2, deadline=deadline)
            updated[tab_id] = [name]
        except (OSError, RuntimeError):
            # Slow or exiting panes are skipped without losing the status label.
            continue
    if updated != previous:
        save_state(state_file, updated)

    workspace = next(
        (
            item
            for item in snapshot["workspaces"]
            if item["workspace_id"] == workspace_id
        ),
        None,
    )
    if workspace:
        print(f"[{workspace_labels.get(workspace['workspace_id'], workspace['label'])}]")


def main():
    action, *args = sys.argv[1:]
    if action == "project":
        project(args[0])
    elif action == "tab":
        number = int(args[0])
        if not 1 <= number <= 9:
            raise ValueError("Tab number must be between 1 and 9.")
        tab(number)
    elif action == "select-tab":
        tab(int(args[0]), create=False)
    elif action == "new-tab":
        tab()
    elif action == "move-tab":
        tab(move={"left": -1, "right": 1}[args[0]])
    elif action == "workspace":
        workspace(int(args[0]))
    elif action == "equalize":
        equalize()
    elif action in ("navigate", "pane"):
        shortcut(action, *args)
    elif action == "status":
        status()
    else:
        raise ValueError(f"Unknown action: {action}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, ValueError, KeyError, IndexError) as error:
        print(f"herdrthing: {error}", file=sys.stderr)
        sys.exit(1)
