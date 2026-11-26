// Catch missing drag/menu wiring, synthetic subgroup paths, and deleted paths offered disk actions.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const kit = require("./check-kit.js");
const element = kit.elements({ args: "auto" });
const files = [{ path: "src/a.ts", status: "modified", reviewed: false }, { path: "removed.ts", status: "removed", reviewed: false }, { path: "lib/nested/b.ts", status: "added", reviewed: false }];
const child = { key: "sub", label: "Sub", category: "code", files: ["lib/nested/b.ts"], missing: [], children: [] };
const group = { key: "top", files: ["src/a.ts", "removed.ts"], missing: ["gone.ts"], children: [child] };
const overlays = [], closed = [], shared = new Map(), calls = [];
let menuProps = null, machine = null, clipboard = "before";
const cx = { notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {}, is_focused: () => false }), on_blur() {},
  timer: { every() {}, after() {} }, spawn() {}, read_from_clipboard: () => clipboard, write_to_clipboard: v => { clipboard = v; } };
const env = { checking: () => false, div: element, svg: p => element("svg", p), image: p => element("image", p), h_flex: element, v_flex: element,
  props: () => menuProps, settings: () => ({ zoom: 1 }), theme: () => ({ foreground: "#ffffff", dim: "#888888", popover: "#111111", accent: "#00ff00" }),
  spaces: () => [{ id: "s", active: true, machine, tabs: [{ id: "tab", active: true }] }],
  agents: () => [], panes: () => [], focused: () => null, appWindow: () => ({ platform: "macos" }), window: () => ({ platform: "macos" }), DISABLED: 0.64,
  openOverlay: o => { overlays.push(o); return `o${overlays.length}`; }, closeOverlay: id => closed.push(id),
  shared: k => shared.get(k), setShared: (k, v) => shared.set(k, v), exec: async () => ({ code: 0 }), run: (...a) => calls.push(a), notify() {},
  hoverKept: (_v, _k, _id, el) => el, tip: (_v, _t, _id, _label, el) => el, glow: () => () => {},
  PANE: "review", checkMark: () => element(), foldAllButton: element, groupFiles: g => [...g.files, ...g.children.flatMap(c => env.groupFiles(c))], categoryIcon: element, criticalMark: element };
const scoped = (f, src, needs) => f === "popup-menu.js" ? needs() + "\nconst { openPopup, openBeside, closeSub, subGone, closeChain, closeTops, menuClosed } = (() => {\n" + kit.strip(src) + "\nreturn { openPopup, openBeside, closeSub, subGone, closeChain, closeTops, menuClosed };\n})();" : null;
const source = kit.bundle(f => fs.readFileSync(path.join(__dirname, f), "utf8"), "files.js", scoped, new Set(["controls.js", "rows.js", "groups.js", "tip.js", "nav-column.js", "button.js"]));
const context = vm.createContext({ ...env });
vm.runInContext(source + "\nglobalThis.api = { fileTree };", context);
const view = { space: "s", root: "/repo", current: "src/a.ts", handle: { is_focused: () => false }, flipped: new Set(["src", "group:sub/lib", "group:sub/lib/nested"]),
  group: () => group, fileAt: p => files.find(f => f.path === p), review: {}, select: p => calls.push(["select", p]), setReviewed: () => calls.push(["reviewed"]) };
const draw = () => context.api.fileTree(view, env.theme());
const get = (id) => { const row = kit.find(draw(), id); assert.ok(row, id); return row; };

