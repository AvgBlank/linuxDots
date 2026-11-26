// Context menus, one per thing (docs/internals/specs/menus.md): props { tab, target } say which thing, not what it offers; Snooze's submenu adds { parents, lit }.
// Herdr's menu (mod.clone), a tab's and a pane's Close going through t3-tabs, which asks first while a program runs and leaves first, so Herdr's neighbour pick never shows.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { checking, run, props, openOverlay, closeOverlay, theme, keys, terminals, agents, spaces, panes, focused, exec, setShared, layout, settings } from "herdr";
import { menuKeys, scrollList, propsLit } from "./list.js";
import { menuRow, menuRule, menuHint, MENU_ROW } from "./menu-row.js";
import { hoverRow, subLeft } from "./submenu.js";
import { openBeside, closeSub, subGone, closeChain, menuClosed } from "./popup-menu.js";
import { presets } from "./snooze-presets.js";
import { agentKids, kidStatus, ownStatus, stillSettled, subAgents, treeStatus } from "./tree.js";
import { isSubAgent, namer, programOf } from "./name.js";
import { programIcon } from "./program.js";
import { statusMark, took } from "./status-mark.js";
import { alpha } from "./color.js";
import { focusAgent, focusPane } from "./zoom.js";
import { pinList } from "./pins.js";
import { sidebarParts } from "./sidebar.js";
import { closedKey } from "./store.js";
import { keyLabel } from "./tip.js";
import { ghostButton } from "./button.js";

// What a submenu's close() stamps, for the menu it hangs off (popup-menu.js subGone).
const SUB_CLOSED = closedKey("t3-menu", "submenu");
const SPACE_CLOSED = closedKey("t3-menu", "space");

// A menu's measures, as T3's, a rule 4 above and below. The space switcher's 280 width and 10-row cap match the sub-agent list's, so names, durations and marks fit.
const WIDTH = 220, PAD = 4, ROW = 28, RULE = 9, SPACE_SHOWN = 10;
// Where row `i` starts below the menu's top, its rules included.
const rowTop = (list, i) => PAD + i * ROW + list.slice(1, i + 1).filter((it, j) => it[4] !== list[j][4]).length * RULE;

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
async function checkout(folder, on) {
  const rev = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], { cwd: folder, on });
  const lines = (rev.stdout ?? "").trim().split(/\r?\n/).map((s) => s.trim());
  if (rev.code !== 0 || lines.length !== 2 || !lines[0] || !lines[1]) return null;
  const [top, common] = lines;
  return common === `${top}/.git` ? "main" : "linked";
}

// The nearest live agent with a pane above an address. Reuse the answer for intermediate shells and pane-less agents.
function paneAncestors(byAddress, byAgent) {
  const cache = new Map();
  return (address) => {
    const visited = new Set();
    let parent = byAddress.get(address)?.parent, found = null;
    while (byAddress.get(parent)?.state === "live" && !visited.has(parent)) {
      if (byAgent.has(parent)) { found = byAgent.get(parent); break; }
      if (cache.has(parent)) { found = cache.get(parent); break; }
      visited.add(parent);
      parent = byAddress.get(parent).parent;
    }
    for (const addr of visited) cache.set(addr, found);
    return found;
  };
}

const terminalPane = (address) => panes().find((p) => p.terminal === address);

// New tab goes through t3-tabs, which opens it and has the Inbox bar read it as something started there (`fresh`).
// The key acts on the space in view alone, so it shows only there.
const startTab = (sp) => run(`t3-tabs.new:${sp.id}`);
const newTabKey = (sp) => sp?.active ? shortcut("t3-tabs.new") : "";

