############ Zsh Defer Setup ###########
if [ ! -d "$HOME/.zsh-plugins/zsh-defer" ]; then
    echo "\033[1;33mzsh-defer plugin does not exist. Cloning plugin...\033[0m"
    mkdir -p "$HOME/.zsh-plugins"
    cd "$HOME/.zsh-plugins"
    git clone https://github.com/romkatv/zsh-defer.git
    cd "$HOME"
fi
source ~/.zsh-plugins/zsh-defer/zsh-defer.plugin.zsh

############ Core Config (Immediate) ###########
source ~/.config/zsh/settings.zsh
source ~/.config/zsh/paths-fast.zsh
source ~/.config/zsh/aliases.zsh
source ~/.config/zsh/funcs.zsh
source ~/.config/zsh/keymaps.zsh

########### Plugins and Paths (Deferred) ###########
zsh-defer source ~/.config/zsh/paths-slow.zsh
zsh-defer source ~/.config/zsh/plugins.zsh


########### Startup (Has to run in the end) ###########
source ~/.config/zsh/startup.zsh
