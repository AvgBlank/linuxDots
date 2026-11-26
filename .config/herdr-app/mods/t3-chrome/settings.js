// The layout's settings dialog, opened by t3-tabs (`t3-tabs.settings`). Herdr's own Settings copied (frame/settings/main.js):
// its sizes, type and theme colors as they are there, not T3's, so it reads as Herdr's. What it holds is t3.settings (docs/adr/0009).
import { div, svg } from "gpui-kit";
import { h_flex, v_flex, Select, Popup } from "gpui-base";
import { theme, props, closeOverlay, run, shared, setShared, appHome, readTextFile, exec, layout } from "herdr";
import { SETTINGS, t3Settings } from "./layout-settings.js";
import { stopsInit, stop, focusRoot } from "./focus.js";
import { menuKeys, openLit } from "./list.js";
import { menuRow } from "./menu-row.js";
import { sidebarParts } from "./sidebar.js";
import { keyOf } from "./tip.js";

const SECTIONS = [
  { id: "home", title: "Home", icon: "mods/t3-chrome/icons/house.svg" },
  { id: "sidebar", title: "Sidebar", icon: "mods/t3-chrome/icons/panel-left.svg" },
];
// A row's value is t3.settings' `key`, unless it has `get` and `set`: what the sidebar shows is the layout's own stack, which
// its key (`also`, named in the hint as keys.json binds it) switches too, so it's read from there each time and never copied into t3.settings.
const ROWS = [
  { section: "home", key: "afterAway", title: "After putting away", about: "Settling, snoozing or dragging away the agent in view.", options: () => [["home", "Home"], ["next", "Next card"]] },
  { section: "home", key: "homeMod", title: "Home shows", about: "A terminal, or a mod that offers itself with \"home\": true in its mod.json.", options: (view) => view.homeMods },
  { section: "sidebar", key: "sidebarShows", title: "Sidebar shows", about: "The Inbox, or the Spaces and Agents lists.", also: "t3-tabs.sidebar", options: () => [["inbox", "Inbox"], ["lists", "Lists"]],
    get: () => sidebarParts(layout()).stack?.active ?? "lists", set: (child) => run("layout.select", { stack: "sidebar-lists", child }) },
];
// Home as a shell, not a mod (homeMod null): an agent started there turns that space into an ordinary one (t3-tabs/navigation.js).
const TERMINAL = [null, "Terminal"];

export function initSettings(view, cx) {
  view.keys = cx.focus_handle();
  view.keys.focus();
  stopsInit(view, cx, "modal");
  view.homeMods = [];
  view.section = SECTIONS[0].id;
  // The row whose menu is open, and each row's handles: its button's, and its menu's while open.
  view.picking = null;
  view.pickAt = -1;
  view.pick = Object.fromEntries(ROWS.map((r) => [r.key, { focus: cx.focus_handle(), keys: cx.focus_handle() }]));
  findHomeMods(view, cx);
}

// The mods that can be Home: `"home": true` in their mod.json.
// The layout's own page reads Default, as its title is Home's own name; Terminal comes next.
async function findHomeMods(view, cx) {
  const dir = `${appHome()}/mods`, names = (await exec("ls", [dir]).catch(() => null))?.stdout.split("\n").filter(Boolean) ?? [];
  const found = (await Promise.all(names.map(async (name) => {
    try { return { name, ...JSON.parse(await readTextFile(`${dir}/${name}/mod.json`) ?? "{}") }; } catch { return null; }
  }))).filter((m) => m?.home);
  view.homeMods = found.map((m) => [m.name, m.name === "t3-home" ? "Default" : m.title ?? m.name]).sort((a, b) => Number(b[0] === "t3-home") - Number(a[0] === "t3-home") || a[1].localeCompare(b[1]));
  view.homeMods.splice(view.homeMods[0]?.[0] === "t3-home" ? 1 : 0, 0, TERMINAL);
  cx.notify();
}

