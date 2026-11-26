import { div, svg, PathBuilder } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { groupFiles } from "./rows.js";
import { LU, zoom, isLight, diffStats, FADED } from "./controls.js";
import { hoverKept } from "./tip.js";
import { tint } from "./button.js";

// The app's category icons (Lucide here, for one icon set across the layout; the app's are Phosphor duotone, in its own shapes) and hues (Tailwind's 300 on dark, 800 on light), by category.
const CATEGORY = {
  ui: ["drafting-compass", "#f9a8d4", "#9d174d"], api: ["plug-zap", "#93c5fd", "#1e40af"], core: ["code", "#c4b5fd", "#5b21b6"],
  data: ["database", "#fcd34d", "#92400e"], cli: ["terminal", "#bef264", "#3f6212"], security: ["shield-check", "#fca5a5", "#991b1b"],
  tests: ["flask-conical", "#86efac", "#166534"], docs: ["book-open", "#7dd3fc", "#075985"], examples: ["circle-play", "#67e8f9", "#155e75"],
  deps: ["package", "#fdba74", "#9a3412"], build: ["hammer", "#fde047", "#854d0e"], scripts: ["wrench", "#6ee7b7", "#065f46"],
  config: ["sliders-horizontal", "#5eead4", "#115e59"], i18n: ["languages", "#a5b4fc", "#3730a3"], assets: ["image", "#f0abfc", "#86198f"],
  other: ["circle-ellipsis", "#d4d4d4", "#262626"],
};

// As CSS's saturate(0), which the app puts on a group's icon until it's shown or hovered: a hue's luminance, as grey.
const grey = (hex) => { const n = parseInt(hex.slice(1, 7), 16), y = Math.round(0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)); return `#${y.toString(16).padStart(2, "0").repeat(3)}`; };

// A group's category icon in its hue (Tailwind's 300 on dark, 800 on light); unless `lit`, grey, as the app's `saturate-0`.
export function categoryIcon(t, category, lit) {
  const [icon, dark, light] = CATEGORY[category] ?? CATEGORY.other, hue = isLight(t.background) ? light : dark;
  return svg(`${LU}/${icon}.svg`).size(16).flex_none().text_color(lit ? hue : grey(hue));
}

export function criticalMark(t, size = 16) {
  return svg(`${LU}/badge-alert.svg`).size(size).flex_none().text_color(isLight(t.background) ? "#d97706" : "#fbbf24");
}

// As the app's countGroupStats, countGroupFiles and groupProgress: a group's own files and its subgroups'.
function groupStats(view, g) {
  const files = groupFiles(g).map(path => view.fileAt(path)).filter(Boolean);
  return {
    added: files.reduce((n, f) => n + f.additions, 0), deleted: files.reduce((n, f) => n + f.deletions, 0), count: files.length,
    progress: files.length ? files.filter(f => f.reviewed).length / files.length : 1,
  };
}

// As the app's DisplayDonut: a faint ring, and from the top, clockwise, an arc as far as `value`.
export function donut(t, value) {
  const size = 14, z = zoom(), c = size / 2 * z, r = (size / 2 - 2) * z, ring = (b) => b.move_to(c, c - r).arc_to(r, r, 0, false, true, c, c + r).arc_to(r, r, 0, false, true, c, c - r);
  const a = 2 * Math.PI * Math.min(value, 1), arc = value >= 1 ? ring(PathBuilder.stroke(2 * z))
    : PathBuilder.stroke(2 * z).move_to(c, c - r).arc_to(r, r, 0, value > 0.5, true, c + r * Math.sin(a), c - r * Math.cos(a));
  return div().size(size).flex_none().relative()
    .child(window.paint_path(ring(PathBuilder.stroke(2 * z)).build(), t.border).absolute().top(0).left(0).size_full())
    .when(value > 0, el => el.child(window.paint_path(arc.build(), t.foreground).absolute().top(0).left(0).size_full()));
}

/**
 * As pulls.review's DiffGroupNav: the groups as one row of tabs across the page under its toolbar, sideways scrolled rather
 * than wrapped. Picking one shows it alone, in the diff and the tree, where its subgroups are. A lone group has no row.
 */
export function groupTabs(view, t, pick) {
  const groups = view.review.groups;
  if (groups.length < 2) return null;
  // Counted once per read or mark: a draw runs on any live change in Herdr, and a review runs to thousands of files.
  if (view.tabStats?.review !== view.review || view.tabStats.marks !== view.marks) {
    view.tabStats = { review: view.review, marks: view.marks, stats: new Map(groups.map(g => [g.key, groupStats(view, g)])) };
  }
  // Upstream's DiffGroupNavItem in T3's tokens: two lines, the name over its counts, 8 by 2 in, 6 apart, radius 8, no outline
  // and no coloured foot; the row 12 in, on the toolbar's line, unruled as T3's subheaders in the panel. The group shown is lit
  // as the panel's tabs (button.js tint), its icon in its hue; the others fade until hovered.
  return div().id("group-tabs").flex_none()
    .child(h_flex().id("group-tab-row").px(12).py(8).gap(6).overflow_x_scroll().children(groups.map(g => {
      const id = `group-tab-${g.key}`, active = g.key === view.groupKey;
      const stats = view.tabStats.stats.get(g.key), critical = g.critical || g.children.some(c => c.critical);
      return hoverKept(view, "hovered", id, h_flex().id(id)).flex_none().px(8).py(2).gap(8).items_center().rounded(8)
        .text_size(12).font_medium().text_color(t.foreground)
        .when(active, el => el.bg(tint(t, "chrome", true))).when(!active, el => el.opacity(FADED).hover(s => s.opacity(1).bg(tint(t, "chrome", false))))
        .role("tab").accessibility_label(g.label).on_click((_e, cx) => pick(g.key, cx))
        .child(v_flex().items_start()
          .child(h_flex().gap(6).items_center()
            .child(categoryIcon(t, g.category, active || view.hovered === id).size(14))
            .child(g.label)
            .when(critical, el => el.child(criticalMark(t, 14))))
          .child(h_flex().items_center().text_size(11).font_normal()
            .child(diffStats(t, stats.added, stats.deleted))
            .child(div().id(`${id}-count`).text_color(t.dim).child(`${stats.added || stats.deleted ? "・" : ""}${stats.count} ${stats.count === 1 ? "file" : "files"}`))))
        .when(stats.progress !== 0, el => el.child(donut(t, stats.progress)));
    })));
}
