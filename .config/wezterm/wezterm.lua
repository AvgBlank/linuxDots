local wezterm = require("wezterm")

local config = wezterm.config_builder()

config = {
  automatically_reload_config = true,
  enable_tab_bar = false,
  window_close_confirmation = "NeverPrompt",

  color_scheme = "Catppuccin Mocha",
  default_cursor_style = "BlinkingBar",

  font = wezterm.font("JetBrainsMono Nerd Font"),
  font_size = 13,

  -- Hide title bar
  -- window_decorations = "RESIZE",
  window_frame = {
    active_titlebar_bg = 'none',
    inactive_titlebar_bg = 'none',
  },

  window_background_opacity = 0.90,
  window_padding = {
    left = 2,
    right = 2,
    top = 10,
    bottom = 2,
  }
}
return config
