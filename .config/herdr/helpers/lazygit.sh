#!/bin/sh

# Run inside the native Herdr popup, using the underlying pane's directory.
if ! command -v lazygit >/dev/null 2>&1; then
    printf '%s\n' 'lazygit is not installed or is missing from PATH.' >&2
    printf '%s' 'Press Enter to close. '
    IFS= read -r response
    exit 127
fi

cd -- "${HERDR_ACTIVE_PANE_CWD:-$PWD}" || exit
exec lazygit "$@"
