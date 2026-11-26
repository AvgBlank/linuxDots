// The Layout dialog: switches that show or hide parts of this layout.
// Usage limits is a layout block (layout.show / layout.hide; Herdr keeps it).
// Files, Changes, Activity and Context are buttons in the tab bar (bettr-tabs), kept in
// shared "bettr.panels". Until changed here, Files and Changes follow Herdr's
// setup (the welcome's "workspace.panels"); Activity and Context, ours, are on.
// Other mods' panels (bettr-tabs/panel-mods.js) come from shared "bettr.modPanels", which
// bettr-tabs publishes. They are on until turned off here: shared "bettr.modPanelsOff".
// The arrows set the order of all the panels, in shared "bettr.panelOrder"; bettr-tabs applies it.
// Machines lists each connected machine and whether the agent reporter there
// (mods/bettr-reporter/setup.py: Activity and Context data) is set up and current; its
// button installs or updates it.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, layout, shared, setShared, exec, appHome, machines } from "herdr";

const remotes = () => machines().map((m) => m.name).filter(Boolean);
const modPanels = () => shared("bettr.modPanels") ?? [];
// The dialog's size when it opens: room for one row per mod panel and per machine.
export const layoutSize = () => ({ width: 340, height: 300 + 30 * modPanels().length + (remotes().length ? 54 + 30 * remotes().length : 0) });

// Per machine: { state, agents?, detail? }. state is checking, installing, current,
// old, missing or error. Kept while the app runs; checked again each time the dialog opens.
const reporter = new Map();
const LABELS = { checking: "Checking…", installing: "Installing…", current: "Up to date", old: "Out of date",
  missing: "Not set up", error: "Unreachable" };
const AGENT_NAMES = { claude: "Claude", codex: "Codex" };
const HOOK_STATES = { current: "hooks current", old: "hooks out of date", missing: "no hooks", absent: "not used" };

async function setup(mode, name) {
  try {
    const out = await exec("python3", ["-I", `${appHome()}/mods/bettr-reporter/setup.py`, mode, name]);
    if (out.code === 0) return JSON.parse(out.stdout.trim().split("\n").pop());
    return { state: "error", detail: (out.stderr || out.stdout).trim().split("\n").pop() };
  } catch (error) {
    return { state: "error", detail: error instanceof Error ? error.message : String(error) };
  }
}

async function step(cx, name, busy, mode) {
  reporter.set(name, { ...reporter.get(name), state: busy });
  cx.notify();
  const result = await setup(mode, name);
  reporter.set(name, mode === "install" && result.state !== "error" ? { ...result, installed: true } : result);
  cx.notify();
}

// Called when the dialog opens.
export const checkMachines = (cx) => Promise.all(remotes().map((name) => step(cx, name, "checking", "status")));

function detail(r) {
  if (r.detail) return r.detail;
  const agents = Object.entries(r.agents ?? {}).map(([a, s]) => `${AGENT_NAMES[a] ?? a}: ${HOOK_STATES[s] ?? s}`);
  return [`Reporter files: ${LABELS[r.files]?.toLowerCase() ?? "unknown"}`, ...agents].join(" · ");
}

