// A gap says which current group or sibling it borders, not where that row was drawn.
const machine = w => w.machine ?? null;
const groupKey = r => r.members ? `repo:${r.g.repo}` : `space:${r.w.id}`;
const parent = r => r.tree ? r.g.repo : null;
const OPENING = 5000, ECHO = 1000;

export function spaceOrdering({ spaces, panes, machines, run, home, facts, shown, foldedRepos, row, pitch }) {
  // Only this run: checkouts opened from synthetic rows, the current batch's echo, and a drop waiting for that echo.
  const opening = new Map();
  const born = new Map();
  let flight, drop;
  const due = (now) => Boolean(flight && now - flight.at >= ECHO &&
    (drop || flight.intent || machines().every(m => !flight.machines.includes(m.name) || m.layout === "ready")));

  function snapshot(now, all, ps) {
    const homeId = home();
    const list = all.map(w => {
      const { git, answered } = w.id === homeId ? { git: null, answered: true } : facts(w, ps);
      if (!shown.has(w.id)) {
        if (!born.has(w.id)) born.set(w.id, now);
        if (answered || now - born.get(w.id) > 1500) { shown.add(w.id); born.delete(w.id); }
      }
      return { w, g: git };
    });
    const mains = new Set(list.filter(r => r.g && !r.g.linked).map(r => r.g.repo));
    const trees = new Map();
    for (const r of list) if (r.g?.linked) {
      if (!trees.has(r.g.repo)) trees.set(r.g.repo, []);
      trees.get(r.g.repo).push(r);
    }
    // A checkout opened from its synthetic row takes that row's place (even before the move echoes).
    for (const [repo, at] of opening) {
      const main = list.findIndex(r => r.g && !r.g.linked && r.g.repo === repo);
      const first = list.indexOf(trees.get(repo)?.[0]);
      if (main >= 0 && first >= 0 && main > first) list.splice(first, 0, list.splice(main, 1)[0]);
      else if (main >= 0 || now - at >= OPENING) opening.delete(repo);
    }
    const out = /** @type {any[]} */ ([]), placed = new Set();
    const hang = (top) => {
      const kids = trees.get(top.g.repo) ?? [], closed = foldedRepos.has(top.g.repo);
      const keep = k => closed && k.w.active;
      top.members = kids.map(k => k.w.id);
      top.kids = kids.length;
      top.hiding = kids.filter(k => !keep(k)).length;
      kids.forEach((k, n) => out.push({ ...k, folded: closed && !keep(k), tree: closed || n === kids.length - 1 ? "└─" : "├─" }));
    };
    for (const r of list) {
      if (r.g?.linked && (mains.has(r.g.repo) || trees.get(r.g.repo).length > 1)) {
        if (mains.has(r.g.repo) || placed.has(r.g.repo)) continue;
        placed.add(r.g.repo);
        const [, common] = JSON.parse(r.g.repo);
        const head = { head: true, g: r.g, w: { id: `repo-${r.g.repo}`, name: r.g.name, machine: machine(r.w), folder: common.endsWith("/.git") ? common.slice(0, -5) : null } };
        out.push(head);
        hang(head);
      } else {
        const top = { ...r, tree: null, kids: 0 };
        out.push(top);
        if (r.g && !r.g.linked && !placed.has(r.g.repo)) { placed.add(r.g.repo); hang(top); }
      }
    }
    return { all, out, homeId };
  }

  function locate(out, id, edge, homeId) {
    const from = out.findIndex(r => r.w.id === id && !r.head);
    const lead = out[from];
    if (!lead || lead.folded || id === homeId || machine(lead.w) !== edge.machine || parent(lead) !== edge.parent) return null;
    const end = from + (lead.tree ? 1 : 1 + (lead.members?.length ?? 0));
    const at = out.findIndex(r => r.w.id !== homeId && machine(r.w) === edge.machine && parent(r) === edge.parent && groupKey(r) === edge.anchor);
    if (at < 0 || (at >= from && at < end)) return null;
    const to = edge.after ? at + 1 + (out[at].members?.length ?? 0) : at;
    return { from, end, to: to >= end ? to - (end - from) : to };
  }

  // `list`, `ps`: spaces() and panes(), when the caller's draw has read them (each read copies the whole list).
  function reconcile(list = spaces(), ps = panes()) {
    const now = Date.now(), { all, out, homeId } = snapshot(now, list, ps), order = all.map(w => w.id);
    if (flight) {
      // Additions/removals can share the echo frame; compare the order of IDs that still exist on both sides.
      const actualIds = new Set(order), sentIds = new Set(flight.after);
      const echo = order.filter(id => sentIds.has(id));
      const expected = flight.after.filter(id => actualIds.has(id));
      if (echo.every((id, i) => id === expected[i]) || due(now)) flight = null;
    }
    const intent = drop ?? flight?.intent;
    const found = intent && locate(out, intent.id, intent.edge, homeId);
    if (found) {
      const { from, end, to } = found;
      out.splice(to, 0, ...out.splice(from, end - from));
      if (intent.edge.parent && !foldedRepos.has(intent.edge.parent)) out.forEach((r, i) => {
        if (parent(r) === intent.edge.parent) r.tree = out[i + 1] && parent(out[i + 1]) === intent.edge.parent ? "├─" : "└─";
      });
    } else {
      drop = null; // The shown boundary is no longer legal. Don't substitute a different one.
    }
    if (!flight) {
      // Keep keys in the same order as the rows by realigning the host. Home and folded worktrees count;
      // a synthetic row does not. The drop changes this same order, not the indexes of a separate batch.
      const key = r => machine(r.w) ?? "";
      const real = out.filter(r => !r.head).sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
      const changed = new Set();
      const move = (r, to) => {
        const id = r.w.id, from = order.indexOf(id);
        if (from === to) return;
        run("space.move", { id, index: to + 1 });
        changed.add(machine(r.w));
        order.splice(to, 0, order.splice(from, 1)[0]);
      };
      // A plain drop normally needs only its own move. Simulate it before fixing any remaining indexes.
      if (drop) {
        const to = real.findIndex(r => r.w.id === drop.id);
        move(real[to], to);
      }
      real.forEach(move);
      if (changed.size) flight = { after: order, at: now, machines: [...changed], intent: drop };
      drop = null;
    }
    return out.filter(r => (r.head || shown.has(r.w.id)) && !r.folded && r.w.id !== homeId);
  }

  function preview(rows, key, y, drawn) {
    const at = rows.findIndex(e => e.key === key), lead = rows[at];
    let end = at + 1;
    const sibling = parent(lead.r);
    if (!sibling) while (rows[end]?.r?.tree) end++;
    const block = rows.slice(at, end), rest = [...rows.slice(0, at), ...rows.slice(end)];
    y = Math.max(0, Math.min(y, rest.length * pitch));
    let slot = at, edge = null;
    const under = rest[Math.min(rest.length - 1, Math.floor((y - row / 2) / pitch))];
    if (drawn && (!under || under.m === lead.m)) {
      const inScope = e => e?.r && e.m === lead.m && parent(e.r) === sibling;
      for (let j = 0; j <= rest.length; j++) {
        const next = rest[j];
        // No root gap inside an expanded group: its last worktree stands for the whole group at its bottom edge.
        if (!sibling && next?.r?.tree) continue;
        let k = j - 1;
        if (!sibling) while (rest[k]?.r?.tree) k--;
        const previous = rest[k], anchor = inScope(next) ? next : inScope(previous) ? previous : null;
        if (anchor && Math.abs(j * pitch - y) < Math.abs(slot * pitch - y)) {
          slot = j;
          edge = { machine: lead.m, parent: sibling, anchor: groupKey(anchor.r), after: anchor !== next };
        }
      }
    }
    return { block, rest, slot, y, edge };
  }

  return {
    rows: reconcile, due, preview,
    place(id, edge) { drop = { id, edge }; reconcile(); },
    openCheckout({ w, g }) {
      const now = Date.now();
      if (now - (opening.get(g.repo) ?? -Infinity) < OPENING) return;
      opening.set(g.repo, now);
      run("space.new", { folder: w.folder, machine: w.machine ?? "" });
    },
  };
}
