#### Bin ####
if [ -d "$HOME/.bin" ]; then
    PATH="$HOME/.bin:$PATH"
fi

#### Local Bin ####
if [ -d "$HOME/.local/bin" ]; then
    PATH="$HOME/.local/bin:$PATH"
fi

#### FNM ####
if [ -d "$HOME/.local/share/fnm" ]; then
    export PATH="$HOME/.local/share/fnm:$PATH"
    eval "`fnm env`"
fi

### Cargo ###
if [ -d "$HOME/.cargo/bin:$PATH" ]; then
    PATH="$HOME/.cargo/bin:$PATH"
fi

### The Fuck ###
if command -v fuck &> /dev/null; then
    eval $(thefuck --alias)
fi

### Bun ###
if [ -d "$HOME/.bun/" ]; then
    [ -s "$HOME/.bun/_bun" ] && source "$HOME/.bun/_bun"
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
fi

### NVM ###
if [ -d "$HOME/.nvm/" ]; then
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
fi

### PGVM ###
if [ -d "$HOME/.pgvm/" ]; then
    source "$HOME/.pgvm/pgvm_env"
fi

