// Workspace spaces: names in stable colors, worktrees under their checkout,
// grouped by machine when more than one is known. Git only places a worktree
// space under its repo's space; no branch shows. Each space's agents are listed
// under it, with their sub-agents. Click to switch, right-click for its menu,
// drag to reorder.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, panes, agents, terminals, focused, setAgentOrder, run, openOverlay, exec, hc, theme, shared, setShared, settings } from "herdr";

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
// Agent and sub-agent rows are ROW tall. A space row is taller by the difference in text size
// (15 - 12), so the space between the space name and its first agent's text equals the space
// between two agents' texts. A space after the first has SPACE_GAP above it.
const ROW = 26, SPACE_ROW = ROW + 3, SPACE_GAP = 7;
// The tab count before a space's name: a BADGE square (two digits fit; more widen it), then
// BADGE_GAP; agent rows start their names at the same place.
const BADGE = 15, BADGE_GAP = 6;
// The space's number (ctrl-N) before its tab-count badge.
const NUM = 12;
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);

// Space colors: the soft rainbow of the Context panel (bettr-context COLORS), in its
// order. `space.colors` stores the hex value. A new space gets the least-used one.
const PALETTE = ["#ee7d7d", "#f2a46a", "#ecc56a", "#7ecf86", "#6fb3ea", "#8c8ce6", "#c08ae6"];

