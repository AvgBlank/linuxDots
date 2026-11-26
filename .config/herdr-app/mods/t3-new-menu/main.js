// New: open a tab in a live space, reopen a bookmarked project, or start a space on a chosen machine.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { checking, exec, notify, theme, spaces, panes, machines, settings, run, closeOverlay, props, home, window, shared, setShared } from "herdr";
import { projectMark, placeOf } from "./project.js";
import { dormantProjects, forgetProject } from "./projects.js";
import { newSpacePlan } from "./new-space.js";
import { step } from "./list.js";
import { keyOf, keyLabel } from "./tip.js";
import { ghostButton } from "./button.js";
import { stopsInit, stop, focusRoot } from "./focus.js";
import { KEY, closedKey } from "./store.js";
import { keycap, footAction, paletteFooter } from "./palette.js";

// As T3's command item: 6 + a 20px title + a 16px line + 6.
const ROW = 48;
const HEAD = 28;
// The list's share of T3's 420 once its border, search, top inset and heading, bottom inset and footer are in; the popup hugs its content.
const LIST_MAX = 420 - 2 - 48 - 8 - 28 - 8 - 41;
const STATE = { ready: "Connected", loading: "Loading…", unavailable: "Unavailable" };

function shortFolder(folder) {
  const h = home();
  if (!folder) return "";
  if (h && (folder === h || folder.startsWith(`${h}/`) || folder.startsWith(`${h}\\`))) return "~" + folder.slice(h.length);
  return folder;
}

// Batch-checks local folders via `sh` (`fs/promises` is sandboxed to manifest read roots and has no stat).
// Fails open (null) if `sh` cannot run so shell issues never block opening valid folders.
async function missingFolders(folders) {
  if (!folders.length) return new Set();
  try {
    const r = await exec("sh", ["-c", 'for d; do [ -d "$d" ] || printf "%s\\0" "$d"; done', "sh", ...folders]);
    if (r.code !== 0) return null;
    return new Set(r.stdout.split("\0").filter(Boolean));
  } catch {
    return null;
  }
}

export default class NewMenu extends View {
  init(_props, cx) {
    stopsInit(this, cx, "modal");
    this.at = 0;
    this.hot = null;
    this.filter = "";
    this.missing = new Set();
    this.probed = new Set();
    this.choosing = false;
    this.closed = false;
    this.scrollTop = /** @type {Record<string, number>} */ ({});
    this.pointerY = /** @type {Record<string, number | undefined>} */ ({});
    this.picking = Boolean(props()?.pick); // choosing the machine for a new space; the sidebar's New space opens here
    const field = (placeholder) => {
      const input = InputState.new({ placeholder });
      input.on("change", (_e, cx) => { this.filter = input.value(); this.at = 0; cx.notify(); });
      input.on("submit", (_e, cx) => { this.choose(this.items()[this.at], cx); });
      return input;
    };
    this.spaceInput = field("Search spaces…");
    this.machineInput = field("Search machines…");
    (this.picking ? this.machineInput : this.spaceInput).focus();
    if (!this.picking && !checking()) this.probeFolders(cx);
  }

  // For the buttons that open this: see justClosed in focus.js. New space's and New tab in…'s apart, as each opens the other's step.
  close() {
    this.closed = true;
    setShared(closedKey("t3-new-menu", this.picking ? "pick" : undefined), Date.now());
  }

  probeFolders(cx) {
    if (checking()) return;
    const ps = panes(), all = spaces(), homeId = shared(KEY.home);
    const folders = [], seen = new Set();
    const add = (folder) => {
      if (!folder || seen.has(folder) || this.probed.has(folder)) return;
      seen.add(folder);
      folders.push(folder);
    };
    for (const s of all) if (s.id !== homeId && !s.machine) add(placeOf(s, ps));
    for (const p of dormantProjects(all, ps, homeId, shared(KEY.projects), machines())) if (!p.machine) add(p.folder);
    if (!folders.length) return;
    cx.spawn(async (cx) => {
      const gone = await missingFolders(folders);
      if (this.closed || !gone) return;
      let changed = false;
      for (const f of folders) {
        this.probed.add(f);
        if (gone.has(f)) { if (!this.missing.has(f)) { this.missing.add(f); changed = true; } }
        else if (this.missing.delete(f)) changed = true;
      }
      if (changed) cx.notify();
    });
  }

