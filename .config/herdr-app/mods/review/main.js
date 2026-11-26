// A pulls.review review, the one `review` surface of the space panel (docs/adr/0017), showing the active space's. Others ask
// for a page through shared(PANE); all of it comes from the jin.review daemon, on this machine only: a remote space has none.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, VirtualListScrollHandle, InputState, TextView } from "gpui-base";
import { checking, exec, layout, nextCommand, setShared, shared, spaces, theme, props, window as appWindow } from "herdr";
import { panelState, surfacesFor, closeSurface, reviewRepo, surfaceBorn, reviewRequest, reviewShown, layoutNode, REVIEW_SHOWN, REVIEW_STATUS } from "./panel.js";
import { workFolder } from "./terminal-context.js";
import { buildItems, contentWidth, groupFiles, rowsToAsk, wrapColumns, CHAR, LOOKAHEAD } from "./rows.js";
import { PANE, LU, SPLIT_MIN, DISABLED, HEADER, BELOW, pref, setPref, zoom, subState } from "./controls.js";
import { GROUP_GAP } from "./button.js";
import { popupClosed } from "./review-menu.js";
import { subOpened } from "./submenu.js";
import { colors, loadReview, loadRows, pollReview, applyReview, analyzeReview, toggleFull, recolorFulls } from "./review-load.js";
import { loadSettings, models, submitModel, pageRows, locale, settingsPanel, settingsSub, openPage } from "./settings.js";
import { scopeOf, diffCommits, scopeList, pickListed, openScope, chosenBase, changesPage, releaseScope } from "./review-scope.js";
import { openLit } from "./list.js";
import { openScopePage, scopeMenu, scopeSub, baseList, openBase, pickBase, baseMenu } from "./scope-header.js";
import { fileTree, navHead, openTo, showGroup } from "./files.js";
import { groupTabs } from "./groups.js";
import { loadingState, emptyState, errorBar } from "./panel-states.js";
import { navToggle } from "./nav-column.js";
import { withNav, navOpen, navShown } from "./nav-column.js";
import { setReviewed, headerPress, diffView, hbars, foldMenu } from "./diff.js";
import { analysisStatus, statusPanel, head, header } from "./header.js";
import { reviewKey } from "./keys.js";
import { wrapLines } from "./store.js";
import { initMenu, closeMenu, menuView, closeMenus } from "./menus.js";
import { installedTargets } from "./open-in.js";

// A request this young when its space's review starts is the click that opened the panel; an older one was already shown.
const FRESH = 10000;
// After a click or a key picks a file, the list is still scrolling to it this long: the file at its top isn't the one in front yet.
const PICKED = 600;
// The spaces shown last whose reviews stay whole; an older one's is read again when it shows (evict).
const KEEP = 3;

