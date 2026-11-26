// What the pane's diff list shows, as plain data: no gpui here, so check-pane.cjs runs it under node.
// The daemon sends each hunk's rows already highlighted (plans/fork/04 in the jin.review fork).
import { STARTS, WIDTHS } from "./vendor/char-width.js";

// Heights on one scale: 20 a code line, 24 a hunk, 28 a group, 32 a file.
export const ROW = 20, HUNK = 24, GROUP = 28, FILE = 32, NOTE_LINE = 18;
// One column of 12px code font; past MAX_COLUMNS characters a line is cut, not scrolled to.
export const CHAR = 7.25, MAX_COLUMNS = 1000;
// Code lines go to the list in runs of up to this many, one item each: Herdr's v_virtual_list takes at most 10000 items,
// which a group of a few thousand changed lines passes when each line is one.
// shortcut: a group past about 5000 hunks still passes it; fold its files there if one ever does.
const RUN = 32;

/** Where code starts in a row, past the line numbers and sign: notes and placeholders line up with it. */
export const codeInset = (split) => split ? 52 : 92;

/** A code point's columns, as wcwidth counts them from Unicode's tables (vendor/char-width.js): East Asian Wide or Fullwidth
 * 2, a combining mark or a default-ignorable (a zero-width joiner, a variation selector) 0, else 1, a lone surrogate too. */
export function charWidth(cp) {
  if (cp < 0x10000) return BMP[cp];
  let lo = 0, hi = STARTS.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (STARTS[mid] <= cp) lo = mid; else hi = mid - 1; }
  return WIDTHS[lo];
}
// The BMP, where nearly all code is, a lookup each.
const BMP = new Uint8Array(0x10000);
STARTS.forEach((start, i) => { if (start < 0x10000) BMP.fill(WIDTHS[i], start, Math.min(STARTS[i + 1] ?? 0x10000, 0x10000)); });
// shortcut: by code point, as wcwidth, not by grapheme as string-width: an emoji joined of several counts each, so it wraps
// early, never late; count by Intl.Segmenter if that shows.
const textColumns = (text) => {
  let n = 0;
  // ASCII and C1 are 1 column, a tab 4: the engine's own regex scans for anything else, half the time of a loop on QuickJS.
  if (!NOT_ASCII.test(text)) {
    for (let i = text.indexOf("\t"); i >= 0; i = text.indexOf("\t", i + 1)) n += 3;
    return n + text.length;
  }
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0xa0) n += c === 9 ? 4 : 1;
    else { const cp = text.codePointAt(i); n += charWidth(cp); if (cp > 0xffff) i++; }
  }
  return n;
};
const NOT_ASCII = /[^\0-\x9f]/;
/** Measures a row, kept on it (its tokens don't change once clipped): `columns` as wcwidth counts them, `wide` how many are a
 *  wide character's 2, `plain` whether it's all ASCII (a tab 4). Else, for lineCount, by each character the narrow
 *  (`narrowTo`) and wide (`wideTo`) columns up to and with it. What a joiner joins is drawn as one with what's before it: 0. */
function measure(row) {
  const tokens = row.tokens;
  row.plain = tokens.every(([text]) => !NOT_ASCII.test(text));
  if (row.plain) { row.columns = tokens.reduce((n, [text]) => n + textColumns(text), 0); row.wide = 0; return row; }
  const size = tokens.reduce((n, [text]) => n + text.length * 4, 0) + 1;
  const narrowTo = new Uint16Array(size), wideTo = new Uint16Array(size);
  let at = 0, narrow = 0, wide = 0, prev = 0;
  for (const [text] of tokens) {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 9) { for (let k = 0; k < 4; k++) { narrowTo[++at] = ++narrow; wideTo[at] = wide; } prev = c; continue; }
      const cp = c < 0xd800 ? c : text.codePointAt(i), w = prev === 0x200d ? 0 : cp < 0xa0 ? 1 : charWidth(cp);
      if (w === 2) wide++; else narrow += w;
      narrowTo[++at] = narrow; wideTo[at] = wide; prev = cp;
      if (cp > 0xffff) i++;
    }
  }
  row.columns = narrow + 2 * wide; row.wide = wide; row.units = at; row.narrowTo = narrowTo; row.wideTo = wideTo;
  return row;
}
// How wide a row draws, in columns of the code font's character, a wide character `wide` of them: the code font seldom has
// CJK, and the font drawn in its place makes it about 1em, not 2 columns (diff.js measures it). As drawn, so past a clipped
// line's wide characters and tabs it still scrolls to its end. Narrow columns plus wide ones by `wide`, as wrapRow and
// lineCount add a line's, so the three agree to the last bit.
const span = (row, wide) => {
  if (!row) return 0;
  if (row.columns === undefined) measure(row);
  return (row.columns - 2 * row.wide) + wide * row.wide;
};

