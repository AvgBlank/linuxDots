// Workspace spaces: stable colored avatars, worktrees under their checkout,
// grouped by machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind. Agent state lives in the agents list, not here. Click to
// switch, right-click for its menu, drag to reorder.

import { View, div, svg } from "gpui-kit";
import { foldArrow, planMotion, flying, leavingRows } from "./motion.js";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, panes, focused, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window, props, layout, nextCommand } from "herdr";
import { projectMark, tint } from "./project.js";
import { repoFacts } from "./repos.js";
import { dragGone, glow, hoverKept, tip, tipMark, POINTER_WATCH, pointerMoved } from "./tip.js";
import { stopsInit, stopsEnd, stop, focusRoot, enter, pressed, justClosed } from "./focus.js";
import { sidebarParts } from "./sidebar.js";

// How long a checkout being opened may take to show up before it's asked for again.
const OPENING = 5000;
// T3's project row, and its list's 1px between items (gap-px). A drag's math goes by the pitch.
const ROW = 32, STACK = 1, PITCH = ROW + STACK;
// Docked alone there's no Inbox to be behind.
const listInView = (root = layout()) => {
  const { rail, stack } = sidebarParts(root);
  return stack?.active !== "inbox" && !rail?.hidden;
};

// A space's number (ctrl-N), a small key cap at the row's end; agents' rows have the same (alt-shift-N).
const keycap = (t, n, on) => div().flex_none().min_w(16).h(16).px(4).flex().items_center().justify_center().rounded(4)
  .border_1().border_color(t.border).text_size(10.5).text_color(on ? t.muted : t.dim).child(String(n));

export default class Spaces extends View {
  async close() { stopsEnd(this); }