export default class ReviewPanel extends View {
  init(_props, cx) {
    if (props()?.files) return initMenu(this, cx);
    if (appWindow()?.platform === "macos") cx.spawn(async cx => { await installedTargets(); cx.notify(); });
    // Each space's review, by space id, for this run; what each shows is kept in review.shown.
    this.panel = this; this.bySpace = new Map();
    // The one popup open over the diff, if any: "settings", "status", "fold" or "scope".
    this.popup = null;
    this.agents = null; this.shared = null; this.settingsError = null;
    this.height = 600; this.width = 900; this.view = 600; this.diffHeight = 600; this.frames = 0;
    // A character's width in the code's font, measured once (diff.js), for where wrapped lines break; every space's review shares it.
    this.charWidth = null; this.wideWidth = null;
    // The model field searches the agent's catalog; Enter picks the model it names exactly, else the text as typed.
    this.modelInput = InputState.new({ placeholder: "Search or type a model" });
    // The row lit on a settings page and in the fold menu, by keys or the pointer; Enter on one picks it.
    this.pageAt = -1; this.foldAt = -1;
    // The inputs are the panel's; what they act on is the space shown.
    this.modelInput.on("change", (_e, cx) => { const s = this.shown(); if (s) s.pageAt = -1; cx.notify(); });
    this.modelInput.on("submit", (_e, cx) => { const s = this.shown(); if (s) submitModel(s, cx); });
    // The scope menu's lit row, its submenu open (null or "commits"), the row lit there, and its search: Enter picks that row.
    this.scopePage = null; this.scopeAt = -1; this.scopeListAt = -1;
    this.scopeSearch = InputState.new({ placeholder: "Search" });
    this.scopeSearch.on("change", (_e, cx) => { const s = this.shown(); if (!s) return; s.scopeListAt = 0; s.scrollTop = { ...s.scrollTop, "scope-list": 0 }; cx.notify(); });
    this.scopeSearch.on("submit", (_e, cx) => { const s = this.shown(); if (s) pickListed(s, scopeList(s)[s.scopeListAt], cx); });
    // The base picker's search, its lit row, and where its button is: Enter picks that row.
    this.baseAt = 0; this.baseX = null;
    this.refSearch = InputState.new({ placeholder: "Search refs" });
    this.refSearch.on("change", (_e, cx) => { const s = this.shown(); if (!s) return; s.baseAt = 0; s.scrollTop = { ...s.scrollTop, "base-list": 0 }; cx.notify(); });
    this.refSearch.on("submit", (_e, cx) => { const s = this.shown(), item = s && baseList(s)[s.baseAt]; if (item) pickBase(s, item.value, cx); });
    // The colors the rows on screen are in.
    this.colorsKey = JSON.stringify(colors(theme()));
    this.handle = cx.focus_handle();
    // Whether the file tree's column is open: the page's, for every space.
    this.navOpen = navOpen();
    // Under NAV_NARROW, the tree shown apart from that preference, for this run only; unset, it follows the preference.
    /** @type {boolean | undefined} */
    this.narrowNav = undefined;
    // `review.scope` (a key, or `herdr-app do`) toggles the shown review's scope menu, as its button does; `scope:commits`
    // opens it with that submenu; `review.base` the base picker the same way. `review.settings` the same for the settings, `settings:language`, `:agent`
    // or `:model` with that submenu. `review.close`, cmd-w while it has the keyboard, closes this surface.
    cx.spawn(async (cx) => {
      for (;;) {
        const [name, page] = (await nextCommand()).split(":"), s = this.shown();
        if (name === "close" && !closeMenus(PANE)) {
          if (s?.popup) s.closePopup(cx);
          else if (page !== "menu") closeSurface();
        }
        if ((name !== "scope" && name !== "settings" && name !== "base") || !s?.page) continue;
        if (!page || s.popup !== name) s.togglePopup(name, cx, true);
        if (name === "scope" && page === "commits") openScopePage(s, page, cx, 0);
        if (name === "settings" && ["language", "agent", "model"].includes(page)) openPage(s, page, cx, null, true);
        cx.notify();
      }
    });
    // Analysis status keeps going for every space's Review tab and bar. Full refresh runs only while Review is seen.
    const each = (f) => { for (const s of this.bySpace.values()) f(s); };
    cx.timer.every(1500, (cx) => each(s => { if (s.analyzing()) s.poll(cx); }));
    cx.timer.every(15000, (cx) => each(s => s.refresh(cx)));
    // Unseen, a review is due a read, which follows within a second of it being seen again. A space closed leaves nothing.
    cx.timer.every(1000, (cx) => {
      const byId = new Map(spaces().map(s => [s.id, s]));
      for (const [id, s] of this.bySpace) {
        const sp = byId.get(id);
        if (!sp || !s.surfaceAlive()) { s.evict(); this.bySpace.delete(id); if (this.front === s) this.front = null; }
        else if (!s.readable()) s.deferRead();
        else if (s.noRepo && !s.root && !s.loading) { if (workFolder(id) !== s.startFolder) s.start(sp, cx); }
        else if (s.dirty) s.load(cx);
      }
    });
    // Scrolling redraws only the list. What the rest shows of where it is - the aside's group, the files and groups in view,
    // as the app's scroll spy marks them - is checked here and redrawn when it moved.
    // Off screen, what the list shows can't move: nothing to measure.
    // The file at the list's top is the one in front, as the diff scrolls.
    cx.timer.every(150, (cx) => {
      const s = this.shown();
      if (!s?.onScreen()) return;
      const top = Date.now() - s.pickedAt > PICKED && s.topFile();
      if (top) s.current = top;
      const spied = s.spied();
      if (spied !== s.lastSpied) { s.lastSpied = spied; cx.notify(); }
    });
  }

  shown() { return this.panel.bySpace.get(spaces().find(s => s.active)?.id) ?? null; }

  /** A space's review, made the first time it shows. It inherits the panel (Object.create), so what takes `view` works on it
   *  unchanged, while what it writes, and what its reads write when they answer after the space has changed, stays its own. */
  spaceReview(space, cx) {
    const panel = this.panel;
    let s = panel.bySpace.get(space.id);
    const born = surfaceBorn("review", space.id);
    if (s && s.surfaceBorn !== born) { s.evict(); panel.bySpace.delete(space.id); if (panel.front === s) panel.front = null; s = null; }
    if (!s) { s = Object.create(panel); s.begin(space.id, space.machine ?? null); panel.bySpace.set(space.id, s); }
    s.on = space.machine ?? null;
    // Shown after another: the latest again, on its own timer, as is its list's scroll and its first read: none can start
    // while drawing (gpui-kit.d.ts). A request in that draw has asked for a read already.
    if (panel.front !== s) { panel.front = s; cx.timer.after(0, (cx) => panel.bring(s, space, cx)); }
    return s;
  }

