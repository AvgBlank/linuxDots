import { View, div, list, svg } from "gpui-kit";
import { Scrollbar, TextView, h_flex, v_flex } from "gpui-base";
import { agents, focused, props, settings, terminals, theme } from "herdr";
import { activityRows, activityState, agentNames, duration, focusedAgent, liveSubagents, verbTable } from "./model.js";

// Numbers and times use the terminals' font (Herdr's `font_family` setting), else Herdr's
// default. Read once per render.
let font = "JetBrains Mono";
const mono = el => el.font_family(font);
const readFont = () => { font = settings()?.font_family || "JetBrains Mono"; };

// A message row's line height; closed, a message shows one line.
const LINE = 17;
// The subagents section: rows of two fixed-height lines, with SUB_PAD above, between and
// below them. It is as tall as its rows, up to SUB_MAX; more rows scroll.
const SUB_TOP = 18, SUB_BOTTOM = 16, SUB_ROW = SUB_TOP + 2 + SUB_BOTTOM, SUB_PAD = 10, SUB_MAX = 200;
// A step row's Lucide icon (mods/bettr-activity/icons), by the verb the layout's
// `verbs` table gives it. Any other verb (a tool's own name) gets the wrench.
const ICONS = {
  Read: "text-initial", Searched: "search", Edited: "pen-line", Fetched: "globe", Spawned: "bot",
  Messaged: "message-square", Stopped: "ban", Asked: "message-circle-question-mark", Used: "wrench",
  Proposed: "square-chart-gantt", Staged: "message-square-diff", Committed: "git-commit-vertical",
  Pulled: "arrow-down-to-line", Pushed: "arrow-up-from-line", Tested: "bug", Ran: "terminal", Steered: "user",
  Notice: "corner-down-right",
};
const ICON = 13, ICON_GAP = 6;
// Detail and note rows start where a step's text does: after the icon.
const TEXT_START = 14 + ICON + ICON_GAP;
// A step row is 22 tall and a detail row 18: the difference, under an open section's last detail.
const DETAIL_END = 2;
// Step rows (icon and text) a little under the muted colour, so headings and replies lead.
const STEP = 0.8;
const icon = verb => `mods/bettr-activity/icons/${ICONS[verb] ?? "wrench"}.svg`;
// `color` (#rgb, #rrggbb or #rrggbbaa) at `alpha` (hex 00-ff); any other color as it is.
// The same helper is in bettr-spaces and bettr-tabs (a mod cannot import another's files).
const tint = (color, alpha) => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color)?.[1];
  if (!hex) return color;
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex.slice(0, 6)}${alpha}`;
};

// One line of text, cut with "…" when it does not fit. The toolkit draws that
// "…" in the text colour and cannot tell whether a line was cut, so it is not
// muted. A row of parts (`grep ×3, cd ×2`) is clipped at the edge without one.
function fitted(content, color) {
  return div().flex_1().min_w(0).truncate().text_color(color).child(content);
}

// Edit line counts (` +12 −3`): small, monospace, in the Context panel's green and red.
// Only the pair: a lone ` +2` is "2 more files".
const ADDED = "#7ecf86", REMOVED = "#ee7d7d";
function counted(value) {
  const pieces = value.split(/( \+\d+ −\d+)/).filter(Boolean);
  if (pieces.length === 1) return value;
  const number = (color, text) => mono(div()).text_size(11).text_color(color).child(text);
  return h_flex().items_baseline().children(pieces.map(piece => {
    const pair = /^ \+(\d+) −(\d+)$/.exec(piece);
    // A margin, not a space: a monospace space is too wide. The two counts touch.
    return pair ? h_flex().flex_none().items_baseline().ml(5).child(number(ADDED, `+${pair[1]}`))
      .child(number(REMOVED, `−${pair[2]}`)) : div().flex_none().child(piece);
  }));
}

// A line the reporter cut ends in "…": draw that mark muted, after the text.
function marked(value, t) {
  if (!value.endsWith("…")) return div().child(value);
  return h_flex().items_end().child(div().flex_1().min_w(0).child(value.slice(0, -1)))
    .child(div().flex_none().text_color(t.muted).child("…"));
}

export default class Activity extends View {
  init(_props, cx) {
    // Turns the user opened or closed, and step and message rows the user
    // opened, by row key. Keys of other sessions are dropped at render.
    this.expanded = new Map();
    this.open = new Set();
    this.rows = [];
    // Message rows whose text wraps past one line (so the closed row cuts it), by key.
    this.cut = new Set();
    this.verbs = { source: undefined, lookup: verbTable({}) };
    // Working turns' start times and the elapsed text last drawn: the timer
    // redraws only when that text changes (each second, or each minute past 1h).
    // A hidden copy is not drawn: once a redraw it asked for did not come, it waits.
    this.live = [];
    this.clock = "";
    this.asked = 0;
    this.drawn = 0;
    cx.timer.every(1000, cx => {
      if (!this.live.length || this.elapsed() === this.clock || this.asked > this.drawn) return;
      this.asked = Date.now();
      cx.notify();
    });
  }

  elapsed() {
    const now = Date.now() / 1000;
    return this.live.map(start => duration(now - start)).join(",");
  }

  toggle(key, cx) {
    const row = this.rows.find(item => item.key === key);
    if (!row) return;
    if (row.type === "prompt" || row.type === "older") {
      if (!row.expandable) return;
      this.expanded.set(key, !row.expanded);
    } else if (row.type === "detail" || row.expandable) {
      const target = row.type === "detail" ? row.parent : key;
      if (this.open.has(target)) this.open.delete(target); else this.open.add(target);
    } else {
      return;
    }
    cx.notify();
  }

  // Keep only keys of the shown session, so the sets do not grow forever.
  forget(session) {
    const prefix = `${session}#`;
    for (const key of this.expanded.keys()) if (!key.startsWith(prefix)) this.expanded.delete(key);
    for (const key of this.open) if (!key.startsWith(prefix)) this.open.delete(key);
    for (const key of this.cut) if (!key.startsWith(prefix)) this.cut.delete(key);
  }

  // GPUI wraps the measuring copy; taller than one line means the closed row cuts it.
  measured(key, height, cx) {
    const long = height > LINE + 1;
    if (long === this.cut.has(key)) return;
    if (long) this.cut.add(key); else this.cut.delete(key);
    cx.notify();
  }

  row(row, t) {
    if (row.type === "prompt") {
      return h_flex().w_full().h(36).px(14).gap(6).items_center()
        .when(!row.first, el => el.border_t(1).border_color(t.border))
        .when(row.expandable, el => el.cursor_pointer())
        .child(fitted(row.title, row.untitled ? t.dim : t.foreground).font_medium())
        .when(Boolean(row.elapsed), el => el.child(mono(div()).flex_none().text_size(11).text_color(t.dim)
          .child(row.elapsed)))
        .child(div().flex_none().text_size(11).text_color(t[row.tone]).child(row.status));
    }
    if (row.type === "message") {
      // The agent's text: full width, no verb. Closed, one line
      // cut with "…" (whether it is cut is measured in render()); opened, the agent's Markdown.
      return div().w_full().px(14).py(4).text_size(12).line_height(`${LINE}px`)
        .text_color(t.foreground)
        .when(row.expandable, el => el.cursor_pointer())
        .when(row.opened, el => el.child(row.markdown ? TextView.markdown(`md-${row.key}`, row.markdown)
          : v_flex().gap(4).children(row.lines.map(line => marked(line, t)))))
        .when(!row.opened, el => el.child(div().truncate().child(row.preview)));
    }
    if (row.type === "detail") {
      // The last one is taller below its text, so the section has equal space above and below its text.
      return h_flex().w_full().h(row.last ? 18 + DETAIL_END : 18).when(row.last, el => el.pb(DETAIL_END))
        .pl(TEXT_START).pr(14).items_center().text_size(11).bg(tint(t.raised, "55"))
        .child(fitted(row.diff ? counted(row.text) : row.text, t.muted));
    }
    if (row.type === "gap") return div().w_full().h(8);
    if (row.type === "note") {
      return div().w_full().h(20).pl(TEXT_START).pr(14).text_size(11).text_color(t.dim).truncate().child(row.text);
    }
    return h_flex().w_full().h(22).px(14).gap(ICON_GAP).items_center().text_size(12)
      .when(row.expandable, el => el.cursor_pointer())
      // An opened step and its details: the selected agent's background in the sidebar.
      .when(row.opened, el => el.bg(tint(t.raised, "55")))
      .accessibility_label([row.verb, row.text, row.repeat, row.tail].filter(Boolean).join(", "))
      // The verb is the icon; it stays in the accessibility label.
      // A fixed box, so every icon takes the same width and the texts start in one column.
      .child(div().w(ICON).min_w(ICON).max_w(ICON).h(ICON).flex_none().flex().items_center().justify_center()
        .child(svg(icon(row.verb)).size(ICON).flex_none().text_color(t.muted).opacity(STEP)))
      .child(fitted(row.parts
        // Names with muted counts: `grep ×3, cd ×2`.
        ? h_flex().children(row.parts.map((part, at) => h_flex().flex_none().child(part.name)
          .when(Boolean(part.count), el => el.child(div().text_color(t.muted).opacity(0.6).child(` ${part.count}`)))
          .when(at < row.parts.length - 1, el => el.child(", "))))
        : row.diff ? counted(row.text) : row.text, t.muted).opacity(STEP))
      .when(Boolean(row.repeat), el => el.child(mono(div()).flex_none().text_size(11).text_color(t.dim)
        .child(row.repeat)))
      .when(Boolean(row.tail), el => el.child(div().flex_none().text_size(11).text_color(t[row.tone])
        .child(row.tail)));
  }

  render() {
    this.drawn = Date.now();
    readFont();
    const t = theme(), all = terminals(), listed = agents();
    const parent = focusedAgent(focused(), all, listed);
    const state = activityState(parent);
    // The verb table is the layout block's `verbs` prop. Rebuild it only when it changes.
    const source = props()?.verbs;
    if (source !== this.verbs.source) this.verbs = { source, lookup: verbTable(source) };
    if (state) this.forget(state.sessionId);
    const built = activityRows(state, { now: Date.now() / 1000, names: agentNames(parent), open: this.open,
      expanded: this.expanded, verbs: this.verbs.lookup, cut: this.cut });
    this.rows = built;
    // The "Show N turns" toggle is in the header, so the list starts at the first turn.
    const older = built.find(row => row.type === "older");
    const rows = older ? built.filter(row => row !== older).map((row, i) => i ? row : { ...row, first: true }) : built;
    const subagents = liveSubagents(parent);
    this.live = [...rows.filter(row => row.type === "prompt" && row.live).map(row => row.startedAt),
      ...subagents.filter(row => row.startedAt !== null).map(row => row.startedAt)];
    this.clock = this.elapsed();

    const listId = `activity-rows-${state?.sessionId ?? "none"}`;
    const empty = !state ? "Focus an agent to see its activity"
      : !rows.length ? "No activity in this session" : "";

    return v_flex().id("activity").size_full().min_h(0).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(36).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().font_medium().child("Activity"))
        // Styled as the Cache header's hit rate, in the same place.
        .when(Boolean(older), el => el.child(div().id("activity-older").flex_none().text_size(11).text_color(t.dim)
          .cursor_pointer().hover(s => s.text_color(t.foreground))
          .tooltip(older.expanded ? "Hide the finished turns before the newest" : "Show the finished turns before the newest")
          .on_click((_e, cx) => this.toggle(older.key, cx))
          .child(`${older.expanded ? "Hide" : "Show"} ${older.count} turns`))))
      // With nothing to show, the message sits under the header, as in the Context panel.
      .when(Boolean(empty), el => el.child(v_flex().p(14).text_size(12).text_color(t.dim).child(empty)))
      .child(v_flex().id("activity-body").relative().flex_1().min_h(0).pb(6)
        .when(rows.length > 0, el => el
          // One list per session: a list keeps its scroll place by id, and a short session
          // shown with a long one's place would draw nothing.
          .child(list(listId, rows.length, index => rows[index].key, index => this.row(rows[index], t))
            .size_full()
            .on_item_click((key, cx) => this.toggle(key, cx)))
          .child(Scrollbar.vertical(listId).absolute().inset_0())
          // A list row that holds an element with on_size_change gets no height, so the closed
          // messages are measured here instead: invisible copies as wide as a row's text.
          .child(v_flex().absolute().top(0).left(14).right(14).h(0).overflow_hidden().opacity(0)
            .text_size(12).line_height(`${LINE}px`)
            .children(rows.filter(row => row.type === "message" && !row.opened).map(row => div().id(`measure-${row.key}`)
              .w_full().flex_none().on_size_change((size, cx) => this.measured(row.key, size.height, cx)).child(row.preview))))))
      // The working subagents under a line; finished ones are not shown, and with none
      // working there is no section.
      .when(subagents.length > 0, el => el.child(this.subagents(subagents, t)));
  }

  // One row per working subagent: name, model, effort, then run time and status on the
  // right as on a turn's heading; the task on the second line.
  subagents(items, t) {
    const now = Date.now() / 1000, n = items.length;
    const height = Math.min(SUB_MAX, n * SUB_ROW + (n + 1) * SUB_PAD + 1);
    return v_flex().id("activity-subagents").flex_none().h(height).overflow_y_scrollbar()
      .px(14).py(SUB_PAD).gap(SUB_PAD).border_t(1).border_color(t.border).text_size(12)
      .children(items.map(item => v_flex().id(`subagent-${item.id}`).h(SUB_ROW).flex_none().gap(2)
        .accessibility_label([item.name, item.model, item.effort, "Working", item.description].filter(Boolean).join(", "))
        .child(h_flex().h(SUB_TOP).w_full().min_w(0).gap(6).items_center()
          .child(div().min_w(0).truncate().font_medium().tooltip(`${item.name} · ${item.id}`).child(item.name))
          .when(Boolean(item.model), el => el.child(div().min_w(0).truncate().text_size(11).text_color(t.muted)
            .tooltip(`Model: ${item.model}`).child(item.model)))
          .when(Boolean(item.effort), el => el.child(div().flex_none().text_size(11).text_color(t.dim)
            .tooltip(`Reasoning effort: ${item.effort}`).child(item.effort)))
          .child(div().flex_1())
          .when(item.startedAt !== null, el => el.child(mono(div()).flex_none().text_size(11).text_color(t.dim)
            .tooltip("Time since start").child(duration(now - item.startedAt))))
          .child(div().flex_none().text_size(11).text_color(t.working).child("Working")))
        .child(div().h(SUB_BOTTOM).w_full().min_w(0).truncate().text_size(11).text_color(t.dim)
          .when(Boolean(item.description), el => el.tooltip(item.description)).child(item.description))));
  }

}
