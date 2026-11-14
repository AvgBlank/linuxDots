import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, terminals, run, exec, hc, notify, openOverlay, theme, window, shared, setShared, layout, settings, appHome, readTextFile, writeTextFile, watchFolder } from "herdr";
import { exists, readdir } from "fs/promises";
import { blocksDiffer, panelMod, withBlocks } from "./panel-mods.js";

// `color` (#rgb, #rrggbb or #rrggbbaa) at `alpha` (hex 00-ff); any other color as it is.
// The same helper is in bettr-spaces (a mod cannot import another's files).
const tint = (color, alpha) => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color)?.[1];
  if (!hex) return color;
  return `#${hex.length === 3 ? [...hex].map(c => c + c).join("") : hex.slice(0, 6)}${alpha}`;
};

// From chat-tabs (herdr-chat): Claude Code, Codex or Hermes, the agents the chat mod can show.
function isAgent(pane) {
  const term = pane.terminal && terminals().find((x) => x.address === pane.terminal);
  const argv0 = term?.argv?.[0]?.split("/").pop() ?? "";
  const what = `${term?.report?.app ?? ""} ${term?.foreground?.name ?? ""} ${term?.program?.key ?? ""} ${argv0}`.toLowerCase();
  return what.includes("claude") || what.includes("codex") || what.includes("hermes");
}

// An agent terminal that the chat's Hide terminal moved out of its tab.
function hasChat(pane) {
  return Boolean(terminals().find((x) => x.address === pane.terminal)?.labels?.["chat.tab"]);
}

// The tab of the chat that agent terminal stepped out of.
function chatTabOf(pane) {
  const term = pane.terminal && terminals().find((x) => x.address === pane.terminal);
  const id = term?.labels?.["chat.tab"];
  if (!id) return null;
  return term.address.includes("/") ? `${term.address.split("/")[0]}/${id}` : id;
}

// App commands one after another (run() calls from a mod aren't ordered).
const HERDR = 'H=$(command -v herdr-app || echo "$HOME/.local/bin/herdr-app"); exec "$H" do "$1" "$2"';
const herdrDo = (command, args) => exec("sh", ["-c", HERDR, "sh", command, JSON.stringify(args)]);

// The chat mod's backstage.js hide(), in short (a mod can't import another's files):
// the agent's terminal steps out of `fromTab` into a new settled tab of its own,
// still running, labelled chat.tab so its chat finds it.
async function parkForChat(address, fromTab) {
  const term = terminals().find(x => x.address === address);
  const space = term?.labels?.["herdr.space"];
  if (!space) return false;
  const local = id => String(id).split("/").pop();
  const tab = "tb" + Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const tabOf = async () => { try { return JSON.parse((await hc(["get", address, "--json"])).stdout).labels?.["herdr.tab"]; } catch { return null; } };
  await hc(["label", address, `chat.tab=${local(fromTab)}`]);
  await herdrDo("terminal.park", { terminal: address });
  for (let i = 0; i < 30 && (await tabOf()); i++) await exec("sh", ["-c", "sleep 0.1"]);
  await hc(["label", address, `herdr.space=${space}`, `herdr.tab=${tab}`]);
  const m = address.includes("/") ? address.split("/")[0] : null;
  for (let i = 0; i < 30; i++) {
    await exec("sh", ["-c", "sleep 0.1"]);
    const r = await herdrDo("tab.settle", { id: m ? `${m}/${tab}` : tab });
    if (r.code === 0 && !/"error"/.test(r.stdout)) return true;
  }
  return true;
}

// Tabs that hold an agent's terminal for its chat (the chat's tab stands for them).
const chatOwnTabs = (list) => new Set(list.filter(x => x.labels?.["chat.tab"] && x.labels["herdr.tab"] && x.labels["herdr.tab"] !== x.labels["chat.tab"])
  .map(x => (x.address.includes("/") ? `${x.address.split("/")[0]}/${x.labels["herdr.tab"]}` : x.labels["herdr.tab"])));

