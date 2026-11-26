// A space panel's surfaces (docs/adr/0017, 0018), as T3 Code's rightPanelStore keeps them; pure, panel.js stores the result.
// A tab's `id` is "files" (the generic Files), "review" or `file:<path>` (with `folder`, a folder's tree from there).
// `born` names one instance, so a mod tells a re-added tab from the one it read for; `reveal` counts picks, as T3's revealRequestId.

const surfaceFile = (path, born, extra = {}) => ({ id: `file:${path}`, path, born, reveal: 0, ...extra });

/** Picking a tab: it shows, and is revealed again. */
export function surfaceActivate(s, id) {
  if (!s.tabs.some(t => t.id === id)) return s;
  return { tabs: s.tabs.map(t => t.id === id ? { ...t, reveal: (t.reveal ?? 0) + 1 } : t), active: id };
}

/** `+` or a surface's key: "files" or "review", picked if it's there, else added at the end. */
export function surfaceAdd(s, id, born) {
  return s.tabs.some(t => t.id === id) ? surfaceActivate(s, id) : { tabs: [...s.tabs, { id, born, reveal: 0 }], active: id };
}

/** A file opened in Files: its tab if it has one, else a new one in the generic Files' place, else at the end. The generic Files goes. */
export function surfaceOpenFile(s, path, born) {
  const id = `file:${path}`, had = s.tabs.find(t => t.id === id);
  // A folder tab whose path is a file now: the same tab, as a file.
  const tab = had && !had.folder ? had : surfaceFile(path, had?.born ?? born, had ? { reveal: had.reveal ?? 0 } : {});
  const generic = s.tabs.findIndex(t => t.id === "files");
  const tabs = s.tabs.flatMap((t, i) => t.id === id ? [tab] : i === generic ? (had ? [] : [tab]) : [t]);
  return { tabs: had || generic >= 0 ? tabs : [...tabs, tab], active: id };
}

/**
 * A breadcrumb's folder, from the active tab: as T3's navigateFolder, `keep` keeps that tab (a file's crumb opens its folder
 * beside it), else the folder takes its place. The root is the generic Files. `trail` is the file the crumbs were read from.
 */
export function surfaceNavigate(s, path, trail, keep, born) {
  const at = s.tabs.findIndex(t => t.id === s.active);
  if (at < 0) return s;
  const id = path ? `file:${path}` : "files", there = s.tabs.some((t, i) => i !== at && t.id === id);
  // The root is the generic Files, as a folder: it keeps the trail back to the file.
  const target = { ...(path ? surfaceFile(path, born, { folder: true }) : { id, born, reveal: 0, folder: true }), ...(trail !== path ? { trail } : {}) };
  const tabs = s.tabs.flatMap((t, i) => i === at ? [...(keep ? [t] : []), ...(there ? [] : [target])]
    : !there && path && t.id === "files" ? [] : [t]);
  return { tabs, active: id };
}

/**
 * mode: "one", "others", "right" or "all", from tab `id`. Closing the active one picks its right neighbour, else its left;
 * any other keeps the active one. All go in one step, so a bulk close never shows the empty page between.
 */
export function surfaceClose(s, id, mode = "one") {
  const at = s.tabs.findIndex(t => t.id === id);
  if (at < 0) return s;
  const tabs = s.tabs.filter((t, i) => mode === "all" ? false : mode === "others" ? t.id === id : mode === "right" ? i <= at : t.id !== id);
  if (tabs.some(t => t.id === s.active)) return { tabs, active: s.active };
  const was = s.tabs.findIndex(t => t.id === s.active);
  return { tabs, active: (s.tabs.slice(was + 1).find(t => tabs.includes(t)) ?? tabs.at(-1))?.id ?? null };
}

/** Drops every file/folder tab when Files changes root, keeping generic Files (without a stale trail) and Review.
 *  If the active tab was removed, switches to generic Files, adding one when absent. */
export function surfaceResetFiles(s, born) {
  let changed = false;
  const kept = [];
  for (const t of s.tabs) {
    if (t.path) { changed = true; continue; }
    if (t.id === "files" && (t.folder || t.trail !== undefined)) {
      changed = true;
      kept.push({ id: "files", born: t.born, reveal: t.reveal ?? 0 });
    } else kept.push(t);
  }
  if (!changed) return s;
  if (!s.active || kept.some(t => t.id === s.active)) return { tabs: kept, active: s.active };
  return kept.some(t => t.id === "files")
    ? { tabs: kept, active: "files" }
    : { tabs: [...kept, { id: "files", born, reveal: 0 }], active: "files" };
}
