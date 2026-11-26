// Loads the menu in a fake `herdr`: ordering, scrolling, and where new tabs and spaces open.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const kit = require("./check-kit.js");
const element = kit.elements(), { find } = kit;
const text = (n) => typeof n === "string" ? n : n?.items ? n.items.map(text).join(" ") : "";

let spaces, machines, panes = [], paneReads = 0, closed = 0, checking = true, notifies = 0;
let openProps = {};
const calls = [], state = {}, notifications = [];
const missingOnDisk = new Set();
let execHandler = null;
const execCalls = [];
const flush = () => new Promise((r) => setImmediate(r));
const cx = {
  notify() { notifies++; },
  stop_propagation() {},
  focus_handle: () => ({ focus() {}, is_focused: () => false }),
  spawn: (fn) => fn(cx),
};
let platform = "macos";
const context = vm.createContext({
  View: class {}, div: element, svg: element, image: element, h_flex: element, v_flex: element, Input: { new: element },
  InputState: { new: () => { const on = {}; let value = ""; return { on: (e, f) => { on[e] = f; }, value: () => value, focus() {}, set_value(v) { value = v; }, type(v) { value = v; on.change({}, cx); }, submit() { on.submit({}, cx); } }; } },
  settings: () => ({ zoom: 1 }),
  theme: () => ({ foreground: "#fff", ansi1: "#f00" }), spaces: () => spaces, machines: () => machines, panes: () => { paneReads++; return [...panes]; }, run: (name, args) => calls.push([name, args]),
  notify: (n) => notifications.push(n),
  shared: (k) => state[k], setShared: (k, v) => { state[k] = v; }, closeOverlay() { closed++; }, props: () => ({ overlay: "o", ...openProps }), window: () => ({ platform }), keys: () => [{ section: "global", keys: "cmd-n", action: "space.new" }], home: () => "/home/me",
  checking: () => checking,
  exec: async (cmd, args = [], opts) => {
    if (cmd === "sh" && args[0] === "-c" && typeof args[1] === "string" && args[1].includes("[ -d ")) {
      const folders = args.slice(3);
      execCalls.push(folders);
      if (execHandler) return execHandler(folders);
      return { code: 0, stdout: folders.filter((d) => missingOnDisk.has(d)).map((d) => `${d}\0`).join(""), stderr: "" };
    }
    throw new Error(`No icon probe in the test (${cmd} ${JSON.stringify(args)} ${JSON.stringify(opts)})`);
  },
});
const read = (file) => fs.readFileSync(path.join(__dirname, file), "utf8");
// Keep project helpers in their module scope so their private keyOf doesn't collide with tip.js.
const projects = `const { projectMark, placeOf, dormantProjects, forgetProject } = (() => {
${["project.js", "projects.js"].map((file) => kit.strip(read(file))).join("\n")}
return { projectMark, placeOf, dormantProjects, forgetProject };
})();`;
const src = ["color.js", "store.js", "list.js", "tip.js", "button.js", "focus.js", "palette.js", "new-space.js", "main.js"]
  .map((file) => kit.strip(read(file))).join("\n").replace("export default class", "globalThis.Mod = class");
vm.runInContext(projects + "\n" + src, context);
const open = () => { const m = new context.Mod(); m.init({}, cx); return m; };
const list = (m) => find(m.render(), "new-rows");
const childKeysOf = (m) => list(m).items.map((n) => n.key);
const keysOf = (m) => childKeysOf(m).filter((k) => k !== "new-projects-heading");
const topHeading = (m) => text(m.render().items[1]);
const click = (m, id) => find(list(m), id).handlers.on_click({}, cx);
const press = (m, key, platform = false, control = false) => m.render().handlers.on_key_down({ key, modifiers: { platform, control } }, cx);
const take = () => JSON.parse(JSON.stringify(calls.splice(0)));

const local = (id, active = false) => ({ id, name: id, folder: "/home/me/" + id, machine: null, active });
const remote = (id, active = false) => ({ id, name: id, folder: "", machine: "kvm", active });
machines = [{ name: null, layout: "ready" }, { name: "kvm", layout: "ready" }, { name: "away", layout: "unavailable" }];

