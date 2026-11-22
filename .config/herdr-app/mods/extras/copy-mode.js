// Native Vim copy mode for Herdr (ctrl-a [): full Vim motions, instant relative line numbers,
// visual / visual-line selection, incremental / and ? search, and clipboard yank.
// Reads terminal history via `hc read --json --lines 2000 <terminal>` (works on macOS, Windows, and WSL/SSH).
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, settings, focused, hc, run, closeOverlay, props } from "herdr";

const MAX_REPEAT = 500;
const SCROLLOFF = 3;
const MAX_HISTORY = 2000;

const isSpace = (c) => c === " " || c === "\t" || c === "\r";
const isWordChar = (c) => /[A-Za-z0-9_]/.test(c);
const charClass = (c) => (isSpace(c) ? 0 : isWordChar(c) ? 1 : 2);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const lineEnd = (line) => Math.max(0, (line?.length ?? 0) - 1);

export function firstNonBlank(line) {
  if (!line) return 0;
  for (let i = 0; i < line.length; i++) if (!isSpace(line[i])) return i;
  return 0;
}

export function motionW(lines, row, col, big = false) {
  const lastRow = lines.length - 1;
  let r = clamp(row, 0, lastRow);
  let line = lines[r] ?? "";
  let c = clamp(col, 0, lineEnd(line));

  if (line.length > 0) {
    const startCls = big ? (isSpace(line[c]) ? 0 : 1) : charClass(line[c]);
    if (startCls !== 0) {
      while (c < line.length && (big ? !isSpace(line[c]) : charClass(line[c]) === startCls)) c++;
    }
    while (c < line.length && isSpace(line[c])) c++;
    if (c < line.length) return { row: r, col: c };
  }

  while (r < lastRow) {
    r++;
    line = lines[r] ?? "";
    if (line.length === 0) return { row: r, col: 0 };
    c = 0;
    while (c < line.length && isSpace(line[c])) c++;
    if (c < line.length) return { row: r, col: c };
  }
  return { row: lastRow, col: lineEnd(lines[lastRow]) };
}

export function motionB(lines, row, col, big = false) {
  let r = clamp(row, 0, lines.length - 1);
  let line = lines[r] ?? "";
  let c = clamp(col, 0, lineEnd(line));

  const stepBack = () => {
    if (c > 0) { c--; return true; }
    if (r === 0) return false;
    r--;
    line = lines[r] ?? "";
    c = lineEnd(line);
    return true;
  };

  if (!stepBack()) return { row: 0, col: 0 };

  while (line.length === 0 || isSpace(line[c])) {
    if (line.length === 0) return { row: r, col: 0 };
    if (!stepBack()) return { row: 0, col: 0 };
  }

  const cls = big ? 1 : charClass(line[c]);
  while (c > 0 && (big ? !isSpace(line[c - 1]) : charClass(line[c - 1]) === cls)) c--;
  return { row: r, col: c };
}

export function motionE(lines, row, col, big = false) {
  const lastRow = lines.length - 1;
  let r = clamp(row, 0, lastRow);
  let line = lines[r] ?? "";
  let c = clamp(col, 0, lineEnd(line));

  const stepFwd = () => {
    if (c + 1 < line.length) { c++; return true; }
    if (r >= lastRow) return false;
    r++;
    line = lines[r] ?? "";
    c = 0;
    return true;
  };

  if (!stepFwd()) return { row: r, col: c };
  while (line.length === 0 || isSpace(line[c])) {
    if (!stepFwd()) return { row: lastRow, col: lineEnd(lines[lastRow]) };
  }

  const cls = big ? 1 : charClass(line[c]);
  while (c + 1 < line.length && (big ? !isSpace(line[c + 1]) : charClass(line[c + 1]) === cls)) c++;
  return { row: r, col: c };
}

export function motionGE(lines, row, col, big = false) {
  let r = clamp(row, 0, lines.length - 1);
  let line = lines[r] ?? "";
  let c = clamp(col, 0, lineEnd(line));

  const stepBack = () => {
    if (c > 0) { c--; return true; }
    if (r === 0) return false;
    r--;
    line = lines[r] ?? "";
    c = lineEnd(line);
    return true;
  };

  if (!stepBack()) return { row: 0, col: 0 };
  while (line.length === 0 || isSpace(line[c])) {
    if (!stepBack()) return { row: 0, col: 0 };
  }
  return { row: r, col: c };
}

export function innerWordBounds(line, col, big = false) {
  if (!line) return { start: 0, end: 0 };
  const c = clamp(col, 0, lineEnd(line));
  const cls = big ? (isSpace(line[c]) ? 0 : 1) : charClass(line[c]);
  const same = (i) => (big ? (isSpace(line[i]) ? 0 : 1) === cls : charClass(line[i]) === cls);
  let start = c, end = c;
  while (start > 0 && same(start - 1)) start--;
  while (end + 1 < line.length && same(end + 1)) end++;
  return { start, end };
}

