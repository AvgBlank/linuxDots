// bettr's tab-bar controls for a layout whose tab bar doesn't have them (focus), ported from bettr-tabs:
// - the chat: a Chat | Terminal switch while a chat and its agent are showing, "Move to chat" for a Claude or
//   Codex terminal without one, and new agents opening in their chat when the bettr Layout dialog says so
//   (shared "bettr.agentView");
// - the side panels: Files, Changes, Activity and Context buttons for the layout's `panel` column.
// - settings.js, the Customize panel (t3-chrome's palette button, or bar.customize): how agents open and which
//   of these controls (and T3's Actions) show.
// props.block: this block's id, sized to what it shows.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, terminals, run, exec, hc, notify, appHome, theme, shared, setShared, settings, props, layout, openOverlay, nextCommand } from "herdr";
import { PANELS, enabledPanels, chatSwitchOn, find, customizeView, CUSTOMIZE_SIZE } from "./settings.js";
import { checkMachines } from "./machines.js";

// Claude Code, Codex or Hermes, the agents the chat mod can show.
function isAgent(pane) {
  const term = pane.terminal && terminals().find((x) => x.address === pane.terminal);
  const argv0 = term?.argv?.[0]?.split("/").pop() ?? "";
  const what = `${term?.report?.app ?? ""} ${term?.foreground?.name ?? ""} ${term?.program?.key ?? ""} ${argv0}`.toLowerCase();
  return what.includes("claude") || what.includes("codex") || what.includes("hermes");
}

// An agent terminal its chat moved out of its tab.
const hasChat = (pane) => Boolean(terminals().find((x) => x.address === pane.terminal)?.labels?.["chat.tab"]);

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

// The chat mod's backstage.js hide(), in short: the agent's terminal steps out of
// `fromTab` into a new settled tab of its own, labelled chat.tab so its chat finds it.
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

const WIDTH = 368;

export default class TopBar extends View {
  init(_props, cx) {
    // The Customize panel is a dialog copy of this mod: it only draws the panel.
    if (props()?.customize) {
      this.section = "agents"; this.handle = cx.focus_handle(); this.handle.focus();
      cx.spawn(async (cx) => { await checkMachines(cx); });
      return;
    }
    // A terminal whose chat was opened once (and maybe closed since) is left as it is.
    cx.spawn(async () => { for (;;) if ((await nextCommand()) === "customize") this.openCustomize(); });
    try { this.autoChat = new Set(JSON.parse(localStorage.getItem("autoChat2") ?? "[]")); } catch { this.autoChat = new Set(); }
    cx.spawn(async cx => {
      for (;;) {
        await cx.sleep(1000);
        try {
          const space = spaces().find(p => p.active);
          const tab = space?.tabs.find(c => c.active);
          const { agent } = this.chatIn(tab, space);
          if (shared("bettr.agentView") === "chat" && agent?.terminal && !this.autoChat.has(agent.terminal) && !this.opening) await this.openChat(tab, cx);
        } catch (e) { console.log(`bar auto chat: ${e}`); }
      }
    });
  }

  chatIn(tab, space) {
    const inTab = panes().filter((p) => p.tab === tab?.id);
    const back = inTab.map(chatTabOf).find((id) => id && id !== tab?.id && space?.tabs?.some((x) => x.id === id));
    // An agent still needs a chat when none in the tab is its own (chat.of, written by the chat).
    const of = shared("chat.of") ?? {};
    const chats = inTab.filter((p) => p.mod === "chat");
    const needs = (p) => isAgent(p) && !hasChat(p) && !chats.some((c) => c.pane === of[p.terminal]);
    return { back, chats, agent: inTab.find((p) => p.focused && needs(p)) ?? inTab.find(needs) };
  }

