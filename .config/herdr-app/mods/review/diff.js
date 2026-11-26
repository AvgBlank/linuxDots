import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list, TextView } from "gpui-base";
import { notify } from "herdr";
import { review } from "./daemon.js";
import { codeInset, FILE, noteWidth, ROW, wrapRow } from "./rows.js";
import { canFull } from "./review-load.js";
import { LU, mono, zoom, isLight, checkMark, diffStats, popover } from "./controls.js";
import { fileStatus } from "./files.js";
import { emptyState } from "./panel-states.js";
import { holdWidth } from "./nav-column.js";
import { alpha } from "./color.js";

// The runs measured for a character's width, and a wide one's: long enough that rounding the whole to a pixel doesn't matter.
const MEASURED = "0".repeat(100), MEASURED_WIDE = "中".repeat(100);
// A run of the code font, drawn unseen under the list until its width is known, for where wrapped lines break (rows.js
// wrapColumns); again when the font is changed in the settings.
const measureRun = (id, text, set) => div().id(id).absolute().top(0).left(0).opacity(0).font_family(mono()).text_size(12).whitespace_nowrap()
  .on_size_change((size, cx) => { if (size.width > 0) { set(size.width / zoom() / text.length); cx.notify(); } })
  .child(text);
// How long a sideways scroll's bars stay after it stops (ms).
const BARS_LINGER = 1000;

// As the app's DiffCollapseMenu: every file of the diff at once, not just the group shown.
export const FOLDS = [
  { id: "expand-all", label: "Expand all files", icon: "unfold-vertical", collapse: false, applies: () => true },
  { id: "collapse-all", label: "Collapse all files", icon: "fold-vertical", collapse: true, applies: () => true },
  { id: "collapse-reviewed", label: "Collapse reviewed files", icon: "square-check", collapse: true, applies: f => f.reviewed && !f.changed },
  { id: "collapse-tests", label: "Collapse test files", icon: "flask-conical", collapse: true, applies: f => f.test },
];

// The most colored elements a line draws: each is a div, and a view of lines dense with them can outrun a render.
// shortcut: 400 is a guess under the 50 ms a render gets; calibrate on a dense line in Herdr.
const SPANS = 400;

// Spaces that end an element are drawn into a following ligature (` =>` shows as `)⇒`): each run's
// trailing spaces lead the next run instead, where they hold their width. Next runs of one color are one element, and
// past SPANS the rest of the line is one in the plain color: every character still shows.
function spans(tokens) {
  const out = [];
  let carry = "";
  for (const [text, color] of tokens) {
    const t = carry + text.replaceAll("\t", "    "), body = t.trimEnd(), last = out.at(-1), c = out.length < SPANS - 1 ? color : undefined;
    carry = t.slice(body.length);
    if (!body) continue;
    if (last && last[1] === c) last[0] += body; else out.push([body, c]);
  }
  return out;
}

// The file at the view's top (or its group's header) is brought back there, as folding the bodies above it would carry the view elsewhere.
export function foldAll(view, { collapse, applies }, cx) {
  const top = (view.itemList ?? [])[view.visible?.start ?? 0];
  const anchor = top && (top.kind === "group" ? top.key : `f:${top.path}`);
  for (const f of view.review.files) if (applies(f)) collapse ? view.collapsed.add(f.path) : view.collapsed.delete(f.path);
  view.version++; view.closePopup(cx);
  const index = anchor ? view.items().findIndex(item => item.key === anchor) : -1;
  if (index >= 0) view.scrollToTop(index, cx);
}

export function foldMenu(view, t) {
  return popover(view, t, "review-fold-menu").min_w(160).p(4)
    .children(FOLDS.map((fold, i) => h_flex().id(`fold-${fold.id}`).h(28).px(8).gap(8).items_center().rounded(4)
      .when(i === view.foldAt, el => el.bg(t.selected)).on_hover((on, cx) => { if (on && view.foldAt !== i) { view.foldAt = i; cx.notify(); } })
      .role("button").accessibility_label(fold.label).on_click((_e, cx) => foldAll(view, fold, cx))
      .child(svg(`${LU}/${fold.icon}.svg`).size(16).mx(-2).flex_none().text_color(t.dim))
      .child(fold.label)));
}