  init(_props, cx) {
    stopsInit(this, cx);
    this.dragKeys = cx.focus_handle();
    // pane.go onto this list (mod.json's "focusable"): the keyboard starts at the heading's button.
    cx.spawn(async (cx) => {
      for (;;) if (await nextCommand() === "focus") enter(this, cx, "space-new");
    });
    this.repos = repoFacts({ exec, watchFolder, cx });
    this.opening = new Map(); // repo -> when its checkout was opened from its dim row
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.drag = null; // { id, key, at, top, moved, dy, y, slot, drawn }: a pressed row, lifted once it moves 6px
    this.machines = [];
    this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.foldedRepos = new Set(JSON.parse(localStorage.getItem("repos.folded") ?? "[]"));
    this.machinesSeen = this.machinesNow();
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (repos.js).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  machinesNow() {
    return JSON.stringify(machines().map((m) => [m.name, m.layout]));
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    // A machine came or went: its heading needn't wait for the next poll.
    const seen = this.machinesNow();
    if (seen !== this.machinesSeen) {
      this.machinesSeen = seen;
      this.refreshMachines(cx);
    }
    this.repos.update({ spaces: sp, panes: panes(), machines: machines(), active: window().active, visible: listInView(), folded: this.folded }, now);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code === 0) {
          this.machines = JSON.parse(r.stdout).machines ?? [];
          // Connected some other way (Add machine, hc machine add): no repair is left to hide its spaces behind.
          const fixed = this.machines.filter((m) => m.state === "connected" && this.reconnecting[m.name] && !this.reconnecting[m.name].busy);
          for (const m of fixed) delete this.reconnecting[m.name];
          if (fixed.length) localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
      } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "t3-menu", kind: "popup", width: 220, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || this.repos.forSpace(w, ps).answered || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    // Home stays in the model's order below, so the moves count it, but it's no one's checkout and has no row.
    const homeId = shared("t3-home.space");
    const list = sp.map((w, i) => ({ w, i, g: w.id === homeId ? null : this.repos.forSpace(w, ps).git }));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const worktrees = (repo) => list.filter((k) => k.g?.linked && k.g.repo === repo);
    // A checkout just opened from its dim row arrives last: it takes that row's place, so the group doesn't jump to the list's end.
    for (const [repo, at] of this.opening) {
      const main = list.findIndex((r) => r.g && !r.g.linked && r.g.repo === repo);
      const first = list.findIndex((r) => r.g?.linked && r.g.repo === repo);
      if (main >= 0 && first >= 0 && main > first) list.splice(first, 0, list.splice(main, 1)[0]);
      else if (main >= 0 || Date.now() - at > OPENING) this.opening.delete(repo);
    }
    // Grouped by repo, as T3's projects, so closing a checkout doesn't scatter its worktrees. One alone isn't worth a row over it.
    const nested = (r) => r.g?.linked && (mains.has(r.g.repo) || worktrees(r.g.repo).length > 1);
    const out = /** @type {any[]} */ ([]);
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    const hang = (top) => {
      const kids = worktrees(top.g.repo), folded = this.foldedRepos.has(top.g.repo);
      // Closed, the one you're on still shows, as T3's route row, and the count leaves it out.
      const keep = (k) => folded && k.w.active;
      top.kids = kids.length;
      top.members = kids.map((k) => k.w.id); // folded ones too: a drop's index counts them
      top.hiding = kids.filter((k) => !keep(k)).length;
      kids.forEach((k, n) => out.push({ ...k, folded: folded && !keep(k), tree: folded || n === kids.length - 1 ? "└─" : "├─" }));
    };
    for (const r of list) {
      if (nested(r)) {
        if (mains.has(r.g.repo) || placed.has(r.g.repo)) continue;
        placed.add(r.g.repo);
        // Its checkout isn't a space: a row stands for it, where its first worktree was. No .git folder (a bare repo): nothing to open.
        const [, common] = JSON.parse(r.g.repo);
        const head = { head: true, g: r.g, w: { id: `repo-${r.g.repo}`, name: r.g.name, machine: r.w.machine ?? null, folder: common.endsWith("/.git") ? common.slice(0, -5) : null } };
        out.push(head);
        hang(head);
        continue;
      }
      const top = { ...r, tree: null, kids: 0 };
      out.push(top);
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      hang(top);
    }
    // space.next/prev and ctrl-N follow the model, so it keeps the rows' order, folded rows included: folding moves nothing. A row with no space isn't in it.
    // Simulate the batch so later indexes include earlier moves. An attempted write can lose a sync conflict: let its echo settle before retrying.
    const real = out.filter((r) => !r.head);
    const order = sp.map(w => w.id);
    const target = real.map(r => r.w.id);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < real.length; i++) {
        const from = order.indexOf(real[i].w.id);
        if (from === i) continue;
        run("space.move", { id: real[i].w.id, index: i + 1 });
        moved.add(real[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    return out.filter(r => (r.head || this.shown.has(r.w.id)) && !r.folded && r.w.id !== homeId);
  }

  toggleRepo(repo, cx) {
    this.foldedRepos.has(repo) ? this.foldedRepos.delete(repo) : this.foldedRepos.add(repo);
    localStorage.setItem("repos.folded", JSON.stringify([...this.foldedRepos]));
    cx.notify();
  }


  // The list's rows, each { key, h, el, ghost, m (its machine), r (a space's or repo's row) }; ghost() draws one
  // without the ids, handlers and labels the list uses.
  grouped(t) {
    const rows = this.ordered(), ps = panes(), lifting = Boolean(this.drag?.moved);
    // Each space's number, as the list shows them (this computer first, then each machine), for ctrl-N (extras.space-N).
    const machineOrder = [null, ...[...new Set(rows.map(r => r.w.machine).filter(Boolean))].sort()];
    const numbered = machineOrder.flatMap(m => rows.filter(r => !r.head && (r.w.machine ?? null) === m).map(r => r.w.id));
    this.spaceNum = new Map(numbered.map((id, i) => [id, i + 1]));
    if (JSON.stringify(numbered) !== JSON.stringify(shared("t3-spaces.order") ?? null)) setShared("t3-spaces.order", numbered);
    const draw = (r, ghost) => r.head ? this.repoHead(r, t, ps, ghost) : this.row(r, t, ps, ghost);
    const entry = (r) => ({ key: r.head ? r.w.id : `space-${r.w.id}`, h: PITCH, m: r.w.machine ?? null, r, el: draw(r), ghost: () => draw(r, true) });
    const plain = (key, m, draw) => ({ key, h: PITCH, m, el: draw(false), ghost: () => draw(true) });
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.filter(m => !m.temporary).map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => plain(`machine-loading-${m ?? "local"}`, m, ghost => div().when(!ghost, el => el.id(`machine-loading-${m ?? "local"}`))
      .h(ROW).flex_none().px(10).flex().items_center().text_color(t.dim).child("Loading…"));
    if (!remote.length) return loading(null) && !rows.length ? [loadingRow(null)] : rows.map(entry);
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const folded = this.folded.has(m);
      const id = m ?? "local";
      // Drawn as the agents list's shelves, T3's: 2 and 8 in, the chevron at the row's end and its + as T3's folder has it, 24 and 2 before.
      // By the row's id: this computer's m is null, which a cleared field would equal. Kept as Agents' headings are, as a leave can go missing.
      const head = hoverKept(this, "overMachine", `machine-${id}`, h_flex().id(`machine-${id}`).h(ROW).flex_none().mx(2).px(8).gap(8).items_center()
        .text_size(12).font_medium().text_color(t.dim)
        .role("button").accessibility_label(`${folded ? "Expand" : "Collapse"} ${m ?? "This computer"}`))
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        // -1: the glyph's own inset, so its edge meets the heading and the spaces' marks.
        .child(svg(`mods/t3-spaces/icons/${m ? "server" : "monitor"}.svg`).size(14).ml(-1).flex_none())
        // The dot describes the machine, so it follows its name, however short.
        .child(h_flex().flex_1().min_w(0).gap(8).items_center()
          .child(div().min_w(0).truncate().child(m ?? "This computer"))
          .child(tipMark(this, t, `machine-state-${id}`, connected ? "Connected" : (machine?.state ?? "asleep").replace(/_/g, " ").replace(/^./, c => c.toUpperCase()), div().size(6).rounded_full().flex_none().bg(connected ? t.ansi2 : t.dim))))
        .when(!connected && !rebuilt, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
        .when(rebuilt, el => el.child(h_flex().flex_none().gap(4).items_center()
          .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
          .child(tip(this, t, `machine-connect-${m}`, `Connect ${m}`, stop(this, t, `machine-connect-${m}`, div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
            .hover(s => s.text_color(t.foreground)).on_hover(glow(this, `machine-connect-${m}`))
            .role("button").accessibility_label(`Connect ${m}`)
            .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
            .child(repair?.busy ? "Connecting…" : "Connect"), 4)))))
        // T3's folder sizes: a 24px + with a 14px icon (icon-xs) and a 12px chevron, in the heading buttons' two columns, 50 and
        // 22px from the sidebar's edge. The -2 sits on the group: on the chevron's own box it threw the whole group past the edge.
        .child(h_flex().flex_none().mr(-2).gap(10).items_center()
          .when(connected, el => el.child(tip(this, t, `machine-add-${id}`, "New space here", stop(this, t, `machine-add-${id}`, div().id(`machine-add-${id}`).size(24).flex_none().flex().items_center().justify_center().rounded(8)
            .text_color(this.hot === `machine-add-${id}` ? t.foreground : t.dim).on_hover(glow(this, `machine-add-${id}`))
            .role("button").accessibility_label("New space here")
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child(svg("mods/t3-spaces/icons/plus.svg").size(14)), 8),
            // The key makes a space on the current space's machine: it names this + only on that one.
            { action: (spaces().find(s => s.active)?.machine ?? null) === m ? "space.new" : null })))
          // An indicator, not a button: the whole row folds, so it lights with the row and has no label of its own.
          .child(div().id(`machine-fold-${id}`).flex_none()
            .text_color(this.overMachine === `machine-${id}` ? t.foreground : t.dim)
            .child(foldArrow("t3-spaces", `machine-fold-${id}`, !folded, 12, this.overMachine === `machine-${id}` ? t.foreground : t.dim))));
      const empty = plain(`machine-new-${id}`, m, ghost => {
        const el = h_flex().h(ROW).flex_none().px(10).gap(10).items_center().rounded(8)
          .text_color(this.hot === `machine-new-${id}` ? t.foreground : t.dim)
          // Laid out as a space's row: the + in the mark's 16px, the words where a name starts.
          .child(div().size(16).flex_none().flex().items_center().justify_center().child(svg("mods/t3-spaces/icons/plus.svg").size(12))).child("New space here");
        return ghost ? el : stop(this, t, `machine-new-${id}`, el.id(`machine-new-${id}`)
          .when(!lifting, el => el.hover(s => s.bg(t.hover)).active(s => s.bg(t.selected))).on_hover(glow(this, `machine-new-${id}`))
          .role("button").accessibility_label("New space here")
          .on_click(() => run("space.new", { machine: m ?? "" })), 8);
      });
      // A machine rarely goes, and when it does its heading just goes: no ghost.
      const heading = { key: `machine-${id}`, h: PITCH, m, el: stop(this, t, `machine-${id}`, head) };
      if (rebuilt) return [heading];
      return [heading, ...(folded ? [] : mine.length ? mine.map(entry) : [loading(m) ? loadingRow(m) : empty])];
    });
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one.
  gitTail(g, tree, name, t, id, ghost) {
    const n = (count, what) => `${count} commit${count === 1 ? "" : "s"} to ${what}`;
    const mark = (mid, label, el) => ghost ? el : tipMark(this, t, mid, label, el);
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(6)
      .justify_end()
      .items_center()
      .text_size(12)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(mark(`ahead-${id}`, n(g.ahead, "push"), div().text_color(t.ansi2).child(`\u2191${g.ahead}`))))
      .when(g.behind > 0, (el) => el.child(mark(`behind-${id}`, n(g.behind, "pull"), div().text_color(t.ansi1).child(`\u2193${g.behind}`))));
  }

  // A checkout's fold arrow: at the row's end, and folded, the count before it, as T3's folder; dim, brightening when hovered.
  // -8: past T3's micro button's padding and 2 more, its 12px chevron stands in the column of a machine's and a folder's,
  // 22px from the sidebar's edge, under the headings' last button.
  // The count just shows: it changes with the arrow, and a fade there isn't worth an element of its own.
  foldButton(t, id, repo, hiding, ghost) {
    const folded = this.foldedRepos.has(repo), lit = this.hot === id ? t.foreground : t.dim;
    const label = folded ? "Expand worktrees" : "Collapse worktrees";
    const el = div().h(20).min_w(20).mr(-8).px(6).gap(4).flex_none().flex().items_center().justify_center().rounded(4)
      // raised: the row under it already shows hover or selected.
      .text_size(11).text_color(lit)
      .when(folded && hiding > 0, el => el.child(String(hiding)))
      .child(foldArrow("t3-spaces", ghost ? null : id, !folded, 12, lit));
    return ghost ? el : tip(this, t, id, label, stop(this, t, id, el.id(id)
      .role("button").accessibility_label(label)
      .on_hover(glow(this, id))
      // Pressing it neither selects nor drags the space.
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.toggleRepo(repo, cx); }), 4));
  }

  // Once, however often it's pressed: the new space takes a moment to show.
  openCheckout({ w, g }) {
    if (Date.now() - (this.opening.get(g.repo) ?? -Infinity) < OPENING) return;
    this.opening.set(g.repo, Date.now());
    run("space.new", { folder: w.folder, machine: w.machine ?? "" });
  }

  // A repo's worktrees with its checkout not open: the checkout's row, dimmed, with its fold arrow. It has no tab to go to,
  // so a click opens it, and it becomes the checkout's own row. A bare repo has nothing to open: there the click folds.
  repoHead(r, t, ps, ghost) {
    const { w, g, hiding = 0 } = r, rowId = w.id, foldId = `${rowId}-fold`;
    const el = h_flex().h(ROW).flex_none().px(10).gap(10).items_center().rounded(8)
      .child(div().flex_none().opacity(0.5).child(projectMark(w, 16, t, ps)))
      .child(div().flex_1().min_w(0).truncate().font_medium().text_color(t.dim).child(w.name))
      .child(this.foldButton(t, foldId, g.repo, hiding, ghost));
    return ghost ? el : stop(this, t, rowId, el.id(rowId)
      .when(!this.drag?.moved, el => el.hover(s => s.bg(t.hover)).active(s => s.bg(t.selected)))
      .role("button").accessibility_label(w.folder ? `Open ${w.name}` : `${this.foldedRepos.has(g.repo) ? "Expand" : "Collapse"} ${w.name}`)
      .on_click((_e, cx) => { if (w.folder) this.openCheckout(r); else this.toggleRepo(g.repo, cx); cx.notify(); }), 8);
  }

  row({ w, g, tree, kids = 0, hiding = kids }, t, ps, ghost) {
    const on = w.active;
    // A checkout with worktrees folds them as an agent folds its sub-agents: an arrow at the
    // end, and folded, the count; dim, brightening when hovered.
    const foldId = `space-fold-${w.id}`;
    const rowId = `space-${w.id}`;
    const el = v_flex()
      .relative()
      .px(10)
      .h(ROW)
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on, (el) => el.bg(t.selected))
      // The same tree lines as sub-agents: from the checkout's avatar center, turning into the branch icon.
      .when(tree === "├─", el => el.child(div().absolute().left(17.25).top(0).bottom(-STACK).w(1.5).bg(t.input)))
      .when(Boolean(tree), el => el.child(div().absolute().left(17.25).top(-4).h(20).w(9.75).border_l(1.5).border_b(1.5).rounded_bl(6).border_color(t.input)))
      .child(
        h_flex()
          .w_full().min_w(0)
          .gap(10)
          .items_center()
          .when(Boolean(tree), el => el.pl(20).child(h_flex().size(16).flex_none().items_center().justify_center()
            .child(svg("mods/t3-spaces/icons/git-branch.svg").size(16).text_color(t.dim))))
          .when(!tree, el => el.child(projectMark(w, 16, t, ps)))
          .child(div().min_w(0).max_w(150).truncate().font_medium().text_color(t.foreground + "e6").child(w.name))
          .child(g ? this.gitTail(g, tree, w.name, t, w.id, ghost) : div().flex_1())
          .when(kids > 0, el => el.child(this.foldButton(t, foldId, g.repo, hiding, ghost)))
          .when((this.spaceNum?.get(w.id) ?? 99) <= 9, el => el.child(keycap(t, this.spaceNum.get(w.id), on))),
      );
    if (ghost) return el;
    return stop(this, t, rowId, el
      .id(rowId)
      .role("button")
      .accessibility_label(w.name)
      .when(!on && !this.drag?.moved, (el) => el.hover((s) => s.bg(t.hover)).active((s) => s.bg(t.selected)))
      // Held by its space and where it was drawn: a move under it doesn't change what's lifted.
      .on_mouse_down("left", (e) => {
        this.drag = { id: w.id, key: rowId, at: e.position, top: /** @type {any} */ (this).motion?.at.get(rowId)?.y ?? 0, moved: false };
      })
      // A press that never became a drag is a click.
      .on_mouse_up("left", (_e, cx) => {
        if (this.drag?.id !== w.id || this.drag.moved) return;
        this.drag = null;
        run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w)),
    // A space goes by its mouse-up, which a key isn't.
    8, { enter: () => run("space.select", { id: w.id }) });
  }

  // Dragging, as T3's sidebar and the inbox do it: press a space and move 6px to lift it, with its worktrees when it's a
  // checkout; it follows the pointer and the list opens a gap where letting go puts it. Within its machine only.
  dragTo(e, cx) {
    const d = this.drag;
    if (!d) return;
    pointerMoved(e.position);
    d.box = e.bounds;
    const dy = e.position.y - d.at.y;
    if (!d.moved && Math.hypot(e.position.x - d.at.x, dy) <= 6) return;
    // Let go outside the window, neither a release nor a leave comes (see pointerGone), and a move doesn't say whether the button's down.
    if (!d.moved) {
      this.dragKeys.focus();
      this.dragFocus = true;
      const watch = cx.timer.every(POINTER_WATCH, (cx) => {
        if (this.drag !== d) { watch.cancel(); if (!this.drag) this.letGo(cx, true); return; }
        if (!dragGone(d.box)) return;
        watch.cancel();
        this.letGo(cx, true);
      });
    }
    d.moved = true;
    // shortcut: measured from the press in window coordinates, so scrolling the list mid-drag isn't followed; take the rows' local_position if that matters.
    d.dy = dy;
    cx.notify();
  }

  // The lifted rows (a checkout takes its worktrees along) and the list without them.
  lift(rows, key) {
    const at = rows.findIndex((e) => e.key === key);
    if (at < 0) return null;
    let end = at + 1;
    if (!rows[at].r.tree) while (rows[end]?.r?.tree) end++;
    return { at, block: rows.slice(at, end), rest: [...rows.slice(0, at), ...rows.slice(end)] };
  }

  // Where they'd land, as an index into the rest, from the lifted top `y` and the rest's fixed pitch (never from
  // the rows the gap is moving): the nearest boundary its kind may take, a group between its machine's groups or a
  // worktree among its own. Half a row into another machine's rows, where it came from.
  slot({ at, block, rest }, y) {
    const lead = block[0], kid = Boolean(lead.r.tree);
    const under = rest[Math.min(rest.length - 1, Math.floor((y - ROW / 2) / PITCH))];
    if (under && under.m !== lead.m) return at;
    let from = at, to = at;
    if (kid) { while (rest[from - 1]?.r?.tree) from--; while (rest[to]?.r?.tree) to++; }
    else { from = 0; to = rest.length; }
    const starts = (e) => e?.r && !e.r.tree && e.m === lead.m;
    let best = at;
    for (let j = from; j <= to; j++) {
      const ok = kid || starts(rest[j]) || (rest[j - 1]?.r && rest[j - 1].m === lead.m && rest[j]?.m !== lead.m);
      if (ok && Math.abs(j * PITCH - y) < Math.abs(best * PITCH - y)) best = j;
    }
    return best;
  }

  // space.move's index for landing at the slot: before the next group (worktree) there, else after the one above.
  // Read from the model as it is now, folded worktrees included.
  dest({ at, block, rest }, { id, slot }) {
    if (slot === at) return null;
    const kid = Boolean(block[0].r.tree), order = spaces().map((s) => s.id), from = order.indexOf(id);
    const unit = (r) => [...(r.head ? [] : [r.w.id]), ...(r.members ?? [])].map((x) => order.indexOf(x)).filter((i) => i >= 0);
    const next = rest[slot];
    if (next?.r && Boolean(next.r.tree) === kid && next.m === block[0].m) {
      const u = Math.min(...unit(next.r));
      return from < 0 || u === Infinity ? null : from > u ? u + 1 : u;
    }
    let k = slot - 1;
    while (!kid && rest[k]?.r?.tree) k--;
    const p = rest[k]?.r ? Math.max(...unit(rest[k].r)) : -Infinity;
    return from < 0 || p === -Infinity ? null : from < p ? p + 1 : p + 2;
  }

  // Let go: it lands where the gap is (with `back`, where it came from), sliding there from where it was let go.
  letGo(cx, back) {
    const d = this.drag;
    this.drag = null;
    if (this.dragFocus) {
      this.dragFocus = false;
      const back = focused();
      if (back?.pane) run("pane.focus", { pane: back.pane });
      else if (back?.terminal) run("pane.focus", { terminal: back.terminal });
    }
    if (d?.drawn) {
      this.landed = { key: d.key, y: d.y };
      const l = this.lift(this.rows, d.key), index = back || !l ? null : this.dest(l, /** @type {any} */ (d));
      if (index) {
        run("space.move", { id: d.id, index });
        this.landing = { key: d.key, slot: d.slot, at: Date.now() };
        cx.timer.after(1000, (cx) => cx.notify());
      }
    }
    cx.notify();
  }

  render(cx) {
    const t = theme();
    const sp = spaces();
    // While a row's lifted, nothing under the pointer lights or labels itself.
    if (this.drag?.moved) this.hot = this.overMachine = null;
    // The shipped mods (the Terminals picker) still color spaces from "space.colors": the same color, from the name.
    const colors = Object.fromEntries(sp.filter(p => p.name !== "~").map(p => [p.id, tint(p.name, false)]));
    if (JSON.stringify(colors) !== JSON.stringify(shared("space.colors") ?? {})) setShared("space.colors", colors);
    const rows = this.rows = this.grouped(t);
    // New space here goes as the space it made arrives, with no leave to say so: it would come back lit.
    if (this.hot?.startsWith("machine-new-") && !rows.some((e) => e.key === this.hot)) this.hot = null;
    // A row that left the list (closed, folded away) can't be dropped.
    let d = this.drag, shown = rows, lifted = null;
    if (d && !rows.some((e) => e.key === d.key)) d = this.drag = null;
    if (d?.moved) {
      const l = this.lift(rows, d.key), h = l.block.length * PITCH;
      d.y = Math.max(0, Math.min(d.top + d.dy, l.rest.length * PITCH));
      // The first frame lifted keeps the gap where the row was, so a quick first move still slides the rows it passes.
      d.slot = d.drawn ? this.slot(l, d.y) : l.at;
      shown = [...l.rest.slice(0, d.slot), { key: "space-gap", h, el: div().h(h - STACK), ghost: () => div().h(h - STACK) }, ...l.rest.slice(d.slot)];
      lifted = v_flex().id("space-lifted").absolute().left(0).right(0).top(d.y).gap(STACK).rounded(8).bg(t.selected).shadow_lg()
        .children(l.block.map((e) => e.ghost()));
    } else if (this.landing) {
      // Until the model's echo of the move arrives, the rows stay where they were let go.
      const l = this.lift(rows, this.landing.key), slot = this.landing.slot;
      if (!l || l.at === slot || Date.now() - this.landing.at >= 1000) this.landing = null;
      else shown = [...l.rest.slice(0, slot), ...l.block, ...l.rest.slice(slot)];
    }
    // The first frame lifted is the list as it was, the gap where the row was: nothing to play.
    planMotion(this, shown, cx, { freeze: d?.moved && !d.drawn, from: this.landed });
    if (d?.moved) d.drawn = true;
    this.landed = null;
    const asks = props()?.newMenu && machines().length > 1;
    const tool = (id, label, icon, fn, more) => tip(this, t, id, label, stop(this, t, id, div().id(id).size(28).flex_none().flex().items_center().justify_center().rounded(8).text_color(this.hot === id ? t.foreground : t.dim).on_hover(glow(this, id)).on_mouse_down("left", () => pressed(this)).role("button").accessibility_label(label).hover(s => s.bg(t.hover))
      .on_click(fn).child(svg(`mods/t3-spaces/icons/${icon}.svg`).size(16)), 8), more);
    return focusRoot(this, v_flex().size_full().min_h(0).bg(t.chrome).text_size(14)
      .when(this.dragFocus, el => el.track_focus(this.dragKeys).on_key_down((e, cx) => {
        if (e.keystroke !== "escape" || !this.dragFocus) return;
        cx.stop_propagation();
        this.letGo(cx, true);
      }))
      // As tall as Inbox's top row, T3's.
      .child(h_flex().id("spaces-heading").h(32).flex_none().pl(18).pr(8).items_center().justify_between().text_size(12).font_medium().text_color(t.dim)
        .child(div().text_color(t.muted).child("Spaces"))
        // The same two as Inbox's top row, so switching modes moves nothing.
        .child(h_flex().flex_none().items_center()
          .child(tool("space-new", "New space", "folder-plus", (_e, cx) => {
            this.hot = null;
            // The layout's menu asks which machine, as its mod.json places it; the shipped one can't, so docked alone it's the active space's.
            const closing = justClosed(this, `${props()?.newMenu}.pickClosed`);
            if (!asks) run("space.new");
            else if (!closing) openOverlay({ mod: props().newMenu, kind: "popup", frame: "none", at: /** @type {any} */ ("top"), offset: 96, width: 576, height: 420, props: { pick: true } });
            cx.notify();
          }, { action: asks ? null : "space.new" }))
          .child(tool("space-new-tab", "New tab", "square-pen", (_e, cx) => { this.hot = null; const menu = props()?.newMenu ?? "new-menu"; if (!justClosed(this, `${menu}.closed`)) run("mod.open", { name: menu }); cx.notify(); }))))
      .child(v_flex().id("space-list").flex_1().min_h(0).overflow_y_scroll()
        .on_mouse_move((e, cx) => this.dragTo(e, cx))
        // Released anywhere in the list, it lands where the gap is.
        .on_mouse_up("left", (_e, cx) => this.letGo(cx))
        // Herdr reports no release outside the sidebar, so leaving ends a drag, as in the inbox: back where it was.
        .on_hover((on, cx) => { if (!on && (this.drag || this.dragFocus)) this.letGo(cx, true); })
        .child(v_flex().id("space-content").w_full().flex_none().px(8).pt(4).pb(8)
          // Inside the padding, so the rows that left and the lifted one line up with the rows.
          .child(v_flex().id("space-rows").relative().gap(STACK)
            .children(leavingRows(this))
            .children(shown.map((e) => flying(this, e.key, e.el)))
            .when(Boolean(lifted), (el) => el.child(lifted))))));
  }
}