test("Review files and folders carry real paths and machines; deleted/group rows cannot drag", () => {
  for (const on of [null, "kvm"]) {
    machine = on;
    for (const [id, absolute] of [["tree-f-src/a.ts", "/repo/src/a.ts"], ["tree-d-src", "/repo/src"], ["tree-d-group:sub/lib/nested", "/repo/lib"], ["tree-f-lib/nested/b.ts", "/repo/lib/nested/b.ts"]]) {
      assert.deepEqual(get(id).style.drag_paths && kit.plain(get(id).style.drag_paths), [[absolute], { on }], `${id}: native drag carries the real absolute path and machine`);
    }
  }
  machine = null;
  for (const id of ["tree-m-gone.ts", "tree-f-removed.ts", "tree-g-sub"]) assert.equal(get(id).style.drag_paths, undefined, `${id}: no native drag`);
});
test("Review right click opens its own menu without changing current/reviewed/fold state", () => {
  machine = null;
  for (const [id, real, deleted] of [["tree-f-src/a.ts", "src/a.ts", false], ["tree-d-src", "src", false], ["tree-d-group:sub/lib/nested", "lib/nested", false], ["tree-m-gone.ts", "gone.ts", true], ["tree-f-removed.ts", "removed.ts", true]]) {
    const before = calls.length;
    const folds = [...view.flipped];
    kit.fire(get(id), "on_mouse_down:right", {}, cx);
    assert.equal(calls.length, before, "right click does not select, review, or toggle a folder");
    assert.equal(view.current, "src/a.ts");
    assert.equal(overlays.at(-1).mod, "review", "standalone Review opens its own native popup");
    assert.deepEqual(kit.plain(overlays.at(-1).props.source), { space: "s", tab: "tab", root: "/repo", on: null });
    assert.equal(overlays.at(-1).props.path, real); assert.equal(overlays.at(-1).props.deleted, deleted);
    assert.deepEqual([...view.flipped], folds, "right click leaves folder folds alone");
    assert.equal(get(id).style.bg, id === "tree-f-src/a.ts" ? "#ffffff1f" : "#ffffff12", "menu owner keeps Files' context highlight (unless selected)");
  }
  assert.equal(get("tree-g-sub").handlers["on_mouse_down:right"], undefined, "a subgroup has no menu");
});

// The captured popup's actual rows, including deleted-path restrictions, not a second menu model.
const menuSource = kit.bundle(f => fs.readFileSync(path.join(__dirname, f), "utf8"), "menus.js", () => null, new Set(["tip.js", "button.js"]));
const popup = vm.createContext({ ...env });
vm.runInContext(menuSource + "\nglobalThis.api = { initMenu, menuView, closeMenu };", popup);
const rowsOf = v => kit.walk(popup.api.menuView(v)).filter(n => n.key?.startsWith("files-menu-") && n.key !== "files-menu-list").map(n => n.key);
test("Deleted Review files offer only relative Copy path; Files' regular menu stays unchanged", () => {
  for (const [path, deleted, expected] of [["src/a.ts", false, ["open", "reveal", "open-with", "copy-path", "mention"]], ["gone.ts", true, ["copy-path"]], ["removed.ts", true, ["copy-path"]]]) {
    menuProps = { overlay: "test", files: "row", menuMod: "review", source: { space: "s", tab: "tab", root: "/repo", on: null }, path, deleted, agent: null, editors: ["Zed"] };
    const v = {}; popup.api.initMenu(v, cx);
    assert.deepEqual(rowsOf(v), expected.map(id => `files-menu-${id}`));
    kit.fire(kit.find(popup.api.menuView(v), "files-menu-copy-path"), "on_click", {}, cx);
    assert.equal(clipboard, path, "Copy path stays relative, including deleted files");
  }
});
test("Review popup closes with its own stamp and remote paths have no local apps", () => {
  menuProps = { overlay: "remote", files: "row", menuMod: "review", source: { space: "s", tab: "tab", root: "/repo", on: "kvm" }, path: "src/a.ts", editors: ["Zed"] };
  const remote = {}; popup.api.initMenu(remote, cx);
  assert.deepEqual(rowsOf(remote), ["files-menu-copy-path", "files-menu-mention"]);
  popup.api.closeMenu(remote);
  assert.ok(shared.has("review.menuClosed"));
});

test("Review Open with stays in Review, uses its icons and closes with its own submenu stamp", () => {
  menuProps = { overlay: "parent", files: "row", menuMod: "review", source: { space: "s", tab: "tab", root: "/repo", on: null }, path: "src/a.ts", editors: ["Zed"] };
  const parent = {}; popup.api.initMenu(parent, cx);
  kit.fire(kit.find(popup.api.menuView(parent), "files-menu-open-with"), "on_click", {}, cx);
  assert.equal(overlays.at(-1).mod, "review");
  assert.equal(overlays.at(-1).props.menuMod, "review");
  menuProps = { ...overlays.at(-1).props, overlay: `o${overlays.length}` };
  const child = {}; popup.api.initMenu(child, cx);
  assert.deepEqual(rowsOf(child), ["files-menu-editor:Zed"]);
  const icons = kit.walk(popup.api.menuView(child)).filter(n => typeof n.source === "string" && n.source.endsWith(".svg")).map(n => n.source);
  assert.ok(icons.includes("mods/review/icons/zed.svg"));
  for (const icon of icons) assert.ok(fs.existsSync(path.join(__dirname, "../..", icon)), icon);
  popup.api.closeMenu(child);
  assert.ok(shared.has("review.submenuClosed"));
});
