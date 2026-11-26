// The Review bar: the focused worktree's uncommitted files and its commits ahead of and behind
// its upstream, each opening that diff. The counts read the remote-tracking refs as they are; nothing fetches.
// Herdr T3 owns its panel controls; an older toggle-only bar collapses to nothing.

import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, Popup } from "gpui-base";
import { checking, spaces, panes, focused, watchFolder, window, openOverlay, props, setShared, shared, theme, home } from "herdr";
import { launch } from "./open.js";
import { detailsFor, detailsAt, detailsLine, detailsCard } from "./details.js";
import { glow, tip } from "./tip.js";
import { step, scrollList } from "./list.js";
import { stop } from "./focus.js";
import { KEY, closedKey } from "./store.js";
import { git, argPage, readReview, readPicks } from "./review-git.js";
import { button, radiusOf, tint } from "./button.js";
import { menuRow, MENU_ROW } from "./menu-row.js";
import { statusMark } from "./status-mark.js";
import { hang, trigger } from "./trigger.js";
import { reviewShown, REVIEW_STATUS } from "./panel.js";
import { alpha } from "./color.js";

const MOD = "pulls-review";
// A conventional commit's type and scope (`fix(t3-tabs): `), dimmed so the words after it lead.
const PREFIX = /^[a-z]+(\([^)]*\))?!?: /;
// When the logo's menu last closed: a press outside a popup closes it before the press's own click lands.
const MENU_CLOSED = closedKey(MOD, "menu");
export const menuClosed = () => setShared(MENU_CLOSED, Date.now());

// The menu's rows (T3's MenuItem), and what sits above them: its padding, search field and either the pages' switch or a title.
const MENU_W = 368, menuChrome = (tabs) => 8 + 43 + (tabs ? 32 : 28);

