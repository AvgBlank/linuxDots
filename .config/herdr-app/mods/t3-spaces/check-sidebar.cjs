const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const kit = require("./check-kit.js");
const element = kit.elements({ args: "auto", adds: ["child"] }), { plain, find, strings, walk, fire } = kit;
// A row's laid-out children, without the absolutely placed tree lines.
const inFlow = row => row.items.filter(n => !("absolute" in n.style));

// A mod as Herdr would load it (kit.bundle), with the names mods import button.js's button and tint under.
function bundle(dir) {
  const own = (file, src) => file === "button.js" ? kit.strip(src) + "\nconst drawButton = button, ghostTint = tint;" : null;
  const code = kit.bundle((file) => fs.readFileSync(path.join(dir, file), "utf8"), "main.js", own);
  // t3-tabs reads measured-text.js's named as namedLabel.
  return code.includes("namedLabel(") ? code + "\nconst namedLabel = named;" : code;
}

const modRoot = path.dirname(__dirname);
const cx = { notify() {}, stop_propagation() {}, spawn() {}, bind_keys() {}, timers: [], watches: [], timer: { every(ms, fn) { const t = { ms, fn, cancel() { t.gone = true; } }; cx.watches.push(t); return t; }, after(ms, fn) { const t = { ms, fn, cancel() { t.gone = true; } }; cx.timers.push(t); return t; } }, focus_handle: () => { let gone = false; return { focus() { assert.ok(!gone, "a released FocusHandle throws when used"); }, is_focused: () => false, release() { gone = true; return true; } }; } };
function fixture(width) {
  const program = { key: "pi", name: "Pi", agent: true, tint: true, icon: "icons/pi.svg" };
  const tabs = ["local task", "second task", "remote task"].map((name, i) => ({ id: `b${i}`, name, named: true }));
  const spaces = tabs.map((tab, i) => ({ id: `s${i}`, name: `project ${i}`, active: i === 0, folder: `/work/p${i}`, machine: i === 2 ? "vps" : null, status: "working", tabs: [tab] }));
  const agents = [0, 2].map((i) => ({ address: i === 2 ? "vps/t2" : "t0", pane: `p${i}`, space: `s${i}`, space_name: spaces[i].name, tab: `b${i}`, title: tabs[i].name, seq: i, program, focused: i === 0, status: i === 0 ? "working" : "blocked" }));
  const terminals = [...agents.map(a => ({ ...a, state: "live" })),
    { address: "child", parent: "t0", name: "child task", state: "live", status: "error", program },
    { address: "grandchild", parent: "child", name: "grandchild task", state: "live", status: "working", program }];
  const panes = agents.map(a => ({ ...a, terminal: a.address, cwd: `/work/${a.space}` }));
  const slots = { sidebar: { id: "sidebar", size: { px: width } }, spaces: { id: "spaces", size: { px: 90 } } };
  const state = { "agents.sort": "grouped" };
  const calls = [], overlays = [], stores = new Map(), scopes = new Map(), labelled = [], shown = { agent: "child" }, commands = [], closed = [], orderWrites = [], sharedWrites = [], notifications = [];
  // What a test may change about the window and the app: the window, the layout's root fields, the update state.
  const ui = { window: { platform: "macos" }, root: {}, updates: { app: {} } };
  let hcAnswer = () => ({ code: 0 });
  const theme = new Proxy({ selected: "#2c2c2f", hover: "#202024", working: "#6b93ff", blocked: "#f0a33a", done: "#ececf0", muted: "#a9a9b4", foreground: "#f4f4f6", dim: "#77777f", ansi3: "#c8a84b", ansi4: "#5f8fe0", ansi11: "#e8cf7a", ansi12: "#8fb4f2" }, { get: (t, k) => t[k] ?? "#a9a9b4" });
  const env = {
    checking: () => false,
    View: class {}, div: () => element(), h_flex: () => element("h"), v_flex: () => element("v"),
    Button: { new: id => element("button").id(id) },
    Popover: { new: id => element("popover").id(id) }, HoverCard: { new: id => element("hovercard").id(id) }, Popup: { new: (id, trigger) => element("popup").id(id).child(trigger) }, Select: { new: id => element("select").id(id) }, Input: { new: () => element("input") },
    InputState: { new: () => ({ on() {}, value: () => "", set_value() {}, focus() {} }) },
    ScrollHandle: { new: () => ({ scroll_to_item() {}, release() {} }) },
    svg: source => element("svg", source), image: source => element("image", source),
    spaces: () => spaces, agents: () => agents, terminals: () => terminals, panes: () => panes,
    machines: () => [{ name: null, layout: "ready" }, { name: "vps", layout: "ready" }], // What has the keyboard: the focused agent's terminal (Husain's T3 lists read it, not agents().focused), with Herdr's chosen agent.
    focused: () => { const a = agents.find(x => x.focused); return { terminal: a?.address ?? null, ...shown }; },
    exec: async () => ({ code: 1, stdout: "" }), readTextFile: async () => null, watchFolder: () => new Promise(() => {}),
    window: () => ui.window, props: () => ({}), theme: () => theme,
    settings: () => ({ zoom: 1, ...ui.settings }), home: () => "/home/test",
    layout: () => ({ ...ui.root, children: Object.values(slots) }), shared: key => state[key],
    setShared: (key, value) => { sharedWrites.push(key); state[key] = value; }, setAgentOrder: xs => orderWrites.push([...xs]),
    hc: (args) => { labelled.push([...args]); return Promise.resolve(hcAnswer(args)); }, notify: n => notifications.push(n),
    run: (name, args) => {
      calls.push([name, JSON.parse(JSON.stringify(args ?? {}))]);
      if (name === "layout.resize" && slots[args.id]) slots[args.id].size = { px: args.px };
      if (name === "layout.select" && slots[args.stack]) slots[args.stack].active = args.child;
    },
    openOverlay: spec => overlays.push(spec), closeOverlay: id => closed.push(id), updates: () => ui.updates,
    nextCommand: () => commands.length ? Promise.resolve(commands.shift()) : new Promise(() => {}),
    keys: () => [{ section: "layout:herdr-t3", keys: "cmd-t", action: "t3-tabs.new" }, { section: "layout:herdr-t3", keys: "cmd-shift-z", action: "t3-tabs.undo" }, { section: "global", keys: "cmd-n", action: "space.new" }],
  };
  function load(name, props = {}) {
    const storage = stores.get(name) ?? new Map();
    stores.set(name, storage);
    const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
    const source = bundle(path.join(modRoot, name));
    // The mod gets a new list each call, as Herdr gives (tree.js indexes each list once); the test keeps editing `terminals`.
    // Husain's pane headers show in a split only: a pane header looked at here has a pane beside it.
    const paneList = name !== "t3-pane" ? () => [...panes] : () => {
      const p = panes.find(q => q.pane === props.pane);
      return p && panes.filter(q => q.tab === p.tab).length < 2 ? [...panes, { pane: "p-beside", tab: p.tab, terminal: null, mod: "x" }] : [...panes];
    };
    const context = vm.createContext({ ...env, terminals: () => [...terminals], panes: paneList, t3FocusRun: true, localStorage, props: () => props, fs: fs.promises, appHome: () => path.dirname(modRoot) });
    vm.runInContext(source, context, { filename: name });
    scopes.set(name, context);
    const mod = new context.Mod();
    mod.init?.(props, cx);
    return mod;
  }
  // Another copy of a loaded mod, sharing its module as Herdr's copies do. props() is the module's: it reads `props` only in init.
  function also(name, props) {
    const context = scopes.get(name), was = context.props;
    context.props = () => props;
    const mod = new context.Mod();
    mod.init?.(props, cx);
    context.props = was;
    return mod;
  }
  return { ...env, load, also, slots, state, calls, overlays, stores, scopes, labelled, shown, commands, closed, ui, orderWrites, sharedWrites, notifications, answerHc: fn => { hcAnswer = fn; } };
}

// Layout cases supply facts at the repository interface; scheduling is checked in check-repos.cjs.
function repoResults(view, fixture) {
  const results = new Map(), placeOf = fixture.scopes.get("t3-spaces").placeOf;
  view.repos = { update() {}, forSpace(space, panes) {
    const key = JSON.stringify([space.machine ?? null, placeOf(space, panes)]);
    return { git: results.get(key) ?? null, answered: results.has(key) };
  } };
  return (folder, git, on = null) => results.set(JSON.stringify([on, folder]), git);
}

function echoSpaceMoves(list, writes) {
  for (const [name, { id, index }] of writes) if (name === "space.move") list.splice(index - 1, 0, list.splice(list.findIndex(s => s.id === id), 1)[0]);
}

// Mouse release runs against a newer host state than the frame which drew the gap.
async function lateSpaceDrop(pendingAuto) {
  const f = fixture(256), list = f.spaces(), view = f.load("t3-spaces"), result = repoResults(view, f);
  const repo = JSON.stringify([null, "/work/repo/.git"]);
  const git = { repo, name: "repo", linked: true, ahead: 0, behind: 0 };
  list[2].machine = null;
  result("/work/p1", git); result("/work/s2", git);
  f.state["t3-tabs.home"] = "h";
  list.splice(1, 0, { id: "h", name: "Home\u200b", named: true, machine: null, tabs: [] });
  const root = () => view.render(cx), row = id => find(root(), id), moves = () => f.calls.filter(([name]) => name === "space.move");
  const echo = () => echoSpaceMoves(list, f.calls.splice(0));
  // Fold the worktrees, open the checkout from its synthetic row, then lift s0 below the group before creation echoes.
  fire(row(`repo-${repo}-fold`), "on_click", {}, cx);
  fire(row(`repo-${repo}`), "on_click", {}, cx);
  fire(row("space-s0"), "on_mouse_down:left", { position: { x: 0, y: 0 } }, cx);
  for (const y of [8, 50]) fire(row("space-list"), "on_mouse_move", { position: { x: 0, y } }, cx);
  const before = root(), gap = find(before, "space-rows").items.filter(n => n.key?.startsWith("fly-")).at(-1);
  assert.ok(gap.key.startsWith("fly-space-gap-"), "the visible gap is after the folded synthetic group");
  list.push({ id: "checkout", name: "repo", folder: "/work/repo", machine: null, tabs: [] });
  result("/work/repo", { ...git, linked: false });
  if (pendingAuto) {
    // Checkout arrival was rendered and automatic placement is still pending at release.
    root();
    const writes = moves();
    assert.ok(writes.some(([, a]) => a.id === "checkout"));
    fire(find(before, "space-list"), "on_mouse_up:left", {}, cx);
    assert.deepEqual(moves(), writes, "release must not race the pending automatic batch");
    echo(); root();
  } else {
    fire(find(before, "space-list"), "on_mouse_up:left", {}, cx);
    assert.deepEqual(moves()[0], ["space.move", { id: "s0", index: 5 }], "the not-yet-drawn checkout already belongs to the drop's anchor");
  }
  for (let i = 0; i < 3; i++) { echo(); root(); }
  assert.deepEqual(list.map(w => w.id), ["h", "checkout", "s1", "s2", "s0"], "the latest checkout and hidden worktrees land before the dragged space");
  const tabs = f.load("t3-tabs");
  const press = async (command, from) => {
    list.forEach(w => { w.active = w.id === from; });
    await tabs.navigation.handle(command, cx);
    return f.calls.pop();
  };
  assert.deepEqual(await press("space:1", "h"), ["space.select", { id: "checkout" }], "the real checkout is first; Home has no number");
  // Husain's: the keys count the rows the sidebar numbers (its keycaps), so folded worktrees have none.
  assert.deepEqual(await press("space:2", "h"), ["space.select", { id: "s0" }], "folded worktrees take no number");
  assert.deepEqual(await press("space-next", "s2"), ["space.select", { id: "s0" }]);
  assert.deepEqual(await press("space-prev", "s0"), ["space.select", { id: "s2" }]);
}

function removedSpaceDropAnchor() {
  const f = fixture(256), view = f.load("t3-spaces");
  f.spaces()[2].machine = null;
  const root = () => view.render(cx), at = id => find(root(), id);
  fire(at("space-s0"), "on_mouse_down:left", { position: { x: 0, y: 0 } }, cx);
  for (const y of [8, 110]) fire(at("space-list"), "on_mouse_move", { position: { x: 0, y } }, cx);
  const before = root();
  assert.match(find(before, "space-rows").items.filter(n => n.key?.startsWith("fly-")).at(-1).key, /^fly-space-gap-/, "the rendered gap is after s2");
  f.spaces().pop();
  fire(find(before, "space-list"), "on_mouse_up:left", {}, cx);
  assert.ok(!f.calls.some(([name]) => name === "space.move"), "when the anchor no longer exists, drop must not fall back to another gap");
}

// Home's button is loaded in the ordinary fixture, with a queued command consumed by the floating Tabs copy.
async function homeNextTiming() {
  const f = fixture(256), sp = f.spaces()[0];
  f.state["t3-tabs.home"] = "h";
  f.slots.sidebar.hidden = true;
  f.slots.lists = { id: "sidebar-lists", active: "inbox" };
  const page = f.load("t3-home"), next = () => find(page.render(cx), "home-next");
  const spawns = [], spawn = cx.spawn;
  cx.spawn = fn => spawns.push(fn);
  try { f.load("t3-tabs", { part: "keys" }); } finally { cx.spawn = spawn; }
  const key = async (command = "next") => {
    f.commands.push(command); spawns.at(-1)(cx); await new Promise(setImmediate);
  };
  f.state["t3-inbox.rows"] = { order: ["t0"], view: "t0" };
  assert.equal(next().handlers.on_click, undefined, "a nonempty queue at its end has no Next target");
  await key(); assert.deepEqual(f.calls.splice(0), []);
  sp.active = false;
  f.spaces().push({ id: "h", name: "Home\u200b", named: true, machine: null, active: true, tabs: [{ id: "home", active: true }] });
  assert.ok(next().handlers.on_click, "Home can start at the first row before the sidebar's view echo");
  fire(next(), "on_click", {}, cx);
  const [click] = f.calls.splice(0);
  assert.deepEqual(click, ["t3-tabs.next", {}]);
  await key(click[0].slice("t3-tabs.".length));
  assert.deepEqual(f.calls.splice(0), [["agent.focus", { terminal: "t0" }]]);
  await key(); assert.deepEqual(f.calls.splice(0), [["agent.focus", { terminal: "t0" }]]);
  const old = next();
  f.state["t3-inbox.rows"] = { order: [] };
  fire(old, "on_click", {}, cx);
  await key(f.calls.pop()[0].slice("t3-tabs.".length));
  assert.deepEqual(f.calls.splice(0), [], "an enabled button's command rechecks the latest queue");
  f.spaces().pop(); sp.active = true;
  f.slots.lists.active = "lists";
  f.state["t3-agents.rows"] = { order: ["pane:card"] };
  assert.ok(next().handlers.on_click, "an omitted view starts at the beginning of the selected Lists snapshot");
  await key(); assert.deepEqual(f.calls.splice(0), [["pane.focus", { pane: "card" }]]);
}

{
  const f = fixture(256);
  const roots = ["t3-tabs", "t3-spaces"].map(name => f.load(name).render(cx));
  assert.deepEqual(roots.map(root => root.style.track_focus), [undefined, undefined], "ordinary presses in the tab bar and Spaces leave the keyboard with the terminal");
}

for (const width of [208, 256]) {
  const f = fixture(width);
  const sp = f.load("t3-spaces"), ag = f.load("t3-agents");
  const st = sp.render(cx);
  let at = ag.render(cx);
  assert.ok(find(at, "fold-t0") && !find(at, "sub-grandchild"), "sub-agents start folded");
  // The child is in error: folded, it still shows, one step in, hung from the parent.
  assert.equal(find(at, "sub-child").style.pl, 28, "a stuck sub-agent shows under its folded parent");
  if (width === 208) assert.equal(find(at, "sub-status-child").style.accessibility_label, "Failed", "a failed one says so, with the menu's `!`");
  f.terminals().find(k => k.address === "grandchild").status = "blocked";
  const stuck = ag.render(cx);
  assert.deepEqual([find(stuck, "sub-child").style.pl, find(stuck, "sub-grandchild").style.pl], [28, 28], "every stuck one hangs straight from the parent");
  f.terminals().find(k => k.address === "grandchild").status = "working";
  ag.toggleFold("t0", cx);
  Object.assign(ag.folded, { gone: false, "vps/gone": false, "far/t1": false, "sp-gone": true });
  ag.render(cx);
  assert.deepEqual(Object.keys(ag.folded).sort(), ["far/t1", "sp-gone", "t0"], "an ended agent's fold goes; a quiet machine's and group headers stay");
  at = ag.render(cx);
  const space = find(st, "space-s0"), agent = find(at, "ag-t0");
  assert.ok(strings(space).includes("project 0"), `space identity at ${width}`);
  assert.ok(strings(agent).includes("local task"), `agent identity at ${width}`);
  assert.equal(space.style.bg, "#2c2c2f");
  assert.equal(agent.style.bg, "#2c2c2f");
  const child = find(at, "sub-child"), grandchild = find(at, "sub-grandchild");
  assert.ok(child.style.pl > agent.style.px, "child is indented from its parent");
  assert.ok(grandchild.style.pl > child.style.pl, "each descendant level is indented");
  assert.ok(strings(child).includes("child task"), "sub-agent keeps its name");
  assert.equal(child.style.bg, f.theme().selected, "parent and peeked child share the selection color");
  for (const row of [space, agent, child]) assert.equal(row.hoverStyle.bg, undefined, "hover preserves a selected row");
  for (const row of [find(st, "space-s1"), find(at, "ag-vps/t2"), grandchild]) assert.equal(row.hoverStyle.bg, f.theme().hover);
  assert.equal(child.style.pl, 28, "first child sits one 20px step in, its turn hung from the parent icon");
  assert.equal(grandchild.style.pl - child.style.pl, 20);
  assert.equal(child.style.text_size, 14);
  for (const row of [agent, child, grandchild]) {
    assert.equal(inFlow(row)[0].style.w ?? inFlow(row)[0].style.size, 16, "icons share a fixed column");
    assert.equal(row.style.gap, 10);
    assert.equal(row.style.h, row === agent ? 52 : 36, "T3's one-line row; Husain's agent row has a second line, its machine");
  }
  const lines = row => row.items.filter(n => "absolute" in n.style).map(n => [n.style.left, "border_b" in n.style ? "elbow" : "line"]);
  assert.deepEqual(lines(child), [[15.25, "elbow"]], "a last child turns in from under its parent's icon");
  assert.deepEqual(lines(grandchild), [[35.25, "elbow"]], "no line continues past a last child");
  f.terminals().push({ address: "child2", parent: "t0", name: "second child", state: "live", status: "idle", program: f.agents()[0].program });
  const branched = ag.render(cx);
  assert.deepEqual(lines(find(branched, "sub-child")), [[15.25, "line"], [15.25, "elbow"]], "a middle child keeps the line going");
  assert.deepEqual(lines(find(branched, "sub-grandchild")), [[15.25, "line"], [35.25, "elbow"]], "descendants carry their ancestors' lines");
  assert.deepEqual(lines(find(branched, "sub-child2")), [[15.25, "elbow"]]);
  const elbow = find(child, "sub-child").items.find(n => "border_b" in n.style).style;
  assert.deepEqual([elbow.w, elbow.rounded_bl], [9.75, 6], "upstream-size turn: ends 4px before the icon, 6px radius");
  assert.equal(elbow.left + 1.5 / 2, agent.style.px + inFlow(agent)[0].style.w / 2, "the line runs down the parent icon's center");
  assert.equal(elbow.left + elbow.w + 4, child.style.pl + (16 - 14) / 2, "the turn stops 4px before the child icon");
  f.terminals().pop();
  // A kept sub-agent (one with a pane) is in agents() too: it shows once, under its parent, unless pinned.
  f.agents().push({ ...f.agents()[0], address: "child", focused: false });
  const kept = ag.render(cx);
  assert.ok(find(kept, "sub-child") && !find(kept, "ag-child"), "a kept sub-agent shows once, under its parent");
  f.state["t3.pins"] = ["child"];
  assert.ok(find(ag.render(cx), "ag-child"), "pinned, it has a row of its own");
  delete f.state["t3.pins"];
  f.agents().pop();
  assert.equal(space.items[0].style.gap, 10);
  assert.equal(space.style.h, 32, "a space's row is T3's project row");
  assert.equal(find(st, "spaces-heading").style.pr, find(at, "agents-heading").style.pr, "header actions share a right edge");
  assert.equal(find(at, "controls-t0").style.gap, 4);
  for (const id of ["status-t0", "status-vps/t2", "sub-status-child", "sub-status-grandchild"]) assert.equal(find(at, id).style.size, 20);
  assert.equal(find(agent, "pin-t0").handlers.on_click, undefined, "faded out, the pin has no click target");
  assert.equal(find(agent, "pin-t0").style.opacity, 0);
  assert.deepEqual(find(at, "controls-t0").items.map(n => n.key), ["tip-fold-t0", "when-t0", "tip-status-t0-mark"], "a parent shows its fold arrow and time before the status, as the shipped list");
  // T3 turns its arrow; here the two directions cross-fade in one slot.
  const arrow = (tree, id) => ["down", "right"].filter(w => find(tree, `${id}-${w}`)?.style.opacity === 1);
  assert.deepEqual(arrow(at, "fold-t0-arrow"), ["down"]);
  assert.deepEqual(strings(find(at, "when-t0")), ["<1m"], "time in its state, as the shipped list");
  fire(agent, "on_hover", true, cx);
  const hoveredTree = ag.render(cx);
  assert.notEqual(find(hoveredTree, "agent-fold-t0").items[0]?.source, "mods/t3-agents/icons/chevron-down.svg", "hover leaves the icon alone");
  assert.deepEqual([find(hoveredTree, "agent-fold-t0").style.h, find(hoveredTree, "agent-fold-t0").style.w], [16, 16]);
  assert.equal(find(hoveredTree, "agent-fold-t0").hoverStyle.bg, undefined, "a row control only lights, as T3's: no ground");
  assert.equal(find(hoveredTree, "pin-t0").style.h, 24, "T3's row control, over the time's slot");
  assert.equal(find(hoveredTree, "pin-t0").style.w, 24);
  assert.equal(find(hoveredTree, "pin-t0").items[0].style.size, 14);
  assert.equal(find(hoveredTree, "pin-t0").style.rounded, 8);
  assert.equal(find(hoveredTree, "pin-t0").style.border, undefined, "pin is borderless like fold");
  fire(find(hoveredTree, "pin-t0"), "on_hover", true, cx);
  assert.equal(find(ag.render(cx), "pin-t0").style.text_color, f.theme().foreground, "hovered, the pin inherits the brightened button color");
  assert.equal(find(ag.render(cx), "pin-t0").hoverStyle.bg, undefined, "a row control only lights, as T3's");
  fire(find(hoveredTree, "pin-t0"), "on_hover", false, cx);
  assert.deepEqual(find(hoveredTree, "controls-t0").items.map(n => n.key), ["tip-fold-t0", "when-t0", "tip-status-t0-mark"], "pin shares the time's slot, the status stays, as the shipped list");
  assert.deepEqual([find(hoveredTree, "pin-t0").style.opacity, find(hoveredTree, "when-t0").items[0].style.opacity], [1, 0], "time and pin cross-fade, as T3's corner");
  assert.equal(find(at, "when-t0").style.min_w, 32, "T3's corner: it holds the pin, so hovering moves nothing");
  fire(find(hoveredTree, "ag-t0"), "on_hover", false, cx);
  assert.equal(find(ag.render(cx), "when-t0").items[0].style.opacity, 1, "leaving restores the time");
  assert.equal(find(at, "agent-menu-t0"), null, "no extra context menu");
  assert.equal(space.items[0].style.justify_center, undefined, "space content stays left aligned");
  assert.equal(agent.style.justify_center, undefined, "agent content stays left aligned");
  assert.equal(find(st, "sidebar-collapse"), null, "no inline sidebar toggle");
  assert.equal(find(at, "collapse"), null, "no sidebar expand control");
  assert.ok(find(at, "sp-s0"), "space group remains visible");
  fire(find(at, "agent-fold-t0"), "on_click", {}, cx);
  at = ag.render(cx);
  assert.equal(find(at, "sub-grandchild"), null, "descendants fold in place");
  assert.equal(find(at, "fold-t0").style.min_w, 20);
  assert.equal(find(at, "fold-t0").style.h, 20);
  assert.ok(strings(find(at, "fold-t0")).includes("2"), "folded badge counts descendants");
  assert.deepEqual(arrow(at, "fold-t0-arrow"), ["right"], "folded, the arrow points right");
  assert.equal(find(at, "fold-t0").style.text_color, f.theme().dim, "count is dim");
  // Inside a hovered row a button's own fill doesn't show: its arrow and count brighten together instead.
  fire(find(at, "fold-t0"), "on_hover", true, cx);
  const lit = find(ag.render(cx), "fold-t0");
  assert.equal(lit.hoverStyle.bg, undefined, "no ground, as T3's row controls");
  assert.deepEqual([lit.style.text_color, find(lit, "fold-t0-arrow-right").items[0].style.text_color], [f.theme().foreground, f.theme().foreground], "hovered, the arrow and the count brighten together");
  fire(lit, "on_hover", false, cx);
  assert.equal(find(ag.render(cx), "fold-t0-arrow-right").items[0].style.text_color, f.theme().dim);
  assert.equal(find(at, "status-t0").style.accessibility_label, "Needs you (sub-agent)", "folded status carries a more urgent hidden child");
  f.agents()[0].status = "blocked";
  assert.equal(find(ag.render(cx), "status-t0").style.accessibility_label, "Needs you", "a row as urgent as its children shows its own status");
  f.agents()[0].status = "idle";
  assert.equal(find(ag.render(cx), "status-t0").style.accessibility_label, "Needs you (sub-agent)");
  f.agents()[0].status = "working";
  const t0 = f.terminals().find(k => k.address === "t0");
  t0.labels = { "pi.session": "mine" };
  assert.ok(strings(find(ag.render(cx), "ag-t0")).includes("mine"), "a lone agent reads as its session, as in the inbox");
  f.agents().push({ ...f.agents()[0], address: "t1", pane: "p1", seq: 1, focused: false });
  f.terminals().push({ address: "t1", state: "live", labels: { "pi.session": "theirs" } });
  const shared = ag.render(cx);
  assert.ok(strings(find(shared, "ag-t0")).includes("mine") && strings(find(shared, "ag-t1")).includes("theirs"), "agents sharing a tab read as their own sessions");
  f.terminals().at(-1).labels = {};
  assert.ok(strings(find(ag.render(cx), "ag-t1")).includes("local task"), "without a session label it falls back to the tab");
  f.agents().pop(); f.terminals().pop(); delete t0.labels;
  assert.equal(f.slots.sidebar.size.px, width, "folding preserves sidebar width");
  fire(find(at, "fold-t0"), "on_click", {}, cx);
  at = ag.render(cx);
  assert.ok(find(at, "sub-child") && !strings(find(at, "fold-t0")).includes("2"), "the fold unfolds and drops its count");
  fire(find(at, "sub-child"), "on_click", {}, cx);
  assert.deepEqual(f.calls.pop(), ["terminal.peek", { terminal: "child" }]);
  fire(agent, "on_click", {}, cx);
  assert.deepEqual(f.calls.pop(), ["agent.focus", { terminal: "t0" }]);
  assert.equal(f.state["t3.pins"], undefined, "ordinary row click does not pin");
  fire(space, "on_mouse_down:left", {}, cx);
  fire(space, "on_mouse_up:left", {}, cx);
  assert.deepEqual(f.calls.pop(), ["space.select", { id: "s0" }]);
  fire(find(st, "space-s2"), "on_mouse_down:right", {}, cx);
  assert.deepEqual(JSON.parse(JSON.stringify(f.overlays.pop().props.target)), { id: "s2" });
  fire(find(at, "ag-sort"), "on_click", {}, cx);
  { const o = f.overlays.pop(); assert.equal(o.mod, "t3-agents"); assert.equal(o.at, undefined, "with no press, the app's default place"); }
  fire(find(at, "ag-sort"), "on_mouse_down:left", { bounds: { x: 300, y: 500, width: 28, height: 28 } }, cx);
  fire(find(at, "ag-sort"), "on_click", {}, cx);
  { const z = f.settings().zoom || 1; assert.deepEqual(plain(f.overlays.pop().at), { x: 328 - 200 * z, y: 528 + 4 * z }, "the sort menu hangs from its button, right edges together"); }
  fire(find(at, "ag-sort"), "on_mouse_down:left", {}, cx);
  f.load("t3-agents", { sortMenu: true }).close();
  fire(find(at, "ag-sort"), "on_click", {}, cx);
  assert.equal(f.overlays.length, 0, "pressing the open sort menu's button closes it without reopening");
  fire(find(at, "agent-fold-t0"), "on_click", {}, cx);
  assert.equal(find(ag.render(cx), "sub-grandchild"), null);
  fire(find(ag.render(cx), "agent-fold-t0"), "on_click", {}, cx);
  assert.ok(find(ag.render(cx), "sub-child"));
  // Moving down, the next row reports before the last one's leaving: a sub-agent's row takes over from its parent's card, up or still on its way.
  const settle = () => { while (cx.timers.length) { const t = cx.timers.shift(); if (!t.gone) t.fn(cx); } };
  for (const opened of [true, false]) {
    fire(find(ag.render(cx), "ag-t0"), "on_hover", true, cx);
    if (opened) { settle(); assert.ok(find(ag.render(cx), "details-t0")?.style.content, "a row's card opens"); }
    fire(find(ag.render(cx), "sub-child"), "on_hover", true, cx);
    fire(find(ag.render(cx), "ag-t0"), "on_hover", false, cx);
    settle();
    const open = ag.render(cx);
    assert.equal(find(open, "details-t0"), null, "a parent's card doesn't stay over its sub-agent's row");
    assert.deepEqual(strings(find(open, "details-sub-child").style.content), ["child task", "P", "project 0", "Pi"], "a sub-agent's card: its name, and the space it hangs in");
    fire(find(open, "sub-child"), "on_hover", false, cx);
    settle();
    assert.equal(find(ag.render(cx), "details-sub-child"), null, "and it goes with the pointer");
  }
  // Its click opens the peek where the card stands: the card goes at once, with no fade under it, and the row redraws to show that.
  fire(find(ag.render(cx), "sub-child"), "on_hover", true, cx);
  settle();
  let redrawn = false;
  fire(find(ag.render(cx), "sub-child"), "on_click", {}, { ...cx, notify() { redrawn = true; } });
  assert.ok(redrawn, "the click redraws the row");
  assert.equal(find(ag.render(cx), "details-sub-child").style.content, undefined, "no card under the peek");
  assert.deepEqual(f.calls.pop(), ["terminal.peek", { terminal: "child" }]);
  fire(find(ag.render(cx), "sub-child"), "on_hover", false, cx);
  settle();
  // A row that goes from under the pointer never reports its leaving: its card doesn't come back with it.
  const kid = f.terminals().find(k => k.address === "child");
  fire(find(ag.render(cx), "agent-fold-t0"), "on_click", {}, cx);
  fire(find(ag.render(cx), "sub-child"), "on_hover", true, cx);
  settle();
  kid.status = "working";
  assert.equal(find(ag.render(cx), "sub-child"), null, "folded, a sub-agent that's fine again has no row");
  kid.status = "error";
  assert.equal(find(ag.render(cx), "details-sub-child")?.style.content, undefined, "its row is back, with the pointer long gone: no card");
  fire(find(ag.render(cx), "agent-fold-t0"), "on_click", {}, cx);
  // A pinned sub-agent with a pane has two rows: hovering one isn't hovering the other, and the next one reporting first keeps the hover and the card.
  f.state["t3.pins"] = ["child"];
  f.agents().push({ address: "child", pane: "pn", space: "s1", space_name: "project 1", tab: "b1", title: "child task", seq: 9, program: f.agents()[0].program, focused: false, status: "working" });
  fire(find(ag.render(cx), "sub-child"), "on_hover", true, cx);
  settle();
  let both = ag.render(cx);
  assert.equal(find(both, "pin-child").style.opacity, 0, "its listed row doesn't look hovered");
  assert.equal(find(both, "details-child")?.style.content, undefined);
  assert.ok(find(both, "details-sub-child").style.content, "only the row hovered has a card");
  fire(find(both, "ag-child"), "on_hover", true, cx);
  fire(find(ag.render(cx), "sub-child"), "on_hover", false, cx);
  settle();
  both = ag.render(cx);
  assert.equal(find(both, "pin-child").style.opacity, 1, "the row now hovered keeps its hover");
  assert.ok(find(both, "details-child").style.content, "and shows its card");
  assert.equal(find(both, "details-sub-child")?.style.content, undefined);
  fire(find(both, "ag-child"), "on_hover", false, cx);
  settle();
  f.agents().pop();
  delete f.state["t3.pins"];
  ag.render(cx);
  settle();
  const beforePin = f.calls.length;
  let stopped = false;
  fire(find(ag.render(cx), "ag-t0"), "on_hover", true, cx);
  fire(find(ag.render(cx), "pin-t0"), "on_click", {}, { ...cx, stop_propagation() { stopped = true; } });
  assert.ok(stopped, "pin button stops propagation to the row");
  assert.ok(f.state["t3.pins"].includes("t0"));
  fire(find(ag.render(cx), "ag-t0"), "on_hover", true, cx);
  assert.equal(find(ag.render(cx), "pin-t0").items[0].source, "mods/t3-agents/icons/pin-off.svg", "pinned rows offer unpin");
  fire(find(ag.render(cx), "ag-t0"), "on_hover", false, cx);
  fire(find(ag.render(cx), "ag-t0"), "on_hover", true, cx);
  fire(find(ag.render(cx), "pin-t0"), "on_click", {}, cx);
  assert.deepEqual(f.calls.pop(), ["t3-tabs.unpin:t0", {}], "Lists unpin uses the shared Undo owner");
  f.load("t3-tabs").unpin("t0", cx);
  assert.equal(f.state["t3.pins"].includes("t0"), false, "unpin still persists");
  assert.equal(f.calls.length, beforePin, "pin and unpin do not focus a pane");
  fire(find(ag.render(cx), "ag-vps/t2"), "on_hover", true, cx);
  fire(find(ag.render(cx), "ag-t0"), "on_hover", false, cx);
  assert.equal(find(ag.render(cx), "pin-t0").handlers.on_click, undefined);
  fire(find(ag.render(cx), "pin-vps/t2"), "on_click", {}, cx);
  assert.deepEqual([...f.state["t3.pins"]], ["vps/t2"], "pin acts on the selected remote button");
  const header = f.load("t3-chrome").render(cx);
  // The toggle first, where it stays with the sidebar hidden, then Herdr's tile and name (brand.js), as T3's SidebarBrand; only
  // here: the hidden sidebar's row keeps the toggle alone. The mode switch is a setting and ⌘⇧L, not a button here.
  assert.deepEqual(header.items.map(n => n.key).filter(k => typeof k === "string"), ["tip-sidebar-toggle", "home", "tip-customize"], "the header holds the toggle, then Herdr's tile and name (Home, no tooltip), then Husain's Customize; search is a shortcut");
  assert.equal(find(header, "sidebar-mode"), null, "no mode button");
  assert.ok(walk(find(header, "home")).some(n => n.kind === "image" && n.source === "frame/welcome/herdr.png") && strings(find(header, "home")).includes("Herdr"), "Herdr's tile and name");
  const after = header.items[header.items.findIndex(n => n.key === "tip-sidebar-toggle") + 1];
  assert.deepEqual([header.style.pl, header.style.pr, find(header, "sidebar-toggle").style.h, find(header, "sidebar-toggle").style.w, find(header, "sidebar-toggle").style.rounded, after.style.w], [8, 8, 28, 28, 8, 8], "8 in with no window buttons of the layout's; T3's 28px toggle, the brand 8 after it, the sidebar's one gap between icons");
  fire(find(header, "sidebar-toggle"), "on_click", {}, cx);
  assert.deepEqual(f.calls.pop(), ["t3-tabs.toggle-sidebar", {}]);
  fire(find(header, "home"), "on_click", {}, cx);
  assert.deepEqual(f.calls.pop(), ["t3-tabs.home", {}]);
  {
    // Short of room the name goes whole, never cut to "Her…"; the tile stays and still goes Home. 8 in and 8 at the right, the
    // toggle's 28 and 8 after it, the button's 16 + 4, 40 of name.
    const brand = f.load("t3-chrome"), named = () => strings(find(brand.render(cx), "home")).includes("Herdr");
    fire(find(brand.render(cx), "home-name"), "on_size_change", { width: 40 }, cx);
    fire(brand.render(cx), "on_size_change", { width: 111 }, cx);
    assert.ok(!named(), "no room, no name");
    assert.ok(find(brand.render(cx), "home") && find(brand.render(cx), "sidebar-toggle"), "the tile and the toggle stay");
    fire(brand.render(cx), "on_size_change", { width: 112 }, cx);
    assert.ok(named(), "room for it whole, the name");
  }
  const footer = f.load("t3-chrome", { footer: true });
  const settings = find(footer.render(cx), "settings");
  assert.deepEqual([settings.style.h, settings.style.w, settings.items[0].style.size, settings.style.accessibility_label], [32, 32, 16, "Settings"], "as T3's footer: 32px icon buttons");
  assert.equal(find(footer.render(cx), "app-update"), null, "no update, no restart");
  f.ui.updates = { app: { ready: "0.9.1" } };
  const update = find(footer.render(cx), "app-update");
  assert.deepEqual(strings(update), ["Update"]);
  fire(update, "on_click", {}, cx);
  assert.deepEqual(f.calls.pop(), ["app.update", {}]);
  f.ui.updates = { app: {} };
  // The inbox's undo notice, in the footer's free space as T3's: short, then Undo, which the inbox does.
  f.state["t3.notice"] = { action: "Settled", count: 2, gen: 3, shown: true, live: true, at: Date.now() };
  assert.ok(find(footer.render(cx), "undo-notice-3"), "Lists have Undo too");
  f.slots["sidebar-lists"] = { id: "sidebar-lists", active: "inbox" };
  const note = find(footer.render(cx), "undo-notice-3");
  assert.deepEqual([strings(note), "flex_1" in note.style, note.style.text_size], [["Settled 2,", "⇧⌘Z to undo"], true, 11]);
  assert.ok("flex_none" in find(note, "undo-notice-undo").style && !("truncate" in note.items[0].style), "short of room the summary hides whole, never truncated to an ellipsis");
  fire(find(note, "undo-notice-undo"), "on_click", {}, cx);
  assert.deepEqual(f.calls.pop(), ["t3-tabs.undo", {}]);
  f.state["t3.notice"].count = 1;
  assert.deepEqual(strings(find(footer.render(cx), "undo-notice-3")), ["Settled,", "⇧⌘Z to undo"], "as T3's: the key in the button, no hover needed");
  f.state["t3.notice"].at = Date.now() - 60000;
  assert.equal(find(footer.render(cx), "undo-notice-3"), null, "one left from before a restart doesn't show");
  delete f.state["t3.notice"];
  delete f.slots["sidebar-lists"];
  const groups = ["pinned", "sp-s0"].map(id => find(ag.render(cx), id).style);
  assert.deepEqual([groups[0].h, groups[1].h], [32, 32], "T3's shelf and folder header");
  fire(settings, "on_click", {}, cx);
  assert.deepEqual(f.calls.pop(), ["app.settings", {}]);
}