/** The columns a wrapped line holds at a diff `width` and a character's measured width, `char`: unified past both numbers,
 * split past one on each half (less the rule between them), an added or removed file's split rows on the whole width. A
 * wide character takes `wideChar` measured, as `wide` columns (2 until measured). */
export function wrapColumns(width, char, wideChar = 2 * char) {
  const fit = (w, inset) => Math.max(8, Math.floor((w - inset - 16) / char));
  return { row: fit(width, codeInset(false)), pair: fit((width - 1) / 2, codeInset(true)), solo: fit(width, codeInset(true)), wide: wideChar / char };
}

/** How many lines a row wraps to at `cols` columns, a wide character `wide`, as wrapRow cuts it but without cutting: a width's
 *  change counts every row of the group, and cuts only those drawn. An ASCII row is its columns over the width; any other
 *  finds where each line ends by halving, from its measured running columns, not a character at a time. */
export function lineCount(row, cols, wide = 2) {
  if (!row) return 1;
  const n = span(row, wide);
  if (n <= cols) return 1;
  if (row.plain) return Math.ceil(n / cols);
  const { narrowTo, wideTo, units } = row;
  let start = 0, lines = 0;
  while (start < units) {
    // The furthest end whose columns from the line's start fit; at least one character, as wrapRow's.
    let lo = start + 1, hi = units;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((narrowTo[mid] - narrowTo[start]) + wide * (wideTo[mid] - wideTo[start]) <= cols) lo = mid; else hi = mid - 1;
    }
    lines++; start = lo;
  }
  return Math.max(1, lines);
}

/** A row's tokens cut into lines of at most `cols` columns, as span() counts them (a wide character `wide`), each piece in its
 * token's color. Kept on the row for the width it was cut at: its tokens don't change once arrived. */
export function wrapRow(row, cols, wide = 2) {
  if (row.wrapAt === cols && row.wrapWide === wide) return row.wrapped;
  // By code points, cut only where a line breaks. Widths as measure() counts them; a pair is never split, nor a line
  // broken before a zero-width mark or a joined character. A row that fits is as it is.
  const fits = span(row, wide) <= cols, lines = [[]];
  let narrow = 0, wides = 0, prev = 0;
  for (const [token, color] of row.tokens) {
    const text = token.replaceAll("\t", "    ");
    if (fits) { if (text) lines[0].push([text, color]); continue; }
    let start = 0;
    for (let i = 0; i < text.length;) {
      const c = text.charCodeAt(i), cp = c < 0xd800 ? c : text.codePointAt(i), w = prev === 0x200d ? 0 : cp < 0xa0 ? 1 : charWidth(cp);
      const dn = w === 2 ? 0 : w, dw = w === 2 ? 1 : 0;
      if ((narrow || wides) && (narrow + dn) + wide * (wides + dw) > cols) { if (i > start) lines.at(-1).push([text.slice(start, i), color]); lines.push([]); start = i; narrow = wides = 0; }
      narrow += dn; wides += dw; prev = cp; i += cp > 0xffff ? 2 : 1;
    }
    if (text.length > start) lines.at(-1).push([text.slice(start), color]);
  }
  row.wrapAt = cols; row.wrapWide = wide; row.wrapped = lines;
  return lines;
}

// A group's rows run past the 8 MB one read carries: a read asks for at most ROW_BUDGET changed lines, from the files in view
// and the LOOKAHEAD after them, so the rest come as the list reaches them. As the daemon's FIRST_ROWS for an open.
const ROW_BUDGET = 3000;
export const LOOKAHEAD = 10;

/** The paths of a read's rows: in view or just after, without rows and not folded, while they fit (the first always). */
export function rowsToAsk(paths, fileAt, inView, collapsed) {
  let first = -1, last = -1;
  paths.forEach((path, i) => { if (inView.has(path)) { if (first < 0) first = i; last = i; } });
  const out = [];
  let lines = 0;
  for (const path of paths.slice(Math.max(first, 0), Math.max(last, 0) + LOOKAHEAD + 1)) {
    const f = fileAt(path);
    if (!f || f.hunks || f.isBinary || collapsed.has(path)) continue;
    const size = f.additions + f.deletions;
    if (out.length && lines + size > ROW_BUDGET) break;
    out.push(path); lines += size;
  }
  return out;
}

/** Cuts each row's tokens, in place, at MAX_COLUMNS characters (at least as many columns), as they arrive: a line of a log or
 *  minified file runs to megabytes, which Herdr's engine can't measure or draw before it interrupts the render. Then each is
 *  measured, there in the read's task rather than in a render. */