// An agent's menu, wherever it's right-clicked (an Inbox card, an Agents row, the tab bar's title): what it can do now, as
// T3's thread actions. Settle and Snooze are the Inbox's (docs/adr/0002): with Lists chosen they aren't offered.
function agentItems(address) {
  const all = terminals(), every = agents();
  const byAddress = new Map(all.map((k) => [k.address, k])), byAgent = new Map(every.map((a) => [a.address, a]));
  const k = byAddress.get(address), a = byAgent.get(address), above = paneAncestors(byAddress, byAgent);
  if (!k) return [];
  const pane = terminalPane(address);
  const inbox = sidebarParts(layout()).stack?.active !== "lists";
  const kids = subAgents(every, all)(address), own = ownStatus(a?.status, address, all);
  const busy = [own, ...kids].some((s) => s === "working" || s === "blocked");
  const parent = k.parent && byAddress.get(k.parent);
  const head = a && above(address);
  // Rename names the tab: aligned with name.js's top-level check, hidden while Pi's session names the agent.
  const tabLeads = a ? every.filter((x) => x.tab === a.tab && !isSubAgent(x.address, byAddress)).length : 0;
  const rename = a && !isSubAgent(address, byAddress) && !(a.program?.key === "pi" && k.labels?.["pi.session"]);
  const pinned = pinList().includes(address), napping = Number(k.labels?.snoozed) > Date.now();
  // The settle key acts on the agent in view, so its key shows only there.
  const inView = every.find((x) => x.focused)?.address === address;
  return grouped(
    [
      ...(a && !head ? [[pinned ? "Unpin" : "Pin", `t3-tabs.${pinned ? "unpin" : "pin"}:${address}`, {}]] : []),
      ...(inbox && a && !busy ? [[stillSettled(k, own, kids) ? "Un-settle" : "Settle", `t3-tabs.settle:${address}`, {}, inView ? shortcut("t3-tabs.settle") : ""]] : []),
      ...(inbox && a ? napping ? [["Wake", `t3-tabs.wake:${address}`, {}]] : treeStatus(own, kids) !== "blocked" ? [["Snooze", "snooze", { address }]] : [] : []),
      ...(inbox && a && treeStatus(own, kids) === "idle" && Number(k.turn) > 0 ? [["Mark unread", `t3-tabs.unread:${address}`, {}]] : []),
    ],
    [
      ...(rename ? [[tabLeads >= 2 ? "Rename tab" : "Rename", "tab.rename", { id: a.tab }]] : []),
      ["Copy address", "copy", { text: address }],
      ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: address }]] : []),
    ],
    pane ? [["Close pane", "pane.close", { pane: pane.pane }]] : [],
  );
}

// Groups in T3's order (where to, state, names and copies, worktrees, ending), a rule between two that show. An item is
// [label, command, args, hint, group]; a hint of "" shows none.
const grouped = (...groups) => groups.flatMap((g, n) => g.map((it) => [it[0], it[1], it[2], it[3], n]));

// An intent includes the arguments and the displayed verb: e.g. Settle and Un-settle run the same command but are not interchangeable.
const itemId = (it) => JSON.stringify(it.slice(0, 3));

