### Making sure they all exist ###
### Cloning them if they do not ###
# Yellow color code
YELLOW='\033[1;33m'
# No color code
NC='\033[0m'
## Auto Suggestions ##
if [ ! -d "$HOME/.zsh-plugins/zsh-autosuggestions" ]; then
    echo "${YELLOW}zsh-autosuggestions plugin does not exist. Cloning plugin...${NC}"
    mkdir -p "$HOME/.zsh-plugins"
    cd "$HOME/.zsh-plugins" || exit
    git clone https://github.com/zsh-users/zsh-autosuggestions
    cd "$HOME"
fi
## Syntax Highlighting ##
if [ ! -d "$HOME/.zsh-plugins/zsh-syntax-highlighting" ]; then
    echo "${YELLOW}zsh-syntax-highlighting plugin does not exist. Cloning plugin...${NC}"
    mkdir -p "$HOME/.zsh-plugins"
    cd "$HOME/.zsh-plugins" || exit
    git clone https://github.com/zsh-users/zsh-syntax-highlighting.git
    cd "$HOME"
fi
## History Substring Search ##
if [ ! -d "$HOME/.zsh-plugins/zsh-history-substring-search" ]; then
    echo "${YELLOW}history-substring-search plugin does not exist. Cloning plugin...${NC}"
    mkdir -p "$HOME/.zsh-plugins"
    cd "$HOME/.zsh-plugins" || exit
    git clone https://github.com/zsh-users/zsh-history-substring-search
    cd "$HOME"
fi


#### Autosuggestions press -> (right arrow) to activate ####
source ~/.zsh-plugins/zsh-autosuggestions/zsh-autosuggestions.zsh
#### Syntax Highlighting ####
source ~/.zsh-plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
#### History Substring Search ####
source ~/.zsh-plugins/zsh-history-substring-search/zsh-history-substring-search.zsh
## Non-Case sensitive searching ##
autoload -Uz compinit && compinit
zstyle ':completion:*' matcher-list 'm:{a-z}={A-Za-z}'
