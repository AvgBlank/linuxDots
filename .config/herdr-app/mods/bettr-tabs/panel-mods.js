// Any installed mod can have a panel and a button here. It says so in its own mod.json:
//   { "title": "Tracker", "panel": { "width": 900 } }   (or "panel": true; an optional icon.svg beside it)
// Bettr names no such mod. A panel must be a layout node, so bettr-tabs writes one block per mod into the
// installed layout, each with an id that starts with GENERATED, and adds it again if an update removes it.
// scripts/install.py ignores these blocks when it compares the layout, and has the same prefix.
export const GENERATED = "mod-panel-";

// One frame for every mod block inside Bettr's panel-body. Herdr paints these
// layout fields; layoutFramed tells a mod to leave its outer surface transparent.
export const PANEL_FRAME = { background: "background", border: { width: 1, color: "border" }, radius: 10 };

function hasFrame(node) {
  return node.background === PANEL_FRAME.background && node.radius === PANEL_FRAME.radius
    && node.border?.width === PANEL_FRAME.border.width && node.border?.color === PANEL_FRAME.border.color
    && node.content?.props?.layoutFramed === true;
}

function framesDiffer(node) {
  if (node.type === "block" && node.content?.mod) return !hasFrame(node);
  return (node.children ?? []).some(framesDiffer);
}

export function framePanels(tree) {
  function frame(node) {
    if (node.type === "block" && node.content?.mod) {
      Object.assign(node, PANEL_FRAME, { border: { ...PANEL_FRAME.border } });
      node.content.props = { ...node.content.props, layoutFramed: true };
    }
    for (const child of node.children ?? []) frame(child);
  }
  const body = find(tree, "panel-body");
  if (body) frame(body);
  return tree;
}

// What a mod's mod.json text says about its panel; null when it has none.
export function panelMod(name, text) {
  let manifest;
  try { manifest = JSON.parse(text); } catch { return null; }
  if (!manifest?.panel) return null;
  const width = manifest.panel.width;
  return { name, id: `${GENERATED}${name}`, title: manifest.title || name, width: width > 0 ? width : null };
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const isGenerated = node => String(node?.id).startsWith(GENERATED);
const block = mod => ({ id: mod.id, type: "block", content: { mod: mod.name }, size: { weight: 1 }, hidden: true });

// `children` with those named in `order` put in that order, inside the slots they hold. The others stay where they are.
function inOrder(children, order) {
  const rank = node => order.indexOf(node.id);
  const moved = children.filter(node => rank(node) >= 0).sort((a, b) => rank(a) - rank(b));
  let next = 0;
  return children.map(node => rank(node) >= 0 ? moved[next++] : node);
}

// `known` in the order panel-body shows them. One with no node in panel-body goes last.
export function orderedPanels(tree, known) {
  const shown = (find(tree, "panel-body")?.children ?? []).map(node => node.id).filter(id => known.includes(id));
  return [...shown, ...known.filter(id => !shown.includes(id))];
}

// True when registered blocks, their shared frames or the panel order need an update. Other layouts are left alone.
export function blocksDiffer(tree, mods, order = []) {
  const body = find(tree, "panel-body");
  if (!body) return false;
  const children = body.children ?? [];
  const have = children.filter(isGenerated).map(node => node.content?.mod).sort();
  const want = mods.map(mod => mod.name).sort();
  return have.length !== want.length || have.some((name, i) => name !== want[i]) || framesDiffer(body)
    || inOrder(children, order).some((node, i) => node !== children[i]);
}

// `tree` with one block per mod in panel-body: a mod that keeps its block keeps it as it is, and the
// person's own blocks stay. The panels named in `order` take that order. Changes `tree`.
export function withBlocks(tree, mods, order = []) {
  const body = find(tree, "panel-body");
  if (!body) return tree;
  const children = body.children ?? [];
  const kept = children.filter(node => !isGenerated(node) || mods.some(mod => mod.id === node.id));
  body.children = inOrder([...kept, ...mods.filter(mod => !kept.some(node => node.id === mod.id)).map(block)], order);
  return framePanels(tree);
}
