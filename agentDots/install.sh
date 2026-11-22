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
SKIP_PLUGINS=0
DO_CLAUDE=1
DO_AGY=1

usage() {
  cat <<'EOF'
Usage: ./install.sh [options]

Options:
  --agy-only       Only install and link Antigravity (~/.gemini) setup
  --claude-only    Only install and link Claude Code (~/.claude + ccstatusline) setup
  --link-only      Only link tracked configs/skills and render templates (offline)
  --skip-plugins   Skip installing upstream plugins (ponytail, superpowers)
  --skip-mcps      Skip registering Claude MCP servers
  --dry-run        Print actions without modifying files or running installs
  -h, --help       Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agy-only) DO_CLAUDE=0 ;;
    --claude-only) DO_AGY=0 ;;
    --link-only) LINK_ONLY=1 ;;
    --skip-plugins) SKIP_PLUGINS=1 ;;
    --skip-mcps) SKIP_MCPS=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [[ "$DO_CLAUDE" -eq 0 && "$DO_AGY" -eq 0 ]]; then
  echo "Error: --agy-only and --claude-only cannot be combined." >&2
  exit 2
fi

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

  if [[ "$DRY_RUN" -eq 0 && ! -e "$src" ]]; then
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

install_agy_plugin() {
  local name="$1" url="$2" subdir="$3"
  local dest="$HOME/.gemini/config/plugins/$name"

  if [[ -d "$dest" ]]; then
    log "ok: agy plugin $name already installed"
    return 0
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[dry-run] git clone --depth 1 %s <tmp> && agy plugin install <tmp>/%s\n' "$url" "$subdir"
    return 0
  fi

  local tmpdir
  tmpdir="$(mktemp -d)"
  if git clone --depth 1 --quiet "$url" "$tmpdir" </dev/null 2>/dev/null; then
    local target="$tmpdir"
    [[ "$subdir" != "." && -n "$subdir" ]] && target="$tmpdir/$subdir"
    log "Installing Antigravity plugin: $name ($url)"
    if ! agy plugin install "$target" </dev/null; then
      SKIPPED+=("agy plugin $name (agy plugin install failed)")
    fi
  else
    SKIPPED+=("agy plugin $name (git clone $url failed)")
  fi
  rm -rf "$tmpdir"
}

# 1. Rules, settings, themes, statusline, MCP & hooks configs
log "Linking rules, configs, theme, and statusline..."

if [[ "$DO_CLAUDE" -eq 1 ]]; then
  link_path "$SCRIPT_DIR/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
  link_path "$SCRIPT_DIR/claude/statusline.py" "$HOME/.claude/statusline.py"
  link_path "$SCRIPT_DIR/claude/themes/tokyonight.json" "$HOME/.claude/themes/tokyonight.json"
  render_json_template "$SCRIPT_DIR/claude/settings.json.tmpl" "$HOME/.claude/settings.json" "autoMode"

  # Ensure ccstatusline config from parent linuxDots repo is linked if present
  CCSTATUS_SRC="$(cd "$SCRIPT_DIR/.." && pwd)/.config/ccstatusline"
  if [[ -d "$CCSTATUS_SRC" ]]; then
    link_path "$CCSTATUS_SRC" "$HOME/.config/ccstatusline"
  fi
fi

if [[ "$DO_AGY" -eq 1 ]]; then
  link_path "$SCRIPT_DIR/gemini/GEMINI.md" "$HOME/.gemini/GEMINI.md"
  link_path "$SCRIPT_DIR/gemini/mcp_config.json" "$HOME/.gemini/config/mcp_config.json"
  link_path "$SCRIPT_DIR/gemini/statusline.sh" "$HOME/.gemini/antigravity-cli/statusline.sh"
  render_json_template "$SCRIPT_DIR/gemini/hooks.json.tmpl" "$HOME/.gemini/config/hooks.json"
  render_json_template "$SCRIPT_DIR/gemini/cli-settings.json" "$HOME/.gemini/antigravity-cli/settings.json" "trustedWorkspaces"
fi

# 2. Custom skills (shared + harness-native)
log "Linking custom skills..."