// The current space leads, a machine's spaces stay together, ⌘n follows what's shown.
spaces = [remote("r1"), local("a"), remote("r2", true), local("b")];
let m = open();
assert.deepEqual(keysOf(m), ["space:r2", "space:r1", "space:a", "space:b"]);
press(m, "3", true);
// A space names itself to t3-tabs, in view or not, so the Inbox bar reads the tab as something started there (`fresh`).
assert.deepEqual(take(), [["t3-tabs.new:a", null]]);
press(open(), "1", true);
assert.deepEqual(take(), [["t3-tabs.new:r2", null]]);
// A row's number reads as the platform names the key that picks it.
assert.ok(text(find(list(m), "space:a")).includes("⌘3"));
assert.equal(topHeading(m), "Spaces", "only live spaces: top heading is Spaces");
assert.equal(find(list(m), "new-projects-heading"), null, "only live spaces: no in-list Projects heading");
assert.equal(text(find(list(m), "space:a").items.at(-1)), "⌘3", "only live spaces: ⌘n sits flush right with no 20px spacer");
assert.notEqual(find(list(m), "space:a").items.at(-1)?.style?.w, 20);
platform = "linux";
assert.ok(text(find(list(open()), "space:a")).includes("Super+3"), "not a Mac's ⌘ elsewhere");
platform = "macos";

// New work doesn't start in Home, shown or not.
state["t3-tabs.home"] = "a";
assert.deepEqual(keysOf(open()), ["space:r2", "space:r1", "space:b"]);
delete state["t3-tabs.home"];

// Up and down keep the highlighted row on screen, round the ends too; six rows show.
spaces = Array.from({ length: 9 }, (_, i) => local("s" + i, i === 0));
m = open();
press(m, "up");
assert.deepEqual([m.at, keysOf(m).at(-1)], [8, "space:s8"]);
press(m, "down");
assert.deepEqual([m.at, keysOf(m)[0]], [0, "space:s0"]);
for (let i = 0; i < 6; i++) press(m, "down");
assert.deepEqual([keysOf(m)[0], keysOf(m).at(-1)], ["space:s1", "space:s6"]);
// The pointer lights a row.
find(list(m), "space:s3").handlers.on_hover(true, cx);
assert.equal(m.at, 3);
spaces = [local("a", true), remote("r1"), local("b")];
m = open();
m.spaceInput.type("kvm");
assert.deepEqual(keysOf(m), ["space:r1"], "search finds a space by its machine");
assert.equal(m.at, 0);
m.spaceInput.type("nothing");
assert.equal(list(m), null);
press(m, "down"); // no rows: nothing to reach, nothing thrown
click(open(), "space:r1");
assert.deepEqual(take(), [["t3-tabs.new:r1", null]], "another machine's space, the same");

// Bookmarks follow live spaces, and neither the creation folder nor the current folder duplicates a live space.
spaces = [remote("r1"), { ...local("a", true), tabs: [{ id: "tab-a" }] }];
panes = [{ tab: "tab-a", cwd: "/home/me/current" }];
state["t3.projects"] = [
  { machine: null, folder: "/home/me/a", name: "Open at creation" },
  { machine: null, folder: "/home/me/current", name: "Open now" },
  { machine: null, folder: "/home/me/archive", name: "My Archive", named: true },
  { machine: "kvm", folder: "/srv/repo", name: "Repo" },
  { machine: "away", folder: "/srv/offline", name: "Offline" },
  { machine: "missing", folder: "/srv/gone", name: "Missing" },
];
m = open();
assert.equal(topHeading(m), "Spaces", "both live spaces and projects: top heading is Spaces");
assert.deepEqual(childKeysOf(m), [
  "space:a", "space:r1", "new-projects-heading", "project::/home/me/archive", "project:kvm:/srv/repo",
  "project:away:/srv/offline", "project:missing:/srv/gone",
], "Projects heading sits directly between live spaces and remembered projects");
assert.deepEqual(keysOf(m), [
  "space:a", "space:r1", "project::/home/me/archive", "project:kvm:/srv/repo",
  "project:away:/srv/offline", "project:missing:/srv/gone",
]);
const projectsHead = find(list(m), "new-projects-heading");
assert.equal(text(projectsHead), "Projects");
assert.equal(projectsHead.style.h, 28);
assert.equal(projectsHead.style.px, 8);
assert.equal(projectsHead.style.pt, 8);
assert.equal(projectsHead.style.pb, 4);
assert.equal(projectsHead.style.top, 96);
assert.equal(projectsHead.handlers.on_click, undefined, "Projects heading is not clickable");
assert.equal(projectsHead.handlers.on_hover, undefined, "Projects heading is not hover-selectable");
const liveSpaceA = find(list(m), "space:a");
assert.equal(liveSpaceA.items.at(-1).style.w, 20, "live space reserves 20px right spacer when projects exist");
assert.equal(text(liveSpaceA.items.at(-2)), "⌘1", "live space shortcut aligns before 20px spacer");
const archive = find(list(m), "project::/home/me/archive");
assert.equal(archive.style.h, 48);
assert.equal(archive.style.top, 124, "first project row sits directly below the 28px Projects heading");
assert.equal(archive.items.at(-1).style.w, 20, "dormant project ends with 20px remove button");
assert.equal(text(archive.items.at(-2)), "⌘3", "dormant project shortcut aligns before 20px remove button");
assert.ok(text(archive).includes("My Archive ~/archive ⌘3"));
const beforeOpen = closed;
press(m, "3", true);
assert.equal(closed, beforeOpen + 1);
assert.deepEqual(take(), [["space.new", { folder: "/home/me/archive", machine: "", name: "My Archive" }]]);

