"""Provider-neutral helpers that turn tool calls into short activity entries.

Shell commands are not interpreted: an entry records the command, cleaned of
noise, and whether it succeeded. The Activity panel's verb table (layout
props) names commands. Output text is never stored, and credentials are
redacted (`common.redact`).
"""
import os
import re

from .common import MAX_DETAIL, MAX_TEXT, redact, short


def entry(kind, label="", **extra):
    """An activity step. Its label and detail are bounded and redacted."""
    result = {"kind": kind}
    label = short(redact(label[:MAX_TEXT]), 120) if isinstance(label, str) else ""
    if label:
        result["label"] = label
    if isinstance(extra.get("detail"), str):
        extra["detail"] = redact(extra["detail"][:MAX_TEXT])[:MAX_DETAIL]
    result.update({key: value for key, value in extra.items() if value not in (None, "", [], 0)})
    return result


def relative(path, cwd=""):
    """A display path: relative to the session folder, or with `~` for home."""
    if not isinstance(path, str) or not path:
        return ""
    if cwd and (path == cwd or path.startswith(cwd.rstrip("/") + "/")):
        path = path[len(cwd.rstrip("/")) + 1:] or "."
    else:
        home = os.path.expanduser("~")
        if path.startswith(home + "/"):
            path = "~" + path[len(home):]
    return short(path, 200)


# ---------------------------------------------------------------- shell commands

# A variable's value: quoted, a `$(…)` without nested parentheses, or plain characters.
VALUE = r"""(?:"[^"]*"|'[^']*'|\$\([^()]*\)|[^\s;&|"'()])*"""
# `cd x &&`, `export A=b;` and `f=$(ls -t | head -1);` in front of the command that does the work.
LEADING = re.compile(r"""^(?:(?:cd|pushd|export|source|\.)\s+(?:"[^"]*"|'[^']*'|[^;&|"'])*?"""
                     r"""|[A-Za-z_]\w*=""" + VALUE + r""")\s*(?:&&|;)\s*""")
# `A=b`, `timeout 30`, `env`, `time`, `nohup` before a program.
WRAPPER = re.compile(r"""^(?:[A-Za-z_]\w*=""" + VALUE + r"""\s+|g?timeout\s+(?:-\S+\s+)*\S+\s+"""
                     r"""|(?:env|time|nohup|command)\s+)""")
# `/usr/bin/git` is shown, and matched by the verb table, as `git`.
SYSTEM_BIN = re.compile(r"^(?:/usr/local|/opt/homebrew|/usr|)/s?bin/(?=[\w.-]+(?:\s|$))")


def clean_command(command):
    """The first line of a command without the setup in front of it."""
    if not isinstance(command, str):
        return ""
    line = next((line.strip() for line in command.splitlines() if line.strip()), "")
    while True:
        shorter = SYSTEM_BIN.sub("", WRAPPER.sub("", LEADING.sub("", line, 1), 1).strip())
        if shorter == line or not shorter:
            return line
        line = shorter


def shell_entry(command, result=None):
    """A `run` entry. `result` is ok, failed, interrupted, started, or None.

    `label` is what the panel shows and matches against its verb table.
    `detail` is the full command when it says more than the label.
    """
    command = redact(command[:MAX_TEXT]) if isinstance(command, str) else ""
    label = short(clean_command(command), 120)
    if not label:
        return None
    detail = command.strip() if command.strip() != label else None
    return entry("run", label, result=result, detail=detail)


# ---------------------------------------------------------------- patches

def patch_files(text, cwd=""):
    """Files and line counts from an apply_patch body."""
    if not isinstance(text, str):
        return []
    if "\n" not in text and "\\n" in text:
        text = text.replace("\\n", "\n")  # An escaped one-line body; keeps non-ASCII paths.
    files, current = [], None
    for line in text.splitlines():
        header = re.match(r"^\*\*\* (Add|Update|Delete) File: (.+)$", line)
        if header:
            op = {"Add": "created", "Update": "modified", "Delete": "deleted"}[header.group(1)]
            current = [relative(header.group(2).strip(), cwd), 0, 0, op]
            files.append(current)
        elif line.startswith("*** Move to: ") and current:
            current[0] = relative(line[13:].strip(), cwd)
        elif current and line.startswith("+") and not line.startswith("+++"):
            current[1] += 1
        elif current and line.startswith("-") and not line.startswith("---"):
            current[2] += 1
    return files


def hunk_counts(patch):
    """Added and removed lines from a list of unified-diff hunks."""
    added = removed = 0
    for hunk in patch if isinstance(patch, list) else []:
        for line in hunk.get("lines", []) if isinstance(hunk, dict) else []:
            if isinstance(line, str) and line.startswith("+"):
                added += 1
            elif isinstance(line, str) and line.startswith("-"):
                removed += 1
    return added, removed


# ---------------------------------------------------------------- code mode

def js_string(code, start):
    """Read a JavaScript string literal that starts at `start`. Return (text, end)."""
    quote, index, out = code[start], start + 1, []
    while index < len(code):
        char = code[index]
        if char == "\\" and index + 1 < len(code):
            nxt = code[index + 1]
            out.append({"n": "\n", "t": "\t", "r": "", "\\": "\\", quote: quote}.get(nxt, nxt))
            index += 2
            continue
        if char == quote:
            return "".join(out), index + 1
        if quote == "`" and char == "$" and code[index + 1:index + 2] == "{":
            index, depth = index + 1, 0  # Count braces from the `{`.
            while index < len(code):
                depth += {"{": 1, "}": -1}.get(code[index], 0)
                index += 1
                if depth == 0:
                    break
            out.append("…")
            continue
        out.append(char)
        index += 1
    return "".join(out), index


def code_mode_calls(code):
    """Nested tool calls in a code-mode script: [(tool, argument text)]."""
    calls = []
    if not isinstance(code, str):
        return calls
    matches = list(re.finditer(r"\btools\.([A-Za-z_][\w]*)\s*\(", code))
    for at, match in enumerate(matches):
        # Only this call's arguments: up to the next `tools.` call.
        end = matches[at + 1].start() if at + 1 < len(matches) else len(code)
        tool, rest = match.group(1), code[match.end():min(end, match.end() + 20000)]
        if tool == "exec_command":
            found = re.search(r"\bcmd\s*:\s*([\"'`])", rest)
            if found:
                calls.append((tool, js_string(rest, found.start(1))[0]))
        elif tool == "apply_patch":
            found = re.search(r"([\"'`])\s*\*\*\* Begin Patch", rest)
            if found:
                calls.append((tool, js_string(rest, found.start(1))[0]))
        else:
            calls.append((tool, ""))
    return calls
