# agentDots

Reproducible setup for **Claude Code** (`~/.claude`) and **Antigravity** (`~/.gemini`), tracked inside the public `AvgBlank/linuxDots` repo.

Only personal configs, customizations, and custom skills live here. Upstream skills, plugins (`ponytail`, `superpowers`), `ccstatusline`, and Claude MCP registrations are declared in `manifest.json` and installed directly from upstream by `install.sh` — neither tool depends on the other being installed.

## Bootstrap on a fresh machine

```bash
cd ~/linuxDots/agentDots
./install.sh                # full setup for both Claude Code and Antigravity
./install.sh --agy-only     # Antigravity (~/.gemini) only
./install.sh --claude-only  # Claude Code (~/.claude + ccstatusline) only
./install.sh --link-only    # offline: symlinks and rendered templates only
./install.sh --dry-run      # preview without changing anything
```

### Flags

| Flag | Effect |
| --- | --- |
| `--agy-only` | Only link and install Antigravity (`~/.gemini`) configs, skills, and plugins |
| `--claude-only` | Only link and install Claude Code (`~/.claude`, `ccstatusline`) configs, skills, plugins, and MCPs |
| `--link-only` | Offline mode — symlink configs/custom skills and render templates only (skips `bun`, `npx`, plugin, and MCP installs) |
| `--skip-plugins` | Skip installing upstream plugins (`ponytail`, `superpowers`) |
| `--skip-mcps` | Skip `claude mcp add` registration |
| `--dry-run` | Print planned actions without touching disk or running installs |
| `-h`, `--help` | Show CLI usage |

`--agy-only` and `--claude-only` are mutually exclusive; any other flags can be combined (for example `./install.sh --agy-only --dry-run`).

`install.sh` is idempotent and moves any existing non-symlink target to `~/.local/state/agentDots-backups/<timestamp>/` (outside scanned skill/theme dirs) before replacing it. When re-rendering `~/.claude/settings.json` or `~/.gemini/antigravity-cli/settings.json` on an existing machine, it preserves machine-local `autoMode` and `trustedWorkspaces` keys.

## Installing via an agent

If the user opens Claude Code or Antigravity inside `agentDots/` and asks to install this setup:

1. Check which target they want (`both`, `--agy-only`, or `--claude-only`).
2. Verify prerequisites are on `PATH`: `git`, `python3`, `jq`, `npx` (for upstream skills), `agy` (for Antigravity plugins), `claude` and `bun` (for Claude plugins, MCPs, and `ccstatusline`), plus optional `sqlite3` (used only as a fallback in `statusline.sh` for conversation titles). Report anything missing before proceeding.
3. Preview first with `./install.sh --dry-run` (plus `--agy-only` / `--claude-only` if requested).
4. Run `./install.sh` with the chosen flags. Note: writing into `~/.gemini/` / `~/.claude/` and fetching upstream skills/plugins over the network requires unsandboxed shell access — ask the user to approve that command rather than skipping steps silently.
5. Verify symlinks resolve and remind the user of the manual post-install steps printed at the end (`~/.unslop/voice/husain/`, Herdr hooks, Figma OAuth).

## Layout

```text
agentDots/
├── AGENTS.md / CLAUDE.md       # This file (CLAUDE.md symlinks to AGENTS.md)
├── install.sh                  # Idempotent installer
├── manifest.json               # Upstream skill repos, plugins, MCPs, and global CLI tools
├── skills/                     # 7 shared custom skills (symlinked into both Claude & Antigravity)
│   ├── add/
│   ├── commit/
│   ├── adversarial-review/
│   ├── architecture-review/
│   ├── investigate/
│   ├── parallel-research/
│   └── review/
├── claude/
│   ├── CLAUDE.md               # -> ~/.claude/CLAUDE.md
│   ├── settings.json.tmpl      # Rendered -> ~/.claude/settings.json (__HOME__ -> $HOME)
│   ├── statusline.py           # -> ~/.claude/statusline.py
│   ├── themes/tokyonight.json  # -> ~/.claude/themes/tokyonight.json
│   └── skills/                 # 3 Claude-native skills (delegate, figma, video)
└── gemini/
    ├── GEMINI.md               # -> ~/.gemini/GEMINI.md
    ├── mcp_config.json         # -> ~/.gemini/config/mcp_config.json (figma, context7)
    ├── hooks.json.tmpl         # Rendered -> ~/.gemini/config/hooks.json (__HOME__ -> $HOME)
    ├── cli-settings.json       # Rendered -> ~/.gemini/antigravity-cli/settings.json
    ├── statusline.sh           # -> ~/.gemini/antigravity-cli/statusline.sh (Tokyo Night status line)
    └── skills/                 # 3 Antigravity-native skills (delegate, figma, video)
```

`ccstatusline` config lives in the sibling repo path `../.config/ccstatusline/` (`settings.json` and `segments.sh`); `install.sh` symlinks it to `~/.config/ccstatusline` and installs the `ccstatusline` binary with `bun add -g ccstatusline`.

## Maintenance rules for agents

- **Edit the source here, not the target:** Modify files under `~/linuxDots/agentDots/` (and re-run `./install.sh --link-only` if you changed a `.tmpl` file or added a new skill folder).
- **Shared vs. harness-native skills:**
  - Put harness-agnostic custom skills in `agentDots/skills/<name>/`.
  - Put skills that reference tool names, model tiers, or harness paths (`delegate`, `figma`, `video`) in both `agentDots/claude/skills/<name>/` and `agentDots/gemini/skills/<name>/`, keeping both in sync.
- **Adding an upstream skill repo:** Add the repo and active skill list to `manifest.json` under `skillRepos`, then run `./install.sh`.
- **Adding a plugin:** Add `{name, repo, url, subdir, claudePlugin}` to `manifest.json` under `plugins`, then run `./install.sh`.
- **Adding an MCP server:** Add it to `gemini/mcp_config.json` AND `manifest.json` (`mcps`), then re-run `./install.sh`. Never put API keys or bearer tokens in either file.
- **Adding a hook:** Edit `claude/settings.json.tmpl` and/or `gemini/hooks.json.tmpl` using `__HOME__` instead of hardcoded home paths, then run `./install.sh --link-only`.

## Intentionally excluded (public repo)

Never commit any of the following to `linuxDots`:

- Secrets, API keys, PATs, OAuth tokens, or `.config/zsh/secrets.zsh`.
- `~/.claude.json` (mixes runtime state/history with MCPs; MCPs are registered via `claude mcp add` instead).
- `autoMode` in `~/.claude/settings.json` and `trustedWorkspaces` in `~/.gemini/antigravity-cli/settings.json` (contain local project/file paths).
- `~/.unslop/voice/husain/` (personal writing samples; copy privately or regenerate with `/unslop teach`).
- `~/.claude/hooks/herdr-agent-state.sh` and `~/.gemini/config/hooks/herdr-agent-state.sh` (generated and overwritten by Herdr).
- `~/.claude/skills/synced/` and `~/.claude/plugins/synced/` (synced automatically by Claude account).
