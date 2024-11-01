########### Setting a few defaults ###########
setopt autocd


########### Setting NeoVim as default editor ###########
export EDITOR='nvim'
export VISUAL='nvim'


########### History ###########
mkdir -p ~/.zsh-cache
export HISTFILE=~/.zsh-cache/zshhist
export HISTSIZE=10000
export SAVEHIST=10000
setopt INC_APPEND_HISTORY_TIME
setopt EXTENDED_HISTORY
setopt HIST_IGNORE_ALL_DUPS
setopt HIST_IGNORE_DUPS
setopt HIST_SAVE_NO_DUPS

########### Setting Locale ###########
export LC_CTYPE="en_US.utf8"
export LC_ALL="en_US.UTF-8"
