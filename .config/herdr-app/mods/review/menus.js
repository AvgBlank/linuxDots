// Files and Review's menus (docs/adr/0018), native popups of their own mod: a tree row's, a breadcrumb's folder and Open in's
// apps. A breadcrumb's folder menu, as T3's FileBreadcrumbs, moves through folders in place, Back on top. Each acts only while
// the space and tab it was opened on still show (`source`).
import { svg } from "gpui-kit";
import { v_flex } from "gpui-base";
import { checking, props, closeOverlay, theme, shared, setShared, spaces, exec, run, notify, window } from "herdr";
import { focusRoot, stopsInit, stopsEnd } from "./focus.js";
import { menuKeys, scrollList, propsLit } from "./list.js";
import { menuRow, menuRule, MENU_ROW } from "./menu-row.js";
import { hoverRow, subLeft } from "./submenu.js";
import { openPopup, openBeside, closeSub, subGone, closeChain, closeTops, menuClosed } from "./popup-menu.js";
import { targetsMenu, awaitTargets, openTarget, targetIcon } from "./open-in.js";
import { pierreFileIcon } from "./pierre-icons.js";
import { KEY, closedKey } from "./store.js";
import { LIST, join, parseListing } from "./file-listing.js";

const menuMod = () => props()?.menuMod ?? "t3-files";
const menuIcons = () => `mods/${menuMod()}`; // each mod draws only its own icons/
// As t3-menu's.
export const MENU_W = 220, FOLDER_H = 8 + 12 * MENU_ROW;
// Stamped as a top menu closes, for the control that opened it (trigger.js); a submenu's, for the menu it hangs off.
export const MENU_CLOSED = closedKey("t3-files", "menu");

/** Opens a top menu: `kind` (row, editors, folder, open-in), openOverlay's `place` ({ at?, height }), `extra` its props;
 *  `keys`: opened by keys, its first row lit. */
export const openMenu = (kind, place, extra, keys = false) => openPopup({ mod: extra.menuMod ?? "t3-files", width: MENU_W, ...place, props: { ...extra, files: kind } }, null, null, keys);

/** The space and tab a menu was opened on are still the ones shown, plus any caller check (Files' live root). */
const sourceOkay = (s, check = null) => {
  const sp = spaces().find(x => x.active);
  return Boolean(sp && sp.id === s.space && sp.tabs.some(t => t.active && t.id === s.tab) && (!check || check(s, sp)));
};

/** A tree row's items: a remote one can't be opened or revealed here; `agent` is the tab's last active terminal. */
/** @param {{ remote?: boolean, platform?: string, agent?: any, editors?: string[], deleted?: boolean }} o */
export function rowItems({ remote = false, platform, agent = null, editors = [], deleted = false }) {
  const mac = platform === "macos" && !remote;
  return [
    mac && { id: "open", label: "Open", icon: "external-link" },
    mac && { id: "reveal", label: "Reveal in Finder", icon: "folder-open" },
    mac && editors.length > 0 && { id: "open-with", label: "Open with", icon: "external-link", sub: "editors" },
    { id: "copy-path", label: "Copy path", icon: "copy" },
    { id: "mention", label: "Insert into agent terminal", icon: "at-sign", disabled: !agent, hint: agent ? "" : "No active terminal in this tab" },
  ].filter(it => it && (!deleted || it.id === "copy-path"));
}

// Into the agent's input as a paste, never sent: the clipboard carries it and gets its text back once the paste has read it.
// A clipboard holding no text (an image) isn't touched.
export function mention(path, address, cx) {
  if (/[\x00-\x1f\x7f]/.test(path)) {
    notify({ title: "Couldn't insert this path", body: "It contains control characters. Use Copy path instead.", level: "warning" });
    return;
  }
  const previous = cx.read_from_clipboard();
  if (previous === undefined) {
    notify({ title: "The clipboard holds something that isn't text", body: "Insert would replace it. Copy path, then paste it yourself.", level: "warning" });
    return;
  }
  if (/** @type {any} */ (globalThis).t3PastePending) return;
  /** @type {any} */ (globalThis).t3PastePending = true;
  // shortcut: the host cannot read an input line, so always supply a separating space; refine when it exposes input text.
  const text = ` ${path}`;
  try { cx.write_to_clipboard(text); run("pane.focus", { terminal: address }); run("terminal.paste"); }
  catch (e) { cx.write_to_clipboard(previous); /** @type {any} */ (globalThis).t3PastePending = false; throw e; }
  cx.spawn(async (cx) => {
    try { await cx.sleep(150); }
    finally { if (cx.read_from_clipboard() === text) cx.write_to_clipboard(previous); /** @type {any} */ (globalThis).t3PastePending = false; }
  });
}

