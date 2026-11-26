const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const kit = require("./check-kit.js"), { plain } = kit;
const read = file => fs.readFileSync(path.join(__dirname, file), "utf8");
const source = kit.bundle(read, "navigation.js");
const flush = () => new Promise(setImmediate);
const closeAnswer = overlay => overlay.props.command.name.slice("t3-tabs.".length);

// Replay with the strip first or with keys on both sides of the strip.
let twice = false;
// A fake Herdr core: tests change platform facts, advance time, and observe commands and labels.
function fixture() {
  const program = { key: "pi", name: "Pi", agent: true, tint: true, icon: "icons/pi.svg" };
  const tabs = ["local task", "second task", "remote task"].map((name, i) => ({ id: `b${i}`, name, named: true }));
  const spaces = tabs.map((tab, i) => ({ id: `s${i}`, name: `project ${i}`, active: i === 0, folder: `/work/p${i}`, machine: i === 2 ? "vps" : null, tabs: [tab] }));
  const agents = [0, 2].map(i => ({ address: i === 2 ? "vps/t2" : "t0", pane: `p${i}`, space: `s${i}`, space_name: spaces[i].name, tab: `b${i}`, title: tabs[i].name, program, focused: i === 0, status: i === 0 ? "working" : "blocked" }));
  const terminals = agents.map(a => ({ ...a, state: "live" }));
  const panes = agents.map(a => ({ ...a, terminal: a.address, cwd: `/work/${a.space}` }));
  const machines = [{ name: null, layout: "ready" }, { name: "vps", layout: "ready" }];
  const slots = { sidebar: { id: "sidebar" } }, state = {}, shown = { agent: "child" };
  const calls = [], labelled = [], overlays = [], closed = [], notifications = [], timers = [], events = [];
  let now = 1000000, hcAnswer = () => ({ code: 0 });
  const cx = { notify() {}, timer: { after(ms, fn) { const t = { ms, fn }; timers.push(t); return t; } } };
  const core = {
    checking: () => false,
    spaces: () => spaces, agents: () => agents, terminals: () => [...terminals], panes: () => [...panes], machines: () => machines,
    focused: () => shown, shared: key => state[key], setShared: (key, value) => { state[key] = value; },
    layout: () => ({ children: Object.values(slots) }), home: () => "/home/test", window: () => ({ active: true }),
    run: (name, args) => calls.push([name, plain(args ?? {})]),
    exec: async () => ({ code: 0, stdout: "", stderr: "" }),
    folderExists: async () => true,
    hc: args => { labelled.push([...args]); return Promise.resolve(hcAnswer(args)); },
    notify: n => notifications.push(n),
    openOverlay: spec => { events.push("open"); overlays.push(spec); return overlays.length; },
    closeOverlay: id => { events.push("close"); closed.push(id); },
  };
  const scope = vm.createContext({ ...core, Date: { now: () => now } });
  vm.runInContext(source, scope, { filename: "navigation.js" });
  Object.assign(core, vm.runInContext("({ namer, programOf, focusAgent, focusPane, writeLabel })", scope));
  return { ...core, terminals: () => terminals, panes: () => panes, cx, slots, state, shown, calls, labelled, overlays, closed, notifications, timers, events,
    navigation: (beforeAsk, over = {}) => {
      const view = scope.navigation(beforeAsk, { ...core, ...over }), frame = view.frame;
      if (twice) view.frame = () => { view.advance(); const model = frame(); view.advance(); return model; };
      return view;
    },
    answerHc: fn => { hcAnswer = fn; }, advance: ms => { now += ms; },
    async tick() { assert.equal(timers.at(-1).ms, 25); timers.at(-1).fn(); await flush(); },
  };
}

function checkBookmarks() {
  const f = fixture(), view = f.navigation();
  f.state["t3-tabs.home"] = "known-home";
  f.spaces().push(
    { id: "known-home", machine: null, name: "My Home", named: true, folder: "/home/test", tabs: [] },
    { id: "named-home", machine: null, name: "Home\u200b", named: true, folder: "/private/home", tabs: [] },
    { id: "unnamed-home-folder", machine: null, name: "~", folder: "/home/test", tabs: [] });
  f.navigation(undefined, { checking: () => true }).advance();
  const saved = () => f.state["t3.projects"];
  assert.equal(saved(), undefined, "checking leaves bookmarks alone");
  f.navigation().frame();
  assert.equal(saved(), undefined, "the strip's frame leaves bookmarks to the keys block, which draws in the same frame");

  view.advance();
  const first = saved();
  assert.deepEqual(plain(first ?? null), [
    { machine: null, folder: "/work/p0", name: "project 0" },
    { machine: null, folder: "/work/p1", name: "project 1" },
    { machine: "vps", folder: "/work/p2", name: "project 2" },
  ], "record open projects, excluding Home and the unnamed local home folder");
  view.advance();
  assert.equal(saved(), first, "an unchanged observation does not rewrite bookmarks");

  f.spaces()[0].active = false;
  f.spaces()[2].active = true;
  f.spaces().push({ id: "new", machine: null, folder: "/work/new", name: "new", tabs: [] });
  view.advance();
  assert.deepEqual(saved().map(p => p.folder).join(","), "/work/p2,/work/new,/work/p0,/work/p1");
  Object.assign(f.spaces()[0], { name: "renamed", named: true });
  view.advance();
  assert.deepEqual(plain(saved()[2]), { machine: null, folder: "/work/p0", name: "renamed", named: true });
  f.spaces().splice(0, 1);
  view.advance();
  assert.equal(saved()[2].name, "renamed", "closing a space preserves its bookmark");
}

function cleanupFixture() {
  const f = fixture(), [current, drained, mixed] = f.spaces();
  current.tabs[0].active = true;
  f.state["t3-tabs.home"] = "known-home";
  const home = { id: "known-home", machine: null, tabs: [{ id: "home-id" }] };
  const namedHome = { id: "named-home", machine: null, named: true, name: "Home\u200b", tabs: [{ id: "home-name" }] };
  const shell = (pane, tab, extra) => {
    const p = { pane, tab, terminal: pane + "-term", ...extra };
    f.panes().push(p);
    return p;
  };
  const agent = (pane, tab, extra = {}) => {
    const p = shell(pane, tab, { program: f.agents()[0].program });
    const a = { pane, tab, address: p.terminal, status: "idle", program: p.program };
    const k = { ...a, state: "live", turn: 2, labels: { settled: "1:2" }, ...extra };
    f.agents().push(a);
    f.terminals().push(k);
    return { p, a, k };
  };
  drained.tabs.push({ id: "drained-shell-tab" });
  mixed.tabs.push({ id: "mixed-shell-tab" }, { id: "quiet-shell-tab" });
  f.spaces().push(home, namedHome);
  const settled = agent("settled", "b1");
  const idle = shell("drained-shell", "drained-shell-tab");
  const split = shell("split-shell", "mixed-shell-tab");
  const quiet = shell("quiet", "quiet-shell-tab");
  shell("active-shell", "b0");
  shell("known-home-shell", "home-id");
  shell("named-home-shell", "home-name");
  shell("vite", "mixed-shell-tab");
  shell("unresponsive", "mixed-shell-tab");
  shell("agent-starting", "mixed-shell-tab", { program: f.agents()[0].program });
  const parent = shell("shell-with-child", "mixed-shell-tab");
  agent("unsettled", "mixed-shell-tab", { turn: 3 });
  agent("unconfirmed", "mixed-shell-tab", { labels: {} });
  const workingTree = agent("working-tree", "mixed-shell-tab");
  const blockedTree = agent("blocked-tree", "mixed-shell-tab");
  agent("child", "mixed-shell-tab", { parent: blockedTree.k.address });
  f.terminals().push(
    { address: "working-child", parent: workingTree.k.address, state: "live", status: "working" },
    { address: "blocked-child", parent: blockedTree.k.address, state: "live", status: "blocked" },
    { address: "shell-child", parent: parent.terminal, state: "live", status: "idle" });
  const prompt = { code: 0, stdout: JSON.stringify({ pid: 1, foreground: { pid: 1, name: "zsh" } }) };
  const busy = { code: 0, stdout: JSON.stringify({ pid: 1, foreground: { pid: 2, name: "vite" } }) };
  const answers = new Map([["vite-term", busy], ["unresponsive-term", { code: 1, stdout: "" }]]);
  const response = ([_cmd, addr]) => answers.get(addr) ?? prompt;
  f.answerHc(response);
  return { f, settled, idle, split, quiet, busy, answers, response };
}

