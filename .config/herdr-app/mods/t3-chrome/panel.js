// The space panel (docs/adr/0012, 0017): the `panel` column at the window's right, the `panel-body` stack its render slots.
// Each space keeps its record in t3.panels (docs/internals/storage.md). Where Herdr's own layout docks the Review extra in its
// stack instead (no `panel-empty` slot), the host owns the head and these only show the page.
import { layout, run, spaces, shared, setShared, exec, window } from "herdr";
import { KEY } from "./store.js";
import { GROUP_GAP } from "./button.js";
import { workFolder } from "./terminal-context.js";
import { surfaceActivate, surfaceAdd, surfaceOpenFile, surfaceNavigate, surfaceClose, surfaceResetFiles } from "./surfaces.js";

/** Layout `node`'s descendant (or itself) with `id`, else null. */
export const layoutNode = (node, id) => node?.id === id ? node : (node?.children ?? []).reduce((hit, c) => hit ?? layoutNode(c, id), null);
const activeSpaceId = () => spaces().find(p => p.active)?.id;
const panelSlots = () => (layoutNode(layout(), "panel-body")?.children ?? []).map(c => c.id);
// A tab's instance name: later than now, any copy's last born, and any tab already kept for this space, so a tab closed and added again in one moment is still another.
globalThis.t3LastBorn ??= 0;
function newBorn(space = activeSpaceId()) {
  const maxTab = (shared(KEY.panels)?.[space]?.tabs ?? []).reduce((m, t) => Math.max(m, Number(t.born) || 0), 0);
  return (globalThis.t3LastBorn = Math.max(Date.now(), globalThis.t3LastBorn, maxTab) + 1);
}

/** `space`'s tabs and the active one; Review's only where the extra is installed. */
export function surfacesFor(space = activeSpaceId(), slots = panelSlots()) {
  const kept = shared(KEY.panels)?.[space], tabs = (kept?.tabs ?? []).filter(t => t.id !== "review" || slots.includes("review"));
  return { tabs, active: tabs.some(t => t.id === kept?.active) ? kept.active : tabs[0]?.id ?? null };
}

/** The instance of `space`'s `id` tab (surfaces.js `born`), or null: none, or Herdr's own stack, which has no tabs. A mod
 * stamps what it keeps or asks for a tab with it, so a tab closed and added again doesn't take the old one's. */
export function surfaceBorn(id, space = activeSpaceId()) {
  const slots = panelSlots();
  return slots.includes("panel-empty") ? surfacesFor(space, slots).tabs.find(t => t.id === id)?.born ?? null : null;
}

/** What shows: open, wide, the stack's slot (`page`) and slots; `owns` this layout's surfaces; the active space's tabs
 *  (`space`, when the caller has found it). */
export function panelState(space = activeSpaceId()) {
  const root = layout(), panel = layoutNode(root, "panel"), body = layoutNode(root, "panel-body"), work = layoutNode(root, "work");
  const slots = (body?.children ?? []).map(c => c.id);
  return { open: Boolean(panel && !panel.hidden), page: body?.active ?? null, pages: slots, owns: slots.includes("panel-empty"),
    wide: Boolean(panel && work?.hidden), ...surfacesFor(space, slots) };
}

/** The tab bar's window part (t3-tabs' `window-end` block), in logical px, as t3-tabs draws it with the panel `open` or not;
 *  open, the panel head has its buttons. */
export function windowEndPx(open, space = activeSpaceId()) {
  const atHome = Boolean(space) && space === shared(KEY.home);
  return open ? 0 : (panelSlots().length && !atHome ? GROUP_GAP + 28 : 0) + (window()?.buttons ? 8 + 3 * 28 : 0);
}

// The panel shown or put away, the window part sized for it in the same go: the frame that shows the change has Details and
// the toggle where they end up. t3-tabs' fit() would size it only from that frame's measure, a frame late.
function showPanel(open, space) {
  run(open ? "layout.show" : "layout.hide", { id: "panel" });
  sizeWindowEnd(open, space, true);
}

function sizeWindowEnd(open, space, force = false) {
  const end = layoutNode(layout(), "window-end");
  if (!end) return;
  const px = windowEndPx(open, space);
  if (force || end.size?.px !== px) run("layout.resize", { id: "window-end", px });
}

const slot = (active) => active === "review" ? "review" : active ? "files" : "panel-empty";

// The active space's record, only its fields: what an older build kept beside them goes at the first write.
function save(want) {
  const id = activeSpaceId();
  if (!id) return;
  const all = shared(KEY.panels) ?? {}, was = all[id] ?? {};
  setShared(KEY.panels, { ...all, [id]: { tabs: was.tabs ?? [], active: was.active ?? null, open: Boolean(was.open), wide: Boolean(was.wide), ...want } });
}

// A step's result shown: stored, its slot selected, the panel open. Opening the panel puts Details away (T3).
function showSurfaces(next, keepDetails = false) {
  save({ tabs: next.tabs, active: next.active, open: true });
  run("layout.select", { stack: "panel-body", child: slot(next.active) });
  showPanel(true);
  if (!keepDetails) run("t3-actions.dismiss-details", {});
}

