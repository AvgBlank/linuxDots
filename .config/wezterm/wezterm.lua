local wezterm = require("wezterm")

local config = wezterm.config_builder()

config = {
  automatically_reload_config = true,
  enable_tab_bar = false,
  window_close_confirmation = "NeverPrompt",
  color_scheme = "Catppuccin Mocha",
  default_cursor_style = "BlinkingBar",
  font = wezterm.font("JetBrainsMono Nerd Font"),
  font_size = 12.5,
  window_background_opacity = 0.95;
  window_padding = {
    left = 0,
    right = 0,
    top = 0,
    bottom = 0,
  }
}
return config
