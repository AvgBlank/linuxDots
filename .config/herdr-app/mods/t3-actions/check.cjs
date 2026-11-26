// node mods/t3-actions/check.cjs: main.js runs on inert elements, every view reached without a window.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const kit = require("./check-kit.js");
const element = kit.elements({ args: "auto" }), { find, plain } = kit;
// A hidden measuring copy (h 0) says nothing.
const strings = (node) => typeof node === "string" ? [node] : node && typeof node === "object" && node.style.h !== 0 ? node.items.flatMap(strings) : [];
// No event given: Herdr's own, an empty one and the frame's cx.
const fire = (node, event, ...args) => kit.fire(node, event, ...(args.length ? args : [{}, cx]));

const state = {}, calls = [], overlays = [], commands = [], jobs = [], notices = [], zoom = 1.1;
const theme = new Proxy({ foreground: "#f4f4f6", dim: "#77777f", border: "#2a2a30", hover: "#202024", input: "#3a3a40" }, { get: (t, k) => t[k] ?? "#a9a9b4" });
// Text fields, in the order the editor makes them.
const fields = [];
const env = {
  checking: () => false,
  View: class {}, div: () => element(), h_flex: () => element("h"), v_flex: () => element("v"),
  svg: (source) => element("svg", source), image: source => element("image", source), Input: { new: () => element("input") }, Popup: { new: (id, trigger) => element("popup").id(id).child(trigger) },
  InputState: { new: ({ value = "" }) => { const f = { text: value, on() {}, value: () => f.text, set_value: value => { f.text = value; }, focus() {} }; fields.push(f); return f; } },
  theme: () => theme, settings: () => ({ zoom }), home: () => "/home/me", keys: () => [], window: () => ({ platform: "macos" }),
  shared: (key) => state[key], setShared: (key, value) => { state[key] = value; },
  run: (name, args) => calls.push([name, plain(args)]), notify: (notice) => notices.push(notice),
  openOverlay: (spec) => overlays.push(spec), closeOverlay() {},
  focused: () => ({ tab: "b", cwd: "/repo" }), panes: () => [], spaces: () => [{ active: true, folder: "/space" }], agents: () => [], terminals: () => [], layout: () => ({}),
  nextCommand: () => commands.length ? Promise.resolve(commands.shift()) : new Promise(() => {}),
  // project.js stays out of the bundle (its tint() is button.js's name); Clean up only places its mark.
  projectMark: () => element("mark"),
};
const source = ["color.js", "button.js", "store.js", "tip.js", "measured-text.js", "focus.js", "trigger.js", "list.js", "menu-row.js", "open-in.js", "terminal-context.js", "surfaces.js", "panel.js", "submenu.js", "popup-menu.js", "titlebar.js", "review-git.js", "review-menu.js", "review-scope.js", "details-popup.js", "actions.js", "workspace-details.js", "review-details.js", "program.js", "tree.js", "dialog.js", "clean-up.js", "main.js"].map(file => fs.readFileSync(path.join(__dirname, file), "utf8")).join("\n").replace("const DISABLED = 0.64;", "const DISABLED = 0.64;\nconst drawButton = button;")
  .replace(/^import .*;\r?\n/gm, "").replace("export default class", "globalThis.Mod = class").replace(/^export (?=(?:async\s+)?function\b|const\b|class\b)/gm, "");
let held = null;
const cx = { notify() {}, stop_propagation() {}, spawn: (fn) => jobs.push(fn), focus_handle: () => { const h = { focus() { held = h; }, is_focused: () => held === h }; return h; }, timer: { every: () => ({ cancel() {} }), after: (_ms, f) => (f(cx), { cancel() {} }) } };
const load = (props = {}) => {
  const context = vm.createContext({ ...env, props: () => props });
  vm.runInContext(source, context, { filename: "main.js" });
  const mod = new context.Mod();
  mod.init?.(props, cx);
  mod.testScope = context;
  return mod;
};

// Every icon it names is on disk.
for (const name of JSON.parse(/const ICONS = (\[[^\]]+\])/.exec(source)[1])) assert.ok(fs.existsSync(path.join(__dirname, "icons", `action-${name}.svg`)), `icon on disk: ${name}`);

// Home has no project to run them in; the same bar elsewhere shows them.
state["t3-tabs.home"] = "home";
env.spaces = () => [{ id: "home", active: true }];
assert.equal(find(load({ block: "actions" }).render(), "actions-fit"), null);
env.spaces = () => [{ id: "home" }, { id: "s", active: true, folder: "/space" }];
assert.ok(find(load({ block: "actions" }).render(), "actions-fit"));
env.spaces = () => [{ active: true, folder: "/space" }];
delete state["t3-tabs.home"];

// None yet: "Add action", outlined, brightening with its icon on hover; it opens the editor.
const bar = load({ block: "actions" });
assert.ok(find(bar.render(), "action-add").style.border, "outlined, as a control on its own in any bar");
assert.equal(find(bar.render(), "action-add").hoverStyle.bg, theme.foreground + "0a", "hovered, the bar's 4%, as the split's halves");
assert.equal(find(bar.render(), "tip-action-add"), null, "visible Add action text needs no repeated tooltip");
assert.equal(find(bar.render(), "action-add").style.text_color, theme.dim);
fire(find(bar.render(), "action-add"), "on_hover", true, cx);
assert.equal(find(bar.render(), "action-add").style.text_color, theme.foreground, "its icon brightens with its text");
fire(find(bar.render(), "action-add"), "on_click", {}, cx);
assert.deepEqual(plain(overlays.at(-1)), { mod: "t3-actions", kind: "dialog", frame: "none", width: 512, props: { actions: "edit", id: null } }, "as T3's dialog, as tall as its fields");

// Some: "▶ Dev | ▾", shared/button.js's xs split: one `input` outline, a rule between, each half lit on its own.
state["t3-actions.actions"] = { list: [{ id: "a", name: "Dev", command: "bun dev" }, { id: "b", name: "Test", command: "bun test", place: "right", cwd: "~/x" }] };
const control = find(bar.render(), "actions");
assert.equal(control.style.border_color, theme.input, "the split's outline, not one of the bar's own");
assert.deepEqual(control.items.map(n => typeof n.key === "string" ? n.key : n.kind), ["action-run", "actions-rule", "action-more"]);
fire(find(control, "action-more"), "on_hover", true, cx);
assert.equal(find(bar.render(), "action-more").style.bg, theme.foreground + "0a", "the half under the pointer, chrome's 4%");
assert.equal(find(bar.render(), "action-run").style.bg, undefined, "the other half stays clear");
fire(find(bar.render(), "action-more"), "on_hover", false, cx);
assert.equal(find(control, "tip-action-more"), null, "a split arrow keeps its accessible label, not a tooltip");
fire(find(control, "text-name-action-run"), "on_size_change", { width: 140 * zoom }, cx);
fire(find(control, "text-measure-action-run"), "on_size_change", { width: 120 * zoom }, cx);
assert.equal(find(bar.render(), "tip-action-run"), null, "the actually fitting name is not repeated");
fire(find(control, "text-measure-action-run"), "on_size_change", { width: 200 * zoom }, cx);
assert.ok(find(bar.render(), "tip-action-run"), "the actually clipped name has its full Run label");
assert.equal(find(bar.render(), "tip-action-run").style.anchor, "top_center");
assert.deepEqual(strings(find(control, "text-name-action-run")), ["Dev"]);
fire(find(control, "action-run"), "on_click");
assert.deepEqual(calls.at(-1), ["terminal.open", { argv: ["sh", "-c", "bun dev"], name: "Dev", place: "tab", folder: "/repo" }]);
// The menu hangs 4 under the control, right edges together (its outline 1 past ▾), as T3's (align end) and the layout's
// other menus from a right-side button; with no press (assistive tech), at the pointer.
fire(find(bar.render(), "action-more"), "on_click", {}, cx);
assert.equal(overlays.at(-1).at, undefined);
fire(find(bar.render(), "action-more"), "on_mouse_down:left", { position: { x: 1000, y: 20 }, bounds: { x: 990 * zoom, y: 9 * zoom, width: 23 * zoom, height: 22 * zoom } }, cx);
fire(find(bar.render(), "action-more"), "on_click", {}, cx);
const hung = plain(overlays.at(-1).at);
assert.deepEqual([hung.x / zoom, hung.y / zoom].map(v => Math.round(v * 1000) / 1000), [990 + 23 + 1 - 220, 9 + 22 + 1 + 4], "right edges together, 4 under the outline");
assert.equal(overlays.at(-1).mod, "t3-actions");
assert.equal(overlays.at(-1).width, 220, "as wide as the layout's other menus (t3-menu's, T3's)");
// The button toggles: the press closed the open menu on its way in, so its click doesn't open another.
{
  const open = load({ actions: "menu" }), count = overlays.length;
  fire(find(bar.render(), "action-more"), "on_mouse_down:left", { position: { x: 1000, y: 20 } }, cx);
  open.close();
  fire(find(bar.render(), "action-more"), "on_click", {}, cx);
  assert.equal(overlays.length, count, "closed by its own button");
  fire(find(bar.render(), "action-more"), "on_click", {}, cx);
  assert.equal(overlays.length, count + 1, "the keyboard's click has no press: it opens");
  delete state["t3-actions.menuClosed"];
  load({ actions: "edit" }).close();
  assert.equal(state["t3-actions.menuClosed"], undefined, "the editor isn't the menu");
}

// The menu: a row runs its action and makes it the one ▶ runs; a gear edits it, shown only on the row lit, as T3's; no rule.
const menu = load({ actions: "menu" });
assert.ok(!find(menu.render(), "edit-a") && !find(menu.render(), "actions-menu").items.some(n => n?.style?.h === 1), "at rest no Edit, no rule over Add action");
fire(find(menu.render(), "action-b"), "on_click");
assert.deepEqual(calls.at(-1), ["terminal.open", { argv: ["sh", "-c", "bun test"], name: "Test", place: "right", folder: "/home/me/x" }]);
assert.deepEqual(strings(find(bar.render(), "action-run")), ["Test"]);
fire(find(menu.render(), "action-a"), "on_hover", true, cx);
fire(find(menu.render(), "edit-a"), "on_click", {}, cx);
assert.deepEqual(plain(overlays.at(-1).props), { actions: "edit", id: "a" });

