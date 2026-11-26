import { step, menuJump } from "./list.js";
import { settingsBack, submitModel } from "./settings.js";
import { FOLDS, foldAll } from "./diff.js";
import { scopeKey } from "./scope-header.js";
import { treeKey, revealRow } from "./file-tree.js";
import { TREE, toggleDir, pickGroup } from "./files.js";
import { NAV_NARROW } from "./nav-column.js";

export function reviewKey(view, e, cx) {
  // Typing a model name isn't a shortcut; Escape closes the panel. An open submenu has the keyboard.
  if (view.popup === "settings") {
    const page = view.settingsPage;
    // Escape closes the submenu, then the panel; ← the submenu, but in the model's search only once it's empty (else it's the caret's).
    if (e.keystroke === "escape") return page ? settingsBack(view, cx) : view.closePopup(cx);
    if (!page) return;
    if (e.key === "left" && (page !== "model" || !view.modelInput.value())) return settingsBack(view, cx);
    if (e.key === "enter" && page === "model") return submitModel(view, cx);
    const rows = view.pageRows();
    if ((e.key === "enter" || e.key === "space") && page !== "model") {
      const row = rows[view.pageAt];
      if (row) { settingsBack(view, cx); row.pick(cx); }
      return;
    }
    // In the search field, Home and End are the caret's and typing is the field's.
    const to = page === "model" ? step(e, view.pageAt, rows.length) : menuJump(view, e, rows.map(r => r.name), view.pageAt);
    if (to >= 0) { view.pageAt = to; cx.stop_propagation(); cx.notify(); }
    return;
  }
  if (view.popup === "fold") {
    if (e.keystroke === "escape") view.closePopup(cx);
    else if (e.key === "enter" || e.key === "space") { if (view.review && !view.switching && FOLDS[view.foldAt]) foldAll(view, FOLDS[view.foldAt], cx); }
    else {
      const to = menuJump(view, e, FOLDS.map(fold => fold.label), view.foldAt);
      if (to < 0) return;
      view.foldAt = to;
    }
    cx.stop_propagation(); cx.notify();
    return;
  }
  if (scopeKey(view, e, cx)) return;
  // The status has no keys of its own, and what's under it is out of reach while it's up.
  if (view.popup && e.keystroke !== "escape") return;
  // The file tree's keys, as T3's: the ring moves, ↵ shows its file or group, or opens its folder; ←/→ fold.
  const rows = view.treeShown && !view.switching ? view.treeOf?.rows : null;
  const k = rows && treeKey(e.keystroke, rows, rows.findIndex(r => r.path === (view.focusPath ?? view.current)));
  if (k) {
    const row = k.toggle ?? k.pick;
    if (k.at !== undefined) { view.focusPath = rows[k.at].path; revealRow(view, TREE, view.focusPath); }
    else if (row.group && k.pick) { view.focusPath = row.path; pickGroup(view, row, cx); }
    else if (row.dir) { view.focusPath = row.path; toggleDir(view, row.path, cx); }
    else if (!row.missing) { view.focusPath = row.path; if (view.width < NAV_NARROW) view.narrowNav = false; view.select(row.path, cx); }
    cx.stop_propagation(); cx.notify();
    return;
  }
  const actions = {
    escape: () => view.closePopup(cx),
    j: () => view.step(1, cx), k: () => view.step(-1, cx),
    r: () => { const f = view.currentFile(); if (f) view.setReviewed(f, !f.reviewed, cx); },
    f: () => { const f = view.currentFile(); if (f) view.toggleFull(f, cx); },
    c: () => { if (view.current) { view.collapsed.has(view.current) ? view.collapsed.delete(view.current) : view.collapsed.add(view.current); view.version++; cx.notify(); } },
    s: () => view.toggleSplit(cx),
  };
  const action = actions[e.keystroke];
  // Switching, the list is the old page's: only Escape works.
  if (view.switching && e.keystroke !== "escape") return;
  if (action) { action(); cx.stop_propagation(); }
}
