// Details' Review row: its main half shows Review (its range, or its default); its chevron opens the range menu under the row, whose
// Commits opens beside it (submenu.js), as t3-menu's Snooze. The rows, reads and picks are Review's own (review-scope.js).
import { div, svg } from "gpui-kit";
import { v_flex, InputState } from "gpui-base";
import { checking, props, closeOverlay, theme } from "herdr";
import { stop, focusRoot } from "./focus.js";
import { glow, tip } from "./tip.js";
import { nameText, measuredTooltip } from "./measured-text.js";
import { split } from "./button.js";
import { panelState, showPage, reviewRepo, openReview, reviewShown } from "./panel.js";
import { workFolder } from "./terminal-context.js";
import { MENU_ROW } from "./menu-row.js";
import { propsLit } from "./list.js";
import { hoverRow, subLeft } from "./submenu.js";
import { openBeside, closeSub, subGone, closeChain, hasOpen } from "./popup-menu.js";
import { scopeOf, openScope, readScope, scopeRows, scopeRow, scopeItems, scopeList, pickListed, menuKey, commitsKey, commitsBody, releaseScope } from "./review-scope.js";
import { sourceOkay, openLayer, underRow, rowMenu, splitHot, CHEVRON, MENU_CLOSED } from "./details-popup.js";

const ICON_DIR = "mods/t3-actions/icons";
// The range menu at its tallest: four ranges, the rule, Commits, its padding. The app fits a popup to what it draws.
const RANGE_H = 8 + 4 * MENU_ROW + 9 + MENU_ROW;
// The Commits submenu: T3's w-80, and its list's tallest under its search (43) and padding.
const COMMITS_W = 320, COMMITS_LIST = 320;
// Where each space's Review read last (panel.js reviewRepo), for this mod's run: the menu reads there at once and checks it after.
const roots = new Map();


function reviewReason(source) {
  return source.machine ? "Review is unavailable on remote spaces." : !source.folder ? "No working directory."
    : !panelState().pages.includes("review") ? "Install the Review extra to use it." : "";
}

/** The Review row's section, under Workspace's rule when that shows (`rule`). */
export function reviewDetailsView(view, t, visible, rule) {
  if (visible.review === false) return null;
  const source = props().source, reason = reviewReason(source), on = hasOpen(props().overlay, "review-scope");
  // The range as Review's scope button names it; nothing while no Review tab shows one.
  const shown = !reason && reviewShown(source.space), label = shown?.page ? shown.label ?? scopeOf({ page: shown.page }).label : "";
  const row = split(t, { id: "details-review-row", mainId: "details-review", moreId: "details-review-more", chevron: CHEVRON, size: "row",
    hot: splitHot(view, "details-review", "details-review-more"), on, disabled: Boolean(reason), label: label ? `Review: ${label}` : "Review", moreLabel: "Choose review range" },
    // The range's whole name in a tooltip only when it's cut, as the machine's (measured-text.js): on the half, whose hover it is.
    main => measuredTooltip(view, t, "details-review", label, stop(view, t, "details-review", main.on_hover(glow(view, "details-review"))
      .when(!reason, el => el.on_click(() => { if (sourceOkay(source)) showPage("review"); }))
      .child(svg(`${ICON_DIR}/pulls-review.svg`).size(16).flex_none())
      .child(div().flex_1().min_w(0).truncate().child("Review"))
      .when(Boolean(label), el => el.child(div().id("details-review-scope-slot").flex_none().max_w(120).min_w(0).font_normal()
        .child(nameText(view, "details-review", label, { size: 12 }).text_color(t.dim).whitespace_nowrap()))), 8), { below: true }),
    more => stop(view, t, "details-review-more", reason ? more : rowMenu(view, "details-review-more", RANGE_H,
      (place, keys) => sourceOkay(source) && openLayer("review-scope", place, { at: place.at ?? null }, keys))(more.on_hover(glow(view, "details-review-more"))), 8));
  return v_flex().id("details-review-section").p(8).when(rule, el => el.border_t(1).border_color(t.border))
    .child(reason ? tip(view, t, "details-review-row", reason, row, { below: true }) : row);
}

const sameSource = source => sourceOkay(source) && workFolder(source.space, source.tab) === source.folder;

// The popups keep Details' folder even before a task starts; don't accept a repo read for a folder the tab moved to.
async function sourceRepo(source) {
  if (!sameSource(source)) return null;
  const result = await reviewRepo(source.space);
  return sameSource(source) ? result : null;
}

/** Details opening: where Review reads and its counts, read now, so the range menu has them when it opens (review-scope.js
 *  keeps them). Only this space, and only when the Review row can open it. */
export function prefetchRange(cx) {
  const source = props().source;
  if (reviewReason(source)) return;
  cx.spawn(async (cx) => {
    const root = (await sourceRepo(source))?.root;
    if (!root) return;
    roots.set(source.space, root);
    readScope({ space: source.space, root }, cx);
  });
}