// The shipped `changes` mod's lookup, except for a mod pane (below).
export function reviewLocation() {
  const space = spaces().find((s) => s.active), f = focused();
  const ps = panes(), pane = f?.pane ? ps.find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  // A mod pane has no folder: its tab's terminals stand in.
  const beside = pane && !pane.cwd ? ps.find(p => p.tab === pane.tab && p.cwd)?.cwd : null;
  return { space: space?.id, cwd: pane?.cwd || beside || f?.cwd || space?.folder, on };
}
// Git counts are reusable across spaces with the same folder; open intents aren't.
const locationKey = ({ cwd, on }) => JSON.stringify({ cwd, on });
const sameSource = (a, b) => a.space === b.space && a.cwd === b.cwd && a.on === b.on;
// A commit's age as the Inbox's settled rows read (t3-inbox's ago), but "now" for "just now": the column is narrow.
function ago(ms, now) {
  const m = Math.floor((now - ms) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// A commit's card: its age, then when to the minute (`2h ago · Nov 5, 10:37`).
function when(ms, now) {
  const d = new Date(ms), short = ago(ms, now), pad = (n) => String(n).padStart(2, "0");
  return `${short === "now" ? "just now" : `${short} ago`} · ${MONTHS[d.getMonth()]} ${d.getDate()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Worth a read? Of Git's own files only HEAD and refs, and nothing Git ignores: macOS reports those too.
async function touchesDiff(root, paths) {
  if (paths.some(p => /\/\.git\/(HEAD|refs\/)/.test(p))) return true;
  const files = paths.filter(p => !/\/\.git(\/|$)/.test(p));
  if (!files.length) return false;
  // check-ignore: 0 some ignored and listed, 1 none, 128 can't judge.
  const r = await git(root, ["check-ignore", "--", ...files]).catch(() => null);
  return r?.code !== 0 || r.stdout.trim().split("\n").length < files.length;
}

// Each location keeps its last read, so switching back shows it at once and switching away never shows the old one.
// Focus is checked every 250 ms (memory reads only); git is read on a new location, a change in the worktree (a second
// after the last read at the soonest), else every 10 s.
// Herdr T3's Home: no worktree to count.
const onHome = () => shared(KEY.home) && spaces().some((s) => s.active && s.id === shared(KEY.home));

export function watchReview(view, cx) {
  view.reviews = new Map();
  view.reviewAt = new Map();
  view.reviewBusy = new Set();
  view.reviewWatching = new Map(); // This run only: root -> the loop's own { wait } token
  view.reviewClosed = false;
  if (checking()) return;
  view.reviewTimer = cx.timer.every(250, (cx) => {
    if (view.reviewClosed) return;
    const where = reviewLocation(), key = locationKey(where);
    const moved = key !== view.reviewKey;
    if (moved) { view.reviewKey = key; cx.notify(); }
    const current = view.reviews.get(key)?.root;
    for (const [root, token] of view.reviewWatching) if (root !== current) {
      view.reviewWatching.delete(root);
      token.wait?.cancel();
    }
    if (onHome() || !window()?.active || view.reviewBusy.has(key) || !moved && Date.now() - (view.reviewAt.get(key) ?? 0) < 10000) return;
    view.reviewBusy.add(key);
    view.reviewAt.set(key, Date.now());
    cx.spawn(async (cx) => {
      try {
        const review = where.cwd && !where.on ? await readReview(where.cwd) : null;
        if (view.reviewClosed) return;
        view.reviews.set(key, review);
        const root = review?.root;
        if (root && view.reviewKey === key && !view.reviewWatching.has(root)) {
          const token = { wait: null };
          view.reviewWatching.set(root, token);
          cx.spawn(async () => {
            try {
              while (view.reviewWatching.get(root) === token && view.reviews.get(view.reviewKey)?.root === root) {
                token.wait = watchFolder(root);
                const paths = await token.wait, soon = Date.now() - 9000;
                token.wait = null;
                if (view.reviewWatching.get(root) !== token) return;
                // Only this repo's locations: another's late event leaves them be. Already due, nothing to ask git.
                const mine = [...view.reviewAt].filter(([k, at]) => view.reviews.get(k)?.root === root && at > soon);
                // Out of focus, no check-ignore per batch: the read on coming back settles it.
                if (mine.length && (!window()?.active || await touchesDiff(root, paths)) && view.reviewWatching.get(root) === token) {
                  for (const [k, at] of mine) view.reviewAt.set(k, Math.min(at, Date.now() - 9000));
                }
              }
            }
            catch {} // The next read watches it again.
            finally { if (view.reviewWatching.get(root) === token) view.reviewWatching.delete(root); }
          });
        }
      } catch { view.reviews.set(key, null); }
      finally { view.reviewBusy.delete(key); cx.notify(); }
    });
  });
}

export function stopReview(view) {
  view.reviewClosed = true;
  view.reviewTimer?.cancel();
  for (const [root, token] of view.reviewWatching ?? []) {
    view.reviewWatching.delete(root);
    token.wait?.cancel();
  }
}

const branchArgs = (b) => [`${props().baseRef}...${b.name}`];
// No analysis here: browsing the menu's commits mustn't start and bill one per click. The menu closes once it's open:
// closing it first would stop this task.
const openPick = (args, cx) => {
  const { source, root, overlay } = props();
  cx.spawn(() => launch({ source, root, args, page: argPage(args), overlay }));
};

function reviewMatches(view) {
  const query = view.search.value().trim().toLowerCase(), { commits, branches } = props();
  return {
    commits: commits.filter(c => c.sha.startsWith(query) || c.subject.toLowerCase().includes(query)),
    branches: branches.filter(b => b.name.toLowerCase().includes(query) || (b.subject ?? "").toLowerCase().includes(query)),
  };
}

export function initReviewMenu(view) {
  view.search = InputState.new({ placeholder: props().branches.length ? "Search commits and branches" : "Search commits" });
  view.at = 0;
  // All the shas not pushed, which can far outnumber the menu's rows: looked up per row on every render.
  view.unpushed = new Set(props().unpushed ?? []);
  view.tab = props().commits.length ? "commits" : "branches";
  view.search.on("change", (_e, cx) => {
    // A search that empties the page shown and not the other turns to the other.
    const m = reviewMatches(view), other = view.tab === "commits" ? "branches" : "commits";
    if (!m[view.tab].length && m[other].length) view.tab = other;
    view.at = 0; view.scrollTop = {}; view.hovered = null; detailsFor(view, null, cx); cx.notify();
  });
  view.search.on("submit", (_e, cx) => menuPicks(view)[view.at]?.act(cx));
  view.search.focus();
}

// The menu's rows in order, each with what it opens: the highlight walks them, as the Actions and New menus'.
function menuPicks(view) {
  const { commits, branches } = reviewMatches(view);
  if (view.tab === "branches") return branches.map(b => ({ id: `review-branch-${b.name}`, act: (cx) => openPick(branchArgs(b), cx) }));
  return commits.map(c => ({ id: `review-commit-${c.sha}`, act: (cx) => openPick([c.sha], cx) }));
}

// Commits and branches are two pages of the menu, so the two never read as one list; Tab or a click turns between them.
const menuTabs = () => props().branches.length > 0 && props().commits.length > 0;
function setTab(view, tab, cx) {
  view.tab = tab; view.at = 0; view.hovered = null;
  detailsFor(view, null, cx);
  cx.notify();
}

// The logo's menu, this mod opened as an overlay with props.menu (main.js).
export function reviewMenu(view) {
  const t = theme(), { base, branch, height, upstream } = props(), { commits, branches } = reviewMatches(view);
  const now = Date.now(), picks = menuPicks(view);
  // The card follows the highlight, by pointer or key: a commit's opens, anything else's closes it.
  const highlight = (at, cx) => {
    view.at = at;
    const id = picks[at].id;
    detailsFor(view, /^review-(commit|branch)-/.test(id) ? id : null, cx);
    cx.notify();
  };
  // As T3's MenuGroupLabel.
  const title = (text) => div().h(28).px(8).flex_none().flex().items_center().text_size(12).font_medium().text_color(t.dim).child(text);
  const tabs = menuTabs(), tab = view.tab, scope = tab === "branches" ? `vs ${base}` : branch === "(detached)" ? "" : `on ${branch}`;
  // As T3's segmented ToggleGroup; the page shown on a popover's on fill (button.js tint), as a pressed button on a card.
  const segment = (id, label, n) => h_flex().id(`review-tab-${id}`).h(24).px(10).gap(8).flex_none().items_center().rounded(6).text_size(12).font_medium()
    .when(id === tab, el => el.bg(tint(t, "card", true)).text_color(t.foreground)).when(id !== tab, el => el.text_color(t.dim).hover(s => s.bg(alpha(t.foreground, "0a"))))
    .role("button").accessibility_label(`${label}, ${n}${id === tab ? ", shown" : ""}`).on_click((_e, cx) => setTab(view, id, cx))
    .child(label).child(div().text_color(t.dim).child(String(n)));
  // menu-row.js's row, lit by the pointer or ↑/↓ (list `i` is pick `i`); its hover also opens the row's card, its last child.
  const row = (i, id, name, action, { icon = null, label, trail, card }) => menuRow(view, t, id, { at: [view, "at", i], label, icon, trail, pick: (cx) => action(null, cx),
    also: (el) => el.accessibility_label(name).child(card)
      .on_hover((on, cx) => {
        if (on) { view.hovered = id; highlight(i, cx); }
        else if (view.hovered === id) { view.hovered = null; detailsFor(view, null, cx); cx.notify(); }
      })
      .on_mouse_move((e) => detailsAt(view, id, e)) });
  // Rows keep their handlers, as a virtual list's can't: a hovered commit opens its card. Only the rows in view are built.
  // The list shown is the picks, row for row. The wheel takes the highlight along, and a card moves off.
  const list = (id, count, draw) => scrollList(view, id, { count, row: MENU_ROW, at: view.at, draw, wheeled: (keep, cx) => {
    if (keep >= 0) view.at = keep;
    view.hovered = null;
    detailsFor(view, null, cx);
  } }).flex_1().min_h(0);
  // A popup's height is only a maximum: this one sets its own, for the list to scroll inside and to hold still while searching.
  return v_flex().id("review-menu").w_full().h(height).p(4).bg(t.popover).text_size(14)
    .on_key_down((e, cx) => {
      if (e.key === "tab" && tabs) { setTab(view, tab === "commits" ? "branches" : "commits", cx); cx.stop_propagation(); return; }
      const to = step(e, view.at, picks.length);
      if (to < 0) return;
      view.hovered = null;
      highlight(to, cx);
      cx.stop_propagation();
    })
    // As T3's MenuSearchInput: 8 in and 6 down less the 1 it shifts up, a 26 field, 6 to the rule, 4 and that 1 below it.
    .child(h_flex().mx(8).mt(5).mb(5).h(33).pb(6).gap(4).flex_none().items_center().border_b_1().border_color(t.border)
      .child(svg(`mods/${MOD}/icons/search.svg`).size(16).flex_none().text_color(t.dim))
      .child(Input.new(view.search).flex_1().h_full().text_size(14).text_color(t.foreground)))
    // Outside the list, so the pages' switch stays put.
    .when(tabs, el => el.child(h_flex().h(28).mx(8).mb(4).gap(8).flex_none().items_center()
      .child(h_flex().p(2).gap(2).flex_none().rounded(8).bg(alpha(t.foreground, "0f"))
        .child(segment("commits", "Commits", commits.length)).child(segment("branches", "Branches", branches.length)))
      .child(div().flex_1()).child(div().min_w(0).truncate().text_size(12).text_color(t.dim).child(scope))))
    .when(!tabs, el => el.child(title(tab === "branches" ? `Branches vs ${base}` : branch === "(detached)" ? "Commits" : `Commits on ${branch}`)))
    .when(tab === "branches", el => el.child(list("review-branches", branches.length, (i) => {
      const b = branches[i], id = `review-branch-${b.name}`;
      return row(i, id, `Review branch ${b.name}` + (b.count === undefined ? "" : `, ${b.count} ahead of ${base}`), (_e, cx) => openPick(branchArgs(b), cx), {
        icon: svg("mods/pulls-review/icons/git-branch.svg").size(16).flex_none().text_color(t.dim),
        label: h_flex().min_w(0).gap(8)
          .child(div().flex_none().max_w(160).truncate().child(b.name))
          .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(b.subject ?? "")),
        trail: h_flex().flex_none().ml(4).gap(8).items_center().text_size(12).text_color(t.dim)
          .when(b.count !== undefined, el => el.child(`${b.count} ahead`))
          .child(b.time ? ago(b.time, now) : ""),
        card: branchCard(view, t, id, b, base, now) });
    })))
    .when(tab === "commits", el => el.child(list("review-commit-list", commits.length, (i) => {
        const c = commits[i], id = `review-commit-${c.sha}`, prefix = PREFIX.exec(c.subject)?.[0] ?? "", out = view.unpushed.has(c.sha);
        return row(i, id, `Review commit ${c.subject}` + (out ? ", not pushed" : ""), (_e, cx) => openPick([c.sha], cx), {
          label: h_flex().min_w(0).gap(4).when(Boolean(prefix), el => el.child(div().flex_none().text_color(t.dim).child(prefix.trim())))
            .child(div().flex_1().min_w(0).truncate().child(c.subject.slice(prefix.length))),
          trail: h_flex().flex_none().ml(4).gap(8).items_center().text_size(12).text_color(t.dim)
            .when(out, el => el.child(div().text_color(t.ansi2).child("↑")))
            .child(c.time ? ago(c.time, now) : ""),
          card: commitCard(view, t, id, c, upstream, out, now) });
      })))
    .when(!picks.length, el => el.child(div().p(8).text_center().text_color(t.dim).child("No matches")));
}

// As an Inbox row's details, but on the row's left: the menu hangs at the window's right. A 1px anchor just outside the
// row's top left corner, the card's top right pinned to it. The whole subject, which the row truncates, then its lines.
const initial = (t, name) => div().size(12).flex_none().rounded_full().bg(t.border).flex().items_center().justify_center()
  .text_size(8).font_medium().text_color(t.muted).child(name.slice(0, 1).toUpperCase());

function commitCard(view, t, id, c, upstream, out, now) {
  const up = view.details === id || view.detailsOut === id;
  return Popup.new(`details-${id}`, div()).absolute().top(-1).left(-1).size(1).anchor("top_right")
    .when(up, pop => pop.content(detailsCard(view, t, id, c.subject, [
      c.time && detailsLine(t, svg("mods/pulls-review/icons/clock.svg").size(12).flex_none().text_color(t.muted), when(c.time, now)),
      c.author && detailsLine(t, initial(t, c.author), c.author),
      upstream && detailsLine(t, svg("mods/pulls-review/icons/git-branch.svg").size(12).flex_none().text_color(out ? t.ansi2 : t.muted), out ? `Not on ${upstream} yet` : `On ${upstream}`),
    ], { wrap: true, from: 4 }).mr(4)));
}

// A branch's card, as a commit's: its last commit, then how it stands against the base and its upstream, and where it's checked out.
function branchCard(view, t, id, b, base, now) {
  const up = view.details === id || view.detailsOut === id, icon = (name, color = t.muted) => svg(`mods/pulls-review/icons/${name}.svg`).size(12).flex_none().text_color(color);
  const ahead = /ahead (\d+)/.exec(b.track ?? "")?.[1], behind = /behind (\d+)/.exec(b.track ?? "")?.[1];
  const upstream = !b.upstream ? "No upstream" : b.track === "gone" ? `${b.upstream} is gone`
    : !ahead && !behind ? `Up to date with ${b.upstream}` : `${[ahead && `${ahead} not pushed`, behind && `${behind} to pull`].filter(Boolean).join(", ")} · ${b.upstream}`;
  const h = home?.() ?? "";
  return Popup.new(`details-${id}`, div()).absolute().top(-1).left(-1).size(1).anchor("top_right")
    .when(up, pop => pop.content(detailsCard(view, t, id, b.name, [
      b.subject && detailsLine(t, icon("file-text"), b.subject),
      b.time && detailsLine(t, icon("clock"), when(b.time, now)),
      b.author && detailsLine(t, initial(t, b.author), b.author),
      b.count !== undefined && detailsLine(t, icon("git-compare"), `${b.count} ahead of ${base}${b.behind ? `, ${b.behind} behind` : ""}`),
      detailsLine(t, icon("git-branch", ahead ? t.ansi2 : t.muted), upstream),
      b.worktree && detailsLine(t, icon("folder"), `Checked out in ${h && b.worktree.startsWith(h) ? "~" + b.worktree.slice(h.length) : b.worktree}`),
    ], { wrap: true, from: 4 }).mr(4)));
}

// What else to review in r's repository, a commit or another branch, in the logo's menu at `at`.
// The menu belongs to the source of the logo that opened it. The second click that closes it is trigger.js's.
function openPicks(view, r, at, source) {
  if (view.readingPicks || !sameSource(source, reviewLocation())) return;
  view.readingPicks = true;
  return (async () => { try {
    const { commits, branches, unpushed } = await readPicks(r);
    // Focus moved on while git read: this repo's menu would hang over another's. Nothing opened: the button isn't on.
    if (view.reviewClosed || !sameSource(source, reviewLocation()) || !commits.length && !branches.length) { view.opened = null; return; }
    // Tall enough for the longer page, so turning pages doesn't resize it; one page alone has a title instead of the switch.
    const tabs = branches.length > 0 && commits.length > 0;
    const height = Math.min(368, menuChrome(tabs) + (tabs ? Math.max(commits.length, branches.length) : commits.length + branches.length) * MENU_ROW);
    openOverlay({ mod: MOD, kind: "popup", at, width: MENU_W, height, props: { menu: "review", source, root: r.root, branch: r.branch, base: r.base, baseRef: r.baseRef, upstream: r.gone ? null : r.upstream, commits, branches, unpushed, height } });
  } finally { view.readingPicks = false; } })();
}

export function reviewBar(view, t, stopPress) {
  // The layout's rightmost header owns its only panel toggle (ADR 0017); Home has no counts.
  if (props()?.toggle || onHome()) return null;
  // Looked up on each render, so the frame that shows another space already shows its own counts.
  const source = reviewLocation(), r = view.reviews?.get(locationKey(source));
  if (!r) return null;
  // How the space's analysis goes: the panel head's mark, here too (docs/adr/0011).
  const { space } = source, word = shared(REVIEW_STATUS)?.[space], mark = statusMark("mods/pulls-review", t, word, 14);
  const n = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  // A narrow bar's layout sets it (Herdr T3's bar-measure): each count with an icon for what it counts. Unset, the words.
  const compact = shared(KEY.compact);
  // What the space's review shows, when it's this repository's.
  const reviewed = reviewShown(space), here = reviewed?.root === r.root ? reviewed : null;
  const pickLabel = `Change what to review${word ? `, analysis ${{ working: "running", done: "done", blocked: "failed" }[word]}` : ""}`;
  // The diff, whichever of its commits the pane is on.
  const isShown = (args) => here?.base === argPage(args, r.branch);
  // The accessibility label says what each count compares, which the short label can't. No color: here it means an agent's state.
  // As T3's ghost xs buttons: 24, 8 in, no outline. Quiet: dim and medium, lit (foreground) hovered or while its diff is the one
  // shown; a hover style can't brighten the icon, so the hover is view.hot. Its label is the name's first part. Compact, the label
  // gives back the words the count lost, `· merged?` included.
  const item = ([id, count, noun, icon, name, args, arrow = ""]) => tip(view, t, id, compact && noun ? `${count} ${noun}` : name.split(": ")[0], stop(view, t, id, button(t, id, {
    text: compact ? count : arrow + count, icon: compact ? `mods/${MOD}/icons/${icon}.svg` : undefined,
    label: isShown(args) ? `${name}, shown` : name, hot: view.hot === id, on: isShown(args),
  })
    .on_hover(glow(view, id))
    .on_click((_e, cx) => cx.spawn(() => launch({ source, root: r.root, args, page: argPage(args, r.branch), analyze: true })))
    .when(Boolean(noun) && !compact, el => el.child(noun)), radiusOf("xs")), { below: true });
  const segments = [
    r.changed > 0 && ["review-changes", String(r.changed), "uncommitted", "file-diff", `Review ${n(r.changed, "uncommitted file")}: staged, unstaged and new`, ["--worktree"]],
    // A squash merge leaves the count standing, so a deleted upstream is the visible hint it may be done.
    r.unmerged > 0 && ["review-open", String(r.unmerged), `ahead of ${r.base}${r.gone ? " · merged?" : ""}`, "git-branch", `Review the branch: ${n(r.unmerged, "commit")} on ${r.branch}, not on ${r.baseRef}`
      + (r.newer ? ` · ${r.baseRef} has ${n(r.newer, "newer commit")}` : "") + (r.gone ? ` · ${r.upstream} is gone, likely merged` : ""), []],
    r.ahead > 0 && ["review-ahead", String(r.ahead), null, "arrow-up", `Review ${r.branch} → ${r.upstream}: ${n(r.ahead, "commit")} to push, on ${r.branch}, not on ${r.upstream}`, [`${r.upstream}...${r.branch}`], "↑"],
    r.behind > 0 && ["review-behind", String(r.behind), null, "arrow-down", `Review ${r.upstream} → ${r.branch}: ${n(r.behind, "commit")} to pull, on ${r.upstream} as of your last fetch, not on ${r.branch}`, [`${r.branch}...${r.upstream}`], "↓"],
  ].filter(Boolean);
  // Under this click's press, if it came with one (from the keys, the app's place). Started here, so a second click while git
  // reads finds it reading.
  const openMenu = (b, cx) => {
    const reading = openPicks(view, r, hang(b, MENU_W).at, source);
    if (!reading) return false;
    cx.spawn(() => reading);
  };
  // No outline: ghost buttons in a row, as the tab bar's own. The last button ends where the bar does, so it stays put as the counts come and go.
  return h_flex().id("pulls-review").h(24).flex_none().items_center().gap(4).on_mouse_down("left", stopPress)
    .children(segments.map(s => item(/** @type {any} */ (s))))
    // Stays with no counts: on a clean default branch it's the only way in.
    // With the analysis's mark after the logo, it grows to hold both.
    // A popup's button as every one (t3-tokens P6): on while its menu is up, its label down meanwhile, a second click closes it.
    .child(trigger(view, t, "review-pick", { label: "Change what to review", below: true, closed: MENU_CLOSED, onOpen: openMenu, size: "xs", wide: Boolean(mark) },
      // As T3's icon-xs. image, not svg: svg would draw the logo in one tint.
      (el) => el.accessibility_label(pickLabel).child(image(`mods/${MOD}/icons/logo.svg`).w(14).h(14).flex_none()).when(Boolean(mark), el => el.child(mark))));
}
