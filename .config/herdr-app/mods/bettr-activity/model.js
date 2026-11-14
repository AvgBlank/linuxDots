// Reads the provider-neutral `bettr.activity` labels (see SCHEMA.md) and turns
// them into one list of rows. Nothing here knows which agent wrote them.
const KINDS = new Set(["run", "edit", "read", "search", "web", "agent", "ask", "tool", "steer", "notice", "message"]);
// Steps that are not tool calls, so the verb table has no row for them.
const FIXED = { steer: "Steered", notice: "", message: "" };
// Neighbours of these kinds with the same verb share one row.
const SINGLE = new Set(["steer", "notice", "message"]);
const MAX_DETAILS = 12;
// A working turn with no step for this long lost its stop event (the agent was
// killed or interrupted): it is shown as stopped. The reporter uses the same rule.
const STALE_TURN = 15 * 60;

// The focused agent's terminal, or null. The displayed terminal takes precedence over
// the agent-block fallback. Same rule as the Context panel.
export function focusedAgent(focus, terminals, agents) {
  const address = focus?.shown ?? focus?.terminal ?? focus?.agent;
  const terminal = terminals.find(item => item.address === address && item.state === "live");
  if (!terminal) return null;
  return terminal.program?.agent || terminal.status || agents.some(item => item.address === address) ? terminal : null;
}

// A label left by a different agent in the same terminal is stale. Checked on every
// read, as the label text does not change when another agent starts there.
const stale = (parent, state) => {
  const app = parent.program?.key ?? parent.report?.app;
  return Boolean(app) && !app.includes(state.provider);
};

const time = value => typeof value === "number" && Number.isFinite(value) ? value : null;
const text = value => typeof value === "string" ? value.trim() : "";
const count = value => Number.isSafeInteger(value) && value > 0 ? value : 0;
const strings = value => Array.isArray(value) ? value.map(text).filter(Boolean) : [];

// Parsed labels, one slot per terminal and label name. A label is parsed again only
// when its text changes, and the new value replaces the old one.
const slots = new Map();
function parse(parent, name, shape = value => value) {
  const value = parent?.labels?.[name];
  if (typeof value !== "string") return null;
  const slot = `${parent.address}\u0000${name}`, known = slots.get(slot);
  if (known?.text === value) return known.value;
  let result = null;
  try { result = shape(JSON.parse(value)); } catch { result = null; }
  if (slots.size > 4000) slots.clear();
  slots.set(slot, { text: value, value: result });
  return result;
}

// A turn label's body, with entries of unknown kinds dropped once.
const turnBody = body => ({ ...body, entries: (Array.isArray(body?.entries) ? body.entries : [])
  .filter(entry => KINDS.has(entry?.kind)) });

// The log from `bettr.activity` (turn headings) and `bettr.activity.<id>` (each
// turn's steps and reply). Turns oldest first; entries in the order they happened.
export function activityState(parent) {
  const state = parse(parent, "bettr.activity");
  if (state?.version !== 4 || typeof state.provider !== "string" || !state.provider
    || typeof state.sessionId !== "string" || !Array.isArray(state.turns) || stale(parent, state)) return null;
  const turns = state.turns
    .filter(turn => turn && typeof turn === "object" && time(turn.startedAt) !== null)
    .map(turn => {
      const body = parse(parent, `bettr.activity.${turn.id}`, turnBody) ?? turnBody({});
      return { ...turn, entries: body.entries, dropped: body.dropped, reply: body.reply };
    });
  return { ...state, turns };
}

