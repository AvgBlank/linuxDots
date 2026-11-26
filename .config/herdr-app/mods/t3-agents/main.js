// Agents in grouped or priority views; a parent reads with its sub-agents (tree.js).
// A viewed done agent stays in Done until left.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { agents, terminals, panes, spaces, focused, theme, layout, shared, setShared, setAgentOrder, settings, openOverlay, closeOverlay, props, nextCommand, window } from "herdr";
import { descendants, notNews, ownStatus, subAgents, treeStatus } from "./tree.js";
import { stopsInit, stopsEnd, focusRoot, enter } from "./focus.js";
import { trigger, hang } from "./trigger.js";
import { menuKeys, litOnHover, litProp, propsLit } from "./list.js";
import { MOTION, planMotion, flying, leavingRows } from "./motion.js";
import { agentEntries, agentStatus, STACK, RANK, SECTION } from "./rows.js";
import { sidebarParts } from "./sidebar.js";
import { KEY, closedKey, readLocal } from "./store.js";
import { prunePins, setPinned } from "./pins.js";

// Herdr's own focused stays on the last agent after you leave it (another space, a shell): what has the keyboard decides.
function withKeyboardFocus(list) {
  const f = focused();
  const on = (f?.pane ? panes().find(p => p.pane === f.pane)?.terminal : f?.terminal) ?? null;
  return list.map(a => ({ ...a, focused: a.address === on }));
}
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];

const SORT_WIDTH = 200;
// Past this many rows the list is windowed (render); before its first measure it draws this tall, and two rows past each end.
const WINDOW_AT = 50, FIRST_H = 800, OVERDRAW = 74;

function revealVisible({ rail, stack } = sidebarParts(layout())) {
  return window()?.active !== false && !rail?.hidden && !stack?.hidden && stack?.active !== "inbox";
}

export default class Agents extends View {
  async close() {
    if (props()?.sortMenu) setShared(closedKey("t3-agents", "sort"), Date.now());
    this.cancelReveal();
    this.listScroll?.release();
    this.listScroll = null;
    stopsEnd(this);
  }

  init(_props, cx) {
    if (props()?.sortMenu) {
      // It takes the keyboard, as the shipped menu does. As T3's menus: nothing's lit until a key or the pointer arrives, and it fades in.
      this.at = propsLit();
      this.keys = cx.focus_handle();
      this.keys.focus();
      cx.timer.after(16, (cx) => { this.shown = true; cx.notify(); });
      return;
    }
    stopsInit(this, cx);
    this.listScroll = ScrollHandle.new();
    // pane.go onto this list (mod.json's "focusable"): the keyboard starts at the heading's button.
    cx.spawn(async (cx) => {
      for (;;) if (await nextCommand() === "focus") enter(this, cx, "ag-sort");
    });
    this.folded = readLocal("folded", {});
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = readLocal("changes", {});
    // Behind the Inbox nothing is drawn or published, so nothing is sorted or grouped: only what outlives the tick is kept.
    cx.timer.every(1000, () => {
      const parts = sidebarParts(layout());
      if (parts.stack?.active !== "inbox") return this.compute(parts);
      this.observe();
      this.agentOrder = null;
    });
    cx.timer.every(30000, (cx) => { if (revealVisible()) cx.notify(); }); // The rows' times move with nothing else changing.
    // Older installs kept pins in this list's storage; move them over once, before the inbox writes any.
    if (shared(KEY.pins) == null && localStorage.getItem("pins")) {
      const legacy = readLocal("pins", null);
      if (Array.isArray(legacy)) setPinned(legacy);
    }
  }

  cancelReveal() {
    this.revealTimer?.cancel();
    this.revealTimer = null;
    this.reveal = null;
  }

  requestReveal(key, cx) {
    this.cancelReveal();
    if (!key) return;
    const request = this.reveal = { key, ready: false };
    this.revealTimer = cx.timer.after(0, (cx) => {
      if (this.reveal !== request) return;
      this.revealTimer = null;
      if (!revealVisible()) { this.cancelReveal(); return; }
      request.ready = true;
      cx.notify();
    });
  }

  isFolded(id, initial = true) {
    return this.folded[id] ?? initial;
  }