{
  const f = fixture(208), ag = f.load("t3-agents");
  for (const status of ["working", "blocked", "idle", "done"]) {
    const slot = ag.status(f.theme(), { status });
    assert.equal(slot.style.size, 20, `${status} keeps the same status column`);
    const mark = slot.items[0];
    assert.ok(mark.style.w === 12 && "justify_center" in mark.style, `${status} mark is centred 12 wide, as T3's one-line row, so centers line up`);
    assert.ok("justify_end" in slot.style && !("justify_center" in slot.style), "marks sit flush right in the slot");
    assert.equal(slot.handlers.on_click, undefined, "status remains an indicator, not a pin target");
  }
  const at = ag.render(cx), heading = find(at, "agents-heading");
  assert.deepEqual([heading.style.pr, find(heading, "ag-sort").style.h, find(heading, "ag-sort").style.w, find(heading, "ag-sort").style.rounded], [8, 28, 28, 8], "T3's header button, 8 from the edge");
  assert.equal(heading.items[0].style.text_color, f.theme().muted, "section titles are a step brighter than group labels");
  // A space's group is T3's project folder: its mark and name, the chevron where the rows' content ends.
  const group = find(at, "sp-s0"), chevron = inFlow(group).at(-1);
  assert.deepEqual([group.style.px, group.style.rounded], [find(at, "ag-t0").style.px, 8]);
  assert.deepEqual(["down", "right"].map(w => find(chevron, `chevron-sp-s0-${w}`).style.opacity), [1, 0], "open, it points down, as T3's");
  assert.ok(strings(group).includes("project 0") && !strings(group).includes("1"), "open, it holds no count");
  fire(group, "on_hover", true, cx);
  const lit = find(ag.render(cx), "sp-s0");
  assert.equal(inFlow(lit).at(-1).style.text_color, f.theme().foreground, "it lights with its row");
  fire(lit, "on_mouse_down:right", {}, cx);
  assert.deepEqual(plain(f.overlays.pop().props), { tab: "space", target: { id: "s0" } }, "right-click is the space's menu");
  // An agent's row and a sub-agent's: the agent's menu, as its Inbox card's; it names the agent, the menu reads the rest.
  fire(find(ag.render(cx), "ag-t0"), "on_mouse_down:right", {}, cx);
  assert.deepEqual(plain(f.overlays.pop()), { mod: "t3-menu", kind: "popup", width: 220, height: 260, props: { tab: "agent", target: { address: "t0" } } });
  if (find(ag.render(cx), "sub-child")) {
    fire(find(ag.render(cx), "sub-child"), "on_mouse_down:right", {}, cx);
    assert.deepEqual(plain(f.overlays.pop().props), { tab: "agent", target: { address: "child" } });
  }
  fire(group, "on_hover", false, cx);
  // Closed, it says how many it hides and whether one wants you, and still shows the row you're on.
  f.agents().splice(1, 0, { ...f.agents()[0], address: "t9", pane: "p9", seq: 9, focused: false, status: "blocked", title: "stuck" });
  f.terminals().push({ address: "t9", state: "live", status: "blocked" });
  ag.toggleFold("sp-s0", cx, false);
  const shut = ag.render(cx), closed = find(shut, "sp-s0");
  assert.ok(find(shut, "ag-t0") && !find(shut, "ag-t9"), "a closed folder keeps the row in view, and only it");
  assert.ok(strings(closed).includes("1"), "the count leaves out the row still showing");
  assert.equal(inFlow(closed).find(n => n.style.size === 6).style.bg, f.theme().blocked, "the dot speaks for what's hidden");
  ag.toggleFold("sp-s0", cx, false);
  f.agents().splice(1, 1); f.terminals().pop();
  // The list's motion: a row that moved is drawn where it was under a new id, then let go; one that left fades out where it
  // was, drawn inert; folds and the sort play it too, as this list starts at the top (T3 skips only a bottom shelf's opening).
  const y = (tree, id) => walk(tree).find(n => String(n.key).startsWith(`fly-${id}-`));
  const leaving = (tree, key) => walk(tree).find(n => String(n.key).startsWith(`leaving-${key}-`));
  const fireTimers = ms => { const due = cx.timers.filter(t => t.ms === ms); cx.timers = cx.timers.filter(t => t.ms !== ms); for (const t of due) if (!t.gone) t.fn(cx); };
  // Drawn for its leaving: no handlers, no tooltip, and no id the list uses.
  const inert = n => walk(n.items[0]).every(c => !Object.keys(c.handlers).length && typeof c.key !== "string");
  cx.timers.length = 0;
  const remote = f.agents().find(a => a.address === "vps/t2"), wasStatus = remote.status;
  remote.status = "working";
  f.state["agents.sort"] = "priority";
  const folder = leaving(ag.render(cx), "m:sp-s0");
  assert.ok(folder && strings(folder).includes("project 0") && inert(folder), "a space's folder leaves inert");
  const before = y(ag.render(cx), "t0");
  remote.status = "blocked";
  const moved = y(ag.render(cx), "t0");
  assert.ok(moved.key !== before.key && moved.style.top < 0, "the moved row starts from above, where it was");
  fireTimers(16);
  assert.equal(y(ag.render(cx), "t0").style.top, 0, "then it's let go");
  remote.status = wasStatus;
  f.state["agents.sort"] = "grouped";
  const sorted = ag.render(cx), head = leaving(sorted, "m:sec-4");
  assert.ok(head && strings(head).includes("Needs you") && inert(head), "switching the sort, the old headers fade out");
  assert.ok("relative" in find(sorted, "ag-content").style && find(sorted, "ag-content").items.includes(head), "in the rows' box, so they scroll with it");
  assert.equal(y(sorted, "m:sp-s0").style.opacity, 0, "and the new ones fade in");
  fireTimers(16);
  assert.deepEqual([leaving(ag.render(cx), "m:sec-4").style.opacity, y(ag.render(cx), "m:sp-s0").style.opacity], [0, 1]);
  fireTimers(200);
  assert.equal(leaving(ag.render(cx), "m:sec-4"), undefined, "faded, they go");
  // Unfolding sub-agents: the new one fades in, the rows under it slide down from where they were.
  const below = y(ag.render(cx), "m:sp-s2").key;
  ag.toggleFold("t0", cx);
  const unfolded = ag.render(cx);
  assert.equal(y(unfolded, "sub-grandchild").style.opacity, 0, "a fold fades its rows in");
  assert.ok(y(unfolded, "m:sp-s2").key !== below && y(unfolded, "m:sp-s2").style.top < 0, "and slides the rows under it");
  fireTimers(16);
  ag.toggleFold("t0", cx);
  const gone = leaving(ag.render(cx), "sub-grandchild");
  assert.ok(gone && strings(gone).includes("grandchild task") && inert(gone), "folding, they fade out");
  fireTimers(16);
  fireTimers(200);
  // Closing a space's folder, its rows leave inert too.
  ag.toggleFold("sp-s2", cx, false);
  assert.ok(inert(leaving(ag.render(cx), "vps/t2")), "an agent's row leaves inert too");
  fireTimers(16); fireTimers(200);
  ag.toggleFold("sp-s2", cx, false);
  ag.render(cx); fireTimers(16); fireTimers(200);
  // The sort menu, as T3's: nothing lit until a key or the pointer arrives.
  const f2 = fixture(256), menu = f2.load("t3-agents", { sortMenu: true, overlay: "o" });
  const m0 = menu.render(cx);
  assert.equal(find(m0, "sort-priority").style.bg, undefined, "no highlight on opening");
  assert.equal(find(m0, "sort-priority").style.h, 28);
  // Lit only while the pointer is on the row, as every menu's (t3-tokens「菜单行」).
  const sortLit = () => find(menu.render(cx), "sort-priority").style.bg;
  fire(find(menu.render(cx), "sort-priority"), "on_hover", true, cx);
  assert.equal(sortLit(), f2.theme().selected, "the pointer on it lights it");
  fire(find(menu.render(cx), "sort-priority"), "on_hover", false, cx);
  assert.equal(sortLit(), undefined, "the pointer gone, nothing stays lit");
  assert.equal(find(f.load("t3-spaces").render(cx), "spaces-heading").items[0].style.text_color, f.theme().muted);
}

{
  // A card from another machine says so as T3's does: a server mark before its program, the machine named on hover.
  const f = fixture(256), root = f.load("t3-inbox").render(cx);
  const card = find(root, "card-vps/t2"), mark = find(card, "machine-vps/t2");
  assert.equal(find(root, "tip-machine-vps/t2"), null, "the row's details name the machine, with no separate tooltip");
  assert.ok(walk(mark).some(n => n.source === "mods/t3-inbox/icons/server.svg"));
  // Husain's: every card ends with a line naming its machine, this computer's as local.
  assert.ok(strings(mark).includes("vps"), "the machine is spelled out on the card's last line");
  assert.ok(strings(find(find(root, "card-t0"), "machine-t0")).includes("local"), "this computer's cards say local");
  // A right-click is the agent's menu, as its Agents row's; the Inbox on its own has no menu to open.
  assert.equal(find(root, "card-t0").handlers["on_mouse_down:right"], undefined);
  fire(find(f.load("t3-inbox", { menu: "t3-menu" }).render(cx), "card-t0"), "on_mouse_down:right", {}, cx);
  assert.deepEqual(plain(f.overlays.pop()), { mod: "t3-menu", kind: "popup", width: 220, height: 260, props: { tab: "agent", target: { address: "t0" } } });
}
{
  // Agents' times come from when the tab changed, not when the list next draws, and go on by themselves.
  const f = fixture(256), run = { ...cx, spawn: fn => { fn(run); } }, ticks = [], every = cx.timer.every;
  cx.timer.every = ms => ticks.push(ms);
  const ag = f.load("t3-agents");
  cx.timer.every = every;
  assert.ok(ticks.includes(30000), "its times move though nothing else does");
  const [t0] = f.agents(), tab = f.spaces()[0].tabs[0];
  ag.render(cx);
  t0.status = "idle"; tab.changed_at = Date.now() - 2 * 3600000;
  assert.ok(strings(find(ag.render(cx), "when-t0")).includes("2h"), "back from the Inbox, it ended two hours ago, not now");
  // A pin ends a snooze though the Inbox isn't running; pins that aren't new, and agents not snoozed, write no label.
  const k = f.terminals().find(k => k.address === "t0");
  k.labels = { snoozed: String(Date.now() + 60000) };
  const tabs = f.load("t3-tabs");
  const pin = () => {
    fire(find(ag.render(run), "ag-t0"), "on_hover", true, run);
    fire(find(ag.render(run), "pin-t0"), "on_click", {}, run);
    if (f.calls.at(-1)?.[0] === "t3-tabs.unpin:t0") { f.calls.pop(); tabs.unpin("t0", run); }
  };
  pin();
  assert.deepEqual(f.labelled.splice(0), [["label", "t0", "snoozed="]]);
  pin();
  assert.deepEqual(f.labelled.splice(0), [], "unpinning leaves labels alone");
  k.labels = {};
  pin();
  assert.deepEqual(f.labelled.splice(0), [], "nothing to end");
  pin();
  // A group whose last agent ended never reports the pointer leaving: it isn't lit when it comes back.
  fire(find(ag.render(cx), "sp-s2"), "on_hover", true, cx);
  const stayed = f.agents().splice(1, 1);
  ag.render(cx);
  f.agents().push(...stayed);
  assert.equal(find(ag.render(cx), "sp-s2").items.at(-1).style.text_color, f.theme().dim);
}
async function checkInbox() {
  // The inbox: Working holds busy trees; Settle is by hand, undone by new work, never by looking.
  const f = fixture(256), inbox = f.load("t3-inbox"), run = { ...cx, spawn: fn => { fn(run); } };
  const remote = f.agents()[1], k = f.terminals().find(k => k.address === "vps/t2"), child = f.terminals().find(c => c.address === "child");
  child.status = "idle";
  assert.deepEqual(strings(find(inbox.render(run), "working-header")), ["Working", "1"], "a working tree moves down to Working");
  fire(find(inbox.render(run), "card-t0"), "on_hover", true, run);
  // Settle sits in the corner faded out, fading in over the state when it's offered (T3's group-hover crossfade).
  const hidden = find(inbox.render(run), "settle-t0"), labels = f.labelled.length;
  assert.ok(hidden.style.opacity === 0 && !("role" in hidden.style) && !hidden.handlers.on_click && !hidden.handlers["on_mouse_down:left"], "a working tree can't be settled: faded, its button takes no press");
  assert.equal(f.labelled.length, labels);
  assert.deepEqual(JSON.parse(JSON.stringify(hidden.style.transition)), ["opacity", { duration: 150, easing: "ease-out" }]);
  assert.equal(find(find(inbox.render(run), "card-t0"), "state-t0").style.opacity ?? 1, 1);
  remote.status = "done"; k.turn = 4;
  fire(find(inbox.render(run), "card-vps/t2"), "on_hover", true, run);
  const offered = inbox.render(run);
  assert.equal(find(offered, "settle-vps/t2").style.opacity, 1);
  assert.equal(find(offered, "settle-vps/t2").hoverStyle.bg, undefined, "as T3's, a card's button only lights up: no ground");
  assert.equal(walk(find(offered, "corner-vps/t2")).find(n => n.style.opacity === 0 && walk(n).some(c => c.key === "state-vps/t2" || strings(c).length)) != null, true, "the state fades out under it");
  fire(find(inbox.render(run), "settle-vps/t2"), "on_click", {}, run);
  const [, , value] = f.labelled.pop();
  assert.match(value, /^settled=\d+:4$/, "the label keeps when and the turn it was settled at");
  k.labels = { settled: value.slice(8) };
  await new Promise(setImmediate);
  const at = inbox.render(run);
  assert.ok(!find(at, "card-vps/t2") && strings(find(at, "settled-header")).includes("1"), "settled leaves the cards for the tail");
  {
    // The settle key (t3-inbox.settle) acts on the agent in view: a busy one stays, a settled one comes back, then goes again.
    const t0 = f.agents()[0], n = f.labelled.length;
    inbox.render(run); inbox.settleKey(run);
    assert.equal(f.labelled.length, n, "the key doesn't settle a working agent");
    t0.focused = false; remote.focused = true;
    inbox.render(run); inbox.settleKey(run);
    assert.deepEqual(f.labelled.pop(), ["label", "vps/t2", "settled="], "on a settled agent the key brings it back");
    k.labels = {};
    await new Promise(setImmediate);
    inbox.render(run); inbox.settleKey(run);
    const [, , again] = f.labelled.pop();
    assert.match(again, /^settled=\d+:4$/, "and settles it again");
    k.labels = { settled: again.slice(8) };
    await new Promise(setImmediate);
    t0.focused = true; remote.focused = false;
  }
  {
    // Settled folds and pages without a Clear control; ending settled processes is Clean up.
    f.spaces()[0].tabs[0].active = true;
    inbox.open = true;
    assert.equal(find(inbox.render(run), "settled-clear"), null, "Settled has no Clear button");
  }
  remote.focused = true;
  inbox.render(run);
  assert.equal(f.labelled.length, 0, "looking doesn't bring it back");
  k.turn = 5;
  inbox.render(run);
  assert.deepEqual(f.labelled.pop(), ["label", "vps/t2", "settled="], "a turn ended since brings it back");
  // The space filter, as T3's project scope: picking a space hides the others' agents; All spaces brings them back.
  const scope = (id) => fire(find(find(inbox.render(run), "inbox-scope-menu").style.content, `scope-${id}`), "on_click", { modifiers: {} }, run);
  scope("s2");
  assert.ok(find(inbox.render(run), "card-vps/t2") && !find(inbox.render(run), "working-header"), "only the chosen space's agents");
  scope("all");
  assert.ok(find(inbox.render(run), "working-header"), "all spaces again");
  // With the inbox showing, a settled agent's done is no news.
  f.slots["sidebar-lists"] = { id: "sidebar-lists", active: "inbox" };
  f.spaces()[0].tabs[0].status = "done"; f.agents()[0].status = "done";
  for (const k of f.terminals()) if (k.parent) k.status = "idle";
  f.terminals().find(c => c.address === "t0").labels = { settled: "1:0" };
  assert.equal(walk(find(f.load("t3-tabs").render(cx), "tab-b0")).some(n => n.style.rounded_full), false, "no done dot for a settled agent's tab");
  {
    // The panes you were in, newest first, for Go to: t3-tabs' keys copy keeps them as focus moves, however it moved; a closed one goes.
    const tabs = f.load("t3-tabs", { part: "keys" }), recent = () => plain(f.state["t3-tabs.recent"]);
    f.shown.pane = "p0"; tabs.render(cx); f.shown.pane = "p2"; tabs.render(cx);
    assert.deepEqual(recent(), ["p2", "p0"]);
    f.shown.pane = "p0"; tabs.render(cx); tabs.render(cx);
    assert.deepEqual(recent(), ["p0", "p2"], "back to one moves it up, once");
    const gone = f.panes().splice(1, 1); tabs.render(cx);
    assert.deepEqual(recent(), ["p0"], "a closed pane leaves it");
    f.panes().splice(1, 0, ...gone); delete f.state["t3-tabs.recent"];
  }
  f.terminals().find(c => c.address === "t0").labels = { snoozed: String(Date.now() + 60000) };
  assert.equal(walk(find(f.load("t3-tabs").render(cx), "tab-b0")).some(n => n.style.rounded_full), false, "nor for a snoozed one's");
  // Hidden, the sidebar's toggle is its icon alone, whatever the agents are doing: how they are is the sidebar's to show.
  f.terminals().find(c => c.address === "child").status = "error"; f.slots.sidebar.hidden = true;
  const quiet = find(f.load("t3-tabs").render(cx), "sidebar-toggle");
  assert.equal(quiet.items.length, 1, "a sub-agent stuck: still just the icon");
  assert.equal(quiet.style.accessibility_label, "Show sidebar");
  delete f.slots.sidebar.hidden;
}

{
  // A parent's unread reply shows first, its working sub-agents beside it; once read, waiting on them is
  // working, everywhere, for as long as the longest-working one has worked.
  const f = fixture(256), inbox = f.load("t3-inbox");
  f.agents()[0].status = "idle"; f.terminals().find(c => c.address === "child").status = "idle";
  /** @type {any} */ (f.terminals().find(c => c.address === "grandchild")).status_ms = Date.now() - 90000;
  assert.deepEqual(strings(find(inbox.render(cx), "state-t0")), ["Working", "1m"], "the waiting parent shows its sub-agent's working time");
  f.agents()[0].status = "done"; f.panes()[0].status = "done";
  const drawn = inbox.render(cx);
  assert.ok(strings(find(drawn, "state-t0")).includes("Done"), "an unread reply isn't hidden by a working sub-agent");
  assert.ok(!find(drawn, "subs-t0") && !strings(drawn).some(s => s.includes("sub-agent")), "as T3's sidebar, a card says nothing of its sub-agents");
  assert.equal(find(f.load("t3-agents").render(cx), "status-t0").style.accessibility_label, "Done");
  assert.ok(walk(find(f.load("t3-tabs").render(cx), "tab-b0")).some(n => n.style.rounded_full), "its tab shows the done dot");
  f.agents()[0].status = "idle"; f.panes()[0].status = "idle";
  assert.deepEqual(strings(find(inbox.render(cx), "state-t0")), ["Working", "1m"], "read, the run goes on from its start");
  assert.equal(find(f.load("t3-agents").render(cx), "status-t0").style.accessibility_label, "Working (sub-agent)", "a read parent waiting on a sub-agent is working");
  const works = tree => walk(tree).some(n => n.source?.endsWith("/icons/circle-dashed.svg"));
  assert.ok(works(find(f.load("t3-tabs").render(cx), "tab-b0")), "its tab still shows it working");
  const header = f.load("t3-pane", { pane: "p0" }).render(cx);
  assert.ok(!find(header, "ph-mark-p0") && works(find(header, "ph-kids-p0")), "its pane header says its own agent is idle; the sub-agent button marks the rest at work");
}

{
  // A mod pane's word marks its tab as an agent's would; a closed pane's says nothing.
  const f = fixture(256);
  const works = tree => walk(tree).some(n => n.source === "mods/t3-tabs/icons/circle-dashed.svg");
  f.spaces()[0].tabs.push({ id: "bx", name: "review", named: true, active: false });
  f.panes().push({ pane: "p9", terminal: null, mod: "review", tab: "bx", title: "review" });
  const tab = () => find(f.load("t3-tabs").render(cx), "tab-bx");
  assert.ok(!works(tab()) && !strings(tab()).includes("!") && !walk(tab()).some(n => n.style.rounded_full), "nothing reported, no mark");
  f.state["review.status"] = { bx: "working" };
  assert.ok(works(tab()), "a run shows the working mark");
  f.state["review.status"] = { bx: "blocked" };
  assert.ok(strings(tab()).includes("!"), "a failure shows the badge");
  f.state["review.status"] = { bx: "done" };
  assert.ok(walk(tab()).some(n => n.style.rounded_full), "a finished run shows the dot");
  f.state["review.status"] = { bx: "working" };
  f.panes().pop();
  assert.ok(!works(tab()), "its pane closed, its word is left behind");
}

