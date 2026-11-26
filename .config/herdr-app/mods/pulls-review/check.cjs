// node mods/pulls-review/check.cjs: bar.js, open.js and main.js run on inert elements, as Herdr would load them, without a window.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const kit = require("./check-kit.js");
const element = kit.elements({ args: "auto", adds: ["child", "trigger"] }), { find, strings, walk, fire, plain } = kit;
const keys = (node) => node.items.map(n => typeof n.key === "string" ? n.key : n.kind);

const commands = [];
const zoom = 1.1, calls = [], overlays = [], closed = [], notes = [], launched = [], state = {}, shown = { pane: "p1", tab: "b" };
const theme = new Proxy({ foreground: "#f4f4f6", dim: "#77777f", border: "#2a2a30", hover: "#202024" }, { get: (t, k) => t[k] ?? "#a9a9b4" });
const env = {
  checking: () => false,
  View: class {}, div: () => element(), h_flex: () => element("h"), v_flex: () => element("v"),
  svg: (source) => element("svg", source), image: (source) => element("image", source), Input: { new: () => element("input") }, HoverCard: { new: (id) => element("hovercard").id(id) }, Popup: { new: (id, trigger) => element("popup").id(id).child(trigger) },
  InputState: { new: () => ({ on() {}, value: () => "", focus() {} }) },
  theme: () => theme, settings: () => ({ zoom }), keys: () => [], window: () => ({ platform: "macos", active: true }),
  spaces: () => [{ id: "s", active: true, folder: "/space", tabs: [{ id: "b" }] }], panes: () => [{ pane: "p1", tab: "b", cwd: "/repo/src" }],
  focused: () => shown, exec: async () => ({ code: 1, stdout: "" }), hc: async () => ({ code: 1 }), watchFolder: () => new Promise(() => {}),
  shared: (key) => state[key], setShared: (key, value) => { state[key] = value; },
  run: (name, args) => calls.push([name, plain(args)]), notify: (n) => notes.push(n),
  openOverlay: (spec) => overlays.push(spec), closeOverlay: (id) => closed.push(id),
  // `pulls-review.<command>`, handed to whichever copy waits.
  nextCommand: () => new Promise(done => { commands.push(done); }),
  appHome: () => "/app", home: () => "/Users/me", readTextFile: async () => '{ "open": "herdr" }',
  // Herdr T3's layout: the space panel, its pages Files and Review.
  layout: () => ({ id: "root", children: [{ id: "work" }, { id: "panel", hidden: true, children: [{ id: "panel-body", active: "files", children: [{ id: "files" }, { id: "review" }] }] }] }),
};
const source = ["color.js", "button.js", "store.js", "details.js", "tip.js", "list.js", "menu-row.js", "focus.js", "trigger.js", "terminal-context.js", "surfaces.js", "panel.js", "review-git.js", "status-mark.js", "bar.js", "open.js", "main.js"].map(file => fs.readFileSync(path.join(__dirname, file), "utf8")).join("\n")
  .replace(/^import [^;]*;\r?\n/gm, "").replace("export default class", "globalThis.Mod = class").replace(/^export /gm, "");
// Timers fire at once: a card that waits 150ms is up by the next render.
const cx = { notify() {}, stop_propagation() {}, spawn: (f) => f(cx), focus_handle: () => ({ focus() {}, is_focused: () => false }), timer: { every() {}, after: (_ms, f) => (f(cx), { cancel() {} }) } };
// `setup` gets the module's scope before init, to stand in for git; by default it records what open.js's launch gets.
const record = (scope) => { scope.launch = (input) => { launched.push(plain(input)); }; };
const load = (props = {}, setup = record) => {
  const scope = vm.createContext({ ...env, props: () => props });
  vm.runInContext(source, scope, { filename: "pulls-review" });
  setup?.(scope);
  const mod = new scope.Mod();
  mod.init?.(props, cx);
  return { mod, scope };
};
const location = scope => vm.runInContext("locationKey(reviewLocation())", scope);
const launch = (scope, input) => scope.launch({ source: scope.reviewLocation(), ...input });

