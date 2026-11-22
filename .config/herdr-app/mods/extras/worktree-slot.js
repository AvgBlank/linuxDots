// Quick worktree slots (alt-u root, alt-i/o/p slots 1/2/3) for extras:
// works locally (macOS/Linux/Windows) and on remote machines (WSL, SSH) with zero fzf or local Python.
import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, home, appHome, exec, notify, openOverlay, closeOverlay, props, readTextFile, writeTextFile, settings } from "herdr";
import * as fs from "fs/promises";
import { norm, tilde, baseOf, openProjectDir } from "./project.js";

const ROW = 24;
const STATE = () => `${appHome()}/data/extras/worktree-slots.json`;
const CREATE_ID = "__create__";

// Keep `${primary}/.git` for local repos (backwards-compatible with existing slots), namespace remotes as `${machine}:${primary}/.git`.
export const slotKey = (primary, machine) => (machine ? `${machine}:${norm(primary)}/.git` : `${norm(primary)}/.git`);
export const branchSlug = (branch) => branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
const randomBranch = () => `worktree-${Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0")}`;

export function parseWorktrees(porcelain) {
  const blocks = (porcelain ?? "").trim().split(/\r?\n\r?\n+/).filter(Boolean);
  const items = [];
  for (const block of blocks) {
    const info = {};
    for (const line of block.split(/\r?\n/)) {
      const i = line.indexOf(" ");
      if (i < 0) info[line] = "";
      else info[line.slice(0, i)] = line.slice(i + 1);
    }
    if (!info.worktree) continue;
    items.push({
      path: norm(info.worktree),
      branch: (info.branch ?? "").replace(/^refs\/heads\//, ""),
      bare: "bare" in info,
      prunable: "prunable" in info,
    });
  }
  if (!items.length || items[0].bare) throw new Error("Worktree slots need a non-bare repository checkout.");
  return { primary: items[0].path, linked: items.slice(1).filter((x) => !x.prunable) };
}

async function readSlots() {
  const text = await readTextFile(STATE()).catch(() => null);
  try { return { state: JSON.parse(text ?? "{}"), disk: text }; } catch { return { state: {}, disk: text }; }
}

async function saveSlot(repoKey, slots, slot, path) {
  await fs.mkdir(`${appHome()}/data/extras`, { recursive: true }).catch(() => {});
  for (let attempt = 0; attempt < 2; attempt++) {
    const { state, disk } = await readSlots();
    state[repoKey] = { ...slots, [slot]: path };
    try {
      await writeTextFile(STATE(), JSON.stringify(state), disk);
      return;
    } catch (e) {
      if (attempt === 1) notify({ title: "Couldn't save worktree slot", body: String(e), level: "warning" });
    }
  }
}

async function machineHome(machine) {
  if (!machine) return norm(home());
  const r = await exec("sh", ["-c", 'printf "%s" "$HOME"'], { on: machine, timeout: 5000 });
  if (r.code !== 0 || !r.stdout.trim()) throw new Error(`Couldn't resolve $HOME on ${machine}`);
  return norm(r.stdout.trim());
}

async function createWorktree(primary, branchName, machine) {
  const branch = (branchName || "").trim() || randomBranch();
  const slug = branchSlug(branch) || randomBranch();
  const rootHome = await machineHome(machine);
  const path = `${rootHome}/.herdr/worktrees/${baseOf(primary)}/${slug}`;
  const check = await exec("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: primary, on: machine });
  const args = check.code === 0
    ? ["worktree", "add", path, branch]
    : ["worktree", "add", "-b", branch, path, "HEAD"];
  const r = await exec("git", args, { cwd: primary, on: machine, timeout: 30000 });
  if (r.code !== 0) throw new Error(r.stderr?.trim() || r.stdout?.trim() || "git worktree add failed");
  return norm(path);
}

// Entry point for alt-u (root) and alt-i/o/p (1/2/3).
export async function openWorktreeSlot(slot, cwd, machine) {
  if (!cwd) return notify({ title: `Worktree ${slot}`, body: "No working directory on the focused pane.", level: "warning" });
  const r = await exec("git", ["worktree", "list", "--porcelain"], { cwd, on: machine, timeout: 10000 });
  if (r.code !== 0) return notify({ title: `Worktree ${slot}`, body: r.stderr?.trim() || "Not a git repository.", level: "warning" });
  let parsed;
  try { parsed = parseWorktrees(r.stdout); } catch (e) {
    return notify({ title: `Worktree ${slot}`, body: e instanceof Error ? e.message : String(e), level: "warning" });
  }
  const { primary, linked } = parsed;
  if (slot === "root") return openProjectDir(primary, machine);
  const repoKey = slotKey(primary, machine);
  const { state } = await readSlots();
  const live = new Set(linked.map((x) => x.path));
  const slots = Object.fromEntries(Object.entries(state[repoKey] ?? {}).filter(([, v]) => live.has(norm(v))).map(([k, v]) => [k, norm(v)]));
  if (slots[slot]) return openProjectDir(slots[slot], machine);
  const userHome = await machineHome(machine).catch(() => (machine ? "" : norm(home())));
  openOverlay({
    mod: "extras", kind: "dialog", frame: "none", width: 0.7, height: 0.7,
    props: { wtPicker: true, slot, machine, primary, repoKey, linked, slots, userHome },
  });
}

export function initWtPicker(view, cx) {
  const p = props();
  view.wt = {
    slot: p.slot,
    machine: p.machine ?? null,
    primary: p.primary,
    repoKey: p.repoKey,
    linked: p.linked ?? [],
    slots: p.slots ?? {},
    userHome: p.userHome ?? "",
    mode: "pick", // "pick" | "create"
    busy: false,
    error: null,
  };
  view.at = 0;
  view.filter = "";
  view.scrollTop = 0;
  view.listH = undefined;
  view.pointerY = undefined;
  view.input = InputState.new({ placeholder: "" });
  view.input.on("change", (_e, cx) => { view.filter = view.input.value(); view.at = 0; view.scrollTop = 0; cx.notify(); });
  view.input.on("submit", (_e, cx) => submitWt(view, cx));
  view.input.focus();
}

function wtItems(view) {
  const used = new Set(Object.values(view.wt.slots));
  const free = view.wt.linked.filter((x) => !used.has(x.path));
  const all = [
    ...free.map((x) => ({
      id: x.path,
      path: x.path,
      branch: x.branch || baseOf(x.path),
      shown: tilde(x.path, view.wt.userHome),
      create: false,
    })),
    { id: CREATE_ID, path: "", branch: "+ Create a new worktree…", shown: "", create: true },
  ];
  const tokens = view.filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const items = tokens.length
    ? all.filter((x) => tokens.every((tok) => `${x.branch} ${x.shown}`.toLowerCase().includes(tok)))
    : all;
  return { items, total: all.length };
}

function submitWt(view, cx) {
  if (view.wt.busy) return;
  if (view.wt.mode === "create") {
    const branchName = view.input.value().trim();
    view.wt.busy = true;
    view.wt.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const path = await createWorktree(view.wt.primary, branchName, view.wt.machine);
        await saveSlot(view.wt.repoKey, view.wt.slots, view.wt.slot, path);
        closeOverlay(props().overlay);
        openProjectDir(path, view.wt.machine);
      } catch (e) {
        view.wt.busy = false;
        view.wt.error = e instanceof Error ? e.message : String(e);
        cx.notify();
      }
    });
    return;
  }
  const item = wtItems(view).items[view.at];
  if (!item) return;
  if (item.create) {
    view.wt.mode = "create";
    view.wt.error = null;
    view.filter = "";
    view.input.set_value("");
    view.input.focus();
    cx.notify();
    return;
  }
  view.wt.busy = true;
  cx.spawn(async () => {
    await saveSlot(view.wt.repoKey, view.wt.slots, view.wt.slot, item.path);
    closeOverlay(props().overlay);
    openProjectDir(item.path, view.wt.machine);
  });
}

