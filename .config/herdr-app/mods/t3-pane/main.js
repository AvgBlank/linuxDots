// A pane's header, for layouts that frame their panes (`"pane": { "header": { "content": { "mod": "t3-pane" } } }`): the program's icon,
// the agent's name or the terminal's title, its folder, sub-agents button, and split, zoom and close; with props { kids: terminal }, its sub-agents' list.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { panes, terminals, agents, spaces, props, run, theme, home, openOverlay, closeOverlay, settings, shared, setShared, layout } from "herdr";
import { namer, programOf } from "./name.js";
import { kidStatus, kidTree, subAgents } from "./tree.js";
import { statusMark, STATUS_WORD, took } from "./status-mark.js";
import { programIcon } from "./program.js";
import { tip, glow, POINTER_WATCH, pointerAt, pointerGone, pointerMoved } from "./tip.js";
import { stopsInit, stopsEnd, stop, focusRoot, within } from "./focus.js";
import { trigger, hang } from "./trigger.js";
import { menuJump, scrollList, litProp, propsLit } from "./list.js";
import { menuRow, menuHint, MENU_ROW } from "./menu-row.js";
import { sidebarParts } from "./sidebar.js";
import { KEY, closedKey } from "./store.js";
import { openMenu } from "./menu.js";
import { button as drawButton, radiusOf, GROUP_GAP } from "./button.js";

// The list as the layout's other menus (the sort menu, the right-click menu): 4 around 28px rows.
const KIDS_WIDTH = 280, KIDS_SHOWN = 10, KIDS_CLOSED = closedKey("t3-pane", "kids");
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const kidName = (k) => k.name || k.template || k.program?.name || k.address;

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}


export default class Pane extends View {
  init(_props, cx) {
    if (props()?.kids) {
      // Take the keyboard; a row lights only after a key or the pointer arrives.
      this.kidLit = propsLit() >= 0 ? undefined : null;
      this.keys = cx.focus_handle();
      this.keys.focus();
      // A working one's time runs on, as the Inbox's pill. With all of them ended, the list goes.
      this.clock = cx.timer.every(1000, (cx) => {
        if (!kidTree(terminals(), props().kids).length) closeOverlay(props().overlay);
        else cx.notify();
      });
      return;
    }
    this.hovered = false;
    stopsInit(this, cx);
  }

  async close() {
    if (props()?.kids) {
      this.clock?.cancel();
      setShared(KIDS_CLOSED, Date.now());
    }
    else stopsEnd(this);
  }

