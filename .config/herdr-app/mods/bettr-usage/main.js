import { View, div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, exec, home, layout, props, readTextFile, run, settings, theme, watchFolder, window } from "herdr";
import { readdir } from "fs/promises";

// Agent hooks write one snapshot per agent here (see report_usage.py), and the mod draws one card
// per file: no polling. Clicking a row asks every agent for fresh usage with --now.
const FOLDER = `${home()}/.cache/bettr/usage`;
// Redraw the age and reset countdown (minutes). Also how long to wait before watching
// again when the folder is not there yet or cannot be watched.
const TICK_MS = 30 * 1000;
// Data older than this is drawn dim: no agent has reported for a while, or the endpoint refused.
const STALE_S = 30 * 60;
const ASK_MS = 3 * 60 * 1000;

// Numbers use the terminals' font (Herdr's `font_family` setting), else Herdr's
// default. Read once per render.
let font = "JetBrains Mono";
const mono = el => el.font_family(font);
const readFont = () => { font = settings()?.font_family || "JetBrains Mono"; };

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const finite = v => typeof v === "number" && Number.isFinite(v);

function parseSnapshot(text) {
  const s = JSON.parse(text);
  if (typeof s?.agent !== "string" || !/^[\w-]+$/.test(s.agent) || !finite(s.updatedAt) || !Array.isArray(s.windows)) return null;
  const windows = s.windows.filter(w => typeof w?.label === "string" && finite(w.used))
    .map(w => ({ label: w.label, used: Math.max(0, Math.min(100, w.used)), resetsAt: finite(w.resetsAt) ? w.resetsAt : null }));
  return windows.length ? { agent: s.agent, name: typeof s.name === "string" ? s.name : s.agent, updatedAt: s.updatedAt, windows } : null;
}

// A card whose windows have all reset shows nothing true any more. The next report brings it back.
const current = (snapshot, now) => snapshot.windows.some(w => !w.resetsAt || w.resetsAt * 1000 > now);

