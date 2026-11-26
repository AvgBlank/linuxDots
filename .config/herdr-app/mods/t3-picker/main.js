// Go to a pane (the shipped picker's mod.clone), drawn as T3's command palette: a row a pane, named and marked as its pane header is,
// so lazygit beside an agent is found as itself. The panes you were in lately lead, as T3's recent threads, so ⌘P, Enter goes back and forth.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, spaces, panes, agents, terminals, focused, run, closeOverlay, props, window, shared, setShared } from "herdr";
import { modStatus, namer, programOf } from "./name.js";
import { focusPane } from "./zoom.js";
import { notNews, ownStatus, subAgents, terminalByAddress, treeStatus } from "./tree.js";
import { statusMark } from "./status-mark.js";
import { projectMark } from "./project.js";
import { programIcon } from "./program.js";
import { step, scrollList } from "./list.js";
import { stopsInit, stop, focusRoot } from "./focus.js";
import { KEY, closedKey } from "./store.js";
import { footAction, paletteFooter } from "./palette.js";

// As T3's command item: 6 + a 20px title + a 16px line + 6.
const ROW = 48;
// The list's share of T3's 420 once its border, search, top and bottom insets and footer are in; the popup hugs its content.
const LIST_MAX = 420 - 2 - 48 - 8 - 8 - 41;

export default class Picker extends View {
  init(_props, cx) {
    stopsInit(this, cx, "modal");
    this.selection = null;
    this.filter = "";
    this.input = InputState.new({ placeholder: "Search terminals…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.selection = null; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.choose(this.selection, this.selection?.pane, cx));
    this.input.focus();
  }

  // For the buttons that open this: see justClosed in focus.js.
  close() { setShared(closedKey("t3-picker"), Date.now()); }

  // Every pane: the ones you were in lately first, newest first (the tab bar keeps them, t3-tabs.recent); then the current
  // space's, then its machine's, as New orders spaces, each space's in tab order; the pane you're in last. Typing, a name that
  // matches goes before a folder or space that does. `ps`, `all`: panes() and terminals(), read once a draw (each read copies them).
  items(ps = panes(), all = terminals()) {
    const q = this.filter.toLowerCase(), every = spaces(), runs = agents(), name = namer({ terminals: all, spaces: every, agents: runs }), kids = subAgents(runs, all), home = shared(KEY.home);
    const mine = every.find((s) => s.active)?.machine ?? null;
    const rank = (s) => (s.active ? 0 : (s.machine ?? null) === mine ? 1 : 2);
    // Home has its own key and nothing to find.
    const rows = every.filter((s) => s.id !== home).sort((a, b) => rank(a) - rank(b) || (a.machine ?? "").localeCompare(b.machine ?? "")).flatMap((s) => s.tabs.flatMap((c) =>
      ps.filter((p) => p.tab === c.id).map((p) => {
        const under = p.terminal ? kids(p.terminal) : [];
        return {
          key: `pane:${p.pane}`, p, s, label: name(p), program: programOf(p), team: under.length, under, here: s.active && c.active && p.focused,
          status: p.mod ? modStatus(p) : treeStatus(ownStatus(p.status, p.terminal, all), under),
          // A tab's own name only if someone gave it: else it's its position ("4") or what it was first, not what runs in it.
          words: [s.name, s.machine ?? "", c.named ? c.name : "", name(p), programOf(p)?.name ?? "", p.program?.key ?? "", (p.cwd ?? "").split(/[\\/]/).pop()],
        };
      })));
    // Not by `focused`: each tab has its own. The pane you're in is the recent list's first.
    const here = focused()?.pane, recent = (shared(KEY.recent) ?? []).filter((p) => p !== here);
    const place = (r) => r.p.pane === here ? Infinity : recent.includes(r.p.pane) ? recent.indexOf(r.p.pane) - recent.length : 0;
    const named = (r) => !q || r.label.toLowerCase().includes(q) ? 0 : 1;
    return rows.filter((r) => !q || r.words.join(" ").toLowerCase().includes(q))
      .map((r, i) => ({ r, i })).sort((a, b) => named(a.r) - named(b.r) || place(a.r) - place(b.r) || a.i - b.i).map(({ r }) => r);
  }

  choose(selection, pane, cx, closing = false) {
    if (!pane || this.selection !== selection) return;
    if (!this.items().some(item => item.p.pane === pane)) {
      if (selection.pane === pane) selection.pane = null;
      cx.notify();
      return;
    }
    closeOverlay(props().overlay);
    // The tab bar asks first while a program runs; a tab's last pane closes the tab.
    if (closing) run(`t3-tabs.close-pane:${pane}`);
    else focusPane(pane);
  }

  row(item, selection, ps, byAddress) {
    const pane = item.p.pane, t = theme(), on = selection.pane === pane, s = item.s, st = item.status;
    const mark = st === "done" && notNews(byAddress.get(item.p.terminal), item.p.status, item.under) ? null : statusMark("mods/t3-picker", t, st, 14);
    return h_flex().id(item.key).w_full().h(ROW).px(8).py(6).gap(8).rounded(4).items_center().flex_none()
      .role("button").accessibility_label(item.label)
      .when(on, (el) => el.bg(t.selected))
      .on_hover((over, cx) => { if (over && this.selection === selection && selection.pane !== pane) { selection.pane = pane; cx.notify(); } })
      .on_click((_e, cx) => this.choose(selection, pane, cx))
      // As T3's CommandPaletteTitleIcon: level with the title, not the row.
      .child(h_flex().w(16).h(20).pt(2).self_start().flex_none().items_center().justify_center().child(projectMark("mods/t3-picker", s, 16, t, ps, true)))
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().text_color(t.foreground).when(Boolean(item.here), (d) => d.font_medium()).child(item.label))
        .child(h_flex().min_w(0).gap(4).items_center().text_size(12).line_height("16px").text_color(t.dim)
          .child(programIcon(item.program, 12, t.muted) ?? svg("mods/t3-picker/icons/terminal.svg").size(12).flex_none().text_color(t.muted))
          .child(div().flex_none().text_color(t.muted).child(item.program?.name ?? "Terminal"))
          .child(div().flex_none().child("·"))
          // As T3 marks a remote thread: a server icon, then the name.
          .when(Boolean(s.machine), (el) => el
            .child(svg("mods/t3-picker/icons/server.svg").size(12).flex_none().text_color(t.muted))
            .child(div().flex_none().text_color(t.muted).child(`${s.machine} ·`)))
          .child(div().min_w(0).truncate().child(s.name + (item.team ? ` · +${item.team}` : "")))))
      .when(Boolean(mark), (el) => el.child(mark));
  }

