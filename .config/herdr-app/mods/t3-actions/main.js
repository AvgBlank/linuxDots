// Actions, as T3 Code's run button: commands you start with one click, kept in shared state. In a bar it draws "▶ Dev | ▾";
// the menu, the editor and Details (cmd-shift-b) are this mod opened as overlays.
import { View, div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, run, openOverlay, closeOverlay, props, setShared, spaces, settings, nextCommand, shared } from "herdr";
import { glow } from "./tip.js";
import { stopsInit, stopsEnd, stop, focusRoot, onStop } from "./focus.js";
import { KEY } from "./store.js";
import { button, radiusOf } from "./button.js";
import { trigger } from "./trigger.js";
import { toggleDetails, dismissDetails, layerClosed, openedDetails, MENU_CLOSED, DETAILS_CLOSED } from "./details-popup.js";
import { initDetails, detailsView, openInMenu, directoryMenu, detailsItemsMenu } from "./workspace-details.js";
import { initRangeMenu, rangeMenu, closeRangeMenu, initCommits, commitsMenu } from "./review-details.js";
import { MOD, ICONS, icon, lit, state, barControl, openBarMenu, initMenu, actionsMenu } from "./actions.js";
import { awaitTargets } from "./open-in.js";
import { dialog, dialogTitle, dialogButton } from "./dialog.js";
import { initCleanUp, cleanUpView } from "./clean-up.js";

const ACTION_PLACES = [["tab", "Tab"], ["right", "Right"], ["down", "Down"]];
const BAR_MENU = "bar-menu:";

// The answer from Delete's confirm dialog.
function deleteAction(id) {
  const s = state();
  setShared(KEY.actions, { ...s, list: s.list.filter(x => x.id !== id) });
}

// The editor dialog: this copy's own inputs, made once in init.
function initEditor(view, cx) {
  stopsInit(view, cx, "modal");
  const a = state().list.find(x => x.id === props().id);
  view.action = a;
  view.icon = a?.icon ?? "play";
  view.place = a?.place ?? "tab";
  view.inputs = [["name", "Dev"], ["command", "bun run dev"], ["cwd", "Focused terminal's folder"]].map(([k, placeholder]) => {
    const input = InputState.new({ placeholder, value: a?.[k] ?? "" });
    input.on("change", (_e, cx) => cx.notify());
    input.on("submit", () => saveEditor(view));
    return [k, input];
  });
  view.inputs[0][1].focus();
}

function saveEditor(view) {
  const v = Object.fromEntries(view.inputs.map(([k, input]) => [k, input.value().trim()]));
  if (!v.name || !v.command) return;
  const s = state(), id = view.action?.id ?? Date.now().toString(36);
  const next = { id, name: v.name, command: v.command, icon: view.icon, place: view.place, ...(v.cwd ? { cwd: v.cwd } : {}) };
  setShared(KEY.actions, { ...s, list: view.action ? s.list.map(x => x.id === id ? next : x) : [...s.list, next] });
  closeOverlay(props().overlay);
}


