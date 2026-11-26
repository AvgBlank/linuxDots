import { checking, exec, spaces, panes, agents, terminals, machines, run, openOverlay, closeOverlay, focused, hc, notify, layout, shared, setShared, home, window } from "herdr";
import { namer, programOf, isSubAgent } from "./name.js";
import { descendants, ownStatus, stillSettled, subAgents, terminalByAddress, treeStatus } from "./tree.js";
import { focusAgent, focusPane } from "./zoom.js";
import { sidebarParts } from "./sidebar.js";
import { agentStep } from "./agent-step.js";
import { newTab, placeOf } from "./project.js";
import { rememberProjects } from "./projects.js";
import { t3Settings } from "./layout-settings.js";
import { KEY } from "./store.js";
import { writeLabel } from "./labels.js";

// Checks a local directory via `sh` (`fs/promises` is sandboxed to manifest read roots and has no stat); fails open on shell errors.
async function folderExists(folder) {
  try {
    const r = await exec("sh", ["-c", '[ -d "$1" ]', "sh", folder]);
    return r.code !== 1;
  } catch {
    return true;
  }
}

// One instance per Tabs view; the Herdr operations also admit the check's fake core.
export function navigation(beforeAsk = (_cx) => {}, core = { checking: () => checking(), spaces, panes, agents, terminals, machines: () => machines(), run, openOverlay, closeOverlay, focused, hc, notify, layout, shared, setShared, home: () => home(), window: () => window(), namer, programOf, focusAgent, focusPane, writeLabel, folderExists }) {
  const { checking, spaces, panes, agents, terminals, machines, run, openOverlay, closeOverlay, focused, hc, notify, layout, shared, setShared, home, window, namer, programOf, focusAgent, focusPane, writeLabel, folderExists: checkFolder = folderExists } = core;
  // lastIn: each tab's agent last in view, which the Inbox's bar holds while a program there has the focus.
  // fresh: spaces where the person started something new (a New tab, New's pick, cmd-t) since last looking at an agent there.
  const trail = {}, lastIn = {}, fresh = new Set(), owed = new Map(), waking = new Map();
  let states = new Map();
  // Spaces that were Home until an agent started there: their rename may not have shown yet.
  const released = new Set();
  let renaming = false, going, inView, wasHome, unread, focusWas, zoomOff, asking, settingsOpen;
  let tabAnswer, tabAskSerial = 0, cleanupAnswer, cleanupSerial = 0, cleanupScanSerial = 0;
  const inboxShown = () => sidebarParts(layout()).stack?.active === "inbox";
  // The Inbox's ways with attention hold unless Lists is the mode (docs/adr/0002).
  const listsShown = () => sidebarParts(layout()).stack?.active === "lists";
  const nameOf = (c, lead, name) => c.named ? c.name : lead ? name(lead) : "Terminal";

  // Home: one place to land, a space of its own on this computer, known by its id so whatever someone arranges there is theirs.
  // The layout's lists leave it out and the keys that walk spaces go around it, so it takes no number. This mod answers for it
  // because the tab bar always shows; the sidebar, with its brand bar, can be hidden.
  const homeId = () => shared(KEY.home);
  // Reads "Home", with a zero-width space nobody types: a space someone else calls Home is never taken for it, and being wrong would hide theirs.
  const HOME_NAME = "Home\u200b";
  const local = (s) => s.machine === null;
  const namedHome = (s) => local(s) && s.named && s.name === HOME_NAME && !released.has(s.id);
  const knownHome = (all = spaces()) => all.find(s => s.id === homeId() && local(s));

  // The id is this computer's (shared.json) and the space the core's, so another window on that core finds Home by its name.
  function knowHome(all = spaces()) {
    const known = knownHome(all);
    // A Home made before it had a name of its own.
    if (known?.name === "Home" && !renaming) { renaming = true; run("space.rename", { id: known.id, name: HOME_NAME }); }
    if (known) return;
    const found = all.find(namedHome);
    if (found) setShared(KEY.home, found.id);
  }
  const atHome = (all = spaces()) => Boolean(knownHome(all)?.active);
  // The one mod Home is (t3.settings, docs/adr/0005); null: a shell in the home folder.
  const homeMod = () => t3Settings().homeMod;
  const fill = () => homeMod() ? { mod: homeMod() } : {};
  // spaces() catches up a frame or so after a command, so each step waits to see the one before.
  async function seen(cx, look) {
    // 10s: past this a slow core's Home would be there with nothing knowing it's Home, an orphan in the lists.
    for (let i = 0; i < 400; i++) {
      const found = look();
      if (found) return found;
      await new Promise(resolve => cx.timer.after(25, () => resolve(undefined)));
    }
    return null;
  }
  async function goHome(cx) {
    // Before this computer's layout is read, a Home that exists reads as missing.
    const here = machines().find(m => m.name === null);
    if (here && here.layout !== "ready") return;
    const all = spaces();
    knowHome(all);
    if (knownHome(all)) return refitHome(true);
    const before = new Set(all.map(s => s.id)), from = all.find(s => s.active)?.id;
    // `space.new` can't start with a mod. Keep the current space showing while Home gets its page.
    run("space.new", { name: HOME_NAME, machine: "", folder: home(), focus: false });
    const found = await seen(cx, () => spaces().find(s => !before.has(s.id) && namedHome(s))?.id);
    const made = spaces().find(s => s.id === found && namedHome(s));
    if (!made) return;
    setShared(KEY.home, made.id);
    const sameHome = () => spaces().find(s => s.id === made.id && namedHome(s));
    const shell = made.tabs[0]?.id, mod = homeMod();
    let page = shell;
    if (mod) {
      const oldTabs = new Set(made.tabs.map(c => c.id));
      run("tab.new", { space: made.id, name: "Home", mod, focus: false });
      page = await seen(cx, () => {
        const pages = sameHome()?.tabs.filter(c => !oldTabs.has(c.id) && c.named && c.name === "Home");
        if (!pages?.length) return;
        const ps = panes();
        return pages.find(c => ps.some(p => p.tab === c.id && p.mod === mod))?.id;
      });
    }
    const tabs = sameHome()?.tabs ?? [];
    if (!tabs.some(c => c.id === page)) return;
    const shown = spaces().find(s => s.active)?.id;
    // The person may have selected another space while the page was being prepared.
    if (shown === from || shown === made.id) {
      api.arrive?.(made.id);
      run("tab.select", { id: page });
    }
    if (mod && tabs.some(c => c.id === shell)) run("tab.close", { id: shell, confirmed: true });
  }
  // The selected sidebar's rows, shown or hidden, stopping at either end.
  function step(command) {
    const to = agentStep(layout(), shared, spaces(), command === "next" ? 1 : -1);
    if (to?.startsWith("pane:")) focusPane(to.slice(5));
    else if (to) focusAgent(to);
  }
  // A space by the keys. Out of view Herdr may have moved its active tab to a closed one's neighbour, and being shown costs an
  // agent its unread done: return to the tab last shown there. tab.select brings the space along, so its active tab never shows.
  function showSpace(s) {
    const back = trail[s.id]?.find(id => s.tabs.some(c => c.id === id));
    api.arrive?.(s.id);
    run(back ? "tab.select" : "space.select", { id: back ?? s.id });
  }
  // The spaces the keys count and walk: all but Home, wrapping as space.next does.
  // The spaces the keys count: per-machine (matching the sidebar's per-device 1..9 numbers), falling back if on Home with no local spaces.
  function selectSpace(index) {
    const all = spaces().filter(s => s.id !== homeId());
    const cur = spaces().find(s => s.active);
    const curMachine = cur?.machine ?? null;
    const byMachine = shared("t3-spaces.by-machine");
    const ids = byMachine?.[curMachine ?? ""]?.length ? byMachine[curMachine ?? ""]
      : Object.values(byMachine ?? {}).find(a => a.length) ?? null;
    if (ids) {
      const id = ids[index - 1];
      const s = id ? all.find(x => x.id === id) : null;
      if (s) showSpace(s);
      return;
    }
    const mine = all.filter(s => (s.machine ?? null) === curMachine);
    const s = (mine.length ? mine : all)[index - 1];
    if (s) showSpace(s);
  }
  function walkSpaces(by) {
    const list = spaces().filter(s => s.id !== homeId());
    if (!list.length) return;
    const i = list.findIndex(s => s.active);
    // From Home, the first going forward, the last going back.
    showSpace(list[i < 0 ? (by > 0 ? 0 : list.length - 1) : (i + by + list.length) % list.length]);
  }

  // A pane is empty when its own shell holds the foreground. No answer counts as busy: better to ask.
  // shortcut: a shell's background jobs read as empty, upgrade if Herdr ever reports them.
  const SHELL = /^-?(zsh|bash|fish|sh|dash|ksh|tcsh|nu)$/;
  // What holds a terminal's foreground: `prompt` when it's its own shell; `process` its name, null without an answer.
  async function foreground(terminal) {
    try {
      const { code, stdout } = await hc(["get", terminal, "--json"]);
      if (code !== 0) return { prompt: false, process: null };
      const k = JSON.parse(stdout), name = k.foreground?.name ?? null;
      return { prompt: k.foreground?.pid === k.pid && SHELL.test(name ?? ""), process: name };
    } catch { return { prompt: false, process: null }; }
  }
  const atPrompt = async (terminal) => (await foreground(terminal)).prompt;

  function openCleanUp(props, cx) {
    beforeAsk(cx);
    if (asking) closeOverlay(asking);
    tabAnswer = cleanupAnswer = null;
    asking = openOverlay({ mod: "t3-actions", kind: "dialog", frame: "none", width: 512, props });
  }

  function confirmClose(title, detail, command, cx) {
    // The dialog covers it, nothing reports the leaving until the pointer moves, and the × stops the press that would close the card.
    beforeAsk(cx);
    if (asking) closeOverlay(asking);
    tabAnswer = cleanupAnswer = null;
    // t3-actions draws T3's alert dialog: the shipped confirm mod's measures are its own.
    asking = openOverlay({ mod: "t3-actions", kind: "dialog", frame: "none", width: 512, props: { actions: "confirm", title, detail, yes: "Close", command: { name: command } } });
  }

  // As T3's confirmTerminalClose: `Close terminal "Pi"?` or `Close 2 terminals?`, then what that ends.
  function ask(names, more, command, cx) {
    const [title, detail] = names.length === 1
      ? [`Close terminal "${names[0]}"?`, "This stops the running process and clears its history."]
      : [`Close ${names.length} terminals?`, `This stops their running processes and clears their histories: ${names.map(n => `"${n}"`).join(", ")}.`];
    confirmClose(title, detail + more, command, cx);
  }

  function cleanupScope() {
    const sp = spaces(), ps = panes(), ags = agents(), all = terminals();
    const tabNow = focused()?.tab ?? sp.find(s => s.active)?.tabs.find(c => c.active)?.id;
    const id = homeId(), openSpaces = sp.filter(s => s.id !== id && !namedHome(s));
    const tabs = new Set(openSpaces.flatMap(s => s.tabs.map(c => c.id)));
    const byAddr = new Map(all.map(k => [k.address, k]));
    const byAgent = new Map(ags.map(a => [a.address, a]));
    const kids = subAgents(ags, all);
    const candidates = new Map();
    for (const p of ps) {
      const terminal = p.terminal;
      if (!terminal || p.tab === tabNow || !tabs.has(p.tab)) continue;
      const a = byAgent.get(terminal), k = byAddr.get(terminal), under = kids(terminal);
      if (a
        ? k && !isSubAgent(terminal, byAddr) && stillSettled(k, ownStatus(a.status, terminal, all), under)
        : !programOf(p)?.agent && k?.status == null && !under.length) {
        candidates.set(p.pane, { terminal, agent: Boolean(a) });
      }
    }
    // Spaces still at work: the one you're in, and any with a top-level agent that isn't settled (snoozed counts: it comes back).
    // Their programs are in use; only another space's are left behind.
    const working = new Set(openSpaces.filter(s => s.tabs.some(c => c.id === tabNow)).map(s => s.id));
    const spaceOfTab = new Map(openSpaces.flatMap(s => s.tabs.map(c => [c.id, s.id])));
    for (const a of ags) {
      const k = byAddr.get(a.address), space = spaceOfTab.get(a.tab);
      if (!space || isSubAgent(a.address, byAddr)) continue;
      if (!(k && stillSettled(k, ownStatus(a.status, a.address, all), kids(a.address)))) working.add(space);
    }
    for (const p of ps) {
      const terminal = p.terminal;
      if (!terminal || byAgent.has(terminal)) continue;
      const space = spaceOfTab.get(p.tab), k = byAddr.get(terminal);
      if (!space || working.has(space) || isSubAgent(terminal, byAddr)) continue;
      if (!programOf(p)?.agent && k?.status == null) continue;
      if (!(k && stillSettled(k, ownStatus(k.status, terminal, all), kids(terminal)))) working.add(space);
    }
    return { openSpaces, ps, candidates, working };
  }

  // `kept`: the non-agent terminals in scope still running a program (pane → its process); cleanup keeps those left behind.
  async function scanCleanup(targets) {
    const { candidates } = cleanupScope();
    const eligible = new Map(), busy = new Map(), procs = new Map();
    await Promise.all([...candidates].map(async ([pane, { terminal, agent }]) => {
      if (targets && targets.get(pane) !== terminal) return;
      const fg = agent ? null : await foreground(terminal);
      if (fg?.process) procs.set(pane, fg.process);
      if (agent || fg.prompt) eligible.set(pane, { terminal, agent });
      else busy.set(pane, fg.process);
    }));
    // A prompt probe can take long enough for focus, pane contents or an agent's state to change.
    const current = cleanupScope();
    const confirmed = new Map();
    for (const [pane, { terminal, agent }] of eligible) {
      const p = current.candidates.get(pane);
      if (p?.terminal === terminal && p.agent === agent) confirmed.set(pane, { terminal, agent });
    }
    const kept = new Map([...busy].filter(([pane]) => {
      const p = current.candidates.get(pane);
      return p && !p.agent && p.terminal === candidates.get(pane).terminal;
    }));
    return { openSpaces: current.openSpaces, ps: current.ps, confirmed, kept, working: current.working, procs };
  }

  // Clean up (t3-actions draws it): what closes, by space, and a card for each program left behind. Nothing in it, a toast.
  async function cleanup(cx) {
    const scan = ++cleanupScanSerial;
    const { openSpaces, ps, confirmed, kept: running, working, procs } = await scanCleanup(null);
    if (scan !== cleanupScanSerial) return;
    const n = confirmed.size;
    // Left behind: a program running where no agent is at work any more. Elsewhere it's in use, and not Clean up's.
    const tabSpace = new Map(openSpaces.flatMap(s => s.tabs.map(c => [c.id, s.id])));
    const kept = new Map([...running].filter(([pane]) => !working.has(tabSpace.get(ps.find(p => p.pane === pane)?.tab))));
    if (!n && !kept.size) {
      notify({ title: "Nothing to clean up", body: "No idle or left-behind terminals outside this tab.", level: "info" });
      return;
    }
    const name = namer(), mine = s => { const tabs = new Set(s.tabs.map(c => c.id)); return ps.filter(p => tabs.has(p.tab)); };
    const tabOf = new Map(openSpaces.flatMap(s => s.tabs.map(c => [c.id, c])));
    const inTab = new Map();
    for (const p of ps) inTab.set(p.tab, (inTab.get(p.tab) ?? 0) + 1);
    const rowName = (p) => {
      const tab = tabOf.get(p.tab);
      if (tab?.named && tab.name && inTab.get(p.tab) === 1) return tab.name;
      const label = name(p);
      const proc = procs.get(p.pane);
      return label === p.terminal && proc ? proc : label;
    };
    // Each row as Clean up draws it: the pane's own name and program, under its space's mark.
    const rows = (has) => openSpaces.flatMap(s => mine(s).filter(p => has(p.pane)).map(p => ({
      pane: p.pane, name: rowName(p), space: s.name, spaceId: s.id, machine: s.machine ?? null, program: programOf(p) ?? null,
    })));
    const settledMap = new Map(), shellsMap = new Map();
    for (const [pane, { terminal, agent }] of confirmed) (agent ? settledMap : shellsMap).set(pane, terminal);
    const settled = rows(pane => settledMap.has(pane)).map(r => ({ ...r, terminal: settledMap.get(r.pane) }));
    const shells = rows(pane => shellsMap.has(pane)).map(r => ({ ...r, terminal: shellsMap.get(r.pane) }));
    const cards = rows(pane => kept.has(pane)).map(c => ({ ...c, process: kept.get(c.pane) }));
    const serial = n ? ++cleanupSerial : null;
    const command = serial ? `cleanup-now:${serial}` : null;
    openCleanUp({ actions: "clean-up", settled, shells, cards, command: command && { name: `t3-tabs.${command}` } }, cx);
    cleanupAnswer = serial ? { serial, settled: settledMap, shells: shellsMap } : null;
  }

  // A card's ×: Clean up already asked, so the program stops now; alone in its tab, the tab goes too, as cleanup closes.
  function stopPane(pane) {
    const p = panes().find(x => x.pane === pane);
    if (!p) return;
    const mine = panes().filter(x => x.tab === p.tab);
    if (mine.length === 1) run("tab.close", { id: p.tab, confirmed: true });
    else run("pane.close", { pane });
  }

  async function cleanupNow(targets) {
    const { openSpaces, ps, confirmed } = await scanCleanup(targets);
    if (!confirmed.size) return;
    for (const s of openSpaces) {
      for (const c of s.tabs) {
        const mine = ps.filter(p => p.tab === c.id);
        if (mine.length && mine.every(p => confirmed.has(p.pane))) run("tab.close", { id: c.id, confirmed: true });
        else for (const p of mine) if (confirmed.has(p.pane)) run("pane.close", { pane: p.pane });
      }
    }
  }

  function tabCloseScope(id) {
    const space = spaces().find(s => s.tabs.some(c => c.id === id));
    // A key pressed out of habit doesn't take Home and what's there with it.
    if (!space || space.id === homeId()) return null;
    const tab = space.tabs.find(c => c.id === id), mine = panes().filter(p => p.tab === id);
    const live = mine.filter(p => p.terminal), terminals = new Set(live.map(p => p.terminal));
    return { space: space.id, tab, mine, live, terminals, closesSpace: space.tabs.length === 1 };
  }

  function askTabClose(scope, idle, cx) {
    const busy = scope.live.filter(p => !idle.has(p.terminal));
    if (!busy.length) return false;
    // A lone pane goes by its tab's name, as the tab shows it.
    const name = namer();
    const names = busy.map(p => scope.mine.length === 1 ? nameOf(scope.tab, p, name) : name(p));
    const command = `close-tab-now:${++tabAskSerial}`;
    ask(names, scope.closesSpace ? " It's the space's last tab, so the space closes too." : "", `t3-tabs.${command}`, cx);
    tabAnswer = { command, id: scope.tab.id, space: scope.space, closesSpace: scope.closesSpace, terminals: scope.terminals, idle };
    return true;
  }

  // Ending a program asks first. Empty panes have none to lose, and an unconfirmed close leaves the space question to Herdr.
  async function closeTab(id, cx, answer = null) {
    const start = tabCloseScope(id);
    if (!start || (answer && start.space !== answer.space)) return;
    const covers = (scope) => answer && (answer.closesSpace || !scope.closesSpace) &&
      [...scope.terminals].every(address => answer.terminals.has(address));
    const idle = answer?.idle ?? new Set();
    if (!answer) {
      await Promise.all([...start.terminals].map(async address => {
        if (await atPrompt(address)) idle.add(address);
      }));
    }
    const before = tabCloseScope(id);
    if (!before || before.space !== start.space) return;
    if (!covers(before) && askTabClose(before, idle, cx)) return;
    await leave(id, cx);
    // Home can take several frames to arrive. Recheck in the same turn as the destructive command.
    const now = tabCloseScope(id);
    if (!now || now.space !== start.space) return;
    if (covers(now)) run("tab.close", { id, confirmed: true });
    else if (!askTabClose(now, idle, cx)) run("tab.close", { id });
  }

  async function closePaneNow(pane, cx) {
    const ps = panes(), p = ps.find(p => p.pane === pane), tab = p?.tab;
    if (ps.filter(p => p.tab === tab).length === 1) await leave(tab, cx);
    else if (focused()?.pane === pane && p?.mod && programOf(p)?.inbox) {
      const mine = agents().filter(a => a.tab === tab), back = mine.find(a => a.address === focused()?.agent) ?? mine[0];
      if (back) focusAgent(back.address);
    }
    run("pane.close", { pane });
  }

  // Home is one thing alone (docs/adr/0005): its own tab, a lone pane that is the setting's mod or, set so, a shell. Another mod
  // there, or an idle shell when a mod is wanted, gives way to it; a shell busy with something else keeps its tab, and Home
  // gets a new one.
  async function refitHome(go) {
    const space = knownHome();
    if (!space) return;
    const tabs = new Set(space.tabs.map(c => c.id));
    const ps = panes(), mine = ps.filter(p => tabs.has(p.tab));
    // panes() hasn't caught up with Home yet: showing it is all there is to do.
    if (!mine.length) {
      if (!go) return;
      api.arrive?.(space.id);
      return run("space.select", { id: space.id });
    }
    const fits = (p) => homeMod() ? p.mod === homeMod() : Boolean(p.terminal);
    const owns = mine.filter(p => ps.filter(q => q.tab === p.tab).length === 1);
    let own = owns.find(fits) ?? owns.find(p => p.mod);
    for (const p of own ? [] : owns.filter(p => p.terminal)) if (await atPrompt(p.terminal)) { own = p; break; }
    if (knownHome()?.id !== space.id) return;
    if (own && !fits(own)) {
      run("pane.split", { direction: "right", pane: own.pane, ...fill() });
      run("pane.close", { pane: own.pane });
    }
    if (!go) return;
    // tab.select brings the space along, so nothing else there shows on the way.
    api.arrive?.(space.id);
    if (own) return run("tab.select", { id: own.tab });
    run("tab.new", { space: space.id, name: "Home", folder: home(), ...fill() });
  }

  // The Inbox's next card after `from`, going around, when the person chose to go on to it (t3.settings); its rows' first
  // `cards` are the cards. False: the caller goes Home.
  function nextCard(from) {
    if (t3Settings().afterAway !== "next") return false;
    const { order = [], cards = 0 } = shared(KEY.inboxRows) ?? {}, list = order.slice(0, cards), i = list.indexOf(from);
    const to = i < 0 ? null : [...list.slice(i + 1), ...list.slice(0, i)][0];
    if (to?.startsWith("pane:")) focusPane(to.slice(5));
    else if (to) focusAgent(to);
    return Boolean(to);
  }

  // Going first, so Herdr's neighbour never shows: being shown costs an agent its unread done, one the bar hides included.
  async function leave(id, cx) {
    const space = spaces().find(s => s.active);
    // Out of view, closing it moves nothing.
    if (atHome() || !space?.tabs.find(c => c.id === id)?.active) return;
    // A space's last tab takes the space: an agent's goes Home first, or Herdr would show another space's tab; any other, Herdr may still ask.
    // Husain's: an agent's tab among others goes back in its space like any tab, not Home as T3's does, in either sidebar mode.
    if (space.tabs.length === 1) return agents().some(a => a.tab === id) ? goHome(cx) : undefined;
    goBack(space.id, id);
  }

  // Back to where the person was before a tab with no agent. Nowhere remembered: Herdr's pick stands.
  function goBack(space, from) {
    const back = trail[space]?.find(id => id !== from && spaces().some(s => s.tabs.some(c => c.id === id)));
    if (!back) return;
    going = { tab: back, until: Date.now() + 500 };
    run("tab.select", { id: back });
  }

  async function closePane(pane, cx) {
    const ps = panes(), p = ps.find(p => p.pane === pane);
    if (!p) return;
    const space = spaces().find(s => s.tabs.some(c => c.id === p.tab)), tabs = space?.tabs.map(c => c.id) ?? [];
    const last = ps.filter(q => tabs.includes(q.tab)).length === 1, inHome = space?.id === homeId();
    // Home's last pane stays: a key doesn't empty Home.
    if (inHome && last) return;
    // A space's last pane closes the space, and Herdr asks that itself.
    if (!p.terminal || last || await atPrompt(p.terminal)) return closePaneNow(pane, cx);
    ask([namer()(p)], "", `t3-tabs.close-pane-now:${pane}`, cx);
  }

  // Where the person has been, once a frame, by what the app reports: each space's tabs, latest shown first. The one memory
  // the bar keeps; which agent it holds and where a close lands both read from it, so they can't disagree.
  // shortcut: it's gone after a restart, so Herdr's pick stands until a tab has been shown; upgrade if that matters.
  function advance() {
    const all = spaces(), ps = panes(), every = agents();
    knowHome(all);
    // An agent started in Home (in its shell) makes that space an ordinary one, named for its folder, where it is: nothing
    // moves, so nothing flickers. Going Home next makes a new Home (docs/adr/0005).
    const homeSpace = knownHome(all);
    if (homeSpace && every.some(a => homeSpace.tabs.some(c => c.id === a.tab))) {
      released.add(homeSpace.id);
      setShared(KEY.home, null);
      run("space.rename", { id: homeSpace.id, name: "" });
      // Home's own tab is called Home, which a card would take for the agent's name.
      for (const c of homeSpace.tabs.filter(c => c.named && c.name === "Home")) run("tab.rename", { id: c.id, name: "" });
      wasHome = false;
    }
    const space = all.find(s => s.active), tab = space?.tabs.find(c => c.active), isHome = atHome(all);
    const liveSpaces = new Set(all.map(s => s.id)), liveTabs = new Set(all.flatMap(s => s.tabs.map(c => c.id)));
    const alive = (id) => liveTabs.has(id);
    for (const sid of Object.keys(trail)) {
      if (!liveSpaces.has(sid)) delete trail[sid];
      else {
        const kept = trail[sid].filter(alive);
        if (kept.length) trail[sid] = kept;
        else delete trail[sid];
      }
    }
    for (const sid of fresh) if (!liveSpaces.has(sid)) fresh.delete(sid);
    for (const sid of released) if (!liveSpaces.has(sid)) released.delete(sid);
    const was = inView;
    // Herdr's pick shows until Home does, and that isn't somewhere the person went.
    const toHome = () => { going = { until: Date.now() + 500 }; run("t3-tabs.home"); };
    // Home's last program ended, past closePane: the space went with it.
    if (wasHome && all.length && !liveSpaces.has(homeId())) toHome();
    wasHome = isHome;
    // For the closes this mod doesn't make, which leave() can't go ahead of: the tab's menu, the program ending. Herdr has
    // already picked the neighbour, and it may have been shown.
    const terms = terminals();
    const byAddress = terminalByAddress(terms);
    const byAgent = new Map(every.map(a => [a.address, a]));
    if (was && !alive(was.tab) && !isHome) {
      // With the Inbox, the agent in view lands on Home, as settling it does: what to look at next stays the person's to say.
      // In Lists, as any tab, unless no space is left to show.
      // Husain's: still in its space, back to the tab before, agent or not; the agent in view whose space went too lands on Home.
      if (space?.id === was.space) goBack(was.space, was.tab);
      else if (was.agent) toHome();
      // Herdr marked what it showed as seen in the same step it picked it (window active), before any mod hears of it. An agent
      // unread a frame ago that only the pick showed is owed its done back, the way Herdr's Mark unread writes it.
      for (const a of every.filter(a => a.tab === tab?.id)) {
        const before = unread?.get(a.address);
        if (before) owed.set(a.address, { ...before, until: Date.now() + 3000 });
      }
    }
    const viewing = inViewAgent(terms, every, ps, byAddress, byAgent);
    zoomFollows(every, ps);
    payBack(tab, isHome, terms, every, ps, byAddress, byAgent);
    endSnoozes(terms, every, viewing, byAddress, byAgent);
    // What's unread now, for the next frame's close: its turn, and a snooze it woke from (seeing it clears that too).
    unread = new Map(every.filter(a => a.status === "done").map(a => {
      const k = byAddress.get(a.address);
      return [a.address, { turn: k?.turn ?? 0, snoozed: k?.labels?.snoozed }];
    }));
    if (going && (Date.now() > going.until || (going.tab ? tab?.id === going.tab : isHome))) going = null;
    // Until a close's target shows, what shows is Herdr's pick, not somewhere the person went.
    if (space && tab && !isHome && !going) trail[space.id] = [tab.id, ...(trail[space.id] ?? []).filter(id => id !== tab.id && alive(id))];
    inView = tab && !isHome && !going ? { tab: tab.id, space: space.id, agent: every.some(a => a.tab === tab.id) } : null;
    const looked = !going && byAgent.get(viewing);
    if (looked && !isHome) { lastIn[looked.tab] = looked.address; fresh.delete(looked.space); }
    for (const id of Object.keys(lastIn)) if (!alive(id)) delete lastIn[id];
    return { spaces: all, panes: ps, space, every, all: terms, looked, home: isHome };
  }

  // For what focuses a pane without zoom.js going first, Herdr's own: a toast, hc, the palette, its keys. Its focus moved and the
  // zoom stayed, or a zoom landed on a pane the focus isn't on: the later of the two wins. What the stale zoom showed for that
  // frame is owed its done, as a close's neighbour is. Once per disagreement: pane.zoom toggles, and a repeat would undo it.
  function zoomFollows(every, ps) {
    const f = ps.find(p => p.focused), z = f && ps.find(p => p.tab === f.tab && p.zoomed), was = focusWas;
    const off = z && z.pane !== f.pane ? `${f.pane}:${z.pane}` : null, told = zoomOff;
    focusWas = f?.pane; zoomOff = off;
    if (!off || off === told) return;
    if (was === f.pane) return run("pane.focus", { pane: z.pane });
    run("pane.zoom", { pane: f.pane });
    const before = unread?.get(z.terminal);
    if (before && every.some(a => a.address === z.terminal)) owed.set(z.terminal, { ...before, until: Date.now() + 3000 });
  }

  // Once what Herdr's pick showed is out of view, and its seen has come back from the core (or the lower write could land first),
  // its turn is unread again. Still in view after a few seconds: the person stayed there, so it was seen after all.
  function payBack(tab, home, terms, every, ps, byAddress = new Map(terms.map(k => [k.address, k])), byAgent = new Map(every.map(a => [a.address, a]))) {
    for (const [addr, o] of owed) {
      const k = byAddress.get(addr), a = byAgent.get(addr);
      if (!k || (k.turn ?? 0) !== o.turn || o.turn < 1) { owed.delete(addr); continue; }
      // Done already (the window wasn't active, so nothing was marked): only a cleared snooze may be owed.
      if (a?.status === "done") o.seen = true;
      // In its tab but zoomed away from isn't in view either.
      const covered = ps.some(p => p.tab === a?.tab && p.zoomed && p.terminal !== addr);
      if (a?.tab === tab?.id && !home && !covered) { if (Date.now() > o.until) owed.delete(addr); continue; }
      if (!o.seen && !o.seenWriting && Number(k.labels?.["herdr.seen"]) >= o.turn) {
        o.seenWriting = true;
        writeLabel(addr, "herdr.seen", String(o.turn - 1), o.seenTold).then(ok => { o.seenWriting = false; if (ok) o.seen = true; });
        o.seenTold = true;
      }
      // The Inbox clears a woken snooze when it's seen, and that write may come back after ours: wait for it.
      if (o.snoozed && !o.snoozeWriting && !k.labels?.snoozed) {
        o.snoozeWriting = true;
        writeLabel(addr, "snoozed", o.snoozed, o.snoozeTold).then(ok => { o.snoozeWriting = false; if (ok) o.snoozed = null; });
        o.snoozeTold = true;
      }
      if ((o.seen && !o.snoozed) || Date.now() > o.until) owed.delete(addr);
    }
  }

  // A snooze ends on a failure in its tree or a new turn given in view, as the Inbox ends it; here too, in either sidebar,
  // as the Inbox copy may not have started (docs/adr/0003). Seeing it once it has woken stays the Inbox's: Woke is its mark.
  function endSnoozes(terms, every, viewing, byAddress = new Map(terms.map(k => [k.address, k])), byAgent = new Map(every.map(a => [a.address, a]))) {
    for (const addr of waking.keys()) if (!byAddress.has(addr)) waking.delete(addr);
    const was = states, active = window()?.active, now = Date.now();
    const under = subAgents(every, terms);
    const state = (a) => treeStatus(ownStatus(a.status, a.address, terms), under(a.address));
    states = new Map(every.map(a => [a.address, state(a)]));
    const viewed = going ? null : viewing;
    for (const k of terms) {
      if (!k.labels?.snoozed || now - (waking.get(k.address) ?? -Infinity) < 10000) continue;
      const a = byAgent.get(k.address);
      if (!a) continue;
      const failed = k.status === "error" || descendants(terms, a.address).some(d => d.status === "error");
      const turned = active && a.address === viewed && states.get(a.address) === "working" && ["idle", "done"].includes(was.get(a.address));
      if (!failed && !turned) continue;
      // Once per 10s: the label takes a moment to come back, and a refused write mustn't retry, and tell, on every frame.
      waking.set(a.address, now);
      writeLabel(a.address, "snoozed", "");
    }
  }

  // The agent in view, as the Inbox's row in view (t3-inbox/row-model.js inboxInView): the focused one; else a sub-agent with
  // no row of its own (a block, a peek) stands for its nearest agent; a mod pane for the agent beside it, unless it has a card.
  function inViewAgent(terms, every, ps, byAddress = new Map(terms.map(k => [k.address, k])), byAgent = new Map(every.map(a => [a.address, a]))) {
    const own = every.find(a => a.focused);
    if (own) return own.address;
    const f = focused();
    if (f?.pane && !f.terminal) {
      const p = ps.find(p => p.pane === f.pane);
      if (p?.mod && programOf(p)?.inbox) return null;
      const here = every.filter(a => a.tab === f.tab);
      return (here.find(a => a.address === f.agent) ?? here[0])?.address ?? null;
    }
    const seen = new Set();
    let k = byAddress.get(f?.pane ? f.terminal : f?.agent ?? f?.terminal);
    while (k && !byAgent.has(k.address) && !seen.has(k.address)) { seen.add(k.address); k = byAddress.get(k.parent); }
    return k && byAgent.has(k.address) ? k.address : null;
  }

  // Who the Inbox's bar is about: the agent in view, the card the Inbox lights. With none (a program has the focus), the one last
  // looked at in the tab holding the work: the shown tab, else, in a tool's tab, the one last shown here with an agent. After
  // something new was started (fresh), a tab with no agent holds none. A tab's heads are its agents whose parent isn't in it.
  function work({ space, every, all, looked, home }) {
    if (!space || home) return null;
    const byAddress = new Map(all.map(k => [k.address, k]));
    const listed = new Map(every.map(a => [a.address, a]));
    // The nearest live agent above, through what isn't listed (a shell between them).
    const above = (address) => {
      const seen = new Set();
      let k = byAddress.get(byAddress.get(address)?.parent);
      while (k?.state === "live" && !seen.has(k.address)) {
        if (listed.has(k.address)) return listed.get(k.address);
        seen.add(k.address);
        k = byAddress.get(k.parent);
      }
      return null;
    };
    const shownTab = going?.tab ?? space.tabs.find(c => c.active)?.id;
    // Until a close's target shows, the focus is on Herdr's pick, not on anyone the person went to.
    const current = looked && space.tabs.some(c => c.id === looked.tab) ? looked : null;
    const tab = current?.tab ?? (fresh.has(space.id) ? [shownTab] : [shownTab, ...(trail[space.id] ?? [])]).find(id => every.some(a => a.tab === id));
    const here = every.filter(a => a.tab === tab), heads = here.filter(a => above(a.address)?.tab !== tab);
    const viewed = current ?? here.find(a => a.address === lastIn[tab]) ?? heads[0];
    let head = viewed;
    while (head && !heads.includes(head)) head = above(head.address);
    // A sub-agent counts as the agent at its top, whose family the bar holds.
    let top = viewed?.address;
    for (let up = viewed && above(top); up; up = above(top)) top = up.address;
    return { space, every, all, tab, shownTab, heads, head, viewed, held: !current, parent: head ? above(head.address) : null, top };
  }

  // With the Inbox showing, cards lead to the agents, so the bar holds what's around the work in view: the agent, its
  // sub-agents' tabs, then the tabs with no agent in their own order. Home has no tabs to show.
  function visibleTabs(w) {
    if (!w) return [];
    const { space, every, all, top } = w;
    if (!inboxShown()) return space.tabs;
    // No agent in view, no family: descendants() of nothing would be every top-level agent.
    const family = new Set(top ? [top, ...descendants(all, top).map(k => k.address)] : []);
    const lead = space.tabs.find(c => c.id === every.find(a => a.address === top)?.tab);
    const kin = space.tabs.filter(c => c !== lead && every.some(a => a.tab === c.id && family.has(a.address)));
    return [...(lead ? [lead] : []), ...kin, ...space.tabs.filter(c => !every.some(a => a.tab === c.id))];
  }

  // The Inbox's bar as it draws: who's in view (docs/internals/specs/tab-bar.md), then its family's other tabs and the
  // space's programs. The tab in view and the parent's are in the breadcrumb, so not again among them.
  function context(w, tabs) {
    if (!w || !inboxShown()) return null;
    const { space, every, tab, shownTab, heads, head, viewed, held, parent } = w;
    const skip = new Set([tab, parent?.tab]);
    const others = tabs.filter(c => !skip.has(c.id));
    return {
      space, tab: tab ?? null, parent: parent?.address ?? null, heads: heads.map(a => a.address), head: head?.address ?? null,
      sub: viewed && viewed !== head ? viewed.address : null, held, away: Boolean(tab) && shownTab !== tab,
      kin: others.filter(c => every.some(a => a.tab === c.id)), programs: others.filter(c => !every.some(a => a.tab === c.id)),
    };
  }

  function tabOrder() {
    const observation = advance(), w = work(observation);
    return { w, tabs: visibleTabs(w), home: observation.home };
  }

  // The next or previous tab the bar shows, going around.
  function walkTabs(by) {
    const { w, tabs: list } = tabOrder();
    if (!list.length) return;
    run("tab.select", { id: list[(list.findIndex(c => c.id === w.shownTab) + by + list.length) % list.length].id });
  }

  // arrive(space): set by the keys block; prepares the destination's work frame, tab row and panel before selecting it.
  const api = {
    get atHome() { return atHome(); },
    // The keys block's draw: t3.projects is kept here alone, as the strip's own advance in the same frame would only repeat it.
    advance() {
      const now = advance(), next = rememberProjects(now.spaces, now.panes, homeId(), home(), shared(KEY.projects));
      if (next && !checking()) setShared(KEY.projects, next);
    },
    nextCard,
    async handle(command, cx) {
      if (command === "close-tab") await closeTab(focused()?.tab, cx);
      else if (command === "close-pane") await closePane(focused()?.pane, cx);
      else if (command.startsWith("close-tab:")) await closeTab(command.slice("close-tab:".length), cx);
      else if (command.startsWith("close-pane:")) await closePane(command.slice("close-pane:".length), cx);
      else if (command.startsWith("close-tab-now:")) {
        const answer = tabAnswer;
        if (answer?.command === command) {
          tabAnswer = null;
          await closeTab(answer.id, cx, answer);
        }
      }
      else if (command.startsWith("close-pane-now:")) await closePaneNow(command.slice("close-pane-now:".length), cx);
      else if (command === "cleanup") await cleanup(cx);
      else if (command.startsWith("stop-pane:")) stopPane(command.slice("stop-pane:".length));
      else if (command.startsWith("go-pane:")) focusPane(command.slice("go-pane:".length));
      else if (command.startsWith("cleanup-now:")) {
        const answer = cleanupAnswer;
        const rest = command.slice("cleanup-now:".length), colon = rest.indexOf(":");
        const serial = colon < 0 ? rest : rest.slice(0, colon), scope = colon < 0 ? "all" : rest.slice(colon + 1);
        if (answer && String(answer.serial) === serial) {
          let targets = null;
          if (scope === "all") {
            targets = new Map([...answer.settled, ...answer.shells]);
            cleanupAnswer = null;
          } else if (scope === "settled") {
            targets = new Map(answer.settled);
            answer.settled.clear();
            if (!answer.shells.size) cleanupAnswer = null;
          } else if (scope === "shells") {
            targets = new Map(answer.shells);
            answer.shells.clear();
            if (!answer.settled.size) cleanupAnswer = null;
          } else if (scope.startsWith("pane:")) {
            const pane = scope.slice("pane:".length), term = answer.settled.get(pane) ?? answer.shells.get(pane);
            if (term !== undefined) {
              targets = new Map([[pane, term]]);
              answer.settled.delete(pane);
              answer.shells.delete(pane);
              if (!answer.settled.size && !answer.shells.size) cleanupAnswer = null;
            }
          }
          if (targets?.size) await cleanupNow(targets);
        }
      }
      else if (command === "home") await goHome(cx);
      else if (command === "home-mod") await refitHome(false);
      // As Herdr's own Settings, a dialog; pressed again, it replaces the open one (closing one already gone does nothing).
      else if (command === "settings") {
        if (settingsOpen) closeOverlay(settingsOpen);
        settingsOpen = openOverlay({ mod: "t3-chrome", kind: "dialog", width: 880, props: { view: "settings" } });
      }
      else if (command === "next" || command === "prev") step(command);
      // New work doesn't start in Home, and with no space open there is none to start it in: New picks its space.
      // `new:<space>` names the space (New's pick, a menu's New tab); bare, the one in view.
      else if (command === "new" || command.startsWith("new:")) {
        const all = spaces(), id = command.slice("new:".length), space = all.find(s => id ? s.id === id : s.active);
        if (!space || space.id === knownHome(all)?.id) run("mod.open", { name: "t3-new-menu" });
        else {
          const folder = !space.machine && !checking() ? placeOf(space, panes()) : null;
          if (folder && !(await checkFolder(folder))) {
            const h = home();
            const shown = h && (folder === h || folder.startsWith(`${h}/`) || folder.startsWith(`${h}\\`)) ? "~" + folder.slice(h.length) : folder;
            notify({ title: "Folder not found", body: `${shown} no longer exists on this computer.`, level: "warning" });
            return;
          }
          const live = spaces().find(s => s.id === space.id);
          if (!live) return;
          fresh.add(live.id);
          newTab(live);
        }
      }
      else if (command.startsWith("space:")) selectSpace(Number(command.slice("space:".length)));
      else if (command === "space-next") walkSpaces(1);
      else if (command === "space-prev") walkSpaces(-1);
      else if (command.startsWith("tab:")) {
        const c = tabOrder().tabs[Number(command.slice("tab:".length)) - 1];
        if (c) run("tab.select", { id: c.id });
      }
      else if (command === "tab-next") walkTabs(1);
      else if (command === "tab-prev") walkTabs(-1);
    },
    frame() {
      const { w, tabs, home } = tabOrder();
      return { tabs, atHome: home, context: context(w, tabs) };
    },
  };
  return api;
}