export function findCharOnLine(line, col, kind, target) {
  if (!line || !target) return null;
  if (kind === "f" || kind === "t") {
    const idx = line.indexOf(target, col + 1);
    if (idx < 0) return null;
    return kind === "t" ? Math.max(col, idx - 1) : idx;
  }
  const idx = line.lastIndexOf(target, col - 1);
  if (idx < 0) return null;
  return kind === "T" ? Math.min(col, idx + 1) : idx;
}

export function motionParagraph(lines, row, dir) {
  const lastRow = lines.length - 1;
  let r = clamp(row, 0, lastRow);
  const blank = (i) => !(lines[i] ?? "").trim();
  if (dir > 0) {
    while (r < lastRow && blank(r)) r++;
    while (r < lastRow && !blank(r)) r++;
    return r;
  }
  while (r > 0 && blank(r)) r--;
  while (r > 0 && !blank(r)) r--;
  return r;
}

export function normalizeRange(a, b) {
  if (a.row < b.row || (a.row === b.row && a.col <= b.col)) {
    return { startRow: a.row, startCol: a.col, endRow: b.row, endCol: b.col };
  }
  return { startRow: b.row, startCol: b.col, endRow: a.row, endCol: a.col };
}

export function extractRange(lines, start, end, lineWise = false) {
  const r = normalizeRange(start, end);
  if (lineWise) return lines.slice(r.startRow, r.endRow + 1).join("\n");
  if (r.startRow === r.endRow) {
    const line = lines[r.startRow] ?? "";
    return line.slice(r.startCol, r.endCol + 1);
  }
  const out = [(lines[r.startRow] ?? "").slice(r.startCol)];
  for (let i = r.startRow + 1; i < r.endRow; i++) out.push(lines[i] ?? "");
  out.push((lines[r.endRow] ?? "").slice(0, r.endCol + 1));
  return out.join("\n");
}

export function findMatches(lines, query) {
  if (!query) return [];
  const sensitive = /[A-Z]/.test(query);
  const needle = sensitive ? query : query.toLowerCase();
  const out = [];
  for (let r = 0; r < lines.length; r++) {
    const hay = sensitive ? lines[r] : lines[r].toLowerCase();
    let idx = 0;
    while ((idx = hay.indexOf(needle, idx)) !== -1) {
      out.push({ row: r, col: idx, len: query.length });
      idx += Math.max(1, query.length);
    }
  }
  return out;
}

export function jumpMatch(matches, row, col, dir) {
  if (!matches.length) return null;
  if (dir >= 0) {
    const hit = matches.find((m) => m.row > row || (m.row === row && m.col > col));
    return hit ?? matches[0];
  }
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    if (m.row < row || (m.row === row && m.col < col)) return m;
  }
  return matches[matches.length - 1];
}

export function keyCharOf(e) {
  const m = e.modifiers || {};
  if (m.control || m.alt || m.platform) return null;
  if (e.key_char && e.key_char.length === 1) return e.key_char;
  if (e.key && e.key.length === 1) return m.shift ? e.key.toUpperCase() : e.key;
  return null;
}

export function createCopyState(lines) {
  const safe = lines.length ? lines : [""];
  let startRow = safe.length - 1;
  while (startRow > 0 && !safe[startRow].trim()) startRow--;
  return {
    lines: safe,
    row: startRow,
    col: 0,
    desiredCol: 0,
    mode: "normal", // "normal" | "visual" | "line" | "search"
    anchor: null,
    count: "",
    pending: "", // "", "g", "y", "f", "F", "t", "T", "i", "yi"
    lastFind: null,
    searchDir: 1,
    searchInput: "",
    searchQuery: "",
    searchOrigin: null,
    matches: [],
    scrollTop: Math.max(0, startRow - 20),
    scrollLeft: 0,
  };
}

function setPos(state, row, col, updateDesired = true) {
  state.row = clamp(row, 0, state.lines.length - 1);
  const maxC = lineEnd(state.lines[state.row]);
  state.col = clamp(col, 0, maxC);
  if (updateDesired) state.desiredCol = state.col;
}

function ensureVisible(state, viewRows) {
  const vr = Math.max(5, viewRows || 30);
  const maxScroll = Math.max(0, state.lines.length - vr);
  const margin = Math.min(SCROLLOFF, Math.floor(vr / 3));
  if (state.row < state.scrollTop + margin) state.scrollTop = state.row - margin;
  else if (state.row >= state.scrollTop + vr - margin) state.scrollTop = state.row - vr + margin + 1;
  state.scrollTop = clamp(state.scrollTop, 0, maxScroll);
}