for skill_dir in "$SCRIPT_DIR"/skills/*; do
  [[ -d "$skill_dir" ]] || continue
  name="$(basename "$skill_dir")"
  [[ "$DO_CLAUDE" -eq 1 ]] && link_path "$skill_dir" "$HOME/.claude/skills/$name"
  [[ "$DO_AGY" -eq 1 ]] && link_path "$skill_dir" "$HOME/.gemini/config/skills/$name"
done

if [[ "$DO_CLAUDE" -eq 1 ]]; then
  for skill_dir in "$SCRIPT_DIR"/claude/skills/*; do
    [[ -d "$skill_dir" ]] || continue
    name="$(basename "$skill_dir")"
    link_path "$skill_dir" "$HOME/.claude/skills/$name"
  done
fi

if [[ "$DO_AGY" -eq 1 ]]; then
  for skill_dir in "$SCRIPT_DIR"/gemini/skills/*; do
    [[ -d "$skill_dir" ]] || continue
    name="$(basename "$skill_dir")"
    link_path "$skill_dir" "$HOME/.gemini/config/skills/$name"
  done
fi

# 3. Upstream installs (skipped with --link-only)
if [[ "$LINK_ONLY" -eq 0 ]]; then
  # 3a. ccstatusline binary via bun (Claude only)
  if [[ "$DO_CLAUDE" -eq 1 ]]; then
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
  fi

  # 3b. Upstream skills from manifest.json
  if command -v npx >/dev/null 2>&1; then
    while IFS= read -r -u 3 repo; do
      [[ -n "$repo" ]] || continue
      log "Installing upstream skill repo: $repo"
      run_cmd npx -y skills add "$repo" -g -y </dev/null || SKIPPED+=("skills repo $repo (install failed)")
    done 3< <(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("\n".join(r["repo"] for r in d["skillRepos"]))' "$MANIFEST")

    # Link installed upstream skills from ~/.agents/skills into target dirs
    while IFS=$'\t' read -r -u 3 skill_name target_key; do
      [[ -n "$skill_name" ]] || continue
      src="$HOME/.agents/skills/$skill_name"
      case "$target_key" in
        claude)       [[ "$DO_CLAUDE" -eq 1 ]] && link_path "$src" "$HOME/.claude/skills/$skill_name" ;;
        gemini)       [[ "$DO_AGY" -eq 1 ]]    && link_path "$src" "$HOME/.gemini/config/skills/$skill_name" ;;
        geminiCli)    [[ "$DO_AGY" -eq 1 ]]    && link_path "$src" "$HOME/.gemini/antigravity-cli/skills/$skill_name" ;;
        geminiLegacy) [[ "$DO_AGY" -eq 1 ]]    && link_path "$src" "$HOME/.gemini/skills/$skill_name" ;;
      esac
    done 3< <(python3 -c '
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

  # 3c. Upstream plugins (installed directly from GitHub for each selected tool)
  if [[ "$SKIP_PLUGINS" -eq 0 ]]; then
    if [[ "$DO_CLAUDE" -eq 1 ]]; then
      if command -v claude >/dev/null 2>&1; then
        while IFS=$'\t' read -r -u 3 repo plugin_id; do
          [[ -n "$repo" ]] || continue
          log "Installing Claude plugin: $plugin_id ($repo)"
          run_cmd claude plugin marketplace add "$repo" </dev/null || true
          run_cmd claude plugin install "$plugin_id" </dev/null || SKIPPED+=("Claude plugin $plugin_id (install failed)")
        done 3< <(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("\n".join("\t".join((p["repo"], p["claudePlugin"])) for p in d["plugins"]))' "$MANIFEST")
      else
        SKIPPED+=("Claude plugins (claude CLI not found)")
      fi
    fi

    if [[ "$DO_AGY" -eq 1 ]]; then
      if command -v agy >/dev/null 2>&1; then
        while IFS=$'\t' read -r -u 3 name url subdir; do
          [[ -n "$name" ]] || continue
          install_agy_plugin "$name" "$url" "$subdir"
        done 3< <(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("\n".join("\t".join((p["name"], p["url"], p["subdir"])) for p in d["plugins"]))' "$MANIFEST")
      else
        SKIPPED+=("Antigravity plugins (agy CLI not found)")
      fi
    fi
  fi

  # 3d. Claude global MCPs (Antigravity MCPs are already linked via gemini/mcp_config.json)
  if [[ "$DO_CLAUDE" -eq 1 && "$SKIP_MCPS" -eq 0 ]]; then
    if command -v claude >/dev/null 2>&1; then
      while IFS=$'\t' read -r -u 3 name transport url; do
        [[ -n "$name" ]] || continue
        log "Registering Claude MCP: $name ($url)"
        run_cmd claude mcp add -s user -t "$transport" "$name" "$url" </dev/null || true
      done 3< <(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("\n".join("\t".join((m["name"], m["transport"], m["url"])) for m in d["mcps"]))' "$MANIFEST")
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
  2. Herdr hooks: enable Claude and/or Antigravity integrations inside Herdr so it writes
     ~/.claude/hooks/herdr-agent-state.sh and ~/.gemini/config/hooks/herdr-agent-state.sh.
  3. OAuth logins: sign in to Figma MCP on first use (and optionally add a Context7 API key
     or switch its URL to https://mcp.context7.com/mcp/oauth for higher rate limits).
EOF
