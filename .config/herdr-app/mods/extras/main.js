import { View, div } from "gpui-kit";
import { spaces, panes, agents, terminals, focused, theme, run, hc, exec, home, appHome, window, openOverlay, nextCommand, shared, setShared, notify, readTextFile, writeTextFile } from "herdr";
import * as fs from "fs/promises";

// Vim, Neovim and fzf get the key instead of Herdr (same match as the old herdr.py).
const EDITOR = /^g?\.?(?:view|l?n?vim?x?|fzf)(?:diff)?(?:-wrapped)?$/;
const HELPER = () => `${appHome()}/mods/extras/helper.py`;
const SCROLLBACK = 'f=$(mktemp -t scrollback); hc read "$1" > "$f"; ${EDITOR:-nvim} + "$f"; rm -f "$f"';
const quote = (s) => JSON.stringify(s); // AppleScript strings escape like JSON
// Tabs that hold an agent's terminal for its chat (the chat's tab stands for them). The rule t3-tabs hides them by
// (chatPairs in t3-tabs/navigation.js), kept the same so numbers go to exactly the tabs the bar shows.
const chatOwnTabs = (list) => new Set(list.filter(x => x.labels?.["chat.tab"] && x.labels["herdr.tab"] && x.labels["herdr.tab"] !== x.labels["chat.tab"])
  .map(x => x.labels["herdr.tab"]));
// App commands one after another (run() calls from a mod aren't ordered).
const HERDR = 'H=$(command -v herdr-app || echo "$HOME/.local/bin/herdr-app"); exec "$H" do "$1" "$2"';
const herdrDo = (command, args) => exec("sh", ["-c", HERDR, "sh", command, JSON.stringify(args)]);
// Fixed tab numbers, as the TUI's tab-slots.json: { [space]: { [tab]: number } }. Closing a tab leaves its number free.
// Shared as "tab-slots", the same shape, for the tab bar (t3-tabs) and other windows' copies of this mod.
const SLOTS = () => `${appHome()}/data/tab-slots.json`;
// The tabs the bar shows, in its order: all but a chat's hidden terminal tab.
const shownTabs = (space) => {
  const owned = chatOwnTabs(terminals());
  return space.tabs.filter((x) => !owned.has(x.id));
};
const sleep = (s) => exec("sleep", [String(s)]);
const lowestFree = (slots) => { let n = 1; while (Object.values(slots).includes(n)) n++; return n; };

