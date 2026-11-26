import { div, svg, image } from "gpui-kit";
import { h_flex, Switch } from "gpui-base";
import { exec, window as appWindow } from "herdr";
import { request } from "./daemon.js";
import { scrollList, openLit } from "./list.js";
import { hoverRow, subOpened, subLeft } from "./submenu.js";
import { menuRow, menuHint } from "./menu-row.js";
import { wrapLines, setWrapLines } from "./store.js";
import { PANE, MODEL_ROW, SPLIT_MIN, BELOW, pref, setPref, pickMark, searchField, popover, toPane, subState, subAt } from "./controls.js";

// Models the settings list before the search must narrow them.
const LISTED = 200;

// As the app's LOCALES (core/locales.ts): the languages an analysis can write in, by their own names.
const LOCALES = [["en", "English"], ["zh-CN", "简体中文"], ["zh-TW", "繁體中文"], ["ja", "日本語"], ["ko", "한국어"], ["es", "Español"], ["fr", "Français"],
  ["de", "Deutsch"], ["pt-BR", "Português (Brasil)"], ["ru", "Русский"], ["it", "Italiano"], ["id", "Bahasa Indonesia"]];

// In the browser, as mods/pulls-review opens one.
function openUrl(url) {
  const platform = appWindow()?.platform;
  const [command, args] = platform === "macos" ? ["open", [url]]
    : platform === "windows" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
  exec(command, args).catch(() => {});
}

// The settings panel reads the daemon's agents and shared settings each time it opens: the browser may have changed them.
// Each lands on its own: the agents take seconds after the daemon starts, settings shown meanwhile can be picked. Only the
// latest read's settings count, and none read before a save: they'd put back what the save changed.
export function loadSettings(view, cx) {
  const root = view.root, on = view.on, read = view.settingsRead = {};
  view.settingsError = null;
  const failed = (e) => { view.settingsError = e?.message ?? String(e); cx.notify(); };
  cx.spawn(async (cx) => {
    try { view.agents = await request(root, "GET", "/api/agents", undefined, on); cx.notify(); } catch (e) { failed(e); }
  });
  cx.spawn(async (cx) => {
    try {
      const shared = await request(root, "GET", "/api/settings", undefined, on);
      if (view.settingsRead === read) { view.shared = shared; cx.notify(); }
    } catch (e) { failed(e); }
  });
}

// Picking an agent or model makes the local agent the provider, as the app's Local agent settings do.
function saveLlm(view, patch, cx) {
  // Whether an agent is set up changes the Analyze button.
  saveShared(view, { llm: { provider: "local-agent", ...patch } }, cx, true);
}

// The daemon's PUT replaces all its settings, and every pane shares the one daemon: saves go one at a time, each
// writing only its own fields over the settings as they are now, so one save can't undo another's.
let saving = Promise.resolve();

function saveShared(view, patch, cx, reload = false) {
  const merged = (s) => ({ ...s, ...patch, ...patch.llm && { llm: { ...s?.llm, ...patch.llm } } });
  view.shared = merged(view.shared); view.settingsRead = null;
  cx.notify();
  const root = view.root, on = view.on;
  const turn = saving.then(async () => request(root, "PUT", "/api/settings", merged(await request(root, "GET", "/api/settings", undefined, on)), on));
  saving = turn.catch(() => {});
  cx.spawn(async (cx) => {
    try { await turn; view.settingsError = null; }
    catch (e) { view.settingsError = e?.message ?? String(e); }
    cx.notify();
    if (reload) view.load(cx);
  });
}

// The picked agent and model, the agent's catalog, and the models the search lists (past LISTED it must narrow them).
export function models(view) {
  const llm = view.shared?.llm ?? {}, agent = llm.provider === "local-agent" ? llm.agent : "", model = llm.agentModel ?? "";
  const catalog = view.agents?.find(a => a.name === agent)?.models ?? [];
  const query = view.modelInput.value().trim().toLowerCase();
  const matches = query ? catalog.filter(m => `${m.id} ${m.name}`.toLowerCase().includes(query)) : catalog;
  const shown = matches.slice(0, LISTED);
  // The rows above the catalog, while a search names them too: else ↓ would stop on Default before the first match.
  const lead = [{ key: "model-default", id: "", name: "Default" }, ...(model && !catalog.some(m => m.id === model) ? [{ key: "model-custom", id: model, name: model, detail: "Custom" }] : [])]
    .filter(m => m.name.toLowerCase().includes(query));
  return { agent, model, catalog, matches, shown, rows: [...lead, ...shown] };
}

