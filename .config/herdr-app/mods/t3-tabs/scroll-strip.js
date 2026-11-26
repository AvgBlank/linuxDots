// A row of tabs wider than its room: the tab bar's and the space panel's. Herdr's scroll areas can't be moved or read from a
// script, so the row is clipped and offset by `at`, kept in `state` between frames.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { settings } from "herdr";
import { alpha } from "./color.js";

/**
 * Where the row sits: the `focus` tab in view with the least move, as T3's scrollIntoView({ inline: "nearest" }), only when
 * `focusKey` or the room changes (a swipe away isn't pulled back) and once `ready` (every width measured). Wider than the
 * room, its start shows. `fromEnd`: the row holds its place from its end, so short of room its end shows.
 * @param {{ at?: number, over?: number, revealed?: string, fromEnd?: number, shown?: number }} state
 * @param {{ widths: number[], gap: number, room: number, focus?: number, focusKey?: string, ready?: boolean, fromEnd?: boolean }} o
 */
export function stripAt(state, { widths, gap, room, focus = -1, focusKey = "", ready = true, fromEnd = false }) {
  const total = widths.reduce((sum, w) => sum + w + gap, -gap), over = Math.max(0, total - room);
  state.at ??= 0;
  if (fromEnd) {
    // A wheel's move (at changed since the last frame) moves the place it holds.
    if (state.shown !== undefined) state.fromEnd = (state.fromEnd ?? 0) + state.shown - state.at;
    state.at = over - (state.fromEnd ?? 0);
  }
  const key = `${focusKey}:${focus}:${room}:${widths[focus] ?? 0}`;
  if (focus >= 0 && room > 0 && ready && key !== state.revealed) {
    state.revealed = key;
    const left = widths.slice(0, focus).reduce((sum, w) => sum + w + gap, 0), right = left + widths[focus];
    if (left < state.at) state.at = left;
    else if (right > state.at + room) state.at = Math.min(left, right - room);
  }
  state.at = Math.max(0, Math.min(state.at, over));
  state.over = over;
  if (fromEnd) { state.fromEnd = over - state.at; state.shown = state.at; } else state.shown = undefined;
  return state.at;
}

/** Whether there's more of the row before and after what shows: T3's canScrollLeft/Right, its arrows' enabled state. */
export const stripEnds = (state) => ({ back: (state.at ?? 0) > 0.5, next: (state.at ?? 0) < (state.over ?? 0) - 0.5 });

/** The wheel, either way, moves the row; the next frame keeps it in range. */
export function stripWheel(state, e) {
  state.at = (state.at ?? 0) - (Math.abs(e.delta.x) > Math.abs(e.delta.y) ? e.delta.x : e.delta.y) / (Number(settings()?.zoom) || 1);
}

/** An arrow: half the room further, as T3's scrollTabs, within the row. @param {-1 | 1} dir */
export function stripPage(state, dir, room) {
  state.at = Math.max(0, Math.min(state.over ?? 0, (state.at ?? 0) + dir * room / 2));
}

/** A cut end fades into `bg` in steps, there being no gradient fill. Laid over the clipped row's ends. */
export function stripFades(bg, state) {
  const fade = (start) => h_flex().id(start ? "strip-fade-start" : "strip-fade-end").absolute().top(0).bottom(0).w(16)
    .when(start, (el) => el.left(0)).when(!start, (el) => el.right(0))
    .children((start ? ["ff", "bf", "80", "40"] : ["40", "80", "bf", "ff"]).map((a) => div().w(4).h_full().bg(alpha(bg, a))));
  const ends = stripEnds(state);
  return [...(ends.back ? [fade(true)] : []), ...(ends.next ? [fade(false)] : [])];
}
