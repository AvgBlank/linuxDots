// Standalone counts only: Herdr T3's toggle does not start watchReview.
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const { strip } = require("./check-kit.js");
const waits = [], reads = [];
let cwd = "/a", tick, now = 1000000, held = null;
const env = {
  checking: () => false, closedKey: () => "closed", KEY: {},
  spaces: () => [{ active: true, folder: cwd }], focused: () => ({}), panes: () => [],
  shared: () => null, window: () => ({ active: true }), Date: { now: () => now },
  readReview: async dir => { reads.push(dir); if (held && dir === "/late") return held; return { root: dir }; },
  watchFolder(dir) {
    let finish;
    const wait = new Promise(resolve => {
      const entry = { dir, finish: paths => { waits.splice(waits.indexOf(entry) >>> 0, 1); resolve(paths); } };
      waits.push(entry); finish = entry.finish;
    });
    wait.cancel = () => finish([]);
    return wait;
  },
};
const c = vm.createContext(env);
vm.runInContext(strip(fs.readFileSync(`${__dirname}/bar.js`, "utf8")), c);
const cx = { notify() {}, spawn: fn => fn(cx),
  timer: { every(_ms, fn) { tick = fn; return { cancel() { tick = () => {}; } }; } } };
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(setImmediate); };
(async () => {
  const view = {}; c.watchReview(view, cx);
  tick(cx); await flush();
  assert.equal(waits.length, 1);
  for (let i = 0; i < 65; i++) {
    cwd = `/repo-${i}`; tick(cx);
    assert.equal(waits.length, 0, "leaving a silent repo cancels its wait before reading the next one");
    await flush(); assert.equal(waits.length, 1);
  }
  cwd = "/a"; tick(cx); await flush();
  assert.equal(waits[0]?.dir, "/a", "returning before the fallback is due immediately resumes watching");
  now += 11000; tick(cx); await flush();
  assert.equal(reads.at(-1), cwd, "timer fallback still reads unchanged repos");
  let finish;
  held = new Promise(resolve => { finish = resolve; });
  cwd = "/late"; tick(cx); await flush();
  cwd = "/elsewhere"; tick(cx); await flush();
  finish({ root: "/late" }); held = null; await flush();
  assert.ok(waits.every(w => w.dir !== "/late"), "a late answer cannot watch an old location");
  c.stopReview(view); await flush();
  assert.equal(waits.length, 0, "closing the bar cancels every wait");
  now += 11000; tick(cx); await flush();
  assert.equal(waits.length, 0, "a closed bar stays stopped");
  console.log("ok: standalone Review watch cancellation, late answers and fallback");
})().catch(e => { console.error(e); process.exitCode = 1; });