{
  // Dragging, as T3's sidebar: labels and gaps open only while a row is lifted; Pinned pins and reorders,
  // Active unpins and unsettles, Settled settles; empty sections take drops; Esc, leaving, or a row
  // vanishing put it back; Working never lifts; a sweep from Settle or undo takes a run of rows along.
  const f = fixture(256), run = { ...cx, spawn: fn => { fn(run); } }, inbox = f.load("t3-inbox");
  for (const a of f.agents()) { a.status = "done"; a.focused = false; }
  for (const k of f.terminals()) if (k.parent) k.status = "idle";
  const t0 = f.terminals().find(k => k.address === "t0");
  const pins = () => [...(f.state["t3.pins"] ?? [])];
  const root = () => inbox.render(run);
  const h = (id) => find(root(), id)?.style.h;
  const badge = (v) => find(find(root(), "drag-ghost"), `badge-${v}`);
  // Press 10px into an 80px row, then move: the sidebar sees the pointer at y.
  const lift = (from, y = 20) => {
    fire(find(root(), from), "on_mouse_down:left", { position: { x: 0, y: 0 }, local_position: { x: 0, y: 10 }, bounds: { height: 80 } }, run);
    fire(root(), "on_mouse_move", { position: { x: 0, y }, local_position: { x: 0, y: 100 + y } }, run);
  };
  const over = (to, y = 10) => fire(find(root(), to), "on_mouse_move", { local_position: { x: 0, y }, bounds: { height: 80 } }, run);
  const release = () => fire(root(), "on_mouse_up:left", {}, run);
  const drag = (from, to, y) => { lift(from); over(to, y); release(); };

  assert.equal(h("pinned"), 0, "no Pinned or Active label until something is lifted");
  f.shown.pane = "p9";
  lift("card-t0", 5);
  assert.equal(find(root(), "drag-ghost"), null, "under 6px it's still a click");
  release();
  lift("card-vps/t2");
  assert.ok(find(find(root(), "drag-ghost"), "ghost-card-vps/t2"), "the lifted card follows the pointer");
  assert.equal(find(root(), "drag-ghost").style.top, 110, "the pressed spot stays under the pointer");
  assert.equal(h("pinned"), 24); assert.equal(h("active"), 24, "the labels open while it's lifted");
  assert.equal(h("hold-vps/t2"), 85, "it holds its place, spacing included");
  assert.equal(badge("pin"), null, "over its own section it says nothing");
  over("pinned");
  assert.equal(h("hold-vps/t2"), 0, "headed elsewhere, its place folds");
  assert.equal(h("gap-head-pinned"), 85, "and empty Pinned opens a gap under its label");
  assert.ok(badge("pin"), "the lifted card says Pin");
  release();
  assert.deepEqual(pins(), ["vps/t2"]);
  assert.ok(find(f.load("t3-agents").render(cx), "pinned"), "the agents list shows the same pin");
  assert.deepEqual(f.calls.pop(), ["pane.focus", { pane: "p9" }], "letting go hands the keyboard back to the pane that had it");
  assert.equal(h("pinned"), 0, "the labels close again");
  assert.ok(walk(find(root(), "card-vps/t2")).some(n => n.source === "mods/t3-inbox/icons/pin.svg"), "a pin shows its glyph");

  lift("card-t0"); over("card-vps/t2", 10);
  assert.equal(h("gap-vps/t2"), 85, "the upper half of a pin opens a gap above it");
  over("card-vps/t2", 60);
  assert.equal(h("gap-vps/t2"), 0);
  assert.equal(h("gap-end-pinned"), 85, "the lower half opens it below");
  assert.deepEqual(JSON.parse(JSON.stringify(find(root(), "gap-end-pinned").style.transition)), ["height", { duration: 150, easing: "ease-out" }], "gaps slide natively");
  release();
  assert.deepEqual(pins(), ["vps/t2", "t0"]);
  lift("card-t0"); over("card-vps/t2", 10);
  assert.equal(badge("pin"), null, "reordering pins says nothing");
  release();
  assert.deepEqual(pins(), ["t0", "vps/t2"], "within Pinned it reorders");
  drag("card-t0", "card-t0", 70);
  assert.deepEqual(pins(), ["t0", "vps/t2"], "back over its own place, nothing changes");

  lift("card-t0");
  assert.ok(find(root(), "active-placeholder"), "empty Active shows a dashed drop target");
  over("active-placeholder");
  assert.equal(find(root(), "active-placeholder"), null);
  assert.equal(h("gap-head-active"), 85, "targeted, it opens a gap instead");
  assert.ok(badge("unpin"));
  release();
  assert.deepEqual(pins(), ["vps/t2"], "onto Active unpins");

  lift("card-t0");
  assert.ok(find(root(), "settled-header") && find(root(), "settled-placeholder"), "Settled shows while dragging, even empty");
  over("settled-header");
  assert.ok(badge("settle"));
  release();
  const [, addr, value] = f.labelled.pop();
  assert.equal(addr, "t0");
  assert.match(value, /^settled=\d+:/, "dropped on Settled, it's settled");
  t0.labels = { settled: value.slice(8) };
  inbox.open = true;
  // As T3's settled rows, it leads with its project's mark, the one its card shows, not its program's icon.
  const mark = find(root(), "slim-mark-t0");
  assert.deepEqual(strings(mark), ["P"], "project 0's monogram");
  assert.ok(!walk(mark).some(n => n.kind === "svg" && n.source === "icons/pi.svg"), "no program icon");
  lift("slim-t0");
  assert.ok(find(find(root(), "drag-ghost"), "ghost-slim-t0"), "a settled row lifts as its row");
  over("card-vps/t2", 10);
  assert.equal(h("gap-vps/t2"), 83, "the gap is the destination's: a card");
  assert.ok(badge("pin"), "a settled row can be pinned");
  over("active-rest");
  assert.equal(h("gap-head-active"), 83, "the empty space above the shelves counts as Active");
  assert.ok(badge("unsettle"));
  release();
  assert.deepEqual(f.labelled.pop(), ["label", "t0", "settled="], "dropped on Active, it's unsettled");
  assert.deepEqual(pins(), ["vps/t2"]);
  lift("card-t0");
  assert.equal(find(root(), "drag-ghost"), null, "a row whose change hasn't landed yet stays put");
  release();
  t0.labels = {};

  f.state["t3.pins"] = [];
  fire(find(root(), "card-t0"), "on_hover", true, run);
  const settleButton = find(root(), "settle-t0");
  fire(settleButton, "on_mouse_down:left", { position: { x: 0, y: 0 } }, { ...run, stop_propagation() {} });
  fire(root(), "on_mouse_move", { position: { x: 0, y: 20 }, local_position: { x: 0, y: 120 } }, run);
  over("card-vps/t2");
  assert.ok(find(find(root(), "card-t0"), "badge-settle") && find(find(root(), "card-vps/t2"), "badge-settle"), "a sweep from Settle marks the run");
  assert.equal(find(root(), "drag-ghost"), null, "a sweep lifts nothing");
  release();
  assert.deepEqual(f.labelled.splice(0).map(([, a, v]) => [a, v.split("=")[0]]).sort(), [["t0", "settled"], ["vps/t2", "settled"]], "letting go settles every marked row");
  fire(settleButton, "on_click", {}, run);
  assert.equal(f.labelled.length, 0, "the button's click after a sweep doesn't settle again");
  // As core writes them back: the label the settle set, else the row stays pending and won't lift (its stamp is ms).
  for (const k of [t0, f.terminals().find(k => k.address === "vps/t2")]) k.labels = { settled: inbox.pending.settled[k.address] ?? `${Date.now()}:0` };

  const n = f.labelled.length;
  lift("slim-vps/t2"); over("active");
  fire(root(), "on_key_down", { keystroke: "escape" }, run);
  assert.equal(find(root(), "drag-ghost"), null, "Esc puts it back");
  release();
  lift("slim-vps/t2"); over("active");
  fire(root(), "on_hover", false, run);
  assert.equal(find(root(), "drag-ghost"), null, "leaving off a side puts it back");
  release();
  const before = f.calls.length;
  lift("slim-vps/t2"); over("active");
  assert.ok(find(root(), "drag-ghost"), "the drag is under way before its row leaves");
  const gone = f.agents().splice(1, 1)[0];
  assert.equal(find(root(), "drag-ghost"), null, "a row that leaves the list ends the drag");
  f.agents().push(gone);
  release();
  assert.deepEqual(f.calls.slice(before), [["pane.focus", { pane: "p9" }]], "and the release still hands the keyboard back");
  assert.equal(f.labelled.length, n, "none of those changed anything");
  // Off the bottom edge, past the Settled shelf, it lands where the badge said (Herdr reports no release outside).
  fire(root(), "on_size_change", { width: 256, height: 900 }, run);
  for (const k of f.terminals()) if (k.address === "vps/t2") k.labels = {};
  lift("card-vps/t2");
  fire(root(), "on_mouse_move", { position: { x: 0, y: 40 }, local_position: { x: 130, y: 895 } }, run);
  over("settled-header");
  fire(root(), "on_hover", false, run);
  assert.equal(find(root(), "drag-ghost"), null);
  assert.deepEqual(f.labelled.pop()?.slice(0, 2), ["label", "vps/t2"], "leaving off the bottom settles it");
  const calls = f.calls.length;
  lift("slim-vps/t2"); over("slim-vps/t2");
  fire(find(root(), "slim-vps/t2"), "on_click", {}, run);
  release();
  assert.ok(!f.calls.slice(calls).some(([name]) => name === "agent.focus"), "a drag's release doesn't open the row");

  const old = fixture(256);
  old.stores.set("t3-agents", new Map([["pins", '["t0"]']]));
  old.load("t3-agents");
  assert.deepEqual([...old.state["t3.pins"]], ["t0"], "older pins move to the shared set, so a drag in the inbox keeps them");

  const w = fixture(256), wf = w.load("t3-inbox");
  for (const k of w.terminals()) if (k.parent) k.status = "idle";
  fire(find(wf.render(cx), "card-t0"), "on_mouse_down:left", { position: { x: 0, y: 0 }, local_position: { x: 0, y: 10 }, bounds: { height: 80 } }, cx);
  fire(wf.render(cx), "on_mouse_move", { position: { x: 0, y: 30 }, local_position: { x: 0, y: 130 } }, cx);
  assert.equal(find(wf.render(cx), "drag-ghost"), null, "a working card doesn't lift");
}

{
  const f = fixture(256), sp = f.load("t3-spaces"), ag = f.load("t3-agents");
  let root = sp.render(cx);
  // The Spaces/Agents divider is the layout's own, as upstream: neither list sizes it.
  for (const tree of [root, ag.render(cx)]) assert.equal(walk(tree).filter(n => "on_size_change" in n.handlers).length, 0, "no list measures itself to move the divider");
  assert.ok(!f.calls.some(([name]) => name === "layout.resize"), "rendering never resizes the layout");
  // Dragging, as the inbox's: rows are 32px, this computer's header, s0, s1, then vps's header and s2.
  const press = (id, y = 0) => fire(find(sp.render(cx), id), "on_mouse_down:left", { position: { x: 0, y } }, cx);
  const move = (y, x = 0) => fire(find(sp.render(cx), "space-list"), "on_mouse_move", { position: { x, y } }, cx);
  const release = () => fire(find(sp.render(cx), "space-list"), "on_mouse_up:left", {}, cx);
  const keyOf = n => "key" in n ? n.key : null;
  const rows = tree => find(tree, "space-rows").items.filter(n => keyOf(n)?.startsWith("fly-")).map(n => keyOf(n.items[0]) ?? `gap-${n.items[0].style.h}`);
  const fly = (tree, key) => walk(tree).find(n => keyOf(n)?.startsWith(`fly-${key}-`));
  const moves = () => f.calls.filter(([name]) => name === "space.move");
  {
    // A machine's lit chevron goes with the pointer even when its leave never comes, as an agents group's does.
    const every = cx.timer.every, watches = [], scope = f.scopes.get("t3-spaces"), was = scope.window.mouse_position;
    cx.timer.every = (ms, fn) => { const t = { ms, fn, cancel() { t.gone = true; } }; watches.push(t); return t; };
    scope.window.mouse_position = () => ({ x: 10, y: 10 });
    fire(find(sp.render(cx), "machine-local"), "on_hover", true, cx);
    fire(find(sp.render(cx), "machine-local"), "on_mouse_move", { position: { x: 10, y: 10 }, bounds: { x: 0, y: 0, width: 208, height: 32 } }, cx);
    scope.window.mouse_position = () => ({ x: 10, y: 300 });
    watches.at(-1).fn(cx);
    assert.equal(sp.overMachine, null, "off it, no leave needed");
    cx.timer.every = every; scope.window.mouse_position = was;
  }
  press("space-s0"); move(4, 3);
  assert.equal(find(sp.render(cx), "space-lifted"), null, "under 6px it's still a click");
  const still = find(sp.render(cx), "space-s0");
  fire(still, "on_mouse_up:left", {}, cx);
  assert.deepEqual(f.calls.pop(), ["space.select", { id: "s0" }], "a press that didn't move selects");
  release();
  // The first frame lifted is the list as it was, the gap in its place, nothing fading; the next opens the gap where it lands.
  press("space-s0"); move(40);
  root = sp.render(cx);
  assert.deepEqual(rows(root), ["machine-local", "gap-32", "space-s1", "machine-vps", "space-s2"]);
  fire(find(sp.render(cx), "machine-local"), "on_mouse_down:right", {}, cx);
  assert.deepEqual(plain(f.overlays.pop().props), { tab: "machine", target: { machine: null, connected: true, connect: false } }, "a machine's heading: its + in a menu");
  assert.equal(find(sp.render(cx), "machine-vps").handlers["on_mouse_down:right"], undefined, "asleep, with nothing to offer, no menu");
  assert.ok(!find(root, "space-rows").items.some(n => keyOf(n)?.startsWith("leaving-")), "nothing leaves: the lifted row is still there");
  root = sp.render(cx);
  assert.deepEqual([rows(root)[2], fly(root, "space-s1").style.top], ["gap-32", 33], "then the rows make way, sliding");
  fire(find(root, "space-list"), "on_hover", false, cx);
  f.calls.splice(0);
  press("space-s0"); move(10);
  root = sp.render(cx);
  assert.deepEqual(rows(root), ["machine-local", "gap-32", "space-s1", "machine-vps", "space-s2"], "lifted, its place holds a gap");
  const lifted = find(root, "space-lifted");
  assert.equal(lifted.style.top, 43, "it rides the pointer");
  assert.ok(strings(lifted).includes("project 0"));
  sp.hot = "space-new"; sp.overMachine = "machine-local";
  root = sp.render(cx);
  assert.deepEqual([sp.hot, sp.overMachine, find(root, "space-s1").hoverStyle.bg, find(root, "space-s1").style.active], [null, null, undefined, undefined], "while lifted, nothing lights under it");
  fire(still, "on_mouse_up:left", {}, cx);
  assert.ok(!f.calls.some(([name]) => name === "space.select"), "a drag's release doesn't select");
  // Past s1's middle, measured from the rows without the lifted one, s1 makes way, sliding up.
  move(24);
  root = sp.render(cx);
  assert.deepEqual(rows(root), ["machine-local", "space-s1", "gap-32", "machine-vps", "space-s2"], "the list opens where it would land");
  assert.equal(fly(root, "space-s1").style.top, 33, "s1 slides up from where it was");
  assert.equal(find(root, "space-lifted").style.top, 57);
  // Half a row onto vps's rows: no machine takes another's space, so it goes back where it was.
  move(60);
  assert.deepEqual(rows(sp.render(cx)), ["machine-local", "gap-32", "space-s1", "machine-vps", "space-s2"], "over another machine, the gap goes home");
  release();
  assert.deepEqual(moves(), [], "cross-machine drag remains rejected");
  assert.equal(fly(sp.render(cx), "space-s0").style.top, 93 - 33, "and it slides back from where it was let go");
  press("space-s0"); move(10); sp.render(cx); move(24); sp.render(cx);
  release();
  assert.deepEqual(moves(), [["space.move", { id: "s0", index: 2 }]], "let go, it lands where the gap was");
  root = sp.render(cx);
  assert.deepEqual(rows(root), ["machine-local", "space-s1", "space-s0", "machine-vps", "space-s2"], "until the move's echo, the rows stay as they were let go");
  assert.deepEqual([fly(root, "space-s0").style.top, fly(root, "space-s0").style.opacity], [57 - 66, 1], "it slides from where it was let go to its place");
  f.spaces().splice(1, 0, f.spaces().shift()); // The move's echo.
  assert.deepEqual(rows(sp.render(cx)), ["machine-local", "space-s1", "space-s0", "machine-vps", "space-s2"]);
  assert.equal(moves().length, 1, "echoing the move needs no further write");
  f.spaces().splice(0, 0, f.spaces().splice(1, 1)[0]);
  sp.render(cx);
  // vps's one space has nowhere to go in its machine; pulled up into this computer's rows, it stays.
  press("space-s2", 0); move(-10); sp.render(cx); move(-60); sp.render(cx);
  assert.deepEqual(rows(sp.render(cx)), ["machine-local", "space-s0", "space-s1", "machine-vps", "gap-32"]);
  release();
  assert.deepEqual(moves().length, 1, "nor into another machine from below");
  // Leaving the list puts it back.
  press("space-s1"); move(-10); sp.render(cx); move(-30); sp.render(cx);
  fire(find(sp.render(cx), "space-list"), "on_hover", false, cx);
  assert.equal(sp.drag, null, "leaving ends the drag");
  assert.equal(moves().length, 1, "and moves nothing");
  assert.equal(fly(sp.render(cx), "space-s1").style.top, 34 - 64, "it slides back");
  press("space-s1"); move(-10); sp.render(cx); move(-30); sp.render(cx);
  fire(sp.render(cx), "on_key_down", { keystroke: "escape" }, cx);
  assert.equal(sp.drag, null, "Esc puts the lifted space back");
  assert.equal(sp.render(cx).style.track_focus, undefined, "after Esc, Spaces no longer takes the keyboard on a press");
  release();
  assert.equal(moves().length, 1, "release after Esc cannot move a space");
  // A space that leaves the list while lifted ends the drag.
  press("space-s1"); move(20); sp.render(cx);
  sp.folded.add(null);
  assert.equal(find(sp.render(cx), "space-lifted"), null);
  assert.equal(sp.drag, null);
  fire(sp.render(cx), "on_key_down", { keystroke: "escape" }, cx);
  assert.equal(sp.dragFocus, false, "Esc still releases the keyboard after the lifted row leaves");
  sp.folded.delete(null);
  // Let go outside the window, neither a release nor a leave comes: where the pointer is ends the drag, and no later click moves a space.
  const watches = [], every = cx.timer.every, scope = f.scopes.get("t3-spaces");
  cx.timer.every = (ms, fn) => { const t = { ms, fn, cancel() { t.gone = true; } }; watches.push(t); return t; };
  const box = { x: 0, y: 0, width: 256, height: 400 }, lift = () => { press("space-s1"); fire(find(sp.render(cx), "space-list"), "on_mouse_move", { position: { x: 0, y: 40 }, bounds: box }, cx); sp.render(cx); };
  scope.window.mouse_position = () => ({ x: 10, y: 40 });
  const made = moves().length;
  lift();
  const out = watches.at(-1);
  out.fn(cx);
  assert.ok(sp.drag, "in the list, it's still lifted");
  scope.window.mouse_position = () => ({ x: -5, y: 40 });
  out.fn(cx);
  assert.deepEqual([sp.drag, out.gone, find(sp.render(cx), "space-lifted")], [null, true, null], "out of it, it goes back and the watch stops");
  release();
  assert.equal(moves().length, made, "and the next click moves nothing");
  scope.window.mouse_position = () => ({ x: 10, y: 40 });
  lift();
  release();
  watches.at(-1).fn(cx);
  assert.ok(watches.at(-1).gone, "released in the list, the watch stops too");
  cx.timer.every = every;
}

{
  // The list's motion, as T3's: a row that comes fades in riding the kept row above it, one that goes fades out as an inert
  // ghost of itself, the rest slide; 150ms ease-out.
  const f = fixture(256), sp = f.load("t3-spaces"), list = f.spaces();
  const keyOf = n => "key" in n ? n.key : null;
  const fly = (tree, key) => walk(tree).find(n => keyOf(n)?.startsWith(`fly-${key}-`));
  const leaving = (tree, key) => find(tree, "space-rows").items.find(n => keyOf(n)?.startsWith(`leaving-${key}-`));
  const settle = () => cx.timers.filter(t => t.ms === 16 && !t.gone).forEach(t => { t.gone = true; t.fn(cx); });
  let tree = sp.render(cx);
  assert.deepEqual([fly(tree, "space-s1").style.opacity, fly(tree, "space-s1").style.top], [1, 0], "the first frame plays nothing");
  // A new space joins when it's shown (its git known, or a moment gone), and its fade starts then.
  list.splice(2, 0, { id: "s3", name: "project 3", active: false, folder: "/work/p3", machine: null, tabs: [] });
  let now = Date.now();
  f.scopes.get("t3-spaces").Date = { now: () => now };
  tree = sp.render(cx);
  assert.equal(fly(tree, "space-s3"), undefined, "waiting for its git, it isn't drawn");
  now += 2000;
  tree = sp.render(cx);
  assert.deepEqual([fly(tree, "space-s3").style.opacity, fly(tree, "space-s3").style.top], [0, 0], "shown, it starts clear, riding s1 (still)");
  assert.equal(fly(tree, "machine-vps").style.top, -33, "the rows below make room");
  settle();
  tree = sp.render(cx);
  assert.deepEqual([fly(tree, "space-s3").style.opacity, fly(tree, "machine-vps").style.top], [1, 0], "then let go");
  // Closed, it fades out where it was, lined up with the rows inside the list's padding.
  list.splice(2, 1);
  tree = sp.render(cx);
  const gone = leaving(tree, "space-s3");
  assert.deepEqual([gone.style.top, gone.style.opacity], [99, 1]);
  assert.ok("relative" in find(tree, "space-rows").style && find(tree, "space-content").items[0] === find(tree, "space-rows"), "clones are placed in the rows' own box");
  assert.equal(fly(tree, "machine-vps").style.top, 33, "the rows below close up");
  settle();
  assert.equal(leaving(sp.render(cx), "space-s3").style.opacity, 0, "it fades out");
  // A machine folding: its rows go the same way, its header stays.
  fire(find(sp.render(cx), "machine-vps"), "on_click", {}, cx);
  tree = sp.render(cx);
  assert.ok(leaving(tree, "space-s2") && fly(tree, "machine-vps") && !fly(tree, "space-s2"), "its spaces leave");
}

{
  // A ghost (a lifted or leaving row) is drawn as its row, without the list's ids, handlers, labels or keyboard stops.
  const o = fixture(256), view = o.load("t3-spaces"), list = o.spaces(), repo = JSON.stringify([null, "/w/E/.git"]);
  const keyOf = n => "key" in n ? n.key : null;
  o.state["t3.focus"] = "elsewhere"; // Keyboard mode: the list's rows are stops.
  list[2].machine = null;
  const wt = { repo, linked: true, name: "E", branch: "x", ahead: 0, behind: 0 };
  const result = repoResults(view, o);
  result("/work/p1", wt);
  result("/work/s2", { ...wt, branch: "y" });
  result("/work/s0", { repo: "r0", linked: false, name: "p", branch: "feat", ahead: 2, behind: 1 });
  view.machines = [{ name: "busy", state: "connected" }, { name: "spare", state: "asleep" }];
  view.render(cx);
  assert.deepEqual(plain(view.rows.map(e => e.key)), ["machine-local", "space-s0", `repo-${repo}`, "space-s1", "space-s2", "machine-busy", "machine-loading-busy", "machine-spare", "machine-new-spare"]);
  for (const e of view.rows.filter(e => e.ghost)) {
    const ghost = e.ghost();
    assert.ok(walk(ghost).every(n => !Object.keys(n.handlers).length && !("track_focus" in n.style) && !keyOf(n)), `${e.key}'s ghost is inert`);
    assert.deepEqual(strings(ghost), strings(e.el), `${e.key}'s ghost reads as its row`);
  }
}

{
  // New space here goes as the space it made arrives, with no leave to say so: back later, it isn't lit.
  const f = fixture(256), sp = f.load("t3-spaces"), list = f.spaces();
  sp.machines = [{ name: "spare", state: "asleep" }];
  fire(find(sp.render(cx), "machine-new-spare"), "on_hover", true, cx);
  assert.equal(find(sp.render(cx), "machine-new-spare").style.text_color, f.theme().foreground);
  list.push({ id: "r", name: "r", active: false, folder: "/r", machine: "spare", tabs: [] });
  sp.shown.add("r");
  sp.render(cx);
  list.pop();
  assert.equal(find(sp.render(cx), "machine-new-spare").style.text_color, f.theme().dim);
}