/** Opens `rel` in app `name`, here only, once more checking the menu's space still shows; the app that opened is the next default. */
export function launch(source, rel, name, check = null) {
  if (source.on || window()?.platform !== "macos") return;
  openTarget(name, join(source.root, rel), () => sourceOkay(source, check)).then(actual => { if (actual) setShared(KEY.openTarget, actual); })
    .catch(e => notify({ title: "Couldn't open this file", body: String(e), level: "error" }));
}

export function initMenu(view, cx, check = null) {
  const p = props();
  view.check = check;
  view.keys = cx.focus_handle(); view.keys.focus();
  stopsInit(view, cx, "modal");
  // As T3's, nothing is lit until a key or the pointer gets there; keys that opened a submenu light its first row.
  view.at = propsLit();
  // The submenu's pointer state (submenu.js), the one open { id, row }, and each row's bounds as the pointer last found it.
  view.s = {}; view.sub = null; view.rowsAt = [];
  // Where it opened: the pointer, for placing a submenu keys open before the pointer has found its row.
  view.origin = /** @type {any} */ (globalThis).window?.mouse_position?.();
  // A breadcrumb menu's folder: it starts at its crumb's (`p.dir`), and Back goes no higher.
  view.dir = p.dir;
  if (p.files === "folder") readFolder(view, cx);
  if (p.files === "open-in") awaitTargets(cx);
  view.sourceWatch = cx.timer.every(250, () => { if (!sourceOkay(p.source, view.check)) closeOverlay(p.overlay); });
}

// A breadcrumb menu's folder, read as it opens and each time it moves; a read for a folder it has left counts for nothing.
function readFolder(view, cx) {
  const p = props(), dir = view.dir;
  view.entries = null;
  if (checking()) return;
  cx.spawn(async (cx) => {
    if (!sourceOkay(p.source, view.check)) { closeOverlay(p.overlay); return; }
    const r = await exec("sh", ["-c", LIST, "files", join(p.source.root, dir)], { on: p.source.on }).catch(() => null);
    if (view.dir !== dir || !sourceOkay(p.source, view.check)) return;
    view.entries = r?.code === 0 ? parseListing(r.stdout) : "failed";
    cx.notify();
  });
}

// The breadcrumb menu shows folder `dir` in place, from the top of its list; keys that moved it light its first row.
function goTo(view, dir, cx, lit) {
  view.dir = dir; view.at = lit ? 0 : -1; view.scrollTop = { ...view.scrollTop, "files-menu-list": 0 };
  readFolder(view, cx);
}

// Where Back goes: the folder above, while that's still within the crumb's (T3's canGoBack); else null.
const backDir = (view) => view.dir === props().dir ? null : view.dir.slice(0, Math.max(0, view.dir.lastIndexOf("/")));

/** Closes the mod's open menus before its tab, for cmd-w: whether there was one. */
export const closeMenus = (mod = "t3-files") => closeTops(mod);

/** Its submenu goes with it; the control that opened it, or the menu it hangs off, learns it's gone. */
export function closeMenu(view) {
  const p = props();
  view.sourceWatch?.cancel();
  stopsEnd(view);
  menuClosed(p.overlay);
  setShared(closedKey(menuMod(), p.parents?.length ? "submenu" : "menu"), Date.now());
}

// What a menu lists: { id, label, icon?|glyph?, sub?, disabled?, hint?, checked?, keepOpen?, run?(cx) }.
function items(view) {
  const p = props(), t = theme(), s = p.source, ICONS = menuIcons();
  if (p.files === "editors") return p.editors.map(name => ({ id: `editor:${name}`, label: name, glyph: targetIcon(ICONS, name, t), run: () => launch(s, p.path, name, view.check) }));
  if (p.files === "row") return rowItems({ remote: Boolean(s.on), platform: window()?.platform, agent: p.agent, editors: p.editors, deleted: p.deleted }).map(it => ({ ...it, run: (cx) => {
    if (it.id === "open") launch(s, p.path, shared(KEY.openTarget) ?? "Finder", view.check);
    else if (it.id === "reveal") exec("open", ["-R", "--", join(s.root, p.path)]).then(r => { if (r.code !== 0) throw new Error(r.stderr); }).catch(e => notify({ title: "Couldn't reveal in Finder", body: String(e), level: "error" }));
    else if (it.id === "copy-path") cx.write_to_clipboard(p.path);
    else if (it.id === "mention" && p.agent) mention(p.path, p.agent.terminal, cx);
  } }));
  // A breadcrumb's folder, as T3's: Back to the folder above, then its entries; a folder shows in this menu, a file opens in Files.
  const up = backDir(view), name = (dir) => dir.slice(dir.lastIndexOf("/") + 1) || s.root.replace(/\/$/, "").split("/").pop() || s.root;
  const back = up === null ? [] : [{ id: "..", label: `Back to ${name(up)}`, icon: "arrow-left", into: up }];
  if (view.entries === "failed") return [...back, { id: "retry", label: "Retry loading folder", icon: "refresh-cw", keepOpen: true, run: (cx) => readFolder(view, cx) }];
  if (!view.entries) return [...back, { id: "loading", label: "Loading folder…", disabled: true }];
  if (!view.entries.length) return [...back, { id: "empty", label: "This folder is empty.", disabled: true }];
  return [...back, ...view.entries.map(e => {
    const path = join(view.dir, e.name);
    return e.dir ? { id: path, label: e.name, glyph: svg(`${ICONS}/icons/tree/folder.svg`).size(16).flex_none().text_color(t.dim), into: path }
      : { id: path, label: e.name, glyph: pierreFileIcon(t, ICONS, path), checked: path === p.file, run: () => run(`t3-files.pick:${path}`) };
  })];
}

