const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function element() {
  const node = { items: [], handlers: {} };
  const proxy = new Proxy(node, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      if (key === "when") { if (args[0]) args[1](proxy); }
      else if (key === "child" || key === "trigger" || key === "content") node.items.push(args[0]);
      else if (key === "children") node.items.push(...args[0]);
      else if (key === "on_click") node.handlers.click = args[0];
      else if (key === "on_mouse_down") node.handlers[args[0]] = args[1];
      else if (key === "on_hover" || key === "on_mouse_move" || key === "on_key_down") node.handlers[key] = args[0];
      else if (key === "id") node.key = args[0];
      else if (key === "pl" || key === "accessibility_label") node[key] = args[0];
      return proxy;
    };
  } });
  return proxy;
}

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.key === id) return node;
  for (const child of node.items) { const found = find(child, id); if (found) return found; }
  return null;
}

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
const env = {
  View: class {}, div: element, svg: element, image: (src) => { images.push(src); return element(); }, h_flex: element, v_flex: element, Popup: { new: (id, trigger) => element().id(id).child(trigger) }, keys: () => [],
  theme: () => ({}), props: () => props, panes: () => [pane, shell, review], shared: (k) => sharedValues[k] ?? null, home: () => "/home/me",
  terminals: () => terms, agents: () => agentList, spaces: () => [{ id: "s1", name: "project", tabs: [tab] }], layout: () => sidebar,
  run: (name, args) => calls.push([name, args]), openOverlay: (o) => calls.push(["overlay", o]), closeOverlay: (id) => calls.push(["close", id]), settings: () => ({ zoom: 1 }), setShared: (k, v) => { sharedValues[k] = v; },
  window: Object.assign(() => ({ platform: "macos", active: true }), { mouse_position: () => pointer, viewport_size: () => ({ width: 1000, height: 800 }) }),
};
const ticks = [];
const tick = () => ticks.filter((w) => !w.gone).forEach((w) => w.fn(cx));
const afters = [];
const later = () => afters.splice(0).filter((w) => !w.gone).forEach((w) => w.fn(cx));
const cx = { notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {}, is_focused: () => false }), timer: {
  every(_ms, fn) { const w = { fn, cancel() { w.gone = true; } }; ticks.push(w); return w; },
  after(_ms, fn) { const w = { fn, cancel() { w.gone = true; } }; afters.push(w); return w; } } };
// The shared modules are inlined as the mod's own copies are.
function load(...files) {
  const src = files.map((f) => fs.readFileSync(f, "utf8")).join("\n")
    .replace(/^import .*;\r?\n/gm, "").replace(/export (function|const) /g, "$1 ").replace("export default class", "globalThis.Mod = class");
  const context = vm.createContext({ ...env });
  vm.runInContext(src, context, { filename: files.at(-1) });
  const mod = new context.Mod(); mod.init({}, cx); return mod;
}
const take = () => JSON.parse(JSON.stringify(calls.splice(0)));
const parts = ["name.js", "tree.js", "tip.js", "focus.js", "list.js", "project.js", "program.js", "details.js", "main.js"].map((f) => path.join(__dirname, f));
const header = load(...parts);
header.hovered = true;
find(header.render(), "pane-head-p2").handlers.click({}, cx);
assert.deepEqual(take(), [["pane.focus", { pane: "p2" }]]);
find(header.render(), "ph-r-p2").handlers.click({}, cx);
assert.deepEqual(take(), [["pane.split", { direction: "right", pane: "p2" }]]);
find(header.render(), "ph-d-p2").handlers.click({}, cx);
assert.deepEqual(take(), [["pane.split", { direction: "down", pane: "p2" }]]);
find(header.render(), "ph-z-p2").handlers.click({}, cx);
assert.deepEqual(take(), [["pane.zoom", { pane: "p2" }]]);
header.hot = "ph-x-p2";
find(header.render(), "ph-x-p2").handlers.click({}, cx);
assert.equal(header.hot, null, "the dialog covers it and the pointer may not move, so its label goes with the click");
assert.deepEqual(take(), [["t3-tabs.close-pane:p2", null]], "the tab bar asks first");
find(header.render(), "pane-head-p2").handlers.right({}, cx);
assert.deepEqual(take(), [["overlay", { mod: "t3-menu", kind: "popup", width: 220, height: 260, props: { tab: "pane", target: { pane: "p2", terminal: "t2" } } }]], "right-click opens the terminal's menu");

