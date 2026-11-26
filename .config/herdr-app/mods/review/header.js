import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { LU, COMPACT, HEADER, button, popover } from "./controls.js";
import { ghostButton, GROUP_GAP } from "./button.js";
import { trigger } from "./trigger.js";
import { tip } from "./tip.js";
import { popupClosed } from "./review-menu.js";
import { scopeHeader } from "./scope-header.js";
import { navToggle, setNavOpen, NAV_NARROW } from "./nav-column.js";

// As the app's describeProgress, but the file's name only: the agent's paths run long, often through its own scratch folder.
function progressText(progress) {
  const n = progress?.paths?.length ?? 0;
  if (progress?.kind === "reading") return `Reading ${n} ${n === 1 ? "file" : "files"}: ${progress.paths[0]?.split("/").pop() ?? ""}${n > 1 ? ", …" : ""}`;
  if (progress?.kind === "organizing") return "Organizing groups…";
  if (progress?.kind === "thinking") return `Thinking… (step ${progress.step})`;
  return "Starting…";
}

// Running or failed: what the status shows; with neither, as the app's dialog, it isn't shown.
export function analysisStatus(view) {
  const a = view.review?.analysis, running = view.analyzing();
  return { running, error: view.analyzeError ?? (running ? null : a?.error) };
}

// As the app's AnalyzeStatusModal, without the transcript the daemon doesn't keep: what the run is doing in a faint line,
// or why it failed, and once it's done a Re-run.
export function statusPanel(view, t) {
  const { running, error } = analysisStatus(view);
  return popover(view, t, "review-status-panel").w(320).p(16).gap(8).text_size(12)
    .child(div().font_medium().text_size(14).child("AI analysis"))
    .when(running, el => el.child(h_flex().gap(8).items_center().opacity(0.4)
      .child(svg("mods/review/icons/circle-dashed.svg").size(14).flex_none().text_color(t.working))
      .child(div().min_w(0).child(progressText(view.review.analysis.progress)))))
    .when(Boolean(error), el => el.child(div().text_color(t.ansi1).child(error)))
    .when(!running, el => el.child(h_flex().justify_end()
      .child(button(view, t, "rerun", "Re-run", (cx) => { view.closePopup(cx); view.analyze(cx, true); }, { primary: true, icon: `${LU}/rotate-cw.svg` }))));
}

// What the header shows: a title, the page, colored parts (theme color names) and buttons.
export function head(view) {
  // Switching, the old page's counts and analysis aren't the new one's.
  const r = view.switching ? null : view.review, parts = [], buttons = [];
  if (r) {
    const files = r.files, done = files.filter(f => f.reviewed).length;
    parts.push({ text: `+${files.reduce((n, f) => n + f.additions, 0)}`, color: "ansi2" }, { text: `−${files.reduce((n, f) => n + f.deletions, 0)}`, color: "ansi1" },
      { text: `${done}/${files.length}`, color: "dim" });
    const a = r.analysis, { error } = analysisStatus(view);
    const compact = view.width < COMPACT;
    // As the app's DiffAnalyzeButton, the analysis's state is the button's: running or failed, it opens the status; without
    // a working mark of its own while running, as the pane's header marks the review working;
    // an agent, the settings. An analysis of an older version (the app has none) says so after its Re-analyze.
    const analyze = !a.agent ? { text: "Set up agent", lead: `${LU}/key-round.svg`, pops: "settings" }
      : view.analyzing() ? { text: "Analyzing…", pops: "status" }
      : error ? { text: "Analysis failed", lead: `${LU}/circle-alert.svg`, color: "ansi1", pops: "status" }
      : { text: a.state === "none" ? "Analyze with AI" : "Re-analyze", lead: `${LU}/sparkles.svg`, note: a.state === "outdated" ? "(outdated)" : null, run: (cx) => view.analyze(cx, a.state === "current") };
    buttons.push({ id: "analyze", ...analyze, ...compact && { text: null, icon: analyze.lead ?? `${LU}/sparkles.svg`, label: analyze.text } });
    buttons.push({ id: "fold-menu", icon: `${LU}/chevrons-up-down.svg`, label: "Expand or collapse files", pops: "fold" });
  }
  // The view (unified or split, lines wrapped or scrolled) is set in the settings, with the analysis.
  buttons.push({ id: "settings", icon: "mods/review/icons/settings.svg", label: "Settings", pops: "settings" });
  // The diff shown is named by the scope button, which leads the header (scope-header.js).
  return { parts, buttons };
}

export function header(view, t, head) {
  // As T3's DiffPanel header: the scope and what it compares, the counts as its DiffStatLabel, then the tools. Narrow, the
  // words give way and the buttons never.
  // 12 in, as the panel head above it (t3-tokens「规则」R1); the bar's buttons sm on chrome, their icons 14 (T3's diff toolbar),
  // the icons a group's gap apart (P3). No rule under it, as T3's subheaders in the panel.
  const icons = head.buttons.filter(b => !b.text), words = head.buttons.filter(b => b.text), open = view.treeOpen();
  return h_flex().id("review-header").h(HEADER).flex_none().px(12).gap(8).items_center().overflow_hidden()
    .child(scopeHeader(view, t))
    // The counts hold, as T3's stats beside its tools: a long commit subject truncates instead.
    .when(head.parts.length > 0, el => el.child(h_flex().id("review-counts").flex_none().gap(4).items_center().text_size(11)
      .children(head.parts.map(p => div().text_color(t[p.color] ?? t.dim).child(p.text)))))
    .child(div().flex_1())
    .children(words.map(b => button(view, t, b.id, b.text, b.pops ? (cx, keys) => view.togglePopup(b.pops, cx, keys) : b.run,
      { after: b.after, icon: b.lead, iconSize: 14, color: t[b.color], note: b.note, pops: b.pops, size: "sm", surface: "chrome" })))
    .child(h_flex().id("review-tools").flex_none().gap(GROUP_GAP).items_center()
      .children(icons.map(b => {
        const run = b.pops ? (cx, keys) => view.togglePopup(b.pops, cx, keys) : b.run;
        // An icon alone says what it does in its label.
        if (b.pops) return trigger(view, t, b.id, { icon: b.icon, iconSize: 14, label: b.label, color: t[b.color], disabled: b.disabled, below: true,
          open: view.popup === b.pops, closed: popupClosed(b.pops), onOpen: (at, cx) => run(cx, !at) });
        return tip(view, t, b.id, b.label, ghostButton(view, t, b.id, { icon: b.icon, iconSize: 14, label: b.label, act: run, color: t[b.color], disabled: b.disabled, size: "sm", surface: "chrome" }), { below: true });
      }))
      // Last, the file tree's switch, greyed with no files to list.
      .child(tip(view, t, "review-nav-toggle", open ? "Hide the file tree" : "Show the file tree",
        navToggle(view, t, "mods/review", "review-nav-toggle", open, (cx) => {
          if (view.width < NAV_NARROW) view.narrowNav = !open;
          else { view.panel.navOpen = !view.navOpen; setNavOpen(view.panel.navOpen); }
          cx.notify();
        }, !view.review || view.navEmpty()), { below: true })));
}
