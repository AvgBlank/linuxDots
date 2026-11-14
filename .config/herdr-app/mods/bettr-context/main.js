import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, focused, layout, props, run, settings, terminals, theme } from "herdr";
import { cacheView, contextState, contextView, focusedAgent, logView, percent, tokens } from "./model.js";

// A soft rainbow, one colour per row in display order. The reserve and unknown rows are grey.
const COLORS = {
  messages: "#ee7d7d", tools: "#f2a46a", skills: "#ecc56a", memory: "#7ecf86",
  agents: "#6fb3ea", system: "#8c8ce6", mcp: "#c08ae6",
};
const color = (key, t) => COLORS[key] ?? (key === "reserved" ? t.border : t.muted);
// Cache totals: an icon in a colour from the same set; uncached is the dim text grey.
const TOTALS = {
  read: ["arrow-down", COLORS.memory], write: ["arrow-up", COLORS.tools],
  rewrite: ["redo-2", COLORS.messages], uncached: ["x", null],
};

// Cache section heights in px: borders, the header with its bottom line, the list's
// padding, and one fixed-height line each with GAP between.
const HEADER = 36, CLOSED = HEADER + 1, PAD = 12, LINE = 24, GAP = 4, UNDER = 6, MAX = 380;

// Numbers and times use the terminals' font (Herdr's `font_family` setting), else Herdr's
// default. Read once per render.
let font = "JetBrains Mono";
const mono = el => el.font_family(font);
const readFont = () => { font = settings()?.font_family || "JetBrains Mono"; };

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Context extends View {
  init() {
    // Rows the user opened.
    this.open = new Set();
  }

  toggle(key, cx) {
    if (this.open.has(key)) this.open.delete(key); else this.open.add(key);
    cx.notify();
  }

  // A row: colour box, label, tokens, share of the window.
  // A row with no swatch keeps its space, so its text starts with its parent's.
  line(id, swatch, label, value, share, t, { dim = false, click = null, opened = false } = {}) {
    return h_flex().id(id).w_full().h(26).gap(10).items_center().text_size(12)
      .when(Boolean(click), el => el.cursor_pointer().hover(s => s.bg(t.hover)).on_click((_e, cx) => click(cx)))
      .child(div().size(10).flex_none().when(swatch !== null, el => el.rounded(2).bg(swatch)))
      .child(h_flex().flex_1().min_w(0).gap(4).items_center().text_color(dim ? t.dim : t.muted)
        .child(div().min_w(0).truncate().child(label))
        .when(Boolean(click), el => el.child(svg(`mods/bettr-context/icons/chevron-${opened ? "down" : "right"}.svg`)
          .size(12).flex_none().text_color(t.dim))))
      .child(mono(div().w(52).flex_none().text_right().text_color(t.dim).child(value)))
      .child(mono(div().w(46).flex_none().text_right().text_color(dim ? t.dim : t.foreground).child(share)));
  }

  // With the `autoSize` prop (the block's layout ID), the block fits its lines.
  // After a manual resize the size is the person's until the heading is
  // double-clicked.
  fit(lines, force = false) {
    const id = props()?.autoSize;
    const node = id ? find(layout(), id) : null;
    if (!node) return;
    const want = lines ? Math.min(MAX, CLOSED + 2 * PAD + lines * LINE + (lines - 1) * GAP + (lines > 1 ? UNDER : 0)) : CLOSED;
    const px = node.size?.px, key = `autoHeight:${id}`;
    let previous = null;
    try { previous = localStorage.getItem(key); } catch {}
    const waiting = this.asked && Date.now() < this.asked.until && px !== this.asked.px;
    if (!force && !waiting && previous !== null && Math.abs((px ?? 0) - Number(previous)) > 1) return;
    if (px === want || (waiting && this.asked.px === want)) return;
    try { localStorage.setItem(key, String(want)); } catch {}
    this.asked = { px: want, until: Date.now() + 1000 };
    run("layout.resize", { id, px: want });
  }

  // The main section hides the Cache block (its `cache` prop: the block's layout ID) while
  // no agent is focused, and shows it again for one: a hidden block is not drawn, so it
  // cannot show itself.
  showCache(on) {
    const id = props()?.cache, node = id ? find(layout(), id) : null;
    if (!node || Boolean(node.hidden) === !on || this.showing?.on === on && Date.now() < this.showing.until) return;
    this.showing = { on, until: Date.now() + 1000 };
    run(on ? "layout.show" : "layout.hide", { id });
  }

  // The Cache section: hit rate, totals, then each miss with the facts before it.
  cache(t, state) {
    const view = state ? cacheView(state.cache, state.provider) : null;
    const lines = view ? 1 + view.misses.length : 0;
    this.lines = lines;
    this.fit(lines);
    const root = v_flex().id("cache").size_full().min_h(0).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(12)
      .child(h_flex().h(HEADER).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().id("cache-heading").flex_1().text_size(13).font_medium()
          .tooltip("Double-click to fit panel height")
          .on_click(event => { if (event.click_count === 2) this.fit(this.lines, true); })
          .child("Cache"))
        .when(Boolean(view?.hit), el => el.child(div().id("cache-hit").flex_none().text_size(11).text_color(t.dim)
          .tooltip("Tokens read from cache ÷ all input tokens").child(view.hit))));
    if (!view) return root;
    const line = (id, ...children) => h_flex().id(id).h(LINE).flex_none().gap(10).items_center().children(children);
    return root.child(v_flex().id("cache-list").flex_1().min_h(0).overflow_y_scrollbar().px(14).py(PAD).gap(GAP)
      .child(line("cache-totals", ...view.totals.map(item => h_flex().id(`cache-${item.key}`).h_full().gap(4).items_center()
        .tooltip(`${item.label} · ${view.about}`).accessibility_label(`${item.label}: ${item.value}`)
        // A line box as tall as the 12 px icon, so both centre on the same axis.
        .child(mono(div()).line_height("12px").text_color(t.muted).child(item.value))
        .child(svg(`mods/bettr-context/icons/${TOTALS[item.key][0]}.svg`).size(12).flex_none()
          .text_color(TOTALS[item.key][1] ?? t.dim)))).justify_between().when(view.misses.length > 0, el => el.mb(UNDER)))
      // Three columns, each as wide as its widest cell, so the cells line up: the time and
      // the size (both right-aligned), then the facts in all the room left.
      .when(view.misses.length > 0, el => el.child(h_flex().id("misses").w_full().gap(8).items_start()
        .child(this.column("time", view.misses, item => mono(div()).text_color(t.dim).child(item.time), true)
          .flex_none())
        .child(this.column("lost", view.misses, item => mono(div()).text_color(item.plain ? t.muted : t.working)
          .child(item.lost), true).flex_none())
        .child(this.column("facts", view.misses, item => div().min_w(0).truncate().text_color(t.muted)
          .child(item.facts)).flex_1().min_w(0)))));
  }

  // One column of cells (Cache rewrites, compactions), each one LINE high so the columns' rows line up.
  column(key, items, cell, right = false) {
    return v_flex().gap(GAP).children(items.map(item => h_flex().id(`miss-${key}-${item.key}`).h(LINE).min_w(0)
      .items_center().when(right, el => el.justify_end()).tooltip(item.tip).child(cell(item))));
  }

  render() {
    const t = theme();
    readFont();
    const terminal = focusedAgent(focused(), terminals(), agents());
    const state = contextState(terminal);
    if (props()?.section === "cache") return this.cache(t, state);
    this.showCache(Boolean(terminal));
    const header = h_flex().h(HEADER).flex_none().px(14).items_center().border_b(1).border_color(t.border)
      .child(div().font_medium().child("Context"));
    const root = v_flex().id("context").size_full().min_h(0).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13).child(header);
    if (!state) {
      return root.child(v_flex().p(14).text_size(12).text_color(t.dim).child("Focus an agent to see its context"));
    }
    const view = contextView(state, this.open), window = state.window;
    const body = v_flex().id("context-body").flex_1().min_h(0).overflow_y_scrollbar().px(14).py(12).gap(2);

    body.child(h_flex().w_full().items_baseline().justify_between().pb(8)
      .child(div().text_size(15).font_medium().child(view.heading))
      .child(mono(div()).text_size(12).text_color(t.dim).child(view.total)));
    // The bar: one segment per row; the track behind it is the free space. As the usage
    // bars: 5 px, radius 3. GPUI does not clip children to rounded corners, so the first
    // and last segments round their own outer ends.
    const segments = view.segments.filter(s => s.share > 0);
    body.child(h_flex().w_full().h(5).mb(10).rounded(3).bg(t.raised)
      .children(segments.map((s, i) => div().h_full().flex_none().w(`${Math.max(0.4, s.share * 100)}%`).bg(color(s.key, t))
        .when(i === 0, el => el.rounded_l(3)).when(i === segments.length - 1, el => el.rounded_r(3)))));

    for (const item of view.rows) {
      body.child(this.line(`row-${item.key}`, color(item.key, t), item.label, tokens(item.tokens),
        percent(item.tokens, window), t,
        { click: item.expandable ? cx => this.toggle(item.key, cx) : null, opened: item.opened }));
      if (item.opened) {
        for (const part of item.parts) {
          body.child(this.line(`part-${item.key}-${part.label}`, null, part.label, tokens(part.tokens),
            percent(part.tokens, window), t, { dim: true }));
        }
      }
    }
    if (view.reserved) {
      body.child(this.line("row-reserved", color("reserved", t), "Autocompact buffer", tokens(view.reserved),
        percent(view.reserved, window), t, { dim: true }));
    }
    if (window) {
      body.child(this.line("row-free", t.raised, "Free space", tokens(view.free), percent(view.free, window), t,
        { dim: true }));
    }

    // The compaction log, styled as the Cache rewrite rows: the time, then
    // "Compacted before → after".
    const log = logView(state.log, window);
    if (log.length) {
      body.child(h_flex().id("compactions").w_full().mt(12).gap(8).items_start().text_size(12)
        .child(this.column("log-time", log, item => mono(div()).text_color(t.dim).child(item.time), true).flex_none())
        .child(this.column("log-size", log, item => h_flex().gap(4).items_center().text_color(t.muted)
          .child(div().line_height("12px").child("Compacted"))
          .child(mono(div()).line_height("12px").child(item.before))
          .child(svg("mods/bettr-context/icons/arrow-right.svg").size(12).flex_none().text_color(t.dim))
          .child(mono(div()).line_height("12px").child(item.after))).flex_1().min_w(0)));
    }
    return root.child(body);
  }
}