function items(p, git) {
  p = p ?? {};
  const tg = p.target ?? {};
  switch (p.tab) {
    case "pane": {
      // A kept sub-agent can go back under its parent, still running.
      const all = terminals();
      const term = all.find((t) => t.address === tg.terminal);
      const parent = term?.parent && all.find((t) => t.address === term.parent);
      // Once they go to the program, Shift+right-click still opens this menu.
      const toProgram = term?.labels?.["herdr.right-click"] === "program";
      // A terminal shown outside a tab (a layout terminal block, a window) has
      // no pane to split, zoom or close: its pane is the block's id.
      const tabbed = panes().find((pane) => pane.pane === tg.pane && (!tg.terminal || pane.terminal === tg.terminal));
      return grouped(
        tabbed
          ? [
              ["Split right", "pane.split", { direction: "right", pane: tg.pane }],
              ["Split down", "pane.split", { direction: "down", pane: tg.pane }],
              [tabbed.zoomed ? "Unzoom pane" : "Zoom pane", "pane.zoom", { pane: tg.pane }],
            ]
          : [],
        [
          ...(term ? [["Copy address", "copy", { text: term.address }]] : []),
          ...(term
            ? [
                toProgram
                  ? ["Use Herdr right-click menu", "terminal.right_click", { terminal: term.address, to: "menu" }]
                  : ["Send right-clicks to pane", "terminal.right_click", { terminal: term.address, to: "program" }],
              ]
            : []),
          ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address }]] : []),
        ],
        tabbed ? [["Close pane", "pane.close", { pane: tg.pane }]] : [],
      );
    }
    case "tab": {
      // With no space named, the one in view.
      const all = spaces();
      if (!all.some((s) => (!tg.space || s.id === tg.space) && s.tabs?.some((tab) => tab.id === tg.id))) return [];
      const sp = all.find((s) => (tg.space ? s.id === tg.space : s.active));
      return grouped(
        [["New tab", "tab.new", { space: tg.space }, newTabKey(sp)]],
        [["Rename", "tab.rename", { id: tg.id }]],
        [["Close", "tab.close", { id: tg.id }]],
      );
    }
    case "agent":
      return agentItems(tg.address);
    // Its Snooze: the card's times, when each wakes on the right, then Custom (the Inbox's dialog).
    case "snooze":
      return grouped(presets(Date.now()).map((p) => [p.label, "snooze-preset", { address: tg.address, ...(p.hours ? { hours: p.hours } : { at: p.at }) }, p.when]),
        [["Custom…", "custom-snooze", { address: tg.address }]]);
    case "space": {
      const s = spaces().find((s) => s.id === tg.id);
      if (!s) return [];
      const folder = place(s);
      return grouped(
        [["New tab", "tab.new", { space: tg.id }, newTabKey(s)]],
        [["Rename", "space.rename", { id: tg.id }], ...(folder ? [["Copy path", "copy", { text: folder }]] : [])],
        git ? [["New worktree", "worktree", { space: tg.id, action: "new" }], ["Open worktree", "worktree", { space: tg.id, action: "open" }]] : [],
        [...(git === "linked" ? [["Remove worktree", "worktree", { space: tg.id, action: "remove" }]] : []), ["Close", "space.close", { id: tg.id }]],
      );
    }
    // A repo's checkout with no space open: the dim row in Spaces, as T3's project folder (New thread, Copy path).
    case "checkout":
      return grouped([["Open", "space.new", { folder: tg.folder, machine: tg.machine ?? "" }]], [["Copy path", "copy", { text: tg.folder }]]);
    // A machine's heading in Spaces: its + and, when its core was rebuilt, its Connect.
    case "machine":
      return grouped([
        ...(tg.connected ? [["New space here", "space.new", { machine: tg.machine ?? "" }]] : []),
        ...(tg.connect ? [["Connect", `t3-spaces.reconnect:${tg.machine}`, {}]] : []),
      ]);
    default:
      return [];
  }
}

// Every icon is this mod's own, Lucide's at the layout's 1.75 (t3-tokens P4; check-menu.cjs reads each). Null: a Snooze
// time, drawn as the card's menu draws them, with none.
function menuIcon(command, label, args) {
  if (command === "snooze-preset" || command === "custom-snooze") return null;
  const name = command === "copy" ? "copy" : command.startsWith("t3-tabs.settle") ? (label === "Settle" ? "check" : "undo") : command.startsWith("t3-tabs.pin:") ? "pin"
    : command.startsWith("t3-tabs.unpin:") ? "pin-off" : command === "snooze" ? "alarm-clock" : command.startsWith("t3-tabs.wake:") ? "alarm-clock-off"
    : command.startsWith("t3-tabs.unread:") ? "circle-dot"
    : command.endsWith(".close") ? "x" : command.endsWith(".rename") ? "square-pen" : command === "space.new" && args?.folder ? "folder"
    : command.endsWith(".new") ? "plus" : command === "worktree" ? (args?.action === "remove" ? "x" : "git-branch") : command.startsWith("t3-spaces.reconnect:") ? "server"
    : command === "pane.split" ? (args?.direction === "down" ? "panel-bottom" : "panel-right") : command === "pane.zoom" ? "square" : "terminal";
  return `mods/t3-menu/icons/${name}.svg`;
}

