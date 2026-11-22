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

const { norm, inside, tilde, baseOf, openProjectDir, REMOTE_LIST } = new Function(
  "spaces", "panes", "run",
  `${projBody}\nreturn { norm, inside, tilde, baseOf, openProjectDir, REMOTE_LIST };`
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

console.log("ok: extras project picker + worktree slots (local/remote, subdir guard, Windows paths, porcelain, REMOTE_LIST)");