// Past the rows that show, ↑/↓ keep the highlight in view; Add action stays outside the list.
{
  const saved = state["t3-actions.actions"];
  state["t3-actions.actions"] = { ...saved, list: Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, name: `N${i}`, command: "x", icon: "play" })) };
  const long = load({ actions: "menu" }), press = (k) => fire(find(long.render(), "actions-menu"), "on_key_down", { key: k }, cx);
  assert.equal(find(long.render(), "actions-list").style.h, 420 - 36, "the list sets its own height: a popup's is only a maximum, and a flexed list would have none");
  assert.ok(!find(long.render(), "action-n20"), "only the rows in view are drawn");
  for (let i = 0; i < 26; i++) press("down");
  assert.ok(find(long.render(), "action-n25"), "the highlight's row is");
  for (let i = 0; i < 5; i++) press("down");
  assert.ok(find(long.render(), "action-new") && find(long.render(), "action-n29"), "Add action lit, the list stays where it was");
  state["t3-actions.actions"] = saved;
}

// The editor saves an edit in place, and a new one at the end.
fields.length = 0;
const edit = load({ actions: "edit", id: "a" });
assert.equal(edit.render().style.opacity, undefined, "its contents are there from the first frame");
assert.equal(find(edit.render(), "action-delete").style.bg, theme.raised);
assert.equal(find(edit.render(), "action-close").hoverStyle.bg, theme.foreground + "12", "a dialog's ghost uses a card tint");
fields[1].text = "bun run dev";
fire(find(edit.render(), "action-save"), "on_click");
assert.equal(state["t3-actions.actions"].list[0].command, "bun run dev");
fields.length = 0;
const add = load({ actions: "edit", id: null });
const disabledSave = find(add.render(), "action-save");
assert.equal(disabledSave.handlers.on_click, undefined, "disabled Save has no click");
assert.equal(state["t3-actions.actions"].list.length, 2, "no name or command, nothing saved");
fields[0].text = "Lint"; fields[1].text = "bun lint";
fire(find(add.render(), "action-save"), "on_click");
assert.deepEqual(plain(state["t3-actions.actions"].list.map(a => a.name)), ["Dev", "Test", "Lint"]);

// It sizes its block to the control, in logical pixels, once per change; without a block it leaves the layout alone.
calls.length = 0;
const fit = find(bar.render(), "actions-fit");
assert.equal(fit.style.pr, 8, "its own gap to what follows it");
fire(fit, "on_size_change", { width: 110 });
fire(fit, "on_size_change", { width: 110 });
assert.deepEqual(calls, [["layout.resize", { id: "actions", px: 100 }]]);
fire(find(load().render(), "actions-fit"), "on_size_change", { width: 220 });
assert.equal(calls.length, 1);
assert.ok([bar.render(), find(bar.render(), "actions"), find(bar.render(), "action-run")].every(n => !n.style.bg), "no fill at rest: the bar's own background shows");

// In a narrow bar the icon stands alone; the hover label and the accessibility label keep the name.
state["t3-tabs.compact"] = true;
assert.deepEqual(strings(find(bar.render(), "action-run")), []);
assert.equal(find(bar.render(), "action-run").style.accessibility_label, "Run Test");
assert.ok(find(bar.render(), "action-more"), "the menu stays");
const added = state["t3-actions.actions"];
state["t3-actions.actions"] = { list: [] };
assert.deepEqual(strings(find(bar.render(), "action-add")), []);
assert.equal(find(bar.render(), "action-add").style.accessibility_label, "Add action");
state["t3-actions.actions"] = added;
delete state["t3-tabs.compact"];

