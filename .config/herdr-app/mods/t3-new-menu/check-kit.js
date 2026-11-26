// What the checks share, beside each mod's checks so a standalone repo's still run: stand-ins for gpui-kit's elements that
// record what a view drew, and a mod's own files loaded into one vm scope. No mod imports it; Herdr never loads it.

/**
 * An element factory. Each call records itself on the node: children in `items`, `id` as `key`, listeners in `handlers`
 * (a press or action under `<on_…>:<button or action>`, every one kept in order as GPUI does), `hover`'s styles in
 * `hoverStyle`, anything else in `style`. `args`: what a style call keeps, "first" its first argument, "auto" that one or
 * all when there are several, "all" the list. `adds`: the calls that add a child.
 * @param {{ args?: "first" | "auto" | "all", adds?: string[] }} [o]
 */
function elements({ args = "first", adds = ["child", "content", "trigger"] } = {}) {
  /** @returns {any} */
  function element(kind = "div", source = undefined) {
    const node = { kind, source, key: null, items: [], handlers: {}, style: {}, hoverStyle: {} };
    const proxy = new Proxy(node, { get(target, key) {
      if (key in target) return target[key];
      return (...a) => {
        if (key === "when") { if (a[0]) a[1](proxy); }
        else if (adds.includes(String(key))) node.items.push(a[0]);
        else if (key === "children") node.items.push(...a[0]);
        else if (key === "id") node.key = a[0];
        else if (key === "hover") { const hovered = element(); a[0](hovered); node.hoverStyle = hovered.style; }
        else if (key === "on_mouse_down" || key === "on_mouse_up" || key === "on_action") {
          const at = `${String(key)}:${a[0]}`, was = node.handlers[at], now = a[1];
          node.handlers[at] = was ? (...e) => { was(...e); return now(...e); } : now;
        }
        else if (String(key).startsWith("on_")) node.handlers[key] = a[0];
        else node.style[key] = args === "all" || (args === "auto" && a.length !== 1) ? a : a[0];
        return proxy;
      };
    } });
    return proxy;
  }
  return element;
}

/** The first node, depth first, whose `id` was `id`; null if none. */
const find = (node, id) => {
  if (!node || typeof node !== "object") return null;
  if (node.key === id) return node;
  for (const child of node.items) { const hit = find(child, id); if (hit) return hit; }
  return null;
};
/** Every node under `node`, itself first. */
const walk = (node) => node && typeof node === "object" ? [node, ...node.items.flatMap(walk)] : [];
/** Every text drawn under `node`, in order. */
const strings = (node) => typeof node === "string" ? [node] : node && typeof node === "object" ? node.items.flatMap(strings) : [];
/** Calls `node`'s `event` listener with `args`, failing when there's no node or no such listener. */
function fire(node, event, ...args) {
  if (!node) throw new Error(`missing event target: ${event}`);
  if (typeof node.handlers[event] !== "function") throw new Error(`no ${event} listener`);
  return node.handlers[event](...args);
}
/** A copy made of this context's objects: a vm's own compare unequal to them. */
const plain = (value) => JSON.parse(JSON.stringify(value));

/** A module's code with its imports and `export`s gone, to run in a vm beside the rest; `export default` stays. */
const strip = (src) => src.replace(/^import [^;]*;\r?\n/gm, "").replace(/^export (?!default )/gm, "");

/**
 * A mod as Herdr would load it, all in one scope: what `file` imports from its own folder, each file once and before what
 * needs it, its default class as `globalThis.Mod`. `read(name)` gives a file's text; `own(name, text, needs)` may give a file's
 * code whole, `needs()` being what it imports, bundled.
 * @param {(name: string) => string} read
 * @param {(name: string, text: string, needs: () => string) => string | null} [own]
 */
function bundle(read, file = "main.js", own = () => null, seen = new Set()) {
  if (seen.has(file)) return "";
  seen.add(file);
  const src = read(file), needs = () => [...src.matchAll(/^import [^;]*? from "\.\/(.+?)";/gm)].map((m) => bundle(read, m[1], own, seen)).join("\n");
  return own(file, src, needs) ?? needs() + "\n" + strip(src).replace("export default class", "globalThis.Mod = class");
}

/**
 * Where the work column's pane header has its centre, from the layout's JSON: the tab row, the pane's border, half its header.
 * The space panel's page headers put their row there too (docs/internals/specs/files.md), so the two read as one line. `head`
 * is the panel head's height, `tabEdge` its first tab's box: the panel's padding and the head's.
 * @param {string} json
 */
function paneHeadCentre(json) {
  const root = JSON.parse(json), node = (n, id) => n?.id === id ? n : (n?.children ?? []).map((c) => node(c, id)).find(Boolean);
  const pane = node(root, "main").content.pane, side = (n) => [].concat(n?.padding ?? 0).at(-1);
  return { left: node(root, "tabs-row").size.px + pane.border.width + pane.header.height / 2, head: node(root, "panel-head").size.px,
    tabEdge: side(node(root, "panel")) + side(node(root, "panel-head")) };
}

module.exports = { elements, find, walk, strings, fire, plain, strip, bundle, paneHeadCentre };
