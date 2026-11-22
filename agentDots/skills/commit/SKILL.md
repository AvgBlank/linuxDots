---
name: commit
description: Commit reviewed changes, staging relevant repository files first when the index is empty.
disable-model-invocation: true
---

# Commit reviewed changes

1. Find the repository root and read any commit instructions it has (`GEMINI.md`, `AGENTS.md`, `CLAUDE.md`, contributing docs). Inspect `git status --short`, the full `git diff --cached`, and unstaged changes.
2. If the index is empty, follow `/add` to stage the relevant changes, then review the full staged diff. If `/add` stages nothing or reports ambiguity or a safety concern, stop without committing. If the index already has staged changes, commit only those and don't run `/add`.
3. Confirm every staged path and hunk belongs in this commit. Check for secrets, local-only or generated files, and unrelated changes, and run `git diff --cached --check` for whitespace errors. If something doesn't belong or looks unsafe, stop and explain, leaving the index and working tree as they are.
4. Run the lint, test, and type-check commands the repository supports (from its instructions, CI config, and project scripts). Skip kinds it doesn't have. If a required check fails or can't run, stop without committing and say why.
5. Write the subject as `type(scope): summary`, with a type such as `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, or `chore`, a short scope, and a specific, imperative summary. Follow the repository's subject conventions if it has them.
6. Write the body as concise bullet points (`- ...`), one per change in this commit, even when the repository's history uses prose. If you can't tell the scope or intent from the repository and the diff, ask before committing.
7. Commit with the message in a quoted heredoc, written with no leading indentation:

```sh
git commit -F - <<'EOF'
fix(auth): prevent repeated-click crash

- Added debouncing to the login click handler
- Fixed a race condition in auth state
EOF
```

8. Don't amend, rewrite history, push, or bypass a failing hook. If Git identity or a hook blocks the commit, stop and report the exact error.
9. Report the commit hash, subject and body, and what's left in the working tree.