{
  const f = fixture(240), ag = f.load("t3-agents"), sp = f.load("t3-spaces");
  const worktree = sp.row({ w: f.spaces()[1], i: 1, g: null, tree: "└─" }, f.theme());
  assert.equal(inFlow(worktree)[0].style.pl, 20, "worktree icon lines up with a sub-agent's");
  assert.equal(inFlow(worktree)[0].items[0].style.size, 16);
  const treeLines = row => row.items.filter(n => "absolute" in n.style && "left" in n.style).map(n => [n.style.left, "border_b" in n.style ? "elbow" : "line"]);
  assert.deepEqual(treeLines(worktree), [[15.25, "elbow"]], "last worktree turns in from under its checkout");
  assert.deepEqual(treeLines(sp.row({ w: f.spaces()[1], i: 1, g: null, tree: "├─" }, f.theme())), [[15.25, "line"], [15.25, "elbow"]], "a middle worktree keeps the line going");
  assert.deepEqual(treeLines(sp.row({ w: f.spaces()[1], i: 1, g: null, tree: null }, f.theme())), [], "checkouts draw no lines");
  {
    // project 1 is a worktree of project 0's repo.
    const g = { repo: "/r", linked: false, name: "project 0", branch: "main", ahead: 0, behind: 0 };
    const result = repoResults(sp, f);
    result("/work/s0", g);
    result("/work/p1", { ...g, linked: true, branch: "x" });
    const ids = () => [...sp.order.rows().map(r => r.w.id)];
    assert.deepEqual(ids(), ["s0", "s1", "s2"]);
    const arrow = find(sp.render(cx), "space-fold-s0");
    assert.equal(arrow.style.mr + arrow.style.px, -2, "past its padding, its 12px chevron ends 2 past the row's content, as a folder's: its middle 22px from the sidebar's edge");
    // T3 turns its arrow; Herdr can't, so the two directions cross-fade in one slot, ids stable so the fade plays.
    const way = (tree, name) => find(tree, `space-fold-s0-${name}`);
    assert.deepEqual([way(arrow, "down").items[0].source, way(arrow, "down").style.opacity, way(arrow, "right").style.opacity, arrow.items.length], ["mods/t3-spaces/icons/chevron-down.svg", 1, 0, 1], "a checkout shows its fold arrow at the end, as an agent parent");
    assert.equal(arrow.style.text_color, f.theme().dim, "the arrow is dim");
    assert.equal(arrow.hoverStyle.bg, undefined, "no ground, as T3's row controls");
    fire(arrow, "on_hover", true, cx);
    assert.equal(way(find(sp.render(cx), "space-fold-s0"), "down").items[0].style.text_color, f.theme().foreground, "hovered, it brightens");
    fire(arrow, "on_hover", false, cx);
    let stopped = false;
    fire(arrow, "on_mouse_down:left", {}, { ...cx, stop_propagation() { stopped = true; } });
    assert.ok(stopped, "pressing the arrow neither selects nor drags the space");
    const before = f.calls.length;
    fire(arrow, "on_click", {}, cx);
    assert.deepEqual(ids(), ["s0", "s2"], "folding hides the worktrees");
    assert.equal(f.calls.length, before, "folding runs no command");
    assert.equal(f.stores.get("t3-spaces").get("repos.folded"), JSON.stringify(["/r"]), "folding persists");
    const count = find(sp.render(cx), "space-fold-s0");
    assert.deepEqual([way(count, "down").style.opacity, way(count, "right").style.opacity], [0, 1], "folded, it points right");
    assert.deepEqual([count.items[0], count.style.text_color], ["1", f.theme().dim], "folded, a dim count says how many");
    fire(count, "on_click", {}, cx);
    assert.deepEqual(ids(), ["s0", "s1", "s2"], "the count unfolds them");
    assert.equal(find(sp.render(cx), "space-fold-s0").items.length, 1);
  }
  {
    // A repo's worktrees hang together with its checkout closed, under a dim row standing for it.
    const o = fixture(256), list = o.spaces(), view = o.load("t3-spaces"), repo = JSON.stringify([null, "/w/Engineer/.git"]);
    list[2].machine = null;
    const result = repoResults(view, o), set = (id, g) => result(`/work/${id}`, g);
    const tree = { repo, linked: true, name: "Engineer", branch: "x", ahead: 0, behind: 0 };
    set("p1", tree); set("s2", { ...tree, branch: "y" });
    const headId = `repo-${repo}`, rows = () => [...view.order.rows().map(r => r.w.id)];
    assert.deepEqual(rows(), ["s0", headId, "s1", "s2"], "the head takes its first worktree's place");
    assert.deepEqual([...view.order.rows().map(r => r.tree ?? null)], [null, null, "├─", "└─"]);
    const moves = () => o.calls.filter(([name]) => name === "space.move");
    assert.deepEqual(moves(), [], "a row with no space never reaches the model's order");
    // Dragged past it, a space goes past the whole group: its worktrees count, though the head isn't a space.
    fire(find(view.render(cx), "space-s0"), "on_mouse_down:left", { position: { x: 0, y: 0 } }, cx);
    for (const y of [10, 100]) fire(find(view.render(cx), "space-list"), "on_mouse_move", { position: { x: 0, y } }, cx);
    view.render(cx);
    fire(find(view.render(cx), "space-list"), "on_mouse_up:left", {}, cx);
    assert.deepEqual(moves(), [["space.move", { id: "s0", index: 3 }]], "after the group's last worktree");
    echoSpaceMoves(list, moves());
    view.render(cx);
    list.unshift(list.pop()); // Reset the fake client's order for the checkout-opening scenario.
    let root = view.render(cx), head = find(root, headId);
    fire(head, "on_mouse_down:right", {}, cx);
    assert.deepEqual(plain(o.overlays.pop().props).tab, "checkout", "its menu opens it or copies its path, as T3's project folder");
    assert.ok(strings(head).includes("Engineer"), "named for its repo");
    // Its arrow is a checkout's: dim until itself hovered, in the same column.
    const foldId = `${headId}-fold`;
    assert.equal(find(root, foldId).style.text_color, o.theme().dim, "the arrow is dim, as a checkout's");
    assert.equal(find(root, foldId).style.mr, -8, "in the column of the headings' last button");
    // Its arrow folds, and makes nothing.
    const before = o.calls.length;
    let halted = false;
    fire(find(root, foldId), "on_click", {}, { ...cx, stop_propagation() { halted = true; } });
    assert.ok(halted, "the arrow's click isn't the row's");
    assert.equal(o.calls.length, before, "folding makes no space");
    assert.deepEqual(rows(), ["s0", headId], "folded, its worktrees go");
    assert.ok(strings(find(view.render(cx), headId)).includes("2"), "and it says how many");
    // Closed, the worktree you're on still shows, last in the tree, and isn't counted.
    list.forEach(s => { s.active = s.id === "s2"; });
    assert.deepEqual(rows(), ["s0", headId, "s2"], "the worktree in view stays");
    assert.equal(view.order.rows().at(-1).tree, "└─");
    assert.ok(strings(find(view.render(cx), headId)).includes("1"));
    list.forEach(s => { s.active = s.id === "s0"; });
    fire(find(view.render(cx), foldId), "on_click", {}, cx);
    // No tab to go to: the click opens the checkout, once however often it's pressed.
    assert.equal(find(view.render(cx), headId).style.accessibility_label, "Open Engineer");
    const opens = () => o.calls.filter(([name]) => name === "space.new").length;
    fire(find(view.render(cx), headId), "on_click", {}, cx);
    assert.deepEqual(o.calls.at(-1), ["space.new", { folder: "/w/Engineer", machine: "" }]);
    fire(find(view.render(cx), headId), "on_click", {}, cx);
    assert.equal(opens(), 1, "a second press doesn't make a second space");
    // It arrives last, and takes the head's place, the fold kept: the group doesn't jump to the end.
    fire(find(view.render(cx), foldId), "on_click", {}, cx);
    list.push({ id: "s9", name: "Engineer", active: false, folder: "/w/Engineer", machine: null, tabs: [] });
    view.shown.add("s9");
    result("/w/Engineer", { ...tree, linked: false, branch: "main" });
    assert.deepEqual(rows(), ["s0", "s9"], "with its checkout open the head is gone, the fold kept");
    assert.deepEqual(moves().at(-1), ["space.move", { id: "s9", index: 2 }], "the checkout moves to where the head was");
    list.splice(1, 0, list.pop());
    assert.deepEqual(rows(), ["s0", "s9"]);
    assert.equal(moves().length, 2, "in place, no further move");
    fire(find(view.render(cx), "space-fold-s9"), "on_click", {}, cx);
    assert.deepEqual(rows(), ["s0", "s9", "s1", "s2"]);
    list.splice(1, 1);
    // One worktree alone stays a plain row.
    set("s0", null);
    set("s2", null);
    assert.deepEqual(rows(), ["s0", "s1", "s2"], "one alone gets no row over it");
    assert.equal(view.order.rows()[1].tree, null);
    // No .git folder (a bare repo): nothing to open, so no pen.
    const bare = JSON.stringify([null, "/w/bare.git"]);
    set("p1", { ...tree, repo: bare }); set("s2", { ...tree, repo: bare });
    const made = opens();
    fire(find(view.render(cx), `repo-${bare}`), "on_click", {}, cx);
    assert.equal(opens(), made, "there the click folds");
    assert.ok(view.foldedRepos.has(bare));
  }
  {
    // Two dim rows opened one after the other: each checkout takes its own row's place, neither group goes to the end.
    const o = fixture(256), list = o.spaces(), view = o.load("t3-spaces");
    const space = (id, folder) => ({ id, name: id, active: false, folder, machine: null, tabs: [] });
    const result = repoResults(view, o);
    const add = (id, folder, repo, linked) => {
      list.push(space(id, folder));
      view.shown.add(id);
      result(folder, { repo: JSON.stringify([null, `/${repo}/.git`]), linked, name: repo, branch: "x", ahead: 0, behind: 0 });
    };
    list.splice(0);
    add("a1", "/ra/1", "ra", true); add("a2", "/ra/2", "ra", true); add("b1", "/rb/1", "rb", true); add("b2", "/rb/2", "rb", true); add("x", "/x", "x", false);
    for (const repo of ["ra", "rb"]) fire(find(view.render(cx), `repo-${JSON.stringify([null, `/${repo}/.git`])}`), "on_click", {}, cx);
    add("ma", "/ra", "ra", false); add("mb", "/rb", "rb", false);
    for (let i = 0; i < 3; i++) {
      view.order.rows();
      for (const [name, a] of o.calls.splice(0)) if (name === "space.move") list.splice(a.index - 1, 0, list.splice(list.findIndex(s => s.id === a.id), 1)[0]);
    }
    assert.deepEqual(list.map(s => s.id), ["ma", "a1", "a2", "mb", "b1", "b2", "x"]);
  }
  {
    // Another machine's space opened between this computer's: the model goes this computer's first, then each machine's,
    // as the rows are drawn, so space.next and ctrl-N don't hop machines.
    const o = fixture(256), list = o.spaces(), view = o.load("t3-spaces");
    for (const s of list) view.shown.add(s.id);
    list.splice(1, 0, list.splice(2, 1)[0]);
    assert.deepEqual(list.map(s => s.id), ["s0", "s2", "s1"]);
    for (let i = 0; i < 2; i++) {
      view.order.rows();
      for (const [name, a] of o.calls.splice(0)) if (name === "space.move") list.splice(a.index - 1, 0, list.splice(list.findIndex(s => s.id === a.id), 1)[0]);
    }
    assert.deepEqual(list.map(s => s.id), ["s0", "s1", "s2"]);
  }
  {
    // A worktree away from its checkout: the model moves to the rows' order, so space keys go down the list.
    const o = fixture(256), list = o.spaces(), view = o.load("t3-spaces");
    list[2].machine = null;
    const g = { repo: "/r", linked: false, name: "project 0", branch: "main", ahead: 0, behind: 0 };
    const result = repoResults(view, o);
    result("/work/s0", g);
    result("/work/s2", { ...g, linked: true, branch: "x" });
    const moves = () => o.calls.filter(([name]) => name === "space.move");
    let now = Date.now();
    o.scopes.get("t3-spaces").Date = { now: () => now };
    const ids = () => [...view.order.rows().map(r => r.w.id)];
    assert.deepEqual(ids(), ["s0", "s2", "s1"]);
    assert.deepEqual(moves(), [["space.move", { id: "s2", index: 2 }]], "the worktree moves under its checkout");
    ids();
    assert.equal(moves().length, 1, "a move is queued once");
    now += 1000;
    ids();
    assert.equal(moves().length, 2, "a write that lost a sync conflict is retried");
    list.splice(1, 0, list.splice(2, 1)[0]); // The move's echo.
    ids();
    now += 1000; ids();
    assert.equal(moves().length, 2, "echoed, the move is not retried");
    view.foldedRepos.add("/r");
    assert.deepEqual(ids(), ["s0", "s1"], "folding hides the worktree");
    assert.equal(moves().length, 2, "folding moves nothing");
    list.push(list.splice(1, 1)[0]);
    assert.deepEqual(ids(), ["s0", "s1"]);
    assert.deepEqual(moves().pop(), ["space.move", { id: "s2", index: 2 }], "a folded worktree still keeps its place");
    list.splice(1, 0, list.splice(2, 1)[0]);
    view.foldedRepos.clear();
    // Dragging: rows are 32px, and the model moves as the rows did, worktrees after their checkout.
    const keyOf = n => "key" in n ? n.key : null;
    const order = tree => find(tree, "space-rows").items.filter(n => keyOf(n)?.startsWith("fly-")).map(n => keyOf(n.items[0]) ?? `gap-${n.items[0].style.h}`);
    const lift = (id, ...ys) => {
      fire(find(view.render(cx), id), "on_mouse_down:left", { position: { x: 0, y: 0 } }, cx);
      for (const y of [Math.sign(ys[0]) * 10, ...ys]) fire(find(view.render(cx), "space-list"), "on_mouse_move", { position: { x: 0, y } }, cx);
      return view.render(cx);
    };
    const drop = () => fire(find(view.render(cx), "space-list"), "on_mouse_up:left", {}, cx);
    assert.deepEqual(list.map(s => s.id), ["s0", "s2", "s1"]);
    // A checkout lifts with its worktrees and lands as a group, between groups.
    let tree = lift("space-s0", 40);
    assert.deepEqual(order(tree), ["space-s1", "gap-65"], "the gap is the group's");
    assert.equal(find(tree, "space-lifted").style.top, 33, "it stays inside the list");
    assert.deepEqual(find(tree, "space-lifted").items.map(n => strings(n).find(x => x.startsWith("project"))), ["project 0", "project 2"], "its worktree rides with it");
    // A drag holds its space, not an index a move can shift under it.
    const up = find(view.render(cx), "space-list");
    list.unshift(list.pop());
    fire(up, "on_mouse_up:left", {}, cx);
    assert.equal(moves().length, 3, "already after s1 when released; no redundant write");
    list.splice(0, Infinity, ...["s0", "s2", "s1"].map(id => list.find(s => s.id === id)));
    tree = lift("space-s1", -40);
    assert.deepEqual(order(tree), ["gap-32", "space-s0", "space-s2"], "a space goes over a group, not into it");
    drop();
    const moved = (id, index) => {
      assert.deepEqual(moves().at(-1), ["space.move", { id, index }]);
      echoSpaceMoves(list, moves().slice(-1)); view.order.rows();
    };
    moved("s1", 1);
    list.push(list.shift()); // Reset between independent pointer gestures, after echoing the first drop.
    tree = lift("space-s1", -20);
    assert.deepEqual(order(tree), ["space-s0", "space-s2", "gap-32"], "halfway into a group it stays below it");
    drop();
    // A worktree moves among its own: past the group's ends it stops at them.
    result("/work/p1", { ...g, linked: true, branch: "y" });
    assert.deepEqual(ids(), ["s0", "s2", "s1"]);
    tree = lift("space-s2", 60);
    assert.deepEqual(order(tree), ["space-s0", "space-s1", "gap-32"], "below its last sibling");
    drop();
    moved("s2", 3);
    list.splice(1, 0, list.pop());
    tree = lift("space-s1", -90);
    assert.deepEqual(order(tree), ["space-s0", "gap-32", "space-s2"], "never above its checkout");
    drop();
    moved("s1", 2);
    list.push(list.splice(1, 1)[0]);
    result("/work/p1", null);
    tree = lift("space-s2", 60);
    assert.deepEqual(order(tree), ["space-s0", "gap-32", "space-s1"], "a lone worktree has nowhere else to go");
    const n = moves().length;
    drop();
    assert.equal(moves().length, n, "so it moves nothing");
    // Without worktrees, a space dropped between two lands between them.
    for (const id of ["s0", "s2"]) result(`/work/${id}`, null);
    tree = lift("space-s0", 40);
    assert.deepEqual(order(tree), ["space-s2", "gap-32", "space-s1"]);
    drop();
    moved("s0", 2);
    // Folded, a group's hidden worktrees still count: a space dropped after it goes after them all.
    const s3 = { id: "s3", name: "project 3", active: false, folder: "/work/p3", machine: null, tabs: [] };
    list.splice(0, Infinity, s3, ...["s0", "s2", "s1"].map(id => list.find(s => s.id === id)));
    view.shown.add("s3");
    result("/work/s0", g);
    for (const k of ["/work/s2", "/work/p1"]) result(k, { ...g, linked: true });
    view.foldedRepos.add("/r");
    list.forEach(s => { s.active = s.id === "s2"; });
    assert.deepEqual(ids(), ["s3", "s0", "s2"]);
    tree = lift("space-s3", 70);
    assert.deepEqual(order(tree), ["space-s0", "space-s2", "gap-32"]);
    drop();
    assert.deepEqual(moves().pop(), ["space.move", { id: "s3", index: 4 }]);
  }
  delete f.agents()[0].program.icon;
  ag.toggleFold("t0", cx);
  const tree = ag.render(cx);
  assert.equal(find(tree, "ag-t0").items[0].style.w, 16, "missing icons do not shift names");
  assert.equal(inFlow(find(tree, "sub-child"))[0].style.size, 16);
  fire(find(tree, "agent-fold-t0"), "on_click", {}, cx);
  assert.equal(find(ag.render(cx), "sub-grandchild"), null, "missing icons do not disable folding");
  const menu = f.load("t3-agents", { sortMenu: true }).render(cx);
  assert.equal(find(menu, "sort-grouped").style.bg, undefined, "as T3's menus, nothing's lit until a key or the pointer arrives");
  assert.ok(walk(find(menu, "sort-grouped")).some(n => n.source === "mods/t3-agents/icons/check.svg"), "the current sort keeps its check");
  fire(find(menu, "sort-priority"), "on_click", {}, cx);
  assert.equal(f.state["agents.sort"], "priority");
  const byPriority = find(ag.render(cx), "ag-t0"), names = byPriority.items[1];
  assert.deepEqual(strings(names), ["local task", "local", "·", "project 0"], "without a space header the task leads, then Husain's second line: its machine and its space; the address stays in the pane header");
  // Husain's second line: dim and smaller; short of room the space gives way, never the machine.
  assert.deepEqual([names.items[1].style.text_color, names.items[1].style.text_size], [f.theme().dim, 12], "the machine line is dim and smaller");
  const where = names.items[1].items.at(-1);
  assert.ok("truncate" in where.style && "flex_none" in names.items[1].items[1].style, "the space truncates first; the machine stays whole");
}