/** A tab picked (its tab, a key): it shows and is revealed again. */
export function activateSurface(id, keepDetails = false) {
  const s = panelState();
  if (!s.tabs.some(t => t.id === id)) return false;
  showSurfaces(surfaceActivate(s, id), keepDetails);
  return true;
}

/** "files" or "review" added, or picked if it's there. In Herdr's own layout, its page shown. */
export function showPage(page, keepDetails = false) {
  const s = panelState();
  if (!s.pages.includes(page)) return false;
  if (!s.owns) { run("layout.select", { stack: "panel-body", child: page }); showPanel(true); return true; }
  showSurfaces(surfaceAdd(s, page, newBorn()), keepDetails);
  return true;
}

/** A file opened from Files: its tab, or a new one (surfaces.js openFile). Not a reveal: Files shows it itself. */
export function openFile(path) { showSurfaces(surfaceOpenFile(panelState(), path, newBorn())); }

/** A breadcrumb's folder, from the active tab (surfaces.js navigateFolder). */
export function navigateFolder(path, trail = path, keep = false) { showSurfaces(surfaceNavigate(panelState(), path, trail, keep, newBorn())); }

/** Drops `space`'s file/folder tabs when its Files root changes, keeping generic Files and Review. */
export function resetFilesTabs(space = activeSpaceId()) {
  if (!space) return false;
  const slots = panelSlots();
  if (!slots.includes("panel-empty")) return false;
  const all = shared(KEY.panels) ?? {}, was = all[space];
  if (!was?.tabs?.length) return false;
  const current = surfacesFor(space, slots), next = surfaceResetFiles(current, newBorn(space));
  if (next === current) return false;
  setShared(KEY.panels, { ...all, [space]: { tabs: next.tabs, active: next.active, open: Boolean(was.open), wide: Boolean(was.wide) } });
  return true;
}

/** mode: "one", "others", "right", "all" (surfaces.js close). The last one gone puts the panel away. Each mod lets go of what a
 * closed tab held when its `born` is gone from the list. In Herdr's own layout, the panel goes. */
export function closeSurface(id = panelState().active, mode = "one") {
  const s = panelState();
  if (!s.owns) { hidePanel(); return; }
  const next = surfaceClose(s, id, mode);
  if (next === s) return;
  if (next.active) { showSurfaces(next); return; }
  save({ tabs: next.tabs, active: null });
  run("layout.select", { stack: "panel-body", child: "panel-empty" });
  hidePanel();
}

// Default px width when restoring a widened panel whose pre-wide width wasn't recorded in this run.
const PANEL_PX = 540;
function setWide(wide) {
  const panel = layoutNode(layout(), "panel");
  if (wide) {
    const px = panel?.size?.px;
    if (Number.isFinite(px) && px > 0) globalThis.t3PanelPx = px;
    run("layout.resize", { id: "panel", weight: 1 });
    run("layout.hide", { id: "work" });
  } else {
    if (panel && !panel.size?.px) run("layout.resize", { id: "panel", px: globalThis.t3PanelPx ?? PANEL_PX });
    run("layout.show", { id: "work" });
  }
}

// Put away: the work column back if the panel had taken its place; the tabs stay.
export function hidePanel() {
  const s = panelState();
  if (s.wide) setWide(false);
  showPanel(false);
  if (s.owns) save({ open: false, wide: false });
}

/** A page's own entry: opens the panel on it, or puts away the panel already showing it. Without one: the panel as it was. */
export function togglePanel(page) {
  const s = panelState();
  if (s.open && (!page || (s.owns ? s.active : s.page) === page)) hidePanel();
  else if (page) showPage(page);
  else if (!s.owns) { if (s.page) showPage(s.page); }
  else if (s.active) activateSurface(s.active);
  else {
    run("layout.select", { stack: "panel-body", child: "panel-empty" });
    showPanel(true);
    run("t3-actions.dismiss-details", {});
    save({ open: true, wide: false });
  }
}

// The panel over the whole work area, the tab bar included, and back: for a split diff or a long file.
export function toggleWide() {
  const s = panelState();
  if (!s.open) return;
  setWide(!s.wide);
  save({ wide: !s.wide });
}

// The Review extra's keys, by space id, that the layout reads: what each space's Review shows (its scope, written by Review's
// keep()) and its run's status word. Named once here, as store.js's KEY names the layout's own (an extra's aren't `t3`).
export const REVIEW_SHOWN = "review.shown", REVIEW_STATUS = "review.status";

/** What `space`'s Review shows (`review.shown`), while the tab that showed it is still there (its `born`): a closed one's is gone. */
export function reviewShown(space) {
  const shown = shared(REVIEW_SHOWN)?.[space];
  return shown && (shown.born ?? null) === surfaceBorn("review", space) ? shown : null;
}