function resetText(seconds, now) {
  if (!seconds) return "—";
  const minutes = Math.ceil((seconds * 1000 - now) / 60000);
  if (minutes <= 0) return "reset";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h ${minutes % 60}m`;
}

function ageText(updatedAt, now) {
  const minutes = Math.max(0, Math.floor((now / 1000 - updatedAt) / 60));
  return minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
}

export default class UsageBars extends View {
  init(_props, cx) {
    this.snapshots = [];
    this.icons = {};
    this.refreshing = false;
    cx.spawn(async cx => {
      await this.reload(cx);
      // First run, or every card has reset: ask now instead of waiting for an agent's turn.
      if (!this.snapshots.some(s => current(s, Date.now()))) await this.refresh(cx);
      for (;;) {
        // The reporter makes the folder with its first snapshot; until then (or when it
        // cannot be watched) look again each tick.
        try { await watchFolder(FOLDER); } catch { await cx.sleep(TICK_MS); }
        await this.reload(cx);
      }
    });
    cx.timer.every(TICK_MS, cx => cx.notify());
    // Hooks only report on a turn: every 3 minutes (ccstatusline's pace) while Herdr is in front, ask for
    // Claude as a hook would. The reporter's own pacing still holds; the folder watch shows the result.
    cx.timer.every(ASK_MS, () => {
      if (window()?.active === false) return;
      exec("sh", ["-c", 'exec python3 -I "$1" claude </dev/null', "sh", `${appHome()}/mods/bettr-usage/report_usage.py`]).catch(() => {});
    });
  }

  async reload(cx) {
    let names = [];
    try { names = (await readdir(FOLDER)).filter(name => name.endsWith(".json")); } catch {}
    const snapshots = [];
    for (const name of names) {
      try {
        const snapshot = parseSnapshot(await readTextFile(`${FOLDER}/${name}`));
        if (snapshot) snapshots.push(snapshot);
      } catch {
        // Ignore a file that is not a snapshot.
      }
    }
    for (const { agent } of snapshots) {
      if (agent in this.icons) continue;
      let found = false;
      try { found = Boolean(await readTextFile(`${appHome()}/icons/${agent}.svg`)); } catch {}
      this.icons[agent] = found ? `icons/${agent}.svg` : "icons/agent.svg";
    }
    this.snapshots = snapshots.sort((a, b) => a.name.localeCompare(b.name));
    cx.notify();
  }

  // Ask every agent for fresh usage (an API read each), then show the files they saved.
  async refresh(cx) {
    if (this.refreshing) return;
    this.refreshing = true;
    cx.notify();
    try {
      await exec("python3", ["-I", `${appHome()}/mods/bettr-usage/report_usage.py`, "--now"]);
    } catch {
      // python3 is missing; still show what the hooks saved.
    } finally {
      this.refreshing = false;
      await this.reload(cx);
    }
  }

  card(snapshot, t, now) {
    // One bar, the weekly window (the chat shows the 5-hour one); its tooltip lists every window.
    const primary = snapshot.windows.find(row => row.label === "Weekly") ?? snapshot.windows[0];
    const stale = now / 1000 - snapshot.updatedAt > STALE_S;
    const windowText = row => `${row.label} (${resetText(row.resetsAt, now)})`;
    // One row per window: the bar, its %, then the provider's icon (first row; room
    // for it below). Provider, window, % and age are in the tooltip.
    const body = v_flex().gap(1);
    const windows = [primary];
    for (const [index, row] of windows.entries()) {
      const expired = row.resetsAt && row.resetsAt * 1000 <= now;
      // One color at any level (the muted text color, a step below white on dark themes);
      // a window that has reset, or data older than STALE_S, is dim until new data comes.
      const color = expired || stale ? t.dim : t.muted;
      const description = `${snapshot.name} · ${snapshot.windows.map(w => `${windowText(w)} ${Math.round(w.used)}%`).join(" · ")} · Updated ${ageText(snapshot.updatedAt, now)}`;
      const track = div().flex_1().min_w(0).h(5).rounded(3).bg(t.raised).overflow_hidden()
        .child(div().w(`${row.used}%`).h(5).rounded(3).bg(color));
      // A fixed 14 px box, so a wide or narrow icon never moves the bar.
      const mark = div().w(14).min_w(14).max_w(14).h(14).flex_none().overflow_hidden().flex().items_center().justify_center()
        .when(index === 0, el => el.child(image(this.icons[snapshot.agent] ?? "icons/agent.svg").w(11).h(11).flex_none()));
      const tip = `${description}\n${this.refreshing ? "Refreshing usage…" : "Click to refresh usage from each agent"}`;
      body.child(v_flex().id(`usage-${snapshot.agent}-${index}`).w_full().py(2).gap(4).cursor_pointer()
        .when(this.refreshing, el => el.opacity(0.5))
        .tooltip(tip).accessibility_label(description)
        .on_click((_event, cx) => cx.spawn(async cx => { await this.refresh(cx); }))
        .when(row !== primary, el => el
          .child(div().text_size(11).text_color(t.dim).child(windowText(row))))
        .child(h_flex().w_full().gap(6).items_center().child(track)
          // Wide enough for "100%" at any value, so every bar ends at the same place.
          .child(mono(div()).w(28).flex_none().text_right().text_size(11).text_color(t.muted)
            .child(`${Math.round(row.used)}%`))
          .child(mark)));
    }
    return body;
  }

  // The block is not resizable: it always fits its rows.
  fitHeight() {
    const id = props()?.autoSize;
    const node = id && this.contentHeight ? find(layout(), id) : null;
    if (node && node.size?.px !== this.contentHeight) run("layout.resize", { id, px: this.contentHeight });
  }

  render() {
    const t = theme();
    readFont();
    const now = Date.now();
    const shown = this.snapshots.filter(s => current(s, now));
    const empty = div().id("usage-empty").cursor_pointer().text_size(11).text_color(t.dim)
      .tooltip("Plan usage of Claude Code (with a Claude plan login) and Codex (with a ChatGPT login).\n"
        + "Agents update it after each turn once the agent hooks are set up.\nClick to check now.")
      .on_click((_event, cx) => cx.spawn(async cx => { await this.refresh(cx); }))
      .child(this.refreshing ? "Checking usage…" : "No plan usage yet. Click to check.");
    // Rows only, directly above the footer: no heading and no refresh button.
    const content = v_flex().id("usage-providers").w_full().flex_none()
      .on_size_change(size => {
        this.contentHeight = Math.min(400, Math.ceil(size.height));
        this.fitHeight();
      })
      .px(16).pt(6).pb(12).gap(6).text_size(12).text_color(t.foreground)
      .children(shown.length ? shown.map(s => this.card(s, t, now)) : [empty]);
    return v_flex().id("usage-root").size_full().min_h(0).bg(t.chrome).overflow_y_scrollbar().child(content);
  }
}
