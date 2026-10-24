"""Ordered association of rule descriptions with concrete keymaps."""

from .common import rule
from .keymaps import (
    ARROW_EXTERNAL_REMAPS,
    ARROW_INTERNAL_REMAPS,
    BROWSER_EXTERNAL_REMAPS,
    BROWSER_INTERNAL_REMAPS,
    CLOSE_EXTERNAL_REMAPS,
    CLOSE_INTERNAL_REMAPS,
    CONTROL_KEY_REMAPS,
    CONTROL_KEY_REMAPS_EXTERNAL,
    CONTROL_KEY_REMAPS_EXTERNAL_NON_TERMINAL,
    FINDER_REMAPS,
    FUNCTION_KEY_REMAPS,
    FUNCTION_KEY_REMAPS_NON_TERMINAL,
    LAUNCH_EXTERNAL_REMAPS,
    LAUNCH_INTERNAL_REMAPS,
    MINECRAFT_EXTERNAL_REMAPS,
    MINECRAFT_INTERNAL_REMAPS,
    MISC_REMAPS,
    RAYCAST_EXTERNAL_REMAPS,
    RECTANGLE_EXTERNAL_REMAPS,
    RECTANGLE_INTERNAL_REMAPS,
    SPOTIFY_EXTERNAL_REMAPS,
    SPOTIFY_INTERNAL_REMAPS,
    SWAP_DESKTOPS_MONITORS,
    SWAP_DESKTOPS_MONITORS_EXTERNAL_REMAPS,
    TERMINAL_ONLY_REMAPS,
    VIM_TMUX_REMAPS,
)

RULES = [
    rule("Function Key Remaps", FUNCTION_KEY_REMAPS),
    rule(
        "Function Key Remaps that don't work in terminal",
        FUNCTION_KEY_REMAPS_NON_TERMINAL,
    ),
    rule("Terminal only Remaps", TERMINAL_ONLY_REMAPS),
    rule("Control Key Remaps", CONTROL_KEY_REMAPS),
    rule("Finder only Remaps", FINDER_REMAPS),
    rule("Browser only Remaps", BROWSER_INTERNAL_REMAPS),
    rule("Spotify only Remaps", SPOTIFY_INTERNAL_REMAPS),
    rule("Arrow key Remaps", ARROW_INTERNAL_REMAPS),
    rule("Swap Desktops / Monitors", SWAP_DESKTOPS_MONITORS),
    rule("Launch Apps", LAUNCH_INTERNAL_REMAPS),
    rule("Close Apps", CLOSE_INTERNAL_REMAPS),
    rule("For Rectangle Users!!", RECTANGLE_INTERNAL_REMAPS),
    rule("For Vim and tmux Users!!", VIM_TMUX_REMAPS),
    rule("Misc Remaps", MISC_REMAPS),
    rule("For Minecraft Gamers!!", MINECRAFT_INTERNAL_REMAPS),
    rule(
        "Swap Desktops / Monitors -- External Keyboard",
        SWAP_DESKTOPS_MONITORS_EXTERNAL_REMAPS,
    ),
    rule("Raycast Remaps -- External Keyboard", RAYCAST_EXTERNAL_REMAPS),
    rule("Control Key Remaps -- External Keyboard", CONTROL_KEY_REMAPS_EXTERNAL),
    rule(
        "Control Key Remaps that don't work in terminal -- External Keyboard",
        CONTROL_KEY_REMAPS_EXTERNAL_NON_TERMINAL,
    ),
    rule("Browser only Remaps -- External Keyboard", BROWSER_EXTERNAL_REMAPS),
    rule("Spotify only Remaps -- External Keyboard", SPOTIFY_EXTERNAL_REMAPS),
    rule("Arrow key Remaps -- External Keyboard", ARROW_EXTERNAL_REMAPS),
    rule("Launch Apps -- External Keyboard", LAUNCH_EXTERNAL_REMAPS),
    rule("Close Apps -- External Keyboard", CLOSE_EXTERNAL_REMAPS),
    rule("For Rectangle Users!! -- External Keyboard", RECTANGLE_EXTERNAL_REMAPS),
    rule("For Minecraft Gamers!! -- External Keyboard", MINECRAFT_EXTERNAL_REMAPS),
]


def build_rules() -> list[dict]:
    return RULES
