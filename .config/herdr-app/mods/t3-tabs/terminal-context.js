// Only this run's last focused terminal per tab. Mods share one JS context, as focus.js already relies on.
import { focused, panes, spaces } from "herdr";

const recent = () => /** @type {any} */ (globalThis).t3TerminalContext ??= new Map();
// `all`: panes(), when the caller has read it (each read copies every pane).
export function rememberTerminal(all = panes()) {
  const f = focused();
  for (const [key, was] of recent()) if (!all.some(p => p.terminal === was.terminal && p.tab === was.tab)) recent().delete(key);
  if (f?.terminal) recent().set(`${f.space}:${f.tab}`, { ...f });
}
export function terminalFor(space = spaces().find(s => s.active)?.id, tab = spaces().find(s => s.id === space)?.tabs.find(t => t.active)?.id, all = panes()) {
  rememberTerminal(all);
  const was = recent().get(`${space}:${tab}`);
  return was && all.some(p => p.terminal === was.terminal && p.tab === tab) ? was : null;
}

/**
 * The folder a tab works in, as T3's diff panel follows its thread's: its last focused terminal's cwd as it is now, else
 * another of its terminals', else the space's folder. Review reads the repository there; Details names it.
 */
export function workFolder(space = spaces().find(s => s.active)?.id, tab = spaces().find(s => s.id === space)?.tabs.find(t => t.active)?.id, all = panes()) {
  const was = terminalFor(space, tab, all);
  return (was && all.find(p => p.terminal === was.terminal)?.cwd) || all.find(p => p.tab === tab && p.cwd)?.cwd
    || spaces().find(s => s.id === space)?.folder || null;
}

/** First live terminal cwd belonging to `sp` in `ps` order, or null. */
export function spaceFolder(sp, ps = panes()) {
  if (!sp?.tabs?.length) return null;
  const ids = new Set(sp.tabs.map(t => t.id));
  return ps.find(p => p.cwd && ids.has(p.tab))?.cwd || null;
}