  render() {
    const t = theme(), ps = panes(), all = terminals(), items = this.items(ps, all), byAddress = terminalByAddress(all);
    // Opens on the first row: the pane you were in before, or another; never the one you're in, where Enter would go nowhere.
    // Editing the query replaces this token. A missing pane clears the highlight instead of choosing the new first row.
    const selection = this.selection ??= { pane: undefined };
    if (selection.pane === undefined) selection.pane = items[0]?.p.pane;
    const index = () => items.findIndex(item => item.p.pane === selection.pane);
    const at = index();
    if (at < 0 && selection.pane !== undefined) selection.pane = null;
    return focusRoot(this, v_flex().id("picker").size_full().min_h(0).rounded(16).border(1).border_color(t.border).bg(t.popover).shadow_2xl().text_size(14).line_height("20px")
      .on_key_down((e, cx) => {
        if (e.key === "escape") return closeOverlay(props().overlay);
        if (this.selection !== selection) return;
        const to = step(e, index(), items.length);
        if (to >= 0) selection.pane = items[to].p.pane;
        else if (e.key === "d" && e.modifiers.control) this.choose(selection, selection.pane, cx, true);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().h(36).my(6).flex_none().pl(18).pr(20).gap(7).items_center()
        .child(svg("mods/t3-picker/icons/search.svg").size(16).flex_none().text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(14).text_color(t.foreground)))
      // No heading: there is one kind of row, and the room goes to the list.
      .child(div().flex_none().mt(8).mb(8).px(8)
        .when(items.length > 0, (el) => el.child(scrollList(this, "picker-rows", { count: items.length, row: ROW, at, height: Math.min(items.length * ROW, LIST_MAX),
          draw: (i) => this.row(items[i], selection, ps, byAddress), wheeled: (keep) => { if (this.selection === selection) selection.pane = items[keep]?.p.pane ?? null; } })))
        .when(items.length === 0, (el) => el.child(div().py(40).text_center().text_color(t.dim).child("No matching terminals."))))
      // New work goes through New, which picks the space (and for a new space, the machine).
      .child(paletteFooter(t, [["↑ ↓", "Navigate"], ["Enter", "Go"], [window()?.platform === "macos" ? "⌃D" : "Ctrl+D", "Close pane"], ["Esc", "Close"]],
        stop(this, t, "picker-new", footAction(t, "picker-new", "New tab in…")
          .on_click(() => { closeOverlay(props().overlay); run("mod.open", { name: "t3-new-menu" }); })
          .child(svg("mods/t3-picker/icons/square-pen.svg").size(14).text_color(t.muted))
          .child("New tab in…"), 8))));
  }
}