// Names: Pi session, else (agents only) a named tab, else a telling title, else the program.
// The agent's name, then its folder; no address, which the right-click menu copies.
assert.deepEqual(texts(header.render()), ["Release", "~/project"]);
const named = () => texts(header.render())[0];
terms[0].labels["pi.session"] = "Fix login";
assert.equal(named(), "Fix login");
delete terms[0].labels["pi.session"];
assert.equal(named(), "Release");
// Two agents in the named tab would read alike under its name: each goes by its own.
pane.title = "✳ Review PR";
agentList = [{ address: "t2", tab: "b" }, { address: "t5", tab: "b" }];
assert.equal(named(), "Review PR");
// A sub-agent beside its parent leaves the name to it.
terms[0].state = "live"; terms.push({ address: "t5", parent: "t2", state: "live", labels: {} });
assert.equal(named(), "Release");
terms.at(-1).parent = null; terms[0].parent = "t5";
assert.equal(named(), "Review PR", "a sub-agent doesn't take its tab's name");
delete terms[0].parent; terms.pop(); agentList = []; pane.title = "pi";
// A name that is only the program's goes when its icon says it.
tab.named = false; pane.program = { ...program, icon: "pi.svg", tint: true };
assert.deepEqual(texts(header.render()), ["~/project"]);
pane.program = program;
tab.named = false; pane.title = "π - Review PR - project";
assert.equal(named(), "Review PR");
pane.title = "π - project";
assert.equal(named(), "Pi", "Pi's unnamed title is only its folder, which the space already says");
pane.title = "⠋ project";
assert.equal(named(), "Pi", "nor Codex's: its spinner and project");
pane.title = "OC | Review PR";
assert.equal(named(), "OC | Review PR", "an agent's marks come off only its own titles");
pane.program = { name: "OpenCode", key: "opencode", agent: true };
assert.equal(named(), "Review PR");
pane.program = program;
pane.title = "✳ Review PR";
assert.equal(named(), "Review PR");
pane.title = "pi";
assert.equal(named(), "Pi");
terms[0].labels["pi.session"] = "Fix login"; pane.title = "π - Fix login - project";
pane.program = { name: "Git Changes", key: "lazygit", agent: false };
assert.equal(named(), "Git Changes", "lazygit after Pi in the same shell: Pi's session and title are left behind");
pane.program = program; delete terms[0].labels["pi.session"];
tab.named = true; props = { pane: "p3" };
assert.equal(named(), "zsh");
shell.title = "t3";
assert.equal(named(), "zsh");
// A mod pane: the title its mod gives itself, else its folder name.
props = { pane: "p4" };
assert.equal(texts(header.render())[0], "review-pane");
sharedValues["review-pane.titles"] = { a: "review · other", b: "review · fix" };
assert.equal(texts(header.render())[0], "review · fix");
// Its icon, the one its mod gives.
sharedValues["review-pane.program"] = { icon: "mods/review-pane/logo.svg", tint: false };
images.length = 0; header.render();
assert.deepEqual(images, ["mods/review-pane/logo.svg"]);
// Its status, the word its mod gives for its tab, with an agent's marks; another tab's isn't its own.
const bare = header.render().items.length;
sharedValues["review-pane.status"] = { a: "working" };
assert.equal(header.render().items.length, bare);
for (const word of ["working", "blocked", "done"]) {
  sharedValues["review-pane.status"] = { b: word };
  assert.equal(header.render().items.length, bare + 1, word);
}
delete sharedValues["review-pane.status"];