// The subagents label on the same terminal (mods/bettr-reporter/SCHEMA.md):
// - `names`: subagent names by ID, so a message from an agent can say who sent it.
// - `live`: the working subagents, newest start first. Finished ones are left out.
function subagentsLabel(state) {
  if (state?.version !== 2 || typeof state.provider !== "string" || !Array.isArray(state.agents)) return null;
  const rows = state.agents.filter(row => text(row?.id));
  return {
    provider: state.provider,
    names: new Map(rows.map(row => [text(row.id), text(row.name) || text(row.description) || text(row.type)])),
    live: rows.filter(row => row.status === "working").map(row => ({
      id: text(row.id), name: text(row.name) || text(row.type) || "Subagent",
      model: text(row.modelLabel) || text(row.model), effort: text(row.effort),
      description: text(row.description), startedAt: time(row.startedAt),
    })).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0) || (a.id < b.id ? -1 : 1)),
  };
}
function subagents(parent) {
  const state = parse(parent, "bettr.subagents", subagentsLabel);
  return state && !stale(parent, state) ? state : null;
}
export const agentNames = parent => subagents(parent)?.names ?? new Map();
export const liveSubagents = parent => subagents(parent)?.live ?? [];

export function duration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const base = path => text(path).replace(/\/+$/, "").split("/").pop() || text(path);
const list = (items, limit = 3) =>
  items.slice(0, limit).join(", ") + (items.length > limit ? ` +${items.length - limit}` : "");

function editedFiles(files) {
  const rows = (Array.isArray(files) ? files : []).filter(file => Array.isArray(file) && text(file[0]));
  const describe = ([path, added, removed, op], name) => {
    if (op === "created") return `${name} (new)`;
    if (op === "deleted") return `${name} (deleted)`;
    return Number.isSafeInteger(added) || Number.isSafeInteger(removed)
      ? `${name} +${count(added)} −${count(removed)}` : name;
  };
  return {
    text: list(rows.map(file => describe(file, base(file[0])))),
    details: rows.length > 1 || rows.some(file => file[0].includes("/"))
      ? rows.map(file => describe(file, file[0])) : [],
  };
}

// A detail row is one line high: a multi-line command (a heredoc) shows its
// line breaks as "↵".
const oneLine = value => value.replace(/[ \t]*\r?\n\s*/g, " ↵ ");
const lines = value => text(value).split("\n").map(line => line.trim()).filter(Boolean);

// The layout's `verbs` prop names every step:
//   { "tools": { "Grep": "Searched", "mcp__*": "Used", "TodoWrite": null },
//     "commands": { "git commit": "Committed", "sleep": null } }
// A tool key is the agent's tool name, or a prefix ending in `*`. A command key
// matches a command that starts with it as whole words. The longest key wins,
// and `null` hides the step. A flat object is a `commands` table.
export function verbTable(verbs) {
  const table = verbs && typeof verbs === "object" ? verbs : {};
  const split = "tools" in table || "commands" in table;
  const rules = value => Object.entries(value && typeof value === "object" ? value : {})
    .map(([key, verb]) => ({ key: text(key), verb: verb === null ? null : text(verb) }))
    .filter(rule => rule.key && rule.verb !== "")
    .sort((a, b) => b.key.length - a.key.length);
  const commands = rules(split ? table.commands : table), tools = rules(split ? table.tools : {});
  return {
    command: line => commands.find(rule => line === rule.key || line.startsWith(`${rule.key} `)),
    tool: name => tools.find(rule => rule.key.endsWith("*") ? name.startsWith(rule.key.slice(0, -1)) : name === rule.key),
  };
}
const noVerbs = verbTable({});

// { verb, hidden, key } for one entry: the table's verb, else the tool's own
// name; `Ran` for an unnamed command.
export function resolve(entry, table = noVerbs) {
  if (entry.kind in FIXED) return { verb: FIXED[entry.kind], hidden: false };
  const rule = entry.kind === "run" ? table.command(text(entry.label)) : table.tool(text(entry.tool));
  if (rule?.verb === null) return { verb: "", hidden: true };
  const fallback = entry.kind === "run" ? "Ran" : text(entry.tool) || "Used";
  return { verb: rule?.verb || fallback, hidden: false, key: rule?.key };
}