  toggleFold(id, cx, initial = true) {
    this.folded[id] = !this.isFolded(id, initial);
    localStorage.setItem("folded", JSON.stringify(this.folded));
    cx.notify();
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, sp, now) {
    let dirty = false;
    // As the tab has it: this list doesn't draw while the Inbox shows, so a frame's time would be when it came back.
    const changedAt = new Map(sp.flatMap((s) => s.tabs ?? []).map((c) => [c.id, c.changed_at]));
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: changedAt.get(a.tab) ?? now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changes", JSON.stringify(this.changed));
  }

  // Drops pins and fold choices of agents that ended. Only for machines the list has heard from:
  // right after a start, or while a machine connects, its agents aren't listed yet.
  prune(all) {
    const kept = prunePins(all);
    const machine = (addr) => (addr.includes("/") ? addr.split("/")[0] : "");
    const heard = new Set(all.map((k) => machine(k.address)));
    const live = new Set(all.filter((k) => k.state === "live").map((k) => k.address));
    // Group headers (sp-…, sec-…, pinned) fold under the same store; only agents' entries end.
    const ended = Object.keys(this.folded).filter((k) => !/^(sp-|sec-|pinned$)/.test(k) && heard.has(machine(k)) && !live.has(k));
    for (const k of ended) delete this.folded[k];
    if (ended.length) localStorage.setItem("folded", JSON.stringify(this.folded));
    return kept;
  }

  // Looking at a done agent makes it idle; it stays with Done until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    // Arriving, or any change but done turning idle, sets what it was.
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  word(a) {
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? "done" : a.status;
  }

