// The Customize panel (t3-chrome's palette button, or bar.customize): which controls the bar shows
// and agent reporter status per machine. Drawn as Herdr's own Settings (frame/settings).
// Panels share bettr's key with bettr-chrome's Layout dialog: "bettr.panels".
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { run, props, closeOverlay, theme, shared, setShared, layout } from "herdr";
import { machinesPage } from "./machines.js";

export const PANELS = [["files", "Files", "list-tree"], ["changes", "Changes", "git-compare"], ["activity", "Activity", "activity"], ["context", "Context", "gauge"]];
export const enabledPanels = () => shared("bettr.panels") ?? [...(shared("workspace.panels") ?? ["files", "changes"]), "activity", "context"];
export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) { const found = find(child, id); if (found) return found; }
  return null;
}
export const CUSTOMIZE_SIZE = { width: 760, height: 480 };

const icon = (name) => `mods/bar/icons/${name}.svg`;
const SECTIONS = [{ id: "bar", title: "Top bar", icon: "layers" }, { id: "machines", title: "Machines", icon: "server" }];
const ABOUT = {
  files: "The space's files, beside the terminals.",
  changes: "Git changes in the space, file by file.",
  activity: "What the agent is doing, tool by tool. Shown on tabs with an agent.",
  context: "How full the agent's context is. Shown on tabs with an agent.",
};

// Settings' helpers (frame/settings/main.js): a section heading, a row with its control, a toggle.
const heading = (t, text) => div().pt(6).pb(8).text_size(12).font_semibold().text_color(t.dim).child(text.toUpperCase());
const row = (t, title, about, control) => h_flex().w_full().gap(16).py(12).items_center().border_b(1).border_color(t.border)
  .child(v_flex().flex_1().min_w(0).gap(3).child(div().text_size(14).text_color(t.foreground).child(title))
    .when(Boolean(about), (el) => el.child(div().text_size(12.5).line_height("18px").text_color(t.dim).child(about))))
  .child(div().flex_none().child(control));
const button = (t, id, label, onClick) => div().id(id).px(12).py(5).rounded(7).border_1().border_color(t.border).bg(t.raised)
  .cursor_pointer().text_size(13).text_color(t.foreground).hover((s) => s.bg(t.hover)).on_click(onClick).child(label);
const toggle = (t, id, on, onClick) => div().id(id).w(36).h(20).rounded(10).p(2).cursor_pointer().bg(on ? t.accent : t.hover).flex()
  .when(on, (el) => el.justify_end()).on_click(onClick)
  .child(div().w(16).h(16).rounded(8).bg(on ? t.accent_foreground : t.muted));

// view: the TopBar copy in this dialog, for setPanels (closing a panel turned off while open).
function barPage(t, view) {
  const root = layout();
  const open = !find(root, "panel")?.hidden ? PANELS.map(([p]) => p).filter((p) => find(root, p) && !find(root, p).hidden) : [];
  const panel = ([id, label]) => {
    const on = enabledPanels().includes(id);
    return row(t, label, ABOUT[id], toggle(t, `cz-${id}`, on, () => {
      setShared("bettr.panels", on ? enabledPanels().filter((p) => p !== id) : [...enabledPanels(), id]);
      if (on && open.includes(id)) view.setPanels(open.filter((p) => p !== id), open);
    }));
  };
  const actions = !find(root, "actions")?.hidden;
  return v_flex().w_full()
    .child(heading(t, "Panels"))
    .children(PANELS.map(panel))
    .child(div().h(18))
    .child(heading(t, "Actions"))
    .child(row(t, "Actions", "Your project's actions (build, test, run) and Add action.",
      toggle(t, "cz-actions", actions, () => run(actions ? "layout.hide" : "layout.show", { id: "actions" }))));
}

export function customizeView(view) {
  const t = theme();
  const nav = v_flex().flex_none().w(190).h_full().p(10).gap(2).border_r(1).border_color(t.border)
    .child(div().px(10).pt(6).pb(12).text_size(16).font_semibold().text_color(t.foreground).child("Customize"))
    .children(SECTIONS.map((s) => {
      const on = s.id === view.section;
      return h_flex().id(`cz-s-${s.id}`).gap(10).px(10).py(7).items_center().rounded(7).cursor_pointer()
        .bg(on ? t.raised : "#00000000").hover((st) => st.bg(t.raised))
        .on_click((_e, cx) => { view.section = s.id; cx.notify(); })
        .child(svg(icon(s.icon)).size(15).text_color(on ? t.accent : t.dim))
        .child(div().flex_1().text_size(13.5).text_color(on ? t.foreground : t.muted).child(s.title));
    }));
  return h_flex().id("customize").track_focus(view.handle).size_full().min_h(0).items_start().bg(t.popover)
    .on_key_down((e, cx) => {
      if (e.key === "escape") closeOverlay(props().overlay);
      else if (e.key === "up" || e.key === "down") view.section = SECTIONS[(SECTIONS.findIndex((s) => s.id === view.section) + 1) % SECTIONS.length].id;
      else return;
      cx.stop_propagation();
      cx.notify();
    })
    .child(nav)
    .child(div().relative().flex_1().min_w(0).h_full()
      .child(div().id("cz-body").size_full().overflow_y_scroll()
        .child(div().px(28).py(22).child(view.section === "machines" ? machinesPage(t, { heading, row, button }) : barPage(t, view))))
      .child(Scrollbar.vertical("cz-body").absolute().inset_0()));
}