/**
 * Pure Vim key handler. `ops`: { copy(text), close() }. Returns true if consumed.
 */
export function handleCopyKey(state, e, viewRows, ops) {
  const m = e.modifiers || {};
  if (m.alt || m.platform) return false;

  const key = (e.key || "").toLowerCase();
  const ctrl = Boolean(m.control);
  const ch = keyCharOf(e);
  const vr = Math.max(5, viewRows || 30);

  // Search prompt input mode (/ or ?)
  if (state.mode === "search") {
    const origin = state.searchOrigin ?? { row: state.row, col: state.col };
    if (key === "escape" || (ctrl && (key === "c" || key === "["))) {
      state.mode = "normal";
      state.searchInput = "";
      state.searchOrigin = null;
      setPos(state, origin.row, origin.col);
      ensureVisible(state, vr);
      return true;
    }
    if (key === "enter" || key === "return") {
      state.mode = "normal";
      if (state.searchInput) {
        state.searchQuery = state.searchInput;
        state.matches = findMatches(state.lines, state.searchQuery);
        const hit = jumpMatch(state.matches, origin.row, origin.col, state.searchDir);
        if (hit) { setPos(state, hit.row, hit.col); ensureVisible(state, vr); }
      }
      state.searchInput = "";
      state.searchOrigin = null;
      return true;
    }
    if (key === "backspace") {
      if (state.searchInput.length > 0) {
        state.searchInput = state.searchInput.slice(0, -1);
        const preview = findMatches(state.lines, state.searchInput);
        const hit = jumpMatch(preview, origin.row, origin.col, state.searchDir);
        if (hit) { setPos(state, hit.row, hit.col); ensureVisible(state, vr); }
        else { setPos(state, origin.row, origin.col); ensureVisible(state, vr); }
      } else {
        state.mode = "normal";
        state.searchOrigin = null;
        setPos(state, origin.row, origin.col);
        ensureVisible(state, vr);
      }
      return true;
    }
    if (!ctrl && ch) {
      state.searchInput += ch;
      const preview = findMatches(state.lines, state.searchInput);
      const hit = jumpMatch(preview, origin.row, origin.col, state.searchDir);
      if (hit) { setPos(state, hit.row, hit.col); ensureVisible(state, vr); }
      return true;
    }
    return true;
  }

  // Pending f/F/t/T target character (including yf/yt)
  const findKind = state.pending.endsWith("f") ? "f"
    : state.pending.endsWith("F") ? "F"
    : state.pending.endsWith("t") ? "t"
    : state.pending.endsWith("T") ? "T" : null;
  if (findKind) {
    const isYank = state.pending.startsWith("y");
    state.pending = "";
    if (key === "escape" || ctrl || !ch) { state.count = ""; return true; }
    const repeat = clamp(Number(state.count) || 1, 1, MAX_REPEAT);
    state.count = "";
    state.lastFind = { kind: findKind, ch };
    const startPos = { row: state.row, col: state.col };
    let c = state.col;
    for (let i = 0; i < repeat; i++) {
      const next = findCharOnLine(state.lines[state.row], c, findKind, ch);
      if (next === null) break;
      c = next;
    }
    if (isYank) {
      if (c !== startPos.col) {
        ops.copy(extractRange(state.lines, startPos, { row: state.row, col: c }, false));
        ops.close();
      }
      return true;
    }
    setPos(state, state.row, c);
    return true;
  }

  // Pending inner text object (i -> iw / iW, yi -> yiw / yiW)
  if (state.pending === "i" || state.pending === "yi") {
    const isYank = state.pending === "yi";
    state.pending = "";
    state.count = "";
    if (!ctrl && (ch === "w" || ch === "W")) {
      const b = innerWordBounds(state.lines[state.row], state.col, ch === "W");
      if (isYank) {
        ops.copy(extractRange(state.lines, { row: state.row, col: b.start }, { row: state.row, col: b.end }, false));
        ops.close();
      } else {
        state.mode = "visual";
        state.anchor = { row: state.row, col: b.start };
        setPos(state, state.row, b.end);
      }
    }
    return true;
  }

  const clearPending = () => { state.count = ""; state.pending = ""; };

  // Hard exit: q, Ctrl+C, Ctrl+G
  if ((!ctrl && ch === "q") || (ctrl && (key === "c" || key === "g"))) {
    clearPending();
    ops.close();
    return true;
  }

  // Esc / Ctrl+[: clear pending, or drop Visual/V-LINE -> Normal, or close when already in Normal
  if (key === "escape" || (ctrl && key === "[")) {
    if (state.count || state.pending) { clearPending(); return true; }
    if (state.mode !== "normal") {
      state.mode = "normal";
      state.anchor = null;
      return true;
    }
    ops.close();
    return true;
  }

  // Enter copies current selection (or current line in normal mode) and exits
  if (!ctrl && (key === "enter" || key === "return")) {
    clearPending();
    const text = state.mode === "normal"
      ? (state.lines[state.row] ?? "")
      : extractRange(state.lines, state.anchor ?? { row: state.row, col: state.col }, { row: state.row, col: state.col }, state.mode === "line");
    ops.copy(text);
    ops.close();
    return true;
  }

  // Yank operator / visual yank
  if (!ctrl && ch === "y") {
    if (state.mode !== "normal") {
      const text = extractRange(state.lines, state.anchor ?? { row: state.row, col: state.col }, { row: state.row, col: state.col }, state.mode === "line");
      clearPending();
      ops.copy(text);
      ops.close();
      return true;
    }
    if (state.pending === "y") {
      const repeat = clamp(Number(state.count) || 1, 1, MAX_REPEAT);
      const endRow = clamp(state.row + repeat - 1, 0, state.lines.length - 1);
      clearPending();
      ops.copy(extractRange(state.lines, { row: state.row, col: 0 }, { row: endRow, col: 0 }, true));
      ops.close();
      return true;
    }
    state.pending = "y";
    return true;
  }
  if (!ctrl && ch === "Y") {
    const repeat = clamp(Number(state.count) || 1, 1, MAX_REPEAT);
    const endRow = clamp(state.row + repeat - 1, 0, state.lines.length - 1);
    clearPending();
    ops.copy(extractRange(state.lines, { row: state.row, col: 0 }, { row: endRow, col: 0 }, true));
    ops.close();
    return true;
  }

  // Inner text object prefix: `viw` / `viW` / `yiw` / `yiW`
  if (!ctrl && ch === "i" && (state.mode === "visual" || state.pending === "y")) {
    state.pending = state.pending === "y" ? "yi" : "i";
    return true;
  }

  // f/F/t/T find char prefix
  if (!ctrl && (ch === "f" || ch === "F" || ch === "t" || ch === "T")) {
    state.pending = state.pending === "y" ? `y${ch}` : ch;
    return true;
  }

  // Numeric count prefix (1..9, or 0 after existing digits)
  if (!ctrl && ch && ch >= "0" && ch <= "9" && (ch !== "0" || state.count.length > 0)) {
    if (state.count.length < 3) state.count += ch;
    return true;
  }

  // Search triggers
  if (!ctrl && (ch === "/" || ch === "?")) {
    clearPending();
    state.mode = "search";
    state.searchDir = ch === "/" ? 1 : -1;
    state.searchInput = "";
    state.searchOrigin = { row: state.row, col: state.col };
    return true;
  }
  if (!ctrl && ch === "*") {
    clearPending();
    const b = innerWordBounds(state.lines[state.row], state.col, false);
    const word = (state.lines[state.row] ?? "").slice(b.start, b.end + 1).trim();
    if (word) {
      state.searchQuery = word;
      state.searchDir = 1;
      state.matches = findMatches(state.lines, word);
      const hit = jumpMatch(state.matches, state.row, state.col, 1);
      if (hit) { setPos(state, hit.row, hit.col); ensureVisible(state, vr); }
    }
    return true;
  }
  if (!ctrl && (ch === "n" || ch === "N")) {
    clearPending();
    const dir = ch === "n" ? state.searchDir : -state.searchDir;
    const hit = jumpMatch(state.matches, state.row, state.col, dir);
    if (hit) { setPos(state, hit.row, hit.col); ensureVisible(state, vr); }
    return true;
  }

  // Visual toggles + swap anchor (`o`)
  if (!ctrl && (ch === "v" || key === "space")) {
    clearPending();
    if (state.mode === "visual") { state.mode = "normal"; state.anchor = null; }
    else { state.mode = "visual"; if (!state.anchor) state.anchor = { row: state.row, col: state.col }; }
    return true;
  }
  if (!ctrl && ch === "V") {
    clearPending();
    if (state.mode === "line") { state.mode = "normal"; state.anchor = null; }
    else { state.mode = "line"; if (!state.anchor) state.anchor = { row: state.row, col: state.col }; }
    return true;
  }
  if (!ctrl && ch === "o" && state.mode !== "normal" && state.anchor) {
    clearPending();
    const prev = state.anchor;
    state.anchor = { row: state.row, col: state.col };
    setPos(state, prev.row, prev.col);
    ensureVisible(state, vr);
    return true;
  }

  // `g` prefix (`gg`, `ge`, `gE`)
  if (!ctrl && ch === "g" && state.pending !== "g" && state.pending !== "yg") {
    state.pending = state.pending === "y" ? "yg" : "g";
    return true;
  }

  const isYankOp = state.pending === "y" || state.pending === "yg";
  const isG = state.pending === "g" || state.pending === "yg";
  const hasCount = state.count.length > 0;
  const repeat = clamp(Number(state.count) || 1, 1, MAX_REPEAT);
  const startPos = { row: state.row, col: state.col };
  let moved = false;
  let lineWiseOp = false;
  let exclusiveOp = false;

  const moveStep = (fn) => {
    let pos = { row: state.row, col: state.col };
    for (let i = 0; i < repeat; i++) pos = fn(pos);
    setPos(state, pos.row, pos.col);
    moved = true;
  };

  if (isG) {
    if (!ctrl && ch === "g") {
      const targetRow = hasCount ? clamp(repeat - 1, 0, state.lines.length - 1) : 0;
      setPos(state, targetRow, firstNonBlank(state.lines[targetRow]));
      moved = true;
      lineWiseOp = true;
    } else if (!ctrl && (ch === "e" || ch === "E")) {
      moveStep((p) => motionGE(state.lines, p.row, p.col, ch === "E"));
    }
  } else if (ctrl) {
    const half = Math.max(1, Math.floor(vr / 2));
    if (key === "u") { setPos(state, state.row - half * repeat, state.desiredCol, false); moved = true; lineWiseOp = true; }
    else if (key === "d") { setPos(state, state.row + half * repeat, state.desiredCol, false); moved = true; lineWiseOp = true; }
    else if (key === "b") { setPos(state, state.row - vr * repeat, state.desiredCol, false); moved = true; lineWiseOp = true; }
    else if (key === "f") { setPos(state, state.row + vr * repeat, state.desiredCol, false); moved = true; lineWiseOp = true; }
  } else if (ch === "h" || key === "left") {
    setPos(state, state.row, state.col - repeat); moved = true; exclusiveOp = true;
  } else if (ch === "l" || key === "right") {
    setPos(state, state.row, state.col + repeat); moved = true; exclusiveOp = true;
  } else if (ch === "k" || key === "up") {
    setPos(state, state.row - repeat, state.desiredCol, false); moved = true; lineWiseOp = true;
  } else if (ch === "j" || key === "down") {
    setPos(state, state.row + repeat, state.desiredCol, false); moved = true; lineWiseOp = true;
  } else if (ch === "w" || ch === "W") {
    moveStep((p) => motionW(state.lines, p.row, p.col, ch === "W"));
    exclusiveOp = true;
  } else if (ch === "b" || ch === "B") {
    moveStep((p) => motionB(state.lines, p.row, p.col, ch === "B"));
    exclusiveOp = true;
  } else if (ch === "e" || ch === "E") {
    moveStep((p) => motionE(state.lines, p.row, p.col, ch === "E"));
  } else if (ch === "0" || key === "home") {
    setPos(state, state.row, 0); moved = true; exclusiveOp = true;
  } else if (ch === "^") {
    setPos(state, state.row, firstNonBlank(state.lines[state.row])); moved = true; exclusiveOp = true;
  } else if (ch === "$" || key === "end") {
    setPos(state, state.row, lineEnd(state.lines[state.row])); state.desiredCol = 1e9; moved = true;
  } else if (ch === "G") {
    const targetRow = hasCount ? clamp(repeat - 1, 0, state.lines.length - 1) : state.lines.length - 1;
    setPos(state, targetRow, firstNonBlank(state.lines[targetRow])); moved = true; lineWiseOp = true;
  } else if (ch === "H") {
    setPos(state, state.scrollTop, firstNonBlank(state.lines[state.scrollTop])); moved = true; lineWiseOp = true;
  } else if (ch === "M") {
    const mid = clamp(state.scrollTop + Math.floor(vr / 2), 0, state.lines.length - 1);
    setPos(state, mid, firstNonBlank(state.lines[mid])); moved = true; lineWiseOp = true;
  } else if (ch === "L") {
    const bot = clamp(state.scrollTop + vr - 1, 0, state.lines.length - 1);
    setPos(state, bot, firstNonBlank(state.lines[bot])); moved = true; lineWiseOp = true;
  } else if (ch === "{" || ch === "}") {
    let r = state.row;
    for (let i = 0; i < repeat; i++) r = motionParagraph(state.lines, r, ch === "}" ? 1 : -1);
    setPos(state, r, 0); moved = true; lineWiseOp = true;
  } else if (key === "pageup") {
    setPos(state, state.row - vr * repeat, state.desiredCol, false); moved = true; lineWiseOp = true;
  } else if (key === "pagedown") {
    setPos(state, state.row + vr * repeat, state.desiredCol, false); moved = true; lineWiseOp = true;
  } else if ((ch === ";" || ch === ",") && state.lastFind) {
    const inv = { f: "F", F: "f", t: "T", T: "t" };
    const kind = ch === ";" ? state.lastFind.kind : inv[state.lastFind.kind];
    let c = state.col;
    for (let i = 0; i < repeat; i++) {
      const next = findCharOnLine(state.lines[state.row], c, kind, state.lastFind.ch);
      if (next === null) break;
      c = next;
    }
    setPos(state, state.row, c); moved = true;
  }

  clearPending();
  if (!moved) return true;

  if (isYankOp) {
    let endPos = { row: state.row, col: state.col };
    if (exclusiveOp && !lineWiseOp && endPos.row === startPos.row && endPos.col > startPos.col) {
      endPos = { row: endPos.row, col: endPos.col - 1 };
    }
    ops.copy(extractRange(state.lines, startPos, endPos, lineWiseOp));
    ops.close();
    return true;
  }

  ensureVisible(state, vr);
  return true;
}

