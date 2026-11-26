import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, openOverlay, closeOverlay, settings } from "herdr";
import { layoutConfig, layoutSize, checkMachines } from "./layout-config.js";
import { sampler } from "./system.js";

// Numbers use the terminals' font (Herdr's `font_family` setting), else Herdr's
// default. Read once per render.
let font = "JetBrains Mono";
const mono = el => el.font_family(font);
const readFont = () => { font = settings()?.font_family || "JetBrains Mono"; };

// The footer's sample interval; slower while the window is in the background.
// Windows starts PowerShell for each sample, so it samples less often.
const POLL_MS = 3000, WINDOWS_POLL_MS = 10000, BACKGROUND_POLL_MS = 15000;
// How agents are ordered under their space; bettr-spaces reads the id from `bettr.agentSort`.
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "order", label: "Tab order", icon: "layers" },
];
const sortOf = () => SORTS.find(s => s.id === shared("bettr.agentSort")) ?? SORTS[0];
const percent = value => value === null ? "—" : `${Math.round(value)}%`;
// A stat over 70% is in the theme's `working` colour, over 90% `blocked`. Compared as
// shown (rounded), so "70%" is never coloured.
const load = (value, t) => value === null ? t.muted : Math.round(value) > 90 ? t.blocked : Math.round(value) > 70 ? t.working : t.muted;
const gigabytes = bytes => `${(bytes / 2 ** 30).toFixed(1).replace(/\.0$/, "")} GB`;
// What the footer shows of a sample, to redraw only when it changes.
const shown = s => s ? [s.cpu, s.gpu, s.ram].map(percent).join() + (s.total ? gigabytes(s.used) : "") : "";

export default class WorkspaceChrome extends View {
  init(_props, cx) {
    // The footer shows this machine's use, sampled every POLL_MS; a sample's own time counts.
    this.stats = null;
    if (props()?.layoutConfig) cx.spawn(async cx => { await checkMachines(cx); });
    if (!props()?.footer) return;
    cx.spawn(async cx => {
      for (;;) {
        const start = Date.now(), before = shown(this.stats);
        // Asked each time: when Herdr starts with this layout, the platform is not known yet.
        const sample = sampler(window()?.platform);
        try { this.stats = sample ? await sample() : null; } catch { this.stats = null; }
        if (shown(this.stats) !== before) cx.notify();
        const every = window()?.active === false ? BACKGROUND_POLL_MS : window()?.platform === "windows" ? WINDOWS_POLL_MS : POLL_MS;
        await cx.sleep(Math.max(0, every - (Date.now() - start)));
      }
    });
  }
  button(id, label, action) {
    const t = theme();
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  // CPU, GPU and RAM in percent, in the terminals' font. GPU is hidden when the OS gives none.
  footer(t) {
    const s = this.stats ?? { cpu: null, gpu: null, ram: null };
    const items = [["CPU", s.cpu], ...(s.gpu === null ? [] : [["GPU", s.gpu]]), ["RAM", s.ram]];
    const tip = [...items.map(([name, value]) => `${name} ${percent(value)}`),
      ...(s.total ? [`${gigabytes(s.used)} / ${gigabytes(s.total)}`] : [])].join(" · ");
    // The number next to its label; its box keeps a fixed minimum width, so the footer does not move.
    const stat = ([name, value]) => h_flex().gap(4).items_baseline()
      .child(div().text_color(t.dim).child(name))
      .child(div().min_w(28).text_color(load(value, t)).child(percent(value)));
    return mono(h_flex().id("system")).size_full().bg(t.chrome).border_t(1).border_color(t.border).px(16)
      .items_center().justify_between().text_size(11).tooltip(tip)
      .children(items.map(stat));
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex().w_full().p(5).bg(t.popover).text_size(13)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Sort agents in each space"))
      .children(SORTS.map(s => h_flex().id(`sort-${s.id}`).h(31).px(8).gap(9).rounded(7).items_center()
        .text_color(t.foreground).hover(el => el.bg(t.hover))
        .on_click(() => { setShared("bettr.agentSort", s.id); closeOverlay(props().overlay); })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, el => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  render() {
    const t = theme();
    readFont();
    if (props()?.layoutConfig) return layoutConfig(t);
    if (props()?.sortMenu) return this.sortMenu(t);
    if (props()?.footer) return this.footer(t);
    return h_flex().size_full().bg(t.chrome).pl(14).pr(10).pt(8).gap(4).items_center().text_size(13)
      .when(window()?.platform === "macos" && !window()?.fullscreen, el => el.pl(76))
      // The name gives way first when the buttons need the room.
      .child(h_flex().flex_1().min_w(0).overflow_hidden().gap(8).items_center().child(image("frame/welcome/herdr.png").size(20).rounded(5)).child(div().font_semibold().text_color(t.foreground).child("Herdr")))
      .child(this.button("search", svg("mods/workspace-chrome/search.svg").size(15), () => run("mod.open", { name: "picker" })))
      .child(this.button("layout-config", svg("mods/bettr-chrome/icons/palette.svg").size(15),
        () => openOverlay({ mod: "bettr-chrome", kind: "dialog", ...layoutSize(), props: { layoutConfig: true } }))
        .tooltip("Layout"))
      // A dot on the gear when an app update is ready.
      .child(this.button("settings", svg("mods/workspace-chrome/settings.svg").size(14), () => run("app.settings"))
        .relative().tooltip("Settings")
        .when(Boolean(updates().app.ready), b => b.child(div().absolute().top(4).right(4).size(6).rounded_full().bg(t.accent))))
      .child(this.button("agent-sort", svg(`mods/workspace-chrome/${sortOf().icon}.svg`).size(14),
        () => openOverlay({ mod: "bettr-chrome", kind: "popup", width: 200, height: 140, props: { sortMenu: true } }))
        .tooltip(`Sort agents: ${sortOf().label}`))
      // The tab bar shows it again (bettr-tabs), as do ⌘B and ctrl-a p.
      .child(this.button("hide-sidebar", svg("mods/workspace-chrome/panel-left.svg").size(15), () => run("layout.hide", { id: "sidebar" }))
        .tooltip("Hide sidebar (⌘B)"));
  }
}