// Marks are written one at a time: a press's write can't land after a later press's and undo it.
let markWrites = Promise.resolve();

// One file, or a folder's files at once. As the app's, marking folds the file and unmarking opens it again.
export function setReviewed(view, files, reviewed, cx) {
  if (view.switching) return;
  files = [files].flat();
  for (const file of files) {
    file.reviewed = reviewed; file.changed = false;
    reviewed ? view.collapsed.add(file.path) : view.collapsed.delete(file.path);
  }
  view.version++; view.marks++; view.marking++;
  const { root, page, on } = view;
  const shas = files.map(file => file.sha), write = markWrites.then(() => review(root, "/api/review/reviewed", { page, shas, reviewed }, on));
  markWrites = write.catch(() => {});
  cx.spawn(async (cx) => {
    try { await write; }
    // A toast: the read after this one, succeeding, would clear the pane's error at once.
    catch (e) { notify({ title: "pulls.review", body: e?.message ?? String(e), level: "error" }); }
    // Read back what the daemon keeps, the marks of a failed press included.
    view.marking--;
    view.load(cx);
  });
  cx.notify();
}

// A press on a file's header, placed by x as item() lays the header out: the reviewed box at the start (8px in,
// 16 wide), the fold and the whole-file slots at the end (20 wide each, 4 apart, 12px in). Anywhere else folds, as the app's.
export function headerPress(view, file, x, cx) {
  if (view.switching) return;
  const fromEnd = view.view - x;
  if (x < 32) return view.setReviewed(file, !file.reviewed, cx);
  if (fromEnd > 32 && fromEnd <= 56 && canFull(file)) return view.toggleFull(file, cx);
  view.collapsed.has(file.path) ? view.collapsed.delete(file.path) : view.collapsed.add(file.path);
  view.version++;
  cx.notify();
}