function parseReadLines(r) {
  if (!r || r.code !== 0) throw new Error(r?.stderr?.trim() || r?.stdout?.trim() || "hc read failed");
  const data = JSON.parse(r.stdout);
  const raw = (data.text ?? "").replace(/\r\n/g, "\n");
  const lines = raw.split("\n");
  while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.length ? lines : [""];
}

export function initCopyMode(view, cx) {
  const p = props();
  const f = focused();
  const terminal = p?.terminal ?? f?.terminal ?? null;
  view.cmPane = p?.pane ?? f?.pane ?? null;
  view.cmTerminal = terminal;
  view.handle = cx.focus_handle();
  view.handle.focus();
  view.cm = createCopyState([""]);
  view.cmLoading = true;
  view.cmError = null;
  view.cmListH = undefined;
  view.cmListW = undefined;
  view.cmInitScroll = false;

  if (!terminal) {
    view.cmLoading = false;
    view.cmError = "No focused terminal";
    return;
  }

  cx.spawn(async (cx) => {
    try {
      // Stage 1: `--lines 0` returns the active screen in ~10ms on every terminal (even alternate-screen TUIs where `--lines > 0` stalls hc).
      const r0 = await hc(["read", "--json", "--lines", "0", terminal]);
      const screenLines = parseReadLines(r0);
      view.cm = createCopyState(screenLines);
      view.cmInitScroll = true;
      view.cmLoading = false;
      view.handle.focus();
      cx.notify();

      // Stage 2: always fetch full scrollback in the background without blocking initial display.
      const r1 = await hc(["read", "--json", "--lines", String(MAX_HISTORY), terminal]);
      const fullLines = parseReadLines(r1);
      if (fullLines.length <= view.cm.lines.length) return;
      const delta = fullLines.length - view.cm.lines.length;
      view.cm.lines = fullLines;
      view.cm.row += delta;
      view.cm.scrollTop += delta;
      if (view.cm.anchor) view.cm.anchor = { row: view.cm.anchor.row + delta, col: view.cm.anchor.col };
      if (view.cm.searchOrigin) view.cm.searchOrigin = { row: view.cm.searchOrigin.row + delta, col: view.cm.searchOrigin.col };
      if (view.cm.searchQuery) view.cm.matches = findMatches(fullLines, view.cm.searchQuery);
      cx.notify();
    } catch (e) {
      if (view.cmLoading) {
        view.cmLoading = false;
        view.cmError = e instanceof Error ? e.message : String(e);
        cx.notify();
      }
    }
  });
}

