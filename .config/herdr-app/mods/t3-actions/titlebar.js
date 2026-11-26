// Where Details' button stands, for a popup keys open under it (cmd-shift-b), in zoomed px. Right of it in the tab row stand the
// window part, sized by panel.js windowEndPx, and the layout's tabs-end-inset; while the panel is open, the panel too, whose
// width only t3-chrome's head measures (`panel`: its head, padding and the root's divider). Mods share one JS context, so
// every copy reads the same.
import { layout } from "herdr";
import { windowEndPx, layoutNode } from "./panel.js";

const measured = () => /** @type {{ panel?: number }} */ (/** @type {any} */ (globalThis).t3Titlebar ??= {});

/** The open panel measured `width` wide, zoomed px. */
export function notePanelWidth(width) { measured().panel = width; }

/** Details' button, centred in its row, in a `viewport` ({ width }) at zoom `z`, the panel `open` or not, zoomed px;
 *  null, and the popup takes its default place, while the open panel's head hasn't drawn yet or in a layout not this one
 *  (Herdr's own, where t3-actions stands alone and nothing says where its button is). */
export function detailsAnchor(viewport, z, open) {
  const panel = measured().panel, inset = layoutNode(layout(), "tabs-end-inset");
  if (!inset || (open && panel == null)) return null;
  const end = windowEndPx(open) + (inset.size?.px ?? 0);
  const right = viewport.width - end * z - (open ? panel : 0);
  return { x: right - 28 * z, y: 6 * z, width: 28 * z, height: 28 * z };
}