// A bookmark with no cached icon falls back to its own mark when another bookmark has an icon.
checking = false;
state["t3.spaceIcons"] = { '[null,"/home/me/archive"]': "cache/archive.svg" };
const marked = list(open());
assert.ok(kit.walk(find(marked, "project::/home/me/archive")).some((node) => node.kind === "cache/archive.svg"));
assert.ok(kit.strings(find(marked, "project:kvm:/srv/repo")).includes("R"));
checking = true;
delete state["t3.spaceIcons"];

// Search matches a bookmark's name, machine and full folder.
for (const query of ["My Archive", "/HOME/ME/ARCHIVE"]) {
  m.spaceInput.type(query);
  assert.deepEqual(keysOf(m), ["project::/home/me/archive"]);
  assert.equal(topHeading(m), "Projects", "only remembered projects match: top heading is Projects");
  assert.equal(find(list(m), "new-projects-heading"), null, "only remembered projects match: no in-list Projects heading");
}
m.spaceInput.type("KVM");
assert.equal(topHeading(m), "Spaces");
assert.deepEqual(childKeysOf(m), ["space:r1", "new-projects-heading", "project:kvm:/srv/repo"]);
assert.equal(list(m).style.h, 48 + 28 + 48, "list height includes the 28px Projects heading");
assert.deepEqual(keysOf(m), ["space:r1", "project:kvm:/srv/repo"]);
const repo = find(list(m), "project:kvm:/srv/repo");
assert.deepEqual(kit.strings(repo).slice(-4), ["Repo", "kvm ·", "/srv/repo", "⌘2"]);
assert.ok(kit.walk(repo).some((node) => node.kind === "mods/t3-new-menu/icons/server.svg"));
assert.equal(repo.style.opacity, undefined);
press(m, "down");
m.spaceInput.submit();
assert.deepEqual(take(), [["space.new", { folder: "/srv/repo", machine: "kvm" }]]);

// A remote Project's folder is its machine's: this computer's home isn't cut out of it.
state["t3.projects"].push({ machine: "kvm", folder: "/home/me/there", name: "There" });
m = open(); m.spaceInput.type("there");
assert.deepEqual(kit.strings(find(list(m), "project:kvm:/home/me/there")).slice(-3, -1), ["kvm ·", "/home/me/there"]);
state["t3.projects"].pop();

// An unavailable or unreported machine cannot open a bookmark by click, Enter or a numbered shortcut.
for (const [query, id] of [["away", "project:away:/srv/offline"], ["missing", "project:missing:/srv/gone"]]) {
  m = open();
  m.spaceInput.type(query);
  assert.equal(find(list(m), id).style.opacity, 0.64);
  const beforeDisabled = closed;
  click(m, id);
  m.spaceInput.submit();
  press(m, "1", true);
  assert.deepEqual(take(), []);
  assert.equal(closed, beforeDisabled);
}