// Enter in the model field: the lit row, else the model it names exactly, else the text as typed.
export function submitModel(view, cx) {
  const typed = view.modelInput.value().trim(), { catalog, rows } = view.models(), lit = rows[view.pageAt];
  if (!view.shared || (!typed && !lit)) return;
  const hit = lit ?? catalog.find(m => [m.id, m.name].some(x => x.toLowerCase() === typed.toLowerCase()));
  settingsBack(view, cx);
  saveLlm(view, { agentModel: hit?.id ?? typed }, cx);
}

// The rows of the settings submenu open, each with what picking it writes.
export function pageRows(view) {
  const page = view.settingsPage, locale = view.locale(), { agent, model, rows } = view.models();
  if (page === "language") return LOCALES.map(([code, name]) => ({ id: `locale-${code}`, name, on: code === locale, pick: (cx) => saveShared(view, { locale: code }, cx) }));
  // One agent's model ids mean nothing to another: switching resets to its default.
  if (page === "agent") return (view.agents ?? []).map(a => ({ id: `agent-${a.name}`, name: a.label, detail: a.version, on: a.name === agent, pick: (cx) => saveLlm(view, { agent: a.name, agentModel: "" }, cx) }));
  return rows.map(m => ({ id: m.key ?? `model-${m.id}`, name: m.name, detail: m.detail, on: m.id === model, pick: (cx) => saveLlm(view, { agentModel: m.id }, cx) }));
}

// The panel's rows at main.js's top (BELOW), right 40, past its border and padding: a label, two choices of 36, a rule, a
// label and the switch, then Language, Agent and Model.
// shortcut: assumes all three rows and no error note above them; a row the pointer is on gives its own bounds instead.
const navRow = (view, id) => ({ x: view.width - 40 - 320 + 5, y: BELOW + 5 + 165 + MODEL_ROW * ["language", "agent", "model"].indexOf(id), width: 310, height: MODEL_ROW });

// A setting's submenu, beside its row (`row`, in the pane), which stays lit. A press on the panel stops there, so the
// keyboard is sent where the submenu wants it: the model search, else the pane's keys.
export function openPage(view, id, cx, row = null, keys = false) {
  if (view.settingsPage !== id) { view.modelInput.set_value(""); view.pageAt = openLit(keys); }
  view.settingsPage = id; view.subRow = row ?? navRow(view, id);
  subOpened(subState(view), id);
  (id === "model" ? view.modelInput : view.handle).focus();
  cx.notify();
}

// The submenu closed, the panel kept. The model field is going, and the keyboard with it unless it's sent back.
export function settingsBack(view, cx) {
  view.settingsPage = null; view.modelInput.set_value(""); view.pageAt = -1;
  subOpened(subState(view), null);
  view.handle.focus();
  cx.notify();
}

// Resting on a row opens its submenu (`key`), or closes the open one (submenu.js).
function settingsRest(view, key, e, cx) {
  const at = toPane(view, e);
  if (key) view.navBox = { ...view.navBox, [key]: at.bounds };
  hoverRow(subState(view), key, at, cx, (key, row, cx) => key ? openPage(view, key, cx, row) : view.settingsPage && settingsBack(view, cx));
}

// As T3's MenuGroupLabel and MenuSeparator, and its ComboboxStatus, its 12 in the panel's 4 and 8.
const rule = (t) => div().h(1).my(4).mx(8).flex_none().bg(t.border);
const note = (t, text, color = t.dim) => div().p(8).flex_none().text_size(12).font_medium().text_color(color).child(text);

/** The settings, as the app's settings dialog in a panel: the view's choices, then the analysis's (analyzing when a count
 *  opens a review, and the language, agent and model, each a row naming its value). A row opens its list as a submenu left
 *  of the panel (settingsSub), as T3's MenuSub; a pick, ←, or Escape closes it. */
