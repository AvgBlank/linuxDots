// Plan usage in the footer, as Ovis shows it: per agent its icon, how much of the week is used in %, and a thin bar under them.
// The snapshots are bettr-usage's (agent hooks write ~/.cache/bettr/usage/<agent>.json after each turn, see
// mods/bettr-usage/report_usage.py); a click asks every agent for fresh numbers.
import { div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, exec, home, knownAgents, readTextFile, settings, watchFolder, window } from "herdr";
import { readdir } from "fs/promises";

const FOLDER = () => `${home()}/.cache/bettr/usage`;
const STALE_S = 30 * 60; // older than this, drawn dim: nothing has reported for a while
const TICK_MS = 30 * 1000;
const finite = (v) => typeof v === "number" && Number.isFinite(v);

function parse(text) {
  const s = JSON.parse(text);
  if (typeof s?.agent !== "string" || !/^[\w-]+$/.test(s.agent) || !finite(s.updatedAt) || !Array.isArray(s.windows)) return null;
  const windows = s.windows.filter((w) => typeof w?.label === "string" && finite(w.used))
    .map((w) => ({ label: w.label, used: Math.max(0, Math.min(100, w.used)), resetsAt: finite(w.resetsAt) ? w.resetsAt : null }));
  return windows.length ? { agent: s.agent, name: typeof s.name === "string" ? s.name : s.agent, updatedAt: s.updatedAt, windows } : null;
}

const resetIn = (secs, now) => {
  if (!secs) return "";
  const m = Math.ceil((secs * 1000 - now) / 60000);
  if (m <= 0) return "reset";
  const h = Math.floor(m / 60);
  return m < 60 ? `${m}m` : h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m % 60}m`;
};

// Starts watching for the footer copy: view.usage is the snapshots, sorted by name.
export function watchUsage(view, cx) {
  view.usage = [];
  // Icons as programs.json has them (an override there wins over the shipped icons/).
  view.usageIcons = {};
  cx.spawn(async (cx) => {
    try { view.usageIcons = Object.fromEntries((await knownAgents()).map((p) => [p.key, p])); cx.notify(); } catch {}
  });
  const reload = async (cx) => {
    let names = [];
    try { names = (await readdir(FOLDER())).filter((n) => n.endsWith(".json")); } catch {}
    const out = [];
    for (const n of names) { try { const s = parse(await readTextFile(`${FOLDER()}/${n}`)); if (s) out.push(s); } catch {} }
    view.usage = out.sort((a, b) => a.name.localeCompare(b.name));
    cx.notify();
  };
  cx.spawn(async (cx) => {
    await reload(cx);
    for (;;) {
      try { await watchFolder(FOLDER()); } catch { await cx.sleep(TICK_MS); }
      await reload(cx);
    }
  });
  cx.timer.every(TICK_MS, (cx) => cx.notify()); // ages and resets
  // Hooks only report on a turn: every 3 minutes (ccstatusline's pace) while Herdr is in front, ask for Claude
  // as a hook would. The reporter's own pacing still holds; the folder watch shows the result.
  cx.timer.every(3 * 60 * 1000, () => {
    if (window()?.active === false) return;
    exec("sh", ["-c", 'exec python3 -I "$1" claude </dev/null', "sh", `${appHome()}/mods/bettr-usage/report_usage.py`]).catch(() => {});
  });
  view.refreshUsage = (cx) => {
    if (view.usageBusy) return;
    view.usageBusy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try { await exec("python3", ["-I", `${appHome()}/mods/bettr-usage/report_usage.py`, "--now"]); } catch {}
      view.usageBusy = false;
      await reload(cx);
    });
  };
}

// One item per agent with a window that hasn't reset: the weekly window (else its first), as how much is used.
export function usageItems(view, t, tip) {
  const now = Date.now(), font = settings()?.font_family || "JetBrains Mono";
  return (view.usage ?? []).filter((s) => s.windows.some((w) => !w.resetsAt || w.resetsAt * 1000 > now)).map((s) => {
    const w = s.windows.find((x) => x.label === "Weekly") ?? s.windows[0];
    const used = Math.round(w.used);
    const dim = now / 1000 - s.updatedAt > STALE_S || (w.resetsAt && w.resetsAt * 1000 <= now);
    const color = dim ? t.dim : t.muted;
    const id = `usage-${s.agent}`, p = view.usageIcons?.[s.agent];
    const icon = p?.icon && p.tint ? svg(p.icon).text_color(t.foreground) : image(p?.icon ?? `icons/${s.agent}.svg`);
    const label = [`${s.name}: ${used}% used`,
      ...s.windows.map((x) => `${x.label}: ${Math.round(x.used)}% used${x.resetsAt ? `, resets in ${resetIn(x.resetsAt, now)}` : ""}`),
      view.usageBusy ? "Checking…" : "Click to check now"].join("\n");
    return tip(id, label, v_flex().id(`${id}-body`).flex_none().gap(3).px(2).cursor_pointer()
      .when(Boolean(view.usageBusy), (el) => el.opacity(0.5))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => view.refreshUsage(cx))
      .child(h_flex().gap(5).items_center()
        .child(icon.size(14).flex_none())
        .child(div().font_family(font).text_size(12).text_color(color).child(`${used}%`)))
      .child(div().w_full().h(3).rounded(2).bg(t.input).overflow_hidden()
        .child(div().h(3).rounded(2).w(`${used}%`).bg(color))));
  });
}