// Dormant project rows (including offline ones) show a fixed × remove button; live spaces and machines do not.
{
  m = open();
  const drawn = list(m);
  assert.equal(find(find(drawn, "space:a"), "remove-space:a"), null, "live space has no remove button");
  assert.equal(find(find(drawn, "space:r1"), "remove-space:r1"), null, "remote live space has no remove button");
  for (const [id, name] of [
    ["project::/home/me/archive", "My Archive"],
    ["project:kvm:/srv/repo", "Repo"],
    ["project:away:/srv/offline", "Offline"],
    ["project:missing:/srv/gone", "Missing"],
  ]) {
    const btn = find(find(drawn, id), `remove-${id}`);
    assert.ok(btn, `${id} has a fixed remove button`);
    assert.equal(btn.style.accessibility_label, `Remove ${name}`);
    assert.equal(btn.style.h, 20);
    assert.equal(btn.style.w, 20);
    assert.equal(btn.style.tab_index, 0);
    assert.ok(kit.walk(btn).some((node) => node.kind === "mods/t3-new-menu/icons/x.svg"));
  }
  // Footer shows ⌃D Remove on macOS and Ctrl+D Remove elsewhere while dormant projects are listed.
  assert.ok(text(m.render()).includes("⌃D Remove"), "macOS footer shows ⌃D Remove");
  platform = "linux";
  assert.ok(text(m.render()).includes("Ctrl+D Remove"), "non-macOS footer shows Ctrl+D Remove");
  platform = "macos";
  // Filtering to only live spaces omits the Remove hint.
  m.spaceInput.type("r1");
  assert.ok(!text(m.render()).includes("Remove"), "footer omits Remove when no dormant project is listed");
  m.spaceInput.type("");

  // Clicking × stops propagation, removes only that project, keeps New open, and clamps `at`.
  m.at = keysOf(m).length - 1; // on project:missing:/srv/gone
  const beforeRemove = closed;
  let stopped = 0;
  const spyCx = { ...cx, stop_propagation() { stopped++; } };
  const btn = find(list(m), "remove-project:missing:/srv/gone");
  btn.handlers["on_mouse_down:left"]({}, spyCx);
  btn.handlers.on_click({}, spyCx);
  assert.equal(stopped, 2, "× stops propagation on mouse down and click");
  assert.deepEqual(take(), [], "clicking × does not open the project");
  assert.equal(closed, beforeRemove, "clicking × keeps New open");
  assert.deepEqual(keysOf(m), [
    "space:a", "space:r1", "project::/home/me/archive", "project:kvm:/srv/repo", "project:away:/srv/offline",
  ]);
  assert.equal(m.at, 4, "clamps highlight to the new last row");
  assert.equal(state["t3.projects"].some((p) => p.machine === "missing"), false);
  assert.equal(state["t3.projects"].some((p) => p.folder === "/home/me/archive"), true, "other remembered projects stay");

  // Ctrl+D removes a highlighted dormant project (including offline), keeps New open, and ignores live spaces.
  const beforeKey = closed;
  press(m, "d", false, true); // m.at === 4 -> offline project:away:/srv/offline
  assert.deepEqual(take(), []);
  assert.equal(closed, beforeKey);
  assert.deepEqual(keysOf(m), ["space:a", "space:r1", "project::/home/me/archive", "project:kvm:/srv/repo"]);
  assert.equal(m.at, 3);

  // Ctrl+D on a live space row does nothing.
  m.at = 0; // space:a
  const beforeLive = JSON.stringify(state["t3.projects"]);
  press(m, "d", false, true);
  assert.equal(JSON.stringify(state["t3.projects"]), beforeLive);
  assert.deepEqual(take(), []);
  assert.equal(closed, beforeKey);

  // Machines step has no remove buttons and omits the Remove footer hint.
  openProps = { pick: true };
  const pm = open();
  assert.equal(topHeading(pm), "Machines");
  assert.equal(find(list(pm), "new-projects-heading"), null);
  assert.ok(!kit.walk(list(pm)).some((node) => typeof node.key === "string" && node.key.startsWith("remove-")), "machine rows have no remove button");
  assert.ok(!text(pm.render()).includes("Remove"), "Machines step omits Remove footer hint");
  openProps = {};
}