export function diffView(view, t) {
  const items = view.items(), sticky = view.stickyFile();
  view.stuck = Boolean(sticky);
  return v_flex().size_full().min_w(0).overflow_hidden()
    .child(div().id("review-diff-area").flex_1().min_h(0).overflow_hidden().relative().text_size(12)
      .on_size_change((size, cx) => {
        view.diffHeight = size.height / zoom();
        // Wrapped lines are cut again only once the width holds (view.wrapHold): a panel dragged changes it every frame.
        if (Math.abs(size.width / zoom() - view.view) >= 1) { view.view = size.width / zoom(); holdWidth(view.wrapHold, view.view, (ms, f) => cx.timer.after(ms, f)); cx.notify(); }
      })
      // Code scrolls sideways by the wheel: split, each side under the pointer; the full-width rows under either.
      // Headers and notes stay put, and the list keeps the vertical.
      .on_scroll_wheel((event, cx) => {
        let moved = false, sideways = false;
        for (const side of view.splitShown() ? [(event.local_position?.x ?? 0) / zoom() < view.view / 2 ? 0 : 1, 2] : [2]) {
          const x = Math.min(view.sideMax(side), Math.max(0, view.shift[side] - event.delta.x / zoom()));
          if (x !== view.shift[side]) { view.shift[side] = x; moved = sideways = true; }
        }
        if (sideways) {
          const run = ++view.barsRun;
          view.barsOn = true;
          cx.timer.after(BARS_LINGER, (cx) => { if (run === view.barsRun) { view.barsOn = false; cx.notify(); } });
        }
        if (moved) cx.notify();
      })
      // A row reports only its key: where the press landed says which part of a file's header it was for.
      .on_mouse_down("left", (event) => { view.pressX = (event.local_position?.x ?? 0) / zoom(); view.pressY = (event.local_position?.y ?? 0) / zoom(); })
      // A wide character's own: a code font seldom has CJK, and the one drawn in its place makes it about 1em, not 2 columns.
      .when(!view.charWidth || view.charFont !== mono(), el => el.child(measureRun("review-char", MEASURED, (w) => { view.panel.charWidth = w; view.panel.charFont = mono(); })))
      .when(!view.wideWidth || view.wideFont !== mono(), el => el.child(measureRun("review-wide", MEASURED_WIDE, (w) => { view.panel.wideWidth = w; view.panel.wideFont = mono(); })))
      // A blank after the items (trailing) lets the last header reach the top.
      .child(v_virtual_list("review-diff", items.length + 1, view.listSizes(), (i) => items[i]?.key ?? "end",
        // The range drawn is the only word on where the list is scrolled, and its frames on when a scroll has landed.
        (range) => {
          view.visible = range; view.frames++;
          return Array.from({ length: range.end - range.start }, (_, k) => items[range.start + k] ? diffItem(view, t, items[range.start + k]) : div().w_full().h(view.trailing()));
        })
        .track_scroll(view.scroll).size_full()
        .on_item_click((key, cx) => {
          // A press on the stuck header lands on the row under it too: the header has it.
          if (view.stuck && view.pressY < FILE) return;
          const path = view.itemList.find(item => item.key === key)?.path, file = view.review.files.find(f => f.path === path);
          if (!file) return;
          if (key.startsWith("f:")) view.headerPress(file, view.pressX ?? 0, cx);
          view.select(file.path, cx, { scroll: false });
        }))
      // Folding or marking the file from its stuck header folds it away under the top: its header, above the view, comes
      // back to the top in one scroll (the list scrolls to the near edge).
      .when(Boolean(sticky), el => el.child(div().id("sticky-file").absolute().top(0).left(0).w_full().bg(t.background)
        .on_click((_e, cx) => {
          const open = !view.collapsed.has(sticky.path);
          view.headerPress(sticky, view.pressX ?? 0, cx);
          view.select(sticky.path, cx, { scroll: false });
          const at = view.items().findIndex(item => item.key === `f:${sticky.path}`);
          if (open && view.collapsed.has(sticky.path) && at >= 0) view.scroll.scroll_to_item(at);
        })
        .child(diffItem(view, t, { key: `f:${sticky.path}`, kind: "file", file: sticky, size: FILE }))))
      .child(Scrollbar.vertical("review-diff").absolute().inset_0())
      .children(view.hbars(t))
      // As T3's DiffPanel with nothing to show: a diff with no files has no group either.
      .when(!items.length, el => el.child(div().absolute().inset_0().child(view.review?.files.length
        ? emptyState(t, "review-empty", `${LU}/file-diff.svg`, "No files in this group", null)
        : emptyState(t, "review-empty", `${LU}/file-diff.svg`, "No changes", "Nothing to review in this range.")))));
}

// Code scrolls sideways by the wheel alone: while it does, as T3's ScrollArea, a 6px bar says where it is, for each
// overflowing side with rows in view. Split, the full-width rows' sits above the halves' when both show.
export function hbars(view, t) {
  const { start = 0, end = 0 } = view.visible ?? {}, split = view.splitShown();
  const kinds = new Set((view.itemList ?? []).slice(start, end).map(item => item.kind));
  const sides = (split ? [0, 1, 2] : [2]).filter(side => view.sideMax(side) > 0 && kinds.has(side < 2 ? "pair" : split ? "solo" : "row"));
  return sides.map(side => {
    const width = side === 2 ? view.view : view.view / 2, max = view.sideMax(side);
    const thumb = Math.max(24, width * width / view.sideWidth[side]);
    return div().id(`hbar-${side}`).absolute().bottom(side === 2 && sides.length > 1 ? 8 : 1).left(side === 1 ? view.view / 2 : 0).w(width).h(6)
      .opacity(view.barsOn ? 1 : 0).transition("opacity", { duration: 150, easing: "ease-out" })
      .child(div().absolute().left((width - thumb) * Math.min(view.shift[side], max) / max).w(thumb).h_full().rounded_full().bg(alpha(t.muted, "80")));
  });
}

