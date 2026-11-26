// File menus and Files use the same paths and directory listings.
import { sortEntries } from "./file-tree.js";

/** `a/b`: either may be "" (the space's folder, or a path from it). */
export const join = (a, b) => !a ? b : !b ? a : `${a.replace(/\/$/, "")}/${b}`;

// A folder's entries, NUL-separated kind and name, `.git` left out (as Herdr's files mod lists them).
export const LIST = 'for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; n=${p##*/}; [ "$n" = .git ] && continue; if [ -d "$p" ]; then k=d; else k=f; fi; printf "%s\\0%s\\0" "$k" "$n"; done; test -d "$1"';

// The listing script's output: a kind (d or f) and a name, each ended by NUL; in file-tree.js's order.
export function parseListing(stdout) {
  const fields = stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return sortEntries(out);
}