  // The current space first, then its machine's, so a machine's spaces stay together. `ps`: panes(), read once a draw.
  items(plan = undefined, ps = panes()) {
    const q = this.filter.toLowerCase();
    if (this.picking) return (plan ?? newSpacePlan()).candidates.map(({ machine, layout }) => ({
      key: `machine:${machine ?? ""}`, machine, name: machine ?? "This computer", sub: machine ? STATE[layout] : "Local", off: layout !== "ready",
    })).filter((m) => m.name.toLowerCase().includes(q));
    const all = spaces(), homeId = shared(KEY.home), here = all.find(s => s.active)?.machine ?? null;
    const rank = (s) => (s.active ? 0 : (s.machine ?? null) === here ? 1 : 2);
    const live = all.filter(s => s.id !== homeId && `${s.name} ${s.machine ?? ""} ${placeOf(s, ps)}`.toLowerCase().includes(q))
      .sort((a, b) => rank(a) - rank(b) || (a.machine ?? "").localeCompare(b.machine ?? ""))
      .map(s => ({ key: `space:${s.id}`, space: s }));
    const dormant = dormantProjects(all, ps, homeId, shared(KEY.projects), machines())
      .filter(p => `${p.name} ${p.machine ?? ""} ${p.folder}`.toLowerCase().includes(q))
      .map(p => {
        const key = `project:${p.machine ?? ""}:${p.folder}`;
        // The project mark remembers its last icon by id.
        return { key, project: { ...p, id: key }, off: p.off };
      });
    return [...live, ...dormant];
  }

  choose(item, cx) {
    if (!item) return;
    if (item.off) {
      if (item.project?.machine) notify({ title: "Machine unavailable", body: `${item.project.machine} is not connected.`, level: "warning" });
      return;
    }
    const entry = item.space ?? item.project;
    const folder = entry && !entry.machine ? (item.space ? placeOf(item.space, panes()) : item.project?.folder) : null;
    const warn = (f) => notify({ title: "Folder not found", body: `${shortFolder(f)} no longer exists on this computer.`, level: "warning" });
    const openItem = () => {
      closeOverlay(props().overlay);
      const p = item.project;
      // Through t3-tabs, which opens the tab and has the Inbox bar read it as something started there (`fresh`).
      if (item.space) run(`t3-tabs.new:${item.space.id}`);
      else if (p) run("space.new", { folder: p.folder, machine: p.machine ?? "", ...(p.named ? { name: p.name } : {}) });
      else run("space.new", { machine: item.machine ?? "" });
    };
    if (folder && this.missing.has(folder)) {
      warn(folder);
      return;
    }
    if (folder && !checking() && !this.probed.has(folder)) {
      if (this.choosing) return;
      this.choosing = true;
      const verify = async (acx) => {
        try {
          const gone = await missingFolders([folder]);
          if (this.closed) return;
          if (gone) {
            this.probed.add(folder);
            if (gone.has(folder)) {
              this.missing.add(folder);
              warn(folder);
              acx?.notify();
              return;
            }
          }
          openItem();
        } finally {
          this.choosing = false;
        }
      };
      if (cx?.spawn) cx.spawn(verify);
      else void verify(cx);
      return;
    }
    openItem();
  }

  forget(project, cx) {
    if (!project) return;
    const next = forgetProject(shared(KEY.projects), project.machine, project.folder);
    if (next === null) return;
    setShared(KEY.projects, next);
    const remaining = this.items();
    this.at = Math.max(0, Math.min(this.at, remaining.length - 1));
    cx.notify();
  }

  showMachines(on, cx) {
    this.picking = on;
    this.at = 0;
    this.filter = "";
    const input = on ? this.machineInput : this.spaceInput;
    input.set_value("");
    input.focus();
    if (!on && !checking()) this.probeFolders(cx);
    cx.notify();
  }