// When only remembered projects exist (no live spaces), the top heading is Projects with no in-list heading.
{
  spaces = [];
  panes = [];
  state["t3.projects"] = [
    { machine: null, folder: "/home/me/only-a", name: "Only A" },
    { machine: null, folder: "/home/me/only-b", name: "Only B" },
  ];
  m = open();
  assert.equal(topHeading(m), "Projects", "no live spaces: top heading is Projects");
  assert.equal(find(list(m), "new-projects-heading"), null, "no live spaces: no in-list Projects heading");
  assert.deepEqual(childKeysOf(m), ["project::/home/me/only-a", "project::/home/me/only-b"]);
  assert.equal(list(m).style.h, 2 * 48);
}

// Scrolling, ↑/↓ and mouse wheel across the Spaces -> Projects boundary keep the Projects heading and highlight in view.
{
  spaces = Array.from({ length: 6 }, (_, i) => local("s" + i, i === 0));
  panes = [];
  state["t3.projects"] = Array.from({ length: 6 }, (_, i) => ({ machine: null, folder: `/home/me/p${i}`, name: `P${i}` }));
  m = open();
  assert.equal(list(m).style.h, 285, "list caps at LIST_MAX (285) so popup stays within 420px");
  assert.equal(find(list(m), "new-projects-heading"), null, "heading below fold at top=0");

  // Step down across the last live space (index 5) onto the first remembered project (index 6).
  for (let i = 0; i < 6; i++) press(m, "down");
  assert.equal(m.at, 6, "↓ skips Projects heading and lands on first project");
  let drawn = list(m);
  assert.equal(m.scrollTop["new-rows"], 6 * 48 + 28 + 48 - 285, "scrolls enough to show first project wholly");
  const headDown = find(drawn, "new-projects-heading");
  const p0Down = find(drawn, "project::/home/me/p0");
  assert.ok(headDown && p0Down, "Projects heading and first project both appear in view");
  assert.equal(p0Down.style.top - headDown.style.top, 28, "first project sits 28px below Projects heading");

  // Step to the bottom so Projects heading scrolls off the top, then step back up to index 6 (first project).
  for (let i = 0; i < 5; i++) press(m, "down");
  assert.equal(m.at, 11);
  assert.equal(find(list(m), "new-projects-heading"), null, "heading scrolled off top at bottom");
  for (let i = 0; i < 5; i++) press(m, "up");
  assert.equal(m.at, 6);
  drawn = list(m);
  assert.equal(m.scrollTop["new-rows"], 6 * 48, "moving up to first project reveals the Projects heading above it");
  assert.equal(find(drawn, "new-projects-heading").style.top, 0);
  assert.equal(find(drawn, "project::/home/me/p0").style.top, 28);

  // One more ↑ crosses back into Spaces cleanly.
  press(m, "up");
  assert.equal(m.at, 5);
  drawn = list(m);
  assert.equal(m.scrollTop["new-rows"], 5 * 48);
  assert.equal(find(drawn, "space:s5").style.top, 0);
  assert.equal(find(drawn, "new-projects-heading").style.top, 48);

  // Wheel scrolling over the heading boundary stops propagation, clamps highlight to a visible selectable item, and stays put.
  m = open();
  list(m);
  let wheelStopped = 0;
  const wheelCx = { ...cx, stop_propagation() { wheelStopped++; } };
  list(m).handlers.on_scroll_wheel({ delta: { y: -300 } }, wheelCx);
  assert.equal(wheelStopped, 1, "wheel stops propagation");
  assert.equal(m.scrollTop["new-rows"], 300);
  assert.ok(m.at >= 7 && m.at <= 11, "wheel clamps highlight to a valid visible selectable project row");
  list(m);
  assert.equal(m.scrollTop["new-rows"], 300, "next render does not fight the wheel scroll");

  // Pointer hover on a partially visible row does not jump scrollTop.
  m = open();
  drawn = list(m);
  // Row 5 (space:s5) sits at y = 240..288, partially clipped at 285.
  drawn.handlers.on_mouse_move({ local_position: { y: 260 } });
  find(drawn, "space:s5").handlers.on_hover(true, cx);
  assert.equal(m.at, 5);
  list(m);
  assert.equal(m.scrollTop["new-rows"], 0, "pointed partially visible row stays where it is");
}
panes = [];
delete state["t3.projects"];
spaces = [local("a", true), remote("r1"), local("b")];

