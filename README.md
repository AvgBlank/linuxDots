# Linux Dotfiles

To clone the repository, run the following command:

```sh
git clone https://github.com/AvgBlank/dotfiles"
```

## Installing :-

To install all the config files, if you're on arch linux, just run:

```sh
curl -s -L https://raw.githubusercontent.com/AverageBlank/Dotfiles/Master/Linux/Import-All-Configs.sh | bash
```

## Vim :-

For the plugins to work, you need to install a plugin manager.
The plugin manager used is Vim Plug, to install run the following command:

```sh
curl -fLo ~/.vim/autoload/plug.vim --create-dirs \
    https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim
```

If the vimrc is in the home folder, edit it using:

```sh
vvim ~/.vimrc
```

To install the plugins, run the following command:

```vim
:PlugInstall
```

Source the file by using the following command:

```vim
:source %
```

The above command is case sensitive.

## Neovim :-

For the plugins to work, you need to install a plugin manager.
The plugin manager used is Vim Plug, to install run the following command:

```sh
sh -c 'curl -fLo "${XDG_DATA_HOME:-$HOME/.local/share}"/nvim/site/autoload/plug.vim --create-dirs \
       https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim'
```

If the vimrc is in the correct folder, edit it using:

```sh
vim ~/.config/nvim/init.vim
```

To install the plugins, run the following command:

```vim
:PlugInstall
```

Source the file by using the following command:

```vim
:source %
```

The above command is case sensitive.

## Zsh:-

To setup zsh, you need to install it first.
Given below is installation for different distributions.

<b>Arch Linux:</b>

```sh
sudo pacman -S zsh
```

<b>Debian, Ubuntu:</b>

```sh
sudo apt-get install zsh
```

<b>Fedora:</b>

```sh
sudo dnf install zsh
```

To verify if zsh has been installed, run the following command:

```sh
zsh --version
```

### Starship:

Starship is the prompt used in zsh.
To install it, run the installation command for your distribution.

<b>Arch Linux:</b>

```sh
sudo pacman -S starship
```

<b>Using Snapcraft:</b>

```sh
sudo snap install starship
```

<b>Using Cargo:</b>

```sh
cargo install starship --loccked
```

<b>Other linux distributions: </b>

```sh
curl -sS https://starship.rs/install.sh | sh
```

### Shell Color Script:

A set of terminal color scripts that beautify the terminal.
To install it, run the installation command for your distribution.

<b>Arch Linux: </b>

If you have AUR set up, run the following command otherwise install it for other linux distributions:

```sh
yay -S shell-color-scripts
```

<b>Other linux distributions: </b>

```sh
git clone https://gitlab.com/dwt1/shell-color-scripts.git
cd shell-color-scripts
sudo make install
cd ..
rm -rf shell-color-scripts
```

### Zsh Plugins:

<b>Zsh Syntax Highlighting</b>

To use syntax highlighting, run the following commands:

```sh
mkdir -p ~/.zsh-plugins
cd ~/.zsh-plugins
git clone https://github.com/zsh-users/zsh-syntax-highlighting.git
```

<b>Zsh Auto Suggestions</b>

To get suggestions, run the following commands:

```sh
mkdir -p ~/.zsh-plugins
cd ~/.zsh-plugins
git clone https://github.com/zsh-users/zsh-autosuggestions
```

<b>History Substring Search</b>

To get history substring search, run the following commands:

```sh
mkdir -p ~/.zsh-plugins
cd ~/.zsh-plugins
git clone https://github.com/zsh-users/zsh-history-substring-search
```
