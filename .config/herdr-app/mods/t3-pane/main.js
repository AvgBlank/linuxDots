// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "t3-pane" } } } }
// Shows the program's icon (the app's program table), the agent's name or
// the terminal's title, the folder, and the agent's status; buttons split, zoom and close
// this pane. Props from the app: { pane, terminal }. Click: focus the pane.
// Its sub-agents: a count in the header that opens their list, this mod again as a popup with { kids: terminal }.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, Popup } from "gpui-base";
import { panes, terminals, agents, spaces, props, run, theme, home, openOverlay, closeOverlay, settings, setShared } from "herdr";
import { modStatus, namer, programOf } from "./name.js";
import { agentKids, kidStatus, notNews, ownStatus, subAgents, treeStatus } from "./tree.js";
import { projectMark } from "./project.js";
import { detailsFor, detailsAt, detailsLine, detailsCard } from "./details.js";
import { programIcon } from "./program.js";
import { tip, tipMark, glow, POINTER_WATCH, pointerAt, pointerGone, pointerMoved } from "./tip.js";
import { stopsInit, stopsEnd, stop, focusRoot, within, pressed, justClosed } from "./focus.js";
import { menuJump, scrollList } from "./list.js";

// The list as the layout's other menus (the sort menu, the right-click menu): 4 around, a 28px heading over 28px rows.
const KIDS_WIDTH = 280, KIDS_SHOWN = 10, KIDS_ROW = 28, KIDS_CLOSED = "t3-pane.kidsClosed";
const WORD = { working: "Working", blocked: "Needs you", idle: "Idle" };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Everything an agent started, a step in for each level, as the agents list nests them, each with its own status:
// as T3's rows, one waiting on a stuck one under it is still at work, and that one says it's stuck.
function kidRows(addr) {
  const all = terminals(), listed = new Map(agents().map((a) => [a.address, a.status]));
  const walk = (at, depth, seen) => {
    if (seen.has(at)) return [];
    seen.add(at);
    // A shell between them isn't listed (tree.js): what it started stands where it would have.
    return agentKids(all, at, seen).flatMap((k) => [{ k, depth, st: kidStatus(k, listed) }, ...walk(k.address, depth + 1, seen)]);
  };
  return walk(addr, 0, new Set());
}
const kidName = (k) => k.name || k.template || k.program?.name || k.address;

