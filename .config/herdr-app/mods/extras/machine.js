// Keyboard-driven GPUI machine switcher for extras (ctrl-a m) with live fzf-style filtering:
// swaps between local and configured remote machines by jumping to the last-used space on that machine
// (falling back to its first space, or opening a fresh space if it has none).
import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, settings, spaces, machines, run, openOverlay, closeOverlay, props, shared } from "herdr";

const ROW = 40;

const fuzzyMatch = (hay, needle) => {
  let j = 0;
  for (let i = 0; i < hay.length && j < needle.length; i++) {
    if (hay[i] === needle[j]) j++;
  }
  return j === needle.length;
};

export function buildMachineItems({ allMachines, allSpaces, byMachine, lastByMachine, homeId }) {
  const spaceById = new Map((allSpaces ?? []).map((s) => [s.id, s]));
  const activeSpace = (allSpaces ?? []).find((s) => s.active) ?? null;
  const activeMachine = activeSpace ? (activeSpace.machine ?? null) : null;
  const infoByName = new Map((allMachines ?? []).filter((m) => m.name).map((m) => [m.name, m]));
  const remoteNames = [...new Set([
    ...infoByName.keys(),
    ...(allSpaces ?? []).map((s) => s.machine).filter(Boolean),
  ])].sort((a, b) => a.localeCompare(b));

  return [null, ...remoteNames].map((m, idx) => {
    const key = m ?? "";
    const info = m ? infoByName.get(m) : null;
    const connected = !m || info?.layout === "ready";
    const state = !m ? "local" : (info?.layout ?? "unavailable");
    const ordered = (byMachine?.[key] ?? []).filter((id) => id !== homeId && spaceById.has(id));
    const fallback = (allSpaces ?? [])
      .filter((s) => (s.machine ?? null) === m && s.id !== homeId)
      .map((s) => s.id);
    const spaceIds = ordered.length ? ordered : fallback;
    const remembered = lastByMachine?.[key];
    const targetSpaceId = remembered && spaceIds.includes(remembered) ? remembered : (spaceIds[0] ?? null);
    const targetSpaceName = targetSpaceId ? (spaceById.get(targetSpaceId)?.name ?? "") : "";
    const spaceNames = spaceIds.map((id) => spaceById.get(id)?.name ?? "").filter(Boolean);
    return {
      index: idx + 1,
      machine: m,
      key,
      label: m ?? "local",
      connected,
      state,
      count: spaceIds.length,
      targetSpaceId,
      targetSpaceName,
      spaceNames,
      active: Boolean(activeSpace && activeMachine === m),
    };
  });
}

