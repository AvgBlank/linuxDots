"""Concrete manipulator lists for each Karabiner keymap."""

from .common import (
    application_condition,
    key_condition,
    key_pair_manipulators,
    manipulator,
    same_key_manipulators,
)

TERMINALS = [
    r"^net\.kovidgoyal\.kitty$",
    r"^com\.mitchellh\.ghostty$",
    r"^com\.github\.wez\.wezterm$",
]
BROWSERS = [
    r"^company\.thebrowser\.Browser$",
    r"^com\.google\.Chrome$",
    r"^com\.microsoft\.edgemac$",
    r"^com\.brave\.Browser$",
    r"^app\.zen-browser\.zen$",
    r"^app\.floorp\.Floorp$",
]
SPOTIFY = [r"^com\.spotify\.client$"]
MINECRAFT_BUNDLE_IDS = [r"^com\.azul\.zulu\.java$"]
KEYBOARD = {"is_keyboard": True, "product_id": 247, "vendor_id": 13027}  # HK GK 61

INTERNAL_DEVICE = [key_condition(KEYBOARD)]
EXTERNAL_DEVICE = [key_condition(KEYBOARD, "device_if")]
TERMINAL_UNLESS_INTERNAL = INTERNAL_DEVICE + [
    application_condition(TERMINALS, "frontmost_application_unless")
]
TERMINAL_IF_INTERNAL = INTERNAL_DEVICE + [
    application_condition(TERMINALS, "frontmost_application_if")
]
BROWSER_INTERNAL = INTERNAL_DEVICE + [
    application_condition(BROWSERS, "frontmost_application_if")
]
BROWSER_EXTERNAL = EXTERNAL_DEVICE + [
    application_condition(BROWSERS, "frontmost_application_if")
]
SPOTIFY_INTERNAL = INTERNAL_DEVICE + [
    application_condition(SPOTIFY, "frontmost_application_if")
]
SPOTIFY_EXTERNAL = EXTERNAL_DEVICE + [
    application_condition(SPOTIFY, "frontmost_application_if")
]
MINECRAFT_EXTERNAL = EXTERNAL_DEVICE + [
    application_condition(MINECRAFT_BUNDLE_IDS, "frontmost_application_if")
]
FINDER_CONDITIONS = [
    application_condition([r"^com.apple.finder$"], "frontmost_application_if")
]

FUNCTION_KEY_REMAPS = [
    *same_key_manipulators(
        list("cv"),
        {"mandatory": ["fn", "left_shift"]},
        ["left_command"],
        INTERNAL_DEVICE,
    ),
    *key_pair_manipulators(
        [
            ["caps_lock", "delete_forward"],
            ["delete_or_backspace", "delete_or_backspace"],
        ],
        {"mandatory": ["fn"]},
        ["left_option"],
        INTERNAL_DEVICE,
    ),
    *same_key_manipulators(
        ["tab"],
        {"mandatory": ["fn", "left_shift"]},
        ["left_control", "left_shift"],
        INTERNAL_DEVICE,
    ),
    *same_key_manipulators(
        ["tab"], {"mandatory": ["fn"]}, ["left_control"], INTERNAL_DEVICE
    ),
]

FUNCTION_KEY_REMAPS_NON_TERMINAL = same_key_manipulators(
    list("zwtacxv"),
    {"mandatory": ["fn"]},
    ["left_command"],
    TERMINAL_UNLESS_INTERNAL,
)

TERMINAL_ONLY_REMAPS = [
    *same_key_manipulators(
        list("tzvac"),
        {"mandatory": ["fn"]},
        ["left_control"],
        TERMINAL_IF_INTERNAL,
    ),
    *same_key_manipulators(
        list("werqtuiopg"),
        {"mandatory": ["left_command"]},
        ["left_option"],
        TERMINAL_IF_INTERNAL,
    ),
    *same_key_manipulators(
        list("123456789"),
        {"mandatory": ["left_command"], "optional": ["shift"]},
        ["left_option"],
        TERMINAL_IF_INTERNAL,
    ),
]