export function clipRows(rows) {
  for (const row of rows) {
    // Only a row past the cut is copied: the daemon's come cut already.
    let left = MAX_COLUMNS, i = 0;
    while (i < row.tokens.length && left > 0) left -= row.tokens[i++][0].length;
    if (i < row.tokens.length || left < 0) {
      row.tokens = row.tokens.slice(0, i);
      const [text, ...color] = row.tokens[i - 1];
      if (left < 0) row.tokens[i - 1] = [text.slice(0, text.length + left), ...color];
    }
    measure(row);
  }
  return rows;
}

/**
 * How wide the code must be to show its longest line, gutters included: unified rows, one `side` ("left", "right")
 * of split pairs, or the "solo" rows a split view gives an added or removed file, which take the whole width.
 */
export function contentWidth(items, side, char = CHAR, wide = 2) {
  let most = 0;
  for (const item of items) {
    if (item.kind !== (!side ? "row" : side === "solo" ? "solo" : "pair")) continue;
    for (const line of item.lines) { const row = side && side !== "solo" ? line[side] : line; if (row) most = Math.max(most, span(row, wide)); }
  }
  return Math.ceil(codeInset(Boolean(side)) + most * char + 16);
}

/** A page in words, for the pane's header. */
export function pageLabel(page, review) {
  const [, kind, ...rest] = page.split("/"), value = decodeURIComponent(rest.join("/"));
  if (kind === "worktree") return "Uncommitted changes";
  if (kind === "branch") return `${value} vs ${review?.base?.ref ?? "base"}`;
  if (kind === "commit") return review?.title || value.slice(0, 7);
  // A branch against its upstream is what there is to push or pull: named as the commits flow, `main → origin/main` or back.
  const [from, to] = value.split("...");
  if (kind === "compare" && to) return to.endsWith(`/${from}`) || from.endsWith(`/${to}`) ? `${to} → ${from}` : `${to} vs ${from}`;
  return value;
}

/** Context lines on both sides; a run of deletions faces the additions that follow it. */
export function pairRows(rows) {
  const pairs = [];
  for (let i = 0; i < rows.length;) {
    if (rows[i].kind === " ") { pairs.push({ left: rows[i], right: rows[i] }); i++; continue; }
    const dels = [], adds = [];
    while (i < rows.length && rows[i].kind === "-") dels.push(rows[i++]);
    while (i < rows.length && rows[i].kind === "+") adds.push(rows[i++]);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) pairs.push({ left: dels[k], right: adds[k] });
  }
  return pairs;
}

/** The width a note's text wraps at, past the row's or card's padding and the mark before it. */
// shortcut: Herdr's Markdown wraps without its inline code chips' padding, so a line of them runs past the width;
// 32px of slack covers a few chips a line. A wrap that counted the chips would drop it.
export const noteWidth = (width, anchored) => (anchored ? Math.min(width - 24, 800) - 20 : width - 24) - 20 - 32;

/** Rough height of a note, as the app's AnalysisNoteCard lays it out: a file's own note is a row across the file
 *  (12px in, 6px padding), a line's is a card under the line (12px in, at most 800 wide, 10 by 4 padding,
 *  3px apart). Either has a 12px mark and an 8px gap before its text. Characters take charWidth's columns. */
export function noteHeight(text, width, anchored) {
  const columns = Math.max(20, Math.floor(noteWidth(width, anchored) / 7));
  const lines = text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(textColumns(line) / columns)), 0);
  return lines * NOTE_LINE + (anchored ? 16 : 12);
}

/** Every file a group shows: its own, then its children's. */
export const groupFiles = (group) => [...group.files, ...group.children.flatMap(child => child.files)];

/** The list for one group: a header per child group and per file and, unless the file is collapsed, its notes and rows, in
 *  runs of up to RUN broken by a line's note, with the heights `v_virtual_list` takes. `full` holds a file's whole-file
 *  answer (`{ rows, truncated }`) once loaded. `parts` keeps each file's items from the last build, reused while what
 *  they're drawn from holds: a batch of rows or a fold rebuilds its files, not a group of thousands. */
