// Details' popup (cmd-shift-b): opening and closing it, the source it was opened on, and the menus that hang off it (popup-menu.js).
// What it draws is workspace-details.js's; its Actions row actions.js's, its Review row review-details.js's.
import { spaces, panes, props, settings, openOverlay, closeOverlay, setShared, run, focused } from "herdr";
import { within, focusStop } from "./focus.js";
import { hang, opener } from "./trigger.js";
import { openPopup, menuClosed, backTo } from "./popup-menu.js";
import { litProp } from "./list.js";
import { terminalFor, workFolder } from "./terminal-context.js";
import { closedKey } from "./store.js";
import { panelState } from "./panel.js";
import { detailsAnchor } from "./titlebar.js";

export const MENU_CLOSED = closedKey("t3-actions", "menu"), DETAILS_CLOSED = closedKey("t3-actions", "details");
export const CHEVRON = "mods/t3-actions/icons/chevron-down.svg";
// T3 threadDetailsPanelStyles: the card 280 wide, its rows inside its 1px border and 8 padding.
const CARD_W = 280, ROW_W = CARD_W - 2 - 16;
export const CARD_MAX = 420;

// Only this run: Details' popup id. Mods share one JS context (terminal-context.js), so the bar's copy and the popups' read the same.
const reg = () => /** @type {any} */ (globalThis).t3Details ??= { id: null };
export const openedDetails = () => reg().id;

/** Where a row's menu goes: as wide as the row, 4 under it, right edges together; `b`, the pressed half's bounds. */
export const underRow = (b, height) => ({ width: ROW_W, height, ...hang(b, ROW_W) });

/** Opens a menu of this popup's, `kind` its props.actions: it shares Details' source and hangs off this popup. `keys`: opened
 *  by keys (a button's opener got no press: `!b`), so its first row lights (list.js propsLit in its init). */
export function openLayer(kind, place, extra = {}, keys = false) {
  const p = props(), root = p.actions === "details" ? p.overlay : p.details;
  return openPopup({ mod: "t3-actions", ...place, props: { ...extra, actions: kind, source: p.source, details: root, parents: [...(p.parents ?? []), p.overlay] } }, p.overlay, kind, keys);
}

/** A popup of this mod's closed: its own menus go with it; Details gone, its button shows it. */
export function layerClosed(id) {
  menuClosed(id);
  if (reg().id === id) { reg().id = null; setShared(DETAILS_CLOSED, Date.now()); }
}

/** A row's chevron `id` that opens its menu, `height` tall, under the row: `open(place, keys)` opens it (openLayer) and returns
 *  its id, or false. Opened by keys (no press), it's placed from where Details hangs (props.at) and the row's top in the card
 *  (view.grid, workspace-details.js detailsGrid); as it closes the keyboard comes back here, ringed if keys opened it, unless
 *  the terminal changed meanwhile (an action ran beside it). */
export const rowMenu = (view, id, height, open) => opener(view, { closed: MENU_CLOSED, onOpen: (b) => {
  const menu = open(underRow(b ?? keyRow(view, id), height), !b);
  if (menu === false) return false;
  const was = focused()?.terminal;
  backTo(menu, () => { if (focused()?.terminal === was) b ? view.detailsKeys.focus() : focusStop(view, id); });
} });

// Row `id`'s bounds as a press would give them, zoomed px: inside the card's 1 border and 8 padding, as wide as a row.
function keyRow(view, id) {
  const at = props().at, row = view.grid?.find(r => r.ids.includes(id)), z = Number(settings().zoom) || 1;
  return at && row ? { x: at.x + 9 * z, y: at.y + row.top * z, width: ROW_W * z, height: 32 * z } : null;
}

/** The keyboard back on the terminal Details opened on: Escape, an action run. */
export function focusSource(s) {
  if (s?.terminal) run("pane.focus", { terminal: s.terminal });
  else if (s?.pane) run("pane.focus", { pane: s.pane });
}

export function dismissDetails() { if (reg().id) closeOverlay(reg().id); reg().id = null; }

/** The space, tab and terminal Details opened on are still the ones shown. */
export function sourceOkay(source) {
  const sp = spaces().find(s => s.active);
  return !source || (sp?.id === source.space && sp.tabs.some(t => t.active && t.id === source.tab)
    && (!source.terminal || panes().some(p => p.terminal === source.terminal && p.tab === source.tab)));
}

export function toggleDetails(bounds) {
  if (reg().id) return dismissDetails();
  const sp = spaces().find(s => s.active);
  if (!sp) return;
  // Taken before the popup takes the keyboard: the tab's last terminal, and the folder it works in (terminal-context.js).
  const tab = sp.tabs.find(t => t.active)?.id, f = terminalFor(sp.id, tab) ?? panes().find(p => p.tab === tab && p.terminal);
  const source = { space: sp.id, tab, pane: f?.pane, terminal: f?.terminal, machine: sp.machine, folder: workFolder(sp.id, tab) };
  // Keys have no press to hang it under: the button's place, from the layout's sizes and the open panel's measure (titlebar.js).
  const viewport = globalThis.window?.viewport_size?.();
  // No press: keys opened it, so its first control takes the keyboard (list.js litProp). `at`: where it hangs, for its rows' menus.
  const keys = !bounds;
  if (!bounds && viewport) bounds = detailsAnchor(viewport, Number(settings().zoom) || 1, panelState().open);
  const place = hang(bounds, CARD_W);
  reg().id = openOverlay({ mod: "t3-actions", kind: "popup", frame: "none", width: CARD_W, height: CARD_MAX, ...place,
    props: { actions: "details", source, at: place.at ?? null, ...litProp(keys) } });
}

// The half of a split under the pointer or the keyboard (T3's group-focus-within), for split()'s `hot`.
export const splitHot = (view, main, more) => view.hot === main || within(view, [main]) ? "main" : view.hot === more || within(view, [more]) ? "more" : null;