export function settingsView(view) {
  const t = theme(), now = t3Settings(), done = () => closeOverlay(props().overlay);
  // What Home shows changes at once, as the person picking it expects to see.
  const pick = (key, value) => {
    setShared(SETTINGS, { ...shared(SETTINGS), [key]: value });
    if (key === "homeMod") run("t3-tabs.home-mod");
  };
  // Herdr's row: what it is on the left, the control on the right.
  const row = (r) => {
    const key = r.also && keyOf(r.also);
    return h_flex().w_full().gap(16).py(12).items_center().border_b(1).border_color(t.border)
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(div().text_size(14).text_color(t.foreground).child(r.title))
        .child(div().text_size(12.5).line_height("18px").text_color(t.dim).child(key ? `${r.about} ${key} switches it too.` : r.about)))
      .child(menu(r));
  };
  // The layout's menu, as the agents list's sort menu, on the kit's Select as the Snooze unit's: hung 4px under the button, as
  // wide; nothing lit until a key or the pointer gets there; ↑/↓, Home, End, typeahead, Enter or Space, Esc; the one in use ticked.
  const menu = (r) => {
    const value = r.get ? r.get() : now[r.key];
    const options = r.options(view), id = `st-${r.key}`, label = options.find(([v]) => v === value)?.[1] ?? value;
    const { focus, keys } = view.pick[r.key], open = view.picking === r.key;
    // Opened by keys (Enter or Space on the button: no press), its first row lit; by the pointer, none (list.js openLit).
    const show = (on, keys = false) => { view.picking = on ? r.key : null; view.pickAt = openLit(on && keys); };
    const choose = (picked) => {
      show(false);
      focus.focus();
      if (picked === value) return;
      if (r.set) r.set(picked);
      else pick(r.key, picked);
    };
    const trigger = stop(view, t, id, h_flex().id(id).w_full().h(32).px(11).gap(8).rounded(8).border_1().border_color(t.border).bg(t.raised).items_center().cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_hover((on) => { view.overPick = on ? r.key : null; })
      .role("button").accessibility_label(`${r.title}: ${label}`)
      .on_mouse_down("left", () => { view.pickPress = true; })
      .on_click((_e, cx) => {
        show(!open, !view.pickPress);
        view.pickPress = false;
        (open ? focus : keys).focus();
        cx.notify();
      })
      .child(div().flex_1().min_w(0).truncate().text_size(13.5).text_color(t.foreground).child(label))
      .child(svg("mods/t3-chrome/icons/chevron-down.svg").size(14).mr(-4).flex_none().text_color(t.muted)), 8, { handle: focus });
    const list = v_flex().id(`${id}-menu`).w(220).mt(4).p(4).rounded(8).bg(t.popover).border_1().border_color(t.border).shadow_lg().text_size(14)
      .track_focus(keys)
      // The trigger's own click toggles, so a press on it isn't "elsewhere".
      .on_mouse_down_out((_e, cx) => { if (view.overPick !== r.key) { show(false); cx.notify(); } })
      // Its Esc here, before the dialog's own, which would close it.
      .on_key_down(menuKeys(view, options.map(([, l]) => l), (at) => choose(options[at][0]), { at: "pickAt", close: () => { show(false); focus.focus(); } }))
      .children(options.map(([v, name], i) => menuRow(view, t, `${id}-${v ?? "terminal"}`, { at: [view, "pickAt", i], label: name,
        trail: v === value ? svg("mods/t3-chrome/icons/check.svg").size(14).flex_none().text_color(t.foreground) : null, pick: (cx) => { choose(v); cx.notify(); } })
        .role("list_box_option").aria_selected(v === value)));
    return Select.new(id).w(220).flex_none().accessibility_label(r.title).open(open).track_focus(focus).content_focus_handle(keys)
      .on_open_change((on, cx) => { show(on); cx.notify(); })
      .child(Popup.new(`${id}-popup`, trigger).w_full().when(open, (el) => el.content(list)));
  };
  const nav = v_flex().flex_none().w(190).h_full().p(10).gap(2).border_r(1).border_color(t.border)
    .child(div().px(10).pt(6).pb(12).text_size(16).font_semibold().text_color(t.foreground).child("Herdr T3"))
    // Herdr's nav: the section shown on the raised fill, its icon in the accent; another muted, lit hovered. A click shows it.
    .children(SECTIONS.map((s) => {
      const on = view.section === s.id, id = `st-s-${s.id}`;
      return stop(view, t, id, h_flex().id(id).gap(10).px(10).py(7).items_center().rounded(7).cursor_pointer()
        .when(on, (el) => el.bg(t.raised)).when(!on, (el) => el.hover((st) => st.bg(t.hover)))
        .role("tab").aria_selected(on).accessibility_label(s.title)
        .on_click((_e, cx) => { view.section = s.id; view.picking = null; cx.notify(); })
        .child(svg(s.icon).size(15).text_color(on ? t.accent : t.muted))
        .child(div().flex_1().text_size(13.5).text_color(on ? t.foreground : t.muted).child(s.title)), 7);
    }));
  const section = SECTIONS.find((s) => s.id === view.section) ?? SECTIONS[0];
  return focusRoot(view, h_flex().id("settings").track_focus(view.keys).w_full().h(620).min_h(0).items_start()
    .on_key_down((e, cx) => {
      if (e.key !== "escape") return;
      done();
      cx.stop_propagation();
    })
    .child(nav)
    .child(div().flex_1().min_w(0).h_full().px(28).py(22)
      .child(div().pt(6).pb(8).text_size(12).font_semibold().text_color(t.dim).child(section.title.toUpperCase()))
      .children(ROWS.filter((r) => r.section === section.id).map(row))));
}