export function settingsPanel(view, t) {
  const page = view.settingsPage, locale = view.locale(), { agent, model, catalog } = view.models();
  const split = pref("split") === true, autoAnalyze = pref("autoAnalyze") === true;
  const label = (text) => div().h(28).px(8).flex_none().flex().items_center().text_size(12).font_medium().text_color(t.dim).child(text);
  // A row without a submenu: resting on it closes the open one.
  const off = (e, cx) => settingsRest(view, null, e, cx);
  const link = (id, text, url) => div().id(id).text_color(t.muted).hover(s => s.text_color(t.foreground).underline()).role("link")
    .on_click((_e, cx) => { cx.stop_propagation(); openUrl(url); }).child(text);
  // A setting with a submenu, as T3's MenuSubTrigger: its name, its value and a chevron; lit while its submenu is open.
  const nav = (id, text, value) => h_flex().id(`settings-${id}`).h(28).px(8).gap(8).flex_none().items_center().rounded(4).hover(s => s.bg(t.selected))
    .when(page === id, el => el.bg(t.selected))
    .on_mouse_move((e, cx) => settingsRest(view, id, e, cx))
    .role("button").accessibility_label(`${text}: ${value}`).on_click((_e, cx) => openPage(view, id, cx, view.navBox?.[id]))
    .child(div().flex_none().child(text))
    .child(div().flex_1().min_w(0).truncate().text_right().text_color(t.dim).child(value))
    .child(svg("mods/review/icons/chevron-right.svg").size(16).mr(-2).flex_none().text_color(t.dim));
  const current = view.agents?.find(a => a.name === agent);
  const rows = [
    label("View"),
    // Split needs a diff SPLIT_MIN wide: narrower, the choice is kept and the diff unified, so it shows faded.
    choiceRow(t, "Diff", [["view-unified", "Unified", !split], ["view-split", "Split", split, view.view < SPLIT_MIN]], (id, cx) => { if ((id === "view-split") !== split) view.toggleSplit(cx); }).on_mouse_move(off),
    // Long lines wrap at the diff's width by default, or scroll sideways as T3's; the page's own choice, apart from Files' (store.js).
    choiceRow(t, "Lines", [["lines-scroll", "Scroll", !wrapLines()], ["lines-wrap", "Wrap", wrapLines()]], (id, cx) => {
      setWrapLines(id === "lines-wrap"); cx.notify();
    }).on_mouse_move(off),
    rule(t),
    label("AI"),
    Switch.new("auto-analyze").checked(autoAnalyze).accessibility_label("Analyze automatically")
      .on_change((on, cx) => { setPref("autoAnalyze", on); cx.notify(); })
      // As T3's MenuCheckboxItem, its switch variant.
      .child(h_flex().on_mouse_move(off).h(28).pl(8).pr(6).gap(16).items_center().rounded(4).hover(s => s.bg(t.selected))
        .child(div().flex_1().child("Analyze automatically"))
        .child(div().w(22).h(14).p(1).flex_none().flex().rounded_full().bg(autoAnalyze ? t.accent : t.input)
          .when(autoAnalyze, el => el.justify_end())
          .child(div().size(12).rounded_full().bg(t.background)))),
    view.settingsError && note(t, view.settingsError, t.ansi1),
    // As the app's LanguageMenu, the language the analysis writes in (the pane's own words stay English): unset, the
    // daemon's default, the system's.
    view.shared && nav("language", "Language", LOCALES.find(([code]) => code === locale)?.[1] ?? locale ?? ""),
    !view.agents ? !view.settingsError && note(t, "Looking for agents…")
      : view.agents.length ? nav("agent", "Agent", current ? `${current.label} ${current.version}` : "None") : note(t, "No agent CLI found on PATH"),
    Boolean(current) && nav("model", "Model", !model ? "Default" : catalog.find(m => m.id === model)?.name ?? model),
    rule(t),
    // Credit, as the app's footer: pulls.review is antfu's; this pane draws from JinJieBeWater's fork of it.
    h_flex().id("settings-credit").on_mouse_move(off).h(28).px(8).gap(4).flex_none().items_center().text_size(11).text_color(t.dim)
      .child(image(`mods/${PANE}/icons/logo.svg`).w(12).h(12).flex_none())
      .child(link("credit-upstream", "pulls.review", "https://github.com/antfu/pulls.review")).child("by")
      .child(link("credit-antfu", "@antfu", "https://github.com/antfu")).child("·")
      .child(link("credit-fork", "fork", "https://github.com/JinJieBeWater/pulls.review")).child("by")
      .child(link("credit-jinjie", "@JinJieBeWater", "https://github.com/JinJieBeWater")),
  ];
  // Clipped: whatever outgrows the height is cut rather than drawn past the pane, BELOW down and 8 short of its foot.
  return popover(view, t, "review-settings-panel").w(320).max_h(Math.max(160, view.height - BELOW - 8)).overflow_hidden().p(4)
    .children(rows.filter(Boolean));
}