export function renderWtPicker(view) {
  const t = theme();
  const s = settings();
  const font = s?.font_family || "JetBrains Mono";
  const fontSize = Number(s?.font_size) || 13;
  const zoom = Number(s?.zoom) || 1;
  const wt = view.wt;
  const { items, total } = wtItems(view);
  view.at = Math.min(view.at, Math.max(0, items.length - 1));
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
    return h_flex().id(`wt-${i}`).w_full().h(ROW).px(4).gap(6).items_center().flex_none().cursor_pointer()
      .when(on, (el) => el.bg(t.raised))
      .on_hover((over, cx) => { if (over && view.at !== i) { view.at = i; cx.notify(); } })
      .on_click((_e, cx) => { view.at = i; submitWt(view, cx); })
      .child(div().w(12).flex_none().text_color(on ? (t.ansi1 || t.accent) : "#00000000").font_bold().child(">"))
      .child(div().flex_none().text_color(item.create ? (t.ansi4 || t.accent) : on ? t.foreground : t.muted).when(on, (el) => el.font_medium()).child(item.branch))
      .when(Boolean(item.shown), (el) => el.child(div().flex_1().min_w(0).pl(8).truncate().text_color(t.dim).child(item.shown)));
  };

  const renderedRows = [];
  for (let i = first; i < end; i++) renderedRows.push(row(items[i], i).absolute().left(0).right(0).top(i * ROW - top));

  const mTag = wt.machine ? ` (${wt.machine})` : "";
  const promptLabel = wt.mode === "create"
    ? "Branch name [Enter picks one]> "
    : `Worktree ${wt.slot}${mTag}> `;

  return v_flex().id("wt-picker").size_full().min_h(0).p(12).gap(4)
    .rounded(8).border(1).border_color(t.border).bg(t.background).shadow_2xl()
    .font_family(font).text_size(fontSize).line_height(`${ROW}px`)
    .on_key_down((e, cx) => {
      if (e.key === "escape" || (e.modifiers.control && e.key === "c")) {
        if (wt.mode === "create" && !wt.busy) {
          wt.mode = "pick"; wt.error = null; view.filter = ""; view.input.set_value(""); view.input.focus();
          cx.stop_propagation(); cx.notify();
          return;
        }
        return closeOverlay(props().overlay);
      }
      if (wt.mode !== "pick") return;
      if (e.key === "down" || (e.modifiers.control && (e.key === "n" || e.key === "j"))) {
        if (items.length) view.at = (view.at + 1) % items.length;
      } else if (e.key === "up" || (e.modifiers.control && (e.key === "p" || e.key === "k"))) {
        if (items.length) view.at = (view.at <= 0 ? items.length : view.at) - 1;
      } else return;
      cx.stop_propagation();
      cx.notify();
    })
    .child(h_flex().h(26).flex_none().items_center().gap(2)
      .child(div().flex_none().font_medium().text_color(t.ansi4 || t.accent).child(promptLabel))
      .child(Input.new(view.input).flex_1().h_full().font_family(font).text_size(fontSize).text_color(t.foreground)))
    .child(h_flex().h(18).flex_none().items_center().gap(8).pl(18)
      .child(div().flex_none().text_size(fontSize - 1).text_color(t.ansi3 || t.dim).child(wt.mode === "create" ? (wt.busy ? "Creating…" : "new worktree") : `${items.length}/${total}`))
      .child(div().flex_1().h(1).bg(t.border))
      .child(div().flex_none().text_size(fontSize - 2).text_color(t.dim).child(wt.mode === "create" ? "Enter: create · Esc: back" : "Choose a checkout or create one · Esc cancels")))
    .when(Boolean(wt.error), (el) => el.child(div().px(18).py(6).text_color(t.ansi1 || t.blocked).child(wt.error)))
    .when(wt.mode === "pick", (el) => el.child(div().id("wt-list").flex_1().min_h(0).relative().overflow_hidden()
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
      .children(renderedRows)));
}
