// The Review page's header: the scope button naming what it compares, a commit's short sha with ‹ › through its diff's
// commits, `head → base` with T3's base picker, and the scope menu with its Commits submenu drawn inside the page (popovers,
// not popups). What the menu reads, its rows and its picks are review-scope.js's, as Details shares them.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { shared, setShared, spaces } from "herdr";
import { scrollList, step } from "./list.js";
import { hoverRow, subOpened, subLeft } from "./submenu.js";
import { LU, COMPACT, MODEL_ROW, pickMark, searchField, popupClosed } from "./review-menu.js";
import { popover, toPane, subState, subAt, HEADER, BELOW } from "./controls.js";
import { BASES, chosenBase, changesPage, diffCommits, repo, scopeOf, scopeRows, scopeList, scopeRow, scopeItems, readScope, releaseScope, openReviewPage, menuKey, commitsKey, commitsBody } from "./review-scope.js";
import { opener } from "./trigger.js";
import { button as drawButton, ghostButton, GROUP_GAP } from "./button.js";
import { glow } from "./tip.js";
import { menuRow } from "./menu-row.js";

/** Opens the submenu `page` ("commits") beside its row, which stays lit; the keyboard is its search's. */
export function openScopePage(view, page, cx, lit = -1) {
  view.scopePage = page; view.scopeSearch.set_value(""); view.scrollTop = { ...view.scrollTop, "scope-list": 0 };
  view.scopeListAt = lit; view.scopeAt = scopeRows(view).findIndex(row => row.sub === page);
  subOpened(subState(view), page);
  view.scopeSearch.focus();
  cx.notify();
}

/** Closes the submenu, the keyboard back on the menu: by keys, on the row that opened it (`lit`); by the pointer, where it is. */
function scopeBack(view, cx, lit = true) {
  const from = view.scopePage;
  view.scopePage = null; view.scopeSearch.set_value("");
  if (lit) view.scopeAt = scopeRows(view).findIndex(row => row.sub === from);
  subOpened(subState(view), null);
  view.handle.focus();
  cx.notify();
}

// Resting on a row opens its submenu, or closes the open one (submenu.js).
function scopeRest(view, key, e, cx) {
  hoverRow(subState(view), key, toPane(view, e), cx, (key, _row, cx) => key ? openScopePage(view, key, cx) : view.scopePage && scopeBack(view, cx, false));
}

const menuWidth = (view) => Math.min(320, view.width - 32);


/** The scope menu's and the base picker's keys. True means one of them owns the keyboard, including search-field typing. */
export function scopeKey(view, e, cx) {
  if (view.popup === "scope") {
    if (!view.scopePage) menuKey(view, e, cx);
    else commitsKey(view, e, cx, (cx) => scopeBack(view, cx));
    return true;
  }
  if (view.popup === "base") {
    if (e.keystroke === "escape") { view.closePopup(cx); cx.stop_propagation(); return true; }
    const to = step(e, view.baseAt, baseList(view).length);
    if (to >= 0) { view.baseAt = to; cx.stop_propagation(); cx.notify(); }
    return true;
  }
  return false;
}


// As the toolbar's xs ghost buttons (docs/adr/0013), its words truncating, a chevron at 70%: no fill of its own over the
// toolbar's, only hovered or while its menu is open. Its box at 12, under the panel head's first tab's (t3-tokens「规则」R1), with
// a sm button's own padding both sides: its words 22 in, where Files' first crumb has its words.
function scopeButton(view, t, s) {
  return opener(view, { closed: popupClosed("scope"), onOpen: (b, cx) => view.togglePopup("scope", cx, !b) })(drawButton(t, "review-scope", { variant: "plain", wide: true, label: `Diff scope: ${s.label}`, size: "sm", surface: "chrome", on: view.popup === "scope", hot: view.hot === "review-scope" }).min_w(0).flex_shrink(1)
    .on_hover(glow(view, "review-scope")))
    .child(div().id("review-scope-label").min_w(0).truncate().child(s.label))
    .child(svg(`${LU}/chevron-down.svg`).size(14).flex_none().opacity(0.7));
}