CONTROL_KEY_REMAPS = [
    manipulator(
        "v",
        {"mandatory": ["left_control"]},
        to=[{"key_code": "v", "modifiers": ["left_control", "left_option"]}],
        conditions=INTERNAL_DEVICE,
    ),
]

FINDER_REMAPS = [
    manipulator(
        "caps_lock",
        {"mandatory": ["left_shift"]},
        to=[
            {
                "key_code": "delete_or_backspace",
                "modifiers": ["left_command", "left_option"],
            }
        ],
        conditions=FINDER_CONDITIONS,
    ),
    manipulator(
        "caps_lock",
        to=[{"key_code": "delete_or_backspace", "modifiers": ["left_command"]}],
        conditions=FINDER_CONDITIONS,
    ),
]

BROWSER_INTERNAL_REMAPS = [
    *same_key_manipulators(
        [
            "return_or_enter",
            "f",
            "l",
            "k",
            "r",
            "1",
            "2",
            "3",
            "4",
            "5",
            "6",
            "7",
            "8",
            "9",
        ],
        {"mandatory": ["fn"]},
        ["left_command"],
        BROWSER_INTERNAL,
    ),
    *key_pair_manipulators(
        [
            ["1", "i"],
            ["2", "o"],
            ["3", "p"],
            ["4", "j"],
            ["5", "k"],
        ],
        {"mandatory": ["left_command"]},
        ["left_control"],
        BROWSER_INTERNAL,
    ),
]

BROWSER_EXTERNAL_REMAPS = [
    *same_key_manipulators(
        [
            "return_or_enter",
            "f",
            "l",
            "k",
            "r",
            "1",
            "2",
            "3",
            "4",
            "5",
            "6",
            "7",
            "8",
            "9",
        ],
        {"mandatory": ["left_control"]},
        ["left_command"],
        BROWSER_EXTERNAL,
    ),
    *key_pair_manipulators(
        [
            ["1", "i"],
            ["2", "o"],
            ["3", "p"],
            ["4", "j"],
            ["5", "k"],
        ],
        {"mandatory": ["left_option"]},
        ["left_control"],
        BROWSER_EXTERNAL,
    ),
]

SPOTIFY_INTERNAL_REMAPS = same_key_manipulators(
    list("lkf"), {"mandatory": ["fn"]}, ["left_command"], SPOTIFY_INTERNAL
)
SPOTIFY_EXTERNAL_REMAPS = same_key_manipulators(
    list("lkf"), {"mandatory": ["left_control"]}, ["left_command"], SPOTIFY_EXTERNAL
)

ARROW_INTERNAL_REMAPS = [
    *key_pair_manipulators(
        [
            ["h", "left_arrow"],
            ["j", "down_arrow"],
            ["k", "up_arrow"],
            ["l", "right_arrow"],
        ],
        {"mandatory": ["fn", "left_command"]},
        ["left_option"],
        INTERNAL_DEVICE,
    ),
    *key_pair_manipulators(
        [
            ["h", "left_arrow"],
            ["j", "down_arrow"],
            ["k", "up_arrow"],
            ["l", "right_arrow"],
        ],
        {"mandatory": ["left_command"]},
        None,
        INTERNAL_DEVICE,
    ),
    *same_key_manipulators(
        ["right_arrow", "left_arrow"],
        {"mandatory": ["fn"]},
        ["left_option"],
        INTERNAL_DEVICE,
    ),
]