/**
 * Asks `space`'s Review for `page` of `root` (the `review` key, docs/internals/storage.md): past the last request's number, and
 * naming the already shown Review tab (`born`), so a tab closed meanwhile doesn't take it up. For an outside pick use openReview.
 */
export function reviewRequest(space, root, page, { base = undefined, analyze = false } = {}) {
  const born = surfaceBorn("review", space);
  setShared("review", { space, root, page, ...(base ? { base } : {}), n: Math.max(Date.now(), Number(shared("review")?.n ?? 0) + 1), analyze: Boolean(analyze), ...(born != null && { born }) });
}

/** Shows a source space's selected Review range, then sends it to the tab just shown. The caller owns repository validation
 * and any popup it needs to close afterwards (`keepDetails` defers Details' dismissal to the caller). */
export function openReview({ space, root, page, base = undefined, analyze = false }, keepDetails = false) {
  if (!space || space !== activeSpaceId()) return "stale";
  if (!showPage("review", keepDetails)) return "unavailable";
  reviewRequest(space, root, page, { base, analyze });
  return "opened";
}

/**
 * Why Review can't read `space` now, or "" when it can: a space on another machine, or no Git repository where its tab works
 * (terminal-context.js workFolder: the last terminal's cwd, else the space folder), as T3's diff panel follows its thread's
 * folder. `root` is that repository, Review's default. Not installed: no Review to ask about (panelState().pages).
 * @returns {Promise<{ root: string | null, problem: string }>}
 */
export const reviewRepo = async (space = activeSpaceId()) => {
  const sp = spaces().find(s => s.id === space);
  if (!sp) return { root: null, problem: "No space is open." };
  const folder = workFolder(sp.id);
  const top = folder ? await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "rev-parse", "--show-toplevel"], { cwd: folder, ...(sp.machine ? { on: sp.machine } : {}) }).catch(() => null) : null;
  const root = top?.code === 0 && top.stdout?.trim();
  return root ? { root, problem: "" } : { root: null, problem: "This tab's folder is not in a Git repository." };
};

// Each space keeps its panel, as T3 keeps one per thread; the width stays the window's.

const same = (a, b) => a.open === b.open && a.page === b.page && a.wide === b.wide;
// The panel as `space` left it; closed if it never had one.
function keptFor(space) {
  const kept = shared(KEY.panels)?.[space];
  return { open: Boolean(kept?.open), page: slot(surfacesFor(space).active), wide: Boolean(kept?.open && kept?.wide) };
}
function lay(want, space) {
  run("layout.select", { stack: "panel-body", child: want.page });
  setWide(want.wide);
  showPanel(want.open, space);
}

/**
 * Lays the panel out as `space` left it in the same go as the select that will show that space, so its first frame has it
 * (t3-tabs' `arrive`). Until spaces() catches up, syncPanel leaves it be while it still observes the source.
 */
export function restorePanel(view, space, source = activeSpaceId()) {
  const s = panelState();
  if (!s.owns) return;
  const want = keptFor(space), supersedes = Boolean(view.panelPending);
  view.panelSpace = space;
  view.panelPending = { want, until: Date.now() + 1000, space, source };
  // A previously queued change may not be reflected in layout() yet, so match the destination even if the snapshot does.
  if (supersedes || !same(want, s)) lay(want, space);
  else sizeWindowEnd(want.open, space);
}

/**
 * Switching spaces shows that space's panel; whatever opens, closes or widens it is recorded. Called from render by one copy
 * that always shows (t3-tabs' `keys`); its first frame starts from what shows rather than restoring. Returns the space
 * whose work frame should be kept, including the prepared target while the model still reports the source.
 */
export function syncPanel(view) {
  const id = activeSpaceId(), s = panelState(id);
  if (!id || !s.owns) { view.panelSpace = view.panelPending = null; return id; }
  // Laid out ahead of a select (restorePanel) that spaces() doesn't show yet.
  const pending = view.panelPending;
  if (pending?.space && id === pending.source && id !== pending.space && Date.now() < pending.until) return pending.space;
  if (id !== view.panelSpace) {
    const first = view.panelSpace == null;
    view.panelSpace = id; view.panelPending = null;
    const want = keptFor(id);
    if (!first && !same(want, s)) {
      // The layout's clicks land after this frame: until then (or until something else wins) what shows isn't a choice.
      view.panelPending = { want, until: Date.now() + 1000 };
      lay(want, id);
      return id;
    }
    if (!first) sizeWindowEnd(want.open, id);
  }
  if (view.panelPending) {
    if (!same(view.panelPending.want, s) && Date.now() < view.panelPending.until) return id;
    view.panelPending = null;
  }
  // shortcut: a closed space's entry stays; prune by spaces() if the record ever grows noticeably.
  const kept = shared(KEY.panels)?.[id];
  if (Boolean(kept?.open) !== s.open || Boolean(kept?.wide) !== s.wide) save({ open: s.open, wide: s.wide });
  return id;
}