// One side of a line: its line numbers (one in split, old and new in unified), its sign and its code, slid left by `shift`.
// `wrapped`: the row's lines as rows.js's wrapRow cut them, each ROW tall, the numbers and sign beside the first.
function drawCode(t, row, numbers, shift = 0, wrapped = null) {
  if (!row) return div().flex_1().min_w(0).h_full().bg(t.canvas);
  const tint = row.kind === "+" ? alpha(t.ansi2, "1c") : row.kind === "-" ? alpha(t.ansi1, "1c") : null;
  const code = (tokens) => spans(tokens).map(([text, color]) => div().flex_none().text_color(color ?? t.foreground).child(text));
  // Herdr ships JetBrains Mono; Geist Mono, a common terminal font here, draws `=>` over the space before it.
  return h_flex().flex_1().min_w(0).h_full().overflow_hidden().font_family(mono()).when(Boolean(tint), el => el.bg(tint))
    .when(!wrapped, el => el.items_center()).when(Boolean(wrapped), el => el.items_start())
    .children(numbers.map(number => div().w(40).flex_none().pr(6).text_right().text_color(t.dim)
      .when(Boolean(wrapped), el => el.h(ROW).flex().items_center().justify_end()).child(number === undefined ? "" : String(number))))
    .child(div().w(12).flex_none().text_color(row.kind === "+" ? t.ansi2 : row.kind === "-" ? t.ansi1 : t.dim)
      .when(Boolean(wrapped), el => el.h(ROW).flex().items_center()).child(row.kind === " " ? "" : row.kind))
    .child(wrapped
      ? v_flex().flex_1().min_w(0).overflow_hidden().children(wrapped.map(tokens => h_flex().h(ROW).flex_none().items_center().whitespace_nowrap().children(code(tokens))))
      : h_flex().flex_1().min_w(0).overflow_hidden().whitespace_nowrap().child(h_flex().flex_none().relative().left(-shift).children(code(row.tokens))));
}

