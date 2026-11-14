// Any installed mod can have a panel and a button here. It says so in its own mod.json:
//   { "title": "Tracker", "panel": { "width": 900 } }   (or "panel": true; an optional icon.svg beside it)
// Bettr names no such mod. A panel must be a layout node, so bettr-tabs writes one block per mod into the
// installed layout, each with an id that starts with GENERATED, and adds it again if an update removes it.
// scripts/install.py ignores these blocks when it compares the layout, and has the same prefix.
export const GENERATED = "mod-panel-";

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

// True when the tree's generated blocks are not exactly `mods`. A tree with no panel-body is not Bettr's: false.
export function blocksDiffer(tree, mods) {
  const body = find(tree, "panel-body");
  if (!body) return false;
  const have = (body.children ?? []).filter(isGenerated).map(node => node.content?.mod).sort();
  const want = mods.map(mod => mod.name).sort();
  return have.length !== want.length || have.some((name, i) => name !== want[i]);
}

// `tree` with one block per mod in panel-body: a mod that keeps its block keeps it as it is, and the
// person's own blocks stay. Changes `tree`.
export function withBlocks(tree, mods) {
  const body = find(tree, "panel-body");
  const children = body.children ?? [];
  const kept = children.filter(node => !isGenerated(node) || mods.some(mod => mod.id === node.id));
  body.children = [...kept, ...mods.filter(mod => !kept.some(node => node.id === mod.id)).map(block)];
  return tree;
}
