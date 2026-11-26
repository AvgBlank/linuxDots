import { div } from "gpui-kit";
import { hoverKept } from "./tip.js";
import { h_flex } from "gpui-base";
import { treeRows, pathEntries, sortEntries, treeList, treeRow, revealRow, statusBadge } from "./file-tree.js";
import { foldAllButton, NAV_NARROW } from "./nav-column.js";
import { PANE, checkMark } from "./controls.js";
import { groupFiles } from "./rows.js";
import { categoryIcon, criticalMark } from "./groups.js";
import { spaces, window as appWindow } from "herdr";
import { terminalFor } from "./terminal-context.js";
import { knownTargets } from "./open-in.js";
import { openMenu, rowItems } from "./menus.js";
import { join } from "./file-listing.js";
import { closedKey } from "./store.js";
import { popupOpen } from "./trigger.js";
import { MENU_ROW } from "./menu-row.js";

export const TREE = "review-files";

// The column's head, as T3's diff file tree's: `Files` and how many, then Collapse all / Expand all.
export function navHead(view, t) {
  treeOf(view);
  // The group shown's, as the tree lists them.
  const g = view.group(), count = g ? groupFiles(g).length + g.missing.length + g.children.reduce((n, c) => n + c.missing.length, 0) : 0;
  const dirs = view.treeOf.dirs, folded = dirs.some(path => !isOpen(view, path));
  return h_flex().flex_1().min_w(0).gap(4).items_center()
    // 8 in, where Files' search icon and the rows' chevrons start.
    .child(div().text_size(12).font_medium().child("Files"))
    .child(div().id("review-nav-count").flex_1().min_w(0).text_size(11).text_color(t.dim).child(String(count)))
    .when(dirs.length > 0, el => el.child(foldAllButton(view, t, `mods/${PANE}`, "review-fold-all", folded, (cx) => {
      for (const path of dirs) setOpen(view, path, folded);
      cx.notify();
    })));
}

/** The group shown in the panel's file tree, in the diff's order: its folders and files, then its subgroups', in Files' rows
 *  (file-tree.js treeRow). The reviewed box leads every row, three-state on a folder or subgroup. Only the rows in view
 *  are drawn: a review runs to thousands of files. */
export function fileTree(view, t) {
  const mod = `mods/${PANE}`;
  const space = spaces().find(s => s.id === view.space), on = space?.machine ?? null;
  const pathRow = (row, id, options, deleted = false) => treeRow(t, mod, row, id, { ...options,
    context: popupOpen(view, id, closedKey(PANE, "menu")),
    // A compact folder's top has the same synthetic subgroup prefix as its last path; trim only that prefix.
    drag: deleted ? undefined : { path: join(view.root, row.dir ? row.top.slice(row.path.length - row.real.length) : row.path), on } })
    .on_mouse_down("right", (_e, cx) => {
      cx.stop_propagation();
      const agent = terminalFor(view.space), editors = (knownTargets() ?? []).filter(name => name !== "Finder");
      const count = rowItems({ remote: Boolean(on), platform: appWindow()?.platform, agent, editors, deleted }).length;
      openMenu("row", { height: 8 + count * MENU_ROW }, { menuMod: PANE,
        source: { space: view.space, tab: space?.tabs.find(tab => tab.active)?.id, root: view.root, on },
        path: row.real ?? row.path, deleted, agent: agent ? { terminal: agent.terminal } : null, editors });
      // The open row is remembered only for this run, as Files' context highlight is.
      view.opened = { id, at: Date.now() };
      cx.notify();
    });
  const checkbox = (id, files, label) => {
    const done = files.filter(f => f.reviewed).length, state = !done ? "none" : done === files.length ? "all" : "some";
    return checkMark(t, state).id(id).role("check_box").accessibility_label(`${label}: ${done} of ${files.length} reviewed`)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => { cx.stop_propagation(); view.setReviewed(files, state !== "all", cx); });
  };
  const rows = treeOf(view), ringed = view.handle.is_focused() && view.focusPath ? rows.findIndex(r => r.path === view.focusPath) : -1, guides = view.treeHot === "tree";
  // The file in front, wherever the list or a key put it, shows in the tree.
  if (view.revealedCurrent !== view.current) { view.revealedCurrent = view.current; if (view.current) revealRow(view, TREE, view.current); }
  const draw = (row, i) => {
    const focused = i === ringed;
    if (row.group) {
      const g = row.group, files = groupFiles(g).map(path => view.fileAt(path)).filter(Boolean), critical = g.critical || g.children.some(c => c.critical);
      // As the app's DiffGroupNavItem, in one 24 row: its category icon, title, critical mark and how many files.
      return treeRow(t, mod, row, `tree-g-${g.key}`, { focused, guides, icon: categoryIcon(t, g.category, true),
        leading: checkbox(`tree-gcheck-${g.key}`, files, g.label),
        trailing: h_flex().flex_none().gap(6).items_center()
          .when(critical, el => el.child(criticalMark(t, 14)))
          .child(div().text_size(11).text_color(t.dim).child(String(files.length))) })
        .on_click((_e, cx) => { view.focusPath = null; pickGroup(view, row, cx); });
    }
    if (row.dir) {
      const files = (underFolders(view, row.owner).get(row.real) ?? []).map(path => view.fileAt(path)).filter(Boolean);
      return pathRow(row, `tree-d-${row.path}`, { focused, guides, leading: checkbox(`tree-dcheck-${row.path}`, files, row.name) })
        .on_click((_e, cx) => { view.focusPath = null; toggleDir(view, row.path, cx); });
    }
    // A removed file has no box: its slot stays, so the icons line up.
    if (row.missing) return pathRow(row, `tree-m-${row.path}`, { focused, guides, dim: true, struck: true, leading: div().size(16).flex_none() }, true);
    const f = view.fileAt(row.path);
    if (!f) return div().id(`tree-f-${row.path}`);
    return pathRow(row, `tree-f-${row.path}`, { selected: view.current === row.path, focused, guides, status: LETTER[f.status] ?? "M", dim: f.reviewed, struck: f.reviewed,
      leading: checkMark(t, f.changed ? "changed" : f.reviewed ? "all" : "none").id(`tree-check-${row.path}`).role("check_box")
        .accessibility_label(f.reviewed ? `${row.path}: reviewed` : `${row.path}: not reviewed`)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => { cx.stop_propagation(); view.setReviewed(f, !f.reviewed, cx); }) }, f.status === "removed")
      .on_click((_e, cx) => { view.focusPath = null; if (view.width < NAV_NARROW) view.narrowNav = false; view.select(row.path, cx); });
  };
  // The indent guides show while the pointer is on the tree, as Files'.
  return hoverKept(view, "treeHot", "tree", div().id("review-tree").size_full().child(treeList(view, TREE, rows, draw)));
}

