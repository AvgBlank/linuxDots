const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const kit = require("./check-kit.js");
const element = kit.elements(), { find } = kit;

function texts(node, out = []) {
  if (typeof node === "string") out.push(node);
  else if (node && typeof node === "object") for (const child of node.items) texts(child, out);
  return out;
}

const calls = [], images = [];
const program = { name: "Pi", key: "pi", agent: true };
const pane = { pane: "p2", terminal: "t2", tab: "b", title: "pi", cwd: "/home/me/project", program, status: "working" };
const review = { pane: "p4", terminal: null, mod: "review-pane", tab: "b", title: "review-pane", cwd: null };
let sharedValues = {};
const shell = { pane: "p3", terminal: "t3", tab: "b", title: "me@mac: ~/project", cwd: "/home/me/project", program: { name: "zsh", key: "shell", shell: true }, status: null };
let terms = [{ address: "t2", labels: {} }, { address: "t3", labels: {} }];
let tab = { id: "b", name: "Release", named: true };
let agentList = [];
let sidebar = { id: "root", children: [{ id: "sidebar-lists", active: "lists" }] };
let props = { pane: "p2" };
let pointer = { x: 50, y: 10 };
let bound = [];
// Host reads a header's draw makes: each copies every pane or agent, and every pane has a header.
const reads = { panes: 0, agents: 0, terminals: 0, spaces: 0 };
const env = {
  View: class {}, div: element, svg: (src) => { const el = element(); el.svg = src; return el; }, image: (src) => { images.push(src); return element(); }, h_flex: element, v_flex: element, Popup: { new: (id, trigger) => element().id(id).child(trigger) }, keys: () => bound,
  theme: () => ({ selected: "#123456" }), props: () => props, panes: () => { reads.panes++; return [pane, shell, review]; }, shared: (k) => sharedValues[k] ?? null, home: () => "/home/me",
  // A new list each call, as Herdr gives (tree.js indexes each list once).
  terminals: () => { reads.terminals++; return [...terms]; }, agents: () => { reads.agents++; return agentList; }, spaces: () => { reads.spaces++; return [{ id: "s1", name: "project", tabs: [tab] }]; }, layout: () => sidebar,
  run: (name, args) => calls.push([name, args]), openOverlay: (o) => calls.push(["overlay", o]), closeOverlay: (id) => calls.push(["close", id]), settings: () => ({ zoom: 1 }), setShared: (k, v) => { sharedValues[k] = v; },
  window: Object.assign(() => ({ platform: "macos", active: true }), { mouse_position: () => pointer, viewport_size: () => ({ width: 1000, height: 800 }) }),
};
const now = Date.now();
env.Date = class extends Date { static now() { return now; } };
const ticks = [];
const tick = () => ticks.filter((w) => !w.gone).forEach((w) => w.fn(cx));
const afters = [];
const later = () => afters.splice(0).filter((w) => !w.gone).forEach((w) => w.fn(cx));
const due = () => afters.filter((w) => !w.gone).map((w) => w.at - now);
const cx = { notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {}, is_focused: () => false }), timer: {
  every(ms, fn) { const w = { ms, fn, cancel() { w.gone = true; } }; ticks.push(w); return w; },
  after(ms, fn) { const w = { at: now + ms, fn, cancel() { w.gone = true; } }; afters.push(w); return w; } } };
