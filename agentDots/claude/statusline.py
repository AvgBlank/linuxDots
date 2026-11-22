#!/usr/bin/env python3
# Claude Code status line. Reads session JSON on stdin, prints two rows:
#   1: folder · branch* · PR · session name
#   2: model effort · ctx % · 5h limit · cache
# Empty segments are dropped; segments past the terminal width drop from the right.
import json, os, re, subprocess, sys, tempfile, time
from datetime import datetime

d = json.load(sys.stdin)


def g(*keys):  # safe nested lookup: g("a", "b") -> d["a"]["b"] or None
    obj = d
    for k in keys:
        if not isinstance(obj, dict):
            return None
        obj = obj.get(k)
    return obj


# tokyonight palette, truecolor
def c(hexcode, text):
    r, gr, b = (int(hexcode[i:i + 2], 16) for i in (1, 3, 5))
    return f"\033[38;2;{r};{gr};{b}m{text}\033[0m"

BLUE, CYAN, GREEN, YELLOW, RED, MAGENTA, ORANGE, DIM = (
    "#7aa2f7", "#7dcfff", "#9ece6a", "#e0af68", "#f7768e", "#bb9af7", "#ff9e64", "#565f89")
SEP = c(DIM, " · ")


def level(pct):  # green / yellow / red by threshold
    return RED if pct >= 90 else YELLOW if pct >= 70 else GREEN


def git_info(cwd):
    # ponytail: 5s file cache per session, same as the docs example; drop it if git is never slow
    cache = os.path.join(tempfile.gettempdir(), f"cc-statusline-git-{g('session_id')}")
    try:
        if time.time() - os.path.getmtime(cache) < 5:
            with open(cache) as f:
                saved_cwd, branch, dirty = f.read().split("\n")[:3]
            if saved_cwd == cwd:
                return branch, dirty == "1"
    except (OSError, ValueError):
        pass
    run = lambda *a: subprocess.run(["git", "-C", cwd, *a], capture_output=True, text=True, timeout=2).stdout.strip()
    try:
        branch = run("branch", "--show-current") or run("rev-parse", "--short", "HEAD")
        dirty = bool(branch and run("status", "--porcelain"))
    except (OSError, subprocess.TimeoutExpired):
        branch, dirty = "", False
    try:
        with open(cache, "w") as f:
            f.write(f"{cwd}\n{branch}\n{int(dirty)}")
    except OSError:
        pass
    return branch, dirty


def fit(parts):
    # drop trailing segments until the row fits, so it never wraps
    width = int(os.environ.get("COLUMNS") or 120) - 4
    while len(parts) > 1 and len(re.sub(r"\033\[[0-9;]*m", "", SEP.join(parts))) > width:
        parts.pop()
    return SEP.join(parts)


# ── row 1: where you are ──
cwd = g("workspace", "current_dir") or g("cwd") or ""
top = [c(BLUE, os.path.basename(cwd) or cwd)] if cwd else []

branch, dirty = git_info(cwd) if cwd else ("", False)
if branch:
    top.append(c(MAGENTA, branch) + (c(ORANGE, "*") if dirty else ""))

if g("pr", "number"):
    state = g("pr", "review_state")
    color = {"approved": GREEN, "changes_requested": RED, "pending": YELLOW}.get(state, DIM)
    label = {"changes_requested": "changes"}.get(state, state or "")
    top.append(c(CYAN, f"{'MR' if g('pr', 'kind') == 'mr' else 'PR'} {g('pr', 'number')}")
               + (" " + c(color, label) if label else ""))

name = g("session_name")
if name:
    top.append(c(DIM, name if len(name) <= 30 else name[:29] + "…"))

# ── row 2: model and usage, most important first ──
model = c(CYAN, g("model", "display_name") or g("model", "id") or "?")
if g("effort", "level"):
    model += " " + c(DIM, g("effort", "level"))
if g("fast_mode"):
    model += " " + c(ORANGE, "fast")
bottom = [model]

pct = g("context_window", "used_percentage")
if pct is not None:
    bottom.append(c(DIM, "ctx ") + c(level(pct), f"{pct:.0f}%"))

five = g("rate_limits", "five_hour", "used_percentage")
if five is not None:
    seg = c(DIM, "5h ") + c(level(five), f"{five:.0f}%")
    reset = g("rate_limits", "five_hour", "resets_at")
    if reset:
        seg += c(DIM, " " + datetime.fromtimestamp(reset).strftime("%-I:%M%p").lower())
    bottom.append(seg)

if g("prompt_cache", "caching_observed"):
    hit = g("prompt_cache", "hit_ratio")
    if not g("prompt_cache", "warm"):
        bottom.append(c(DIM, "cache ") + c(YELLOW, "cold"))
    elif hit is not None:
        bottom.append(c(DIM, "cache ") + c(GREEN, f"{hit * 100:.0f}%"))

print(fit(top))
print(fit(bottom))
