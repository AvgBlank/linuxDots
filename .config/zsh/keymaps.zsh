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
# Ctrl + U to open history search and accept query.
zle -N fzfHistory
bindkey '^R' fzfHistory
# Ctrl + R to just open history search.
zle -N fzfAcceptHistory
bindkey '^U' fzfAcceptHistory

# Ctrl + F to open tmux script
tmuxthing_widget() {
  BUFFER="tmuxthing"
  zle accept-line
}
zle -N tmuxthing_widget
bindkey '^F' tmuxthing_widget
# Ctrl + T to open vim script
vimthing_widget() {
  vimthing
  zle reset-prompt
}
zle -N vimthing_widget
bindkey '^T' vimthing_widget
# Ctrl + Y to open yazi script
yazithing_widget() {
  yazithing
  zle reset-prompt
}
zle -N yazithing_widget
bindkey '^Y' yazithing_widget
# Ctrl + E to open change dir script
bindkey -s '^E' 'cdthing\n'
