// What the review compares, as T3's DiffPanel header names it, and the scope menu the Review page's header and Details' Quick
// Review both open. A view drawing the menu supplies `pick(page, { analyze, base, stays }, cx)`, asking for that range its own
// way (panel.js reviewRequest), and `openCommits(cx, lit)`, opening Commits where that view puts it.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { shared } from "herdr";
import { scrollList, step, menuJump } from "./list.js";
import { git, readReview, readPicks, readRefs, argPage } from "./review-git.js";
import { PANE, LU, MODEL_ROW, pickMark, searchField } from "./review-menu.js";
import { menuRow, menuRule } from "./menu-row.js";

// A conventional commit's type and scope (`fix(t3-tabs): `), dimmed so the words after it lead.
const PREFIX = /^[a-z]+(\([^)]*\))?!?: /;
// A commit's age as the Review bar's menu reads it.
function ago(ms, now) {
  const m = Math.floor((now - ms) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}
// The base each space's Changes compares to, as T3 keeps one per thread: { [space id]: ref }, a space without one on the
// default branch (Automatic).
export const BASES = `${PANE}.bases`;
/** The base this space's Changes compares to, or null: the default branch. */
export const chosenBase = (view) => shared(BASES)?.[view.space] ?? null;
// A branch's Changes: against the base picked, or the default branch as the Review bar's count opens it.
export const changesPage = (base, head) => base ? argPage([`${base}...${head}`]) : argPage([], head);

const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

// The diff's commits, oldest first: on one commit's page, still its base's.
export function diffCommits(view) { return view.baseCommits ?? (view.switching ? null : view.review?.commits) ?? []; }

// The last read of this review's repository, against the base picked now.
export const repo = (view) => view.scopeRoot === view.root && view.scopeBase === chosenBase(view) ? view.scopeGit : null;

/** What the page shown compares: its kind, the button's words, and for a branch's diff its head and base. */
export function scopeOf(view) {
  const page = view.page ?? "", r = repo(view), [, kind, ...rest] = page.split("/"), value = decodeURIComponent(rest.join("/"));
  if (kind === "worktree") return { kind: "uncommitted", label: "Uncommitted" };
  if (kind === "branch") return { kind: "changes", label: "Changes", head: value, base: (!view.switching && view.review?.base?.ref) || r?.baseRef || null };
  if (kind === "commit") {
    const c = diffCommits(view).find(c => c.sha === value) ?? view.picks?.commits.find(c => c.sha === value);
    return { kind: "commit", label: c?.subject ?? ((!view.switching && view.review?.title) || value.slice(0, 7)), sha: value };
  }
  // A branch against its upstream is what there is to push or to pull, as the Review bar's arrows count them; against any
  // other base, its Changes.
  const [from, to] = value.split("...");
  if (kind === "compare" && to) {
    const push = (r && from === r.upstream && to === r.branch) || from.endsWith(`/${to}`);
    const pull = (r && from === r.branch && to === r.upstream) || to.endsWith(`/${from}`);
    return { kind: push ? "push" : pull ? "pull" : "changes", label: push ? "Outgoing" : pull ? "Incoming" : "Changes", head: to, base: from };
  }
  return { kind: "other", label: value || page };
}

/** Drops a read still out, before the menu closes or its review moves on. */
export function releaseScope(view) {
  view.scopeRead = null; view.scopeWaiting = null; view.scopeSlow = false;
  delete view.scopeFiltered; delete view.scopeBases;
}

// The last read of each repository against each base, for this mod's run only (docs/internals/storage.md): a menu opened anew
// (Details' is a new popup each time) draws it at once while it reads afresh. shortcut: never evicted, a few small reads per
// repository and base visited; bound it if a run visits hundreds.
const scopeCache = new Map();

// Counts, commits and refs, read afresh; what comes back for a menu since closed or moved on is dropped. Until it lands, the
// last read of this repository and base shows (`scopeCached`); with none, the rows' counts stay blank, `…` once slow.
export function readScope(view, cx) {
  releaseScope(view);
  const { root, space, on } = view, base = chosenBase(view), token = {}, key = `${on ?? ""}\n${root}\n${base ?? ""}`;
  view.scopeRead = token;
  const live = () => view.scopeRead === token && !view.evicted && root === view.root && space === view.space && base === chosenBase(view);
  const kept = !repo(view) && scopeCache.get(key);
  if (kept) Object.assign(view, kept);
  view.scopeCached = Boolean(repo(view));
  if (!view.scopeCached) cx.timer.after(150, (cx) => { if (live() && !repo(view)) { view.scopeSlow = true; cx.notify(); } });
  cx.spawn(async (cx) => {
    const r = await readReview(root, on).catch(() => null);
    if (!live()) return;
    const ab = r && base && r.branch !== "(detached)" ? await git(root, ["rev-list", "--left-right", "--count", `${base}...HEAD`], on).catch(() => null) : null;
    if (!live()) return;
    if (ab?.code === 0) r.chosen = { ref: base, unmerged: parseInt(ab.stdout.trim().split(/\s+/)[1], 10) || 0 };
    const [picks, refs] = r ? await Promise.all([readPicks(r.chosen ? { ...r, baseRef: r.chosen.ref, unmerged: r.chosen.unmerged } : r, on).catch(() => null), readRefs(root, on).catch(() => [])]) : [null, []];
    if (!live()) return;
    const read = { scopeGit: r, picks, refs, scopeRoot: root, scopeBase: base };
    if (r) scopeCache.set(key, read);
    Object.assign(view, read, { scopeRead: null, scopeCached: false, scopeSlow: false });
    // A pick made on the last read goes now, if the fresh one still offers that row (docs/internals/specs/details.md).
    const waiting = view.scopeWaiting && scopeRows(view).find(row => row.id === view.scopeWaiting);
    view.scopeWaiting = null;
    if (waiting) pickScopeRow(view, waiting, cx);
    cx.notify();
  });
}

/** The menu's rows: the scopes as radios, each with its count as a number and its unit, then the submenu of commits. One
 *  checked only for the range shown (`view.page`; none before a first review). An empty one is greyed, as T3's disabled
 *  items, unless it's shown. */
export function scopeRows(view) {
  const r = repo(view), p = repo(view) && view.picks, { kind } = scopeOf(view), c = r?.chosen;
  // Not read yet: no count, the number's place blank (or `…` while slow), and not greyed as empty.
  const radio = (id, k, label, count, detail, page) => ({ id, kind: k, label, count, detail: r ? detail : view.scopeSlow ? "…" : "", page, on: kind === k, known: Boolean(r) });
  const ahead = c ? c.unmerged : r?.unmerged, commits = (n) => plural(n ?? 0, "commit");
  return [
    radio("scope-changes", "changes", "Changes", ahead, c || r?.base ? commits(ahead) : "", r && (c || r.base) && changesPage(c?.ref, r.branch)),
    radio("scope-uncommitted", "uncommitted", "Uncommitted", r?.changed, plural(r?.changed ?? 0, "file"), "/worktree"),
    // Only with an upstream: there's nothing to push to or pull from without one.
    ...r?.upstream && !r.gone ? [
      radio("scope-push", "push", "Outgoing", r.ahead, commits(r.ahead), argPage([`${r.upstream}...${r.branch}`])),
      radio("scope-pull", "pull", "Incoming", r.behind, commits(r.behind), argPage([`${r.branch}...${r.upstream}`])),
    ] : [],
    { id: "scope-commits", label: "Commits", count: p?.commits.length, sub: "commits", known: Boolean(p) },
  ];
}

/** The Commits submenu's rows, as its search narrows them: this branch's commits. */
export function scopeList(view) {
  const query = view.scopeSearch.value().trim().toLowerCase(), p = repo(view) && view.picks;
  if (view.scopeFiltered?.p === p && view.scopeFiltered.query === query) return view.scopeFiltered.rows;
  const rows = (p?.commits ?? []).filter(c => c.sha.startsWith(query) || c.subject.toLowerCase().includes(query))
    .map(c => ({ id: `scope-commit-${c.sha}`, page: `/commit/${c.sha}`, commit: c }));
  view.scopeFiltered = { p, query, rows };
  return rows;
}

// Another page of this diff (‹ ›): its base keeps the commits, and it has no `analyze`.
export function openReviewPage(view, page, cx) { view.pick(page, { base: view.base }, cx); }

// A radio asks as a count's click, the analysis included; Commits opens its submenu (`lit`: its row lit). The range shown
// stays pickable at nothing, to read it again.
export function pickScopeRow(view, row, cx, lit = -1) {
  // Drawn from the last read, or not read yet: the fresh read decides (readScope).
  if (view.scopeRead && (view.scopeCached || !repo(view)) && !row.sub) { view.scopeWaiting = row.id; return; }
  if (!row.count && !row.on) return;
  if (row.sub) return view.openCommits(cx, lit);
  view.pick(row.page, { analyze: true }, cx);
}

// Browsing commits mustn't start and bill a run per pick. A commit of the diff shown, or of this branch's Changes, keeps
// that diff as its base so ‹ › step through it.
export function pickListed(view, item, cx) {
  if (!item) return;
  const r = repo(view), sha = item.commit.sha;
  const ofDiff = !view.base?.startsWith("/commit/") && diffCommits(view).some(c => c.sha === sha);
  view.pick(item.page, { base: ofDiff ? view.base : (r?.chosen ? r.chosen.unmerged : r?.unmerged) ? changesPage(r.chosen?.ref, r.branch) : undefined }, cx);
}

/** The scope menu's own keys (scopeRows): ↑/↓, Home, End and typeahead move, Enter, Space or → on Commits picks, Escape closes. */
export function menuKey(view, e, cx) {
  const rows = scopeRows(view), row = rows[view.scopeAt];
  if (e.keystroke === "escape") view.closePopup(cx);
  else if (e.key === "enter" || e.key === "space" || (e.key === "right" && row?.sub)) { if (row) pickScopeRow(view, row, cx, 0); }
  else {
    const to = menuJump(view, e, rows.map(r => r.label), view.scopeAt);
    if (to < 0) return;
    view.scopeAt = to;
  }
  cx.stop_propagation(); cx.notify();
}

/** The Commits submenu's keys: ↑/↓ move in its list; Escape, or ← with the search empty, goes `back`. */
export function commitsKey(view, e, cx, back) {
  if (e.keystroke === "escape" || (e.key === "left" && !view.scopeSearch.value())) { back(cx); cx.stop_propagation(); return; }
  const to = step(e, view.scopeListAt, scopeList(view).length);
  if (to >= 0) { view.scopeListAt = to; cx.stop_propagation(); cx.notify(); }
}

/** The Commits submenu's body, as T3's: its search, then its list `height` tall at most, or a note. `icons`: the mod's own folder. */
export function commitsBody(view, t, { height, icons = LU }) {
  const items = scopeList(view);
  return [searchField(t, view.scopeSearch, icons).mx(8).mt(5).mb(5),
    v_flex().flex_none()
      .child(scrollList(view, "scope-list", { count: items.length, row: MODEL_ROW, at: view.scopeListAt, draw: (i) => commitRow(view, t, items, i, icons), height: Math.min(items.length * MODEL_ROW, height),
        wheeled: (keep) => { if (keep >= 0) view.scopeListAt = keep; } }))
      .when(!items.length, el => el.child(div().id("scope-none").p(8).flex_none().text_center().text_color(t.dim).child(view.picks ? "No matches" : "Reading…")))];
}

/** Opening the menu: its counts read afresh; `lit` the row lit (list.js openLit: the first opened by keys, else none until a key
 *  or the pointer gets there). */
export function openScope(view, cx, lit = -1) {
  view.scopePage = null; view.scopeListAt = -1; view.scopeAt = lit;
  readScope(view, cx);
}

/** One of the scope menu's rows, as T3's MenuRadioItem and MenuSubTrigger: the mark's slot kept on every row so the words
 *  line up. `icons`: the mod's own folder, for the check; `also(row)`: the menu's own handlers. */
export function scopeRow(view, t, r, i, { icons = LU, open = false, also = undefined } = {}) {
  return menuRow(view, t, r.id, { at: [view, "scopeAt", i], label: r.label, open, lead: pickMark(Boolean(r.on), icons), sub: Boolean(r.sub) && icons,
    disabled: r.known && !r.count && !r.on, pick: (cx) => pickScopeRow(view, r, cx),
    trail: r.detail ? div().id(`${r.id}-detail`).flex_none().ml(16).text_size(12).text_color(t.dim).child(r.detail) : null, also })
    .role(r.sub ? "button" : "radio_button").accessibility_label(`${r.label}${r.detail ? `, ${r.detail}` : ""}${r.on ? ", shown" : ""}`);
}

/** The rows of scopeRows, the radios then a rule then Commits, each drawn by `row(r, i)`. */
export const scopeItems = (t, rows, row) => {
  const radios = rows.filter(r => !r.sub).length;
  return [...rows.slice(0, radios).map(row), menuRule(t), ...rows.slice(radios).map((r, i) => row(r, radios + i))];
};

/** Commit `i` of the Commits submenu (scopeList), as T3's: its check, its type and scope dimmed, unpushed ↑, its age. */
export function commitRow(view, t, items, i, icons = LU) {
  const item = items[i], on = item.page === view.page, c = item.commit, now = Date.now();
  const prefix = PREFIX.exec(c.subject)?.[0] ?? "", out = Boolean(view.picks?.unpushed.includes(c.sha));
  const label = h_flex().w_full().min_w(0).gap(4)
    .when(Boolean(prefix), el => el.child(div().flex_none().text_color(t.dim).child(prefix.trim())))
    .child(div().flex_1().min_w(0).truncate().child(c.subject.slice(prefix.length)));
  const trail = (out || c.time) ? h_flex().flex_none().gap(8).items_center()
    .when(out, el => el.child(div().flex_none().text_size(12).text_color(t.ansi2).child("↑")))
    .when(Boolean(c.time), el => el.child(div().id(`${item.id}-time`).flex_none().text_size(12).text_color(t.dim).child(ago(c.time, now)))) : null;
  return menuRow(view, t, item.id, { at: [view, "scopeListAt", i], label, lead: pickMark(on, icons), trail, pick: (cx) => pickListed(view, item, cx) })
    .accessibility_label(`Review commit ${c.subject}${on ? ", shown" : ""}${out ? ", not pushed" : ""}`);
}