/** The open setting's submenu, left of the panel: its choices, the model's under a search. As T3's: a select as tall as
 *  there's room for, 8 short of the pane's ends; a combobox, as the model's is, 368 at most. */
export function settingsSub(view, t) {
  const page = view.settingsPage, model = page === "model", { matches, shown } = view.models(), typed = view.modelInput.value().trim();
  const row = view.subRow ?? navRow(view, page), options = view.pageRows();
  // Menu rows (t3-tokens「菜单行」): lit by the pointer or the keys, out when the pointer leaves.
  const choice = (r, i) => menuRow(view, t, r.id, { at: [view, "pageAt", i], label: r.name, lead: pickMark(r.on),
    trail: r.detail ? menuHint(t, r.detail) : null, pick: (cx) => { settingsBack(view, cx); r.pick(cx); } }).role("radio_button");
  // Pi lists hundreds: past LISTED the search finds the rest.
  const notes = [model && shown.length < matches.length && note(t, `${matches.length - LISTED} more: search to narrow`),
    model && Boolean(typed) && !matches.length && note(t, `Enter to use “${typed}”`)].filter(Boolean);
  // Its border and padding, the search and its margins, and a note's 32 each.
  const chrome = 10 + (model ? 43 : 0) + notes.length * 32;
  const listHeight = Math.min(options.length * MODEL_ROW, Math.max(MODEL_ROW * 3, Math.min(model ? 368 : Infinity, view.height - 16) - chrome));
  // 320 where there's room beside the panel, else narrower, never over its row (subAt).
  const { at: box, w } = subAt(view, row, 320, chrome + listHeight);
  // The pointer on it: nothing pending on the panel's rows opens or closes it.
  return box
    .child(popover(view, t, "review-settings-sub", false).w(w).p(4).on_hover((on) => { if (on) subLeft(subState(view)); })
      // The search sits above the catalog, which runs to hundreds for some agents.
      .when(model, el => el.child(searchField(t, view.modelInput).mx(8).mt(5).mb(5)))
      .child(scrollList(view, `${page}-list`, { count: options.length, row: MODEL_ROW, at: view.pageAt, draw: (i) => choice(options[i], i), height: listHeight, wheeled: (keep) => { view.pageAt = keep; } }))
      .children(notes));
}

// The language the analysis writes in: the one set, else the daemon's default.
export function locale(view) { return view.shared?.locale ?? view.shared?.defaultLocale; }

// A setting's row: its name, then its options as one segmented control; `pick(id, cx)` on a press.
function choiceRow(t, name, options, pick) {
  // A menu row's 4 either side of the 28 track.
  return h_flex().h(36).px(8).gap(8).flex_none().items_center()
    .child(div().flex_1().child(name))
    // As Custom snooze's segmented group (T3's ToggleGroup): an `input` track, the picked option `selected`; the others brighten on hover.
    .child(h_flex().flex_none().p(2).gap(2).rounded(8).bg(t.input)
      .children(options.map(([id, text, on, faded]) => div().id(id).h(24).px(10).flex().items_center().rounded(6).text_size(12).font_medium()
        .text_color(on ? t.foreground : t.dim).when(on, el => el.bg(t.selected)).when(!on, el => el.hover(s => s.text_color(t.foreground)))
        .when(Boolean(faded), el => el.opacity(0.5))
        .role("radio_button").accessibility_label(`${name}: ${text}`)
        .on_click((_e, cx) => pick(id, cx))
        .child(text))));
}
