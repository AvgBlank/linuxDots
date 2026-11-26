import { theme } from "herdr";
import { review } from "./daemon.js";
import { clipRows } from "./rows.js";
import { TREE } from "./files.js";
import { pathEntries, sortEntries } from "./file-tree.js";
import { pref } from "./controls.js";

// How long a read may take before the pane says it didn't answer and offers Retry; its answer still counts if it comes.
const LOAD_TIMEOUT = 30000;

// Syntax kinds in the theme's own colors, as the shipped files mod colors code.
export function colors(t) {
  const kinds = { foreground: t.foreground, keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6, boolean: t.ansi6 };
  return Object.fromEntries(Object.entries(kinds).filter(([, color]) => /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color ?? "")));
}

// A read of the page shown. Only the latest counts: one that doesn't answer in LOAD_TIMEOUT says so and offers Retry.
function startRead(view, cx) {
  const id = ++view.loadId;
  view.loading = { root: view.root, page: view.page }; view.again = false; view.dirty = false;
  cx.timer.after(LOAD_TIMEOUT, (cx) => {
    if (!view.loading || !canRead(view, () => id === view.loadId)) return;
    view.loading = null; view.error = `jin.review didn't answer in ${LOAD_TIMEOUT / 1000} s`;
    // Not under the new page's title.
    if (view.switching) view.forget();
    cx.notify();
  });
  return id;
}

function canRead(view, current = () => true) {
  if (!current()) return false;
  if (!view.surfaceAlive()) { view.evict(); return false; }
  if (view.evicted || !view.readable()) { view.deferRead(); return false; }
  return true;
}

// A task can start or answer before the visibility timer observes a hide. Each kind of read has its own identity;
// ending the visible period invalidates them all, without a new read in one kind invalidating a different kind.
function readVisible(view, cx, { current, request, commit, fail = null, done = null }) {
  const period = view.hiddenId;
  const live = () => canRead(view, () => period === view.hiddenId && current());
  // A first read behind another window stops being readable as it lands (main.js readable): it still ends and redraws.
  let landed = false;
  cx.spawn(async (cx) => {
    if (!live()) return;
    try {
      const result = await request();
      if (live()) { landed = true; commit(result, cx); }
    } catch (e) { if (live()) { landed = true; fail?.(e, cx); } }
    finally { if (done && (landed || live())) done(cx); }
  });
}

function endRead(view, cx) {
  view.loading = null;
  view.report();
  cx.notify();
  if (view.again) view.load(cx);
}

// Rows come only for the group shown (a large diff's run to megabytes), none while polling a run: apply() keeps the rows of
// files whose sha didn't change. With no group yet the first group's rows come with the read (a daemon too old for
// `firstRows` ignores it, and they're asked for once the group shows). Only the latest read counts: a read of the page being
// read waits for it (a burst of changes can't restart it forever); a read of another starts at once, the old answer dropped.
export function loadReview(view, cx, poll = false) {
  if (!canRead(view)) return;
  if (!view.root || !view.page) return;
  if (view.loading?.root === view.root && view.loading.page === view.page) { view.again = true; return; }
  // Switching, the group shown is the old page's: the new page's first group comes with the read instead.
  const { root, page, on } = view, switched = view.switching, t = theme(), group = switched ? null : view.group(), marks = view.marks, id = startRead(view, cx);
  // Rows only for the files in view or just after that have none: apply() keeps the rest, and each asked-for file is highlighted anew.
  const rows = poll || !group ? [] : view.rowsWanted();
  const key = JSON.stringify(colors(t));
  readVisible(view, cx, {
    current: () => id === view.loadId,
    request: () => review(root, "/api/review", { page, colors: colors(t), rows, firstRows: !group }, on),
    commit: (r, cx) => {
      // The theme changed meanwhile: these rows have the old colors, and later reads ask only for files without rows.
      if (JSON.stringify(colors(theme())) !== key) { view.again = true; return; }
      // Read before a reviewed mark landed, it would undo the mark on screen: the mark's own read follows.
      if (view.marking || marks !== view.marks) return;
      view.apply(r);
      // The list is built here, in the read's task, and not in the next render: cutting a group's wrapped lines can take most of
      // the ~50ms Herdr gives a render, past which it's interrupted, and a task has ~500.
      view.items();
      view.error = null; view.stale = false;
      readFulls(view, cx, { afterPage: true });
      // Back from eviction, on the file it was reading.
      if (view.restoreTo) { const path = view.restoreTo; view.restoreTo = null; if (view.fileAt(path)) view.select(path, cx); }
      // A rows read changes no commit, and the base's whole read can outweigh it. Nor does stepping to another page of the
      // same diff: a new base clears its commits (main.js), and a refresh still reads them.
      if (!rows.length && !(switched && view.baseCommits)) loadBaseCommits(view, cx);
      // Only a count's click starts a run, on a page with no analysis. An outdated one waits for Re-analyze: every commit
      // on the branch would otherwise start another. The setting is off by default: the app never starts a paid, slow AI run by itself.
      if (view.analyzeFor === page) {
        view.analyzeFor = null;
        const a = r.analysis;
        if (pref("autoAnalyze") === true && a.agent && !a.error && a.state === "none") view.analyze(cx, false);
      }
    },
    fail: (e) => {
      view.error = e?.message ?? String(e);
      if (view.switching) view.forget();
      // No daemon to ask: a run shown as going would poll, and each poll try to start the daemon, until it answers.
      else if (view.review?.analysis.state === "running") view.review.analysis = { ...view.review.analysis, state: "none", error: view.error };
    },
    // A file can come back without rows, past the bytes one read carries: it's left for the next.
    done: (cx) => endRead(view, cx),
  });
}

