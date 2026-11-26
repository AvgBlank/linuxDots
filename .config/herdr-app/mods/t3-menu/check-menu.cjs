// Loads the menu in a fake `herdr`: a tab's and a pane's Close go through the tab bar; the rest is Herdr's own; its list moves as every popup's.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// An element that keeps what it's given: its id, children, handlers and style.
function el() {
  const node = { items: [], handlers: {}, style: {} };
  const proxy = new Proxy(node, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      if (key === "when") { if (args[0]) args[1](proxy); }
      else if (key === "child") node.items.push(args[0]);
      else if (key === "children") node.items.push(...args[0]);
      else if (key === "id") node.key = args[0];
      else if (key === "on_mouse_down" || key === "on_mouse_up" || key === "on_action") {
        const at = `${key}:${args[0]}`, was = node.handlers[at], now = args[1];
        node.handlers[at] = was ? (...e) => { was(...e); return now(...e); } : now;
      }
      else if (key.startsWith("on_")) node.handlers[key] = args[0];
      else node.style[key] = args.length === 1 ? args[0] : args;
      return proxy;
    };
  } });
  return proxy;
}
const find = (node, id) => !node || typeof node !== "object" ? null : node.key === id ? node : node.items.map((c) => find(c, id)).find(Boolean) ?? null;
const rowAt = (tree, i) => tree.items[i]?.items.at(-1);
const rowNamed = (node, label) => !node || typeof node !== "object" ? null
  : node.style.accessibility_label === label ? node : node.items.map((n) => rowNamed(n, label)).find(Boolean) ?? null;
const theme = { selected: "#selected", hover: "#hover", foreground: "#fg", muted: "#muted", dim: "#dim", border: "#border", popover: "#pop", working: "#blue", blocked: "#amber", done: "#green", accent: "#accent", ansi1: "#red" };
let target = {}, calls = [], closed = [], state = {}, list = "inbox", opened = 0, zoom = 1, view = { width: 1200, height: 800 }, mouse = { x: 0, y: 0 };
let terms = [{ address: "t1", labels: {} }], agentList = [], keyList = [];
let spaceList = [{ id: "s1", active: true, folder: "/work/p1", tabs: [{ id: "b1" }] }];
let paneList = [{ pane: "p1", tab: "b1", terminal: "t1", cwd: "/work/s1" }];
let focusState = {}, keyReads = 0;
let now = Date.now();
// tip.js's keyLabel, as on a Mac: what every key hint in the layout is written with.
const tipScope = vm.createContext({ window: () => ({ platform: "macos" }), keys: () => keyList });
vm.runInContext(fs.readFileSync(path.join(__dirname, "tip.js"), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "") + "\nglobalThis.keyLabel = keyLabel;", tipScope);
// button.js in a scope of its own: its tint() and project.js's share a name in one bundle.
const buttonScope = vm.createContext({ div: el, h_flex: el, svg: (path) => { const n = el(); n.style.path = path; return n; }, glow: () => () => {}, alpha: (c) => c });
vm.runInContext(fs.readFileSync(path.join(__dirname, "button.js"), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "") + "\nglobalThis.ghostButton = ghostButton; globalThis.DISABLED = DISABLED;", buttonScope);
// closeOverlay runs what a closed t3-menu's close() does with the registry (popup-menu.js menuClosed), as Herdr calls close().
const context = vm.createContext({
  Date: class extends Date { static now() { return now; } },
  checking: () => false,
  // menu-row.js's: button.js's and tip.js's (no row here is disabled).
  DISABLED: buttonScope.DISABLED, ghostButton: (...a) => buttonScope.ghostButton(...a), glow: () => () => {}, tip: (_v, _t, _id, _label, el) => el,
  View: class {}, div: el, svg: (path) => { const n = el(); n.style.path = path; return n; }, image: (path) => { const n = el(); n.style.path = path; return n; }, v_flex: el, h_flex: el,
  run: (name, args) => calls.push(args === undefined ? [name] : [name, args]), props: () => target, closeOverlay: (id) => { closed.push(id); context.menuClosed?.(id); }, openOverlay: (spec) => { calls.push(["overlay", spec]); return `o${++opened}`; },
  window: { viewport_size: () => view, mouse_position: () => mouse },
  theme: () => theme, keys: () => { keyReads++; return keyList; }, settings: () => ({ zoom }), terminals: () => [...terms], agents: () => [...agentList], spaces: () => spaceList, panes: () => paneList, focused: () => focusState, exec: async () => ({ code: 1 }),
  shared: (k) => state[k], setShared: (k, v) => { state[k] = v; }, hc: async () => ({ code: 0 }), notify() {},
  layout: () => ({ id: "root", children: [{ id: "sidebar-lists", active: list, children: [] }] }),
  keyLabel: (k) => tipScope.keyLabel(k),
});
const src = ["store.js", "color.js", "labels.js", "pins.js", "tree.js", "sidebar.js", "space-arrival.js", "name.js", "program.js", "status-mark.js", "zoom.js", "list.js", "menu-row.js", "snooze-presets.js", "submenu.js", "popup-menu.js", "main.js"].map((f) => fs.readFileSync(path.join(__dirname, f), "utf8")).join("\n")
  .replace(/^import .*;\r?\n/gm, "").replace("export default class", "globalThis.Menu = class").replace(/^export /gm, "");
vm.runInContext(src, context);
// Timers run when the test says time has passed.
let pending = [];
const schedule = (ms, f, repeat) => {
  const t = { at: now + ms, f, cancel() { pending = pending.filter((x) => x !== t); }, repeat };
  pending.push(t);
  return t;
};
const timer = { after: (ms, f) => schedule(ms, f, 0), every: (ms, f) => schedule(ms, f, ms) };
let notifications = 0;
const cx = { notify() { notifications++; }, stop_propagation() {}, spawn() {}, timer, focus_handle: () => { const h = { focused: 0, focus() { h.focused++; } }; return h; } };
const elapse = (ms) => {
  now += ms;
  for (const t of [...pending]) {
    if (!pending.includes(t) || t.at > now) continue;
    if (t.repeat) t.at = now + t.repeat; else t.cancel();
    t.f(cx);
  }
};
const choose = (props, label) => {
  target = props; calls = [];
  const menu = new context.Menu(); menu.init(props, cx);
  rowNamed(menu.render(), label)?.handlers.on_click({}, { ...cx, write_to_clipboard: (text) => calls.push(["clipboard", text]) });
  return JSON.parse(JSON.stringify(calls));
};

assert.deepEqual(choose({ tab: "tab", target: { id: "b1", space: "s1" } }, "Close"), [["t3-tabs.close-tab:b1"]], "a tab's Close asks and leaves first");
assert.deepEqual(choose({ tab: "pane", target: { pane: "p1", terminal: "t1" } }, "Close pane"), [["t3-tabs.close-pane:p1"]], "so does a pane's");
assert.deepEqual(choose({ tab: "pane", target: { pane: "p1", terminal: "t1" } }, "Copy address"), [["clipboard", "t1"]], "Copy address puts the terminal's address on the clipboard");
assert.ok(!vm.runInContext("items", context)({ tab: "pane", target: { pane: "p1" } }, null).some((it) => it[0] === "Copy address"), "a mod pane has no address to copy");
const block = vm.runInContext("items", context)({ tab: "pane", target: { pane: "block", terminal: "t1" } }, null).map((it) => it[0]);
assert.ok(block.includes("Copy address") && !["Split right", "Split down", "Zoom pane", "Close pane"].some((l) => block.includes(l)), "a terminal outside a tab has no pane to split, zoom or close");
assert.deepEqual(choose({ tab: "tab", target: { id: "b1", space: "s1" } }, "Rename"), [["tab.rename", { id: "b1" }]], "the rest is Herdr's");
// New tab names its space to t3-tabs, in view or not, so the Inbox bar reads the tab as something started there (`fresh`).
for (const active of [true, false]) {
  spaceList[0].active = active;
  assert.deepEqual(choose({ tab: "tab", target: { id: "b1", space: "s1" } }, "New tab"), [["t3-tabs.new:s1"]], `a tab's, its space ${active ? "in view" : "elsewhere"}`);
  assert.deepEqual(choose({ tab: "space", target: { id: "s1" } }, "New tab"), [["t3-tabs.new:s1"]], `a space's, ${active ? "in view" : "elsewhere"}`);
}
spaceList[0].active = true;
assert.deepEqual(choose({ tab: "tab", target: { id: "b1" } }, "New tab"), [["t3-tabs.new:s1"]], "with no space named, the one in view");
spaceList[0].active = true;
assert.deepEqual(choose({ tab: "space", target: { id: "s1" } }, "Close"), [["space.close", { id: "s1" }]], "a space's Close is Herdr's, which asks itself");

