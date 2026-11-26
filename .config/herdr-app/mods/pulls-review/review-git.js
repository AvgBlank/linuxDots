// What the Review bar counts and the Review page's scope menu lists, read from git. Read-only: nothing here writes under .git.
import { exec } from "herdr";

// Keep these reads from updating the repository's index or filesystem-monitor state.
export const git = (cwd, args) => exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", ...args], { cwd });
// The files the pane lists for the working tree, as the daemon's worktreeDiff reads them: HEAD to the working tree, net,
// new files marked intent-to-add in a throwaway copy of the index so a moved file pairs up as one rename.
const NET = `d=$(mktemp -d) && trap 'rm -rf "$d"' EXIT && { cp "$(git rev-parse --git-path index)" "$d/i" 2>/dev/null; export GIT_INDEX_FILE="$d/i"; } && `
  + "git --no-optional-locks -c core.fsmonitor=false add -N -- . && git --no-optional-locks -c core.fsmonitor=false diff -M --name-only -z HEAD --";
// Status counts a file staged then edited back, which the pane shows no diff for, and a moved file as two: `lines`, status's
// count, stands only where the net read can't run.
export async function changedFiles(root, lines) {
  if (!lines) return 0;
  const net = await exec("sh", ["-c", NET], { cwd: root }).catch(() => null);
  // shortcut: no sh (Windows) or no commit yet falls back to status's count; follow the daemon's empty-tree base if that matters.
  return net?.code === 0 ? net.stdout.split("\0").filter(Boolean).length : lines;
}

const browserPath = page => encodeURI(page).replaceAll("#", "%23");

// The page the CLI opens for `args` (its pageFor), `branch` standing in for its default-branch lookup: what the bar knows without git.
export const argPage = (args, branch) => browserPath(args[0] === "--worktree" ? "/worktree"
  : args[0] ? `/${args[0].includes("...") ? "compare" : "commit"}/${args[0]}` : `/branch/${branch}`);

/** The counts for the repository at `cwd`: { root, branch, upstream, base, baseRef, changed, ahead, behind, unmerged, newer, gone }, or null outside one. */
export async function readReview(cwd) {
  const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return null;
  // File by file, as the page it opens lists them: plain status folds a new folder into one line.
  const root = top.stdout.trim(), status = await git(root, ["status", "--porcelain=v2", "--branch", "--untracked-files=all"]);
  if (status.code !== 0) return null;
  const review = { root, branch: null, upstream: null, base: null, baseRef: null, changed: 0, ahead: 0, behind: 0, unmerged: 0, newer: 0, gone: false };
  let ab = false, lines = 0;
  for (const line of status.stdout.split("\n")) {
    if (line.startsWith("# branch.head ")) review.branch = line.slice(14);
    else if (line.startsWith("# branch.upstream ")) review.upstream = line.slice(18);
    else if (line.startsWith("# branch.ab ")) { ab = true; [review.ahead, review.behind] = line.slice(12).split(" ").map(n => Math.abs(parseInt(n, 10)) || 0); }
    else if (line && !line.startsWith("#")) lines++;
  }
  review.changed = await changedFiles(root, lines);
  // git leaves out branch.ab when the upstream is set but gone, as after a merged PR's branch is deleted.
  review.gone = Boolean(review.upstream) && !ab;
  // The default branch as the CLI resolves it (resolveDefaultBranch): origin/HEAD, else main or master.
  const originHead = (await git(root, ["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"])).stdout.trim();
  const names = originHead ? [originHead.replace(/^origin\//, "")] : ["main", "master"];
  for (const ref of names.flatMap(name => [`origin/${name}`, name])) {
    const count = await git(root, ["rev-list", "--left-right", "--count", `${ref}...HEAD`]);
    if (count.code !== 0) continue; // No such ref.
    // `base` is the branch name; `baseRef` is what was compared, named in the label so a fork's stale origin/main reads as itself.
    review.base = ref.replace(/^origin\//, "");
    review.baseRef = ref;
    // On the default branch or a detached HEAD the CLI opens its ref picker instead: nothing to show.
    if (review.branch !== review.base && review.branch !== "(detached)") {
      [review.newer, review.unmerged] = count.stdout.trim().split(/\s+/).map(n => parseInt(n, 10) || 0);
      // A branch tracking the default branch: its ↑ is the same commits as N ahead of base.
      if (review.upstream === `origin/${review.base}`) review.ahead = 0;
    }
    break;
  }
  return review;
}

// Read on demand (a menu's opening), so the bar's poll stays cheap.
// shortcut: the newest 200 commits and 20 branches, so search can't reach past them; read more if a repo needs it.
// `unpushed`: the shas not on the upstream, for the menus' ↑.
export async function readPicks(r) {
  const [read, ahead] = await Promise.all([
    // log.showSignature would add lines of its own.
    git(r.root, ["log", "-200", "--no-show-signature", "--format=%H%x1f%s%x1f%ct%x1f%an", r.unmerged ? `${r.baseRef}..HEAD` : "HEAD"]),
    // All of them: a menu commit can be past the first 200 to push, and one missing here reads as pushed.
    r.upstream && !r.gone ? git(r.root, ["rev-list", `${r.upstream}..HEAD`]) : { code: 0, stdout: "" },
  ]);
  const commits = read.stdout.split("\n").filter(Boolean).map(line => { const [sha, subject, time, author] = line.split("\x1f"); return { sha, subject, time: Number(time) * 1000, author }; });
  const unpushed = ahead.code === 0 ? ahead.stdout.split("\n").filter(Boolean) : [];
  if (!r.baseRef) return { commits, branches: [], unpushed };
  // Each branch's last commit, upstream and worktree, and how far it is ahead of and behind the base, in the same call.
  // %(ahead-behind) is Git 2.41's: an older Git fails it, and the menu goes without counts.
  const fields = "%(refname:short)%1f%(contents:subject)%1f%(committerdate:unix)%1f%(authorname)%1f%(upstream:short)%1f%(upstream:track,nobracket)%1f%(worktreepath)";
  const refs = (format) => git(r.root, ["for-each-ref", "--sort=-committerdate", "--count=21", `--no-merged=${r.baseRef}`, `--format=${format}`, "refs/heads"]);
  let listed = await refs(`${fields}%1f%(ahead-behind:${r.baseRef})`);
  if (listed.code !== 0) listed = await refs(fields);
  const branches = listed.stdout.split("\n").map(line => line.split("\x1f")).filter(([name]) => name && name !== r.branch).slice(0, 20)
    .map(([name, subject, time, author, upstream, track, worktree, ab]) => {
      const [count, behind] = (ab ?? "").split(" ").map(n => parseInt(n, 10) || 0);
      return { name, subject, time: Number(time) * 1000, author, upstream, track, worktree, ...(ab === undefined ? {} : { count, behind }) };
    });
  return { commits, branches, unpushed };
}

// shortcut: the 200 most recently committed branches, so search can't reach past them; read more if a repo needs it.
/** The local and remote branches, newest first, for the Review page's base picker: [{ name, remote }], `remote` null for a local one. */
export async function readRefs(root) {
  const read = await git(root, ["for-each-ref", "--sort=-committerdate", "--count=200", "--format=%(refname)", "refs/heads", "refs/remotes"]);
  return read.code !== 0 ? [] : read.stdout.split("\n").map(full => full.split("/"))
    // A remote's HEAD is only a name for its default branch, listed already.
    .filter(parts => parts.length > 2 && parts.at(-1) !== "HEAD")
    .map(([, kind, ...rest]) => ({ name: rest.join("/"), remote: kind === "remotes" ? rest[0] : null }));
}