// New space asks which machine; one that's away can't be picked.
m = open();
find(m.render(), "space-new").handlers.on_click({}, cx);
assert.deepEqual(take(), []);
assert.deepEqual(keysOf(m), ["machine:", "machine:away", "machine:kvm"]);
click(m, "machine:away");
assert.deepEqual(take(), []);
click(m, "machine:kvm");
assert.deepEqual(take(), [["space.new", { machine: "kvm" }]]);
m = open();
find(m.render(), "space-new").handlers.on_click({}, cx);
assert.equal(find(m.render(), "new-back").style.tab_index, 0, "Tab reaches ← Spaces");
find(m.render(), "new-back").handlers.on_click({}, cx);
assert.deepEqual(keysOf(m), ["space:a", "space:b", "space:r1"], "Back returns to the spaces");
assert.equal(find(m.render(), "space-new").style.tab_index, 0, "and New space, so the machine step is there without a mouse");
m = open();
find(m.render(), "space-new").handlers.on_click({}, cx);
click(m, "machine:");
assert.deepEqual(take(), [["space.new", { machine: "" }]], "This computer");

// The sidebar's New space opens on the machines; ⌘N, which doesn't ask, isn't offered as the same thing.
openProps = { pick: true };
m = open();
assert.deepEqual(keysOf(m), ["machine:", "machine:away", "machine:kvm"]);
click(m, "machine:kvm");
assert.deepEqual(take(), [["space.new", { machine: "kvm" }]]);
openProps = {};
assert.ok(!text(open().render()).includes("⌘N"), "no ⌘N beside a button that asks");

// On a remote space its machine is offered first; with one machine there is nothing to ask.
spaces = [local("a"), remote("r1", true)];
m = open();
find(m.render(), "space-new").handlers.on_click({}, cx);
assert.equal(keysOf(m)[0], "machine:kvm");
machines = [{ name: null, layout: "ready" }];
spaces = [local("a", true)];
m = open();
find(m.render(), "space-new").handlers.on_click({}, cx);
assert.deepEqual(take(), [["space.new", { machine: "" }]]);
assert.ok(text(open().render()).includes("⌘N"), "⌘N beside a button that does the same");