const rowCount = (hunks) => hunks.reduce((n, hunk) => n + hunk.rows.length, 0);

// After the open, a batch's rows, or the next page of a file cut short as its end nears the view, come on their own, not
// inside the whole page. The daemon serves them from the diff shown; one it no longer holds is `stale`, and the whole page
// is read again, rows and all.
export function loadRows(view, cx) {
  if (!canRead(view)) return;
  if (view.dirty) return view.load(cx);
  const rows = view.rowsWanted(), more = rows.length ? null : view.pageWanted();
  if (!rows.length && !more) return;
  if (view.stale || view.loading) return view.load(cx);
  const { root, page, on, review: shown } = view, t = theme(), key = JSON.stringify(colors(t)), id = startRead(view, cx);
  const whole = more && view.full.get(more);
  readVisible(view, cx, {
    current: () => id === view.loadId,
    request: () => whole
      ? review(root, "/api/review/file", { page, file: more, colors: colors(t), from: whole.rows.length }, on)
      : review(root, "/api/review/rows", { page, colors: colors(t), files: more ? [more] : rows, base: shown.base?.sha ?? "", head: shown.head?.sha ?? "", ...more ? { from: rowCount(view.fileAt(more).hunks) } : {} }, on),
    commit: (r) => {
      if (JSON.stringify(colors(theme())) !== key) { view.again = true; return; }
      if (r.stale) { view.stale = view.again = true; return; }
      // shortcut: a whole file changed between its pages goes on from the new text until the read that drops it, a second at most; the answer could name its sha.
      if (whole) {
        if (view.full.get(more) !== whole) return;
        whole.rows = whole.rows.concat(clipRows(r.rows)); whole.truncated = r.truncated;
        whole.stuck = Boolean(r.truncated) && !r.rows.length;
      } else {
        const file = more && view.fileAt(more), before = file ? rowCount(file.hunks) : 0;
        for (const got of r.files) {
          const file = view.fileAt(got.path);
          if (file?.sha !== got.sha) continue;
          for (const hunk of got.hunks ?? []) clipRows(hunk.rows);
          if (!more) { Object.assign(file, { hunks: got.hunks, clipped: got.clipped, stuck: false }); continue; }
          // A page's first hunk without a header goes on from the last one shown.
          for (const hunk of got.hunks ?? []) { const last = file.hunks.at(-1); if (hunk.header === undefined && last) last.rows = last.rows.concat(hunk.rows); else file.hunks.push(hunk); }
          file.clipped = got.clipped;
        }
        // A page that brings nothing more can't be got: the rest stays out.
        if (file?.clipped && rowCount(file.hunks) === before) file.stuck = true;
      }
      view.version++;
      view.items();
    },
    // A batch a daemon without the route (an older one) or a failed read didn't bring: the whole page brings it, or says why.
    fail: (e) => { if (more) view.error = e?.message ?? String(e); else view.stale = view.again = true; },
    done: (cx) => endRead(view, cx),
  });
}