// The shared modules are inlined as the mod's own copies are.
function load(...files) {
  const src = files.map((f) => fs.readFileSync(f, "utf8")).join("\n")
    .replace(/^import .*;\r?\n/gm, "").replace(/export (function|const) /g, "$1 ").replace("export default class", "globalThis.Mod = class");
  const context = vm.createContext({ ...env });
  // Load the real synced helper, including the alias main.js imports.
  vm.runInContext("(() => {\n" + ["color.js", "button.js", "trigger.js"].map((f) => fs.readFileSync(path.join(__dirname, f), "utf8")).join("\n").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "") + "\nglobalThis.drawButton = button; globalThis.radiusOf = radiusOf; globalThis.DISABLED = DISABLED; globalThis.GROUP_GAP = GROUP_GAP; globalThis.trigger = trigger; globalThis.hang = hang;\n})();", context);
  vm.runInContext(src, context, { filename: files.at(-1) });
  const mod = new context.Mod(); mod.init({}, cx);
  // Drawn with a cx, as Herdr draws it: a draw may arrange a one-shot.
  const draw = mod.render;
  mod.render = () => draw.call(mod, cx);
  return mod;
}
const take = () => JSON.parse(JSON.stringify(calls.splice(0)));
const parts = ["store.js", "name.js", "tree.js", "color.js", "status-mark.js", "tip.js", "focus.js", "list.js", "menu-row.js", "program.js", "menu.js", "sidebar.js", "main.js"].map((f) => path.join(__dirname, f));
const header = load(...parts);
// Pane headers never schedule timers on render.
const repeats = (draw) => { const before = ticks.length; draw(); return ticks.length - before; };
assert.deepEqual([repeats(() => header.render()), due()], [0, []], "no render timer");
header.hovered = true;
find(header.render(), "pane-head-p2").handlers.on_click({}, cx);
assert.deepEqual(take(), [["pane.focus", { pane: "p2" }]]);
find(header.render(), "ph-r-p2").handlers.on_click({}, cx);
assert.deepEqual(take(), [["pane.split", { direction: "right", pane: "p2" }]]);
find(header.render(), "ph-d-p2").handlers.on_click({}, cx);
assert.deepEqual(take(), [["pane.split", { direction: "down", pane: "p2" }]]);
find(header.render(), "ph-z-p2").handlers.on_click({}, cx);
assert.deepEqual(take(), [["pane.zoom", { pane: "p2" }]]);
header.hot = "ph-x-p2";
find(header.render(), "ph-x-p2").handlers.on_click({}, cx);
assert.equal(header.hot, null, "the dialog covers it and the pointer may not move, so its label goes with the click");
assert.deepEqual(take(), [["t3-tabs.close-pane:p2", null]], "the tab bar asks first");
find(header.render(), "pane-head-p2").handlers["on_mouse_down:right"]({}, cx);
assert.deepEqual(take(), [["overlay", { mod: "t3-menu", kind: "popup", width: 220, height: 260, props: { tab: "pane", target: { pane: "p2", terminal: "t2" } } }]], "right-click opens the terminal's menu");
// The × runs the tab bar's close, which asks first: its label names that command's key, not Herdr's own pane.close.
{
  bound = [{ section: "", keys: "cmd-shift-q", action: "pane.close" }, { section: "layout:herdr-t3", keys: "cmd-shift-w", action: "t3-tabs.close-pane" }];
  const tipped = load(...parts);
  tipped.hovered = true; tipped.hot = "ph-x-p2";
  find(tipped.render(), "tip-over-ph-x-p2").handlers.on_hover(true, cx);
  later();
  assert.deepEqual(texts(find(tipped.render(), "tip-ph-x-p2")), ["Close pane (⇧⌘W)"]);
  find(tipped.render(), "tip-over-ph-x-p2").handlers.on_hover(false, cx);
  later();
  bound = [];
}
// One draw reads each host list once, the namer taking the draw's own: split in Lists, or alone with the Inbox.
for (const alone of [false, true]) {
  pane.zoomed = alone; sidebar.children[0].active = alone ? "inbox" : "lists";
  for (const k in reads) reads[k] = 0;
  header.render();
  assert.deepEqual(reads, { panes: 1, agents: 1, terminals: 1, spaces: 1 }, alone ? "alone with the Inbox" : "split");
}
pane.zoomed = false; sidebar.children[0].active = "lists";

// The agent's name, then its folder; no address, which the right-click menu copies.
assert.deepEqual(texts(header.render()), ["Release", "~/project"]);
// A name that is only the program's goes when its icon says it.
tab.named = false; pane.program = { ...program, icon: "pi.svg", tint: true };
assert.deepEqual(texts(header.render()), ["~/project"]);
pane.program = program; tab.named = true;
// A mod pane, named by its mod.
props = { pane: "p4" };
sharedValues["review-pane.titles"] = { a: "review · other", b: "review · fix" };
assert.equal(texts(header.render())[0], "review · fix");
// Its icon, the one its mod gives.
sharedValues["review-pane.program"] = { icon: "mods/review-pane/logo.svg", tint: false };
images.length = 0; header.render();
assert.deepEqual(images, ["mods/review-pane/logo.svg"]);
// Pane headers never draw a right-end status mark (status lives in the sidebar and tabs).
for (const word of ["working", "blocked", "done"]) {
  sharedValues["review-pane.status"] = { b: word };
  assert.equal(find(header.render(), "ph-mark-p4"), null, `mod pane draws no header mark for ${word}`);
}
delete sharedValues["review-pane.status"];

