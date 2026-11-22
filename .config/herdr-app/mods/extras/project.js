// Native GPUI project picker for extras (ctrl-f): styled like `fzf --layout=reverse --border=none`.
// Works locally on macOS/Linux/Windows via fs/promises and on remote machines (WSL, SSH) via exec(..., { on }).
import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, spaces, panes, machines, terminals, home, appHome, run, hc, exec, openOverlay, closeOverlay, readTextFile, notify, props, shared, setShared, window, settings } from "herdr";
import * as fs from "fs/promises";

const ROW = 24;

export const norm = (p) => (p ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
const inside = (path, folder) => {
  const a = norm(path), b = norm(folder);
  return Boolean(a && b) && (a === b || a.startsWith(`${b}/`));
};
export const tilde = (path, userHome) => {
  const p = norm(path), h = norm(userHome);
  return h && (p === h || p.startsWith(`${h}/`)) ? `~${p.slice(h.length)}` : path;
};
export const baseOf = (path) => norm(path).split("/").pop() || path;

// POSIX remote listing: prints $HOME on line 1, then depth-1 dirs in ~ and ~/projects, and depth-1..2 in ~/organizations.
const REMOTE_LIST = `
printf '%s\\n' "$HOME"
for base in "$HOME" "$HOME/projects"; do
  [ -d "$base" ] || continue
  for d in "$base"/*/ "$base"/.[!.]*/; do
    [ -d "$d" ] && printf '%s\\n' "\${d%/}"
  done
done
if [ -d "$HOME/organizations" ]; then
  for d in "$HOME"/organizations/*/ "$HOME"/organizations/*/*/; do
    [ -d "$d" ] && printf '%s\\n' "\${d%/}"
  done
fi
`;

async function subdirs(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const out = [];
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = `${dir}/${e.name}`;
      if (e.isDirectory()) out.push(full);
      else if (e.isSymbolicLink()) {
        try { if ((await fs.stat(full)).isDirectory()) out.push(full); } catch {}
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function listLocal() {
  const root = norm(home());
  const top = await subdirs(root);
  const SKIP_DOT = new Set([".Trash", ".cache", ".npm", ".yarn", ".cargo", ".rustup", ".gradle", ".nvm", ".vim", ".zsh_sessions", ".zsh-cache", ".DS_Store"]);
  try {
    for (const e of await fs.readdir(root, { withFileTypes: true })) {
      if (!e.name.startsWith(".") || SKIP_DOT.has(e.name)) continue;
      const full = `${root}/${e.name}`;
      if (e.isDirectory()) top.push(full);
      else if (e.isSymbolicLink()) {
        try { if ((await fs.stat(full)).isDirectory()) top.push(full); } catch {}
      }
    }
  } catch {}
  const projects = await subdirs(`${root}/projects`);
  const orgParents = await subdirs(`${root}/organizations`);
  const orgs = (await Promise.all(orgParents.map(subdirs))).flat();
  const dirs = [...new Set([...top, ...projects, ...orgParents, ...orgs].map(norm))].sort((a, b) => a.localeCompare(b));
  return { userHome: root, dirs };
}

async function listRemote(machine) {
  const r = await exec("sh", ["-c", REMOTE_LIST], { on: machine, timeout: 10000 });
  if (r.code !== 0) throw new Error(r.stderr?.trim() || `Couldn't list folders on ${machine}`);
  const lines = r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  const userHome = norm(lines[0] ?? "");
  const SKIP = new Set([".cache", ".npm", ".yarn", ".cargo", ".rustup", ".gradle", ".nvm", ".vim", ".local"]);
  const dirs = [...new Set(lines.slice(1).map(norm).filter((p) => !SKIP.has(baseOf(p))))].sort((a, b) => a.localeCompare(b));
  return { userHome, dirs };
}

// Real fzf project picker matching funcs.zsh (`herdrthing`): scans ~, ~/projects (depth 1),
// ~/organizations (depth 1..2), and on WSL also the Windows host (/mnt/c/Users/<user>, Projects, Organizations).
// Args: $1 = output file, $2 = newline-separated open dirs, $3 = fzf prompt, $4 = "1" for Tab/Shift-Tab switch, $5 = initial query, $6 = error file.
export const FZF_PROJECT_SCRIPT = `
PATH="$HOME/.fzf/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
out="$1"
open_dirs="$2"
prompt="$3"
multi_m="$4"
init_q="$5"
err="$6"
if ! command -v fzf >/dev/null 2>&1; then
  printf '__NO_FZF__\\n' > "$out"
  exit 0
fi
win_dir=""
if [ -f /proc/sys/fs/binfmt_misc/WSLInterop ]; then
  cmd_bin=$(command -v cmd.exe 2>/dev/null || echo /mnt/c/Windows/System32/cmd.exe)
  if [ -x "$cmd_bin" ]; then
    win_user=$(cd /mnt/c 2>/dev/null && "$cmd_bin" /c 'echo %USERNAME%' 2>/dev/null | tr -d '\\r' | tail -n 1)
    [ -n "$win_user" ] && [ -d "/mnt/c/Users/$win_user" ] && win_dir="/mnt/c/Users/$win_user"
  fi
fi
list_dirs() {
  for root in "$HOME" "$HOME/projects" "$win_dir" "\${win_dir:+$win_dir/Projects}"; do
    [ -n "$root" ] && [ -d "$root" ] && find "$root" -mindepth 1 -maxdepth 1 -type d 2>/dev/null
  done
  for root in "$HOME/organizations" "\${win_dir:+$win_dir/Organizations}"; do
    [ -n "$root" ] && [ -d "$root" ] && find "$root" -mindepth 1 -maxdepth 2 -type d 2>/dev/null
  done
}
tab=$(printf '\\t')
formatted=$(
  list_dirs | HERDR_OPEN_DIRS="$open_dirs" awk -v home="$HOME" '
    BEGIN {
      n = split(ENVIRON["HERDR_OPEN_DIRS"], a, "\\n");
      for (i = 1; i <= n; i++) if (a[i] != "") is_open[a[i]] = 1;
    }
    {
      p = $0; sub(/\\/+$/, "", p);
      if (p == "" || seen[p]++) next;
      disp = p;
      if (home != "" && index(p, home "/") == 1) disp = "~" substr(p, length(home) + 1);
      if (is_open[p]) printf "0\\t%s  \\033[32m●\\033[0m\\t%s\\n", disp, p;
      else printf "1\\t%s\\t%s\\n", disp, p;
    }
  ' | LC_ALL=C sort -t "$tab" -k1,1 -k2,2 | cut -f2-
)
if [ "$multi_m" = "1" ]; then
  res=$(printf '%s\\n' "$formatted" | FZF_DEFAULT_OPTS="" FZF_DEFAULT_OPTS_FILE="" fzf --ansi --layout=reverse --border=none --no-multi --delimiter='\\t' --with-nth=1 --print-query --expect=tab,btab --query="$init_q" --prompt="$prompt" 2>"$err")
  rc=$?
else
  res=$(printf '%s\\n' "$formatted" | FZF_DEFAULT_OPTS="" FZF_DEFAULT_OPTS_FILE="" fzf --ansi --layout=reverse --border=none --no-multi --delimiter='\\t' --with-nth=1 --query="$init_q" --prompt="$prompt" 2>"$err")
  rc=$?
fi
if [ "$rc" -eq 0 ] || [ "$rc" -eq 1 ]; then
  rm -f "$err"
  [ -n "$res" ] && printf '%s\\n' "$res" > "$out"
elif [ "$rc" -eq 130 ]; then
  rm -f "$err"
elif [ ! -s "$err" ]; then
  printf 'fzf exited with code %s\\n' "$rc" > "$err"
fi
`;

export function projectTargets() {
  const remotes = machines().filter((m) => m.name && !m.temporary).map((m) => m.name);
  return [null, ...remotes];
}

export function defaultProjectMachine(activeMachine) {
  const targets = projectTargets();
  if (activeMachine && targets.includes(activeMachine)) return activeMachine;
  if (window()?.platform === "windows" && targets.length > 1) return targets[1];
  return null;
}

export function parseFzfOutput(raw, multiMachine) {
  if (!raw) return { action: "cancel", query: "" };
  const text = raw.replace(/\r\n/g, "\n").replace(/\n+$/, "");
  if (!text) return { action: "cancel", query: "" };
  if (text === "__NO_FZF__") return { action: "no_fzf", query: "" };
  if (multiMachine) {
    // With `--print-query --expect=tab,btab`: line 0 = typed query, line 1 = expect key ("" | "tab" | "btab"), line 2 = selected item.
    const lines = text.split("\n");
    const query = lines[0] ?? "";
    const key = lines[1] ?? "";
    const line = lines[2] ?? "";
    if (key === "tab") return { action: "tab", delta: 1, query };
    if (key === "btab") return { action: "tab", delta: -1, query };
    const picked = line.includes("\t") ? line.split("\t")[1] : line;
    return picked ? { action: "pick", path: picked, query } : { action: "cancel", query };
  }
  const picked = text.includes("\t") ? text.split("\t")[1] : text;
  return picked ? { action: "pick", path: picked, query: "" } : { action: "cancel", query: "" };
}

const psStr = (s) => `'${String(s ?? "").replace(/'/g, "''")}'`;
// PowerShell 5.1 drops unescaped double quotes in native executable args; escape them for fzf.exe.
const psNativeStr = (s) => psStr(String(s ?? "").replace(/"/g, '\\"'));
const winPath = (p) => String(p ?? "").replace(/\//g, "\\");

// Native Windows PowerShell + fzf script (used on the Windows `local` tab when `fzf` is installed on Windows PATH).
export function buildWinFzfScript({ outFile, errFile, fzfBin, openDirs, prompt, multiMachine, initialQuery }) {
  const openList = openDirs.map(psStr).join(", ");
  return [
    "$utf8 = [System.Text.UTF8Encoding]::new($false)",
    "$OutputEncoding = $utf8",
    "[Console]::InputEncoding = $utf8",
    "[Console]::OutputEncoding = $utf8",
    `$out = ${psStr(winPath(outFile))}`,
    `$err = ${psStr(winPath(errFile || `${outFile}.err`))}`,
    `$fzfHint = ${psStr(fzfBin ? winPath(fzfBin) : "")}`,
    "try {",
    "  $fzf = if ($fzfHint -and (Test-Path -LiteralPath $fzfHint -PathType Leaf)) { $fzfHint } else { (Get-Command fzf -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source }",
    "  if (-not $fzf) { [System.IO.File]::WriteAllText($out, \"__NO_FZF__`n\", $utf8); exit 0 }",
    "  $homeDir = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }",
    "  $openSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)",
    `  foreach ($o in @(${openList})) { if ($o) { [void]$openSet.Add(($o -replace '\\\\','/').TrimEnd('/')) } }`,
    "  $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)",
    "  $rows = [System.Collections.Generic.List[string]]::new()",
    "  $esc = [char]27; $tab = [char]9",
    "  $hNorm = ($homeDir -replace '\\\\','/').TrimEnd('/')",
    "  function Add-Dir([string]$full) {",
    "    if (-not $full) { return }",
    "    $n = ($full -replace '\\\\','/').TrimEnd('/')",
    "    if (-not $seen.Add($n)) { return }",
    "    $disp = if ($hNorm -and $n.StartsWith(\"$hNorm/\", [System.StringComparison]::OrdinalIgnoreCase)) { '~' + $n.Substring($hNorm.Length) } else { $n }",
    "    if ($openSet.Contains($n)) { $rows.Add(\"0$tab$disp  ${esc}[32m●${esc}[0m$tab$full\") }",
    "    else { $rows.Add(\"1$tab$disp$tab$full\") }",
    "  }",
    "  foreach ($r in @($homeDir, (Join-Path $homeDir 'projects'), (Join-Path $homeDir 'Projects'))) {",
    "    if ($r -and (Test-Path -LiteralPath $r -PathType Container)) { Get-ChildItem -LiteralPath $r -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object { Add-Dir $_.FullName } }",
    "  }",
    "  foreach ($r in @((Join-Path $homeDir 'organizations'), (Join-Path $homeDir 'Organizations'))) {",
    "    if ($r -and (Test-Path -LiteralPath $r -PathType Container)) {",
    "      Get-ChildItem -LiteralPath $r -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {",
    "        Add-Dir $_.FullName",
    "        Get-ChildItem -LiteralPath $_.FullName -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object { Add-Dir $_.FullName }",
    "      }",
    "    }",
    "  }",
    "  $sorted = @($rows | Sort-Object | ForEach-Object { $_.Substring(2) })",
    "  $env:FZF_DEFAULT_OPTS = ''; $env:FZF_DEFAULT_OPTS_FILE = ''",
    `  $fargs = @('--ansi','--layout=reverse','--border=none','--no-multi','--delimiter=\\t','--with-nth=1','--prompt',${psNativeStr(prompt)})`,
    initialQuery ? `  $fargs += @('--query',${psNativeStr(initialQuery)})` : "",
    multiMachine ? "  $fargs += @('--print-query','--expect=tab,btab')" : "",
    "  $res = $sorted | & $fzf @fargs",
    "  $rc = $LASTEXITCODE",
    "  if (($rc -eq 0 -or $rc -eq 1) -and $res) {",
    "    [System.IO.File]::WriteAllText($out, (($res -join \"`n\") + \"`n\"), $utf8)",
    "  } elseif ($rc -ne 0 -and $rc -ne 1 -and $rc -ne 130) {",
    "    [System.IO.File]::WriteAllText($err, \"fzf exited with code $rc ($fzf)\", $utf8)",
    "  }",
    "} catch {",
    "  [System.IO.File]::WriteAllText($err, $_.Exception.Message, $utf8)",
    "}",
  ].filter(Boolean).join("\n");
}

function openGpuiFallback(target, query) {
  openOverlay({ mod: "extras", kind: "dialog", frame: "none", width: 0.7, height: 0.7, props: { projectPicker: true, machine: target, forceLocal: !target, initialQuery: query } });
}

export async function openFzfProjectPicker(activeMachine, cx, explicitTarget, initialQuery = "") {
  const targets = projectTargets();
  const hasRemotes = targets.length > 1;
  const target = explicitTarget !== undefined ? explicitTarget : defaultProjectMachine(activeMachine);
  const query = typeof initialQuery === "string" ? initialQuery : "";
  const isWinLocal = window()?.platform === "windows" && !target;

  // On Windows local, probe `where fzf` first so missing fzf falls back to GPUI immediately without a terminal flash.
  let winFzfBin = "";
  if (isWinLocal) {
    const probe = await exec("where", ["fzf"]).catch(() => ({ code: 1, stdout: "" }));
    winFzfBin = probe.code === 0 ? (probe.stdout || "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "" : "";
    if (!winFzfBin) {
      openGpuiFallback(null, query);
      return;
    }
  }

  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const openDirs = [...existingFolders(target)];
  const prompt = target ? `Herdr project (${target})> ` : "Herdr project> ";
  let outFile, errFile, scriptFile = null;
  const args = ["run", "--bg", "--json", "--rm", "--no-parent"];
  let address;
  try {
    if (isWinLocal) {
      const dir = `${appHome()}/data/extras`;
      await fs.mkdir(dir, { recursive: true });
      outFile = `${dir}/proj-${token}.out`;
      errFile = `${dir}/proj-${token}.err`;
      scriptFile = `${dir}/proj-${token}.ps1`;
      const ps = buildWinFzfScript({ outFile, errFile, fzfBin: winFzfBin, openDirs, prompt, multiMachine: hasRemotes, initialQuery: query });
      // UTF-8 BOM ensures Windows PowerShell 5.1 parses the green dot (●) as UTF-8, not CP1252.
      await fs.writeFile(scriptFile, `\uFEFF${ps}`);
      args.push("--cwd", home(), "--", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", winPath(scriptFile));
    } else {
      outFile = `/tmp/herdr-proj-${token}.out`;
      errFile = `/tmp/herdr-proj-${token}.err`;
      if (target) args.push("--on", target);
      else args.push("--cwd", home());
      args.push("--", "sh", "-c", FZF_PROJECT_SCRIPT, "sh", outFile, openDirs.join("\n"), prompt, hasRemotes ? "1" : "0", query, errFile);
    }

    const r = await hc(args);
    if (r.code !== 0) throw new Error(r.stderr?.trim() || "hc run failed");
    address = JSON.parse(r.stdout).address;
    if (target && address && !address.includes("/")) address = `${target}/${address}`;
  } catch (e) {
    if (scriptFile) fs.unlink(scriptFile).catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`extras project launch failed: ${msg}`);
    notify({ title: "Project picker fallback", body: msg, level: "warning", timeout: 6000 });
    openGpuiFallback(target, query);
    return;
  }

  const layout = hasRemotes
    ? {
        type: "column",
        children: [
          { id: "fzf-tabs", type: "block", size: { px: 34 }, content: { mod: "extras", props: { fzfTabs: true, token, machine: target, targets, terminal: address } } },
          { id: "fzf-term", type: "block", size: { weight: 1 }, content: { terminal: address } },
        ],
      }
    : { type: "block", content: { terminal: address } };

  openOverlay({ kind: "dialog", width: 0.7, height: 0.7, layout });

  // Watch for the fzf popup terminal to exit off the main command loop so other extras keys stay responsive.
  cx.spawn(async (cx) => {
    let seen = false;
    for (let i = 0; i < 40; i++) {
      if (terminals().some((t) => t.address === address)) { seen = true; break; }
      await cx.sleep(50);
    }
    const deadline = Date.now() + 600_000;
    while (seen && Date.now() < deadline && terminals().some((t) => t.address === address)) {
      await cx.sleep(80);
    }

    const [raw, errRaw] = await Promise.all([
      readTextFile(outFile, { on: target }).catch(() => null),
      readTextFile(errFile, { on: target }).catch(() => null),
    ]);
    if (isWinLocal) {
      fs.unlink(outFile).catch(() => {});
      fs.unlink(errFile).catch(() => {});
      if (scriptFile) fs.unlink(scriptFile).catch(() => {});
    } else {
      exec("rm", ["-f", outFile, errFile], { on: target }).catch(() => {});
    }
    const errText = errRaw?.trim();
    const res = parseFzfOutput(raw, hasRemotes);
    const nextQuery = res.query || "";

    // Check if the user clicked a machine tab pill in the top bar (which sent Tab to preserve the typed query).
    const clicked = shared("fzf-tab-switch");
    if (clicked && clicked.token === token) {
      setShared("fzf-tab-switch", null);
      openFzfProjectPicker(clicked.machine, cx, clicked.machine, nextQuery);
      return;
    }

    if (res.action === "no_fzf") {
      openGpuiFallback(target, query);
    } else if (res.action === "tab" && hasRemotes) {
      const idx = targets.indexOf(target);
      const next = targets[(idx + res.delta + targets.length) % targets.length];
      openFzfProjectPicker(next, cx, next, nextQuery);
    } else if (res.action === "pick") {
      openProjectDir(res.path, target);
    } else if (errText) {
      console.log(`extras project error: ${errText}`);
      notify({ title: "Project picker error", body: errText, level: "error", timeout: 10000 });
      openGpuiFallback(target, query);
    }
  });
}

// Clickable machine tab bar rendered above the real fzf terminal when multiple machines exist.
export function renderFzfTabBar() {
  const p = props() || {};
  const t = theme();
  const s = settings();
  const font = s?.font_family || "JetBrains Mono";
  const fontSize = Number(s?.font_size) || 13;
  const targets = Array.isArray(p.targets) ? p.targets : projectTargets();
  const current = p.machine ?? null;

  return h_flex()
    .id("fzf-tab-bar")
    .size_full()
    .px(12)
    .gap(6)
    .items_center()
    .bg(t.chrome || t.surface)
    .border_b(1)
    .border_color(t.border)
    .font_family(font)
    .text_size(fontSize - 1)
    .children(
      targets.map((m) => {
        const on = m === current;
        return div()
          .id(`ft-${m ?? "local"}`)
          .h(22)
          .px(8)
          .flex()
          .items_center()
          .rounded(5)
          .cursor_pointer()
          .bg(on ? t.raised : "#00000000")
          .text_color(on ? (t.ansi4 || t.foreground) : t.dim)
          .when(on, (el) => el.font_medium())
          .hover((st) => st.text_color(t.foreground))
          .on_click(() => {
            if (m === current) return;
            setShared("fzf-tab-switch", { token: p.token, machine: m });
            // Send Tab so fzf exits via --expect=tab and prints the current query to outFile.
            if (p.terminal) hc(["keys", p.terminal, "tab"]).catch(() => hc(["kill", p.terminal]).catch(() => {}));
          })
          .child(m ?? "local");
      }),
    )
    .child(div().flex_1())
    .child(div().text_size(fontSize - 2).text_color(t.dim).child("Tab: machine"));
}

// Match an existing space on `machine` working in `folder`, else create one there.
export function openProjectDir(folder, machine) {
  const target = norm(folder), ps = panes();
  for (const space of spaces()) {
    if ((space.machine ?? null) !== (machine ?? null)) continue;
    const own = norm(space.folder);
    // A space for a project inside this folder is that project's: picking ~/projects isn't picking it.
    if (own && own !== target && inside(own, target)) continue;
    const tabIds = new Set((space.tabs ?? []).map((t) => t.id));
    const dirs = [own, ...ps.filter((p) => tabIds.has(p.tab) && p.cwd).map((p) => norm(p.cwd))];
    if (dirs.some((d) => d && inside(d, target))) {
      return run("space.select", { id: space.id });
    }
  }
  return run("space.new", { folder, ...(machine ? { machine } : {}) });
}

function existingFolders(machine) {
  const ps = panes(), open = new Set();
  for (const s of spaces()) {
    if ((s.machine ?? null) !== (machine ?? null)) continue;
    if (s.folder) open.add(norm(s.folder));
    const tabIds = new Set((s.tabs ?? []).map((t) => t.id));
    for (const p of ps) if (tabIds.has(p.tab) && p.cwd) open.add(norm(p.cwd));
  }
  return open;
}

// Cache directory listings per machine for instant re-opening; still refreshes in background.
const dirCache = new Map();

export function initProjectPicker(view, cx) {
  const p = props();
  const remotes = machines().filter((m) => m.name && !m.temporary).map((m) => m.name);
  view.targets = [null, ...remotes];
  // Default to the active space's machine; on Windows with a remote (e.g. wsl) and no active remote space, prefer the first remote (unless forceLocal).
  const activeMachine = p?.machine || null;
  view.machine = p?.forceLocal ? null
    : activeMachine && view.targets.includes(activeMachine) ? activeMachine
    : (window()?.platform === "windows" && remotes.length ? remotes[0] : null);
  view.at = 0;
  view.filter = typeof p?.initialQuery === "string" ? p.initialQuery : "";
  view.scrollTop = 0;
  view.listH = undefined;
  view.pointerY = undefined;
  view.loading = false;
  view.error = null;
  view.input = InputState.new({ placeholder: "" });
  if (view.filter) view.input.set_value(view.filter);
  view.input.on("change", (_e, cx) => { view.filter = view.input.value(); view.at = 0; view.scrollTop = 0; cx.notify(); });
  view.input.on("submit", () => choose(view, itemsOf(view).items[view.at]));
  view.input.focus();
  loadMachine(view, view.machine, cx);
}

function loadMachine(view, machine, cx) {
  const key = machine ?? "";
  const req = (view.loadSeq = (view.loadSeq ?? 0) + 1);
  view.error = null;
  view.loading = !dirCache.has(key);
  cx.notify();
  cx.spawn(async (cx) => {
    try {
      const data = machine ? await listRemote(machine) : await listLocal();
      dirCache.set(key, data);
      if (view.loadSeq === req) { view.loading = false; view.error = null; cx.notify(); }
    } catch (e) {
      if (view.loadSeq === req) { view.loading = false; view.error = e instanceof Error ? e.message : String(e); cx.notify(); }
    }
  });
}

function itemsOf(view) {
  const key = view.machine ?? "";
  const data = dirCache.get(key);
  const userHome = data?.userHome ?? (view.machine ? "" : norm(home()));
  const open = existingFolders(view.machine);
  const all = new Set(data?.dirs ?? []);
  for (const s of spaces()) {
    if ((s.machine ?? null) === (view.machine ?? null) && s.folder) all.add(norm(s.folder));
  }
  const tokens = view.filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const items = [];
  for (const dir of all) {
    const shown = tilde(dir, userHome);
    const name = baseOf(dir);
    const hay = shown.toLowerCase();
    if (tokens.length && !tokens.every((tok) => hay.includes(tok))) continue;
    const isOpen = [...open].some((d) => inside(d, dir));
    const nameHit = tokens.length ? tokens.every((tok) => name.toLowerCase().includes(tok)) : false;
    items.push({ dir, shown, isOpen, nameHit });
  }
  items.sort((a, b) =>
    Number(b.nameHit) - Number(a.nameHit) ||
    Number(b.isOpen) - Number(a.isOpen) ||
    a.shown.localeCompare(b.shown)
  );
  return { items, total: all.size };
}

function choose(view, item) {
  if (!item) return;
  closeOverlay(props().overlay);
  openProjectDir(item.dir, view.machine);
}

function switchMachine(view, next) {
  if (next === view.machine) return;
  // Hand off to the persistent `extras` block before closing this overlay so async fzf launch isn't cancelled on overlay close.
  setShared("project-switch", { machine: next, query: view.filter });
  closeOverlay(props().overlay);
  run("extras.projectswitch");
}

export function renderProjectPicker(view) {
  const t = theme();
  const s = settings();
  const font = s?.font_family || "JetBrains Mono";
  const fontSize = Number(s?.font_size) || 13;
  const zoom = Number(s?.zoom) || 1;
  const { items, total } = itemsOf(view);
  view.at = Math.min(view.at, Math.max(0, items.length - 1));
  const hasRemotes = view.targets.length > 1;
  const listH = view.listH ?? 480;
  const maxScroll = Math.max(0, items.length * ROW - listH);
  let top = Math.max(0, Math.min(view.scrollTop ?? 0, maxScroll));
  const pointed = view.pointerY === undefined ? -1 : Math.floor((view.pointerY + top) / ROW);
  if (view.at >= 0 && view.at < items.length && view.at !== pointed && view.listH !== undefined) {
    top = Math.max(0, Math.min(top, view.at * ROW, maxScroll), (view.at + 1) * ROW - listH);
  }
  view.scrollTop = top;
  const first = Math.floor(top / ROW), end = Math.min(items.length, Math.ceil((top + listH) / ROW));

  const row = (item, i) => {
    const on = view.at === i;
    return h_flex().id(`proj-${i}`).w_full().h(ROW).px(4).gap(6).items_center().flex_none().cursor_pointer()
      .when(on, (el) => el.bg(t.raised))
      .on_hover((over, cx) => { if (over && view.at !== i) { view.at = i; cx.notify(); } })
      .on_click(() => choose(view, item))
      .child(div().w(12).flex_none().text_color(on ? (t.ansi1 || t.accent) : "#00000000").font_bold().child(">"))
      .child(div().flex_1().min_w(0).truncate()
        .text_color(on ? t.foreground : t.muted)
        .when(on, (el) => el.font_medium())
        .child(item.shown))
      .when(item.isOpen, (el) => el.child(div().flex_none().pr(4).text_size(fontSize - 1).text_color(t.ansi2 || t.done).child("●")));
  };

  const renderedRows = [];
  for (let i = first; i < end; i++) renderedRows.push(row(items[i], i).absolute().left(0).right(0).top(i * ROW - top));

  const promptLabel = view.machine ? `Herdr project (${view.machine})> ` : "Herdr project> ";

  return v_flex().id("project-picker").size_full().min_h(0).p(12).gap(4)
    .rounded(8).border(1).border_color(t.border).bg(t.background).shadow_2xl()
    .font_family(font).text_size(fontSize).line_height(`${ROW}px`)
    .on_key_down((e, cx) => {
      if (e.key === "escape" || (e.modifiers.control && e.key === "c")) return closeOverlay(props().overlay);
      if (e.key === "down" || (e.modifiers.control && (e.key === "n" || e.key === "j"))) {
        if (items.length) view.at = (view.at + 1) % items.length;
      } else if (e.key === "up" || (e.modifiers.control && (e.key === "p" || e.key === "k"))) {
        if (items.length) view.at = (view.at <= 0 ? items.length : view.at) - 1;
      } else if (e.key === "tab" && hasRemotes) {
        const idx = view.targets.indexOf(view.machine);
        const next = view.targets[(idx + (e.modifiers.shift ? view.targets.length - 1 : 1)) % view.targets.length];
        switchMachine(view, next, cx);
      } else return;
      cx.stop_propagation();
      cx.notify();
    })
    // Prompt line (`Herdr project> ...`), fzf --layout=reverse style
    .child(h_flex().h(26).flex_none().items_center().gap(2)
      .child(div().flex_none().font_medium().text_color(t.ansi4 || t.accent).child(promptLabel))
      .child(Input.new(view.input).flex_1().h_full().font_family(font).text_size(fontSize).text_color(t.foreground))
      .when(hasRemotes, (el) => el.child(h_flex().flex_none().gap(4).items_center()
        .children(view.targets.map((m) => {
          const on = m === view.machine;
          return div().id(`pm-${m ?? "local"}`).h(20).px(6).flex().items_center().rounded(4).cursor_pointer().text_size(fontSize - 1)
            .bg(on ? t.raised : "#00000000").text_color(on ? (t.ansi4 || t.foreground) : t.dim)
            .hover((st) => st.text_color(t.foreground))
            .on_click((_e, cx) => switchMachine(view, m, cx))
            .child(m ?? "local");
        })))))
    // fzf counter + horizontal rule (`  12/48 ────────────────────────`)
    .child(h_flex().h(18).flex_none().items_center().gap(8).pl(18)
      .child(div().flex_none().text_size(fontSize - 1).text_color(t.ansi3 || t.dim).child(view.loading ? "…" : `${items.length}/${total}`))
      .child(div().flex_1().h(1).bg(t.border))
      .when(hasRemotes, (el) => el.child(div().flex_none().text_size(fontSize - 2).text_color(t.dim).child("Tab: machine"))))
    // Single-line list filling the rest of the modal
    .child(div().id("proj-list").flex_1().min_h(0).relative().overflow_hidden()
      .on_size_change((size, cx) => {
        const h = Math.max(ROW, Math.floor(size.height / zoom));
        if (h !== view.listH) { view.listH = h; cx.notify(); }
      })
      .on_mouse_move((e) => { view.pointerY = e.local_position.y / zoom; })
      .on_hover((on) => { if (!on) view.pointerY = undefined; })
      .on_scroll_wheel((e, cx) => {
        cx.stop_propagation();
        const next = Math.max(0, Math.min(view.scrollTop - e.delta.y / zoom, maxScroll));
        view.scrollTop = next;
        if (items.length) view.at = Math.min(Math.max(view.at, Math.ceil(next / ROW)), Math.floor((next + listH) / ROW) - 1);
        cx.notify();
      })
      .when(Boolean(view.error), (el) => el.child(div().py(16).px(18).text_color(t.ansi1 || t.blocked).child(view.error)))
      .when(!view.error && view.loading && items.length === 0, (el) => el.child(div().py(16).px(18).text_color(t.dim).child(`Scanning ${view.machine ?? "local"}…`)))
      .when(!view.error && !view.loading && items.length === 0, (el) => el.child(div().py(16).px(18).text_color(t.dim).child("No matches")))
      .when(items.length > 0, (el) => el.children(renderedRows)));
}