  row(item, i, ps, hasProjects) {
    const t = theme(), on = this.at === i, { space, project } = item, entry = space ?? project;
    const folder = space ? placeOf(space, ps) : project?.folder;
    const missing = Boolean(entry && !entry.machine && folder && this.missing.has(folder));
    // Another machine's folder is said whole: `~` here is this computer's home. An empty one on a live remote space is its home.
    const sub = entry ? (entry.machine ? folder || "~" : shortFolder(folder)) : item.sub;
    return h_flex().id(item.key).w_full().h(ROW).px(8).py(6).gap(8).rounded(4).items_center().flex_none()
      .role("button").accessibility_label(entry?.name ?? item.name)
      .when(on, el => el.bg(t.selected))
      .when(Boolean(item.off) || missing, el => el.opacity(0.64))
      .on_hover((over, cx) => { if (over && this.at !== i) { this.at = i; cx.notify(); } })
      .on_click((_e, cx) => this.choose(item, cx))
      // As T3's CommandPaletteTitleIcon: level with the title, not the row.
      .child(h_flex().w(16).h(20).pt(2).self_start().flex_none().items_center().justify_center()
        .child(entry ? projectMark("mods/t3-new-menu", entry, 16, t, ps) : svg(`mods/t3-new-menu/icons/${item.machine ? "server" : "monitor"}.svg`).size(16).text_color(t.muted)))
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().text_color(t.foreground).child(entry?.name ?? item.name))
        .child(h_flex().min_w(0).gap(4).items_center().text_size(12).line_height("16px").text_color(t.dim)
          // As T3 marks a remote thread: a server icon, then the name.
          .when(Boolean(entry?.machine), el => el
            .child(svg("mods/t3-new-menu/icons/server.svg").size(12).flex_none().text_color(t.muted))
            .child(div().flex_none().text_color(t.muted).child(`${entry.machine} ·`)))
          .child(div().min_w(0).truncate().child(sub))
          .when(missing, el => el.child(div().flex_none().text_color(t.ansi1).child("· Folder not found")))))
      .when(Boolean(entry) && i < 9, el => el.child(div().flex_none().text_size(12).font_medium().text_color(t.muted).child(keyLabel(`cmd-${i + 1}`))))
      .when(Boolean(space) && hasProjects, el => el.child(div().w(20).flex_none()))
      .when(Boolean(project), el => {
        const removeId = `remove-${item.key}`;
        return el.child(stop(this, t, removeId, ghostButton(this, t, removeId, {
          icon: "mods/t3-new-menu/icons/x.svg", label: `Remove ${project.name}`, size: "micro", surface: "card",
          act: (cx) => this.forget(project, cx),
        }), 4));
      });
  }

  rowsView(t, items, ps, liveCount, dormantCount) {
    const id = "new-rows";
    const hasProjects = !this.picking && dormantCount > 0;
    const hasProjectsHead = !this.picking && liveCount > 0 && dormantCount > 0;
    const headTop = liveCount * ROW;
    const rowTop = (i) => i * ROW + (hasProjectsHead && i >= liveCount ? HEAD : 0);
    const needTop = (i) => hasProjectsHead && i === liveCount ? headTop : rowTop(i);
    const totalH = items.length * ROW + (hasProjectsHead ? HEAD : 0);
    const seen = Math.min(totalH, LIST_MAX);
    const max = Math.max(0, totalH - seen);
    let top = Math.max(0, Math.min(this.scrollTop?.[id] ?? 0, max));
    const py = this.pointerY?.[id];
    let pointed = -1;
    if (py !== undefined) {
      const y = py + top;
      if (y >= 0 && y < totalH) {
        if (!hasProjectsHead || y < headTop) pointed = Math.floor(y / ROW);
        else if (y >= headTop + HEAD) pointed = Math.floor((y - HEAD) / ROW);
      }
    }
    if (this.at >= 0 && this.at < items.length && this.at !== pointed) {
      top = Math.max(0, Math.min(top, needTop(this.at), max), rowTop(this.at) + ROW - seen);
    }
    this.scrollTop = { ...this.scrollTop, [id]: top };
    const rows = [];
    for (let i = 0; i < items.length; i++) {
      if (hasProjectsHead && i === liveCount && headTop + HEAD > top && headTop < top + seen) {
        rows.push(div().id("new-projects-heading").h(HEAD).px(8).pt(8).pb(4)
          .text_size(12).line_height("16px").font_medium().text_color(t.muted).child("Projects")
          .absolute().left(0).right(0).top(headTop - top));
      }
      const y = rowTop(i);
      if (y + ROW > top && y < top + seen) {
        rows.push(this.row(items[i], i, ps, hasProjects).absolute().left(0).right(0).top(y - top));
      }
    }
    return div().id(id).relative().overflow_hidden().flex_none().h(seen)
      .on_mouse_move((e) => { this.pointerY = { ...this.pointerY, [id]: e.local_position.y / (Number(settings()?.zoom) || 1) }; })
      .on_hover((on) => { if (!on) this.pointerY = { ...this.pointerY, [id]: undefined }; })
      .on_scroll_wheel((e, cx) => {
        // Herdr hands a wheel to what's under a popup too.
        cx.stop_propagation();
        const from = this.scrollTop[id], next = Math.max(0, Math.min(from - e.delta.y / (Number(settings()?.zoom) || 1), max));
        if (next === from) return;
        this.scrollTop = { ...this.scrollTop, [id]: next };
        let firstFull = -1, lastFull = -1;
        for (let i = 0; i < items.length; i++) {
          if (needTop(i) >= next && rowTop(i) + ROW <= next + seen) {
            if (firstFull < 0) firstFull = i;
            lastFull = i;
          }
        }
        if (this.at >= 0 && firstFull >= 0) this.at = Math.min(Math.max(this.at, firstFull), lastFull);
        cx.notify();
      })
      .children(rows);
  }

  render() {
    const t = theme(), ps = panes(), plan = newSpacePlan(), items = this.items(plan, ps);
    const liveCount = this.picking ? 0 : items.filter(it => Boolean(it.space)).length;
    const dormantCount = this.picking ? 0 : items.length - liveCount;
    const hasProjects = !this.picking && dormantCount > 0;
    const heading = this.picking ? "Machines" : liveCount === 0 && dormantCount > 0 ? "Projects" : "Spaces";
    // ⌘N doesn't ask: it only names what this button does when there's nothing to ask.
    const newKey = plan.ask ? "" : keyOf("space.new");
    const hints = [
      ["↑ ↓", "Navigate"],
      ["Enter", this.picking ? "New space" : "New tab"],
      ...(hasProjects ? [[window()?.platform === "macos" ? "⌃D" : "Ctrl+D", "Remove"]] : []),
      ["Esc", "Close"],
    ];
    return focusRoot(this, v_flex().id("new-menu").size_full().min_h(0).rounded(16).border(1).border_color(t.border).bg(t.popover).shadow_2xl().text_size(14).line_height("20px")
      .on_key_down((e, cx) => {
        if (e.key === "escape") return closeOverlay(props().overlay);
        const to = step(e, this.at, items.length);
        if (to >= 0) this.at = to;
        else if (!this.picking && e.key === "d" && e.modifiers?.control) {
          if (!items[this.at]?.project) return;
          cx.stop_propagation();
          return this.forget(items[this.at].project, cx);
        }
        else if (!this.picking && /^[1-9]$/.test(e.key) && e.modifiers?.platform) { cx.stop_propagation(); return this.choose(items[Number(e.key) - 1], cx); }
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().h(36).my(6).flex_none().pl(18).pr(20).gap(7).items_center()
        .child(svg("mods/t3-new-menu/icons/search.svg").size(16).flex_none().text_color(t.dim))
        .child(Input.new(this.picking ? this.machineInput : this.spaceInput).flex_1().h_full().text_size(14).text_color(t.foreground)))
      .child(div().mt(8).px(16).py(6).flex_none().text_size(12).line_height("16px").font_medium().text_color(t.muted).child(heading))
      .child(div().flex_none().mb(8).px(8)
        .when(items.length > 0, el => el.child(this.rowsView(t, items, ps, liveCount, dormantCount)))
        .when(items.length === 0, el => el.child(div().py(40).text_center().text_color(t.dim).child(this.picking ? "No matching machines." : "No matching spaces."))))
      .child(paletteFooter(t, hints, this.picking
        ? stop(this, t, "new-back", footAction(t, "new-back", "Back to spaces").on_click((_e, cx) => this.showMachines(false, cx)).child("← Spaces"), 8)
        : stop(this, t, "space-new", footAction(t, "space-new", "New space").on_click((_e, cx) => plan.ask ? this.showMachines(true, cx) : this.choose(plan.candidates[0], cx))
          .child(svg("mods/t3-new-menu/icons/folder-plus.svg").size(14).text_color(t.muted))
          .child("New space")
          .when(Boolean(newKey), row => row.child(keycap(t, newKey))), 8))));
  }
}
