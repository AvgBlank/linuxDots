// Self-check for mods/extras (project.js, worktree-slot.js, and main.js helpers):
// verifies local/remote space matching, subdir guard, Windows path normalization,
// REMOTE_LIST scanning, git worktree porcelain parsing, slot keys, and XML escaping.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const projSrc = fs.readFileSync(path.join(__dirname, "project.js"), "utf8");
const wtSrc = fs.readFileSync(path.join(__dirname, "worktree-slot.js"), "utf8");

// 1. Load pure helpers + openProjectDir from project.js
const calls = [];
let mockSpaces = [], mockPanes = [];
const projBody = projSrc
  .replace(/^import .*;\r?\n/gm, "")
  .replace(/^export /gm, "");

const { norm, inside, tilde, baseOf, openProjectDir, REMOTE_LIST, FZF_PROJECT_SCRIPT, buildWinFzfScript, parseFzfOutput } = new Function(
  "spaces", "panes", "run",
  `${projBody}\nreturn { norm, inside, tilde, baseOf, openProjectDir, REMOTE_LIST, FZF_PROJECT_SCRIPT, buildWinFzfScript, parseFzfOutput };`
)(() => mockSpaces, () => mockPanes, (cmd, args) => calls.push([cmd, args]));

// Path normalization (POSIX + Windows backslashes)
assert.equal(norm("C:\\Users\\husain\\projects\\foo\\"), "C:/Users/husain/projects/foo");
assert.equal(tilde("C:\\Users\\husain\\projects\\foo", "C:\\Users\\husain"), "~/projects/foo");
assert.equal(inside("/home/hussain/linuxDots/agentDots", "/home/hussain/linuxDots"), true);
assert.equal(inside("/home/hussain/linuxDots2", "/home/hussain/linuxDots"), false);

// Remote space matching & subdir guard
mockSpaces = [
  { id: "sp-local", machine: null, folder: "/Users/husain/linuxDots", tabs: [{ id: "t1" }] },
  { id: "wsl/sp-1", machine: "wsl", folder: "/home/hussain/linuxDots", tabs: [{ id: "wsl/t1" }] },
  { id: "wsl/sp-child", machine: "wsl", folder: "/home/hussain/projects/app", tabs: [{ id: "wsl/t2" }] },
];
mockPanes = [
  { tab: "wsl/t1", cwd: "/home/hussain/linuxDots/agentDots" },
  { tab: "wsl/t2", cwd: "/home/hussain/projects/app" },
];

openProjectDir("/home/hussain/linuxDots", "wsl");
assert.deepEqual(calls.pop(), ["space.select", { id: "wsl/sp-1" }]);

openProjectDir("/home/hussain/projects", "wsl");
assert.deepEqual(calls.pop(), ["space.new", { folder: "/home/hussain/projects", machine: "wsl" }]);

openProjectDir("/Users/husain/projects/newapp", null);
assert.deepEqual(calls.pop(), ["space.new", { folder: "/Users/husain/projects/newapp" }]);