// A pane's menu as drawn: each row's icon t3-menu's own, at the layout's 1.75 (t3-tokens P4), Split down's not Split right's;
// the right column only keys, written as the tooltips and New write them; Copy address shows no address there.
{
  keyList = [{ section: "global", action: "pane.split:right", keys: "cmd-d" }, { section: "global", action: "pane.split:down", keys: "cmd-shift-d" }, { section: "layout:herdr-t3", action: "pane.zoom", keys: "cmd-shift-enter" }];
  target = { tab: "pane", target: { pane: "p1", terminal: "t1" } };
  const m = new context.Menu(); m.init({}, cx);
  const rows = vm.runInContext("items", context)(target, null).map((it, i) => {
    const row = rowAt(m.render(), i), walk = (n) => !n || typeof n !== "object" ? [] : [n, ...n.items.flatMap(walk)];
    const icon = walk(row).find((n) => typeof n.style.path === "string")?.style.path, words = walk(row).flatMap((n) => n.items.filter((x) => typeof x === "string"));
    return { label: it[0], icon, hint: words.filter((w) => w && w !== it[0]) };
  });
  const row = (label) => rows.find((r) => r.label === label);
  for (const r of rows) {
    assert.match(r.icon, /^mods\/t3-menu\/icons\/[a-z-]+\.svg$/, `${r.label}: t3-menu's own icon`);
    const svg = fs.readFileSync(path.join(__dirname, r.icon.replace("mods/t3-menu/", "")), "utf8");
    assert.deepEqual([...new Set(svg.match(/stroke-width="[^"]*"/g))], ['stroke-width="1.75"'], `${r.label}: at 1.75`);
  }
  assert.equal(row("Split down").icon, "mods/t3-menu/icons/panel-bottom.svg");
  assert.notEqual(row("Split down").icon, row("Split right").icon, "the two splits look apart");
  assert.deepEqual([row("Split right").hint, row("Split down").hint, row("Zoom pane").hint], [["⌘D"], ["⇧⌘D"], ["⇧⌘Enter"]], "keys as the layout writes them");
  assert.deepEqual(row("Copy address").hint, [], "no address on the right: only keys go there");
  keyReads = 0; m.render();
  assert.equal(keyReads, 1, "a draw reads the bindings once, not for each row");
  keyList = []; target = {};
}

// An agent's menu, the same from a card, an Agents row or the tab bar's title: what it can do now, read from the agent itself.
{
  const items = vm.runInContext("items", context), labels = () => JSON.parse(JSON.stringify(items({ tab: "agent", target: { address: "t1" } }, null).map((it) => it[0])));
  const groups = () => JSON.parse(JSON.stringify(items({ tab: "agent", target: { address: "t1" } }, null).map((it) => it[4])));
  const agent = (more = {}, labels = {}) => {
    agentList = [{ address: "t1", pane: "p1", tab: "b1", status: "done", focused: true, ...more }];
    terms = [{ address: "t1", state: "live", turn: 2, labels }];
  };
  agent();
  assert.deepEqual(labels(), ["Pin", "Settle", "Snooze", "Rename", "Copy address", "Close pane"]);
  assert.deepEqual(groups(), [0, 0, 0, 1, 1, 2], "state, then names and copies, then Close pane: a rule between");
  agent({ status: "working" });
  assert.deepEqual(labels(), ["Pin", "Snooze", "Rename", "Copy address", "Close pane"], "busy: no Settle");
  agent({ status: "blocked" });
  assert.deepEqual(labels(), ["Pin", "Rename", "Copy address", "Close pane"], "needing you: neither Settle nor Snooze");
  agent({ status: "idle" });
  assert.deepEqual(labels(), ["Pin", "Settle", "Snooze", "Mark unread", "Rename", "Copy address", "Close pane"], "idle with a completed turn: Mark unread in the state group");
  assert.deepEqual(groups(), [0, 0, 0, 0, 1, 1, 2], "Mark unread belongs to the state group");
  assert.deepEqual(choose({ tab: "agent", target: { address: "t1" } }, "Mark unread"), [["t3-tabs.unread:t1", {}]]);
  {
    target = { tab: "agent", target: { address: "t1" } };
    const m = new context.Menu(); m.init(target, cx);
    const walk = (n) => !n || typeof n !== "object" ? [] : [n, ...n.items.flatMap(walk)];
    const icon = walk(rowNamed(m.render(), "Mark unread")).find((n) => typeof n.style.path === "string")?.style.path;
    assert.equal(icon, "mods/t3-menu/icons/circle-dot.svg", "Mark unread uses t3-menu's circle-dot icon");
    const svg = fs.readFileSync(path.join(__dirname, icon.replace("mods/t3-menu/", "")), "utf8");
    assert.deepEqual([...new Set(svg.match(/stroke-width="[^"]*"/g))], ['stroke-width="1.75"'], "Mark unread icon is drawn at 1.75");
    target = {};
  }
  terms[0].turn = 0;
  assert.ok(!labels().includes("Mark unread"), "no completed turn yet: no Mark unread");
  delete terms[0].turn;
  assert.ok(!labels().includes("Mark unread"), "missing turn: no Mark unread");
  agent({ status: "idle" });
  terms[0].status = "error";
  assert.ok(!labels().includes("Mark unread"), "failed own turn counts as blocked: no Mark unread");
  for (const kidStatus of ["working", "blocked", "error"]) {
    agent({ status: "idle" });
    terms.push({ address: "t1k", parent: "t1", state: "live", status: kidStatus, labels: {} });
    assert.ok(!labels().includes("Mark unread"), `idle with ${kidStatus} sub-agent: no Mark unread`);
  }
  agent({ status: "idle" });
  terms.push({ address: "t1k", parent: "t1", state: "live", status: "done", labels: {} });
  assert.ok(labels().includes("Mark unread"), "idle with quiet sub-agent keeps Mark unread");
  agent({ status: "idle" }, { settled: "1:2" });
  assert.deepEqual(labels().slice(0, 4), ["Pin", "Un-settle", "Snooze", "Mark unread"], "settled idle agent still offers Mark unread");
  agent({ status: "idle" }, { snoozed: String(Date.now() + 3600000) });
  assert.deepEqual(labels().slice(0, 4), ["Pin", "Settle", "Wake", "Mark unread"], "snoozed idle agent offers Mark unread after Wake");
  list = "lists";
  assert.ok(!labels().includes("Mark unread"), "Lists mode hides Mark unread (docs/adr/0002)");
  list = "inbox";
  agent({}, { settled: "1:2" });
  assert.ok(labels().includes("Un-settle"), "settled since its last turn");
  agent({}, { snoozed: String(Date.now() + 3600000) });
  assert.deepEqual(labels().slice(0, 3), ["Pin", "Settle", "Wake"], "snoozed: Wake");
  assert.deepEqual(choose({ tab: "agent", target: { address: "t1" } }, "Wake"), [["t3-tabs.wake:t1", {}]]);
  agent({ program: { key: "pi", name: "Pi", agent: true } }, { "pi.session": "x" });
  assert.ok(!labels().includes("Rename"), "Pi names the tab");
  agent();
  assert.deepEqual(choose({ tab: "agent", target: { address: "t1" } }, "Settle"), [["t3-tabs.settle:t1", {}]], "the agent it was opened on, in view or not");
  assert.deepEqual(choose({ tab: "agent", target: { address: "t1" } }, "Pin"), [["t3-tabs.pin:t1", {}]]);
  assert.deepEqual(choose({ tab: "agent", target: { address: "t1" } }, "Close pane"), [["t3-tabs.close-pane:p1"]], "its pane, asking first");
  assert.deepEqual(choose({ tab: "agent", target: { address: "t1" } }, "Copy address"), [["clipboard", "t1"]]);
  state["t3.pins"] = ["t1"];
  assert.equal(labels()[0], "Unpin");
  assert.deepEqual(choose({ tab: "agent", target: { address: "t1" } }, "Unpin"), [["t3-tabs.unpin:t1", {}]], "Unpin with its Undo");
  delete state["t3.pins"];
  list = "lists";
  assert.deepEqual(labels(), ["Pin", "Rename", "Copy address", "Close pane"], "Settle and Snooze are the Inbox's (docs/adr/0002)");
  list = "inbox";
  // A sub-agent kept in the tab beside its parent: no pin or rename of its own, and it can go back.
  agentList = [{ address: "t1", pane: "p1", tab: "b1", status: "working" }, { address: "t2", pane: "p2", tab: "b1", status: "done", focused: true }];
  paneList.push({ pane: "p2", tab: "b1", terminal: "t2" });
  terms = [{ address: "t1", name: "lead", state: "live", status: "working", labels: {} }, { address: "t2", parent: "t1", state: "live", status: "done", labels: {} }];
  assert.deepEqual(JSON.parse(JSON.stringify(items({ tab: "agent", target: { address: "t2" } }, null).map((it) => it[0]))), ["Settle", "Snooze", "Copy address", "Send back to lead", "Close pane"]);
  paneList.pop();
  // One with no pane (a sub-agent the parent still holds): only its address.
  terms = [{ address: "t1", state: "live", status: "working", labels: {} }, { address: "t3", parent: "t1", state: "live", status: "done", labels: {} }];
  assert.deepEqual(JSON.parse(JSON.stringify(items({ tab: "agent", target: { address: "t3" } }, null).map((it) => it[0]))), ["Copy address", "Send back to t1"]);
  terms = [{ address: "t1", labels: {} }]; agentList = [];

  // Rename / Rename tab rules aligned with shared/name.js.
  {
    const pi = { key: "pi", name: "Pi", agent: true };
    const codex = { key: "codex", name: "Codex", agent: true };
    const zsh = { key: "shell", name: "zsh", shell: true };
    const labelsFor = (addr) => JSON.parse(JSON.stringify(items({ tab: "agent", target: { address: addr } }, null).map((it) => it[0])));
    const hasRename = (addr) => labelsFor(addr).some((l) => l === "Rename" || l === "Rename tab");

    // Non-Pi agent (e.g. codex) with leftover pi.session still offers Rename.
    agentList = [{ address: "t1", pane: "p1", tab: "b1", status: "done", program: codex }];
    terms = [{ address: "t1", state: "live", status: "done", program: codex, labels: { "pi.session": "old" } }];
    assert.ok(labelsFor("t1").includes("Rename"), "non-Pi agent with leftover pi.session still offers Rename");

    // One top-level agent plus a non-agent shell in the same tab: still Rename.
    terms.push({ address: "t-sh", state: "live", status: null, program: zsh, labels: {} });
    paneList.push({ pane: "p-sh", tab: "b1", terminal: "t-sh" });
    assert.ok(labelsFor("t1").includes("Rename"), "a non-agent shell beside the agent keeps Rename");
    assert.ok(!labelsFor("t1").includes("Rename tab"));
    paneList.pop();

    // Two top-level agents in the same tab (e.g. two unnamed Pis): both show "Rename tab" targeting the same tab.
    agentList = [
      { address: "t1", pane: "p1", tab: "b1", status: "done", program: pi },
      { address: "t2", pane: "p2", tab: "b1", status: "idle", program: pi },
    ];
    terms = [
      { address: "t1", state: "live", status: "done", program: pi, labels: {} },
      { address: "t2", state: "live", status: "idle", program: pi, labels: {} },
    ];
    paneList.push({ pane: "p2", tab: "b1", terminal: "t2" });
    assert.ok(labelsFor("t1").includes("Rename tab") && !labelsFor("t1").includes("Rename"), "first split peer offers Rename tab");
    assert.ok(labelsFor("t2").includes("Rename tab") && !labelsFor("t2").includes("Rename"), "second split peer offers Rename tab");
    assert.deepEqual(choose({ tab: "agent", target: { address: "t1" } }, "Rename tab"), [["tab.rename", { id: "b1" }]]);
    assert.deepEqual(choose({ tab: "agent", target: { address: "t2" } }, "Rename tab"), [["tab.rename", { id: "b1" }]]);
    assert.equal(vm.runInContext("menuIcon", context)("tab.rename", "Rename tab", { id: "b1" }), "mods/t3-menu/icons/square-pen.svg", "Rename tab keeps the rename icon");

    // One Pi with pi.session and one without in the same tab: former hides rename, latter shows Rename tab.
    terms[0].labels["pi.session"] = "Fix login";
    assert.ok(!hasRename("t1"), "Pi with pi.session hides Rename / Rename tab");
    assert.ok(labelsFor("t2").includes("Rename tab"), "split peer without session still offers Rename tab");
    delete terms[0].labels["pi.session"];

    // Sub-agent in its own separate tab still hides Rename / Rename tab.
    agentList = [
      { address: "t1", pane: "p1", tab: "b1", status: "working", program: pi },
      { address: "t2", pane: "p2", tab: "b2", status: "done", program: pi },
    ];
    terms = [
      { address: "t1", state: "live", status: "working", program: pi, labels: {} },
      { address: "t2", parent: "t1", state: "live", status: "done", program: pi, labels: {} },
    ];
    assert.ok(!hasRename("t2"), "sub-agent in its own tab hides Rename");

    // Agent spawned from a live non-agent shell is top-level: offers Rename when alone, Rename tab when paired.
    agentList = [{ address: "t2", pane: "p2", tab: "b1", status: "done", program: pi }];
    terms = [
      { address: "t-sh", state: "live", status: null, program: zsh, labels: {} },
      { address: "t2", parent: "t-sh", state: "live", status: "done", program: pi, labels: {} },
    ];
    assert.ok(labelsFor("t2").includes("Rename"), "shell-spawned agent alone in a tab offers Rename");
    agentList.push({ address: "t1", pane: "p1", tab: "b1", status: "idle", program: pi });
    terms.push({ address: "t1", state: "live", status: "idle", program: pi, labels: {} });
    assert.ok(labelsFor("t2").includes("Rename tab"), "shell-spawned agent sharing a tab offers Rename tab");

    // Grandchild whose root exited but middle pane-less parent is a live sub-agent: stays a sub-agent, hides Rename.
    agentList = [{ address: "t2", pane: "p2", tab: "b2", status: "done", program: pi }];
    terms = [
      { address: "t0", state: "exited", status: "idle", program: pi, labels: {} },
      { address: "t1", parent: "t0", state: "live", status: "working", program: pi, labels: {} },
      { address: "t2", parent: "t1", state: "live", status: "done", program: pi, labels: {} },
    ];
    assert.ok(!hasRename("t2"), "grandchild under a live pane-less sub-agent hides Rename");

    paneList.pop();
    terms = [{ address: "t1", labels: {} }];
    agentList = [];
  }
  const snooze = choose({ tab: "agent", target: { address: "t1" } }, "Snooze");
  assert.deepEqual(snooze, [], "gone: nothing");
  agent();
  assert.deepEqual(choose({ tab: "agent", target: { address: "t1" } }, "Snooze").map((c) => [c[0], c[1].mod, c[1].props.tab, c[1].props.target]), [["overlay", "t3-menu", "snooze", { address: "t1" }]], "its times, as the card's Snooze menu, beside it");
  const times = items({ tab: "snooze", target: { address: "t1" } }, null);
  // Soonest first, so from 5 to 6 pm This evening leads: compare with the presets at this time, not a fixed label.
  assert.equal(times[0][0], vm.runInContext("presets", context)(Date.now())[0].label);
  assert.ok(times.some((t) => t[0] === "In 1 hour"));
  assert.match(choose({ tab: "snooze", target: { address: "t1" } }, times[0][0])[0][0], /^t3-tabs\.snooze:t1:\d+$/);
  assert.ok(times[0][3], "the time it wakes, on the right");
  assert.deepEqual(choose({ tab: "snooze", target: { address: "t1" } }, "Custom…").map((c) => [c[1].mod, c[1].props]), [["t3-inbox", { customSnooze: "t1", answer: "t3-tabs.snooze" }]], "Custom is the Inbox's dialog, answering the tab bar");
  terms = [{ address: "t1", labels: {} }]; agentList = [];
}

// A space's, a checkout's and a machine's.
{
  const items = vm.runInContext("items", context), labels = (p, git = null) => JSON.parse(JSON.stringify(items(p, git).map((it) => it[0])));
  assert.deepEqual(labels({ tab: "space", target: { id: "s1" } }), ["New tab", "Rename", "Copy path", "Close"]);
  assert.deepEqual(labels({ tab: "space", target: { id: "s1" } }, "linked"), ["New tab", "Rename", "Copy path", "New worktree", "Open worktree", "Remove worktree", "Close"]);
  assert.deepEqual(choose({ tab: "space", target: { id: "s1" } }, "Copy path"), [["clipboard", "/work/s1"]], "where it is now");
  assert.deepEqual(labels({ tab: "checkout", target: { folder: "/work/r", machine: null } }), ["Open", "Copy path"]);
  assert.deepEqual(choose({ tab: "checkout", target: { folder: "/work/r", machine: null } }, "Open"), [["space.new", { folder: "/work/r", machine: "" }]]);
  assert.deepEqual(labels({ tab: "machine", target: { machine: "vps", connected: true, connect: false } }), ["New space here"]);
  assert.deepEqual(choose({ tab: "machine", target: { machine: "vps", connected: false, connect: true } }, "Connect"), [["t3-spaces.reconnect:vps", {}]]);
  assert.deepEqual(labels({ tab: "global" }), [], "no menu for nothing in particular");
  // Drawn: a rule between groups only, and only Remove worktree in red.
  const m = new context.Menu();
  m.git = { folder: "/work/s1", machine: undefined, kind: "linked" };
  target = { tab: "space", target: { id: "s1" } };
  const tree = m.render(), rows = tree.items;
  assert.deepEqual(rows.map((r) => r.items.length), [1, 2, 1, 2, 1, 2, 1], "a rule before Rename, New worktree and Remove worktree");
  assert.deepEqual(rows.map((r) => r.items.at(-1).style.text_color), ["#fg", "#fg", "#fg", "#fg", "#fg", "#red", "#fg"]);
}

// New tab's key is cmd-t's only where that key acts, the space in view, as Settle's shows only on the agent in view.
{
  keyList = [{ section: "global", action: "tab.new", keys: "cmd-t" }, { section: "layout:herdr-t3", action: "t3-tabs.new", keys: "cmd-t" }];
  const hint = (p) => vm.runInContext("items", context)(p, null).find((it) => it[0] === "New tab")[3];
  const menus = [{ tab: "space", target: { id: "s1" } }, { tab: "tab", target: { id: "b1", space: "s1" } }];
  assert.deepEqual(menus.map(hint), ["⌘T", "⌘T"]);
  spaceList[0].active = false;
  assert.deepEqual(menus.map(hint), ["", ""], "another space: cmd-t wouldn't open it there");
  spaceList[0].active = true; keyList = [];
}

// A tab's menu (New tab, Rename, Close), opened by a right-click, moves as every popup's list (shared/list.js).
{
  target = { tab: "tab", target: { id: "b1", space: "s1" } };
  const m = new context.Menu();
  m.init(target, cx);
  const lit = () => [0, 1, 2].filter((i) => rowAt(m.render(), i).style.bg === theme.selected);
  const key = (e) => { calls = []; find(m.render(), "menu").handlers.on_key_down(e, cx); return JSON.parse(JSON.stringify(calls)); };
  assert.deepEqual(lit(), [], "as T3's, nothing lit until a key or the pointer gets there");
  assert.deepEqual(key({ key: "enter" }), [], "so Enter runs nothing");
  // The pointer on Close lights Close alone, and Enter runs what's lit.
  rowAt(m.render(), 2).handlers.on_hover(true, cx);
  assert.deepEqual(lit(), [2], "one row lit, the pointer's");
  assert.equal(rowAt(m.render(), 2).style.hover, undefined, "no second light of its own");
  assert.deepEqual(key({ key: "enter" }), [["t3-tabs.close-tab:b1"]]);
  rowAt(m.render(), 2).handlers.on_hover(false, cx);
  assert.deepEqual(lit(), [], "leaving the row clears it, as the Snooze menu's");
  key({ key: "end" });
  assert.deepEqual(lit(), [2]);
  key({ key: "home" });
  assert.deepEqual(lit(), [0]);
  key({ key: "r", key_char: "r", modifiers: {} });
  assert.deepEqual(lit(), [1], "typing finds Rename");
  key({ key: "up" });
  assert.deepEqual(lit(), [0]);
}
// An agent's Snooze opens its times beside its row, as T3's MenuSub: a second popup, on the pointer resting on the row, on a
// click, or on → or Enter; ← or Esc in it goes back; a time closes both.
{
  agentList = [{ address: "t1", pane: "p1", tab: "b1", status: "done", focused: true }];
  terms = [{ address: "t1", state: "live", turn: 2, labels: {} }];
  const plain = (v) => JSON.parse(JSON.stringify(v));
  // Another menu opening closes the one open, as Herdr's popups do: what hung off it goes too.
  let open = null;
  const root = (overlay = "root") => {
    open?.close();
    target = { tab: "agent", target: { address: "t1" }, overlay };
    const m = open = new context.Menu();
    m.init(target, cx);
    return m;
  };
  const row = (m, i) => rowAt(m.render(), i);
  const opens = () => calls.filter((c) => c[0] === "overlay").map((c) => plain({ mod: c[1].mod, kind: c[1].kind, at: c[1].at, width: c[1].width, props: c[1].props }));
  const box = { x: 100, y: 200, width: 212, height: 28 };
  const move = (m, i, position, bounds = box) => { calls = []; closed = []; row(m, i).handlers.on_mouse_move({ position, bounds }, cx); };
  let m = root();
  // Pin, Settle, Snooze, Rename, Copy address, Close pane: Snooze alone ends in T3's chevron.
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => row(m, i).items.at(-1).style.path ?? null), [null, null, "mods/t3-menu/icons/chevron-right.svg", null, null, null]);
  move(m, 2, { x: 150, y: 210 });
  elapse(99);
  assert.deepEqual(calls, [], "not before 100ms on the row");
  elapse(1);
  assert.deepEqual(opens(), [{ mod: "t3-menu", kind: "popup", at: { x: 312, y: 195 }, width: 220, props: { tab: "snooze", target: { address: "t1" }, parents: ["root"] } }], "to the row's right, its first row level with it");
  const first = `o${opened}`;
  row(m, 2).handlers.on_hover(false, cx);
  assert.equal(row(m, 2).style.bg, theme.selected, "its row stays lit while it's open");
  move(m, 2, { x: 160, y: 211 });
  elapse(500);
  assert.deepEqual([calls, closed], [[], []], "moving on its row changes nothing");
  // Toward it, over Rename, inside the safe triangle: it stays until the pointer rests there.
  move(m, 3, { x: 300, y: 240 }, { ...box, y: 237 });
  elapse(100);
  assert.deepEqual(closed, [], "heading to it: kept");
  elapse(200);
  assert.deepEqual(closed, [first], "stopped short over Rename: closed");
  assert.notEqual(row(m, 2).style.bg, theme.selected);
  // Open again, then away from it: closed after 100ms.
  move(m, 2, { x: 150, y: 210 });
  elapse(100);
  move(m, 4, { x: 150, y: 275 }, { ...box, y: 274 });
  elapse(99);
  assert.deepEqual(closed, []);
  elapse(1);
  assert.deepEqual(closed, [`o${opened}`], "another row, away from it: closed");
  // The pointer leaving the menu: nothing pending opens.
  move(m, 2, { x: 150, y: 210 });
  find(m.render(), "menu").handlers.on_hover(false, cx);
  elapse(500);
  assert.deepEqual(calls, [], "left before 100ms: nothing opens");
  // Near the window's right edge: to the row's left.
  m = root();
  move(m, 2, { x: 1000, y: 210 }, { ...box, x: 960 });
  elapse(100);
  assert.deepEqual(opens()[0].at, { x: 740, y: 195 }, "no room on the right: to the left");
  // Zoomed: the row and the window in its pixels, the width in the menu's own.
  zoom = 2;
  m = root();
  move(m, 2, { x: 300, y: 420 }, { x: 200, y: 400, width: 424, height: 56 });
  elapse(100);
  assert.deepEqual([opens()[0].at, opens()[0].width], [{ x: 624, y: 390 }, 220]);
  zoom = 1;
  // A click opens it at once, where the pointer found the row.
  m = root();
  move(m, 2, { x: 150, y: 210 });
  calls = [];
  row(m, 2).handlers.on_click({}, cx);
  assert.deepEqual(opens().map((o) => [o.at, o.props.lit]), [[{ x: 312, y: 195 }, undefined]], "a click opens it now, nothing lit");
  elapse(500);
  assert.equal(opens().length, 1, "and the wait doesn't open it twice");
  // Closing the menu closes its submenu.
  closed = [];
  m.close();
  assert.deepEqual(closed, [`o${opened}`]);

  // Keys: → or Enter on Snooze opens it with its first time lit; with no row seen, it's placed from where the menu opened.
  mouse = { x: 50, y: 60 };
  m = root();
  const key = (v, e) => { calls = []; closed = []; find(v.render(), "menu").handlers.on_key_down(e, cx); };
  key(m, { key: "down" }); key(m, { key: "down" }); key(m, { key: "down" });
  key(m, { key: "right" });
  assert.deepEqual(opens().map((o) => [o.at, o.props.lit]), [[{ x: 266, y: 115 }, 0]], "→: beside where the row is, its first time lit");
  const sub = `o${opened}`;
  target = { tab: "snooze", target: { address: "t1" }, parents: ["root"], lit: 0, overlay: sub };
  let s = new context.Menu();
  s.init(target, cx);
  assert.equal(rowAt(s.render(), 0).style.bg, theme.selected, "its first time lit");
  const focused = m.keys.focused;
  key(s, { key: "left" });
  assert.deepEqual(closed, [sub], "←: it alone closes");
  assert.equal(m.keys.focused, focused + 1, "and the menu takes the keyboard back as it closes");
  s.close();
  target = { tab: "agent", target: { address: "t1" }, overlay: "root" };
  m.render();
  assert.equal(m.keys.focused, focused + 1, "drawing again focuses nothing (Herdr refuses focus() there)");
  assert.equal(row(m, 2).style.bg, theme.selected, "on Snooze");
  key(m, { key: "enter" });
  assert.deepEqual(opens().map((o) => o.props.lit), [0], "Enter opens it too");
  const again = `o${opened}`;
  target = { tab: "snooze", target: { address: "t1" }, parents: ["root"], lit: 0, overlay: again };
  s = new context.Menu();
  s.init(target, cx);
  key(s, { key: "escape" });
  assert.deepEqual(closed, [again], "Esc: it alone closes");
  // A time closes the whole chain and snoozes; Custom… does too, and opens the Inbox's dialog.
  s = new context.Menu();
  s.init(target, cx);
  key(s, { key: "enter" });
  assert.deepEqual(closed, [again, "root"], "a time: both close");
  assert.match(calls[0][0], /^t3-tabs\.snooze:t1:\d+$/);
  s = new context.Menu();
  s.init(target, cx);
  key(s, { key: "end" });
  key(s, { key: "enter" });
  assert.deepEqual([closed, opens().map((o) => o.mod)], [[again, "root"], ["t3-inbox"]], "Custom…: both close, its dialog opens");
  agentList = []; terms = [{ address: "t1", labels: {} }];
}

// Live rows can change between the frame that received input and dispatch.
{
  const row = rowNamed;
  const key = (tree, name, eventCx = cx) => tree.handlers.on_key_down({ key: name }, eventCx);
  const open = (p = { tab: "agent", target: { address: "t1" }, overlay: "live-root" }) => {
    target = p;
    agentList = [{ address: "t1", pane: "p1", tab: "b1", status: "done" }];
    terms = [{ address: "t1", state: "live", labels: {} }];
    calls = []; closed = [];
    const m = new context.Menu(); m.init(target, cx);
    return m;
  };
  const clipboard = { ...cx, write_to_clipboard: (text) => calls.push(["clipboard", text]) };
  const trace = () => JSON.parse(JSON.stringify([closed, calls]));
  const copy = [["live-root"], [["clipboard", "t1"]]];

  let m = open(), tree = m.render();
  agentList[0].status = "working";
  row(tree, "Copy address").handlers.on_click({}, clipboard);
  const clickTrace = trace();

  m = open(); tree = m.render();
  key(tree, "end"); key(tree, "up"); // Copy address, the row before Close pane.
  agentList[0].status = "working";
  key(tree, "enter", clipboard);
  const enterTrace = trace();

  m = open(); tree = m.render();
  key(tree, "end"); key(tree, "up");
  agentList[0].status = "working";
  tree = m.render();
  const stillLit = row(tree, "Copy address").style.bg;
  key(tree, "enter", clipboard);
  const redrawTrace = trace();

  const box = { x: 100, y: 200, width: 212, height: 28 };
  const hoverSnooze = (tree) => row(tree, "Snooze").handlers.on_mouse_move({ position: { x: 150, y: 210 }, bounds: box }, cx);
  m = open(); tree = m.render();
  hoverSnooze(tree);
  agentList[0].status = "blocked";
  elapse(100);
  const blockedTrace = trace();

  m = open(); tree = m.render();
  hoverSnooze(tree);
  agentList[0].status = "working"; // Settle disappears, but Snooze remains.
  elapse(100);
  const snoozeTarget = calls[0]?.[1]?.props?.target;
  m.close();

  const savedNow = now;
  now = new Date(2026, 10, 18, 12, 15).getTime();
  m = open({ tab: "snooze", target: { address: "t1" }, parents: ["live-root"], overlay: "live-snooze" });
  tree = m.render();
  elapse(1000);
  const durationWake = now + 3_600_000;
  row(tree, "In 1 hour").handlers.on_click({}, cx);
  const timeTrace = trace();

  m = open({ tab: "snooze", target: { address: "t1" }, parents: ["live-root"], overlay: "live-snooze" });
  tree = m.render();
  agentList[0].status = "blocked";
  row(tree, "In 1 hour").handlers.on_click({}, cx);
  const obsoleteTimeTrace = trace();

  now = new Date(2026, 10, 18, 17, 30).getTime();
  m = open({ tab: "snooze", target: { address: "t1" }, parents: ["live-root"], overlay: "live-snooze" });
  tree = m.render();
  elapse(30 * 60_000 + 1);
  row(tree, "This evening").handlers.on_click({}, cx);
  const expiredTimeTrace = trace();
  now = savedNow;

  assert.deepEqual({ clickTrace, enterTrace, stillLit, redrawTrace, blockedTrace, snoozeTarget: JSON.parse(JSON.stringify(snoozeTarget ?? null)), timeTrace, obsoleteTimeTrace, expiredTimeTrace }, {
    clickTrace: copy, enterTrace: copy, stillLit: theme.selected, redrawTrace: copy,
    blockedTrace: [[], []], snoozeTarget: { address: "t1" },
    timeTrace: [["live-snooze", "live-root"], [[`t3-tabs.snooze:t1:${durationWake}`, {}]]], obsoleteTimeTrace: [[], []], expiredTimeTrace: [[], []],
  });
  agentList = []; terms = [{ address: "t1", labels: {} }];
}

// The clock follows the rows actually drawn by the scrolling viewport.
{
  target = { tab: "space-switch", target: { id: "clock-space" } };
  spaceList = [{ id: "clock-space", tabs: [{ id: "b1" }] }];
  agentList = Array.from({ length: 11 }, (_, i) => ({ address: `a${i}`, pane: `p${i}`, tab: "b1", status: "idle" }));
  terms = agentList.map(({ address }) => ({ address, state: "live", status: "idle" }));
  paneList = agentList.map(({ address, pane, tab }) => ({ terminal: address, pane, tab }));
  const sm = new context.Menu();
  sm.init(target, cx);
  sm.render(cx);
  const before = notifications;
  elapse(3000);
  assert.equal(notifications, before, "idle menu does not redraw on the clock");

  agentList[10].status = terms[10].status = "working";
  terms[10].status_ms = now - 58_000;
  const tree = sm.render(cx);
  assert.equal(find(tree, "space-item-a10"), null, "the working row is below the viewport");
  elapse(1000);
  assert.equal(notifications, before, "offscreen duration does not trigger a redraw");

  const menu = find(sm.render(cx), "menu");
  menu.handlers.on_key_down({ key: "end" }, cx);
  const readTime = () => JSON.stringify(find(sm.render(cx), "space-item-a10"));
  assert.ok(readTime().includes("59s"), "scrolling makes the running duration visible");
  const afterScroll = notifications;
  elapse(999);
  assert.equal(notifications, afterScroll, "no redraw before the next whole second");
  elapse(1);
  assert.equal(notifications, afterScroll + 1);
  assert.ok(readTime().includes('"1m"'), "visible working duration advances to 1m");
  elapse(59_999);
  assert.equal(notifications, afterScroll + 1, "minute labels do not redraw every second");
  elapse(1);
  assert.equal(notifications, afterScroll + 2);
  assert.ok(readTime().includes('"2m"'), "working duration continues to advance each minute");

  agentList[10].status = terms[10].status = "idle";
  terms[10].labels = { snoozed: String(now + 2500) };
  assert.ok(readTime().includes("alarm-clock.svg"));
  elapse(2500);
  assert.equal(notifications, afterScroll + 3, "visible Snooze expiry redraws once");
  assert.ok(!readTime().includes("alarm-clock.svg"));
  const idle = notifications;
  elapse(60_000);
  assert.equal(notifications, idle, "a visible row going idle stops its clock");

  agentList[10].status = terms[10].status = "working";
  terms[10].status_ms = now;
  readTime();
  sm.close();
  elapse(1000);
  assert.equal(notifications, idle, "closing the popup cancels the duration refresh");
}

// Each pass over model data grows with the number of agents and tabs.
{
  const reads = [30, 100, 200].map((count) => {
    let addresses = 0, tabs = 0;
    agentList = Array.from({ length: count }, (_, i) => ({ address: `a${i}`, pane: `p${i}`, get tab() { tabs++; return `b${i}`; }, status: "idle" }));
    terms = agentList.map(({ address }) => ({ get address() { addresses++; return address; }, state: "live", status: "idle" }));
    paneList = agentList.map(({ address }, i) => ({ terminal: address, pane: `p${i}`, get tab() { tabs++; return `b${i}`; } }));
    spaceList = [{ id: "index-space", tabs: agentList.map((_, i) => ({ id: `b${i}` })) }];
    target = { tab: "space-switch", target: { id: "index-space" } };
    const sm = new context.Menu();
    sm.init(target, cx);
    assert.ok(find(sm.render(cx), "space-item-a0"));
    sm.close();
    return { count, addresses, tabs };
  });
  for (const { count, addresses, tabs } of reads) {
    assert.ok(addresses <= 12 * count && tabs <= 12 * count, `space menu scan must be linear: ${JSON.stringify(reads)}`);
  }
  console.log("ok space menu scan", JSON.stringify(reads));
}

// Space switcher menu (tab: "space-switch"): New tab at top with shortcut, then the space's agents (nested sub-agents included) and non-agent terminal programs.
{
  const pi = { key: "pi", name: "Pi", agent: true, tint: true, icon: "icons/pi.svg" };
  const codex = { key: "codex", name: "Codex", agent: true, tint: true, icon: "icons/codex.svg" };
  const lazygit = { key: "lazygit", name: "lazygit", agent: false, tint: false, icon: "icons/git.svg" };
  const zsh = { key: "zsh", name: "zsh", agent: false, tint: true, icon: "icons/terminal.svg" };
  keyList = [{ section: "layout:herdr-t3", action: "t3-tabs.new", keys: "cmd-t" }];
  spaceList = [
    { id: "s0", name: "herdr-t3", active: true, folder: "/work/herdr-t3", tabs: [
      { id: "b1", named: false, active: true },
      { id: "b2", named: false, active: false },
      { id: "b3", named: true, name: "Codex PR", active: false },
      { id: "b4", named: true, name: "Server", active: false },
    ] },
    { id: "s9", name: "other", active: false, folder: "/work/other", tabs: [{ id: "b9", named: false }] },
  ];
  agentList = [
    { address: "t1", pane: "p1", tab: "b1", status: "working", focused: true, program: pi, title: "refactor" },
    { address: "t1b", pane: "p1b", tab: "b2", status: "idle", focused: false, program: pi, title: "sub-pane" },
    { address: "t2", pane: "p2", tab: "b3", status: "idle", focused: false, program: codex, title: "Codex PR" },
    { address: "t9", pane: "p9", tab: "b9", status: "working", focused: false, program: pi, title: "elsewhere" },
  ];
  terms = [
    { address: "t1", state: "live", status: "working", status_ms: now - 120000, program: pi, labels: {} },
    { address: "t1a", parent: "t1", name: "review-runner", state: "live", status: "done", turn: 1, program: pi, labels: {} },
    { address: "t1b", parent: "t1", name: "sub-pane", state: "live", status: "idle", program: pi, labels: {} },
    { address: "t2", state: "live", status: "idle", program: codex, labels: { snoozed: String(now + 3600000) } },
    { address: "t2a", parent: "t2", name: "blocked-kid", state: "live", status: "blocked", program: codex, labels: {} },
    { address: "t-git", state: "live", program: lazygit, labels: {} },
    { address: "t-sh", state: "live", program: zsh, labels: {} },
    { address: "t9", state: "live", status: "working", program: pi, labels: {} },
    { address: "t-other", state: "live", program: zsh, labels: {} },
  ];
  paneList = [
    { pane: "p1", tab: "b1", terminal: "t1", zoomed: true, focused: true, program: pi, title: "refactor", cwd: "/work/herdr-t3" },
    { pane: "p-git", tab: "b1", terminal: "t-git", zoomed: false, focused: false, program: lazygit, title: "lazygit", cwd: "/work/herdr-t3" },
    { pane: "p1b", tab: "b2", terminal: "t1b", zoomed: false, focused: false, program: pi, title: "sub-pane", cwd: "/work/herdr-t3" },
    { pane: "p2", tab: "b3", terminal: "t2", zoomed: false, focused: false, program: codex, title: "Codex PR", cwd: "/work/herdr-t3" },
    { pane: "p-sh", tab: "b4", terminal: "t-sh", zoomed: false, focused: false, program: zsh, title: "zsh", cwd: "/work/herdr-t3" },
    { pane: "p9", tab: "b9", terminal: "t9", zoomed: false, focused: false, program: pi, title: "elsewhere", cwd: "/work/other" },
    { pane: "p-other", tab: "b9", terminal: "t-other", zoomed: false, focused: false, program: zsh, title: "zsh", cwd: "/work/other" },
  ];
  focusState = { space: "s0", tab: "b1", pane: "p1", terminal: "t1" };

  target = { tab: "space-switch", target: { id: "s0" }, overlay: "space-root" };
  const sm = new context.Menu();
  sm.init(target, cx);
  const tree = sm.render();
  const walk = (n) => !n || typeof n !== "object" ? [] : [n, ...n.items.flatMap(walk)];
  const labelsOf = (n) => walk(n).flatMap((x) => x.items.filter((c) => typeof c === "string"));

  const newRow = find(tree, "space-new-tab");
  assert.ok(newRow, "New tab row exists at top");
  assert.deepEqual(labelsOf(newRow), ["New tab", "⌘T"], "New tab shows shortcut hint");

  const listNode = find(tree, "space-menu-list");
  assert.ok(listNode, "space entries live inside scrollList");
  const rowIds = listNode.items.map((r) => r.key);
  assert.deepEqual(rowIds, ["space-item-t1", "space-item-t1a", "space-item-t1b", "space-item-t2", "space-item-t2a", "space-term-p-git", "space-term-p-sh"], "agents (with nested sub-agents once) then non-agent terminals, excluding other spaces");

  // Sub-agents are indented by 16px (8px lead spacer + 8px row gap) and top-level/sub-agent statuses match the layout's marks.
  const row1 = find(listNode, "space-item-t1");
  const row1a = find(listNode, "space-item-t1a");
  const row2 = find(listNode, "space-item-t2");
  const row2a = find(listNode, "space-item-t2a");
  const rowSh = find(listNode, "space-term-p-sh");
  assert.ok(!walk(row1).some((n) => n.style.path === "mods/t3-menu/icons/check.svg"), "current viewed agent does not stack a check mark next to its status");
  assert.ok(Boolean(row1.style.bg), "current viewed agent uses active background tint instead of a check mark");
  assert.equal(row1.style.text_color, theme.foreground, "current viewed agent keeps foreground text");
  assert.equal(row2.style.text_color, theme.muted, "unselected inactive agent uses muted text until hovered");
  const trail1 = row1.items.at(-1);
  assert.ok((trail1.style.pl ?? 0) >= 8, "trailing status adds extra left spacing past the row gap so truncated labels do not crowd it");
  assert.ok(walk(row1).some((n) => n.style.path === "mods/t3-menu/icons/circle-dashed.svg"), "working agent shows the working mark");
  assert.ok(labelsOf(row1).includes("2m"), "working agent shows duration");
  assert.equal(row1a.items[0].style.w, 8, "sub-agent indented one level (16 - 8 lead spacer)");
  assert.ok(walk(row1a).some((n) => n.style.rounded_full && n.style.bg === theme.done), "unread sub-agent shows done dot");
  assert.ok(labelsOf(row2).includes("!"), "blocked sub-agent rolls up to parent");
  assert.ok(labelsOf(row2a).includes("!"), "blocked sub-agent shows !");
  // Without a blocked child, snoozed top-level agent shows the accent alarm clock.
  terms.splice(terms.findIndex((k) => k.address === "t2a"), 1);
  assert.ok(walk(find(sm.render(), "space-item-t2")).some((n) => n.style.path === "mods/t3-menu/icons/alarm-clock.svg"), "snoozed agent shows alarm clock");
  assert.ok(labelsOf(rowSh).includes("Server"), "single-pane named terminal tab uses its tab name");

  // Clicking New tab closes and runs t3-tabs.new for the menu's space; clicking items focuses/peeks properly.
  const plain = (v) => JSON.parse(JSON.stringify(v));
  calls = []; closed = [];
  find(tree, "space-new-tab").handlers.on_click({}, cx);
  assert.deepEqual(plain([closed, calls]), [["space-root"], [["t3-tabs.new:s0"]]]);

  calls = []; closed = [];
  row2.handlers.on_click({}, cx);
  assert.deepEqual(plain([closed, calls]), [["space-root"], [["agent.focus", { terminal: "t2" }]]]);

  calls = []; closed = [];
  row1a.handlers.on_click({}, cx);
  assert.deepEqual(plain([closed, calls]), [["space-root"], [["terminal.peek", { terminal: "t1a" }]]]);

  // Clicking a split non-agent terminal in a zoomed tab moves zoom first and focuses its pane.
  calls = []; closed = [];
  find(listNode, "space-term-p-git").handlers.on_click({}, cx);
  assert.deepEqual(plain([closed, calls]), [["space-root"], [["pane.zoom", { pane: "p-git" }], ["pane.focus", { pane: "p-git" }]]]);

  // Right-clicking an agent or terminal row closes the space menu and opens its context menu.
  calls = []; closed = [];
  row2.handlers["on_mouse_down:right"]({}, cx);
  assert.deepEqual(plain([closed, calls.map((c) => [c[0], c[1].mod, c[1].props])]), [["space-root"], [["overlay", "t3-menu", { tab: "agent", target: { address: "t2" } }]]]);

  calls = []; closed = [];
  find(listNode, "space-term-p-git").handlers["on_mouse_down:right"]({}, cx);
  assert.deepEqual(plain([closed, calls.map((c) => [c[0], c[1].mod, c[1].props])]), [["space-root"], [["overlay", "t3-menu", { tab: "pane", target: { pane: "p-git", terminal: "t-git" } }]]]);

  // A row the pointer lights swaps its mark for a × that closes the pane (asking first, as other closes do); the keyboard's
  // highlight keeps the mark, and Ctrl+D closes its row. A sub-agent with no pane has nothing to close.
  const menuNode = () => find(sm.render(), "menu");
  menuNode().handlers.on_mouse_move({}, cx);
  sm.at = 4;
  const x2 = find(sm.render(), "space-close-t2");
  assert.ok(x2, "the pointer's row shows its close button");
  assert.ok(!walk(find(sm.render(), "space-item-t2")).some((n) => n.style.path === "mods/t3-menu/icons/alarm-clock.svg"), "the × takes the mark's place");
  sm.at = 2;
  assert.equal(find(sm.render(), "space-close-t1a"), null, "a sub-agent without a pane has no close button");
  calls = []; closed = [];
  x2.handlers.on_click({}, cx);
  assert.deepEqual(plain([closed, calls]), [[], [["t3-tabs.close-pane:p2"]]], "× closes the pane through t3-tabs and leaves the menu open");
  sm.at = 6;
  menuNode().handlers.on_key_down({ key: "up", modifiers: {} }, cx);
  assert.equal(find(sm.render(), "space-close-t2"), null, "a key puts the × away");
  assert.equal(sm.at, 5);
  sm.at = 5; // t2a left the list above, so lazygit is row 5
  calls = []; closed = [];
  menuNode().handlers.on_key_down({ key: "d", key_char: "d", modifiers: { control: true } }, cx);
  assert.deepEqual(plain([closed, calls]), [[], [["t3-tabs.close-pane:p-git"]]], "Ctrl+D closes the lit row's pane and leaves the menu open");
  // The pane goes: the list follows live, the highlight on the row that took its place, or the last row once the end is gone.
  const gitPane = paneList.splice(paneList.findIndex((p) => p.pane === "p-git"), 1)[0];
  assert.ok(!find(sm.render(), "space-term-p-git"), "the closed pane leaves the open menu");
  assert.equal(sm.at, 5, "the highlight stays on the row that took its place");
  sm.at = 6;
  sm.render();
  assert.equal(sm.at, 5, "past the end, the highlight comes back to the last row");
  paneList.push(gitPane);
  // The space itself went (its last tab closed): nothing left, so the menu goes, after this frame.
  const spacesWere = spaceList;
  spaceList = spaceList.filter((sp) => sp.id !== "s0");
  closed = [];
  sm.render(cx);
  elapse(0);
  assert.deepEqual(closed, ["space-root"], "a menu whose space closed goes away");
  spaceList = spacesWere;
  sm.at = -1;

  // Keyboard navigation walks New tab + scrollList seamlessly, and close() stamps t3-menu.spaceClosed (not t3-menu.closed).
  const keyNav = (e) => { calls = []; closed = []; find(sm.render(), "menu").handlers.on_key_down(e, cx); };
  keyNav({ key: "down" }); assert.equal(sm.at, 0);
  keyNav({ key: "down" }); assert.equal(sm.at, 1);
  keyNav({ key: "s", key_char: "s", modifiers: {} });
  assert.equal(sm.at, 3, "typing s jumps to sub-pane (t1b)");
  keyNav({ key: "end" });
  assert.equal(sm.at, 6, "End reaches Server at the bottom");
  keyNav({ key: "enter" });
  assert.deepEqual(plain([closed, calls]), [["space-root"], [["pane.focus", { pane: "p-sh" }]]]);

  // Over 10 entries caps the scroll viewport at 10 rows (280px).
  for (let i = 0; i < 8; i++) {
    paneList.push({ pane: `px-${i}`, tab: "b4", terminal: `tx-${i}`, program: zsh, title: `extra-${i}` });
  }
  assert.equal(find(sm.render(), "space-menu-list").style.h, 280, "scrollList caps height at 10 rows");

  delete state["t3-menu.closed"];
  delete state["t3-menu.spaceClosed"];
  sm.close();
  assert.ok(state["t3-menu.spaceClosed"] > 0 && !state["t3-menu.closed"], "space menu stamps its own closed key so it never blocks agent menus");

  const pickRow = (node, id, command, args) => {
    calls = []; closed = [];
    find(node, id).handlers.on_click({}, cx);
    assert.deepEqual(plain([closed, calls]), [["space-root"], [[command, args]]]);
  };
  pickRow(tree, "space-item-t1b", "agent.focus", { terminal: "t1b" });

  // A child split to a different space takes its pane-less branch with it. A pane moved back starts a local row.
  const foreign = terms.find((k) => k.address === "t9");
  foreign.parent = "t1";
  foreign.status = agentList.find((a) => a.address === "t9").status = "blocked";
  terms.push({ address: "t9a", parent: "t9", state: "live", status: "idle", program: pi });
  terms.find((k) => k.address === "t1b").parent = "t9";
  const source = sm.render();
  assert.ok(!find(source, "space-item-t9") && !find(source, "space-item-t9a"), "the source space excludes a foreign pane's branch");
  assert.ok(labelsOf(find(source, "space-item-t1")).includes("!"), "a foreign blocked child still contributes to the parent's roll-up");
  assert.equal(find(source, "space-item-t1b").items[0].style.w, undefined, "the pane returned here starts a local root row");
  pickRow(source, "space-item-t1a", "terminal.peek", { terminal: "t1a" });
  pickRow(source, "space-item-t1b", "agent.focus", { terminal: "t1b" });
  target = { ...target, target: { id: "s9" } };
  const destination = sm.render();
  assert.ok(!find(destination, "space-item-t1b"), "the destination excludes a pane in the source space");
  assert.equal(find(destination, "space-item-t9a").items[0].style.w, 8, "the parked child stays nested in the destination space");
  pickRow(destination, "space-item-t9", "agent.focus", { terminal: "t9" });
  pickRow(destination, "space-item-t9a", "terminal.peek", { terminal: "t9a" });

  // A pane missing from agents() can still be placed and focused using panes().
  agentList = agentList.filter((a) => a.address !== "t9");
  foreign.status = undefined;
  pickRow(sm.render(), "space-item-t9", "pane.focus", { pane: "p9" });

  const contextMenuFor = id => {
    closed = []; calls = [];
    find(sm.render(), `space-item-${id}`).handlers["on_mouse_down:right"]({}, cx);
    assert.deepEqual(closed, ["space-root"]);
    const spec = calls[0][1];
    assert.deepEqual(plain(spec.props), { tab: "agent", target: { address: id } });
    return { ...spec.props, overlay: "agent-root" };
  };
  const parkedContext = contextMenuFor("t9a"), paneContext = contextMenuFor("t9"), spaceTarget = target;
  const items = vm.runInContext("items", context);
  assert.deepEqual(plain(items(parkedContext, null).map(it => it[0])), ["Copy address", "Send back to t9"], "a pane-less child gets no Close pane");
  target = paneContext;
  const actionMenu = new context.Menu(); actionMenu.init(target, cx);
  const menuTree = actionMenu.render();
  const closeRow = rowNamed(menuTree, "Close pane");
  assert.ok(closeRow, "a child with a pane gets Close pane before its first report");
  calls = []; closed = [];
  closeRow.handlers.on_click({}, cx);
  assert.deepEqual(plain([closed, calls]), [["agent-root"], [["t3-tabs.close-pane:p9"]]], "Close pane goes through the pane confirmation entry point");
  target = spaceTarget;

  const beforeKeep = sm.render();
  paneList.push({ pane: "p9a", tab: "b9", terminal: "t9a" });
  pickRow(beforeKeep, "space-item-t9a", "pane.focus", { pane: "p9a" });
  paneList.pop();

  target = { ...target, target: { id: "s0" } };
  assert.ok(!find(sm.render(), "space-item-t9"), "global pane data excludes a foreign child even before its first report");

  keyList = []; agentList = []; terms = [{ address: "t1", labels: {} }];
  spaceList = [{ id: "s1", folder: "/work/p1", tabs: [{ id: "b1" }] }];
  paneList = [{ pane: "p1", tab: "b1", terminal: "t1", cwd: "/work/s1" }];
  focusState = {};
}
// Its target gone before anything could be picked: an empty popup closes, with the menus it hangs off.
{
  target = { tab: "tab", target: { id: "gone", space: "s1" }, overlay: "empty-root", parents: ["empty-parent"] };
  calls = []; closed = [];
  const m = new context.Menu(); m.init(target, cx);
  m.render(cx);
  assert.deepEqual(closed, [], "not while it's being drawn");
  elapse(0);
  assert.deepEqual(closed, ["empty-root", "empty-parent"], "an empty menu closes its chain");
  m.render(cx); elapse(0);
  assert.deepEqual(closed, ["empty-root", "empty-parent"], "once");
}

// Space checkout detection runs one lock-free git rev-parse and rejects non-2-line or failing output.
(async () => {
  const checkout = vm.runInContext("checkout", context);
  const was = context.exec;
  const asked = [];
  let reply = () => ({ code: 0, stdout: "" });
  context.exec = async (cmd, args, opts) => { asked.push([cmd, args, opts]); return reply(cmd, args, opts); };
  try {
    reply = () => ({ code: 0, stdout: "/work/repo\n/work/repo/.git\n" });
    assert.equal(await checkout("/work/repo", "vps"), "main");
    assert.deepEqual(JSON.parse(JSON.stringify(asked.splice(0))), [
      ["git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], { cwd: "/work/repo", on: "vps" }],
    ]);
    reply = () => ({ code: 0, stdout: "/work/wt\n/work/repo/.git\n" });
    assert.equal(await checkout("/work/wt", null), "linked");
    for (const bad of [
      { code: 128, stdout: "/work/repo\n/work/repo/.git\n" },
      { code: 0, stdout: "" },
      { code: 0, stdout: "/work/repo\n" },
      { code: 0, stdout: "\n/work/repo/.git\n" },
      { code: 0, stdout: "/work/repo\n\n/work/repo/.git\n" },
      { code: 0, stdout: "/work/repo\n/work/repo/.git\nextra\n" },
    ]) {
      reply = () => bad;
      assert.equal(await checkout("/work/repo", null), null, `reject bad rev-parse output: ${JSON.stringify(bad)}`);
    }
  } finally {
    context.exec = was;
  }
  console.log("ok menu");
})().catch((e) => { console.error(e); process.exit(1); });