props = { pane: "p2" }; header.hovered = false;
const svgs = (node, out = []) => { if (node && typeof node === "object") { if (typeof node.svg === "string") out.push(node.svg); node.items.forEach((c) => svgs(c, out)); } return out; };
for (const mode of ["lists", "inbox"]) {
  sidebar.children[0].active = mode;
  for (const status of ["working", "blocked", "done", "idle"]) {
    pane.status = status;
    assert.equal(find(header.render(), "ph-mark-p2"), null, `${mode}/${status}: no header status mark`);
  }
  pane.status = "done";
  terms[0].labels.settled = "1:1";
  assert.equal(find(header.render(), "ph-mark-p2"), null, `${mode}/settled: no header status mark`);
  delete terms[0].labels.settled;
  terms[0].labels.snoozed = String(now + 90000);
  assert.equal(repeats(() => assert.equal(find(header.render(), "ph-mark-p2"), null, `${mode}/snoozed: no header status mark`)), 0);
  assert.deepEqual(due(), [], `${mode}/snoozed: no header timer`);
  delete terms[0].labels.snoozed;
}
sidebar.children[0].active = "inbox";
pane.status = "done";

// The buttons go with the pointer, even when the header's leave never comes (tip.js).
{
  const hover = load(...parts);
  const head = () => find(hover.render(), "pane-head-p2");
  head().handlers.on_hover(true, cx);
  head().handlers.on_mouse_move({ position: pointer, bounds: { x: 0, y: 0, width: 100, height: 30 } });
  tick();
  assert.ok(find(hover.render(), "ph-x-p2"), "the pointer on the header keeps them");
  pointer = { x: 50, y: 200 };
  tick();
  assert.equal(find(hover.render(), "ph-x-p2"), null, "off it with no leave reported, they go");
  // Under a still pointer, no move yet: no box to go by, so the first move away decides.
  head().handlers.on_hover(true, cx);
  tick();
  assert.ok(find(hover.render(), "ph-x-p2"));
  pointer = { x: 60, y: 300 };
  tick();
  assert.equal(find(hover.render(), "ph-x-p2"), null);
}

// The mode's owner closing ends the mode: a pane's × can close the pane it's on.
{
  const owner = load(...parts);
  sharedValues["t3.focus"] = owner.fs.me;
  owner.render();
  owner.close();
  assert.equal(sharedValues["t3.focus"], null);
}

// The buttons come with the keyboard on the header, the stop that gets there, and only in keyboard mode.
{
  const quiet = load(...parts);
  props = { pane: "p2" };
  assert.equal(find(quiet.render(), "ph-x-p2"), null);
  assert.equal(find(quiet.render(), "pane-head-p2").style?.tab_index, undefined);
  sharedValues["t3.focus"] = "on";
  assert.equal(find(quiet.render(), "ph-x-p2"), null);
  quiet.fs.keyboard = true; quiet.fs.handles.set("pane-head-p2", { focus() {}, is_focused: () => true });
  assert.ok(find(quiet.render(), "ph-x-p2"), "the buttons show");
  delete sharedValues["t3.focus"];
}

