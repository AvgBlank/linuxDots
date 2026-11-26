// Actions, as T3 Code's run button: the bar's control "▶ Dev | ▾" and Details' Actions row, their menus, and running one.
// The editor and the confirm dialog are main.js's.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, openOverlay, closeOverlay, props, shared, setShared, home, focused, panes, spaces } from "herdr";
import { tip, glow } from "./tip.js";
import { nameText, measuredTooltip } from "./measured-text.js";
import { stopsInit, stop, focusRoot, onStop } from "./focus.js";
import { menuKeys, scrollList, litProp, propsLit } from "./list.js";
import { MENU_ROW, menuRow } from "./menu-row.js";
import { KEY } from "./store.js";
import { button, radiusOf, split, cardRow, tint } from "./button.js";
import { opener, popupOpen, hang, barAtBottom } from "./trigger.js";
import { closeChain, hasOpen } from "./popup-menu.js";
import { sourceOkay, openLayer, rowMenu, focusSource, splitHot, dismissDetails, openedDetails, CHEVRON, MENU_CLOSED } from "./details-popup.js";

export const MOD = "t3-actions";
export const ICONS = ["play", "test", "lint", "configure", "build", "debug"];
export const icon = (name) => svg(`mods/${MOD}/icons/action-${ICONS.includes(name) ? name : "play"}.svg`);

export const lit = (view, id, color = theme().dim) => (view.hot === id ? theme().foreground : color);

// { list: [{ id, name, command, icon, place, cwd }], last: id }
export const state = () => shared(KEY.actions) ?? { list: [] };
const primary = ({ list, last }) => list.find(a => a.id === last) ?? list[0];
// The menu: a popup's height is only a maximum, so its list sets its own. REST: its padding and Add action.
// The menu as wide as the layout's other menus (t3-menu's, T3's); a longer name is cut short.
const MENU_MAX = 420, MENU_REST = 36, MENU_W = 220;
const menuHeight = (count) => Math.min(MENU_MAX, MENU_REST + count * MENU_ROW);
export const editor = (id) => { const p = props() ?? {}; return openOverlay({ mod: MOD, kind: "dialog", frame: "none", width: 512, props: { actions: "edit", id, source: p.source, details: p.actions === "details" ? p.overlay : p.details } }); };

// Hung 4 under the control, right edges together (its outline 1 past ▾, and 1 under it), as T3's (align end) and the layout's
// other menus from a right-side button: `b` is ▾'s bounds from the press or the demo's synthetic bounds.
export function openBarMenu(b) {
  const height = menuHeight(state().list.length);
  return openOverlay({ mod: MOD, kind: "popup", ...hang(b, MENU_W, { gap: 5, nudge: 1, up: barAtBottom() ? height : 0 }), width: MENU_W,
    height, props: { actions: "menu", source: props()?.source, details: null, ...litProp(!b) } });
}

function runAction(a) {
  const p = props(), source = p?.source;
  if (!sourceOkay(source)) { closeChain(); return; }
  focusSource(source);
  setShared(KEY.actions, { ...state(), last: a.id });
  // A mod pane (a review beside its agent) has no folder: use a terminal's in the same tab, else the space's.
  const f = focused();
  const folder = a.cwd?.startsWith("~") ? home() + a.cwd.slice(1)
    : a.cwd || source?.folder || f?.cwd || panes().find(p => p.tab === f?.tab && p.cwd)?.cwd || spaces().find(s => s.active)?.folder;
  // A tab action switches the active tab, so close Details beforehand to avoid its source watch firing a false warning.
  if (source && (a.place ?? "tab") === "tab") {
    if (p?.actions === "details" && (!p.overlay || openedDetails() === p.overlay)) dismissDetails();
    else closeChain();
  }
  // shortcut: sh -c skips your shell's aliases and functions and needs sh (not plain Windows); `zsh -ic` in the command gets them.
  run("terminal.open", { argv: ["sh", "-c", a.command], name: a.name, place: a.place ?? "tab", ...(folder ? { folder } : {}) });
}

