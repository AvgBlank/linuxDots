// Workspace spaces: names in stable colors, grouped by machine when more than
// one is known. Each space's agents are listed under it, with their sub-agents.
// Click to switch, right-click for its menu, drag to reorder.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, panes, agents, terminals, focused, setAgentOrder, run, openOverlay, hc, theme, shared, setShared, settings } from "herdr";

// Agent and sub-agent rows are ROW tall. A space row is taller by the difference in text size
// (15 - 12), so the space between the space name and its first agent's text equals the space
// between two agents' texts. A space after the first has SPACE_GAP above it.
const ROW = 26, SPACE_ROW = ROW + 3, SPACE_GAP = 7;
// The tab count before a space's name: a BADGE square (two digits fit; more widen it), then
// BADGE_GAP; agent rows start their names at the same place.
const BADGE = 15, BADGE_GAP = 6;
// The space's number (ctrl-N) before its tab-count badge.
const NUM = 12;
// Where a space's tab count starts: the space row's padding, then its number.
const COUNT_LEFT = 8 + NUM + BADGE_GAP;

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

// Stored JSON, or `fallback` when it is missing or damaged. A full or blocked store loses only the save.
const stored = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; }
};
const store = (key, text) => { try { localStorage.setItem(key, text); } catch {} };
const record = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

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
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.reconnecting = Object.fromEntries(Object.entries(record(stored("machines.reconnecting", {})))
      .filter(([, state]) => record(state) === state));
    for (const state of Object.values(this.reconnecting)) state.busy = false;
    const folded = stored("machines.folded", []);
    this.folded = new Set(Array.isArray(folded) ? folded : []);
    this.agentFolded = new Set(); // agents whose sub-agents are hidden
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = record(stored("changed", {}));
    // Redraw the time each agent has been in its state (minutes).
    cx.timer.every(30000, (cx) => cx.notify());
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code !== 0) return;
        // Asked every 15 s: redraw only when the answer changes.
        const machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary), text = JSON.stringify(machines);
        if (text === this.machinesText) return;
        this.machinesText = text; this.machines = machines;
        cx.notify();
      } catch {}
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
    store("machines.reconnecting", JSON.stringify(this.reconnecting));
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
          store("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        store("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      store("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
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
    store("changed", JSON.stringify(this.changed));
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

  subRow(t, s, shown) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      // The focused background starts at the space's tab count, with the same rounding.
      .ml(COUNT_LEFT)
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
  agentRow(t, a, subs, now) {
    const name = this.names.get(a.address);
    const when = this.changed[a.address]?.at ?? 0;
    return h_flex()
      .id(`ag-${a.address}`)
      .relative()
      // The focused background starts at the space's tab count, with the same rounding.
      .ml(COUNT_LEFT)
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
    // Each agent's live sub-agents, found once per render: the sort and the rows both use them.
    this.subs = new Map(list.map((a) => [a.address, this.tree(this.all, a.address)]));
    // Priority (the default): most urgent first (counting its sub-agents), then most recently
    // changed. "order" keeps tab order. The sort button and its menu are in bettr-chrome.
    if (shared("bettr.agentSort") !== "order") {
      const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.subs.get(a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
      const since = (a) => this.changed[a.address]?.at ?? 0;
      list = [...list].sort((x, y) => urgency.get(y.address) - urgency.get(x.address) || since(y) - since(x) || y.seq - x.seq);
    }
    const bySpace = new Map();
    for (const a of list) {
      if (!bySpace.has(a.space)) bySpace.set(a.space, []);
      bySpace.get(a.space).push(a);
    }
    this.bySpace = bySpace;
    // Sent only when it changes: render runs on each hover and timer tick.
    const order = rows.flatMap((r) => bySpace.get(r.w.id) ?? []).map((a) => a.address);
    if (order.join("\n") !== this.agentOrder) {
      this.agentOrder = order.join("\n");
      setAgentOrder(order);
    }
    this.agentNum = new Map(order.map((t, i) => [t, i + 1]));
    // Share the shown order so extras' alt-shift-N picks the Nth agent on screen.
    if (JSON.stringify(shared("agents.order")) !== JSON.stringify(order)) setShared("agents.order", order);

    const ps = panes();
    const tabs = this.sp.flatMap((s) => s.tabs ?? []);
    const labels = new Map(list.map((a) => {
      const tab = tabs.find((tab) => tab.id === a.tab);
      return [a.address, tab ? title(tab, lead(tab, ps)) : a.title || a.program?.name || ""];
    }));
    const label = (a) => labels.get(a.address);
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
  agentRows({ w }, t) {
    const shown = focused()?.agent;
    const now = Date.now();
    return (this.bySpace.get(w.id) ?? []).flatMap((a) => {
      const subs = this.subs.get(a.address) ?? [];
      const r = this.agentRow(t, a, subs, now);
      return this.agentFolded.has(a.address) ? [r] : [r, ...subs.map((s) => this.subRow(t, s, shown))];
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t) {
    const rows = this.sp.map((w, i) => ({ w, i }));
    this.prepareAgents(rows);
    // A gap above each space after the first in its group.
    const draw = (r, n) => [this.row(r, t, n > 0), ...this.agentRows(r, t)];
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"));
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
          store("machines.folded", JSON.stringify([...this.folded]));
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

  row({ w, i }, t, gap = false) {
    // `this.sp` and `this.colors`: read once per render, not once per row.
    const fromIndex = this.pressed === null ? -1 : this.sp.findIndex(s => s.id === this.pressed);
    const fill = this.colors[w.id] ?? PALETTE[0];
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
        if (this.pressed === null) return; // No drag: nothing to do on a pointer move.
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
          .items_center()
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
    this.sp = sp; this.colors = kept;
    const list = this.grouped(t);
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(v_flex().id("spaces-list").flex_1().min_h(0).px(8).pb(14).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        // The button released outside the list gives no mouse-up here: the pointer's exit ends the drag.
        .on_hover((on, cx) => { if (!on && this.pressed !== null) { this.pressed = null; this.over = null; cx.notify(); } })
        .children(list));
  }
}