{
  const f = fixture(256), first = f.spaces()[0].tabs[0];
  Object.assign(first, { active: true, status: "working" });
  f.spaces()[0].tabs.push({ id: "other", name: "other task", active: false });
  const tabs = f.load("t3-tabs"), root = tabs.render(cx);
  assert.equal(find(root, "tab-b0").hoverStyle.bg, undefined);
  assert.equal(find(root, "tab-other").hoverStyle.bg, f.theme().foreground + "0a", "hovered: the text color at 4%, as the bar's buttons");
  assert.equal(find(root, "tab-strip").style.gap, 4);
  // Tabs take their whole names while the room allows, the longest give way first; past that the strip keeps the active tab in view.
  {
    const strip = f.spaces()[0].tabs, kept = strip.splice(0), view = f.load("t3-tabs");
    strip.push(...["a", "b", "c", "d"].map(id => ({ id, name: id, active: id === "a" })));
    const at = () => Math.abs(find(view.render(cx), "tab-strip").style.ml);
    const w = (id) => find(view.render(cx), `tab-${id}`).style.w;
    const pick = (id) => strip.forEach(c => { c.active = c.id === id; });
    // Husain's + sits after the tabs, in the measured area: its 24px and the gap come off.
    const room = (width) => fire(find(view.render(cx), "tab-area"), "on_size_change", { width: width + 24 + 4 }, cx);
    const wheel = (x, y) => fire(view.render(cx), "on_scroll_wheel", { delta: { x, y } }, cx);
    // A name's width, so its tab is `whole` wide: 51 around the name.
    const name = (id, whole) => fire(find(view.render(cx), `text-measure-tab-${id}`), "on_size_change", { width: whole - 51 }, cx);
    assert.equal(w("a"), 144, "before its name is measured");
    assert.equal(find(view.render(cx), "text-measure-tab-a").style.h, 0, "the measure doesn't show");
    for (const id of "abcd") name(id, 300);
    room(1212);
    // Husain's: a tab is 200px at most.
    assert.deepEqual([..."abcd"].map(w), [200, 200, 200, 200], "room for them all: every name whole, up to 200");
    room(692);
    assert.deepEqual([..."abcd"].map(w), [200, 160, 160, 160], "too little: the active tab keeps its 200, the rest share what's left");
    room(1012);
    name("b", 100);
    room(812);
    assert.deepEqual([..."abcd"].map(w), [200, 100, 200, 200], "a short name keeps its width, the long ones stop at 200");
    room(500);
    assert.deepEqual([..."abcd"].map(w), [200, 100, 144, 144], "squeezed: the active tab keeps its 200, the rest stop at 144, and the strip scrolls");
    pick("b");
    assert.deepEqual([..."abcd"].map(w), [144, 100, 144, 144], "a short active tab asks for no more");
    name("b", 51 + 14);
    assert.equal(w("b"), 96, "a name as short as `Pi` still gets a tab 96px wide");
    for (const id of "abcd") name(id, 100);
    pick("a");
    room(250);
    assert.equal(at(), 0, "the first tab is at its place");
    pick("d");
    assert.equal(at(), 162, "the last tab lands at the right edge: 4 tabs, 3 gaps, 250 of room");
    pick("b");
    assert.equal(at(), 104, "an earlier tab lands at the left edge");
    pick("c");
    assert.equal(at(), 104, "one already in view doesn't move the strip");
    wheel(-30, 0);
    assert.equal(at(), 134, "a swipe moves the strip");
    assert.equal(at(), 134, "and the next render doesn't pull it back");
    f.calls.length = 0;
    wheel(0, 30);
    assert.deepEqual(f.calls.splice(0), [], "the wheel goes to no tab: a click does");
    assert.equal(at(), 104, "up and down, the wheel scrolls the strip too");
    wheel(0, -30);
    assert.equal(at(), 134);
    wheel(-10000, 0);
    assert.equal(at(), 162, "a swipe stops at the last tab");
    wheel(10000, 0);
    assert.equal(at(), 0, "and at the first");
    // A cut end fades in Lists as with the Inbox: one way for the strip to run out of room.
    const fades = () => ["strip-fade-start", "strip-fade-end"].map(id => Boolean(find(view.render(cx), id)));
    assert.deepEqual(fades(), [false, true], "at its start, only the end is cut");
    wheel(-10000, 0);
    assert.deepEqual(fades(), [true, false], "at its end, only the start");
    wheel(10000, 0);
    room(1000);
    assert.deepEqual(fades(), [false, false], "room for all: nothing fades");
    room(250);
    // Its name lengthening moves the strip for its new end; another tab's doesn't.
    pick("d");
    assert.equal(at(), 162);
    name("d", 200);
    assert.equal(at(), 262, "the active tab's end stays in view");
    name("a", 120);
    assert.equal(at(), 262, "another tab's width doesn't move the strip");
    name("a", 100);
    pick("b");
    room(60);
    assert.equal(at(), 104, "a tab wider than the room shows its start");
    room(1000);
    pick("d");
    assert.equal(at(), 0, "with room for every tab the strip stays put");
    strip.splice(0, strip.length, ...kept);
  }
  // A tab nobody named reads as its agent, the name its pane header and inbox card show.
  Object.assign(first, { name: "1", named: false });
  f.terminals().find(k => k.address === "t0").labels = { "pi.session": "mine" };
  assert.ok(strings(find(f.load("t3-tabs").render(cx), "tab-b0")).includes("mine"), "an unnamed tab reads as its agent's session");
  assert.ok(strings(f.load("t3-pane", { pane: "p0" }).render(cx)).includes("mine"), "its pane header reads the same");

  // New opens a terminal tab in the space picked: no agent step.
  const menu = f.load("t3-new-menu"); f.calls.length = 0;
  menu.choose(menu.items().find(item => item.space?.id === f.spaces()[2].id));
  assert.deepEqual(f.calls.splice(0), [["t3-tabs.new:s2", {}]], "New names the space to t3-tabs, which opens the tab where its terminals are (t3-tabs check-navigation.cjs)");
  // Two machines: New space asks which, as T3's Add project asks for an environment.
  fire(find(menu.render(cx), "space-new"), "on_click", {}, cx);
  assert.deepEqual(f.calls, [], "New space asks first");
  menu.choose(menu.items().find(item => item.machine === "vps"));
  assert.deepEqual(f.calls.pop(), ["space.new", { machine: "vps" }], "New space opens a space there");
  f.calls.length = 0;
  {
    // "+" on a machine's header names that machine, this computer included: without one the focused space's machine wins.
    const f = fixture(256), sp = f.load("t3-spaces");
    sp.machines = [{ name: "vps", state: "connected" }];
    fire(find(sp.render(cx), "machine-add-local"), "on_click", {}, cx);
    assert.deepEqual(f.calls.pop(), ["space.new", { machine: "" }]);
    fire(find(sp.render(cx), "machine-add-vps"), "on_click", {}, cx);
    assert.deepEqual(f.calls.pop(), ["space.new", { machine: "vps" }]);
  }
  assert.equal(find(root, "sidebar-toggle"), null, "with the sidebar shown its own header has the toggle");
  f.slots.sidebar.hidden = true;
  const bare = tabs.render(cx);
  assert.deepEqual(bare.items.slice(0, 2).map(n => n.key), ["tip-sidebar-toggle", "tab-area"], "hidden, the toggle sits first, after the window buttons, then the tabs: no brand, as T3's collapsed sidebar");
  const toggle = find(bare, "sidebar-toggle");
  {
    // Hidden and shown, the toggle sits in one place past the window buttons, as T3's.
    const brand = f.load("t3-chrome");
    for (const zoom of [1, 1.25]) {
      f.ui.settings = { zoom }; Object.assign(f.ui.window, { titlebar: "none" }); Object.assign(f.ui.root, { titlebar: "none", traffic_lights: [16, 12] });
      assert.equal(tabs.render(cx).style.pl, brand.render(cx).style.pl, `at ${zoom * 100}%`);
      assert.equal(brand.render(cx).style.pl, (16 + 66) / zoom - 4);
    }
    delete f.ui.settings; delete f.ui.window.titlebar; delete f.ui.root.titlebar; delete f.ui.root.traffic_lights;
  }
  // t0 works, but its sub-agent is stuck: the toggle doesn't say so, the sidebar does.
  assert.equal(toggle.items.length, 1, "hidden, the toggle is its icon alone");
  assert.equal(toggle.style.accessibility_label, "Show sidebar");
  {
    // One look across the preset: the same "needs you" mark everywhere, no scrollbars, English throughout.
    f.spaces()[0].tabs[0].status = "blocked";
    f.panes()[0].status = "blocked";
    const all = () => [tabs.render(cx), f.load("t3-agents").render(cx), f.load("t3-spaces").render(cx), f.load("t3-chrome").render(cx), f.load("t3-pane", { pane: "p0" }).render(cx)].flatMap(walk);
    const look = n => { const { accessibility_label, ...s } = n.style; return JSON.stringify([s, strings(n)]); };
    const marks = all().filter(n => strings(n).join("") === "!" && n.style.size === 14);
    assert.equal(marks.length, 1, "tabs show the 14px needs-you mark (pane headers show none; the agents list's is 12, as T3's one-line row)");
    assert.equal(new Set(marks.map(look)).size, 1, "needs-you is drawn the same everywhere");
    assert.ok(!all().some(n => Object.keys(n.style).some(k => k.includes("scrollbar"))), "lists scroll without a painted bar");
    assert.ok(!all().some(n => /\p{Script=Han}/u.test(strings(n).join("") + (n.style.accessibility_label ?? ""))), "UI text and labels are English");
    delete f.spaces()[0].tabs[0].status; f.panes()[0].status = "working";
  }
  for (const k of f.terminals()) if (k.parent) k.status = "idle";
  fire(find(bare, "sidebar-toggle"), "on_click", {}, cx);
  assert.deepEqual(f.calls.pop(), ["t3-tabs.toggle-sidebar", {}]);
  delete f.slots.sidebar.hidden;
  fire(find(root, "tab-b0"), "on_mouse_down:left", { click_count: 1, position: { x: 10, y: 10 } }, cx);
  fire(find(root, "tab-other"), "on_mouse_move", { position: { x: 15, y: 10 } }, cx);
  fire(find(root, "tab-other"), "on_mouse_up:left", {}, cx);
  assert.deepEqual(f.calls.pop(), ["tab.select", { id: "b0" }], "under 6px, as T3's, a press is no drag: it selects the tab pressed, not the one let go over");
  fire(find(root, "tab-b0"), "on_mouse_down:left", { click_count: 1, position: { x: 10, y: 10 } }, cx);
  fire(find(root, "tab-other"), "on_mouse_move", { position: { x: 16, y: 10 } }, cx);
  fire(find(root, "tab-other"), "on_mouse_up:left", {}, cx);
  assert.deepEqual(f.calls.pop(), ["tab.move", { id: "b0", index: 2 }]);
  fire(find(root, "tab-b0"), "on_mouse_down:left", { click_count: 1, position: { x: 10, y: 10 } }, cx);
  fire(find(root, "tab-other"), "on_mouse_move", { position: { x: 20, y: 10 } }, cx);
  fire(tabs.render(cx), "on_key_down", { keystroke: "escape" }, cx);
  assert.deepEqual([tabs.pressed, tabs.over], [null, null], "Esc puts the dragged tab back");
  assert.equal(tabs.render(cx).style.track_focus, undefined, "after Esc, the tab bar no longer takes the keyboard on a press");
  const afterEscape = f.calls.length;
  fire(find(tabs.render(cx), "tab-other"), "on_mouse_up:left", {}, cx);
  assert.equal(f.calls.length, afterEscape, "release after Esc neither moves nor selects a tab");
  fire(find(root, "tab-other"), "on_mouse_down:right", {}, cx);
  assert.equal(f.overlays.pop().props.target.id, "other");
  // Husain's + sits right after the last tab; the window's buttons are the bar's end, a block of their own, sized to fit.
  assert.ok(find(root, "tab-new"), "the + follows the tabs");
  const end = f.load("t3-tabs", { part: "end", block: "tabs-end" });
  f.calls.length = 0;
  fire(find(end.render(cx), "tabs-end"), "on_size_change", { width: 34 }, cx);
  fire(find(end.render(cx), "tabs-end"), "on_size_change", { width: 34 }, cx);
  assert.deepEqual(f.calls.splice(0), [["layout.resize", { id: "tabs-end", px: 34 }]], "once per change");
  // Zoomed 1.1, a 28 button is 30.8 px, which the window snaps to 31: its block is still 28, not 29, so it touches Details (「规则」P3).
  const wasSettings = f.scopes.get("t3-tabs").settings;
  f.scopes.get("t3-tabs").settings = () => ({ ...wasSettings(), zoom: 1.1 });
  fire(find(end.render(cx), "tabs-end"), "on_size_change", { width: 31 }, cx);
  assert.deepEqual(f.calls.splice(0), [["layout.resize", { id: "tabs-end", px: 28 }]], "a zoomed width rounds to its own px");
  f.scopes.get("t3-tabs").settings = wasSettings;
  // What the end draws before Details, and after it the closed panel's toggle then the window's buttons: the tips over its buttons.
  const win = f.load("t3-tabs", { part: "window", block: "window-end" });
  f.scopes.get("t3-tabs").window = () => ({ platform: "windows", buttons: true });
  const keysOf = (view, id) => { const keys = []; const walk = (n) => { if (!n || typeof n !== "object") return; if (n.key?.startsWith?.("tip-") && !n.key.startsWith("tip-over-")) keys.push(n.key); (n.items ?? []).forEach(walk); }; walk(find(view.render(cx), id)); return keys; };
  const endKeys = () => keysOf(end, "tabs-end");
  assert.deepEqual(endKeys(), [], "the + is the strip's");
  assert.deepEqual(keysOf(win, "window-end"), ["tip-minimize", "tip-maximize", "tip-close-window"], "the window's buttons stay last, after Details");
  // The layout owns the only toggle, even with the Review extension installed (ADR 0017).
  f.slots.panel = { id: "panel", hidden: true, children: [{ id: "panel-body", active: "files", children: [{ id: "files" }] }] };
  const toggleLast = ["tip-panel-toggle", "tip-minimize", "tip-maximize", "tip-close-window"];
  assert.deepEqual([endKeys(), keysOf(win, "window-end")], [[], toggleLast]);
  f.slots.review = { id: "review-bar", content: { mod: "pulls-review", props: { block: "review-bar", toggle: true } } };
  assert.deepEqual([endKeys(), keysOf(win, "window-end")], [[], toggleLast]);
  f.scopes.get("t3-tabs").window = () => ({ platform: "macos", buttons: false });
  f.slots["sidebar-lists"] = { id: "sidebar-lists", active: "inbox" };
  assert.deepEqual([endKeys(), keysOf(win, "window-end")], [[], ["tip-panel-toggle"]], "closed panel keeps one toggle with Inbox; a Mac's window has its own buttons");
  delete f.slots.review;
  delete f.slots["sidebar-lists"]; f.scopes.get("t3-tabs").window = () => ({ platform: "windows", buttons: true });
  delete f.slots.panel; delete f.slots.review;
  fire(find(win.render(cx), "close-window"), "on_hover", true, cx);
  assert.equal(find(win.render(cx), "close-window").style.text_color, f.theme().foreground, "the window's close lights as the others do: it's no tab's ×");
  fire(find(win.render(cx), "close-window"), "on_hover", false, cx);
  // The strip under the work column says whether the bar's controls fold, at 1024.
  const measure = f.load("t3-tabs", { part: "measure" });
  fire(find(measure.render(cx), "bar-measure"), "on_size_change", { width: 1023 }, cx);
  assert.equal(f.scopes.get("t3-tabs").shared("t3-tabs.compact"), true);
  fire(find(measure.render(cx), "bar-measure"), "on_size_change", { width: 1024 }, cx);
  assert.equal(f.scopes.get("t3-tabs").shared("t3-tabs.compact"), false);
  fire(find(measure.render(cx), "bar-measure"), "on_size_change", { width: 0 }, cx);
  measure.close();
  assert.equal(f.scopes.get("t3-tabs").shared("t3-tabs.compact"), false, "gone with its layout, it leaves no bar compact");
  fire(find(root, "tab-b0-close"), "on_click", {}, cx);
  assert.deepEqual(f.calls.pop(), ["t3-tabs.close-tab:b0", {}], "the × goes through the tab bar's answer");
  const pane = f.load("t3-pane", { pane: "p0" });
  pane.hovered = true;
  const head = pane.render(cx);
  const working = tree => walk(tree).find(n => n.source?.endsWith("/icons/circle-dashed.svg"));
  const open = f.load("t3-agents");
  for (const tree of [tabs.render(cx), open.render(cx)]) assert.equal(working(tree).style.text_color, f.theme().working);
  assert.equal(working(head), undefined, "pane headers show no own working mark");
  for (const id of ["ph-r-p0", "ph-d-p0", "ph-z-p0", "ph-x-p0"]) assert.deepEqual([find(head, id).style.h, find(head, id).style.w], [24, 24]);
  const actions = walk(head).find(n => n.items.some(child => child?.key === "tip-ph-r-p0"));
  assert.equal(actions.style.gap, 4);
  assert.ok("flex_none" in actions.style, "narrow panes keep the action targets at their full size");
  assert.ok("absolute" in actions.style, "hovering a pane's header moves nothing else");
}
{
  // Icons: every UI glyph drawn is a file that exists.
  const f = fixture(256);
  f.spaces()[0].tabs[0].status = "blocked";
  const trees = [f.load("t3-tabs").render(cx), f.load("t3-tabs", { part: "end" }).render(cx), f.load("t3-agents").render(cx), f.load("t3-spaces").render(cx), f.load("t3-chrome").render(cx), f.load("t3-chrome", { footer: true }).render(cx), f.load("t3-pane", { pane: "p0" }).render(cx)].flatMap(walk);
  const glyphs = trees.filter(n => n.kind === "svg").map(n => n.source).filter(s => s !== "icons/pi.svg");
  assert.ok(glyphs.length >= 5);
  for (const s of glyphs) {
    assert.ok(fs.existsSync(path.join(path.dirname(modRoot), s)), `icon on disk: ${s}`);
  }
}
(async () => {
  for (const pendingAuto of [false, true]) await lateSpaceDrop(pendingAuto);
  removedSpaceDropAnchor();
  await homeNextTiming();
  await checkInbox();
  {
    // A rebuilt machine: one click forgets it and pairs again, and a failed pairing can be retried without forgetting twice.
    const f = fixture(256);
    /** @type {any} */ let done;
    const run = { ...cx, spawn: fn => { done = fn(run); } };
    const sp = f.load("t3-spaces"), vps = { name: "vps", target: "me@vps:2222", session: "main", state: "unreachable", why: 'a different core answers there ("c2")' };
    sp.machines = [{ ...vps, why: "connection refused" }];
    assert.equal(find(sp.render(run), "machine-connect-vps"), null, "only a different core offers Connect");
    assert.ok(find(sp.render(run), "space-s2"), "a machine that's merely away keeps its spaces");
    sp.machines = [vps];
    assert.equal(find(sp.render(run), "space-s2"), null, "a rebuilt machine's old spaces aren't offered");
    assert.ok(!("tooltip" in find(sp.render(run), "machine-connect-vps").style), "Connect says itself, no hover tooltip");
    assert.equal(find(sp.render(run), "tip-machine-connect-vps"), null, "the visible machine name doesn't need a custom tooltip either");
    assert.equal(find(sp.render(run), "machine-connect-vps").style.accessibility_label, "Connect vps");
    const asks = () => f.labelled.splice(0).filter(a => a[1] !== "ls");
    const add = ["machine", "add", "me@vps:2222", "--name", "vps", "--session", "main", "--json"];
    f.answerHc(a => a[1] === "add" ? { code: 1, stdout: '{"error":{"message":"no route"}}' } : { code: 0, stdout: '{"machines":[]}' });
    fire(find(sp.render(run), "machine-connect-vps"), "on_click", {}, run);
    await done;
    assert.deepEqual(asks(), [["machine", "rm", "vps", "--json"], add]);
    assert.ok(strings(find(sp.render(run), "machine-vps")).includes("no route"), "it stays listed, saying why, though the machine is forgotten");
    f.answerHc(() => ({ code: 0, stdout: '{"machines":[]}' }));
    fire(find(sp.render(run), "machine-connect-vps"), "on_click", {}, run);
    await done;
    assert.deepEqual(asks(), [add], "a retry doesn't forget it again");
    assert.deepEqual(Object.keys(sp.reconnecting), [], "paired, nothing's left to repair");
  }
  {
    const flush = async () => { for (let i = 0; i < 40; i++) await new Promise(setImmediate); };
    const running = () => { const run = { ...cx, spawn: fn => { fn(run); } }; return run; };
    const answer = machines => ({ code: 0, stdout: JSON.stringify({ machines }) });
    {
      // Connected some other way (Add machine, hc machine add): no repair is left, and its spaces show, after a restart too.
      const f = fixture(256), run = running();
      f.stores.set("t3-spaces", new Map([["machines.reconnecting", JSON.stringify({ vps: { machine: { name: "vps", target: "me@vps", state: "unreachable" }, removed: true, error: "no route" } })]]));
      f.answerHc(() => answer([{ name: "vps", target: "me@vps", state: "connected" }]));
      const sp = f.load("t3-spaces");
      assert.equal(find(sp.render(run), "space-s2"), null, "until hc says so it's a repair");
      sp.refreshMachines(run);
      await flush();
      assert.ok(find(sp.render(run), "space-s2"), "connected, its spaces are back");
      assert.equal(f.stores.get("t3-spaces").get("machines.reconnecting"), "{}", "for good");
      sp.reconnecting.vps = { busy: true };
      sp.refreshMachines(run);
      await flush();
      assert.ok(sp.reconnecting.vps, "a Connect under way ends its own repair");
    }
    {
      // A temporary machine with a space is known as any other: connected, with its +. One with no space isn't listed.
      const f = fixture(256), run = running();
      f.answerHc(() => answer([{ name: "vps", target: "vps", state: "connected", temporary: true }, { name: "spare", state: "asleep", temporary: true }]));
      const sp = f.load("t3-spaces");
      sp.refreshMachines(run);
      await flush();
      const tree = sp.render(run), head = strings(find(tree, "machine-vps"));
      assert.ok(find(tree, "machine-add-vps") && !head.includes("asleep"), "it isn't asleep");
      assert.equal(find(tree, "machine-spare"), null);
    }
    {
      // machines() says a machine changed: the headings ask hc at once, not at the next poll.
      const f = fixture(256), run = running(), sp = f.load("t3-spaces"), asked = () => f.labelled.splice(0).filter(a => a[0] === "machine").length;
      const scope = f.scopes.get("t3-spaces");
      asked();
      sp.checkNew(run);
      assert.equal(asked(), 0, "nothing changed");
      scope.machines = () => [{ name: null, layout: "ready" }, { name: "vps", layout: "unavailable" }];
      sp.checkNew(run);
      assert.equal(asked(), 1);
      sp.checkNew(run);
      assert.equal(asked(), 0, "once per change");
      await flush();
    }
    {
      // A poll, four a second: machines() once, and where the sidebar is only when the fallback or a draw could use it.
      const f = fixture(256), sp = f.load("t3-spaces"), scope = f.scopes.get("t3-spaces"), seen = { machines: 0, layout: 0, draws: 0 };
      for (const k of ["machines", "layout"]) { const read = scope[k]; scope[k] = () => { seen[k]++; return read(); }; }
      const run = { ...cx, notify: () => { seen.draws++; } };
      const poll = () => { seen.machines = seen.layout = seen.draws = 0; sp.checkNew(run); return { ...seen }; };
      assert.deepEqual(poll(), { machines: 1, layout: 0, draws: 0 }, "the window in the background, nothing new to draw");
      // A space made while the list is behind the Inbox is drawn when the list shows: until then no poll asks for a draw.
      f.slots["sidebar-lists"] = { id: "sidebar-lists", active: "inbox" };
      f.spaces().push({ id: "fresh", name: "fresh", folder: "/work/fresh", machine: null, tabs: [] });
      assert.deepEqual(poll(), { machines: 1, layout: 1, draws: 0 }, "behind the Inbox");
      f.slots["sidebar-lists"].active = "lists";
      assert.deepEqual(poll(), { machines: 1, layout: 1, draws: 1 }, "in view, the new space gets its draw");
    }
    {
      // The repository fallback follows the actual window and sidebar layout.
      const f = fixture(256), sp = f.load("t3-spaces"), scope = f.scopes.get("t3-spaces"), run = running(), looks = [];
      let now = 1000000;
      scope.Date = { now: () => now };
      sp.repos = scope.repoFacts({ cx: run, watchFolder: scope.watchFolder, exec: async (_cmd, args, { cwd }) => {
        if (args.includes("status")) looks.push(cwd);
        return { code: 0, stderr: "", stdout: args.includes("status") ? "# branch.head x\n" : args.includes("--show-toplevel") ? cwd : `${cwd}/.git` };
      } });
      sp.checkNew(run);
      await flush();
      const due = async () => { now += 61000; looks.splice(0); sp.checkNew(run); await flush(); return looks.length; };
      f.ui.window.active = true;
      f.slots["sidebar-lists"] = { id: "sidebar-lists", active: "inbox" };
      assert.equal(await due(), 0, "under the Inbox");
      f.slots["sidebar-lists"].active = "lists";
      f.slots.sidebar.hidden = true;
      assert.equal(await due(), 0, "sidebar hidden");
      f.slots.sidebar.hidden = false;
      assert.ok(await due() > 0, "back in view");
      delete f.slots["sidebar-lists"];
      assert.ok(await due() > 0, "docked alone, with no Lists to be hidden in");
    }
    {
      // Repository facts and the list's model order agree through an unanswered cd and a failed read.
      const o = fixture(256), list = o.spaces(), view = o.load("t3-spaces"), scope = o.scopes.get("t3-spaces");
      list[2].machine = null;
      const k1 = { pane: "p9", terminal: "t9", tab: "b1", cwd: "/work/p1" };
      o.panes().push(k1);
      view.repos = scope.repoFacts({ cx: running(), watchFolder: () => new Promise(() => {}), exec: async (_cmd, args, { cwd }) => {
        if (cwd === "/away") throw new Error("machine is away");
        if (cwd === "/tmp") return { code: 128, stdout: "", stderr: "fatal: not a git repository" };
        const top = cwd.split("/").slice(0, 3).join("/");
        return { code: 0, stderr: "", stdout: args.includes("status") ? "# branch.head x\n" : args.includes("--show-toplevel") && args.includes("--git-common-dir") ? `${top}\n/work/s0/.git\n` : args.includes("--show-toplevel") ? top : "/work/s0/.git" };
      } });
      const look = async () => {
        view.repos.update({ spaces: list, panes: o.panes(), machines: o.machines(), active: false, visible: true, folded: view.folded }, Date.now());
        await flush();
      };
      await look();
      const shape = () => plain(view.order.rows().map(r => [r.w.id, r.tree ?? null])), moves = () => o.calls.filter(([name]) => name === "space.move");
      const grouped = [["s0", null], ["s1", "├─"], ["s2", "└─"]];
      assert.deepEqual(shape(), grouped);
      k1.cwd = "/work/p1/src";
      assert.deepEqual(shape(), grouped, "it stays in its group");
      assert.deepEqual(moves(), [], "and nothing moves in the model");
      await look();
      assert.deepEqual(shape(), grouped);
      assert.deepEqual(moves(), [], "nor when git answers");
      k1.cwd = "/away";
      await look();
      assert.deepEqual(shape(), grouped, "nor where git couldn't answer");
      k1.cwd = "/tmp";
      await look();
      assert.deepEqual(shape(), [["s0", null], ["s2", "└─"], ["s1", null]], "known not to be a repo, it leaves");
    }
    {
      // The icon through a cd: until the new place answers, the space keeps it, not a flash of its letter.
      const f = fixture(256), sp = f.load("t3-spaces"), scope = f.scopes.get("t3-spaces"), key = dir => JSON.stringify([null, dir]);
      f.state["t3.spaceIcons"] = { [key("/work/s0")]: "cache/t3-icons/x.svg", [key("/old")]: "cache/t3-icons/y.svg", [key("/empty")]: null };
      let open;
      const gate = new Promise(res => { open = res; });
      scope.exec = async () => { await gate; return { code: 1, stdout: "", stderr: "" }; };
      const hasIcon = () => walk(find(sp.render(cx), "space-s0")).some(n => n.kind === "image");
      assert.ok(hasIcon());
      f.panes()[0].cwd = "/work/s0/src";
      assert.ok(hasIcon(), "asking, it keeps the icon");
      open();
      await flush();
      assert.equal(f.state["t3.spaceIcons"][key("/work/s0/src")], null, "no icon there is an answer every mod can see");
      assert.ok(key("/work/s0/src") in f.state["t3.spaceIcons"]);
      assert.ok(!hasIcon(), "and it shows");
      assert.ok(!(key("/empty") in f.state["t3.spaceIcons"]), "answers of no icon stay only for places in use");
      assert.equal(f.state["t3.spaceIcons"][key("/old")], "cache/t3-icons/y.svg");
      // Agents draws beside Spaces, which keeps asking: it asks only where nobody has answered (a worktree has no mark in Spaces).
      const ag = f.load("t3-agents"), asks = [];
      f.scopes.get("t3-agents").exec = async (_cmd, args, { cwd }) => { if (args.includes("--show-toplevel")) asks.push(cwd); return { code: 1, stdout: "", stderr: "" }; };
      delete f.state["t3.spaceIcons"][JSON.stringify(["vps", "/work/s2"])];
      ag.render(cx);
      await flush();
      ag.render(cx);
      await flush();
      assert.deepEqual(asks, ["/work/s2"], "once for the unanswered place, never for the answered");
    }
  }
  {
    // A hover style's color reaches text but never an svg: Herdr colors an icon as it builds the tree. So a button with an icon brightens by state.
    const f = fixture(256), views = [f.load("t3-chrome"), f.load("t3-chrome", { footer: true }), f.load("t3-tabs"), f.load("t3-pane", { pane: "p0" }), f.load("t3-spaces"), f.load("t3-agents"), f.load("t3-inbox"), f.load("t3-tabs", { part: "end" })];
    fire(views[3].render(cx), "on_hover", true, cx); // A pane's buttons show while its header is hovered.
    for (const view of views) for (const n of walk(view.render(cx))) if (n.hoverStyle.text_color) assert.ok(!walk(n).some(c => c.kind === "svg"), `${n.key}: a hover style can't brighten its icon`);
    const rest = f.theme().dim, bright = f.theme().foreground;
    for (const [view, id] of [[views[0], "sidebar-toggle"], [views[1], "t3-settings"], [views[2], "tab-new"], [views[4], "space-new"], [views[5], "ag-sort"]]) {
      const color = () => find(view.render(cx), id).style.text_color;
      assert.equal(color(), rest, `${id} at rest`);
      fire(find(view.render(cx), id), "on_hover", true, cx);
      assert.equal(color(), bright, `${id} hovered`);
      fire(find(view.render(cx), id), "on_hover", false, cx);
      assert.equal(color(), rest, `${id} left`);
    }
    const pane = () => find(views[3].render(cx), "ph-x-p0");
    fire(pane(), "on_hover", true, cx);
    assert.equal(pane().style.text_color, bright, "a pane button too");
    fire(pane(), "on_hover", false, cx);
    const toggle = () => find(views[0].render(cx), "sidebar-toggle");
    fire(toggle(), "on_hover", true, cx);
    fire(toggle(), "on_click", {}, cx);
    assert.equal(toggle().style.text_color, rest, "the toggle goes with the sidebar, so it can't wait for the pointer to report leaving");
  }
  {
    // Every control says what it is. A pane's header focuses it; it's no control.
    // As in T3, an icon alone says it on hover too; words may, naming what they do. A row's own fold and the editor's icon picks explain themselves.
    const f = fixture(256);
    const pane = f.load("t3-pane", { pane: "p0" });
    pane.hovered = true;
    const views = [f.load("t3-chrome"), f.load("t3-chrome", { footer: true }), f.load("t3-tabs"), pane, f.load("t3-spaces"), f.load("t3-agents"), f.load("t3-inbox"),
      f.load("t3-tabs", { part: "end" }), f.load("t3-agents", { sortMenu: true }), f.load("t3-new-menu")];
    for (const view of views) for (const n of walk(view.render(cx))) {
      if (n.handlers.on_click && !String(n.key).startsWith("pane-head")) assert.equal(n.style.role, "button", `${n.key}: a role`);
      if (n.style.role !== "button") continue;
      assert.ok(n.style.accessibility_label, `${n.key}: a label`);
      assert.ok(!("tooltip" in n.style), `${n.key}: the shell's tooltip isn't T3's`);
      const tipped = walk(view.render(cx)).some(c => String(c.key).startsWith("tip-over-") && c.items.some(i => i.key === n.key));
      const icon = n.items.length === 1 && n.items[0].kind === "svg", plain = /agent-fold|^(icon|sub|ag|card|slim)/.test(n.key);
      if (icon && !plain) assert.ok(tipped, `${n.key}: an icon alone has a hover label`);
    }
  }
  {
    // A mark with no words says what it is on hover; what sits at the window's bottom opens upward, as a Popup doesn't flip.
    const f = fixture(256), ag = f.load("t3-agents"), footer = f.load("t3-chrome", { footer: true });
    const mark = () => find(ag.render(cx), "tip-status-t0-mark");
    assert.equal(strings(mark().style.content).length, 0, "its card waits for the hover");
    const over = (on) => { fire(find(ag.render(cx), "status-t0-mark"), "on_hover", on, cx); fire(find(ag.render(cx), "tip-over-status-t0-mark"), "on_hover", on, cx); while (cx.timers.length) { const t = cx.timers.shift(); if (!t.gone) t.fn(cx); } };
    over(true);
    assert.ok(strings(mark().style.content).length > 0);
    assert.equal(find(ag.render(cx), "status-t0").style.accessibility_label, strings(mark().style.content)[0]);
    over(false);
    assert.equal(strings(mark().style.content).length, 0);
    assert.equal(find(footer.render(cx), "tip-settings").style.anchor, "bottom_center");
  }
  {
    // Whatever opens over its button covers it, and the pointer may not move: it doesn't stay lit.
    const f = fixture(256), footer = f.load("t3-chrome", { footer: true }), agents = f.load("t3-agents"), inbox = f.load("t3-inbox");
    for (const [view, id] of [[footer, "settings"], [agents, "ag-sort"], [inbox, "inbox-new-tab"]]) {
      fire(find(view.render(cx), id), "on_hover", true, cx);
      assert.equal(view.hot, id);
      fire(find(view.render(cx), id), "on_click", {}, cx);
      assert.equal(view.hot, null, `${id} doesn't stay lit`);
    }
  }
  {
    // Lists and Inbox make the same things the same way: with two machines New space asks, in the layout's menu; docked alone it can't.
    const f = fixture(256), menu = { newMenu: "t3-new-menu" };
    for (const [mod, space, tab] of [["t3-spaces", "space-new", "space-new-tab"], ["t3-inbox", "inbox-new-space", "inbox-new-tab"]]) {
      const view = f.load(mod, menu);
      f.calls.length = f.overlays.length = 0;
      fire(find(view.render(cx), space), "on_click", {}, cx);
      assert.deepEqual(f.calls, [], `${space} asks first`);
      assert.deepEqual(plain(f.overlays), [{ mod: "t3-new-menu", kind: "popup", frame: "none", at: "top", offset: 96, width: 576, height: 420, props: { pick: true } }], `${space} opens on the machines`);
      fire(find(view.render(cx), tab), "on_click", {}, cx);
      assert.deepEqual(f.calls.splice(0), [["mod.open", { name: "t3-new-menu" }]], `${tab} picks a space`);
      f.overlays.length = 0;
      fire(find(f.load(mod).render(cx), space), "on_click", {}, cx);
      assert.deepEqual(f.calls.splice(0), [["space.new", {}]], `${space} docked alone`);
      assert.equal(f.overlays.length, 0);
      // A popup's button toggles: the press closed it on its way in, so the click opens nothing. The other button's still opens its step.
      const pressClick = (id) => { fire(find(view.render(cx), id), "on_mouse_down:left", {}, cx); f.state[`t3-new-menu.${id === space ? "pickClosed" : "closed"}`] = Date.now(); fire(find(view.render(cx), id), "on_click", {}, cx); };
      pressClick(space); pressClick(tab);
      assert.deepEqual([f.calls.length, f.overlays.length], [0, 0], `${space} and ${tab} close what they opened`);
      delete f.state["t3-new-menu.closed"];
      fire(find(view.render(cx), tab), "on_mouse_down:left", {}, cx);
      f.state["t3-new-menu.pickClosed"] = Date.now();
      fire(find(view.render(cx), tab), "on_click", {}, cx);
      assert.deepEqual(f.calls.splice(0), [["mod.open", { name: "t3-new-menu" }]], "New tab in… over New space's step changes step");
      delete f.state["t3-new-menu.closed"]; delete f.state["t3-new-menu.pickClosed"];
      fire(find(view.render(cx), space), "on_mouse_down:left", {}, cx);
      f.state["t3-new-menu.closed"] = Date.now();
      fire(find(view.render(cx), space), "on_click", {}, cx);
      assert.deepEqual(f.overlays.splice(0).map((o) => plain(o.props)), [{ pick: true }], "New space over New tab in…'s step changes step once");
      delete f.state["t3-new-menu.closed"];
    }
    {
      // A remote space can outlive the machine's entry. Each entry must offer the same choice.
      const f = fixture(256), local = () => [{ name: null, layout: "ready" }];
      const load = (name, props) => {
        const view = f.load(name, props);
        f.scopes.get(name).machines = local;
        return view;
      };
      const header = [[load("t3-spaces", menu), "space-new"], [load("t3-inbox", menu), "inbox-new-space"]];
      const menuFooter = () => [load("t3-new-menu"), "space-new"];
      const click = ([view, id]) => fire(find(view.render(cx), id), "on_click", {}, cx);
      const tipLabel = ([view, id]) => {
        view.hot = id;
        fire(find(view.render(cx), `tip-over-${id}`), "on_hover", true, cx);
        while (cx.timers.length) { const t = cx.timers.shift(); if (!t.gone) t.fn(cx); }
        return strings(find(view.render(cx), `tip-${id}`).style.content);
      };
      const pickAway = (view) => {
        const row = () => find(view.render(cx), "machine:vps");
        assert.match(strings(row()).join(" "), /vps.*Unavailable/, "an unreported machine with a space stays listed");
        fire(row(), "on_click", {}, cx);
        assert.deepEqual(f.calls.splice(0), [], "an unavailable machine cannot create a space");
      };
      for (const control of header) {
        assert.deepEqual(tipLabel(control), ["New space"], "the header does not advertise a key that makes a different choice");
        click(control);
        assert.deepEqual(f.calls.splice(0), [], `${control[1]} still asks about the unreported machine`);
        const [popup] = f.overlays.splice(0);
        assert.deepEqual(plain(popup.props), { pick: true });
        const picker = load("t3-new-menu", popup.props);
        pickAway(picker);
        picker.close();
      }
      const footer = menuFooter();
      assert.ok(!strings(find(footer[0].render(cx), footer[1])).includes("⌘N"), "neither does the footer");
      click(footer);
      pickAway(footer[0]);
      f.spaces().pop();
      for (const control of header) assert.deepEqual(tipLabel(control), ["New space (⌘N)"], "the key now makes the same choice as the header");
      for (const control of [...header, menuFooter()]) {
        click(control);
        assert.deepEqual(f.calls.splice(0), [["space.new", { machine: "" }]], `${control[1]} creates directly with only this computer`);
        assert.deepEqual(f.overlays, [], "a direct create doesn't open an overlay");
      }
    }
    {
      const inbox = f.load("t3-inbox", {});
      f.calls.length = 0;
      const tree = inbox.render(cx);
      assert.ok(find(tree, "inbox-search-input"), "Inbox has a search input before any interaction");
      fire(find(tree, "inbox-search-field"), "on_mouse_down:left", {}, cx);
      assert.deepEqual(f.calls, [], "focusing Inbox search keeps the current pane and overlays in place");
    }
    // A machine's row is T3's shelf with its folder's +. The + and the chevron stand in the heading's two button columns:
    // in 8 + 2 + 8, the group 2 past the edge puts a 12px chevron's middle 22 from the sidebar's, and a 24px + 10 before it, 50.
    // Not on the chevron's own box: there Herdr draws the whole group past the sidebar's edge.
    const lists = f.load("t3-spaces", menu), row = find(lists.render(cx), "machine-local");
    const add = find(row, "machine-add-local").style, slots = row.items.at(-1).style;
    assert.deepEqual([row.style.h, row.style.mx, row.style.px, add.h, add.w, add.rounded, slots.gap, slots.mr, find(row, "machine-fold-local").style.mr], [32, 2, 8, 24, 24, 8, 10, -2, undefined]);
    assert.equal(row.style.text_size, 12, "the same size as the agents' group headers and Inbox's shelves");
    assert.ok(row.items.findIndex(n => find(n, "machine-state-local")) < row.items.findIndex(n => find(n, "machine-add-local")), "the dot is before the +");
    // Hover labels name the control, and its key only when the key does the same.
    lists.machines = [{ name: "spare", state: "asleep" }];
    const blank = find(lists.render(cx), "machine-new-spare");
    assert.deepEqual([blank.style.px, blank.items[0].style.size, blank.style.gap], [8, 16, 10], "New space here lays out as a space's row");
    lists.machines = [{ name: "vps", state: "connected" }];
    for (const flag of [true, undefined, false]) {
      lists.machines = [{ name: "vps", state: "connected", ...(flag === undefined ? {} : { keeps_running_after_logout: flag }) }];
      const warning = find(lists.render(cx), "machine-logout-vps");
      assert.equal(Boolean(warning), flag === false, "warn only on an explicit false, even while connected");
    }
    const warning = find(lists.render(cx), "machine-logout-vps"), before = f.labelled.length;
    let stopped = false;
    fire(warning, "on_click", {}, { ...cx, stop_propagation() { stopped = true; } });
    assert.deepEqual(plain(f.overlays.pop()), { mod: "machine-add", kind: "dialog", width: 560 }, "the official dialog owns the fix and Copy");
    assert.ok(stopped, "the warning's click cannot fold its machine");
    assert.equal(lists.folded.has("vps"), false);
    assert.equal(f.labelled.length, before, "opening the instructions never executes sudo or another core command");
    lists.machines[0].keeps_running_after_logout = true;
    assert.equal(find(lists.render(cx), "machine-logout-vps"), null, "a repaired machine loses the warning");
    const label = (id) => { lists.hot = id; fire(find(lists.render(cx), `tip-over-${id}`), "on_hover", true, cx); while (cx.timers.length) { const t = cx.timers.shift(); if (!t.gone) t.fn(cx); } return strings(find(lists.render(cx), `tip-${id}`).style.content); };
    assert.deepEqual(label("space-new"), ["New space"], "⌘N doesn't ask, as this does");
    assert.deepEqual(label("space-new-tab"), ["New tab in…"]);
    assert.deepEqual(label("machine-add-local"), ["New space here (⌘N)"], "⌘N makes it on this space's machine");
    assert.deepEqual(label("machine-add-vps"), ["New space here"], "and not on another");
    assert.deepEqual(label("machine-state-local"), ["Connected"]);
    // Three kinds: a button does what the row doesn't (a ground on hover, a label); an indicator is the row's (it lights with it);
    // a mark only says (a label, no ground).
    const fold = () => find(lists.render(cx), "machine-fold-local");
    assert.equal(find(lists.render(cx), "tip-machine-fold-local"), null, "the chevron has no label: the row folds");
    assert.deepEqual([fold().hoverStyle.bg, fold().style.text_color], [undefined, f.theme().dim]);
    fire(find(lists.render(cx), "machine-local"), "on_hover", true, cx);
    assert.equal(fold().style.text_color, f.theme().foreground, "it lights with its row");
    fire(find(lists.render(cx), "machine-local"), "on_hover", false, cx);
    assert.equal(fold().style.text_color, f.theme().dim, "and dims when the pointer leaves");
    assert.equal(find(lists.render(cx), "machine-add-local").hoverStyle.bg, undefined, "a button in a row only lights up, as T3's");
    assert.equal(find(lists.render(cx), "machine-state-local").hoverStyle.bg, undefined, "a mark: no ground");
    lists.hot = null;
  }
  {
    // A row's details, as T3's thread card: at the row's top right, with T3's tooltip group for timing and fade.
    const f = fixture(256), inbox = f.load("t3-inbox");
    f.panes()[0].branch = "feat/x";
    f.panes()[1].branch = "main";
    const anchor = (a) => find(inbox.render(cx), `details-${a}`);
    const card = (a) => anchor(a)?.style.content;
    const row = (a) => find(inbox.render(cx), `card-${a}`);
    const hover = (a, on) => fire(row(a), "on_hover", on, cx);
    cx.timers.length = 0; // Other tests' hovers left theirs.
    const due = (ms) => cx.timers.filter(t => t.ms === ms && !t.gone);
    const pass = (ms) => { for (const t of due(ms)) { t.gone = true; t.fn(cx); } };
    assert.equal(anchor("t0"), null, "nothing until hovered");
    hover("t0", true);
    assert.deepEqual([anchor("t0").style.top, anchor("t0").style.right, anchor("t0").style.size], [-1, -1, 1], "its bottom left, where a Popup hangs from, is the row's top right");
    assert.equal(card("t0"), undefined, "the first waits, its anchor already measured");
    assert.equal(due(150).length, 1);
    hover("t0", false);
    assert.equal(due(150).length, 0, "leaving first cancels it");
    assert.equal(anchor("t0"), null);
    hover("t0", true);
    pass(150);
    assert.equal(card("t0").style.opacity, 0, "drawn clear first: a transition adopts the first value it sees");
    assert.ok(card("t0").key && "transition" in card("t0").style, "and it needs an id to sample by");
    pass(34);
    assert.equal(card("t0").style.opacity, 1, "then it fades in");
    assert.equal(card("t0").style.ml, 4);
    assert.ok(row("t0").style.relative !== undefined);
    assert.deepEqual(strings(card("t0")).slice(1), ["P", "project 0", "feat/x", "Pi"], "the card describes its own project, branch and program");
    assert.equal(strings(card("t0"))[0], row("t0").style.accessibility_label, "led by the title the row shows");
    // The pointer can report entering the next row before leaving this one.
    hover("vps/t2", true);
    assert.equal(card("t0"), undefined, "the one it replaces goes at once, as T3's tooltip group (data-instant): no fading card under the new one");
    assert.equal(card("vps/t2").style.opacity, 1, "unfaded");
    assert.deepEqual(strings(card("vps/t2")).slice(1), ["P", "project 2", "vps", "main", "Pi"], "another machine's names it");
    const labelDelay = (id) => { fire(find(inbox.render(cx), `tip-over-${id}`), "on_hover", true, cx); const { ms } = cx.timers.at(-1); fire(find(inbox.render(cx), `tip-over-${id}`), "on_hover", false, cx); return ms; };
    assert.equal(labelDelay("settle-t0"), 0, "a control's label in the row opens at once too");
    hover("t0", false);
    assert.ok(card("vps/t2"), "the late leave of the row before doesn't close it");
    hover("vps/t2", false);
    assert.equal(card("vps/t2").style.opacity, 0, "the last one fades out");
    assert.equal(due(150).length, 1);
    pass(150);
    assert.equal(anchor("vps/t2"), null, "then it's gone");
    hover("t0", true);
    assert.equal(card("t0").style.opacity, 1, "within 400ms the next still opens at once");
    inbox.hot = "settle-t0";
    assert.deepEqual([card("t0").style.opacity, card("t0").style.left], [0, -4], "a lit control's own label speaks instead: the card fades back toward the row");
    inbox.hot = null;
    assert.equal(card("t0").style.opacity, 1, "and it's back with the pointer on the row");
    fire(row("t0"), "on_click", {}, cx);
    assert.equal(card("t0").style.opacity, 0, "a click takes it down");
    pass(150);
    assert.equal(card("t0"), undefined);
    hover("t0", false);
    inbox.detailsClosed = Date.now() - 400;
    assert.equal(labelDelay("settle-t0"), 150, "past 400ms a label waits again");
    hover("t0", true);
    assert.equal(card("t0"), undefined, "and so does the card");
    pass(150);
    assert.equal(card("t0").style.opacity, 0);
    hover("t0", false);
    hover("t0", true);
    assert.equal(card("t0").style.opacity, 1, "coming back while it fades out lifts it again");
  }
  {
    // A hover label, as T3's: the label with its bound key, a dim hint, and nothing up unless the button is lit.
    const f = fixture(256), tabs = f.load("t3-tabs"), inbox = f.load("t3-inbox"); // Husain's + is the strip's
    f.spaces()[0].active = true;
    const card = (view, id) => find(view.render(cx), `tip-${id}`).style.content;
    const lit = (view, id) => { fire(find(view.render(cx), id), "on_hover", true, cx); fire(find(view.render(cx), `tip-over-${id}`), "on_hover", true, cx); while (cx.timers.length) { const t = cx.timers.shift(); if (!t.gone) t.fn(cx); } };
    assert.deepEqual(strings(card(tabs, "tab-new")), [], "not while unlit");
    lit(tabs, "tab-new");
    assert.deepEqual(strings(card(tabs, "tab-new")), ["New tab (⌘T)"]);
    assert.equal(card(tabs, "tab-new").style.text_size, 12);
    fire(find(tabs.render(cx), "tab-new"), "on_click", {}, cx);
    lit(inbox, "inbox-new-tab");
    assert.deepEqual(strings(card(inbox, "inbox-new-tab")), ["New tab in…"], "a label names its control; what opens says the rest");
    fire(find(inbox.render(cx), "inbox-new-tab"), "on_click", {}, cx);
    assert.deepEqual(strings(card(inbox, "inbox-new-tab")), [], "what opens over it takes its label down");
    inbox.hot = "inbox-scope";
    fire(find(inbox.render(cx), "tip-over-inbox-scope"), "on_hover", true, cx);
    while (cx.timers.length) { const t = cx.timers.shift(); if (!t.gone) t.fn(cx); }
    assert.deepEqual(strings(card(inbox, "inbox-scope")), ["Filter by space", "Shift+click to pick several"], "a second line only for what can't be seen");
    // A program's icon has no label of its own, as T3's rows.
    f.panes()[0].program = f.agents()[0].program;
    for (const [name, view] of Object.entries({ tabs: f.load("t3-tabs"), inbox, agents: f.load("t3-agents"), pane: f.load("t3-pane", { pane: "p0" }) })) {
      const nodes = walk(view.render(cx));
      assert.ok(nodes.some(n => n.source === "icons/pi.svg"), `${name}: the icon is there`);
      // A label whose trigger is the icon alone; a tab's, with its name, is the tab's. A tab's × holds its icon at rest, but its
      // label shows only once the hover has put × over the icon (shared/tab.js).
      assert.ok(!nodes.some(n => String(n.key).startsWith("tip-") && !String(n.key).endsWith("-close") && strings(n.items[0]).length === 0 && walk(n).some(c => c.source === "icons/pi.svg")), `${name}: no label on a program's icon`);
    }
  }
  {
    // A tab as T3's panel tab (shared/tab.js): 24px, 12px; × covers its icon while the tab is hovered, its status mark stays
    // at the end. A tab drags as a space does, and leaving ends either.
    const f = fixture(256), tabs = f.load("t3-tabs"), spaces = f.load("t3-spaces");
    f.spaces()[0].active = f.spaces()[0].tabs[0].active = true;
    f.spaces()[0].tabs.push({ id: "other", index: 2, name: "other", named: true });
    const tab = find(tabs.render(cx), "tab-other").style;
    assert.deepEqual([tab.h, tab.text_size, tab.pl, tab.pr, tab.gap], [24, 12, 6, 8, 2]);
    const close = () => find(tabs.render(cx), "tab-other-close");
    assert.deepEqual([close().style.h, close().style.w, close().style.accessibility_label], [16, 16, "Close other"], "every tab has it, not only the active one");
    assert.equal(walk(close()).find(n => n.source)?.source, "mods/t3-tabs/icons/terminal.svg", "at rest it holds the tab's icon, a terminal's when it has no program");
    fire(find(tabs.render(cx), "tab-other"), "on_hover", true, cx);
    assert.deepEqual(walk(close()).filter(n => n.source).map(n => n.source), ["mods/t3-tabs/icons/x.svg"], "hovered, × over the icon");
    assert.equal(find(tabs.render(cx), "tab-other").style.text_color, f.theme().foreground);
    assert.equal(find(tabs.render(cx), "tab-other").items.at(-1).style.size, 16, "the end slot kept for the status mark, × or no ×");
    fire(find(tabs.render(cx), "tab-other"), "on_mouse_down:middle", {}, cx);
    assert.deepEqual(f.calls.pop(), ["t3-tabs.close-tab:other", {}], "a middle press goes through the tab bar's answer, as × does");
    assert.ok(walk(find(tabs.render(cx), "tab-other")).some(n => "truncate" in n.style && n.style.min_w === 0), "the name truncates in the tab itself");
    fire(find(tabs.render(cx), "tab-other"), "on_hover", false, cx);
    assert.equal(walk(close()).find(n => n.source)?.source, "mods/t3-tabs/icons/terminal.svg", "the × goes with the pointer");
    fire(close(), "on_click", {}, cx);
    assert.deepEqual(f.calls.pop(), ["t3-tabs.close-tab:other", {}], "the × goes through the tab bar's answer");
    fire(find(tabs.render(cx), "tab-b0"), "on_mouse_down:left", { click_count: 1, position: { x: 0, y: 0 } }, cx);
    assert.equal(find(tabs.render(cx), "tab-b0").style.opacity, undefined, "a press alone doesn't lift it");
    fire(find(tabs.render(cx), "tab-other"), "on_mouse_move", { position: { x: 40, y: 0 } }, cx);
    assert.equal(find(tabs.render(cx), "tab-b0").style.opacity, 0.5, "the dragged tab fades");
    assert.ok(walk(find(tabs.render(cx), "tab-other")).some(n => "absolute" in n.style && n.style.w === 2), "a line shows where it lands");
    fire(tabs.render(cx), "on_hover", false, cx);
    assert.equal(tabs.pressed, null, "leaving the bar ends the drag");
    assert.equal(find(tabs.render(cx), "tab-b0").style.opacity, undefined);
    const id = `space-${f.spaces()[0].id}`;
    fire(find(spaces.render(cx), id), "on_mouse_down:left", {}, cx);
    fire(find(spaces.render(cx), "space-list"), "on_hover", false, cx);
    assert.equal(spaces.drag, null, "leaving the list ends a space's drag");
  }
  {
    // A tab's name: said whole in a label below only when cut short (t3-tokens P5), as the panel's tabs; a press hides it.
    const f = fixture(256), tabs = f.load("t3-tabs");
    f.spaces()[0].tabs.push({ id: "other", index: 2, name: "other", named: true });
    const pending = () => { while (cx.timers.some(t => !t.gone)) cx.timers.filter(t => !t.gone).forEach(t => { t.gone = true; t.fn(cx); }); };
    const label = () => find(tabs.render(cx), "tip-tab-other")?.style.content;
    const hover = (on) => { fire(find(tabs.render(cx), "tip-over-tab-other"), "on_hover", on, cx); fire(find(tabs.render(cx), "tab-other"), "on_hover", on, cx); };
    tabs.nameW = { "tab-other": 40 }; tabs.textW = { "tab-other": 40 };
    assert.equal(find(tabs.render(cx), "tip-tab-other"), null, "a name the tab shows whole has no label: it would only repeat it");
    tabs.nameW["tab-other"] = 400;
    hover(true); pending();
    assert.deepEqual(strings(label()), ["other"], "a name cut short does");
    assert.equal(find(tabs.render(cx), "tip-tab-other").style.anchor, "top_center", "below the tab");
    fire(find(tabs.render(cx), "tab-other"), "on_mouse_down:left", { click_count: 1, position: { x: 0, y: 0 } }, cx);
    assert.equal(label(), undefined, "a press hides it");
    fire(find(tabs.render(cx), "tab-other"), "on_mouse_up:left", {}, cx);
    f.calls.pop();
    hover(false);
    // × has its own label, which waits long enough for a straight click and has a key only on the active tab.
    fire(find(tabs.render(cx), "tip-over-tab-other-close"), "on_hover", true, cx);
    fire(find(tabs.render(cx), "tab-other-close"), "on_hover", true, cx);
    assert.equal(cx.timers.at(-1).ms, 500);
    pending();
    assert.deepEqual(strings(find(tabs.render(cx), "tip-tab-other-close").style.content), ["Close tab"], "no key: it closes the active tab only");
    fire(find(tabs.render(cx), "tab-other-close"), "on_hover", false, cx);
  }
  {
    // The keys copy alone consumes commands; the dialog it opens clears the card under the pointer in the strip.
    const f = fixture(256), jobs = [], spawn = cx.spawn;
    f.spaces()[0].tabs.push({ id: "other" });
    Object.assign(f.shown, { tab: "b0", pane: "p0" });
    f.answerHc(() => ({ code: 0, stdout: JSON.stringify({ pid: 1, foreground: { pid: 2, name: "sleep" } }) }));
    cx.spawn = fn => jobs.push(fn);
    const view = f.load("t3-tabs");
    f.also("t3-tabs", { part: "end", block: "tabs-end" });
    f.also("t3-tabs", { part: "measure" });
    f.also("t3-tabs", { part: "keys" });
    cx.spawn = spawn;
    assert.equal(jobs.length, 2, "the strip listens for closes; of the layout's copies only keys answers, or one close opens several dialogs");
    Object.assign(view, { overTab: "tab-b0", hot: "tab-b0-close", details: "b0" });
    // Each shown copy hears a command: one each for the strip and keys.
    f.commands.push("close-tab", "close-tab"); for (const job of jobs) job(cx); await new Promise(setImmediate);
    assert.deepEqual([view.overTab, view.hot, view.details], [null, null, null], "cmd-w over a hovered tab takes its card too");
    assert.equal(f.overlays.length, 1);
    assert.deepEqual(f.calls, [], "the command listener waits for confirmation");
    const answer = () => f.overlays.pop().props.command.name.slice("t3-tabs.".length);
    const first = answer();
    f.spaces()[0].tabs.pop();
    await view.navigation.handle(first, cx);
    assert.deepEqual(f.calls, [], "the original answer doesn't close a space made last while the dialog was open");
    assert.match(f.overlays.at(-1).props.detail, /space closes too/);
    await view.navigation.handle(answer(), cx);
    assert.deepEqual(f.calls, [["tab.close", { id: "b0", confirmed: true }]], "the updated dialog's command confirms the space consequence");
  }
  {
    // Both modes walk their drawn rows and stop at either end, including while hidden.
    const f = fixture(256), jobs = [], spawn = cx.spawn;
    cx.spawn = fn => jobs.push(fn);
    f.load("t3-tabs", { part: "keys" }); f.also("t3-tabs", { part: "end" }); f.also("t3-tabs", { part: "measure" }); f.load("t3-chrome"); f.load("t3-chrome", { footer: true });
    cx.spawn = spawn;
    // Husain's footer also starts its usage watcher (t3-chrome usage.js): two loops that read files, not commands.
    assert.equal(jobs.length, 3, "only the keys copy listens, beside the footer's usage watcher");
    assert.deepEqual(Object.values(JSON.parse(fs.readFileSync(path.join(modRoot, "..", "keys.json"), "utf8"))["layout:focus"]).filter(a => /^t3-(chrome|inbox)\./.test(a)), [], "a key's command goes to the mod that always shows: another's would miss it, or toast");
    f.slots.lists = { id: "sidebar-lists", active: "inbox" };
    const press = async (command, rows) => {
      f.state["t3-inbox.rows"] = rows; f.state["t3-agents.rows"] = rows; f.calls.length = 0; f.commands.push(command);
      jobs[0](cx); await new Promise(resolve => setImmediate(resolve));
      return f.calls.slice();
    };
    const order = ["t0", "vps/t2", "t5"];
    assert.deepEqual(await press("next", { order, view: "vps/t2" }), [["agent.focus", { terminal: "t5" }]]);
    assert.deepEqual(await press("prev", { order, view: "vps/t2" }), [["agent.focus", { terminal: "t0" }]]);
    assert.deepEqual(await press("next", { order, view: "t5" }), [], "at the end it stays, as T3's");
    assert.deepEqual(await press("prev", { order, view: "t0" }), []);
    assert.deepEqual(await press("next", { order, view: null }), [["agent.focus", { terminal: "t0" }]], "none in view: the first");
    assert.deepEqual(await press("prev", { order, view: null }), [["agent.focus", { terminal: "t5" }]], "or the last");
    const mixed = ["t0", "pane:p9", "t5"];
    assert.deepEqual(await press("next", { order: mixed, view: "t0" }), [["pane.focus", { pane: "p9" }]], "a mod pane's row has no agent to focus");
    assert.deepEqual(await press("next", { order: mixed, view: "pane:p9" }), [["agent.focus", { terminal: "t5" }]], "and the walk goes on from it");
    // A zoom on another pane of the target's tab goes first, in the same tick; on the target itself, a toggle would undo it.
    const p2 = f.panes().find(p => p.pane === "p2"), other = { pane: "px", tab: p2.tab, terminal: "tx", zoomed: true };
    f.panes().push(other);
    assert.deepEqual(await press("next", { order, view: "t0" }), [["pane.zoom", { pane: "p2" }], ["agent.focus", { terminal: "vps/t2" }]], "the zoom goes to the target before the focus");
    other.zoomed = false; p2.zoomed = true;
    assert.deepEqual(await press("next", { order, view: "t0" }), [["agent.focus", { terminal: "vps/t2" }]], "already zoomed: left alone");
    p2.zoomed = false;
    assert.deepEqual(await press("next", { order, view: "t0" }), [["agent.focus", { terminal: "vps/t2" }]], "no zoom in its tab: none made");
    f.panes().pop();
    f.slots.lists.active = "lists";
    assert.deepEqual(await press("next", { order, view: "t0" }), [["agent.focus", { terminal: "vps/t2" }]], "Lists use their drawn rows");
    assert.deepEqual(await press("prev", { order, view: "t0" }), [], "Lists stop at the beginning too");
    f.slots.sidebar.hidden = true;
    assert.deepEqual(await press("next", { order, view: "t0" }), [["agent.focus", { terminal: "vps/t2" }]], "hidden Lists keep their mode");
    assert.deepEqual(await press("next", { order, view: "t5" }), [], "and stop at the end");
    f.slots.lists.active = "inbox"; f.slots.sidebar.hidden = true;
    assert.deepEqual(await press("next", { order, view: "t0" }), [["agent.focus", { terminal: "vps/t2" }]], "hidden Inbox keeps its mode");
    assert.deepEqual(await press("prev", { order, view: "t0" }), []);
    // Busy work cannot be settled; as T3's sidebar keys, ⌘⇧L does nothing with no sidebar on screen.
    assert.deepEqual(await press("sidebar"), [], "hidden, nothing to switch");
    assert.deepEqual(await press("settle"), [], "hidden, a busy agent stays");
    delete f.slots.sidebar.hidden;
    assert.deepEqual(await press("sidebar"), [["layout.select", { stack: "sidebar-lists", child: "lists" }]], "shown, it switches");
    assert.deepEqual(await press("settle"), []);
    f.slots.lists.active = "lists";
    assert.deepEqual(await press("settle"), [], "Lists have no Settle");
    assert.deepEqual(await press("sidebar"), [["layout.select", { stack: "sidebar-lists", child: "inbox" }]]);
    // The Review shortcut observes the same availability as + and the startup list.
    const scope = f.scopes.get("t3-tabs"), reviewSpace = { id: "review-test", active: true, machine: "remote", folder: "/repo", tabs: [] };
    scope.spaces = () => [reviewSpace];
    f.slots.panel = { id: "panel", hidden: true, children: [{ id: "panel-body", active: "panel-empty", children: ["files", "panel-empty", "review"].map(id => ({ id })) }] };
    let gitReads = 0, gitCode = 128;
    scope.exec = async () => { gitReads++; return { code: gitCode, stdout: gitCode ? "" : "/repo\n" }; };
    assert.deepEqual(await press("review"), []); assert.equal(gitReads, 0, "remote never asks local Git");
    reviewSpace.machine = null;
    assert.deepEqual(await press("review"), [], "not a repository: no surface added");
    gitCode = 0;
    assert.ok((await press("review")).some(([cmd, a]) => cmd === "layout.select" && a.child === "review"));
  }
  {
    // Every menu goes by arrows and Enter, and says when a search finds nothing.
    const f = fixture(256), key = (view, id, k) => fire(find(view.render(cx), id), "on_key_down", { key: k }, cx);
    const sort = f.load("t3-agents", { sortMenu: true });
    assert.equal(find(sort.render(cx), "sort-grouped").style.bg, undefined, "it opens with nothing lit");
    key(sort, "sort-menu", "down");
    assert.equal(find(sort.render(cx), "sort-priority").style.bg, f.theme().selected, "down lights the first row");
    key(sort, "sort-menu", "enter");
    assert.equal(f.state["agents.sort"], "priority");
    const inbox = f.load("t3-inbox");
    const panel = () => find(inbox.render(cx), "inbox-scope-menu").style.content;
    fire(find(panel(), "inbox-scope-panel"), "on_key_down", { key: "down" }, cx);
    assert.equal(inbox.scopeAt, 1);
    assert.equal(find(panel(), "scope-all").style.bg, undefined);
    {
      // Past the rows that show, ↑/↓ keep the highlight in view, round the ends too; empty spaces (s1) stay out of the filter.
      assert.equal(find(panel(), "scope-s1"), null, "a space with no Inbox entry is omitted unless selected");
      f.spaces().push(...Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, name: `extra ${i}`, active: false, folder: `/work/x${i}`, machine: null, tabs: [{ id: `bx${i}` }] })));
      f.agents().push(...Array.from({ length: 12 }, (_, i) => ({ address: `tx${i}`, pane: `px${i}`, space: `x${i}`, space_name: `extra ${i}`, tab: `bx${i}`, title: `extra ${i}`, seq: 10 + i, status: "idle" })));
      const rows = () => walk(find(panel(), "inbox-scope-list")).filter((n) => String(n.key).startsWith("scope-")).map((n) => n.key);
      assert.equal(rows().length, 9, "nine show");
      const down = () => fire(find(panel(), "inbox-scope-panel"), "on_key_down", { key: "down" }, cx);
      while (inbox.scopeAt < 9) down();
      assert.ok(rows().includes(`scope-${inbox.matches()[9].id}`), "the highlight's row is drawn");
      assert.equal(find(panel(), `scope-${inbox.matches()[9].id}`).style.bg, f.theme().selected);
      fire(find(panel(), "inbox-scope-panel"), "on_key_down", { key: "up" }, cx);
      inbox.scopeAt = 0;
      fire(find(panel(), "inbox-scope-panel"), "on_key_down", { key: "up" }, cx);
      assert.ok(rows().includes(`scope-${inbox.matches().at(-1).id}`), "up from the first shows the last");
      f.agents().splice(-12);
      f.spaces().splice(-12);
      inbox.scopeAt = 0;
    }
    // As T3's: hangs from the button's left edge, 288 wide.
    assert.deepEqual([find(inbox.render(cx), "inbox-scope-menu").style.anchor, find(panel(), "inbox-scope-panel").style.w], ["top_left", 288]);
    const spaces = f.load("t3-new-menu");
    spaces.filter = "no such space";
    assert.ok(strings(spaces.render(cx)).includes("No matching spaces."));
  }
  {
    // The keyboard's way round (check-focus.cjs has its rules): no control is a stop until the mode's on; then each is, a row
    // shows with the keyboard on it what it shows hovered, and Enter does what the pointer does.
    const f = fixture(256), tabs = f.load("t3-tabs"), ag = f.load("t3-agents"), sp = f.load("t3-spaces"), footer = f.load("t3-chrome", { footer: true }), brand = f.load("t3-chrome");
    const on = (mod, id) => { mod.fs.keyboard = true; mod.fs.handles.set(id, { focus() {}, is_focused: () => true }); };
    for (const [view, id] of [[tabs, "tab-b0"], [tabs, "sidebar-toggle"], [ag, "ag-t0"], [ag, "ag-sort"], [sp, "space-s0"], [sp, "space-new"], [footer, "settings"], [brand, "sidebar-toggle"]]) {
      const node = find(view.render(cx), id);
      if (node) assert.equal(node.style.tab_index, undefined, `${id} takes no keyboard from a terminal when pressed`);
    }
    f.state["t3.focus"] = "on";
    for (const [view, id] of [[ag, "ag-t0"], [ag, "ag-sort"], [ag, "fold-t0"], [sp, "space-s0"], [sp, "space-new"], [footer, "settings"], [footer, "t3-settings"], [brand, "sidebar-toggle"], [brand, "home"], [tabs, "tab-b0"]])
      assert.equal(find(view.render(cx), id).style.tab_index, 0, `${id} is a stop`);
    assert.equal(find(tabs.render(cx), "tab-new").style.tab_index, 0); // Husain's + is the strip's
    // Tab's × and the pin come with the keyboard, as with the pointer.
    assert.equal(find(tabs.render(cx), "tab-b0-close").style.tab_index, undefined);
    on(tabs, "tab-b0");
    const tab = find(tabs.render(cx), "tab-b0");
    assert.equal(find(tab, "tab-b0-close").style.tab_index, 0);
    assert.ok(walk(find(tab, "tab-b0-close")).some((n) => n.source === "mods/t3-tabs/icons/x.svg"), "the × shows");
    assert.ok(tab.items.some((n) => n.style?.border === 2 && n.style.border_color === f.theme().accent), "the ring is on the tab");
    // A tab and a space go by their mouse-ups: a key has to say so itself.
    fire(tab, "on_key_down", { keystroke: "enter" }, cx);
    assert.deepEqual(f.calls.pop(), ["tab.select", { id: "b0" }]);
    on(sp, "space-s0");
    fire(find(sp.render(cx), "space-s0"), "on_key_down", { keystroke: "space" }, cx);
    assert.deepEqual(f.calls.pop(), ["space.select", { id: "s0" }]);
    assert.equal(find(ag.render(cx), "pin-t0").style.tab_index, undefined);
    on(ag, "ag-t0");
    assert.equal(find(ag.render(cx), "pin-t0").style.tab_index, 0, "a hidden control is there once the keyboard's on its row");
    // Menus: Home, End and typing, with the same highlight the arrows move.
    const sort = f.load("t3-agents", { sortMenu: true }), key = (e) => fire(find(sort.render(cx), "sort-menu"), "on_key_down", e, cx), lit = () => find(sort.render(cx), "sort-priority").style.bg === f.theme().selected ? "priority" : "grouped";
    key({ key: "home" });
    assert.equal(lit(), "priority");
    key({ key: "end" });
    assert.equal(lit(), "grouped");
    key({ key: "p", key_char: "p", modifiers: {} });
    assert.equal(lit(), "priority");
  }
  // At Home the tab bar's row folds to 8px so Home's mod takes the height; it stays with the sidebar hidden (its toggle and
  // the macOS window buttons are there) or the bar's own window buttons, and comes back on leaving. Home's pane shows in
  // home-main, the frame with no header, whatever the row does.
  {
    const f = fixture(256), list = f.spaces();
    f.slots["tabs-row"] = { id: "tabs-row", size: { px: 40 } };
    f.slots["work-main"] = { id: "work-main", type: "stack", active: "main" };
    const bar = f.load("t3-tabs", { part: "keys" }), resized = () => plain(f.calls.splice(0).filter(([n]) => n.startsWith("layout.")));
    bar.render(cx); assert.deepEqual(resized(), [], "away from Home, as the layout has it");
    list[0].active = false; list.push({ id: "h", name: "Home\u200b", named: true, active: true, machine: null, tabs: [{ id: "page", active: true }] }); f.state["t3-tabs.home"] = "h";
    // The fixture applies a resize and a select, as Herdr does.
    bar.render(cx); assert.deepEqual(resized(), [["layout.select", { stack: "work-main", child: "home-main" }], ["layout.resize", { id: "tabs-row", px: 8 }]]);
    bar.render(cx); assert.deepEqual(resized(), [], "once");
    f.slots.sidebar.hidden = true;
    bar.render(cx); assert.deepEqual(resized(), [["layout.resize", { id: "tabs-row", px: 40 }]], "the sidebar hidden: its toggle needs the row");
    f.slots.sidebar.hidden = false; f.ui.window.buttons = true;
    bar.render(cx); assert.deepEqual(resized(), [], "window buttons of its own: it stays");
    f.ui.window.buttons = false;
    bar.render(cx); assert.deepEqual(resized(), [["layout.resize", { id: "tabs-row", px: 8 }]]);
    list.pop(); list[0].active = true;
    bar.render(cx); assert.deepEqual(resized(), [["layout.select", { stack: "work-main", child: "main" }], ["layout.resize", { id: "tabs-row", px: 40 }]], "back from Home");
  }
  // Home's page, sidebar, pane header and bar agree on the same hidden space.
  {
    const f = fixture(256), list = f.spaces();
    const home = { id: "h", name: "Home\u200b", named: true, active: true, machine: null, folder: "/home/test", tabs: [{ id: "page", name: "Home", active: true }] };
    list[0].active = false; list.splice(1, 0, home); f.state["t3-tabs.home"] = "h";
    const made = () => plain(f.calls.splice(0));
    const view = f.load("t3-spaces");
    view.render(cx);
    assert.ok(!view.rows.some(e => e.key === "space-h"), "no row");
    assert.ok(view.rows.some(e => e.key === "space-s1"));
    assert.ok(!f.calls.some(([name]) => name === "space.move"), "and the rows' order still counts it: nothing moves");
    f.calls.length = 0;

    // At Home the bar is empty, Herdr's name keeps its one look and goes there, and what the bar's keys would do elsewhere stays out of it.
    const strip = f.load("t3-tabs", { part: "strip" }).render(cx);
    assert.equal(find(strip, "tab-page"), null, "no tab");
    assert.equal(find(f.load("t3-tabs", { part: "end" }).render(cx), "tab-new"), null, "no +");
    const mark = () => find(f.load("t3-chrome").render(cx), "home");
    assert.deepEqual([mark().style.text_color, mark().style.bg], [f.theme().muted, undefined], "one look at Home too, as T3's: the name muted, no background");
    fire(find(f.load("t3-chrome").render(cx), "home"), "on_click", {}, cx);
    assert.deepEqual(made(), [["t3-tabs.home", {}]]);

    // The page: what can be done next as buttons, each stroke of a bound key on a cap of its own.
    {
      f.slots.lists = { id: "sidebar-lists", active: "inbox" };
      f.state["t3-inbox.rows"] = { order: ["t0"], view: null };
      f.calls.length = 0;
      const page = f.load("t3-home"), tree = () => page.render(cx);
      assert.deepEqual(strings(tree()), ["Next agent", "Go to", "New tab", "⌘", "T"], "an unbound action stays a button, with no caps");
      fire(find(tree(), "home-next"), "on_click", {}, cx);
      fire(find(tree(), "home-goto"), "on_click", {}, cx);
      fire(find(tree(), "home-new"), "on_click", {}, cx);
      assert.deepEqual(plain(f.calls.splice(0)), [["t3-tabs.next", {}], ["mod.open", { name: "t3-picker" }], ["t3-tabs.new", {}]]);
      // Go to and New tab are popups' buttons here too; Next agent has none to toggle.
      for (const [id, key] of [["home-goto", "t3-picker.closed"], ["home-new", "t3-new-menu.closed"], ["home-next", "t3-picker.closed"]]) {
        fire(find(tree(), id), "on_mouse_down:left", {}, cx); f.state[key] = Date.now(); fire(find(tree(), id), "on_click", {}, cx);
      }
      assert.deepEqual(plain(f.calls.splice(0)), [["t3-tabs.next", {}]]);
      delete f.state["t3-picker.closed"]; delete f.state["t3-new-menu.closed"];
      f.state["t3-inbox.rows"] = { order: [], view: null };
      assert.equal(find(tree(), "home-next").handlers.on_click, undefined, "nowhere to go: no button");
      assert.ok(find(tree(), "home-next").style.opacity < 1);
      assert.ok(find(tree(), "home-goto").handlers.on_click, "and the others stay");
      f.slots.lists.active = "lists";
      f.state["t3-agents.rows"] = { order: ["t0"], view: null };
      assert.ok(find(tree(), "home-next").handlers.on_click, "Lists go by their rows");
      f.slots.lists.active = "inbox"; f.slots.sidebar.hidden = true;
      assert.equal(find(tree(), "home-next").handlers.on_click, undefined, "hidden Inbox still has no rows");
      delete f.slots.sidebar.hidden;
      delete f.slots.lists;
      delete f.state["t3-inbox.rows"];
      // The mode's owner closing ends the mode: its row can move the page aside, and its timers go with it.
      f.state["t3.focus"] = page.fs.me;
      page.close();
      assert.equal(f.state["t3.focus"], null);
    }

    // Home has no header, whatever is there: nothing to split or close, and Home itself tells where this is.
    const panes = f.panes(), head = (tab) => { panes.push({ pane: "ph", tab, mod: "review", title: "review" }); const n = walk(f.load("t3-pane", { pane: "ph" }).render(cx)); panes.pop(); return n.some(x => x.key === "pane-head-ph"); };
    assert.equal(head("page"), false);
    assert.equal(head(f.spaces()[0].tabs[0].id), true, "a mod elsewhere has its header");

  }
  // With the Inbox showing, the bar holds the agent in view and what's around it; the sidebar says what needs the person.
  {
    const f = fixture(256);
    const program = { key: "pi", name: "Pi", agent: true, tint: true, icon: "icons/pi.svg" };
    const tabs = f.spaces()[0].tabs;
    tabs.splice(0, tabs.length, ...["prog", "other", "mine", "kid", "rev"].map(id => ({ id, name: id, named: true, active: false })));
    const agent = (address, tab, status, parent) => ({ address, pane: `p-${tab}`, tab, space: "s0", space_name: "project 0", title: tab, status, program, parent, state: "live", focused: false });
    const list = [agent("A", "mine", "working"), agent("B", "other", "blocked"), agent("K", "kid", "working", "A")];
    f.agents().splice(0, f.agents().length, ...list);
    f.terminals().splice(0, f.terminals().length, ...list);
    f.panes().splice(0, f.panes().length, ...list.map(a => ({ ...a, terminal: a.address })),
      { pane: "p-prog", terminal: "sh", tab: "prog", title: "lazygit" }, { pane: "p-rev", terminal: null, mod: "review", tab: "rev", title: "review" });
    const view = f.load("t3-tabs");
    // A drag hands the keyboard back to the terminal it was on (endDrag): the fixture's focus now names one, so that's left out.
    const taken = () => JSON.parse(JSON.stringify(f.calls.splice(0))).filter(([name]) => name !== "pane.focus");
    const pick = (id, address) => { tabs.forEach(c => { c.active = c.id === id; }); list.forEach(a => { a.focused = a.address === address; }); f.shown.agent = address ?? null; };
    const shown = () => find(view.render(cx), "tab-strip").items.map(n => walk(n).map(x => x.key).find(k => /^tab-/.test(k ?? ""))?.slice(4) ?? "|");
    const inbox = (on) => { f.slots["sidebar-lists"] = { id: "sidebar-lists", active: on ? "inbox" : "lists" }; };
    const works = () => walk(find(view.render(cx), "tab-strip")).some(n => n.source === "mods/t3-tabs/icons/circle-dashed.svg");
    const bang = () => strings(find(view.render(cx), "tab-strip")).includes("!");

    pick("mine", "A"); inbox(false);
    assert.deepEqual(shown(), ["prog", "other", "mine", "kid", "rev"], "Lists keeps every tab in its order");
    assert.ok(works() && bang(), "and every mark");
    inbox(true);
    assert.deepEqual(shown(), ["kid", "|", "prog", "rev"], "the agent in view is the breadcrumb's; its sub-agent's tab, a rule, then tabs with no agent; no other agent");
    // What shows: a name's measure is clipped to nothing.
    const shownText = (n) => typeof n === "string" ? [n] : n && typeof n === "object" && !String(n.key).startsWith("text-measure-") ? n.items.flatMap(shownText) : [];
    assert.deepEqual(shownText(find(view.render(cx), "crumb")).filter(s => s !== "/"), ["P", "project 0", "mine"], "the breadcrumb: the space, then the agent in view");
    assert.ok(!works() && !bang(), "no marks: that's the sidebar's");
    f.slots.sidebar.hidden = true;
    assert.deepEqual(shown(), ["kid", "|", "prog", "rev"], "the same with the sidebar hidden");
    assert.ok(!works() && !bang(), "no marks there either");
    assert.equal(find(view.render(cx), "sidebar-toggle").items.length, 1, "nor on its toggle");
    delete f.slots.sidebar.hidden;

    // Only tabs with no agent drag, and among themselves.
    const press = (id) => fire(find(view.render(cx), `tab-${id}`), "on_mouse_down:left", { position: { x: 0, y: 0 }, click_count: 1 }, cx);
    const over = (id) => fire(find(view.render(cx), `tab-${id}`), "on_mouse_move", { position: { x: 50, y: 0 } }, cx);
    const release = (id) => fire(find(view.render(cx), `tab-${id}`), "on_mouse_up:left", {}, cx);
    view.render(cx); taken();
    press("kid"); over("prog"); release("prog");
    assert.deepEqual(taken(), [["tab.select", { id: "kid" }]], "an agent's tab doesn't drag");
    press("rev"); over("prog"); release("prog");
    assert.deepEqual(taken(), [["tab.move", { id: "rev", index: 1 }]], "to its place in the space's real order");
    press("rev"); over("prog"); over("kid"); release("kid");
    assert.deepEqual(taken(), [["tab.move", { id: "rev", index: 1 }]], "an agent's tab takes no drop: it lands at the line it showed");
    // The bar's list can change under a press: an agent starting takes its tab out of the bar.
    const starts = agent("X", "prog", "working");
    press("rev"); f.agents().push(starts); view.render(cx); release("rev");
    assert.deepEqual(taken(), [["tab.select", { id: "rev" }]], "the tab pressed, whatever moved");
    f.agents().pop(); press("prog"); f.agents().push(starts); over("rev"); release("rev");
    assert.deepEqual(taken(), [], "the pressed tab gone from the bar, its click and drag go with it");
    f.agents().pop(); press("rev"); over("prog"); f.agents().push(starts); release("rev");
    assert.deepEqual(taken(), [["tab.select", { id: "rev" }]], "the tab dragged over gone: no drop on it");
    f.agents().pop();

    // With the Inbox, closing the agent in view lands on Home, however it went; nothing else does.
    const close = (id) => { const i = tabs.findIndex(c => c.id === id); tabs.splice(i, 1); const a = list.findIndex(x => x.tab === id); if (a >= 0) { f.agents().splice(f.agents().findIndex(x => x.tab === id), 1); f.terminals().splice(f.terminals().findIndex(x => x.tab === id), 1); list.splice(a, 1); } };
    pick("mine", "A"); view.render(cx); taken();
    close("other"); view.render(cx);
    assert.deepEqual(taken(), [], "another tab closing stays put");
    pick("prog"); view.render(cx); close("rev"); view.render(cx);
    assert.deepEqual(taken(), [], "so does a tab with no agent that isn't in view");
    pick("mine", "A"); view.render(cx);
    close("mine"); pick("prog"); view.render(cx);
    // Husain's: back to the tab last shown in its space, as Lists does, past Herdr's neighbour; not Home.
    assert.deepEqual(taken(), [["tab.select", { id: "prog" }]], "the agent in view closing goes back to the tab before, past Herdr's neighbour");
    view.render(cx);
    assert.deepEqual(taken(), [], "once");
    // Observe the Home landing, then return to the program tab in Lists before testing a later, independent close.
    const home = { id: "h", machine: null, named: true, name: "Home\u200b", active: true, tabs: [{ id: "page", active: true }] };
    f.spaces()[0].active = false; f.spaces().push(home); view.render(cx); taken();
    home.active = false; f.spaces()[0].active = true;
    pick("prog"); view.render(cx);
    inbox(false); pick("kid", "K"); view.render(cx); close("kid"); pick("prog"); view.render(cx);
    assert.deepEqual(taken(), [["tab.select", { id: "prog" }]], "in Lists, back to the tab last shown: Home is the Inbox's");
  }
  // With the Inbox, a tab's agents side by side in the breadcrumb, the one in view lit as its card is; a zoomed tab's other panes
  // a segment each beside them; in Lists a zoomed tab shows its panes so. An agent's pane shown alone leaves its name to the bar.
  {
    const f = fixture(256);
    const program = { key: "pi", name: "Pi", agent: true, tint: true, icon: "icons/pi.svg" };
    const tabs = f.spaces()[0].tabs;
    tabs.splice(0, tabs.length, ...["mine", "prog"].map(id => ({ id, name: id, named: false, active: false })));
    const agent = (address, title) => ({ address, pane: `p-${address}`, tab: "mine", space: "s0", space_name: "project 0", title, status: "idle", program, state: "live", focused: false });
    const list = [agent("A", "layout"), agent("C", "review")];
    f.agents().splice(0, Infinity, ...list);
    f.terminals().splice(0, Infinity, ...list.map(a => ({ ...a })));
    f.panes().splice(0, Infinity, ...list.map(a => ({ ...a, terminal: a.address, zoomed: false })),
      { pane: "p-git", terminal: "git", tab: "mine", title: "lazygit", zoomed: false }, { pane: "p-prog", terminal: "sh", tab: "prog", title: "vite", zoomed: false });
    f.slots["sidebar-lists"] = { id: "sidebar-lists", active: "inbox" };
    const view = f.load("t3-tabs"), taken = () => JSON.parse(JSON.stringify(f.calls.splice(0)));
    const at = (tab, pane) => {
      tabs.forEach(c => { c.active = c.id === tab; });
      f.agents().forEach(a => { a.focused = a.pane === pane; });
      Object.assign(f.shown, { tab, pane, terminal: f.panes().find(p => p.pane === pane).terminal, agent: null });
      return view.render(cx);
    };
    let root = at("mine", "p-A");
    // Only the agent in view, the card the Inbox lights: another agent in the tab is reached by its own card, or its pane.
    assert.equal(find(root, "peer-C"), null, "only the one in view");
    assert.equal(find(root, "peer-A").style.text_color, f.theme().foreground, "a plain title, as T3's");
    assert.ok(find(find(root, "peer-A"), "crumb-menu"), "the one in view has its tab's menu, its ⌄ part of the title, as T3's");
    assert.equal(find(root, "crumb-menu").style.opacity, 0, "shown only hovered or with the keyboard on it, as T3's");
    assert.equal(find(root, "crumb").style.gap, 12, "T3's breadcrumb gap (sm:gap-3)");
    // Where you are shows whole first: the crumb takes its own width, the strip beside it gives way and scrolls, down to a tab's
    // width, and only then do its names shorten. No cap on the space's or the parent's name.
    assert.deepEqual([find(root, "crumb").style.flex_shrink, find(root, "tab-scroll").style.min_w], [0, 0], "the strip gives way, the crumb doesn't");
    assert.equal(find(root, "crumb-space").style.max_w, undefined, "the space's name has no cap");
    fire(find(root, "tab-scroll"), "on_size_change", { width: 300 }, cx);
    view.render(cx);
    assert.equal(view.room, 300, "its tabs share the width it got");
    // Anchored at the right, beside Actions with 8 between: short of room the strip shows its end and is cut at the start, which
    // fades out, as T3's scrollFade; scrolled back to its start, the end fades instead.
    fire(find(view.render(cx), "tab-scroll"), "on_size_change", { width: 100 }, cx);
    let bar = view.render(cx);
    assert.deepEqual([find(bar, "tab-strip").style.ml < 0, Boolean(find(bar, "strip-fade-start")), find(bar, "strip-fade-end"), find(bar, "tab-scroll").style.mr], [true, true, null, 4], "its end shows, its start fades");
    fire(bar, "on_scroll_wheel", { delta: { x: 1000, y: 0 } }, cx);
    bar = view.render(cx);
    assert.deepEqual([find(bar, "tab-strip").style.ml, find(bar, "strip-fade-start"), Boolean(find(bar, "strip-fade-end"))], [-0, null, true], "scrolled to its start, the end fades");
    fire(bar, "on_scroll_wheel", { delta: { x: -1000, y: 0 } }, cx);
    fire(find(view.render(cx), "tab-scroll"), "on_size_change", { width: 300 }, cx);
    // Its tabs hug their icon and name, as T3's panel tabs: no 96px floor, no slot kept for the ×, so the group sits flush
    // against Actions and the gaps between them are even. Hovered, the icon turns to the ×, as T3's does.
    fire(find(view.render(cx), "text-measure-tab-prog"), "on_size_change", { width: 30 }, cx);
    const progTab = () => find(view.render(cx), "tab-prog");
    assert.equal(progTab().style.w, 30 + 32, "6 in, the 16px icon, 2, the name, 8");
    assert.equal(progTab().items.length, 2, "the icon's slot and the name: no end slot kept");
    fire(progTab(), "on_hover", true, cx);
    assert.ok(walk(find(progTab(), "tab-prog-close")).some(n => n.source === "mods/t3-tabs/icons/x.svg"), "hovered, the icon's slot is the ×");
    fire(progTab(), "on_hover", false, cx);
    fire(find(root, "peer-A"), "on_hover", true, cx);
    assert.equal(find(view.render(cx), "crumb-menu").style.opacity, 1, "hovering the title shows it");
    fire(find(view.render(cx), "peer-A"), "on_hover", false, cx);
    // Its menu hangs 4 under the title, left edges together, as T3's title menu and the layout's other menus; not on the pointer.
    const title = () => find(view.render(cx), "peer-A"), z = f.settings().zoom || 1;
    f.overlays.length = 0;
    fire(title(), "on_mouse_down:left", { bounds: { x: 300, y: 8, width: 120, height: 24 }, position: { x: 350, y: 20 } }, cx);
    fire(title(), "on_click", {}, cx);
    const opened = f.overlays.pop();
    assert.deepEqual([opened.mod, opened.props.tab, plain(opened.at)], ["t3-menu", "agent", { x: 300, y: 32 + 4 * z }], "under the title, from its left edge");
    assert.deepEqual(plain(opened.props.target), { address: "A" }, "the agent's own menu: which agent; t3-menu reads what it offers, as from its card");
    // Pressed again while it's open: the press closed it (its close() stamps t3-menu.closed), so the click doesn't reopen it.
    fire(title(), "on_mouse_down:left", { bounds: { x: 300, y: 8, width: 120, height: 24 }, position: { x: 350, y: 20 } }, cx);
    f.state["t3-menu.closed"] = Date.now();
    fire(title(), "on_click", {}, cx);
    assert.equal(f.overlays.length, 0, "a second click closes it, as every popup's button");
    // A right-click is the menu of what's under it, on the pointer: the space's, as in Spaces; an agent's pane's, as its header's.
    fire(find(view.render(cx), "crumb-space"), "on_mouse_down:right", {}, cx);
    fire(find(view.render(cx), "peer-A"), "on_mouse_down:right", {}, cx);
    // The title's right-click is its click's menu, on the pointer, as T3's header.
    assert.deepEqual(f.overlays.splice(0).map(o => [o.props.tab, o.props.target.id ?? o.props.target.address, o.at]), [["space", "s0", undefined], ["agent", "A", undefined]]);
    // A name shown whole has no label, as a tab's (T3's title only repeats it); cut short, the tab's hover label holds it whole.
    assert.equal(find(view.render(cx), "tip-over-peer-A"), null, "no tooltip repeating a name");
    const crumbCard = (id) => find(view.render(cx), `details-${id}`)?.style.content;
    const wait = () => [150, 34].forEach(ms => cx.timers.filter(t => t.ms === ms && !t.gone).forEach(t => { t.gone = true; t.fn(cx); }));
    const hoverTitle = (on) => { fire(find(view.render(cx), "peer-A"), "on_hover", on, cx); wait(); };
    fire(find(view.render(cx), "tab-area"), "on_size_change", { width: 1200 }, cx);
    fire(find(view.render(cx), "text-measure-peer-A"), "on_size_change", { width: 80 }, cx);
    fire(find(view.render(cx), "text-name-peer-A"), "on_size_change", { width: 80 }, cx);
    hoverTitle(true);
    assert.equal(crumbCard("peer-A"), undefined, "shown whole: no label");
    hoverTitle(false);
    fire(find(view.render(cx), "text-name-peer-A"), "on_size_change", { width: 40 }, cx);
    hoverTitle(true);
    assert.deepEqual([strings(crumbCard("peer-A")), crumbCard("peer-A").style.opacity], [["layout"], 1], "cut short: its whole name");
    assert.deepEqual([find(view.render(cx), "details-peer-A").style.bottom, find(view.render(cx), "details-peer-A").style.left], [0, -9], "under it, its words where the name starts");
    hoverTitle(false);
    // Clicking the breadcrumb's space opens its menu below it with no ⌄ (brightening on hover/open without shifting `/`).
    assert.equal(find(root, "crumb-space").style.accessibility_label, "project 0", "the space's label is its name");
    assert.equal(find(find(root, "crumb-space"), "crumb-space-menu"), null, "the space crumb has no ⌄");
    assert.equal(find(root, "crumb-space").style.text_color, f.theme().muted, "the space crumb rests muted");
    fire(find(view.render(cx), "crumb-space"), "on_hover", true, cx);
    assert.deepEqual([find(view.render(cx), "crumb-space").style.text_color, find(view.render(cx), "crumb-space").style.bg], [f.theme().foreground, undefined], "hovering the space brightens its text without a pill or moving /");
    fire(find(view.render(cx), "crumb-space"), "on_hover", false, cx);
    const spaceCrumb = () => find(view.render(cx), "crumb-space");
    f.overlays.length = 0;
    fire(spaceCrumb(), "on_mouse_down:left", { bounds: { x: 260, y: 8, width: 90, height: 24 }, position: { x: 290, y: 20 } }, cx);
    fire(spaceCrumb(), "on_click", {}, cx);
    const spaceOpened = f.overlays.pop();
    assert.deepEqual([spaceOpened.mod, spaceOpened.props.tab, spaceOpened.width, plain(spaceOpened.at)], ["t3-menu", "space-switch", 280, { x: 260, y: 32 + 4 * z }], "space menu hangs under the space from its left edge");
    assert.deepEqual(plain(spaceOpened.props.target), { id: "s0" });
    assert.equal(find(view.render(cx), "crumb-space").style.text_color, f.theme().foreground, "the space stays bright while its menu is open");
    // Pressed again while open: its close() stamps t3-menu.spaceClosed, so the click doesn't reopen it, while opening the title's menu still works.
    fire(spaceCrumb(), "on_mouse_down:left", { bounds: { x: 260, y: 8, width: 90, height: 24 }, position: { x: 290, y: 20 } }, cx);
    f.state["t3-menu.spaceClosed"] = Date.now();
    fire(spaceCrumb(), "on_click", {}, cx);
    assert.equal(f.overlays.length, 0, "a second click closes the space menu");
    // Opening the title's menu right after the space menu closed isn't blocked by the space menu's close stamp.
    delete f.state["t3-menu.closed"];
    fire(title(), "on_mouse_down:left", { bounds: { x: 300, y: 8, width: 120, height: 24 }, position: { x: 350, y: 20 } }, cx);
    fire(title(), "on_click", {}, cx);
    assert.equal(f.overlays.pop().props.tab, "agent", "the title menu still opens after closing the space menu");
    f.state["t3-menu.closed"] = Date.now();
    // Keyboard click on the space crumb opens its menu with the first row lit.
    fire(spaceCrumb(), "on_click", {}, cx);
    assert.equal(f.overlays.pop().props.lit, 0, "keyboard open lights the first row");
    f.state["t3-menu.spaceClosed"] = Date.now();
    // Truncated space crumb shows its full name on hover at x=20 (past icon + gap) and hides while its menu is open.
    fire(find(view.render(cx), "text-measure-crumb-space"), "on_size_change", { width: 80 }, cx);
    fire(find(view.render(cx), "text-name-crumb-space"), "on_size_change", { width: 40 }, cx);
    fire(spaceCrumb(), "on_hover", true, cx); wait();
    assert.deepEqual([strings(crumbCard("crumb-space")), find(view.render(cx), "details-crumb-space").style.left], [["project 0"], 11], "cut space name shows full label past its icon");
    fire(spaceCrumb(), "on_hover", false, cx); wait();
    assert.equal(find(f.load("t3-tabs", { part: "end" }).render(cx), "tab-new"), null, "Inbox still has no + beside it");
    root = at("mine", "p-C");
    assert.deepEqual([Boolean(find(root, "peer-C")), find(root, "peer-A")], [true, null], "the other one focused: the title is it");
    root = at("mine", "p-git");
    assert.deepEqual([find(root, "peer-C").style.text_color, find(root, "peer-A")], [f.theme().muted, null], "a program beside them: the one last looked at stays, dim");
    assert.equal(find(root, "crumb-menu"), null);
    fire(find(root, "peer-C"), "on_click", {}, cx);
    assert.deepEqual(taken().at(-1), ["agent.focus", { terminal: "C" }], "and leads back");
    at("mine", "p-A");

    // Zoomed: the panes that aren't the agents' are segments beside them; showing them all again is the pane header's zoom.
    f.panes().find(p => p.pane === "p-A").zoomed = true;
    root = at("mine", "p-A");
    assert.ok(find(root, "group-tools-mine"), "the tab's other panes");
    assert.equal(find(root, "seg-p-C"), null, "not its agents: each has its card");
    fire(find(root, "seg-p-git"), "on_click", {}, cx);
    assert.deepEqual(taken(), [["pane.zoom", { pane: "p-git" }], ["pane.focus", { pane: "p-git" }]], "a segment moves the zoom there");
    assert.equal(find(root, "restore-p-A"), null, "no unzoom button in the bar");
    // Shown alone, an agent's pane header leaves its name to the breadcrumb; in Lists it keeps it.
    const header = () => strings(f.load("t3-pane", { pane: "p-A" }).render(cx));
    assert.ok(!header().includes("layout"));
    f.slots["sidebar-lists"].active = "lists";
    assert.ok(header().includes("layout"));
    assert.ok(find(f.load("t3-tabs").render(cx), "tab-new"), "Lists keeps its +, after the tabs (Husain's)");
    root = at("mine", "p-A");
    assert.ok(find(root, "group-mine") && find(root, "seg-p-C"), "in Lists the zoomed tab shows all its panes");
    assert.equal(find(root, "restore-p-A"), null, "and no unzoom button there either");
    assert.ok(!strings(root).some(s => / Z$/.test(s)), "no Z after its name");
    f.agents()[0].status = "blocked";
    assert.ok(strings(find(at("mine", "p-A"), "group-mine")).includes("!"), "and the tab's status mark stays with it");
    f.panes().find(p => p.pane === "p-A").zoomed = false;
    root = at("mine", "p-A");
    assert.equal(find(root, "group-mine"), null, "split, it's a tab again");
  }

  // Both sidebar modes restore the last shown tab and repay an unread neighbour after an external tab close.
  for (const mode of ["lists", "inbox"]) {
    const f = fixture(256), tabs = f.spaces()[0].tabs, a = f.agents()[0];
    f.slots.lists = { id: "sidebar-lists", active: mode }; tabs[0].active = true;
    tabs.push({ id: "prog" }, { id: "next" });
    const n = { ...a, address: "N", tab: "next", pane: "pn", focused: false, status: "done", turn: 1, labels: { "herdr.seen": "0" } };
    f.agents().push(n); f.terminals().push(n); f.panes().push({ ...n, terminal: "N" });
    const view = f.load("t3-tabs"); view.render(cx); f.calls.length = 0;
    f.spaces()[0].active = false; f.spaces()[1].active = true; view.render(cx);
    tabs.forEach(c => { c.active = c.id === "next"; });
    await view.navigation.handle("space:1", cx);
    assert.deepEqual(plain(f.calls.splice(0)), [["tab.select", { id: "b0" }]], mode + ": the last shown tab, without showing the neighbour first");
    f.spaces()[0].active = true; f.spaces()[1].active = false;
    tabs.forEach(c => { c.active = c.id === "b0"; }); view.render(cx); f.calls.length = 0;
    tabs.shift(); f.agents().splice(f.agents().indexOf(a), 1);
    n.status = "idle"; n.labels["herdr.seen"] = "1";
    tabs.forEach(c => { c.active = c.id === "next"; }); view.render(cx);
    // Husain's: either mode goes back as any tab does, and with nowhere else shown in this space, Herdr's pick stands.
    assert.deepEqual(plain(f.calls.splice(0)), []);
    assert.deepEqual(f.labelled, [], "nothing while the neighbour is on screen");
    tabs.forEach(c => { c.active = c.id === "prog"; }); view.render(cx);
    assert.deepEqual(f.labelled.map(a => a.join(" ")), ["label N herdr.seen=0"], mode + ": the unread turn comes back");
  }

  // Lists publish the full group order, even hidden; the inactive copy cannot reset the order.
  {
    const f = fixture(256), firstWatch = cx.watches.length;
    f.slots.lists = { id: "sidebar-lists", active: "lists" }; f.slots.sidebar.hidden = true;
    const ag = f.load("t3-agents");
    ag.folded["sp-s2"] = true; ag.folded.t0 = false;
    const tick = () => cx.watches.slice(firstWatch).find(t => t.ms === 1000).fn(cx);
    ag.render(cx);
    assert.deepEqual(plain(f.state["t3-agents.rows"]), { order: ["t0", "vps/t2"], view: "t0" }, "a sub-agent, expanded and in view, isn't walked: its parent stands for it; a folded group's agents are");
    ag.render = () => { throw new Error("hidden Lists must compute without drawing"); };
    ag.folded.t0 = true; tick();
    assert.deepEqual(plain(f.state["t3-agents.rows"].order), ["t0", "vps/t2"], "nor a stuck child under a folded parent");
    f.terminals().find(k => k.address === "child").status = "idle"; tick();
    assert.deepEqual(plain(f.state["t3-agents.rows"]), { order: ["t0", "vps/t2"], view: "t0" }, "folded-away focus lights its ancestor");
    const before = [f.orderWrites.length, f.sharedWrites.length]; tick(); tick();
    assert.deepEqual([f.orderWrites.length, f.sharedWrites.length], before, "unchanged hidden data causes no writes");
    f.slots.lists.active = "inbox"; ag.folded["sp-s2"] = false; tick();
    assert.deepEqual([f.orderWrites.length, f.sharedWrites.length], before, "inactive Lists own neither navigation nor rows");
    {
      // Behind the Inbox a tick sorts and groups nothing; what outlives it is still kept: each agent's history, and an ended agent's pin and fold go.
      const scope = f.scopes.get("t3-agents"), real = { subAgents: scope.subAgents, panes: scope.panes, focused: scope.focused }, work = [];
      for (const name of Object.keys(real)) scope[name] = (...a) => { work.push(name); return real[name](...a); };
      f.agents()[1].status = "working"; f.state["t3.pins"] = ["t0", "ended"]; ag.folded.ended = false;
      tick();
      Object.assign(scope, real);
      assert.deepEqual(work, [], "no rows to draw or publish: nothing is grouped, no pane or focus read");
      assert.equal(JSON.parse(f.stores.get("t3-agents").get("changes"))["vps/t2"].s, "working", "its history still follows each agent");
      assert.deepEqual([plain(f.state["t3.pins"]), "ended" in ag.folded, f.stores.get("t3-agents").get("folded").includes("ended")], [["t0"], false, false], "an ended agent's pin and fold still go");
    }
    f.slots.lists.active = "lists"; tick();
    assert.deepEqual(plain(f.state["t3-agents.rows"].order), ["t0", "vps/t2"]);
  }

  {
    const f = fixture(256), firstWatch = cx.watches.length, [parent, remote] = f.agents();
    f.slots.lists = { id: "sidebar-lists", active: "lists" };
    const ag = f.load("t3-agents");
    ag.folded["sp-s2"] = true;
    ag.render(cx);
    f.slots.sidebar.hidden = true;
    const tick = () => cx.watches.slice(firstWatch).find(t => t.ms === 1000).fn(cx);
    const jobs = [], spawn = cx.spawn;
    cx.spawn = job => jobs.push(job);
    try { f.load("t3-tabs", { part: "keys" }); } finally { cx.spawn = spawn; }
    const press = async (command) => {
      f.calls.length = 0; f.commands.push(command);
      jobs[0](cx); await new Promise(setImmediate);
      return plain(f.calls);
    };
    parent.focused = false;
    Object.assign(f.shown, { space: "s0", tab: "b0", pane: null, terminal: "child", agent: null });
    tick(); // No Lists redraw: the terminal now in view is a child without a pane.
    assert.deepEqual(await press("next"), [["agent.focus", { terminal: "vps/t2" }]], "next starts at the child's ancestor and walks into the folded space");
    remote.focused = true;
    Object.assign(f.shown, { space: "s2", tab: "b2", pane: "p2", terminal: "vps/t2", agent: "vps/t2" });
    tick();
    assert.deepEqual(await press("prev"), [["agent.focus", { terminal: "t0" }]], "previous returns from that group");

    f.slots.lists.active = "inbox";
    f.state["t3-inbox.rows"] = { order: ["vps/t2", "t0"], view: "vps/t2" };
    f.state["t3.agentOrder"] = "inbox";
    const writes = f.orderWrites.length;
    tick();
    assert.equal(f.orderWrites.length, writes, "a hidden Lists tick can't take Inbox's order");
    assert.deepEqual(await press("next"), [["agent.focus", { terminal: "t0" }]]);
  }

  // Settle needs no Inbox copy: the key works with the Inbox shown or hidden, with the same Undo. In Lists it does nothing.
  for (const mode of ["lists", "inbox"]) for (const hidden of [false, true]) {
    const f = fixture(256), a = f.agents()[0], k = f.terminals()[0];
    f.slots.lists = { id: "sidebar-lists", active: mode }; f.slots.sidebar.hidden = hidden;
    f.terminals().splice(2); a.status = k.status = "done"; k.turn = 2;
    const until = String(Date.now() + 60000); k.labels = { snoozed: until };
    f.state["t3.pins"] = ["head", "t0", "tail"];
    Object.assign(f.shown, { space: "s0", tab: "b0", pane: "p0", terminal: "t0", agent: "t0" });
    f.spaces()[0].tabs[0].active = true;
    f.answerHc(args => { if (args[0] === "label") { const i = args[2].indexOf("="); k.labels[args[2].slice(0, i)] = args[2].slice(i + 1); } return { code: 0 }; });
    const tabs = f.load("t3-tabs"), firstTimer = cx.timers.length;
    await tabs.settle(cx);
    if (mode === "lists") {
      assert.deepEqual([f.labelled, f.calls, k.labels.settled], [[], [], undefined], `hidden=${hidden}: Lists has no Settle`);
      continue;
    }
    assert.match(k.labels.settled, /^\d+:2$/);
    assert.deepEqual([k.labels.snoozed, f.state["t3.pins"]], ["", ["head", "tail"]]);
    assert.deepEqual(plain(f.calls.splice(0)), [["t3-tabs.home", {}]], `${mode}, hidden=${hidden}: Settle goes Home`);
    assert.equal(f.scopes.has("t3-inbox"), false, "the Inbox has never started");
    assert.equal(f.state["t3.notice"].count, 1);
    for (const timer of cx.timers.slice(firstTimer).filter(t => t.ms === 16)) timer.fn(cx);
    const tree = hidden ? tabs.render(cx) : f.load("t3-chrome", { footer: true }).render(cx);
    const undo = find(tree, "undo-notice-undo");
    assert.ok(undo, "Undo is in the visible bar");
    assert.deepEqual(strings(undo), ["⇧⌘Z to undo"], `hidden=${hidden}: the key in the button`);
    fire(undo, "on_click", {}, cx);
    assert.deepEqual(f.calls.pop(), ["t3-tabs.undo", {}]);
    f.spaces()[0].active = false;
    f.spaces().push({ id: "h", name: "Home\u200b", named: true, active: true, machine: null, tabs: [{ id: "home" }] });
    f.state["t3-tabs.home"] = "h"; f.state["t3.pins"] = ["new", "head", "tail"];
    await tabs.settle(cx);
    assert.deepEqual([f.state["t3.notice"]?.live, f.calls.length], [true, 0], `${mode}, hidden=${hidden}: at Home the Settle key leaves Undo to its own key, as T3's`);
    await tabs.undo();
    assert.deepEqual(plain([k.labels.settled, k.labels.snoozed, f.state["t3.pins"]]), ["", until, ["new", "head", "t0", "tail"]]);
    assert.deepEqual(plain(f.calls.splice(0)), [["agent.focus", { terminal: "t0" }]], "Undo returns from Home");
    assert.equal(f.state["t3.notice"], null);
    f.spaces().pop(); f.spaces()[0].active = true;
    await tabs.settle(cx);
    const end = cx.timers.filter(t => t.ms === 5000).at(-1); end.fn(cx);
    const gone = hidden ? tabs.render(cx) : f.load("t3-chrome", { footer: true }).render(cx);
    assert.equal(find(gone, "undo-notice-undo").handlers.on_click, undefined, "Undo stops at five seconds");
    const labels = f.labelled.length; await tabs.undo(); assert.equal(f.labelled.length, labels, "expired Undo writes nothing");
    cx.timers.filter(t => t.ms === 250 && !t.gone).at(-1).fn(cx);
    assert.equal(f.state["t3.notice"], null);
  }

  // The breadcrumb title's menu, for the agent in view: Pin as the agents list's, Snooze as its card's, putting it away as Settle does.
  {
    const f = fixture(256), k = f.terminals()[0];
    f.slots.lists = { id: "sidebar-lists", active: "inbox" };
    f.terminals().splice(2); k.labels = {}; f.state["t3.pins"] = ["head"];
    Object.assign(f.shown, { space: "s0", tab: "b0", pane: "p0", terminal: "t0", agent: "t0" });
    f.spaces()[0].tabs[0].active = true;
    f.answerHc(args => { if (args[0] === "label") { const i = args[2].indexOf("="); k.labels[args[2].slice(0, i)] = args[2].slice(i + 1); } return { code: 0 }; });
    const tabs = f.load("t3-tabs");
    // Pinned from the tab bar's menu as from the agents list (pins.js): first, and it ends a snooze.
    k.labels.snoozed = String(Date.now() + 60000);
    f.scopes.get("t3-tabs").pin("t0");
    await new Promise(setImmediate);
    assert.deepEqual([plain(f.state["t3.pins"]), k.labels.snoozed], [["t0", "head"], ""], "Pin goes first, as T3's, and ends the snooze");
    f.state["t3.pins"] = ["head"];
    f.scopes.get("t3-tabs").pin("t0");
    const at = Date.now() + 3600000;
    await tabs.snooze(`t0:${at}`, cx);
    assert.equal(k.labels.snoozed, String(at));
    assert.deepEqual(plain(f.calls.splice(0)), [["t3-tabs.home", {}]], "the agent in view snoozed: Home, as Settle");
    assert.equal(f.state["t3.notice"].action, "Snoozed");
    f.spaces()[0].active = false; f.spaces().push({ id: "h", name: "Home\u200b", named: true, active: true, machine: null, tabs: [{ id: "home" }] }); f.state["t3-tabs.home"] = "h";
    await tabs.undo();
    assert.equal(k.labels.snoozed, "", "Undo wakes it");
    assert.deepEqual(plain(f.calls.splice(0)), [["agent.focus", { terminal: "t0" }]], "and brings it back from Home");
    f.spaces().pop(); f.spaces()[0].active = true;
    await tabs.snooze(`t0:${Date.now() - 1}`, cx);
    assert.equal(f.notifications.pop().title, "Couldn't snooze the agent", "a time gone by is refused, as the card's");
  }

  // An agent's menu (t3-menu) settles the agent it was opened on: one in the background stays where the person is; the one in
  // view goes Home, as the key. Wake ends its snooze.
  {
    const f = fixture(256), [k0, k2] = f.terminals();
    f.slots.lists = { id: "sidebar-lists", active: "inbox" };
    f.terminals().splice(2);
    for (const [a, k] of [[f.agents()[0], k0], [f.agents()[1], k2]]) { a.status = k.status = "done"; k.turn = 1; k.labels = {}; }
    Object.assign(f.shown, { space: "s0", tab: "b0", pane: "p0", terminal: "t0", agent: "t0" });
    f.spaces()[0].tabs[0].active = true;
    f.answerHc(args => { if (args[0] === "label") { const k = f.terminals().find(t => t.address === args[1]), i = args[2].indexOf("="); k.labels[args[2].slice(0, i)] = args[2].slice(i + 1); } return { code: 0 }; });
    const tabs = f.load("t3-tabs");
    await tabs.settle(cx, "vps/t2");
    assert.deepEqual([k2.labels.settled?.endsWith(":1"), k0.labels.settled, plain(f.calls.splice(0))], [true, undefined, []], "the background one, and nowhere to go");
    await tabs.settle(cx, "t0");
    assert.deepEqual([k0.labels.settled?.endsWith(":1"), plain(f.calls.splice(0))], [true, [["t3-tabs.home", {}]]], "the one in view goes Home");
    await tabs.settle(cx, "vps/t2");
    assert.equal(k2.labels.settled, "", "again: Un-settle");
  }

  // Lists unpin shares the notice, restores only its pin in place, and leaves agent labels and focus alone.
  {
    const f = fixture(256), tabs = f.load("t3-tabs"), k = f.terminals()[0];
    k.labels = { settled: "100:1", snoozed: "200" };
    f.state["t3.pins"] = ["head", "t0", "tail"];
    const timers = cx.timers.length;
    tabs.unpin("t0", cx);
    assert.deepEqual(plain(f.state["t3.pins"]), ["head", "tail"]);
    assert.deepEqual(plain([f.state["t3.notice"].action, f.state["t3.notice"].count]), ["Unpinned", 1]);
    for (const timer of cx.timers.slice(timers).filter(t => t.ms === 16)) timer.fn(cx);
    assert.ok(strings(f.load("t3-chrome", { footer: true }).render(cx)).includes("Unpinned,"));
    f.state["t3.pins"] = ["new", "head", "tail"];
    f.state["t3-tabs.home"] = "h"; f.spaces()[0].active = false; f.spaces().push({ id: "h", name: "Home\u200b", named: true, active: true, machine: null, tabs: [] });
    await tabs.undo();
    assert.deepEqual(plain(f.state["t3.pins"]), ["new", "head", "t0", "tail"]);
    assert.deepEqual([f.labelled, f.calls], [[], []], "unpin Undo changes neither labels nor the place being viewed");
    assert.deepEqual(k.labels, { settled: "100:1", snoozed: "200" });
    tabs.unpin("t0", cx);
    tabs.unpin("tail", cx);
    assert.equal(f.state["t3.notice"].count, 2, "successive unpins share one Undo notice");
    await tabs.undo();
    assert.deepEqual(plain(f.state["t3.pins"]), ["new", "head", "t0", "tail"]);
    f.agents()[0].status = "idle"; k.labels = {};
    await tabs.settle(cx, "t0");
    tabs.unpin("tail", cx);
    assert.equal(f.state["t3.notice"].count, 1, "unpin does not merge a Settle undo into a pin-only action");
  }

  // A failed Settle cannot move the person or remove a pin.
  {
    const f = fixture(256); f.terminals().splice(2); f.agents()[0].status = "idle";
    f.state["t3.pins"] = ["t0"];
    Object.assign(f.shown, { space: "s0", tab: "b0", pane: "p0", terminal: "t0", agent: "t0" });
    f.answerHc(() => ({ code: 1, stderr: "offline" }));
    await f.load("t3-tabs").settle(cx);
    assert.deepEqual([f.calls, f.state["t3.pins"], f.state["t3.notice"]], [[], ["t0"], undefined]);
    assert.equal(f.notifications.at(-1).body, "offline");
    f.spaces()[0].active = false; f.spaces().push({ id: "h", name: "Home\u200b", named: true, active: true, machine: null, tabs: [] }); f.state["t3-tabs.home"] = "h";
    const retry = f.load("t3-tabs");
    f.answerHc(() => ({ code: 0 }));
    await retry.settle(cx, "t0");
    f.calls.length = 0;
    f.answerHc(() => ({ code: 1, stderr: "offline" }));
    await retry.undo();
    assert.deepEqual(f.calls, [], "failed Undo does not jump to an agent it could not restore");
    assert.deepEqual([f.state["t3.notice"]?.live, f.state["t3.notice"]?.count], [true, 1], "and its notice stays, so Undo can be tried again");
  }

  {
    const f = fixture(256); f.terminals().splice(2); f.agents()[0].status = "idle";
    Object.assign(f.shown, { space: "s0", tab: "b0", pane: "p0", terminal: "t0", agent: "t0" });
    f.state["t3.pins"] = ["t0"];
    let finish;
    f.answerHc(() => new Promise(resolve => { finish = resolve; }));
    const settling = f.load("t3-tabs").settle(cx);
    f.state["t3.pins"] = ["new", "t0"];
    Object.assign(f.shown, { space: "s2", tab: "b2", pane: "p2", terminal: "vps/t2", agent: "vps/t2" });
    finish({ code: 0 }); await settling;
    assert.deepEqual(f.state["t3.pins"], ["new"], "a slow label write preserves pins added while it was pending");
    assert.deepEqual(f.calls, [], "finishing a slow Settle cannot pull someone away from where they've gone");
  }

  // Settled or snoozed, a Lists row only loses its done dot without moving; snoozed work still shows as working.
  {
    const f = fixture(256), a = f.agents()[0], k = f.terminals()[0]; f.terminals().splice(2);
    f.slots.lists = { id: "sidebar-lists", active: "lists" }; f.slots.sidebar.hidden = true;
    a.status = f.panes()[0].status = "done"; k.turn = 1; k.labels = {};
    f.state["agents.sort"] = "priority";
    const ag = f.load("t3-agents"), tabs = f.load("t3-tabs"); ag.folded["sec-3"] = false;
    ag.render(cx); const before = plain(f.state["t3-agents.rows"].order);
    k.labels.settled = "1:1";
    assert.equal(find(ag.render(cx), "status-t0").style.accessibility_label, "Idle");
    assert.deepEqual(plain(f.state["t3-agents.rows"].order), before, "settling doesn't move it to Idle's group");
    assert.equal(walk(find(tabs.render(cx), "tab-b0")).some(n => n.style.bg === f.theme().done), false);
    delete k.labels.settled; k.labels.snoozed = String(Date.now() + 60000); a.status = "working";
    assert.equal(find(ag.render(cx), "status-t0").style.accessibility_label, "Working", "hiding work is the Inbox's");
    a.status = "done";
    assert.equal(find(ag.render(cx), "status-t0").style.accessibility_label, "Idle", "a snoozed done loses its dot");
    a.status = "done"; k.status = "error"; k.labels = { settled: "1:1", snoozed: String(Date.now() + 60000) };
    assert.equal(find(ag.render(cx), "status-t0").style.accessibility_label, "Needs you");
  }

  {
    const f = fixture(256), [viewed, other] = f.agents();
    f.slots.lists = { id: "sidebar-lists", active: "lists" };
    f.terminals().splice(2);
    f.state["agents.sort"] = "priority";
    viewed.status = "done"; other.status = "working";
    const ag = f.load("t3-agents");
    Object.assign(f.shown, { pane: "p0", terminal: "t0", agent: "t0" });
    assert.equal(find(ag.render(cx), "status-t0").style.accessibility_label, "Done");
    viewed.status = "idle";
    const read = ag.render(cx);
    assert.equal(find(read, "status-t0").style.accessibility_label, "Idle");
    assert.ok(find(read, "sec-3"), "still in Done while viewed");
    assert.deepEqual(plain(f.state["t3-agents.rows"].order), ["t0", "vps/t2"]);
    viewed.focused = false; other.focused = true;
    Object.assign(f.shown, { pane: "p2", terminal: "vps/t2", agent: "vps/t2" });
    const left = ag.render(cx);
    assert.ok(find(left, "sec-1"), "moves to Idle only after leaving");
    assert.deepEqual(plain(f.state["t3-agents.rows"].order), ["vps/t2", "t0"]);
  }

  // Review is the sole Settle exception: its tab goes back, a split stays with its agent. × does the same in both modes.
  for (const mode of ["lists", "inbox"]) for (const split of [false, true]) {
    const f = fixture(256), tabs = f.spaces()[0].tabs, reviewTab = split ? "b0" : "review";
    f.slots.lists = { id: "sidebar-lists", active: mode };
    if (!split) tabs.push({ id: reviewTab, name: "Review", active: true });
    else tabs[0].active = true;
    f.panes().push({ pane: "pr", tab: reviewTab, mod: "review", title: "Review", terminal: null });
    f.state["review.program"] = { inbox: true }; f.state["review.status"] = { [reviewTab]: "done" };
    Object.assign(f.shown, { space: "s0", tab: reviewTab, pane: "pr", terminal: null, agent: "t0" });
    const view = f.load("t3-tabs");
    tabs.forEach(c => { c.active = c.id === "b0"; });
    Object.assign(f.shown, { tab: "b0", pane: "p0" }); view.render(cx);
    tabs.forEach(c => { c.active = c.id === reviewTab; });
    Object.assign(f.shown, { tab: reviewTab, pane: "pr" }); view.render(cx); f.calls.length = 0;
    const want = split ? [["agent.focus", { terminal: "t0" }], ["pane.close", { pane: "pr" }]] : [["tab.select", { id: "b0" }], ["pane.close", { pane: "pr" }]];
    await view.settle(cx); assert.deepEqual(plain(f.calls.splice(0)), mode === "lists" ? [] : want, "Settle is the Inbox's");
    assert.equal(f.labelled.length, 0); assert.equal(f.state["t3.notice"], undefined);
    await view.navigation.handle("close-pane-now:pr", cx); assert.deepEqual(plain(f.calls.splice(0)), want, "× returns the same way");
    f.state["review.status"][reviewTab] = "working";
    await view.settle(cx); assert.deepEqual(f.calls, [], "analysis in progress cannot be settled");
  }

  // Closing an agent split leaves the surviving pane in view, in either sidebar mode.
  for (const mode of ["lists", "inbox"]) {
    const f = fixture(256), tab = f.spaces()[0].tabs[0]; tab.active = true;
    f.slots.lists = { id: "sidebar-lists", active: mode };
    Object.assign(f.shown, { space: "s0", tab: "b0", pane: "p0", terminal: "t0", agent: "t0" });
    const neighbour = { ...f.agents()[0], address: "N", pane: "pn", focused: false, status: "done" };
    f.agents().push(neighbour); f.panes().push({ ...neighbour, terminal: "N" });
    const k = { ...neighbour, turn: 1, labels: { "herdr.seen": "0" } }; f.terminals().push(k);
    f.state["t3-tabs.home"] = "h"; f.spaces().push({ id: "h", name: "Home\u200b", named: true, active: false, machine: null, tabs: [] });
    const view = f.load("t3-tabs"); view.render(cx); f.calls.length = 0;
    await view.navigation.handle("close-pane-now:p0", cx);
    assert.deepEqual(plain(f.calls.splice(0)), [["pane.close", { pane: "p0" }]], "the surviving pane stays in view");
    f.panes().splice(f.panes().findIndex(p => p.pane === "p0"), 1); f.agents().splice(0, 1);
    neighbour.status = "idle"; k.labels["herdr.seen"] = "1";
    Object.assign(f.shown, { pane: "pn", terminal: "N", agent: "N" }); view.render(cx);
    assert.deepEqual(plain(f.calls.splice(0)), [], "a program ending also keeps the surviving pane in view");
    f.spaces()[0].active = false; f.spaces().at(-1).active = true; view.render(cx);
    assert.deepEqual(f.labelled, [], "the surviving pane was left in view, so its turn stays seen");
  }

  for (const mode of ["lists", "inbox"]) {
    const f = fixture(256); f.slots.lists = { id: "sidebar-lists", active: mode };
    f.spaces().splice(1); f.spaces()[0].tabs[0].active = true;
    const view = f.load("t3-tabs"); view.render(cx); f.calls.length = 0;
    f.spaces().splice(0); f.agents().splice(0); view.render(cx);
    assert.deepEqual(plain(f.calls), [["t3-tabs.home", {}]], "the last agent space closing still lands on Home");
  }

  {
    const f = fixture(256), ag = f.load("t3-agents"), scope = f.scopes.get("t3-agents");
    f.terminals()[0].parent = "grandchild";
    ag.folded.t0 = false;
    assert.equal(walk(ag.render(cx)).filter(n => n.key === "sub-t0").length, 0, "a cycle cannot render the parent again as its own descendant");
  }
  {
    const f = fixture(256), tabs = f.load("t3-tabs"), scope = f.scopes.get("t3-tabs");
    f.spaces()[0].tabs[0].named = false;
    f.spaces()[0].tabs.push({ id: "extra", named: false });
    f.panes().push({ pane: "px", tab: "extra", title: "Another terminal" });
    let names = 0;
    const name = scope.namer;
    scope.namer = () => { names++; return name(); };
    tabs.render(cx);
    assert.equal(names, 1, "a frame snapshots names once");
    f.slots.sidebar.hidden = true;
    tabs.render(cx);
    assert.equal(names, 2, "and so with the sidebar hidden");
  }
  {
    // A draw reads a host list once, however many rows ask about it: each read copies the whole list.
    const f = fixture(256), drawn = (name, lists) => {
      f.load(name);
      const scope = f.scopes.get(name), reads = {};
      for (const k of lists) { const read = scope[k]; scope[k] = () => { reads[k]++; return read(); }; }
      // A copy started after the counting: what its init hands on (ordering.js) is counted too.
      const view = f.also(name, {});
      for (const k of lists) reads[k] = 0;
      view.render(cx);
      return reads;
    };
    assert.deepEqual(drawn("t3-spaces", ["spaces", "panes"]), { spaces: 1, panes: 1 }, "Spaces, with a machine's heading and its +");
    assert.deepEqual(drawn("t3-agents", ["layout"]), { layout: 1 }, "Agents: where the sidebar is, for publishing and for the reveal");
  }

  // Settings' Sidebar section: what the sidebar shows, Inbox or Lists, as ⌘⇧L switches it. Read from the layout each time, not
  // kept in t3.settings, so the key, the palette and this row can't disagree.
  {
    const f = fixture(256), view = f.load("t3-chrome", { view: "settings" });
    f.slots["sidebar-lists"] = { id: "sidebar-lists", active: "inbox" };
    let root = view.render(cx);
    assert.ok(find(root, "st-s-home") && find(root, "st-s-sidebar"), "Home and Sidebar in the nav");
    assert.ok(find(root, "st-afterAway") && !find(root, "st-sidebarShows"), "Home's rows first");
    fire(find(root, "st-s-sidebar"), "on_click", {}, cx);
    root = view.render(cx);
    assert.ok(!find(root, "st-afterAway"), "a section at a time");
    assert.ok(strings(find(root, "st-sidebarShows")).includes("Inbox"), "the mode shown");
    fire(find(find(root, "st-sidebarShows-popup"), "st-sidebarShows"), "on_click", {}, cx);
    fire(find(find(view.render(cx), "st-sidebarShows-popup").style.content, "st-sidebarShows-lists"), "on_click", {}, cx);
    assert.deepEqual(f.calls.pop(), ["layout.select", { stack: "sidebar-lists", child: "lists" }], "picking Lists shows Lists");
    f.slots["sidebar-lists"].active = "lists";
    assert.ok(strings(find(view.render(cx), "st-sidebarShows")).includes("Lists"), "what the layout has, read again");
    // Its hint names the key the bindings give, which keys.json can change, in this platform's words; with none bound, none.
    const scope = f.scopes.get("t3-chrome"), bound = scope.keys, about = () => strings(view.render(cx)).find(s => s.startsWith("The Inbox"));
    assert.equal(about(), "The Inbox, or the Spaces and Agents lists.", "no key bound, none named");
    scope.keys = () => [{ section: "layout:herdr-t3", keys: "cmd-alt-l", action: "t3-tabs.sidebar" }];
    assert.equal(about(), `The Inbox, or the Spaces and Agents lists. ${scope.keyOf("t3-tabs.sidebar")} switches it too.`, "rebound, the hint follows");
    scope.keys = bound;
    fire(find(view.render(cx), "st-s-home"), "on_click", {}, cx);
    assert.ok(find(view.render(cx), "st-afterAway"), "and back to Home");
  }

  // Settings offers as Home the mods whose mod.json says "home": true, the layout's page first as Default, then Terminal;
  // a folder with no or a broken mod.json is passed over.
  {
    const f = fixture(256), view = f.load("t3-chrome", { view: "settings" }), scope = f.scopes.get("t3-chrome");
    const files = { "t3-home": { title: "Home", home: true }, notes: { title: "Notes", home: true }, "t3-tabs": { title: "Tabs" }, broken: "{" };
    scope.appHome = () => "/app";
    scope.exec = async (cmd, args) => { assert.deepEqual(plain([cmd, args]), ["ls", ["/app/mods"]]); return { code: 0, stdout: [...Object.keys(files), "bare"].join("\n") + "\n" }; };
    scope.readTextFile = async (file) => { const m = files[file.split("/").at(-2)]; return m === undefined ? null : typeof m === "string" ? m : JSON.stringify(m); };
    await scope.findHomeMods(view, cx);
    assert.deepEqual(plain(view.homeMods), [["t3-home", "Default"], [null, "Terminal"], ["notes", "Notes"]]);
  }

  {
    const f = fixture(256), firstWatch = cx.watches.length, chrome = f.load("t3-chrome"), scope = f.scopes.get("t3-chrome"), jobs = [], writes = [];
    const run = { ...cx, spawn: fn => jobs.push(fn) };
    let zoom = 1.25;
    Object.assign(f.ui.root, { titlebar: "none", traffic_lights: [16, 12] });
    f.state.layout = "focus"; // Husain's T3 layout's name
    const original = JSON.stringify({ ...f.ui.root, theme: "mine", children: [{ id: "sidebar", size: { px: 300 } }] });
    scope.settings = () => ({ zoom });
    scope.appHome = () => "/fake-app";
    scope.exec = async () => assert.fail("the layout name comes from shared state without starting a subprocess");
    scope.readTextFile = async file => { assert.equal(file, "/fake-app/layouts/focus.json"); return original; };
    scope.writeTextFile = async (file, text, expected) => { writes.push({ file, text, expected }); };
    cx.watches.slice(firstWatch).find(t => t.ms === 250).fn(run);
    chrome.alignLayout(run);
    assert.equal(jobs.length, 1, "a zoom change starts just one layout write");
    await jobs.shift()(run);
    assert.equal(f.notifications.length, 0, "window button alignment works without the Herdr CLI");
    assert.deepEqual(JSON.parse(writes[0].text), { ...JSON.parse(original), traffic_lights: [16, 17] }, "at 125% the buttons stay centered on the 40px brand row; other layout fields stay intact");
    assert.equal(writes[0].text, original.replace("[16,12]", "[16,17]"), "only traffic_lights changes, including the layout file's formatting");
    assert.equal(writes[0].expected, original, "the atomic write refuses to replace concurrent edits");
    chrome.alignLayout(run);
    assert.equal(jobs.length, 0, "waiting for the layout to reload does not repeat the write");
    f.ui.root.traffic_lights = [16, 17];
    f.ui.settings = { zoom };
    f.load("t3-chrome").alignLayout(run);
    assert.equal(jobs.length, 0, "matching coordinates need no file write");
    chrome.alignLayout(run);
    f.ui.root.traffic_lights = [16, 12];
    chrome.alignLayout(run);
    assert.equal(jobs.length, 1, "an update that puts the layout's [16, 12] back at the same zoom is aligned again");
    await jobs.shift()(run);
    for (const state of [{ platform: "linux" }, { platform: "windows" }, { platform: "macos", fullscreen: true }]) {
      Object.assign(f.ui.window, state); zoom += 0.25;
      chrome.alignLayout(run);
      assert.equal(jobs.length, 0, "non-macOS and fullscreen windows leave traffic lights alone");
    }
    Object.assign(f.ui.window, { platform: "macos", fullscreen: false });
    zoom = 2;
    scope.writeTextFile = async () => { throw new Error("changed meanwhile"); };
    chrome.alignLayout(run); await jobs.shift()(run);
    assert.match(f.notifications.at(-1).body, /changed meanwhile/);
    chrome.alignLayout(run);
    assert.equal(jobs.length, 0, "a failed write is reported once for this zoom, without a retry loop");
    zoom = 2.25;
    scope.readTextFile = async () => JSON.stringify({ children: [{ content: { props: { traffic_lights: [1, 2] } } }], titlebar: "none", traffic_lights: [16, 12] });
    scope.writeTextFile = async () => assert.fail("an ambiguous field must not overwrite unrelated mod props");
    chrome.alignLayout(run); await jobs.shift()(run);
    assert.match(f.notifications.at(-1).body, /Couldn't locate/, "the text edit is checked against the intended root field before writing");
    zoom = 2.5;
    f.state.layout = "other";
    const notices = f.notifications.length;
    chrome.alignLayout(run);
    assert.equal(jobs.length, 0, "another layout does not start a layout write");
    assert.equal(f.notifications.length, notices, "an unconfirmed layout is left alone");
  }

  {
    // As T3's SidebarBrandWidthProbe: the sidebar is never narrower than the brand row, the toggle's inset, 28 and 8, the tile's
    // 16 + 4, the name, and T3's 4 + 2 × 28 + 12 after it, nor than 208. At that width the name ends 2 short of the filter
    // icon's right edge in the row below (8 in, two 28px buttons after it, its 16px icon 6 in), as T3's "Code" does.
    const f = fixture(256), chrome = f.load("t3-chrome"), scope = f.scopes.get("t3-chrome"), jobs = [], writes = [];
    const run = { ...cx, spawn: fn => jobs.push(fn) };
    let zoom = 1.1;
    Object.assign(f.ui.root, { titlebar: "none", traffic_lights: [16, 14] });
    Object.assign(f.ui.window, { titlebar: "none" });
    f.slots.sidebar.min = 208;
    f.state.layout = "focus"; // Husain's T3 layout's name
    const original = `{\n  "titlebar": "none",\n  "traffic_lights": [16, 14],\n  "children": [\n    { "id": "sidebar", "children": [{ "id": "spaces", "min": 90 }],\n      "size": { "px": 256 },\n      "min": 208,\n      "max": 480 }\n  ]\n}\n`;
    let file = original;
    scope.settings = () => ({ zoom });
    scope.appHome = () => "/fake-app";
    scope.readTextFile = async () => file;
    scope.writeTextFile = async (path, text, expected) => { writes.push({ path, text, expected }); };
    chrome.alignLayout(run);
    assert.equal(jobs.length, 0, "until the name is measured there is no row to fit");
    fire(find(chrome.render(cx), "home-name"), "on_size_change", { width: 40 * zoom }, cx);
    chrome.alignLayout(run);
    assert.equal(jobs.length, 1, "a measured name starts one layout write");
    await jobs.shift()(run);
    assert.equal(f.notifications.length, 0);
    // (16 + 66) / 1.1 − 4 = 70.5, + 28 + 8 + 20 + 40 + 72 = 238.5 → 239.
    assert.equal(writes[0].text, original.replace(`"min": 208`, `"min": 239`), "only the sidebar's min changes, not another node's, formatting kept");
    assert.equal(writes[0].expected, original, "the atomic write refuses to replace concurrent edits");
    chrome.alignLayout(run);
    assert.equal(jobs.length, 0, "waiting for the layout to reload does not repeat the write");
    f.slots.sidebar.min = 239;
    f.load("t3-chrome").alignLayout(run);
    assert.equal(jobs.length, 0, "a fitting min needs no write");
    // A short name: never under T3's 208.
    fire(find(chrome.render(cx), "home-name"), "on_size_change", { width: 1 }, cx);
    file = original.replace(`"min": 208`, `"min": 239`);
    chrome.alignLayout(run); await jobs.shift()(run);
    assert.match(writes.at(-1).text, /"min": 208,/, "the floor is 208");
    // Another zoom moves the window buttons and the toggle with them: one write carries both.
    f.slots.sidebar.min = 208; file = original;
    zoom = 1.25; writes.length = 0;
    fire(find(chrome.render(cx), "home-name"), "on_size_change", { width: 40 * zoom }, cx);
    chrome.alignLayout(run);
    assert.equal(jobs.length, 1, "one write for both fields");
    await jobs.shift()(run);
    // (82) / 1.25 − 4 = 61.6, + 168 = 229.6 → 230.
    assert.equal(writes[0].text, original.replace("[16, 14]", "[16,17]").replace(`"min": 208`, `"min": 230`));
    for (const state of [{ platform: "linux" }, { platform: "windows" }, { platform: "macos", fullscreen: true }]) {
      Object.assign(f.ui.window, state); zoom += 0.25;
      chrome.alignLayout(run);
      assert.equal(jobs.length, 0, "without the layout's window buttons the min is left as it is");
    }
  }

  {
    // A long Agents list draws only the rows in view, and the wheel moves them; a short one draws them all, natively scrolled.
    const f = fixture(256), program = f.agents()[0].program;
    for (let i = 0; i < 60; i++) {
      const a = { address: `w${i}`, pane: `pw${i}`, space: "s0", space_name: "project 0", tab: `bw${i}`, title: `w${i}`, seq: 10 + i, program, focused: false, status: "working" };
      f.agents().push(a); f.terminals().push({ ...a, state: "live" }); f.panes().push({ ...a, terminal: a.address, cwd: "/work/s0" });
    }
    const ag = f.load("t3-agents"), drawn = () => {
      const win = find(ag.render(cx), "ag-window");
      return win && win.items.filter(n => "absolute" in n.style).map(n => n.items[0].items[0].key).filter(k => typeof k === "string");
    };
    assert.ok(drawn().length > 0 && drawn().length < 30, "62 agents: only what fits before the first measure");
    fire(find(ag.render(cx), "ag-window"), "on_size_change", { width: 240, height: 300 }, cx);
    const first = drawn();
    // Husain's agent rows are two lines: 52px and the 1px gap, not T3's 36.
    const P = 53;
    assert.ok(first.length <= Math.ceil((300 + 4 * P) / P) + 1 && first.includes("ag-t0"), "measured: the rows in 300px and two past each end");
    fire(find(ag.render(cx), "ag-window"), "on_scroll_wheel", { delta: { y: -P * 30 } }, cx);
    const later = drawn();
    assert.ok(!later.includes("ag-t0") && later.includes("ag-w30") && later.length <= Math.ceil((300 + 4 * P) / P) + 1, "the wheel moves the window down the list");
    fire(find(ag.render(cx), "ag-window"), "on_scroll_wheel", { delta: { y: 1e6 } }, cx);
    assert.deepEqual(drawn(), first, "and back to the top, no further");
    f.agents().splice(2); f.terminals().splice(f.terminals().findIndex(k => k.address === "w0")); f.panes().splice(2);
    assert.equal(find(ag.render(cx), "ag-window"), null, "two agents: the whole list, natively scrolled");
  }
  console.log("ok: sidebar widths, folds, pins, tree, shared hidden navigation, Settle/Undo in both modes, status suppression, Review return, Home.");
})().catch(e => { console.error(e); process.exit(1); });