async function checkCleanup() {
  {
    const { f } = cleanupFixture(), view = f.navigation(() => f.events.push("prepare"));
    const say = command => view.handle(command, f.cx);
    await say("cleanup");
    assert.equal(f.overlays.length, 1, "ask before closing any terminal");
    const dialog = f.overlays[0];
    assert.equal(dialog.mod, "t3-actions");
    assert.equal(dialog.kind, "dialog");
    // Clean up: settled top-level agents and idle shells in their own shelves; each program still running, a card with its process.
    assert.deepEqual(plain(dialog.props), {
      actions: "clean-up",
      settled: [
        { pane: "settled", terminal: "settled-term", name: "second task", space: "project 1", spaceId: "s1", machine: null, program: f.agents()[0].program },
      ],
      shells: [
        { pane: "drained-shell", terminal: "drained-shell-term", name: "zsh", space: "project 1", spaceId: "s1", machine: null, program: null },
        { pane: "split-shell", terminal: "split-shell-term", name: "zsh", space: "project 2", spaceId: "s2", machine: "vps", program: null },
        { pane: "quiet", terminal: "quiet-term", name: "zsh", space: "project 2", spaceId: "s2", machine: "vps", program: null },
      ],
      // project 2 still has agents at work: its programs are in use, not left behind.
      cards: [],
      command: { name: "t3-tabs.cleanup-now:1" },
    });
    assert.deepEqual(f.calls, [], "the scan leaves all panes open");
    assert.deepEqual(f.labelled.map(args => args[1]).sort(),
      ["drained-shell-term", "quiet-term", "split-shell-term", "unresponsive-term", "vite-term"]);
    await say("cleanup");
    const replaced = closeAnswer(f.overlays[1]);
    await say("close-pane:vite");
    await say(replaced);
    assert.deepEqual(f.calls, [], "a manual close replaces the cleanup answer");
    await say("cleanup");
    assert.deepEqual(f.closed, [1, 2, 3], "cleanup and manual close replace the prior dialog");
    assert.deepEqual(f.events, ["prepare", "open", "prepare", "close", "open", "prepare", "close", "open", "prepare", "close", "open"]);
    await say(closeAnswer(dialog));
    await say(replaced);
    assert.deepEqual(f.calls, [], "a replaced cleanup answer cannot close anything");
    const latest = closeAnswer(f.overlays.at(-1));
    await say(latest);
    assert.deepEqual(f.calls, [
      ["tab.close", { id: "b1", confirmed: true }],
      ["tab.close", { id: "drained-shell-tab", confirmed: true }],
      ["pane.close", { pane: "split-shell" }],
      ["tab.close", { id: "quiet-shell-tab", confirmed: true }],
    ], "close full tabs outright, keep the busy split, and leave no replacement shell");
    await say(latest);
    assert.equal(f.calls.length, 4, "an answer can only be applied once");
  }
  {
    const { f, settled, idle, split, quiet, answers, busy } = cleanupFixture(), view = f.navigation();
    await view.handle("cleanup", f.cx);
    settled.k.turn++;
    answers.set(split.terminal, busy);
    idle.terminal = "replacement";
    f.shown.tab = quiet.tab;
    await view.handle(closeAnswer(f.overlays[0]), f.cx);
    assert.deepEqual(f.calls, [], "spare unsettled, busy, replaced and newly viewed panes");
  }
  {
    const { f, idle, settled, quiet, response } = cleanupFixture();
    let finish;
    const view = f.navigation(undefined, {
      hc: args => finish && args[1] === idle.terminal ? new Promise(resolve => finish = () => resolve(response(args))) : Promise.resolve(response(args)),
    });
    await view.handle("cleanup", f.cx);
    finish = () => {};
    const confirmation = view.handle(closeAnswer(f.overlays[0]), f.cx);
    f.shown.tab = idle.tab;
    settled.a.status = "working";
    f.panes().push({ pane: "new-mod", tab: quiet.tab, mod: "review" });
    finish();
    await confirmation;
    assert.deepEqual(f.calls, [["pane.close", { pane: "split-shell" }], ["pane.close", { pane: "quiet" }]],
      "check focus, agent state and tab membership again after slow shell probes");
  }
  {
    const f = fixture(), view = f.navigation();
    await view.handle("cleanup", f.cx);
    assert.deepEqual([f.calls, f.overlays], [[], []], "close nothing and ask nothing with no eligible panes");
    assert.deepEqual(plain(f.notifications), [{ title: "Nothing to clean up", body: "No idle or left-behind terminals outside this tab.", level: "info" }],
      "a press with nothing in Clean up says so");
  }
  {
    const { f, settled, idle, split, quiet, answers, busy } = cleanupFixture(), view = f.navigation();
    settled.k.turn++;
    for (const p of [idle, split, quiet]) answers.set(p.terminal, busy);
    await view.handle("cleanup", f.cx);
    assert.deepEqual([f.calls, f.overlays], [[], []], "programs in spaces whose agents still work aren't in Clean up");
    assert.equal(f.notifications[0]?.title, "Nothing to clean up");
  }
  {
    // A program is left behind once no agent in its space is active, and never in the space you're in.
    const { f, answers, busy } = cleanupFixture(), view = f.navigation();
    const [current] = f.spaces();
    f.spaces().push({ id: "s3", name: "project 3", machine: null, folder: "/work/p3", tabs: [{ id: "left-tab" }] });
    current.tabs.push({ id: "here-tab" });
    for (const [pane, tab] of [["leftover", "left-tab"], ["here-prog", "here-tab"]]) {
      f.panes().push({ pane, tab, terminal: pane + "-term" });
      answers.set(pane + "-term", busy);
    }
    // The space you're in, even with its agent gone.
    f.agents().splice(0, 1);
    await view.handle("cleanup", f.cx);
    assert.deepEqual(plain(f.overlays[0].props).cards,
      [{ pane: "leftover", name: "vite", space: "project 3", spaceId: "s3", machine: null, program: null, process: "vite" }]);
  }
  {
    // A card's × stops its program at once: Clean up already asked. Alone in its tab, the tab goes with it.
    const { f } = cleanupFixture(), view = f.navigation();
    await view.handle("stop-pane:vite", f.cx);
    await view.handle("stop-pane:quiet", f.cx);
    await view.handle("stop-pane:gone", f.cx);
    assert.deepEqual(f.calls, [["pane.close", { pane: "vite" }], ["tab.close", { id: "quiet-shell-tab", confirmed: true }]]);
    assert.deepEqual(f.overlays, [], "no confirmation");
    f.calls.length = 0;
    await view.handle("go-pane:vite", f.cx);
    assert.deepEqual(f.calls, [["pane.focus", { pane: "vite" }]], "a card goes to its pane");
  }
  {
    // Orphaned/recovered top-level agents whose parent exited act as top-level: cleanable when settled, working when not.
    const f = fixture(), view = f.navigation();
    const program = f.agents()[0].program;
    const busy = { code: 0, stdout: JSON.stringify({ pid: 1, foreground: { pid: 2, name: "vite" } }) };
    f.answerHc(() => busy);
    f.spaces()[0].tabs[0].active = true;
    f.spaces().push(
      { id: "s-orphan-settled", name: "orphan settled", machine: null, folder: "/work/os", tabs: [{ id: "os-agent" }, { id: "os-prog" }] },
      { id: "s-orphan-active", name: "orphan active", machine: null, folder: "/work/oa", tabs: [{ id: "oa-agent" }, { id: "oa-prog" }] },
    );
    f.terminals().push({ address: "dead-parent", state: "exited", status: "idle", program });
    // Settled orphan whose parent exited: cleanable, and its space's running program is Left behind.
    f.panes().push({ pane: "p-os", tab: "os-agent", terminal: "t-os", program }, { pane: "p-os-vite", tab: "os-prog", terminal: "t-os-vite" });
    f.agents().push({ pane: "p-os", tab: "os-agent", address: "t-os", status: "idle", program });
    f.terminals().push({ address: "t-os", parent: "dead-parent", state: "live", status: "idle", turn: 2, labels: { settled: "1:2" }, program });
    // Active orphan whose parent is missing: not cleanable, and marks its space working so its program is not Left behind.
    f.panes().push({ pane: "p-oa", tab: "oa-agent", terminal: "t-oa", program }, { pane: "p-oa-vite", tab: "oa-prog", terminal: "t-oa-vite" });
    f.agents().push({ pane: "p-oa", tab: "oa-agent", address: "t-oa", status: "working", program });
    f.terminals().push({ address: "t-oa", parent: "gone-parent", state: "live", status: "working", turn: 1, labels: {}, program });

    await view.handle("cleanup", f.cx);
    assert.equal(f.overlays.length, 1);
    assert.deepEqual(plain(f.overlays[0].props).settled.map(r => r.pane), ["p-os"], "settled orphaned agent is cleanable");
    assert.deepEqual(plain(f.overlays[0].props).shells, [], "no idle shells");
    assert.deepEqual(plain(f.overlays[0].props).cards.map(c => c.pane), ["p-os-vite"], "unsettled orphaned agent protects its space's running program");
  }
  {
    // A starting non-sub-agent (not yet in agents()) protects its space from Left behind and is never probed as a shell.
    const f = fixture(), view = f.navigation();
    const program = f.agents()[0].program;
    const busy = { code: 0, stdout: JSON.stringify({ pid: 1, foreground: { pid: 2, name: "vite" } }) };
    f.answerHc(() => busy);
    f.spaces()[0].tabs[0].active = true;
    f.spaces().push(
      { id: "s-start-prog", name: "starting program", machine: null, folder: "/work/sp", tabs: [{ id: "sp-ag" }, { id: "sp-vite" }] },
      { id: "s-start-status", name: "starting status", machine: null, folder: "/work/ss", tabs: [{ id: "ss-ag" }, { id: "ss-vite" }] },
      { id: "s-unlisted-settled", name: "unlisted settled", machine: null, folder: "/work/us", tabs: [{ id: "us-ag" }, { id: "us-vite" }] },
    );
    // Starting agent identified by program.agent (no terminal status yet).
    f.panes().push({ pane: "p-sp-ag", tab: "sp-ag", terminal: "t-sp-ag", program }, { pane: "p-sp-vite", tab: "sp-vite", terminal: "t-sp-vite" });
    f.terminals().push({ address: "t-sp-ag", state: "live", program });
    // Starting agent identified by k.status != null (no program.agent yet).
    f.panes().push({ pane: "p-ss-ag", tab: "ss-ag", terminal: "t-ss-ag" }, { pane: "p-ss-vite", tab: "ss-vite", terminal: "t-ss-vite" });
    f.terminals().push({ address: "t-ss-ag", state: "live", status: "working", turn: 1, labels: {} });
    // Agent terminal not in agents() that is already stillSettled does not block Left behind, and is not probed as a shell.
    f.panes().push({ pane: "p-us-ag", tab: "us-ag", terminal: "t-us-ag" }, { pane: "p-us-vite", tab: "us-vite", terminal: "t-us-vite" });
    f.terminals().push({ address: "t-us-ag", state: "live", status: "idle", turn: 2, labels: { settled: "1:2" } });

    await view.handle("cleanup", f.cx);
    assert.deepEqual(plain(f.overlays[0].props).cards.map(c => c.pane), ["p-us-vite"], "starting agents protect their spaces; already-settled unlisted agent does not");
    assert.ok(!f.labelled.some(args => ["t-sp-ag", "t-ss-ag", "t-us-ag"].includes(args[1])), "agent terminals are not probed as shells");
  }
  {
    // Row naming: lone pane in a named tab keeps tab.name; unnamed non-agent falls back to fg.process over raw terminal address,
    // while preserving real titles and program names.
    const f = fixture(), view = f.navigation();
    const prompt = { code: 0, stdout: JSON.stringify({ pid: 1, foreground: { pid: 1, name: "zsh" } }) };
    const node = { code: 0, stdout: JSON.stringify({ pid: 1, foreground: { pid: 2, name: "node" } }) };
    const lazygitProg = { key: "lazygit", name: "lazygit", agent: false };
    const answers = new Map([
      ["t-dev", node], ["t-split-a", node], ["t-split-b", prompt], ["t-titled", node],
      ["t-prog", node], ["t-unresp", { code: 1, stdout: "" }],
    ]);
    f.answerHc(([_cmd, addr]) => answers.get(addr) ?? prompt);
    f.spaces()[0].tabs[0].active = true;
    f.spaces().push({
      id: "s-names", name: "names", machine: null, folder: "/work/n", tabs: [
        { id: "tab-dev", name: "Dev server", named: true },
        { id: "tab-scratch", name: "Scratch", named: true },
        { id: "tab-split", name: "Split tab", named: true },
        { id: "tab-titled" },
        { id: "tab-prog" },
        { id: "tab-unresp" },
      ],
    });
    f.panes().push(
      { pane: "p-dev", tab: "tab-dev", terminal: "t-dev" },
      { pane: "p-scratch", tab: "tab-scratch", terminal: "t-scratch" },
      { pane: "p-split-a", tab: "tab-split", terminal: "t-split-a" },
      { pane: "p-split-b", tab: "tab-split", terminal: "t-split-b" },
      { pane: "p-titled", tab: "tab-titled", terminal: "t-titled", title: "Build watcher" },
      { pane: "p-prog", tab: "tab-prog", terminal: "t-prog", program: lazygitProg },
      { pane: "p-unresp", tab: "tab-unresp", terminal: "t-unresp" },
    );
    await view.handle("cleanup", f.cx);
    const props = plain(f.overlays[0].props);
    assert.deepEqual(props.settled, []);
    assert.deepEqual(Object.fromEntries(props.shells.map(r => [r.pane, r.name])), {
      "p-scratch": "Scratch",
      "p-split-b": "zsh",
    }, "lone named shell tab keeps tab.name; split falls back to fg.process");
    assert.deepEqual(Object.fromEntries(props.cards.map(c => [c.pane, c.name])), {
      "p-dev": "Dev server",
      "p-split-a": "node",
      "p-titled": "Build watcher",
      "p-prog": "lazygit",
      "p-unresp": "t-unresp",
    }, "lone named Action tab keeps tab.name; unnamed preserves title/program, falls back to fg.process, else terminal address");
  }
  {
    // Concurrent cleanup triggers: latest-wins serial guard drops stale slow scans so they don't open or overwrite dialogs.
    const { f, idle, response } = cleanupFixture();
    const gates = [];
    const view = f.navigation(undefined, {
      hc: args => args[1] === idle.terminal
        ? new Promise(resolve => gates.push(() => resolve(response(args))))
        : Promise.resolve(response(args)),
    });
    const first = view.handle("cleanup", f.cx);
    await flush();
    const second = view.handle("cleanup", f.cx);
    await flush();
    assert.equal(gates.length, 2, "two scans in flight");
    // Second finishes first, then stale first finishes after: only the second opens a dialog.
    gates[1]();
    await second;
    assert.equal(f.overlays.length, 1, "latest scan opens its dialog");
    gates[0]();
    await first;
    assert.equal(f.overlays.length, 1, "stale scan finishing later does not open a second dialog");
    assert.equal(f.notifications.length, 0);
  }
  {
    // Scoped cleanup: :settled, :shells, :pane:<pane> and :all share one serial, recheck targets, keep remaining targets alive,
    // and only close a tab when every pane in it is in the confirmed subset.
    const { f } = cleanupFixture(), view = f.navigation();
    // Put an idle shell alongside the settled agent in tab b1 to verify subset closes use pane.close, not tab.close.
    f.panes().push({ pane: "b1-shell", tab: "b1", terminal: "b1-shell-term" });
    await view.handle("cleanup", f.cx);
    const cmd = closeAnswer(f.overlays[0]);
    // Close settled only: b1 still has b1-shell, so settled closes via pane.close; shells remain in cleanupAnswer.
    await view.handle(`${cmd}:settled`, f.cx);
    assert.deepEqual(f.calls.splice(0), [["pane.close", { pane: "settled" }]], ":settled closes only settled panes");
    await view.handle(`${cmd}:settled`, f.cx);
    assert.deepEqual(f.calls, [], ":settled cannot run twice");
    // Remove settled pane from live state as host would.
    f.panes().splice(f.panes().findIndex(p => p.pane === "settled"), 1);
    // Close a single shell pane alone in its tab -> tab.close; and one in a split tab -> pane.close.
    await view.handle(`${cmd}:pane:quiet`, f.cx);
    assert.deepEqual(f.calls.splice(0), [["tab.close", { id: "quiet-shell-tab", confirmed: true }]], ":pane closes a lone pane's tab");
    await view.handle(`${cmd}:pane:quiet`, f.cx);
    assert.deepEqual(f.calls, [], "same pane cannot close twice");
    await view.handle(`${cmd}:pane:split-shell`, f.cx);
    assert.deepEqual(f.calls.splice(0), [["pane.close", { pane: "split-shell" }]], ":pane closes a split pane alone");
    // Remaining shells (drained-shell, b1-shell) close via :shells; b1 is now wholly in the confirmed subset so it closes via tab.close.
    await view.handle(`${cmd}:shells`, f.cx);
    assert.deepEqual(f.calls.splice(0), [
      ["tab.close", { id: "b1", confirmed: true }],
      ["tab.close", { id: "drained-shell-tab", confirmed: true }],
    ], ":shells closes remaining shells and clears cleanupAnswer");
    // Now both groups are exhausted; :all or bare serial does nothing.
    await view.handle(cmd, f.cx);
    await view.handle(`${cmd}:all`, f.cx);
    assert.deepEqual(f.calls, [], "exhausted cleanupAnswer does nothing");
  }
  {
    // :all closes both groups at once; :pane rechecks through scanCleanup (spares newly busy/unsettled/focused panes),
    // and stale serials or replaced dialogs reject all scoped commands.
    const { f, settled, split, quiet, answers, busy } = cleanupFixture(), view = f.navigation();
    await view.handle("cleanup", f.cx);
    const stale = closeAnswer(f.overlays[0]);
    await view.handle("cleanup", f.cx);
    const current = closeAnswer(f.overlays[1]);
    for (const suffix of ["", ":all", ":settled", ":shells", ":pane:quiet"]) await view.handle(`${stale}${suffix}`, f.cx);
    assert.deepEqual(f.calls, [], "stale serial rejects every scoped cleanup command");
    // Make split busy and settled unsettled before :pane and :all.
    answers.set(split.terminal, busy);
    settled.k.turn++;
    await view.handle(`${current}:pane:split-shell`, f.cx);
    await view.handle(`${current}:pane:settled`, f.cx);
    assert.deepEqual(f.calls, [], ":pane rechecks through scanCleanup and spares busy/unsettled panes");
    await view.handle(`${current}:all`, f.cx);
    assert.deepEqual(f.calls.splice(0), [
      ["tab.close", { id: "drained-shell-tab", confirmed: true }],
      ["tab.close", { id: "quiet-shell-tab", confirmed: true }],
    ], ":all closes remaining confirmed targets across both groups");
    assert.ok(quiet, "fixture quiet used");
  }
}

// The floating keys block, main.js over the real navigation; the returned function sends it a command as nextCommand delivers one.
function keysBlock(f, over = {}) {
  const pending = [];
  const scope = vm.createContext({
    ...f, View: class {}, props: () => ({ part: "keys" }), layoutNode: () => null, restorePanel() {},
    nextCommand: () => new Promise(resolve => pending.push(resolve)), ...over,
  });
  vm.runInContext([source, kit.strip(read("pins.js")), kit.strip(read("notice.js")), kit.strip(read("main.js")).replace("export default class", "globalThis.Mod = class")].join("\n"), scope);
  const mod = new scope.Mod();
  mod.init({}, { ...f.cx, focus_handle() {}, spawn: fn => fn(f.cx) });
  const send = async name => { pending.shift()(name); await flush(); };
  send.advance = () => mod.navigation.advance();
  return send;
}

