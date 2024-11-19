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

