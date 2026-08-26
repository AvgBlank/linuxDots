########### Extracting Files ###########
function ex ()
{
    if [ -f $1 ] ; then
        case $1 in
            *.tar.bz2)   tar xjf $1   ;;
            *.tar.gz)    tar xzf $1   ;;
            *.bz2)       bunzip2 $1   ;;
            *.rar)       unrar x $1   ;;
            *.gz)        gunzip $1    ;;
            *.tar)       tar xf $1    ;;
            *.tbz2)      tar xjf $1   ;;
            *.tgz)       tar xzf $1   ;;
            *.zip)       unzip $1     ;;
            *.Z)         uncompress $1 ;;
            *.7z)        7z x $1      ;;
            *.deb)       ar x $1      ;;
            *.tar.xz)    tar xf $1    ;;
            *.tar.zst)   tar xf $1    ;;
            *)           echo "'$1' cannot be extracted via ex" ;;
        esac
    else
        echo "'$1' is not a valid file"
    fi
}


########### Python Virtual Environment ###########
function pv() {
    if [ -d ".venv" ]; then
        # Activate the existing virtual environment
        source .venv/bin/activate
    else
        # Create a new virtual environment and activate it
        python3 -m venv .venv
        source .venv/bin/activate
    fi
}


########### Toggle Disable Sleep for MacOS ###########
# `st` for "Sleep Toggle"
# To run, `st {user password}`
function st() {
    current_status=$(pmset -g | grep SleepDisabled | awk '{print $2}')
    stty -echo

    if [ "$current_status" -eq 1 ]; then
        # Enable Sleep if Disabled
        echo -e "$1" | sudo -S pmset -a disablesleep 0 > /dev/null 2>&1
        stty echo
        echo "Sleep Enabled."
    else
        # Disable Sleep if Enabled
        echo -e "$1" | sudo -S pmset -a disablesleep 1 > /dev/null 2>&1
        stty echo
        echo "Sleep Disabled."
    fi
}


########### Tmux Script ###########
# This script launches a tmux session based on selection
function tmuxthing() {
    if [[ $# -eq 1 ]]; then
        selected=$1
    else
        if [ -f /proc/sys/fs/binfmt_misc/WSLInterop ]; then
            # Get Windows username
            WIN_HOME=$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r')
            WIN_DIR="/mnt/c/Users/$WIN_HOME"

            # Run find in both Linux and Windows home and coding directories
            selected=$( (find ~ ~/projects "$WIN_DIR" "$WIN_DIR/Projects" -mindepth 1 -maxdepth 1 -type d; find ~/organizations "$WIN_DIR/Organizations" -mindepth 1 -maxdepth 2 -type d) | fzf )
        else
            # Run find in Linux home and coding directories
            selected=$( (find ~ ~/projects -mindepth 1 -maxdepth 1 -type d; find ~/organizations -mindepth 1 -maxdepth 2 -type d) | fzf )
        fi
    fi

    if [[ $selected ]]; then
        selected_name=$(basename "$selected" | tr . _)

        if ! tmux has-session -t=$selected_name 2> /dev/null; then
            tmux new-session -ds $selected_name -c $selected
        fi

        if [ -n "$TMUX" ]; then
            tmux switch-client -t $selected_name > /dev/null 2>&1
        else
            tmux attach-session -t "$selected_name"
        fi

    fi

}


########### NeoVim Script ###########
# This script launches a nvim instance with the selected file
function vimthing() {
    if [[ $# -eq 1 ]]; then
        selected=$1
    else
        selected=$(rg --files --hidden --glob '!**/.git/**' --glob '!**/.local/**' --glob '!**/.venv/**' --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/build/**' --glob '!**/target/**' | fzf --preview "bat --style=numbers --color=always {}")
    fi

    if [[ $selected ]]; then
        nvim "$selected"
    fi
}


########### Yazi Script ###########
# This script launches a yazi instance with the selected directory
function yazithing() {
    if [[ $# -eq 1 ]]; then
        selected=$1
    else
        selected=$(find . -type d \( ! -path '*/.git*' -a ! -path '*/.venv*' -a ! -path '*/node_modules*' -a ! -path '*/build*' -a ! -path '*/.local*' \) | fzf)
    fi

    if [[ $selected ]]; then
        yazi "$selected"
    fi
}


########### Change Dir Script ###########
# This script changes into the selected directory
function cdthing() {
    if [[ $# -eq 1 ]]; then
        selected=$1
    else
        selected=$(find . -type d \( ! -path '*/.git*' -a ! -path '*/.venv*' -a ! -path '*/node_modules*' -a ! -path '*/build*' \) | fzf)
    fi

    if [[ $selected ]]; then
        cd "$selected"
    fi
}


########### Search through history ###########
function fzfHistory() {
    local selected
    selected=$(fc -rl 1 | awk '{$1=""; print substr($0,2)}' | fzf --header='Select a command to run')
    if [[ -n $selected ]]; then
        BUFFER="$selected"
    fi
}
function fzfAcceptHistory() {
    local selected
    selected=$(fc -rl 1 | awk '{$1=""; print substr($0,2)}' | fzf --header='Select a command to run')
    if [[ -n $selected ]]; then
        BUFFER="$selected"
        zle accept-line
    fi
}


########### Dir Touch ###########
# Command to automatically create both files and folders automatically.
function mdt() {
    for item in "$@"; do
        parent_dir=$(dirname "$item")
        if [[ "$parent_dir" != "." && ! -d "$parent_dir" ]]; then
            mkdir -p "$parent_dir"  # Create parent directories if they don't exist
        fi
        if [[ "$item" == */ ]]; then
            mkdir -p "$item"  # Create directory
        else
            touch "$item"     # Create file
        fi
    done
}


########### Misc Functions ###########
if command -v yazi &> /dev/null; then
    function y() {
        local tmp="$(mktemp -t "yazi-cwd.XXXXXX")" cwd
        yazi "$@" --cwd-file="$tmp"
        if cwd="$(command cat -- "$tmp")" && [ -n "$cwd" ] && [ "$cwd" != "$PWD" ]; then
            builtin cd -- "$cwd"
        fi
        rm -f -- "$tmp"
    }
fi

