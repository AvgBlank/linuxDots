// The space panel's navigation column, one for the Files and Review pages (docs/adr/0013), sized as T3's FileExplorerPane.
// Each page keeps its width (`nav.width`) and whether its column is open (`nav.open`) in its own localStorage.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { settings } from "herdr";
import { ghostButton } from "./button.js";
import { alpha } from "./color.js";
import { dragGone, pointerMoved, POINTER_WATCH } from "./tip.js";

const NAV = 256, NAV_MIN = 160, NAV_MAX = 560, CONTENT_MIN = 256;
export const NAV_NARROW = 640;

/** How wide the column may be in a page `body` wide: [least, most]. */
export const navRange = (body) => [NAV_MIN, Math.max(NAV_MIN, Math.min(NAV_MAX, body - CONTENT_MIN))];
/** The column's width in a page `body` wide: that page's own, kept within navRange. */
export function navWidth(body, kept = localStorage.getItem("nav.width")) {
  const [least, most] = navRange(body);
  return Math.min(most, Math.max(least, Number(kept) || NAV));
}

// Open until closed on this page; under NAV_NARROW a file pick collapses `narrow` without overwriting the wide preference.
export const navOpen = () => localStorage.getItem("nav.open") !== "false";
export const setNavOpen = (open) => localStorage.setItem("nav.open", String(open));
export const navShown = (body, open, narrow) => body < NAV_NARROW && narrow !== undefined ? narrow : open;

/** Follow the first width at once, then keep it until the room has held its latest width a while.
 * Each page owns `hold`; `after(ms, f)` schedules `f(cx)` without retaining a render's context. */
export function holdWidth(hold, width, after) {
  if (hold.at == null) { hold.at = width; return; }
  hold.want = width;
  const run = hold.run = (hold.run ?? 0) + 1;
  after(300, (cx) => { if (run === hold.run && hold.at !== hold.want) { hold.at = hold.want; cx.notify(); } });
}

// The edge being dragged on this page; each mod has its own copy.
let drag = null;

/**
 * The tree's head, the navigation column's and generic Files' (docs/internals/specs/files.md#tree-header): the page headers'
 * height, not T3's 36, so its centre lines up with the pane header's and with Review's file header beside it.
 * @param {string} id @param {any} head
 */
export const treeHead = (id, head) => h_flex().id(id).h(32).mb(8).flex_none().px(12).gap(8).items_center().child(head);

/**
 * The page's `content` and, while `open`, the column right of it: `head` over `list`. Its left edge drags, and the width it
 * lands at stays on this page.
 * @param {any} t @param {string} id @param {number} body @param {{ content: any, head: any, list: any, open: boolean, handle?: any }} parts
 */
export function withNav(t, id, body, { content, head, list, open, handle }) {
  // The content on the theme's `background`, as T3's code surface (`--code-background`); the column stays on the page's chrome.
  if (!open) return div().id(`${id}-solo`).size_full().min_w(0).bg(t.background).child(content);
  const [least, most] = navRange(body), z = Number(settings()?.zoom) || 1, mine = drag?.id === id;
  const width = mine ? Math.min(most, Math.max(least, drag.width)) : navWidth(body);
  // Written once, on release. A pointer leaving the page lets go there, and so does a release outside the window, which brings
  // neither a release nor a leave (tip.js dragGone, as the sidebar's drags).
  const end = (cx) => {
    if (drag?.id !== id) return;
    const to = Math.round(Math.min(most, Math.max(least, drag.width)));
    drag.watch?.cancel();
    drag = null;
    if (to !== Math.round(navWidth(body))) localStorage.setItem("nav.width", String(to));
    cx.notify();
  };
  // Not Herdr's resizable group: it keeps its panels' sizes under its id and scales them with the page, so the column twitches
  // on resize. The pointer's positions are zoomed pixels.
  return h_flex().id(`${id}-split`).size_full().min_w(0)
    .when(mine, (el) => el.cursor_col_resize())
    .on_mouse_move((e, cx) => {
      if (drag?.id !== id) return;
      pointerMoved(e.position); drag.box = e.bounds;
      const to = drag.from - (e.position.x - drag.x) / z;
      if (to !== drag.width) { drag.width = to; cx.notify(); }
    })
    .on_mouse_up("left", (_e, cx) => end(cx))
    .on_hover((on, cx) => { if (!on) end(cx); })
    .child(div().id(`${id}-main`).flex_1().min_w(0).h_full().bg(t.background).child(content))
    .child(v_flex().id(`${id}-nav`).relative().w(width).flex_none().h_full().pl(1)
      // As T3's FileExplorerPane, `border-border/60`; an element's opacity, as a theme's border may carry its own alpha.
      .child(div().id(`${id}-nav-rule`).absolute().top(0).bottom(0).left(0).w(1).bg(t.border).opacity(0.6))
      .child(treeHead(`${id}-nav-head`, head))
      .child(div().flex_1().min_h(0).child(list))
      .child(div().id(`${id}-nav-edge`).absolute().top(0).bottom(0).left(-3).w(6).cursor_col_resize()
        .when(Boolean(handle), el => el.track_focus(handle).tab_index(0).accessibility_label("Resize the file tree")
          .when(handle?.is_focused(), el => el.bg(alpha(t.accent, "40")))
          .on_key_down((e, cx) => {
            const next = e.key === "home" ? least : e.key === "end" ? most : e.key === "left" ? width + 16 : e.key === "right" ? width - 16 : null;
            if (next === null) return;
            localStorage.setItem("nav.width", String(Math.min(most, Math.max(least, next))));
            cx.stop_propagation(); cx.notify();
          }))
        .on_mouse_down("left", (e, cx) => {
          cx.stop_propagation();
          const d = drag = { id, x: e.position.x, from: width, width, box: null, watch: null };
          d.watch = cx.timer.every(POINTER_WATCH, (cx) => { if (drag !== d) d.watch.cancel(); else if (dragGone(d.box)) end(cx); });
          cx.notify();
        })));
}

/** The toolbar's switch for the column, last at its right. */
/** @param {any} view @param {any} t @param {string} mod @param {string} id @param {boolean} open @param {any} toggle @param {boolean} [disabled] */
export function navToggle(view, t, mod, id, open, toggle, disabled = false) {
  return ghostButton(view, t, id, { icon: `${mod}/icons/folder-tree.svg`, label: open ? "Hide the file tree" : "Show the file tree", act: toggle, on: open, disabled, size: "sm", iconSize: 14, surface: "chrome" });
}

/** The head's Collapse all / Expand all: `folded` says which it does now. */
/** @param {any} view @param {any} t @param {string} mod @param {string} id @param {boolean} folded @param {any} press */
export function foldAllButton(view, t, mod, id, folded, press) {
  return ghostButton(view, t, id, { icon: `${mod}/icons/${folded ? "chevrons-up-down" : "chevrons-down-up"}.svg`, label: folded ? "Expand all" : "Collapse all", act: press, surface: "chrome" });
}