// `color` (#rgb, #rrggbb or #rrggbbaa) at `alpha` (hex 00-ff); any other color as it is.
// The same helper is in bettr-tabs (a mod cannot import another's files).
const tint = (color, alpha) => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color)?.[1];
  if (!hex) return color;
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex.slice(0, 6)}${alpha}`;
};

// Agent rows, from the former Agents panel.
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function lead(tab, all) {
  const mine = all.filter(p => p.tab === tab.id && p.terminal);
  return mine.find(p => p.program?.agent) ?? mine.find(p => p.focused) ?? mine[0];
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};

// Numbers and names use the terminals' font (Herdr's `font_family` setting), else Herdr's
// default. Read once per render.
let font = "JetBrains Mono";
const mono = el => el.font_family(font);
const readFont = () => { font = settings()?.font_family || "JetBrains Mono"; };

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export default class Spaces extends View {
  init(_props, cx) {
    this.git = {}; // where() -> { repo, linked }, null: not a repo
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.ready = {}; // machine -> its layout was readable at the last look
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.agentFolded = new Set(); // agents whose sub-agents are hidden
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    // Redraw the time each agent has been in its state (minutes).
    cx.timer.every(30000, (cx) => cx.notify());
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // New places (a new space, a cd) get one git look; the timer itself only compares
    // folders, so it is cheap.
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
  }

  // Places git has not answered for: new ones, and those on a machine that is back.
  // Whether a folder is a repo or a worktree does not change while a space is there,
  // so a place is asked again only after the spaces leave it and come back.
  due(sp, ps) {
    const keys = new Set(sp.map((s) => where(s, ps)).filter((k) => JSON.parse(k)[1]));
    for (const k of Object.keys(this.git)) if (!keys.has(k) && !this.pending.has(k)) delete this.git[k];
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of this.unsure) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    return due;
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
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

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key);
      }
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's repo: its shared git folder, and whether the place is a linked worktree
  // (its top's own .git is not that folder).
  async check(key) {
    const [on, cwd] = JSON.parse(key);
    this.unsure.delete(key);
    try {
      const r = await exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], { cwd, on });
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      const [top, repo] = r.stdout.trim().split("\n").map((line) => line.trim());
      this.git[key] = { repo: JSON.stringify([on, repo]), linked: repo !== `${top}/.git` };
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  // Idle: a ring; done: a dot; working: a spinner; blocked: "Needs you".
  status(t, a) {
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(tint(t.blocked, "26")).text_size(11).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle);
    return div().size(7).mx(3).flex_none().rounded(4).when(a.status === "done", el => el.bg(t.done));
  }

  subRow(t, s, shown, indent) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      // The focused background starts at the space's tab count, with the same rounding.
      .ml(indent - BADGE - BADGE_GAP)
      .pl(BADGE + BADGE_GAP + 6)
      .pr(8)
      .rounded(4)
      .h(ROW)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(11)
      .cursor_pointer()
      // Focused: brighter text on a faint background. Hovered: brighter text only.
      .when(on, el => el.bg(tint(t.raised, "55")))
      .text_color(on ? t.foreground : t.muted)
      .hover((s) => s.text_color(t.foreground))
      .on_click(() => run("terminal.peek", { terminal: k.address }))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .child(div().flex_1().truncate().child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }));
  }

  // The fold chevron; folded, the count too, colored by the most urgent one.
  fold(t, a, subs) {
    const sts = subs.map((s) => kidStatus(s.t, this.listed));
    const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
    const open = !this.agentFolded.has(a.address);
    return div()
      .id(`fold-${a.address}`)
      .h(18)
      .px(3)
      .gap(3)
      .flex()
      .items_center()
      .rounded(4)
      .text_size(11)
      .text_color(open ? t.dim : (t[top] ?? t.dim))
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        open ? this.agentFolded.add(a.address) : this.agentFolded.delete(a.address);
        cx.notify();
      })
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
      .when(!open, (el) => el.child(String(subs.length)));
  }

  // An agent under its space: its tab's name or its own title, never an automatic
  // tab number unless two rows in the space would otherwise read the same.
  // `indent`: where its space's name starts, so the two line up.
  agentRow(t, a, subs, now, indent) {
    const name = this.names.get(a.address);
    const when = this.changed[a.address]?.at ?? 0;
    return h_flex()
      .id(`ag-${a.address}`)
      .relative()
      // The focused background starts at the space's tab count, with the same rounding.
      .ml(indent - BADGE - BADGE_GAP)
      .pl(BADGE + BADGE_GAP)
      .pr(8)
      .h(ROW)
      .flex_none()
      .rounded(4)
      .items_center()
      .gap(9)
      // The run time's size; the name is 12, under the space name's 15.
      .text_size(11)
      .cursor_pointer()
      // Bright only when focused (on a faint background) or hovered; the status mark says the rest.
      .when(a.focused, el => el.bg(tint(t.raised, "55")))
      .text_color(a.focused ? t.foreground : t.muted)
      .hover((s) => s.text_color(t.foreground))
      .on_click(() => run("pane.focus", { pane: a.pane }))
      // Its number (alt-shift-N), under the space's tab count.
      .when(this.agentNum.has(a.address), el => el.child(mono(div()).absolute().left(0).top(0).bottom(0).w(BADGE)
        .flex().items_center().justify_center().text_size(11).text_color(a.focused ? t.foreground : t.dim).child(String(this.agentNum.get(a.address)))))
      // The harness's icon (Claude, Codex, ...): one-colour glyphs take the row's text colour.
      .when(Boolean(a.program?.icon), el => el.child(a.program.tint
        ? svg(a.program.icon).size(13).flex_none()
        : image(a.program.icon).size(13).flex_none()))
      .child(mono(div()).flex_1().min_w(0).truncate().text_size(12).child(name))
      .when(subs.length > 0, el => el.child(this.fold(t, a, subs)))
      .when(Boolean(when), el => el.child(mono(div()).flex_none().text_size(12).text_color(t.dim).child(duration(now - when))))
      .child(this.status(t, a));
  }

  // Each space's agents, in agents() order, and their row names. agent.next and
  // agent.prev follow the order the list shows them in.
  prepareAgents(rows) {
    // What has the keyboard decides which agent is selected.
    // Herdr's own focused stays on the last agent after you leave it (another space, a shell).
    const f = focused();
    const on = (f?.pane ? panes().find(p => p.pane === f.pane)?.terminal : f?.terminal) ?? null;
    let list = agents().map(a => ({ ...a, focused: a.address === on }));
    const now = Date.now();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    this.all = terminals();
    this.track(list, now);
    this.hold(list);
    // Priority (the default): most urgent first (counting its sub-agents), then most recently
    // changed. "order" keeps tab order. The sort button and its menu are in bettr-chrome.
    if (shared("bettr.agentSort") !== "order") {
      const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(this.all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
      const since = (a) => this.changed[a.address]?.at ?? 0;
      list = [...list].sort((x, y) => urgency.get(y.address) - urgency.get(x.address) || since(y) - since(x) || y.seq - x.seq);
    }
    const bySpace = new Map();
    for (const a of list) {
      if (!bySpace.has(a.space)) bySpace.set(a.space, []);
      bySpace.get(a.space).push(a);
    }
    this.bySpace = bySpace;
    const order = rows.flatMap((r) => bySpace.get(r.w.id) ?? []).map((a) => a.address);
    setAgentOrder(order);
    this.agentNum = new Map(order.map((t, i) => [t, i + 1]));
    // Share the shown order so extras' alt-shift-N picks the Nth agent on screen.
    if (JSON.stringify(shared("agents.order")) !== JSON.stringify(order)) setShared("agents.order", order);

    const ps = panes();
    const tabs = spaces().flatMap((s) => s.tabs ?? []);
    const label = (a) => {
      const tab = tabs.find((tab) => tab.id === a.tab);
      return tab ? title(tab, lead(tab, ps)) : a.title || a.program?.name || "";
    };
    const detail = new Map(list.map((a) => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    this.names = new Map(list.map((a) => {
      const more = detail.get(a.address);
      const plain = more ?? (seen[`${a.space}\u0000`] > 1 ? label(a) : a.program?.name || label(a));
      return [a.address, plain];
    }));
  }

  // Looking at a done agent makes it idle; under Priority it keeps its place until
  // you leave it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a) {
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? RANK.done : RANK[a.status] ?? 0;
  }

  // A space's agent rows, each followed by its sub-agents unless folded.
  // Agent text starts where the space's name does: the row's own padding, or
  // after a worktree's indent and branch glyph (row(): px 8, then 22 + 13, gap 9).
  agentRows({ w, tree }, t) {
    const indent = (tree ? 8 + 22 + 13 + 9 : 8) + NUM + BADGE_GAP + BADGE + BADGE_GAP;
    const all = this.all;
    const shown = focused()?.agent;
    const now = Date.now();
    return (this.bySpace.get(w.id) ?? []).flatMap((a) => {
      const subs = this.tree(all, a.address);
      const r = this.agentRow(t, a, subs, now, indent);
      return this.agentFolded.has(a.address) ? [r] : [r, ...subs.map((s) => this.subRow(t, s, shown, indent))];
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Spaces in order, each worktree space moved under its main checkout's. The spaces
  // are moved to match, so space.next, the rail's numbers and dragging follow what shows.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    // Simulate the batch so later indexes include earlier moves. A write can lose a
    // sync conflict: let the echo settle before trying again.
    const order = sp.map(w => w.id);
    const target = out.map(r => r.w.id);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < out.length; i++) {
        const from = order.indexOf(out[i].w.id);
        if (from === i) continue;
        run("space.move", { id: out[i].w.id, index: i + 1 });
        moved.add(out[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    return out.filter(r => this.shown.has(r.w.id));
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t) {
    const rows = this.ordered();
    this.prepareAgents(rows);
    // A gap above each space after the first in its group; a worktree stays with its repo.
    const draw = (r, n) => [this.row(r, t, n > 0), ...this.agentRows(r, t)];
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => div().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(8).text_size(12).text_color(t.dim).child("Loading…");
    if (!remote.length) return loading(null) && !rows.length ? [loadingRow(null)] : rows.flatMap(draw);
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m, n) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const folded = this.folded.has(m);
      // A button in the row (+, Connect) is hovered: the chevron stays grey.
      const sub = (on, cx) => { this.overButton = on; cx.notify(); };
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().when(n > 0, el => el.mt(12)).px(8).gap(7).items_center().text_size(11)
        // Text line boxes as tall as the 11 px text, so the dot, chevron and "+" centre on the letters.
        .line_height("11px").text_color(t.dim)
        // No hover background: the fold chevron turns bright instead.
        .cursor_pointer()
        .on_hover((on, cx) => {
          const key = m ?? "";
          if (on) this.overMachine = key; else if (this.overMachine === key) this.overMachine = null;
          cx.notify();
        })
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .child(mono(div()).min_w(0).truncate().text_color(t.muted).child(m ?? "This computer"))
        // The fold chevron just after the name (3 px closer than the row's gap); it brightens on row hover.
        .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none().ml(-3)
          .when(this.overMachine === (m ?? "") && !this.overButton, el => el.text_color(t.foreground)))
        .child(div().flex_1())
        .when(!connected && !rebuilt, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
        .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
          .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
          .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
            .hover(s => s.text_color(t.foreground)).on_hover(sub)
            .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
            .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
            .child(repair?.busy ? "Connecting…" : "Connect"))))
        .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).hover(s => s.text_color(t.foreground)).on_hover(sub)
          .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
        // Connected or not, at the end of the row (This computer always is). Centred on
        // the agent rows' status dots below: theirs is 7 px with 3 px each side.
        .child(div().size(6).rounded(3).flex_none().mr(3.5).bg(connected ? t.ansi2 : t.dim));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .child(svg("mods/workspace-chrome/plus.svg").size(12)).child("New space there");
      if (rebuilt) return [head];
      return [head, ...(folded ? [] : mine.length ? mine.flatMap(draw) : [loading(m) ? loadingRow(m) : empty])];
    });
  }

  row({ w, i, tree }, t, gap = false) {
    const fromIndex = this.pressed === null ? -1 : spaces().findIndex(s => s.id === this.pressed);
    const colors = shared("space.colors") ?? {};
    const fill = colors[w.id] ?? PALETTE[0];
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .h(SPACE_ROW)
      .when(gap, (el) => el.mt(SPACE_GAP))
      .flex_none()
      .justify_center()
      .rounded(8)
      .cursor_pointer()
      // Each name is in its space's color; the selected space gets a tint of it and a bar on its left.
      .when(w.active, (el) => el.bg(tint(fill, "24")).child(
        div().absolute().left(0).top(8).bottom(8).w(3).rounded(2).bg(fill)))
      .when(!w.active && this.overSpace === w.id, (el) => el.bg(t.hover))
      .when(this.pressed === w.id && this.over !== w.id, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === w.id && this.pressed !== w.id, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(fromIndex < i, line => line.bottom(0))
          .when(fromIndex > i, line => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.pressed = w.id;
        this.over = w.id;
      })
      .on_mouse_move((_e, cx) => {
        const source = spaces().find(s => s.id === this.pressed);
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? w.id : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from !== null && over === w.id && from !== w.id) {
          const index = spaces().findIndex(s => s.id === w.id);
          if (index !== -1) run("space.move", { id: from, index: index + 1 });
        } else if (from === w.id) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .on_hover((on, cx) => {
        if (on) this.overSpace = w.id; else if (this.overSpace === w.id) this.overSpace = null;
        cx.notify();
      })
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), el => el.pl(22).child(svg("mods/workspace-chrome/branch.svg").size(13).text_color(t.dim)))
          // How many tabs, then the name: a solid fill in the space color for the selected space
          // (PALETTE is pastel in every theme, so dark digits), a faint tint of it on hover, solid grey otherwise.
          .child(h_flex().flex_1().min_w(0).gap(BADGE_GAP).items_center()
            .child(mono(div()).flex_none().w(NUM).flex().justify_end().text_size(11).text_color(w.active ? fill : t.dim).child(String(w.index)))
            .child(mono(div()).flex_none().min_w(BADGE).px(2).h(BADGE).flex().items_center().justify_center().rounded(4)
              .bg(w.active ? fill : this.overSpace === w.id ? tint(fill, "33") : t.border).text_size(9).font_black()
              .text_color(w.active ? "#1a1a1a" : this.overSpace === w.id ? fill : t.muted)
              // Line boxes as tall as their text, so the digits and the name centre on the badge's axis.
              .child(div().line_height("9px").child(String((w.tabs ?? []).length))))
            .child(div().min_w(0).truncate().text_size(15).line_height("15px").text_color(fill).when(w.active, (el) => el.font_semibold()).child(w.name))),
      );
  }

  render() {
    const t = theme();
    readFont();
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    // Spaces that are gone, and colors not in PALETTE (from an older version), are dropped.
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {})
      .filter(([id, c]) => ids.has(id) && PALETTE.includes(c)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = PALETTE.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    const list = this.grouped(t);
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(v_flex().flex_1().min_h(0).px(8).pb(14).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .children(list));
  }
}