  // A chat and its agent's own tab, seen from either: { chatTab, ownTab, side }.
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
      // In a split, the terminal takes the chat's place there (in: the pane that comes in), rather than its tab showing whole.
      const tp = panes().find(p => p.terminal === t);
      const inPlace = inTab.length > 1 && tp ? [cp.pane, tp.pane, t] : null;
      if (id && id !== tab.id && term.labels["chat.tab"]) return { chatTab: tab.id, ownTab: id, side: "chat", inPlace, terminal: t };
    }
    const tp = inTab.find(p => p.focused && p.terminal);
    const back = tp && chatTabOf(tp);
    // The terminal standing in for its chat in the chat's own tab: the chat, in its tab of its own, swaps back.
    if (back && back === tab.id) {
      const cp = panes().find(p => p.mod === "chat" && p.pane === of[tp.terminal] && p.tab !== tab.id);
      return cp ? { chatTab: tab.id, ownTab: cp.tab, side: "terminal", inPlace: [tp.pane, cp.pane, tp.terminal], terminal: tp.terminal } : null;
    }
    return back ? { chatTab: back, ownTab: tab.id, side: "terminal", terminal: tp.terminal } : null;
  }

  swap(pair, to) {
    if (to === pair.side) return;
    // The side this agent opens on from now on, however you get to it (the chat's keepSide).
    // ponytail: one entry per agent ever switched, never pruned; a few bytes each.
    setShared("chat.side", { ...(shared("chat.side") ?? {}), [pair.terminal]: to });
    if (pair.inPlace) {
      // here: the split's pane, away: the one in the hidden tab. They trade contents (helper.py swap), so the chat ends up in
      // `away` (going to the terminal) or `here` (coming back): chat.of follows it at once, as the chat would on its next check.
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

  // A chat beside the agent; the terminal then moves into a tab of its own.
  async openChat(tab, cx) {
    const { agent, chats } = this.chatIn(tab);
    if (!agent || this.opening) return;
    this.opening = true;
    try {
      // With other panes beside it, the terminal steps out first and the chat splits from a neighbour, so it gets a whole half.
      const others = panes().filter(p => p.tab === tab.id && p.pane !== agent.pane);
      const from = others.find(p => p.focused) ?? others[others.length - 1];
      if (from) await parkForChat(agent.terminal, tab.id);
      const r = await herdrDo("pane.split", { direction: "right", pane: from ? from.pane : agent.pane, mod: "chat", props: { terminal: agent.terminal } });
      let made = null;
      try { made = JSON.parse(r.stdout).pane ?? null; } catch {}
      for (let i = 0; i < 20; i++) {
        const now = this.chatIn(tab).chats;
        if (now.length > chats.length) {
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
    } finally {
      this.opening = false;
    }
  }

  // The Customize panel, as a dialog like Herdr's Settings.
  openCustomize() {
    openOverlay({ mod: "bar", kind: "dialog", ...CUSTOMIZE_SIZE, props: { customize: true } });
  }

  // Show exactly `want` in the panel column, each at the width it was left at; none hides the column.
  // ponytail: one choice for every space (bettr-tabs remembers it per space) and no mod-provided panels.
  setPanels(want, now) {
    const root = layout(), panel = find(root, "panel"), gap = find(root, "panel-body")?.gap ?? 0;
    try { this.widths ??= JSON.parse(localStorage.getItem("panelWidths") ?? "{}"); } catch { this.widths = {}; }
    if (now.length && panel?.size?.px) {
      let rest = panel.size.px - gap * (now.length - 1);
      const flexible = [];
      for (const id of now) {
        const px = find(root, id)?.size?.px;
        if (px) { this.widths[id] = Math.max(200, Math.round(px)); rest -= px; } else flexible.push(id);
      }
      for (const id of flexible) this.widths[id] = Math.max(200, Math.round(rest / flexible.length));
      try { localStorage.setItem("panelWidths", JSON.stringify(this.widths)); } catch {}
    }
    for (const [id] of PANELS) run(want.includes(id) ? "layout.show" : "layout.hide", { id });
    if (!want.length) return run("layout.hide", { id: "panel" });
    const width = (id) => this.widths[id] ?? WIDTH;
    want.forEach((id, i) => run("layout.resize", i ? { id, px: width(id) } : { id, weight: 1 }));
    run("layout.resize", { id: "panel", px: want.reduce((sum, id) => sum + width(id), 0) + gap * (want.length - 1) });
    run("layout.show", { id: "panel" });
  }

  // Sized to its controls, as t3-tabs sizes its end block (layout px are logical, sizes zoomed).
  fit(size) {
    const id = props()?.block, px = Math.max(1, Math.ceil(size.width / (Number(settings()?.zoom) || 1)));
    if (!id || px === this.fitted) return;
    this.fitted = px;
    run("layout.resize", { id, px });
  }

  render() {
    if (props()?.customize) return customizeView(this);
    const t = theme();
    const space = spaces().find(p => p.active);
    const tab = space?.tabs.find(c => c.active);
    const pair = this.pairIn(tab);
    const { agent } = this.chatIn(tab, space);
    const stop = (_e, cx) => cx.stop_propagation();
    // T3's bar sizes: 24px controls, 12px words, 8px rounding.
    const seg = (to, label, icon) => {
      const on = pair?.side === to;
      return h_flex().id(`view-${to}`).h(20).px(8).gap(5).flex_none().items_center().rounded(6).text_size(12).cursor_pointer()
        .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .when(!on, el => el.hover(s => s.text_color(t.foreground)))
        .on_mouse_down("left", stop).on_click(() => this.swap(pair, to))
        .child(svg(icon).size(12)).child(label);
    };
    // The panels the Layout dialog turned on (bettr's default: Files and Changes, plus Activity and Context).
    const enabled = enabledPanels();
    const chatSwitch = chatSwitchOn();
    const root = layout(), panel = find(root, "panel");
    const open = panel && !panel.hidden ? PANELS.map(([id]) => id).filter(id => find(root, id) && !find(root, id).hidden) : [];
    const panelButton = ([id, label, icon]) => {
      const on = open.includes(id);
      return div().id(`panel-${id}`).size(24).flex_none().flex().items_center().justify_center().rounded(8).cursor_pointer()
        .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.dim).hover(s => s.bg(on ? t.selected : t.hover).text_color(t.foreground))
        .tooltip(label).on_mouse_down("left", stop)
        .on_click(() => this.setPanels(on ? open.filter(p => p !== id) : PANELS.map(([p]) => p).filter(p => p === id || open.includes(p)), open))
        .child(svg(`mods/bar/icons/${icon}.svg`).size(14));
    };
    // Activity and Context are about an agent: shown when the tab has one (or the panel is open, so it can be closed).
    const hasAgent = Boolean(pair) || panes().some(p => p.tab === tab?.id && (p.mod === "chat" || isAgent(p)));
    const forAgent = (id) => id !== "activity" && id !== "context" || hasAgent || open.includes(id);
    const panels = panel ? PANELS.filter(([id]) => enabled.includes(id) && find(root, id) && forAgent(id)) : [];
    return h_flex().size_full().items_center().bg(t.chrome)
      .child(h_flex().id("bar-fit").flex_none().gap(6).items_center().on_size_change((size) => this.fit(size))
        .when(chatSwitch && Boolean(pair), el => el.mr(8).child(h_flex().flex_none().h(24).p(2).gap(2).items_center().rounded(8).border_1().border_color(t.border)
          .child(seg("chat", "Chat", "mods/bar/icons/chat.svg")).child(seg("terminal", "Terminal", "mods/bar/icons/terminal.svg"))))
        // Only for the agent you're on: a shell beside it isn't the one moving.
        .when(chatSwitch && !pair && Boolean(agent?.focused), el => el.mr(8).child(h_flex().id("move-to-chat").h(24).px(8).gap(5).flex_none().items_center().rounded(8)
          .text_size(12).text_color(t.accent).border_1().border_color(t.accent).hover(s => s.bg(t.hover))
          .on_mouse_down("left", stop).on_click((_e, cx) => this.openChat(tab, cx))
          .child(svg("mods/bar/icons/chat.svg").size(12)).child("Move to chat")))
        .when(panels.length > 0, el => el.mr(4).child(h_flex().flex_none().gap(2).items_center().children(panels.map(panelButton)))));
  }
}