// Its sub-agents, all the way down: how many, or how many need the person, that opens their list.
props = { pane: "p2" }; pane.status = "working"; header.hovered = false;
assert.equal(find(header.render(), "ph-kids-p2"), null, "none, no button");
terms.push({ address: "child", parent: "t2", state: "live", status: "working", status_ms: now - 4 * 60000, name: "child task", labels: {} },
  { address: "grandchild", parent: "child", state: "live", status: "idle", name: "grandchild task", labels: {} },
  { address: "gone", parent: "t2", state: "exited", status: "idle", name: "ended", labels: {} });
{
  const kids = find(header.render(), "ph-kids-p2");
  // What it draws, in order: an svg by its file, words as they are.
  const shown = () => { const out = [], walk = (n) => typeof n === "string" ? out.push(n) : n && typeof n === "object" && (typeof n.svg === "string" ? out.push(path.basename(n.svg)) : n.items.forEach(walk)); walk(find(header.render(), "ph-kids-p2")); return out; };
  assert.equal(kids.style.accessibility_label, "2 sub-agents, 1 working", "the button says how many are at work");
  // Whenever any sub-agent is at work, the button shows the working mark before the count (even if its own agent is working too).
  const working = () => svgs(header.render()).filter((s) => path.basename(s) === "circle-dashed.svg").length;
  assert.equal(working(), 1, "one working mark in the header, inside the sub-agent button");
  assert.deepEqual(shown(), ["circle-dashed.svg", "2", "chevron-down.svg"], "shown even while its own agent is working");
  assert.equal(find(header.render(), "ph-kids-p2").style.accessibility_label, "2 sub-agents, 1 working", "its tooltip still says one is at work");
  pane.status = "idle";
  assert.deepEqual(shown(), ["circle-dashed.svg", "2", "chevron-down.svg"], "one at work, anywhere down: the shared working mark before the count");
  terms.find((k) => k.address === "child").status = "idle";
  assert.deepEqual(shown(), ["2", "chevron-down.svg"], "none at work: the count alone");
  assert.equal(find(header.render(), "ph-kids-p2").style.accessibility_label, "2 sub-agents");
  terms.find((k) => k.address === "grandchild").status = "working";
  assert.deepEqual(shown(), ["circle-dashed.svg", "2", "chevron-down.svg"], "a grandchild at work marks it too");
  terms.find((k) => k.address === "grandchild").status = "idle";
  terms.find((k) => k.address === "child").status = "working";
  pane.status = "blocked";
  assert.equal(find(header.render(), "ph-mark-p2"), null, "its own blocked state draws no separate header mark");
  pane.status = "idle";
  terms.find((k) => k.address === "grandchild").status = "blocked";
  assert.equal(find(header.render(), "ph-mark-p2"), null);
  assert.equal(find(header.render(), "ph-kids-p2").style.accessibility_label, "2 sub-agents, 1 needs you, 1 working", "the button says it");
  assert.deepEqual(shown(), ["circle-dashed.svg", "2", "chevron-down.svg"], "needing the person adds no `!` of its own: the count's colour says it");
  pane.status = "working";
  // Hung from the button, right edges together, as the agents list's sort menu.
  const k = find(header.render(), "ph-kids-p2");
  k.handlers["on_mouse_down:left"]({ bounds: { x: 300, y: 2, width: 40, height: 24 } }, cx);
  k.handlers.on_click({}, cx);
  assert.deepEqual(take(), [["overlay", { mod: "t3-pane", kind: "popup", width: 280, at: { x: 60, y: 30 }, props: { kids: "t2" } }]], "it opens the list, not the pane's focus; no height, so it grows and shrinks with its rows");
  // The list: every one a step in for each level with its own status; a click or Enter peeks it and closes the list.
  props = { kids: "t2", overlay: "o1" };
  const menu = load(...parts);
  const list = () => menu.render();
  assert.equal(find(list(), "kid-grandchild").style.bg, undefined, "opening lights no row");
  assert.equal(find(list(), "kid-gone"), null, "an ended one isn't listed");
  assert.deepEqual(["kid-child", "kid-grandchild"].map((id) => find(list(), id).items[0]?.style.w ?? 0), [0, 8], "a level in: 8 more and the gap's 8");
  assert.ok(texts(find(list(), "kid-child")).includes("4m"), "working, how long");
  const child = terms.find((k) => k.address === "child");
  child.created_ms = child.status_ms - 60 * 60000; child.status_ms = null;
  assert.ok(texts(find(list(), "kid-child")).includes("1h"), "no status change yet: working since it was made");
  const mark = (address) => find(list(), `kid-status-${address}`);
  assert.equal(mark("child").style.accessibility_label, "Working");
  assert.equal(mark("child").items[0].items[0].svg, "mods/t3-pane/icons/circle-dashed.svg");
  assert.equal(mark("grandchild").style.accessibility_label, "Needs you");
  assert.deepEqual(texts(mark("grandchild")), ["!", "Needs you"]);
  find(list(), "kid-grandchild").handlers.on_click({}, cx);
  assert.deepEqual(take(), [["close", "o1"], ["terminal.peek", { terminal: "grandchild" }]]);
  find(list(), "kid-grandchild").handlers["on_mouse_down:right"]({}, cx);
  assert.deepEqual(take(), [["close", "o1"], ["overlay", { mod: "t3-menu", kind: "popup", width: 220, height: 260,
    props: { tab: "agent", target: { address: "grandchild" } } }]], "right-click replaces the list with the shared agent menu, without peeking");
  const keys = find(list(), "pane-kids").handlers.on_key_down;
  keys({ key: "enter" }, cx);
  assert.deepEqual(take(), [], "Enter before a row is lit peeks nothing");
  keys({ key: "down" }, cx); keys({ key: "enter" }, cx);
  assert.deepEqual(take(), [["close", "o1"], ["terminal.peek", { terminal: "child" }]]);
  keys({ key: "escape" }, cx);
  assert.deepEqual(take(), [["close", "o1"]]);
  find(list(), "kid-grandchild").handlers.on_hover(true, cx);
  assert.equal(find(list(), "kid-grandchild").style.bg, env.theme().selected, "the pointer lights its row");
  find(list(), "kid-grandchild").handlers.on_hover(false, cx);
  // A command an agent ran in a shell of its own isn't an agent; an agent that shell started still is, a level in from it.
  terms.push({ address: "job", parent: "t2", state: "live", status: null, name: "e2e-run", program: { key: "shell", shell: true, agent: false }, labels: {} },
    { address: "job-kid", parent: "job", state: "live", status: "idle", name: "docs", program: { key: "pi", agent: true }, labels: {} });
  assert.equal(find(list(), "kid-job"), null, "a shell isn't listed");
  assert.equal(find(list(), "kid-job-kid").items[0]?.style.w, undefined, "what it started stands where the shell would have");
  const jobKid = terms.find((k) => k.address === "job-kid");
  jobKid.status_ms = now - 12 * 60000;
  assert.deepEqual(texts(mark("job-kid")), ["12m"], "idle shows how long, no mark");
  jobKid.status = "done"; jobKid.turn = 2;
  assert.equal(mark("job-kid").style.accessibility_label, "Done", "an unread done is a dot");
  jobKid.labels["herdr.seen"] = "2";
  assert.deepEqual(texts(mark("job-kid")), ["12m"], "read, it's idle again");
  jobKid.status = "error";
  assert.deepEqual(texts(mark("job-kid")), ["!", "Failed"], "failed: the same `!`, its own word");
  assert.deepEqual(list().items[0].items.map((row) => row.key), ["kid-child", "kid-grandchild", "kid-job-kid"], "a failure keeps its place in the tree");
  jobKid.status = null;
  assert.equal(mark("job-kid"), null, "nothing before its first report");
  jobKid.status = "idle";
  props = { pane: "p2" };
  assert.equal(find(header.render(), "ph-kids-p2").style.accessibility_label, "3 sub-agents, 1 needs you, 1 working");
  // All of them ended with the list open: it closes on the next tick.
  props = { kids: "t2", overlay: "o1" };
  const left = terms.splice(-5);
  tick();
  assert.deepEqual(take(), [["close", "o1"]]);
  terms.push(...left); tick();
  assert.deepEqual(take(), [], "while there are some, it stays");
  terms.splice(-5);
  props = { pane: "p2" };
}

