import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { settings, setShared, shared } from "herdr";
import { button as drawButton } from "./button.js";
import { glow } from "./tip.js";
import { PANE, LU, COMPACT, MODEL_ROW, zoom, pickMark, searchField, popupClosed } from "./review-menu.js";
import { subPlace } from "./submenu.js";
import { opener } from "./trigger.js";
import { alpha } from "./color.js";
export { PANE, LU, COMPACT, MODEL_ROW, zoom, pickMark, searchField };

// The toolbar, 32 high, not T3's 40: its row's centre falls on the work column's pane header's (40 of tabs, 2 of border, half
// of 28), so the two read as one line (docs/internals/specs/review.md). Its menus hang 4 under its 28 buttons, centred in it.
export const HEADER = 32, BELOW = HEADER / 2 + 28 / 2 + 4;

// The page's popovers (settings, status, the scope menu and its submenu): drawn inside the pane, not popups. A press outside
// one closes it, unless it's on its submenu (`subRect`, subAt).
export function popover(view, t, id, closes = true) {
  return v_flex().id(id).rounded(8).bg(t.popover).border_1().border_color(t.border).text_size(14).shadow_lg()
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_scroll_wheel((_e, cx) => cx.stop_propagation())
    .when(closes, el => el.on_mouse_down_out((e, cx) => { if (!inSub(view, e)) view.closePopup(cx, true); }));
}

export function toPane(view, e) {
  const z = zoom(), o = view.paneAt ?? { x: 0, y: 0 }, b = e.bounds;
  return { position: { x: (e.position.x - o.x) / z, y: (e.position.y - o.y) / z },
    bounds: b && { x: (b.x - o.x) / z, y: (b.y - o.y) / z, width: b.width / z, height: b.height / z } };
}

function inSub(view, e) {
  const r = view.subRect, p = r && toPane(view, e).position;
  return Boolean(r) && p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

export const subState = view => (view.subHover ??= {});

/** A submenu `max` wide at most, `h` tall, beside `row` (in the pane) as submenu.js subPlace puts one, 8 short of the pane's
 *  ends: narrower where there's less room, never over the row. Kept inside the pane's height. */
export function subAt(view, row, max, h) {
  const p = subPlace(row, max, 8, view.width - 8), w = p.width, x = p.x, y = Math.max(8, Math.min(p.y, view.height - h - 8));
  view.subRect = { x, y, width: w, height: h };
  Object.assign(subState(view), { sub: view.subRect, side: p.side });
  return { at: div().id("review-sub-at").absolute().left(x).top(y), w };
}

// Preferences every review pane shares: a pane's localStorage is its own, so a new pane would start from the defaults.
const PREFS = `${PANE}.prefs`;
export const pref = (key) => shared(PREFS)?.[key];
export const setPref = (key, value) => setShared(PREFS, { ...shared(PREFS), [key]: value });
// The code's font, the window's terminal font: only the diff's code and hunk headers are in it.
export const mono = () => /** @type {string} */ (settings().font_family);

// A light theme takes the darker hues, as the app's `dark:` variants switch them.
export const isLight = (hex) => { const n = parseInt(String(hex).slice(1, 7), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.5; };

// @antfu/design's opacities: op-fade for what waits for a hover, op-disabled; and its segment track and raised pill.
export const FADED = 0.65, DISABLED = 0.3;

// Responsive widths, the app's: split from SPLIT_MIN of diff (its MIN_SPLIT_WIDTH_PX; narrower, unified, the choice kept).
// Under COMPACT the header's text buttons are icons.
export const SPLIT_MIN = 640;

// The reviewed box, drawn as the app's ReviewCheckbox: checked, partly (a folder), or not. Handlers are the caller's.
// State "all", "some", "none", or "changed" (reviewed, then changed: the app's orange half mark).
export function checkMark(t, state) {
  const fill = state === "changed" ? "#f97316" : state === "none" ? null : t.accent;
  // dark:bg-input/32: 32% of `input`, which can already be translucent (color.js alpha scales its own).
  const wash = alpha(t.input, "52");
  // Unchecked, as T3's Checkbox (border-input, dark:bg-input/32): `raised` would vanish on a `selected` row.
  return div().size(16).flex_none().rounded(4).border_1().border_color(fill ?? t.input).bg(fill ?? wash)
    .flex().items_center().justify_center().text_color(state === "changed" ? "#ffffff" : t.accent_foreground)
    .when(state === "all", el => el.child(svg("mods/review/icons/check.svg").size(12)))
    .when(state === "some" || state === "changed", el => el.child(svg("mods/review/icons/minus.svg").size(12)));
}

// The pane's xs buttons; `note` stays dim after the label. `pops`: the popover it toggles, on while it's open (trigger.js).
export function button(view, t, id, label, action, { color, icon, iconSize, after, primary, note, pops, size = "xs", surface = "card" } = /** @type {{ color?: any, icon?: any, iconSize?: number, after?: any, primary?: boolean, note?: any, pops?: string, size?: "sm" | "xs", surface?: "chrome" | "card" }} */ ({})) {
  const el = drawButton(t, id, { variant: primary ? "primary" : "plain", text: label, icon, iconSize, color, size, surface, hot: view.hot === id, on: Boolean(pops) && view.popup === pops })
    .on_hover(glow(view, id));
  return (pops ? opener(view, { closed: popupClosed(pops), onOpen: (b, cx) => action(cx, !b) })(el)
    : el.on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => { cx.stop_propagation(); action(cx); }))
    .when(Boolean(note), el => el.child(div().opacity(FADED).child(note)))
    .when(Boolean(after), el => el.child(svg(after).size(14).flex_none()));
}

// As the app's DiffStats, each only when there are any, measured as T3's DiffStatLabel.
export function diffStats(t, added, deleted) {
  return h_flex().flex_none().gap(4)
    .when(added > 0, el => el.child(div().text_color(t.ansi2).child(`+${added.toLocaleString()}`)))
    .when(deleted > 0, el => el.child(div().text_color(t.ansi1).child(`-${deleted.toLocaleString()}`)));
}