// The key bound to a command, for the hint on the right, written as tooltips and New write keys (tip.js keyLabel): ⇧⌘D.
// `bound`: keys(), read once by a caller that asks for each row.
function shortcut(name, args, bound = keys()) {
  // `pane.split:right` binds pane.split with { direction: "right" }.
  const value = args && Object.values(args)[0];
  // A layout's own keys too: Settle's is the herdr-t3 layout's.
  const k = bound.find((b) => (b.section === "global" || b.section?.startsWith("layout:")) && (b.action === name || b.action === `${name}:${value}`));
  return k ? keyLabel(k.keys) : "";
}

function groupByTab(list) {
  const grouped = new Map();
  for (const item of list) {
    const tab = item.tab, group = grouped.get(tab);
    if (group) group.push(item); else grouped.set(tab, [item]);
  }
  return grouped;
}

// Agents and their local branches in tab order, then non-agent terminal panes in `spaceId`.
function spaceSwitchEntries(spaceId, now) {
  const space = spaces().find((s) => s.id === spaceId);
  if (!space) return [];
  const tabs = space.tabs ?? [];
  const all = terminals(), every = agents(), ps = panes(), f = focused(), name = namer({ terminals: all, agents: every });
  const byAddress = new Map(all.map((k) => [k.address, k]));
  /** @type {Map<string, Pick<import("herdr").AgentInfo, "address" | "pane" | "tab" | "title" | "program" | "status" | "focused">>} */
  const byAgent = new Map(every.map((a) => [a.address, a]));
  const listed = new Map(every.map((a) => [a.address, a.status]));
  // A sub-agent may already have a pane before its first report puts it in agents().
  for (const p of ps) {
    const k = byAddress.get(p.terminal);
    if (k?.state === "live" && k.parent && (k.status != null || k.program?.agent) && !byAgent.has(p.terminal)) {
      byAgent.set(p.terminal, { ...p, address: p.terminal, status: kidStatus(k, listed) });
    }
  }
  const agentsByTab = groupByTab(byAgent.values()), panesByTab = groupByTab(ps);
  const localTabs = new Set(tabs.map((c) => c.id));
  const above = paneAncestors(byAddress, byAgent);
  const inbox = sidebarParts(layout()).stack?.active !== "lists";
  const entries = [], seen = new Set(), children = new Map(), busyByAddress = new Map();
  const childrenOf = (address) => {
    if (!children.has(address)) children.set(address, agentKids(all, address));
    return children.get(address);
  };
  // Roll up the whole tree, including agents in other spaces. The shared status rules only need these two signals.
  const busyBelow = (address) => {
    if (busyByAddress.has(address)) return busyByAddress.get(address);
    const busy = new Set();
    busyByAddress.set(address, busy);
    for (const k of childrenOf(address)) {
      const st = kidStatus(k, listed);
      if (st === "working") busy.add("working");
      if (st === "blocked" || st === "error") busy.add("blocked");
      for (const word of busyBelow(k.address)) busy.add(word);
    }
    return busy;
  };

  const agentHere = (a, address) => Boolean(f?.pane ? a.pane === f.pane : f?.terminal ? address === f.terminal : a.focused);
  const addAgent = (address, k, a, depth) => {
    if (seen.has(address) || (a && !localTabs.has(a.tab))) return;
    seen.add(address);
    const root = depth === 0;
    const own = root ? ownStatus(a.status, address, all) : kidStatus(k, listed);
    const kids = root || (a && own === "done") ? [...busyBelow(address)] : [];
    const st = root ? treeStatus(own, kids) : own;
    const snoozedUntil = Number(k?.labels?.snoozed);
    const napping = snoozedUntil > now;
    const done = st === "done" && (!a || !stillSettled(k, a.status, kids));
    const snoozed = root && inbox && napping && st !== "working" && st !== "blocked";
    entries.push({
      kind: "agent", id: `space-item-${address}`, address, listed: listed.has(address), depth,
      label: a ? name(a) : (k.name || k.template || k.program?.name || address), program: a?.program ?? k?.program,
      status: st, newsDone: done && !(a && napping), snoozed,
      snoozedUntil: snoozed || (a && done && napping) ? snoozedUntil : Infinity,
      since: k?.status_ms || k?.created_ms || 0,
      here: a ? agentHere(a, address) : (f?.terminal === address || f?.agent === address),
    });
    for (const child of childrenOf(address)) addAgent(child.address, child, byAgent.get(child.address), depth + 1);
  };

  for (const c of tabs) {
    for (const a of agentsByTab.get(c.id) ?? []) {
      if (!localTabs.has(above(a.address)?.tab)) addAgent(a.address, byAddress.get(a.address), a, 0);
    }
  }

  let firstTerm = entries.length > 0;
  for (const c of tabs) {
    const mine = panesByTab.get(c.id) ?? [];
    for (const p of mine) {
      if (!p.terminal || byAgent.has(p.terminal)) continue;
      entries.push({
        kind: "terminal", id: `space-term-${p.pane}`, pane: p.pane, address: p.terminal,
        depth: 0, label: mine.length === 1 && c.named ? c.name : name(p), program: programOf(p),
        here: Boolean(f?.pane ? p.pane === f.pane : f?.terminal === p.terminal), firstInGroup: firstTerm,
      });
      firstTerm = false;
    }
  }
  return entries;
}