/** The header's left end: the scope, a commit's sha and ‹ › within its diff, then `head → base` (narrow, `vs base`). */
export function scopeHeader(view, t, { trigger = true } = {}) {
  const s = scopeOf(view), list = diffCommits(view), at = s.sha ? list.findIndex(c => c.sha === s.sha) : -1;
  // A commit opened as its own diff, or no longer listed (as after an amend), has nowhere to step.
  const steps = s.sha && view.page !== view.base && at >= 0;
  // The Review header's 40 bar: its buttons sm on chrome (t3-tokens「规则」R2, P7).
  const go = (id, icon, label, c) => ghostButton(view, t, id, { icon, label, act: (cx) => openReviewPage(view, `/commit/${c.sha}`, cx), disabled: !c, size: "sm", iconSize: 14, surface: "chrome" });
  return h_flex().id("review-scope-row").min_w(0).gap(12).items_center()
    .when(trigger, el => el.child(scopeButton(view, t, s)))
    .when(Boolean(s.sha), el => el.child(h_flex().flex_none().gap(GROUP_GAP).items_center()
      .child(div().id("review-sha").mr(4).text_size(12).text_color(t.dim).child(s.sha.slice(0, 7)))
      .when(steps, el => el
        .child(go("commit-older", `${LU}/chevron-left.svg`, "Older commit", list[at - 1]))
        .child(go("commit-newer", `${LU}/chevron-right.svg`, "Newer commit", list[at + 1])))))
    // As T3's refs, which drop the head below 20rem: here below COMPACT, where the header's buttons turn to icons. On Changes
    // the base is T3's comparison-target picker.
    .when(Boolean(s.head && s.base), el => el.child(h_flex().id("review-refs").min_w(0).gap(8).items_center().overflow_hidden().text_size(12).text_color(t.dim)
      .when(view.width >= COMPACT, el => el
        .child(div().id("review-ref-head").min_w(0).max_w(192).truncate().child(s.head))
        .child(svg(`${LU}/arrow-right.svg`).size(14).flex_none().opacity(0.7)))
      .when(view.width < COMPACT, el => el.child(div().id("review-ref-vs").flex_none().child("vs")))
      .when(s.kind !== "changes", el => el.child(div().id("review-ref-base").min_w(0).truncate().child(s.base)))
      .when(s.kind === "changes", el => el.child(baseButton(view, t, s)))));
}

// As T3's ComboboxTrigger there: a ghost-muted xs button, 36 to 192 wide, the ref truncating, a chevron at 70%. Its press
// notes where it is, for the popup to hang under it.
function baseButton(view, t, s) {
  return opener(view, { closed: popupClosed("base"), press: (e) => { view.baseX = toPane(view, e).bounds?.x ?? null; }, onOpen: (_b, cx) => view.togglePopup("base", cx) })(
    drawButton(t, "review-base", { wide: true, label: `Change comparison target. Currently ${s.base}`, surface: "chrome", on: view.popup === "base", hot: view.hot === "review-base" }).min_w(36).max_w(192)
      .on_hover(glow(view, "review-base")))
    .child(div().id("review-ref-base").min_w(0).truncate().child(s.base))
    .child(svg(`${LU}/chevron-down.svg`).size(14).flex_none().opacity(0.7));
}

/** The base picker's rows, as T3's buildBaseRefChoices: Automatic (unless searching), then each local branch with its
 *  remote of the same name (origin's first), then the remote-only ones, the default branch lifted first; the head itself left out. A row picks its local
 *  ref, or the remote one where that's what's picked. */
export function baseList(view) {
  const query = view.refSearch.value().trim().toLowerCase(), picked = chosenBase(view), head = scopeOf(view).head;
  const r = view.scopeRoot === view.root || view.scopeGit?.root === view.root ? view.scopeGit : null, refs = r ? view.refs : null, cached = view.scopeBases;
  if (cached && cached.refs === refs && cached.query === query && cached.picked === picked && cached.head === head && cached.repo === r) return cached.rows;
  const remotes = (refs ?? []).filter(ref => ref.remote);
  const short = (ref) => ref.name.slice(ref.remote.length + 1);
  const choices = (refs ?? []).filter(ref => !ref.remote && ref.name !== head).map(local => {
    const matches = remotes.filter(remote => short(remote) === local.name);
    const remote = matches.find(m => m.remote === "origin") ?? matches[0] ?? null;
    return { label: local.name, local: local.name, remote: remote?.name ?? null };
  });
  const paired = new Set(choices.map(c => c.remote));
  choices.push(...remotes.filter(r => !paired.has(r.name)).map(r => ({ label: r.name, local: null, remote: r.name })));
  // The default branch first, as T3's listRefs keeps it on the first page; the rest stay newest first.
  const auto = repo(view), isDefault = (c) => Boolean(auto?.base) && (c.local === auto.base || c.remote === auto.baseRef);
  choices.sort((a, b) => Number(isDefault(b)) - Number(isDefault(a)));
  const rows = [
    ...query ? [] : [{ id: "base-auto", label: "Automatic", value: null }],
    ...choices.filter(c => [c.label, c.local, c.remote].some(n => n?.toLowerCase().includes(query)))
      .map(c => ({ ...c, id: `base-${c.label}`, value: picked && picked === c.remote ? picked : c.local ?? c.remote })),
  ];
  view.scopeBases = { refs, query, picked, head, repo: r, rows };
  return rows;
}

/** Opening the picker: its refs read afresh, the search empty and focused, the picked row lit. */
export function openBase(view, cx) {
  view.refSearch.set_value("");
  view.baseAt = Math.max(0, baseList(view).findIndex(item => item.value === chosenBase(view)));
  view.refSearch.focus();
  readScope(view, cx);
}

