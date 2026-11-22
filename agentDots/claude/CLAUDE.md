# About the user

- Name: Husain Khorakiwala — call them **Husain**

# Writing

- Always apply the `unslop` skill (`~/.claude/skills/unslop/`) to any prose you generate: chat replies, docs, READMEs, commit messages, PR descriptions, emails, posts. Invoke it via the Skill tool before writing, or before handing back drafted text, and follow its core contract (`references/core-contract.md`) and taboo phrase list (`references/taboo-phrases.md`). Default preset: `crisp` (`presets/crisp-human.md`).
- This includes generated output and reports: anything another skill, command, or workflow produces (REVIEW.md, VERIFICATION.md, SUMMARY.md, audit reports, planning docs), artifacts and Claude Docs, and summaries of subagent results. Run unslop on that prose before saving, publishing, or relaying it.
- Important writing that goes out under Husain's name (reports, project docs, READMEs, commit messages and PR descriptions on shared repos, emails): write it in his taught voice with `/unslop mimic`, using the card at `~/.unslop/voice/husain/` (`card.md` plus the matching `card/<situation>.md` sheet), and run the full mimic flow including the gates and `voice_score.py`. Don't copy his typos or swearing. If it's unclear whether something counts as important, ask.
- Everything else (chat replies, scratch notes, routine commits, summaries): use the `crisp` preset.
- When spawning a subagent that writes prose, tell it in the brief to apply the `unslop` skill to its output.
- Code, identifiers, and quoted or user-supplied text are exempt; don't rewrite those.

# Git

- Always use the `/commit` skill (`~/.claude/skills/commit/SKILL.md`) to create a commit. It has `disable-model-invocation: true`, so when Husain hasn't typed `/commit`, read that file and follow its steps exactly.
- Never `git push` (or force-push, or push tags) unless Husain explicitly authorizes that specific push. Approval for one push doesn't carry over to the next.

# Packages

- Husain installs CLI packages with nanobrew (`nb`), which shares the Homebrew prefix: `/opt/homebrew` is a symlink to `/opt/nanobrew/prefix`. Homebrew marks nanobrew's kegs `installed_on_request = false`, so it treats them all as unneeded dependencies.
- Never run or suggest `brew uninstall`, `brew remove`, `brew autoremove` or `brew cleanup`. Any of them can auto-remove every nanobrew package. On 2026-11-14 a suggested `brew uninstall batt` deleted 111 packages, including neovim, tmux and starship.
- Before running or suggesting any package command, check which tool installed the package (`nb list --names`, or `installed_on_request` in the keg's `INSTALL_RECEIPT.json`) and use that tool. For nanobrew packages that means `nb install` and `nb remove`.
- More generally, before handing Husain a command that changes system state, check what it does on this machine and tell him its side effects. Don't assume a stock setup.

## Safe `brew install`

Homebrew 7.x runs `brew cleanup` after `brew install`, and cleanup calls autoremove by default, which would delete every nanobrew keg. Use brew only when nanobrew can't handle it (for example, nb fails on taps whose release asset is a bare binary, not a tarball: `tar: Unrecognized archive format`; `deepnoodle-ai/tap/mobius` was installed via brew for this reason). When you do, always run it as:

`HOMEBREW_NO_INSTALL_CLEANUP=1 HOMEBREW_NO_AUTOREMOVE=1 HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_UPGRADE=1 HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1 brew install ...`

# Documentation

- Use the `context7` MCP (`resolve-library-id`, then `query-docs`) whenever you need up-to-date library or framework docs, API references, or setup and config details — don't wait for Husain to ask.
