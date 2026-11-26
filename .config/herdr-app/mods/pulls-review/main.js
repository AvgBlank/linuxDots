// pulls.review in Herdr. In a bar it is the Review bar (bar.js), sized to fit its block; opened as an overlay it opens a
// review (open.js), or with props.menu the logo's menu. A review in "herdr" mode draws in the review page of the window's
// panel (the review mod).
// Bound in keys.json, `mod.open:pulls-review` reviews the focused pane's worktree.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, run, settings, setShared, shared, theme } from "herdr";
import { watchReview, stopReview, reviewBar, reviewMenu, initReviewMenu, menuClosed, reviewLocation } from "./bar.js";
import { launch } from "./open.js";
import { stopsInit, stopsEnd, focusRoot } from "./focus.js";
import { REVIEW_STATUS } from "./panel.js";

export default class PullsReview extends View {
  init(_props, cx) {
    const p = props() ?? {};
    if (p.menu === "review") initReviewMenu(this);
    else if (p.overlay) {
      const source = reviewLocation();
      cx.spawn(() => launch({ ...p, source }));
    }
    else {
      // The panel's review page starts only when first shown and shared outlives the app, so a run's word from before a restart
      // would stay until that page is seen. The bar, always shown, drops it; a review still running says so again at its next poll (1.5s).
      const status = Object.entries(shared(REVIEW_STATUS) ?? {}), left = status.filter(([, word]) => word !== "working");
      if (left.length < status.length) setShared(REVIEW_STATUS, Object.fromEntries(left));
      // An older layout's toggle-only bar draws nothing (bar.js): no counts to read git for.
      if (!p.toggle) watchReview(this, cx);
      stopsInit(this, cx);
    }
  }

  close() {
    stopReview(this);
    stopsEnd(this);
    if (/** @type {any} */ (this).search) menuClosed();
  }

  render() {
    const p = props() ?? {};
    if (p.menu === "review") return reviewMenu(this);
    // Opening: nothing to see, and the overlay closes itself when it's done.
    if (p.overlay) return div();
    const bar = reviewBar(this, theme(), (_e, cx) => cx.stop_propagation());
    // Outside a repository there's no bar, and its block closes to nothing.
    return focusRoot(this, h_flex().size_full().items_center().justify_end()
      .child(h_flex().id("review-fit").flex_none().items_center().when(Boolean(bar), el => el.pr(8).child(bar)).on_size_change((size) => this.fit(size))));
  }

  // With the block's id in props.block, it sizes that block to the bar: layout.resize, which Herdr keeps with the
  // layout's clicks. on_size_change reports zoomed pixels; a layout's are logical.
  fit(size) {
    // The window snaps a zoomed width to whole pixels: up to half a px over its logical width isn't more room needed.
    const id = props()?.block, px = Math.ceil(size.width / (Number(settings()?.zoom) || 1) - 0.5);
    if (!id || px === this.fitted) return;
    this.fitted = px;
    run("layout.resize", { id, px });
  }
}