/** Picks `value` (null: Automatic) as this space's base, and shows Changes against it; the switch's pick `stays` open, as T3's. */
export function pickBase(view, value, cx, stays = false) {
  const head = scopeOf(view).head ?? repo(view)?.branch;
  releaseScope(view);
  const live = new Set(spaces().map(s => s.id));
  live.add(view.space);
  const kept = Object.fromEntries(Object.entries(shared(BASES) ?? {}).filter(([id]) => live.has(id)));
  setShared(BASES, { ...kept, [view.space]: value });
  if (head) view.pick(changesPage(value, head), { stays }, cx);
  else if (!stays) view.closePopup(cx);
}

const BASE_W = 288; // T3's w-72

/** The base picker, as T3's ComboboxPopup: under its button, 288 wide; a search, a BRANCH / REMOTE heading, then the rows,
 *  256 tall at most. A row with a local and a remote ref has T3's switch to take the remote one; a remote-only row, a check. */
export function baseMenu(view, t) {
  const items = baseList(view), picked = chosenBase(view), height = Math.min(items.length * MODEL_ROW, 256);
  const draw = (i) => {
    const item = items[i], on = item.value === picked, remote = Boolean(item.remote) && item.value === item.remote;
    return menuRow(view, t, item.id, { at: [view, "baseAt", i], label: item.label, lead: pickMark(on), pick: (cx) => pickBase(view, item.value, cx),
      trail: div().w(32).flex_none().flex().justify_end()
        .when(Boolean(item.local && item.remote), el => el.child(div().id(`${item.id}-remote`).w(22).h(14).p(1).flex().rounded_full()
          .bg(remote ? t.accent : t.input).when(remote, el => el.justify_end())
          .role("switch").accessibility_label(`Use remote version of ${item.label}${remote ? ", on" : ""}`)
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); pickBase(view, remote ? item.local : item.remote, cx, true); })
          .child(div().size(12).rounded_full().bg(t.background))))
        .when(Boolean(item.remote) && !item.local, el => el.child(svg(`${LU}/check.svg`).size(12).text_color(t.dim))) })
      .role("radio_button").accessibility_label(`${item.label}${on ? ", picked" : ""}`);
  };
  const x = Math.max(8, Math.min(view.baseX ?? 16, view.width - BASE_W - 8));
  // 4 under its 24 button, centred in the header.
  return div().absolute().top(HEADER / 2 + 24 / 2 + 4).left(x).child(popover(view, t, "review-base-menu").w(Math.min(BASE_W, view.width - 16)).p(4)
    .child(searchField(t, view.refSearch).mx(8).mt(5))
    // As T3's: 10px, uppercase, the check's column kept.
    .child(h_flex().h(24).pl(30).pr(8).flex_none().items_center().border_b_1().border_color(t.border).text_size(10).font_medium().text_color(t.dim)
      .child(div().flex_1().child("BRANCH")).child(div().child("REMOTE")))
    .child(v_flex().flex_none().mt(4)
      .child(scrollList(view, "base-list", { count: items.length, row: MODEL_ROW, at: view.baseAt, draw, height,
        wheeled: (keep) => { if (keep >= 0) view.baseAt = keep; } }))
      .when(!items.length, el => el.child(div().id("base-none").p(8).flex_none().text_center().text_color(t.dim).child(view.refs ? "No matching refs." : "Reading…")))));
}


/** The scope menu in the Review page, as T3's: radios, a rule, Commits ›, whose submenu opens beside it (scopeSub). */
export function scopeMenu(view, t) {
  const row = (r, i) => scopeRow(view, t, r, i, { open: Boolean(r.sub) && r.sub === view.scopePage,
    also: (el) => el.on_mouse_move((e, cx) => scopeRest(view, r.count ? r.sub ?? null : null, e, cx)) });
  return popover(view, t, "review-scope-menu").w(menuWidth(view)).p(4).children(scopeItems(t, scopeRows(view), row));
}

/** The open submenu of commits in the Review page, as T3's: its search on top, its list at most 320 tall, beside its row
 *  in the menu (main.js draws the menu at top BELOW, left 12; its rows start past its border and padding: rows of 28, a rule of 9). */
export function scopeSub(view, t) {
  const page = view.scopePage, rows = scopeRows(view), radios = rows.filter(r => !r.sub).length;
  const at = rows.findIndex(r => r.sub === page);
  const items = scopeList(view), most = Math.max(MODEL_ROW * 3, Math.min(320, view.height - 180));
  // Its border and padding, the search and its margins, then the list or its 36 note.
  const h = 10 + 43 + (items.length ? Math.min(items.length * MODEL_ROW, most) : 36);
  const anchor = { x: 17, y: BELOW + 5 + at * MODEL_ROW + (at >= radios ? 9 : 0), width: menuWidth(view) - 10, height: MODEL_ROW };
  // 384 where there's room beside the menu, else narrower (its subjects truncate), never over its row (subAt).
  const { at: box, w } = subAt(view, anchor, 384, h);
  // The pointer on it: nothing pending on the menu's rows opens or closes it.
  return box.child(popover(view, t, "review-scope-sub", false).w(w).p(4).on_hover((on) => { if (on) subLeft(subState(view)); })
    .children(commitsBody(view, t, { height: most })));
}