// How long it's been working, as the Inbox's Working pill: 9s, 4m, 1h 5m.
function took(ms, now) {
  const s = Math.max(0, Math.floor((now - ms) / 1000)), m = Math.floor(s / 60);
  return s < 60 ? `${s}s` : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

// T3's ThreadRelationshipIcon: the program's 16px icon, its status an 8px dot on the bottom right corner, ringed in the panel's color.
function kidIcon(t, k, st) {
  const dot = st === "working" ? t.working : st === "blocked" ? t.blocked : t.muted + "73";
  // As the menus' icons, it hangs 2 into the padding and the gap.
  return div().relative().size(16).mx(-2).flex_none().flex().items_center().justify_center()
    .child(programIcon(k.program, 16, t.muted) ?? svg("mods/workspace-chrome/terminal.svg").size(16).flex_none().text_color(t.muted))
    .child(div().absolute().right(-4).bottom(-4).size(8).rounded_full().border(2).border_color(t.popover).bg(dot));
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}


export default class Pane extends View {
  init(_props, cx) {
    if (props()?.kids) {
      // The list takes the keyboard, as the shipped menu does; as T3's, nothing's lit until a key or the pointer arrives.
      this.at = -1;
      this.keys = cx.focus_handle();
      this.keys.focus();
      // A working one's time runs on, as the Inbox's pill. With all of them ended, the list goes.
      this.clock = cx.timer.every(1000, (cx) => {
        if (kidRows(props().kids).length === 0) closeOverlay(props().overlay);
        else cx.notify();
      });
      // A row's details card (details.js): which is up or fading, and its timers.
      this.details = this.detailsOut = this.hovered = null;
      this.detailsWait = this.detailsFade = this.detailsWatch = null;
      return;
    }
    this.hovered = false;
    stopsInit(this, cx);
  }

  async close() {
    if (props()?.kids) {
      for (const w of [this.clock, this.detailsWait, this.detailsFade, this.detailsWatch]) w?.cancel();
      setShared(KIDS_CLOSED, Date.now());
    }
    else stopsEnd(this);
  }

  // The sub-agents' list, drawn as the layout's other menus: a heading with the counts over 28px rows, each the program's icon
  // with its status dot, the name, and how long it's been working or its status word; stepped in by level. A pick peeks that one and closes it.
  kidsMenu(t) {
    const rows = kidRows(props().kids), done = () => closeOverlay(props().overlay), now = Date.now();
    if (this.at >= rows.length) this.at = rows.length - 1;
    const peek = (k) => { done(); run("terminal.peek", { terminal: k.address }); };
    const count = (st) => rows.filter((r) => r.st === st).length, busy = count("working"), stuck = count("blocked");
    const heading = [plural(rows.length, "agent", "agents"), busy && `${busy} working`, stuck && `${stuck} need${stuck === 1 ? "s" : ""} you`].filter(Boolean).join(" · ");
    // T3's text-2xs with tabular figures: the time in monospace children, one per part, as the Inbox's pill.
    const mono = settings()?.font_family ?? "JetBrains Mono";
    // No status_ms is a status unchanged since it began: working since it was made.
    const since = (k) => k.status_ms || k.created_ms || 0;
    const trail = (k, st) => st === "blocked" ? div().text_color(t.blocked).child(WORD.blocked)
      : st === "working" ? (since(k) > 0 ? h_flex().gap(4).children(took(since(k), now).split(" ").map((part) => div().font_family(mono).child(part))) : div().child(WORD.working))
      : div().child(WORD[st] ?? "");
    // Each row's details, the agents list's card for a sub-agent: its space, machine, branch and program. Hung on the row's left,
    // as the list stands at the window's right. One with no pane of its own is in its parent's space, and has no branch to name.
    const ps = panes(), sp = spaces(), parent = ps.find((p) => p.terminal === props().kids);
    const spaceOf = (p) => p && sp.find((s) => (s.tabs ?? []).some((b) => b.id === p.tab));
    const details = (k) => {
      const key = k.address;
      if (this.details !== key && this.detailsOut !== key) return null;
      const own = ps.find((p) => p.terminal === k.address), space = spaceOf(own) ?? spaceOf(parent);
      const machine = k.address.includes("/") ? k.address.split("/")[0] : null, pic = programIcon(k.program, 12, t.muted);
      // Its right edge 4 off the list's: the list's 4 in, then 4, as the agents list's card stands off its row.
      return Popup.new(`details-${key}`, div()).absolute().top(-1).left(-9).size(1).anchor("top_right")
        .content(detailsCard(this, t, key, kidName(k), [
          space && detailsLine(t, projectMark(space, 12, t, ps, true), space.name),
          machine && detailsLine(t, svg("mods/t3-pane/icons/server.svg").size(12).flex_none().text_color(t.muted), machine),
          own?.branch && detailsLine(t, svg("mods/t3-pane/icons/git-branch.svg").size(12).flex_none().text_color(t.muted), own.branch),
          pic && detailsLine(t, div().flex_none().opacity(0.6).child(pic), k.program.name),
        ], { from: 4 }));
    };
    // As tall as it is: the popup opens with no height, so it grows and shrinks as sub-agents come and go.
    return v_flex().id("pane-kids").w_full().min_h(0).p(4).bg(t.popover).text_size(14)
      .track_focus(this.keys).on_key_down((e, cx) => {
        if (e.key === "enter") { if (rows[this.at]) peek(rows[this.at].k); }
        else if (e.key === "escape") done();
        else {
          const to = menuJump(this, e, rows.map(({ k }) => kidName(k)), this.at);
          if (to < 0) return;
          this.at = to;
        }
        cx.stop_propagation();
        cx.notify();
      })
      // The sort menu's heading.
      .child(div().px(8).py(6).flex_none().min_w(0).truncate().text_size(12).line_height("16px").font_medium().text_color(t.muted).child(heading))
      .child(scrollList(this, "pane-kids-list", { count: rows.length, row: KIDS_ROW, height: Math.min(rows.length, KIDS_SHOWN) * KIDS_ROW, at: this.at,
        wheeled: (keep) => { if (keep >= 0) this.at = keep; },
        draw: (i) => {
          const { k, depth, st } = rows[i];
          // The menus' row: 8 in, 8 between, radius 4, lit with the selection; a level steps in by the icon's 16.
          const card = details(k);
          return h_flex().id(`kid-${k.address}`).relative().h(KIDS_ROW).pl(8 + depth * 16).pr(8).gap(8).rounded(4).items_center().flex_none()
            .text_color(t.foreground).when(i === this.at, (el) => el.bg(t.selected))
            .role("button").accessibility_label(WORD[st] ? `${kidName(k)}, ${WORD[st]}` : kidName(k))
            .on_hover((on, cx) => {
              // As the agents list's rows: the next row's enter can come before this one's leave.
              if (on) { this.hovered = k.address; detailsFor(this, k.address, cx); }
              else if (this.hovered === k.address) { this.hovered = null; detailsFor(this, null, cx); }
              const to = on ? i : this.at === i ? -1 : this.at;
              if (to !== this.at) this.at = to;
              cx.notify();
            })
            .on_mouse_move((e) => detailsAt(this, k.address, e))
            .on_click(() => peek(k))
            .child(kidIcon(t, k, st))
            .child(div().flex_1().min_w(0).truncate().child(kidName(k)))
            // The right-click menu's shortcut column: 12px medium, dim.
            .child(div().flex_none().text_size(12).font_medium().text_color(t.dim).child(trail(k, st)))
            .when(Boolean(card), (el) => el.child(card));
        } }));
  }

  // How many sub-agents, all the way down, or how many need the person, as T3's details meta button; a click opens their list under it.
  kidsButton(t, pane, terminal) {
    const rows = kidRows(terminal);
    const id = `ph-kids-${pane}`, n = rows.length, stuck = rows.filter((r) => r.st === "blocked").length;
    const total = plural(n, "sub-agent", "sub-agents"), text = stuck ? `${stuck} need${stuck === 1 ? "s" : ""} you` : plural(n, "agent", "agents");
    const label = stuck ? `${total}, ${text}` : total;
    const color = stuck ? t.blocked : this.hot === id ? t.foreground : t.dim;
    // T3's META_ACTION: 24 high, 6 in, 4 apart, radius 6, 12px medium; the arrow is a select's 14.
    return tip(this, t, id, label, stop(this, t, id, h_flex().id(id).h(24).px(6).gap(4).flex_none().items_center().rounded(6)
      .text_size(12).font_medium().text_color(color).hover((s) => s.bg(t.hover)).on_hover(glow(this, id))
      .role("button").accessibility_label(label)
      .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); pressed(this); this.kidsFrom = e.bounds; })
      .on_click((_e, cx) => {
        cx.stop_propagation();
        const b = this.kidsFrom, z = Number(settings()?.zoom) || 1;
        this.kidsFrom = null;
        if (justClosed(this, KIDS_CLOSED)) return;
        this.hot = null; // The list covers it, before the pointer can report leaving it.
        // Hung from the button, right edges together, as the agents list's sort menu; no press (the keyboard), the app's default.
        openOverlay({ mod: "t3-pane", kind: "popup", width: KIDS_WIDTH,
          ...(b ? { at: { x: b.x + b.width - KIDS_WIDTH * z, y: b.y + b.height + 4 * z } } : {}), props: { kids: terminal } });
        cx.notify();
      })
      .child(div().child(text))
      .child(svg("mods/t3-pane/icons/chevron-down.svg").size(14).flex_none().text_color(color)), 8));
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

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, icon, label, action, key) {
    return tip(this, t, id, label, stop(this, t, id, div()
      .id(id)
      .size(24).flex_none().flex().items_center().justify_center()
      .rounded(8)
      // Its icon brightens by state: a hover style reaches text but not an svg, as in the inbox.
      .text_color(this.hot === id ? t.foreground : t.dim)
      .role("button").accessibility_label(label)
      .hover((s) => s.bg(t.hover))
      .on_hover(glow(this, id))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        action();
        cx.notify();
      })
      .child(svg(icon).size(14)), 8), { action: key });
  }

  render() {
    const t = theme();
    if (props()?.kids) return this.kidsMenu(t);
    const p = this.me();
    if (!p) return div();
    // Headers are for splits (t3-tabs syncHeader takes the layout's away for a lone pane; this covers the moment before).
    if (panes().filter((q) => q.tab === p.tab).length < 2) return div();
    // Home's default page says nothing of itself: the brand bar's lit mark tells where this is.
    const named = p.mod === "t3-home" ? "" : namer()(p);
    const pic = programIcon(programOf(p), 14, t.muted);
    // A name that is only the program's says what its icon already does.
    const name = !p.mod && pic && named === p.program?.name ? "" : named;
    // Its agent with the sub-agents it started (tree.js).
    const all = terminals();
    const kids = subAgents(agents(), all)(p.terminal);
    const st = p.mod ? modStatus(p) : treeStatus(ownStatus(p.status, p.terminal, all), kids);
    const pane = p.pane;
    // A mark takes the last button's 24px, so it, the × and the tab bar's + share one column: this header's pr(2), the frame's 2 and the block's 8 are the bar's 12.
    const slot = (mark) => div().w(24).flex_none().flex().items_center().justify_center().child(mark);
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
      // The terminal's own right-click menu (the layout's terminal_menu, at its 220×260), whose Copy address gives the address.
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "t3-menu", kind: "popup", width: 220, height: 260, props: { tab: "pane", target: { pane, terminal: p.terminal } } }); })
      .child(div().size(16).mr(-4).flex_none().flex().items_center().justify_center().when(Boolean(pic), (el) => el.child(pic)))
      .when(Boolean(name), (el) => el.child(div().min_w(0).truncate().font_medium().text_color(p.focused ? t.foreground : t.muted).child(name)))
      .child(div().relative().flex_1().min_w(0).h_full().ml(6).flex().items_center()
        .child(div().flex_1().min_w(0).truncate().pr(12).text_color(t.dim).child(folder(p.cwd)))
        // Over the folder's end, so hovering moves nothing else, as in the agents list and the inbox.
        .when(this.hovered || within(this, [head, ...tools]), el => el.child(h_flex().absolute().top(0).bottom(0).right(0).pl(12).flex_none().gap(4).items_center().bg(t.background)
          .child(this.button(t, `ph-r-${pane}`, "mods/t3-pane/icons/square-split-horizontal.svg", "Split right", () => run("pane.split", { direction: "right", pane }), "pane.split:right"))
          .child(this.button(t, `ph-d-${pane}`, "mods/t3-pane/icons/square-split-vertical.svg", "Split down", () => run("pane.split", { direction: "down", pane }), "pane.split:down"))
          .child(this.button(t, `ph-z-${pane}`, `mods/t3-pane/icons/${p.zoomed ? "minimize-2" : "maximize-2"}.svg`, p.zoomed ? "Unzoom pane" : "Zoom pane", () => run("pane.zoom", { pane }), "pane.zoom"))
          .child(this.button(t, `ph-x-${pane}`, "mods/t3-pane/icons/x.svg", "Close pane", () => { this.hot = null; run(`t3-tabs.close-pane:${pane}`); }, "pane.close")))))
      .when(Boolean(p.terminal && kids.length), (el) => el.child(this.kidsButton(t, pane, p.terminal)))
      .when(st === "working", el => el.child(slot(tipMark(this, t, `ph-mark-${pane}`, "Working", svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))))
      // The same marks as the agents list and tabs.
      .when(st === "blocked", el => el.child(slot(tipMark(this, t, `ph-mark-${pane}`, "Needs you", div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(11).font_bold().text_color(t.blocked).flex().items_center().justify_center().accessibility_label("Needs you").child("!")))))
      .when(st === "done" && !notNews(all.find(k => k.address === p.terminal), p.status, kids), el => el.child(slot(tipMark(this, t, `ph-mark-${pane}`, "Done", div().size(6).flex_none().rounded_full().bg(t.done))))), 8));
  }
}
