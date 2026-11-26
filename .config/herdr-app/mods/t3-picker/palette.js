// The layout's keycaps (Home, the panel's empty page, Go to and New) and the command palettes' footer (Go to, New), as T3's
// Kbd (`ui/kbd.tsx`) and CommandPalette's footer.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { alpha } from "./color.js";

/** T3's Kbd, one for the whole layout, on a faint wash of the text. */
export const keycap = (t, label) => div().min_w(20).h(20).px(4).flex().flex_none().items_center().justify_center().rounded(4)
  .bg(alpha(t.foreground, "12")).text_size(12).font_medium().text_color(alpha(t.foreground, "bf")).child(label);

/** T3's CommandFooterAction: no fill of its own, its words brighten. The caller adds what it does and shows. */
export const footAction = (t, id, label) => h_flex().id(id).gap(4).px(8).rounded(8).items_center().flex_none().text_size(12).line_height("16px")
  .role("button").accessibility_label(label).hover((s) => s.text_color(t.foreground));

/** A palette's footer: `hints`, [keys, what] (keys split on spaces, a keycap each), then `end` (a footAction) on the right. */
export const paletteFooter = (t, hints, end) => h_flex().flex_none().px(16).py(10).gap(8).items_center().justify_between().rounded_b(15)
  .border_t(1).border_color(alpha(t.foreground, "12")).bg(alpha(t.foreground, "06")).font_medium().text_color(t.muted)
  .child(h_flex().gap(12).items_center().children(hints.map(([keys, what]) => h_flex().gap(4).items_center().children(keys.split(" ").map((k) => keycap(t, k))).child(what))))
  .child(end);