export default class Menu extends View {
  init(_props, cx) {
    // As T3's, nothing is lit until a key or the pointer gets there.
    const p = props();
    this.at = propsLit();
    this.typed = "";
    this.typedAt = -Infinity;
    this.git = null;
    // The submenu's pointer state (submenu.js), the one open { id, row }, and each row's bounds as the pointer last found it.
    this.s = {};
    this.sub = null;
    this.rowsAt = {};
    // Where it opened: the pointer, for placing a submenu keys open before the pointer has found its row.
    this.origin = globalThis.window?.mouse_position?.();
    this.keys = cx.focus_handle();
    this.keys.focus();
    const space = p?.tab === "space" && spaces().find((s) => s.id === p.target?.id);
    const folder = space && place(space);
    if (!checking() && folder)
      cx.spawn(async (cx) => {
        const kind = await checkout(folder, space.machine).catch(() => null);
        if (kind) this.git = { folder, machine: space.machine, kind };
        cx.notify();
      });
  }

  liveItems(p) {
    let git = null;
    if (this.git && p.tab === "space") {
      const space = spaces().find((s) => s.id === p.target?.id);
      if (space && space.machine === this.git.machine && place(space) === this.git.folder) git = this.git.kind;
    }
    return items(p, git);
  }

  // For the control that opened it: a press on it that closed this mustn't reopen it (justClosed in focus.js); for the menu
  // a submenu hangs off, that its submenu went. Its own submenu goes with it.
  async close() {
    this.clock?.cancel();
    this.emptied?.cancel();
    subLeft(this.s);
    const p = props() ?? {};
    menuClosed(p.overlay);
    const stamp = p.parents?.length ? SUB_CLOSED : p.tab === "space-switch" ? SPACE_CLOSED : closedKey("t3-menu");
    setShared(stamp, Date.now());
  }

  // Keep the visible row's position, not where Snooze would be if Herdr drew again now.
  openSub(id, it, lit) {
    if (id !== this.snoozeRow?.id) return;
    const times = items({ tab: "snooze", target: it[2] }, null), h = rowTop(times, times.length) + PAD + 2;
    openBeside(this, id, id, { top: this.snoozeRow.top, width: WIDTH - 2 * PAD },
      { mod: "t3-menu", width: WIDTH, height: h, props: { tab: "snooze", target: it[2] } }, null, lit);
  }

