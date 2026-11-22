import { View, div, svg } from "gpui-kit";
import { h_flex, Popup } from "gpui-base";
import { spaces, panes, agents, terminals, run, openOverlay, focused, hc, notify, theme, window, layout, settings, props, shared, setShared, nextCommand, appHome, readTextFile, writeTextFile } from "herdr";
import { modStatus, namer, programOf } from "./name.js";
import { notNews, ownStatus, stillSettled, subAgents, treeStatus } from "./tree.js";
import { tip, glow } from "./tip.js";
import { detailsFor, detailsAt, detailsWatch } from "./details.js";
import { programIcon } from "./program.js";
import { focusAgent } from "./zoom.js";
import { stopsInit, stopsEnd, stop, focusRoot, within } from "./focus.js";
import { sidebarParts } from "./sidebar.js";
import { navigation } from "./navigation.js";
import { projectMark, newTab } from "./project.js";

// The tab bar under the panes (tmux style, the focus layout's tabs-row after work-body): its tooltips and menus open upward.
const findNode = (n, id) => n?.id === id ? n : (n?.children ?? []).map((c) => findNode(c, id)).find(Boolean) ?? null;
const barAtBottom = () => { const ids = (findNode(layout(), "work")?.children ?? []).map((c) => c.id); return ids.indexOf("tabs-row") > ids.indexOf("work-body"); };
// macOS's window buttons over the panes' top-left: the bar at the bottom, and the sidebar, whose brand row holds them, hidden.
// Then the gap above the panes is a 40px strip for them, with the sidebar toggle beside them.
const lightsStrip = () => {
  const w = window(), root = layout();
  return barAtBottom() && w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && Boolean(root?.traffic_lights) && Boolean(sidebarParts(root).rail?.hidden);
};

const inboxShown = () => sidebarParts(layout()).stack?.active === "inbox";

// What the hidden sidebar's toggle counts. An agent settled there isn't news while it
// stays settled. A snoozed one, until it wakes, isn't news either, working or done; while it or what's under it needs the
// person it shows there, so it counts here too.
function awake(st, under) {
  const now = Date.now(), byAddress = new Map(terminals().map((k) => [k.address, k]));
  return agents().filter((a) => {
    const k = byAddress.get(a.address);
    return st(a) === "blocked" || (!stillSettled(k, a.status, under(a.address)) && !(Number(k?.labels?.snoozed) > now));
  });
}

// "Needs you", drawn as the agents list and pane headers draw it.
const blockedMark = (t) => div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(11).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
const mark = (t, s) => s === "working" ? svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)
  : s === "blocked" ? blockedMark(t)
  : div().size(6).flex_none().rounded_full().bg(t.done);

const WORDS = { working: "Working", blocked: "Needs you", done: "Done" };
const TAB_GAP = 4;
// A tab's name gives way to T3's 144px at most, the active one's to 240px; past that the strip scrolls.
// Unlike T3's, a tab is 96px at least: a short name (`Pi`) left one too small to aim at, and 200px at most, room or not.
const TAB_FLOOR = 144, TAB_ACTIVE = 240, TAB_MIN = 96, TAB_MAX = 200;
// A tab around its name: padding, the icon's slot, the gaps and the slot its status mark and × share.
const TAB_CHROME = 51;

// The widest a tab may be for `wants` to fill `room`: the shorter keep all they want, the longest share what's left.
function fairCap(wants, room) {
  const sorted = [...wants].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    const share = room / (sorted.length - i);
    if (sorted[i] > share) return share;
    room -= sorted[i];
  }
  return Infinity;
}

const lit = (view, id, color = theme().dim) => (view.hot === id ? theme().foreground : color);

// A tab nobody named reads as its lead pane: the agent in it, else the focused one.
const leadOf = (mine) => mine.find(p => p.status != null) ?? mine.find(p => p.focused) ?? mine[0];
const nameOf = (c, lead, name) => c.named ? c.name : lead ? name(lead) : "Terminal";