  // Everything the agent started, a step in for each level, as the agents list nests them, each with its own status:
  // one waiting on a stuck one under it is still at work, and that one says it's stuck.
  kidsMenu(t) {
    const { kids, overlay } = props(), listed = new Map(agents().map((a) => [a.address, a.status]));
    const rows = kidTree(terminals(), kids), now = Date.now();
    if (this.kidLit === undefined) this.kidLit = rows[0]?.k.address ?? null;
    const view = this;
    // The menu helpers speak in row indices; only the address survives a draw.
    const cursor = {
      get at() { return rows.findIndex(({ k }) => k.address === view.kidLit); },
      set at(i) { view.kidLit = rows[i]?.k.address ?? null; },
    };
    if (cursor.at < 0) this.kidLit = null;
    const labels = rows.map(({ k }) => kidName(k));
    const pick = (address, cx, menu = false) => {
      if (!address) return;
      if (!kidTree(terminals(), kids).some(({ k }) => k.address === address)) {
        if (this.kidLit === address) this.kidLit = null;
        cx.notify();
        return;
      }
      closeOverlay(overlay);
      if (menu) openMenu(this, "agent", { address }, cx);
      else run("terminal.peek", { terminal: address });
    };
    // T3's text-2xs with tabular figures: the time in monospace children, one per part, as the Inbox's pill.
    const mono = settings()?.font_family ?? "JetBrains Mono";
    // No status_ms means unchanged since creation, for working and idle alike.
    const since = (k) => k.status_ms || k.created_ms || 0;
    // Its status at the row's end, the Agents rows' mark; needing the person or failed, the word too; working or idle, for how long.
    const trail = (k, st) => STATUS_WORD[st] && h_flex().id(`kid-status-${k.address}`).flex_none().gap(4).items_center()
      .role("status").accessibility_label(STATUS_WORD[st])
      .when(st !== "idle", (el) => el.child(h_flex().w(12).flex_none().justify_center().child(statusMark("mods/t3-pane", t, st))))
      .when(st === "blocked" || st === "error", (el) => el.child(menuHint(t, STATUS_WORD[st]).text_color(st === "error" ? t.ansi1 : t.blocked)))
      .when((st === "working" || st === "idle") && since(k) > 0, (el) => el.children(took(since(k), now).split(" ").map((part) => menuHint(t, part).font_family(mono))));
    // As tall as it is: the popup opens with no height, so it grows and shrinks as sub-agents come and go.
    return v_flex().id("pane-kids").w_full().min_h(0).p(4).bg(t.popover)
      .track_focus(this.keys).on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(overlay);
        else if (e.key === "enter" || e.key === "space") pick(this.kidLit, cx);
        else {
          const next = labels.length ? menuJump(this, e, labels, cursor.at) : -1;
          if (next < 0) return;
          cursor.at = next;
        }
        cx.stop_propagation(); cx.notify();
      })
      .child(scrollList(this, "pane-kids-list", { count: rows.length, row: MENU_ROW, height: Math.min(rows.length, KIDS_SHOWN) * MENU_ROW, at: cursor.at,
        wheeled: (keep) => { if (keep >= 0) cursor.at = keep; },
        draw: (i) => {
          const { k, depth } = rows[i];
          // A level steps in by the icon's 16: the spacer and the row's gap.
          return menuRow(this, t, `kid-${k.address}`, { at: [cursor, "at", i], label: labels[i], pick: (cx) => pick(k.address, cx),
            lead: depth > 0 ? div().w(depth * 16 - 8).flex_none() : undefined,
            icon: programIcon(k.program, 16, t.muted) ?? "mods/t3-pane/icons/terminal.svg",
            trail: trail(k, kidStatus(k, listed)),
            also: (row) => row.on_mouse_down("right", (_e, cx) => pick(k.address, cx, true)) });
        } }));
  }

  // How many sub-agents, all the way down, as T3's details meta button, in the colour of needing the person if one does;
  // a click opens their list under it. `kids`: their words (subAgents).
  kidsButton(t, pane, terminal, kids) {
    const stuck = kids.filter((s) => s === "blocked").length, busy = kids.filter((s) => s === "working").length;
    const label = [plural(kids.length, "sub-agent", "sub-agents"), stuck && `${stuck} need${stuck === 1 ? "s" : ""} you`, busy && `${busy} working`].filter(Boolean).join(", ");
    // Hung from the button, right edges together, as the agents list's sort menu; no press (the keyboard), the app's default.
    return trigger(this, t, `ph-kids-${pane}`, { wide: true, label, size: "xs", surface: "card", color: stuck ? t.blocked : undefined, closed: KIDS_CLOSED,
      onOpen: (b) => { openOverlay({ mod: "t3-pane", kind: "popup", width: KIDS_WIDTH, ...hang(b, KIDS_WIDTH), props: { kids: terminal, ...litProp(!b) } }); } },
    (el) => el.when(busy > 0, (b) => b.child(statusMark("mods/t3-pane", t, "working"))).child(String(kids.length))
      .child(svg("mods/t3-pane/icons/chevron-down.svg").size(14).flex_none()));
  }

  // What shows on hover also watches where the pointer is: its leave can be dropped (tip.js).
  headHover(on, cx) {
    this.hovered = on;
    this.box = null;
    this.hoverWatch?.cancel();
    if (on) {
      const from = pointerAt();
      this.hoverWatch = cx.timer.every(POINTER_WATCH, (cx) => {
        if (!pointerGone(this.box, from)) return;
        this.hoverWatch.cancel();
        this.hovered = false;
        cx.notify();
      });
    }
    cx.notify();
  }

  button(t, id, icon, label, action, key) {
    return tip(this, t, id, label, stop(this, t, id, drawButton(t, id, { icon, label, surface: "card", hot: this.hot === id })
      .on_hover(glow(this, id))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        action();
        cx.notify();
      }), radiusOf("xs")), { action: key });
  }

  render() {
    const t = theme();
    if (props()?.kids) return this.kidsMenu(t);
    const ps = panes(), p = ps.find((q) => q.pane === props()?.pane), sp = p && spaces();
    // Home has no header, mod or shell (docs/adr/0005): nothing to split, zoom or close, and Home itself tells where this is.
    if (!p || sp.find((s) => s.id === shared(KEY.home))?.tabs.some((c) => c.id === p.tab)) return div();
    // Headers are for splits (t3-tabs syncHeader takes the layout's away for a lone pane; this covers the moment before).
    if (ps.filter((q) => q.tab === p.tab).length < 2) return div();
    const every = agents(), all = terminals(), named = namer({ terminals: all, spaces: sp, agents: every })(p);
    const pic = programIcon(programOf(p), 14, t.muted);
    // A name that is only the program's says what its icon already does.
    // With the Inbox the bar's breadcrumb names the agent in view: an agent's pane shown alone (its tab's only one, or zoomed)
    // doesn't say it again. Split, the names tell the panes apart.
    const alone = p.zoomed || ps.filter((q) => q.tab === p.tab).length === 1;
    const inbox = sidebarParts(layout()).stack?.active === "inbox";
    const crumbed = alone && inbox && every.some((a) => a.address === p.terminal);
    const name = crumbed || (!p.mod && pic && named === p.program?.name) ? "" : named;
    // Split, the panes beside the focused one recede, as T3's split terminals do, with no ring: their icon, name and folder a
    // step down, back up while hovered. Its buttons stay as they are.
    const quiet = !alone && !p.focused && !this.hovered;
    // What this agent started speaks through the sub-agent button (tree.js).
    const kids = subAgents(every, all)(p.terminal);
    const pane = p.pane;
    // The buttons show with the keyboard on the header or one of them, as they do hovered: the header's the stop that gets there.
    const head = `pane-head-${pane}`, tools = ["r", "d", "z", "x"].map((k) => `ph-${k}-${pane}`);
    // The rounded frame paints the background; rectangular child fills would cover its corners.
    return focusRoot(this, stop(this, t, head, h_flex()
      .id(head)
      .size_full()
      // 4 + the frame's 2 is a tab's 6: with its 16px slot and 2 to the name, the icon and first word stand under the first tab's.
      .pl(4)
      .pr(2)
      .gap(6)
      .items_center()
      .text_size(14)
      .on_hover((on, cx) => this.headHover(on, cx))
      .on_mouse_move((e) => { pointerMoved(e.position); this.box = e.bounds; })
      .on_click(() => run("pane.focus", { pane }))
      // The terminal's own right-click menu (the layout's terminal_menu), whose Copy address copies the address.
      .on_mouse_down("right", (_e, cx) => openMenu(this, "pane", { pane, terminal: p.terminal }, cx))
      .child(div().id(`ph-icon-${pane}`).size(16).mr(-4).flex_none().flex().items_center().justify_center().when(quiet, (el) => el.opacity(0.5)).when(Boolean(pic), (el) => el.child(pic)))
      .when(Boolean(name), (el) => el.child(div().id(`ph-name-${pane}`).min_w(0).truncate().font_medium().text_color(p.focused ? t.foreground : t.muted).when(quiet, (e) => e.opacity(0.5)).child(name)))
      .child(div().relative().flex_1().min_w(0).h_full().ml(6).flex().items_center()
        .child(div().id(`ph-folder-${pane}`).flex_1().min_w(0).truncate().pr(12).text_color(t.dim).when(quiet, (el) => el.opacity(0.5)).child(folder(p.cwd)))
        // Over the folder's end, so hovering moves nothing else, as in the agents list and the inbox.
        .when(this.hovered || within(this, [head, ...tools]), el => el.child(h_flex().absolute().top(0).bottom(0).right(0).pl(12).flex_none().gap(GROUP_GAP).items_center().bg(t.background)
          .child(this.button(t, `ph-r-${pane}`, "mods/t3-pane/icons/square-split-horizontal.svg", "Split right", () => run("pane.split", { direction: "right", pane }), "pane.split:right"))
          .child(this.button(t, `ph-d-${pane}`, "mods/t3-pane/icons/square-split-vertical.svg", "Split down", () => run("pane.split", { direction: "down", pane }), "pane.split:down"))
          .child(this.button(t, `ph-z-${pane}`, `mods/t3-pane/icons/${p.zoomed ? "minimize-2" : "maximize-2"}.svg`, p.zoomed ? "Unzoom pane" : "Zoom pane", () => run("pane.zoom", { pane }), "pane.zoom"))
          .child(this.button(t, `ph-x-${pane}`, "mods/t3-pane/icons/x.svg", "Close pane", () => { this.hot = null; run(`t3-tabs.close-pane:${pane}`); }, "t3-tabs.close-pane")))))
      .when(Boolean(p.terminal && kids.length), (el) => el.child(this.kidsButton(t, pane, p.terminal, kids))), 8));
  }
}
