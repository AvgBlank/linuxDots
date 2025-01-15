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

#### Nix Packages ####
if [ -f $HOME/.nix-profile/etc/profile.d/nix.sh ]; then
    source $HOME/.nix-profile/etc/profile.d/nix.sh
fi

#### Linuxbrew Packages ####
if [ -d "/home/linuxbrew/.linuxbrew" ]; then
    eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
fi

#### Homebrew Arm MacOS ####
if [ -d "/opt/homebrew/bin" ]; then
    export PATH="/opt/homebrew/bin:$PATH"
    export CPATH="/opt/homebrew/include:$CPATH"
    export LIBRARY_PATH="/opt/homebrew/lib:$LIBRARY_PATH"
fi

### Cargo ###
if [ -d "$HOME/.cargo/bin:$PATH" ]; then
    PATH="$HOME/.cargo/bin:$PATH"
fi

### The Fuck ###
if command -v fuck &> /dev/null; then
    eval $(thefuck --alias)
fi

