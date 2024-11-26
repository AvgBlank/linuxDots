#!/bin/bash

# Parse the input arguments
while getopts "d:f:r:" opt; do
    case "$opt" in
        d) dir=$OPTARG ;;
        f) fileName=$OPTARG ;;
        r) runwith=$OPTARG ;;
    esac
done

# Remove the parsed options from the arguments list
shift $((OPTIND-1))

# C++ Version
ver="-std=c++17" # C++ 17
# ver="-std=c++14" # C++ 14

# Store any additional arguments to pass to the compiled program
program_args=("$@")
unset 'program_args[${#program_args[@]}-1]' 2>/dev/null

# Change to the specified directory
cd "$dir" || exit

# Join the directory and file name to create the new directory path
newDir="$dir/$fileName"

# Determine the file name without extension
fileNameWithoutExt="${fileName%.*}"

if [[ "$dir" == *src* ]]; then
    cd ..
    printDir="${dir/src/build}/$fileNameWithoutExt"
else
    printDir="$dir/build/$fileNameWithoutExt"
fi

# Clear the screen
clear

# Color Codes
YELLOW='\033[1;33m'
NC='\033[0m'

case $runwith in
    r)
        echo -e "${YELLOW}[Running] \"$printDir\"\n$(printf '%*s' 75 | tr ' ' -)${NC}"
        "./build/$fileNameWithoutExt" "${program_args[@]}"
        ;;
    b)
        mkdir -p build
        echo -e "${YELLOW}[Rebuilding] \"$newDir\"\n$(printf '%*s' 75 | tr ' ' -)${NC}"
        if [ -f "./build/$fileNameWithoutExt" ]; then
            rm "./build/$fileNameWithoutExt"
        fi
        g++ $ver "$newDir" -o "./build/$fileNameWithoutExt"
        echo "Compiled to: \"$printDir\""
        ;;
    d)
        mkdir -p build
        echo -e "${YELLOW}[Debug Compiling] \"$newDir\"\n$(printf '%*s' 75 | tr ' ' -)${NC}"
        g++ $ver -g "$newDir" -o "./build/$fileNameWithoutExt"
        echo "Compiled to: \"$printDir\""
        ;;
    c)
        mkdir -p build
        echo -e "${YELLOW}[Compiling] \"$newDir\"\n$(printf '%*s' 75 | tr ' ' -)${NC}"
        g++ $ver "$newDir" -o "./build/$fileNameWithoutExt"
        echo "Compiled to: \"$printDir\""
        ;;
    *)
        mkdir -p build
        echo -e "${YELLOW}[Compiling and Running] \"$newDir\"\n$(printf '%*s' 75 | tr ' ' -)${NC}"
        if [ -f "./build/$fileNameWithoutExt" ]; then
            rm "./build/$fileNameWithoutExt"
        fi
        g++ $ver "$newDir" -o "./build/$fileNameWithoutExt"
        "./build/$fileNameWithoutExt" "${program_args[@]}"
        ;;
esac
