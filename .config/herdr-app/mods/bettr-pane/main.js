// Herdr's `pane` mod, with the same header look as the Bettr panels (36 px high, 14 px sides).
// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "bettr-pane" } } } }
// Shows the program's icon (the app's program table), the agent's name or
// the terminal's title, the folder, and the agent's status; buttons split, zoom and close
// this pane. Props from the app: { pane, terminal }. Click: focus the pane.
// A shell whose terminal had an agent session (see resume.js) shows a Resume button.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { hc, notify, panes, props, run, terminals, theme, home } from "herdr";
import { resume } from "./resume.js";

// `color` (#rgb, #rrggbb or #rrggbbaa) at `alpha` (hex 00-ff); any other color as it is.
// The same helper is in bettr-spaces, bettr-tabs and bettr-activity (a mod cannot import another's files).
const tint = (color, alpha) => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color)?.[1];
  if (!hex) return color;
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex.slice(0, 6)}${alpha}`;
};

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

export default class Pane extends View {
  init() { this.hovered = false; }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, icon, command, args) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/bettr-pane/${icon}.svg`).size(14));
  }

  // Types the resume command into the pane's shell, on its own machine.
  // `again`: { command, title, prompt } from resume.js. Yellow (ansi3) in every theme.
  resume(t, pane, terminal, again) {
    const yellow = t.ansi3;
    return div()
      .id(`ph-resume-${pane}`)
      .flex_none()
      .px(8)
      .h(20)
      .flex()
      .items_center()
      .rounded(5)
      .border(1)
      .border_color(tint(yellow, "66"))
      .bg(tint(yellow, "1f"))
      .text_size(11)
      .font_medium()
      .text_color(yellow)
      .hover((s) => s.bg(tint(yellow, "40")))
      .when(Boolean(again.prompt), (el) => el.tooltip(again.prompt))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run("pane.focus", { pane });
        const failed = (why) => notify({ title: "Resume failed", body: String(why).trim(), level: "error" });
        hc(["send", terminal, again.command]).then((r) => { if (r.code !== 0) failed(r.stderr || r.stdout); }, failed);
      })
      .child(again.title);
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const pic = icon(p.program, 14, t.dim);
    const st = p.status;
    const pane = p.pane;
    const again = p.terminal
      ? resume(terminals().find((x) => x.address === p.terminal)?.labels, p.program)
      : null;
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(14)
      .gap(8)
      .items_center()
      .bg(t.background)
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).text_size(13).font_medium().text_color(t.foreground).child(name))
      .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd)))
      .when(st === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(tint(t.blocked, "26")).text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(st === "done", el => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .when(this.hovered, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })))
      // Last, so the hover buttons open to its left and it does not move.
      .when(Boolean(again), el => el.child(this.resume(t, pane, p.terminal, again)));
  }
}