// A settled agent's done dot goes in both sidebar modes.
props = { pane: "p2" }; pane.status = "done"; header.hovered = false;
const dots = () => header.render().items.length;
const shown = dots();
terms[0].labels.settled = "1:1";
assert.equal(dots(), shown - 1, "Lists hide a settled done dot too");
delete terms[0].labels.settled; terms[0].labels.snoozed = String(Date.now() + 60000);
assert.equal(dots(), shown - 1, "Lists hide a snoozed done dot too");
delete terms[0].labels.snoozed; terms[0].labels.settled = "1:1";
sidebar.children[0].active = "inbox";
assert.equal(dots(), shown - 1);
delete terms[0].labels.settled; terms[0].labels.snoozed = String(Date.now() + 60000);
assert.equal(dots(), shown - 1, "snoozed too");
terms[0].labels.snoozed = String(Date.now() - 1);
assert.equal(dots(), shown, "woken, it is news again");
delete terms[0].labels.snoozed;
// A hidden Inbox doesn't clear the label, so the label alone can't say: a turn ended since it was settled is news.
terms[0].labels.settled = "1:1"; terms[0].turn = 2;
assert.equal(dots(), shown, "a new turn's done shows, the label still on");
delete terms[0].labels.settled; delete terms[0].turn;

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

// The mode's owner closing ends the mode: a pane's × can close the pane it's on, and its timers go with it.
{
  const owner = load(...parts);
  sharedValues["t3-focus"] = owner.fs.me;
  owner.close();
  assert.equal(sharedValues["t3-focus"], null);
}

// The buttons come with the keyboard on the header, the stop that gets there, and only in keyboard mode.
{
  const quiet = load(...parts);
  props = { pane: "p2" };
  assert.equal(find(quiet.render(), "ph-x-p2"), null);
  assert.equal(find(quiet.render(), "pane-head-p2").style?.tab_index, undefined);
  sharedValues["t3-focus"] = "on";
  assert.equal(find(quiet.render(), "ph-x-p2"), null);
  quiet.fs.keyboard = true; quiet.fs.handles.set("pane-head-p2", { focus() {}, is_focused: () => true });
  assert.ok(find(quiet.render(), "ph-x-p2"), "the buttons show");
  delete sharedValues["t3-focus"];
}

