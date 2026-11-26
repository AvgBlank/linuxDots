import { div } from "gpui-kit";
import { Popup } from "gpui-base";
import { settings } from "herdr";
import { tip, tipCard, FADE } from "./tip.js";

const textStyle = (el, size, weight) => weight === "medium" ? el.text_size(size).font_medium() : el.text_size(size).font_normal();
const widthChanged = (view, key, id) => (size, cx) => {
  const width = size.width / (Number(settings().zoom) || 1);
  // Only this run's layout measurements; never a preference or a character-count estimate.
  const widths = view[key] ??= {};
  if (widths[id] === width) return;
  widths[id] = width;
  cx.notify();
};

function measureText(view, id, label, { size = 12, weight = "normal" } = {}) {
  return textStyle(div().id(`text-measure-${id}`).absolute().top(0).left(0).h(0).overflow_hidden().whitespace_nowrap(), size, weight)
    .child(label).on_size_change(widthChanged(view, "nameW", id));
}

export function nameText(view, id, label, { size = 12, weight = "normal" } = {}) {
  // Ellipsis is inherited: the natural copy must be a sibling, never a child, of truncated text.
  return textStyle(div().id(`text-name-${id}`).relative().min_w(0), size, weight)
    .child(div().min_w(0).truncate().child(label))
    .on_size_change(widthChanged(view, "textW", id)).child(measureText(view, id, label, { size, weight }));
}

// An unmeasured name reads as whole; an icon or ellipsis is always hiding its name.
export function isTextCut(view, id, { shown = true } = {}) {
  return !shown || view.textW?.[id] + 0.5 < view.nameW?.[id];
}

export function measuredTooltip(view, t, id, label, trigger, { shown = true, ...options } = /** @type {{ shown?: boolean, action?: any, hint?: string, below?: boolean, delay?: number, off?: any }} */ ({})) {
  return isTextCut(view, id, { shown }) ? tip(view, t, id, label, trigger, options) : trigger;
}

// The breadcrumb's original Popup; callers retain their own focus, press, menu and hover timing.
export function named(view, t, id, label, trigger, { shown = true, at = 0, onHover, onMove } = /** @type {{ shown?: boolean, at?: number, onHover?: Function, onMove?: Function }} */ ({})) {
  const on = view.details === id && view.detailsIn;
  const card = Popup.new(`details-${id}`, div()).absolute().bottom(0).left(at - 9).size(1)
    .when(view.details === id || view.detailsOut === id, pop => pop.content(tipCard(t, `details-card-${id}`)
      .mt(4).opacity(on ? 1 : 0).top(on ? 0 : -4).transition("opacity", FADE).transition("top", FADE).child(label)));
  return trigger.relative().on_hover((hovered, cx) => onHover?.(hovered, isTextCut(view, id, { shown }), cx))
    .on_mouse_move(e => onMove?.(e)).when([view.details, view.detailsOut].includes(id), el => el.child(card));
}