function diffItem(view, t, item) {
  switch (item.kind) {
    case "file": {
      // As the app's file header: the reviewed box, the path and its marks; the counts, the status, the whole file and the fold.
      // A row holds no handlers: headerPress places a press by these parts' positions.
      const f = item.file, open = !view.collapsed.has(f.path), full = view.full.has(f.path), loading = full && !view.full.get(f.path);
      // 12 in on both sides, the page's edge (t3-tokens「规则」R1); its controls icon-micro. As Pierre's header: on the code's
      // ground, no rules, the file in front unlit (the tree's selected row says which).
      const slot = () => div().size(20).flex_none().flex().items_center().justify_center();
      return h_flex().w_full().h(item.size).px(12).gap(8).items_center()
        .child(checkMark(t, f.changed ? "changed" : f.reviewed ? "all" : "none"))
        .child(div().min_w(0).flex_shrink_1().truncate().when(f.reviewed, el => el.text_color(t.dim)).child(f.previousPath ? `${f.previousPath} → ${f.path}` : f.path))
        .when(f.test, el => el.child(svg(`${LU}/flask-conical.svg`).size(14).flex_none().text_color(isLight(t.background) ? "#15803d" : "#4ade80")))
        .when(f.noisy, el => el.child(div().flex_none().text_size(11).text_color(t.dim).child("generated")))
        .when(f.changed, el => el.child(div().flex_none().text_size(11).text_color(t.ansi3).child("changed since reviewed")))
        .child(div().flex_1())
        .when(!f.isBinary, el => el.child(div().flex_none().text_size(11).child(diffStats(t, f.additions, f.deletions))))
        .when(f.isBinary, el => el.child(div().flex_none().text_size(11).text_color(t.dim).child("binary")))
        .child(fileStatus(f.status))
        .child(h_flex().flex_none().gap(4)
          .child(slot().when(canFull(f), el => el.child(svg(loading ? "mods/review/icons/loader-circle.svg" : "mods/review/icons/file-text.svg").size(12).text_color(loading ? t.working : full ? t.accent : t.dim))))
          .child(slot().child(svg(`mods/review/icons/chevron-${open ? "down" : "right"}.svg`).size(16).text_color(t.dim))));
    }
    case "group":
      return h_flex().w_full().h(item.size).px(12).gap(8).items_center().font_semibold().text_color(t.ansi4)
        .when(item.group.critical, el => el.child(div().text_color(t.blocked).child("!")))
        .child(div().min_w(0).truncate().child(item.group.label));
    case "hunk":
      // Hunk headers on the text color at 5%, as Pierre's separator (the code's ground 95%, its text 5%), 11px; `@@` is code, so mono.
      // Cut inside the 12 on the right too: truncate on the padded row would clip the text at its border.
      return div().w_full().h(item.size).px(12).flex().items_center().bg(alpha(t.foreground, "0d")).font_family(mono()).text_size(11).text_color(t.dim)
        .child(div().min_w(0).truncate().child(item.text));
    case "note": {
      // As the app's AnalysisNoteCard: a sparkle, or a critical note's mark, then its Markdown in the UI font.
      // A file's own notes run across the file under its header; a line's sits under the line as a card.
      const { note } = item, critical = note.critical;
      const body = h_flex().gap(8).items_start().overflow_hidden()
        .child(critical
          ? div().w(12).flex_none().font_bold().text_color(t.blocked).child("!")
          : svg(`${LU}/sparkles.svg`).size(12).mt(3).flex_none().text_color(t.dim))
        // Markdown in a row wraps at the row's width, past the mark and padding: a column of the measured width holds it.
        .child(v_flex().w(noteWidth(view.view, item.anchored)).flex_none()
          .child(TextView.markdown(`note-${item.key}`, note.text).selectable(true).scrollable(false).text_size(12).text_color(t.foreground)));
      return item.anchored
        ? div().w_full().h(item.size).px(12).py(3)
          .child(body.w_full().max_w(800).h_full().px(10).py(4).rounded(8).bg(critical ? alpha(t.blocked, "1a") : alpha(t.foreground, "0a")))
        : body.w_full().h(item.size).px(12).py(6).when(critical, el => el.bg(alpha(t.blocked, "1a")));
    }
    case "empty":
      return div().w_full().h(item.size).pl(codeInset(view.splitShown())).pr(12).gap(8).flex().items_center().text_color(t.dim)
        .when(Boolean(item.loading), el => el.child(svg("mods/review/icons/loader-circle.svg").size(14).flex_none().text_color(t.working))).child(item.text);
    default:
      return v_flex().w_full().h(item.size).children(item.lines.map(line => diffLine(view, t, item.kind, line)));
  }
}

// One code line of a run, ROW tall; wrapped, as many ROWs as its lines (a pair, its longer side's), as buildItems counts them.
function diffLine(view, t, kind, line) {
  const cols = view.wrapCols?.[kind], cut = (row) => cols && row ? wrapRow(row, cols, view.wrapCols.wide) : null;
  if (kind === "pair") {
    const left = cut(line.left), right = cut(line.right);
    return h_flex().w_full().h(cols ? Math.max(left?.length ?? 1, right?.length ?? 1) * ROW : ROW)
      .child(drawCode(t, line.left, [line.left?.old], Math.min(view.shift[0], view.sideMax(0)), left))
      // A 1px gap of the panel's chrome between the halves on background, as Pierre's sides, no rule.
      .child(div().w(1).h_full().flex_none().bg(t.chrome))
      .child(drawCode(t, line.right, [line.right?.new], Math.min(view.shift[1], view.sideMax(1)), right));
  }
  const numbers = kind === "solo" ? [line.kind === "-" ? line.old : line.new] : [line.old, line.new], lines = cut(line);
  return h_flex().w_full().h(lines ? lines.length * ROW : ROW).child(drawCode(t, line, numbers, Math.min(view.shift[2], view.sideMax(2)), lines));
}