function editorView(view) {
  const t = theme(), done = () => closeOverlay(props().overlay);
  const [name, command] = view.inputs.map(([, input]) => input.value().trim());
  const ok = Boolean(name && command);
  const label = (text) => div().line_height("16px").font_medium().text_color(t.foreground).child(text);
  const field = ([k, input]) => v_flex().gap(6).child(label({ name: "Name", command: "Command", cwd: "Folder (optional)" }[k]))
    .child(h_flex().h(32).px(11).rounded(8).border(1).border_color(t.border).bg(t.input).items_center()
      .child(Input.new(input).flex_1().h_full().text_size(14).text_color(t.foreground)));
  // T3's sm toggle.
  const choice = (id, on, pick, name, child) => stop(view, t, id, h_flex().id(id).h(28).min_w(28).px(6).rounded(8).items_center().justify_center().font_medium()
    .bg(on ? t.selected : t.input).text_color(lit(view, id, on ? t.foreground : t.dim)).on_hover(glow(view, id))
    .role("button").accessibility_label(name)
    .on_click((_e, cx) => { pick(); cx.notify(); }).child(child), 8);
  return focusRoot(view, dialog("action-editor", t)
    .child(div().p(24).pb(12).child(dialogTitle(t, view.action ? "Edit action" : "Add action")))
    // T3's close: 32 square, 8 in from the corner.
    .child(stop(view, t, "action-close", button(t, "action-close", { icon: "mods/t3-actions/icons/x.svg", label: "Close", size: "default", surface: "card", hot: view.hot === "action-close" })
      .absolute().top(8).right(8).on_hover(glow(view, "action-close")).on_click(done), radiusOf("default")))
    .child(v_flex().px(24).py(4).gap(16)
      .children(view.inputs.map(field))
      .child(h_flex().gap(16)
        .child(v_flex().gap(6).child(label("Icon")).child(h_flex().gap(2).children(ICONS.map(i =>
          choice(`icon-${i}`, view.icon === i, () => { view.icon = i; }, `Icon: ${i}`, icon(i).size(16)).px(0)))))
        .child(v_flex().gap(6).child(label("Run in")).child(h_flex().gap(2).children(ACTION_PLACES.map(([p, text]) =>
          choice(`place-${p}`, view.place === p, () => { view.place = p; }, `Run in: ${text}`, text)))))))
    // As T3's editor: its footer is the bare kind, with no rule.
    .child(h_flex().mt_auto().px(24).py(16).gap(8).items_center()
      .when(Boolean(view.action), el => el.child(dialogButton(view, t, "action-delete", "Delete", "danger", () => {
          done();
          openOverlay({ mod: MOD, kind: "dialog", frame: "none", width: 512, props: {
            actions: "confirm",
            title: `Delete ${view.action.name}?`,
            detail: "This removes the action and can't be undone.",
            yes: "Delete",
            command: { name: `${MOD}.delete-action:${view.action.id}` },
          } });
        })))
      .child(div().flex_1())
      .child(dialogButton(view, t, "action-cancel", "Cancel", "outline", done))
      .child(dialogButton(view, t, "action-save", "Save", "primary", () => saveEditor(view), !ok))));
}

// T3's alert dialog, for what the shipped confirm mod would ask: props { title, detail, yes, command: { name, args } }. Enter confirms, Esc cancels.
// Drawn as this layout's editor is: a bare footer, and the going-ahead button the editor's Delete, its word saying what it does (`yes`).
function initConfirm(view, cx) {
  view.ask = cx.focus_handle();
  view.ask.focus();
  stopsInit(view, cx, "modal");
}

function confirmView(view) {
  const t = theme(), p = props() ?? {}, done = () => closeOverlay(p.overlay);
  const yes = () => { done(); run(p.command.name, p.command.args ?? {}); };
  return focusRoot(view, dialog("action-confirm", t).track_focus(view.ask)
    .on_key_down((e, cx) => {
      // On a button, Enter is the button's.
      if (e.key === "enter") { if (onStop(view)) return; yes(); }
      else if (e.key === "escape") done();
      else return;
      cx.stop_propagation();
    })
    .child(v_flex().p(24).gap(8).min_h(0)
      .child(dialogTitle(t, p.title ?? "Are you sure?"))
      .child(div().id("confirm-detail").max_h(384).overflow_y_scrollbar().text_color(t.muted).child(p.detail ?? "")))
    .child(h_flex().id("confirm-footer").mt_auto().px(24).pb(24).gap(8).items_center().justify_end()
      .child(dialogButton(view, t, "confirm-no", "Cancel", "outline", done))
      .child(dialogButton(view, t, "confirm-yes", p.yes ?? "Confirm", "danger", yes))));
}

export default class Actions extends View {

