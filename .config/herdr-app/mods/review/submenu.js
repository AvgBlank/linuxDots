// A menu row that opens a submenu beside it, as T3's MenuSub (Base UI's SubmenuTrigger): where the submenu goes, and when
// a pointer resting on rows opens or switches it (docs/internals/specs/menus.md). It draws nothing: each menu opens its own.
// Keys, as Base UI's: → or Enter on the row opens it, with the first row (or its search) lit; ← or Escape in it closes it.

// Base UI's SubmenuTrigger `delay`, and T3's MenuSubPopup `alignOffset`: its first row level with the row that opened it.
export const SUB_DELAY = 100, SUB_ALIGN = -5;
// Stopped short of the submenu inside the safe triangle, the pointer opens what it rests on after this long.
export const SUB_REST = 300;

/** Where a submenu `w` wide at most goes beside `row` ({ x, y, width, height }), in an area spanning `left` to `right`
 *  (docs/internals/t3-tokens.md R4): against the row's right edge, its first row level with the row's; to the row's left
 *  where only that fits; neither, the side with more room, `width` narrowed to it. Never over the row: a host that keeps a
 *  popup in view would otherwise push it there. */
export function subPlace(row, w, left, right) {
  const roomRight = right - (row.x + row.width), roomLeft = row.x - left;
  const side = roomRight >= w || roomRight >= roomLeft ? "right" : "left";
  const width = Math.max(0, Math.min(w, side === "right" ? roomRight : roomLeft));
  return { side, x: side === "right" ? row.x + row.width : row.x - width, y: row.y + SUB_ALIGN, width };
}

function sign(p, a, b) {
  return (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
}

/** Whether `p` is inside the triangle a, b, c (on an edge counts). */
export function inTriangle(p, a, b, c) {
  const d1 = sign(p, a, b), d2 = sign(p, b, c), d3 = sign(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/** Base UI's safe polygon: whether the pointer, from `from` to `p`, is still inside the triangle from `from` to the
 *  near corners of `sub` ({ x, y, width, height }) on `side`. */
export function heading(from, p, sub, side) {
  const x = side === "right" ? sub.x : sub.x + sub.width;
  return inTriangle(p, from, { x, y: sub.y }, { x, y: sub.y + sub.height });
}

function cancel(s) {
  s.timer?.cancel();
  s.timer = null;
  s.want = undefined;
}

/** A row's on_mouse_move. `s` is the menu's: { open, sub, side, from, want, timer }. `key` names the row's submenu, or
 *  null for a row without one. After SUB_DELAY on the row, `apply(key, row, cx)` opens that submenu (null: closes the
 *  open one); it records what it opened with subOpened. A move toward the open submenu, inside its safe triangle,
 *  changes nothing until the pointer rests SUB_REST. */
export function hoverRow(s, key, e, cx, apply) {
  const p = e.position, from = s.from;
  s.from = p;
  if (key === (s.open ?? null)) return cancel(s);
  const toward = s.open != null && s.sub && from && heading(from, p, s.sub, s.side);
  // Already counting down on this row: let it run, unless it was the longer wait for a pointer heading to the submenu.
  if (!toward && s.want === key && !s.resting) return;
  cancel(s);
  s.want = key;
  s.resting = toward;
  const row = e.bounds;
  s.timer = cx.timer.after(toward ? SUB_REST : SUB_DELAY, (cx) => { s.timer = null; s.want = undefined; apply(key, row, cx); });
}

/** What `apply` opened: its key and its bounds, as subPlace put it; or nothing (key null), closed. */
export function subOpened(s, key, sub = null, side = "right") {
  cancel(s);
  Object.assign(s, { open: key, sub, side });
}

/** The pointer left the menu for its submenu, or for good: nothing pending opens. */
export function subLeft(s) {
  cancel(s);
}
