// Native GPUI project picker for extras (ctrl-f): styled like `fzf --layout=reverse --border=none`.
// Works locally on macOS/Linux/Windows via fs/promises and on remote machines (WSL, SSH) via exec(..., { on }).
import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, spaces, panes, machines, home, run, exec, closeOverlay, props, window, settings } from "herdr";
import * as fs from "fs/promises";

const ROW = 24;

export const norm = (p) => (p ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
const inside = (path, folder) => {
  const a = norm(path), b = norm(folder);
  return Boolean(a && b) && (a === b || a.startsWith(`${b}/`));
};
export const tilde = (path, userHome) => {
  const p = norm(path), h = norm(userHome);
  return h && (p === h || p.startsWith(`${h}/`)) ? `~${p.slice(h.length)}` : path;
};
export const baseOf = (path) => norm(path).split("/").pop() || path;

// POSIX remote listing: prints $HOME on line 1, then depth-1 dirs in ~ and ~/projects, and depth-1..2 in ~/organizations.
const REMOTE_LIST = `
printf '%s\\n' "$HOME"
for base in "$HOME" "$HOME/projects"; do
  [ -d "$base" ] || continue
  for d in "$base"/*/ "$base"/.[!.]*/; do
    [ -d "$d" ] && printf '%s\\n' "\${d%/}"
  done
done
if [ -d "$HOME/organizations" ]; then
  for d in "$HOME"/organizations/*/ "$HOME"/organizations/*/*/; do
    [ -d "$d" ] && printf '%s\\n' "\${d%/}"
  done
fi
`;

async function subdirs(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const out = [];
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = `${dir}/${e.name}`;
      if (e.isDirectory()) out.push(full);
      else if (e.isSymbolicLink()) {
        try { if ((await fs.stat(full)).isDirectory()) out.push(full); } catch {}
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function listLocal() {
  const root = norm(home());
  const top = await subdirs(root);
  const SKIP_DOT = new Set([".Trash", ".cache", ".npm", ".yarn", ".cargo", ".rustup", ".gradle", ".nvm", ".vim", ".zsh_sessions", ".zsh-cache", ".DS_Store"]);
  try {
    for (const e of await fs.readdir(root, { withFileTypes: true })) {
      if (!e.name.startsWith(".") || SKIP_DOT.has(e.name)) continue;
      const full = `${root}/${e.name}`;
      if (e.isDirectory()) top.push(full);
      else if (e.isSymbolicLink()) {
        try { if ((await fs.stat(full)).isDirectory()) top.push(full); } catch {}
      }
    }
  } catch {}
  const projects = await subdirs(`${root}/projects`);
  const orgParents = await subdirs(`${root}/organizations`);
  const orgs = (await Promise.all(orgParents.map(subdirs))).flat();
  const dirs = [...new Set([...top, ...projects, ...orgParents, ...orgs].map(norm))].sort((a, b) => a.localeCompare(b));
  return { userHome: root, dirs };
}

async function listRemote(machine) {
  const r = await exec("sh", ["-c", REMOTE_LIST], { on: machine, timeout: 10000 });
  if (r.code !== 0) throw new Error(r.stderr?.trim() || `Couldn't list folders on ${machine}`);
  const lines = r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  const userHome = norm(lines[0] ?? "");
  const SKIP = new Set([".cache", ".npm", ".yarn", ".cargo", ".rustup", ".gradle", ".nvm", ".vim", ".local"]);
  const dirs = [...new Set(lines.slice(1).map(norm).filter((p) => !SKIP.has(baseOf(p))))].sort((a, b) => a.localeCompare(b));
  return { userHome, dirs };
}

// Match an existing space on `machine` working in `folder`, else create one there.
export function openProjectDir(folder, machine) {
  const target = norm(folder), ps = panes();
  for (const space of spaces()) {
    if ((space.machine ?? null) !== (machine ?? null)) continue;
    const own = norm(space.folder);
    // A space for a project inside this folder is that project's: picking ~/projects isn't picking it.
    if (own && own !== target && inside(own, target)) continue;
    const tabIds = new Set((space.tabs ?? []).map((t) => t.id));
    const dirs = [own, ...ps.filter((p) => tabIds.has(p.tab) && p.cwd).map((p) => norm(p.cwd))];
    if (dirs.some((d) => d && inside(d, target))) {
      return run("space.select", { id: space.id });
    }
  }
  return run("space.new", { folder, ...(machine ? { machine } : {}) });
}

function existingFolders(machine) {
  const ps = panes(), open = new Set();
  for (const s of spaces()) {
    if ((s.machine ?? null) !== (machine ?? null)) continue;
    if (s.folder) open.add(norm(s.folder));
    const tabIds = new Set((s.tabs ?? []).map((t) => t.id));
    for (const p of ps) if (tabIds.has(p.tab) && p.cwd) open.add(norm(p.cwd));
  }
  return open;
}

// Cache directory listings per machine for instant re-opening; still refreshes in background.
const dirCache = new Map();

export function initProjectPicker(view, cx) {
  const p = props();
  const remotes = machines().filter((m) => m.name && !m.temporary).map((m) => m.name);
  view.targets = [null, ...remotes];
  // Default to the active space's machine; on Windows with a remote (e.g. wsl) and no active remote space, prefer the first remote.
  const activeMachine = p?.machine || null;
  view.machine = activeMachine && view.targets.includes(activeMachine) ? activeMachine
    : (window()?.platform === "windows" && remotes.length ? remotes[0] : null);
  view.at = 0;
  view.filter = "";
  view.scrollTop = 0;
  view.listH = undefined;
  view.pointerY = undefined;
  view.loading = false;
  view.error = null;
  view.input = InputState.new({ placeholder: "" });
  view.input.on("change", (_e, cx) => { view.filter = view.input.value(); view.at = 0; view.scrollTop = 0; cx.notify(); });
  view.input.on("submit", () => choose(view, itemsOf(view).items[view.at]));
  view.input.focus();
  loadMachine(view, view.machine, cx);
}

function loadMachine(view, machine, cx) {
  const key = machine ?? "";
  const req = (view.loadSeq = (view.loadSeq ?? 0) + 1);
  view.error = null;
  view.loading = !dirCache.has(key);
  cx.notify();
  cx.spawn(async (cx) => {
    try {
      const data = machine ? await listRemote(machine) : await listLocal();
      dirCache.set(key, data);
      if (view.loadSeq === req) { view.loading = false; view.error = null; cx.notify(); }
    } catch (e) {
      if (view.loadSeq === req) { view.loading = false; view.error = e instanceof Error ? e.message : String(e); cx.notify(); }
    }
  });
}

function itemsOf(view) {
  const key = view.machine ?? "";
  const data = dirCache.get(key);
  const userHome = data?.userHome ?? (view.machine ? "" : norm(home()));
  const open = existingFolders(view.machine);
  const all = new Set(data?.dirs ?? []);
  for (const s of spaces()) {
    if ((s.machine ?? null) === (view.machine ?? null) && s.folder) all.add(norm(s.folder));
  }
  const tokens = view.filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const items = [];
  for (const dir of all) {
    const shown = tilde(dir, userHome);
    const name = baseOf(dir);
    const hay = shown.toLowerCase();
    if (tokens.length && !tokens.every((tok) => hay.includes(tok))) continue;
    const isOpen = [...open].some((d) => inside(d, dir));
    const nameHit = tokens.length ? tokens.every((tok) => name.toLowerCase().includes(tok)) : false;
    items.push({ dir, shown, isOpen, nameHit });
  }
  items.sort((a, b) =>
    Number(b.nameHit) - Number(a.nameHit) ||
    Number(b.isOpen) - Number(a.isOpen) ||
    a.shown.localeCompare(b.shown)
  );
  return { items, total: all.size };
}

function choose(view, item) {
  if (!item) return;
  closeOverlay(props().overlay);
  openProjectDir(item.dir, view.machine);
}

function switchMachine(view, next, cx) {
  if (next === view.machine) return;
  view.machine = next;
  view.at = 0;
  view.scrollTop = 0;
  loadMachine(view, next, cx);
}

export function renderProjectPicker(view) {
  const t = theme();
  const s = settings();
  const font = s?.font_family || "JetBrains Mono";
  const fontSize = Number(s?.font_size) || 13;
  const zoom = Number(s?.zoom) || 1;
  const { items, total } = itemsOf(view);
  view.at = Math.min(view.at, Math.max(0, items.length - 1));
  const hasRemotes = view.targets.length > 1;
  const listH = view.listH ?? 480;
  const maxScroll = Math.max(0, items.length * ROW - listH);
  let top = Math.max(0, Math.min(view.scrollTop ?? 0, maxScroll));
  const pointed = view.pointerY === undefined ? -1 : Math.floor((view.pointerY + top) / ROW);
  if (view.at >= 0 && view.at < items.length && view.at !== pointed && view.listH !== undefined) {
    top = Math.max(0, Math.min(top, view.at * ROW, maxScroll), (view.at + 1) * ROW - listH);
  }
  view.scrollTop = top;
  const first = Math.floor(top / ROW), end = Math.min(items.length, Math.ceil((top + listH) / ROW));

  const row = (item, i) => {
    const on = view.at === i;
    return h_flex().id(`proj-${i}`).w_full().h(ROW).px(4).gap(6).items_center().flex_none().cursor_pointer()
      .when(on, (el) => el.bg(t.raised))
      .on_hover((over, cx) => { if (over && view.at !== i) { view.at = i; cx.notify(); } })
      .on_click(() => choose(view, item))
      .child(div().w(12).flex_none().text_color(on ? (t.ansi1 || t.accent) : "#00000000").font_bold().child(">"))
      .child(div().flex_1().min_w(0).truncate()
        .text_color(on ? t.foreground : t.muted)
        .when(on, (el) => el.font_medium())
        .child(item.shown))
      .when(item.isOpen, (el) => el.child(div().flex_none().pr(4).text_size(fontSize - 1).text_color(t.ansi2 || t.done).child("●")));
  };

  const renderedRows = [];
  for (let i = first; i < end; i++) renderedRows.push(row(items[i], i).absolute().left(0).right(0).top(i * ROW - top));

  const promptLabel = view.machine ? `Herdr project (${view.machine})> ` : "Herdr project> ";

  return v_flex().id("project-picker").size_full().min_h(0).p(12).gap(4)
    .rounded(8).border(1).border_color(t.border).bg(t.background).shadow_2xl()
    .font_family(font).text_size(fontSize).line_height(`${ROW}px`)
    .on_key_down((e, cx) => {
      if (e.key === "escape" || (e.modifiers.control && e.key === "c")) return closeOverlay(props().overlay);
      if (e.key === "down" || (e.modifiers.control && (e.key === "n" || e.key === "j"))) {
        if (items.length) view.at = (view.at + 1) % items.length;
      } else if (e.key === "up" || (e.modifiers.control && (e.key === "p" || e.key === "k"))) {
        if (items.length) view.at = (view.at <= 0 ? items.length : view.at) - 1;
      } else if (e.key === "tab" && hasRemotes) {
        const idx = view.targets.indexOf(view.machine);
        const next = view.targets[(idx + (e.modifiers.shift ? view.targets.length - 1 : 1)) % view.targets.length];
        switchMachine(view, next, cx);
      } else return;
      cx.stop_propagation();
      cx.notify();
    })
    // Prompt line (`Herdr project> ...`), fzf --layout=reverse style
    .child(h_flex().h(26).flex_none().items_center().gap(2)
      .child(div().flex_none().font_medium().text_color(t.ansi4 || t.accent).child(promptLabel))
      .child(Input.new(view.input).flex_1().h_full().font_family(font).text_size(fontSize).text_color(t.foreground))
      .when(hasRemotes, (el) => el.child(h_flex().flex_none().gap(4).items_center()
        .children(view.targets.map((m) => {
          const on = m === view.machine;
          return div().id(`pm-${m ?? "local"}`).h(20).px(6).flex().items_center().rounded(4).cursor_pointer().text_size(fontSize - 1)
            .bg(on ? t.raised : "#00000000").text_color(on ? (t.ansi4 || t.foreground) : t.dim)
            .hover((st) => st.text_color(t.foreground))
            .on_click((_e, cx) => switchMachine(view, m, cx))
            .child(m ?? "local");
        })))))
    // fzf counter + horizontal rule (`  12/48 ────────────────────────`)
    .child(h_flex().h(18).flex_none().items_center().gap(8).pl(18)
      .child(div().flex_none().text_size(fontSize - 1).text_color(t.ansi3 || t.dim).child(view.loading ? "…" : `${items.length}/${total}`))
      .child(div().flex_1().h(1).bg(t.border))
      .when(hasRemotes, (el) => el.child(div().flex_none().text_size(fontSize - 2).text_color(t.dim).child("Tab: machine"))))
    // Single-line list filling the rest of the modal
    .child(div().id("proj-list").flex_1().min_h(0).relative().overflow_hidden()
      .on_size_change((size, cx) => {
        const h = Math.max(ROW, Math.floor(size.height / zoom));
        if (h !== view.listH) { view.listH = h; cx.notify(); }
      })
      .on_mouse_move((e) => { view.pointerY = e.local_position.y / zoom; })
      .on_hover((on) => { if (!on) view.pointerY = undefined; })
      .on_scroll_wheel((e, cx) => {
        cx.stop_propagation();
        const next = Math.max(0, Math.min(view.scrollTop - e.delta.y / zoom, maxScroll));
        view.scrollTop = next;
        if (items.length) view.at = Math.min(Math.max(view.at, Math.ceil(next / ROW)), Math.floor((next + listH) / ROW) - 1);
        cx.notify();
      })
      .when(Boolean(view.error), (el) => el.child(div().py(16).px(18).text_color(t.ansi1 || t.blocked).child(view.error)))
      .when(!view.error && view.loading && items.length === 0, (el) => el.child(div().py(16).px(18).text_color(t.dim).child(`Scanning ${view.machine ?? "local"}…`)))
      .when(!view.error && !view.loading && items.length === 0, (el) => el.child(div().py(16).px(18).text_color(t.dim).child("No matches")))
      .when(items.length > 0, (el) => el.children(renderedRows)));
}
