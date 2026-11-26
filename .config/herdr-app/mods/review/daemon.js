// The jin.review daemon's review API (plans/fork/04 in the fork), signed in with the session the CLI keeps in ~/.pulls.review.
// Works both on this machine (direct fetch to 127.0.0.1) and on remote Herdr machines (via exec(..., { on }) + python3 bridge).
import { exec, home, readTextFile } from "herdr";

let state = null;

async function readState() {
  const text = await readTextFile(`${home()}/.pulls.review/daemon.pid`).catch(() => null);
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

/** Starts the local daemon when none answers: `-d --no-open` registers the worktree and opens nothing. */
async function startLocal(root, extra = []) {
  const args = ["-d", "--no-open", "--worktree", ...extra];
  const h = home(), bun = `${h}/.bun/bin/bun`, bunCli = `${h}/.bun/bin/jin.review`;
  let r = await exec("jin.review", args, { cwd: root }).catch(() => null);
  if (!r || (r.code !== 0 && /no such file|not found/i.test((r.stderr || "") + (r.stdout || "")))) {
    r = await exec(bun, [bunCli, ...args], { cwd: root }).catch(() => null)
      ?? await exec(bunCli, args, { cwd: root }).catch(() => null)
      ?? r;
  }
  return r;
}

async function connect(root, fresh) {
  if (state && !fresh) return state;
  state = await readState();
  if (state && await call(state, "GET", "/api/status").then(r => r.ok, () => false)) return state;
  let r = await startLocal(root);
  if (r && r.code !== 0 && /already in use/i.test((r.stderr || "") + (r.stdout || ""))) {
    r = await startLocal(root, ["--port", "7857"]);
  }
  if (!r) throw new Error("jin.review isn't installed: bun add --global jin.review. See mods/README.md in github.com/JinJieBeWater/pulls.review.");
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `jin.review -d exited ${r.code}`);
  state = await readState();
  if (!state) throw new Error("The jin.review daemon didn't start");
  return state;
}

function call({ port, session }, method, path, body) {
  const origin = `http://127.0.0.1:${port}`;
  return fetch(origin + path, {
    method,
    headers: { Cookie: `pulls_session=${session}`, Origin: origin, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

// Remote bridge: runs on the remote machine via Herdr's exec(..., { on }) using Python 3 stdlib,
// auto-starting jin.review if daemon.pid is missing or stale.
const REMOTE_BRIDGE = [
  "import json, os, pathlib, shutil, subprocess, sys, urllib.error, urllib.request",
  "root, method, path, body = sys.argv[1:5]",
  "pid_file = pathlib.Path.home() / '.pulls.review' / 'daemon.pid'",
  "def read_state():",
  "  try: return json.loads(pid_file.read_text())",
  "  except Exception: return None",
  "def start():",
  "  env = dict(os.environ)",
  "  extra = [str(pathlib.Path.home() / '.bun' / 'bin'), str(pathlib.Path.home() / '.local' / 'share' / 'mise' / 'shims'), str(pathlib.Path.home() / '.volta' / 'bin'), '/opt/homebrew/bin', '/usr/local/bin']",
  "  env['PATH'] = ':'.join(extra + [env.get('PATH', '')])",
  "  cli = shutil.which('jin.review', path=env['PATH'])",
  "  if not cli:",
  "    sys.stderr.write(\"jin.review isn't installed on this machine: bun add --global jin.review\\n\")",
  "    sys.exit(1)",
  "  cmd = [cli, '-d', '--no-open', '--worktree', '--port', '7856']",
  "  if not shutil.which('node', path=env['PATH']):",
  "    bun = shutil.which('bun', path=env['PATH'])",
  "    if bun: cmd = [bun, cli, '-d', '--no-open', '--worktree', '--port', '7856']",
  "  r = subprocess.run(cmd, cwd=root, env=env, capture_output=True, text=True)",
  "  if r.returncode != 0:",
  "    sys.stderr.write((r.stderr or r.stdout or f'jin.review -d exited {r.returncode}').strip() + '\\n')",
  "    sys.exit(1)",
  "  st = read_state()",
  "  if not st:",
  "    sys.stderr.write(\"The jin.review daemon didn't start\\n\")",
  "    sys.exit(1)",
  "  return st",
  "def call(st):",
  "  origin = f\"http://127.0.0.1:{st['port']}\"",
  "  headers = {'Cookie': f\"pulls_session={st['session']}\", 'Origin': origin, 'Content-Type': 'application/json'}",
  "  data = body.encode('utf-8') if body else None",
  "  req = urllib.request.Request(origin + path, data=data, headers=headers, method=method)",
  "  with urllib.request.urlopen(req, timeout=25) as resp:",
  "    return resp.read().decode('utf-8')",
  "st = read_state()",
  "for attempt in range(2):",
  "  if not st: st = start()",
  "  try:",
  "    sys.stdout.write(call(st))",
  "    sys.exit(0)",
  "  except urllib.error.HTTPError as e:",
  "    if e.code == 401 and attempt == 0:",
  "      st = start()",
  "      continue",
  "    sys.stderr.write((e.read().decode('utf-8', 'replace') or f'jin.review answered {e.code}').strip() + '\\n')",
  "    sys.exit(1)",
  "  except Exception as e:",
  "    if attempt == 0:",
  "      st = start()",
  "      continue",
  "    sys.stderr.write(f'{e}\\n')",
  "    sys.exit(1)",
].join("\n");

async function remoteRequest(root, method, path, body, on) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  const out = await exec("python3", ["-c", REMOTE_BRIDGE, root, method, path, payload], { on }).catch(() => null);
  if (!out) throw new Error(`Could not run python3 on ${on}`);
  if (out.code !== 0) throw new Error((out.stderr || out.stdout).trim() || `jin.review failed on ${on}`);
  return /** @type {any} */ (JSON.parse(out.stdout));
}

/** Calls the daemon for the worktree at `root` (locally or on remote machine `on`). */
export async function request(root, method, path, body, on = null) {
  if (on) return remoteRequest(root, method, path, body, on);
  let r;
  try { r = await call(await connect(root), method, path, body); }
  catch { r = await call(await connect(root, true), method, path, body); }
  if (r.status === 401) r = await call(await connect(root, true), method, path, body);
  if (!r.ok) throw new Error((await r.text()).trim() || `jin.review answered ${r.status}`);
  return /** @type {Promise<any>} */ (r.json());
}

/** POSTs to the review API, which names the worktree in the body. */
export const review = (root, path, body, on = null) => request(root, "POST", path, { path: root, ...body }, on);