/** The range menu: Review's rows (none lit, the range Review shows checked), read on opening; the last read meanwhile. */
export function initRangeMenu(view, cx) {
  const p = props(), source = p.source;
  // menuKey's Escape (review-scope.js) is this popup's close.
  view.s = {}; view.sub = null; view.rowsAt = [];
  view.keys = cx.focus_handle(); view.keys.focus();
  // Where it opened, for placing Commits when keys open it before the pointer has found its row.
  view.origin = p.at ?? globalThis.window?.mouse_position?.() ?? null;
  const scopeSearch = InputState.new({ placeholder: "Search" }), lit = propsLit();
  // Every root gets a fresh scope: the old rows and their Commits keep the old scope even if a click arrives after a redraw.
  const at = (root, confirmed, cx) => {
    const shown = root ? reviewShown(source.space) : null;
    const page = shown?.root === root ? shown.page : null, base = page ? shown.base || page : undefined;
    const scope = { root, space: source.space, page, base, scopeSearch, confirmed, pending: null,
      scopeAt: -1, closePopup: () => closeOverlay(p.overlay),
      openCommits: (cx, lit) => { if (view.scope === scope && !view.closed) openCommits(view, scope, lit, cx); },
      pick: (page, { base = undefined, analyze = false }) => {
        if (!root || view.closed || view.scope !== scope || !sameSource(source)) return;
        // A radio may finish re-reading its count first; a commit from an unconfirmed repo must be picked again.
        if (!scope.confirmed) { if (analyze) scope.pending = { page, base, analyze }; return; }
        if (openReview({ space: source.space, root, page, base, analyze }, true) === "opened") closeChain();
      } };
    view.scope = scope;
    if (root) openScope(scope, cx, lit);
  };
  at(checking() ? null : roots.get(source.space) ?? null, false, cx);
  if (!checking()) cx.spawn(async (cx) => {
    const result = await sourceRepo(source);
    if (view.closed || !result) return;
    const { root, problem } = result, scope = view.scope;
    if (root) roots.set(source.space, root); else roots.delete(source.space);
    if (!root || root !== scope.root) {
      releaseScope(scope);
      closeSub(view);
      if (root) at(root, true, cx);
      else { view.scope = null; view.scopeError = problem; }
    } else {
      scope.confirmed = true;
      const pending = scope.pending; scope.pending = null;
      if (pending) scope.pick(pending.page, pending);
    }
    cx.notify();
  });
  /** @type {any} */ (globalThis).t3DetailsRange = view;
}

export function closeRangeMenu(view) {
  view.closed = true; if (view.scope) releaseScope(view.scope);
  if (/** @type {any} */ (globalThis).t3DetailsRange === view) /** @type {any} */ (globalThis).t3DetailsRange = null;
}

// Commits beside its row, as t3-menu's Snooze: the row where the pointer last found it, else from where the menu opened.
function openCommits(view, scope, lit, cx) {
  const p = props(), i = scopeRows(scope).findIndex(r => r.sub);
  const count = scopeList(scope).length, h = 8 + 43 + (count ? Math.min(count * MENU_ROW, COMMITS_LIST) : 36);
  openBeside(view, i, "commits", { top: 4 + i * MENU_ROW + 9, width: underRow(null, 0).width - 8 },
    { mod: "t3-actions", width: COMMITS_W, height: h, props: { actions: "review-commits", source: p.source, details: p.details } }, "review-commits", lit >= 0);
  cx.notify();
}

export function rangeMenu(view) {
  const t = theme(), scope = view.scope;
  // Its Commits closed itself (← or Esc in it, a click beside it): the keyboard comes back here.
  subGone(view, MENU_CLOSED);
  const rows = scope ? scopeRows(scope) : [];
  const row = (r, i) => scopeRow(scope, t, r, i, { icons: ICON_DIR, open: Boolean(r.sub) && Boolean(view.sub),
    also: (el) => el.on_mouse_move((e, cx) => {
      if (view.scope !== scope) return;
      view.rowsAt[i] = e.bounds;
      hoverRow(view.s, r.sub && r.count ? r.sub : null, e, cx, (key, _b, cx) => {
        if (view.scope !== scope) return;
        if (key) scope.openCommits(cx, -1); else closeSub(view);
      });
    }) });
  return focusRoot(view, v_flex().id("details-range-menu").w_full().p(4).bg(t.popover).text_size(14).track_focus(view.keys)
    .on_hover((on) => { if (!on) subLeft(view.s); })
    .on_key_down((e, cx) => { if (scope && view.scope === scope) menuKey(scope, e, cx); else if (e.key === "escape") closeOverlay(props().overlay); })
    .when(Boolean(view.scopeError), el => el.child(div().id("details-range-note").min_h(28).px(8).flex().items_center().text_color(t.dim).child(view.scopeError)))
    .when(!view.scopeError, el => el.children(scopeItems(t, rows, row))));
}

/** Commits beside the range menu: what the menu read, its search, its rows. */
export function initCommits(view) {
  const range = /** @type {any} */ (globalThis).t3DetailsRange, overlay = props().overlay, scope = range?.scope;
  if (!scope || range.closed || range.sub?.id !== overlay) return closeOverlay(overlay);
  for (const k of ["space", "root", "page", "base", "scopeGit", "picks", "refs", "scopeRoot", "scopeBase"]) view[k] = scope[k];
  view.pick = (page, options) => { if (range.sub?.id === overlay) scope.pick(page, options); };
  view.scopeListAt = propsLit();
  view.scopeSearch = InputState.new({ placeholder: "Search commits" });
  view.scopeSearch.on("change", (_e, cx) => { view.scopeListAt = 0; view.scrollTop = { ...view.scrollTop, "scope-list": 0 }; cx.notify(); });
  view.scopeSearch.on("submit", (_e, cx) => pickListed(view, scopeList(view)[view.scopeListAt], cx));
  view.scopeSearch.focus();
}

export function commitsMenu(view) {
  if (!view.scopeSearch) return div(); // Its parent closed or changed repositories before the overlay mounted.
  const t = theme();
  return focusRoot(view, v_flex().id("details-commits").w_full().p(4).bg(t.popover).text_size(14)
    .on_key_down((e, cx) => commitsKey(view, e, cx, () => closeOverlay(props().overlay)))
    .children(commitsBody(view, t, { height: COMMITS_LIST, icons: ICON_DIR })));
}
