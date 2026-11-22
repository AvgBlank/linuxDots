---
name: add
description: Use when repository changes need safe staging, including before a commit when the index is empty.
---

# Stage repository changes

Stage only changes that belong in the requested repository commit. Never stage every change blindly.

1. Find repository root. Read its staging rules (`GEMINI.md`, `CLAUDE.md`, `AGENTS.md`, contributing docs). Inspect `git status --short --untracked-files=all`, tracked diffs, and existing staged paths.
2. Review each candidate path and its diff or contents. Check project ignore rules and generation conventions when they apply.
3. Stage only safe, relevant paths with explicit path arguments, such as `git add -- path/to/file`. When only some hunks of a file belong, write just those hunks to a patch file and stage it with `git apply --cached <patch>`; don't use `git add -p` or other interactive commands. For deletions, stage the exact deleted path.
4. Inspect the staged diff and status. Confirm the index contains only intended repository changes. Report staged paths and any excluded or ambiguous paths.

Exclude credentials, private keys, tokens, `.env` files, local machine settings, logs, dumps, caches, dependency folders, build output, and generated artifacts the repository does not commit. Safe templates such as `.env.example` may be staged after checking they contain no real secrets. Treat filenames and contents as evidence; do not assume every unignored file belongs in a commit.

Preserve changes already staged by the user. Do not reset, unstage, commit, or push. If a candidate may contain secrets, has unclear purpose, or cannot be reviewed safely, leave it unstaged and ask the user.
