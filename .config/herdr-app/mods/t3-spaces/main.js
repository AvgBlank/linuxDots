// Workspace spaces: stable colored avatars, worktrees under their checkout, grouped by machine when more than one is known.
// After a space's name, its repo only where unusual (branch, ahead/behind); agent state lives in the agents list, not here.

import { View, div, svg } from "gpui-kit";
import { foldArrow, planMotion, flying, leavingRows } from "./motion.js";
import { v_flex, h_flex } from "gpui-base";
import { checking, spaces, machines, panes, focused, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window, props, layout, nextCommand } from "herdr";
import { projectMark, monogramColor } from "./project.js";
import { newSpaceButton } from "./new-space.js";
import { repoFacts } from "./repos.js";
import { spaceOrdering } from "./ordering.js";
import { dragGone, glow, hoverKept, tip, tipMark, POINTER_WATCH, pointerMoved } from "./tip.js";
import { openMenu } from "./menu.js";
import { stopsInit, stopsEnd, stop, focusRoot, enter } from "./focus.js";
import { trigger } from "./trigger.js";
import { sidebarParts } from "./sidebar.js";
import { KEY, closedKey, readLocal } from "./store.js";
import { button, radiusOf } from "./button.js";
import { alpha } from "./color.js";
import { prepareSpace } from "./space-arrival.js";

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
  async close() { this.repos?.close(); stopsEnd(this); }

  init(_props, cx) {
    stopsInit(this, cx);
    this.dragKeys = cx.focus_handle();
    // pane.go onto this list (mod.json's "focusable"): the keyboard starts at the heading's button.
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") enter(this, cx, "space-new");
        // A machine heading's menu (t3-menu): its Connect.
        else if (command.startsWith("reconnect:")) {
          const name = command.slice("reconnect:".length), machine = this.machines.find(k => k.name === name) ?? this.reconnecting[name]?.machine;
          if (machine) this.reconnect(machine, cx);
        }
      }
    });
    this.repos = repoFacts({ exec, watchFolder, cx });
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.drag = null; // Pressed row, lifted once it moves 6px; edge names the gap actually drawn.
    this.machines = [];
    this.reconnecting = readLocal("machines.reconnecting", {});
    for (const state of Object.values(this.reconnecting)) if (state && typeof state === "object") state.busy = false;
    this.folded = new Set(readLocal("machines.folded", []));
    this.foldedRepos = new Set(readLocal("repos.folded", []));
    this.order = spaceOrdering({ spaces, panes, machines, run, home: () => shared(KEY.home), facts: (w, ps) => this.repos.forSpace(w, ps),
      shown: this.shown, foldedRepos: this.foldedRepos, row: ROW, pitch: PITCH });
    this.machinesSeen = this.machinesNow();
    this.machinesDirty = false;
    this.machinesRefreshedAt = -Infinity;
    this.wasInView = listInView();
    if (this.wasInView) this.refreshMachines(cx);
    cx.timer.every(15000, cx => {
      if (listInView()) this.refreshMachines(cx);
    });
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (repos.js).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  machinesNow(list = machines()) {
    return JSON.stringify(list.map((m) => [m.name, m.layout]));
  }

  checkNew(cx) {
    if (checking()) return;
    const now = Date.now();
    const known = machines();
    // A machine came or went: tracked while hidden, asked once back in view.
    const seen = this.machinesNow(known);
    if (seen !== this.machinesSeen) {
      this.machinesSeen = seen;
      this.machinesDirty = true;
    }
    const sp = spaces(), active = window().active, draw = sp.some((s) => !this.shown.has(s.id)) || this.order.due(now);
    // layout() copies the whole tree: skip when already in view and neither active nor drawing;
    // once hidden, check every tick so returning to view wakes polling immediately.
    const inView = !this.wasInView || active || draw ? listInView() : true;
    if (!inView) {
      this.wasInView = false;
      return;
    }
    const returned = !this.wasInView;
    this.wasInView = true;
    if (this.machinesDirty || (returned && now - this.machinesRefreshedAt >= 15000)) {
      this.refreshMachines(cx);
    }
    const visible = Boolean(active || draw);
    this.repos.update({ spaces: sp, panes: panes(), machines: known, active, visible, folded: this.folded }, now);
    if (draw && visible) cx.notify();
  }

  refreshMachines(cx) {
    if (checking()) return;
    this.machinesDirty = false;
    this.machinesRefreshedAt = Date.now();
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

  toggleRepo(repo, cx) {
    this.foldedRepos.has(repo) ? this.foldedRepos.delete(repo) : this.foldedRepos.add(repo);
    localStorage.setItem("repos.folded", JSON.stringify([...this.foldedRepos]));
    cx.notify();
  }


  // The list's rows, each { key, h, el, ghost, m (its machine), r (a space's or repo's row) }; ghost() draws one
  // without the ids, handlers and labels the list uses.
  // `sp`, `ps`: the draw's one read of spaces() and panes().
  grouped(t, sp, ps) {
    const rows = this.order.rows(sp, ps), lifting = Boolean(this.drag?.moved), here = sp.find(s => s.active)?.machine ?? null;
    // Each space's number within its own machine (1..9 per device), for ctrl-a alt-N and ctrl-alt-shift-N.
    const machineOrder = [null, ...[...new Set(rows.map(r => r.w.machine).filter(Boolean))].sort()];
    const byMachine = {};
    const spaceNum = new Map();
    for (const m of machineOrder) {
      const ids = rows.filter(r => !r.head && (r.w.machine ?? null) === m).map(r => r.w.id);
      byMachine[m ?? ""] = ids;
      ids.forEach((id, i) => spaceNum.set(id, i + 1));
    }
    this.spaceNum = spaceNum;
    const numbered = machineOrder.flatMap(m => byMachine[m ?? ""]);
    if (JSON.stringify(numbered) !== JSON.stringify(shared("t3-spaces.order") ?? null)) setShared("t3-spaces.order", numbered);
    if (JSON.stringify(byMachine) !== JSON.stringify(shared("t3-spaces.by-machine") ?? null)) setShared("t3-spaces.by-machine", byMachine);
    const draw = (r, ghost) => r.head ? this.repoHead(r, t, ps, ghost) : this.row(r, t, ps, ghost);
    const entry = (r) => ({ key: r.head ? r.w.id : `space-${r.w.id}`, h: PITCH, m: r.w.machine ?? null, r, el: draw(r), ghost: () => draw(r, true) });
    const plain = (key, m, draw) => ({ key, h: PITCH, m, el: draw(false), ghost: () => draw(true) });
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.filter(m => !m.temporary).map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    let known;
    const loading = m => {
      const layout = (known ??= machines()).find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || sp.some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => plain(`machine-loading-${m ?? "local"}`, m, ghost => div().when(!ghost, el => el.id(`machine-loading-${m ?? "local"}`))
      .h(ROW).flex_none().px(8).flex().items_center().text_color(t.dim).child("Loading…"));
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
      // Drawn as the agents list's shelves, T3's: the chevron at the row's end and its + as T3's folder has it.
      // By the row's id: this computer's m is null, which a cleared field would equal. Kept as Agents' headings are, as a leave can go missing.
      const head = hoverKept(this, "overMachine", `machine-${id}`, h_flex().id(`machine-${id}`).h(ROW).flex_none().mx(2).px(8).gap(8).items_center()
        .text_size(12).font_medium().text_color(t.dim)
        .role("button").accessibility_label(`${folded ? "Expand" : "Collapse"} ${m ?? "This computer"}`))
        // Its + and its Connect in a menu; asleep, with neither, it has none.
        .when(connected || (rebuilt && !repair?.busy), el => el.on_mouse_down("right", (_e, cx) => openMenu(this, "machine", { machine: m, connected, connect: rebuilt && !repair?.busy }, cx)))
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
          .child(tipMark(this, t, `machine-state-${id}`, connected ? "Connected" : (machine?.state ?? "asleep").replace(/_/g, " ").replace(/^./, c => c.toUpperCase()), div().size(6).rounded_full().flex_none().bg(connected ? t.ansi2 : t.dim)))
          .when(machine?.keeps_running_after_logout === false, el => el.child(trigger(this, t, `machine-logout-${id}`, {
            icon: "mods/t3-spaces/icons/circle-alert.svg", label: "Agents stop when you disconnect. Show the fix", size: "micro", surface: "row", color: t.blocked, open: false,
            onOpen: () => openOverlay({ mod: "machine-add", kind: "dialog", width: 560 }),
          }))))
        .when(!connected && !rebuilt, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
        .when(rebuilt, el => el.child(h_flex().flex_none().gap(4).items_center()
          .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
          .child(stop(this, t, `machine-connect-${m}`, div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
            .hover(s => s.text_color(t.foreground))
            .role("button").accessibility_label(`Connect ${m}`)
            .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
            .child(repair?.busy ? "Connecting…" : "Connect"), 4))))
        // T3's folder sizes: a 24px + with a 14px icon (icon-xs) and a 12px chevron, in the heading buttons' two columns, 50 and
        // 22px from the sidebar's edge. The -2 sits on the group: on the chevron's own box it pushes the whole group past the edge.
        .child(h_flex().flex_none().mr(-2).gap(10).items_center()
          .when(connected, el => el.child(tip(this, t, `machine-add-${id}`, "New space here", stop(this, t, `machine-add-${id}`, button(t, `machine-add-${id}`, { icon: "mods/t3-spaces/icons/plus.svg", label: "New space here", surface: "row", hot: this.hot === `machine-add-${id}` })
            .on_hover(glow(this, `machine-add-${id}`))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }), radiusOf()),
            // The key makes a space on the current space's machine: it names this + only on that one.
            { action: here === m ? "space.new" : null })))
          // An indicator, not a button: the whole row folds, so it lights with the row and has no label of its own.
          .child(div().id(`machine-fold-${id}`).flex_none()
            .text_color(this.overMachine === `machine-${id}` ? t.foreground : t.dim)
            .child(foldArrow("t3-spaces", `machine-fold-${id}`, !folded, 12, this.overMachine === `machine-${id}` ? t.foreground : t.dim))));
      const empty = plain(`machine-new-${id}`, m, ghost => {
        const el = h_flex().h(ROW).flex_none().px(8).gap(10).items_center().rounded(8)
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
    const el = button(t, ghost ? undefined : id, { size: "micro", wide: true, surface: "row", label, hot: !ghost && this.hot === id }).min_w(20).mr(-8)
      .when(folded && hiding > 0, el => el.child(String(hiding)))
      .child(foldArrow("t3-spaces", ghost ? null : id, !folded, 12, lit));
    return ghost ? el : tip(this, t, id, label, stop(this, t, id, el
      .on_hover(glow(this, id))
      // Pressing it neither selects nor drags the space.
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.toggleRepo(repo, cx); }), radiusOf("micro")));
  }

  // A repo's worktrees with its checkout not open: the checkout's row, dimmed, with its fold arrow. It has no tab to go to,
  // so a click opens it, and it becomes the checkout's own row. A bare repo has nothing to open: there the click folds.
  repoHead(r, t, ps, ghost) {
    const { w, g, hiding = 0 } = r, rowId = w.id, foldId = `${rowId}-fold`;
    const el = h_flex().h(ROW).flex_none().px(8).gap(10).items_center().rounded(8)
      .child(div().flex_none().opacity(0.5).child(projectMark("mods/t3-spaces", w, 16, t, ps)))
      .child(div().flex_1().min_w(0).truncate().font_medium().text_color(t.dim).child(w.name))
      .child(this.foldButton(t, foldId, g.repo, hiding, ghost));
    return ghost ? el : stop(this, t, rowId, el.id(rowId)
      .when(!this.drag?.moved, el => el.hover(s => s.bg(t.hover)).active(s => s.bg(t.selected)))
      .role("button").accessibility_label(w.folder ? `Open ${w.name}` : `${this.foldedRepos.has(g.repo) ? "Expand" : "Collapse"} ${w.name}`)
      .on_click((_e, cx) => { if (w.folder) this.order.openCheckout(r); else this.toggleRepo(g.repo, cx); cx.notify(); })
      // A bare repo has nothing to open or copy.
      .when(Boolean(w.folder), el => el.on_mouse_down("right", (_e, cx) => openMenu(this, "checkout", { folder: w.folder, machine: w.machine ?? null }, cx))), 8);
  }

  row({ w, g, tree, kids = 0, hiding = kids }, t, ps, ghost) {
    const on = w.active;
    // A checkout with worktrees folds them as an agent folds its sub-agents: an arrow at the
    // end, and folded, the count; dim, brightening when hovered.
    const foldId = `space-fold-${w.id}`;
    const rowId = `space-${w.id}`;
    const el = v_flex()
      .relative()
      .px(8)
      .h(ROW)
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on, (el) => el.bg(t.selected))
      // The same tree lines as sub-agents: from the checkout's avatar center, turning into the branch icon.
      .when(tree === "├─", el => el.child(div().absolute().left(15.25).top(0).bottom(-STACK).w(1.5).bg(t.input)))
      .when(Boolean(tree), el => el.child(div().absolute().left(15.25).top(-4).h(20).w(9.75).border_l(1.5).border_b(1.5).rounded_bl(6).border_color(t.input)))
      .child(
        h_flex()
          .w_full().min_w(0)
          .gap(10)
          .items_center()
          .when(Boolean(tree), el => el.pl(20).child(h_flex().size(16).flex_none().items_center().justify_center()
            .child(svg("mods/t3-spaces/icons/git-branch.svg").size(16).text_color(t.dim))))
          .when(!tree, el => el.child(projectMark("mods/t3-spaces", w, 16, t, ps)))
          .child(div().min_w(0).max_w(150).truncate().font_medium().text_color(alpha(t.foreground, "e6")).child(w.name))
          .child(g ? this.gitTail(g, tree, w.name, t, w.id, ghost) : div().flex_1())
          .when(kids > 0, el => el.child(this.foldButton(t, foldId, g.repo, hiding, ghost)))
          .when((this.spaceNum?.get(w.id) ?? 99) <= 9, el => el.child(keycap(t, this.spaceNum.get(w.id), on))),
      );
    if (ghost) return el;
    const select = () => { prepareSpace(w.id); run("space.select", { id: w.id }); };
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
        select();
        cx.notify();
      })
      .on_mouse_down("right", (_e, cx) => openMenu(this, "space", { id: w.id }, cx)),
    // A space goes by its mouse-up, which a key isn't.
    8, { enter: select });
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
    // shortcut: measured from the press in window coordinates, so scrolling mid-drag isn't followed; use the rows' local_position if that matters.
    d.dy = dy;
    cx.notify();
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
      if (!back && d.edge) this.order.place(d.id, d.edge);
    }
    cx.notify();
  }

  render(cx) {
    const t = theme();
    const sp = spaces(), ps = panes();
    // While a row's lifted, nothing under the pointer lights or labels itself.
    if (this.drag?.moved) this.hot = this.overMachine = null;
    // The shipped mods (the Terminals picker) still color spaces from "space.colors": the same color, from the name.
    const colors = Object.fromEntries(sp.filter(p => p.name !== "~").map(p => [p.id, monogramColor(p.name, false)]));
    if (JSON.stringify(colors) !== JSON.stringify(shared("space.colors") ?? {})) setShared("space.colors", colors);
    const rows = this.rows = this.grouped(t, sp, ps);
    // New space here goes as the space it made arrives, with no leave to say so: it would come back lit.
    if (this.hot?.startsWith("machine-new-") && !rows.some((e) => e.key === this.hot)) this.hot = null;
    // A row that left the list (closed, folded away) can't be dropped.
    let d = this.drag, shown = rows, lifted = null;
    if (d && !rows.some((e) => e.key === d.key)) d = this.drag = null;
    if (d?.moved) {
      // The first frame lifted keeps the gap where the row was, so a quick first move still slides the rows it passes.
      const { block, rest, slot, y, edge } = this.order.preview(rows, d.key, d.top + d.dy, d.drawn), h = block.length * PITCH;
      d.y = y; d.edge = edge;
      shown = [...rest.slice(0, slot), { key: "space-gap", h, el: div().h(h - STACK), ghost: () => div().h(h - STACK) }, ...rest.slice(slot)];
      lifted = v_flex().id("space-lifted").absolute().left(0).right(0).top(d.y).gap(STACK).rounded(8).bg(t.selected).shadow_lg()
        .children(block.map((e) => e.ghost()));
    }
    // The first frame lifted is the list as it was, the gap where the row was: nothing to play.
    planMotion(this, shown, cx, { freeze: d?.moved && !d.drawn, from: this.landed });
    if (d?.moved) d.drawn = true;
    this.landed = null;
    const tool = (id, label, icon, options) => trigger(this, t, id, { icon: `mods/t3-spaces/icons/${icon}.svg`, label, ...options });
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
          .child(tool("space-new", "New space", "folder-plus", newSpaceButton(props()?.newMenu, sp)))
          .child(tool("space-new-tab", "New tab in…", "square-pen", { closed: closedKey(props()?.newMenu ?? "new-menu"), onOpen: () => run("mod.open", { name: props()?.newMenu ?? "new-menu" }) }))))
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
