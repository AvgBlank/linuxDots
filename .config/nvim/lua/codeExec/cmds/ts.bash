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
    v)
        echo -e "${YELLOW}[Running] npm run dev${NC}"
        echo -e "${YELLOW}$(printf '%*s' 75 | tr ' ' -)${NC}"
        npm run dev
        ;;
    *)
        echo -e "${YELLOW}[Running] tsc \"$dir/$fileName\" && node \"$dir/$fileNameWithoutExt.js\"${NC}"
        echo -e "${YELLOW}$(printf '%*s' 75 | tr ' ' -)${NC}"
        tsc "$fileName"
        node "$fileNameWithoutExt".js
        ;;
esac