async function checkCleanupDispatch() {
  const { f } = cleanupFixture(), send = keysBlock(f);
  await send("cleanup");
  assert.equal(f.overlays.length, 1, "the keys block dispatches cleanup");
  await send(closeAnswer(f.overlays[0]));
  assert.equal(f.calls[0]?.[0], "tab.close", "the keys block dispatches the confirmation too");
}

// An agent's menu acts on the agent it names (specs/tab-bar.md). At Home every agent is in the background: its Settle and
// Snooze still happen, nothing moves, and Undo jumps only to an agent that was in view when it was put away.
async function checkMenuAtHome() {
  const f = fixture(), [a, far] = f.agents(), [project] = f.spaces();
  const home = { id: "h", machine: null, named: true, name: "Home\u200b", active: false, tabs: [{ id: "hp", active: true }] };
  f.slots.lists = { id: "sidebar-lists", active: "inbox" };
  f.state["t3-tabs.home"] = "h";
  f.spaces().push(home);
  f.panes().push({ pane: "ph", tab: "hp", mod: "t3-home" });
  a.status = far.status = "idle";
  const at = (space) => {
    project.active = space === project; home.active = space === home; a.focused = space === project;
    Object.assign(f.shown, space === home ? { space: "h", tab: "hp", pane: "ph", terminal: null, agent: null } : { space: "s0", tab: "b0", pane: "p0", terminal: "t0", agent: "t0" });
  };
  const send = keysBlock(f), did = () => [f.labelled.splice(0).map(l => l.slice(1).join(" ").replace(/\d{6,}/g, "T")), plain(f.calls.splice(0))];
  at(home);
  await send("settle:t0");
  assert.deepEqual(did(), [["t0 settled=T:0"], []], "Settle in a card's menu at Home settles it, and nothing moves");
  assert.equal(f.state["t3.notice"]?.action, "Settled", "with its Undo");
  await send("undo");
  assert.deepEqual(did(), [["t0 settled="], []], "Undo of one never in view brings it back without going to it");
  await send(`snooze:vps/t2:${Date.now() + 3600000}`);
  assert.deepEqual(did(), [["vps/t2 snoozed=T"], []], "Snooze in the menu at Home, another machine's agent too");
  at(project);
  await send("settle");
  assert.deepEqual(did(), [["t0 settled=T:0"], [["t3-tabs.home", {}]]], "the key puts the agent in view away and goes Home");
  at(home);
  await send("undo");
  assert.deepEqual(did(), [["t0 settled="], [["agent.focus", { terminal: "t0" }]]], "its Undo at Home goes back to it");
}

// Mark unread (t3-tabs.unread:<address>) works even with the sidebar hidden (ADR 0003), stays Inbox-only (ADR 0002),
// and puts an idle agent back to Done in place without switching routes (whether in view or in the background).
async function checkUnread() {
  const setup = () => {
    const f = fixture(), [a, far] = f.agents(), [k, kFar] = f.terminals(), [project, , remote] = f.spaces();
    const home = { id: "h", machine: null, named: true, name: "Home\u200b", active: false, tabs: [{ id: "hp", active: true }] };
    project.tabs[0].active = true;
    remote.tabs[0].active = true;
    f.slots.sidebar = { id: "sidebar", hidden: true };
    f.slots.lists = { id: "sidebar-lists", active: "inbox" };
    f.state["t3-tabs.home"] = "h";
    f.spaces().push(home);
    f.panes().push({ pane: "ph", tab: "hp", mod: "t3-home" });
    Object.assign(a, { status: "idle", focused: false });
    Object.assign(far, { status: "idle", focused: false });
    Object.assign(k, { status: "idle", turn: 2, labels: { "herdr.seen": "2" } });
    Object.assign(kFar, { status: "idle", turn: 3, labels: { "herdr.seen": "3" } });
    const focus = (where) => {
      project.active = where === "t0";
      remote.active = where === "vps/t2";
      home.active = where === "home";
      a.focused = where === "t0";
      far.focused = where === "vps/t2";
      Object.assign(f.shown, where === "home"
        ? { space: "h", tab: "hp", pane: "ph", terminal: null, agent: null }
        : where === "vps/t2"
          ? { space: "s2", tab: "b2", pane: "p2", terminal: "vps/t2", agent: "vps/t2" }
          : { space: "s0", tab: "b0", pane: "p0", terminal: "t0", agent: "t0" });
    };
    focus("home");
    let clock = 1000000;
    const send = keysBlock(f, { Date: { now: () => clock }, terminals: () => [...f.terminals()] });
    const did = () => [f.labelled.splice(0).map(l => l.slice(1).join(" ")), plain(f.calls.splice(0))];
    return { f, a, far, k, kFar, project, remote, home, focus, send, did, now: () => clock, advance: ms => { clock += ms; } };
  };

  // Lists mode and invalid states/turns do nothing.
  {
    const { f, a, k, send, did } = setup();
    f.slots.lists.active = "lists";
    await send("unread:t0");
    assert.deepEqual(did(), [[], []], "Lists mode ignores Mark unread (ADR 0002)");
    f.slots.lists.active = "inbox";

    for (const status of ["working", "blocked", "done"]) {
      a.status = k.status = status;
      await send("unread:t0");
      assert.deepEqual(did(), [[], []], `${status}: ignored`);
    }
    a.status = "idle"; k.status = "error";
    await send("unread:t0");
    assert.deepEqual(did(), [[], []], "own error status counts as blocked: ignored");
    k.status = "idle";
    for (const kidStatus of ["working", "blocked", "error"]) {
      f.terminals().push({ address: "kid", parent: "t0", state: "live", status: kidStatus, labels: {} });
      await send("unread:t0");
      assert.deepEqual(did(), [[], []], `idle with ${kidStatus} sub-agent: ignored`);
      f.terminals().pop();
    }
    k.turn = 0;
    await send("unread:t0");
    assert.deepEqual(did(), [[], []], "turn 0: ignored");
    delete k.turn;
    await send("unread:t0");
    assert.deepEqual(did(), [[], []], "missing turn: ignored");
    await send("unread:missing");
    assert.deepEqual(did(), [[], []], "unknown agent: ignored");
  }

  // Background agent with sidebar hidden: writes herdr.seen directly, clears settled (with KEY.unsettled) and snoozed/Woke.
  {
    const { f, k, kFar, send, did } = setup();
    await send("unread:t0");
    assert.deepEqual(did(), [["t0 herdr.seen=1"], []], "hidden sidebar: background idle agent becomes unread without moving");

    k.labels = { "herdr.seen": "2", settled: "1:2" };
    f.state["t3-tabs.unsettled"] = { gone: 500, t0: 1000000 };
    await send("unread:t0");
    assert.deepEqual(did(), [["t0 herdr.seen=1", "t0 settled="], []], "settled background agent clears settled after herdr.seen");
    assert.deepEqual(plain(f.state["t3-tabs.unsettled"]), { t0: 1000001 }, "KEY.unsettled prunes dead terminals and advances monotonically");

    k.labels = { "herdr.seen": "2", snoozed: String(1000000 + 3600000) };
    await send("unread:t0");
    assert.deepEqual(did(), [["t0 herdr.seen=1", "t0 snoozed="], []], "snoozed background agent clears snoozed");

    k.labels = { "herdr.seen": "2", snoozed: "1" };
    await send("unread:t0");
    assert.deepEqual(did(), [["t0 herdr.seen=1", "t0 snoozed="], []], "Woke background agent clears expired snoozed");

    kFar.labels = { "herdr.seen": "3", settled: "1:3" };
    await send("unread:vps/t2");
    assert.deepEqual(did(), [["vps/t2 herdr.seen=2", "vps/t2 settled="], []], "remote machine background agent works");

    // Failed herdr.seen write stops before touching settled, KEY.unsettled or snoozed.
    k.labels = { "herdr.seen": "2", settled: "1:2", snoozed: "1" };
    f.state["t3-tabs.unsettled"] = { t0: 99 };
    f.answerHc(() => ({ code: 1, stderr: "offline" }));
    await send("unread:t0");
    assert.deepEqual(did(), [["t0 herdr.seen=1"], []], "failed herdr.seen aborts without polluting settled/snoozed");
    assert.deepEqual(plain(f.state["t3-tabs.unsettled"]), { t0: 99 }, "KEY.unsettled unchanged on failure");
  }

  // In-view agent: stays in view (no route change, no timers), writes herdr.seen directly and clears settled/snoozed.
  {
    const { f, k, focus, send, did } = setup();
    f.state["t3.settings"] = { afterAway: "next" };
    f.state["t3-inbox.rows"] = { order: ["t0", "vps/t2"], view: "t0", cards: 2 };
    k.labels = {}; // herdr.seen not echoed on terminal yet
    focus("t0");
    await send("unread:t0");
    assert.deepEqual(did(), [["t0 herdr.seen=1"], []], "in-view agent marks unread in place without navigating Home or to the next card");
    assert.equal(f.timers.length, 0, "no timers needed");

    k.labels = { "herdr.seen": "2", settled: "1:2", snoozed: "1" };
    await send("unread:t0");
    assert.deepEqual(did(), [["t0 herdr.seen=1", "t0 settled=", "t0 snoozed="], []], "in-view settled/snoozed agent clears labels in place");
    assert.ok(f.state["t3-tabs.unsettled"]?.t0 > 0, "KEY.unsettled updated when settled cleared");

    // Failed herdr.seen write stops before touching settled, KEY.unsettled or snoozed.
    const fail = setup();
    fail.k.labels = { "herdr.seen": "2", settled: "1:2", snoozed: "1" };
    fail.focus("t0");
    fail.f.answerHc(() => ({ code: 1, stderr: "boom" }));
    await fail.send("unread:t0");
    assert.deepEqual(fail.did(), [["t0 herdr.seen=1"], []], "failed herdr.seen aborts without touching settled or snoozed");
    assert.equal(fail.f.state["t3-tabs.unsettled"], undefined);
  }
}

// The Details key opens it at once. A maximized panel hides the bar that answers, so only then is it un-maximized and waited for.
async function checkDetailsKey() {
  const f = fixture();
  let wide = false;
  const send = keysBlock(f, { panelState: () => ({ wide }), toggleWide: () => { f.calls.push(["wide"]); } });
  await send("details");
  assert.deepEqual([plain(f.calls.splice(0)), f.timers.length], [[["t3-actions.details", {}]], 0], "nothing to wait for: it opens with the press");
  wide = true;
  await send("details");
  assert.deepEqual(plain(f.calls), [["wide"]], "maximized: the work column comes back first");
  f.timers.pop().fn();
  assert.deepEqual(plain(f.calls), [["wide"], ["t3-actions.details", {}]]);
}

