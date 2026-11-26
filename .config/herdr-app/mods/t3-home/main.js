// Home's default page: where putting the agent in view away lands, with nothing to look at but what can be done next.
// t3-tabs owns the place itself (a space of its own); this is only what it shows unless Settings picks another mod or a terminal (docs/adr/0005).
import { View } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { layout, run, shared, spaces, theme } from "herdr";
import { keyOf } from "./tip.js";
import { stopsInit, stopsEnd, stop, focusRoot, pressed, justClosed } from "./focus.js";
import { agentStep } from "./agent-step.js";
import { closedKey } from "./store.js";
import { keycap } from "./palette.js";
import { alpha } from "./color.js";

const ACTIONS = [
  { id: "next", word: "Next agent", action: "t3-tabs.next", go: () => run("t3-tabs.next"), ready: () => agentStep(layout(), shared, spaces(), 1) !== null },
  { id: "goto", word: "Go to", action: "mod.open:t3-picker", go: () => run("mod.open", { name: "t3-picker" }), pops: closedKey("t3-picker") },
  { id: "new", word: "New tab", action: "t3-tabs.new", go: () => run("t3-tabs.new"), pops: closedKey("t3-new-menu") },
];
// A key as its strokes: each modifier, then the rest ("⇧⌘P", "Ctrl+Shift+P").
const caps = (key) => key.match(/[⌃⌥⇧⌘]|[^⌃⌥⇧⌘+]+/gu);

export default class Home extends View {
  init(_props, cx) {
    stopsInit(this, cx);
  }

  async close() {
    stopsEnd(this);
  }

  render() {
    const t = theme();
    const row = (a) => {
      const id = `home-${a.id}`, off = a.ready && !a.ready(), key = keyOf(a.action);
      const el = h_flex().id(id).h(32).px(10).gap(10).flex_none().rounded(8).items_center().justify_between().text_color(t.muted)
        .child(a.word)
        .when(Boolean(key), (r) => r.child(h_flex().flex_none().gap(4).children(caps(key).map((cap) => keycap(t, cap)))));
      // Nowhere to go: dimmed, as the key does nothing either. The theme's hover can be the pane's own color, so a tint of the text, as Go to's rows.
      return off ? el.opacity(0.5) : stop(this, t, id, el.role("button").accessibility_label(a.word)
        .hover((s) => s.bg(alpha(t.foreground, "0f")).text_color(t.foreground)).active((s) => s.bg(t.selected)).on_mouse_down("left", () => pressed(this)).on_click(() => { if (!a.pops || !justClosed(this, a.pops)) a.go(); }), 8);
    };
    // As T3's launcher: pb its top bar's height, so the list centers on the whole panel.
    // work-body already paints the shared chrome tint over the wallpaper, so Home stays transparent to avoid double-stacking.
    return focusRoot(this, v_flex().size_full().px(24).pb(40).items_center().justify_center()
      .child(v_flex().w_full().max_w(320).gap(2).text_size(14).children(ACTIONS.map(row))));
  }
}