  choose(id, cx, lit = false) {
    if (id === undefined) return;
    const p = props() ?? {};
    const it = /** @type {any} */ (this.liveItems(p).find((candidate) => itemId(candidate) === id));
    if (!it || (p.tab === "snooze" && !agentItems(p.target?.address).some((candidate) => candidate[1] === "snooze"))) return;
    // Its times, beside it: this stays open.
    if (it[1] === "snooze") return this.openSub(id, it, lit);
    const wake = it[1] === "snooze-preset" ? (it[2].hours ? Date.now() + it[2].hours * 3_600_000 : it[2].at) : null;
    if (wake !== null && wake <= Date.now()) return;
    // The whole chain closes, submenu and the menus it hangs off.
    closeChain();
    if (it[1] === "worktree") openOverlay({ mod: "worktrees", kind: "dialog", ...(it[2].action === "open" ? { width: 560, height: 480 } : { width: 512, height: 240, frame: "none" }), props: it[2] });
    // The item keeps Herdr's command, for its icon, its divider and its key; only where it goes changes.
    else if (it[1] === "tab.close") run(`t3-tabs.close-tab:${it[2].id}`);
    else if (it[1] === "pane.close") run(`t3-tabs.close-pane:${it[2].pane}`);
    else if (it[1] === "copy") cx.write_to_clipboard(it[2].text);
    else if (wake !== null) run(`t3-tabs.snooze:${it[2].address}:${wake}`, {});
    else if (it[1] === "custom-snooze") openOverlay({ mod: "t3-inbox", kind: "dialog", frame: "none", width: 384, props: { customSnooze: it[2].address, answer: "t3-tabs.snooze" } });
    else if (it[1] === "tab.new") { const sp = spaces().find((s) => it[2].space ? s.id === it[2].space : s.active); if (sp) startTab(sp); }
    else run(it[1], it[2]);
  }

