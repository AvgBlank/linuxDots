// The data of the Worktrees section, without Herdr or git, so that it can be tested.

const field = (line) => {
  const at = line.indexOf(" ");
  return at < 0 ? [line, ""] : [line.slice(0, at), line.slice(at + 1)];
};

// The output of `git worktree list --porcelain`: one item per checkout that can be read.
// A bare repository has no files, and a prunable worktree's folder is gone.
export function parseWorktrees(text) {
  return text.split(/\n\n+/).flatMap((block) => {
    const fields = new Map(block.split("\n").filter(Boolean).map(field));
    if (!fields.has("worktree") || fields.has("bare") || fields.has("prunable")) return [];
    const path = fields.get("worktree"), head = fields.get("HEAD") ?? "";
    return [{
      path,
      name: path.replace(/\/+$/, "").split("/").pop(),
      branch: fields.get("branch")?.replace(/^refs\/heads\//, "") ?? `detached ${head.slice(0, 7)}`,
      unborn: /^0+$/.test(head),
    }];
  });
}

// The output of `du -sk <folder>` as whole megabytes, rounded up. Null when it has no number.
export function sizeLabel(text) {
  const match = /^\s*(\d+)/.exec(text);
  return match ? `${Math.ceil(Number(match[1]) / 1024).toLocaleString("en-US")} MB` : null;
}

// The totals of `git diff --numstat -z --no-renames`. A file with "0 0" is only touched: it
// has no change, because the diff does not refresh the index. A binary file ("-") counts as
// a change with no lines.
export function numstatTotals(text) {
  const totals = { add: 0, del: 0, dirty: false };
  for (const entry of text.split("\0")) {
    const [add, del, ...path] = entry.split("\t");
    if (!path.length || (add === "0" && del === "0")) continue;
    totals.add += Number(add) || 0;
    totals.del += Number(del) || 0;
    totals.dirty = true;
  }
  return totals;
}
