# Forward a word
bindkey '^[[1;5C' forward-word
# Backward a word
bindkey "^[[1;5D" backward-word
# Up arrow for history search
bindkey '^[[A' history-substring-search-up
# Down arrow for history search
bindkey '^[[B' history-substring-search-down
# Ctrl + L to clear the screen
bindkey -s '^L' "clear\n"
# Ctrl + F to open tmux script
bindkey -s '^F' 'tmuxthing\n'
# Ctrl + T to open vim script
bindkey -s '^T' 'vimthing\n'
# Ctrl + Y to open yazi script
bindkey -s '^Y' 'yazithing\n'
# Ctrl + E to open change dir script
bindkey -s '^E' 'cdthing\n'