ARROW_EXTERNAL_REMAPS = [
    *key_pair_manipulators(
        [
            ["h", "left_arrow"],
            ["j", "down_arrow"],
            ["k", "up_arrow"],
            ["l", "right_arrow"],
        ],
        {"mandatory": ["left_control", "left_option"]},
        ["left_option"],
        EXTERNAL_DEVICE,
    ),
    *key_pair_manipulators(
        [
            ["h", "left_arrow"],
            ["j", "down_arrow"],
            ["k", "up_arrow"],
            ["l", "right_arrow"],
        ],
        {"mandatory": ["left_option"]},
        None,
        EXTERNAL_DEVICE,
    ),
    *same_key_manipulators(
        ["right_arrow", "left_arrow"],
        {"mandatory": ["left_control"]},
        ["left_option"],
        EXTERNAL_DEVICE,
    ),
]

SWAP_DESKTOPS_MONITORS = [
    *key_pair_manipulators(
        [["comma", "left_arrow"], ["period", "right_arrow"]],
        {"mandatory": ["left_control", "left_shift"]},
        ["left_control", "left_option", "left_command"],
        INTERNAL_DEVICE,
    ),
    *key_pair_manipulators(
        [["comma", "left_arrow"], ["period", "right_arrow"]],
        {"mandatory": ["fn", "left_control"]},
        ["left_control"],
        INTERNAL_DEVICE,
    ),
]

LAUNCH_INTERNAL_REMAPS = [
    manipulator(
        "return_or_enter",
        {"mandatory": ["left_control", "left_shift"]},
        to=[{"key_code": "spacebar", "modifiers": ["left_command"]}],
        conditions=INTERNAL_DEVICE,
    ),
    manipulator(
        "m",
        {"mandatory": ["left_control", "left_shift"]},
        to=[{"shell_command": "open -a 'Mission Control'"}],
        conditions=INTERNAL_DEVICE,
    ),
    manipulator(
        "e",
        {"mandatory": ["left_control"]},
        to=[{"shell_command": "open -a Finder"}],
        conditions=INTERNAL_DEVICE,
    ),
    manipulator(
        "return_or_enter",
        {"mandatory": ["left_control"]},
        to=[{"shell_command": "open -a ghostty"}],
        conditions=INTERNAL_DEVICE,
    ),
    manipulator(
        "b",
        {"mandatory": ["left_control", "fn"]},
        to=[{"shell_command": "open -a 'Microsoft Edge'"}],
        conditions=INTERNAL_DEVICE,
    ),
    manipulator(
        "d",
        {"mandatory": ["left_control", "fn"]},
        to=[{"shell_command": "open -a discord"}],
        conditions=INTERNAL_DEVICE,
    ),
]

LAUNCH_EXTERNAL_REMAPS = [
    manipulator(
        "return_or_enter",
        {"mandatory": ["left_command", "left_shift"]},
        to=[{"key_code": "spacebar", "modifiers": ["left_command"]}],
        conditions=EXTERNAL_DEVICE,
    ),
    manipulator(
        "m",
        {"mandatory": ["left_command", "left_shift"]},
        to=[{"shell_command": "open -a 'Mission Control'"}],
        conditions=EXTERNAL_DEVICE,
    ),
    manipulator(
        "e",
        {"mandatory": ["left_command"]},
        to=[{"shell_command": "open -a Finder"}],
        conditions=EXTERNAL_DEVICE,
    ),
    manipulator(
        "return_or_enter",
        {"mandatory": ["left_command"]},
        to=[{"shell_command": "open -a ghostty"}],
        conditions=EXTERNAL_DEVICE,
    ),
    manipulator(
        "b",
        {"mandatory": ["left_control", "left_command"]},
        to=[{"shell_command": "open -a 'Microsoft Edge'"}],
        conditions=EXTERNAL_DEVICE,
    ),
    manipulator(
        "d",
        {"mandatory": ["left_control", "left_command"]},
        to=[{"shell_command": "open -a discord"}],
        conditions=EXTERNAL_DEVICE,
    ),
]

