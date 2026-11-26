// What the Review page and Details' Review row draw alike: their names, the radio's check and a menu's search field.
import { div, svg } from "gpui-kit";
import { h_flex, Input } from "gpui-base";
import { settings } from "herdr";
import { closedKey } from "./store.js";

export const PANE = "review", LU = "mods/review/icons", COMPACT = 640, MODEL_ROW = 28;
export const zoom = () => Number(settings()?.zoom) || 1;
// Stamped as the Review page's popover `name` closes to a press outside it, for the button that opened it (trigger.js); another's
// button still opens its own. One key for every Review tab: two presses a moment apart in two of them can't both be on a button.
export const popupClosed = (name) => closedKey(PANE, name);

// `icons`: the drawing mod's own folder, as a mod draws only its own icons.
export function pickMark(on, icons = LU) {
  // The row's own colour, as T3's MenuRadioItemIndicator.
  return div().w(14).flex_none().when(on, el => el.child(svg(`${icons}/check.svg`).size(14)));
}

export function searchField(t, state, icons = LU) {
  return h_flex().h(33).pb(6).gap(4).flex_none().items_center().border_b_1().border_color(t.border)
    .child(svg(`${icons}/search.svg`).size(16).flex_none().text_color(t.dim))
    .child(Input.new(state).flex_1().h_full().text_size(14).text_color(t.foreground));
}
