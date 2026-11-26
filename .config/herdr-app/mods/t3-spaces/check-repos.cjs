const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const kit = require("./check-kit.js"), { plain } = kit;
const source = kit.bundle((file) => fs.readFileSync(path.join(__dirname, file), "utf8"), "repos.js");
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(setImmediate); };
const status = ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch", "--untracked-files=no"];
const space = (id, folder, machine = null) => ({ id, folder, machine, tabs: [{ id: `b-${id}` }] });

// The same Herdr operations as the sidebar fake, with a clock and waits the test controls.
function fixture(spaces = [space("s0", "/work/s0"), space("s1", "/work/p1"), space("s2", "/work/s2", "vps")]) {
  const snapshot = { spaces, panes: [], machines: [{ name: null, layout: "ready" }, { name: "vps", layout: "ready" }], active: false, visible: true, folded: new Set() };
  const commands = [], watches = [], errors = [];
  let now = 1000000, answer = (_cmd, args, { cwd }) => {
    const top = cwd.split("/").slice(0, 3).join("/");
    return { code: 0, stderr: "", stdout: args.includes("status") ? "# branch.head x\n" : `${top}\n${top}/.git\n` };
  };
  const cx = { notify() {}, spawn(fn) { fn(cx).catch(e => errors.push(e)); } };
  const adapter = {
    cx,
    exec: (cmd, args, options) => { commands.push([cmd, [...args], { ...options }]); return Promise.resolve().then(() => answer(cmd, args, options)); },
    watchFolder(dir) {
      let finish;
      const wait = new Promise(resolve => {
        const watch = { dir, resolve: paths => { watches.splice(watches.indexOf(watch) >>> 0, 1); resolve(paths); } };
        watches.push(watch); finish = watch.resolve;
      });
      wait.cancel = () => finish([]);
      return wait;
    },
  };
  const scope = vm.createContext({ Date: { now: () => now } });
  vm.runInContext(source, scope, { filename: "repos.js" });
  const repos = scope.repoFacts(adapter);
  return {
    snapshot, repos, commands, watches,
    answer: fn => { answer = fn; },
    update(at = now) { now = at; repos.update(snapshot, now); },
    // A new list each ask, as panes() gives (project.js indexes each list once).
    fact: s => plain(repos.forSpace(s, [...snapshot.panes])),
    looks: () => commands.filter(([, args]) => args.includes("status")).map(([, , { cwd, on }]) => [on, cwd]),
    wake(dir) { for (const watch of [...watches]) if (watch.dir === dir) watch.resolve([]); },
    async flush() { await flush(); assert.deepEqual(errors, []); },
  };
}