/** The tree's entries (file-tree.js treeRows) for one group: its own files, then its subgroups (`group:<key>`, never joined to
 *  a folder), each with its files. A subgroup's folder's path is the subgroup's and its own (`group:<key>/src`), as a folder
 *  can be in two; `real` is its own, `owner` the group whose files it holds. */
function reviewEntries(top) {
  const kids = new Map([["", []]]);
  if (!top) return kids;
  const files = (at, g) => {
    const own = pathEntries([...g.files.map(path => ({ path })), ...g.missing.map(path => ({ path, missing: true }))]);
    // Files were ordered on read; only missing paths still need merging into that order.
    for (const [dir, list] of own) kids.set(at && dir ? `${at}/${dir}` : at || dir, (g.missing.length ? sortEntries(list) : list).map(e => e.dir ? { ...e, path: at ? `${at}/${e.path}` : e.path, real: e.path, owner: g } : e));
  };
  const group = (g, parent, at) => {
    kids.get(parent === top ? "" : `group:${parent.key}`).push({ name: g.label, dir: true, path: at, group: g, parent, flat: false });
    files(at, g);
    for (const child of g.children) group(child, g, `group:${child.key}`);
  };
  files("", top);
  for (const child of top.children) group(child, top, `group:${child.key}`);
  return kids;
}

// The tree's rows, made again only for another read or group, or a folder opened or closed.
export function treeOf(view) {
  if (view.treeOf?.review !== view.review || view.treeOf.group !== view.groupKey || view.treeOf.closed !== view.dirsMoved) {
    const kids = reviewEntries(view.group());
    view.treeOf = { review: view.review, group: view.groupKey, closed: view.dirsMoved, dirs: [...kids.keys()].filter(Boolean),
      rows: treeRows(rel => kids.get(rel) ?? [], path => isOpen(view, path)) };
  }
  return view.treeOf.rows;
}

// A group's files under each of its folders, made with the tree's rows, so a folder row drawn doesn't filter the whole group.
function underFolders(view, group) {
  const made = view.treeOf.under ??= new Map();
  if (!made.has(group)) {
    const under = new Map();
    for (const path of group.files) for (let at = path.indexOf("/"); at > 0; at = path.indexOf("/", at + 1)) {
      const dir = path.slice(0, at), list = under.get(dir);
      if (list) list.push(path); else under.set(dir, [path]);
    }
    made.set(group, under);
  }
  return made.get(group);
}

// Folders start folded, as Files'; a subgroup's row (`group:<key>`) open. `flipped` holds the rows turned from that.
export const isOpen = (view, path) => /^group:[^/]*$/.test(path) !== view.flipped.has(path);
function setOpen(view, path, open) {
  if (isOpen(view, path) === open) return false;
  view.flipped.has(path) ? view.flipped.delete(path) : view.flipped.add(path);
  view.dirsMoved = (view.dirsMoved ?? 0) + 1;
  return true;
}

export function toggleDir(view, path, cx) {
  setOpen(view, path, !isOpen(view, path));
  cx.notify();
}

/** A subgroup's row: opened, and its header brought to the diff's top. */
export function pickGroup(view, row, cx) {
  setOpen(view, row.path, true);
  const index = view.items().findIndex(item => item.key === `g:${row.group.key}`);
  if (index >= 0) view.scrollToTop(index, cx);
  cx.notify();
}

/** The groups list's row: that group shown, the diff and the tree from their tops. */
export function showGroup(view, key, cx) {
  if (key !== view.groupKey) { view.groupKey = key; view.version++; view.scrollTop = { ...view.scrollTop, [TREE]: 0 }; view.scrollToTop(0, cx); }
  cx.notify();
}

// The tree's folders and groups down to a file, opened: a jump to it shows it wherever it is.
export function openTo(view, path) {
  const owner = view.review.groups.flatMap(g => [g, ...g.children]).find(g => g.files.includes(path) || g.missing.includes(path));
  if (!owner) return;
  const sub = !view.review.groups.includes(owner), at = sub ? `group:${owner.key}/` : "";
  const parts = path.split("/").slice(0, -1).map((_, i, all) => at + all.slice(0, i + 1).join("/"));
  for (const p of [...(sub ? [`group:${owner.key}`] : []), ...parts]) setOpen(view, p, true);
}

// A change's letter, as the app's FileStatus.
const LETTER = { added: "A", removed: "D", modified: "M", renamed: "R", copied: "C" };
export const fileStatus = (status) => statusBadge(LETTER[status] ?? "M");