// The bar's control: "▶ Dev | ⌄", shared/button.js's xs split (T3's ProjectScriptsControl in its header), or "Add action"
// before there is one. Outlined, not filled: a fill would read as an active tab.
export function barControl(view, t, stopPress = (_e, cx) => cx.stop_propagation()) {
  // A narrow bar's layout sets it (Herdr T3's bar-measure): the icon alone, the name left to the hover label. Unset, the full control.
  const s = state(), main = primary(s), compact = shared(KEY.compact), menuOn = popupOpen(view, "action-more", MENU_CLOSED);
  // T3's xs outline button: its svg hangs 2px into each side, its label sits 4 on, and with the icon alone it's 24 square. The
  // split's outline (`input`) and, hovered, the bar's 4% (button.js tint), as the split's halves.
  const ends = (el, wide) => wide ? el.pl(5).pr(7).gap(4) : el.justify_center();
  const box = (id) => h_flex().id(id).h(24).flex_none().items_center().rounded(8).border(1).border_color(t.input).text_size(12).on_mouse_down("left", stopPress);
  if (!main) return measuredTooltip(view, t, "action-add", "Add action", stop(view, t, "action-add", ends(box("action-add"), !compact).when(Boolean(compact), el => el.w(24)).text_color(lit(view, "action-add")).hover(st => st.bg(tint(t, "chrome", false))).on_hover(glow(view, "action-add"))
    // The dialog covers it, before the pointer can report leaving it.
    .role("button").accessibility_label("Add action").on_click((_e, cx) => { view.hot = null; editor(null); cx.notify(); })
    .child(svg("mods/t3-actions/icons/plus.svg").size(14)).when(!compact, el => el.child("Add action")), 8), { shown: !compact, below: !barAtBottom() });
  return split(t, { id: "actions", mainId: "action-run", moreId: "action-more", chevron: "mods/t3-actions/icons/chevron-down.svg", size: "xs", surface: "chrome",
    wide: !compact, hot: splitHot(view, "action-run", "action-more"), on: menuOn, label: `Run ${main.name}`, moreLabel: "Actions" },
    run => measuredTooltip(view, t, "action-run", `Run ${main.name}`, stop(view, t, "action-run", run.text_color(lit(view, "action-run")).on_hover(glow(view, "action-run"))
      .on_click(() => runAction(main))
      .child(icon(main.icon).size(14)).when(!compact, el => el.child(nameText(view, "action-run", main.name).max_w(140))), 8), { shown: !compact, below: !barAtBottom() }),
    more => stop(view, t, "action-more", opener(view, { id: "action-more", closed: MENU_CLOSED, onOpen: openBarMenu })(
      more.on_hover(glow(view, "action-more"))), 8))
    .text_size(12).text_color(t.dim).on_mouse_down("left", stopPress);
}

/** Details' Actions row: a split, ▶ the action and ⌄ its menu, hung under the row. */
export function detailsControl(view, t) {
  const s = state(), main = primary(s), menuOn = hasOpen(props().overlay, "menu");
  if (!main) return stop(view, t, "action-add", cardRow(t, "action-add").w_full().role("button").accessibility_label("Add action").cursor_pointer()
    .on_click(() => editor(null)).child(svg("mods/t3-actions/icons/plus.svg").size(16).flex_none().text_color(t.dim)).child("Add action"), 8);
  return split(t, { id: "details-actions-row", mainId: "action-run", moreId: "action-more", chevron: CHEVRON, size: "row",
    hot: splitHot(view, "action-run", "action-more"), on: menuOn, label: `Run ${main.name}`, moreLabel: "Actions" },
    // Its whole name in a tooltip only when it's cut (measured-text.js), on the half, whose hover it is.
    run => measuredTooltip(view, t, "action-run", main.name, stop(view, t, "action-run", run.on_hover(glow(view, "action-run")).on_click(() => runAction(main))
      .child(icon(main.icon).size(16).flex_none().text_color(t.dim)).child(nameText(view, "action-run", main.name, { size: 13, weight: "medium" }).flex_1().whitespace_nowrap()), 8), { below: true }),
    more => stop(view, t, "action-more", rowMenu(view, "action-more", menuHeight(s.list.length), (place, keys) => openLayer("menu", place, {}, keys))(more.on_hover(glow(view, "action-more"))), 8));
}

// The menu takes the keyboard, as the shipped menu does. As T3's, nothing is lit until a key or the pointer gets there.
export function initMenu(view, cx) {
  view.at = propsLit();
  view.keys = cx.focus_handle();
  view.keys.focus();
  stopsInit(view, cx, "modal");
}

/** The Actions menu, from the bar's ⌄ or Details' row, as T3's ProjectScriptsControl: its actions, each with its Edit, shown only
 *  while its row is lit or Edit has the keyboard, then Add action, no rule between. */
export function actionsMenu(view) {
  const t = theme(), { list } = state(), done = () => closeOverlay(props().overlay);
  const picks = [...list.map(a => () => runAction(a)), () => editor(null)];
  const labels = [...list.map(a => a.name), "Add action"];
  const row = (id, at, icon, label, trail = null) => menuRow(view, t, id, { at: [view, "at", at], label, icon, trail, pick: () => { done(); picks[at](); } });
  return focusRoot(view, v_flex().id("actions-menu").size_full().min_h(0).p(4).bg(t.popover).text_size(14)
    // On a row's Edit, Enter is Edit's.
    .track_focus(view.keys).on_key_down(menuKeys(view, labels, (at) => { done(); picks[at](); }, { enter: () => !onStop(view) }))
    // Add action stays outside the list, always in view: with it lit, nothing here is.
    .child(scrollList(view, "actions-list", { count: list.length, row: MENU_ROW, height: menuHeight(list.length) - MENU_REST, at: view.at < list.length ? view.at : -1, wheeled: (keep) => { if (keep >= 0) view.at = keep; }, draw: (at) => { const a = list[at]; return row(`action-${a.id}`, at, icon(a.icon).size(16).text_color(t.muted), a.name,
        div().size(24).flex_none().when(view.at === at || onStop(view) === `edit-${a.id}`, el => el.child(tip(view, t, `edit-${a.id}`, `Edit ${a.name}`, stop(view, t, `edit-${a.id}`, button(t, `edit-${a.id}`, { icon: "mods/t3-actions/icons/settings.svg", label: `Edit ${a.name}`, surface: "card", hot: view.hot === `edit-${a.id}` })
          .on_hover(glow(view, `edit-${a.id}`)).on_click((_e, cx) => { cx.stop_propagation(); done(); editor(a.id); }), radiusOf()), { below: true })))); } }))
    .child(row("action-new", list.length, "mods/t3-actions/icons/plus.svg", "Add action")));
}