async function check() {
  {
    const s = space("s", "/work/main"), f = fixture([s]);
    const other = fixture([space("other", "/work/main")]);
    other.update(); await other.flush();
    for (let i = 0; i < 65; i++) {
      f.update(); await f.flush();
      assert.equal(f.watches.length, 1, "reopening has exactly one wait");
      f.snapshot.spaces = []; f.update();
      assert.equal(f.watches.length, 0, "closing a silent repo immediately cancels its pending wait");
      await f.flush();
      assert.equal(other.watches.length, 1, "another subscriber to the same folder stays alive");
      f.snapshot.spaces = [s];
    }
    f.update(); await f.flush();
    f.repos.close();
    assert.equal(f.watches.length, 0, "closing the view releases its waits too");
    await f.flush();
    assert.equal(f.watches.length, 0, "cancel does not restart a loop");
  }
  {
    const f = fixture([space("s", "/work/main")]);
    let finish;
    f.answer(() => new Promise(resolve => { finish = resolve; }));
    f.update(); await f.flush();
    f.snapshot.spaces = []; f.update();
    finish({ code: 0, stdout: "# branch.head main\n", stderr: "" });
    await f.flush();
    assert.equal(f.watches.length, 0, "a read for a closed repo cannot install a late watch");
    assert.equal(f.commands.length, 1, "a closed repo needs no further probes");
    f.answer((_cmd, args) => ({ code: 0, stderr: "", stdout: args.includes("status") ? "# branch.head main\n" : "/work/main\n/work/main/.git\n" }));
    f.snapshot.spaces = [space("s", "/work/main")]; f.update(); await f.flush();
    assert.equal(f.watches.length, 1, "reopening after an abandoned first read probes and watches again");
  }
  {
    // One queue per machine; a place is asked only once while waiting.
    const f = fixture(), [s0, s1, s2] = f.snapshot.spaces;
    f.snapshot.spaces.unshift(f.snapshot.spaces.pop());
    let open, back;
    const hold = new Promise(resolve => { open = resolve; });
    const away = new Promise(resolve => { back = resolve; });
    f.answer(async (_cmd, args, { cwd, on }) => {
      if (on) await away;
      if (args.includes("status")) await hold;
      const top = cwd.split("/").slice(0, 3).join("/");
      return { code: 0, stderr: "", stdout: args.includes("status") ? "# branch.head x\n" : `${top}\n${top}/.git\n` };
    });
    for (let i = 0; i < 3; i++) { f.update(); await f.flush(); }
    assert.deepEqual(f.looks(), [["vps", "/work/s2"], [null, "/work/s0"]], "the next local place waits for its queue; polls cannot duplicate a read");
    assert.deepEqual(f.fact(s1), { git: null, answered: false }, "still asking");
    open();
    await f.flush();
    f.update();
    await f.flush();
    assert.equal(f.looks().filter(([, dir]) => dir === "/work/s0").length, 1, "the first look isn't asked for again while it runs");
    assert.equal(f.fact(s0).answered, true, "a machine that doesn't answer holds up only its own");
    assert.equal(f.fact(s2).answered, false);
    back();
    await f.flush();
    assert.equal(f.fact(s2).answered, true);
    for (const s of [s0, s1, s2]) {
      const commands = f.commands.filter(([, , o]) => o.cwd === s.folder);
      assert.deepEqual(commands, [
        ["git", status, { cwd: s.folder, on: s.machine }],
        ["git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], { cwd: s.folder, on: s.machine }],
      ], "all git arguments and the target machine survive extraction");
    }
    assert.deepEqual(f.watches.map(w => w.dir), ["/work/s0/.git", "/work/p1/.git"], "remote repos never enter the local watch");

    // Forget closed places, keep a watch through cd, and reject an older watch loop.
    f.update();
    f.snapshot.spaces.splice(f.snapshot.spaces.indexOf(s1), 1);
    f.update();
    const pane = { pane: "p0", terminal: "t0", tab: "b-s0", cwd: s0.folder, program: { shell: true } };
    f.snapshot.panes.push(pane);
    for (const dir of ["/work/s0/d1", "/work/s0/d2"]) { pane.cwd = dir; f.update(); await f.flush(); }
    f.update();
    assert.equal(f.watches.filter(w => w.dir === "/work/s0/.git").length, 1, "a cd within the repo keeps its one watch");
    f.commands.splice(0);
    f.wake("/work/s0/.git");
    await f.flush();
    assert.deepEqual(f.looks(), [[null, "/work/s0/d2"]], "one commit, one look, only at the current folder");
    f.commands.splice(0);
    f.wake("/work/p1/.git");
    await f.flush();
    assert.deepEqual(f.looks(), [], "a commit in the closed repo looks at nothing");
    assert.ok(!f.watches.some(w => w.dir === "/work/p1/.git"), "the closed repo's loop ends");
    f.snapshot.spaces.push(s1);
    f.update();
    await f.flush();
    f.snapshot.spaces.pop();
    f.update();
    f.snapshot.spaces.push(s1);
    f.update();
    await f.flush();
    assert.equal(f.watches.filter(w => w.dir === "/work/p1/.git").length, 1, "the old watch is cancelled before reopening");
    f.commands.splice(0);
    f.wake("/work/p1/.git");
    await f.flush();
    assert.deepEqual(f.looks(), [[null, "/work/p1"]], "only the new watch can schedule a read");
    assert.equal(f.watches.filter(w => w.dir === "/work/p1/.git").length, 1, "the old loop ends, so changes aren't looked at twice");

    // A 60 second fallback, only while the list and machine are in view.
    f.snapshot.active = true;
    f.commands.splice(0);
    f.update(1059000);
    await f.flush();
    assert.deepEqual(f.looks(), [], "the fallback waits a minute");
    f.update(1061000);
    await f.flush();
    assert.deepEqual(f.looks(), [["vps", "/work/s2"], [null, "/work/s0/d2"], [null, "/work/p1"]], "editor changes are checked again after 60 seconds");
    for (const [field, value, reason] of [["visible", false, "under Inbox or the hidden sidebar"], ["active", false, "a background window"]]) {
      f.snapshot[field] = value;
      f.commands.splice(0);
      f.update(1122000);
      await f.flush();
      assert.deepEqual(f.looks(), [], reason);
      f.snapshot[field] = true;
    }
    f.snapshot.folded.add(null);
    f.commands.splice(0);
    f.update(1122000);
    await f.flush();
    assert.deepEqual(f.looks(), [["vps", "/work/s2"]], "a folded machine waits");
    f.snapshot.folded.clear();
    f.commands.splice(0);
    f.update(1122000);
    await f.flush();
    assert.deepEqual(f.looks(), [[null, "/work/s0/d2"], [null, "/work/p1"]], "back in view, including a list docked alone");
  }
  {
    // Only not-a-repository is a lasting no; other failures must be asked again.
    const f = fixture([space("s", "/work/s")]);
    f.snapshot.active = true;
    f.answer(() => ({ code: 128, stdout: "", stderr: "fatal: unsafe repository" }));
    f.update();
    await f.flush();
    assert.deepEqual(f.fact(f.snapshot.spaces[0]), { git: null, answered: true });
    f.commands.splice(0);
    f.update(1059000);
    await f.flush();
    assert.deepEqual(f.looks(), []);
    f.update(1061000);
    await f.flush();
    assert.deepEqual(f.looks(), [[null, "/work/s"]], "a git failure other than not-a-repository is asked again");
    f.answer(() => ({ code: 128, stdout: "", stderr: "fatal: not a git repository" }));
    f.update(1122000);
    await f.flush();
    f.commands.splice(0);
    f.update(1183000);
    await f.flush();
    assert.deepEqual(f.looks(), [], "a confirmed non-repository isn't polled");
  }
  {
    // Unknown, transient failure and a confirmed no have different trusted results.
    const s = space("s", "/work/main"), f = fixture([s]);
    f.snapshot.panes.push({ pane: "p", terminal: "t", tab: "b-s", cwd: s.folder, program: { shell: true } });
    f.update();
    await f.flush();
    const known = f.fact(s).git;
    const pane = f.snapshot.panes[0];
    pane.cwd = "/work/main/src";
    assert.deepEqual(f.fact(s), { git: known, answered: false }, "a cd keeps the last trusted result before the new place answers");
    f.update();
    await f.flush();
    assert.deepEqual(f.fact(s), { git: known, answered: true }, "the same repo answers without changing the fact");
    pane.cwd = "/away";
    f.answer(() => { throw new Error("machine is away"); });
    f.update();
    await f.flush();
    assert.deepEqual(f.fact(s), { git: known, answered: true }, "an exec failure keeps the last result");
    pane.cwd = "/unsafe";
    f.answer(() => ({ code: 128, stdout: "", stderr: "fatal: unsafe repository" }));
    f.update();
    await f.flush();
    assert.deepEqual(f.fact(s), { git: known, answered: true }, "a non-repository error isn't a trusted no");
    pane.cwd = "/tmp";
    f.answer(() => ({ code: 128, stdout: "", stderr: "fatal: not a git repository" }));
    f.update();
    await f.flush();
    assert.deepEqual(f.fact(s), { git: null, answered: true }, "a confirmed no releases the old repo");
    f.snapshot.spaces.pop();
    f.update();
    f.snapshot.spaces.push(s);
    pane.cwd = "/away-again";
    assert.deepEqual(f.fact(s), { git: null, answered: false }, "a returning space keeps its last trusted answer");
  }
  {
    // A remote repo with the same path cannot keep a former local watch alive.
    const local = space("local", "/work/main"), remote = space("remote", "/work/main", "vps"), f = fixture([local, remote]);
    f.update();
    await f.flush();
    f.snapshot.spaces.shift();
    f.update();
    f.commands.splice(0);
    f.wake("/work/main/.git");
    await f.flush();
    assert.deepEqual(f.looks(), []);
    assert.deepEqual(f.watches, [], "remote facts cannot retain a local watch");
  }
  {
    // A turn/program ending refreshes every worktree in its repo; a returning machine re-asks its places.
    const main = space("main", "/work/main"), linked = space("linked", "/work/linked"), f = fixture([main, linked]);
    const pane = { pane: "p", terminal: "t", tab: "b-main", cwd: main.folder, status: "working", program: { agent: true } };
    f.snapshot.panes.push(pane);
    f.answer((_cmd, args, { cwd }) => ({ code: 0, stderr: "", stdout: args.includes("status") ? "# branch.head feature\n# branch.ab +2 -1\n" : `${cwd}\n/work/main/.git\n` }));
    f.update();
    await f.flush();
    assert.deepEqual(f.fact(main).git, { name: "main", branch: "feature", ahead: 2, behind: 1, repo: '[null,"/work/main/.git"]', linked: false });
    assert.equal(f.fact(linked).git.linked, true);
    for (const program of [{ agent: true }, { shell: true }]) {
      pane.program = {};
      f.update();
      pane.status = "idle";
      pane.program = program;
      f.commands.splice(0);
      f.update();
      await f.flush();
      assert.deepEqual(f.looks(), [[null, "/work/main"], [null, "/work/linked"]], "completion refreshes the whole repo");
    }
    f.snapshot.machines[0].layout = "unavailable";
    f.update();
    f.snapshot.machines[0].layout = "ready";
    f.commands.splice(0);
    f.update();
    await f.flush();
    assert.deepEqual(f.looks(), [[null, "/work/main"], [null, "/work/linked"]], "a machine back re-asks its places");
    const other = fixture([main]);
    assert.deepEqual(other.fact(main), { git: null, answered: false }, "Spaces copies never share facts or queues");
  }
  {
    // A look runs four times a second: each space is placed from its own panes, not by walking every pane for every space.
    const list = Array.from({ length: 20 }, (_, i) => space(`s${i}`, `/work/s${i}`)), f = fixture(list);
    let asked = 0;
    f.snapshot.panes = list.map((s, i) => ({ pane: `p${i}`, terminal: `t${i}`, get tab() { asked++; return `b-${s.id}`; }, cwd: `/work/s${i}/src`, program: { shell: true } }));
    f.update();
    assert.ok(asked <= 4 * list.length, `a look asks each pane's tab a few times, not once per space: ${asked} for ${list.length} panes`);
    await f.flush();
    assert.deepEqual(f.looks().at(-1), [null, "/work/s19/src"], "and still finds where each space is");
  }
  {
    // A failed or malformed rev-parse never records an empty repo or starts a watch on "", and retries as unsure.
    const s = space("s", "/work/s"), f = fixture([s]);
    f.snapshot.active = true;
    let at = 1000000;
    for (const bad of [
      { code: 128, stdout: "", stderr: "fatal: error" },
      { code: 0, stdout: "", stderr: "" },
      { code: 0, stdout: "/work/s\n", stderr: "" },
      { code: 0, stdout: "\n/work/s/.git\n", stderr: "" },
      { code: 0, stdout: "/work/s\n\n/work/s/.git\n", stderr: "" },
      { code: 0, stdout: "/work/s\n/work/s/.git\nextra\n", stderr: "" },
    ]) {
      f.answer((_cmd, args) => args.includes("status") ? { code: 0, stderr: "", stdout: "# branch.head main\n" } : bad);
      f.commands.splice(0);
      f.update(at);
      await f.flush();
      assert.deepEqual(f.fact(s), { git: null, answered: true }, "malformed rev-parse stores no empty repo fact");
      assert.deepEqual(f.watches, [], "malformed rev-parse never watches an empty path");
      at += 61000;
    }
    f.answer((_cmd, args) => ({ code: 0, stderr: "", stdout: args.includes("status") ? "# branch.head main\n" : "/work/s\n/work/s/.git\n" }));
    f.commands.splice(0);
    f.update(at);
    await f.flush();
    assert.deepEqual(f.looks(), [[null, "/work/s"]], "marked unsure, it retries on fallback");
    assert.equal(f.fact(s).git.repo, '[null,"/work/s/.git"]');
    assert.deepEqual(f.watches.map(w => w.dir), ["/work/s/.git"]);
  }
  console.log("ok: repository facts, per-machine queues, trusted results, retries, local watches and fallback.");
}

check().catch(e => { console.error(e); process.exit(1); });