// 2. REMOTE_LIST scans ~/*, ~/projects/*, ~/organizations/*, and ~/organizations/*/*
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "extras-proj-"));
try {
  fs.mkdirSync(path.join(tmp, "linuxDots"));
  fs.mkdirSync(path.join(tmp, "projects", "demo"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "organizations", "acme", "api"), { recursive: true });
  const out = execFileSync("sh", ["-c", REMOTE_LIST], { env: { ...process.env, HOME: tmp }, encoding: "utf8" });
  const lines = out.trim().split("\n");
  assert.equal(lines[0], tmp);
  assert.ok(lines.includes(path.join(tmp, "linuxDots")), "includes ~/*");
  assert.ok(lines.includes(path.join(tmp, "projects", "demo")), "includes ~/projects/*");
  assert.ok(lines.includes(path.join(tmp, "organizations", "acme")), "includes ~/organizations/* (depth 1)");
  assert.ok(lines.includes(path.join(tmp, "organizations", "acme", "api")), "includes ~/organizations/*/* (depth 2)");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 3. Worktree porcelain parsing, slot keys, and branch slugging
const wtBody = wtSrc
  .replace(/^import .*;\r?\n/gm, "")
  .replace(/^export /gm, "");
const { parseWorktrees, slotKey, branchSlug } = new Function(
  "norm", "tilde", "baseOf", "openProjectDir",
  `${wtBody}\nreturn { parseWorktrees, slotKey, branchSlug };`
)(norm, tilde, baseOf, openProjectDir);

const porcelain = [
  "worktree /home/hussain/linuxDots",
  "HEAD abcdef",
  "branch refs/heads/Master",
  "",
  "worktree /home/hussain/.herdr/worktrees/linuxDots/feat-win",
  "HEAD 123456",
  "branch refs/heads/feat/win",
  "",
  "worktree /home/hussain/.herdr/worktrees/linuxDots/stale",
  "HEAD 999999",
  "prunable gitdir file points to non-existent location",
].join("\n");

const parsed = parseWorktrees(porcelain);
assert.equal(parsed.primary, "/home/hussain/linuxDots");
assert.equal(parsed.linked.length, 1);
assert.equal(parsed.linked[0].branch, "feat/win");
assert.equal(parsed.linked[0].path, "/home/hussain/.herdr/worktrees/linuxDots/feat-win");
assert.equal(slotKey("/Users/husain/linuxDots", null), "/Users/husain/linuxDots/.git");
assert.equal(slotKey("/home/hussain/linuxDots", "wsl"), "wsl:/home/hussain/linuxDots/.git");
assert.equal(branchSlug("feat/win test!"), "feat-win-test");

// 4. Auto-merge of keys.custom.json into platform keys.json (Windows/macOS/Linux)
const mainSrc = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
const fnMatch = /export function mergeCustomKeys\([\s\S]*?\n\}/.exec(mainSrc);
assert.ok(fnMatch, "mergeCustomKeys exported from main.js");
const mergeCustomKeys = new Function(`${fnMatch[0].replace(/^export /, "")}\nreturn mergeCustomKeys;`)();

const winBase = JSON.stringify({
  global: { "ctrl-shift-t": "tab.new", "alt-1": "space.select:1" },
  terminal: { "ctrl-shift-c": "terminal.copy", "ctrl-f": "terminal.search" },
});
const customText = fs.readFileSync(path.join(__dirname, "..", "..", "keys.custom.json"), "utf8");
const merged = mergeCustomKeys(winBase, customText);
assert.ok(merged, "produces merged JSON when custom keys are missing");
const parsedKeys = JSON.parse(merged);
assert.equal(parsedKeys.global["ctrl-shift-t"], "tab.new", "preserves Windows base keys");
assert.equal(parsedKeys.global["alt-q"], "extras.tab-1");
assert.equal(parsedKeys.global["ctrl-f"], "extras.project");
assert.equal(parsedKeys.global["ctrl-a p"], "layout.toggle:sidebar");
assert.equal(parsedKeys.global["ctrl-a ["], "extras.copymode");
assert.equal(parsedKeys.global["ctrl-a m"], "extras.machine");
assert.equal(parsedKeys.global["alt-f4"], "window.close");
// Windows GPUI reports Alt+Shift+1 as `alt-!` (shift stripped), so `alt-shift-1` alone never matches there.
assert.equal(parsedKeys.global["alt-!"], "extras.agent-1", "Windows spelling of alt-shift-1");
assert.equal(parsedKeys.global["alt-("], "extras.agent-9", "Windows spelling of alt-shift-9");
assert.equal(parsedKeys.global["alt-shift-1"], "extras.agent-1", "keeps alt-shift-1 agent binding");
assert.equal("ctrl-f" in parsedKeys.terminal, false, "removes shadowed terminal binding");
assert.equal(parsedKeys.terminal["ctrl-shift-c"], "terminal.copy");
assert.equal(parsedKeys.terminal["ctrl-a ctrl-a"], "send:\u0001");
assert.equal(parsedKeys["layout:focus"]["ctrl-alt-b"], "t3-tabs.sidebar");
assert.ok(parsedKeys["mod:extras"]);
assert.equal(mergeCustomKeys(merged, customText), null, "idempotent: no write when already synced");
assert.equal(mergeCustomKeys(null, customText), null, "skips if base keys.json not created yet");

// 5. Native Vim copy mode (full motions, visual / V-LINE, relative-line navigation, search, yank)
const cmSrc = fs.readFileSync(path.join(__dirname, "copy-mode.js"), "utf8");
const cmCleaned = cmSrc
  .replace(/^import .*$/gm, "")
  .replace(/\bexport function /g, "function ");
const { createCopyState, handleCopyKey } = new Function(`${cmCleaned}\nreturn { createCopyState, handleCopyKey };`)();

const runCm = (lines) => {
  const copied = [];
  let closed = false;
  const state = createCopyState(lines);
  const ops = { copy: (t) => copied.push(t), close: () => { closed = true; } };
  return { state, ops, copied, isClosed: () => closed };
};
const ev = (key, extra = {}) => ({ key, modifiers: {}, ...extra });
const press = (state, ops, seq) => {
  for (const ch of seq) {
    const shift = ch >= "A" && ch <= "Z";
    handleCopyKey(state, ev(ch.toLowerCase(), { key_char: ch, modifiers: shift ? { shift: true } : {} }), 10, ops);
  }
};

const sample = [
  "alpha beta_two gamma-three",
  "  indented foo.bar/baz end",
  "",
  "fourth line here",
  "fifth line target",
];

{
  // Starts at last non-empty line; j/k with counts and sticky desiredCol
  const { state, ops } = runCm(sample);
  assert.equal(state.row, 4);
  press(state, ops, "2k");
  assert.equal(state.row, 2);
  press(state, ops, "k");
  assert.equal(state.row, 1);
  press(state, ops, "$");
  assert.equal(state.col, sample[1].length - 1);
  press(state, ops, "j"); // empty line clamps col to 0
  assert.equal(state.row, 2);
  assert.equal(state.col, 0);
  press(state, ops, "j"); // sticky desiredCol jumps back to end of line 3
  assert.equal(state.row, 3);
  assert.equal(state.col, sample[3].length - 1);
}
{
  // w, b, e, W, B, E, ge, ^, 0, f/t/;
  const { state, ops } = runCm(sample);
  press(state, ops, "gg");
  assert.equal(state.row, 0);
  assert.equal(state.col, 0);
  press(state, ops, "w");
  assert.equal(state.col, 6); // beta_two
  press(state, ops, "e");
  assert.equal(state.col, 13); // end of beta_two
  press(state, ops, "w");
  assert.equal(state.col, 15); // gamma
  press(state, ops, "w");
  assert.equal(state.col, 20); // '-'
  press(state, ops, "b");
  assert.equal(state.col, 15); // gamma
  press(state, ops, "W"); // skips gamma-three as one WORD -> wraps to line 1 'indented'
  assert.equal(state.row, 1);
  assert.equal(state.col, 2);
  press(state, ops, "E");
  assert.equal(state.col, 9); // end of 'indented'
  press(state, ops, "W");
  assert.equal(state.col, 11); // foo.bar/baz
  press(state, ops, "B");
  assert.equal(state.col, 2);
  press(state, ops, "0");
  assert.equal(state.col, 0);
  press(state, ops, "^");
  assert.equal(state.col, 2);
  press(state, ops, "fb");
  assert.equal(state.col, 15); // 'b' in foo.bar
  press(state, ops, ";");
  assert.equal(state.col, 19); // 'b' in /baz
}
{
  // V (visual line) moving UP and DOWN selects complete lines cleanly
  const { state, ops, copied, isClosed } = runCm(sample);
  assert.equal(state.row, 4);
  press(state, ops, "Vkky"); // lines 2, 3, 4
  assert.equal(isClosed(), true);
  assert.equal(copied[0], ["", "fourth line here", "fifth line target"].join("\n"));
}
{
  // v (char visual) + viw + o + y
  const { state, ops, copied } = runCm(sample);
  press(state, ops, "ggwviwy");
  assert.equal(copied[0], "beta_two");
}
{
  // Operator-pending yank: yw, yiw, yy, 2yy
  const a = runCm(sample);
  press(a.state, a.ops, "ggyiw");
  assert.equal(a.copied[0], "alpha");

  const b = runCm(sample);
  press(b.state, b.ops, "gg2yy");
  assert.equal(b.copied[0], `${sample[0]}\n${sample[1]}`);
}
{
  // Search /target<Enter> + n + N + { } paragraph jumps + Esc two-step
  const { state, ops, isClosed } = runCm(sample);
  press(state, ops, "gg/line");
  handleCopyKey(state, ev("enter"), 10, ops);
  assert.equal(state.row, 3);
  press(state, ops, "n");
  assert.equal(state.row, 4);
  press(state, ops, "{");
  assert.equal(state.row, 2);
  press(state, ops, "v");
  assert.equal(state.mode, "visual");
  handleCopyKey(state, ev("escape"), 10, ops);
  assert.equal(state.mode, "normal");
  assert.equal(isClosed(), false);
  // Second Esc in normal mode closes copy mode
  handleCopyKey(state, ev("escape"), 10, ops);
  assert.equal(isClosed(), true);
}
{
  const { state, ops, isClosed } = runCm(sample);
  press(state, ops, "q");
  assert.equal(isClosed(), true);
}
{
  const { state, ops, isClosed } = runCm(sample);
  handleCopyKey(state, ev("c", { modifiers: { control: true } }), 10, ops);
  assert.equal(isClosed(), true);
}

// Check FZF_PROJECT_SCRIPT syntax, WSL host discovery paths, and Tab-switching output parsing
assert.ok(FZF_PROJECT_SCRIPT.includes("WSLInterop"), "detects WSL for Windows host projects");
assert.ok(FZF_PROJECT_SCRIPT.includes("/mnt/c/Users/$win_user"), "scans Windows host home on WSL");
assert.ok(FZF_PROJECT_SCRIPT.includes("$win_dir/Projects"), "scans Windows host Projects on WSL");
assert.ok(FZF_PROJECT_SCRIPT.includes("$win_dir/Organizations"), "scans Windows host Organizations on WSL");
assert.ok(FZF_PROJECT_SCRIPT.includes("--expect=tab,btab"), "supports Tab/Shift-Tab machine switching in fzf");
assert.ok(FZF_PROJECT_SCRIPT.includes("--print-query"), "preserves typed search query across tabs");
assert.ok(FZF_PROJECT_SCRIPT.includes('--query="$init_q"'), "pre-fills carried search query");
assert.ok(FZF_PROJECT_SCRIPT.includes('"$rc" -eq 1'), "allows rc=1 so Tab carries query even with 0 matches");
execFileSync("sh", ["-n", "-c", FZF_PROJECT_SCRIPT]);
const awkOnly = FZF_PROJECT_SCRIPT.replace(/if \[ "\$multi_m"[\s\S]*/, 'printf "%s\\n" "$formatted"');
const awkOut = execFileSync("sh", ["-c", awkOnly, "sh", "/tmp/noop", `${os.homedir()}/linuxDots\n${os.homedir()}/projects`, "Herdr> ", "1", ""], { encoding: "utf8" });
assert.ok(awkOut.includes("~/linuxDots  \x1b[32m●\x1b[0m\t"), "marks open spaces with green dot and tab-delimited real path");

assert.deepEqual(parseFzfOutput("", true), { action: "cancel", query: "" });
assert.deepEqual(parseFzfOutput("__NO_FZF__\n", true), { action: "no_fzf", query: "" });
assert.deepEqual(parseFzfOutput("aura\ntab\n~/linuxDots\t/home/h/linuxDots\n", true), { action: "tab", delta: 1, query: "aura" });
assert.deepEqual(parseFzfOutput("aura\ntab\n", true), { action: "tab", delta: 1, query: "aura" });
assert.deepEqual(parseFzfOutput("\ntab\n~/linuxDots\t/home/h/linuxDots\n", true), { action: "tab", delta: 1, query: "" });
assert.deepEqual(parseFzfOutput("foo\nbtab\n", true), { action: "tab", delta: -1, query: "foo" });
assert.deepEqual(parseFzfOutput("lin\n\n~/linuxDots  ●\t/home/h/linuxDots\n", true), { action: "pick", path: "/home/h/linuxDots", query: "lin" });
assert.deepEqual(parseFzfOutput("~/linuxDots  ●\t/home/h/linuxDots\n", false), { action: "pick", path: "/home/h/linuxDots", query: "" });

const winPs = buildWinFzfScript({
  outFile: "C:/Users/husain/.config/herdr-app/data/extras/proj-1.out",
  errFile: "C:/Users/husain/.config/herdr-app/data/extras/proj-1.err",
  fzfBin: "C:/Users/husain/scoop/shims/fzf.exe",
  openDirs: ["C:/Users/husain/projects/foo"],
  prompt: "Herdr project> ",
  multiMachine: true,
  initialQuery: 'foo\'b"ar',
});
assert.ok(winPs.includes("Get-Command fzf -CommandType Application"), "resolves fzf executable on Windows");
assert.ok(winPs.includes("--delimiter=\\t"), "uses escaped tab delimiter instead of raw TAB in PowerShell argv");
assert.ok(!winPs.includes("--delimiter=$tab"), "avoids raw TAB char that PowerShell 5.1 fails to quote");
assert.ok(!winPs.includes("--no-height"), "omits --no-height for compatibility with older fzf builds");
assert.ok(winPs.includes("$OutputEncoding = $utf8"), "configures UTF-8 pipeline encoding in PowerShell 5.1");
assert.ok(winPs.includes("--print-query"), "Windows fzf preserves query across Tab");
assert.ok(winPs.includes('\'foo\'\'b\\"ar\''), "safely escapes single and double quotes for PowerShell 5.1 native args");
assert.ok(winPs.includes("C:\\Users\\husain\\.config\\herdr-app\\data\\extras\\proj-1.out"), "uses native Windows backslashes");
assert.ok(!FZF_PROJECT_SCRIPT.includes("--no-height"), "POSIX fzf omits --no-height for older WSL fzf");
assert.ok(FZF_PROJECT_SCRIPT.includes("--delimiter='\\t'"), "POSIX fzf uses escaped tab delimiter");

// 6. Keyboard machine switcher (ctrl-a m) with live fzf-style filtering
const machSrc = fs.readFileSync(path.join(__dirname, "machine.js"), "utf8");
const machBody = machSrc.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
const machCalls = [];
const { buildMachineItems, filterMachineItems, selectMachine } = new Function(
  "run",
  `${machBody}\nreturn { buildMachineItems, filterMachineItems, selectMachine };`,
)((cmd, args) => machCalls.push([cmd, args]));

const mItems = buildMachineItems({
  allMachines: [
    { name: null, layout: "ready" },
    { name: "wsl", layout: "ready" },
    { name: "vps", layout: "unavailable" },
    { name: "dev", layout: "loading" },
  ],
  allSpaces: [
    { id: "home", machine: null, name: "Home", active: false },
    { id: "sp-l1", machine: null, name: "notes", active: false },
    { id: "sp-l2", machine: null, name: "dots", active: true },
    { id: "wsl/sp-1", machine: "wsl", name: "app", active: false },
    { id: "wsl/sp-2", machine: "wsl", name: "api", active: false },
  ],
  byMachine: { "": ["sp-l1", "sp-l2"], wsl: ["wsl/sp-1", "wsl/sp-2"], vps: [] },
  lastByMachine: { wsl: "wsl/sp-2" },
  homeId: "home",
});
assert.deepEqual(mItems.map((x) => x.label), ["local", "dev", "vps", "wsl"], "lists local + remotes");
assert.equal(mItems[0].active, true);
assert.equal(mItems[0].connected, true);
assert.equal(mItems[0].targetSpaceId, "sp-l1");
assert.equal(mItems[1].connected, false, "loading machine is not yet ready");
assert.equal(mItems[1].state, "loading");
assert.equal(mItems[2].connected, false, "unavailable machine is marked disconnected");
assert.equal(mItems[2].state, "unavailable");
assert.equal(mItems[2].targetSpaceId, null, "empty remote has no target space");
assert.equal(mItems[3].connected, true, "ready machine shows connected");
assert.equal(mItems[3].targetSpaceId, "wsl/sp-2", "returns to last active space on wsl");
assert.equal(mItems[3].count, 2);

assert.deepEqual(filterMachineItems(mItems, "").map((x) => x.label), ["local", "dev", "vps", "wsl"]);
assert.deepEqual(filterMachineItems(mItems, "wl").map((x) => x.label), ["wsl"], "fuzzy-matches machine name");
assert.deepEqual(filterMachineItems(mItems, "api").map((x) => x.label), ["wsl"], "matches open space names on machine");
assert.deepEqual(filterMachineItems(mItems, "loc").map((x) => x.label), ["local"], "matches local machine");

selectMachine(mItems[3]);
assert.deepEqual(machCalls.pop(), ["space.select", { id: "wsl/sp-2" }]);
selectMachine(mItems[2]);
assert.deepEqual(machCalls.pop(), ["space.new", { machine: "vps" }]);
selectMachine({ ...mItems[0], targetSpaceId: null });
assert.deepEqual(machCalls.pop(), ["space.new", { machine: "" }]);

console.log("ok: extras fzf project picker + machine switcher + worktree slots + auto keys.custom.json merge + vim copy mode");