// A changing tree doesn't turn an old highlight or a click into a different terminal's action.
{
  props = { kids: "t2", overlay: "kid-list" };
  const kid = (address) => ({ address, parent: "t2", state: "live", status: "idle", labels: {} });
  terms.push(kid("first"), kid("second"));
  let menu = load(...parts);
  const press = (frame, key) => frame.handlers.on_key_down({ key }, cx);
  press(menu.render(), "down");
  const first = terms.findIndex(k => k.address === "first");
  terms.splice(first, 0, kid("inserted"));
  const inserted = menu.render();
  press(inserted, "enter");
  assert.deepEqual(take(), [["close", "kid-list"], ["terminal.peek", { terminal: "first" }]], "insertion keeps the highlighted address");

  menu = load(...parts);
  const stale = menu.render();
  press(stale, "down");
  terms.splice(first, 1);
  press(stale, "enter");
  find(stale, "kid-inserted").handlers.on_click({}, cx);
  find(stale, "kid-inserted").handlers["on_mouse_down:right"]({}, cx);
  assert.deepEqual(take(), [], "the terminal that left can't be peeked or opened in the agent menu even before redraw");
  press(menu.render(), "enter");
  assert.deepEqual(take(), [], "nothing takes over the highlight");
  // Losing a highlighted agent during a redraw also clears it without a preceding action.
  press(menu.render(), "down");
  terms.splice(first, 1);
  press(menu.render(), "enter");
  assert.deepEqual(take(), []);
  terms.splice(first, 1);
  props = { pane: "p2" };
}

// Split, the panes beside the focused one recede, as T3's split terminals do, with no ring: their icon, name and folder a step
// down, back up while hovered. The buttons keep full opacity.
{
  props = { pane: "p2" };
  const step = () => ["ph-icon-p2", "ph-name-p2", "ph-folder-p2"].map((id) => find(header.render(), id)?.style.opacity);
  header.hovered = false;
  assert.deepEqual(step(), [0.5, 0.5, 0.5], "beside the focused one: a step down");
  pane.focused = true;
  assert.deepEqual(step(), [undefined, undefined, undefined], "the focused one as it is");
  pane.focused = false;
  header.hovered = true;
  assert.deepEqual(step(), [undefined, undefined, undefined], "hovered, it's back up");
}

props = { pane: "missing" };
assert.equal(find(header.render(), "pane-head-p2"), null);
console.log("ok: a lone pane keeps zoom and close; focus, both splits and close target their own pane; names follow the shared rule, a mod pane's its own title and icon; no right-end status mark or snooze timer; sub-agents' button marks working descendants and opens their nested list; a missing pane renders nothing.");
