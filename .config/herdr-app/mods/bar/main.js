// bettr's side-panel controls for a layout whose tab bar doesn't have them (focus), ported from bettr-tabs:
// - the side panels: Files, Changes, Activity and Context buttons for the layout's `panel` column.
// - settings.js, the Customize panel (t3-chrome's palette button, or bar.customize): which controls show
//   and whether the agent reporter is set up on each machine.
// props.block: this block's id, sized to what it shows.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, terminals, run, theme, settings, props, layout, openOverlay, nextCommand } from "herdr";
import { PANELS, enabledPanels, find, customizeView, CUSTOMIZE_SIZE } from "./settings.js";
import { checkMachines } from "./machines.js";

// terminals() copies every terminal into JS on each call: cache once per 100 ms.
let termsAt = 0, termsBy = new Map();
const termOf = (address) => {
  if (Date.now() - termsAt > 100) { termsBy = new Map(terminals().map((x) => [x.address, x])); termsAt = Date.now(); }
  return address ? termsBy.get(address) : undefined;
};

// Claude Code, Codex or Hermes: agent terminals that Activity and Context track.
function isAgent(pane) {
  const term = termOf(pane.terminal);
  const argv0 = term?.argv?.[0]?.split("/").pop() ?? "";
  const what = `${term?.report?.app ?? ""} ${term?.foreground?.name ?? ""} ${term?.program?.key ?? ""} ${argv0}`.toLowerCase();
  return what.includes("claude") || what.includes("codex") || what.includes("hermes");
}

const WIDTH = 368;

export default class TopBar extends View {
  init(_props, cx) {
    // The Customize panel is a dialog copy of this mod: it only draws the panel.
    if (props()?.customize) {
      this.section = "bar"; this.handle = cx.focus_handle(); this.handle.focus();
      cx.spawn(async (cx) => { await checkMachines(cx); });
      return;
    }
    cx.spawn(async () => { for (;;) if ((await nextCommand()) === "customize") this.openCustomize(); });
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
    const stop = (_e, cx) => cx.stop_propagation();
    // The panels the Layout dialog turned on (bettr's default: Files and Changes, plus Activity and Context).
    const enabled = enabledPanels();
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
    const hasAgent = panes().some(p => p.tab === tab?.id && isAgent(p));
    const forAgent = (id) => id !== "activity" && id !== "context" || hasAgent || open.includes(id);
    const panels = panel ? PANELS.filter(([id]) => enabled.includes(id) && find(root, id) && forAgent(id)) : [];
    return h_flex().size_full().items_center().bg(t.chrome)
      .child(h_flex().id("bar-fit").flex_none().gap(6).items_center().on_size_change((size) => this.fit(size))
        .when(panels.length > 0, el => el.mr(4).child(h_flex().flex_none().gap(2).items_center().children(panels.map(panelButton)))));
  }
}