function machineRow(t, name) {
  const r = reporter.get(name) ?? { state: "checking" };
  const color = { current: t.done, old: t.working, error: t.blocked }[r.state] ?? t.dim;
  const action = { old: "Update", missing: "Set up", error: "Retry" }[r.state];
  return h_flex().id(`machine-${name}`).h(30).gap(9).items_center()
    .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(name))
    .child(div().id(`machine-state-${name}`).text_size(12).text_color(color).child(LABELS[r.state])
      .when(r.state !== "checking" && r.state !== "installing", (el) => el.tooltip(detail(r))))
    .when(Boolean(action), (el) => el.child(div().id(`machine-action-${name}`).h(22).px(8).flex().items_center()
      .rounded(6).bg(t.input).text_size(12).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => cx.spawn(async (cx) => {
        if (r.state === "error") await step(cx, name, "checking", "status");
        else await step(cx, name, "installing", "install");
      }))
      .child(action)));
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Keep the same default in bettr-tabs/main.js (a mod cannot import another's files).
const panels = () => shared("bettr.panels") ?? [...(shared("workspace.panels") ?? ["files", "changes"]), "activity", "context"];

function setPanel(id, on) {
  const now = panels().filter((p) => p !== id);
  setShared("bettr.panels", on ? [...now, id] : now);
  // Turned off while open: bettr-tabs closes it, and the panel when no other is open.
}

const modPanelsOff = () => shared("bettr.modPanelsOff") ?? [];

function setModPanel(id, on) {
  const now = modPanelsOff().filter((p) => p !== id);
  setShared("bettr.modPanelsOff", on ? now : [...now, id]);
  // Turned off while open: bettr-tabs closes it, as for setPanel.
}

// The panels' rows, in the saved order. One with no saved position goes last.
function panelRows() {
  const order = shared("bettr.panelOrder") ?? [];
  const rank = (r) => { const i = order.indexOf(r.id); return i < 0 ? order.length : i; };
  return [
    ...[["files", "Files"], ["changes", "Changes"], ["activity", "Activity"], ["context", "Context"]].map(([id, label]) => (
      { id, label, on: () => panels().includes(id), set: (on) => setPanel(id, on) })),
    ...modPanels().map(({ id, title }) => (
      { id, label: title, on: () => !modPanelsOff().includes(id), set: (on) => setModPanel(id, on) })),
  ].sort((a, b) => rank(a) - rank(b));
}

function movePanel(all, from, to) {
  const ids = all.map((r) => r.id);
  [ids[from], ids[to]] = [ids[to], ids[from]];
  setShared("bettr.panelOrder", ids);
}

const rows = () => [
  { section: "Sidebar" },
  { id: "usage", label: "Usage limits", on: () => !find(layout(), "usage-limits")?.hidden,
    set: (on) => run(on ? "layout.show" : "layout.hide", { id: "usage-limits" }) },
  { section: "Panels" },
  ...panelRows().map((r, i, all) => ({ ...r, move: {
    up: i > 0 ? () => movePanel(all, i, i - 1) : null,
    down: i < all.length - 1 ? () => movePanel(all, i, i + 1) : null,
  } })),
];

// An arrow on a panel's row. It takes its own clicks, so the row does not toggle. `action` is null at the end of the list.
function arrow(t, id, direction, action) {
  return div().id(`layout-${id}-${direction}`).size(20).flex_none().flex().items_center().justify_center().rounded(5)
    .text_color(action ? t.dim : t.input)
    .when(Boolean(action), (el) => el.cursor_pointer().hover((s) => s.bg(t.input).text_color(t.foreground)))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); action?.(); cx.notify(); })
    .child(svg(`mods/bettr-chrome/icons/chevron-${direction}.svg`).size(14));
}

function toggle(t, on) {
  return div().w(28).h(16).p(2).flex_none().flex().rounded(8).bg(on ? t.accent : t.input)
    .when(on, (el) => el.justify_end())
    .child(div().size(12).rounded(6).bg(on ? t.accent_foreground : t.muted));
}

export function layoutConfig(t) {
  return v_flex().id("layout-config").size_full().min_h(0).overflow_y_scroll().p(18).gap(4).bg(t.popover).text_size(13)
    .child(h_flex().items_center().pb(6)
      .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Layout"))
      .child(div().id("layout-close").text_size(11).text_color(t.dim).cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click(() => closeOverlay(props().overlay)).child("Esc")))
    .children(rows().map((r) => r.section
      ? div().pt(10).pb(2).text_size(11).text_color(t.dim).child(r.section)
      : h_flex().id(`layout-${r.id}`).h(30).px(8).mx(-8).gap(9).items_center().rounded(7).cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { r.set(!r.on()); cx.notify(); })
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(r.label))
        .when(Boolean(r.move), (el) => el.child(h_flex().flex_none().gap(2)
          .child(arrow(t, r.id, "up", r.move.up))
          .child(arrow(t, r.id, "down", r.move.down))))
        .child(toggle(t, r.on()))))
    .when(remotes().length > 0, (el) => el
      .child(div().pt(10).pb(2).text_size(11).text_color(t.dim).child("Machines"))
      .children(remotes().map((name) => machineRow(t, name)))
      .when(remotes().some((name) => reporter.get(name)?.installed), (el) => el
        .child(div().pt(4).text_size(11).text_color(t.dim).child("Restart agent sessions there to load the new hooks."))));
}