  init(_props, cx) {
    this.hot = null;
    const overlay = props()?.actions;
    if (overlay === "edit") initEditor(this, cx);
    if (overlay === "menu") initMenu(this, cx);
    if (overlay === "open-in") { initMenu(this, cx); awaitTargets(cx); }
    if (overlay === "directory-menu") initMenu(this, cx);
    if (overlay === "details-items") initMenu(this, cx);
    if (overlay === "confirm") initConfirm(this, cx);
    if (overlay === "clean-up") initCleanUp(this, cx);
    if (overlay === "details") { stopsInit(this, cx, "modal"); initDetails(this, cx); }
    if (overlay === "review-scope") { stopsInit(this, cx, "modal"); initRangeMenu(this, cx); }
    if (overlay === "review-commits") { stopsInit(this, cx, "modal"); initCommits(this); }
    if (!overlay) stopsInit(this, cx);
    // The bar's copy answers Delete's dialog and opens the demo's standalone menu at explicit chevron bounds.
    if (!overlay) cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command.startsWith("delete-action:")) deleteAction(command.slice("delete-action:".length));
        else if (command.startsWith(BAR_MENU)) {
          let b;
          try { b = JSON.parse(command.slice(BAR_MENU.length)); } catch { continue; }
          if ([b?.x, b?.y, b?.width, b?.height].every(Number.isFinite) && b.width > 0 && b.height > 0) openBarMenu(b);
        }
        else if (command === "details") { toggleDetails(); cx.notify(); }
        else if (command === "dismiss-details") { dismissDetails(); cx.notify(); }
      }
    });
  }

  close() {
    stopsEnd(this);
    if (props()?.actions === "review-scope") closeRangeMenu(this);
    // Every menu, and every layer Details opens (the Review row's too): a press on its button that closed it mustn't reopen it.
    if (/** @type {any} */ (this).keys || props()?.details) setShared(MENU_CLOSED, Date.now());
    // Its own menus go with it; Details, its button shows it gone.
    if (props()?.overlay) layerClosed(props().overlay);
  }

  render(cx) {
    const overlay = props()?.actions;
    if (overlay === "menu") return actionsMenu(this);
    if (overlay === "open-in") return openInMenu(this);
    if (overlay === "directory-menu") return directoryMenu(this);
    if (overlay === "details-items") return detailsItemsMenu(this);
    if (overlay === "edit") return editorView(this);
    if (overlay === "confirm") return confirmView(this);
    if (overlay === "clean-up") return cleanUpView(this, cx);
    if (overlay === "details") return detailsView(this);
    if (overlay === "review-scope") return rangeMenu(this);
    if (overlay === "review-commits") return commitsMenu(this);
    const stopPress = (_e, cx) => cx.stop_propagation(), home = shared(KEY.home);
    return focusRoot(this, h_flex().size_full().items_center().justify_end()
      // Home has no project to run them in.
      .when(!home || !spaces().some(s => s.active && s.id === home), el => el.child(h_flex().id("actions-fit").flex_none().pr(props()?.details ? 0 : 8).items_center().on_size_change((size) => this.fit(size))
        .when(!props()?.details, el => el.child(barControl(this, theme(), stopPress)))
        .when(Boolean(props()?.details), el => el.child(trigger(this, theme(), "details-toggle", { icon: "mods/t3-actions/icons/square-menu.svg", label: "Details",
          action: "t3-tabs.details", below: true, open: Boolean(openedDetails()), closed: DETAILS_CLOSED, onOpen: (b) => toggleDetails(b) }))))));
  }

  // With the block's id in props.block, it sizes that block to the control: layout.resize, which Herdr keeps with the
  // layout's clicks. on_size_change reports zoomed pixels; a layout's are logical.
  fit(size) {
    // The window snaps a zoomed width to whole pixels: up to half a px over its logical width isn't more room needed.
    const id = props()?.block, px = Math.ceil(size.width / (Number(settings()?.zoom) || 1) - 0.5);
    if (!id || px === this.fitted) return;
    this.fitted = px;
    run("layout.resize", { id, px });
  }
}