export function buildItems(review, group, { collapsed, full, split, width, wrap = null, parts = new Map() }) {
  const items = [], byPath = new Map(review.files.map(file => [file.path, file]));
  const notesOf = (g, path) => [g, ...g.children].flatMap(x => x.notes[path] ?? []);
  const addFile = (path) => {
    const file = byPath.get(path);
    if (!file) return;
    items.push({ key: `f:${path}`, kind: "file", file, size: FILE, path });
    if (collapsed.has(path)) return;
    const notes = notesOf(group, path), whole = full.get(path), hunks = file.hunks;
    // What its items show: rows arriving, a page more (a hunk added, or the last one's rows), a whole file, its notes (and
    // the width they wrap at), the mode. A read's new file objects carry the rows already shown.
    const stamp = [hunks, hunks?.length, hunks?.at(-1)?.rows, file.clipped, file.stuck, file.status, file.isBinary, file.truncated,
      whole, whole?.rows, whole?.truncated, whole?.stuck, split, notes.length ? `${width}:${JSON.stringify(notes)}` : "", wrap && `${wrap.row}:${wrap.pair}:${wrap.solo}:${wrap.wide}`];
    let part = parts.get(path);
    if (!part || stamp.some((value, i) => value !== part.stamp[i])) parts.set(path, part = { stamp, items: fileItems(path, file, notes, whole, split, width, wrap) });
    for (const item of part.items) items.push(item);
  };
  for (const path of group.files) addFile(path);
  for (const child of group.children) {
    items.push({ key: `g:${child.key}`, kind: "group", group: child, size: GROUP });
    for (const path of child.files) addFile(path);
  }
  return items;
}

/** A file's items under its header: its own notes, then its rows (or the whole file's), with their lines' notes. */
function fileItems(path, file, notes, whole, split, width, wrap) {
  const items = [];
  // Each names its file: a path may hold ":", which its key can't be split at.
  const push = (item, size) => { items.push({ ...item, size, path }); };
  // The file's own notes, and notes on lines no hunk shows, sit under its header as the app shows them; a rule ends them.
  const own = notes.filter(note => !note.anchor);
  for (const [i, note] of own.entries()) push({ key: `n:${path}:f${i}`, kind: "note", note, last: i === own.length - 1 }, noteHeight(note.text, width, false));
  // A binary file has no rows: its header says `binary`.
  if (file.isBinary) return items;
  const hunks = whole ? [{ header: null, rows: whole.rows }] : file.hunks;
  if (!hunks) {
    push({ key: `e:${path}`, kind: "empty", text: "Loading…", loading: true }, ROW);
    return items;
  }
  if (!hunks.length) {
    push({ key: `e:${path}`, kind: "empty", text: file.isBinary ? "Binary file" : file.truncated ? "Too large to show" : "No text changes" }, ROW);
    return items;
  }
  // Split, an added or removed file has one side only: it takes the whole width rather than half.
  const solo = split && (file.status === "added" || file.status === "removed");
  const kind = !split ? "row" : solo ? "solo" : "pair";
  // Wrapped, a line is as many ROWs as it runs to; a pair, as its longer side.
  const count = (row) => lineCount(row, wrap[kind], wrap.wide);
  const height = (line) => !wrap ? ROW : (kind === "pair" ? Math.max(count(line.left), count(line.right)) : count(line)) * ROW;
  // The anchored notes by the line they're on: each row looks up its own, not every note of the file.
  const anchored = new Map();
  for (const [i, note] of notes.entries()) {
    const at = note.anchor && `${note.anchor.side}:${note.anchor.line}`;
    if (at) anchored.set(at, [...anchored.get(at) ?? [], i]);
  }
  for (const [h, hunk] of hunks.entries()) {
    if (hunk.header) push({ key: `h:${path}:${h}`, kind: "hunk", text: hunk.header }, HUNK);
    const lines = split && !solo ? pairRows(hunk.rows) : hunk.rows;
    let run = /** @type {any} */ (null);
    for (const [r, line] of lines.entries()) {
      if (!run || run.lines.length === RUN) { run = { key: `r:${path}:${h}:${r}`, kind, lines: [], path, size: 0 }; items.push(run); }
      run.lines.push(line); run.size += height(line);
      if (!anchored.size) continue;
      const rows = kind === "pair" ? [line.left, line.right].filter(Boolean) : [line];
      // A removed line holds the deletions side's notes, any other the additions'; a pair's two sides, in the file's order.
      const here = [...new Set(rows.flatMap(row => anchored.get(row.kind === "-" ? `deletions:${row.old}` : `additions:${row.new}`) ?? []))];
      for (const i of here.sort((a, b) => a - b)) {
        push({ key: `n:${path}:${i}`, kind: "note", note: notes[i], anchored: true }, noteHeight(notes[i].text, width, true));
        run = null;
      }
    }
  }
  // Past the bytes one read carries, the daemon sends the rows only so far: the next page comes as this row nears the view.
  const stuck = (whole ?? file).stuck;
  if (whole ? whole.truncated : file.clipped) push({ key: `e:${path}:cut`, kind: "empty", text: stuck ? "The rest of this file is too large to show" : "Loading…", loading: !stuck, more: !stuck }, ROW);
  return items;
}