// `/usr/bin/git status` -> `git`; `f() {` -> `f`; `ls; pwd` and `(cd x)` -> `ls`, `cd`.
export const program = label => text(label).replace(/^[\s(]+/, "").split(/[\s;&|)]+/)[0]
  .replace(/^["']|["']$/g, "").replace(/\($/, "").split("/").pop() || text(label);

const times = (name, n) => n > 1 ? `${name} ×${n}` : name;

// Names with counts, in first-seen order: `grep ×3, cd ×2, node`. `parts` lets
// the panel draw the counts muted.
function tally(pairs) {
  const counts = new Map();
  for (const [name, n] of pairs) counts.set(name, (counts.get(name) ?? 0) + n);
  const parts = [...counts].map(([name, n]) => ({ name, count: n > 1 ? `×${n}` : "" }));
  return { parts, text: parts.map(part => [part.name, part.count].filter(Boolean).join(" ")).join(", ") };
}

function outcome(entries) {
  const failed = entries.filter(entry => entry.result === "failed").length;
  if (failed) return { tail: entries.length > 1 ? `${failed} failed` : "failed", tone: "blocked" };
  const last = entries[entries.length - 1]?.result;
  if (last === "started") return { tail: "started", tone: "working" };
  if (last === "interrupted") return { tail: "stopped", tone: "dim" };
  return { tail: "", tone: "dim" };
}

function cap(details) {
  return details.length > MAX_DETAILS
    ? [...details.slice(0, MAX_DETAILS - 1), `+${details.length - MAX_DETAILS + 1} more`] : details;
}

const unique = values => [...new Set(values)];

// Edited files across steps: line counts add up per file.
function mergedFiles(entries) {
  const files = new Map();
  for (const entry of entries) {
    for (const file of Array.isArray(entry.files) ? entry.files : []) {
      if (!Array.isArray(file) || !text(file[0])) continue;
      const known = files.get(file[0]);
      if (!known) { files.set(file[0], [...file]); continue; }
      if (Number.isSafeInteger(file[1]) || Number.isSafeInteger(known[1])) {
        known[1] = count(known[1]) + count(file[1]);
        known[2] = count(known[2]) + count(file[2]);
      }
      if (file[3] === "deleted") known[3] = "deleted";
      else if (known[3] === "deleted") known[3] = "modified";  // Deleted, then written again.
    }
  }
  return [...files.values()];
}

// One row: an entry, or neighbours with the same kind and verb. `step` is from
// `steps`, which already resolved the verb and each command's table key.
// Returns { verb, text, parts?, tail, tone, repeat, details }; `tone` is a theme token.
export function describe(entries, table = noVerbs, step = undefined) {
  entries = Array.isArray(entries) ? entries : [entries];
  const [entry] = entries, kind = entry.kind;
  const verb = step?.verb ?? resolve(entry, table).verb;
  const runs = entries.map(item => count(item.repeat) || 1);
  if (kind === "run") {
    const keys = step?.keys ?? entries.map(item => resolve(item, table).key);
    // The full command, setup included, when the reporter kept it.
    const details = cap(entries.map((item, at) =>
      times(text(item.detail) || text(item.label), runs[at]) + (item.result === "failed" ? "  — failed" : "")));
    const line = { verb, repeat: "", details, ...outcome(entries),
      ...tally(entries.map((item, at) => [keys[at] ?? program(item.label), runs[at]])) };
    if (entries.length === 1 && details[0] === text(entry.label)) line.details = [];
    return line;
  }
  const line = { verb, text: "", repeat: "", details: [], ...outcome(entries) };
  if (kind === "edit") {
    // `diff`: the text has line counts (`+3 −1`) for the view to colour.
    Object.assign(line, editedFiles(mergedFiles(entries)), { diff: true });
  } else if (kind === "read") {
    const items = unique(entries.flatMap(item => strings(item.items)));
    line.text = list(items.map(base));
    line.details = items.length > 1 || items.some(item => item.includes("/")) ? items : [];
  } else if (kind === "search") {
    const items = unique(entries.flatMap(item => strings(item.items)));
    const total = runs.reduce((sum, n) => sum + n, 0);
    line.text = items.map(item => `“${item}”`).join(" · ") || "files";
    line.repeat = total > 1 ? `×${total}` : "";
    line.details = [...(items.length > 1 ? items : []), ...entries.flatMap(item => lines(item.detail))];
  } else if (entries.length > 1) {
    Object.assign(line, tally(entries.map((item, at) => [text(item.label) || text(item.tool), runs[at]])));
    line.details = entries.flatMap((item, at) =>
      [times(text(item.label) || text(item.tool), runs[at]), ...lines(item.detail)]);
  } else {
    line.text = text(entry.label);
    line.repeat = runs[0] > 1 ? `×${runs[0]}` : "";
    line.details = lines(entry.detail);
  }
  if (line.details.length === 1 && line.details[0] === line.text) line.details = [];
  line.details = cap(line.details);
  return line;
}

// Neighbouring entries that share a row, after hidden steps are dropped: a
// hidden step between two reads does not split them. A finished turn's entries
// never change, so the result is kept per entries array and table.
const grouped = new WeakMap();
export function steps(entries, table = noVerbs) {
  const known = grouped.get(entries);
  if (known?.table === table) return known.value;
  const out = [];
  entries.forEach((entry, index) => {
    const { verb, hidden, key } = resolve(entry, table);
    if (hidden) return;
    const last = out[out.length - 1];
    if (last && !SINGLE.has(entry.kind) && last.kind === entry.kind && last.verb === verb) {
      last.entries.push(entry);
      last.keys.push(key);
    } else {
      out.push({ index, kind: entry.kind, verb, entries: [entry], keys: [key] });
    }
  });
  grouped.set(entries, { table, value: out });
  return out;
}

// Agent replies are Markdown. The panel shows plain text: no fences, emphasis,
// or heading marks; list items keep a bullet.
export function plainText(value) {
  return text(value).split("\n")
    .filter(line => !/^\s*```/.test(line))
    .map(line => line.replace(/^\s*#{1,6}\s+/, "").replace(/^\s*[-*]\s+/, "• ")
      .replace(/\*\*|__|`/g, "").trim())
    .filter(Boolean);
}

const OUTCOMES = { done: ["Done", "done"], failed: ["Failed", "blocked"], interrupted: ["Stopped", "dim"] };

// A turn heading: { title, status, tone, elapsed, live }. `now` is in seconds.
export function turnSummary(turn, now = Date.now() / 1000, names = new Map()) {
  const open = time(turn.endedAt) === null;
  const last = Math.max(turn.startedAt, ...(turn.entries ?? []).map(entry => time(entry?.at) ?? 0));
  const live = open && now - last < STALE_TURN;
  const [status, tone] = live ? ["Working", "working"]
    : open ? OUTCOMES.interrupted : OUTCOMES[turn.outcome] ?? OUTCOMES.done;
  const end = live ? now : open ? last : time(turn.endedAt);
  const notice = turn.source === "notice";
  return {
    notice, live, status, tone,
    title: noticeTitle(turn, names) || (notice ? "Notice" : "Continued"),
    untitled: !notice && !text(turn.prompt),
    elapsed: end >= turn.startedAt ? duration(end - turn.startedAt) : "",
  };
}

function noticeTitle(item, names) {
  const sender = text(item.from) && (names.get(item.from) || "an agent");
  return text(item.prompt ?? item.label) || (sender ? `Message from ${sender}` : "");
}

// The whole log as rows: turns top to bottom in the order they happened (the
// newest at the bottom), and inside a turn its heading, then its steps in the order they happened, then the reply.
// - `expanded`: turn key -> open or closed, as the user set it. Otherwise the
//   newest turn and any working turn are open, and older turns closed.
//   The key `<session>#~older` shows the finished turns before the newest: by
//   default two or more of them fold into one "older" row (the panel's header toggle).
// - `open`: keys of step and message rows the user opened.
// - `verbs`: from `verbTable`. `cut`: keys of message rows the panel found longer than
//   their one closed line (it measures the wrapped text); only those open.
// Keys are `<session>#<turn id>`, then `:<step>`.
export function activityRows(state, { now = Date.now() / 1000, names = new Map(), open = new Set(),
  expanded = new Map(), verbs = noVerbs, cut = new Set() } = {}) {
  const turns = [], all = state?.turns ?? [];
  // `markdown`: the agent's own text, drawn as Markdown when opened; the closed preview is plain.
  const message = (key, lines, markdown = "") => {
    // The panel draws the preview on one line and reports which are cut.
    const long = cut.has(key);
    return { type: "message", key, lines, markdown, preview: lines.join(" "), cut: long, expandable: long,
      opened: long && open.has(key) };
  };
  // Finished turns before the newest, up to the first working one.
  let older = 0;
  while (older < all.length - 1 && !turnSummary(all[older], now, names).live) older += 1;
  const olderKey = `${state?.sessionId}#~older`, folded = older >= 2 && !expanded.get(olderKey);
  if (older < 2) older = 0;
  for (const [index, turn] of all.entries()) {
    if (folded && index < older) continue;
    const id = `${state.sessionId}#${turn.id}`;
    const summary = turnSummary(turn, now, names);
    const found = steps(turn.entries, verbs);
    const content = found.length > 0 || text(turn.reply) !== "";
    // The newest turn stays open after it ends; it closes when the next one starts.
    const shown = content && (expanded.get(id) ?? (summary.live || index === all.length - 1));
    // Every turn has the same heading, whether a prompt or a message started it.
    const head = { type: "prompt", key: id, expandable: content, expanded: shown, ...summary };
    // Blocks in the order they happened; a step keeps its detail rows under it.
    const blocks = [];
    if (shown) {
      const dropped = count(turn.dropped);
      if (dropped) blocks.push([{ type: "note", key: `${id}:dropped`,
        text: `${dropped} ${turn.entries.length ? "earlier " : ""}step${dropped === 1 ? "" : "s"} not kept` }]);
      for (const step of found) {
        const key = `${id}:${dropped + step.index}`;
        if (step.kind === "message") {
          // The agent's text between tool calls: shown like the final reply.
          const lines = plainText(step.entries[0].text);
          if (lines.length) blocks.push([message(key, lines, text(step.entries[0].text))]);
          continue;
        }
        if (step.kind === "notice") {
          // A harness message that arrived while the agent worked: a step row with no details.
          blocks.push([{ type: "entry", key, verb: "Notice", opened: false, expandable: false,
            text: noticeTitle(step.entries[0], names) || "Notice" }]);
          continue;
        }
        const line = describe(step.entries, verbs, step);
        const opened = open.has(key) && line.details.length > 0;
        blocks.push([{ type: step.kind === "steer" ? "steer" : "entry", key, opened,
          expandable: line.details.length > 0, ...line },
        ...(opened ? line.details.map((detail, at) => ({ type: "detail", key: `${key}:d${at}`, parent: key,
          text: oneLine(detail), diff: line.diff, last: at === line.details.length - 1 })) : [])]);
      }
      const reply = plainText(turn.reply);
      if (reply.length) blocks.push([message(`${id}:reply`, reply, text(turn.reply))]);
    }
    // Space under an open turn's last row, as above its first.
    const end = blocks.length ? [{ type: "gap", key: `${id}:end` }] : [];
    turns.push([head, ...blocks.flat(), ...end]);
  }
  if (older) turns.unshift([{ type: "older", key: olderKey, count: older, expandable: true, expanded: !folded }]);
  const rows = turns.flat();
  if (rows.length) rows[0] = { ...rows[0], first: true };
  return rows;
}
