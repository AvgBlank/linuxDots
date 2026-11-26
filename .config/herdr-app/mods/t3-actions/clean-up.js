// Clean up (docs/internals/specs/dialogs.md#clean-up), drawn as Inbox is: Settled and Idle shells shelves folded to their counts, then Left behind cards.
// t3-tabs.cleanup opens it: props { settled: [row + terminal], shells: [row + terminal], cards: [row + process], command: { name } | null }, a row { pane, name, space, spaceId, machine, program }.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, closeOverlay, props, panes, spaces, focused, agents, terminals } from "herdr";
import { stopsInit, stop, focusRoot, onStop, within } from "./focus.js";
import { button, radiusOf, tint } from "./button.js";
import { glow } from "./tip.js";
import { programIcon } from "./program.js";
import { ownStatus, stillSettled, subAgents } from "./tree.js";
import { alpha } from "./color.js";
import { projectMark } from "./project.js";
import { dialog, dialogTitle, dialogButton } from "./dialog.js";

const cleanUpAnd = (list) => list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;

export function initCleanUp(view, cx) {
  view.ask = cx.focus_handle();
  view.ask.focus();
  view.openSettled = false;
  view.openShells = false;
  view.overRow = null;
  view.overCard = null;
  view.closing = false;
  stopsInit(view, cx, "modal");
}

const hovers = (view, id) => (over, cx) => {
  const to = over ? id : view.hot === id ? null : view.hot;
  if (to !== view.hot) { view.hot = to; cx.notify(); }
};

const hoverCleanRow = (view, id) => (over, cx) => {
  const to = over ? id : view.overRow === id ? null : view.overRow;
  if (to !== view.overRow) { view.overRow = to; cx.notify(); }
};

const hoverCard = (view, id) => (over, cx) => {
  const to = over ? id : view.overCard === id ? null : view.overCard;
  if (to !== view.overCard) { view.overCard = to; cx.notify(); }
};

// The space's own mark, as Inbox's cards wear it; a space already gone keeps a plain one. `all`, `ps`: spaces() and panes(),
// read once a draw (each read copies them).
const marker = (t, all, ps) => (r) => projectMark("mods/t3-actions", all.find((x) => x.id === r.spaceId) ?? { id: r.spaceId, name: r.space, machine: r.machine }, 16, t, ps, true);

// Fixed-width 54px right-end micro action (Close / Stop) so every row aligns with zero hover reflow.
function actionButton(view, t, id, { text, label, act }) {
  return stop(view, t, id, button(t, id, {
    text,
    variant: "ghost",
    size: "micro",
    surface: "card",
    label,
    hot: view.hot === id,
  }).w(54).cursor_pointer()
    .on_hover(glow(view, id))
    .on_click((_e, cx) => { cx.stop_propagation(); act(); }), radiusOf("micro"));
}

// As Inbox's shelf header: a dim label, its count, a chevron when it folds; what it implies and a per-shelf Close at the right.
/** @param {any} view @param {any} t @param {string} id @param {string} label @param {number} count
 *  @param {{ open?: boolean, side?: string | null, toggle?: (e: any, cx: any) => void, action?: { id: string, label: string, act: () => void } | null }} o */