(async () => {
  // The counts: a line per file (renamed and untracked too), the arrows from the branch headers, and the commits the
  // branch adds to the default branch, resolved as the CLI does.
  const { mod: bar, scope } = load({ block: "review" });
  assert.equal(find(bar.render(), "pulls-review"), null, "no bar before git is read");
  let status = ["# branch.oid 1a2b", "# branch.head feat", "# branch.upstream origin/feat", "# branch.ab +2 -1",
    "1 .M N... 100644 100644 100644 1a2b 1a2b src/a.js", "2 R. N... 100644 100644 100644 1a2b 1a2b R100 new.js\told.js", "? notes.md", ""].join("\n");
  const refs = { "main...HEAD": "0\t4\n" }; // No origin/HEAD, no origin/main: the local main.
  scope.exec = async (_command, args) => args.includes("--show-toplevel") ? { code: 0, stdout: "/repo\n" }
    : args.includes("symbolic-ref") ? { code: 1, stdout: "" }
    : args.includes("rev-list") ? (refs[args.at(-1)] ? { code: 0, stdout: refs[args.at(-1)] } : { code: 128, stdout: "" })
    : _command === "sh" ? { code: 1, stdout: "" } // No net diff to read: status's count, as without sh. A real repo's is below.
    : (assert.ok(args.includes("--untracked-files=all"), "a new folder counts its files, as the page it opens"), { code: 0, stdout: status });
  const review = await scope.readReview("/repo/src");
  const show = r => bar.reviews.set(location(scope), r);
  assert.deepEqual(plain(review), { root: "/repo", branch: "feat", upstream: "origin/feat", base: "main", baseRef: "main", changed: 3, ahead: 2, behind: 1, unmerged: 4, newer: 0, gone: false });
  show(review);
  const drawn = bar.render();
  assert.deepEqual(strings(find(drawn, "review-open")), ["4", "ahead of main"], "the branch's count says what it is against");
  assert.deepEqual(strings(find(drawn, "review-changes")), ["3", "uncommitted"]);
  // Ghost buttons, as the tab bar's own: no outline, no rules between them.
  assert.ok(!("border" in find(drawn, "pulls-review").style));
  // The counts, then the logo, last so they can come and go without moving it.
  assert.deepEqual(keys(find(drawn, "pulls-review")), ["tip-review-changes", "tip-review-open", "tip-review-ahead", "tip-review-behind", "tip-review-pick"]);
  assert.equal(strings(find(drawn, "tip-review-ahead").style.content).length, 0, "its card waits for the hover");
  for (const id of ["review-changes", "review-pick"]) assert.deepEqual([find(drawn, id).style.h, find(drawn, id).style.rounded, "border" in find(drawn, id).style], [24, 8, false], id);
  assert.equal(find(drawn, "review-pick").style.w, 24);
  // In keyboard mode Tab reaches each count and the logo, as it does the Actions beside them.
  state["t3.focus"] = "someone";
  for (const id of ["review-changes", "review-open", "review-ahead", "review-behind", "review-pick"]) assert.equal(find(bar.render(), id).style.tab_index, 0, `${id} is a Tab stop`);
  delete state["t3.focus"];
  assert.equal(find(bar.render(), "review-pick").style.tab_index, undefined, "out of it, a press keeps the terminal's keyboard");
  assert.equal(find(drawn, "review-open").style.accessibility_label, "Review the branch: 4 commits on feat, not on main");
  for (const n of walk(drawn)) if (n.hoverStyle.text_color) assert.ok(!walk(n).some(c => c.kind === "svg"), `${n.key}: a hover style can't brighten its icon`);
  // The logo, in its own colors and on disk: a missing file draws nothing, and the button shows blank.
  const logo = walk(find(drawn, "review-pick")).find(n => n.kind === "image");
  assert.equal(logo.source, "mods/pulls-review/icons/logo.svg");
  assert.ok(fs.existsSync(path.join(__dirname, "icons/logo.svg")));
  fire(find(drawn, "review-pick"), "on_hover", true, cx);
  fire(find(drawn, "tip-over-review-pick"), "on_hover", true, cx);
  assert.deepEqual(strings(find(bar.render(), "tip-review-pick").style.content), ["Change what to review"], "its card shows on hover");
  fire(find(drawn, "review-pick"), "on_hover", false, cx);
  fire(find(drawn, "tip-over-review-pick"), "on_hover", false, cx);
  // No color: here it means an agent's state. Shared xs buttons are dim and medium weight; hovered, foreground on the fill.
  const colorOf = id => find(bar.render(), id).style.text_color;
  const counted = ["review-changes", "review-open", "review-ahead", "review-behind"];
  assert.deepEqual(counted.map(colorOf), counted.map(() => theme.dim));
  for (const id of counted) assert.ok(find(bar.render(), id).style.font_medium !== undefined && !find(bar.render(), id).items.flatMap(walk).some(n => n.style.text_color || n.style.font_medium !== undefined), `${id}: the shared button sets the weight, nothing inside sets its own color or weight`);
  for (const id of counted) assert.deepEqual(plain(find(bar.render(), id).hoverStyle), { bg: theme.foreground + "0a" }, `${id}: hovered, the text color at 4%`);
  fire(find(drawn, "review-open"), "on_hover", true, cx);
  assert.equal(colorOf("review-open"), theme.foreground, "hovered, lit");
  assert.equal(colorOf("review-changes"), theme.dim, "only the one hovered");
  fire(find(drawn, "review-open"), "on_hover", false, cx);
  assert.equal(colorOf("review-open"), theme.dim);
  assert.equal(find(drawn, "review-ahead").style.accessibility_label, "Review feat → origin/feat: 2 commits to push, on feat, not on origin/feat", "the label says what a count compares");
  assert.equal(find(drawn, "review-behind").style.accessibility_label, "Review origin/feat → feat: 1 commit to pull, on origin/feat as of your last fetch, not on feat");
  assert.equal(walk(drawn).filter(n => "tooltip" in n.style).length, 0, "the shell's tooltip isn't Herdr T3's");
  fire(find(drawn, "review-ahead"), "on_hover", true, cx);
  fire(find(drawn, "tip-over-review-ahead"), "on_hover", true, cx);
  assert.deepEqual(strings(find(bar.render(), "tip-review-ahead").style.content), ["Review feat → origin/feat"], "the label names what it opens, as the pane's title; what it compares stays in the accessibility label");
  fire(find(drawn, "review-ahead"), "on_hover", false, cx);
  Object.assign(shown, { pane: "p9", cwd: "/other" });
  assert.equal(find(bar.render(), "pulls-review"), null, "another location never shows this one's counts, even before its own read");
  Object.assign(shown, { pane: "p1", cwd: undefined });
  assert.ok(find(bar.render(), "review-open"), "coming back shows the last read at once");
  // A mod pane focused: the folder of a terminal in its tab.
  const allPanes = scope.panes;
  scope.panes = () => [{ pane: "p7", mod: "notes", tab: "b", cwd: null }, ...allPanes()];
  Object.assign(shown, { pane: "p7" });
  assert.deepEqual(plain(scope.reviewLocation()), { space: "s", cwd: "/repo/src", on: null });
  scope.panes = allPanes; Object.assign(shown, { pane: "p1" });
  show({ ...review, unmerged: 0, changed: 0, ahead: 0, behind: 0 });
  assert.deepEqual(keys(find(bar.render(), "pulls-review")), ["tip-review-pick"], "no counts: the icon stays, the way in on a clean default branch");
  show({ ...review, newer: 1, gone: true });
  assert.deepEqual(strings(find(bar.render(), "review-open")), ["4", "ahead of main · merged?"], "a deleted upstream shows, not only in the label");
  assert.deepEqual(strings(find(bar.render(), "review-ahead")), ["↑2"]);
  assert.deepEqual(walk(find(bar.render(), "review-open")).filter(n => n.kind === "svg"), [], "wide, the words tell them apart");
  // In a narrow bar each count has a Lucide icon in place of its words, or its arrow; the hover label gives back the words, and the accessibility label stays whole.
  state["t3-tabs.compact"] = true;
  assert.deepEqual(strings(find(bar.render(), "review-open")), ["4"]);
  assert.deepEqual(strings(find(bar.render(), "review-ahead")), ["2"]);
  for (const [id, icon] of [["review-changes", "file-diff"], ["review-open", "git-branch"], ["review-ahead", "arrow-up"], ["review-behind", "arrow-down"]]) {
    assert.equal(walk(find(bar.render(), id)).find(n => n.kind === "svg").source, `mods/pulls-review/icons/${icon}.svg`);
    assert.match(fs.readFileSync(path.join(__dirname, "icons", `${icon}.svg`), "utf8"), /stroke-width="1\.75"/, `${icon}: as the mod's other icons`);
  }
  assert.deepEqual(counted.map(colorOf), counted.map(() => theme.dim), "still no color");
  fire(find(bar.render(), "review-open"), "on_hover", true, cx);
  fire(find(bar.render(), "tip-over-review-open"), "on_hover", true, cx);
  assert.deepEqual(strings(find(bar.render(), "tip-review-open").style.content), ["4 ahead of main · merged?"]);
  fire(find(bar.render(), "review-open"), "on_hover", false, cx);
  assert.match(find(bar.render(), "review-open").style.accessibility_label, /^Review the branch: 4 commits on feat/);
  delete state["t3-tabs.compact"];
  assert.equal(find(bar.render(), "review-open").style.accessibility_label,
    "Review the branch: 4 commits on feat, not on main · main has 1 newer commit · origin/feat is gone, likely merged");
  const full = status;
  status = full.replace(/^# branch\.ab .*\n/m, "");
  const lost = await scope.readReview("/repo");
  assert.deepEqual([lost.gone, lost.ahead, lost.behind], [true, 0, 0], "an upstream without branch.ab is gone");
  status = full.replace("origin/feat", "origin/main");
  const tracking = await scope.readReview("/repo");
  assert.deepEqual([tracking.ahead, tracking.behind], [0, 1], "tracking main: ↑ repeats N ahead of main, so it goes; ↓ stays");
  // With origin/main the label names the remote ref: a fork's origin/main can lag the upstream it mirrors.
  refs["origin/main...HEAD"] = "0\t43\n";
  show(await scope.readReview("/repo"));
  assert.equal(find(bar.render(), "review-open").style.accessibility_label, "Review the branch: 43 commits on feat, not on origin/main");
  assert.deepEqual(strings(find(bar.render(), "review-open")), ["43", "ahead of main"], "the bar stays short: the remote ref is left to the label");
  delete refs["origin/main...HEAD"];
  refs["main...HEAD"] = "0\t0\n";
  assert.equal((await scope.readReview("/repo")).unmerged, 0, "nothing past main: no Review");
  refs["main...HEAD"] = "0\t4\n";
  for (const head of ["(detached)", "main"]) {
    status = full.replace("# branch.head feat", `# branch.head ${head}`);
    assert.equal((await scope.readReview("/repo")).unmerged, 0, `on ${head} the CLI opens its ref picker: no Review`);
  }

  // It sizes its block to the bar, its gap to what follows included, in logical pixels, once per change; with no bar, to nothing.
  show(review);
  const fit = () => find(bar.render(), "review-fit");
  assert.equal(fit().style.pr, 8);
  // Herdr T3's Home has no worktree to count: no bar, and its block closes.
  state["t3-tabs.home"] = "s";
  assert.equal(fit().style.pr, undefined);
  delete state["t3-tabs.home"];
  fire(fit(), "on_size_change", { width: 220 });
  fire(fit(), "on_size_change", { width: 220 });
  assert.deepEqual(calls.splice(0), [["layout.resize", { id: "review", px: 200 }]]);
  Object.assign(shown, { pane: "p9", cwd: "/other" });
  assert.equal(fit().style.pr, undefined, "no bar, no gap");
  fire(fit(), "on_size_change", { width: 0 });
  assert.deepEqual(calls.splice(0), [["layout.resize", { id: "review", px: 0 }]]);
  Object.assign(shown, { pane: "p1", cwd: undefined });
  const { mod: loose } = load();
  fire(find(loose.render(), "review-fit"), "on_size_change", { width: 220 });
  assert.equal(calls.length, 0, "without a block it leaves the layout alone");

  // In a real repository: a change worth a read reads a second after the last read at the soonest; one Git ignores
  // (macOS reports them), or of Git's own files but HEAD and refs, waits for the 10 s.
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pulls-review-")));
  try {
    spawnSync("git", ["init", "-q"], { cwd: tmp });
    fs.writeFileSync(path.join(tmp, ".gitignore"), "node_modules/\n");
    const { scope: watcher } = load();
    watcher.exec = async (command, args, { cwd }) => { const r = spawnSync(command, args, { cwd, encoding: "utf8" }); return { code: r.status, stdout: r.stdout }; };
    const under = (...files) => files.map(f => path.join(tmp, f));
    assert.equal(await watcher.touchesDiff(tmp, under("node_modules/x", "node_modules/y")), false, "only ignored files");
    assert.equal(await watcher.touchesDiff(tmp, under("node_modules/x", "src/a.js")), true, "one that isn't");
    assert.equal(await watcher.touchesDiff(tmp, under(".git/index", ".git/objects/ab/cd", ".git")), false, "Git's own files");
    assert.equal(await watcher.touchesDiff(tmp, under(".git/HEAD")), true);
    assert.equal(await watcher.touchesDiff(tmp, under(".git/refs/heads/main")), true);
    assert.equal(await watcher.touchesDiff(tmp, [tmp]), true, "the root, for everything");
    assert.equal(await watcher.touchesDiff(tmp, ["/elsewhere/x"]), true, "what Git can't judge");
    let tick, change;
    const wcx = { notify() {}, spawn: (f) => f(wcx), timer: { every: (_ms, f) => { tick = f; } } };
    watcher.panes = () => [{ pane: "p1", tab: "b", cwd: tmp }];
    watcher.watchFolder = () => new Promise(resolve => { change = resolve; });
    const view = {};
    watcher.watchReview(view, wcx);
    tick(wcx); await new Promise(setImmediate);
    const [key] = view.reviewAt.keys(), readAt = view.reviewAt.get(key);
    assert.equal(view.reviews.get(key)?.root, tmp);
    change(under("node_modules/x")); await new Promise(setImmediate);
    assert.equal(view.reviewAt.get(key), readAt, "an ignored change");
    change(under("src/a.js")); await new Promise(setImmediate);
    assert.ok(Date.now() - view.reviewAt.get(key) >= 9000 && view.reviewAt.get(key) <= readAt, "a change: the 10 s rule reads a second after the last read");
    // Already due, a batch asks git nothing; out of focus, nor does one that isn't: the read on coming back settles it.
    const realExec = watcher.exec, asked = [];
    watcher.exec = async (command, args, options) => { asked.push(args); return realExec(command, args, options); };
    change(under("src/b.js")); await new Promise(setImmediate);
    view.reviewAt.set(key, Date.now()); watcher.window = () => ({ active: false });
    change(under("node_modules/x")); await new Promise(setImmediate);
    assert.deepEqual([asked.length, Date.now() - view.reviewAt.get(key) >= 9000], [0, true], "no check-ignore, and a read once back");
    watcher.window = env.window;
    // Another repository's late event leaves this one's last read be.
    view.reviews.set("other", { root: "/other" }); view.reviewAt.set("other", Date.now()); view.reviewAt.set(key, Date.now());
    change(under("src/a.js")); await new Promise(setImmediate);
    assert.ok(Date.now() - view.reviewAt.get("other") < 9000 && Date.now() - view.reviewAt.get(key) >= 9000);
    watcher.exec = realExec;
    // The uncommitted count is what the pane shows: a file staged then edited back is no diff, a moved file one rename.
    const repo = path.join(tmp, "count"), sh = (cmd) => assert.equal(spawnSync("sh", ["-c", cmd], { cwd: repo }).status, 0, cmd);
    fs.mkdirSync(repo);
    sh("git init -q && echo base > a.txt && git add a.txt && git -c user.name=a -c user.email=a@b commit -qm init");
    sh("echo staged > a.txt && git add a.txt && echo base > a.txt");
    assert.equal((await watcher.readReview(repo)).changed, 0, "staged, then edited back");
    sh("git reset -q --hard && mv a.txt renamed.txt");
    assert.equal((await watcher.readReview(repo)).changed, 1, "moved");
    sh("echo new > n.txt");
    assert.equal((await watcher.readReview(repo)).changed, 2, "and a new file");
    assert.equal(fs.readFileSync(path.join(repo, ".git/index")).includes("n.txt"), false, "the person's index untouched");
    // Herdr T3's Home draws no bar: nothing reads its folder, which may be a whole home directory's repository.
    view.reviewAt.clear(); state["t3-tabs.home"] = "s";
    tick(wcx); await new Promise(setImmediate);
    assert.equal(view.reviewAt.size, 0);
    delete state["t3-tabs.home"];
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

  // The logo reads on click, then its menu's rows open one commit, or one branch against the base.
  // Two git processes: the log and one for-each-ref, which counts each branch too; a Git before 2.41 has no
  // %(ahead-behind) and fails it, and the names come again without counts.
  const ranges = [], gits = [];
  let oldGit = false;
  const exec = scope.exec = async (_command, args) => {
    gits.push(args.find(a => a === "log" || a === "for-each-ref") ?? args.join(" "));
    if (args.includes("log")) assert.ok(args.includes("--no-show-signature"), "log.showSignature would add lines that aren't commits");
    if (args.includes("rev-list")) assert.ok(!args.some(a => a.startsWith("--max-count")), "the unpushed set whole, or a commit past it reads as pushed");
    if (args.includes("log")) { ranges.push(args.at(-1)); return { code: 0, stdout: `abcdef123456\x1ffix: a\x1f${Math.floor(Date.now() / 1000) - 7260}\x1fAvery\n` }; }
    if (args.includes("rev-list")) return { code: 0, stdout: "abcdef123456\n" };
    // Each branch: name, last subject, its time, author, upstream, its track, worktree, then (Git 2.41) ahead and behind.
    const format = args.find(a => a.startsWith("--format=%(refname:short)%1f")), counting = format?.endsWith("%1f%(ahead-behind:origin/main)");
    const refs = (ab) => [["feat", "wip", 60, "Avery", "origin/feat", "", "/repo", "0 0"], ["Other", "add other", 10800, "Blake", "origin/Other", "ahead 2", "/Users/me/wt/other", "3 1"]]
      .map(([name, subject, age, ...rest]) => [name, subject, Math.floor(Date.now() / 1000) - age, ...rest].slice(0, ab ? 8 : 7).join("\x1f")).join("\n") + "\n";
    if (counting) return oldGit ? { code: 128, stdout: "" } : { code: 0, stdout: refs(true) };
    if (format) return { code: 0, stdout: refs(false) };
    return { code: 128, stdout: "" };
  };
  const r = { root: "/repo", branch: "feat", base: "main", baseRef: "origin/main", unmerged: 4 };
  /** @type {any} */ let reading;
  const run = { ...cx, spawn: fn => { reading = fn(run); } };
  const click = async (picked) => {
    show(picked);
    fire(find(bar.render(), "review-pick"), "on_mouse_down:left", { position: { x: 900, y: 20 }, bounds: { x: 890 * zoom, y: 8 * zoom, width: 24 * zoom, height: 24 * zoom } }, cx);
    fire(find(bar.render(), "review-pick"), "on_click", {}, run);
    await reading;
    return overlays.at(-1);
  };
  const spec = await click(r);
  assert.equal(spec.width, 368);
  assert.equal(ranges.at(-1), "origin/main..HEAD", "the branch's own commits");
  assert.deepEqual(gits.splice(0), ["log", "for-each-ref"]);
  const { time: otherTime, ...other } = plain(spec.props.branches)[0];
  assert.deepEqual([spec.props.branches.length, other], [1, { name: "Other", subject: "add other", author: "Blake", upstream: "origin/Other", track: "ahead 2", worktree: "/Users/me/wt/other", count: 3, behind: 1 }],
    "the current branch isn't offered against itself; each comes with its last commit, upstream, worktree and counts, from the one call");
  assert.ok(Math.abs(Date.now() - 3 * 36e5 - otherTime) < 5000);
  assert.equal(spec.height, 8 + 43 + 32 + 28, "the popup fits the switch and the longer page, so turning pages doesn't resize it");
  assert.equal(spec.props.height, spec.height, "and the menu sets that height itself: a popup's is only a maximum");
  assert.deepEqual([spec.mod, spec.props.menu], ["pulls-review", "review"]);
  // The Review page reads git itself for its scope menu (shared/review-git.js): the bar takes no command from it.
  assert.equal(commands.length, 0, "no copy waits on a command");
  assert.deepEqual([spec.at.x / zoom, spec.at.y / zoom].map(v => Math.round(v * 1000) / 1000), [890 + 24 - 368, 36], "4 under the button, right edges together, wherever the press was");
  fire(find(bar.render(), "review-open"), "on_click", {}, cx);
  assert.deepEqual(launched.at(-1), { source: plain(scope.reviewLocation()), root: "/repo", args: [], page: "/branch/feat", analyze: true }, "a count's click opens its page, known without git, and starts the analysis");
  const { mod: menu } = load({ ...spec.props, overlay: "m1" });
  const shut = closed.length;
  fire(find(menu.render(), "review-commit-abcdef123456"), "on_click", {}, cx);
  assert.deepEqual(launched.at(-1), { source: plain(spec.props.source), root: "/repo", args: ["abcdef123456"], page: "/commit/abcdef123456", overlay: "m1" }, "a menu pick doesn't analyze");
  assert.equal(closed.length, shut, "launch closes the menu when done: closing first would stop its task");
  assert.equal(find(menu.render(), "review-branch-Other"), null, "commits first, the branches on a page of their own");
  fire(find(menu.render(), "review-tab-branches"), "on_click", {}, cx);
  assert.deepEqual([find(menu.render(), "review-commit-abcdef123456"), strings(find(menu.render(), "review-branch-Other"))], [null, ["Other", "add other", "3 ahead", "3h"]],
    "a branch's row: its name, its last commit, how far ahead and how old");
  fire(find(menu.render(), "review-branch-Other"), "on_click", {}, cx);
  assert.deepEqual([launched.at(-1).args, launched.at(-1).page], [["origin/main...Other"], "/compare/origin/main...Other"]);
  // The space's review lights the count of the diff it shows, whichever of its commits it's on.
  const pane = (page, base = "/branch/feat", space = "s") => { state["review.shown"] = { [space]: { root: "/repo", page, base } }; };
  // The diff shown: lit, foreground on the hover's fill.
  // On: the text color at 7% (shared button.js), as every ghost on chrome.
  const isLit = (id) => find(bar.render(), id).style.bg === theme.foreground + "12" && find(bar.render(), id).style.text_color === theme.foreground;
  pane("/branch/feat"); show(r);
  let lit = bar.render();
  assert.ok(isLit("review-open"));
  assert.equal(find(lit, "review-open").style.accessibility_label, "Review the branch: 4 commits on feat, not on origin/main, shown");
  pane("/commit/c2"); lit = bar.render();
  assert.ok(isLit("review-open"), "on one of its commits it's still that diff");
  for (const id of ["review-commits", "commit-older", "commit-newer"]) assert.equal(find(lit, id), null, "the bar has no commit steps: they're the review's");
  pane("/branch/feat", "/branch/feat", "o");
  assert.ok(!isLit("review-open"), "another space's review lights nothing");
  // How the space's review analysis goes, after the logo, as the panel head marks it: another space's isn't this one's.
  const pick = () => find(bar.render(), "review-pick");
  const marked = () => walk(pick()).some(n => n.source === "mods/pulls-review/icons/circle-dashed.svg" || strings(n).includes("!") || n.style.rounded_full !== undefined);
  for (const [word, label] of [["working", "running"], ["done", "done"], ["blocked", "failed"]]) {
    state["review.status"] = { s: word };
    assert.ok(marked() && pick().style.accessibility_label === `Change what to review, analysis ${label}`, word);
  }
  state["review.status"] = { o: "working" };
  assert.ok(!marked() && pick().style.accessibility_label === "Change what to review" && pick().style.w === 24);
  delete state["review.status"];
  pane("/commit/abc", "/commit/abc");
  assert.ok(!isLit("review-open"), "a commit opened as its own diff lights no count");
  pane("/branch/feat"); state["review.shown"].s.root = "/other";
  assert.ok(!isLit("review-open"), "another repository's diff lights nothing");
  // In Herdr T3's panel, what the Review tab now open showed: one closed since (another `born`) lights nothing.
  const layout = scope.layout;
  scope.layout = () => ({ id: "root", children: [{ id: "panel", children: [{ id: "panel-body", active: "review", children: [{ id: "files" }, { id: "review" }, { id: "panel-empty" }] }] }] });
  state["t3.panels"] = { s: { tabs: [{ id: "review", born: 9 }], active: "review", open: true } };
  pane("/branch/feat"); state["review.shown"].s.born = 8;
  assert.ok(!isLit("review-open"), "a closed Review tab's diff lights nothing");
  state["review.shown"].s.born = 9;
  assert.ok(isLit("review-open"), "the open one's does");
  scope.layout = layout; delete state["t3.panels"];
  // The logo's menu picks what to review, whatever the review shows: the log and the branches, both on their own page.
  pane("/commit/c2");
  gits.length = 0;
  const onCommit = await click(r);
  assert.deepEqual(gits.splice(0), ["log", "for-each-ref"], "the log, not the review's commits");
  assert.deepEqual(plain(onCommit.props.commits.map(c => c.sha)), ["abcdef123456"]);
  assert.ok(!("within" in onCommit.props));
  const list = ["c3", "c2", "c1"].map(sha => ({ sha, subject: sha, time: Date.now() - 36e5 }));
  const menuProps = { ...spec.props, commits: list };
  const inMenu = load(menuProps).mod;
  // Commits first, no branch among them, no All changes: that's the pane's.
  const rowsOf = (m) => ["review-all", "review-branch-Other", "review-commit-c3", "review-commit-c2", "review-commit-c1"].filter(id => find(m.render(), id));
  const ids = rowsOf(inMenu);
  assert.deepEqual(ids, ["review-commit-c3", "review-commit-c2", "review-commit-c1"]);
  assert.deepEqual(strings(find(inMenu.render(), "review-menu")).filter(text => /^(Commits|Branches|\d+|on feat)$/.test(text)), ["Commits", "3", "Branches", "1", "on feat"],
    "the switch counts each page, and says what the page shown lists");
  // The highlight as every menu's (menu-row.js): `selected`, on the top row first, moved by ↑/↓ (round) and by the pointer.
  const highlighted = () => ids.filter(id => find(inMenu.render(), id)?.style.bg === theme.selected);
  assert.deepEqual(highlighted(), ["review-commit-c3"]);
  const key = (k) => fire(find(inMenu.render(), "review-menu"), "on_key_down", { key: k }, cx);
  key("down");
  assert.deepEqual(highlighted(), ["review-commit-c2"]);
  const cardOf = (id) => strings(find(find(inMenu.render(), id), `details-${id}`).style.content);
  assert.equal(cardOf("review-commit-c2")[0], "c2", "the card follows the keys to a commit");
  key("up"); key("up");
  assert.deepEqual(highlighted(), ["review-commit-c1"], "up from the top goes round to the bottom");
  fire(find(inMenu.render(), "review-commit-c3"), "on_hover", true, cx);
  assert.deepEqual(highlighted(), ["review-commit-c3"], "the pointer moves it too");
  fire(find(inMenu.render(), "review-commit-c1"), "on_click", {}, cx);
  assert.deepEqual(launched.at(-1), { source: plain(spec.props.source), root: "/repo", args: ["c1"], page: "/commit/c1" }, "a pick opens it as its own diff, unanalyzed");
  // Tab turns to the branches' page, and back.
  key("tab");
  assert.deepEqual(rowsOf(inMenu), ["review-branch-Other"], "no commit among the branches");
  assert.equal(strings(find(inMenu.render(), "review-menu")).at(-5), "vs main");
  // A branch's card, as a commit's: its last commit, then how it stands against the base and its upstream, and where it's checked out.
  key("down");
  const [branchName, branchSubject, branchAge, ...branchRest] = cardOf("review-branch-Other");
  assert.deepEqual([branchName, branchSubject, branchRest], ["Other", "add other", ["B", "Blake", "3 ahead of main, 1 behind", "2 not pushed · origin/Other", "Checked out in ~/wt/other"]]);
  assert.match(branchAge, /^3h ago · /);
  fire(find(inMenu.render(), "review-branch-Other"), "on_click", {}, cx);
  assert.deepEqual(launched.at(-1).args, ["origin/main...Other"], "a branch is a new diff");
  key("tab");
  assert.deepEqual(rowsOf(inMenu), ids);
  const top = find(inMenu.render(), "review-menu").items.map(n => n.key);
  assert.ok(top.includes("review-commit-list") && !top.includes("review-branches"), "the switch outside the list");
  const many = load({ ...menuProps, branches: Array.from({ length: 9 }, (_, i) => ({ name: `b${i}`, count: 1 })) }).mod;
  fire(find(many.render(), "review-tab-branches"), "on_click", {}, cx);
  // The lists scroll by script, as the shipped picker's: rows keep their handlers, ↑/↓ keep the highlight in view, the wheel
  // takes the highlight along. Until the list is measured every row is drawn; then only those in view, where the scroll puts them.
  const branchRow = (i) => find(many.render(), `review-branch-b${i}`);
  assert.ok(branchRow(8), "unmeasured: all drawn");
  fire(find(many.render(), "review-branches"), "on_size_change", { width: 500, height: 4 * 28 * zoom }, cx);
  assert.deepEqual([branchRow(3)?.style.top, branchRow(4)], [3 * 28, null], "measured: the four in view");
  const manyKey = (k) => fire(find(many.render(), "review-menu"), "on_key_down", { key: k }, cx);
  for (let i = 0; i < 5; i++) manyKey("down");
  assert.equal(branchRow(5).style.bg, theme.selected);
  assert.deepEqual([branchRow(5).style.top, branchRow(1)], [3 * 28, null], "↑/↓ scroll the highlight into view, at the bottom edge");
  // Two events before the next render, as a trackpad sends them: both count.
  const wheeled = find(many.render(), "review-branches");
  for (let i = 0; i < 2; i++) fire(wheeled, "on_scroll_wheel", { delta: { x: 0, y: 28 * zoom } }, cx);
  assert.deepEqual([branchRow(0)?.style.top, branchRow(4)], [0, null], "the wheel scrolls back up");
  assert.equal(branchRow(3).style.bg, theme.selected, "and the highlight comes along, to the last row in view");
  // Only the rows drawn are built: 200 commits, four in view, build a few dozen elements, not one per commit.
  const long = load({ ...menuProps, commits: Array.from({ length: 200 }, (_, i) => ({ sha: `s${i}`, subject: `fix: c${i}`, time: Date.now() })),
    // Read once into a set: a scan per row per render grows with every commit not pushed.
    unpushed: Object.assign(["s0"], { includes() { throw new Error("the unpushed set scanned in render"); } }) });
  fire(find(long.mod.render(), "review-commit-list"), "on_size_change", { width: 500, height: 4 * 28 * zoom }, cx);
  let built = 0;
  for (const make of ["div", "h_flex", "v_flex", "svg"]) { const real = long.scope[make]; long.scope[make] = (...args) => (built++, real(...args)); }
  const longMenu = long.mod.render();
  assert.deepEqual([Boolean(find(longMenu, "review-commit-s3")), find(longMenu, "review-commit-s4")], [true, null]);
  assert.ok(built < 100, `${built} elements for four rows`);
  assert.deepEqual(strings(find(longMenu, "review-commit-s0")).slice(-2, -1), ["↑"], "not pushed");
  // The logo toggles: a press outside the popup closes it, before or just after the press reaches the bar; its click leaves it closed.
  const menus = () => overlays.length, logoButton = () => find(bar.render(), "review-pick");
  const pressLogo = () => fire(logoButton(), "on_mouse_down:left", { position: { x: 900, y: 20 } }, cx);
  const menusBefore = menus();
  inMenu.close(); pressLogo(); fire(logoButton(), "on_click", {}, run); await reading;
  assert.equal(menus(), menusBefore, "closed just before the press");
  pressLogo(); inMenu.close(); fire(logoButton(), "on_click", {}, run); await reading;
  assert.equal(menus(), menusBefore, "closed just after it");
  state["pulls-review.menuClosed"] = Date.now() - 1000;
  pressLogo(); fire(logoButton(), "on_click", {}, run); await reading;
  assert.equal(menus(), menusBefore + 1, "closed long ago, by Esc or a pick: the click opens it");
  // Clicks while it's still reading open it once.
  pressLogo(); fire(logoButton(), "on_click", {}, run); fire(logoButton(), "on_click", {}, run); await reading;
  assert.equal(menus(), menusBefore + 2);
  delete state["pulls-review.menuClosed"];
  // Focus moving to another repository while git reads: no menu of this one over it.
  const readPicks = scope.readPicks;
  let release;
  scope.readPicks = (picked) => new Promise(done => { release = () => done(readPicks(picked)); });
  fire(logoButton(), "on_click", {}, run);
  Object.assign(shown, { pane: "p9", cwd: "/other" });
  release(); await reading;
  assert.equal(menus(), menusBefore + 2, "a stale read opens nothing");
  Object.assign(shown, { pane: "p1", cwd: undefined });
  scope.readPicks = readPicks;
  // Enter takes the top row, or the first a search leaves.
  let enter, query = "";
  const placeholders = [];
  const scoped = load(menuProps);
  scoped.scope.InputState = { new: (options) => { placeholders.push(options.placeholder); return { on: (event, fn) => { if (event === "submit") enter = fn; }, value: () => query, focus() {} }; } };
  scoped.scope.initReviewMenu(scoped.mod);
  scoped.scope.launch = (input) => { launched.push(plain(input)); };
  enter({}, cx);
  assert.deepEqual(launched.at(-1).args, ["c3"]);
  query = "c1";
  enter({}, cx);
  assert.deepEqual(launched.at(-1).args, ["c1"]);
  // The search says what there is to search.
  const alone = load({ ...menuProps, branches: [] });
  alone.scope.InputState = scoped.scope.InputState;
  alone.scope.initReviewMenu(alone.mod);
  assert.deepEqual(placeholders, ["Search commits and branches", "Search commits"]);
  delete state["review.shown"];
  // Search narrows both lists; Enter opens the first left.
  const searching = load(spec.props);
  let typed = "", submit, change;
  searching.scope.InputState = { new: () => ({ on: (event, fn) => { if (event === "submit") submit = fn; else if (event === "change") change = fn; }, value: () => typed, focus() {} }) };
  searching.scope.initReviewMenu(searching.mod);
  const type = (text) => { typed = text; change({}, cx); };
  fire(find(searching.mod.render(), "review-menu"), "on_key_down", { key: "down" }, cx);
  submit({}, cx);
  assert.deepEqual(launched.at(-1).args, ["abcdef123456"], "Enter opens the highlighted row");
  type("oTHER");
  assert.equal(find(searching.mod.render(), "review-commit-abcdef123456"), null, "a commit that doesn't match goes");
  assert.ok(find(searching.mod.render(), "review-branch-Other"), "matching ignores case");
  submit({}, cx);
  assert.deepEqual(launched.at(-1).args, ["origin/main...Other"], "Enter opens the only match left");
  type("abcdef");
  const commitRow = () => find(searching.mod.render(), "review-commit-abcdef123456");
  assert.deepEqual(strings(commitRow()), ["fix:", "a", "2h"], "a sha's start matches; one line: the dimmed prefix, the subject, a short age, no sha");
  const card = () => strings(find(commitRow(), "details-review-commit-abcdef123456").style.content);
  assert.deepEqual(card(), [], "its card waits for the hover");
  fire(commitRow(), "on_hover", true, cx);
  const [title, age, ...who] = card();
  assert.deepEqual([title, who], ["fix: a", ["A", "Avery"]], "hovered: the whole subject, then its author");
  assert.match(age, /^2h ago · [A-Z][a-z]{2} \d+, \d\d:\d\d$/, "and when, to the minute");
  assert.equal(find(commitRow(), "details-review-commit-abcdef123456").style.anchor, "top_right", "on the row's left: the menu hangs at the window's right");
  fire(commitRow(), "on_hover", false, cx);
  assert.deepEqual(card(), [], "gone with the pointer");
  // Not pushed: ↑ in the row, and the card says where it isn't.
  const picks = await scope.readPicks({ ...r, upstream: "origin/feat" });
  assert.deepEqual(plain(picks.unpushed), ["abcdef123456"], "the upstream's missing commits, read beside the log");
  gits.length = 0;
  const pushing = load({ ...spec.props, upstream: "origin/feat", unpushed: picks.unpushed });
  const outRow = () => find(pushing.mod.render(), "review-commit-abcdef123456");
  assert.deepEqual(strings(outRow()), ["fix:", "a", "↑", "2h"]);
  fire(outRow(), "on_hover", true, cx);
  assert.equal(strings(find(outRow(), "details-review-commit-abcdef123456").style.content).at(-1), "Not on origin/feat yet");
  submit({}, cx);
  assert.deepEqual(launched.at(-1).args, ["abcdef123456"]);
  type("nope");
  const opened = launched.length;
  submit({}, cx);
  assert.equal(launched.length, opened, "no match: Enter opens nothing");
  await click({ ...r, branch: "main", unmerged: 0 });
  assert.equal(ranges.at(-1), "HEAD", "on the default branch: its recent commits");
  // Right after a press's: the last press isn't this click's.
  fire(find(bar.render(), "review-pick"), "on_click", {}, run);
  await reading;
  assert.equal(overlays.at(-1).at, undefined, "a click with no press opens at the pointer");
  const before = overlays.length;
  scope.exec = async () => ({ code: 128, stdout: "" });
  await click(r);
  assert.equal(overlays.length, before, "nothing to pick, no menu");
  scope.exec = exec;
  oldGit = true; gits.length = 0;
  const old = await click(r);
  assert.deepEqual(gits.splice(0).filter(g => g === "for-each-ref"), ["for-each-ref", "for-each-ref"]);
  assert.deepEqual([old.props.branches[0].name, "count" in old.props.branches[0]], ["Other", false], "an older Git: the branches without counts");
  const oldMenu = load(old.props).mod;
  fire(find(oldMenu.render(), "review-tab-branches"), "on_click", {}, cx);
  const uncounted = find(oldMenu.render(), "review-branch-Other");
  assert.deepEqual([strings(uncounted), uncounted.style.accessibility_label], [["Other", "add other", "3h"], "Review branch Other"]);

  // Opened as an overlay (`mod.open:pulls-review`) it reviews the focused pane's worktree and closes itself: in "herdr"
  // mode, on the review page of the window's panel, the request naming the space.
  calls.length = 0;
  const { mod: launcher, scope: opener } = load({ overlay: "o1" }, (scope) => {
    // No sh: status's count, as on Windows.
    scope.exec = async (command, args) => command === "sh" ? { code: 1, stdout: "" } : args.includes("--show-toplevel") ? { code: 0, stdout: "/repo\n" } : { code: 0, stdout: args.includes("status") ? " M a.js\n" : "" };
  });
  await new Promise(setImmediate);
  const panelShown = [["layout.select", { stack: "panel-body", child: "review" }], ["layout.show", { id: "panel" }]];
  assert.deepEqual(calls, panelShown);
  assert.deepEqual(plain({ ...state.review, n: 0 }), { space: "s", root: "/repo", page: "/worktree", n: 0, analyze: false });
  assert.deepEqual(closed.at(-1), "o1");
  assert.equal(find(launcher.render(), "review-fit"), null, "nothing to see while it works");
  // A file staged then edited back is no change to review, as the bar counts it: the shortcut opens the branch's commit.
  const netRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pulls-review-net-")));
  try {
    const sh = (cmd) => assert.equal(spawnSync("sh", ["-c", cmd], { cwd: netRepo }).status, 0, cmd);
    sh("git init -q -b main && echo base > a.txt && git add a.txt && git -c user.name=a -c user.email=a@b commit -qm init"
      + " && git checkout -qb feat && echo b > b.txt && git add b.txt && git -c user.name=a -c user.email=a@b commit -qm b"
      + " && echo staged > a.txt && git add a.txt && echo base > a.txt");
    calls.length = 0;
    const { scope: shortcut } = load({}, null);
    shortcut.panes = () => [{ pane: "p1", tab: "b", cwd: netRepo }];
    shortcut.exec = async (command, args, { cwd }) => { const r = spawnSync(command, args, { cwd, encoding: "utf8" }); return { code: r.status, stdout: r.stdout }; };
    await launch(shortcut, {});
    assert.equal(state.review.page, "/branch/feat", "staged then edited back: the branch, not an empty worktree");
    sh("echo edited > a.txt"); calls.length = 0;
    await launch(shortcut, {});
    assert.equal(state.review.page, "/worktree", "a real change: the worktree");
  } finally { fs.rmSync(netRepo, { recursive: true, force: true }); }
  // From the bar, what it already knows: no git, no overlay to close.
  calls.length = 0;
  const shutBefore = closed.length;
  opener.exec = async (_command, args) => assert.fail(`git ${args.join(" ")}`);
  await launch(opener, { root: "/repo", args: ["origin/feat...feat"], page: "/compare/origin/feat...feat", analyze: true });
  assert.deepEqual([calls, state.review.page, state.review.analyze], [panelShown, "/compare/origin/feat...feat", true], "the request carries the ask");
  assert.equal(closed.length, shutBefore);
  assert.deepEqual(plain(notes), []);

  // A layout whose panel has no review page says so.
  const noPage = opener.layout;
  opener.layout = () => ({ id: "root", children: [{ id: "panel", children: [{ id: "panel-body", children: [{ id: "files" }] }] }] });
  calls.length = 0; await launch(opener, { root: "/repo", args: [], page: "/branch/feat" });
  assert.deepEqual([calls, notes.splice(0).map(n => n.body)], [[], ["This layout's panel has no review page: add the review block to its panel-body stack."]]);
  opener.layout = noPage;
  // The review takes only a number past the last it handled, and its own switch sends the last one + 1: each request's is
  // past the last sent, whatever the clock says.
  const OpenerDate = vm.runInContext("Date", opener), clock = OpenerDate.now;
  OpenerDate.now = () => 100000;
  state.review = { space: "s", root: "/repo", page: "/commit/previous", base: "/branch/feat", n: 101000 };
  await launch(opener, { root: "/repo", args: [], page: "/branch/feat" });
  assert.ok(state.review.n > 101000, "the clock set back");
  const first = state.review.n;
  await launch(opener, { root: "/repo", args: [], page: "/branch/feat" });
  assert.ok(state.review.n > first, "two in the same millisecond");
  OpenerDate.now = clock; delete state.review;
  // Switching space while it reads: the review stays out of the new space's.
  let config;
  opener.readTextFile = () => new Promise(done => { config = done; });
  calls.length = 0;
  const late = launch(opener, { root: "/repo", args: [], page: "/branch/feat" });
  opener.spaces = () => [{ id: "s", active: false, folder: "/space", tabs: [] }, { id: "o", active: true, folder: "/o", tabs: [] }];
  config('{ "open": "herdr" }'); await late;
  assert.deepEqual([plain(calls), state.review], [[], undefined], "started in one space, nothing done in another");
  opener.readTextFile = env.readTextFile; opener.spaces = env.spaces;

  // The independent external modes still launch their own programs, not the panel. Their root is the captured one.
  for (const mode of ["browser", "pwa", "official"]) {
    const external = [], { scope } = load({}, null);
    scope.readTextFile = async () => JSON.stringify({ open: mode });
    scope.exec = async (command, args, options) => { external.push([command, plain(args), options?.cwd]); return { code: 0 }; };
    scope.hc = async args => { external.push(["hc", plain(args)]); return { code: 0, stdout: '{"terminals":[]}' }; };
    await launch(scope, { root: "/repo", args: ["--worktree"], page: "/worktree", analyze: true });
    if (mode === "official") {
      assert.deepEqual(external, [["hc", ["ls", "--json", "--label", "pulls-review.root=/repo"]], ["pulls.review", ["--help"], undefined],
        ["hc", ["run", "--json", "--bg", "--no-parent", "--rm", "--cwd", "/repo", "--label", "pulls-review.root=/repo", "--", "pulls.review", "--worktree"]]]);
    } else assert.deepEqual(external, [["jin.review", ["-d", ...(mode === "pwa" ? ["--pwa"] : []), "--analyze", "--worktree"], "/repo"]]);
    assert.deepEqual([calls, state.review, plain(notes)], [[], undefined, []], mode);
  }

  // Both spaces have the same cwd. Exercise the rendered count, the logo/menu and mod.open with real launch and panel code.
  {
    let active = "a", read, release;
    const seen = [], queued = [], pane = "/repo/src", { mod: bar, scope } = load({ block: "review" }, null);
    const r = { root: "/repo", branch: "feat", base: "main", changed: 1, unmerged: 0 };
    const barProps = () => ({ block: "review" });
    scope.spaces = () => ["a", "b"].map(id => ({ id, active: id === active, folder: pane, tabs: [{ id: "b", active: true }] }));
    scope.layout = () => ({ id: "panel", children: [{ id: "panel-body", children: ["review", "files", "panel-empty"].map(id => ({ id })) }] });
    scope.run = (name, args) => seen.push([name, plain(args)]);
    scope.setShared = (key, value) => { state[key] = value; if (key === "review") seen.push([key, value]); };
    scope.closeOverlay = id => seen.push(["close", id]);
    scope.readPicks = () => new Promise(done => { release = () => done({ commits: [{ sha: "a123", subject: "from A" }], branches: [], unpushed: [] }); });
    scope.exec = async (_cmd, args) => ({ code: 0, stdout: args.includes("--show-toplevel") ? "/repo\n" : "" });
    const barReady = () => { scope.props = barProps; bar.reviews.set(location(scope), r); return bar.render(); };
    const menuCx = { ...cx, spawn: fn => { read = fn(menuCx); } }, jobCx = { ...cx, spawn: fn => queued.push(fn) };
    const logo = () => fire(find(barReady(), "review-pick"), "on_click", {}, menuCx);
    const count = () => fire(find(barReady(), "review-changes"), "on_click", {}, jobCx);
    const mount = (p, cx) => { scope.props = () => p; const v = new scope.Mod(); v.init(p, cx); return v; };
    const menu = () => mount({ ...overlays.at(-1).props, overlay: "same-cwd-menu" }, cx);
    const pick = v => fire(find(v.render(), "review-commit-a123"), "on_click", {}, jobCx);
    const runJob = async () => { await queued.shift()(jobCx); };
    const writes = () => seen.filter(([action]) => action !== "close").map(([action]) => action);
    const popupCount = overlays.length;
    logo(); active = "b"; release(); await read;
    const lateMenu = overlays.length - popupCount;

    active = "a"; logo(); release(); await read;
    const fromA = menu();
    active = "b"; pick(fromA); await runJob();
    const latePick = writes(); seen.length = 0;

    active = "a"; count(); active = "b"; await runJob();
    const lateCount = writes(); seen.length = 0;

    active = "a"; mount({ overlay: "same-cwd-shortcut", page: "/worktree", args: ["--worktree"] }, jobCx);
    active = "b"; await runJob();
    const lateShortcut = writes(); seen.length = 0;
    assert.deepEqual([lateMenu, latePick, lateCount, lateShortcut], [0, [], [], []], "no late menu, or panel handoff to another space with the same cwd");

    active = "a"; count(); await runJob();
    const countRequest = state.review, born = state["t3.panels"].a.tabs.find(t => t.id === "review").born;
    assert.deepEqual([writes().slice(-3), countRequest.space, countRequest.root, countRequest.page, countRequest.analyze, countRequest.born],
      [["layout.show", "t3-actions.dismiss-details", "review"], "a", "/repo", "/worktree", true, born]);
    seen.length = 0;
    logo(); release(); await read;
    pick(menu()); await runJob();
    assert.deepEqual([seen.slice(-2).map(([action]) => action), state.review.page, state.review.analyze, state.review.born],
      [["review", "close"], "/commit/a123", false, born], "menu asks for its commit, then closes; browsing does not ask for analysis");
    delete state["t3.panels"]; delete state.review;
  }

  // Herdr T3 owns its layout controls; an older installed Review bar collapses to nothing, without Git reads.
  const { mod: merged, scope: mergedScope } = load({ block: "review-bar", toggle: true });
  const joined = merged.render();
  assert.equal(find(joined, "pulls-review"), null);
  assert.equal(merged.reviews, undefined, "nothing reads git for counts it doesn't show");
  assert.ok(!walk(joined).some(n => n.kind === "image"), "no logo in the bar");
  assert.equal(find(joined, "review-panel"), null);

  // The panel's review page starts only when first shown and shared outlives the app, so a run's word from before a restart
  // would stay working in the bar and the panel head. The bar, always shown, drops it; only the bar: an overlay opens with every menu.
  state["review.status"] = { a: "working", b: "done", c: "blocked" };
  load({ overlay: "o", page: "/x" });
  assert.equal(state["review.status"].a, "working", "opening a review isn't a restart");
  load({ block: "review" });
  assert.deepEqual(plain(state["review.status"]), { b: "done", c: "blocked" }, "how a run ended is still news");
  const kept = state["review.status"]; load({ block: "review" });
  assert.equal(state["review.status"], kept, "nothing to drop, nothing written: every write redraws every mod");

  // Every icon on disk is drawn: what a change orphans goes with it.
  const code = ["bar.js", "details.js", "tip.js", "status-mark.js", "main.js"].map(file => fs.readFileSync(path.join(__dirname, file), "utf8")).join("\n");
  for (const file of fs.readdirSync(path.join(__dirname, "icons"))) assert.ok(code.includes(path.basename(file, ".svg")), `${file} is used`);

  console.log("ok: standalone Review counts/menu/analysis, native panel opening and shared Git reads; Herdr T3's retired toggle bar collapses without duplicate controls");
})().catch(e => { console.error(e); process.exit(1); });