function lineSelectionSpan(state, rowIdx, lineLen) {
  if (state.mode !== "visual" && state.mode !== "line") return null;
  const r = normalizeRange(state.anchor ?? { row: state.row, col: state.col }, { row: state.row, col: state.col });
  if (rowIdx < r.startRow || rowIdx > r.endRow) return null;
  if (state.mode === "line") return { start: 0, end: Math.max(0, lineLen - 1), fullLine: true };
  const s = rowIdx === r.startRow ? r.startCol : 0;
  const e = rowIdx === r.endRow ? r.endCol : Math.max(0, lineLen - 1);
  return { start: clamp(s, 0, Math.max(0, lineLen)), end: clamp(e, 0, Math.max(0, lineLen - 1)), fullLine: false };
}

function renderLineText(line, rowIdx, state, t, scrollLeft, selBg) {
  const full = line.length ? line : " ";
  const visible = scrollLeft > 0 ? full.slice(scrollLeft) : full;
  const text = visible.length ? visible : " ";
  const sel = lineSelectionSpan(state, rowIdx, full.length);
  const hasCursor = rowIdx === state.row;
  const curCol = state.col - scrollLeft;

  const tags = new Uint8Array(text.length); // 0=normal, 1=search, 2=selected, 3=cursor
  if (state.matches.length) {
    for (const hit of state.matches) {
      if (hit.row !== rowIdx) continue;
      const a = Math.max(0, hit.col - scrollLeft);
      const b = Math.min(text.length, hit.col + hit.len - scrollLeft);
      for (let i = a; i < b; i++) tags[i] = 1;
    }
  }
  if (sel) {
    const a = Math.max(0, sel.start - scrollLeft);
    const b = Math.min(text.length, sel.end + 1 - scrollLeft);
    for (let i = a; i < b; i++) tags[i] = 2;
  }
  if (hasCursor && curCol >= 0 && curCol < text.length) {
    tags[curCol] = 3;
  }

  const children = [];
  let i = 0;
  while (i < text.length) {
    const tag = tags[i];
    let j = i + 1;
    while (j < text.length && tags[j] === tag) j++;
    const chunk = text.slice(i, j);
    if (tag === 3) {
      children.push(div().bg(t.accent).text_color(t.accent_foreground || t.background).whitespace_nowrap().child(chunk));
    } else if (tag === 2) {
      children.push(div().bg(selBg).text_color(t.foreground).whitespace_nowrap().child(chunk));
    } else if (tag === 1) {
      children.push(div().bg(t.ansi3 || t.working).text_color(t.background).whitespace_nowrap().child(chunk));
    } else {
      children.push(div().text_color(t.foreground).whitespace_nowrap().child(chunk));
    }
    i = j;
  }
  return children;
}