export function filterMachineItems(items, query) {
  const tokens = String(query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return items;
  const matched = [];
  for (const item of items) {
    const label = item.label.toLowerCase();
    const fields = [label, ...item.spaceNames.map((n) => n.toLowerCase())];
    if (!tokens.every((tok) => fields.some((f) => f.includes(tok) || fuzzyMatch(f, tok)))) continue;
    const exactLabel = tokens.every((tok) => label.includes(tok));
    const fuzzyLabel = tokens.every((tok) => fuzzyMatch(label, tok));
    matched.push({ item, score: exactLabel ? 2 : fuzzyLabel ? 1 : 0 });
  }
  matched.sort((a, b) => b.score - a.score);
  return matched.map((x) => x.item);
}

export function selectMachine(item) {
  if (!item) return;
  if (item.targetSpaceId) return run("space.select", { id: item.targetSpaceId });
  return run("space.new", { machine: item.machine ?? "" });
}

function currentItems() {
  return buildMachineItems({
    allMachines: machines(),
    allSpaces: spaces(),
    byMachine: shared("t3-spaces.by-machine"),
    lastByMachine: shared("extras.last-space-by-machine"),
    homeId: shared("t3-tabs.home") ?? shared("t3-home.space") ?? null,
  });
}

export function openMachinePicker() {
  const count = Math.max(1, currentItems().length);
  openOverlay({
    mod: "extras",
    kind: "dialog",
    frame: "none",
    width: 460,
    height: Math.min(440, 96 + count * ROW),
    props: { machinePicker: true },
  });
}

export function initMachinePicker(view) {
  const all = currentItems();
  const cur = all.findIndex((x) => x.active);
  // Pre-select the next machine so `ctrl-a m` + `Enter` flips immediately on two-machine setups.
  view.at = all.length > 1 ? ((cur >= 0 ? cur + 1 : 0) % all.length) : 0;
  view.filter = "";
  view.input = InputState.new({ placeholder: "" });
  view.input.on("change", (_e, cx) => {
    view.filter = view.input.value();
    view.at = 0;
    cx.notify();
  });
  view.input.on("submit", () => {
    const items = filterMachineItems(currentItems(), view.filter);
    const hit = items[view.at];
    if (!hit) return;
    closeOverlay(props().overlay);
    selectMachine(hit);
  });
  view.input.focus();
}

export function renderMachinePicker(view) {
  const t = theme();
  const s = settings();
  const font = s?.font_family || "JetBrains Mono";
  const fontSize = Number(s?.font_size) || 13;
  const all = currentItems();
  const items = filterMachineItems(all, view.filter);
  view.at = Math.min(view.at ?? 0, Math.max(0, items.length - 1));

  const choose = (item) => {
    if (!item) return;
    closeOverlay(props().overlay);
    selectMachine(item);
  };

  return v_flex()
    .id("machine-picker")
    .size_full()
    .min_h(0)
    .p(12)
    .gap(4)
    .rounded(8)
    .border(1)
    .border_color(t.border)
    .bg(t.background)
    .shadow_2xl()
    .font_family(font)
    .text_size(fontSize)
    .on_key_down((e, cx) => {
      const k = e.key;
      const ctrl = Boolean(e.modifiers?.control);
      const shift = Boolean(e.modifiers?.shift);
      if (k === "escape" || (ctrl && k === "c")) {
        return closeOverlay(props().overlay);
      }
      if (k === "down" || (ctrl && (k === "n" || k === "j")) || (k === "tab" && !shift)) {
        if (items.length) view.at = (view.at + 1) % items.length;
      } else if (k === "up" || (ctrl && (k === "p" || k === "k")) || (k === "tab" && shift)) {
        if (items.length) view.at = (view.at <= 0 ? items.length : view.at) - 1;
      } else return;
      cx.stop_propagation();
      cx.notify();
    })
    // Prompt line (`Machine> ...`), fzf --layout=reverse style
    .child(
      h_flex()
        .h(26)
        .flex_none()
        .items_center()
        .gap(2)
        .child(div().flex_none().font_medium().text_color(t.ansi4 || t.accent).child("Machine> "))
        .child(Input.new(view.input).flex_1().h_full().font_family(font).text_size(fontSize).text_color(t.foreground)),
    )
    // Counter + horizontal rule (`  2/2 ────────────`)
    .child(
      h_flex()
        .h(18)
        .flex_none()
        .items_center()
        .gap(8)
        .pl(12)
        .child(div().flex_none().text_size(fontSize - 1).text_color(t.ansi3 || t.dim).child(`${items.length}/${all.length}`))
        .child(div().flex_1().h(1).bg(t.border))
        .child(div().flex_none().text_size(fontSize - 2).text_color(t.dim).child("↑↓ · Tab · Enter")),
    )
    // Machine list
    .child(
      v_flex()
        .flex_1()
        .min_h(0)
        .gap(2)
        .when(items.length === 0, (el) => el.child(div().py(14).px(12).text_color(t.dim).child("No matching machines")))
        .when(items.length > 0, (el) =>
          el.children(
            items.map((item, i) => {
              const on = view.at === i;
              const right = item.targetSpaceName
                ? `${item.targetSpaceName}${item.count > 1 ? ` (${item.count})` : ""}`
                : "new space";
              return h_flex()
                .id(`mp-${item.label}`)
                .w_full()
                .h(ROW - 2)
                .px(6)
                .gap(8)
                .rounded(5)
                .items_center()
                .cursor_pointer()
                .when(on, (el) => el.bg(t.raised || t.selected))
                .on_hover((over, cx) => {
                  if (over && view.at !== i) {
                    view.at = i;
                    cx.notify();
                  }
                })
                .on_click(() => choose(item))
                .child(div().w(12).flex_none().text_color(on ? (t.ansi1 || t.accent) : "#00000000").font_bold().child(">"))
                .child(
                  div()
                    .size(7)
                    .rounded_full()
                    .flex_none()
                    .bg(item.connected ? (t.ansi2 || t.done) : t.dim),
                )
                .child(
                  div()
                    .flex_none()
                    .text_color(on ? t.foreground : t.muted)
                    .when(on || item.active, (el) => el.font_medium())
                    .child(item.label),
                )
                .when(item.active, (el) =>
                  el.child(
                    div()
                      .px(5)
                      .py(1)
                      .rounded(4)
                      .bg(`${t.ansi4 || t.accent}26`)
                      .text_size(fontSize - 2)
                      .text_color(t.ansi4 || t.accent)
                      .child("here"),
                  ),
                )
                .when(!item.connected, (el) =>
                  el.child(div().text_size(fontSize - 2).text_color(t.dim).child(item.state)),
                )
                .child(div().flex_1())
                .child(
                  div()
                    .min_w(0)
                    .max_w(180)
                    .truncate()
                    .text_size(fontSize - 1)
                    .text_color(item.targetSpaceName ? t.dim : t.muted)
                    .child(right),
                );
            }),
          ),
        ),
    );
}
