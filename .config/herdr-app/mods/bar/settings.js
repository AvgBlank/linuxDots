// The Customize panel (t3-chrome's palette button, or bar.settings): how new agents open and which
// controls the top bar shows. Drawn as Herdr's own Settings (frame/settings): sections on the left, rows on the right.
// Panels share bettr's keys with bettr-chrome's Layout dialog: "bettr.panels" and "bettr.agentView".
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { run, props, closeOverlay, theme, shared, setShared, layout } from "herdr";
import { machinesPage } from "./machines.js";

export const PANELS = [["files", "Files", "list-tree"], ["changes", "Changes", "git-compare"], ["activity", "Activity", "activity"], ["context", "Context", "gauge"]];
export const enabledPanels = () => shared("bettr.panels") ?? [...(shared("workspace.panels") ?? ["files", "changes"]), "activity", "context"];
export const chatSwitchOn = () => shared("bar.chatSwitch") ?? true;
export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) { const found = find(child, id); if (found) return found; }
  return null;
}
export const CUSTOMIZE_SIZE = { width: 760, height: 480 };

const icon = (name) => `mods/bar/icons/${name}.svg`;
const SECTIONS = [{ id: "agents", title: "Agents", icon: "chat" }, { id: "chat", title: "Chat", icon: "type" }, { id: "bar", title: "Top bar", icon: "layers" }, { id: "machines", title: "Machines", icon: "server" }];
// The chat's text size (the chat mod reads shared "chat.fontSize"; keep its default and range in step).
const CHAT_FONT = 14, CHAT_FONT_MIN = 11, CHAT_FONT_MAX = 20;
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

function agentsPage(t) {
  const now = shared("bettr.agentView") ?? "terminal";
  const picker = h_flex().p(2).gap(2).rounded(8).border_1().border_color(t.border).bg(t.background)
    .children([["terminal", "Terminal"], ["chat", "Chat"]].map(([value, label]) => div().id(`cz-view-${value}`).px(12).py(4).rounded(6).text_size(13).cursor_pointer()
      .when(now === value, (el) => el.bg(t.raised).text_color(t.foreground).border_1().border_color(t.border))
      .when(now !== value, (el) => el.text_color(t.muted).hover((s) => s.text_color(t.foreground)))
      .on_click(() => setShared("bettr.agentView", value)).child(label)));
  return v_flex().w_full().child(heading(t, "New agents"))
    .child(row(t, "Open agents in", "Claude Code, Codex and Hermes start in their terminal, or in a chat that stands for it.", picker));
}

// Settings' − value + (frame/settings stepper).
function stepper(t, id, value, onMinus, onPlus) {
  const b = (k, label, f) => div().id(`${id}-${k}`).w(28).h(28).flex().items_center().justify_center().cursor_pointer().text_size(15)
    .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(f).child(label);
  return h_flex().items_center().rounded(7).border_1().border_color(t.border).bg(t.raised).overflow_hidden()
    .child(b("minus", "\u2212", onMinus))
    .child(div().w(54).text_size(13).text_color(t.foreground).flex().justify_center().child(value))
    .child(b("plus", "+", onPlus));
}

function chatPage(t) {
  const now = Number(shared("chat.fontSize")) || CHAT_FONT;
  const set = (v) => setShared("chat.fontSize", Math.min(CHAT_FONT_MAX, Math.max(CHAT_FONT_MIN, v)));
  return v_flex().w_full().child(heading(t, "Text"))
    .child(row(t, "Font size", `Messages and what you type. Default ${CHAT_FONT}px.`,
      h_flex().gap(8).items_center()
        .when(now !== CHAT_FONT, (el) => el.child(div().id("cz-font-reset").text_size(12).text_color(t.dim).cursor_pointer()
          .hover((s) => s.text_color(t.foreground)).on_click(() => setShared("chat.fontSize", null)).child("Reset")))
        .child(stepper(t, "cz-font", `${now}px`, () => set(now - 1), () => set(now + 1)))))
    .child(div().pt(18).child(div().text_size(Math.min(CHAT_FONT_MAX, now)).line_height(`${Math.round(now * 1.5)}px`).text_color(t.muted)
      .child("The quick brown fox jumps over the lazy dog.")));
}

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
    .child(heading(t, "Agent"))
    .child(row(t, "Chat switch", "Chat | Terminal for an agent with a chat, and Move to chat for one without.",
      toggle(t, "cz-chat-switch", chatSwitchOn(), () => setShared("bar.chatSwitch", !chatSwitchOn()))))
    .child(div().h(18))
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
        .child(div().px(28).py(22).child(view.section === "bar" ? barPage(t, view) : view.section === "chat" ? chatPage(t)
          : view.section === "machines" ? machinesPage(t, { heading, row, button }) : agentsPage(t))))
      .child(Scrollbar.vertical("cz-body").absolute().inset_0()));
}