// A removed or binary file has no new side to show whole; one too large for its diff is larger whole.
export function canFull(file) { return file && file.status !== "removed" && !file.isBinary && !file.truncated; }

function queueFull(view, file) {
  // Recoloring a deferred open does not make it current before the catch-up page.
  const period = view.fullReads.get(file.path)?.period ?? view.hiddenId;
  view.full.set(file.path, null);
  view.fullReads.set(file.path, { sha: file.sha, period, attempt: null });
}

export function toggleFull(view, file, cx) {
  if (view.switching || !canFull(file) || !canRead(view)) return;
  // Disabled while loading, including while waiting to resume. An old reply cannot occupy another attempt's slot.
  if (view.full.has(file.path) && !view.full.get(file.path)) return;
  if (view.full.delete(file.path)) view.version++;
  else {
    queueFull(view, file);
    readFulls(view, cx);
  }
  cx.notify();
}

export function recolorFulls(view, cx) {
  if (!view.full.size || view.switching) return;
  for (const path of view.full.keys()) {
    const file = view.fileAt(path);
    if (canFull(file)) queueFull(view, file); else dropFull(view, path);
  }
  // Called in render; the visible-read gate runs after the frame.
  cx.timer.after(0, (cx) => readFulls(view, cx));
}

// Resume unfinished whole-file opens after the catch-up page checks their file identities. There is no dependency
// on when the old attempt answers or on the page/row lane's read id.
function readFulls(view, cx, { afterPage = false } = {}) {
  if (!view.fullReads.size || view.switching || !canRead(view) || view.dirty) return;
  const { root, page } = view, palette = colors(theme()), key = JSON.stringify(palette);
  for (const [path, intent] of view.fullReads) {
    if (intent.period !== view.hiddenId && !afterPage) continue;
    const sameFile = () => { const file = view.fileAt(path); return canFull(file) && file.sha === intent.sha; };
    if (!sameFile()) { dropFull(view, path); view.version++; continue; }
    if (intent.period === view.hiddenId && intent.attempt?.key === key) continue;
    const attempt = intent.attempt = { key };
    intent.period = view.hiddenId;
    readVisible(view, cx, {
      current: () => view.fullReads.get(path) === intent && intent.attempt === attempt && sameFile() && JSON.stringify(colors(theme())) === key,
      request: () => review(root, "/api/review/file", { page, file: path, colors: palette }, view.on),
      commit: (result, cx) => {
        clipRows(result.rows);
        view.fullReads.delete(path); view.full.set(path, result); view.collapsed.delete(path);
        view.version++; cx.notify();
      },
      fail: (e, cx) => {
        dropFull(view, path); view.error = e?.message ?? String(e);
        view.version++; cx.notify();
      },
    });
  }
}

function dropFull(view, path) { view.full.delete(path); view.fullReads.delete(path); }

// Poll a run without reading the diff. When it ends, report its outcome and refresh the diff only when shown.
export function pollReview(view, cx) {
  if (view.surfaceAlive?.() === false) return;
  if (view.polling) return;
  const { root, page } = view;
  view.polling = true;
  const current = () => view.surfaceAlive() && root === view.root && page === view.page;
  const ended = (cx, error) => {
    // Keep the visible fallback for a daemon without this route. Hidden, end the lightweight status without reading the diff.
    if (!view.review || !view.onScreen()) {
      const outcome = { ...view.runState(), state: "none", progress: null, error };
      if (view.review) view.review.analysis = outcome; else view.awayAnalysis = outcome;
      view.startingUntil = 0;
      view.report(); cx.notify();
    }
    view.load(cx, true);
  };
  cx.spawn(async (cx) => {
    try {
      const s = await review(root, "/api/review/status", { page }, view.on);
      if (!current()) return;
      const a = view.runState();
      if (!a) return;
      if (s.running) {
        const run = { ...a, state: "running", progress: s.progress };
        if (view.review) view.review.analysis = run; else view.awayAnalysis = { state: "running", error: a.error ?? null };
        view.startingUntil = 0; view.report(); cx.notify();
      } else if (a.state === "running" || (s.error && s.error !== a.error)) ended(cx, s.error ?? null);
    } catch (e) { if (current()) ended(cx, e?.message ?? String(e)); }
    finally { view.polling = false; }
  });
}

