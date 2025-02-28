#!/bin/bash

# Parse the input arguments
while getopts "d:f:r:" opt; do
    case "$opt" in
        d) dir=$OPTARG ;;
        f) fileName=$OPTARG ;;
        r) runwith=$OPTARG ;;
    esac
done

# Navigate to the specified directory
cd "$dir" || exit

# Clear the screen
clear

# Yellow color code
YELLOW='\033[1;33m'
# No color code
NC='\033[0m'

fileNameWithoutExt="${fileName%.*}"

# Print the running message
case $runwith in
    d)
        echo -e "${YELLOW}[Running] npm run dev${NC}"
        echo -e "${YELLOW}$(printf '%*s' 75 | tr ' ' -)${NC}"
        npm run dev
        ;;
    b)
        echo -e "${YELLOW}[Running] npm run dev${NC}"
        echo -e "${YELLOW}$(printf '%*s' 75 | tr ' ' -)${NC}"
        npm run build
        ;;
    s)
        echo -e "${YELLOW}[Running] npm run dev${NC}"
        echo -e "${YELLOW}$(printf '%*s' 75 | tr ' ' -)${NC}"
        npm start
        ;;
    c)
        echo -e "${YELLOW}[Running] tsc \"$dir/$fileName\"${NC}"
        echo -e "${YELLOW}$(printf '%*s' 75 | tr ' ' -)${NC}"
        tsc "$fileName"
        echo "Compiled $fileName."
        ;;
    *)
        echo -e "${YELLOW}[Running] tsc${NC}"
        echo -e "${YELLOW}$(printf '%*s' 75 | tr ' ' -)${NC}"
        tsc
        echo "Compiled all TypeScript files."
        ;;
esac