(async () => {
  // What opens over its button drops its hover: nothing reports the leaving until the pointer moves.
  state["t3-actions.actions"] = { list: [{ id: "a1", name: "Dev", command: "x" }, { id: "a2", name: "Test", command: "y" }] };
  const view = load();
  fire(find(view.render(), "action-more"), "on_hover", true, cx);
  fire(find(view.render(), "action-more"), "on_click", {}, cx);
  assert.equal(view.hot, null, "the menu's button doesn't stay lit");
  fire(find(view.render(), "action-more"), "on_hover", true, cx);
  assert.equal(find(view.render(), "tip-action-more"), null, "hover does not restore the removed split-arrow tooltip");

  // The menu goes by arrows and Enter.
  const selected = (n) => find(n.render(), "action-a1").style.bg === theme.selected;
  const menu = load({ actions: "menu" }), key = (k) => fire(find(menu.render(), "actions-menu"), "on_key_down", { key: k }, cx);
  assert.ok(!selected(menu) && find(menu.render(), "action-new").style.bg !== theme.selected, "as T3's, nothing lit until a key or the pointer gets there");
  overlays.length = 0; calls.length = 0;
  key("enter");
  assert.equal(overlays.length + calls.length, 0, "so Enter runs nothing");
  // The pointer lights the row it's on, and leaving it puts the light out, as the Snooze menu's.
  fire(find(menu.render(), "action-a1"), "on_hover", true, cx);
  assert.ok(selected(menu));
  fire(find(menu.render(), "action-a1"), "on_hover", false, cx);
  assert.ok(!selected(menu), "leaving the row clears it");
  key("up");
  assert.equal(find(menu.render(), "action-new").style.bg, theme.selected, "up wraps to the last row");
  overlays.length = 0;
  key("enter");
  assert.equal(overlays.pop().props.actions, "edit");

  // Delete asks; only the dialog's answer, split as the app splits it, deletes. Only the bar's copy hears it.
  jobs.length = 0;
  load();
  const heard = jobs.length;
  const edit = load({ actions: "edit", id: "a1" });
  assert.equal(jobs.length, heard, "an overlay's copy doesn't listen");
  fire(find(edit.render(), "action-delete"), "on_click", {}, cx);
  const { mod, props } = overlays.pop();
  assert.deepEqual([mod, props.actions, props.title, props.yes], ["t3-actions", "confirm", "Delete Dev?", "Delete"]);
  assert.equal(state["t3-actions.actions"].list.length, 2, "the click only asks");
  const dot = props.command.name.indexOf(".");
  assert.equal(props.command.name.slice(0, dot), "t3-actions");
  commands.push(props.command.name.slice(dot + 1));
  jobs[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(plain(state["t3-actions.actions"].list.map((a) => a.id)), ["a2"]);

  // Clean up, as Inbox: Settled and Idle shells shelves folded to their counts, then a Left behind shelf of cards; quiet until hovered, the reason last.
  {
    const panesWere = env.panes, spacesWere = env.spaces, agentsWere = env.agents, termsWere = env.terminals;
    const piProg = { key: "pi", name: "Pi", agent: true, tint: true, icon: "icons/pi.svg" };
    let live = [
      { pane: "p-agent", tab: "t-h1", terminal: "t-ag" },
      { pane: "p-dev", tab: "t-h2", terminal: "t-dev" },
      { pane: "p-zsh", tab: "t-p", terminal: "t-z" },
      { pane: "p-sh", tab: "t-a", terminal: "t-sh" },
    ];
    let liveAgents = [{ address: "t-ag", status: "idle", tab: "t-h1" }];
    let liveTerms = [{ address: "t-ag", state: "live", status: "idle", turn: 2, labels: { settled: "1:2" } }];
    env.panes = () => live;
    env.agents = () => liveAgents;
    env.terminals = () => liveTerms;
    env.spaces = () => [
      { id: "s-h", name: "herdling", tabs: [{ id: "t-h1" }, { id: "t-h2" }] },
      { id: "s-p", name: "pulls.review", tabs: [{ id: "t-p" }] },
      { id: "s-a", name: "api", tabs: [{ id: "t-a" }] },
    ];
    const open = (p) => load({ actions: "clean-up", overlay: "cu-main", command: { name: "t3-tabs.cleanup-now:1" },
      settled: [
        { pane: "p-agent", terminal: "t-ag", name: "Notarize release build", space: "herdling", spaceId: "s-h", machine: null, program: piProg },
      ],
      shells: [
        { pane: "p-zsh", terminal: "t-z", name: "zsh", space: "pulls.review", spaceId: "s-p", machine: null, program: null },
      ],
      cards: [
        { pane: "p-dev", name: "Dev server", space: "herdling", spaceId: "s-h", machine: null, process: "node", program: null },
        { pane: "p-sh", name: "lazygit", space: "api", spaceId: "s-a", machine: "vps", process: "lazygit", program: null },
        { pane: "p-gone", name: "Old", space: "api", spaceId: "s-a", machine: null, process: "vite", program: null },
      ], ...p });
    let view = open();
    const closedOverlays = [];
    view.testScope.closeOverlay = (id) => closedOverlays.push(id);
    let tree = view.render();
    assert.ok(strings(tree).includes("Clean up"), "the title is the act; counts are the shelves'");
    assert.ok(!strings(tree).some((w) => /idle terminals?\?/.test(w)), "no title repeating the shelf");
    const settledShelf = find(tree, "clean-up-settled");
    const shellsShelf = find(tree, "clean-up-shells");
    assert.ok(["Settled", "1"].every((w) => strings(settledShelf).includes(w)), "Settled shelf with count");
    assert.ok(["Idle shells", "1", "closes pulls.review"].every((w) => strings(shellsShelf).includes(w)), "Idle shells shelf, its count and the spaces it closes");
    assert.equal(find(tree, "clean-up-settled-p-agent"), null, "Settled folded until opened");
    assert.equal(find(tree, "clean-up-shell-p-zsh"), null, "Idle shells folded until opened");
    // Both shelves non-empty: per-shelf Close buttons shown in one 54px column, footer says "Close all 2".
    const closeSettledBtn = find(tree, "clean-up-close-settled");
    const closeShellsBtn = find(tree, "clean-up-close-shells");
    assert.ok(closeSettledBtn && strings(closeSettledBtn).includes("Close"), "per-shelf Close on Settled when both shelves exist");
    assert.equal(closeSettledBtn.style.accessibility_label, "Close 1 settled agent");
    assert.equal(closeSettledBtn.style.w, 54, "Settled shelf Close uses fixed 54px width");
    assert.ok(closeShellsBtn && strings(closeShellsBtn).includes("Close"), "per-shelf Close on Idle shells when both shelves exist");
    assert.equal(closeShellsBtn.style.accessibility_label, "Close 1 idle shell");
    assert.equal(closeShellsBtn.style.w, 54, "Idle shells shelf Close uses fixed 54px width");
    assert.ok(strings(find(tree, "clean-up-yes")).includes("Close all 2"), "footer says Close all when both shelves exist");
    // Both per-shelf Close buttons run immediately on first click without closing Clean up or toggling fold.
    let ran = calls.length;
    let stopped = 0;
    const stopCx = { ...cx, stop_propagation: () => { stopped++; } };
    fire(closeSettledBtn, "on_click", {}, stopCx);
    assert.equal(view.armed, undefined, "Clean up has no arming state");
    assert.deepEqual(calls.slice(ran), [["t3-tabs.cleanup-now:1:settled", {}]], "first click on Settled shelf Close runs scoped command immediately");
    assert.equal(closedOverlays.length, 0, "Settled shelf Close keeps Clean up open");
    assert.equal(stopped, 1, "Settled shelf Close stops propagation on click");
    assert.deepEqual([view.openSettled, view.openShells], [false, false], "Settled shelf Close does not toggle shelf fold");
    ran = calls.length;
    fire(find(view.render(), "clean-up-close-shells"), "on_click", {}, stopCx);
    assert.deepEqual(calls.slice(ran), [["t3-tabs.cleanup-now:1:shells", {}]], "Idle shells shelf Close runs immediately on first click");
    assert.equal(closedOverlays.length, 0, "Idle shells shelf Close keeps Clean up open");
    assert.deepEqual([view.openSettled, view.openShells], [false, false], "per-shelf Close does not toggle shelf fold");

    // Expand both shelves and inspect slim rows: fixed columns [mark, icon, name, meta, Close] never shift on hover.
    const shapeOf = (el) => el.items.map((n) => (typeof n === "string" ? "text" : `${n.kind}:${n.key ?? ""}`));
    fire(settledShelf, "on_click", {}, cx);
    fire(shellsShelf, "on_click", {}, cx);
    tree = view.render();
    const settledRow = find(tree, "clean-up-settled-p-agent");
    const shellRow = find(tree, "clean-up-shell-p-zsh");
    assert.ok(["Notarize release build", "herdling", "Close"].every((w) => strings(settledRow).includes(w)), "opened settled row shows name, space and Close at rest");
    assert.equal(settledRow.items[0].items[0].kind, "mark", "column 1 is space mark");
    assert.ok(settledRow.items[1].items.some((c) => c?.kind === "svg" && c.source === "icons/pi.svg"), "column 2 is agent program icon right after space mark");
    assert.deepEqual(strings(settledRow.items[2]), ["Notarize release build"], "column 3 is pane name");
    assert.deepEqual(strings(settledRow.items[3]), ["herdling"], "column 4 is space metadata");
    assert.equal(settledRow.items[4].key, "clean-up-close-pane-p-agent", "column 5 is always-visible Close button");
    assert.equal(settledRow.items[4].style.accessibility_label, "Close Notarize release build");
    assert.equal(settledRow.items[4].style.text_color, theme.dim, "row Close is quiet dim at rest");
    assert.equal(settledRow.items[4].style.w, 54, "Settled row Close uses fixed 54px width");
    assert.ok(["zsh", "pulls.review", "Close"].every((w) => strings(shellRow).includes(w)), "opened shell row shows name, space and Close at rest");
    assert.ok(shellRow.items[1].items.some((c) => c?.kind === "svg" && c.source === "mods/t3-actions/icons/terminal.svg"), "shell row column 2 is terminal icon");
    assert.equal(shellRow.items[4].key, "clean-up-close-pane-p-zsh", "shell row column 5 is always-visible Close button");
    assert.equal(shellRow.items[4].style.w, 54, "Idle shells row Close uses fixed 54px width");

    // Per-row hover keeps identical child structure (zero reflow) and tracks overRow separately from hot; every row Close and Ctrl+D executes immediately.
    const restRowShape = shapeOf(settledRow);
    const restRowStrings = strings(settledRow);
    assert.equal(settledRow.style.bg, undefined, "row has no fill at rest");
    fire(settledRow, "on_hover", true, cx);
    tree = view.render();
    const litSettledRow = find(tree, "clean-up-settled-p-agent");
    const rowCloseBtn = find(tree, "clean-up-close-pane-p-agent");
    assert.equal(litSettledRow.style.bg, theme.foreground + "12", "hover lights row fill");
    assert.deepEqual(shapeOf(litSettledRow), restRowShape, "hovering row never adds, removes or reorders children");
    assert.deepEqual(strings(litSettledRow), restRowStrings, "hovering row keeps space metadata visible alongside Close");
    assert.equal(rowCloseBtn.style.text_color, theme.dim, "row hover alone keeps Close dim");
    fire(rowCloseBtn, "on_hover", true, cx);
    tree = view.render();
    assert.equal(view.hot, "clean-up-close-pane-p-agent");
    assert.equal(find(tree, "clean-up-close-pane-p-agent").style.text_color, theme.foreground, "hovering Close brightens it");
    assert.deepEqual(shapeOf(find(tree, "clean-up-settled-p-agent")), restRowShape, "hovering Close never changes row structure");
    fire(rowCloseBtn, "on_hover", false, cx);
    tree = view.render();
    assert.equal(view.hot, null, "leaving Close clears button hot");
    assert.equal(find(tree, "clean-up-settled-p-agent").style.bg, theme.foreground + "12", "row stays lit while pointer is still on row");
    assert.equal(find(tree, "clean-up-close-pane-p-agent").style.text_color, theme.dim, "leaving Close dims it back");
    ran = calls.length;
    fire(find(tree, "clean-up-close-pane-p-agent"), "on_click", {}, stopCx);
    assert.deepEqual(calls.slice(ran), [["t3-tabs.cleanup-now:1:pane:p-agent", {}]], "first click on Settled row Close runs single-pane cleanup immediately");
    assert.equal(closedOverlays.length, 0, "row Close keeps Clean up open");
    ran = calls.length;
    fire(find(view.render(), "clean-up-close-pane-p-zsh"), "on_click", {}, stopCx);
    assert.deepEqual(calls.slice(ran), [["t3-tabs.cleanup-now:1:pane:p-zsh", {}]], "Idle shells row Close runs immediately on first click");
    // Ctrl+D on lit Settled or Idle shells row closes immediately on first press.
    tree = view.render();
    ran = calls.length;
    fire(find(tree, "action-clean-up"), "on_key_down", { key: "d", modifiers: { control: true } }, cx);
    assert.deepEqual(calls.slice(ran), [["t3-tabs.cleanup-now:1:pane:p-agent", {}]], "first Ctrl+D closes lit Settled row immediately");
    fire(find(view.render(), "clean-up-settled-p-agent"), "on_hover", false, cx);
    fire(find(view.render(), "clean-up-shell-p-zsh"), "on_hover", true, cx);
    ran = calls.length;
    fire(find(view.render(), "action-clean-up"), "on_key_down", { key: "d", modifiers: { control: true } }, cx);
    assert.deepEqual(calls.slice(ran), [["t3-tabs.cleanup-now:1:pane:p-zsh", {}]], "Ctrl+D closes lit Idle shells row immediately");
    // Folding a shelf prevents Ctrl+D from targeting a hidden row.
    fire(find(view.render(), "clean-up-shells"), "on_click", {}, cx);
    ran = calls.length;
    fire(find(view.render(), "action-clean-up"), "on_key_down", { key: "d", modifiers: { control: true } }, cx);
    assert.deepEqual(calls.slice(ran), [], "Ctrl+D ignores rows in a folded shelf");
    view.overRow = null;
    fire(find(view.render(), "clean-up-shells"), "on_click", {}, cx);
    tree = view.render();

    // A draw reads panes() and spaces() once, not again for each row's mark: each read copies the whole list.
    {
      const listPanes = env.panes, listSpaces = env.spaces, reads = { panes: 0, spaces: 0 };
      view.testScope.panes = () => { reads.panes++; return listPanes(); };
      view.testScope.spaces = () => { reads.spaces++; return listSpaces(); };
      view.render();
      assert.deepEqual(reads, { panes: 1, spaces: 1 });
      view.testScope.panes = listPanes; view.testScope.spaces = listSpaces;
    }
    assert.ok(["Left behind", "2", "no agent at work"].every((w) => strings(find(tree, "clean-up-left")).includes(w)), "Left behind counts the live cards and says why");
    const card = find(tree, "clean-up-card-p-dev");
    assert.ok(["Dev server", "herdling", "node", "Stop"].every((w) => strings(card).includes(w)), "a card: its space, process, Stop and name at rest");
    assert.equal(card.style.border, undefined, "quiet at rest: no outline, only a faint fill");
    const same = open({ cards: [{ pane: "p-dev", name: "sleep", space: "herdling", spaceId: "s-h", machine: null, process: "sleep", program: null }] }).render();
    assert.equal(strings(find(same, "clean-up-card-p-dev")).filter((w) => w === "sleep").length, 1, "a process its name already says isn't said twice");
    assert.ok(["vps", "api"].every((w) => strings(find(tree, "clean-up-card-p-sh")).includes(w)), "a remote one names its machine");
    assert.equal(find(tree, "clean-up-card-p-gone"), null, "a pane that's gone leaves Clean up");
    const restStopBtn = find(tree, "clean-up-stop-p-dev");
    assert.ok(restStopBtn && strings(restStopBtn).includes("Stop"), "Stop is rendered at rest alongside process");
    assert.equal(restStopBtn.style.accessibility_label, "Stop Dev server");
    assert.equal(restStopBtn.style.text_color, theme.dim, "Stop is quiet dim at rest");
    assert.equal(restStopBtn.style.w, 54, "Left behind Stop uses fixed 54px width");
    const restCardShapes = card.items.map(shapeOf);
    const restCardStrings = strings(card);
    view.hot = "clean-up-card-p-dev";
    tree = view.render();
    const litCard = find(tree, "clean-up-card-p-dev");
    const stopButton = find(tree, "clean-up-stop-p-dev");
    assert.ok(strings(stopButton).includes("Stop"), "a word, not the ×s that ask first elsewhere");
    assert.deepEqual(litCard.items.map(shapeOf), restCardShapes, "hovering card never adds, removes or reorders children");
    assert.deepEqual(strings(litCard), restCardStrings, "hovering card keeps process visible alongside Stop");
    // Left behind Stop executes immediately on first click without going there.
    ran = calls.length;
    fire(stopButton, "on_click", {}, cx);
    assert.deepEqual(calls.slice(ran), [["t3-tabs.stop-pane:p-dev", {}]], "first click on Stop runs stop-pane immediately and doesn't go there");
    assert.equal(closedOverlays.length, 0, "Stop keeps Clean up open");
    // Ctrl+D on lit Left behind card stops immediately on first press; with none lit, nothing.
    ran = calls.length;
    fire(find(view.render(), "action-clean-up"), "on_key_down", { key: "d", modifiers: { control: true } }, cx);
    view.hot = null;
    fire(find(view.render(), "action-clean-up"), "on_key_down", { key: "d", modifiers: { control: true } }, cx);
    assert.deepEqual(calls.slice(ran), [["t3-tabs.stop-pane:p-dev", {}]], "first Ctrl+D stops the lit card, and only that");
    // Counts follow what's live: Dev server gone, herdling goes whole on Settled; zsh gone -> only Settled remains, its shelf Close stays, footer says "Close 1".
    live = live.filter((x) => x.pane !== "p-dev");
    tree = view.render();
    assert.ok(strings(find(tree, "clean-up-settled")).includes("closes herdling"), "a space emptied since it opened closes on its shelf");
    assert.ok(!strings(find(tree, "clean-up-note")).some((w) => w.startsWith("Closes ")), "note doesn't repeat spaces already named on individual shelves");
    live = live.filter((x) => x.pane !== "p-zsh");
    tree = view.render();
    assert.equal(find(tree, "clean-up-shells"), null, "empty Idle shells shelf disappears");
    assert.ok(find(tree, "clean-up-close-settled"), "Settled shelf Close stays present even when only Settled remains");
    assert.ok(["1", "closes herdling", "Close"].every((w) => strings(find(tree, "clean-up-settled")).includes(w)), "the count, closes note and Close button stay on the remaining shelf");
    assert.ok(strings(find(tree, "clean-up-yes")).includes("Close 1"), "single shelf uses Close <n> instead of Close all <n>");

    // Combined closing-spaces summary: when a space holds both a settled agent and an idle shell, only closing both empties it -> named in clean-up-note.
    {
      const savedPanes = env.panes, savedSpaces = env.spaces;
      env.panes = () => [
        { pane: "p-agent", tab: "t-m1", terminal: "t-ag" },
        { pane: "p-zsh", tab: "t-m2", terminal: "t-z" },
        { pane: "p-only-sh", tab: "t-o1", terminal: "t-osh" },
      ];
      env.spaces = () => [
        { id: "s-mix", name: "mixed", tabs: [{ id: "t-m1" }, { id: "t-m2" }] },
        { id: "s-only", name: "shells-only", tabs: [{ id: "t-o1" }] },
      ];
      const mixView = open({
        settled: [{ pane: "p-agent", terminal: "t-ag", name: "Agent", space: "mixed", spaceId: "s-mix", machine: null, program: piProg }],
        shells: [
          { pane: "p-zsh", terminal: "t-z", name: "zsh", space: "mixed", spaceId: "s-mix", machine: null, program: null },
          { pane: "p-only-sh", terminal: "t-osh", name: "zsh", space: "shells-only", spaceId: "s-only", machine: null, program: null },
        ],
        cards: [],
      });
      const mixTree = mixView.render();
      assert.ok(!strings(find(mixTree, "clean-up-settled")).some((w) => w.startsWith("closes")), "Settled alone doesn't empty mixed");
      assert.ok(strings(find(mixTree, "clean-up-shells")).includes("closes shells-only"), "Idle shells alone empties shells-only");
      assert.equal(find(mixTree, "clean-up-close-shells").style.accessibility_label, "Close 2 idle shells");
      assert.ok(strings(find(mixTree, "clean-up-note")).includes("Closes mixed and shells-only. Skips the tab you're on, and programs in the space you're in."),
        "combined closing spaces appear in clean-up-note when closing both empties additional spaces");
      env.panes = savedPanes; env.spaces = savedSpaces;
    }

    live = [
      { pane: "p-agent", tab: "t-h1", terminal: "t-ag" },
      { pane: "p-dev", tab: "t-h2", terminal: "t-dev" },
      { pane: "p-zsh", tab: "t-p", terminal: "t-z" },
      { pane: "p-sh", tab: "t-a", terminal: "t-sh" },
    ];
    tree = view.render();
    ran = calls.length;
    fire(find(tree, "clean-up-card-p-dev"), "on_click", {}, cx);
    fire(find(tree, "clean-up-settled-p-agent"), "on_click", {}, cx);
    assert.deepEqual(calls.slice(ran), [["t3-tabs.go-pane:p-dev", {}], ["t3-tabs.go-pane:p-agent", {}]], "a card or row goes there");
    const note = find(tree, "clean-up-note");
    assert.ok(strings(note).includes("Skips the tab you're on, and programs in the space you're in."), "both scopes, last");
    assert.equal(note.style.px, 24, "a line of its own, level with the title, not squeezed beside the buttons");
    assert.ok(!strings(find(tree, "clean-up-footer")).some((w) => w.startsWith("Skips")), "the footer holds only the buttons, as T3's alert");
    const yes = find(tree, "clean-up-yes");
    assert.ok(strings(yes).includes("Close all 2"));
    ran = calls.length;
    closedOverlays.length = 0;
    fire(yes, "on_click", {}, cx);
    fire(find(tree, "action-clean-up"), "on_key_down", { key: "escape" }, cx);
    assert.deepEqual(closedOverlays, ["cu-main", "cu-main"], "Close all and Esc close the dialog immediately");
    fire(find(tree, "action-clean-up"), "on_key_down", { key: "enter" }, cx);
    assert.deepEqual(calls.slice(ran), [["t3-tabs.cleanup-now:1", {}], ["t3-tabs.cleanup-now:1", {}]], "Close all and Enter empty it; Esc doesn't");
    // Only programs left behind: neither Settled nor Idle shells shelf, nothing to empty, the cards still there.
    tree = open({ settled: [], shells: [], command: null }).render();
    assert.deepEqual([find(tree, "clean-up-settled"), find(tree, "clean-up-shells"), find(tree, "clean-up-yes")], [null, null, null]);
    assert.ok(strings(find(tree, "clean-up-no")).includes("Done"));
    assert.ok(find(tree, "clean-up-card-p-dev"));

    // Live-filter settled & shell rows: newly focused tab, unsettled agent, busy sub-agent, exited agent, or replaced terminal drop immediately.
    {
      const focusedWere = env.focused;
      let focusNow = { tab: "b" };
      let livePanes = [
        { pane: "p-agent", tab: "t-h1", terminal: "t-ag" },
        { pane: "p-zsh", tab: "t-p", terminal: "t-z" },
        { pane: "p-dev", tab: "t-h2", terminal: "t-dev" },
      ];
      let ags = [{ address: "t-ag", status: "idle", tab: "t-h1" }];
      let terms = [{ address: "t-ag", state: "live", status: "idle", turn: 2, labels: { settled: "1:2" } }];
      env.panes = () => livePanes;
      env.agents = () => ags;
      env.terminals = () => terms;
      env.focused = () => focusNow;
      const v = open({
        overlay: "cu-live",
        settled: [{ pane: "p-agent", terminal: "t-ag", name: "Notarize", space: "herdling", spaceId: "s-h", machine: null, program: piProg }],
        shells: [{ pane: "p-zsh", terminal: "t-z", name: "zsh", space: "pulls.review", spaceId: "s-p", machine: "vps", program: null }],
        cards: [{ pane: "p-dev", name: "Dev server", space: "herdling", spaceId: "s-h", machine: null, process: "node", program: null }],
      });
      let tr = v.render(cx);
      assert.ok(strings(find(tr, "clean-up-settled")).includes("1") && strings(find(tr, "clean-up-shells")).includes("1"), "both shelves live while settled and unfocused");
      // Shelf head right-side note truncates right-aligned instead of overflowing with flex_none.
      const shellsItems = find(tr, "clean-up-shells").items;
      const side = shellsItems.find((el) => el?.items?.includes?.("closes pulls.review"));
      assert.deepEqual([Boolean(side.style.flex_1), side.style.min_w, Boolean(side.style.truncate), Boolean(side.style.text_right), side.style.flex_none],
        [true, 0, true, true, undefined], "closes note shrinks and truncates cleanly inside 512px");
      // Shell row shows remote machine + server.svg and caps space width before the fixed Close button.
      fire(find(tr, "clean-up-shells"), "on_click", {}, cx);
      tr = v.render(cx);
      const remoteRow = find(tr, "clean-up-shell-p-zsh");
      assert.ok(strings(remoteRow).includes("vps"), "shell row names its remote machine");
      const meta = remoteRow.items.at(-2);
      assert.equal(remoteRow.items.at(-1).key, "clean-up-close-pane-p-zsh", "shell row Close button sits fixed at the right end");
      assert.equal(meta.style.max_w, 180, "shell row metadata capped so space cannot crush name");
      assert.ok(meta.items.some((el) => el?.kind === "svg" && el.source === "mods/t3-actions/icons/server.svg"), "shell row draws server.svg for remote machine");
      assert.deepEqual([meta.items[0].style.min_w, Boolean(meta.items[0].style.truncate)], [0, true], "shell row space truncates");
      // Settled agent becomes working -> dropped from Settled immediately; Idle shells keeps its shelf Close button.
      ags = [{ address: "t-ag", status: "working", tab: "t-h1" }];
      tr = v.render(cx);
      assert.equal(find(tr, "clean-up-settled"), null, "unsettled agent drops from Settled");
      assert.ok(find(tr, "clean-up-close-shells"), "Idle shells shelf Close stays present even when only Idle shells remains");
      assert.ok(strings(find(tr, "clean-up-yes")).includes("Close 1"), "footer falls back to Close 1");
      // Agent back to settled, but its sub-agent becomes blocked -> still dropped.
      ags = [{ address: "t-ag", status: "idle", tab: "t-h1" }];
      terms = [
        { address: "t-ag", state: "live", status: "idle", turn: 2, labels: { settled: "1:2" } },
        { address: "t-kid", parent: "t-ag", state: "live", status: "blocked" },
      ];
      tr = v.render(cx);
      assert.equal(find(tr, "clean-up-settled"), null, "agent with busy sub-agent drops from Settled");
      // Agent removed from agents() -> dropped from Settled.
      ags = [];
      terms = [{ address: "t-ag", state: "live", status: "idle", turn: 2, labels: { settled: "1:2" } }];
      tr = v.render(cx);
      assert.equal(find(tr, "clean-up-settled"), null, "agent no longer in agents() drops from Settled");
      // Restore agent; shell's tab becomes focused -> shell drops from Idle shells.
      ags = [{ address: "t-ag", status: "idle", tab: "t-h1" }];
      focusNow = { tab: "t-p" };
      tr = v.render(cx);
      assert.ok(find(tr, "clean-up-settled") && !find(tr, "clean-up-shells"), "focused shell tab drops from Idle shells");
      // Terminal replaced in pane -> drops from Settled too.
      livePanes = [{ pane: "p-agent", tab: "t-h1", terminal: "t-new" }, { pane: "p-dev", tab: "t-h2", terminal: "t-dev" }];
      tr = v.render(cx);
      assert.equal(find(tr, "clean-up-settled"), null, "replaced terminal drops from Settled");
      env.focused = focusedWere;
    }

    // Card hover tracks view.overCard separately from Stop's view.hot: moving across card and Stop keeps card lit with zero structural change.
    {
      env.panes = () => live;
      env.agents = () => liveAgents;
      env.terminals = () => liveTerms;
      const v = open();
      let tr = v.render(cx);
      const restCard = find(tr, "clean-up-card-p-dev");
      const restShape = restCard.items.map(shapeOf);
      assert.ok(find(tr, "clean-up-stop-p-dev"), "Stop is already present at rest");
      assert.equal(restCard.style.bg, theme.foreground + "0a", "card has rest fill");
      fire(restCard, "on_hover", true, cx);
      tr = v.render(cx);
      assert.equal(find(tr, "clean-up-card-p-dev").style.bg, theme.foreground + "12", "entering card lights its fill");
      assert.deepEqual(find(tr, "clean-up-card-p-dev").items.map(shapeOf), restShape, "entering card keeps identical child structure");
      assert.ok(strings(find(tr, "clean-up-card-p-dev")).includes("node"), "entering card keeps process visible");
      fire(find(tr, "clean-up-stop-p-dev"), "on_hover", true, cx);
      tr = v.render(cx);
      assert.equal(v.hot, "clean-up-stop-p-dev");
      assert.equal(find(tr, "clean-up-stop-p-dev").style.text_color, theme.foreground, "hovering Stop brightens it");
      assert.equal(find(tr, "clean-up-card-p-dev").style.bg, theme.foreground + "12", "card stays lit while Stop is hovered");
      fire(find(tr, "clean-up-stop-p-dev"), "on_hover", false, cx);
      tr = v.render(cx);
      assert.equal(v.hot, null, "leaving Stop clears Stop's hot");
      assert.equal(find(tr, "clean-up-stop-p-dev").style.text_color, theme.dim, "leaving Stop dims it back");
      assert.equal(find(tr, "clean-up-card-p-dev").style.bg, theme.foreground + "12", "card stays lit while pointer is still on card");
      const before = calls.length;
      fire(find(tr, "action-clean-up"), "on_key_down", { key: "d", modifiers: { control: true } }, cx);
      assert.deepEqual(calls.slice(before), [["t3-tabs.stop-pane:p-dev", {}]], "Ctrl+D immediately targets the hovered card");
      fire(find(tr, "clean-up-card-p-dev"), "on_hover", false, cx);
      tr = v.render(cx);
      assert.equal(find(tr, "clean-up-card-p-dev").style.bg, theme.foreground + "0a", "leaving card restores rest fill");
      assert.ok(find(tr, "clean-up-stop-p-dev"), "leaving card keeps Stop rendered");
      assert.deepEqual(find(tr, "clean-up-card-p-dev").items.map(shapeOf), restShape, "leaving card keeps identical child structure");
    }

    // Auto-close when all items disappear (e.g. last Left behind card stopped): schedules closeOverlay once via cx.timer.after(0).
    {
      let remaining = [{ pane: "p-dev", tab: "t-h2" }];
      env.panes = () => remaining;
      const closed = [], scheduled = [];
      const deferCx = { ...cx, timer: { ...cx.timer, after: (ms, f) => { scheduled.push({ ms, f }); return { cancel() {} }; } } };
      const v = open({ overlay: "cu-auto", settled: [], shells: [], command: null, cards: [{ pane: "p-dev", name: "Dev server", space: "herdling", spaceId: "s-h", machine: null, process: "node", program: null }] });
      v.testScope.closeOverlay = (id) => closed.push(id);
      v.render(deferCx);
      assert.deepEqual([scheduled.length, closed.length], [0, 0], "stays open while an item remains");
      remaining = [];
      v.render(deferCx);
      v.render(deferCx);
      assert.equal(scheduled.length, 1, "schedules auto-close once");
      assert.equal(scheduled[0].ms, 0);
      assert.equal(closed.length, 0, "doesn't close synchronously during render");
      scheduled[0].f(deferCx);
      assert.deepEqual(closed, ["cu-auto"], "auto-closes the overlay");
    }

    // Enter when total === 0 closes the dialog (matching the sole Done button) and never runs a stale cleanup command.
    {
      env.panes = () => [{ pane: "p-dev", tab: "t-h2" }];
      const closed = [];
      const v = open({ overlay: "cu-enter", settled: [], shells: [{ pane: "p-gone-idle", name: "zsh", space: "api", spaceId: "s-a", machine: null, program: null }], command: { name: "t3-tabs.cleanup-now:9" },
        cards: [{ pane: "p-dev", name: "Dev server", space: "herdling", spaceId: "s-h", machine: null, process: "node", program: null }] });
      v.testScope.closeOverlay = (id) => closed.push(id);
      const tr = v.render(cx);
      const before = calls.length;
      fire(find(tr, "action-clean-up"), "on_key_down", { key: "enter" }, cx);
      assert.deepEqual([closed, calls.slice(before)], [["cu-enter"], []], "Enter closes when total === 0 and runs no command");
    }

    env.panes = panesWere; env.spaces = spacesWere; env.agents = agentsWere; env.terminals = termsWere;
  }

  // T3's alert dialog: its buttons run the command or only close, Enter runs it, Esc only closes.
  {
    const ask = (p) => load({ actions: "confirm", title: "Close?", detail: "It stops.", command: { name: "x.y", args: { a: 1 } }, ...p });
    let ran = calls.length;
    fire(find(ask().render(), "confirm-no"), "on_click", {}, cx);
    assert.equal(calls.length, ran, "Cancel runs nothing");
    // As the editor's Delete: the theme's red on the raised fill, no block of color; it says what it does. A bare footer, as the editor's.
    Object.assign(theme, { ansi1: "#f38ba8", raised: "#313244" });
    const yesButton = find(ask({ yes: "Close" }).render(), "confirm-yes");
    assert.deepEqual([yesButton.style.text_color, yesButton.style.bg, yesButton.items.at(-1)], ["#f38ba8", "#313244", "Close"]);
    assert.equal(find(ask().render(), "confirm-yes").items.at(-1), "Confirm", "with no word given, Confirm");
    assert.equal(find(ask().render(), "confirm-footer").style.border_t, undefined, "no rule over the buttons");
    delete theme.ansi1; delete theme.raised;
    fire(find(ask().render(), "confirm-yes"), "on_click", {}, cx);
    assert.deepEqual(calls.at(-1), ["x.y", { a: 1 }]);
    ran = calls.length;
    fire(find(ask().render(), "action-confirm"), "on_key_down", { key: "escape" }, cx);
    assert.equal(calls.length, ran, "Esc runs nothing");
    fire(find(ask().render(), "action-confirm"), "on_key_down", { key: "enter" }, cx);
    assert.deepEqual(calls.at(-1), ["x.y", { a: 1 }]);
    const copy = ask();
    delete state["t3-actions.menuClosed"];
    copy.close();
    assert.equal(state["t3-actions.menuClosed"], undefined, "the dialog isn't the menu");
  }

  {
  // Home, End, typing; Enter on a row's Edit is Edit's, not the row's; the bar's stops wait for keyboard mode.
  const menu = load({ actions: "menu" }), key = (e) => fire(find(menu.render(), "actions-menu"), "on_key_down", e, cx);
  key({ key: "end" });
  assert.equal(find(menu.render(), "action-new").style.bg, theme.selected);
  key({ key: "home" });
  assert.notEqual(find(menu.render(), "action-new").style.bg, theme.selected);
  key({ key: "a", key_char: "a", modifiers: {} });
  assert.equal(find(menu.render(), "action-new").style.bg, theme.selected, "typing finds Add action");
  assert.equal(find(menu.render(), "action-new").style.tab_index, undefined, "rows go by the arrows");
}
{
  // Details: what it does, not how it's drawn.
  const source = { space: "s", tab: "b", terminal: "t9", folder: "/captured", machine: null };
  const panelLayout = () => ({ id: "root", children: [{ id: "work" }, { id: "panel", children: [{ id: "panel-body", children: [{ id: "files" }, { id: "review" }, { id: "panel-empty" }] }] }] });
  env.panes = () => [{ terminal: "t9", tab: "b", cwd: "/captured" }];
  env.spaces = () => [{ id: "s", active: true, machine: null, folder: "/space", tabs: [{ id: "b", active: true }] }];
  env.focused = () => ({ space: "s", tab: "b", terminal: "t9", cwd: "/captured" });

  // The button opens it on what's in view; a second press, which closed it, doesn't open it again.
  const entry = load({ details: true }), press = () => fire(find(entry.render(), "details-toggle"), "on_mouse_down:left", { bounds: { x: 1000, y: 6, width: 28 * zoom, height: 28 * zoom } }, cx);
  press(); fire(find(entry.render(), "details-toggle"), "on_click", {}, cx);
  const opened = overlays.at(-1);
  assert.deepEqual([opened.props.actions, plain(opened.props.source)], ["details", { space: "s", tab: "b", terminal: "t9", machine: null, folder: "/captured" }], "the tab's terminal and the folder it works in");
  assert.ok(vm.runInContext("openedDetails()", entry.testScope), "its button shows it open");
  const count = overlays.length;
  press(); entry.testScope.layerClosed(vm.runInContext("openedDetails()", entry.testScope));
  fire(find(entry.render(), "details-toggle"), "on_click", {}, cx);
  assert.equal(overlays.length, count, "closed by its own button");
  assert.ok(!vm.runInContext("openedDetails()", entry.testScope));

  // Its height follows what it holds, 420 at most.
  state["t3-actions.actions"] = { list: [] };
  const details = load({ actions: "details", source, overlay: "details" });
  details.testScope.layout = panelLayout;
  fire(find(details.render(), "details-content"), "on_size_change", { width: 280 * zoom, height: 240 * zoom }, cx);
  assert.equal(find(details.render(), "workspace-details").style.h, 242);
  fire(find(details.render(), "details-content"), "on_size_change", { width: 280 * zoom, height: 2000 * zoom }, cx);
  assert.equal(find(details.render(), "workspace-details").style.h, 420);

  // Add action's editor keeps Details behind it; an action runs where Details was opened, and not once that's gone.
  const closed = []; details.testScope.closeOverlay = id => closed.push(id);
  fire(find(details.render(), "action-add"), "on_click", {}, cx);
  assert.deepEqual(closed, []); assert.equal(overlays.at(-1).props.details, "details");
  state["t3-actions.actions"] = { list: [{ id: "a", name: "Run captured", command: "pwd", place: "down" }] };
  calls.length = 0; fire(find(details.render(), "action-run"), "on_click");
  assert.deepEqual([calls.at(-1)[1].folder, calls.at(-1)[1].place, closed.length], ["/captured", "down", 0]);
  details.testScope.spaces = () => [{ id: "other", active: true, tabs: [] }]; calls.length = 0;
  fire(find(details.render(), "action-run"), "on_click"); assert.equal(calls.length, 0, "a stale source runs nothing");
  details.testScope.spaces = env.spaces;
  // A long action name is whole in a tooltip only when it's cut.
  state["t3-actions.actions"] = { list: [{ id: "a", name: "A deliberately long action name", command: "pwd" }] };
  fire(find(details.render(), "text-name-action-run"), "on_size_change", { width: 120 * zoom }, cx);
  fire(find(details.render(), "text-measure-action-run"), "on_size_change", { width: 100 * zoom }, cx);
  assert.equal(find(details.render(), "tip-action-run"), null);
  fire(find(details.render(), "text-measure-action-run"), "on_size_change", { width: 240 * zoom }, cx);
  assert.ok(find(details.render(), "tip-action-run"), "clipped: its whole name");

  // A row's menu is as wide as the row, right edges together, 4 under it.
  fire(find(details.render(), "details-open-more"), "on_mouse_down:left", { bounds: { x: 900, y: 100, width: 32 * zoom, height: 32 * zoom } }, cx);
  fire(find(details.render(), "details-open-more"), "on_click", {}, cx);
  const menu = overlays.at(-1);
  assert.deepEqual([menu.props.actions, menu.width, Math.round(menu.at.x * 100) / 100, Math.round(menu.at.y * 100) / 100], ["open-in", 262, Math.round((900 + 32 * zoom - 262 * zoom) * 100) / 100, Math.round((100 + 36 * zoom) * 100) / 100]);
  assert.equal(find(details.render(), "details-open-row").style.bg, theme.foreground + "1f", "its row stays on while it's open");
  // Details closing takes its menus with it; only Details watches the source.
  closed.length = 0;
  details.close();
  assert.deepEqual(closed, [overlays.length], "its open menu goes with it");
  assert.equal(find(details.render(), "details-open-row").style.bg, undefined);

  // Open in's menu only picks the app, and closes only itself.
  const picker = load({ actions: "open-in", source, targets: ["Finder", "Zed"], details: "parent", overlay: "picker" });
  const pickedExec = [], pickedClose = [];
  picker.testScope.exec = async (...args) => { pickedExec.push(args); return { code: 0 }; };
  picker.testScope.closeOverlay = id => pickedClose.push(id);
  fire(find(picker.render(), "open-in-menu"), "on_key_down", { key: "up" }, cx);
  fire(find(picker.render(), "open-in-menu"), "on_key_down", { key: "enter" }, cx);
  await Promise.resolve();
  assert.deepEqual([pickedExec.length, state["t3.openTarget"], pickedClose], [0, "Zed", ["picker"]]);
  // Open in opens there; an uninstalled app falls back to Finder for everyone.
  const opener = load({ actions: "details", source, overlay: "d2" }), ran = [];
  opener.targets = ["Finder", "Zed"];
  opener.testScope.exec = async (_cmd, args) => { ran.push([...args]); return { code: args.includes("-Ra") ? 1 : 0 }; };
  fire(find(opener.render(), "details-finder"), "on_click", {}, cx);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(ran, [["-Ra", "Zed"], ["--", "/captured"]]);
  assert.equal(state["t3.openTarget"], "Finder");

  // The machine row's Copy path copies and says no more, as Copy path in every other menu.
  {
    const copied = [], menu = load({ actions: "directory-menu", source, details: "details", overlay: "directory" });
    fire(find(menu.render(), "details-copy-directory"), "on_click", {}, { ...cx, write_to_clipboard: (text) => copied.push(text) });
    assert.deepEqual([copied, notices], [["/captured"], []]);
  }

  // What shows: only what's hidden is kept; Reset shows all; with nothing shown, a way back.
  state["t3-actions.detailsItems"] = { environment: false, openIn: false, scripts: false, review: false };
  assert.ok(find(details.render(), "details-choose-items") && !find(details.render(), "details-context"));
  const items = load({ actions: "details-items", source, details: "details" });
  fire(find(items.render(), "details-item-openIn"), "on_click", {}, cx);
  assert.equal(state["t3-actions.detailsItems"].openIn, undefined);
  fire(find(items.render(), "details-items-reset"), "on_click", {}, cx);
  assert.deepEqual(plain(state["t3-actions.detailsItems"]), {});

  // The Review row's end names the range a Review tab shows; a closed tab's isn't claimed.
  assert.equal(find(details.render(), "details-review-scope-slot"), null, "no Review shown: nothing named");
  state["t3.panels"] = { s: { tabs: [{ id: "review", born: 5 }], active: "review", open: true } };
  state["review.shown"] = { s: { root: "/captured", page: "/worktree", born: 5 } };
  assert.deepEqual(strings(find(details.render(), "details-review-scope-slot")), ["Uncommitted"]);
  state["review.shown"] = { s: { root: "/captured", page: "/commit/1a2b3c", label: "fix: keep", born: 4 } };
  assert.equal(find(details.render(), "details-review-scope-slot"), null, "a closed Review tab's range");
  // Its main half shows Review, asking for nothing: the tab shows what it shows, or its default.
  const asked = state.review; calls.length = 0;
  fire(find(details.render(), "details-review"), "on_click", {}, cx);
  assert.ok(calls.some(([name, a]) => name === "layout.select" && a.child === "review") && state.review === asked);
  // Its chevron: the range menu, under the row, as wide.
  fire(find(details.render(), "details-review-more"), "on_mouse_down:left", { bounds: { x: 900, y: 180, width: 32 * zoom, height: 32 * zoom } }, cx);
  fire(find(details.render(), "details-review-more"), "on_click", {}, cx);
  assert.deepEqual([overlays.at(-1).props.actions, overlays.at(-1).width], ["review-scope", 262]);
  delete state["t3-actions.menuClosed"];
}
{
  // The range menu: Review's rows, none checked before Review has shown one; a pick shows Review and asks it for that range.
  env.layout = () => ({ id: "root", children: [{ id: "work" }, { id: "panel", children: [{ id: "panel-body", children: [{ id: "files" }, { id: "review" }, { id: "panel-empty" }] }] }] });
  env.exec = async (_cmd, args) => args.includes("--show-toplevel") ? { code: 0, stdout: "/repo\n" } : { code: 0, stdout: "" };
  delete state["review.shown"]; delete state["t3.panels"];
  const source = { space: "s", tab: "b", terminal: "t9", folder: "/captured" };
  const open = async (shown) => {
    state["review.shown"] = shown;
    jobs.length = 0;
    const range = load({ actions: "review-scope", source, details: "parent", parents: ["parent"], overlay: "quick", at: { x: 600, y: 220 } });
    await jobs.shift()(cx);
    Object.assign(range.scope, { scopeGit: { root: "/repo", branch: "feature", base: "main", baseRef: "main", unmerged: 2, changed: 0 },
      picks: { commits: [{ sha: "abc123", subject: "fix: focused review", time: 1 }], unpushed: [] }, refs: [], scopeRoot: "/repo", scopeBase: null });
    return range;
  };
  const label = (range, id) => find(range.render(), id).style.accessibility_label;
  // Nothing read yet: Review's rows at once, their counts' places blank, no note while it reads; the keys already work.
  {
    jobs.length = 0;
    const first = load({ actions: "review-scope", source, details: "parent", parents: ["parent"], overlay: "q0", at: { x: 600, y: 220 } });
    assert.equal(find(first.render(), "details-range-note"), null, "no note while it reads");
    assert.ok(find(first.render(), "scope-changes") && find(first.render(), "scope-uncommitted"), "the rows' names at once");
    assert.notEqual(find(first.render(), "scope-uncommitted").style.opacity, 0.64, "not greyed as empty: not read yet");
    fire(find(first.render(), "details-range-menu"), "on_key_down", { key: "down", keystroke: "down" }, cx);
    assert.equal(first.scope.scopeAt, 0, "↓ works while it reads");
    first.close(); jobs.length = 0;
  }
  let range = await open(undefined);
  // Another popup of the mod's (Herdr runs them in one runtime): opened again on this space, the range menu reads where it
  // read last at once, and checks that behind it.
  const another = (scope, p) => { scope.props = () => p; const m = new scope.Mod(); m.init(p, cx); m.testScope = scope; return m; };
  {
    jobs.length = 0;
    const again = another(range.testScope, { actions: "review-scope", source, details: "parent", parents: ["parent"], overlay: "q1", at: { x: 600, y: 220 } });
    assert.equal(again.scope.root, "/repo", "the repository it read last, before asking again");
    assert.ok(jobs.length > 0, "and it asks again");
    again.close(); jobs.length = 0;
  }
  // Details opening reads the range menu's repository and counts, so a first opening has them.
  {
    const asked = [], was = env.exec;
    jobs.length = 0;
    const card = load({ actions: "details", source: { ...source, machine: null }, overlay: "dq", at: { x: 700, y: 40 } });
    card.testScope.exec = async (cmd, args, opts) => { asked.push(args.join(" ")); return was(cmd, args, opts); };
    for (let i = 0; i < 20 && jobs.length; i++) await jobs.shift()(cx);
    assert.ok(asked.some(a => a.includes("--show-toplevel")), "where Review reads, asked as Details opens");
    assert.ok(asked.some(a => a.includes("status")), "and its counts");
    const menu = another(card.testScope, { actions: "review-scope", source, details: "dq", parents: ["dq"], overlay: "q2", at: { x: 600, y: 220 } });
    assert.equal(menu.scope.root, "/repo", "its menu, opened after, starts where Details read");
    menu.close(); jobs.length = 0;
  }
  assert.ok(!label(range, "scope-uncommitted").endsWith(", shown") && !label(range, "scope-changes").endsWith(", shown"), "nothing claimed shown");
  assert.notEqual(find(range.render(), "scope-uncommitted").style.bg, theme.selected, "nothing lit on opening");
  state["t3.panels"] = { s: { tabs: [{ id: "review", born: 9 }], active: "review", open: true } };
  range = await open({ s: { root: "/repo", page: "/worktree", born: 9 } });
  assert.ok(label(range, "scope-uncommitted").endsWith(", shown"));
  assert.equal(find(range.render(), "scope-uncommitted").style.opacity, undefined, "the range shown isn't greyed at nothing");
  const closed = []; range.testScope.closeOverlay = id => closed.push(id);
  fire(find(range.render(), "scope-changes"), "on_click", {}, cx);
  const born = state["t3.panels"].s.tabs.find(t => t.id === "review").born;
  assert.deepEqual([state.review.page, state.review.root, state.review.born, state.review.analyze], ["/branch/feature", "/repo", born, true], "for the Review tab shown, its born");
  assert.ok(closed.includes("parent"), "Details goes");
  // A stale source changes nothing.
  const before = state.review;
  range.testScope.spaces = () => [{ id: "other", active: true, tabs: [] }];
  fire(find(range.render(), "scope-changes"), "on_click", {}, cx);
  assert.equal(state.review, before);
  range.testScope.spaces = env.spaces;
  // Commits opens beside it, a popup of its own; a commit picked there asks for it, its branch's Changes as base.
  fire(find(range.render(), "scope-commits"), "on_click", {}, cx);
  const sub = overlays.at(-1);
  assert.equal(sub.props.actions, "review-commits");
  assert.ok(sub.at.x >= 600 + (4 + 254) * zoom - 1, "beside its row, as t3-menu's submenus");
  assert.ok(Math.abs(sub.at.y - (220 + (4 + 2 * 28 + 9 - 5) * zoom)) < 0.01, "its first row level with Commits, under the two ranges and the rule");
  env.t3DetailsRange = range;
  const commits = load({ ...sub.props, overlay: overlays.length });
  delete env.t3DetailsRange;
  // A commit row lights under the pointer and goes out when it leaves, as every menu row (menu-row.js).
  fire(find(commits.render(), "scope-commit-abc123"), "on_hover", true, cx);
  assert.equal(find(commits.render(), "scope-commit-abc123").style.bg, theme.selected);
  fire(find(commits.render(), "scope-commit-abc123"), "on_hover", false, cx);
  assert.notEqual(find(commits.render(), "scope-commit-abc123").style.bg, theme.selected, "off it, unlit");
  fire(find(commits.render(), "scope-commit-abc123"), "on_click", {}, cx);
  assert.deepEqual([state.review.page, state.review.base], ["/commit/abc123", "/branch/feature"]);
  range.close();
}
{
  // Open Details and its menus through their controls in one runtime, as the host does. A and B are two tabs of one space.
  let tab = "a", release;
  const closed = [], panelCalls = [];
  const tabs = ["a", "b"], cwd = id => `/repo-${id}/sub`;
  const bar = load({ details: true }), scope = bar.testScope;
  const overlayId = spec => overlays.indexOf(spec) + 1;
  const mounted = new Map();
  const inOverlay = (spec) => {
    const p = { ...spec.props, overlay: overlayId(spec) };
    scope.props = () => p;
    const m = new scope.Mod(); m.init(p, cx); mounted.set(m, p); return m;
  };
  scope.spaces = () => [{ id: "s", active: true, folder: "/space", tabs: tabs.map(id => ({ id, active: id === tab })) }];
  scope.panes = () => tabs.map(id => ({ tab: id, terminal: `term-${id}`, cwd: cwd(id) }));
  scope.focused = () => ({ space: "s", tab, terminal: `term-${tab}` });
  scope.closeOverlay = id => closed.push(id);
  scope.run = (name, args) => panelCalls.push([name, plain(args)]);
  const slots = ["files", "review", "panel-empty"];
  scope.layout = () => ({ id: "panel", children: [{ id: "panel-body", children: slots.map(id => ({ id })) }] });
  const bProbe = new Promise(done => { release = done; });
  scope.exec = async (_cmd, args, { cwd: dir } = {}) => {
    if (!args.includes("--show-toplevel")) return { code: 1, stdout: "" };
    if (dir === cwd("b")) await bProbe;
    return { code: 0, stdout: dir.replace(/\/sub$/, "") + "\n" };
  };
  scope.readReview = async root => ({ root, branch: "feature", base: "main", unmerged: 1 });
  scope.readPicks = async ({ root }) => ({ commits: [{ sha: root === "/repo-a" ? "aa1111" : "bb2222", subject: root }], unpushed: [] });
  scope.readRefs = async () => [];
  const drain = async () => { while (jobs.length) await jobs.shift()(cx); };
  const opened = (m, id) => { fire(find(m.render(), id), "on_click", {}, cx); return inOverlay(overlays.at(-1)); };
  const card = () => { scope.props = () => ({ details: true }); return opened(bar, "details-toggle"); };
  jobs.length = 0;
  delete state["t3.panels"]; delete state["review.shown"]; delete state["t3-actions.detailsClosed"]; delete state["t3-actions.menuClosed"];
  const aDetails = card();
  await drain();
  aDetails.close();
  tab = "b";
  const bDetails = card(), bMenu = opened(bDetails, "details-review-more");
  const bJobs = jobs.splice(0).map(job => job(cx));
  const oldRange = find(bMenu.render(), "scope-changes");
  const stale = opened(bMenu, "scope-commits");
  const staleSpec = overlays.at(-1);
  const oldCommit = find(stale.render(), "scope-commit-aa1111");
  assert.ok(oldCommit, "cached A commits are drawn while B's Git probe is pending");
  const before = state.review, beforeClose = closed.length;
  fire(oldCommit, "on_click", {}, cx);
  const whileProbing = [state.review === before, panelCalls.length, closed.length - beforeClose];
  release(); await Promise.all(bJobs); await drain();
  const afterProbe = closed.length;
  fire(oldCommit, "on_click", {}, cx);
  fire(oldRange, "on_click", {}, cx);
  assert.deepEqual([whileProbing, state.review === before, panelCalls.length, closed.length - afterProbe],
    [[true, 0, 0], true, 0, 0], "old A selections cannot show Review or close Details, before or after B confirms");
  const mountedLate = inOverlay(staleSpec);
  assert.equal(find(mountedLate.render(), "scope-commit-bb2222"), null, "a late mount of A's submenu cannot turn into B's");

  const menuProps = () => mounted.get(bMenu);
  scope.props = menuProps;
  const current = opened(bMenu, "scope-commits");
  const newCommit = find(current.render(), "scope-commit-bb2222");
  assert.ok(newCommit, "the new repository's commits are selectable");
  slots.splice(1, 1);
  fire(newCommit, "on_click", {}, cx);
  assert.deepEqual([state.review, panelCalls.length], [before, 0], "a removed Review slot cannot take a request");
  slots.splice(1, 0, "review");
  fire(newCommit, "on_click", {}, cx);
  const born = state["t3.panels"].s.tabs.find(t => t.id === "review").born;
  assert.deepEqual([state.review.space, state.review.root, state.review.page, state.review.born, closed.at(-1)],
    ["s", "/repo-b", "/commit/bb2222", born, mounted.get(bDetails).overlay]);
  current.close(); scope.props = menuProps; bMenu.close();
  delete state["t3.panels"]; delete state["t3-actions.detailsClosed"]; delete state["t3-actions.menuClosed"];
}
{
  // Details by keys (cmd-shift-b, or Enter on its button): its first control holds the keyboard, ringed; ↑/↓ walk its rows and
  // ←/→ their halves; Enter on a chevron hangs its menu under the row, its first row lit; that menu gone, the keyboard is back.
  const source = { space: "s", tab: "b", terminal: "t9", folder: "/captured", machine: null };
  state["t3-actions.actions"] = { list: [{ id: "a", name: "Dev", command: "bun dev" }] };
  delete state["t3-actions.detailsItems"]; delete state["t3-actions.menuClosed"]; delete state["t3-actions.detailsClosed"]; delete state["t3.panels"]; delete state["review.shown"];

  // Its button opens it for the pointer, where it hangs; the command (no press) for the keys.
  const entry = load({ details: true });
  fire(find(entry.render(), "details-toggle"), "on_mouse_down:left", { bounds: { x: 1000, y: 6, width: 28 * zoom, height: 28 * zoom } }, cx);
  fire(find(entry.render(), "details-toggle"), "on_click", {}, cx);
  assert.equal(overlays.at(-1).props.lit, undefined, "a press: the pointer's");
  assert.deepEqual(overlays.at(-1).props.at, overlays.at(-1).at, "it knows where it hangs");
  vm.runInContext("dismissDetails(); toggleDetails()", entry.testScope);
  assert.equal(overlays.at(-1).props.lit, 0, "no press: the keys'");
  vm.runInContext("dismissDetails()", entry.testScope);

  assert.deepEqual(strings(find(load({ actions: "details-items", source, details: "dk" }).render(), "details-item-review")), ["Review"]);
  const at = { x: 700, y: 40 }, round = v => Math.round(v * 100) / 100;
  const kv = load({ actions: "details", source, overlay: "dk", lit: 0, at });
  const on = () => kv.testScope.onStop(kv);
  const key = (k) => fire(find(kv.render(), "workspace-details"), "on_key_down", { key: k, keystroke: k, modifiers: {} }, cx);
  const ring = (id) => find(kv.render(), id).items.some(c => c?.style?.border === 2);
  assert.equal(on(), "details-finder", "the first control holds the keyboard");
  assert.ok(ring("details-finder"), "and wears the ring");
  // The Review row, and its line in what to show, are called Review.
  assert.ok(strings(find(kv.render(), "details-review")).includes("Review") && !strings(kv.render()).includes("Quick Review"));
  // The machine row isn't in the walk; ← and → stop at the row's ends; ↑ and ↓ wrap, keeping the half.
  const walk = [["right", "details-open-more"], ["right", "details-open-more"], ["down", "action-more"], ["left", "action-run"], ["left", "action-run"],
    ["down", "details-review"], ["right", "details-review-more"], ["down", "details-open-more"], ["up", "details-review-more"]];
  for (const [k, id] of walk) { key(k); assert.equal(on(), id, k); }
  // Enter clicks it (Herdr's keyboard activation), no press: the row it's on places the menu, as wide, 4 under it.
  fire(find(kv.render(), "details-review-more"), "on_click", {}, cx);
  const menu = overlays.at(-1);
  // The card's 1 border, Workspace's 8 and three rows, the rule, Review's 8, its row and 4: 158 down; 9 in from the left.
  assert.deepEqual([menu.props.actions, menu.props.lit, round(menu.at.x), round(menu.at.y)], ["review-scope", 0, round(at.x + 9 * zoom), round(at.y + 158 * zoom)]);
  // The menu goes (Esc in it): the keyboard comes back to the chevron that opened it, not in a render.
  held = null; kv.testScope.menuClosed(overlays.length);
  assert.equal(on(), "details-review-more", "back on the control that opened it");
  // An action run from its menu moved the keyboard to its terminal: the menu's close leaves it there.
  key("up"); fire(find(kv.render(), "action-more"), "on_click", {}, cx);
  assert.equal(overlays.at(-1).props.actions, "menu");
  kv.testScope.focused = () => ({ space: "s", tab: "b", terminal: "t10" });
  held = null; kv.testScope.menuClosed(overlays.length);
  assert.equal(held, null, "the terminal keeps it");
  kv.testScope.focused = env.focused; vm.runInContext("focusStop", kv.testScope)(kv, "action-more");
  // Escape closes Details and gives the keyboard back to its terminal.
  const closed = []; kv.testScope.closeOverlay = id => closed.push(id); calls.length = 0;
  key("escape");
  assert.deepEqual([closed, calls], [["dk"], [["pane.focus", { terminal: "t9" }]]]);

  // Opened by the pointer: nothing ringed until a key.
  const mv = load({ actions: "details", source, overlay: "dm", at });
  assert.equal(mv.testScope.onStop(mv), null);
  fire(find(mv.render(), "workspace-details"), "on_key_down", { key: "down", keystroke: "down", modifiers: {} }, cx);
  assert.equal(mv.testScope.onStop(mv), "details-finder");
  delete state["t3-actions.menuClosed"];
}
{
  // Open in's menu opened while the editors are still being looked for: once they're found, the open menu lists them too,
  // as Details' row does (open-in.js targetsMenu reads what the probe found, not what it was opened with).
  const source = { space: "s", tab: "b", pane: "p", terminal: "t", folder: "/captured" };
  const was = { spaces: env.spaces, panes: env.panes, focused: env.focused, layout: env.layout, exec: env.exec };
  env.spaces = () => [{ id: "s", active: true, tabs: [{ id: "b", active: true }] }];
  env.panes = () => [{ pane: "p", terminal: "t", tab: "b" }];
  env.focused = () => ({ pane: "p", terminal: "t", tab: "b" });
  env.layout = () => ({ id: "root", children: [{ id: "panel-body", children: [{ id: "review" }] }] });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  env.exec = async (_cmd, args) => {
    if (args[0] === "-Ra") { await gate; return { code: args[1] === "Zed" ? 0 : 1, stdout: "", stderr: "" }; }
    return { code: 0, stdout: "Test Mac", stderr: "" };
  };
  jobs.length = 0;
  const details = load({ actions: "details", source, overlay: "details" });
  const running = jobs.splice(0).map((job) => job(cx));
  const arrow = () => find(details.render(), "details-open-more");
  fire(arrow(), "on_mouse_down:left", { bounds: { x: 300, y: 100, width: 32, height: 32 } }, cx);
  fire(arrow(), "on_click", {}, cx);
  const first = overlays.at(-1);
  assert.deepEqual(plain(first.props.targets), ["Finder"], "opened while the probe runs");
  const picker = load({ ...first.props, overlay: "picker" });
  // Herdr runs a mod's popups in one runtime: the probe's cache is the same one.
  picker.testScope.t3OpenInTargets = details.testScope.t3OpenInTargets;
  const before = jobs.length; vm.runInContext("awaitTargets", picker.testScope)(cx);
  assert.equal(jobs.length, before + 1, "the menu waits for the probe, to draw again when it ends");
  jobs.pop();
  const labels = () => ["open-in-0", "open-in-1", "open-in-2"].map((id) => find(picker.render(), id)).filter(Boolean).map((row) => row.style.accessibility_label);
  assert.deepEqual(plain(labels()), ["Open in Finder"]);
  release(); await Promise.all(running); await new Promise(setImmediate);
  assert.deepEqual(plain(details.targets), ["Finder", "Zed"], "the probe found Zed");
  assert.deepEqual(plain(labels()), ["Open in Finder", "Open in Zed"], "the open menu lists it too");
  Object.assign(env, was); jobs.length = 0;
}
{
  // Tab-action from Details closes the popup chain before terminal.open (no false source warning); split-action stays open;
  // and the 100ms source watcher cancels itself once !sourceOkay(source) fires so it can never notify twice.
  const was = { spaces: env.spaces, panes: env.panes, focused: env.focused };
  let tab = "b";
  env.spaces = () => [{ id: "s", active: true, machine: null, folder: "/space", tabs: [{ id: "b", active: tab === "b" }, { id: "new-tab", active: tab === "new-tab" }] }];
  env.panes = () => [{ pane: "p", terminal: "t9", tab: "b", cwd: "/captured" }];
  env.focused = () => ({ space: "s", tab, terminal: tab === "b" ? "t9" : "t10", cwd: "/captured" });

  // 1) Directly on Details card: tab action (explicit place: "tab" and default omitted place) dismisses Details before terminal.open.
  for (const place of ["tab", undefined]) {
    tab = "b";
    state["t3-actions.actions"] = { list: [{ id: "a", name: "Tab act", command: "ls", ...(place ? { place } : {}) }] };
    const entry = load({ details: true }), events = [], watches = [];
    const entryClose = (id) => { events.push(["close", id]); const reg = entry.testScope.t3Details; if (reg?.id === id) reg.id = null; };
    entry.testScope.closeOverlay = entryClose;
    fire(find(entry.render(), "details-toggle"), "on_click", {}, cx);
    const detSpec = overlays.at(-1), detId = overlays.length;
    assert.equal(vm.runInContext("openedDetails()", entry.testScope), detId);
    entry.testScope.props = () => ({ ...detSpec.props, overlay: detId });
    const det = new entry.testScope.Mod();
    const detCx = { ...cx, timer: { ...cx.timer, every: (ms, f) => { const h = { ms, f, cancelled: 0, cancel() { this.cancelled++; } }; watches.push(h); return h; } } };
    det.init(entry.testScope.props(), detCx);
    entry.testScope.run = (name, args) => {
      events.push(["run", name, plain(args)]);
      if (name === "terminal.open" && args.place === "tab") tab = "new-tab";
    };
    notices.length = 0;
    fire(find(det.render(), "action-run"), "on_click");
    const closeAt = events.findIndex(([kind, arg]) => kind === "close" && arg === detId);
    const openAt = events.findIndex(([kind, arg]) => kind === "run" && arg === "terminal.open");
    assert.ok(closeAt >= 0 && openAt > closeAt, `place=${place}: Details closes before terminal.open`);
    assert.equal(vm.runInContext("openedDetails()", entry.testScope), null, `place=${place}: openedDetails cleared`);
    assert.equal(notices.length, 0, `place=${place}: no false warning`);
  }

  // 2) From Details' Actions menu: tab action closes menu + Details before terminal.open; split action closes menu only.
  {
    tab = "b";
    state["t3-actions.actions"] = { list: [
      { id: "a-tab", name: "Tab menu act", command: "ls" },
      { id: "a-split", name: "Split menu act", command: "pwd", place: "right" },
    ] };
    const source = { space: "s", tab: "b", terminal: "t9", folder: "/captured", machine: null };
    const events = [];
    const menuView = load({ actions: "menu", source, details: "det-1", parents: ["det-1"], overlay: "menu-1" });
    menuView.testScope.closeOverlay = (id) => events.push(["close", id]);
    menuView.testScope.run = (name, args) => events.push(["run", name, plain(args)]);
    fire(find(menuView.render(), "action-a-tab"), "on_click");
    const detCloseAt = events.findIndex(([kind, arg]) => kind === "close" && arg === "det-1");
    const openAt = events.findIndex(([kind, arg]) => kind === "run" && arg === "terminal.open");
    assert.ok(detCloseAt >= 0 && openAt > detCloseAt, "menu tab action closes Details before terminal.open");

    events.length = 0;
    fire(find(menuView.render(), "action-a-split"), "on_click");
    assert.ok(!events.some(([kind, arg]) => kind === "close" && arg === "det-1"), "menu split action keeps Details open");
    assert.ok(events.some(([kind, arg]) => kind === "run" && arg === "terminal.open"), "menu split action runs terminal.open");
  }

  // 3) Directly on Details card: split action (place: "right" / "down") keeps Details open.
  for (const place of ["right", "down"]) {
    tab = "b";
    state["t3-actions.actions"] = { list: [{ id: "a", name: "Split", command: "pwd", place }] };
    const entry = load({ details: true }), closed = [];
    entry.testScope.closeOverlay = (id) => closed.push(id);
    fire(find(entry.render(), "details-toggle"), "on_click", {}, cx);
    const detSpec = overlays.at(-1), detId = overlays.length;
    entry.testScope.props = () => ({ ...detSpec.props, overlay: detId });
    const det = new entry.testScope.Mod(); det.init(entry.testScope.props(), cx);
    fire(find(det.render(), "action-run"), "on_click");
    assert.equal(closed.length, 0, `place=${place}: Details stays open`);
    assert.equal(vm.runInContext("openedDetails()", entry.testScope), detId, `place=${place}: openedDetails stays set`);
    vm.runInContext("dismissDetails()", entry.testScope);
  }

  // 4) External source change cancels the 100ms watch immediately so it never notifies twice.
  {
    tab = "b";
    const source = { space: "s", tab: "b", terminal: "t9", folder: "/captured", machine: null };
    const watches = [], closed = [];
    const det = load({ actions: "details", source, overlay: "det-watch" });
    det.testScope.closeOverlay = (id) => closed.push(id);
    const detCx = { ...cx, timer: { ...cx.timer, every: (ms, f) => { const h = { ms, f, cancelled: 0, cancel() { this.cancelled++; } }; watches.push(h); return h; } } };
    det.init({ actions: "details", source, overlay: "det-watch" }, detCx);
    const watch = watches.find(w => w.ms === 100);
    assert.ok(watch, "100ms source watch registered");
    tab = "new-tab";
    notices.length = 0;
    watch.f();
    if (!watch.cancelled) watch.f();
    assert.equal(watch.cancelled, 1, "watch cancels itself immediately when source changes");
    assert.deepEqual(closed, ["det-watch"], "closes Details once");
    assert.equal(notices.length, 1, "warns once and never notifies twice");
    assert.equal(notices[0].title, "Open Details again");
  }

  Object.assign(env, was);
}
console.log("ok: Actions controls/editor; Details opens on its source, its menus under their rows and gone with it, walked by keys; its Review row shows Review and picks its range");
})().catch((e) => { console.error(e); process.exit(1); });