// Handles extras.<command> keys from keys.json.
export default class Extras extends View {
  init(_props, cx) {
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
      this.reconcile();
    })();
    cx.spawn(() => this.ready);
    cx.timer.every(15000, (cx) => cx.notify()); // re-checks agents for notifyChanges
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        try { await this.handle(c); } catch (e) { console.log(`extras ${c}: ${e}`); }
      }
    });
  }

  focusedPane() {
    const f = focused();
    return f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  }

  // The focused terminal, or for a chat pane its agent's (chat.of, written by the chat mod).
  focusedTerminal() {
    const f = focused();
    if (f?.terminal) return f.terminal;
    const p = this.focusedPane();
    const of = shared("chat.of") ?? {};
    return p?.mod === "chat" ? Object.keys(of).find((k) => of[k] === p.pane) ?? null : null;
  }

  // Where the focus is working: a mod pane has no folder, so a chat uses its agent's.
  focusedCwd() {
    const t = this.focusedTerminal();
    return focused()?.cwd || panes().find((p) => p.terminal === t)?.cwd || null;
  }

  // True when an editor has the focus and got the key.
  async forward(key) {
    const p = this.focusedPane();
    const prog = p?.program;
    if (!p?.terminal || !prog || !(EDITOR.test(prog.key) || EDITOR.test(prog.name.toLowerCase()))) return false;
    await hc(["keys", p.terminal, key]);
    return true;
  }

  // Runs argv in a terminal shown as a dialog; the dialog closes when it exits.
  async popup(argv, size = 0.8) {
    const r = await hc(["run", "--bg", "--json", "--rm", "--no-parent", "--cwd", this.focusedCwd() || home(), "--", ...argv]);
    const { address } = JSON.parse(r.stdout);
    openOverlay({ kind: "dialog", width: size, height: size, layout: { type: "block", content: { terminal: address } } });
  }

  async handle(c) {
    const [name, arg] = c.split("-");
    const n = Number(arg);
    const space = spaces().find((s) => s.active);
    const tab = space?.tabs.find((t) => t.active);
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
      if (!space) return;
      this.reconcile();
      const slots = this.slots[space.id] ?? {};
      const id = Object.keys(slots).find((k) => slots[k] === n);
      if (id) return run("tab.select", { id });
      if (name === "slot") return;
      const r = await herdrDo("tab.new", { space: space.id });
      let made = null;
      try { made = JSON.parse(r.stdout).tab; } catch {}
      if (!made) return notify({ title: `Couldn't open tab ${n}`, body: r.stderr?.trim() || r.stdout?.trim() || "herdr-app tab.new failed", level: "warning", timeout: 5000 });
      this.pending.set(made, Date.now());
      this.slots[space.id] = { ...this.slots[space.id], [made]: n };
      this.save();
      this.place(space.id);
    } else if (name === "space") {
      // focus: the Nth space its sidebar numbers (t3-spaces.order: the hidden Home left out). Elsewhere Herdr's Nth.
      const id = shared("layout") === "focus" ? shared("t3-spaces.order")?.[n - 1] : null;
      if (id) run("space.select", { id });
      else if (shared("layout") !== "focus") run("space.select", { index: n });
    } else if (name === "move") {
      // As the TUI: the tab takes the next number down or up, swapping with the tab that had it, or moving into a gap.
      await this.ready;
      if (!tab) return;
      this.reconcile();
      const slots = this.slots[space.id] ?? {};
      const old = slots[tab.id], to = old + (arg === "left" ? -1 : 1);
      if (!old || to < 1) return;
      for (const k of Object.keys(slots)) if (slots[k] === to) slots[k] = old;
      slots[tab.id] = to;
      this.save();
      this.place(space.id);
    } else if (name === "close") {
      // A chat and its agent are one: closing the chat ends the agent too.
      const f = this.focusedPane();
      const of = shared("chat.of") ?? {};
      const t = f?.mod === "chat" ? Object.keys(of).find((k) => of[k] === f.pane) : null;
      const dup = t && Object.keys(of).filter((k) => of[k] === f.pane).length > 1;
      if (t && !dup) run("terminal.kill", { terminal: t });
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
      // Every pane of the tab the same area, as the TUI's prefix shift-e (helper.py equalize: the core's layout document).
      if (!tab) return;
      const r = await exec("python3", [HELPER(), "equalize", tab.id]);
      if (r.code !== 0) notify({ title: "Couldn't equalize the panes", body: (r.stderr || r.stdout).trim(), level: "error" });
    } else if (name === "project") {
      await this.popup(["python3", HELPER(), "project"], 0.7);
    } else if (name === "wt" && ["new", "open", "remove"].includes(arg)) {
      // worktrees: the shipped dialog, with remove/new drawn as T3's alert box.
      const size = arg === "open" ? { width: 560, height: 480 } : { width: 512, height: 240, frame: "none" };
      openOverlay({ mod: "worktrees", kind: "dialog", ...size, props: { space: space?.id, folder: this.focusedCwd(), action: arg } });
    } else if (name === "wt") {
      await this.popup(["python3", HELPER(), "wt", arg], 0.7);
    } else if (name === "lazygit") {
      await this.popup(["lazygit"], 0.95);
    } else if (name === "scrollback") {
      const t = this.focusedTerminal();
      if (t) await this.popup(["sh", "-c", SCROLLBACK, "sh", t], 0.95);
    } else if (name === "agent") {
      // The order the agents list shows: focus's Inbox or Lists rows, bettr's shared order, else Herdr's own.
      const live = new Set(agents().map((a) => a.address));
      const t3 = shared("layout") === "focus" ? shared(shared("t3-agent-order") === "lists" ? "t3-agents.rows" : "t3-inbox.rows")?.order : null;
      const order = (t3 ?? shared("agents.order") ?? []).filter((t) => live.has(t));
      const t = (order.length ? order : agents().map((a) => a.address))[n - 1];
      if (t) await this.focusAgent(t);
    }
  }

  // An agent with a chat (chat.of, written by the chat mod): its chat, or its
  // terminal when that's the side showing. Others: Herdr's agent.focus.
  async focusAgent(t) {
    const ps = panes();
    const cp = ps.find((p) => p.mod === "chat" && p.pane === shared("chat.of")?.[t]);
    // Its terminal swapped into the chat's place (a split's Chat | Terminal switch): that's what shows.
    const chatTab = terminals().find((k) => k.address === t)?.labels?.["chat.tab"];
    const tp0 = ps.find((p) => p.terminal === t);
    if (!cp || (tp0 && chatTab && tp0.tab.split("/").pop() === chatTab)) return run("agent.focus", { terminal: t });
    const tp = ps.find((p) => p.terminal === t && p.tab === cp.tab);
    const sp = spaces().find((s) => s.tabs.some((x) => x.id === cp.tab));
    if (sp && !sp.active) await herdrDo("space.select", { id: sp.id });
    await herdrDo("tab.select", { id: cp.tab });
    await herdrDo("pane.focus", { pane: (tp?.zoomed ? tp : cp).pane });
  }

  // Gives each shown tab a number: kept ones keep theirs, a new one takes the lowest free number. A tab dragged in the bar
  // keeps the numbers in the bar's new order, so a drag swaps numbers rather than undoing itself.
  // A space missing from spaces() keeps its numbers: it may be on a machine that's offline, or not loaded yet.
  reconcile() {
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
      if (fresh) this.place(space.id);
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
    const write = (retry) => writeTextFile(SLOTS(), text, this.disk).then(() => { this.disk = text; }, async (e) => {
      this.disk = await readTextFile(SLOTS()).catch(() => null);
      if (retry) write(false); else console.log(`extras: couldn't save tab numbers: ${e}`);
    });
    write(true);
  }

  // Moves a space's tabs into number order, one move at a time. While it runs, the order isn't read as a drag.
  async place(spaceId) {
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
        const r = await herdrDo("tab.move", { id: want[at].id, index: space.tabs.findIndex((x) => x.id === tabs[at].id) + 1 });
        if (r.code !== 0) { console.log(`extras: tab.move failed: ${r.stderr?.trim()}`); break; }
        // spaces() shows the move a frame or more later: wait for it, so the same move isn't sent again.
        for (let k = 0; k < 20; k++) {
          const now = spaces().find((s) => s.id === spaceId);
          if (!now || shownTabs(now).filter((t) => slots[t.id]).findIndex((t) => t.id === want[at].id) === at) break;
          await sleep(0.05);
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
        exec("osascript", ["-e", `display notification ${quote(body)} with title ${quote(a.program.name)}`]).catch(() => {});
      }
    }
    this.seen = now;
  }

  render(cx) {
    const t = theme();
    this.notifyChanges();
    // Numbering can save and move tabs, so it runs just after the frame, not in it.
    if (!this.reconciling) { this.reconciling = true; cx.spawn(() => { this.reconciling = false; this.reconcile(); }); }
    const pane = focused()?.pane ?? null;
    if (pane && pane !== this.cur) { this.prev = this.cur; this.cur = pane; }
    // No visible bar: the block stays (1px) so extras.<command> keys still reach it.
    return div().size_full().bg(t.chrome);
  }
}
