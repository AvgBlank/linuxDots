// Finds the session log an agent terminal is writing, and reads it as it grows.
import { exec } from "herdr";
import { Buffer } from "buffer";

// Start this far from the end of a long log; earlier history is skipped.
const TAIL_BYTES = 4 * 1024 * 1024;

const sh = (script, args, on) => exec("sh", ["-c", script, "sh", ...args], { on });

export const machineOf = (address) => (address?.includes("/") ? address.split("/")[0] : null);

export function agentKind(term) {
  const argv0 = term?.argv?.[0]?.split("/").pop() ?? "";
  const what = `${term?.report?.app ?? ""} ${term?.foreground?.name ?? ""} ${term?.program?.key ?? ""} ${argv0}`.toLowerCase();
  return what.includes("claude") ? "claude" : what.includes("codex") ? "codex" : what.includes("hermes") ? "hermes" : null;
}

// Claude Code writes ~/.claude/sessions/<pid>.json with the live session id.
const CLAUDE = `
for p in "$1" $(pgrep -P "$1"); do
  f="$HOME/.claude/sessions/$p.json"
  [ -f "$f" ] || continue
  id=$(sed -n 's/.*"sessionId":"\\([^"]*\\)".*/\\1/p' "$f")
  [ -n "$id" ] || continue
  log=$(ls "$HOME"/.claude/projects/*/"$id".jsonl 2>/dev/null | head -1)
  [ -n "$log" ] && echo "$log" && exit 0
done`;

// Codex keeps its rollout file open; fall back to the newest one for this folder.
const CODEX = `
kids=$(pgrep -P "$1" | tr '\\n' ' ')
grand=$(for k in $kids; do pgrep -P "$k"; done | tr '\\n' ' ')
for p in "$1" $kids $grand; do
  { lsof -p "$p" -Fn 2>/dev/null | sed -n 's/^n//p'; ls -l "/proc/$p/fd" 2>/dev/null | sed 's/.* -> //'; } | grep '/sessions/.*rollout-.*\\.jsonl$'
done | head -1 | grep . && exit 0
find "$HOME/.codex/sessions" -name 'rollout-*.jsonl' -mtime -2 2>/dev/null | xargs ls -t 2>/dev/null | while read -r f; do
  head -c 20000 "$f" | grep -q "\\"cwd\\":\\"$2\\"" && { echo "$f"; break; }
done`;

export async function locate(term, kind) {
  const pid = term?.foreground?.pid;
  if (!pid) return null;
  if (kind === "hermes") return hermesSession(term);
  const on = machineOf(term.address);
  const r = await sh(kind === "codex" ? CODEX : CLAUDE, [String(pid), term.foreground.cwd ?? ""], on);
  return r.stdout.trim().split("\n")[0] || null;
}

// Hermes runs in the `hermes` Docker container (~/hermes-docker). Its TUI keeps
// its session id in the file its HERMES_TUI_ACTIVE_SESSION_FILE names, rewritten
// on /new; the ~/.local/bin/hermes wrapper tags each launch with HERMES_LAUNCH.
// Only the hermes user can read the TUI's environment.
export const docker = (args) => exec("sh", ["-c", 'PATH="$PATH:/usr/local/bin" exec docker "$@"', "sh", ...args]);
const HERMES_FILE = `
for p in /proc/[0-9]*; do
  grep -qzx "HERMES_LAUNCH=$1" $p/environ 2>/dev/null || continue
  f=$(tr "\\0" "\\n" <$p/environ | sed -n "s/^HERMES_TUI_ACTIVE_SESSION_FILE=//p")
  [ -n "$f" ] && echo "$f" && exit
done`;
const hermesFiles = new Map();

// "hermes:<session id>", in place of a log file.
async function hermesSession(term) {
  const launch = term.foreground?.argv?.find((a) => a.startsWith("HERMES_LAUNCH="))?.slice(14);
  if (!launch) return null;
  if (!hermesFiles.has(launch)) {
    const f = (await docker(["exec", "-u", "hermes", "hermes", "sh", "-c", HERMES_FILE, "sh", launch])).stdout.trim();
    if (!f.startsWith("/opt/host/")) return null;
    hermesFiles.set(launch, f.replace("/opt/host/", ".hermes/"));
  }
  const r = await sh('cat "$HOME/$1" 2>/dev/null', [hermesFiles.get(launch)]);
  const id = /"session_id"\s*:\s*"([^"]+)"/.exec(r.stdout)?.[1];
  return id ? `hermes:${id}` : null;
}