export function renderCopyMode(view) {
  const state = view.cm;
  const t = theme();
  const s = settings();
  const font = s?.font_family || "JetBrains Mono";
  const fontSize = Number(s?.font_size) || 13;
  const zoom = Number(s?.zoom) || 1;
  const rowH = Math.max(18, Math.round(fontSize * 1.45));

  const listH = view.cmListH ?? 600;
  const viewRows = Math.max(5, Math.floor(listH / rowH));
  if (view.cmInitScroll) {
    view.cmInitScroll = false;
    state.scrollTop = Math.max(0, state.lines.length - viewRows);
    ensureVisible(state, viewRows);
  }

  const gutterDigits = Math.max(3, String(state.lines.length).length);
  const gutterW = Math.round((gutterDigits + 1.5) * fontSize * 0.62) + 8;
  const approxCols = Math.max(40, Math.floor(((view.cmListW ?? 960) - gutterW - 16) / (fontSize * 0.62)));
  if (state.col < state.scrollLeft) state.scrollLeft = state.col;
  else if (state.col >= state.scrollLeft + approxCols - 2) state.scrollLeft = state.col - approxCols + 3;
  state.scrollLeft = Math.max(0, state.scrollLeft);

  const first = clamp(state.scrollTop, 0, Math.max(0, state.lines.length - 1));
  const end = Math.min(state.lines.length, first + viewRows + 1);

  const curLineBg = t.popover || t.surface;
  const selBg = t.ansi4 && t.ansi4.length === 7 ? `${t.ansi4}59` : (t.selection || t.selected);

  const rows = [];
  for (let i = first; i < end; i++) {
    const isCur = i === state.row;
    const rel = isCur ? String(i + 1) : String(Math.abs(i - state.row));
    const lineSel = state.mode === "line" && lineSelectionSpan(state, i, state.lines[i].length);
    rows.push(
      h_flex()
        .id(`cm-r-${i}`)
        .w_full()
        .h(rowH)
        .flex_none()
        .items_center()
        .when(Boolean(lineSel), (el) => el.bg(selBg))
        .when(!lineSel && isCur, (el) => el.bg(curLineBg))
        .on_click((_e, clickCx) => {
          setPos(state, i, state.col);
          view.handle.focus();
          clickCx.notify();
        })
        .child(
          div()
            .w(gutterW)
            .flex_none()
            .pr(10)
            .text_right()
            .text_color(isCur ? t.accent : lineSel ? (t.ansi4 || t.foreground) : t.dim)
            .when(isCur || Boolean(lineSel), (el) => el.font_semibold())
            .child(rel),
        )
        .child(
          h_flex()
            .flex_1()
            .min_w(0)
            .overflow_hidden()
            .items_center()
            .children(renderLineText(state.lines[i], i, state, t, state.scrollLeft, selBg)),
        ),
    );
  }

  const modeLabel = state.mode === "line" ? "V-LINE"
    : state.mode === "visual" ? "VISUAL"
    : state.mode === "search" ? (state.searchDir > 0 ? "SEARCH /" : "SEARCH ?")
    : "NORMAL";
  const modeBg = state.mode === "line" ? (t.ansi5 || t.accent)
    : state.mode === "visual" ? (t.ansi3 || t.working)
    : state.mode === "search" ? (t.ansi4 || t.accent)
    : t.accent;
  const modeFg = t.accent_foreground || t.background;
  const pending = `${state.count}${state.pending}`;
  const matchInfo = state.searchQuery ? `/${state.searchQuery} (${state.matches.length})` : "";
  const selLines = state.mode === "visual" || state.mode === "line"
    ? Math.abs(state.row - (state.anchor?.row ?? state.row)) + 1
    : 0;

  const closeCopy = (refocus = true) => {
    closeOverlay(props().overlay);
    if (refocus && view.cmPane) run("pane.focus", { pane: view.cmPane });
    else if (refocus && view.cmTerminal) run("pane.focus", { terminal: view.cmTerminal });
  };

  return v_flex()
    .id("copy-mode-root")
    .track_focus(view.handle)
    .size_full()
    .min_h(0)
    .rounded(8)
    .border(1)
    .border_color(t.border)
    .bg(t.background)
    .shadow_2xl()
    .overflow_hidden()
    .font_family(font)
    .text_size(fontSize)
    .line_height(`${rowH}px`)
    .on_mouse_down_out(() => closeCopy(false))
    .on_key_down((e, keyCx) => {
      const ops = {
        copy: (text) => keyCx.write_to_clipboard(text),
        close: () => closeCopy(true),
      };
      if (handleCopyKey(state, e, viewRows, ops)) {
        keyCx.stop_propagation();
        keyCx.notify();
      }
    })
    .child(
      div()
        .id("copy-mode-body")
        .flex_1()
        .min_h(0)
        .w_full()
        .py(4)
        .overflow_hidden()
        .on_mouse_down("left", (_e, mcx) => {
          view.handle.focus();
          mcx.stop_propagation();
        })
        .on_size_change((size, scx) => {
          const h = Math.max(rowH * 5, Math.floor(size.height / zoom) - 8);
          const w = Math.max(200, Math.floor(size.width / zoom));
          if (h !== view.cmListH || w !== view.cmListW) {
            view.cmListH = h;
            view.cmListW = w;
            scx.notify();
          }
        })
        .on_scroll_wheel((e, wcx) => {
          const dy = e.delta?.y ?? 0;
          if (!dy) return;
          const step = dy < 0 ? 3 : -3;
          const maxScroll = Math.max(0, state.lines.length - viewRows);
          state.scrollTop = clamp(state.scrollTop + step, 0, maxScroll);
          state.row = clamp(state.row, state.scrollTop, Math.min(state.lines.length - 1, state.scrollTop + viewRows - 1));
          wcx.stop_propagation();
          wcx.notify();
        })
        .when(view.cmLoading, (el) => el.child(div().px(14).py(8).text_color(t.dim).child("Loading scrollback...")))
        .when(!view.cmLoading && Boolean(view.cmError), (el) => el.child(div().px(14).py(8).text_color(t.blocked || t.ansi1).child(view.cmError)))
        .when(!view.cmLoading && !view.cmError, (el) => el.child(v_flex().w_full().children(rows))),
    )
    .child(
      h_flex()
        .w_full()
        .h(28)
        .flex_none()
        .px(10)
        .gap(10)
        .items_center()
        .border_t(1)
        .border_color(t.border)
        .bg(t.chrome || t.surface)
        .text_size(Math.max(11, fontSize - 1))
        .child(div().px(6).py(1).rounded(4).bg(modeBg).text_color(modeFg).font_semibold().child(modeLabel))
        .when(state.mode === "search", (el) =>
          el.child(div().text_color(t.foreground).child(`${state.searchDir > 0 ? "/" : "?"}${state.searchInput}█`)),
        )
        .when(state.mode !== "search" && Boolean(pending), (el) =>
          el.child(div().text_color(t.foreground).font_semibold().child(pending)),
        )
        .when(state.mode !== "search" && Boolean(matchInfo), (el) =>
          el.child(div().text_color(t.muted).child(matchInfo)),
        )
        .when(selLines > 0, (el) =>
          el.child(div().text_color(t.accent).child(`${selLines}L`)),
        )
        .child(div().flex_1())
        .child(div().text_color(t.muted).child(`Ln ${state.row + 1}/${state.lines.length}  Col ${state.col + 1}`))
        .child(div().text_color(t.dim).child("hjkl  w/b/e  v/V  /  y  Esc/q")),
    );
}