CLOSE_INTERNAL_REMAPS = key_pair_manipulators(
    [["c", "w"], ["w", "q"]],
    {"mandatory": ["left_control", "left_shift"]},
    ["left_command"],
    INTERNAL_DEVICE,
)
CLOSE_EXTERNAL_REMAPS = key_pair_manipulators(
    [["c", "w"], ["w", "q"]],
    {"mandatory": ["left_command", "left_shift"]},
    ["left_command"],
    EXTERNAL_DEVICE,
)
RECTANGLE_INTERNAL_REMAPS = key_pair_manipulators(
    [["t", "return_or_enter"], ["f", "return_or_enter"]],
    {"mandatory": ["left_shift", "left_control"]},
    ["left_option", "left_control"],
    INTERNAL_DEVICE,
)
RECTANGLE_EXTERNAL_REMAPS = key_pair_manipulators(
    [["t", "return_or_enter"]],
    {"mandatory": ["left_shift", "left_command"]},
    ["left_option", "left_control"],
    EXTERNAL_DEVICE,
)
VIM_TMUX_REMAPS = same_key_manipulators(
    list("exrdu bwfhjklsanpyg".replace(" ", "")),
    {"mandatory": ["fn"]},
    ["left_control"],
    INTERNAL_DEVICE,
)
MISC_REMAPS = [manipulator("caps_lock", to=[{"key_code": "delete_forward"}])]
MINECRAFT_INTERNAL_REMAPS = same_key_manipulators(
    list("q"),
    {"mandatory": ["fn"]},
    ["left_command"],
    INTERNAL_DEVICE
    + [application_condition(MINECRAFT_BUNDLE_IDS, "frontmost_application_if")],
)

SWAP_DESKTOPS_MONITORS_EXTERNAL_REMAPS = [
    *key_pair_manipulators(
        [["comma", "left_arrow"], ["period", "right_arrow"]],
        {"mandatory": ["left_command", "left_shift"]},
        ["left_control", "left_option", "left_command"],
        EXTERNAL_DEVICE,
    ),
    *same_key_manipulators(
        list("1234567890"),
        {"mandatory": ["left_command"]},
        ["left_control"],
        EXTERNAL_DEVICE,
    ),
    *key_pair_manipulators(
        [["comma", "left_arrow"], ["period", "right_arrow"]],
        {"mandatory": ["left_command", "left_control"]},
        ["left_control"],
        EXTERNAL_DEVICE,
    ),
]

RAYCAST_EXTERNAL_REMAPS = [
    *same_key_manipulators(
        list("v"),
        {"mandatory": ["left_command", "left_shift"]},
        ["left_control", "left_shift"],
        EXTERNAL_DEVICE,
    ),
    *same_key_manipulators(
        ["period"], {"mandatory": ["left_command"]}, ["left_control"], EXTERNAL_DEVICE
    ),
]
CONTROL_KEY_REMAPS_EXTERNAL = [
    *same_key_manipulators(
        list("cv"),
        {"mandatory": ["left_control", "left_shift"]},
        ["left_command"],
        EXTERNAL_DEVICE,
    ),
    *key_pair_manipulators(
        [
            ["caps_lock", "delete_forward"],
            ["delete_or_backspace", "delete_or_backspace"],
        ],
        {"mandatory": ["left_control"]},
        ["left_option"],
        EXTERNAL_DEVICE,
    ),
]
CONTROL_KEY_REMAPS_EXTERNAL_NON_TERMINAL = same_key_manipulators(
    list("zwtacxv"),
    {"mandatory": ["left_control"]},
    ["left_command"],
    EXTERNAL_DEVICE
    + [application_condition(TERMINALS, "frontmost_application_unless")],
)
MINECRAFT_EXTERNAL_REMAPS = [
    manipulator(
        "q",
        {"mandatory": ["left_control"]},
        to=[{"key_code": "q", "modifiers": ["left_command"]}],
        conditions=MINECRAFT_EXTERNAL,
    ),
    manipulator(
        "delete_or_backspace",
        {"mandatory": ["left_control"]},
        to=[{"key_code": "delete_or_backspace", "modifiers": ["left_command"]}],
        conditions=MINECRAFT_EXTERNAL,
    ),
]