// Row `i`'s submenu beside it, Open with's editors (the one row with one). `lit`: keys opened it, so its first row is lit, as Base UI's.
function openSub(view, i, lit) {
  const p = props(), it = items(view)[i];
  openBeside(view, i, it.id, { top: 4 + i * MENU_ROW, width: MENU_W - 8 }, { mod: menuMod(), width: MENU_W, height: 8 + p.editors.length * MENU_ROW,
    props: { menuMod: menuMod(), files: it.sub, source: p.source, path: p.path, editors: p.editors } }, null, lit);
}

function choose(view, i, cx, lit = false) {
  if (!sourceOkay(props().source, view.check)) { closeChain(); return; }
  const it = items(view)[i];
  if (!it || it.disabled) return;
  if (it.into !== undefined) return goTo(view, it.into, cx, lit);
  if (it.sub) return openSub(view, i, lit);
  // The whole chain closes, the menus it hangs off too.
  if (!it.keepOpen) closeChain();
  it.run?.(cx);
}

export function menuView(view) {
  const p = props(), t = theme(), ICONS = menuIcons();
  if (p.files === "open-in") return targetsMenu(view, ICONS, p.targets ?? [], p.reason, (name) => { if (sourceOkay(p.source, view.check)) setShared(KEY.openTarget, name); closeOverlay(p.overlay); });
  // Its submenu closed itself (← or Esc in it, a click beside it): the keyboard comes back here.
  subGone(view, closedKey(menuMod(), "submenu"));
  const list = items(view), o = list[0]?.id === ".." ? 1 : 0;
  const row = (i) => { const it = list[i]; return menuRow(view, t, `files-menu-${it.id}`, { at: [view, "at", i], label: it.label, open: i === view.sub?.row,
    icon: it.glyph ?? (it.icon ? `${ICONS}/icons/${it.icon}.svg` : null), sub: Boolean(it.sub || (it.into !== undefined && it.id !== "..")) && `${ICONS}/icons`, disabled: it.disabled, hint: it.hint || "Not available",
    trail: it.checked ? svg(`${ICONS}/icons/check.svg`).size(14).flex_none().text_color(t.foreground) : null, pick: (cx) => choose(view, i, cx),
    also: (el) => el.on_mouse_move((e, cx) => {
      view.rowsAt[i] = e.bounds;
      hoverRow(view.s, it.sub ? it.id : null, e, cx, (key, _row, cx) => { if (key) openSub(view, i, false); else closeSub(view); cx.notify(); });
    }) }); };
  return focusRoot(view, v_flex().id("files-menu").size_full().p(4).bg(t.popover).text_size(14).track_focus(view.keys)
    // Off the menu, nothing pending opens; a submenu open stays.
    .on_hover((on) => { if (!on) subLeft(view.s); })
    // A submenu's ← goes back to its menu, as its Esc does. Moving off the row whose submenu is open closes it, as Base UI's.
    .on_key_down((e, cx) => {
      // ← in a breadcrumb menu goes up a folder, as its Back; at its crumb's folder it does nothing.
      if (e.key === "left" && p.files === "folder") { const up = backDir(view); if (up !== null) goTo(view, up, cx, true); cx.stop_propagation(); cx.notify(); return; }
      menuKeys(view, list.map(it => it.label), (at, cx, lit) => choose(view, at, cx, lit), { back: Boolean(p.parents?.length), sub: (at) => Boolean(list[at]?.sub) })(e, cx);
      if (view.sub && view.sub.row !== view.at) closeSub(view);
    })
    // Back, then a rule, stay put over the folder's entries.
    .when(o > 0, (el) => el.child(row(0)).child(menuRule(t)))
    .child(scrollList(view, "files-menu-list", { count: list.length - o, row: MENU_ROW, at: view.at - o, height: Math.min((list.length - o) * MENU_ROW, FOLDER_H - 8 - o * (MENU_ROW + 9)),
      wheeled: (keep) => { if (keep >= 0) view.at = keep + o; },
      draw: (i) => row(i + o) })));
}
