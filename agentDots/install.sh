#!/usr/bin/env bash
# Idempotent bootstrap for Antigravity (~/.gemini) and Claude Code (~/.claude).
# Safe to run on a fresh machine or repeatedly on an existing setup.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$SCRIPT_DIR/manifest.json"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_ROOT="$HOME/.local/state/agentDots-backups/$TIMESTAMP"

DRY_RUN=0
LINK_ONLY=0
SKIP_MCPS=0

usage() {
  cat <<'EOF'
Usage: ./install.sh [options]

Options:
  --dry-run     Print actions without modifying files or running installs
  --link-only   Only link tracked configs/skills and render templates (offline)
  --skip-mcps   Skip registering Claude MCP servers
  -h, --help    Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --link-only) LINK_ONLY=1 ;;
    --skip-mcps) SKIP_MCPS=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

SKIPPED=()

log() { printf '[agentDots] %s\n' "$*"; }

run_cmd() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

ensure_dir() {
  local dir="$1"
  [[ -d "$dir" ]] && return 0
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[dry-run] mkdir -p %s\n' "$dir"
  else
    mkdir -p "$dir"
  fi
}

backup_path() {
  local target="$1"
  local rel="${target#"$HOME/"}"
  local backup="$BACKUP_ROOT/$rel"
  ensure_dir "$(dirname "$backup")"
  log "backup: $target -> $backup"
  run_cmd mv "$target" "$backup"
}

same_target() {
  local a="$1"
  local b="$2"
  python3 -c 'import os, sys; sys.exit(0 if os.path.realpath(sys.argv[1]) == os.path.realpath(sys.argv[2]) else 1)' "$a" "$b"
}

link_path() {
  local src="$1"
  local dst="$2"

  if [[ ! -e "$src" ]]; then
    log "warn: missing source $src (skipping $dst)"
    return 0
  fi

  if [[ -L "$dst" ]] && same_target "$dst" "$src"; then
    log "ok: $dst -> $(readlink "$dst")"
    return 0
  fi

  ensure_dir "$(dirname "$dst")"

  if [[ -e "$dst" || -L "$dst" ]]; then
    backup_path "$dst"
  fi

  log "link: $dst -> $src"
  run_cmd ln -s "$src" "$dst"
}

render_json_template() {
  local src="$1"
  local dst="$2"
  shift 2
  local preserve_keys=("$@")

  ensure_dir "$(dirname "$dst")"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[dry-run] render %s -> %s (preserve: %s)\n' "$src" "$dst" "${preserve_keys[*]:-none}"
    return 0
  fi

  python3 - "$src" "$dst" "$HOME" "$BACKUP_ROOT" ${preserve_keys[@]+"${preserve_keys[@]}"} <<'PY'
import json, os, shutil, sys

src, dst, home, backup_root = sys.argv[1:5]
preserve_keys = sys.argv[5:]

raw = open(src, encoding="utf-8").read().replace("__HOME__", home)
desired = json.loads(raw)

if os.path.exists(dst):
    try:
        existing = json.load(open(dst, encoding="utf-8"))
        if isinstance(existing, dict):
            for key in preserve_keys:
                if key in existing and key not in desired:
                    desired[key] = existing[key]
    except Exception:
        pass

rendered = json.dumps(desired, indent=2) + "\n"

if os.path.exists(dst) and not os.path.islink(dst):
    try:
        if open(dst, encoding="utf-8").read() == rendered:
            print(f"[agentDots] ok: {dst} (up to date)")
            raise SystemExit(0)
    except OSError:
        pass

if os.path.lexists(dst):
    rel = os.path.relpath(dst, home) if dst.startswith(home + os.sep) else os.path.basename(dst)
    backup = os.path.join(backup_root, rel)
    os.makedirs(os.path.dirname(backup), exist_ok=True)
    shutil.move(dst, backup)
    print(f"[agentDots] backup: {dst} -> {backup}")

with open(dst, "w", encoding="utf-8") as fh:
    fh.write(rendered)
print(f"[agentDots] render: {dst}")
PY
}

# 1. Rules, settings, themes, statusline, MCP & hooks configs
log "Linking rules, configs, theme, and statusline..."

link_path "$SCRIPT_DIR/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
link_path "$SCRIPT_DIR/claude/statusline.py" "$HOME/.claude/statusline.py"
link_path "$SCRIPT_DIR/claude/themes/tokyonight.json" "$HOME/.claude/themes/tokyonight.json"
render_json_template "$SCRIPT_DIR/claude/settings.json.tmpl" "$HOME/.claude/settings.json" "autoMode"

link_path "$SCRIPT_DIR/gemini/GEMINI.md" "$HOME/.gemini/GEMINI.md"
link_path "$SCRIPT_DIR/gemini/mcp_config.json" "$HOME/.gemini/config/mcp_config.json"
link_path "$SCRIPT_DIR/gemini/statusline.sh" "$HOME/.gemini/antigravity-cli/statusline.sh"
render_json_template "$SCRIPT_DIR/gemini/hooks.json.tmpl" "$HOME/.gemini/config/hooks.json"
render_json_template "$SCRIPT_DIR/gemini/cli-settings.json" "$HOME/.gemini/antigravity-cli/settings.json" "trustedWorkspaces"

# Ensure ccstatusline config from parent linuxDots repo is linked if present
CCSTATUS_SRC="$(cd "$SCRIPT_DIR/.." && pwd)/.config/ccstatusline"
if [[ -d "$CCSTATUS_SRC" ]]; then
  link_path "$CCSTATUS_SRC" "$HOME/.config/ccstatusline"
fi

