// This run's LaunchServices probe is shared across Files and Details; never launch after the captured source changes.
// The app menu both open is drawn here too (targetsMenu), each in a popup of its own mod.
import { image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { checking, exec, theme } from "herdr";
import { focusRoot } from "./focus.js";
import { menuKeys, scrollList } from "./list.js";
import { menuRow, MENU_ROW } from "./menu-row.js";

// T3 contracts/editor.ts; LaunchServices also finds bundles absent from this GUI process's PATH.
const EDITORS = ["Cursor", "Trae", "Kiro", "Visual Studio Code", "Visual Studio Code - Insiders", "VSCodium", "Zed", "Antigravity",
  "IntelliJ IDEA", "Aqua", "CLion", "DataGrip", "DataSpell", "GoLand", "PhpStorm", "PyCharm", "Rider", "RubyMine", "RustRover", "WebStorm"];

export function installedTargets() {
  if (checking()) return Promise.resolve(["Finder"]);
  const cache = globalThis.t3OpenInTargets;
  if (cache?.version === 3) return cache.promise;
  const entry = { version: 3, names: null, promise: null };
  entry.promise = Promise.all(EDITORS.map(async name => {
    const r = await exec("open", ["-Ra", name]).catch(() => null);
    return r?.code === 0 ? name : null;
  })).then(names => entry.names = ["Finder", ...names.filter(Boolean)]);
  globalThis.t3OpenInTargets = entry;
  return entry.promise;
}

// A hot-reloaded view may have lost its init await; rendering reads only completed metadata.
export const knownTargets = () => globalThis.t3OpenInTargets?.version === 3 ? globalThis.t3OpenInTargets.names : null;

/** @param {string} name @param {string} path @param {() => boolean} [isCurrent] */
export async function openTarget(name, path, isCurrent = () => true) {
  if (!path || !isCurrent()) return null;
  if (!EDITORS.includes(name)) name = "Finder";
  if (name !== "Finder") {
    const present = await exec("open", ["-Ra", name]).catch(() => null);
    if (present?.code !== 0) { name = "Finder"; globalThis.t3OpenInTargets = null; }
  }
  if (!isCurrent()) return null;
  const r = await exec("open", name === "Finder" ? ["--", path] : ["-a", name, "--", path]);
  if (r.code !== 0) throw new Error(r.stderr || "The application couldn't be opened.");
  return name;
}

// T3's OpenInPicker: brand art in its own colours, a one-colour brand mark in the text's, any other app the dim generic window.
const APP_ART = { Finder: "finder", "Visual Studio Code": "vscode", VSCodium: "vscodium" }, APP_MARKS = { Cursor: "cursor", Zed: "zed" };
/** `mod` the folder whose icons/ holds them (scripts/sync.sh copies them into Files). @param {string} mod @param {string} name @param {any} t */
export function targetIcon(mod, name, t, size = 16) {
  if (APP_ART[name]) return image(`${mod}/icons/${APP_ART[name]}.svg`).size(size).flex_none();
  return svg(`${mod}/icons/${APP_MARKS[name] ?? "app-window"}.svg`).size(size).flex_none().text_color(APP_MARKS[name] ? t.foreground : t.dim);
}

// At most this tall, so twenty editors scroll and the keys' row stays in view (list.js scrollList).
const OPEN_IN_MAX = 420;
/** The popup's height for `names` (a row saying why when there are none). */
export const openInHeight = (names) => Math.min(OPEN_IN_MAX, 8 + Math.max(1, names.length) * MENU_ROW);

/** An Open in menu opened before the probe has finished: redrawn once it has, so it lists what it found (targetsMenu). */
export function awaitTargets(cx) {
  if (!knownTargets() && globalThis.t3OpenInTargets) cx.spawn(async (cx) => { await installedTargets(); cx.notify(); });
}

/** Open in's menu, Files' and Details': only picks the app (`choose(name, cx)`); the button beside it opens. No names: `reason`.
 *  `names` are what its button knew as it opened; once the probe has found more (awaitTargets), those. `mod` the folder whose
 *  icons/ hold the apps'. `view.keys` takes the keyboard, `view.at` is the lit row. */
export function targetsMenu(view, mod, names, reason, choose) {
  if (names.length) names = knownTargets() ?? names;
  const t = theme(), pick = (at, cx) => choose(names[at], cx);
  return focusRoot(view, v_flex().id("open-in-menu").size_full().p(4).bg(t.popover).track_focus(view.keys)
    .on_key_down(menuKeys(view, names, pick))
    .when(!names.length, el => el.child(h_flex().id("open-in-unavailable").min_h(28).px(8).items_center().text_size(14).text_color(t.dim).child(reason ?? "No installed editors found")))
    .when(names.length > 0, el => el.child(scrollList(view, "open-in-list", { count: names.length, row: MENU_ROW, at: view.at, height: Math.min(names.length * MENU_ROW, OPEN_IN_MAX - 8),
      wheeled: (keep) => { if (keep >= 0) view.at = keep; },
      draw: (i) => menuRow(view, t, `open-in-${i}`, { at: [view, "at", i], label: names[i], icon: targetIcon(mod, names[i], t), pick: (cx) => pick(i, cx) })
        .accessibility_label(`Open in ${names[i]}`) }))));
}
