#### Terminal Utilities ####
# If eza exists
if command -v eza &> /dev/null; then
    alias ls='eza'
    alias l='eza -la --icons --git'
    alias ll='eza -la --icons --git'
    alias tree='eza --tree --level=2 --long --icons --git'
    # Long Listing with Octal Permissions
    alias lln="ls -la --octal-permissions"
else
    alias ls='ls --color=auto'
    alias l='ls'
    alias ll='ls -la'
    # Long Listing with Octal Permissions
    alias lln="ls -la | awk '{k=0;for(i=0;i<=8;i++)k+=((substr(\$1,i+2,1)~/[rwx]/)*2^(8-i));if(k)printf(\"%0o \",k);print}'"
fi

# If lazygit exists
if command -v lazygit &> /dev/null; then
    alias gs="lazygit"
fi

# If bat exists
if command -v bat &> /dev/null; then
    alias cat="bat"
fi


#### Setting Vim as NeoVim if exists ####
if command -v nvim &> /dev/null; then
    alias vvim='vi'
    alias vim='nvim'
    alias v='nvim'
fi


#### Grep With Better Colors ####
alias grep='grep --color=auto'


#### Package Managers ####
### Pacman ###
## Aliasing Pacman ##
alias pacman='sudo pacman --color auto'
alias sps='sudo pacman -S $1 --noconfirm'
alias spss='sudo pacman -Ss'
alias spr='sudo pacman -R $1 --noconfirm'
alias spq='sudo pacman -Q'
alias spu='sudo pacman -Syu --noconfirm'
## Unlocking Pacman ##
alias punlock='sudo rm /var/lib/pacman/db.lck'
## Using Yay as Paru ##
if command -v paru &> /dev/null; then
    alias yay='paru'
fi
## Aliasing Yay ##
alias yys='yay -S $1 --noconfirm'
alias yyss='yay -Ss'
alias yyr='yay -R $1 --noconfirm'
alias yyq='yay -Q'
alias yyu='yay -Syu --noconfirm'
## Updating the System ##
alias update='sudo pacman -Syu --noconfirm'
alias upall='yay -Syu --noconfirm'

### HomeBrew ###
## Aliasing brew ##
alias hbs='brew install $1'
alias hbss='brew search $1'
alias hbr='brew uninstall $1'
alias hbq='brew list'
alias hbu='brew upgrade'


#### Fastest Mirrors ####
alias mirror="sudo reflector -f 30 -l 30 --number 10 --verbose --save /etc/pacman.d/mirrorlist"
alias mirrors="sudo reflector --latest 30 --number 10 --sort score --save /etc/pacman.d/mirrorlist"
alias mirrorlist="sudo reflector --age 6 --latest 21 --fastest 21 --threads 21 --sort rate --protocol https --save /etc/pacman.d/mirrorlist"


#### Miscellaneous ####
## Calendar ##
alias caly="cal -y"
## Listing Users ##
alias userlist="cut -d: -f1 /etc/passwd"
## Update Grub Config ##
alias update-grub="sudo grub-mkconfig -o /boot/grub/grub.cfg"
alias grub-update="sudo grub-mkconfig -o /boot/grub/grub.cfg"
## Python ##
alias python="python3"
alias py="python3"
## Emacs ##
alias emacs="emacsclient -c -a 'emacs'"
## Iso ##
alias iso="cat /etc/dev-rel | awk -F '=' '/ISO/ {print $2}'"
## Shutdown/Reboot ##
alias ssn="sudo shutdown now"
alias sr="sudo reboot"
alias sfr="sudo systemctl reboot --firmware-setup"
## Superuser Do ##
alias fucking="sudo"
## Exit Terminal ##
alias kys="echo 'Fakyu, I also have feelings. ☹️'; sleep 1; exit"


####  Git ####
alias gss="git status"
alias ga="git add ."
alias gc="git commit -m"
alias gp="git push -u origin"
alias gpl="git pull"


####  Optimus Manager ####
alias oph='optimus-manager --switch hybrid --no-confirm'
alias opn='optimus-manager --switch nvidia --no-confirm'
alias opi='optimus-manager --switch integrated --no-confirm'
alias ops='optimus-manager --print-mode'


####  ArcoLinux ####
alias skel='cp -Rf ~/.config ~/.config-backup-$(date +%Y.%m.%d-%H.%M.%S)'