# 2. Custom skills (shared + harness-native)
log "Linking custom skills..."

for skill_dir in "$SCRIPT_DIR"/skills/*; do
  [[ -d "$skill_dir" ]] || continue
  name="$(basename "$skill_dir")"
  link_path "$skill_dir" "$HOME/.claude/skills/$name"
  link_path "$skill_dir" "$HOME/.gemini/config/skills/$name"
done

for skill_dir in "$SCRIPT_DIR"/claude/skills/*; do
  [[ -d "$skill_dir" ]] || continue
  name="$(basename "$skill_dir")"
  link_path "$skill_dir" "$HOME/.claude/skills/$name"
done

for skill_dir in "$SCRIPT_DIR"/gemini/skills/*; do
  [[ -d "$skill_dir" ]] || continue
  name="$(basename "$skill_dir")"
  link_path "$skill_dir" "$HOME/.gemini/config/skills/$name"
done

# 3. Upstream installs (skipped with --link-only)
if [[ "$LINK_ONLY" -eq 0 ]]; then
  # 3a. ccstatusline binary via bun
  if [[ ! -x "$HOME/.bun/bin/ccstatusline" ]]; then
    if command -v bun >/dev/null 2>&1; then
      log "Installing ccstatusline via bun..."
      run_cmd bun add -g ccstatusline
    else
      SKIPPED+=("ccstatusline (bun not found; run: bun add -g ccstatusline)")
    fi
  else
    log "ok: ccstatusline already installed"
  fi

  # 3b. Upstream skills from manifest.json
  if command -v npx >/dev/null 2>&1; then
    while IFS= read -r repo; do
      [[ -n "$repo" ]] || continue
      log "Installing upstream skill repo: $repo"
      run_cmd npx -y skills add "$repo" -g -y || SKIPPED+=("skills repo $repo (install failed)")
    done < <(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("\n".join(r["repo"] for r in d["skillRepos"]))' "$MANIFEST")

    # Link installed upstream skills from ~/.agents/skills into target dirs
    while IFS=$'\t' read -r skill_name target_key; do
      [[ -n "$skill_name" ]] || continue
      src="$HOME/.agents/skills/$skill_name"
      case "$target_key" in
        claude)       link_path "$src" "$HOME/.claude/skills/$skill_name" ;;
        gemini)       link_path "$src" "$HOME/.gemini/config/skills/$skill_name" ;;
        geminiCli)    link_path "$src" "$HOME/.gemini/antigravity-cli/skills/$skill_name" ;;
        geminiLegacy) link_path "$src" "$HOME/.gemini/skills/$skill_name" ;;
      esac
    done < <(python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
for r in d["skillRepos"]:
    for s in r["skills"]:
        for t in r["targets"]:
            print(f"{s}\t{t}")
' "$MANIFEST")
  else
    SKIPPED+=("upstream skills (npx not found)")
  fi

  # 3c. Claude plugins & Antigravity plugin import
  if command -v claude >/dev/null 2>&1; then
    while IFS= read -r repo; do
      [[ -n "$repo" ]] || continue
      log "Adding Claude plugin marketplace: $repo"
      run_cmd claude plugin marketplace add "$repo" || true
    done < <(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("\n".join(m["repo"] for m in d["plugins"]["claudeMarketplaces"]))' "$MANIFEST")

    while IFS= read -r plugin; do
      [[ -n "$plugin" ]] || continue
      log "Installing Claude plugin: $plugin"
      run_cmd claude plugin install "$plugin" || true
    done < <(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("\n".join(d["plugins"]["claudePlugins"]))' "$MANIFEST")
  else
    SKIPPED+=("Claude plugins (claude CLI not found)")
  fi

  if command -v agy >/dev/null 2>&1; then
    log "Importing plugins into Antigravity from Claude..."
    run_cmd agy plugin import claude || SKIPPED+=("agy plugin import claude (returned non-zero)")
  else
    SKIPPED+=("Antigravity plugin import (agy CLI not found)")
  fi

  # 3d. Claude global MCPs
  if [[ "$SKIP_MCPS" -eq 0 ]]; then
    if command -v claude >/dev/null 2>&1; then
      while IFS=$'\t' read -r name transport url; do
        [[ -n "$name" ]] || continue
        log "Registering Claude MCP: $name ($url)"
        run_cmd claude mcp add -s user -t "$transport" "$name" "$url" || true
      done < <(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("\n".join(f"{m[\"name\"]}\t{m[\"transport\"]}\t{m[\"url\"]}" for m in d["mcps"]))' "$MANIFEST")
    else
      SKIPPED+=("Claude MCP registration (claude CLI not found)")
    fi
  fi
fi

# 4. Summary
echo ""
log "Done."
if [[ -n "${SKIPPED[*]-}" ]]; then
  log "Skipped items:"
  for item in "${SKIPPED[@]}"; do
    printf '  - %s\n' "$item"
  done
fi

cat <<'EOF'

Manual post-install steps (kept out of git for privacy):
  1. Unslop voice card: restore ~/.unslop/voice/husain/ privately, or run `/unslop teach`.
  2. Herdr hooks: enable Claude and Antigravity integrations inside Herdr so it writes
     ~/.claude/hooks/herdr-agent-state.sh and ~/.gemini/config/hooks/herdr-agent-state.sh.
  3. OAuth logins: sign in to Figma MCP on first use (and optionally add a Context7 API key
     or switch its URL to https://mcp.context7.com/mcp/oauth for higher rate limits).
  4. Claude synced plugins: sign in to Claude Code to sync superpowers & engineering, then
     re-run `agy plugin import claude` if Antigravity did not have them yet.
EOF