// The T3 pane header, as the layout has it in a split (syncHeader).
const PANE_HEADER = { content: { mod: "t3-pane" }, reveal: "always", height: 28, position: "top" };

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    this.over = null;
    this.strip = 0;
    this.nameW = {};
    this.navigation = navigation((cx) => {
      this.overTab = this.hot = null;
      detailsFor(this, null, cx);
      cx.notify();
    });
    this.dragKeys = cx.focus_handle();
    stopsInit(this, cx); // the measure copy too: it draws the sidebar toggle in the strip above the panes
    // Only the tab strip's copy answers every person's way to close: the layout's other parts would each open a dialog.
    if (!props()?.part) cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        // One at a time: a second press finds the first's pane gone.
        // Here because the tab bar always shows; the brand bar goes with the sidebar.
        if (command === "sidebar") run("layout.select", { stack: "sidebar-lists", child: inboxShown() ? "lists" : "inbox" });
        else if (command === "settle") await this.settle(cx);
        else if (command.startsWith("unpin:")) this.unpin(command.slice("unpin:".length), cx);
        else if (command === "undo") await this.undo();
        else await this.navigation.handle(command, cx);
      }
    });
  }

  async writeLabel(address, key, value, quiet = false) {
    const r = await hc(["label", address, `${key}=${value}`]).catch(e => ({ code: 1, stderr: String(e) }));
    if (r.code === 0) return true;
    if (!quiet) notify({ title: "Couldn't update the agent", body: r.stderr.trim(), level: "error" });
    return false;
  }

  async settle(cx) {
    if (this.navigation.atHome) return;
    const f = { ...focused() }, ps = panes(), p = ps.find(p => p.pane === f.pane), every = agents(), all = terminals();
    if (p?.mod && programOf(p)?.inbox) {
      if (!["working", "blocked"].includes(modStatus(p))) await this.navigation.handle(`close-pane-now:${p.pane}`, cx);
      return;
    }
    const byAddress = new Map(all.map(k => [k.address, k]));
    let address = f?.pane && !f.terminal ? (every.find(a => a.tab === f.tab && a.address === f.agent) ?? every.find(a => a.tab === f.tab))?.address
      : f?.terminal ?? f?.agent ?? every.find(a => a.focused)?.address;
    const seen = new Set();
    while (address && !every.some(a => a.address === address) && !seen.has(address)) { seen.add(address); address = byAddress.get(address)?.parent; }
    const a = every.find(a => a.address === address), k = byAddress.get(address);
    if (!a) return;
    const kids = subAgents(every, all)(address), own = ownStatus(a.status, address, all);
    if ([own, ...kids].some(s => s === "working" || s === "blocked")) return;
    if (stillSettled(k, own, kids)) {
      if (await this.writeLabel(address, "settled", "")) {
        // Kept for live terminals only, so the record doesn't grow with every agent ever brought back.
        const unsettled = Object.fromEntries(Object.entries(shared("t3-inbox.unsettled") ?? {}).filter(([at]) => all.some(t => t.address === at)));
        setShared("t3-inbox.unsettled", { ...unsettled, [address]: Math.max(Date.now(), (unsettled[address] ?? 0) + 1) });
      }
      return;
    }
    const snoozed = k?.labels?.snoozed ?? "";
    if (!await this.writeLabel(address, "settled", `${Date.now()}:${k?.turn ?? 0}`)) return;
    if (snoozed) await this.writeLabel(address, "snoozed", "");
    const pins = shared("agents.pins") ?? [];
    if (pins.includes(address)) setShared("agents.pins", pins.filter(p => p !== address));
    this.remember("Settled", { address, snoozed, pins }, cx);
    const current = focused();
    if (["space", "tab", "pane", "terminal", "agent"].every(key => current?.[key] === f[key])) run("t3-tabs.home");
  }

  unpin(address, cx) {
    const pins = shared("agents.pins") ?? [];
    if (!pins.includes(address)) return;
    setShared("agents.pins", pins.filter(p => p !== address));
    this.remember("Unpinned", { address, pins }, cx);
  }

  remember(action, undo, cx) {
    const old = shared("t3-inbox.notice"), now = Date.now();
    const joined = old?.owner === "tabs" && old.action === action && old.live && now - old.at < 5000;
    const n = { owner: "tabs", action, count: (joined ? old.count : 0) + 1, gen: (old?.gen ?? 0) + 1,
      live: true, shown: joined, at: now, undos: [...(joined ? old.undos : []), undo] };
    setShared("t3-inbox.notice", n);
    const update = (change) => {
      const current = shared("t3-inbox.notice");
      if (current?.owner === "tabs" && current.gen === n.gen && current.at === n.at) setShared("t3-inbox.notice", change && { ...current, ...change });
    };
    if (!joined) cx.timer.after(16, () => update({ shown: true }));
    cx.timer.after(5000, () => update({ live: false, shown: false }));
    cx.timer.after(5250, () => update(null));
  }

  async undo() {
    const n = shared("t3-inbox.notice");
    if (!n?.live || Date.now() - n.at >= 5000) return;
    if (n.owner !== "tabs") {
      setShared("t3-inbox.undo", { gen: n.gen, at: n.at, requestedAt: Date.now(), request: (shared("t3-inbox.undo")?.request ?? 0) + 1 });
      return;
    }
    // Gone while the writes run, so a second press can't repeat them; back with what failed, so it can be tried again.
    setShared("t3-inbox.notice", null);
    let back;
    const failed = [];
    for (const u of [...n.undos].reverse()) {
      if (n.action !== "Unpinned") {
        if (!await this.writeLabel(u.address, "settled", "")) { failed.unshift(u); continue; }
        back = u.address;
        if (Number(u.snoozed) > Date.now()) await this.writeLabel(u.address, "snoozed", u.snoozed);
      }
      const pins = [...(shared("agents.pins") ?? [])];
      if (u.pins.includes(u.address) && !pins.includes(u.address)) {
        const next = u.pins.slice(u.pins.indexOf(u.address) + 1).find(p => pins.includes(p));
        pins.splice(next ? pins.indexOf(next) : pins.length, 0, u.address);
        setShared("agents.pins", pins);
      }
    }
    if (failed.length) setShared("t3-inbox.notice", { ...n, count: failed.length, undos: failed });
    if (back && this.navigation.atHome) focusAgent(back);
  }

  // Each tab's width: its whole name while the room allows, else the longest names give way first.
  tabWidths(shown, want) {
    const room = (this.room ?? 0) - TAB_GAP * (shown.length - 1), active = shown.find(c => c.active);
    let cap = fairCap(shown.map(want), room), held = active && want(active);
    if (active && held > cap) {
      held = Math.min(held, Math.max(cap, TAB_ACTIVE));
      cap = fairCap(shown.filter(c => c !== active).map(want), room - held);
    }
    return new Map(shown.map(c => [c.id, c === active ? held : Math.min(want(c), Math.max(cap, TAB_FLOOR))]));
  }

  // Where the tab strip sits: the active tab in view with the least move, as T3's scrollIntoView({ inline: "nearest" }).
  // Herdr's scroll areas can't be moved from a script, so the strip is a clipped row this offsets itself.
  // Only when the active tab or the room changes: a swipe to another tab isn't pulled back.
  stripAt(shown, widths) {
    // The tab the keyboard's on, else the active one: a stop off the strip's end can't be seen.
    const walked = shown.findIndex(c => within(this, [`tab-${c.id}`, `close-${c.id}`]));
    const room = this.room ?? 0, i = walked >= 0 ? walked : shown.findIndex(c => c.active), width = (c) => widths.get(c.id);
    const key = `${shown[i]?.id}:${i}:${room}:${i >= 0 ? width(shown[i]) : 0}`;
    if (i >= 0 && room > 0 && key !== this.revealed && shown.every(c => this.nameW[c.id])) {
      this.revealed = key;
      const left = shown.slice(0, i).reduce((sum, c) => sum + width(c) + TAB_GAP, 0), right = left + width(shown[i]);
      if (left < this.strip) this.strip = left;
      // Wider than the room, its start shows: that's where its icon and the name begin.
      else if (right > this.strip + room) this.strip = Math.min(left, right - room);
    }
    const all = shown.reduce((sum, c) => sum + width(c) + TAB_GAP, -TAB_GAP);
    this.strip = Math.max(0, Math.min(this.strip, all - room));
    return this.strip;
  }

  // With the sidebar hidden, its toggle also says how the agents are doing, with the sidebar's own marks.
  // Idle agents aren't counted: nothing to look at.
  sidebarToggle(t, stopPress, live, st, below = !barAtBottom()) {
    const counts = ["blocked", "working", "done"].map(s => [s, live.filter(a => st(a) === s).length]).filter(([, n]) => n > 0);
    const words = { blocked: "needing you", working: "working", done: "done" };
    const summary = counts.map(([s, n]) => `${n} ${words[s]}`).join(" · ");
    return tip(this, t, "sidebar-toggle", "Show sidebar", stop(this, t, "sidebar-toggle", h_flex().id("sidebar-toggle").h(28).px(6).mr(8).gap(8).flex_none().items_center().rounded(8)
      .text_size(12).text_color(lit(this, "sidebar-toggle")).hover(s => s.bg(t.hover)).on_hover(glow(this, "sidebar-toggle"))
      .role("button").accessibility_label(summary ? `Show sidebar, ${summary}` : "Show sidebar")
      // It goes when the sidebar shows, before the pointer can report leaving it.
      .on_mouse_down("left", stopPress).on_click(() => { this.hot = null; run("layout.toggle", { id: "sidebar" }); })
      .child(svg("mods/t3-tabs/icons/panel-left.svg").size(16).flex_none())
      .children(counts.map(([s, n]) => h_flex().id(`agents-${s}`).gap(4).items_center().child(mark(t, s)).child(div().text_color(t.muted).child(String(n))))), 8), { action: "layout.toggle:sidebar", below });
  }

  // With props.block, sizes that block to `size`: layout.resize, which Herdr keeps with the layout's clicks.
  // on_size_change reports zoomed pixels; a layout's are logical.
  fit(size) {
    const id = props()?.block, px = Math.ceil(size.width / (Number(settings()?.zoom) || 1));
    if (!id || px === this.fitted) return;
    this.fitted = px;
    run("layout.resize", { id, px });
  }

  // Another layout's bar shouldn't stay compact because this one was narrow when it went.
  async close() {
    stopsEnd(this);
    if (props()?.part === "measure") setShared("bar.compact", false);
  }

  endDrag() {
    const moved = this.over !== null;
    this.pressed = this.over = null;
    const back = moved ? focused() : null;
    if (back?.pane) run("pane.focus", { pane: back.pane });
    else if (back?.terminal) run("pane.focus", { terminal: back.terminal });
  }

  // Pane headers in splits only. Herdr's header is one setting for the whole layout, so the layout file gains or
  // loses it as the tab shown does: a direct file edit, which keeps the layout's saved clicks (layout.set drops them).
  syncHeader(cx) {
    if (props()?.part || shared("layout") !== "focus" || this.headerBusy) return;
    const tab = spaces().find(s => s.active)?.tabs.find(c => c.active);
    if (!tab) return;
    const want = panes().filter(p => p.tab === tab.id).length > 1;
    if (want === this.headerOn) return;
    this.headerBusy = true;
    cx.spawn(async (cx) => {
      try {
        const path = `${appHome()}/layouts/focus.json`, text = await readTextFile(path), doc = JSON.parse(text);
        const find = (n) => n.id === "main" ? n : (n.children ?? []).map(find).find(Boolean);
        const pane = find(doc)?.content?.pane;
        if (pane && Boolean(pane.header) !== want) {
          if (want) pane.header = PANE_HEADER; else delete pane.header;
          await writeTextFile(path, JSON.stringify(doc, null, 1) + "\n", text);
        }
        this.headerOn = want;
      } catch (e) { console.log(`t3-tabs header: ${e}`); await cx.sleep(2000); }
      this.headerBusy = false;
      cx.notify();
    });
  }

  // The bar at the bottom leaves macOS's window buttons over the panes' top-left. With the sidebar (whose brand row holds
  // them) hidden, the gap above the panes grows to the old top bar's 40, so they sit where they always did; else 8.
  // A resize, saved as a drag is: the layout file stays as it is.
  syncTopGap() {
    if (props()?.part || shared("layout") !== "focus") return;
    const px = lightsStrip() ? 40 : 8;
    if (px === this.topGap) return;
    this.topGap = px;
    run("layout.resize", { id: "work-top", px });
  }

  render(cx) {
    this.syncHeader(cx);
    this.syncTopGap();
    // The work column's width, in a strip the bar's controls can't change: measured in the bar, their collapsing would undo itself.
    // on_size_change reports zoomed pixels. Past T3's 768 for the same controls: here they share the row with the tabs.
    if (props()?.part === "measure") {
      const strip = lightsStrip(), root = layout();
      const every = strip ? agents() : [], all = strip ? terminals() : [], under = subAgents(every, all);
      const st = (a) => treeStatus(ownStatus(a.status, a.address, all), under(a.address));
      return h_flex().id("bar-measure").size_full().items_center()
        .on_size_change((size) => setShared("bar.compact", size.width / (Number(settings()?.zoom) || 1) < 1024))
        .when(strip, el => el.pl((root.traffic_lights[0] + 64) / settings().zoom)
          .child(this.sidebarToggle(theme(), (_e, cx) => cx.stop_propagation(), awake(st, under), st, true)));
    }
    const t = theme(), w = window();
    const stopPress = (_e, cx) => cx.stop_propagation();
    // 24 as T3's tab bar +; the window's own buttons 28, as its titlebar controls.
    const button = (id, glyph, label, action, key, size = 24) => tip(this, t, id, label, stop(this, t, id, div().id(id).size(size).flex_none().flex().items_center().justify_center().rounded(8).text_color(lit(this, id)).hover(s => s.bg(t.hover)).on_hover(glow(this, id))
      .role("button").accessibility_label(label)
      .on_mouse_down("left", stopPress).on_click(action).child(glyph), 8), { action: key, below: !barAtBottom() });
    // The bar's end, a block of its own after the controls other mods put in the bar (Actions, Review): + keeps its spot
    // however wide they are, and the window's own buttons stay last.
    if (props()?.part === "end") return focusRoot(this, h_flex().size_full().items_center().justify_end().bg(t.chrome)
      .child(h_flex().id("tabs-end").flex_none().pr(12).gap(4).items_center().on_size_change((size) => this.fit(size))
        .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/t3-tabs/icons/win-min.svg").size(16) : "−", "Minimize", () => run("window.minimize"), undefined, 28))
          .child(button("maximize", w.platform === "windows" ? svg(`mods/t3-tabs/icons/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", w.maximized ? "Restore" : "Maximize", () => run("window.maximize"), undefined, 28))
          .child(button("close-window", w.platform === "windows" ? svg("mods/t3-tabs/icons/win-close.svg").size(16) : svg("mods/t3-tabs/icons/x.svg").size(16), "Close window", () => run("window.close"), undefined, 28)))));
    const space = spaces().find(p => p.active);
    // At Home, none: the brand bar's lit mark tells where this is.
    const { tabs: shown } = this.navigation.frame(!props()?.part), inbox = inboxShown();
    // A tab that goes under the pointer reports no leaving, and a lit × would keep every tab's card away.
    if (this.hot?.startsWith("close-") && !shown.some(c => this.hot === `close-${c.id}`)) this.hot = null;
    // Each agent with its sub-agents (tree.js).
    const every = agents(), all = terminals(), under = subAgents(every, all);
    const st = (a) => treeStatus(ownStatus(a.status, a.address, all), under(a.address));
    const ps = panes(), tabName = namer();
    // The tab's most urgent agent, ranked as the app ranks tabs; a done one only while it's still news.
    const statusOf = (c) => {
      const words = [...every.filter(a => a.tab === c.id).map(a => st(a) === "done" && notNews(all.find(k => k.address === a.address), a.status, under(a.address)) ? "idle" : st(a)), ...ps.filter(p => p.tab === c.id && p.mod).map(p => modStatus(p))];
      return words.includes("blocked") ? "blocked"
        : words.includes("done") ? "done"
        : words.includes("working") ? "working" : null;
    };
    const widths = this.tabWidths(shown, (c) => this.nameW[c.id] ? Math.min(TAB_MAX, Math.max(TAB_MIN, Math.ceil(this.nameW[c.id]) + TAB_CHROME)) : TAB_FLOOR);
    // With the Inbox showing, agents' tabs hold their place at the front: only the rest drag, among themselves.
    const loose = (c) => !inbox || !every.some(a => a.tab === c.id);
    // A press holds a tab's id: an agent starting or a tab closing can change the bar under it.
    const pressedAt = shown.findIndex(c => c.id === this.pressed);
    const item = (c, i) => {
      const mine = ps.filter(p => p.tab === c.id), lead = leadOf(mine);
      const program = lead && programOf(lead);
      const name = nameOf(c, lead, tabName);
      // With the Inbox showing, what needs the person is the sidebar's to say, shown or hidden.
      const status = inbox ? null : statusOf(c), label = c.zoomed ? `${name} Z` : name;
      // Its fixed number (the extras mod's tab slots), as the TUI's "2: nvim".
      // Its fixed number, from the extras mod: "tab-slots" is { [space]: { [tab]: number } }.
      const slot = (shared("tab-slots") ?? {})[space?.id]?.[c.id];
      // As T3's panel tabs: 24px, 12px words. Unlike T3's, the icon stays: it tells tabs apart, so hovering puts × over the status mark instead.
      const tabId = `tab-${c.id}`, closeId = `close-${c.id}`;
      const over = this.overTab === c.id || within(this, [tabId, closeId]);
      const glyph = programIcon(program, 12, t.muted) ?? svg("mods/t3-tabs/icons/terminal.svg").size(12).text_color(t.muted);
      // Its whole name, in a hover label's quiet style: the project, branch and program are already in the sidebar and the pane's header.
      // A Popup hanging from a 1px anchor at the tab's bottom, with an Inbox row's timing; the label's words start where the tab's name does
      // (the tab's 6px padding, 16px icon slot and 2px gap, less the label's 1px border and 8px padding). Up from the hover on: a Popup must
      // have measured its anchor before the frame a label starts to fade in. It says the status too, as × covers the mark while it shows.
      // Only what the tab isn't showing: a name cut short or that status. Not yet measured counts as cut.
      const says = status || !(widths.get(c.id) >= Math.ceil(this.nameW[c.id]) + TAB_CHROME);
      const cardShown = /** @type {any} */ (this).details === c.id && /** @type {any} */ (this).detailsIn && !this.hot, cardFade = /** @type {const} */ ({ duration: 150, easing: "ease-out" });
      // With the bar at the window's bottom it hangs from the tab's top instead: below, it would be pushed back over the name and its clicks.
      const up = barAtBottom();
      const details = Popup.new(`details-${c.id}`, div()).absolute().when(up, el => el.top(0).anchor("bottom_left")).when(!up, el => el.bottom(0)).left(6 + 16 + 2 - (1 + 8)).size(1)
        .when((/** @type {any} */ (this).details === c.id && this.pressed === null) || /** @type {any} */ (this).detailsOut === c.id, pop => pop.content(div().id(`details-card-${c.id}`)
          .when(up, el => el.mb(4)).when(!up, el => el.mt(4)).max_w(320).px(8).py(4).rounded(6).border(1).border_color(t.border).bg(t.chrome).shadow_md().text_size(12).text_color(t.foreground)
          .opacity(cardShown ? 1 : 0).top(cardShown ? 0 : up ? 4 : -4).transition("opacity", cardFade).transition("top", cardFade)
          .child(status ? `${name} · ${WORDS[status]}` : name)));
      const tab = h_flex().id(tabId).relative().h(24).w(widths.get(c.id)).pl(6).pr(8).gap(2).rounded(6).items_center().flex_none().text_size(12)
        .bg(c.active ? t.selected : t.chrome).text_color(c.active || over ? t.foreground : t.muted)
        .role("button").accessibility_label(name)
        .on_hover((on, cx) => {
          if (on) { this.overTab = c.id; detailsWatch(this, c.id, cx); }
          else if (this.overTab === c.id) { this.overTab = null; detailsFor(this, null, cx); }
          cx.notify();
        })
        .when(!c.active, el => el.hover(s => s.bg(t.hover)))
        // Dragged as a space is: the source fades, a line shows where it lands. `over` is null until the drag starts.
        .when(pressedAt === i && this.over !== null && this.over !== c.id, el => el.opacity(0.5))
        .when(pressedAt >= 0 && this.over === c.id && pressedAt !== i, el => el.child(
          div().absolute().top(0).bottom(0).w(2).bg(t.accent)
            .when(pressedAt < i, line => line.right(0))
            .when(pressedAt > i, line => line.left(0)),
        ))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); detailsFor(this, null, cx); this.pressed = c.id; this.over = null; this.pressAt = e.position; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_move((e, cx) => {
          detailsAt(this, c.id, e);
          const held = shown.find(x => x.id === this.pressed);
          if (!held || this.over === c.id || !loose(held) || !loose(c)) return;
          // As T3's tabs: a drag starts 6px from the press, so a click's wobble only selects.
          if (this.over === null && Math.hypot(e.position.x - this.pressAt.x, e.position.y - this.pressAt.y) < 6 * settings().zoom) return;
          if (this.over === null) this.dragKeys.focus();
          this.over = c.id;
          cx.notify();
        })
        .on_mouse_up("left", (_e, cx) => {
          const from = this.pressed, to = this.over;
          if (from === null) return;
          this.endDrag();
          // To the line it shows: past a tab that can't take a drop, the last one that can.
          if (from !== to && shown.some(x => x.id === from) && shown.some(x => x.id === to)) run("tab.move", { id: from, index: space.tabs.findIndex(x => x.id === to) + 1 });
          // Short of a drag it was a click on the pressed tab, wherever the release lands. A tab gone from the bar took its press along.
          else if (shown.some(x => x.id === from)) run("tab.select", { id: from });
          cx.notify();
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); detailsFor(this, null, cx); openOverlay({ mod: "t3-menu", kind: "popup", width: 220, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        // Its name's whole width, whatever the tab's: clipped to nothing, it only measures.
        // The number laid out as the label lays it out (its 3px margin and 2px gap), or the name comes up short and truncates.
        .child(h_flex().id(`name-${c.id}`).absolute().top(0).left(0).h(0).gap(2).overflow_hidden().whitespace_nowrap()
          .when(Boolean(slot), el => el.child(div().flex_none().mr(3).child(String(slot)))).child(div().flex_none().child(label))
          .on_size_change((size, cx) => { this.nameW[c.id] = size.width / settings().zoom; cx.notify(); }))
        // The card belongs to the icon and name, as T3's and Zed's: on the way to the × it goes.
        .child(h_flex().id(`label-${c.id}`).flex_1().min_w(0).h_full().gap(2).items_center()
          .on_hover((on, cx) => { detailsFor(this, on && says ? c.id : null, cx); cx.notify(); })
          .when(Boolean(slot), el => el.child(div().flex_none().mr(3).text_color(t.dim).child(String(slot))))
          .child(div().size(16).flex_none().flex().items_center().justify_center().child(glyph))
          .child(div().flex_1().min_w(0).truncate().child(label)))
        // Its label waits longer than a card's 150ms, so a straight click never meets it. Its key closes the active tab only.
        .child(tip(this, t, closeId, "Close tab", div().id(closeId).size(16).flex_none().flex().items_center().justify_center().rounded(4).hover(s => s.bg(t.raised)).on_hover(glow(this, closeId))
          .role("button").accessibility_label(`Close ${name}`)
          .on_mouse_down("left", stopPress).on_click((_e, cx) => { cx.stop_propagation(); run(`t3-tabs.close-tab:${c.id}`); })
          .when(over, el => el.child(svg("mods/t3-tabs/icons/x.svg").size(12).text_color(t.foreground)))
          .when(!over && status != null, el => el.child(mark(t, status)))
          .when(over, el => stop(this, t, closeId, el, 4)), { action: c.active ? "t3-tabs.close-tab" : undefined, below: !barAtBottom(), delay: 500 }))
        .when([this.overTab, /** @type {any} */ (this).details, /** @type {any} */ (this).detailsOut].includes(c.id), el => el.child(details));
      // A tab goes by its mouse-up, which a key isn't.
      return stop(this, t, tabId, tab, 6, { enter: () => run("tab.select", { id: c.id }) });
    };
    const root = layout(), { rail: sidebar } = sidebarParts(root);
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights && !barAtBottom()
      ? Math.max(8, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 8;
    const notice = sidebar?.hidden && this.undoNotice(t);
    return focusRoot(this, h_flex().size_full().min_w(0).pl(lightsPadding).pr(4).gap(4).items_center().bg(t.chrome)
      .when(this.over !== null, el => el.track_focus(this.dragKeys).on_key_down((e, cx) => {
        if (e.keystroke !== "escape" || this.over === null) return;
        cx.stop_propagation();
        this.endDrag();
        cx.notify();
      }))
      .on_mouse_up("left", (_e, cx) => { this.endDrag(); cx.notify(); })
      // Herdr reports no release outside the bar, so leaving ends a drag, as in the inbox.
      .on_hover((on, cx) => {
        if (on || this.pressed === null) return;
        this.endDrag();
        cx.notify();
      })
      .on_scroll_wheel((e, cx) => {
        if (Math.abs(e.delta.x) > Math.abs(e.delta.y)) { this.strip -= e.delta.x / settings().zoom; cx.notify(); }
        else if (Math.abs(e.delta.y) >= 1) this.navigation.handle(e.delta.y > 0 ? "tab-prev" : "tab-next", cx);
      })
      // As tmux's session name: the space in view, first in a bar at the bottom.
      // Drawn as the sidebar draws it: its mark and name, then a rule before the tabs.
      .when(barAtBottom() && Boolean(space), el => el.child(h_flex().id("bar-space").flex_none().max_w(200).gap(8).pl(4).items_center()
        .child(projectMark(space, 16, t, ps))
        .child(div().min_w(0).truncate().text_size(13).text_color(t.foreground).child(space.name))
        .child(div().flex_none().w(1).h(16).ml(4).mr(4).bg(t.border))))
      .when(Boolean(sidebar?.hidden) && !lightsStrip(), el => el.child(this.sidebarToggle(t, stopPress, awake(st, under), st)))
      .when(Boolean(notice), el => el.child(notice))
      // The + sits right after the last tab (T3 has it after the bar's controls). The tabs' room is measured on
      // the whole area less the +, as before; the strip itself takes only its tabs' width, so + follows them.
      .child(h_flex().id("tab-area").flex_1().min_w(0).h_full().items_center()
        .on_size_change((size, cx) => { this.room = Math.max(0, size.width / settings().zoom - (this.navigation.atHome ? 0 : 24 + TAB_GAP)); cx.notify(); })
        .child(h_flex().id("tab-scroll").min_w(0).h_full().items_center().overflow_hidden()
          .child(h_flex().id("tab-strip").flex_none().h_full().items_center().gap(TAB_GAP).ml(-this.stripAt(shown, widths)).children(shown.map(item))))
        .when(!this.navigation.atHome, el => el.child(div().flex_none().ml(TAB_GAP).child(button("tab-new", svg("mods/t3-tabs/icons/plus.svg").size(14), "New tab", () => newTab(spaces().find(s => s.active)), "t3-tabs.new"))))));
  }

  undoNotice(t) {
    const n = shared("t3-inbox.notice");
    if (!n || Date.now() - n.at >= 6000) return null;
    return h_flex().id(`undo-notice-${n.gen}`).flex_none().h(24).gap(4).items_center().text_size(11).text_color(t.dim)
      .opacity(n.shown ? 1 : 0).transition("opacity", { duration: 200, easing: "ease-out" })
      .child(`${n.action}${n.count === 1 ? "" : ` ${n.count}`},`)
      .child(h_flex().id("undo-notice-undo").h(24).items_center().font_medium().text_color(t.foreground)
        .when(n.live && Date.now() - n.at < 5000, el => stop(this, t, "undo-notice-undo", el.hover(s => s.underline()).role("button")
          .accessibility_label(`Undo: ${n.action}`).on_click(() => run("t3-tabs.undo")), 4)).child("Undo"));
  }
}
