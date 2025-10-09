#### Nix Packages ####
if [ -f $HOME/.nix-profile/etc/profile.d/nix.sh ]; then
    source $HOME/.nix-profile/etc/profile.d/nix.sh
fi

#### Linuxbrew Packages ####
if [ -d "/home/linuxbrew/.linuxbrew" ]; then
    eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
fi
if [ -d "/home/linuxbrew/.linuxbrew/opt/postgresql@17" ]; then
    export PATH="/home/linuxbrew/.linuxbrew/opt/postgresql@17/bin:$PATH"
fi

#### Homebrew Arm MacOS ####
if [ -d "/opt/homebrew/bin" ]; then
    export PATH="/opt/homebrew/bin:$PATH"
    export CPATH="/opt/homebrew/include:$CPATH"
    export LIBRARY_PATH="/opt/homebrew/lib:$LIBRARY_PATH"
fi