// A draw reads panes() once: each read copies every pane.
{ const drawn = open(); paneReads = 0; drawn.render(); assert.equal(paneReads, 1); }
// Its contents are there from the first frame: a fade leaves the popup blank.
assert.notEqual(typeof open().render().style.opacity, "number");
// Closing says which step it was on, for the buttons that open each to toggle.
openProps = {}; open().close();
assert.ok(state["t3-new-menu.closed"] && !state["t3-new-menu.pickClosed"]);
openProps = { pick: true }; open().close();
assert.ok(state["t3-new-menu.pickClosed"]);
openProps = {};
(async () => {
  // Missing local folders: probe on open (skipping checking() and remote entries), dim + label rows, warn instead of opening,
  // keep New open, keep × / Ctrl+D removal working, and handle clicks before the initial probe finishes.
  machines = [{ name: null, layout: "ready" }, { name: "kvm", layout: "ready" }];
  spaces = [local("ok-space", true), local("gone-space"), { ...remote("r1"), folder: "/srv/r1" }];
  panes = [];
  state["t3.projects"] = [
    { machine: null, folder: "/home/me/ok-proj", name: "Ok Proj" },
    { machine: null, folder: "/home/me/gone-proj", name: "Gone Proj" },
    { machine: null, folder: "/tmp/vanished", name: "Vanished" },
    { machine: "kvm", folder: "/srv/repo", name: "Repo" },
  ];

  // checking() === true never probes local folders.
  checking = true;
  execCalls.splice(0);
  open();
  await flush();
  assert.deepEqual(execCalls, [], "checking mode skips folder probing");

  // Live probe checks only unique local folders, notifies once when missing folders are found, and marks missing rows.
  checking = false;
  missingOnDisk.clear();
  missingOnDisk.add("/home/me/gone-space");
  missingOnDisk.add("/home/me/gone-proj");
  missingOnDisk.add("/tmp/vanished");
  notifications.splice(0);
  execCalls.splice(0);
  notifies = 0;
  let pm = open();
  await flush();
  assert.equal(execCalls.length, 1, "one batch probe on open");
  assert.deepEqual([...execCalls[0]].sort(), [
    "/home/me/gone-proj", "/home/me/gone-space", "/home/me/ok-proj", "/home/me/ok-space", "/tmp/vanished",
  ], "probes only local folders, never remote ones");
  assert.equal(notifies, 1, "notifies once when missing folders are found");

  const rowOf = (view, id) => {
    const idx = view.items().findIndex((x) => x.key === id);
    assert.ok(idx >= 0, `${id} exists in items`);
    view.at = idx;
    return find(list(view), id);
  };
  for (const id of ["space:gone-space", "project::/home/me/gone-proj", "project::/tmp/vanished"]) {
    const row = rowOf(pm, id);
    assert.equal(row.style.opacity, 0.64, `${id} is dimmed when missing`);
    const tag = kit.walk(row).find((n) => n.items?.includes("· Folder not found"));
    assert.ok(tag, `${id} shows Folder not found`);
    assert.equal(tag.style.text_color, "#f00", `${id} uses t.ansi1 for Folder not found`);
  }
  for (const id of ["space:ok-space", "space:r1", "project::/home/me/ok-proj", "project:kvm:/srv/repo"]) {
    const row = rowOf(pm, id);
    assert.equal(row.style.opacity, undefined, `${id} stays at full opacity`);
    assert.ok(!text(row).includes("Folder not found"), `${id} has no missing label`);
  }
  pm.at = 0;

  // Click, Enter and ⌘n on a known-missing remembered project or live space warn and keep New open.
  const beforeMissing = closed;
  const goneIdx = pm.items().findIndex((x) => x.key === "project::/home/me/gone-proj");
  rowOf(pm, "project::/home/me/gone-proj").handlers.on_click({}, cx);
  pm.at = goneIdx;
  pm.spaceInput.submit();
  press(pm, String(goneIdx + 1), true);
  assert.deepEqual(take(), [], "missing project never runs space.new");
  assert.equal(closed, beforeMissing, "missing project keeps New open");
  assert.equal(notifications.length, 3);
  assert.deepEqual(kit.plain(notifications[0]), {
    title: "Folder not found",
    body: "~/gone-proj no longer exists on this computer.",
    level: "warning",
  });
  notifications.splice(0);

  rowOf(pm, "space:gone-space").handlers.on_click({}, cx);
  assert.deepEqual(take(), [], "missing live space never runs t3-tabs.new");
  assert.equal(closed, beforeMissing, "missing live space keeps New open");
  assert.deepEqual(kit.plain(notifications.splice(0)), [{
    title: "Folder not found",
    body: "~/gone-space no longer exists on this computer.",
    level: "warning",
  }]);

  rowOf(pm, "project::/tmp/vanished").handlers.on_click({}, cx);
  assert.deepEqual(kit.plain(notifications.splice(0)), [{
    title: "Folder not found",
    body: "/tmp/vanished no longer exists on this computer.",
    level: "warning",
  }], "folders outside home stay unshortened");

  // Missing remembered projects can still be removed with × and Ctrl+D without warning or closing New.
  const rmBtn = find(rowOf(pm, "project::/tmp/vanished"), "remove-project::/tmp/vanished");
  rmBtn.handlers["on_mouse_down:left"]({}, cx);
  rmBtn.handlers.on_click({}, cx);
  assert.equal(closed, beforeMissing);
  assert.deepEqual(notifications, []);
  assert.equal(state["t3.projects"].some((p) => p.folder === "/tmp/vanished"), false, "× removes missing project");

  pm.at = pm.items().findIndex((x) => x.key === "project::/home/me/gone-proj");
  press(pm, "d", false, true);
  assert.equal(closed, beforeMissing);
  assert.deepEqual(notifications, []);
  assert.equal(state["t3.projects"].some((p) => p.folder === "/home/me/gone-proj"), false, "Ctrl+D removes missing project");

  // Re-add missing project and test instant click before initial probe resolves (missing, present, and closed mid-flight).
  state["t3.projects"].push({ machine: null, folder: "/home/me/gone-proj", name: "Gone Proj" });
  const gates = [];
  execHandler = (folders) => new Promise((resolve) => {
    gates.push(() => resolve({ code: 0, stdout: folders.filter((d) => missingOnDisk.has(d)).map((d) => `${d}\0`).join(""), stderr: "" }));
  });
  pm = open();
  assert.equal(gates.length, 1, "initial probe started");
  const beforeRace = closed;
  rowOf(pm, "project::/home/me/gone-proj").handlers.on_click({}, cx);
  assert.equal(gates.length, 2, "unprobed click triggers on-demand check");
  assert.deepEqual(take(), [], "waits for check before space.new");
  gates[1]();
  await flush();
  assert.deepEqual(take(), [], "missing project found on instant click does not open");
  assert.equal(closed, beforeRace, "New stays open after instant-click missing check");
  assert.deepEqual(kit.plain(notifications.splice(0)), [{
    title: "Folder not found",
    body: "~/gone-proj no longer exists on this computer.",
    level: "warning",
  }]);
  assert.equal(rowOf(pm, "project::/home/me/gone-proj").style.opacity, 0.64, "row updates to dimmed after click probe");
  gates[0]();
  await flush();

  // Instant click on an existing local project opens once the on-demand check succeeds.
  gates.splice(0);
  pm = open();
  const beforeOkRace = closed;
  rowOf(pm, "project::/home/me/ok-proj").handlers.on_click({}, cx);
  assert.equal(gates.length, 2);
  gates[1]();
  await flush();
  assert.equal(closed, beforeOkRace + 1, "closes New once check confirms folder exists");
  assert.deepEqual(take(), [["space.new", { folder: "/home/me/ok-proj", machine: "" }]]);
  gates[0]();
  await flush();

  // Closing New while an instant-click probe is in flight cancels opening.
  gates.splice(0);
  pm = open();
  const beforeCancelRace = closed;
  rowOf(pm, "project::/home/me/ok-proj").handlers.on_click({}, cx);
  pm.close();
  gates[1]();
  gates[0]();
  await flush();
  assert.deepEqual(take(), [], "closing New cancels in-flight click open");
  assert.equal(closed, beforeCancelRace);

  // Opening on Machines step skips initial probe, then ← Spaces triggers probing.
  execHandler = null;
  execCalls.splice(0);
  openProps = { pick: true };
  pm = open();
  await flush();
  assert.deepEqual(execCalls, [], "Machines step does not probe local folders");
  find(pm.render(), "new-back").handlers.on_click({}, cx);
  await flush();
  assert.equal(execCalls.length, 1, "returning to Spaces probes local folders");
  assert.equal(rowOf(pm, "project::/home/me/gone-proj").style.opacity, 0.64);
  openProps = {};

  // Fail-open when exec throws: no folders marked missing, and choosing still opens.
  execHandler = async () => { throw new Error("sh unavailable"); };
  pm = open();
  await flush();
  assert.equal(rowOf(pm, "project::/home/me/gone-proj").style.opacity, undefined, "exec failure does not mark folders missing");
  rowOf(pm, "project::/home/me/gone-proj").handlers.on_click({}, cx);
  await flush();
  assert.deepEqual(take(), [["space.new", { folder: "/home/me/gone-proj", machine: "" }]]);
  assert.deepEqual(notifications, []);
  execHandler = null;
  // Offline remote project warns "Machine unavailable", keeps New open, and remains removable via × / Ctrl+D.
  machines = [{ name: null, layout: "ready" }, { name: "away", layout: "unavailable" }, { name: "kvm", layout: "ready" }];
  state["t3.projects"] = [
    { machine: "away", folder: "/srv/offline-repo", name: "Offline Repo" },
    { machine: "kvm", folder: "/srv/repo", name: "Repo" },
  ];
  notifications.splice(0);
  pm = open();
  await flush();
  const beforeOff = closed;
  const offIdx = pm.items().findIndex((x) => x.key === "project:away:/srv/offline-repo");
  rowOf(pm, "project:away:/srv/offline-repo").handlers.on_click({}, cx);
  pm.at = offIdx;
  pm.spaceInput.submit();
  press(pm, String(offIdx + 1), true);
  assert.deepEqual(take(), [], "offline remote project never runs space.new");
  assert.equal(closed, beforeOff, "offline remote project keeps New open");
  assert.equal(notifications.length, 3);
  assert.deepEqual(kit.plain(notifications.splice(0)[0]), {
    title: "Machine unavailable",
    body: "away is not connected.",
    level: "warning",
  });
  press(pm, "d", false, true);
  assert.equal(closed, beforeOff, "Ctrl+D removes offline remote project without closing New");
  assert.equal(state["t3.projects"].some((p) => p.machine === "away"), false, "offline remote project removed");

  checking = true;
  console.log("ok new menu");
})().catch((e) => { console.error(e); process.exit(1); });
