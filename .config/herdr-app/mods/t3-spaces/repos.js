import { placeOf } from "./project.js";

// Where a space is now. `ps`: panes(), read once by the caller (each read copies every pane).
const where = (s, ps) => JSON.stringify([s.machine ?? null, placeOf(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

// One instance per Spaces view; exec, watchFolder and cx are its Herdr adapter.
export function repoFacts({ exec, watchFolder, cx }) {
  const git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
  const lastGit = {}; // space -> its git where it last had an answer; kept for one that's gone, as its machine may bring it back
  const checked = {}; // where() -> when it was last looked at
  const unsure = new Set(); // where()s git couldn't answer for (a machine away)
  const pending = new Set(); // where()s to look at next
  const refreshing = new Set(); // machines being looked at
  let busy = {}; // pane -> an agent working or a program in front of its shell
  const ready = {}; // machine -> its layout was readable at the last look
  let at = {}; // space -> its where() at the last look
  const watching = new Map(); // local repos' git folders -> their watch's own token

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  function due({ spaces: sp, panes: ps, machines, active, visible, folded }, now) {
    // Moved there: what it knew of that place may be old.
    const next = {};
    for (const s of sp) next[s.id] = where(s, ps);
    const keys = new Set(Object.values(next).filter((k) => JSON.parse(k)[1]));
    // Where no space is any more: forgotten, so a commit looks only where spaces are and a repo none is in isn't watched.
    for (const k of Object.keys(git)) if (!keys.has(k)) { delete git[k]; delete checked[k]; unsure.delete(k); }
    // Not while a place is unanswered: a cd within a repo would let it go and watch it again.
    if ([...keys].every((k) => k in git)) {
      const used = new Set(Object.values(git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of watching.keys()) if (!used.has(repo)) watching.delete(repo);
    }
    const due = new Set([...keys].filter((k) => !(k in git) && !(k in checked)));
    for (const [id, k] of Object.entries(next)) if (at[id] && at[id] !== k && keys.has(k)) due.add(k);
    at = next;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const nextBusy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      nextBusy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (busy[p.pane] && !nextBusy[p.pane]) sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    busy = nextBusy;
    for (const m of machines) {
      const readable = m.layout === "ready";
      if (readable && ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      ready[m.name] = readable;
    }
    if (active && visible) {
      for (const k of keys) {
        const asks = git[k] || unsure.has(k);
        if (asks && !folded.has(JSON.parse(k)[0]) && now - (checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  function sameRepo(key, keys) {
    const repo = git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => git[k]?.repo === repo) : [])];
  }

  // One look at a time on each machine, so one that hangs holds up only its own places; each place once however often it was asked for meanwhile.
  function refreshGit(keys, cx) {
    const now = Date.now(), machineOf = (k) => JSON.parse(k)[0];
    for (const k of keys) { pending.add(k); checked[k] = now; }
    for (const on of new Set([...pending].map(machineOf))) {
      if (refreshing.has(on)) continue;
      refreshing.add(on);
      cx.spawn(async (cx) => {
        for (let key; (key = [...pending].find((k) => machineOf(k) === on));) {
          pending.delete(key);
          await check(key, cx);
        }
        refreshing.delete(on);
        cx.notify();
      });
    }
  }

  // One place's git: branch, ahead/behind, its repo.
  async function check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch", "--untracked-files=no"], { cwd, on });
      unsure.delete(key); // Only now: until it answers, what it couldn't say stays unsaid.
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) unsure.add(key);
        git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, branch: null, ahead: 0, behind: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${top.stdout.trim()}/.git` };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      git[key] = info;
      if (!on) watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      git[key] ??= null;
      unsure.add(key);
    }
  }

  function watch(repo, cx) {
    if (watching.has(repo)) return;
    // A wait can't be taken back: a repo let go and watched again has a new loop, and the old one, on waking, ends here.
    const token = {};
    watching.set(repo, token);
    cx.spawn(async (cx) => {
      try {
        while (watching.get(repo) === token) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (watching.get(repo) === token) refreshGit(Object.keys(git).filter((k) => git[k]?.repo === mine), cx);
        }
      } catch { if (watching.get(repo) === token) watching.delete(repo); }
    });
  }

  return {
    update(snapshot, now) {
      const keys = due(snapshot, now);
      if (keys.size) refreshGit(keys, cx);
    },
    forSpace(space, panes) {
      const k = where(space, panes);
      // An unanswered place (a cd just now) keeps the last trusted fact, so a frame cannot scatter its worktrees.
      if (git[k] || (k in git && !unsure.has(k))) lastGit[space.id] = git[k];
      return { git: lastGit[space.id] ?? null, answered: k in git };
    },
  };
}
