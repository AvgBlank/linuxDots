// T3's dialog pieces, for the editor, the confirmation and Clean up.
import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { stop } from "./focus.js";
import { button, radiusOf } from "./button.js";

// T3's dialog: 512 wide (max-w-lg) and as tall as its content. Its 16px corners are more than the app's frame has, so it opens frame: "none" and draws them.
export const dialog = (id, t) => v_flex().id(id).size_full().relative().rounded(16).border(1).border_color(t.border).bg(t.popover).shadow_2xl().text_size(14).line_height("20px");
export const dialogTitle = (t, text) => div().text_size(20).line_height("27.5px").font_semibold().text_color(t.foreground).child(text);
export const dialogButton = (view, t, id, text, variant, act, disabled = false) => stop(view, t, id,
  button(t, id, { text, variant, size: "default", surface: "card", disabled }).when(!disabled, el => el.cursor_pointer().on_click(act)), radiusOf("default"));