function shelfHead(view, t, id, label, count, { open = false, side = null, toggle = undefined, action = null }) {
  const lit = view.hot === id || within(view, [id]);
  const actBtn = action ? actionButton(view, t, action.id, { text: "Close", label: action.label, act: action.act }) : null;
  const head = h_flex().id(id).h(32).px(8).gap(6).items_center().rounded(6).text_size(12)
    .child(div().flex_none().text_color(lit ? t.muted : t.dim).child(label))
    .child(div().flex_none().text_color(t.muted).child(String(count)))
    .when(Boolean(toggle), (el) => el.child(svg(`mods/t3-actions/icons/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim)))
    .when(Boolean(side), (el) => el.child(div().flex_1().min_w(0).truncate().text_right().text_color(t.dim).child(side)))
    .when(!side && Boolean(actBtn), (el) => el.child(div().flex_1()))
    .when(Boolean(actBtn), (el) => el.child(side ? actBtn.ml(2) : actBtn));
  if (!toggle) return head;
  return stop(view, t, id, head.cursor_pointer().on_hover(hovers(view, id)).on_click(toggle)
    .role("button").accessibility_label(`${open ? "Hide" : "Show"} ${count} ${label.toLowerCase()}`), 6);
}

// What closes: Settled's slim row with fixed columns (mark, icon, name, space, Close) so hover never shifts widths.
function closeRow(view, t, prefix, r, done, mark, closePane) {
  const id = `${prefix}-${r.pane}`, closeId = `clean-up-close-pane-${r.pane}`;
  const lit = view.overRow === id || view.hot === id || view.hot === closeId || within(view, [id, closeId]);
  const icon = prefix === "clean-up-settled"
    ? (programIcon(r.program, 14, t.muted) ?? svg("mods/t3-actions/icons/terminal.svg").size(14).flex_none().text_color(t.muted))
    : svg("mods/t3-actions/icons/terminal.svg").size(14).flex_none().text_color(t.muted);
  const meta = h_flex().flex_none().max_w(180).gap(6).items_center().text_size(12).text_color(t.dim)
    .child(div().min_w(0).truncate().child(r.space))
    .when(Boolean(r.machine), (el) => el
      .child(svg("mods/t3-actions/icons/server.svg").size(12).flex_none().text_color(t.dim))
      .child(div().flex_none().max_w(80).truncate().child(r.machine)));
  const closeBtn = closePane
    ? actionButton(view, t, closeId, { text: "Close", label: `Close ${r.name}`, act: () => closePane(r.pane) })
    : null;
  return stop(view, t, id, h_flex().id(id).h(32).px(8).gap(8).items_center().rounded(6).cursor_pointer()
    .when(lit, (el) => el.bg(tint(t, "card", false)))
    .on_hover(hoverCleanRow(view, id)).on_click(() => { done(); run(`t3-tabs.go-pane:${r.pane}`, {}); })
    .role("button").accessibility_label(`Go to ${r.name}`)
    .child(div().flex_none().opacity(lit ? 1 : 0.4).child(mark(r)))
    .child(div().flex_none().opacity(0.6).child(icon))
    .child(div().flex_1().min_w(0).truncate().text_color(lit ? t.foreground : t.muted).child(r.name))
    .child(meta)
    .when(Boolean(closeBtn), (el) => el.child(closeBtn)), 6);
}

// A program left behind, as Inbox's card: space, process and Stop fixed on line 1, name on line 2. A click goes
// there; Stop stops it at once, a word rather than the ×s that open a dialog elsewhere.
function card(view, t, c, done, mark) {
  const id = `clean-up-card-${c.pane}`, stopId = `clean-up-stop-${c.pane}`;
  const lit = view.overCard === id || view.hot === id || view.hot === stopId || within(view, [id, stopId]);
  // A process the name already says isn't said twice (t3-tokens P5).
  const proc = c.process && c.process.toLowerCase() !== c.name.toLowerCase() ? c.process : null;
  const stopBtn = actionButton(view, t, stopId, { text: "Stop", label: `Stop ${c.name}`, act: () => stopCard(c.pane) });
  // A card on the dialog's face: a 4% fill at rest so it reads as one, the card surface's 7% hovered.
  const row = v_flex().id(id).px(8).py(8).rounded(6).cursor_pointer()
    .bg(lit ? tint(t, "card", false) : alpha(t.foreground, "0a"))
    .on_hover(hoverCard(view, id)).on_click(() => { done(); run(`t3-tabs.go-pane:${c.pane}`, {}); })
    .role("button").accessibility_label(`Go to ${c.name}`)
    .child(h_flex().h(20).gap(6).items_center().text_size(12).text_color(t.dim)
      .child(mark(c))
      .child(div().flex_1().min_w(0).truncate().child(c.space))
      .when(Boolean(c.machine), (el) => el.child(svg("mods/t3-actions/icons/server.svg").size(12).flex_none().text_color(t.dim)).child(div().flex_none().child(c.machine)))
      .when(Boolean(proc), (el) => el.child(div().flex_none().font_family("monospace").child(proc)))
      .child(stopBtn))
    .child(h_flex().h(20).mt(4).gap(6).items_center()
      .child(div().flex_1().min_w(0).truncate().text_color(lit ? t.foreground : t.muted).child(c.name))
      .child(div().flex_none().opacity(0.6).child(programIcon(c.program, 14, t.muted) ?? svg("mods/t3-actions/icons/terminal.svg").size(14).flex_none().text_color(t.muted))));
  return stop(view, t, id, row, 6);
}

const stopCard = (pane) => run(`t3-tabs.stop-pane:${pane}`, {});

// The card or expanded row Ctrl+D acts on: the one holding the keyboard, else the one under the pointer.
function litTarget(view, settled, shells, cards) {
  const id = onStop(view) ?? view.overCard ?? view.overRow ?? view.hot;
  const c = cards.find((x) => id === `clean-up-card-${x.pane}` || id === `clean-up-stop-${x.pane}`);
  if (c) return { kind: "card", pane: c.pane };
  const s = (view.openSettled ? settled : []).find((x) => id === `clean-up-settled-${x.pane}` || id === `clean-up-close-pane-${x.pane}`);
  if (s) return { kind: "settled", pane: s.pane };
  const sh = (view.openShells ? shells : []).find((x) => id === `clean-up-shell-${x.pane}` || id === `clean-up-close-pane-${x.pane}`);
  return sh ? { kind: "shell", pane: sh.pane } : null;
}

export function cleanUpView(view, cx = undefined) {
  const t = theme(), p = props() ?? {}, done = () => closeOverlay(p.overlay);
  const ps = panes(), all = spaces(), ags = agents(), terms = terminals(), mark = marker(t, all, ps);
  const byPane = new Map(ps.map((x) => [x.pane, x]));
  const tabNow = focused()?.tab ?? all.find((s) => s.active)?.tabs?.find((c) => c.active)?.id;
  const byAgent = new Map(ags.map((a) => [a.address, a]));
  const byAddr = new Map(terms.map((k) => [k.address, k]));
  const kids = subAgents(ags, terms);
  const stillSettledRow = (r) => {
    const pane = byPane.get(r.pane);
    if (!pane || (tabNow && pane.tab === tabNow)) return false;
    const term = pane.terminal ?? r.terminal;
    if (r.terminal && pane.terminal && pane.terminal !== r.terminal) return false;
    if (!term) return false;
    const a = byAgent.get(term), k = byAddr.get(term);
    return Boolean(a && k && stillSettled(k, ownStatus(a.status, term, terms), kids(term)));
  };
  const stillShell = (r) => {
    const pane = byPane.get(r.pane);
    if (!pane || (tabNow && pane.tab === tabNow)) return false;
    const term = pane.terminal ?? r.terminal;
    if (r.terminal && pane.terminal && pane.terminal !== r.terminal) return false;
    if (!term) return true;
    const k = byAddr.get(term);
    return !byAgent.has(term) && !pane.program?.agent && k?.status == null && !kids(term).length;
  };
  // A row goes as its pane does or stops being idle: stopped here, or changed anywhere; counts and closing spaces follow.
  const settled = (p.settled ?? []).filter(stillSettledRow);
  const shells = (p.shells ?? []).filter(stillShell);
  const cards = (p.cards ?? []).filter((c) => byPane.has(c.pane));
  const total = settled.length + shells.length, both = settled.length > 0 && shells.length > 0;
  if (!total && !cards.length && !view.closing) {
    view.closing = true;
    if (cx?.timer) cx.timer.after(0, () => done());
    else done();
  }
  const closingSpaces = (set) => set.size ? all.filter((s) => {
    const tabs = new Set((s.tabs ?? []).map((c) => c.id)), mine = ps.filter((x) => tabs.has(x.tab));
    return mine.length > 0 && mine.every((x) => set.has(x.pane));
  }) : [];
  const settledSet = new Set(settled.map((r) => r.pane)), shellsSet = new Set(shells.map((r) => r.pane));
  const closingSettled = closingSpaces(settledSet);
  const closingShells = closingSpaces(shellsSet);
  const closingAll = closingSpaces(new Set([...settledSet, ...shellsSet]));
  const singleClosed = new Set([...closingSettled, ...closingShells].map((s) => s.id));
  const combinedCloses = both && closingAll.some((s) => !singleClosed.has(s.id));
  const runScoped = (suffix) => { if (!p.command) return; run(`${p.command.name}:${suffix}`, p.command.args ?? {}); };
  const closePane = p.command ? (pane) => runScoped(`pane:${pane}`) : null;
  const yes = () => { if (!total || !p.command) return; done(); run(p.command.name, p.command.args ?? {}); };
  const toggleSettled = (_e, cx) => { view.openSettled = !view.openSettled; cx.notify(); };
  const toggleShells = (_e, cx) => { view.openShells = !view.openShells; cx.notify(); };
  const scopeNote = "Skips the tab you're on, and programs in the space you're in.";
  const noteText = combinedCloses ? `Closes ${cleanUpAnd(closingAll.map((s) => s.name))}. ${scopeNote}` : scopeNote;
  return focusRoot(view, dialog("action-clean-up", t).track_focus(view.ask)
    .on_key_down((e, cx) => {
      // On a row or a button, Enter is its own.
      if (e.key === "enter") { if (onStop(view)) return; if (total > 0) yes(); else done(); }
      else if (e.key === "escape") done();
      else if (e.key === "d" && e.modifiers?.control) {
        const hit = litTarget(view, settled, shells, cards);
        if (!hit) return;
        if (hit.kind === "card") stopCard(hit.pane);
        else if (closePane) closePane(hit.pane);
        else return;
      }
      else return;
      cx.stop_propagation();
    })
    .child(div().px(24).pt(24).pb(12).child(dialogTitle(t, "Clean up")))
    .child(v_flex().id("clean-up-body").px(16).gap(8).max_h(420).overflow_y_scrollbar()
      .when(settled.length > 0, (el) => el.child(v_flex()
        .child(shelfHead(view, t, "clean-up-settled", "Settled", settled.length, {
          open: view.openSettled,
          toggle: toggleSettled,
          side: closingSettled.length ? `closes ${cleanUpAnd(closingSettled.map((s) => s.name))}` : null,
          action: p.command ? { id: "clean-up-close-settled", label: `Close ${settled.length} settled ${settled.length === 1 ? "agent" : "agents"}`, act: () => runScoped("settled") } : null,
        }))
        .when(view.openSettled, (el) => el.child(v_flex().gap(1).children(settled.map((r) => closeRow(view, t, "clean-up-settled", r, done, mark, closePane)))))))
      .when(shells.length > 0, (el) => el.child(v_flex()
        .child(shelfHead(view, t, "clean-up-shells", "Idle shells", shells.length, {
          open: view.openShells,
          toggle: toggleShells,
          side: closingShells.length ? `closes ${cleanUpAnd(closingShells.map((s) => s.name))}` : null,
          action: p.command ? { id: "clean-up-close-shells", label: `Close ${shells.length} idle ${shells.length === 1 ? "shell" : "shells"}`, act: () => runScoped("shells") } : null,
        }))
        .when(view.openShells, (el) => el.child(v_flex().gap(1).children(shells.map((r) => closeRow(view, t, "clean-up-shell", r, done, mark, closePane)))))))
      .when(cards.length > 0, (el) => el.child(v_flex()
        .child(shelfHead(view, t, "clean-up-left", "Left behind", cards.length, { side: "no agent at work" }))
        .child(v_flex().gap(5).children(cards.map((c) => card(view, t, c, done, mark)))))))
    // The reason last (P9), on a line of its own level with the title, clear of the buttons.
    .child(div().id("clean-up-note").px(24).pt(12).text_size(12).line_height("16px").text_color(t.dim)
      .child(noteText))
    .child(h_flex().id("clean-up-footer").mt_auto().px(24).pt(20).pb(24).gap(8).items_center().justify_end()
      .child(dialogButton(view, t, "clean-up-no", total ? "Cancel" : "Done", "outline", done))
      .when(total > 0, (el) => el.child(dialogButton(view, t, "clean-up-yes", `${both ? "Close all" : "Close"} ${total}`, "danger", yes)))));
}