  spaceSwitchView(t, p, cx) {
    const spaceId = p.target?.id, now = Date.now(), entries = spaceSwitchEntries(spaceId, now);
    // Its last tab closed from here, the space went: nothing left to show, so it goes, after this frame.
    if (cx && !this.emptied && !spaces().some((s) => s.id === spaceId)) this.emptied = cx.timer.after(0, () => { if (!spaces().some((s) => s.id === spaceId)) closeChain(); });
    // A closed last row takes the highlight back to the row now last.
    if (this.at > entries.length) this.at = entries.length;
    let clockAt = Infinity;
    const mono = settings()?.font_family ?? "JetBrains Mono";
    const labels = ["New tab", ...entries.map((e) => e.label)];
    const pick = (i) => {
      closeChain();
      if (i === 0) {
        const sp = spaces().find((s) => s.id === spaceId);
        if (sp) startTab(sp);
        return;
      }
      const entry = entries[i - 1];
      if (!entry) return;
      if (entry.kind === "agent") {
        const pane = terminalPane(entry.address);
        if (!pane) run("terminal.peek", { terminal: entry.address });
        else if (entry.listed) focusAgent(entry.address);
        else focusPane(pane.pane);
      } else {
        focusPane(entry.pane);
      }
    };
    // The pane a row's × or Ctrl+D closes: a sub-agent peeked without a pane has none.
    const paneOf = (entry) => entry?.kind === "agent" ? terminalPane(entry.address)?.pane : entry?.pane;
    // The menu stays: closing a few in a row is what it's for, and the list follows as each pane goes. t3-tabs asks
    // first while a program runs, as Go to's Ctrl+D.
    const closeEntry = (entry) => {
      const pane = paneOf(entry);
      if (pane) run(`t3-tabs.close-pane:${pane}`);
    };
    const rightClick = (entry) => (_e, cx) => {
      cx.stop_propagation();
      closeOverlay(p.overlay);
      const spec = entry.kind === "agent"
        ? { tab: "agent", target: { address: entry.address } }
        : { tab: "pane", target: { pane: entry.pane, terminal: entry.address } };
      openOverlay({ mod: "t3-menu", kind: "popup", width: WIDTH, height: 260, props: spec });
    };
    const trailOf = (entry) => {
      let mark = null;
      if (entry.kind === "agent") {
        clockAt = Math.min(clockAt, entry.snoozedUntil);
        if (entry.status === "working") {
          if (entry.since > 0) {
            const elapsed = Math.max(0, now - entry.since), unit = elapsed < 60_000 ? 1000 : 60_000;
            clockAt = Math.min(clockAt, entry.since + (Math.floor(elapsed / unit) + 1) * unit);
          }
          const time = entry.since > 0 ? h_flex().flex_none().gap(4).items_center().children(took(entry.since, now).split(" ").map((part) => menuHint(t, part).font_family(mono))) : null;
          mark = time ? h_flex().flex_none().gap(4).items_center().child(statusMark("mods/t3-menu", t, "working")).child(time) : statusMark("mods/t3-menu", t, "working");
        } else if (entry.status === "blocked" || entry.status === "error") {
          mark = statusMark("mods/t3-menu", t, entry.status);
        } else if (entry.newsDone) {
          mark = statusMark("mods/t3-menu", t, "done");
        } else if (entry.snoozed) {
          mark = svg("mods/t3-menu/icons/alarm-clock.svg").size(12).flex_none().text_color(t.accent);
        }
      }
      return mark && h_flex().flex_none().pl(10).items_center().child(mark);
    };
    const drawEntry = (j) => {
      const entry = entries[j], rowIndex = j + 1, lit = this.at === rowIndex;
      // Only under the pointer: a highlight walked by keys keeps its mark where it is.
      const closing = lit && this.pointer && Boolean(paneOf(entry));
      const closeId = `space-close-${entry.address ?? entry.pane}`;
      const color = entry.here || lit ? t.foreground : t.muted;
      const divider = entry.firstInGroup && !lit && this.at !== rowIndex - 1 && !entry.here && !entries[j - 1]?.here;
      return menuRow(this, t, entry.id, {
        at: [this, "at", rowIndex],
        label: entry.here ? div().min_w(0).truncate().font_medium().child(entry.label) : entry.label,
        color,
        lead: entry.depth > 0 ? div().w(entry.depth * 16 - 8).flex_none() : undefined,
        icon: programIcon(entry.program, 16, color) ?? svg("mods/t3-menu/icons/terminal.svg").size(16).flex_none().text_color(color),
        trail: closing
          ? h_flex().flex_none().pl(10).items_center().child(ghostButton(this, t, closeId, {
            size: "micro", surface: "card", icon: "mods/t3-menu/icons/x.svg", label: `Close ${entry.label}`, act: () => closeEntry(entry),
          }))
          : trailOf(entry),
        pick: () => pick(rowIndex),
        also: (row) => row.when(entry.here, (el) => el.accessibility_label(entry.label))
          .when(entry.here && !lit, (el) => el.bg(alpha(t.foreground, "12")))
          .on_mouse_down("right", rightClick(entry))
          .when(divider, (el) => el.relative().child(div().absolute().top(0).left(8).right(8).h(1).bg(t.border))),
      });
    };
    const keyed = menuKeys(this, labels, (at) => pick(at));
    const view = v_flex()
      .id("menu")
      .track_focus(this.keys)
      .w_full()
      .min_h(0)
      .p(4)
      .bg(t.popover)
      .text_size(14)
      .on_mouse_move((_e, cx) => { if (!this.pointer) { this.pointer = true; cx.notify(); } })
      .on_key_down((e, cx) => {
        this.pointer = false;
        if (e.key === "d" && e.modifiers?.control) {
          closeEntry(entries[this.at - 1]);
          cx.stop_propagation();
          return;
        }
        keyed(e, cx);
      })
      .child(menuRow(this, t, "space-new-tab", {
        at: [this, "at", 0], label: "New tab", icon: "mods/t3-menu/icons/plus.svg",
        trail: menuHint(t, shortcut("t3-tabs.new")), pick: () => pick(0),
      }))
      .when(entries.length > 0, (el) => el.child(menuRule(t)).child(scrollList(this, "space-menu-list", {
        count: entries.length, row: MENU_ROW, at: this.at - 1,
        height: Math.min(entries.length, SPACE_SHOWN) * MENU_ROW,
        wheeled: (keep) => { if (keep >= 0) this.at = keep + 1; },
        draw: drawEntry,
      })));
    if (cx && !checking() && clockAt !== this.clockAt) {
      this.clock?.cancel();
      this.clockAt = clockAt;
      this.clock = Number.isFinite(clockAt) ? cx.timer.after(Math.max(0, clockAt - Date.now()), (cx) => {
        this.clock = null;
        this.clockAt = Infinity;
        cx.notify();
      }) : null;
    }
    return view;
  }

