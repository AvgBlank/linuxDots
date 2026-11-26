import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, props, layout, run } from "herdr";
import { numstatTotals, parseWorktrees, sizeLabel } from "./worktrees.js";

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());
// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
// The folder watch is recursive on macOS and Windows (node_modules, build output, .git), so a
// burst of changes (a build, an install) makes one refresh after WATCH_DEBOUNCE_MS, not one each.
// While the watch works, the timer refreshes only every WATCHED_POLL_MS: it still catches what
// the watch cannot see (a linked worktree's index, a remote machine has no watch).
const WATCH_DEBOUNCE_MS = 400, POLL_MS = 10000, WATCHED_POLL_MS = 60000;
const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;

// The Worktrees section (the block with `section: "worktrees"`), in px: rows of two fixed-height
// lines as Activity's subagents, with TREE_PAD above, between and below them. Up to TREE_MAX; more rows scroll.
const CLOSED = 37, TREE_TOP = 18, TREE_BOTTOM = 16, TREE_ROW = TREE_TOP + 2 + TREE_BOTTOM, TREE_PAD = 10, TREE_MAX = 240;
// Each refresh runs git in every worktree and reads its new files, so it is slower than Changes' poll.
// `du` reads every file (node_modules, build output), so a size is measured again only after SIZE_POLL_MS.
const TREE_POLL_MS = 15000, UNTRACKED_MAX = 200, SIZE_POLL_MS = 300000;
const sizeKey = (path, on) => `${on ?? ""}\0${path}`;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// `color` (#rgb, #rrggbb or #rrggbbaa) at `alpha` (hex 00-ff); any other color as it is.
// The same helper is in bettr-spaces, bettr-tabs and bettr-activity (a mod cannot import another's files).
const tint = (color, alpha) => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color)?.[1];
  if (!hex) return color;
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex.slice(0, 6)}${alpha}`;
};

// The panel's column in Bettr's layout. A hidden copy stays alive: its timer and folder watch do no
// work until it is drawn again. In a layout without this column, the panel always refreshes.
const hidden = () => Boolean(find(layout(), "changes")?.hidden);

// Numbers each diff line once, so a frame only draws the rows on screen.
function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: line.slice(1) || " " };
    if (kind === "+") return { kind, number: next++, text: line.slice(1) || " " };
    if (kind === " ") { old++; return { kind, number: next++, text: line.slice(1) || " " }; }
    return { kind: "", text: line };
  });
}

export default class Changes extends View {
  init(_props, cx) {
    if (props()?.section === "worktrees") return this.initWorktrees(cx);
    this.files = []; this.rows = []; this.diffWidth = 0; this.message = ""; this.handle = cx.focus_handle();
    // Untracked files' line counts by full path, kept until the folder watch names the file.
    // `touches` counts the watch's reports, so a file that changed during its read is not kept.
    this.lines = new Map(); this.touches = 0;
    this.input = InputState.new({ placeholder: "Commit message" });
    this.input.on("change", (_e, cx) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value();
      if (hadMessage !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.commit(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(POLL_MS, (cx) => {
      if (this.watched && Date.now() - (this.refreshedAt ?? 0) < WATCHED_POLL_MS) return;
      // The timer also catches what the watch did not report: count every new file again.
      this.touch(null);
      this.later(cx);
    });
  }

  // `this.watched` is this watch's own object: a loop that waits for an old context ends at its
  // next change, also when the new context has the same root.
  watch(root, cx) {
    if (this.on || this.watched?.root === root) return;
    const mine = this.watched = { root };
    cx.spawn(async (cx) => {
      try {
        while (this.watched === mine) {
          const paths = await watchFolder(root);
          if (this.watched !== mine) return;
          this.touch(paths);
          await cx.sleep(WATCH_DEBOUNCE_MS);
          if (this.watched === mine) this.later(cx);
        }
      } catch { if (this.watched === mine) this.watched = null; }
    });
  }

  // Forget the line counts of the changed files (`paths` from the folder watch), or of all of them.
  touch(paths) {
    this.touches += 1;
    if (!Array.isArray(paths) || !paths.length || paths.length > 500) { this.lines.clear(); return; }
    for (const full of [...this.lines.keys()]) {
      if (paths.some((p) => full === p || full.endsWith(`/${p}`) || full.startsWith(`${p}/`))) this.lines.delete(full);
    }
  }

  // A refresh from the timer or the folder watch. A hidden panel waits until it is drawn.
  later(cx) {
    if (hidden()) this.stale = true; else this.refresh(cx);
  }

  refresh(cx) {
    // A change during a refresh may be missed by it: refresh again when it ends. A commit refreshes when it ends.
    this.stale = false;
    if (this.loading) { this.again = true; return; }
    if (this.busy) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) {
      this.context = context; this.root = null; this.files = []; this.open = null; this.lines.clear();
      this.setLines([]); this.message = ""; this.input.set_value(""); this.error = null; this.note = null; this.watched = null; this.closed = false; this.limited = false;
    }
    if (!cwd) return;
    this.loading = true; this.again = false; this.refreshedAt = Date.now();
    cx.spawn(async (cx) => {
      try {
        // The root is found once per context, and again after a refresh that failed.
        let root = this.unsure ? null : this.root;
        if (!root) {
          const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
          if (key() !== context) return;
          if (top.code !== 0) { this.root = null; this.files = []; this.setLines([]); this.open = null; this.error = "Not a git repository"; return; }
          root = top.stdout.trim();
        }
        const git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const status = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
        if (status.code !== 0) throw new Error(status.stderr);
        const head = await git(["rev-parse", "--verify", "HEAD"]);
        const stats = {};
        const results = head.code === 0 ? [await git(["diff", "HEAD", "--numstat", "-z", "--no-renames"])] : [await git(["diff", "--cached", "--numstat", "-z", "--no-renames"]), await git(["diff", "--numstat", "-z", "--no-renames"])];
        for (const result of results) {
          if (result.code !== 0) throw new Error(result.stderr);
          for (const entry of result.stdout.split("\0")) {
            const [a, d, ...parts] = entry.split("\t");
            if (!parts.length) continue;
            const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
            stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
          }
        }
        const files = [];
        const entries = status.stdout.split("\0").filter(Boolean);
        for (const entry of entries.slice(0, 1000)) {
          const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
          const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
          const s = conflict ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
          const stat = stats[path] ?? { add: 0, del: 0 };
          files.push({ path, status: s, fresh, ...stat });
        }
        // A new file has no numstat: count its lines, as the Worktrees section does. Each file is
        // read once, then again only after the folder watch names it.
        const kept = new Set();
        for (const file of files.filter((f) => f.fresh).slice(0, UNTRACKED_MAX)) {
          const full = `${root}/${file.path}`, touches = this.touches;
          kept.add(full);
          if (this.lines.has(full)) { file.add = this.lines.get(full); continue; }
          const text = await readTextFile(full, { on }).catch(() => null);
          if (key() !== context) return;
          file.add = text && !text.includes("\0") ? countLines(text) : 0;
          if (touches === this.touches) this.lines.set(full, file.add);
        }
        for (const full of [...this.lines.keys()]) if (!kept.has(full)) this.lines.delete(full);
        this.unsure = false;
        this.root = root; this.on = on; this.hasHead = head.code === 0; this.files = files; this.limited = entries.length > 1000; this.error = null;
        this.watch(root, cx);
        if (this.open && !files.some((f) => f.path === this.open)) { this.open = null; this.setLines([]); }
        // The first file's diff shows until you pick another.
        if (!this.open && !this.closed && files.length) this.open = files[0].path;
        if (this.open) {
          try { await this.load(this.open, context); }
          catch { if (key() === context) this.setLines(["Cannot preview this diff (too large or unreadable)"]); }
        }
      } catch (e) { if (key() === context) { this.error = String(e); this.unsure = true; } }
      finally {
        this.loading = false;
        if (this.again) this.refresh(cx);
        cx.notify();
      }
    });
  }

  async load(path, context) {
    const file = this.files.find((f) => f.path === path), root = this.root, on = this.on;
    if (!file) return;
    let lines;
    if (file.fresh || (!this.hasHead && file.status === "A")) {
      const text = await readTextFile(`${root}/${path}`, { on }).catch(() => null);
      if (text === null) lines = ["Cannot preview this file (binary, too large, or unreadable)"];
      else if (text.includes("\0")) lines = ["Binary file · no text diff"];
      else {
        file.add = countLines(text);
        lines = [`@@ -0,0 +1,${file.add} @@`, ...text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, 1500).map(l => `+${l}`)];
      }
    } else {
      const r = await exec("git", [...READ, "diff", ...(this.hasHead ? ["HEAD"] : []), "--no-ext-diff", "--no-textconv", "--no-color", "--", path], { cwd: root, on });
      if (r.code !== 0) throw new Error(r.stderr);
      const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
      lines = first < 0 ? [file.binary ? "Binary file changed" : "No text diff available"] : all.slice(first);
    }
    if (key() === context && this.open === path) this.setLines(lines.slice(0, 1500).map(line => line.length > 4000 ? line.slice(0, 4000) + "… (line truncated)" : line));
  }

  setLines(lines) {
    this.rows = diffRows(lines);
    this.diffWidth = Math.max(300, ...lines.map(line => line.length * 7 + 50));
  }

  pick(path, cx) {
    this.open = this.open === path ? null : path; this.setLines([]); this.note = null;
    this.closed = !this.open;
    const context = this.context;
    if (this.open) cx.spawn(async (cx) => {
      try { await this.load(path, context); }
      catch (e) { if (key() === context && this.open === path) this.note = `Cannot preview this diff (too large or unreadable): ${e}`; }
      cx.notify();
    });
    cx.notify();
  }

  commit(cx) {
    if (!this.message.trim() || !this.root || this.busy || this.loading || this.context !== key()) return;
    const root = this.root, on = this.on, context = this.context, message = this.message.trim();
    this.busy = true; this.note = null;
    cx.spawn(async (cx) => {
      try {
        for (const args of [["add", "-A"], ["commit", "-m", message]]) {
          const r = await exec("git", args, { cwd: root, on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        if (key() === context) { this.message = ""; this.input.set_value(""); }
      } catch (e) { if (key() === context) this.note = `Commit failed: ${e}`; }
      finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  diffRow({ kind, number, text }, t) {
    if (kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.raised).text_color(t.dim).child(text);
    return h_flex().w_full().h(20).flex_none().gap(10).when(kind === "+", (e) => e.bg(tint(t.ansi2, "18"))).when(kind === "-", (e) => e.bg(tint(t.ansi1, "18")))
      .child(div().w(30).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
      .child(div().flex_1().min_w(0).truncate().child(text));
  }

  initWorktrees(cx) {
    this.trees = []; this.sizes = new Map();
    this.refreshWorktrees(cx);
    cx.timer.every(TREE_POLL_MS, (cx) => { if (!find(layout(), "changes")?.hidden) this.refreshWorktrees(cx); });
  }

  refreshWorktrees(cx) {
    if (this.loading) { this.again = true; return; }
    const { cwd, on } = location(), context = key();
    this.context = context;
    if (!cwd) { this.trees = []; return; }
    this.loading = true; this.again = false;
    cx.spawn(async (cx) => {
      try {
        const list = await exec("git", ["worktree", "list", "--porcelain"], { cwd, on });
        const trees = [];
        if (list.code === 0) for (const tree of parseWorktrees(list.stdout)) {
          trees.push({ ...tree, stat: await this.worktreeStat(tree, on).catch(() => null) });
          if (key() !== context) return;
        }
        if (key() === context) { this.trees = trees; this.on = on; this.measure(trees, on, cx); }
      } catch { if (key() === context) this.trees = []; }
      finally {
        this.loading = false;
        if (this.again) this.refreshWorktrees(cx);
        cx.notify();
      }
    });
  }

  // Apart from the refresh, so a slow `du` does not hold back the rows. `du` is missing on
  // Windows, and it can pass the 30 s limit of exec: then the row shows no size.
  measure(trees, on, cx) {
    if (this.measuring) return;
    const stale = trees.filter((tree) => Date.now() - (this.sizes.get(sizeKey(tree.path, on))?.at ?? 0) >= SIZE_POLL_MS);
    if (!stale.length) return;
    this.measuring = true;
    cx.spawn(async (cx) => {
      try {
        for (const { path } of stale) {
          // du exits non-zero for one unreadable file, and still prints the total.
          const out = await exec("du", ["-sk", path], { on }).catch(() => null);
          this.sizes.set(sizeKey(path, on), { label: out ? sizeLabel(out.stdout) : null, at: Date.now() });
          cx.notify();
        }
      } finally { this.measuring = false; }
    });
  }

  // The uncommitted lines of one worktree, new files included. Null when git cannot read it.
  async worktreeStat(tree, on) {
    const git = (args) => exec("git", [...READ, ...args], { cwd: tree.path, on });
    const diff = await git(["diff", tree.unborn ? "--cached" : "HEAD", "--numstat", "-z", "--no-renames"]);
    const others = await git(["ls-files", "--others", "--exclude-standard", "-z"]);
    if (diff.code !== 0 || others.code !== 0) return null;
    const stat = numstatTotals(diff.stdout);
    // A nested repository or worktree is one entry that ends in "/": it is not this worktree's file.
    for (const path of others.stdout.split("\0").filter((p) => p && !p.endsWith("/")).slice(0, UNTRACKED_MAX)) {
      stat.dirty = true;
      const text = await readTextFile(`${tree.path}/${path}`, { on }).catch(() => null);
      if (text && !text.includes("\0")) stat.add += countLines(text);
    }
    return stat;
  }

  // As the Cache section: the block fits its rows. After a manual resize the size is the
  // person's until the heading is double-clicked.
  fit(rows, force = false) {
    const id = props()?.autoSize, node = id ? find(layout(), id) : null;
    if (!node) return;
    const want = rows ? Math.min(TREE_MAX, CLOSED + rows * TREE_ROW + (rows + 1) * TREE_PAD) : CLOSED;
    const px = node.size?.px, storeKey = `autoHeight:${id}`;
    let previous = null;
    try { previous = localStorage.getItem(storeKey); } catch {}
    const waiting = this.asked && Date.now() < this.asked.until && px !== this.asked.px;
    const manual = previous !== null && Math.abs((px ?? 0) - Number(previous)) > 1 && (px ?? 0) > (node.min ?? CLOSED);
    if (!force && !waiting && manual) return;
    if (px === want || (waiting && this.asked.px === want)) return;
    try { localStorage.setItem(storeKey, String(want)); } catch {}
    this.asked = { px: want, until: Date.now() + 1000 };
    run("layout.resize", { id, px: want });
  }

  worktrees(cx) {
    if (key() !== this.context) this.refreshWorktrees(cx);
    const t = theme(), trees = this.trees;
    this.fit(trees.length);
    const root = v_flex().id("worktrees").size_full().min_h(0).overflow_hidden().text_color(t.foreground).text_size(12)
      .child(h_flex().h(36).flex_none().px(14).items_center().border_b(1).border_color(t.border)
        .child(div().id("worktrees-heading").flex_1().text_size(13).font_medium()
          .tooltip("Double-click to fit panel height")
          .on_click((event) => { if (event.click_count === 2) this.fit(this.trees.length, true); })
          .child("Worktrees")));
    if (!trees.length) return root;
    return root.child(v_flex().id("worktrees-list").flex_1().min_h(0).overflow_y_scrollbar().px(14).py(TREE_PAD).gap(TREE_PAD)
      .children(trees.map((tree) => v_flex().id(`worktree-${tree.path}`).h(TREE_ROW).flex_none().gap(2)
        .child(h_flex().h(TREE_TOP).w_full().min_w(0).gap(6).items_center()
          .child(div().id(`worktree-name-${tree.path}`).min_w(0).truncate().font_medium().tooltip(tree.path).child(tree.name))
          .child(div().flex_1())
          .child(div().min_w(0).truncate().text_size(11).text_color(t.muted).child(tree.branch)))
        .child(h_flex().h(TREE_BOTTOM).w_full().min_w(0).gap(6).items_center().text_size(11)
          .when(!tree.stat?.dirty, (el) => el.text_color(t.dim).child(tree.stat ? "No changes" : "Cannot read changes"))
          .when(Boolean(tree.stat?.dirty), (el) => el
            .child(div().text_color(t.ansi2).child(`+${tree.stat.add}`))
            .child(div().text_color(t.ansi1).child(`−${tree.stat.del}`)))
          .child(div().flex_1())
          .child(div().flex_none().text_color(t.dim).child(this.sizes.get(sizeKey(tree.path, this.on))?.label ?? ""))))));
  }

  render(cx) {
    if (props()?.section === "worktrees") return this.worktrees(cx);
    if (this.stale || key() !== this.context) this.refresh(cx);
    const t = theme(), add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    const enabled = Boolean(this.message.trim() && this.root && !this.busy && !this.loading);
    return v_flex().id("changes").size_full().min_h(0).overflow_hidden().text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      })
      .child(h_flex().h(36).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_medium().child("Changes"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${this.files.length} files`))
        .child(div().flex_1()).child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)).child(div().text_size(11).text_color(t.ansi1).child(`−${del}`)))
      .child(v_flex().id("changes-list").flex_none().h(Math.min(200, Math.max(44, this.files.length * 28 + 12))).overflow_y_scrollbar().p(6).border_b(1).border_color(t.border).children(this.files.map((f) => {
        const parts = f.path.split("/"), name = parts.pop();
        return h_flex().id(`change-${f.path}`).h(28).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer().when(this.open === f.path, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pick(f.path, cx))
          .child(div().w(14).text_size(11).text_color(f.status === "A" ? t.ansi2 : f.status === "D" ? t.ansi1 : f.status === "U" ? t.ansi1 : t.blocked).child(f.status))
          .child(h_flex().flex_1().min_w(0).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().max_w(260).min_w(0).truncate().child(name)))
          .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`))).when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
      })).when(!this.files.length, (e) => e.child(div().p(8).text_color(t.dim).child(this.error || (this.loading ? "Loading changes…" : this.root ? "No uncommitted changes" : "No folder")))))
      .when(this.limited, el => el.child(div().px(12).py(4).text_size(11).text_color(t.dim).child("Showing the first 1,000 changed files")))
      .child(div().flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
        .child(div().id("changes-diff-x").size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(this.diffWidth).h_full().child(v_virtual_list("changes-diff", this.rows.length, 20, (i) => String(i),
            (range) => this.rows.slice(range.start, range.end).map((row) => this.diffRow(row, t))).size_full())))
        .child(Scrollbar.vertical("changes-diff").viewport_from_layout().absolute().inset_0())
        .when(!this.open && this.files.length > 0, (e) => e.child(div().absolute().top(6).px(12).text_color(t.dim).child("Select a file to view its changes"))))
      .when(Boolean(this.note), (e) => e.child(div().px(10).pb(8).text_size(11).text_color(t.ansi1).child(this.note)))
      .child(h_flex().flex_none().p(10).gap(8).border_t(1).border_color(t.border)
        .child(div().id("commit-message").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(8).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
        .child(div().id("commit").h(32).px(14).flex().items_center().rounded(8).bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim).text_size(12).when(enabled, (e) => e.cursor_pointer()).on_click((_e, cx) => this.commit(cx)).child(this.busy ? "Committing…" : "Commit")));
  }
}