// Paths in the order the file tree shows them: in each folder its folders first, then its files, by name as Files sorts them.
function treeOrder(paths) {
  const kids = pathEntries(paths.map(path => ({ path }))), out = [];
  const walk = (dir) => { for (const e of sortEntries(kids.get(dir))) e.dir ? walk(e.path) : out.push(e.path); };
  walk("");
  return out;
}

export function applyReview(view, r) {
  // Each group's files once per read in the tree's order, which the diff, its reads and the keys follow (rows.js groupFiles).
  const order = (g) => { g.files = treeOrder(g.files); g.children.forEach(order); };
  r.groups.forEach(order);
  // Noisy and reviewed files start collapsed, the first time each version of them shows.
  for (const file of r.files) {
    if (view.seen.has(file.sha)) continue;
    view.seen.add(file.sha);
    if (file.noisy || file.reviewed) view.collapsed.add(file.path);
  }
  for (const file of r.files) for (const hunk of file.hunks ?? []) clipRows(hunk.rows);
  const old = new Map(view.review?.files.map(file => [file.path, file]));
  // With its pages so far, and whether more can come.
  for (const file of r.files) if (!file.hunks && old.get(file.path)?.sha === file.sha) { const o = old.get(file.path); Object.assign(file, { hunks: o.hunks, clipped: o.clipped, stuck: o.stuck }); }
  // A read that says what the one shown does changes nothing: the list isn't rebuilt, and its files stay the ones marks change.
  const said = (x) => JSON.stringify([x.key, x.title, x.base, x.head, x.commits, x.source, x.groups, x.analysis,
    x.files.map(f => [f.path, f.sha, f.reviewed, f.changed, Boolean(f.hunks)])]);
  if (view.review && !view.switching && said(r) === said(view.review)) return;
  for (const path of view.full.keys()) if (old.get(path)?.sha !== r.files.find(file => file.path === path)?.sha) dropFull(view, path);
  const switched = view.switching;
  if (switched) { view.forget(); view.settling = null; }
  view.review = r;
  if (r.analysis.state === "running") view.startingUntil = 0;
  // The diff's commits, for stepping through them while one is shown on its own (its page lists only itself).
  if (view.page === view.base) view.baseCommits = r.commits;
  // Another list - another page or worktree, a read after a failed one, an analysis's groups - starts at its top: the
  // scroll handle keeps the old list's place. forget() leaves no group, so every one of them comes through here.
  if (!r.groups.some(g => g.key === view.groupKey)) { view.groupKey = r.groups[0]?.key ?? null; view.scroll.scroll_to_item(0); view.treeOf = null; view.scrollTop = { ...view.scrollTop, [TREE]: 0 }; }
  view.version++;
}

// One commit's page lists only itself: the diff's commits come from its base, read without rows after each read of none, so a new
// commit reaches the header's list. A failed read leaves the list as it was.
function loadBaseCommits(view, cx) {
  const { root, base } = view;
  if (view.page === base) return;
  readVisible(view, cx, {
    current: () => root === view.root && base === view.base,
    request: () => review(root, "/api/review", { page: base, colors: colors(theme()), rows: [] }, view.on),
    commit: (r, cx) => { view.baseCommits = r.commits; cx.notify(); },
  });
}

export function analyzeReview(view, cx, force) {
  if (view.surfaceAlive?.() === false) return;
  const { root, page } = view;
  // shortcut: 10 s is a guess at the slowest start, and a start that fails says nothing; replace it once the worktree server answers when it has started.
  view.startingUntil = Date.now() + 10000; view.analyzeError = null;
  cx.timer.after(10000, (cx) => { view.report(); cx.notify(); });
  cx.notify();
  const current = () => view.surfaceAlive() && root === view.root && page === view.page;
  cx.spawn(async (cx) => {
    try { await review(root, "/api/review/analyze", { page, force }, view.on); }
    catch (e) { if (current()) { view.startingUntil = 0; view.analyzeError = e?.message ?? String(e); view.report(); } }
    if (!current()) return;
    cx.notify();
    view.load(cx);
  });
}