  sortMenu(t) {
    const on = sortOf().id;
    const choose = (s) => {
      setShared("agents.sort", s.id);
      closeOverlay(props().overlay);
    };
    return v_flex()
      .id("sort-menu")
      .w_full()
      .p(4)
      .bg(t.popover)
      .text_size(14)
      .opacity(this.shown ? 1 : 0).transition("opacity", MOTION)
      .track_focus(this.keys).on_key_down(menuKeys(this, SORTS.map((s) => s.label), (at) => choose(SORTS[at])))
      .child(div().px(8).py(6).text_size(12).line_height("16px").font_medium().text_color(t.muted).child("Sort agents"))
      .children(SORTS.map((s, i) => h_flex()
        .id(`sort-${s.id}`)
        .h(28)
        .px(8)
        .gap(8)
        .rounded(4)
        .items_center()
        .text_color(t.foreground)
        .role("button").accessibility_label(s.label)
        .when(i === this.at, el => el.bg(t.selected))
        .on_hover(litOnHover(this, "at", i))
        .on_click(() => choose(s))
        .child(svg(`mods/t3-agents/icons/${s.icon}.svg`).size(16).mx(-2).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/t3-agents/icons/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  status(t, a, note = "", id) {
    return agentStatus(this, t, a, note, id);
  }

  // What every look owes, drawn or not: each agent's history, the done being read, and ended agents' pins and folds dropped.
  observe() {
    const every = agents(), all = terminals(), sp = spaces(), now = Date.now();
    const pins = this.prune(all);
    this.track(every, sp, now);
    this.hold(every);
    return { every, all, sp, now, pins };
  }

  // `parts`: where the sidebar is, read once a look (layout() copies the whole tree).
  compute(parts = sidebarParts(layout())) {
    const sort = sortOf(), observed = this.observe(), { all, sp, now, pins } = observed, f = focused(), ps = panes(), pinSet = new Set(pins);
    const every = withKeyboardFocus(observed.every);
    const listed = new Map(every.map((a) => [a.address, a.status]));
    // Herdr's chosen agent (f.agent) stays set while a shell has the keyboard, so what's focused counts: the agent
    // withKeyboardFocus found, else the focused terminal. f.agent still counts as one of that agent's own
    // sub-agents (a peek), lit with its parent; a stale one elsewhere doesn't.
    const mine = every.find((a) => a.focused)?.address;
    const peeked = mine && f?.agent && f.agent !== mine && descendants(all, mine).some((k) => k.address === f.agent);
    // A mod pane (no terminal) stands for the agent beside it in its tab, as before.
    const beside = f?.pane && !f.terminal ? (every.some((a) => a.tab === f.tab && a.address === f.agent) ? f.agent : null) : f?.terminal;
    const shown = peeked ? f.agent : mine ?? beside ?? null;
    // A kept sub-agent (one with a pane) is in agents() too: under its parent it gets no row of its own, unless pinned, as Herdr's list (#539).
    const nested = new Set(every.flatMap((a) => descendants(all, a.address).map((k) => k.address)));
    const list = every.filter((a) => pinSet.has(a.address) || !nested.has(a.address));
    const top = new Set(list.map((a) => a.address)), byAddress = new Map(all.map((k) => [k.address, k]));
    // A sub-agent folded away from view lights its nearest listed ancestor, as T3's resolveSidebarRowThreadId does.
    const ancestor = (() => {
      const seen = new Set();
      let address = shown;
      while (address && !top.has(address) && !seen.has(address)) { seen.add(address); address = byAddress.get(address)?.parent; }
      return top.has(address) ? address : null;
    })();
    const byPriority = sort.id === "priority";
    // A kept sub-agent's word is still agents()' for its parent's tree.
    const under = subAgents(every, all);
    const facts = new Map(list.map((a) => {
      const address = a.address, kids = under(address), own = ownStatus(a.status, address, all);
      const s = treeStatus(own, kids);
      // Quiet labels drop only the dot. Reading Done does not move this row until you leave it.
      const status = s === "done" && notNews(byAddress.get(address), own, kids) ? "idle" : s;
      const rank = RANK[treeStatus(ownStatus(this.word(a), address, all), kids)] ?? 0;
      return [address, { own, status, rank, since: this.changed[address]?.at ?? 0,
        pinned: pinSet.has(address), viewed: a.focused || (address === ancestor && this.isFolded(address)) }];
    }));
    const pinned = pins.map((p) => list.find((a) => a.address === p)).filter(Boolean);
    const rest = list.filter((a) => !pinSet.has(a.address));
    const of = (a) => facts.get(a.address);
    if (byPriority) rest.sort((x, y) => of(y).rank - of(x).rank || of(y).since - of(x).since || y.seq - x.seq);
    const groups = /** @type {any[]} */ (pinned.length ? [{ id: "pinned", label: "Pinned", members: pinned }] : []);
    for (const a of rest) {
      const r = of(a).rank || RANK.idle;
      const id = byPriority ? `sec-${r}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({ id, label: byPriority ? SECTION[r] : a.space_name || "", space: byPriority ? null : a.space, members: [a] });
    }
    // Every top-level agent, in its group or not. A sub-agent with no pane can only open as a peek, a popup over the work. A folded group
    // counts: Idle folds by default, and leaving a row there would take it off the walk, with no key back.
    const ordered = groups.flatMap(g => g.members), order = [...new Set(ordered.map(a => a.address))];
    this.publishRows({ order, view: ancestor }, parts);
    return { sort, list: ordered, all, shown, ancestor, ps, sp, now, byPriority, facts, listed, groups, parts };
  }

  publishRows(drawn, parts) {
    if (parts.stack?.active !== "inbox") {
      if (JSON.stringify(drawn) !== JSON.stringify(shared(KEY.agentsRows) ?? null)) setShared(KEY.agentsRows, drawn);
      const key = JSON.stringify(drawn.order);
      if (key !== this.agentOrder || shared(KEY.agentOrder) !== "lists") {
        this.agentOrder = key;
        setAgentOrder(drawn.order);
        if (shared(KEY.agentOrder) !== "lists") setShared(KEY.agentOrder, "lists");
      }
    } else this.agentOrder = null;
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    const data = this.compute();
    const { sort, list } = data;
    const entries = agentEntries(this, t, data);

    // The list's motion, as t3-inbox's and T3's (Sidebar.motion.ts). Folds and the sort play it too: T3 skips only a bottom shelf's
    // opening (Sidebar.tsx), and this list starts at the top.
    planMotion(this, entries, cx);
    // A row no longer drawn has no hover listener, so it never reports the pointer leaving it: forget it, or its card comes back with it.
    const gone = this.hovered;
    if (gone && !entries.some((e) => e.key === gone)) {
      this.hovered = this.hot = null;
      /** @type {any} */ (this).detailsWait?.cancel();
      if (this.details === gone) this.details = null;
      if (this.detailsOut === gone) this.detailsOut = null;
    }
    const target = (data.shown && entries.some((e) => e.key === `sub-${data.shown}`) ? `sub-${data.shown}`
      : data.shown && entries.some((e) => e.key === data.shown) ? data.shown
      : data.ancestor && entries.some((e) => e.key === data.ancestor) ? data.ancestor : null);
    if (!revealVisible(data.parts)) this.cancelReveal();
    else if (this.inView !== undefined && target !== this.inView) this.requestReveal(target === this.hovered ? null : target, cx);
    this.inView = target;
    if (this.reveal && (!target || this.reveal.key !== target || this.hovered === target)) this.cancelReveal();
    // A long list draws only the rows in view, scrolled by the wheel (windowed). shortcut: windowed, Tab reaches only the rows drawn;
    // switch to a host virtual list when its rows can hold handlers.
    const windowed = entries.length > WINDOW_AT;
    const z = Number(settings()?.zoom) || 1, at = /** @type {any} */ (this).motion.at, total = entries.reduce((sum, e) => sum + e.h, 0);
    const seen = this.listH ?? FIRST_H;
    if (windowed && this.reveal?.ready) {
      const box = at.get(target);
      this.cancelReveal();
      if (box) {
        const cur = this.listTop ?? 0;
        if (box.y < cur) this.listTop = box.y;
        else if (box.y + box.h > cur + seen) this.listTop = Math.max(0, box.y + box.h - seen);
      }
    }
    const top = this.listTop = windowed ? Math.max(0, Math.min(this.listTop ?? 0, total - seen)) : 0;
    const exits = leavingRows(this, windowed ? top : 0);
    if (!windowed && this.reveal?.ready) {
      const rowAt = entries.findIndex((e) => e.key === target);
      this.cancelReveal();
      if (rowAt >= 0 && this.listScroll) this.listScroll.scroll_to_item(exits.length + rowAt);
    }
    const rows = windowed
      ? entries.filter((e) => at.get(e.key).y + e.h > top - OVERDRAW && at.get(e.key).y < top + seen + OVERDRAW)
        .map((e) => div().absolute().left(0).right(0).top(at.get(e.key).y - top).child(flying(this, e.key, e.el())))
      : entries.map((e) => flying(this, e.key, e.el()));

    return focusRoot(this, v_flex()
      .id("t3-agents-root")
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(14)
      .child(
          h_flex()
            .id("agents-heading")
            .pl(18).pr(8)
            .h(31)
            .flex_none()
            .items_center()
            .justify_between()
            .child(div().text_size(12).font_medium().text_color(t.muted).child("Agents"))
            .child(
              // Hung from the button, right edges together, as T3's menus. No press (the keyboard), the app's default.
              trigger(this, t, "ag-sort", { icon: `mods/t3-agents/icons/${sort.icon}.svg`, label: `Sort agents: ${sort.label}`, closed: closedKey("t3-agents", "sort"),
                onOpen: (b) => { openOverlay({ mod: "t3-agents", kind: "popup", width: SORT_WIDTH, height: 140, ...hang(b, SORT_WIDTH), props: { sortMenu: true, ...litProp(!b) } }); } }),
            ),
      )
      .when(list.length === 0, (el) =>
        el.child(div().px(16).py(24).text_center().text_size(12).line_height("16px").text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .when(!windowed, (el) => el.child(v_flex().id("ag-list").flex_1().min_h(0).px(8).pb(8)
        // The rows in one box that scrolls, so the leaving ones placed in it scroll with them.
        .child(v_flex().id("ag-content").relative().w_full().flex_1().min_h(0).gap(STACK).overflow_y_scroll()
          .when(Boolean(this.listScroll), (c) => c.track_scroll(this.listScroll))
          .on_scroll_wheel(() => this.cancelReveal())
          .children(exits).children(rows))))
      .when(windowed, (el) => el.child(v_flex().id("ag-list").flex_1().min_h(0).px(8).pb(8)
        .child(div().id("ag-window").relative().size_full().overflow_hidden()
          .on_size_change((size, cx) => { const h = size.height / z; if (h !== this.listH) { this.listH = h; cx.notify(); } })
          .on_scroll_wheel((e, cx) => {
            cx.stop_propagation();
            this.cancelReveal();
            const next = Math.max(0, Math.min(top - e.delta.y / z, total - seen));
            if (next !== top) { this.listTop = next; cx.notify(); }
          })
          .children(exits).children(rows)))));
  }
}