  render(cx) {
    const t = theme(), p = props() ?? {};
    if (p.tab === "space-switch") return this.spaceSwitchView(t, p, cx);
    const list = this.liveItems(p), ids = list.map(itemId), bound = keys();
    // Its target went (a tab or space closed under it): nothing left to pick, so it goes, after this frame.
    if (!list.length && cx && !this.emptied) this.emptied = cx.timer.after(0, () => { if (!this.liveItems(props() ?? {}).length) closeChain(); });
    if (this.selected === undefined) this.selected = ids[this.at] ?? null;
    const snooze = list.findIndex((it) => it[1] === "snooze");
    const snoozeRow = snooze < 0 ? null : { id: ids[snooze], top: rowTop(list, snooze) };
    if (snoozeRow?.id !== this.snoozeRow?.id || snoozeRow?.top !== this.snoozeRow?.top) this.rowsAt = {};
    this.snoozeRow = snoozeRow;
    // The common list helpers walk positions in this frame; retain the highlight across frames by intent.
    const view = this;
    const selection = {
      get at() { return ids.indexOf(view.selected); },
      set at(i) { view.selected = ids[i] ?? null; },
      get typed() { return view.typed; },
      set typed(text) { view.typed = text; },
      get typedAt() { return view.typedAt; },
      set typedAt(at) { view.typedAt = at; },
    };
    // Its submenu closed itself (← or Esc in it, a click beside it): the keyboard comes back here.
    subGone(this, SUB_CLOSED);
    return v_flex()
      .id("menu")
      .track_focus(this.keys)
      .w_full()
      .min_h(0)
      .p(4)
      .bg(t.popover)
      .text_size(14)
      // Off the menu, nothing pending opens; a submenu open stays.
      .on_hover((on) => { if (!on) subLeft(this.s); })
      // A submenu's ← goes back to its menu, as its Esc does.
      .on_key_down(menuKeys(selection, list.map((it) => it[0]), (at, cx, lit) => this.choose(ids[at], cx, lit), { back: Boolean(p.parents?.length), sub: (at) => at === snooze }))
      .children(
        list.map((it, i) =>
          v_flex()
            .when(i > 0 && list[i - 1][4] !== it[4], el => el.child(menuRule(t)))
            .child(menuRow(this, t, `mi-${ids[i]}`, {
              at: [selection, "at", i], label: it[0], open: ids[i] === this.sub?.row, icon: menuIcon(it[1], it[0], it[2]) || null, sub: it[1] === "snooze" && "mods/t3-menu/icons",
              // Only what deletes something is red, in words, as T3's destructive item: a Close asks first while a program runs.
              color: it[1] === "worktree" && it[2].action === "remove" ? t.ansi1 : null,
              trail: it[1] === "snooze" ? null : menuHint(t, it[3] ?? shortcut(it[1], it[2], bound)),
              pick: (cx) => this.choose(ids[i], cx),
              also: (el) => el.on_mouse_move((e, cx) => {
                const id = i === snooze ? ids[i] : null;
                if (id && this.snoozeRow?.top === snoozeRow.top) this.rowsAt[id] = e.bounds;
                hoverRow(this.s, id, e, cx, (key, _row, cx) => { if (key) this.choose(key, cx); else closeSub(this); cx.notify(); });
              }),
            })),
        ),
      );
  }
}
