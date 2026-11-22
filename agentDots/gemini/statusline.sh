#!/usr/bin/env bash
# Custom status line for Antigravity CLI (`agy`), matching Claude's ccstatusline
# Tokyo Night look (~/linuxDots/.config/ccstatusline/segments.sh).
# Single jq pass + short file caches for git branch & chat title (~8ms/tick).
#   1: Model (Effort) | Ctx | Project (branch) | Chat title/summary
#   2: 5h Limit | Weekly
#   3: Mode banner (auto / accept edits / plan / manual)

JQ="$(command -v jq 2>/dev/null || echo /usr/bin/jq)"
[ -x "$JQ" ] || exit 0

# Single jq invocation extracts every field (US-delimited so empty fields never collapse)
IFS=$'\x1f' read -r -d '' \
  model_name effort ctx_pct dir title cid mode \
  q5_used q5_secs qw_used qw_secs \
  < <(
    "$JQ" -j '
      def s(x): (x // "") | tostring | gsub("[\r\n\t\u001f]"; " ");
      def pct(rem): if rem == null then "" else (((1 - rem) * 100) | if . < 0 then 0 elif . > 100 then 100 else . end | round | tostring) end;
      def sec(x): if x == null then "" else (x | floor | tostring) end;
      (if (.model | type) == "string" then .model else (.model.display_name // .model.id // "") end) as $m |
      (if (.effort | type) == "string" then .effort else (.model.effort // .effort.level // "") end) as $e |
      (if ($m | ascii_downcase | contains("gemini")) then "gemini" else "3p" end) as $qp |
      [
        s($m),
        s($e),
        (if .context_window.used_percentage == null then "" else (.context_window.used_percentage | round | tostring) end),
        s(.workspace.current_dir // .workspace.project_dir // .cwd),
        s(.conversation_title // .session.conversation_title // .session_name),
        s(.conversation_id // .session_id),
        s(.cycle_mode),
        pct(.quota[$qp + "-5h"].remaining_fraction),
        sec(.quota[$qp + "-5h"].reset_in_seconds),
        pct(.quota[$qp + "-weekly"].remaining_fraction),
        sec(.quota[$qp + "-weekly"].reset_in_seconds)
      ] | join("\u001f")
    ' 2>/dev/null
    printf '\0'
  ) || true

# Empty JSON / nothing to show
if [ -z "$model_name" ] && [ -z "$dir" ] && [ -z "$mode" ] && [ -z "$ctx_pct" ] && [ -z "$q5_used" ]; then
  exit 0
fi

# Tokyo Night truecolor escapes (matching ~/.claude/themes/tokyonight.json)
ORANGE=$'\033[38;2;255;158;100m'
BLUE=$'\033[38;2;122;162;247m'
CYAN=$'\033[38;2;125;207;255m'
TEAL=$'\033[38;2;65;166;181m'
PURPLE=$'\033[38;2;187;154;247m'
GREEN=$'\033[38;2;158;206;106m'
YELLOW=$'\033[38;2;224;175;104m'
RED=$'\033[38;2;247;118;142m'
GREY=$'\033[38;2;154;165;206m'
PLAN_GREY=$'\033[38;2;173;180;177m'
SUBTLE=$'\033[38;2;115;122;162m'
R=$'\033[0m'
SEP=$'\033[38;2;86;95;137m | \033[0m'

level() { # green <50, yellow <80, red >=80
  local p="${1%.*}"
  if (( p >= 80 )); then printf '%s' "$RED"
  elif (( p >= 50 )); then printf '%s' "$YELLOW"
  else printf '%s' "$GREEN"
  fi
}

format_duration() { # seconds -> 4h44m / 6d9h
  local s="${1%.*}"
  (( s < 0 )) && s=0
  if (( s >= 86400 )); then
    printf '%dd%dh' $((s / 86400)) $((s % 86400 / 3600))
  else
    printf '%dh%02dm' $((s / 3600)) $((s % 3600 / 60))
  fi
}

file_age_lt() { # file_age_lt <path> <max_seconds>
  local f="$1" max="$2" now mtime
  [ -f "$f" ] || return 1
  now="$(date +%s)"
  mtime="$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null || echo 0)"
  (( now - mtime < max ))
}

git_branch_cached() {
  local d="$1" key cache b=""
  # Fast-path: read .git/HEAD directly if repo root matches d (0 subprocesses)
  if [ -f "$d/.git/HEAD" ]; then
    IFS= read -r b < "$d/.git/HEAD" 2>/dev/null || true
    case "$b" in
      "ref: refs/heads/"*) printf '%s' "${b#ref: refs/heads/}"; return 0 ;;
    esac
  fi
  key="${d//[^A-Za-z0-9._-]/_}"
  cache="${TMPDIR:-/tmp}/agy-sl-git-${key}"
  if file_age_lt "$cache" 5; then
    IFS= read -r b < "$cache" 2>/dev/null || true
    printf '%s' "$b"
    return 0
  fi
  b="$(git -C "$d" branch --show-current 2>/dev/null </dev/null || true)"
  printf '%s\n' "$b" > "$cache" 2>/dev/null || true
  printf '%s' "$b"
}

lookup_title_cached() {
  local id="$1" cache db="" res=""
  [[ "$id" =~ ^[A-Za-z0-9_-]+$ ]] || return 0
  cache="${TMPDIR:-/tmp}/agy-sl-title-${id}"
  if file_age_lt "$cache" 30; then
    IFS= read -r res < "$cache" 2>/dev/null || true
    printf '%s' "$res"
    return 0
  fi
  command -v sqlite3 >/dev/null 2>&1 || return 0
  for candidate in "$HOME/.gemini/antigravity/conversation_summaries.db" "$HOME/.gemini/antigravity-cli/conversation_summaries.db"; do
    if [ -r "$candidate" ]; then
      db="$candidate"
      break
    fi
  done
  [ -z "$db" ] && return 0
  res="$(sqlite3 -readonly -cmd '.timeout 100' "file:${db}?mode=ro" \
    "SELECT COALESCE(NULLIF(title, ''), preview) FROM conversation_summaries WHERE conversation_id = '${id}' LIMIT 1;" \
    </dev/null 2>/dev/null || true)"
  res="${res//$'\r'/ }"
  res="${res//$'\n'/ }"
  res="${res//$'\t'/ }"
  printf '%s\n' "$res" > "$cache" 2>/dev/null || true
  printf '%s' "$res"
}

cap_first() {
  local s="$1" c="${1:0:1}"
  case "$c" in
    a) c=A ;; b) c=B ;; c) c=C ;; d) c=D ;; e) c=E ;; f) c=F ;; g) c=G ;;
    h) c=H ;; i) c=I ;; j) c=J ;; k) c=K ;; l) c=L ;; m) c=M ;; n) c=N ;;
    o) c=O ;; p) c=P ;; q) c=Q ;; r) c=R ;; s) c=S ;; t) c=T ;; u) c=U ;;
    v) c=V ;; w) c=W ;; x) c=X ;; y) c=Y ;; z) c=Z ;;
  esac
  printf '%s%s' "$c" "${s:1}"
}

