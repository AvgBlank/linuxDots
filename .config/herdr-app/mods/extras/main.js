import { View, div } from "gpui-kit";
import { spaces, panes, agents, focused, theme, run, hc, exec, home, appHome, window, openOverlay, nextCommand, shared, setShared, notify, readTextFile, writeTextFile, props, checking } from "herdr";
import * as fs from "fs/promises";
import { Buffer } from "buffer";
import { initProjectPicker, renderProjectPicker, openFzfProjectPicker, renderFzfTabBar } from "./project.js";
import { openWorktreeSlot, initWtPicker, renderWtPicker } from "./worktree-slot.js";
import { initCopyMode, renderCopyMode } from "./copy-mode.js";

// Vim, Neovim and fzf get the key instead of Herdr (same match as the old herdr.py).
const EDITOR = /^g?\.?(?:view|l?n?vim?x?|fzf)(?:diff)?(?:-wrapped)?$/;
const HELPER = () => `${appHome()}/mods/extras/helper.py`;
const SCROLLBACK = 'f=$(mktemp -t scrollback); hc read "$1" > "$f"; ${EDITOR:-nvim} + "$f"; rm -f "$f"';
const quote = (s) => JSON.stringify(s); // AppleScript strings escape like JSON
const xmlEsc = (s) => String(s).replace(/\r?\n/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
// Windows Toast via built-in PowerShell + WinRT; uses PowerShell's registered AUMID so Windows 10/11 never drops the toast.
const WIN_AUMID = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";
function sendOsNotification(title, body) {
  const plat = window()?.platform;
  if (plat === "macos") {
    exec("osascript", ["-e", `display notification ${quote(body)} with title ${quote(title)}`]).catch(() => {});
  } else if (plat === "windows") {
    const xml = `<toast><visual><binding template="ToastGeneric"><text>${xmlEsc(title)}</text><text>${xmlEsc(body)}</text></binding></visual></toast>`;
    const ps = [
      "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
      "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null",
      "$x = New-Object Windows.Data.Xml.Dom.XmlDocument",
      `$x.LoadXml(@'\n${xml}\n'@)`,
      "$t = [Windows.UI.Notifications.ToastNotification]::new($x)",
      `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${WIN_AUMID}').Show($t)`,
    ].join("\n");
    const enc = Buffer.from(ps, "utf16le").toString("base64");
    exec("powershell", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", enc]).catch(() => {});
  } else if (plat === "linux") {
    exec("notify-send", [title, body]).catch(() => {});
  }
}
// Inline equalize for remote machines (runs python3 on the remote machine against its local hc, zero host Python needed).
const REMOTE_EQUALIZE = `
import json, subprocess, sys
def core(*calls):
    lines = [{"jsonrpc":"2.0","id":0,"method":"hello","params":{}}]
    lines += [{"jsonrpc":"2.0","id":i+1,"method":m,"params":p} for i,(m,p) in enumerate(calls)]
    r = subprocess.run(["hc","connect"], input="".join(json.dumps(x)+"\\n" for x in lines), capture_output=True, text=True, timeout=10)
    rep = {x.get("id"): x for x in (json.loads(l) for l in r.stdout.splitlines() if l.strip())}
    for i in range(1, len(calls)+1):
        if "error" in rep.get(i, {"error":"no reply"}): raise RuntimeError(str(rep.get(i,{}).get("error","no reply")))
    return [rep[i]["result"] for i in range(1, len(calls)+1)]
def leaves(n):
    k = n.get("children") if n.get("type") in ("row","column") else None
    return sum(map(leaves, k)) if k else 1
def even(n):
    k = n.get("children") if n.get("type") in ("row","column") else None
    if not k: return
    if all("px" not in (c.get("size") or {}) for c in k):
        tot = leaves(n)
        for c in k: c["size"] = {"weight": round(leaves(c)/tot, 6)}
    for c in k: even(c)
tab = sys.argv[1]
for _ in range(3):
    (doc,) = core(("doc.get", {"name":"herdr-app"}))
    val = doc["value"]
    found = [c for s in val.get("spaces",[]) for c in s.get("tabs",[]) if c.get("id") == tab]
    if not found: raise RuntimeError(f"no tab {tab}")
    even(found[0]["root"])
    try:
        core(("doc.set", {"name":"herdr-app","value":val,"version":doc["version"]}))
        raise SystemExit(0)
    except RuntimeError as e:
        if "conflict" not in str(e): raise
raise RuntimeError("the layout kept changing; try again")
`;
// Fixed tab numbers, as the TUI's tab-slots.json: { [space]: { [tab]: number } }. Closing a tab leaves its number free.
// Shared as "tab-slots", the same shape, for the tab bar (t3-tabs) and other windows' copies of this mod.
const SLOTS = () => `${appHome()}/data/tab-slots.json`;
const shownTabs = (space) => space.tabs;
const lowestFree = (slots) => { let n = 1; while (Object.values(slots).includes(n)) n++; return n; };

// Merges keys.custom.json into base keys.json (returns new JSON string only when a change is needed, else null).
// Clears any platform-default `terminal` entry that would shadow a custom `global` key (`terminal` beats `global` in Herdr).
export function mergeCustomKeys(baseText, customText) {
  if (!baseText || !customText) return null;
  let base, custom;
  try { base = JSON.parse(baseText); custom = JSON.parse(customText); } catch { return null; }
  if (!base || typeof base !== "object" || !custom || typeof custom !== "object") return null;
  let changed = false;
  for (const [section, bindings] of Object.entries(custom)) {
    if (!bindings || typeof bindings !== "object") continue;
    const dest = (base[section] && typeof base[section] === "object") ? base[section] : (base[section] = {}, changed = true, base[section]);
    for (const [k, v] of Object.entries(bindings)) {
      if (JSON.stringify(dest[k]) !== JSON.stringify(v)) { dest[k] = v; changed = true; }
    }
  }
  if (base.terminal && typeof base.terminal === "object" && custom.global && typeof custom.global === "object") {
    for (const k of Object.keys(custom.global)) {
      if (k in base.terminal && !(custom.terminal && k in custom.terminal)) {
        delete base.terminal[k];
        changed = true;
      }
    }
  }
  return changed ? JSON.stringify(base, null, 2) + "\n" : null;
}

// Automatically applies keys.custom.json onto this machine's keys.json on startup — zero manual scripts needed.
async function syncCustomKeys() {
  const customPath = `${appHome()}/keys.custom.json`, keysPath = `${appHome()}/keys.json`;
  const [customText, baseText] = await Promise.all([
    readTextFile(customPath).catch(() => null),
    readTextFile(keysPath).catch(() => null),
  ]);
  const next = mergeCustomKeys(baseText, customText);
  if (next) await writeTextFile(keysPath, next, baseText).catch((e) => console.log(`extras syncCustomKeys: ${e}`));
}

// Handles extras.<command> keys from keys.json, and renders the project picker when opened as a dialog.
export default class Extras extends View {
  init(_props, cx) {
    if (props()?.projectPicker) {
      initProjectPicker(this, cx);
      return;
    }
    if (props()?.fzfTabs) {
      return;
    }
    if (props()?.wtPicker) {
      initWtPicker(this, cx);
      return;
    }
    if (props()?.copyMode) {
      initCopyMode(this, cx);
      return;
    }
    if (!checking()) cx.spawn(() => syncCustomKeys());
    this.cur = this.prev = null;
    // slots: this copy's numbers. disk: the file's text as last read or written here (writes only replace that).
    // pending: tabs tab-N just made, not yet in spaces(). sharedText: the "tab-slots" this copy last published.
    this.slots = this.disk = this.sharedText = null;
    this.placing = new Set();
    this.pending = new Map();
    this.ready = (async () => {
      const text = await readTextFile(SLOTS()).catch(() => null);
      this.disk = text;
      try { this.slots = JSON.parse(text ?? "{}"); } catch {
        this.slots = {};
        fs.writeFile(`${SLOTS()}.bad`, text).catch(() => {});
        notify({ title: "Tab numbers reset", body: "data/tab-slots.json couldn't be read; it's kept as tab-slots.json.bad.", level: "warning", timeout: 6000 });
      }
      this.reconcile(cx);
    })();
    cx.spawn(() => this.ready);
    cx.timer.every(15000, (cx) => cx.notify()); // re-checks agents for notifyChanges
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        try { await this.handle(c, cx); } catch (e) { console.log(`extras ${c}: ${e}`); }
      }
    });
  }

  focusedPane() {
    const f = focused();
    return f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  }

  focusedTerminal() {
    return focused()?.terminal ?? null;
  }

  focusedCwd() {
    return focused()?.cwd || null;
  }

  // True when an editor has the focus and got the key.
  async forward(key) {
    const p = this.focusedPane();
    const prog = p?.program;
    if (!p?.terminal || !prog || !(EDITOR.test(prog.key) || EDITOR.test(prog.name.toLowerCase()))) return false;
    await hc(["keys", p.terminal, key]);
    return true;
  }

  // Runs argv in a terminal shown as a dialog (on `machine` when remote); the dialog closes when it exits.
  async popup(argv, size = 0.8, machine = null) {
    const cwd = this.focusedCwd();
    const args = ["run", "--bg", "--json", "--rm", "--no-parent"];
    if (machine) args.push("--on", machine);
    if (cwd) args.push("--cwd", cwd);
    else if (!machine) args.push("--cwd", home());
    args.push("--", ...argv);
    const r = await hc(args);
    const { address } = JSON.parse(r.stdout);
    openOverlay({ kind: "dialog", width: size, height: size, layout: { type: "block", content: { terminal: address } } });
  }

  async handle(c, cx) {
    const [name, arg] = c.split("-");
    const n = Number(arg);
    const space = spaces().find((s) => s.active);
    const tab = space?.tabs.find((t) => t.active);
    const machine = space?.machine || null;
    if (name === "left" || name === "right") {
      if (!(await this.forward(`ctrl+${name === "left" ? "h" : "l"}`))) run("pane.go", { direction: name });
    } else if (name === "pane") {
      if (await this.forward(`alt+${n}`)) return;
      const p = panes().filter((p) => p.tab === tab?.id)[n - 1];
      if (p) run("pane.focus", { pane: p.pane });
    } else if (name === "last") {
      if (this.prev && panes().some((p) => p.pane === this.prev)) run("pane.focus", { pane: this.prev });
    } else if (name === "tab" || name === "slot") {
      // tab-N: the tab numbered N, made if there's none. slot-N: only an existing one.
      await this.ready;
      if (!space || space.id === shared("t3-home.space")) return;
      this.reconcile(cx);
      const slots = this.slots[space.id] ?? {};
      const id = Object.keys(slots).find((k) => slots[k] === n);
      if (id) return run("tab.select", { id });
      if (name === "slot") return;
      // Use native run("tab.new") and wait for the new tab id in spaces() (no herdr-app CLI / PATH required).
      const before = new Set(space.tabs.map((t) => t.id));
      run("tab.new", { space: space.id });
      let made = null;
      for (let k = 0; k < 60; k++) {
        await cx.sleep(50);
        const now = spaces().find((s) => s.id === space.id);
        const added = now?.tabs.find((t) => !before.has(t.id));
        if (added) { made = added.id; break; }
      }
      if (!made) return notify({ title: `Couldn't open tab ${n}`, body: "New tab did not appear", level: "warning", timeout: 5000 });
      this.pending.set(made, Date.now());
      this.slots[space.id] = { ...this.slots[space.id], [made]: n };
      this.save();
      this.place(space.id, cx);
    } else if (name === "space") {
      // focus: the Nth space its sidebar numbers (t3-spaces.order: the hidden Home left out). Elsewhere Herdr's Nth.
      const id = shared("layout") === "focus" ? shared("t3-spaces.order")?.[n - 1] : null;
      if (id) run("space.select", { id });
      else if (shared("layout") !== "focus") run("space.select", { index: n });
    } else if (name === "move") {
      // As the TUI: the tab takes the next number down or up, swapping with the tab that had it, or moving into a gap.
      await this.ready;
      if (!tab) return;
      this.reconcile(cx);
      const slots = this.slots[space.id] ?? {};
      const old = slots[tab.id], to = old + (arg === "left" ? -1 : 1);
      if (!old || to < 1) return;
      for (const k of Object.keys(slots)) if (slots[k] === to) slots[k] = old;
      slots[tab.id] = to;
      this.save();
      this.place(space.id, cx);
    } else if (name === "close") {
      // A tab's only pane closes the tab (and a last tab its space) without "Close space?".
      if (tab?.panes === 1) run("tab.close", { id: tab.id, confirmed: true });
      else run("pane.close", {});
    } else if (name === "cycle") {
      const list = panes().filter((p) => p.tab === tab?.id);
      const i = list.findIndex((p) => p.focused);
      if (list.length > 1) run("pane.focus", { pane: list[(i + (arg === "prev" ? list.length - 1 : 1)) % list.length].pane });
    } else if (name === "target") {
      const a = agents().find((a) => a.status === "blocked") ?? agents().find((a) => a.status === "done");
      if (a) run("agent.focus", { terminal: a.address });
    } else if (name === "equalize") {
      // Every pane of the tab the same area, as the TUI's prefix shift-e (the core's layout document).
      if (!tab) return;
      const localTab = tab.id.includes("/") ? tab.id.split("/").pop() : tab.id;
      const r = machine
        ? await exec("python3", ["-c", REMOTE_EQUALIZE, localTab], { on: machine })
        : await exec("python3", [HELPER(), "equalize", tab.id]);
      if (r.code !== 0) notify({ title: "Couldn't equalize the panes", body: (r.stderr || r.stdout).trim(), level: "error" });
    } else if (name === "project") {
      await openFzfProjectPicker(machine, cx);
    } else if (name === "wt" && ["new", "open", "remove"].includes(arg)) {
      // worktrees: the shipped dialog, with remove/new drawn as T3's alert box.
      const size = arg === "open" ? { width: 560, height: 480 } : { width: 512, height: 240, frame: "none" };
      openOverlay({ mod: "worktrees", kind: "dialog", ...size, props: { space: space?.id, folder: this.focusedCwd(), action: arg } });
    } else if (name === "wt") {
      await openWorktreeSlot(arg, this.focusedCwd(), machine);
    } else if (name === "lazygit") {
      await this.popup(["lazygit"], 0.95, machine);
    } else if (name === "copymode") {
      const f = focused();
      const t = f?.terminal ?? null;
      if (t) {
        openOverlay({
          mod: "extras",
          kind: "window",
          frame: "none",
          width: 0.92,
          height: 0.9,
          props: { copyMode: true, terminal: t, pane: f?.pane ?? null, machine },
        });
      }
    } else if (name === "scrollback") {
      const t = this.focusedTerminal();
      if (t) {
        const localTerm = machine && t.startsWith(`${machine}/`) ? t.slice(machine.length + 1) : t;
        await this.popup(["sh", "-c", SCROLLBACK, "sh", localTerm], 0.95, machine);
      }
    } else if (name === "agent") {
      // The order the agents list shows: focus's Inbox or Lists rows, bettr's shared order, else Herdr's own.
      const live = new Set(agents().map((a) => a.address));
      const t3 = shared("layout") === "focus" ? shared(shared("t3-agent-order") === "lists" ? "t3-agents.rows" : "t3-inbox.rows")?.order : null;
      const order = (t3 ?? shared("agents.order") ?? []).filter((t) => live.has(t));
      const t = (order.length ? order : agents().map((a) => a.address))[n - 1];
      if (t) run("agent.focus", { terminal: t });
    }
  }

  // Gives each shown tab a number: kept ones keep theirs, a new one takes the lowest free number. A tab dragged in the bar
  // keeps the numbers in the bar's new order, so a drag swaps numbers rather than undoing itself.
  // A space missing from spaces() keeps its numbers: it may be on a machine that's offline, or not loaded yet.
  reconcile(cx) {
    if (!this.slots) return;
    // Another window's copy published newer numbers: start from those, so this one doesn't write back older ones.
    const theirs = shared("tab-slots");
    if (theirs && JSON.stringify(theirs) !== this.sharedText) { this.slots = JSON.parse(JSON.stringify(theirs)); this.sharedText = JSON.stringify(theirs); }
    let changed = false;
    for (const space of spaces()) {
      const tabs = shownTabs(space), old = this.slots[space.id] ?? {}, slots = {};
      for (const t of tabs) {
        const n = old[t.id];
        if (Number.isInteger(n) && n > 0 && !Object.values(slots).includes(n)) slots[t.id] = n;
      }
      // A tab tab-N just made keeps its number until it shows: spaces() lags the command.
      for (const [id, n] of Object.entries(old)) if (this.pending.has(id) && !(id in slots) && !Object.values(slots).includes(n)) slots[id] = n;
      if (!this.placing.has(space.id)) {
        const kept = tabs.filter((t) => slots[t.id]), sorted = kept.map((t) => slots[t.id]).sort((a, b) => a - b);
        if (kept.some((t, i) => slots[t.id] !== sorted[i])) kept.forEach((t, i) => { slots[t.id] = sorted[i]; });
      }
      let fresh = false;
      for (const t of tabs) if (!slots[t.id]) { slots[t.id] = lowestFree(slots); fresh = true; }
      if (JSON.stringify(slots) !== JSON.stringify(old)) { this.slots[space.id] = slots; changed = true; }
      if (fresh) this.place(space.id, cx);
    }
    for (const [id, at] of this.pending) if (Date.now() - at > 5000 || spaces().some((s) => s.tabs.some((t) => t.id === id))) this.pending.delete(id);
    if (changed) this.save();
  }

  save() {
    const text = JSON.stringify(this.slots);
    this.sharedText = text;
    setShared("tab-slots", JSON.parse(text));
    // Atomic, and only over the text this copy last saw: if another copy wrote in between, read what's there and write again
    // (its numbers came in through "tab-slots" already).
    const write = (retry) => fs.mkdir(`${appHome()}/data`, { recursive: true }).catch(() => {}).then(() =>
      writeTextFile(SLOTS(), text, this.disk).then(() => { this.disk = text; }, async (e) => {
        this.disk = await readTextFile(SLOTS()).catch(() => null);
        if (retry) write(false); else console.log(`extras: couldn't save tab numbers: ${e}`);
      })
    );
    write(true);
  }

  // Moves a space's tabs into number order, one move at a time. While it runs, the order isn't read as a drag.
  async place(spaceId, cx) {
    if (this.placing.has(spaceId)) return;
    this.placing.add(spaceId);
    try {
      for (let i = 0; i < 20; i++) {
        const space = spaces().find((s) => s.id === spaceId), slots = this.slots[spaceId] ?? {};
        if (!space) break;
        const tabs = shownTabs(space).filter((t) => slots[t.id]);
        const want = [...tabs].sort((a, b) => slots[a.id] - slots[b.id]);
        const at = want.findIndex((t, j) => t.id !== tabs[j].id);
        if (at < 0) break;
        // Into the place of the tab that's there now, counted among all the space's tabs.
        run("tab.move", { id: want[at].id, index: space.tabs.findIndex((x) => x.id === tabs[at].id) + 1 });
        // spaces() shows the move a frame or more later: wait for it, so the same move isn't sent again.
        for (let k = 0; k < 20; k++) {
          const now = spaces().find((s) => s.id === spaceId);
          if (!now || shownTabs(now).filter((t) => slots[t.id]).findIndex((t) => t.id === want[at].id) === at) break;
          await cx.sleep(50);
        }
      }
    } catch (e) {
      console.log(`extras: placing tabs: ${e}`);
    } finally {
      this.placing.delete(spaceId);
    }
  }

  // OS notifications (old toast delivery = "system") while the window isn't in front.
  notifyChanges() {
    const now = {};
    for (const a of agents()) {
      now[a.address] = a.status;
      const changed = this.seen && this.seen[a.address] !== a.status;
      if (changed && (a.status === "blocked" || a.status === "done") && !window()?.active) {
        const body = `${a.space_name} / ${a.tab_name}: ${a.status === "blocked" ? "needs you" : "done"}`;
        sendOsNotification(a.program.name, body);
      }
    }
    this.seen = now;
  }

  render(cx) {
    if (props()?.projectPicker) return renderProjectPicker(this);
    if (props()?.fzfTabs) return renderFzfTabBar();
    if (props()?.wtPicker) return renderWtPicker(this);
    if (props()?.copyMode) return renderCopyMode(this);
    const t = theme();
    this.notifyChanges();
    // Numbering can save and move tabs, so it runs just after the frame, not in it.
    if (!this.reconciling) { this.reconciling = true; cx.spawn((cx) => { this.reconciling = false; this.reconcile(cx); }); }
    const pane = focused()?.pane ?? null;
    if (pane && pane !== this.cur) { this.prev = this.cur; this.cur = pane; }
    // No visible bar: the block stays (1px) so extras.<command> keys still reach it.
    return div().size_full().bg(t.chrome);
  }
}