  bring(s, space, cx) {
    if (this.bySpace.get(s.space) !== s) return;
    this.bySpace.delete(s.space); this.bySpace.set(s.space, s);
    [...this.bySpace.values()].slice(0, -KEEP).forEach(old => old.evict());
    if (!s.scroll) {
      s.evicted = false; s.scroll = VirtualListScrollHandle.new();
      if (!s.root) s.start(space, cx); else if (!s.loading && !s.review) s.load(cx);
    }
    cx.notify();
  }

  // Past the KEEP spaces shown last, a review keeps only what it was reading - its page, group, file and folds - and a run
  // going, for the status poll: its diff, rows, lists and scroll go, and a read out for it is dropped when it lands.
  evict() {
    if (this.evicted) return;
    releaseScope(this);
    // A run just asked for (startingUntil) keeps its state as it was, so the poll still sees it start, or a "not running" before then end nothing.
    const a = this.runState();
    this.awayAnalysis = this.analyzing() ? { state: a?.state ?? "none", error: a?.error ?? null } : null;
    this.evicted = true; this.dirty = true; this.restoreTo = this.current;
    this.loadId++; this.startId++; this.hiddenId++; this.loading = null; this.again = false; this.stale = false; this.error = null;
    this.review = null; this.switching = false; this.baseCommits = null; this.full.clear(); this.fullReads.clear(); this.parts.clear();
    this.scroll = null; this.wrapHold = {};
    // Back to the panel's own, none, as at begin.
    for (const key of ["itemList", "itemsId", "sizes", "visible", "paths", "pathsOf", "treeOf", "tabStats", "settling", "lastSpied", "revealedCurrent", "scopeGit", "picks", "refs"]) delete this[key];
  }

  // A space's review's own state, at its start: what review.shown says it showed, and requests from before it ignored.
  begin(space, on = null) {
    this.surfaceBorn = surfaceBorn("review", space);
    // What it showed, if that was this tab's: closed and added again, it starts from the default.
    const was = reviewShown(space);
    this.space = space; this.on = on; this.root = was?.root ?? null; this.page = was?.page ?? null; this.base = was?.base ?? this.page;
    this.handled = Date.now() - FRESH; this.noRepo = false; this.startFolder = null; this.startId = 0; this.evicted = false; this.awayAnalysis = null;
    // The width wrapped lines are cut at (`at`), a moment behind a width that's moving (nav-column.js holdWidth).
    this.wrapHold = {};
    // The page a count's click asked to analyze, until its first read.
    this.analyzeFor = null; this.baseCommits = null;
    this.review = null; this.error = null; this.version = 0; this.sideWidth = [0, 0, 0]; this.shift = [0, 0, 0];
    this.startingUntil = 0; this.loading = null; this.loadId = 0; this.hiddenId = 0; this.marks = 0; this.marking = 0;
    this.flipped = new Set(); this.focusPath = null; this.pickedAt = 0;
    this.collapsed = new Set(); this.full = new Map(); this.fullReads = new Map(); this.parts = new Map(); this.seen = new Set();
    this.scroll = null; this.barsOn = false; this.barsRun = 0;
  }