join_row() {
  local first=1 seg
  for seg in "$@"; do
    [ -z "$seg" ] && continue
    if (( first )); then
      printf '%s' "$seg"
      first=0
    else
      printf '%s%s' "$SEP" "$seg"
    fi
  done
}

# --- Row 1: Model (Effort) | Ctx | Project (branch) | Chat title/summary ---
row1=()

if [ -n "$model_name" ]; then
  if [ -n "$effort" ]; then
    eff_cap="$(cap_first "$effort")"
    model_clean="${model_name% (${eff_cap})}"
    model_clean="${model_clean% (${effort})}"
    row1+=("${BLUE}Model: ${model_clean}${R} ${PURPLE}(${eff_cap})${R}")
  else
    row1+=("${BLUE}Model: ${model_name}${R}")
  fi
fi

if [ -n "$ctx_pct" ]; then
  row1+=("$(level "$ctx_pct")Ctx: ${ctx_pct}%${R}")
fi

if [ -n "$dir" ]; then
  proj="${dir##*/}"
  [ -z "$proj" ] && proj="$dir"
  seg="${ORANGE}Project: ${proj}${R}"
  branch="$(git_branch_cached "$dir")"
  [ -n "$branch" ] && seg+=" ${PURPLE}(${branch})${R}"
  row1+=("$seg")
fi

if [ -z "$title" ] && [ -n "$cid" ]; then
  title="$(lookup_title_cached "$cid")"
fi
if [ -n "$title" ]; then
  if (( ${#title} > 40 )); then
    title="${title:0:39}…"
  fi
  row1+=("${GREY}${title}${R}")
fi

if (( ${#row1[@]} > 0 )); then
  join_row "${row1[@]}"
  printf '\n'
fi

# --- Row 2: 5h Limit | Weekly ---
row2=()

if [ -n "$q5_used" ]; then
  seg="$(level "$q5_used")5h Limit: ${q5_used}%${R}"
  [ -n "$q5_secs" ] && seg+=" ${GREY}($(format_duration "$q5_secs"))${R}"
  row2+=("$seg")
fi

if [ -n "$qw_used" ]; then
  seg="$(level "$qw_used")Weekly: ${qw_used}%${R}"
  [ -n "$qw_secs" ] && seg+=" ${GREY}($(format_duration "$qw_secs"))${R}"
  row2+=("$seg")
fi

if (( ${#row2[@]} > 0 )); then
  join_row "${row2[@]}"
  printf '\n'
fi

# --- Row 3: Mode banner (Claude Tokyo Night colors, never disappears on manual/default) ---
hint="${SUBTLE}(shift+tab to cycle)${R}"
case "$mode" in
  auto)
    printf '%s %s\n' "${ORANGE}⏵⏵ auto mode on${R}" "$hint"
    ;;
  accept-edits|accept_edits|acceptEdits)
    printf '%s %s\n' "${CYAN}⏵⏵ accept edits on${R}" "$hint"
    ;;
  plan)
    printf '%s %s\n' "${PLAN_GREY}⏸ plan mode on${R}" "$hint"
    ;;
  ""|default|manual|normal|ask)
    printf '%s %s\n' "${PLAN_GREY}⏸ manual mode on${R}" "$hint"
    ;;
  *)
    printf '%s %s\n' "${TEAL}⏵⏵ ${mode} mode on${R}" "$hint"
    ;;
esac

exit 0