// Its sub-agents, all the way down: how many, or how many need the person, that opens their list.
props = { pane: "p2" }; pane.status = "working"; header.hovered = false;
assert.equal(find(header.render(), "ph-kids-p2"), null, "none, no button");
terms.push({ address: "child", parent: "t2", state: "live", status: "working", status_ms: Date.now() - 4 * 60000, name: "child task", labels: {} },
  { address: "grandchild", parent: "child", state: "live", status: "idle", name: "grandchild task", labels: {} },
  { address: "gone", parent: "t2", state: "exited", status: "idle", name: "ended", labels: {} });
{
  const kids = find(header.render(), "ph-kids-p2");
  assert.equal(kids.accessibility_label, "2 sub-agents");
  assert.ok(texts(kids).includes("2 agents"));
  terms.find((k) => k.address === "grandchild").status = "blocked";
  assert.equal(find(header.render(), "ph-kids-p2").accessibility_label, "2 sub-agents, 1 needs you");
  assert.ok(texts(find(header.render(), "ph-kids-p2")).includes("1 needs you"), "what needs the person says so, counted once");
  // Hung from the button, right edges together, as the agents list's sort menu.
  const k = find(header.render(), "ph-kids-p2");
  k.handlers.left({ bounds: { x: 300, y: 2, width: 40, height: 24 } }, cx);
  k.handlers.click({}, cx);
  assert.deepEqual(take(), [["overlay", { mod: "t3-pane", kind: "popup", width: 280, at: { x: 60, y: 30 }, props: { kids: "t2" } }]], "it opens the list, not the pane's focus; no height, so it grows and shrinks with its rows");
  // The list, as the layout's menus: a heading with the counts, every one a step in for each level with its own status;
  // a click or Enter peeks it and closes the list.
  props = { kids: "t2", overlay: "o1" };
  const menu = load(...parts);
  const list = () => menu.render();
  assert.ok(texts(list()).includes("2 agents · 1 working · 1 needs you"));
  assert.equal(find(list(), "kid-gone"), null, "an ended one isn't listed");
  assert.deepEqual(["kid-child", "kid-grandchild"].map((id) => find(list(), id).pl), [8, 24]);
  assert.equal(find(list(), "kid-child").accessibility_label, "child task, Working", "its own status: the row under it says what's stuck");
  assert.ok(texts(find(list(), "kid-child")).includes("4m"), "working, how long");
  const child = terms.find((k) => k.address === "child");
  child.created_ms = child.status_ms - 60 * 60000; child.status_ms = null;
  assert.ok(texts(find(list(), "kid-child")).includes("1h"), "no status change yet: working since it was made");
  assert.equal(find(list(), "kid-grandchild").accessibility_label, "grandchild task, Needs you");
  assert.ok(texts(find(list(), "kid-grandchild")).includes("Needs you"));
  find(list(), "kid-grandchild").handlers.click({}, cx);
  assert.deepEqual(take(), [["close", "o1"], ["terminal.peek", { terminal: "grandchild" }]]);
  const keys = find(list(), "pane-kids").handlers.on_key_down;
  keys({ key: "down" }, cx); keys({ key: "enter" }, cx);
  assert.deepEqual(take(), [["close", "o1"], ["terminal.peek", { terminal: "child" }]]);
  keys({ key: "escape" }, cx);
  assert.deepEqual(take(), [["close", "o1"]]);
  // A row's details, as the agents list's card for a sub-agent: 150ms in; one with no pane is in its parent's space.
  const row = () => find(list(), "kid-child");
  row().handlers.on_hover(true, cx);
  assert.equal(find(list(), "details-child"), null, "not at once");
  later(); later();
  const card = find(list(), "details-child");
  assert.ok(card, "the card comes");
  assert.deepEqual(texts(card).filter((s) => ["child task", "project"].includes(s)), ["child task", "project"]);
  // The next row's enter before this one's leave: the card goes to it, and this leave doesn't take it down.
  find(list(), "kid-grandchild").handlers.on_hover(true, cx);
  row().handlers.on_hover(false, cx);
  later();
  assert.ok(find(list(), "details-grandchild"), "the next row's card, at once, and it stays");
  find(list(), "kid-grandchild").handlers.on_hover(false, cx);
  later();
  assert.equal(find(list(), "details-grandchild"), null, "leaving, it fades and goes");
  // A command an agent ran in a shell of its own isn't an agent; an agent that shell started still is, a level in from it.
  terms.push({ address: "job", parent: "t2", state: "live", status: null, name: "e2e-run", program: { key: "shell", shell: true, agent: false }, labels: {} },
    { address: "job-kid", parent: "job", state: "live", status: "idle", name: "docs", program: { key: "pi", agent: true }, labels: {} });
  assert.equal(find(list(), "kid-job"), null, "a shell isn't listed");
  assert.equal(find(list(), "kid-job-kid").pl, 8);
  assert.ok(texts(list()).includes("3 agents · 1 working · 1 needs you"));
  props = { pane: "p2" };
  assert.equal(find(header.render(), "ph-kids-p2").accessibility_label, "3 sub-agents, 1 needs you");
  // All of them ended with the list open: it closes on the next tick, not left as a heading over nothing.
  props = { kids: "t2", overlay: "o1" };
  const left = terms.splice(-5);
  tick();
  assert.deepEqual(take(), [["close", "o1"]]);
  terms.push(...left); tick();
  assert.deepEqual(take(), [], "while there are some, it stays");
  terms.splice(-5);
  props = { pane: "p2" };
}

props = { pane: "missing" };
assert.equal(find(header.render(), "pane-head-p2"), null);
console.log("ok: a lone pane keeps zoom and close; focus, both splits and close target their own pane; names follow the shared rule, a mod pane's its own title and icon; quiet done dots hide in both modes; sub-agents open as a nested list that peeks; a missing pane renders nothing.");