async function check() {
  // One observation reads each of Herdr's lists once (a read copies the whole list), and with no agent snoozed or unread
  // it searches the terminals for none of them.
  {
    const f = fixture(), reads = {};
    let scans = 0;
    const counted = Object.fromEntries(["spaces", "panes", "agents", "terminals"].map(name => [name, () => {
      reads[name] = (reads[name] ?? 0) + 1;
      const list = f[name]();
      return name === "terminals" ? Object.assign([...list], { find(...args) { scans++; return Array.prototype.find.apply(this, args); } }) : list;
    }]));
    f.state["t3-tabs.home"] = "h";
    f.spaces().push({ id: "h", machine: null, named: true, name: "Home\u200b", tabs: [{ id: "hp" }] });
    // A mod's pane has the focus, so who's in view is worked out from the panes.
    f.spaces()[0].tabs[0].active = true; f.agents()[0].focused = false;
    f.panes().push({ pane: "pm", tab: "b0", mod: "review" });
    Object.assign(f.shown, { tab: "b0", pane: "pm", agent: null });
    f.navigation(undefined, counted).advance();
    assert.deepEqual([reads, scans], [{ spaces: 1, panes: 1, agents: 1, terminals: 1 }, 0]);
  }
  // With no space open there is none to put a tab in: New picks one, as at Home.
  {
    const f = fixture(), view = f.navigation();
    f.spaces().splice(0);
    await view.handle("new", f.cx);
    assert.deepEqual(plain(f.calls), [["mod.open", { name: "t3-new-menu" }]]);
  }
  // A tab command can arrive at a new host observation before either Tabs block draws.
  {
    const f = fixture(), view = f.navigation();
    f.spaces()[0].active = false;
    f.spaces().push({ id: "h", machine: null, name: "Home\u200b", named: true, active: true, tabs: [{ id: "home-tab", active: true }] });
    await view.handle("tab:1", f.cx);
    await view.handle("tab-next", f.cx);
    assert.deepEqual(f.calls, [], "tab keys must see the same empty order as the first strip frame at Home");
  }
  // The first confirmation covers the terminals and space consequence the person saw. The same scope can close after the
  // Home landing, even if a terminal has gone away. A larger scope needs a fresh answer.
  const closeRaces = [];
  // Husain's: an agent's tab among others closes in its space with no Home landing first, so only the dialog race is left.
  for (const when of ["dialog"]) {
    for (const change of ["terminal", "last tab"]) {
      const f = fixture(), space = f.spaces()[0], view = f.navigation();
      space.tabs[0].active = true;
      space.tabs.push({ id: "spare" });
      const home = { id: "h", machine: null, named: true, name: "Home\u200b", tabs: [{ id: "shell" }] };
      if (when === "dialog") f.spaces().push(home);
      const say = command => view.handle(command, f.cx);
      const closed = () => f.calls.filter(([name, args]) => name === "tab.close" && args.id === "b0");
      const changeScope = () => change === "terminal"
        ? f.panes().push({ pane: "late", tab: "b0", terminal: "late-terminal", title: "Late" })
        : space.tabs.pop();
      await say("close-tab:b0");
      const original = closeAnswer(f.overlays.pop());
      if (when === "dialog") changeScope();
      let closedOrAsked = false;
      const closing = say(original).then(() => { closedOrAsked = true; });
      await flush();
      if (when === "landing") changeScope();
      // Complete Home if asked for, while the source tab is still waiting to close.
      if (f.calls.some(([name]) => name === "space.new")) {
        f.state["t3.settings"] = { homeMod: null };
        f.spaces().push(home);
        await f.tick();
      }
      try {
        assert.ok(closedOrAsked, `${when}: the answer was handled once Home was ready`);
        await closing;
        assert.deepEqual(closed(), [], `${when}: a new ${change} must not close on the old answer`);
        const updated = f.overlays.pop();
        assert.ok(updated, `${when}: show the new scope`);
        if (change === "terminal") assert.equal(updated.props.title, "Close 2 terminals?");
        else assert.match(updated.props.detail, /space closes too/);
        await say(original);
        assert.deepEqual(closed(), [], "the old answer cannot confirm the replacement dialog");
        const calls = f.labelled.length;
        await say(closeAnswer(updated));
        assert.equal(f.labelled.length, calls, "an unchanged scope needs no additional process checks");
        assert.deepEqual(closed(), [["tab.close", { id: "b0", confirmed: true }]]);
      } catch (e) { closeRaces.push(e); }
    }
  }
  {
    const f = fixture(), view = f.navigation();
    f.panes().push({ pane: "later-exits", tab: "b0", terminal: "other-terminal" });
    await view.handle("close-tab:b0", f.cx);
    const answer = closeAnswer(f.overlays.pop()), probes = f.labelled.length;
    f.panes().pop();
    f.spaces()[0].tabs.push({ id: "spare" });
    await view.handle(answer, f.cx);
    assert.deepEqual(f.calls, [["tab.close", { id: "b0", confirmed: true }]], "fewer terminals and no space closure need no new answer");
    assert.deepEqual([f.overlays.length, f.labelled.length], [0, probes]);
  }

  // A same-named remote Home can appear before the local space creation is reflected in spaces().
  {
    const f = fixture(), view = f.navigation(), spaces = f.spaces();
    view.arrive = id => f.calls.push(["arrive", id, f.state["t3-tabs.home"] === id]);
    const pending = view.handle("home", f.cx);
    await flush();
    const reserved = "Home\u200b";
    spaces.push({ id: "remote-home", machine: "vps", named: true, name: reserved, tabs: [{ id: "remote-shell" }, { id: "remote-page" }] });
    await f.tick();
    try {
      assert.deepEqual([f.state["t3-tabs.home"], f.calls],
        [undefined, [["space.new", { name: reserved, machine: "", folder: "/home/test", focus: false }]]], "the remote Home remains untouched and the local starter stays out of view");
      const local = { id: "local-home", machine: null, named: true, name: reserved, tabs: [{ id: "local-shell" }] };
      spaces.push(local);
      await f.tick();
      assert.equal(f.state["t3-tabs.home"], local.id);
      const adding = ["tab.new", { space: "local-home", name: "Home", mod: "t3-home", focus: false }];
      assert.deepEqual(f.calls.slice(1), [adding], "adding the page does not show Home yet");
      local.tabs.push({ id: "unrelated" }, { id: "local-page", named: true, name: "Home" });
      f.panes().push({ pane: "other", tab: "unrelated", mod: "review" });
      await f.tick();
      assert.deepEqual(f.calls.slice(1), [adding], "neither another mod tab nor a tab without the Home pane is ready to show");
      f.panes().push({ pane: "home", tab: "local-page", mod: "t3-home" });
      await f.tick(); await pending;
      assert.deepEqual(f.calls.slice(1), [adding, ["arrive", "local-home", true], ["tab.select", { id: "local-page" }], ["tab.close", { id: "local-shell", confirmed: true }]]);
    } catch (e) { closeRaces.push(e); }
  }
  if (closeRaces.length) throw new AggregateError(closeRaces, "destructive navigation races");

  // Background creation must not steal focus from a space selected while Home was getting ready.
  {
    const f = fixture(), [source, destination] = f.spaces(), view = f.navigation();
    view.arrive = id => f.calls.push(["arrive", id]);
    const pending = view.handle("home", f.cx);
    const h = { id: "h", machine: null, named: true, name: "Home\u200b", active: false, tabs: [{ id: "starter", active: true }] };
    f.spaces().push(h);
    await f.tick();
    f.calls.length = 0;
    source.active = false;
    destination.active = true;
    h.tabs.push({ id: "page", named: true, name: "Home" });
    f.panes().push({ pane: "ph", tab: "page", mod: "t3-home" });
    await f.tick(); await pending;
    assert.deepEqual(f.calls, [["tab.close", { id: "starter", confirmed: true }]], "keep the later project and remove only the starter");
    assert.equal(f.state["t3-tabs.home"], "h", "the prepared Home is available next time");
  }

  // Closing one split keeps the surviving panes in view, both through T3 and when a program ends itself.
  for (const external of [false, true]) {
    for (const kind of ["shell", "agent", "mod"]) {
      const f = fixture(), view = f.navigation(), tabs = f.spaces()[0].tabs;
      tabs[0].active = true;
      tabs.push({ id: "previous", active: false });
      f.spaces().push({ id: "h", name: "Home\u200b", named: true, machine: null, tabs: [] });
      f.panes().push({ pane: "sibling", tab: "b0", ...(kind === "mod" ? { mod: "review" } : { terminal: "sibling-terminal" }) });
      if (kind === "agent") {
        const sibling = { ...f.agents()[0], address: "sibling-terminal", pane: "sibling", focused: false, status: "done" };
        f.agents().push(sibling); f.terminals().push({ ...sibling, turn: 1, labels: { "herdr.seen": "0" } });
      }
      tabs[0].active = false; tabs[1].active = true; view.frame();
      tabs[0].active = true; tabs[1].active = false;
      Object.assign(f.shown, { tab: "b0", pane: "p0", agent: "t0" });
      view.frame(); f.calls.length = 0;
      if (!external) {
        await view.handle("close-pane-now:p0", f.cx);
        assert.deepEqual(plain(f.calls.splice(0)), [["pane.close", { pane: "p0" }]], "a split closes without selecting Home");
      }
      f.panes().splice(f.panes().findIndex(p => p.pane === "p0"), 1);
      f.agents().splice(0, 1);
      Object.assign(f.shown, { pane: "sibling", agent: kind === "agent" ? "sibling-terminal" : null });
      view.frame();
      assert.deepEqual(f.calls, [], "the next frame keeps the surviving split in view");
      assert.deepEqual(f.labelled, [], "a surviving split was intentionally left in view");
    }
  }

  // Review's tab returns to the preceding tab; its split returns focus to the agent in that tab.
  for (const split of [false, true]) {
    const f = fixture(), view = f.navigation(), tabs = f.spaces()[0].tabs;
    tabs[0].active = true;
    Object.assign(f.shown, { tab: "b0", pane: "p0", agent: "t0" }); view.frame();
    const reviewTab = split ? "b0" : "review";
    if (!split) { tabs[0].active = false; tabs.push({ id: reviewTab, active: true }); }
    f.panes().push({ pane: "pr", tab: reviewTab, mod: "review", terminal: null });
    f.state["review.program"] = { inbox: true };
    Object.assign(f.shown, { tab: reviewTab, pane: "pr" }); view.frame(); f.calls.length = 0;
    await view.handle("close-pane-now:pr", f.cx);
    assert.deepEqual(plain(f.calls), split
      ? [["agent.focus", { terminal: "t0" }], ["pane.close", { pane: "pr" }]]
      : [["tab.select", { id: "b0" }], ["pane.close", { pane: "pr" }]], "Review returns before closing");
    assert.deepEqual(f.labelled, [], "closing Review writes no agent labels");
  }
  // A second navigation gets its own history; keys alone keep it current without asking for a strip model.
  {
    const f = fixture(), first = f.navigation(), tabs = f.spaces()[0].tabs;
    tabs.push({ id: "prog", active: false }); tabs[0].active = true; first.frame();
    tabs[0].active = false; tabs[1].active = true; first.frame();
    const second = f.navigation();
    tabs.pop(); tabs[0].active = true; f.calls.length = 0;
    second.frame(); assert.deepEqual(f.calls, [], "another view cannot inherit a close landing");
    first.frame(); assert.deepEqual(plain(f.calls), [["tab.select", { id: "b0" }]], "the first view keeps its own history");
    const h = { id: "h", machine: null, name: "Home\u200b", named: true, tabs: [] };
    f.spaces().push(h); second.advance();
    assert.equal(f.state["t3-tabs.home"], "h", "the keys-only observation claims Home");
  }
  // Home: a space of its own, in no list, and the keys that walk spaces go around it.
  {
    const f = fixture(), list = f.spaces(), view = f.navigation();
    let pending;
    const say = async command => { pending = view.handle(command, f.cx); await flush(); };
    const made = () => plain(f.calls.splice(0));
    // spaces() catches up after a command: a step waits to see the one before.
    const tick = () => f.tick();
    f.calls.length = 0;
    // Before this computer's layout is read, a Home that exists would read as missing.
    f.machines()[0].layout = "loading";
    await say("home");
    assert.deepEqual(made(), [], "too soon to tell: no second Home");
    f.machines()[0].layout = "ready";
    await say("home");
    assert.deepEqual(made(), [["space.new", { name: "Home\u200b", machine: "", folder: "/home/test", focus: false }]]);
    // A slow core: past 2s it still counts as the Home it asked for, or it'd be an orphan in the lists.
    for (let i = 0; i < 100; i++) await tick();
    assert.equal(f.state["t3-tabs.home"], undefined, "not known until it's seen");
    // In the model's middle: its place doesn't change the keys' count or the spaces' rows.
    const home = { id: "h", name: "Home\u200b", named: true, active: false, machine: null, folder: "/home/test", tabs: [{ id: "shell", name: "1", active: true }] };
    list.splice(1, 0, home);
    await tick();
    assert.equal(f.state["t3-tabs.home"], "h");
    assert.equal(view.atHome, false, "Home's layout isn't applied over the project while waiting");
    assert.deepEqual(made(), [["tab.new", { space: "h", name: "Home", mod: "t3-home", focus: false }]]);
    assert.ok(f.spaces().find(s => s.id === "h").tabs.some(c => c.id === "shell"), "the page goes in before the shell leaves");
    home.tabs.push({ id: "page", named: true, name: "Home", active: false });
    f.panes().push({ pane: "ph", tab: "page", mod: "t3-home" });
    await tick();
    assert.deepEqual(made(), [["tab.select", { id: "page" }], ["tab.close", { id: "shell", confirmed: true }]]);
    home.tabs.shift();
    list[0].active = false; home.active = home.tabs[0].active = true;
    f.panes().pop();
    await say("home");
    assert.deepEqual(made(), [["space.select", { id: "h" }]], "there's one Home");

    await pending;
    assert.deepEqual(plain(view.frame()), { tabs: [], atHome: true, context: null }, "Home has no visible tabs");
    await say("new");
    assert.deepEqual(made(), [["mod.open", { name: "t3-new-menu" }]], "New picks the space");
    // New's pick, a menu's New tab: the space is named, in view or not.
    for (const id of ["h", "gone"]) {
      await say(`new:${id}`);
      assert.deepEqual(made(), [["mod.open", { name: "t3-new-menu" }]], `new:${id}: Home or a space gone takes no tab, New picks`);
    }
    await say("new:s2");
    assert.deepEqual(made(), [["tab.new", { space: "s2", folder: "/work/s2" }]], "from Home, a tab in the space named, where its terminals are");
    f.shown.tab = "page";
    await say("close-tab");
    assert.deepEqual([made(), f.overlays.length], [[], 0], "a key pressed out of habit doesn't close Home");
    const panes = f.panes();
    // Home's last pane stays; a pane split in beside it (Herdr's own keys) closes as any.
    panes.push({ pane: "ph", tab: "page", mod: "t3-home", title: "Home" });
    await say("close-pane:ph");
    assert.deepEqual(made(), [], "Home's last pane stays");
    panes.push({ pane: "pb", tab: "page", terminal: "t9" });
    f.answerHc(() => ({ code: 0, stdout: JSON.stringify({ pid: 1, foreground: { pid: 1, name: "zsh" } }) }));
    await say("close-pane:pb");
    assert.deepEqual(made(), [["pane.close", { pane: "pb" }]]);
    panes.splice(-2);

    // Its last program ending takes the space with it, past the × above: back to a new Home, not wherever Herdr landed.
    {
      const strip = f.navigation();
      strip.frame();
      made();
      list.splice(list.indexOf(home), 1); home.active = false; list[0].active = true;
      strip.frame();
      assert.deepEqual(made(), [["t3-tabs.home", {}]]);
      strip.frame();
      assert.deepEqual(made(), [], "once");
      list[0].active = false; list.splice(1, 0, home); home.active = true;
    }

    // Husain's: space numbers are per-device (leaving Home out), while space-next/prev still walk across all spaces and wrap.
    for (const [command, id] of [["space:1", "s0"], ["space:2", "s1"], ["space-next", "s0"], ["space-prev", "s2"]]) {
      await say(command);
      assert.deepEqual(made(), [["space.select", { id }]], `${command} from Home`);
    }
    await say("space:3");
    assert.deepEqual(made(), [], "past the last local space, nothing (s2 is on vps)");
    home.active = false; list.find(s => s.id === "s2").active = true;
    await say("space:1");
    assert.deepEqual(made(), [["space.select", { id: "s2" }]], "space:1 on vps selects vps's first space");
    await say("space:2");
    assert.deepEqual(made(), [], "past the last vps space, nothing");
    list.find(s => s.id === "s2").active = false; home.active = true;

    // Going Home: the layout takes Home's shape in the same go as the select, before spaces() shows it, and not once left.
    {
      home.active = false; list[0].active = true;
      panes.push({ pane: "ph", tab: "page", mod: "t3-home", title: "Home" });
      view.arrive = id => f.calls.push(["arrive", id]);
      await say("home"); await pending;
      assert.deepEqual(made(), [["arrive", "h"], ["tab.select", { id: "page" }]], "laid out for Home, then shown");
      assert.equal(view.atHome, false, "preparing Home does not change the observed active space");
      home.active = true; list[0].active = false;
      view.advance();
      assert.equal(view.atHome, true);
      home.active = false; list[0].active = true;
      assert.equal(view.atHome, false, "left straight after: not still coming");
      home.active = true; list[0].active = false;
      panes.pop(); delete view.arrive;
    }
    home.active = false; list.find(s => s.id === "s1").active = true;
    await say("space-next");
    assert.deepEqual(made(), [["space.select", { id: "s2" }]]);
    await say("space-prev");
    assert.deepEqual(made(), [["space.select", { id: "s0" }]], "s0, not Home between");
    for (const [from, command, to] of [["s0", "space-prev", "s2"], ["s2", "space-next", "s0"]]) {
      list.forEach(s => { s.active = s.id === from; });
      await say(command);
      assert.deepEqual(made(), [["space.select", { id: to }]], `${command} wraps at ${from}`);
    }
    await say("new");
    assert.deepEqual(made(), [["tab.new", { space: "s2", folder: "/work/s2" }]], "elsewhere New is a tab there, where its terminals are");
  }

  // With the Inbox showing, the bar holds the agent in view and what's around it; the sidebar says what needs the person.
  {
    const f = fixture();
    const program = { key: "pi", name: "Pi", agent: true, tint: true, icon: "icons/pi.svg" };
    const tabs = f.spaces()[0].tabs;
    tabs.splice(0, tabs.length, ...["prog", "other", "mine", "kid", "rev"].map(id => ({ id, name: id, named: true, active: false })));
    const agent = (address, tab, status, parent) => ({ address, pane: `p-${tab}`, tab, space: "s0", space_name: "project 0", title: tab, status, program, parent, state: "live", focused: false });
    const list = [agent("A", "mine", "working"), agent("B", "other", "blocked"), agent("K", "kid", "working", "A")];
    f.agents().splice(0, f.agents().length, ...list);
    f.terminals().splice(0, f.terminals().length, ...list);
    f.panes().splice(0, f.panes().length, ...list.map(a => ({ ...a, terminal: a.address })),
      { pane: "p-prog", terminal: "sh", tab: "prog", title: "lazygit" }, { pane: "p-rev", terminal: null, mod: "review", tab: "rev", title: "review" });
    const view = f.navigation(), say = command => view.handle(command, f.cx);
    const taken = () => plain(f.calls.splice(0));
    const pick = (id, address) => { tabs.forEach(c => { c.active = c.id === id; }); list.forEach(a => { a.focused = a.address === address; }); f.shown.agent = address ?? null; };
    const shown = () => plain(view.frame().tabs.map(c => c.id));
    f.slots.lists = { id: "sidebar-lists", active: "inbox" };
    pick("mine", "A");
    assert.deepEqual(shown(), ["mine", "kid", "prog", "rev"]);
    pick("prog");
    assert.deepEqual(shown(), ["mine", "kid", "prog", "rev"], "gone to a tool's tab from the bar, the agent last looked at stays: the tool is its work's");
    pick("kid", "K");
    assert.deepEqual(shown(), ["mine", "kid", "prog", "rev"], "a sub-agent counts as the agent at its top");
    pick("other", "B");
    assert.deepEqual(shown(), ["other", "prog", "rev"], "another agent takes the place");
    pick("prog");
    assert.deepEqual(shown(), ["other", "prog", "rev"]);

    // Keys go by what's shown, around the ends; Lists keeps Herdr's own.
    pick("mine", "A"); view.frame(); taken();
    await say("tab:3");
    assert.deepEqual(taken(), [["tab.select", { id: "prog" }]], "the third shown, not the third of the space");
    await say("tab:9");
    assert.deepEqual(taken(), [], "past the end, nothing");
    await say("tab-prev");
    assert.deepEqual(taken(), [["tab.select", { id: "rev" }]], "round the start");
    await say("tab-next");
    assert.deepEqual(taken(), [["tab.select", { id: "kid" }]], "the other agent's tab between them is skipped");
    f.slots.lists.active = "lists"; view.frame(); taken();
    await say("tab:3");
    assert.deepEqual(taken(), [["tab.select", { id: "mine" }]], "in Lists, the third of the space");
    await say("tab-next");
    assert.deepEqual(taken(), [["tab.select", { id: "kid" }]]);
    f.slots.lists.active = "inbox";

  }

  // The Inbox's bar names who's in view, the lit card: a tab's agents side by side, the one last looked at held while a program
  // has the focus, a sub-agent under its parent. Everything comes from the frame; the one memory is checked against it.
  {
    const f = fixture();
    const program = { key: "pi", name: "Pi", agent: true, tint: true, icon: "icons/pi.svg" };
    const tabs = f.spaces()[0].tabs;
    tabs.splice(0, tabs.length, ...["mine", "kid", "prog"].map(id => ({ id, name: id, named: true, active: false })));
    const agent = (address, tab, parent) => ({ address, pane: `p-${address}`, tab, space: "s0", space_name: "project 0", title: address, status: "idle", program, parent, state: "live", focused: false });
    const list = [agent("A", "mine"), agent("C", "mine"), agent("K", "kid", "A")];
    f.agents().splice(0, Infinity, ...list);
    f.terminals().splice(0, Infinity, ...list.map(a => ({ ...a })));
    f.panes().splice(0, Infinity, ...list.map(a => ({ ...a, terminal: a.address })),
      { pane: "p-git", terminal: "git", tab: "mine", title: "lazygit" }, { pane: "p-prog", terminal: "sh", tab: "prog", title: "vite" });
    f.slots.lists = { id: "sidebar-lists", active: "inbox" };
    let view = f.navigation();
    const at = (tab, pane) => {
      tabs.forEach(c => { c.active = c.id === tab; });
      const p = f.panes().find(p => p.pane === pane);
      f.agents().forEach(a => { a.focused = a.pane === pane; });
      Object.assign(f.shown, { tab, pane, terminal: p.terminal, agent: null });
      const c = view.frame().context;
      return c && plain({ ...c, space: c.space.id, kin: c.kin.map(t => t.id), programs: c.programs.map(t => t.id) });
    };
    const who = (heads, head, more = {}) => ({ space: "s0", tab: "mine", parent: null, heads, head, sub: null, held: false, away: false, kin: ["kid"], programs: ["prog"], ...more });

    assert.deepEqual(at("mine", "p-A"), who(["A", "C"], "A"), "a tab's agents are side by side; the focused one is in view");
    assert.deepEqual(at("mine", "p-C"), who(["A", "C"], "C", { kin: [] }), "focusing the other moves which is in view, and the family is its own");
    assert.deepEqual(at("mine", "p-git"), who(["A", "C"], "C", { held: true, kin: [] }), "a program beside them holds the one last looked at");
    assert.deepEqual(at("prog", "p-prog"), who(["A", "C"], "C", { held: true, away: true, kin: [] }), "a tool's tab: the agent last looked at stays, away");
    assert.deepEqual(at("kid", "p-K"), who(["K"], "K", { tab: "kid", parent: "A", kin: [] }), "a sub-agent's own tab: its parent leads back");

    // A sub-agent split beside its parent isn't a peer: it shows under the one it belongs to.
    const k2 = agent("K2", "mine", "C");
    f.agents().push(k2); f.terminals().push({ ...k2 }); f.panes().push({ ...k2, terminal: "K2" });
    assert.deepEqual(at("mine", "p-K2"), who(["A", "C"], "C", { sub: "K2", kin: [] }), "its family is C's, which has no other tab");

    // The one held ends: the tab's first stands for it. Its parent ending leaves a sub-agent at the top.
    at("mine", "p-C");
    for (const l of [f.agents(), f.terminals(), f.panes()]) l.splice(l.findIndex(x => x.address === "C"), 1);
    assert.deepEqual(at("mine", "p-git"), who(["A", "K2"], "A", { held: true }), "a gone agent isn't held");
    f.terminals().find(k => k.address === "A").state = "exited";
    f.agents().splice(f.agents().findIndex(a => a.address === "A"), 1);
    assert.deepEqual(at("kid", "p-K"), who(["K"], "K", { tab: "kid", kin: [] }), "with its parent gone, a sub-agent has none to lead back to");

    // After a restart nothing is remembered: the tab's first agent is held.
    f.terminals().find(k => k.address === "A").state = "live";
    f.agents().unshift(list[0]);
    view = f.navigation();
    assert.deepEqual(at("mine", "p-git"), who(["A", "K2"], "A", { held: true }));
    // Lists has its own bar.
    f.slots.lists.active = "lists";
    assert.equal(at("mine", "p-A"), null);
  }

  // Starting something new in the space (cmd-t) leaves the agent behind: tabs with no agent read as the space alone, gone to by
  // the bar or not, until an agent is looked at again.
  {
    const command = "new";
    const f = fixture(), tabs = f.spaces()[0].tabs, view = f.navigation();
    tabs.splice(0, Infinity, ...["mine", "prog", "fresh"].map(id => ({ id, name: id, named: true, active: id === "mine" })));
    f.agents()[0].tab = "mine"; f.panes()[0].tab = "mine";
    f.panes().splice(1, Infinity, { pane: "p-prog", tab: "prog", terminal: "t-prog" }, { pane: "p-fresh", tab: "fresh", terminal: "t-fresh" });
    f.slots.lists = { id: "sidebar-lists", active: "inbox" };
    f.answerHc(() => ({ code: 0, stdout: JSON.stringify({ pid: 1, foreground: { pid: 1, name: "zsh" } }) }));
    const show = (id, agent) => { tabs.forEach(c => { c.active = c.id === id; }); f.agents()[0].focused = Boolean(agent); Object.assign(f.shown, { tab: id, agent: agent ?? null }); return view.frame().context; };
    show("mine", "t0");
    assert.equal(show("prog").head, "t0", "a tool's tab: still the agent's");
    await view.handle(command, f.cx);
    assert.deepEqual([show("fresh").head, show("prog").head], [null, null], `${command}: the space alone, the tools' tabs too`);
    show("mine", "t0");
    assert.equal(show("prog").head, "t0", "looking at an agent again picks it back up");

    // Started from elsewhere (New's pick at Home or in another space, a space's menu): the same, as the space is named.
    const [here, other] = f.spaces(), go = (to) => { here.active = to === here; other.active = to === other; };
    go(other); f.agents()[0].focused = false; Object.assign(f.shown, { tab: "b1", agent: null });
    view.frame(); f.calls.length = 0;
    await view.handle("new:s0", f.cx);
    assert.deepEqual(plain(f.calls), [["tab.new", { space: "s0", folder: "/work/s0" }]], "new:<space>: a tab there");
    view.frame();
    go(here);
    assert.deepEqual([show("fresh").head, show("prog").head], [null, null], "new:<space>: that space alone, once there");
    show("mine", "t0");
    assert.equal(show("prog").head, "t0");
  }

  {
    // A person's close asks when it ends terminals, as T3's; only the dialog's command closes.
    const f = fixture();
    f.spaces().splice(0, Infinity,
      { id: "s", active: true, tabs: [{ id: "a", name: "Alpha", named: true, active: true }, { id: "b", name: "Beta", named: true }] },
      { id: "solo", tabs: [{ id: "c", name: "Solo", named: true }] });
    f.panes().splice(0, Infinity, { pane: "p1", tab: "a", terminal: "t1" }, { pane: "p2", tab: "a", terminal: "t2" },
      { pane: "m", tab: "b", mod: "board" }, { pane: "p4", tab: "c", terminal: "t4" });
    Object.assign(f.shown, { tab: "a", pane: "p1" });
    const view = f.navigation(() => f.events.push("prepare"));
    const say = command => view.handle(command, f.cx);
    // What `hc get` says: its own shell at the prompt, a program it started, a program that is the terminal, or no answer.
    const shell = { pid: 1, foreground: { pid: 1, name: "zsh" } }, program = { pid: 1, foreground: { pid: 2, name: "sleep" } }, own = { pid: 1, foreground: { pid: 1, name: "sleep" } };
    let fg = () => program;
    f.answerHc(args => ({ code: 0, stdout: JSON.stringify(fg(args[1])) }));
    f.calls.length = 0;
    await say("close-tab");
    let asked = f.overlays.pop();
    assert.deepEqual([asked.mod, asked.frame, asked.props.actions, asked.props.title, asked.props.yes], ["t3-actions", "none", "confirm", "Close 2 terminals?", "Close"], "as T3's: what ends, counted; the button says it");
    assert.match(asked.props.detail, /^This stops their running processes and clears their histories: ".+", ".+"\.$/);
    assert.doesNotMatch(asked.props.detail, /space closes/);
    await say(closeAnswer(asked));
    assert.deepEqual(f.calls.pop(), ["tab.close", { id: "a", confirmed: true }], "so the space's own ask can't follow");
    await say("close-pane");
    assert.deepEqual(f.closed.length, 1, "a second ask replaces the first");
    asked = f.overlays.pop();
    assert.deepEqual(plain(asked.props.command), { name: "t3-tabs.close-pane-now:p1" });
    await say("close-pane-now:p1");
    assert.deepEqual(f.calls.pop(), ["pane.close", { pane: "p1" }]);
    await say("close-pane:p2");
    assert.deepEqual(plain(f.overlays.pop().props.command), { name: "t3-tabs.close-pane-now:p2" }, "the pane header's × names its pane");
    assert.deepEqual(f.calls, [], "nothing closes before the answer");
    await say("close-tab");
    f.overlays.pop();
    assert.deepEqual(f.events.slice(-3), ["prepare", "close", "open"], "prepare the dialog before replacing the previous one");
    Object.assign(f.shown, { tab: "c", pane: "p4" });
    await say("close-tab");
    asked = f.overlays.pop();
    assert.equal(asked.props.title, 'Close terminal "Solo"?', "a lone pane by its tab's name, as T3's");
    assert.match(asked.props.detail, /^This stops the running process.*space closes too/, "the last tab says its space goes too");
    assert.equal(f.overlays.length, 0);
    f.spaces()[1].tabs[0].name = "x".repeat(41);
    await say("close-tab");
    assert.equal(f.overlays.pop().props.title, `Close terminal "${"x".repeat(41)}"?`, "a long name stays whole: the title wraps, as T3's");
    Object.assign(f.shown, { tab: "b", pane: "m" });
    await say("close-tab");
    assert.deepEqual(f.calls.pop(), ["tab.close", { id: "b" }], "a tab of mods has no terminal to lose");
    await say("close-pane");
    assert.deepEqual(f.calls.pop(), ["pane.close", { pane: "m" }], "nor has a mod's pane");
    await say("close-pane:p4");
    assert.deepEqual(f.calls.pop(), ["pane.close", { pane: "p4" }], "a space's last pane closes the space, which Herdr asks about itself");
    assert.equal(f.overlays.length, 0);
    // Empty panes have nothing to lose: nothing asks, and the same goes for a tab of them.
    f.calls.length = 0;
    fg = () => shell;
    await say("close-pane:p1");
    assert.deepEqual(f.calls.pop(), ["pane.close", { pane: "p1" }], "a shell at its prompt closes at once");
    await say("close-tab:a");
    assert.deepEqual(f.calls.pop(), ["tab.close", { id: "a" }], "and so does a tab of them");
    assert.equal(f.overlays.length, 0);
    fg = t => t === "t1" ? program : shell;
    await say("close-tab:a");
    assert.equal(f.overlays.pop().props.title.startsWith("Close terminal "), true, "only what's running counts");
    fg = () => own;
    await say("close-pane:p1");
    assert.ok(f.overlays.pop().props.command.name.startsWith("t3-tabs.close-pane-now:"), "a program that is the terminal is no prompt");
    fg = () => { throw new Error("no answer"); };
    await say("close-pane:p1");
    assert.ok(f.overlays.pop().props.command.name.startsWith("t3-tabs.close-pane-now:"), "no answer asks");
    Object.assign(f.shown, { tab: undefined, pane: undefined });
    f.calls.length = 0;
    await say("close-tab"); await say("close-pane");
    assert.deepEqual([f.calls, f.overlays.length], [[], 0], "with nothing focused, nothing to close");
  }

  // Another window on the core finds Home by its own name, and nothing that only looks like it.
  {
    const f = fixture(), list = f.spaces(), tabs = f.navigation();
    const place = (id, name, extra) => list.push({ id, name, named: true, active: false, machine: null, tabs: [], ...extra });
    place("mine", "Home");
    place("plain", "Home\u200b", { named: false });
    place("far", "Home\u200b", { machine: "kvm" });
    tabs.frame();
    assert.equal(f.state["t3-tabs.home"], undefined, "a space someone calls Home, an unnamed one, another machine's: none is this Home");
    place("h", "Home\u200b");
    tabs.frame();
    assert.equal(f.state["t3-tabs.home"], "h");
    f.state["t3-tabs.home"] = "mine"; f.calls.length = 0;
    tabs.frame(); tabs.frame();
    assert.deepEqual(plain(f.calls.filter(([name]) => name === "space.rename")), [["space.rename", { id: "mine", name: "Home\u200b" }]], "a Home made before gets the name, once");
    assert.equal(f.state["t3-tabs.home"], "mine", "the Home it knows stays");
  }

  // A focus or a zoom this mod didn't go ahead of (a toast, hc, the zoom button): the later of the two wins, once, and what the stale zoom showed gets its done back.
  {
    const f = fixture(), program = { key: "pi", name: "Pi", agent: true, tint: true, icon: "icons/pi.svg" };
    const tabs = f.spaces()[0].tabs;
    tabs.splice(0, tabs.length, ...["away", "two"].map(id => ({ id, name: id, named: true, active: false })));
    const list = [["E", "away", "idle"], ["Z", "two", "done"], ["Y", "two", "idle"]].map(([address, tab, status]) => ({ address, pane: `p${address}`, tab, space: "s0", space_name: "project 0", title: tab, status, program, state: "live", focused: false, turn: 1, labels: { "herdr.seen": "0" } }));
    f.agents().splice(0, f.agents().length, ...list);
    f.terminals().splice(0, f.terminals().length, ...list);
    f.panes().splice(0, f.panes().length, ...list.map(a => ({ ...a, terminal: a.address })));
    f.slots["sidebar-lists"] = { id: "sidebar-lists", active: "inbox" };
    const view = f.navigation(), zooms = () => f.calls.filter(([name]) => ["pane.zoom", "pane.focus"].includes(name));
    const frame = (tab, on, zoomed) => {
      tabs.forEach(c => { c.active = c.id === tab; });
      f.panes().forEach(p => { p.focused = p.pane === `p${on}`; p.zoomed = p.pane === `p${zoomed}`; });
      f.agents().forEach(a => { a.focused = a.address === on; });
      f.shown.agent = on; view.frame();
    };
    frame("away", "E", "Z");
    assert.deepEqual(zooms(), [], "a zoom in a tab out of view asks nothing");
    // The stale frame shows Z, and in the focus's own step Herdr marks it seen.
    list[1].status = "idle"; list[1].labels["herdr.seen"] = "1";
    frame("two", "Y", "Z");
    assert.deepEqual(zooms(), [["pane.zoom", { pane: "pY" }]], "the focus moved: the zoom follows");
    frame("two", "Y", "Z");
    assert.equal(zooms().length, 1, "once: a repeat would toggle it off");
    assert.deepEqual(f.labelled, [], "still on screen: nothing yet");
    frame("two", "Y", "Y");
    assert.deepEqual(f.labelled.map(a => a.join(" ")), ["label Z herdr.seen=0"], "zoomed away from is out of view: its done is back");
    f.calls.length = 0;
    frame("two", "Y", "Z");
    assert.deepEqual(zooms(), [["pane.focus", { pane: "pZ" }]], "the zoom moved, the focus didn't: the focus follows");
    f.calls.length = 0;
    frame("two", "Z", "Z");
    assert.deepEqual(zooms(), [], "agreeing, nothing to do");
  }


  // A close this mod can't go ahead of (the program ending, a menu's Close): Herdr showed its pick and marked it seen, so an agent
  // that was unread a frame before gets its done back once it's out of view, Herdr's own Mark unread.
  {
    const f = fixture(), program = { key: "pi", name: "Pi", agent: true, tint: true, icon: "icons/pi.svg" };
    const tabs = f.spaces()[0].tabs;
    let view;
    const setup = () => {
      tabs.splice(0, tabs.length, ...["prog", "mine", "next"].map(id => ({ id, name: id, named: true, active: false })));
      const list = [["A", "mine", "idle"], ["N", "next", "done"]].map(([address, tab, status]) => ({ address, pane: `p-${tab}`, tab, space: "s0", space_name: "project 0", title: tab, status, program, state: "live", focused: false, turn: 1, labels: { "herdr.seen": "0" } }));
      f.agents().splice(0, f.agents().length, ...list);
      f.terminals().splice(0, f.terminals().length, ...list);
      f.panes().splice(0, f.panes().length, ...list.map(a => ({ ...a, terminal: a.address })));
      f.labelled.splice(0); f.calls.splice(0);
      view = f.navigation();
      return list;
    };
    const pick = (id, address) => { tabs.forEach(c => { c.active = c.id === id; }); f.agents().forEach(a => { a.focused = a.address === address; }); f.shown.agent = address ?? null; view.frame(); };
    // Herdr's pick: the tab goes, its right neighbour shows and, the window active, is seen.
    const exit = (id, to) => { const n = f.agents().find(a => a.tab === to); tabs.splice(tabs.findIndex(c => c.id === id), 1); f.agents().splice(f.agents().findIndex(a => a.tab === id), 1); if (n) { n.status = "idle"; n.labels["herdr.seen"] = "1"; } pick(to, n?.address); };
    const labels = () => f.labelled.map(a => a.join(" "));
    f.slots["sidebar-lists"] = { id: "sidebar-lists", active: "inbox" };

    setup();
    pick("mine", "A"); exit("mine", "next");
    tabs.pop(); // The temporary neighbour also closes before Home shows; only the floating keys copy is left.
    tabs.find(c => c.id === "prog").active = true;
    f.shown.agent = null;
    view.advance(); view.advance();
    // Husain's: still in its space with no tab before it to go back to, it stays where Herdr put it, not Home.
    assert.deepEqual(f.calls, [], "the temporary neighbour wasn't a second visit or a reason to go Home");
    assert.deepEqual(labels(), ["label N herdr.seen=0"], "keys alone repay the unread turn when the neighbour leaves view");

    let [, n] = setup();
    pick("mine", "A"); exit("mine", "next");
    assert.deepEqual(labels(), [], "nothing while it's still on screen");
    pick("prog");
    assert.deepEqual(labels(), ["label N herdr.seen=0"], "out of view, its done is back");
    pick("prog");
    assert.deepEqual(labels(), ["label N herdr.seen=0"], "once");

    [, n] = setup(); n.labels.snoozed = "1";
    pick("mine", "A"); exit("mine", "next"); delete n.labels.snoozed; pick("prog");
    assert.deepEqual(labels(), ["label N herdr.seen=0", "label N snoozed=1"], "a woken snooze the showing cleared comes back too");

    [, n] = setup(); n.labels.snoozed = "1";
    pick("mine", "A"); exit("mine", "next"); pick("prog");
    assert.deepEqual(labels(), ["label N herdr.seen=0"], "the snooze's clearing not back yet: it waits");
    delete n.labels.snoozed; pick("prog");
    assert.deepEqual(labels(), ["label N herdr.seen=0", "label N snoozed=1"]);

    [, n] = setup();
    pick("mine", "A"); exit("mine", "next"); n.labels["herdr.seen"] = "0"; pick("prog");
    assert.deepEqual(labels(), [], "its seen not back from the core yet: the lower write would land first, so it waits");
    n.labels["herdr.seen"] = "1"; pick("prog");
    assert.deepEqual(labels(), ["label N herdr.seen=0"]);

    [, n] = setup();
    pick("mine", "A"); exit("mine", "next");
    pick("next", "N"); f.advance(3001); pick("next", "N"); pick("prog");
    assert.deepEqual(labels(), [], "staying on it, it was seen after all");

    [, n] = setup();
    pick("mine", "A"); exit("mine", "next");
    f.advance(3000); pick("next", "N"); pick("prog");
    assert.deepEqual(labels(), ["label N herdr.seen=0"], "the debt still belongs to the unread turn at exactly three seconds");


    await new Promise(setImmediate);
    const pending = [];
    f.answerHc(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
    [, n] = setup(); n.labels.snoozed = "1";
    pick("mine", "A"); exit("mine", "next"); delete n.labels.snoozed; pick("prog");
    assert.equal(pending.length, 2, "the unread done and Woke both start repayment");
    pick("prog"); pick("prog");
    assert.equal(pending.length, 2, "each label has at most one request in flight across frames");
    pending[0].resolve({ code: 1, stderr: "offline" }); pending[1].reject(new Error("disconnected"));
    await new Promise(setImmediate);
    assert.equal(pending.length, 2, "failed writes wait for the next frame before retrying");
    assert.deepEqual(f.notifications.map(n => n.body), ["offline", "Error: disconnected"], "both failures use writeLabel's visible error path");
    pick("prog");
    assert.equal(pending.length, 4, "a later frame retries both labels");
    pending[2].resolve({ code: 1, stderr: "still offline" }); pending[3].reject(new Error("still disconnected"));
    await new Promise(setImmediate);
    assert.equal(f.notifications.length, 2, "repeated repayment failures do not repeat either error toast");
    pick("prog");
    assert.equal(pending.length, 6, "both labels keep retrying after a repeated failure");
    pending[4].resolve({ code: 0 }); pending[5].resolve({ code: 0 });
    await new Promise(setImmediate);
    pick("prog");
    assert.deepEqual(labels(), Array.from({ length: 3 }, () => ["label N herdr.seen=0", "label N snoozed=1"]).flat(), "each retry keeps the original unread turn and snooze");
    assert.equal(pending.length, 6, "success stops retries");
  }


  // Closing a tab with no agent goes back where the person was, not to the neighbour Herdr picks, which isn't somewhere they went.
  {
    const f = fixture(), program = { key: "pi", name: "Pi", agent: true, tint: true, icon: "icons/pi.svg" };
    const tabs = f.spaces()[0].tabs;
    tabs.splice(0, tabs.length, ...["mine", "prog", "new", "other"].map(id => ({ id, name: id, named: true, active: false })));
    const list = [["A", "mine"], ["B", "other"]].map(([address, tab]) => ({ address, pane: `p-${tab}`, tab, space: "s0", space_name: "project 0", title: tab, status: "idle", program, state: "live", focused: false }));
    f.agents().splice(0, f.agents().length, ...list);
    f.terminals().splice(0, f.terminals().length, ...list);
    f.panes().splice(0, f.panes().length, ...list.map(a => ({ ...a, terminal: a.address })));
    f.slots["sidebar-lists"] = { id: "sidebar-lists", active: "inbox" };
    const view = f.navigation();
    const taken = () => JSON.parse(JSON.stringify(f.calls.splice(0)));
    const pick = (id, address) => { tabs.forEach(c => { c.active = c.id === id; }); list.forEach(a => { a.focused = a.address === address; }); f.shown.agent = address ?? null; view.frame(); };
    const shown = () => plain(view.frame().tabs.map(c => c.id));
    const gone = (id) => tabs.splice(tabs.findIndex(c => c.id === id), 1);

    pick("mine", "A"); pick("new"); taken();
    gone("new"); pick("prog");
    assert.deepEqual(taken(), [["tab.select", { id: "mine" }]], "opened from the agent, closed: back to the agent");
    pick("mine", "A"); taken();

    tabs.splice(2, 0, { id: "new", name: "new", named: true, active: false });
    pick("prog"); pick("new"); taken();
    gone("new"); pick("other", "B");
    assert.deepEqual(taken(), [["tab.select", { id: "prog" }]], "the neighbour's an agent: still back to where they were");
    assert.deepEqual(shown(), ["mine", "prog"], "and while it goes, the neighbour doesn't take the bar's place");
    pick("prog"); taken();
    assert.deepEqual(shown(), ["mine", "prog"], "the agent the bar holds is still the one they last looked at");

    // A close this mod makes goes first, so Herdr's neighbour is never shown: that would cost an agent its unread done.
    {
      const closer = f.navigation();
      const say = command => closer.handle(command, f.cx);
      const see = (id, address) => { tabs.forEach(c => { c.active = c.id === id; }); list.forEach(a => { a.focused = a.address === address; }); f.shown.agent = address ?? null; closer.frame(); };
      tabs.splice(2, 0, { id: "new", name: "new", named: true, active: false });
      f.panes().push({ pane: "p-new", terminal: null, mod: "x", tab: "new", title: "x" });
      see("mine", "A"); see("new"); taken();
      await say("close-tab:new");
      assert.deepEqual(taken(), [["tab.select", { id: "mine" }], ["tab.close", { id: "new" }]], "back first, then the close");
      await say("close-pane:p-new");
      assert.deepEqual(taken(), [["tab.select", { id: "mine" }], ["pane.close", { pane: "p-new" }]], "a tab's lone pane too");
      see("prog"); taken();
      await say("close-tab:new");
      assert.deepEqual(taken(), [["tab.close", { id: "new" }]], "out of view, closing it moves nothing");
      f.state["t3-tabs.home"] = "h"; f.spaces().push({ id: "h", name: "Home\u200b", machine: null, active: false, tabs: [{ id: "hp", name: "Home" }] });
      see("mine", "A"); taken();
      await say("close-tab:mine");
      await say(closeAnswer(f.overlays.pop()));
      assert.deepEqual(taken(), [["tab.select", { id: "new" }], ["tab.close", { id: "mine", confirmed: true }]], "the agent in view: back in its space first, then the close (Husain's)");
      see("mine", "A"); taken();
      const all = tabs.splice(0, tabs.length, ...tabs.filter(c => c.id === "mine"));
      await say("close-tab:mine");
      await say(closeAnswer(f.overlays.pop()));
      assert.deepEqual(taken(), [["space.select", { id: "h" }], ["tab.close", { id: "mine", confirmed: true }]], "its space's last tab too: Herdr would show another space's");
      tabs.splice(0, tabs.length, ...all);
      // Herdr moved the space's own active tab to the closed one's neighbour, out of sight: a key back mustn't show it, which would cost it its unread done.
      see("prog"); see("mine", "A"); taken();
      f.spaces()[0].active = false; f.spaces().at(-1).active = true; closer.frame();
      tabs.forEach(c => { c.active = c.id === "other"; });
      await say("space:1");
      assert.deepEqual(taken(), [["tab.select", { id: "mine" }]], "back to the tab last shown there, without its active tab showing on the way");
      await say("space-next");
      assert.deepEqual(taken(), [["tab.select", { id: "mine" }]], "walking there too");
      f.spaces()[0].active = true; f.spaces().at(-1).active = false;
      f.spaces().pop(); delete f.state["t3-tabs.home"]; f.panes().pop(); gone("new");
    }

    // Nowhere to go back to, as after a restart: Herdr's pick stands.
    const fresh = f.navigation();
    fresh.frame(); taken();
    gone("prog"); tabs.forEach(c => { c.active = c.id === "mine"; }); fresh.frame();
    assert.deepEqual(taken(), [], "no memory, no jump");
  }


  // The agent in view closed by what this mod doesn't make (its menu, its program ending): the neighbour Herdr shows for a frame isn't somewhere the person went.
  {
    const f = fixture(), program = { key: "pi", name: "Pi", agent: true, tint: true, icon: "icons/pi.svg" };
    const tabs = f.spaces()[0].tabs;
    tabs.splice(0, tabs.length, ...["was", "mine", "next", "prog"].map(id => ({ id, name: id, named: true, active: false })));
    const list = [["W", "was"], ["A", "mine"], ["N", "next"]].map(([address, tab]) => ({ address, pane: `p-${tab}`, tab, space: "s0", space_name: "project 0", title: tab, status: "idle", program, state: "live", focused: false }));
    f.agents().splice(0, f.agents().length, ...list);
    f.terminals().splice(0, f.terminals().length, ...list);
    f.panes().splice(0, f.panes().length, ...list.map(a => ({ ...a, terminal: a.address })));
    f.slots["sidebar-lists"] = { id: "sidebar-lists", active: "inbox" };
    const view = f.navigation();
    const pick = (id, address) => { tabs.forEach(c => { c.active = c.id === id; }); list.forEach(a => { a.focused = a.address === address; }); f.shown.agent = address ?? null; view.frame(); };
    pick("was", "W"); pick("mine", "A"); f.calls.length = 0;
    tabs.splice(tabs.findIndex(c => c.id === "mine"), 1); f.agents().splice(f.agents().findIndex(a => a.address === "A"), 1);
    pick("next", "N");
    assert.deepEqual(plain(f.calls.splice(0)), [["tab.select", { id: "was" }]], "back to the tab before, not Home (Husain's, in the Inbox too)");
    pick("prog");
    assert.deepEqual(plain(view.frame().tabs.map(c => c.id)), ["was", "prog"], "the agent last looked at is still the one the bar holds, not Herdr's pick of a neighbour");
  }

  // In Lists, the agent in view closed goes back where the person was, as any tab: landing on Home is the Inbox's.
  for (const external of [true, false]) {
    const f = fixture(), program = { key: "pi", name: "Pi", agent: true, tint: true, icon: "icons/pi.svg" };
    const tabs = f.spaces()[0].tabs;
    tabs.splice(0, tabs.length, ...["was", "mine", "next"].map(id => ({ id, name: id, named: true, active: false })));
    const list = [["W", "was"], ["A", "mine"], ["N", "next"]].map(([address, tab]) => ({ address, pane: `p-${tab}`, tab, space: "s0", space_name: "project 0", title: tab, status: "idle", program, state: "live", focused: false }));
    f.agents().splice(0, f.agents().length, ...list);
    f.terminals().splice(0, f.terminals().length, ...list);
    f.panes().splice(0, f.panes().length, ...list.map(a => ({ ...a, terminal: a.address })));
    f.slots["sidebar-lists"] = { id: "sidebar-lists", active: "lists" };
    f.state["t3-tabs.home"] = "h"; f.spaces().push({ id: "h", name: "Home\u200b", named: true, machine: null, active: false, tabs: [{ id: "hp", name: "Home" }] });
    const view = f.navigation();
    const pick = (id, address) => { tabs.forEach(c => { c.active = c.id === id; }); list.forEach(a => { a.focused = a.address === address; }); f.shown.agent = address ?? null; view.frame(); };
    pick("was", "W"); pick("mine", "A"); f.calls.length = 0;
    if (external) {
      tabs.splice(tabs.findIndex(c => c.id === "mine"), 1); f.agents().splice(f.agents().findIndex(a => a.address === "A"), 1);
      pick("next", "N");
      assert.deepEqual(plain(f.calls.splice(0)), [["tab.select", { id: "was" }]], "Lists: a program ending goes back, not Home");
    } else {
      await view.handle("close-tab:mine", f.cx);
      await view.handle(closeAnswer(f.overlays.pop()), f.cx);
      assert.deepEqual(plain(f.calls.splice(0)), [["tab.select", { id: "was" }], ["tab.close", { id: "mine", confirmed: true }]], "Lists: back first, then the close");
    }
  }

  // A snooze ends on a failure in its tree or a new turn given in view, in either sidebar, though the Inbox copy hasn't started.
  {
    const f = fixture(), [a] = f.agents(), [k] = f.terminals(), view = f.navigation();
    const snoozes = () => f.labelled.filter(l => l[2].startsWith("snoozed=")).map(l => l.join(" "));
    f.slots["sidebar-lists"] = { id: "sidebar-lists", active: "lists" };
    Object.assign(a, { status: "idle" }); k.labels = { snoozed: String(Date.now() + 3600000) };
    view.frame();
    a.status = "working"; view.frame();
    assert.deepEqual(snoozes(), ["label t0 snoozed="], "put to work in view: the snooze ends");
    view.frame();
    assert.equal(snoozes().length, 1, "once while the label comes back");

    const g = fixture(), [b] = g.agents(), [kb] = g.terminals(), quiet = g.navigation();
    const said = () => g.labelled.filter(l => l[2].startsWith("snoozed=")).length;
    b.status = "idle"; b.focused = false; kb.labels = { snoozed: String(Date.now() + 3600000) };
    quiet.frame(); b.status = "working"; quiet.frame();
    assert.equal(said(), 0, "work out of view isn't the person's: it stays snoozed");
    kb.status = "error"; quiet.frame();
    assert.equal(said(), 1, "a failure ends it");

    // A peek at its sub-agent is it in view, as in the Inbox: the work given there ends the parent's snooze.
    const h = fixture(), [p] = h.agents(), [kp] = h.terminals(), peek = h.navigation();
    p.status = "idle"; p.focused = false; kp.labels = { snoozed: String(Date.now() + 3600000) };
    const kid = { address: "kid", parent: "t0", state: "live", status: "idle", program: p.program };
    h.terminals().push(kid); Object.assign(h.shown, { agent: "kid", pane: undefined, terminal: undefined });
    peek.frame(); kid.status = "working"; peek.frame();
    assert.deepEqual(h.labelled.filter(l => l[2].startsWith("snoozed=")).map(l => l.join(" ")), ["label t0 snoozed="], "peeked at: the snooze ends");
  }
  // The layout's settings (t3.settings): a dialog of t3-chrome's, opened by the key this bar answers; one at a time.
  {
    const f = fixture(), view = f.navigation();
    await view.handle("settings", f.cx);
    assert.deepEqual(plain(f.overlays), [{ mod: "t3-chrome", kind: "dialog", width: 880, props: { view: "settings" } }]);
    await view.handle("settings", f.cx);
    assert.deepEqual([f.closed, f.overlays.length], [[1], 2], "pressed again, it replaces the open one");
  }

  // The Home preference picks the first visible tab, whether a custom mod or the Terminal.
  for (const mod of ["review", null]) {
    const f = fixture(), list = f.spaces(), view = f.navigation();
    f.state["t3.settings"] = { homeMod: mod };
    const pending = view.handle("home", f.cx); await flush();
    assert.deepEqual(plain(f.calls.splice(0)), [["space.new", { name: "Home\u200b", machine: "", folder: "/home/test", focus: false }]]);
    const h = { id: "h", name: "Home\u200b", named: true, active: false, machine: null, folder: "/home/test", tabs: [{ id: "shell", name: "1", active: true }] };
    list.push(h);
    view.arrive = id => f.calls.push(["arrive", id, f.state["t3-tabs.home"] === id]);
    await f.tick();
    if (mod) {
      assert.deepEqual(plain(f.calls.splice(0)), [["tab.new", { space: "h", name: "Home", mod: "review", focus: false }]]);
      h.tabs.push({ id: "page", named: true, name: "Home" });
      f.panes().push({ pane: "pr", tab: "page", mod: "review" });
      await f.tick();
      assert.deepEqual(plain(f.calls.splice(0)), [["arrive", "h", true], ["tab.select", { id: "page" }], ["tab.close", { id: "shell", confirmed: true }]]);
    } else {
      assert.deepEqual(plain(f.calls.splice(0)), [["arrive", "h", true], ["tab.select", { id: "shell" }]], "Terminal is selected directly and kept");
    }
    await pending;
    if (mod) {
      h.tabs.shift();
      await view.handle("close-pane:pr", f.cx);
      assert.deepEqual(f.calls, [], "Home's mod stays");
    }
  }

  // Home is one thing alone: its own tab, a lone pane that's the setting's mod or, set so, a shell. Another mod there, or an
  // idle shell when a mod is wanted, gives way to it; a busy shell keeps its tab and Home gets a new one.
  {
    const f = fixture(), ps = f.panes(), list = f.spaces(), every = f.agents();
    f.state["t3-tabs.home"] = "h";
    const home = { id: "h", name: "Home\u200b", named: true, machine: null, tabs: [] };
    list.push(home);
    let n = 0, busy = false;
    const tabOf = (pane) => ps.find(p => p.pane === pane)?.tab;
    // Herdr, as far as Home needs it: a new tab, a split, a close.
    const run = (name, args = {}) => {
      f.run(name, args);
      const extra = args.mod ? { mod: args.mod } : { terminal: `tn${++n}` };
      if (name === "tab.new") { const id = `new${++n}`; home.tabs.push({ id }); ps.push({ pane: `pn${n}`, tab: id, ...extra }); }
      if (name === "pane.split") ps.push({ pane: `px${++n}`, tab: tabOf(args.pane), ...extra });
      if (name === "pane.close") ps.splice(ps.findIndex(p => p.pane === args.pane), 1);
    };
    const hc = () => Promise.resolve({ code: 0, stdout: JSON.stringify({ pid: 1, foreground: busy ? { pid: 2, name: "lazygit" } : { pid: 1, name: "zsh" } }) });
    const view = f.navigation(undefined, { run, hc });
    // A step waits to see the one before: time moves until the command is through.
    const say = async (command, mod, panes, tabs = [...new Set(panes.map(p => p.tab))]) => {
      ps.splice(2, Infinity, ...panes.map(p => ({ ...p }))); home.tabs = tabs.map(id => ({ id })); f.calls.length = 0;
      f.state["t3.settings"] = { homeMod: mod };
      let done = false;
      const pending = view.handle(command, f.cx).then(() => { done = true; });
      for (let i = 0; i < 40 && !done; i++) { await flush(); if (!done && f.timers.length) f.timers.pop().fn(); }
      await pending;
      return plain(f.calls);
    };
    const page = { pane: "ph", tab: "ht", mod: "t3-home" }, shell = { pane: "ps", tab: "ht", terminal: "t9" };
    assert.deepEqual(await say("home", "t3-home", [page]), [["tab.select", { id: "ht" }]]);
    assert.deepEqual(await say("home-mod", "review", [page]), [["pane.split", { direction: "right", pane: "ph", mod: "review" }], ["pane.close", { pane: "ph" }]], "a change shows at once, staying where you are");
    assert.deepEqual(await say("home-mod", null, [page]), [["pane.split", { direction: "right", pane: "ph" }], ["pane.close", { pane: "ph" }]]);
    assert.deepEqual(await say("home", "review", [page]), [["pane.split", { direction: "right", pane: "ph", mod: "review" }], ["pane.close", { pane: "ph" }], ["tab.select", { id: "ht" }]], "the setting changed");
    assert.deepEqual(await say("home", "t3-home", [shell]), [["pane.split", { direction: "right", pane: "ps", mod: "t3-home" }], ["pane.close", { pane: "ps" }], ["tab.select", { id: "ht" }]], "an idle shell gives way");
    busy = true;
    assert.deepEqual(await say("home", "t3-home", [shell]), [["tab.new", { space: "h", name: "Home", folder: "/home/test", mod: "t3-home" }]], "a program running stays; a new tab shows itself");
    busy = false;
    // Home as a terminal: the page gives way to a shell, a new tab of it has the home folder, and the shell stays.
    assert.deepEqual(await say("home", null, [page]), [["pane.split", { direction: "right", pane: "ph" }], ["pane.close", { pane: "ph" }], ["tab.select", { id: "ht" }]]);
    assert.deepEqual(await say("home", null, [shell]), [["tab.select", { id: "ht" }]]);

    // An agent started in Home turns it into an ordinary space where it is, renamed for its folder: nothing moves or parks.
    // Its old name doesn't make it Home again before the rename shows; going Home makes a new one.
    {
      const strip = f.navigation(undefined, { run });
      list.forEach(s => { s.active = s.id === "h"; });
      ps.splice(2, Infinity, { pane: "pq", tab: "ht", terminal: "t6" }); home.tabs = [{ id: "ht", active: true, named: true, name: "Home" }]; every.push({ address: "t6", tab: "ht", status: "working" });
      f.calls.length = 0; strip.frame(); strip.frame();
      assert.deepEqual(plain(f.calls), [["space.rename", { id: "h", name: "" }], ["tab.rename", { id: "ht", name: "" }]], "once, and the view stays; the tab's Home name goes too");
      assert.equal(f.state["t3-tabs.home"], null);
      assert.equal(strip.frame().atHome, false, "an ordinary space now: its tabs show");
      f.calls.length = 0;
      strip.handle("home", f.cx); await flush();
      assert.deepEqual(plain(f.calls), [["space.new", { name: "Home\u200b", machine: "", folder: "/home/test", focus: false }]], "a new Home");
      every.pop();
    }
  }

  // Settled with the key, the agent in view gives way to the Inbox's next card, going around, if the person chose that;
  // the rows say which are cards. No card left, or Home chosen: the caller goes Home.
  {
    const f = fixture(), view = f.navigation();
    const as = (fn) => { f.calls.length = 0; fn(); return plain(f.calls.splice(0)); };
    f.state["t3-inbox.rows"] = { order: ["A", "pane:pm", "S"], view: "A", cards: 2 };
    assert.deepEqual([view.nextCard("A"), f.calls], [false, []], "Home by default");
    f.state["t3.settings"] = { afterAway: "next" };
    assert.deepEqual(as(() => assert.equal(view.nextCard("A"), true)), as(() => f.focusPane("pm")));
    assert.deepEqual(as(() => assert.equal(view.nextCard("pane:pm"), true)), as(() => f.focusAgent("A")), "from the last, the first");
    f.state["t3-inbox.rows"] = { order: ["A", "S"], view: "A", cards: 1 };
    assert.deepEqual([view.nextCard("A"), f.calls], [false, []], "a settled row isn't a card");
  }
}

// Opening a new tab in a local space checks its current folder first; missing folders warn instead of failing cryptically,
// while remote spaces and checking() never probe local disk.
async function checkNewTabMissingFolder() {
  {
    // Local active space (`new`) whose live cwd under home() no longer exists: warn with ~, no tab.new, and don't mark space fresh.
    const f = fixture(), probed = [];
    const tabs = f.spaces()[0].tabs;
    tabs.splice(0, Infinity, { id: "mine", name: "mine", named: true, active: true }, { id: "prog", name: "prog", named: true, active: false });
    f.agents()[0].tab = "mine";
    f.panes()[0].tab = "mine";
    f.panes()[0].cwd = "/home/test/vanished";
    f.panes().push({ pane: "p-prog", tab: "prog", terminal: "t-prog" });
    f.slots.lists = { id: "sidebar-lists", active: "inbox" };
    const view = f.navigation(undefined, { folderExists: async (p) => { probed.push(p); return false; } });
    const show = (id, agent) => {
      tabs.forEach(c => { c.active = c.id === id; });
      f.agents()[0].focused = Boolean(agent);
      Object.assign(f.shown, { tab: id, agent: agent ?? null });
      return view.frame().context;
    };
    show("mine", "t0");
    assert.equal(show("prog").head, "t0");
    await view.handle("new", f.cx);
    assert.deepEqual(probed, ["/home/test/vanished"]);
    assert.deepEqual(f.calls, [], "missing local folder does not run tab.new");
    assert.deepEqual(plain(f.notifications), [{
      title: "Folder not found",
      body: "~/vanished no longer exists on this computer.",
      level: "warning",
    }]);
    assert.equal(show("prog").head, "t0", "failed new tab does not mark space as fresh");
  }
  {
    // Local named space (`new:s1`) whose creation folder outside home() is missing, plus home boundary check (`/home/test-other`).
    const f = fixture(), probed = [];
    const view = f.navigation(undefined, { folderExists: async (p) => { probed.push(p); return false; } });
    await view.handle("new:s1", f.cx);
    assert.deepEqual(probed, ["/work/p1"]);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(plain(f.notifications.splice(0)), [{
      title: "Folder not found",
      body: "/work/p1 no longer exists on this computer.",
      level: "warning",
    }]);
    f.spaces()[1].folder = "/home/test-other/proj";
    await view.handle("new:s1", f.cx);
    assert.deepEqual(plain(f.notifications.splice(0)), [{
      title: "Folder not found",
      body: "/home/test-other/proj no longer exists on this computer.",
      level: "warning",
    }], "home prefix shortening requires a path separator boundary");
    f.spaces()[1].folder = "/home/test";
    await view.handle("new:s1", f.cx);
    assert.deepEqual(plain(f.notifications.splice(0)), [{
      title: "Folder not found",
      body: "~ no longer exists on this computer.",
      level: "warning",
    }], "exact home folder shortens to ~");
  }
  {
    // Remote spaces (`new` and `new:s2`) never probe local disk and always open the tab.
    const f = fixture(), probed = [];
    f.spaces()[0].active = false;
    f.spaces()[2].active = true;
    const view = f.navigation(undefined, { folderExists: async (p) => { probed.push(p); return false; } });
    await view.handle("new", f.cx);
    await view.handle("new:s2", f.cx);
    assert.deepEqual(probed, [], "remote spaces are never probed locally");
    assert.deepEqual(plain(f.calls), [
      ["tab.new", { space: "s2", folder: "/work/s2" }],
      ["tab.new", { space: "s2", folder: "/work/s2" }],
    ]);
    assert.deepEqual(f.notifications, []);
  }
  {
    // checking() skips folder probing.
    const f = fixture(), probed = [];
    const view = f.navigation(undefined, { checking: () => true, folderExists: async (p) => { probed.push(p); return false; } });
    await view.handle("new", f.cx);
    assert.deepEqual(probed, []);
    assert.deepEqual(plain(f.calls), [["tab.new", { space: "s0", folder: "/work/s0" }]]);
  }
  {
    // Real folderExists via keysBlock + exec: code 1 warns, code 0 opens, thrown exec fails open.
    const f = fixture();
    let mode = "missing";
    const send = keysBlock(f, {
      exec: async (cmd, args) => {
        assert.equal(cmd, "sh");
        assert.equal(args[3], "/work/s0");
        if (mode === "throw") throw new Error("sh unavailable");
        return { code: mode === "missing" ? 1 : 0, stdout: "", stderr: "" };
      },
    });
    await send("new");
    assert.deepEqual(f.calls, [], "exec exit 1 blocks tab.new");
    assert.deepEqual(plain(f.notifications.splice(0)), [{
      title: "Folder not found",
      body: "/work/s0 no longer exists on this computer.",
      level: "warning",
    }]);
    mode = "ok";
    await send("new");
    assert.deepEqual(plain(f.calls.splice(0)), [["tab.new", { space: "s0", folder: "/work/s0" }]]);
    mode = "throw";
    await send("new");
    assert.deepEqual(plain(f.calls.splice(0)), [["tab.new", { space: "s0", folder: "/work/s0" }]], "exec error fails open");
    assert.deepEqual(f.notifications, []);
  }
}

async function checkPruningAndLinearScans() {
  // 1. Prune dead space/terminal entries (trail, fresh, released, waking).
  {
    const f = fixture(), view = f.navigation();
    const s1 = f.spaces()[1];
    s1.tabs = [{ id: "b1", active: false }, { id: "b1_alt", active: true }];
    f.spaces()[0].active = false;
    s1.active = true;
    view.advance(); // records b1_alt in trail.s1

    // Remove s1 so trail.s1 is pruned, then re-add s1 with b1 active and b1_alt inactive.
    s1.active = false;
    f.spaces()[0].active = true;
    const savedS1 = f.spaces().splice(1, 1)[0];
    view.advance();
    savedS1.tabs = [{ id: "b1", active: true }, { id: "b1_alt", active: false }];
    f.spaces().splice(1, 0, savedS1);
    view.advance();
    f.calls.length = 0;
    await view.handle("space:2", f.cx);
    assert.deepEqual(f.calls, [["space.select", { id: "s1" }]], "pruned trail does not select stale tab after space closes and returns");
  }

  {
    // fresh: closing a space prunes its fresh entry so returning with the same id can use trail again.
    const f = fixture(), view = f.navigation();
    f.slots.lists = { id: "sidebar-lists", active: "inbox" };
    const s1 = f.spaces()[1];
    s1.tabs = [{ id: "b1_agent", active: false }, { id: "b1_shell", active: true }];
    f.agents().push({ address: "t1", pane: "p1", space: "s1", space_name: "project 1", tab: "b1_agent", title: "A1", program: f.agents()[0].program, focused: false, status: "idle" });
    f.terminals().push({ address: "t1", pane: "p1", space: "s1", tab: "b1_agent", state: "live", status: "idle" });
    f.panes().push({ pane: "p1", tab: "b1_agent", terminal: "t1" });
    await view.handle("new:s1", f.cx); // marks s1 fresh
    f.spaces().splice(1, 1);
    view.advance(); // prunes s1 from fresh
    f.spaces().splice(1, 0, { id: "s1", name: "project 1", active: true, folder: "/work/p1", machine: null, tabs: [{ id: "b1_agent", active: true }, { id: "b1_shell", active: false }] });
    f.spaces()[0].active = false;
    view.advance(); // records b1_agent in trail.s1 (while focused() is still elsewhere, so looked is null)
    f.spaces()[1].tabs[0].active = false;
    f.spaces()[1].tabs[1].active = true;
    assert.equal(view.frame().context.tab, "b1_agent", "pruned fresh no longer blocks falling back to trail");
  }

  {
    // released: closing a released Home space prunes its id so a re-created Home with the same id is recognized.
    const f = fixture(), view = f.navigation();
    const homeSpace = { id: "h", machine: null, named: true, name: "Home\u200b", active: false, tabs: [{ id: "ht", active: true }] };
    f.state["t3-tabs.home"] = "h";
    f.spaces().push(homeSpace);
    f.agents().push({ address: "th", pane: "ph", space: "h", tab: "ht", status: "idle" });
    view.advance(); // releases h
    assert.equal(f.state["t3-tabs.home"], null);
    f.agents().pop();
    f.spaces().pop();
    view.advance(); // prunes h from released
    f.spaces().push({ id: "h", machine: null, named: true, name: "Home\u200b", active: false, tabs: [] });
    view.advance();
    assert.equal(f.state["t3-tabs.home"], "h", "pruned released id allows Home recognition again");
  }

  {
    // waking: removing a terminal prunes its 10s waking cooldown so a new terminal with the same address wakes immediately.
    const f = fixture(), view = f.navigation();
    const t0 = f.terminals()[0];
    t0.status = "error";
    t0.labels = { snoozed: String(Date.now() + 60000) };
    view.advance();
    assert.equal(f.labelled.length, 1);
    f.labelled.length = 0;
    const removed = f.terminals().shift();
    view.advance(); // prunes t0 from waking
    f.advance(1000);
    removed.labels = { snoozed: String(Date.now() + 60000) };
    f.terminals().unshift(removed);
    view.advance();
    assert.equal(f.labelled.length, 1, "pruned waking entry does not suppress error wake within 10s");
  }

  // 2. No O(agents * terminals) or O(spaces * tabs) quadratic scans in advance().
  {
    const N = 120;
    const baseSpaces = Array.from({ length: N }, (_, i) => ({
      id: `s${i}`, name: `sp${i}`, active: i === 0, folder: `/work/${i}`, machine: null,
      tabs: [{ id: `b${i}`, name: `t${i}`, named: true, active: true }],
    }));
    const baseAgents = Array.from({ length: N }, (_, i) => ({
      address: `a${i}`, pane: `p${i}`, space: `s${i}`, tab: `b${i}`, status: "done", focused: i === 0,
    }));
    const baseTerms = Array.from({ length: N }, (_, i) => ({
      address: `a${i}`, state: "live", status: "done", turn: 1, labels: {},
    }));
    const basePanes = Array.from({ length: N }, (_, i) => ({
      pane: `p${i}`, tab: `b${i}`, terminal: `a${i}`, cwd: `/work/${i}`,
    }));
    let termReads = 0;
    const countReads = (arr, onRead) => new Proxy(arr, {
      get(target, prop, receiver) {
        if (typeof prop === "string" && /^\d+$/.test(prop)) onRead();
        return Reflect.get(target, prop, receiver);
      },
    });
    const f = fixture();
    const view = f.navigation(undefined, {
      spaces: () => baseSpaces,
      agents: () => baseAgents,
      terminals: () => countReads(baseTerms, () => { termReads++; }),
      panes: () => basePanes,
      focused: () => ({ space: "s0", tab: "b0", pane: "p0", terminal: "a0", agent: "a0" }),
    });
    view.advance();
    // With O(N) Map indexing, termReads is O(N) (~1000-2000), far below O(N^2) (> 14400 * 2).
    assert.ok(termReads < N * 20, `expected linear terminal reads for N=${N}, got ${termReads}`);
  }
}

(async () => {
  const additions = { bookmarks: checkBookmarks, cleanup: checkCleanup, dispatch: checkCleanupDispatch, menu: checkMenuAtHome, unread: checkUnread, details: checkDetailsKey, missingFolder: checkNewTabMissingFolder, pruningAndLinear: checkPruningAndLinearScans };
  if (process.argv[2]) { await additions[process.argv[2]](); return; }
  for (const verify of Object.values(additions)) await verify();
  await check();
  twice = true;
  await check();
  console.log("ok: navigation, project bookmarks, cleanup and the keys block's menu and Details commands; the navigation history checks also tracked twice a frame.");
})().catch(e => { console.error(e); process.exit(1); });