// Closing a chat's tab ends its agent too (a chat and its agent are one): the terminals
// parked for this tab (chat.tab), and any its chat panes show (chat.of, one owner only).
function closeTab(id) {
  const local = id.includes("/") ? id.split("/")[1] : id;
  const chats = new Set(panes().filter(p => p.tab === id && p.mod === "chat").map(p => p.pane));
  const of = shared("chat.of") ?? {};
  const owners = (pane) => Object.keys(of).filter(k => of[k] === pane);
  const ends = new Set([
    ...terminals().filter(x => x.labels?.["chat.tab"] === local).map(x => x.address),
    ...[...chats].map(owners).filter(list => list.length === 1).flat(),
  ]);
  for (const terminal of ends) run("terminal.kill", { terminal });
  run("tab.close", { id, confirmed: true });
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The right panel's children, side by side in `panel-body` (a row). Each button shows or
// hides its own. The first open child takes what is left (weight 1) and the others are
// fixed (px), so dragging the panel's outer edge resizes only the first. Each child keeps
// its own width; WIDTH is the width of a child the person never resized. Other mods add
// their own panels: panel-mods.js.
const PANELS = ["files", "changes", "activity", "context"], WIDTH = 368;
const BLOCK_CHECK_MS = 5000, WATCH_RETRY_MS = 30000;
const gap = () => find(layout(), "panel-body")?.gap ?? 0;
const same = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    // A new Claude or Codex agent opens in the chat; a terminal whose chat was
    // opened once (and maybe closed since) is left as it is.
    try { this.autoChat = new Set(JSON.parse(localStorage.getItem("autoChat2") ?? "[]")); } catch { this.autoChat = new Set(); }
    cx.spawn(async cx => {
      for (;;) {
        await cx.sleep(1000);
        try {
          const space = spaces().find(p => p.active);
          const tab = space?.tabs.find(c => c.active);
          const { agent } = this.chatIn(tab, space);
          // Only when the Layout dialog says agents open in their chat (default: terminal).
          if (shared("bettr.agentView") === "chat" && agent?.terminal && !this.autoChat.has(agent.terminal) && !this.opening) await this.openChat(tab, cx);
        } catch (e) { console.log(`bettr-tabs auto chat: ${e}`); }
      }
    });
    this.mods = null; // the mods that ask for a panel; null until a scan of the mods folder works
    const dir = `${appHome()}/mods`;
    cx.spawn(async cx => {
      await this.scanMods(dir, cx);
      for (;;) {
        try { await watchFolder(dir); } catch { await cx.sleep(WATCH_RETRY_MS); }
        await this.scanMods(dir, cx);
      }
    });
    // Not only when mods change: an update of Bettr replaces the layout, and with it the blocks.
    cx.spawn(async cx => {
      for (;;) {
        await this.writeBlocks();
        await cx.sleep(BLOCK_CHECK_MS);
      }
    });
    // Each space's open panels.
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem("panels") ?? "{}") ?? {}; } catch {}
    this.panels = Object.fromEntries(Object.entries(saved).filter(([, v]) => Array.isArray(v)));
    // Each child's last width, px.
    this.widths = {};
    try { this.widths = JSON.parse(localStorage.getItem("panelWidths") ?? "{}") ?? {}; } catch {}
  }

  async scanMods(dir, cx) {
    try {
      const found = await Promise.all((await readdir(dir)).map(async name => {
        const mod = panelMod(name, await readTextFile(`${dir}/${name}/mod.json`).catch(() => null));
        return mod && { ...mod, icon: await exists(`${dir}/${name}/icon.svg`) ? `mods/${name}/icon.svg` : null };
      }));
      const mods = found.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
      if (JSON.stringify(mods) === JSON.stringify(this.mods)) return;
      this.mods = mods;
      setShared("bettr.modPanels", mods.map(({ id, title }) => ({ id, title }))); // for the Layout dialog
      await this.writeBlocks();
      cx.notify();
    } catch {
      // Not readable now: keep what is known, and leave the layout as it is.
    }
  }

  // Make the shown layout's file hold one block per mod. The file, not layout.set: that forgets the sizes the
  // person dragged, and writes the rest of the tree too. A file that changed since the read is refused: the next check tries again.
  async writeBlocks() {
    if (!this.mods || !blocksDiffer(layout(), this.mods)) return;
    try {
      const path = `${appHome()}/layouts/${shared("layout")}.json`, text = await readTextFile(path);
      await writeTextFile(path, `${JSON.stringify(withBlocks(JSON.parse(text), this.mods), null, 2)}\n`, text);
    } catch {
      // Tried again at the next check.
    }
  }

  // The mods whose block is in the layout now.
  shownMods(root) {
    return (this.mods ?? []).filter(mod => find(root, mod.id));
  }

  // All the panels, in the order they show.
  panelIds(root) {
    return [...PANELS, ...this.shownMods(root).map(mod => mod.id)];
  }

  // The open children, in panel order: none while the panel is hidden.
  opened(root, panel) {
    return panel && !panel.hidden ? this.panelIds(root).filter(id => { const node = find(root, id); return node && !node.hidden; }) : [];
  }

  // Show exactly `want`, and size the panel to fit them. None hides the panel.
  setOpen(want, now, panel) {
    const between = gap();
    // Record the widths the person left: fixed children have px, the first gets the rest.
    if (now.length && panel?.size?.px) {
      const root = layout();
      let rest = panel.size.px - between * (now.length - 1);
      const shared = [];
      for (const id of now) {
        const px = find(root, id)?.size?.px;
        if (px) { this.widths[id] = Math.max(200, Math.round(px)); rest -= px; } else shared.push(id);
      }
      for (const id of shared) this.widths[id] = Math.max(200, Math.round(rest / shared.length));
      try { localStorage.setItem("panelWidths", JSON.stringify(this.widths)); } catch {}
    }
    for (const id of this.panelIds(layout())) run(want.includes(id) ? "layout.show" : "layout.hide", { id });
    if (!want.length) { run("layout.hide", { id: "panel" }); return; }
    const width = id => this.widths[id] ?? this.mods?.find(mod => mod.id === id)?.width ?? WIDTH;
    want.forEach((id, i) => run("layout.resize", i ? { id, px: width(id) } : { id, weight: 1 }));
    run("layout.resize", { id: "panel", px: want.reduce((sum, id) => sum + width(id), 0) + between * (want.length - 1) });
    run("layout.show", { id: "panel" });
  }

  // The open panels are remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing one records it.
  syncPanel(space, root, panel, enabled) {
    if (!space || !panel) return;
    const now = this.opened(root, panel);
    // A panel turned off in the Layout dialog closes.
    const allowed = now.filter(id => enabled.includes(id));
    if (!same(allowed, now) && !this.pending) {
      this.pending = { want: allowed, until: Date.now() + 1000 };
      this.setOpen(allowed, now, panel);
      return;
    }
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const want = this.panelIds(root).filter(id => (this.panels[space.id] ?? []).includes(id) && enabled.includes(id));
        if (!same(want, now)) {
          this.pending = { want, until: Date.now() + 1000 };
          this.setOpen(want, now, panel);
          return;
        }
      }
    }
    // Open children from an older layout state can all share the width: fix their sizes.
    // The first open child has no px (it takes the rest); each other one has px.
    if (!this.pending && now.some((id, i) => Boolean(find(root, id)?.size?.px) !== i > 0)) {
      this.pending = { want: now, until: Date.now() + 1000 };
      this.setOpen(now, now, panel);
      return;
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (!same(this.pending.want, now) && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (same(this.panels[space.id] ?? [], now) && space.id in this.panels) return;
    this.panels[space.id] = now;
    try { localStorage.setItem("panels", JSON.stringify(this.panels)); } catch {}
  }

  // "Move to chat" while the tab has a Claude or Codex terminal and no chat;
  // "Back to chat" in the tab of an agent terminal its chat hid.
  chatIn(tab, space) {
    const inTab = panes().filter((p) => p.tab === tab?.id);
    const back = inTab.map(chatTabOf).find((id) => id && id !== tab?.id && space?.tabs?.some((x) => x.id === id));
    // An agent still needs a chat when none in the tab is its own (chat.of, written by the chat).
    const of = shared("chat.of") ?? {};
    const chats = inTab.filter((p) => p.mod === "chat");
    const needs = (p) => isAgent(p) && !hasChat(p) && !chats.some((c) => c.pane === of[p.terminal]);
    return {
      back,
      chats,
      agent: inTab.find((p) => p.focused && needs(p)) ?? inTab.find(needs),
    };
  }

  // A chat and its agent's own tab (where the terminal lives, settled), seen from
  // either: { chatTab, ownTab, side }. The tab bar shows the pair as one tab.
  pairIn(tab) {
    if (!tab) return null;
    const of = shared("chat.of") ?? {};
    const inTab = panes().filter(p => p.tab === tab.id);
    const cp = inTab.find(p => p.mod === "chat" && p.focused);
    if (cp) {
      const t = Object.keys(of).find(a => of[a] === cp.pane);
      const term = t && terminals().find(x => x.address === t);
      const own = term?.labels?.["herdr.tab"];
      const id = own && (term.address.includes("/") ? `${term.address.split("/")[0]}/${own}` : own);
      // In a split, the terminal takes the chat's place there (inPlace: [split's pane, hidden tab's pane, agent]).
      const tp = panes().find(p => p.terminal === t);
      const inPlace = inTab.length > 1 && tp ? [cp.pane, tp.pane, t] : null;
      if (id && id !== tab.id && term.labels["chat.tab"]) return { chatTab: tab.id, ownTab: id, side: "chat", inPlace };
    }
    const tp = inTab.find(p => p.focused && p.terminal);
    const back = tp && chatTabOf(tp);
    // The terminal standing in for its chat in the chat's own tab: the chat, in its tab of its own, swaps back.
    if (back && back === tab.id) {
      const cp = panes().find(p => p.mod === "chat" && p.pane === of[tp.terminal] && p.tab !== tab.id);
      return cp ? { chatTab: tab.id, ownTab: cp.tab, side: "terminal", inPlace: [tp.pane, cp.pane, tp.terminal] } : null;
    }
    return back ? { chatTab: back, ownTab: tab.id, side: "terminal" } : null;
  }

  // Chat or Terminal: the chat's tab, or the agent's own (put away again on leaving it). In a split they trade
  // contents in place (extras/helper.py swap): each tab keeps its pane ids, and chat.of follows the chat.
  swap(pair, to) {
    if (to === pair.side) return;
    if (pair.inPlace) {
      const [here, away, terminal] = pair.inPlace;
      return exec("python3", [`${appHome()}/mods/extras/helper.py`, "swap", here, away]).then((r) => {
        if (r.code !== 0) return notify({ title: `Couldn't show the ${to}`, body: (r.stderr || r.stdout).trim(), level: "error" });
        setShared("chat.of", { ...(shared("chat.of") ?? {}), [terminal]: to === "terminal" ? away : here });
        herdrDo("pane.focus", { pane: here });
      });
    }
    if (to === "terminal") run("tab.select", { id: pair.ownTab });
    else { run("tab.select", { id: pair.chatTab }); run("tab.settle", { id: pair.ownTab }); }
  }

  // A chat beside the agent; the chat then moves the terminal into a tab of its own.
  async openChat(tab, cx) {
    const { agent, chats } = this.chatIn(tab);
    if (!agent || this.opening) return;
    this.opening = true;
    try {
      // With other panes beside it, the terminal steps out first and the chat splits from
      // a neighbour, so it gets a whole half (Herdr can't resize panes from a mod).
      const others = panes().filter(p => p.tab === tab.id && p.pane !== agent.pane);
      const from = others.find(p => p.focused) ?? others[others.length - 1];
      if (from) await parkForChat(agent.terminal, tab.id);
      const r = await herdrDo("pane.split", { direction: "right", pane: from ? from.pane : agent.pane, mod: "chat", props: { terminal: agent.terminal } });
      let made = null;
      try { made = JSON.parse(r.stdout).pane ?? null; } catch {}
      for (let i = 0; i < 20; i++) {
        const now = this.chatIn(tab).chats;
        if (now.length > chats.length) {
          // The new chat's pane is the one that wasn't there: record it as this agent's.
          const pane = made ?? now.find(c => !chats.some(o => o.pane === c.pane))?.pane;
          if (pane) setShared("chat.of", { ...(shared("chat.of") ?? {}), [agent.terminal]: pane });
          // Parking made a tab and settled it, and Herdr then shows a tab of its choosing: back to this one, on the chat.
          if (from) {
            const space = spaces().find(s => s.tabs.some(x => x.id === tab.id));
            if (space && !space.active) await herdrDo("space.select", { id: space.id });
            await herdrDo("tab.select", { id: tab.id });
            if (pane) await herdrDo("pane.focus", { pane });
          }
          this.autoChat.add(agent.terminal);
          try { localStorage.setItem("autoChat2", JSON.stringify([...this.autoChat].slice(-200))); } catch {}
          return;
        }
        await cx.sleep(100);
      }
      notify({ title: "Couldn't open the chat", body: "The chat pane didn't appear", level: "error" });
      this.autoChat.add(agent.terminal); // don't retry it every second
    } finally { this.opening = false; }
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    // Settled tabs (a chat's hidden agent terminal lives in one) stay out unless shown.
    const activeTab = space?.tabs?.find(x => x.active);
    const pair = this.pairIn(activeTab);
    const owned = chatOwnTabs(terminals());
    const shown = (space?.tabs ?? []).filter((x) => !owned.has(x.id) && (!x.settled || x.active));
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    // Shared by the tabs and the panel buttons.
    const chip = (el, on) => el.h(29).flex_none().items_center().rounded(7).border(1).border_color(on ? t.input : t.chrome)
      .bg(on ? tint(t.raised, "80") : t.chrome).text_color(on ? t.foreground : t.muted).cursor_pointer().hover(s => s.bg(t.hover));
    const ps = panes(); // Read once: each read copies every pane.
    const item = (c, i) => {
      const program = ps.find(p => p.tab === c.id && p.program?.agent)?.program ?? ps.find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      return chip(h_flex().id(`tab-${c.id}`).px(10).gap(7).text_size(13), c.active)
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(pair?.side === "terminal" && c.id === pair.chatTab, el => el.bg(tint(t.raised, "80")).text_color(t.foreground))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); closeTab(c.id); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // The first tab starts on the pane's left edge (work-body's padding in the layout).
    // With the sidebar hidden, the tabs start after the macOS window buttons.
    const paneEdge = find(root, "work-body")?.padding ?? 8;
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(paneEdge, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : paneEdge;
    const panel = find(root, "panel");
    // Set in the Layout dialog (bettr-chrome/layout-config.js, same default).
    // Set in the Layout dialog too: on until turned off, so a new mod's panel needs no setting.
    const off = shared("bettr.modPanelsOff") ?? [];
    const mods = this.shownMods(root).filter(mod => !off.includes(mod.id));
    const enabled = [...(shared("bettr.panels") ?? [...(shared("workspace.panels") ?? ["files", "changes"]), "activity", "context"]),
      ...mods.map(mod => mod.id)];
    this.syncPanel(space, root, panel, enabled);
    const open = this.opened(root, panel);
    const panelButton = (id, label, icon) => {
      const on = open.includes(id);
      // Icon only; the name is the tooltip.
      return chip(h_flex().id(`panel-${id}`).w(29).justify_center(), on)
        .tooltip(label).on_mouse_down("left", stop)
        // Each button shows or hides its own panel; the others stay as they are.
        .on_click(() => this.setOpen(on ? open.filter(p => p !== id) : this.panelIds(layout()).filter(p => p === id || open.includes(p)), open, panel))
        .child(icon ? svg(icon).size(14) : div().text_size(12).child(label.slice(0, 1).toUpperCase()));
    };
    const tab = shown.find((c) => c.active);
    const { agent } = this.chatIn(tab, space);
    // One segmented control: both sides in a track, the one showing filled.
    const seg = (to, label, icon) => {
      const on = pair?.side === to;
      return h_flex().id(`view-${to}`).h(23).px(10).gap(6).flex_none().items_center().rounded(6).text_size(12.5).cursor_pointer()
        .bg(on ? t.raised : t.chrome).text_color(on ? t.foreground : t.muted)
        .when(!on, el => el.hover(s => s.text_color(t.foreground)))
        .on_mouse_down("left", stop).on_click(() => this.swap(pair, to))
        .child(svg(icon).size(13)).child(label);
    };
    const chatButton = (id, label, action) => h_flex().id(id).h(29).px(9).gap(5).flex_none().items_center().rounded(7)
      .text_size(12).bg(t.chrome).text_color(t.accent).border_1().border_color(t.accent)
      .hover(s => s.bg(t.hover)).on_mouse_down("left", stop).on_click(action)
      .child(svg("mods/bettr-tabs/icons/chat.svg").size(14)).child(label);
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).pt(8).gap(6).items_center().bg(t.chrome)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .when(Boolean(sidebar?.hidden), el => el.child(button("show-sidebar", svg("mods/workspace-chrome/panel-left.svg").size(15), () => run("layout.show", { id: "sidebar" }))
        .tooltip("Show sidebar (⌘B)")))
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .when(Boolean(pair), el => el.child(h_flex().flex_none().h(29).p(2).gap(2).items_center().rounded(8).border_1().border_color(t.border).bg(t.chrome)
        .child(seg("chat", "Chat", "mods/bettr-tabs/icons/chat.svg")).child(seg("terminal", "Terminal", "mods/bettr-tabs/icons/terminal.svg"))))
      // Only for the agent you're on: a shell beside it isn't the one moving.
      .when(Boolean(agent?.focused), el => el.child(chatButton("panel-chat", "Move to chat", (_e, cx) => this.openChat(tab, cx))))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/bettr-tabs/icons/list-tree.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/bettr-tabs/icons/git-compare.svg")))
      .when(enabled.includes("activity"), el => el.child(panelButton("activity", "Activity", "mods/bettr-tabs/icons/activity.svg")))
      .when(enabled.includes("context"), el => el.child(panelButton("context", "Context", "mods/bettr-tabs/icons/gauge.svg")))
      .children(mods.map(mod => panelButton(mod.id, mod.title, mod.icon)))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
