#!/usr/bin/env bash
# Custom segments for ccstatusline. Reads Claude Code's status JSON on stdin.
# Usage: segments.sh project|title|model|ctx|limits
# Colors from ~/.claude/themes/tokyonight.json; usage % is green <50, yellow <80, red otherwise.
in=$(cat)
q() { /usr/bin/jq -r "$1 // empty" <<<"$in"; }

rgb() { printf '\033[38;2;%d;%d;%dm' "0x${1:0:2}" "0x${1:2:2}" "0x${1:4:2}"; }
ORANGE=$(rgb FF9E64) BLUE=$(rgb 7AA2F7) TEAL=$(rgb 41A6B5) PURPLE=$(rgb BB9AF7) GREEN=$(rgb 9ECE6A) YELLOW=$(rgb E0AF68)
RED=$(rgb F7768E) GREY=$(rgb 9AA5CE) R=$'\033[0m'

level() { # color for a percentage
    local p=${1%.*}
    if ((p >= 80)); then printf '%s' "$RED"; elif ((p >= 50)); then printf '%s' "$YELLOW"; else printf '%s' "$GREEN"; fi
}

until_reset() { # epoch seconds -> 1h29m / 3d10h
    local s=$(($1 - $(date +%s)))
    ((s < 0)) && s=0
    if ((s >= 86400)); then printf '%dd%dh' $((s / 86400)) $((s % 86400 / 3600))
    else printf '%dh%02dm' $((s / 3600)) $((s % 3600 / 60)); fi
}

case $1 in
project)
    d=$(q '.workspace.current_dir // .cwd')
    [ -z "$d" ] && exit 0
    b=$(git -C "$d" branch --show-current 2>/dev/null)
    printf '%sProject: %s%s' "$ORANGE" "${d##*/}" "$R"
    [ -n "$b" ] && printf ' %s(%s)%s' "$PURPLE" "$b" "$R"
    ;;
title)
    t=$(q .session_name)
    [ -n "$t" ] && printf '%s%s%s' "$GREY" "$t" "$R"
    ;;
model)
    printf '%sModel: %s%s' "$BLUE" "$(q .model.display_name)" "$R"
    e=$(q .effort.level)
    [ -n "$e" ] && printf ' %s(%s)%s' "$PURPLE" "$(tr '[:lower:]' '[:upper:]' <<<"${e:0:1}")${e:1}" "$R"
    ;;
ctx)
    p=$(q .context_window.used_percentage)
    [ -n "$p" ] && printf '%sCtx: %.0f%%%s' "$(level "$p")" "$p" "$R"
    ;;
limits)
    out=()
    for w in five_hour:5h\ Limit seven_day:Weekly; do
        key=${w%%:*} name=${w#*:}
        p=$(q ".rate_limits.$key.used_percentage")
        [ -z "$p" ] && continue
        seg="$(level "$p")$name: $(printf '%.0f' "$p")%$R"
        r=$(q ".rate_limits.$key.resets_at")
        [ -n "$r" ] && seg+=" $GREY($(until_reset "$r"))$R"
        out+=("$seg")
    done
    sep=$(rgb 565F89)' | '$R
    printf '%s' "${out[0]}"
    for s in "${out[@]:1}"; do printf '%s%s' "$sep" "$s"; done
    ;;
esac
exit 0 # a false `[ -n ... ] &&` above must not become the exit code; ccstatusline shows [Exit: 1]
