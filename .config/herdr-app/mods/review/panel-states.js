// What the Files and Review pages show while there's nothing else to (docs/adr/0013): loading, empty and failed, one way
// on both. Each paints no background: the panel's shows through.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { button as drawButton, radiusOf } from "./button.js";
import { glow } from "./tip.js";
import { stop } from "./focus.js";
import { alpha } from "./color.js";

/** Loading: T3's loader arc, still, and a line, centered, announced as a status (as T3's FeedbackLoading). `mod`: the caller's folder (`mods/t3-files`), whose own icons/ holds the arc. */
export function loadingState(mod, t, id, text) {
  return h_flex().id(id).size_full().gap(8).items_center().justify_center().text_size(12).text_color(t.dim).role("status")
    .child(svg(`${mod}/icons/loader-circle.svg`).size(14).flex_none().text_color(t.working))
    .child(div().id(`${id}-text`).child(text));
}

/** Empty: an icon (a path in the mod's folder), a title and a `dim` hint, centered. */
export function emptyState(t, id, icon, title, hint) {
  return v_flex().id(id).size_full().p(24).gap(8).items_center().justify_center().text_center().text_color(t.dim)
    .child(svg(icon).size(24).flex_none().text_color(t.dim))
    .child(div().id(`${id}-title`).text_size(13).font_medium().child(title))
    .when(Boolean(hint), (el) => el.child(div().id(`${id}-hint`).text_size(12).child(hint)));
}

/** Failed: a red bar under the toolbar, `ansi1` on a wash of it, and Retry, T3's xs ghost button. */
export function errorBar(t, id, text, retry, view) {
  return noticeBar(t, id, text, t.ansi1, "retry", "Retry", retry, view);
}

/** A bar under the toolbar in `color` on a wash of it, as T3's FileSurfaceNotice, and one action, `${id}-${key}`, a tab stop in a view that keeps them. */
export function noticeBar(t, id, text, color, key, label, act, view) {
  return h_flex().id(id).flex_none().px(12).py(6).gap(8).items_center().bg(alpha(color, "18")).text_color(color).text_size(11)
    .child(div().id(`${id}-text`).flex_1().min_w(0).child(text))
    .child(drawButton(t, `${id}-${key}`, { variant: "plain", text: label, surface: "card", hot: view?.hot === `${id}-${key}` })
      .when(Boolean(view), el => el.on_hover(glow(view, `${id}-${key}`)))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); act(cx); })
      .map(el => view?.fs ? stop(view, t, `${id}-${key}`, el, radiusOf()) : el));
}
