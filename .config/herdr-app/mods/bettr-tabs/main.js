import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, setShared, layout, settings, appHome, readTextFile, writeTextFile, watchFolder } from "herdr";
import { exists, readdir } from "fs/promises";
import { blocksDiffer, panelMod, withBlocks } from "./panel-mods.js";

// `color` (#rgb, #rrggbb or #rrggbbaa) at `alpha` (hex 00-ff); any other color as it is.
// The same helper is in bettr-spaces (a mod cannot import another's files).
const tint = (color, alpha) => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color)?.[1];
  if (!hex) return color;
  return `#${hex.length === 3 ? [...hex].map(c => c + c).join("") : hex.slice(0, 6)}${alpha}`;
};

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

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = (space?.tabs ?? []).filter((x) => !x.settled || x.active);
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
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id, confirmed: true }); }).child(svg("mods/pane/close.svg").size(12))));
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
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).pt(8).gap(6).items_center().bg(t.chrome)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .when(Boolean(sidebar?.hidden), el => el.child(button("show-sidebar", svg("mods/workspace-chrome/panel-left.svg").size(15), () => run("layout.show", { id: "sidebar" }))
        .tooltip("Show sidebar (⌘B)")))
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
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