// Hermes keeps chats in SQLite, one row per step. Read inside the container:
// the Mac can't lock a file the Linux VM writes. A compacted session's earlier
// parts are its ancestors. Prints the session (model, title, the last request's
// size), then the rows after id $2, at most $3, as JSON lines.
const HERMES_ROWS = `
import sqlite3, sys, json
c = sqlite3.connect("file:/opt/host/data/state.db?mode=ro", uri=True)
c.row_factory = sqlite3.Row
s = c.execute("select model, title, model_config from sessions where id = ?", (sys.argv[1],)).fetchone()
if s: print(json.dumps({"session": dict(s)}))
q = """with recursive chain(id) as (select ? union select s.parent_session_id from sessions s join chain using(id) where s.parent_session_id is not null)
select id, role, content, tool_call_id, tool_calls, display_kind, timestamp from messages where session_id in chain and id > ? order by id limit ?"""
for r in c.execute(q, (sys.argv[1], int(sys.argv[2]), int(sys.argv[3]))): print(json.dumps(dict(r)))`;
const hermesRows = async (file, after, limit = -1) => {
  const r = await docker(["exec", "hermes", "python3", "-c", HERMES_ROWS, file.slice(7), String(after), String(limit)]);
  if (r.code !== 0) throw new Error(r.stderr.trim().split("\n").at(-1) || "can't read Hermes's chat");
  return r.stdout.split("\n").filter(Boolean);
};
export const HERMES_DATA = ".hermes/data";

// Hermes's earlier chats, newest first, for the chat's resume list: [{ id, title, at }].
const HERMES_SESSIONS = `
import sqlite3, json
c = sqlite3.connect("file:/opt/host/data/state.db?mode=ro", uri=True)
print(json.dumps([{"id": i, "title": t or "(untitled)", "at": a * 1000} for i, t, a in c.execute(
  "select id, title, coalesce(last_activity_at, started_at) a from sessions where id like 'local-%' and message_count > 0 and not hidden and not archived order by a desc limit 40")]))`;
export async function hermesSessions() {
  return JSON.parse((await docker(["exec", "hermes", "python3", "-c", HERMES_SESSIONS])).stdout);
}

// Hermes's new rows since the last call; `at` holds their ids, where a tool's row is read back from.
export class HermesTail {
  constructor(file) { this.file = file; this.last = 0; }
  async read() {
    const lines = await hermesRows(this.file, this.last);
    const session = lines[0]?.startsWith('{"session"') ? lines.shift() : null;
    this.at = lines.map((l) => JSON.parse(l).id);
    if (this.at.length) this.last = this.at.at(-1);
    // The session line only when it changed.
    if (session && session !== this.session) { this.session = session; lines.unshift(session); this.at.unshift(null); }
    return lines;
  }
}

// Reads complete new lines from `file` since the last call.
export class Tail {
  constructor(file, on) {
    this.file = file;
    this.on = on;
    this.offset = null;
  }

  async read() {
    let skipFirst = false;
    if (this.offset === null) {
      const r = await sh('wc -c < "$1"', [this.file], this.on);
      const size = parseInt(r.stdout.trim(), 10) || 0;
      this.offset = Math.max(0, size - TAIL_BYTES);
      skipFirst = this.offset > 0;
      this.truncated = skipFirst;
    }
    const r = await exec("tail", ["-c", `+${this.offset + 1}`, this.file], { on: this.on });
    if (r.code !== 0) throw new Error(r.stderr.trim() || "can't read the session log");
    const s = r.stdout;
    const cut = s.lastIndexOf("\n");
    if (cut < 0) return [];
    const chunk = s.slice(0, cut + 1);
    // Each line's byte offset in the log, in `this.at`, beside the lines.
    let at = this.offset;
    const lines = [];
    this.at = [];
    chunk.split("\n").forEach((line, i, all) => {
      if (line && !(skipFirst && i === 0)) { lines.push(line); this.at.push(at); }
      if (i < all.length - 1) at += Buffer.from(line, "utf8").length + 1;
    });
    this.offset = at;
    return lines;
  }
}

// The log line that starts at byte `at`: where a tool's output is read back from when its line is opened.
export async function lineAt(file, at, on) {
  if (file.startsWith("hermes:")) return (await hermesRows(file, at - 1, 1)).find((l) => !l.startsWith('{"session"')) ?? null;
  const r = await sh('tail -c +"$1" "$2" | head -n 1', [String(at + 1), file], on);
  if (r.code !== 0) throw new Error(r.stderr.trim() || `exit ${r.code}`);
  return r.stdout || null;
}
