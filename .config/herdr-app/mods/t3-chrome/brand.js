// Herdr's app tile and name in the brand bar, a way Home, as T3's SidebarBrand (docs/internals/specs/sidebar.md). Only the brand
// bar has it: with the sidebar hidden the tab row keeps just the toggle, as T3's collapsed sidebar does.
import { div, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run } from "herdr";
import { stop } from "./focus.js";

/** What the button takes besides its name: the 16px tile and the 4 after it. */
export const BRAND_FIXED = 16 + 4;
/**
 * From the sidebar toggle to the tile: the sidebar's one gap between icons, as the hidden tab row's 4 + 4 after the same toggle,
 * so hiding the sidebar puts the next mark where the tile was. T3 has 12 here (`--workspace-titlebar-content-left`).
 */
export const BRAND_GAP = 8;

/**
 * As T3's SidebarBrandMark, but the mark is Herdr's tile in its own colours, as big as the 16px icons beside it (its PNG is 80%
 * tile): a wordmark-sized icon reads small. One look always: no fill, no hover, nothing lit at Home, no tooltip; only the focus ring.
 * Short of room (`named` false) the name gives way whole, never cut to "Her…"; its unzoomed width goes in `view.brandNameW`.
 * @param {any} view @param {any} t @param {{ named: boolean, zoom: number }} o
 */
export function brand(view, t, { named, zoom }) {
  return stop(view, t, "home", h_flex().id("home").h(28).min_w(0).flex_none().gap(4).items_center().rounded(6)
    .text_size(14).font_medium().text_color(t.muted)
    .role("button").accessibility_label("Home")
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click(() => run("t3-tabs.home"))
    .child(image("frame/welcome/herdr.png").size(16).flex_none().rounded(4))
    .when(named, (el) => el.child(div().id("home-name").flex_none().child("Herdr")
      .on_size_change((size, cx) => { view.brandNameW = size.width / zoom; cx.notify(); }))));
}