  // Nothing shown in this space yet: the repository where its tab works (panel.js reviewRepo), on its branch's Changes as T3's
  // diff panel opens, against the base picked for the space; a detached HEAD, with no branch, on its uncommitted changes.
  start(space, cx) {
    if (checking()) return;
    this.startFolder = workFolder(space.id);
    // Evicted or closed meanwhile (evict bumps loadId): a late answer sets nothing and reads no further.
    const id = this.loadId, probe = this.startId = (this.startId ?? 0) + 1;
    const live = () => !this.evicted && id === this.loadId && probe === this.startId;
    cx.spawn(async (cx) => {
      const { root } = await reviewRepo(space.id);
      if (!live()) return;
      if (this.root || !root) { this.noRepo = !this.root; return cx.notify(); }
      this.noRepo = false;
      this.root = root;
      const head = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "symbolic-ref", "--short", "-q", "HEAD"], { cwd: root, ...(this.on ? { on: this.on } : {}) }).catch(() => null);
      const branch = head?.code === 0 && head.stdout.trim();
      if (!live()) return;
      if (!this.page) { this.page = this.base = branch ? changesPage(chosenBase(this), branch) : "/worktree"; this.load(cx); }
      cx.notify();
    });
  }

  open(page, cx) {
    if (page === this.page) return;
    releaseScope(this);
    // The old page stays on screen, dimmed and inert, until the new one's read replaces it: apply() then resets what belonged to it.
    this.fullReads.clear();
    this.page = page; this.switching = Boolean(this.review); this.error = null; this.analyzeError = null; this.startingUntil = 0; this.awayAnalysis = null;
    this.wasRunning = false; this.news = null;
    this.version++;
    this.load(cx);
  }

  // No review shown, or none yet: what belonged to the last one goes with it.
  forget() { this.restoreTo = null; this.review = null; this.switching = false; this.groupKey = null; this.current = null; this.full.clear(); this.fullReads.clear(); this.parts.clear(); this.shift = [0, 0, 0]; }

  surfaceAlive() {
    return !panelState().owns || surfaceBorn("review", this.space) === this.surfaceBorn;
  }

  // This review's space the active one and the panel open on its review page, whichever window is in front.
  inView() {
    if (!this.surfaceAlive() || !spaces().some(s => s.active && s.id === this.space)) return false;
    const p = panelState();
    if (!p.open) return false;
    if (p.owns) return p.page === PANE && p.active === PANE;
    const node = layoutNode(layout(), PANE);
    return p.page ? p.page === PANE : Boolean(node && !node.hidden);
  }

  onScreen() { return appWindow()?.active !== false && this.inView(); }

  // Reads wait for the window to be in front, but for the first: until it lands or fails, the page says it is loading.
  readable() { return this.onScreen() || (!this.review && !this.error && this.inView()); }

  // Drop the visible period's reads and merge their retries into the next page refresh.
  deferRead() {
    if (!this.dirty) {
      this.hiddenId++;
      if (this.page) this.loadId++;
    }
    this.dirty = true; this.loading = null; this.again = false;
  }

  refresh(cx) { if (this.readable()) this.load(cx); else this.deferRead(); }

  load(cx, poll = false) { return loadReview(this, cx, poll); }

  loadRows(cx) { return loadRows(this, cx); }

  poll(cx) { return pollReview(this, cx); }

  apply(r) { return applyReview(this, r); }

  analyze(cx, force) { return analyzeReview(this, cx, force); }

  // A run going, as the app's from the click: the daemon answers before the worktree server has started it, and a read until then finds none.
  analyzing() { return this.runState()?.state === "running" || Date.now() < this.startingUntil; }

  // The run's state: the review's, or, evicted, what was kept of it.
  runState() { return this.switching ? null : this.review?.analysis ?? this.awayAnalysis; }

  // What the Review bar and the panel head's Review tab show, as the word an agent would report: a run going, then how it
  // ended until this review is looked at. In the review, the button keeps a failure.
  // shortcut: the panel's review page starts only when first shown, so the Review bar drops a run's word from before a restart (its main.js); with no bar in the layout, that word stays until the page is shown.
  report() {
    const a = this.runState(), real = a?.state === "running";
    if (this.wasRunning && !real) this.news = this.analyzeError ?? a?.error ? "blocked" : "done";
    this.wasRunning = real;
    if (this.analyzing() || this.onScreen()) this.news = null;
    this.keep(REVIEW_STATUS, this.analyzing() ? "working" : this.news ?? null);
  }

  // This space's entry in a value shared by space, none with no value. Every write redraws every mod: only a change, and
  // keys of no live space drop out.
  keep(key, value) {
    if (!this.surfaceAlive()) return;
    const all = shared(key) ?? {}, ids = new Set(spaces().map(s => s.id));
    const live = Object.entries(all).filter(([id]) => id !== this.space && ids.has(id));
    if (JSON.stringify(all[this.space] ?? null) === JSON.stringify(value) && live.length === Object.keys(all).length - (this.space in all ? 1 : 0)) return;
    setShared(key, Object.fromEntries(value ? [...live, [this.space, value]] : live));
  }

  // What this space's review shows: for the Review bar to light its count, and to show it again after a restart.
  // `label`: its scope button's words (a commit's subject once read), so Details names the same range.
  // `born`: the tab it was shown in (panel.js), so a closed tab's range isn't taken for a new one's, here or in Details.
  publish() { if (this.page) this.keep(REVIEW_SHOWN, { root: this.root, page: this.page, base: this.base, label: scopeOf(this).label, ...(this.surfaceBorn != null && { born: this.surfaceBorn }) }); }

  diffCommits() { return diffCommits(this); }

  models() { return models(this); }

  pageRows() { return pageRows(this); }

  locale() { return locale(this); }

  // A popup's button (trigger.js) or key toggles it. The settings read the daemon's agents and settings on opening: the browser may have changed them.
  // `keys`: opened by keys (a command, or its button with no pointer press), so a menu lights its first row (list.js openLit).
  togglePopup(name, cx, keys = false) {
    // The button's press stops there, short of the pane that would take the keyboard.
    this.handle.focus();
    if (this.popup === name) return this.closePopup(cx);
    releaseScope(this);
    this.popup = name; this.foldAt = openLit(keys);
    if (name === "settings") loadSettings(this, cx);
    // On the row shown, so ↑/↓ start from it.
    if (name === "scope") openScope(this, cx, openLit(keys));
    if (name === "base") openBase(this, cx);
    cx.notify();
  }

  // The scope menu's pick (review-scope.js): the menu goes and the keyboard is back on the pane, unless it `stays`.
  pick(page, { analyze = false, base = undefined, stays = false }, cx) {
    if (!stays) { this.closePopup(cx); this.handle.focus(); }
    reviewRequest(this.space, this.root, page, { base, analyze });
    cx.notify();
  }

  openCommits(cx, lit) { openScopePage(this, "commits", cx, lit); }

  // `outside`: closed by a press outside it, which may be on its own button.
  closePopup(cx, outside = false) {
    if (!this.popup) return;
    releaseScope(this);
    // A press outside may be on its own button, which mustn't reopen it.
    if (outside) setShared(popupClosed(this.popup), Date.now());
    this.popup = null;
    this.modelInput.set_value(""); this.scopeSearch.set_value(""); this.refSearch.set_value(""); this.pageAt = -1; this.settingsPage = null; this.scopePage = null;
    subOpened(subState(this), null);
    cx.notify();
  }

  setReviewed(files, reviewed, cx) { return setReviewed(this, files, reviewed, cx); }

  toggleFull(file, cx) { return toggleFull(this, file, cx); }

  group() { return this.review?.groups.find(g => g.key === this.groupKey) ?? null; }

  headerPress(file, x, cx) { return headerPress(this, file, x, cx); }

  // Rebuilt only when something it shows changed: render runs on every live change in Herdr. Of the files, only those whose
  // items changed are built again (`parts`); the rest of a group of thousands is joined as it was.
  items() {
    // Wrapped, lines break at the columns the diff's width holds, of the characters' measured widths (diff.js), once known.
    const char = this.charWidth ?? CHAR, wideChar = this.wideWidth ?? 2 * char, wide = wideChar / char;
    // At the width it last held (diff.js), so a drag doesn't cut every row in view at each step.
    const wrap = wrapLines() ? wrapColumns(this.wrapHold.at ?? this.view, char, wideChar) : null;
    const split = this.splitShown(), group = this.group(), id = `${this.version}:${this.groupKey}:${split}:${Math.round(this.view / 40)}:${wrap ? `${wrap.row}:${wrap.pair}` : ""}:${char}:${wide}`;
    if (id !== this.itemsId) {
      // Kept only once all of it is built: a throw part way would leave the list and its lookups out of step, never rebuilt.
      // A width's change counts each row's lines again (rows.js lineCount) and cuts only those drawn (diff.js).
      const list = group ? buildItems(this.review, group, { collapsed: this.collapsed, full: this.full, split, width: this.view, wrap, parts: this.parts }) : [];
      // In one pass: the heights v_virtual_list takes (the trailing blank's last), the height from the last header on, and
      // how wide the code runs, from each open file's widths, measured once per build of its items. Wrapped, nothing runs past.
      const measure = (items) => wrap ? [0, 0, 0] : split ? ["left", "right", "solo"].map(side => contentWidth(items, side, char, wide)) : [0, 0, contentWidth(items, undefined, char, wide)];
      const sizes = [], widths = measure([]);
      let tail = 0;
      for (const item of list) {
        sizes.push(item.size);
        if (item.kind === "file" || item.kind === "group") tail = 0;
        tail += item.size;
        const part = item.kind === "file" && !this.collapsed.has(item.path) && this.parts.get(item.path);
        if (part && part.widthsAt !== `${char}:${wide}`) { part.widths = measure(part.items); part.widthsAt = `${char}:${wide}`; }
        if (part) part.widths.forEach((w, i) => { widths[i] = Math.max(widths[i], w); });
      }
      sizes.push(0);
      // The range last drawn was another list's: until this one draws, scrollToTop mustn't go by it.
      this.itemsId = id; this.visible = null; this.itemList = list; this.sideWidth = widths; this.sizes = sizes; this.tail = tail; this.wrapCols = wrap;
    }
    return this.itemList;
  }

  // The list's heights as v_virtual_list takes them, the blank after the items last.
  listSizes() { const trailing = this.trailing(); this.sizes[this.sizes.length - 1] = trailing; return this.sizes; }

  // How far code can scroll sideways: a split side (0 left, 1 right), or the full-width rows (2: unified ones, or a split
  // view's added and removed files), as far as its longest line runs past its width.
  sideMax(side) { return Math.max(0, this.sideWidth[side] - (side === 2 ? this.view : this.view / 2)); }

  select(path, cx, { scroll = true } = {}) {
    const owner = this.review.groups.find(g => groupFiles(g).includes(path));
    if (owner && owner.key !== this.groupKey) { this.groupKey = owner.key; this.version++; }
    this.current = path; this.pickedAt = Date.now();
    openTo(this, path);
    if (scroll) {
      const index = this.items().findIndex(item => item.key === `f:${path}`);
      if (index >= 0) this.scrollToTop(index, cx);
    }
    cx.notify();
  }

  // The blank after the list, so its last header can still reach the top: a view's height less what follows that header.
  trailing() { this.items(); return Math.max(0, Math.ceil(this.diffHeight - this.tail)); }

  /** Brings an item's top to the list's top. The list scrolls only to the near edge (above the view lands at the top, below
   *  at the bottom): so below, bottom-align the first item a view's height past it, and once that frame is drawn scroll to
   *  this one, now above the view. Rows arriving in between rebuild the list: the item is found again by its key. */
  scrollToTop(index, cx) {
    const sizes = this.listSizes(), start = this.visible?.start ?? 0;
    const token = this.settling = {}, key = this.itemList[index]?.key, built = this.itemsId;
    if (index <= start) return this.scroll.scroll_to_item(index);
    let last = index, height = sizes[index];
    // A pixel's margin, so a rounded height still carries it past the top.
    while (height <= this.diffHeight + 1 && last + 1 < sizes.length) height += sizes[++last];
    this.scroll.scroll_to_item(last);
    const drawn = this.frames;
    let tries = 0;
    const settle = (cx) => {
      if (this.settling !== token) return;
      const at = this.items().findIndex(item => item.key === key);
      if (at < 0) return;
      if (this.itemsId !== built) return this.scrollToTop(at, cx);
      if (this.frames > drawn) { this.scroll.scroll_to_item(index); cx.notify(); }
      else if (++tries < 30) cx.timer.after(8, settle);
    };
    cx.timer.after(8, settle);
  }

  step(delta, cx) {
    const group = this.group();
    if (!group) return;
    const files = groupFiles(group), at = files.indexOf(this.current);
    const next = files[Math.min(files.length - 1, Math.max(0, at + delta))];
    if (next) this.select(next, cx);
  }

  currentFile() { return this.review?.files.find(file => file.path === this.current) ?? null; }

  rowsWanted() {
    const g = this.switching ? null : this.group();
    return g ? rowsToAsk(groupFiles(g), path => this.fileAt(path), this.visibleFiles(), this.collapsed) : [];
  }

  // The file cut short whose end the list shows or nears, as many items on as a batch looks files ahead: its next page is due.
  pageWanted() {
    const { start = 0, end = 0 } = this.visible ?? {};
    return this.switching ? null : (this.itemList ?? []).slice(start, end + LOOKAHEAD).find(item => item.more)?.path ?? null;
  }

  // A file by its path, from a map made once per read: a branch's files run to thousands, and a render looks up a group's every one.
  fileAt(path) {
    if (this.pathsOf !== this.review) { this.pathsOf = this.review; this.paths = new Map(this.review?.files.map(file => [file.path, file])); }
    return this.paths.get(path);
  }

  // The active space's review; a sentence where there is none to show.
  render(cx) {
    if (props()?.files) return menuView(this);
    const t = theme(), space = spaces().find(s => s.active);
    if (this.panel.front && this.panel.front.space !== space?.id) {
      releaseScope(this.panel.front);
      this.panel.front.deferRead();
    }
    // With no review to show, the toolbar names the page alone and keeps the column's switch, greyed.
    const note = (body) => v_flex().id("review-pane").size_full().text_color(t.foreground).text_size(12)
      .child(h_flex().id("review-header").h(HEADER).flex_none().px(12).gap(8).items_center()
        .child(div().id("review-title").flex_1().pl(8).font_medium().child("Review"))
        .child(navToggle(this, t, "mods/review", "review-nav-toggle", this.navOpen, () => {}, true)))
      .child(div().id("review-note").flex_1().min_h(0).child(body));
    const starting = () => note(loadingState("mods/review", t, "review-loading", "Loading the review…"));
    if (!space) return starting();
    if (panelState().owns && !surfacesFor(space.id).tabs.some(t => t.id === "review")) return div().size_full();
    const s = this.spaceReview(space, cx);
    s.follow(cx);
    if (!s.scroll) return starting();
    if (!s.page) return s.noRepo ? note(emptyState(t, "review-empty", `${LU}/file-diff.svg`, "Not a git repository", "The folder this tab works in isn't in a git repository.")) : starting();
    return s.draw(cx);
  }

  close() { if (props()?.files) closeMenu(this); }

  // What others ask of this space's review, and what it tells them.
  follow(cx) {
    this.report();
    // An open from the Review bar or the review's own commit switch: another page, maybe another worktree.
    const request = shared(PANE);
    // A request names the tab it's for (`born`): one for a tab since closed isn't this one's.
    if (request && request.space === this.space && request.n > this.handled && (request.born ?? null) === this.surfaceBorn) {
      this.handled = request.n;
      if (request.root !== this.root) { releaseScope(this); this.root = request.root; this.seen.clear(); this.collapsed.clear(); this.flipped.clear(); this.page = null; this.forget(); }
      // With the same base, ‹ › stepping to another page of the same diff: its commits stay.
      if (!request.base || request.base !== this.base) this.baseCommits = null;
      this.base = request.base ?? request.page;
      // Only the bar's counts ask for an analysis, so anything else takes back an ask not yet read.
      this.analyzeFor = request.analyze === true ? request.page : null;
      // The page already shown has no read coming to act on the ask.
      const again = this.analyzeFor && request.page === this.page;
      this.open(request.page, cx);
      if (again) this.load(cx);
    }
    this.publish();
  }

  draw(cx) {
    const t = theme();
    if (JSON.stringify(colors(t)) !== this.colorsKey) {
      this.colorsKey = JSON.stringify(colors(t));
      if (this.review) {
        for (const file of this.review.files) delete file.hunks;
        recolorFulls(this, cx);
        this.version++;
        this.load(cx);
      }
    }
    // Files in view or just after have no rows (just opened, scrolled to, or changed since): ask for them, one read at a time;
    // or a file cut short nears its end: its next page. Not after a failed read (Retry and the slow timer read again) nor
    // while a mark lands (its own read follows): a read then would fail or be dropped, and ask again at once.
    if ((this.rowsWanted().length || this.pageWanted()) && !this.loading && !this.error && !this.marking) this.loadRows(cx);
    const group = this.group();
    // The column lists the group's files; with none to list (no changes), it's away and its switch greyed.
    this.navShown = this.treeOpen();
    // The keys move in the file tree only while it's drawn.
    this.treeShown = this.navShown;
    // There's always a file in front while the group has one: its first, until a click, a key or the list's top says another.
    // Its folders open, so the tree shows it.
    if (group && !this.switching && !groupFiles(group).includes(this.current)) { this.current = groupFiles(group)[0] ?? null; if (this.current) openTo(this, this.current); }
    // Its run over, nothing else closes the panel: the next run would bring it back, or the next press only close it unseen.
    const { running, error } = analysisStatus(this);
    if (this.popup === "status" && (!this.review || this.switching || !(running || error))) this.popup = null;
    // Set again by the submenu drawn, if one is.
    this.subRect = null;
    // The settings and fold menus hang 4 under their 28 buttons (controls.js BELOW), right-aligned with them: the
    // settings' right edge past the 12 inset, the tree's switch and the group's gap (header.js), the fold's a button and a gap on.
    // Keys open them too, with no press to place them by.
    const right = 12 + 28 + GROUP_GAP, below = BELOW;
    return v_flex().id("review-pane").relative().size_full().min_h(0).text_color(t.foreground).text_size(12)
      // cmd-w and cmd-t are keys.json's (mod:review): review.close, t3-chrome.surface-menu.
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => this.handle.focus())
      // Where the pane is in the window: a submenu goes by its rows' bounds, which come in the window's.
      .on_mouse_move((e) => { this.paneAt = { x: e.bounds.x, y: e.bounds.y }; })
      .on_size_change((size, cx) => {
        const width = size.width / zoom(), height = size.height / zoom();
        if (Math.abs(width - this.width) >= 1 || Math.abs(height - this.height) >= 1) { this.width = width; this.height = height; cx.notify(); }
      })
      .child(header(this, t, this.head()))
      .when(Boolean(this.error), el => el.child(errorBar(t, "review-error", this.error, (cx) => this.load(cx), this)))
      // The groups, as pulls.review's tabs, across the page: the one picked is the diff and the tree.
      .children(this.review && !this.switching ? [groupTabs(this, t, (key, cx) => showGroup(this, key, cx))].filter(Boolean) : [])
      .child((!this.review
        // As the app's FeedbackLoading.
        ? div().flex_1().min_h(0).when(!this.error, el => el.child(loadingState("mods/review", t, "review-loading", "Loading the review…")))
        // The diff on the left, the files in the panel's navigation column on the right, at the window's edge (ADR 0013).
        : div().flex_1().min_h(0).child(withNav(t, "review", this.width, { open: this.navShown, head: navHead(this, t), list: fileTree(this, t).size_full(),
          // The group shown's summary over its diff, as the app's group header: its title 13 medium, its words 12.
          content: v_flex().size_full().min_w(0)
            // A rule-based group's summary is the daemon's boilerplate for its folder rule.
            .when(Boolean(group?.summary) && this.review.source !== "rule-based", el => el.child(v_flex().id("group-summary").flex_none().max_h(160).overflow_hidden().px(12).py(10).gap(4)
              .child(div().text_size(13).font_medium().child(group.label))
              .child(TextView.markdown(`summary-${group.key}`, group.summary).selectable(true).scrollable(false).text_size(12).text_color(t.muted))))
            .child(div().flex_1().min_h(0).child(diffView(this, t))) }))).when(Boolean(this.switching), el => el.opacity(DISABLED)))
      // Built only while open: render runs on every live change, and a catalog runs to hundreds of rows.
      // Each 4 under its button (T3's sideOffset) in the header.
      .when(this.popup === "settings", el => el.child(div().id("settings-anchor").absolute().top(below).right(right).child(settingsPanel(this, t))))
      .when(this.popup === "settings" && Boolean(this.settingsPage), el => el.child(settingsSub(this, t)))
      // Under its button, the one left of the gear.
      .when(this.popup === "fold" && Boolean(this.review) && !this.switching, el => el.child(div().id("fold-anchor").absolute().top(below).right(right + 28 + GROUP_GAP).child(foldMenu(this, t))))
      // Under the header's left end, where the scope button starts.
      .when(this.popup === "scope", el => el.child(div().absolute().top(below).left(12).child(scopeMenu(this, t))))
      .when(this.popup === "scope" && Boolean(this.scopePage), el => el.child(scopeSub(this, t)))
      // Under its button in the header, where its press found it.
      .when(this.popup === "base", el => el.child(baseMenu(this, t)))
      // At the pane's end rather than under its button: 320 wide, it would run off a narrow pane from there.
      .when(this.popup === "status", el => el.child(div().absolute().top(below).right(12).child(statusPanel(this, t))))
      ;
  }

  // Split as chosen, where the diff is wide enough for two sides; narrower it's unified, the choice kept.
  splitShown() { return pref("split") === true && this.view >= SPLIT_MIN; }

  // No files for the column to list: no changes in this diff.
  navEmpty() { return !this.review?.files.length; }
  // Narrow, picking a file folds the tree for this run only (`narrowNav`); wide, the page's kept open state governs.
  treeOpen() { return navShown(this.width, this.navOpen, this.narrowNav) && Boolean(this.review) && !this.navEmpty(); }

  toggleSplit(cx) {
    setPref("split", pref("split") !== true);
    cx.notify();
  }

  key(e, cx) { return reviewKey(this, e, cx); }

  head() { return head(this); }

  // The files whose rows the list last drew, as the app marks the files in view.
  visibleFiles() {
    const { start = 0, end = 0 } = this.visible ?? {};
    return new Set((this.itemList ?? []).slice(start, end).filter(item => item.kind !== "group").map(item => item.path));
  }

  spied() { return this.review ? JSON.stringify([[...this.visibleFiles()], this.stickyFile()?.path, this.pageWanted(), this.current]) : ""; }

  // The file whose header or rows open the view; before the list draws, none.
  topFile() {
    if (!this.visible || this.switching) return null;
    const items = this.itemList ?? [];
    for (let i = this.visible.start; i < items.length; i++) if (items[i].path) return items[i].path;
    return null;
  }

  // The file whose rows open the view once its header has scrolled past the top: that header sticks there, as the app's.
  stickyFile() {
    const item = (this.itemList ?? [])[this.visible?.start ?? 0];
    return item && item.kind !== "file" && item.kind !== "group" ? this.fileAt(item.path) ?? null : null;
  }

  hbars(t) { return hbars(this, t); }
}
