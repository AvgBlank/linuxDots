// T3's original icon shapes; hue comes from this layout's theme, never a fixed light/dark palette.
import { svg } from "gpui-kit";
import { PIERRE_NAMES, PIERRE_EXTENSIONS } from "./pierre-icons-data.js";

const COLOR = Object.fromEntries([
  ["ansi1", "pdf video image ruby git npm angular svelte sass"],
  ["ansi2", "spreadsheet vue excel bash node python"],
  ["ansi3", "javascript json babel yml yaml terraform zip slides font"],
  ["ansi4", "typescript word markdown css go java cpp csharp dart docker powershell toml text"],
  ["ansi5", "react elixir haskell kotlin php graphql"],
  ["ansi6", "database sql xml swift lua wasm astro"],
].flatMap(([color, names]) => names.split(" ").map(name => [name, color])));

export function pierreIconFile(path) {
  const name = path.split("/").at(-1).toLowerCase();
  if (Object.hasOwn(PIERRE_NAMES, name)) return PIERRE_NAMES[name];
  const parts = name.split(".");
  for (let i = 1; i < parts.length; i++) { const ext = parts.slice(i).join("."); if (Object.hasOwn(PIERRE_EXTENSIONS, ext)) return PIERRE_EXTENSIONS[ext]; }
  return "file-tree-builtin-default";
}

export function pierreFileIcon(t, mod, path, size = 16) {
  const file = pierreIconFile(path), token = file.replace(/^(file-tree-builtin-|t3-file-icon-)/, "");
  return svg(`${mod}/icons/pierre/${file}.svg`).size(size).flex_none().text_color(t[COLOR[token]] ?? t.dim);
}
