// The / menu: which commands an agent takes, as its own menu lists them.
import { exec } from "herdr";
import { claudeInfo, codexCalls } from "./sdk.js";
import { docker } from "./source.js";

// Claude Code's built-in commands, as its app describes them (2.1.311). The
// ones it only runs outside the terminal come from \`claude -p\` below too.
const CLAUDE = [
  ["add-dir", "Add a new working directory", "<path>", []],
  ["advisor", "Let Claude consult a stronger model at key moments", "", []],
  ["artifacts", "Browse your published and shared artifacts", "", []],
  ["auto-mode-setup", "Teach auto mode about your environment, plus optional rule tweaks", "", []],
  ["autocompact", "Set how full the context gets before auto-summarizing", "[auto|<tokens>]", []],
  ["autofix-pr", "Monitor and autofix any issues with the current PR", "", []],
  ["background", "Send this session to the background and free the terminal", "[prompt]", ["bg"]],
  ["branch", "Create a branch of the current conversation at this point", "[name]", []],
  ["btw", "Ask a quick side question without interrupting the main conversation", "[question]", []],
  ["bug", "Report a bug or share your conversation", "[report]", ["share"]],
  ["cd", "Move this session to a new working directory", "<path>", []],
  ["chrome", "Open Claude in Chrome settings", "", []],
  ["clear", "Start a new session with empty context; previous session stays on disk (resumable with /resume)", "[name]", ["reset", "new"]],
  ["cloud-plugins", "Choose whether cloud sessions use the plugins enabled on this machine", "", []],
  ["color", "Set the prompt bar color for this session", "", []],
  ["compact", "Free up context by summarizing the conversation so far", "", []],
  ["config", "Open settings", "[key=value]", ["settings"]],
  ["context", "Visualize current context usage as a colored grid", "[all]", []],
  ["copy", "Copy Claude's last response to clipboard (or /copy N for the Nth-latest)", "", []],
  ["daemon", "Manage background services and routines", "", []],
  ["design-login", "Authorize design-system access for /design-sync with your claude.ai account", "", []],
  ["desktop", "Continue the current session in Claude Desktop", "", ["app"]],
  ["diff", "View uncommitted changes and per-turn diffs", "", []],
  ["effort", "Set effort level for model usage", "", []],
  ["exit", "Exit the REPL", "", ["quit"]],
  ["export", "Export the current conversation to a file or clipboard", "[filename]", []],
  ["fast", "Toggle fast mode", "[on|off]", []],
  ["feedback", "Send feedback to Anthropic or report a bug", "[report]", []],
  ["focus", "Toggle focus view: just your prompt, summary, and response", "", []],
  ["fork", "Spawn a background agent that inherits the full conversation", "<directive>", []],
  ["goal", "Set a goal Claude checks before stopping", "[<condition> | clear]", []],
  ["help", "Show help and available commands", "", []],
  ["hooks", "View hook configurations for tool events", "", []],
  ["ide", "Manage IDE integrations and show status", "[open]", []],
  ["import", "Import config from another AI coding agent", "[codex|gemini|cursor] [--dry-run]", []],
  ["init", "Initialize a new CLAUDE.md file with codebase documentation", "", []],
  ["insights", "Generate a report analyzing your Claude Code sessions", "", []],
  ["install", "Install Claude Code native build", "[options]", []],
  ["install-github-app", "Set up Claude GitHub Actions for a repository", "", []],
  ["install-slack-app", "Install the Claude Slack app", "", []],
  ["keybindings", "Open your keyboard shortcuts file", "", []],
  ["list-agents", "List subagents, teammates, and other Claude sessions you can message", "", ["peers"]],
  ["login", "Sign in with your Anthropic account", "", []],
  ["logout", "Sign out from your Anthropic account", "", []],
  ["loops", "List, create, and delete loops", "", []],
  ["mcp", "Manage MCP servers", "", []],
  ["memory", "Edit CLAUDE.md files and memory settings", "", []],
  ["mobile", "Show QR code to download the Claude mobile app", "", ["ios", "android"]],
  ["model", "Set the AI model for Claude Code", "<model>", []],
  ["output-style", "List output styles or switch to one", "[style]", []],
  ["passes", "Share a free week of Claude Code with friends", "", []],
  ["pause-memory", "Pause account memory and local auto-memory for this session (run again to turn both back on)", "", ["memory-pause", "toggle-memory"]],
  ["permissions", "Manage allow and deny tool permission rules", "", ["allowed-tools"]],
  ["plan", "Enable plan mode or view the current session plan", "[open|<description>]", []],
  ["plugin", "Manage Claude Code plugins", "", ["plugins", "marketplace"]],
  ["powerup", "Discover Claude Code features through quick interactive lessons", "", []],
  ["privacy-settings", "View and update your privacy settings", "", []],
  ["radio", "Listen to Claude FM lo-fi radio", "", []],
  ["recap", "Generate a one-line session recap now", "", []],
  ["release-notes", "View release notes", "", []],
  ["reload-plugins", "Activate pending plugin changes in the current session", "[--force]", []],
  ["reload-skills", "Pick up skills added or changed on disk during this session", "", []],
  ["remote-control", "Control this session from your phone or claude.ai/code", "", ["rc"]],
  ["remote-env", "Choose the default environment for cloud agents", "", []],
  ["rename", "Rename the current conversation", "[name]", ["name"]],
  ["restart", "Restart Claude Code and keep this session", "", ["update"]],
  ["resume", "Resume a previous conversation", "", ["continue"]],
  ["rewind", "Restore the code and/or conversation to a previous point", "", ["checkpoint", "undo"]],
  ["sandbox", "Configure the sandbox", "", []],
  ["scroll-speed", "Adjust mouse wheel scroll speed", "", []],
  ["session", "Show cloud session URL and QR code", "", ["remote"]],
  ["setup-bedrock", "Reconfigure Amazon Bedrock authentication, region, or model pins", "", []],
  ["setup-vertex", "Reconfigure Google Vertex AI authentication, project, region, or model pins", "", []],
  ["skill-doctor", "Show which loaded skills are unused and costing context", "", []],
  ["skills", "List available skills", "", []],
  ["status", "Show Claude Code status including version, model, account, API connectivity, and tool statuses", "", []],
  ["statusline", "Set up Claude Code's status line UI", "", []],
  ["stickers", "Order Claude Code stickers", "", []],
  ["stop", "Stop this background session; transcript and worktree are kept", "", []],
  ["subtask", "Send a subagent off with your full context; its result comes back here", "<task>", []],
  ["tasks", "View and manage everything running in the background", "", ["bashes"]],
  ["team-onboarding", "Help teammates ramp on Claude Code with a guide from your usage", "", []],
  ["teleport", "Send this session to the cloud, or resume one from claude.ai", "", ["tp"]],
  ["terminal-setup", "Enable Option+Enter key binding for newlines and disable the audible bell (skipped in screen-reader mode)", "", []],
  ["theme", "Change the theme", "", []],
  ["tui", "Set the terminal UI renderer (default | fullscreen)", "[default|fullscreen]", []],
  ["ultraplan", "Draft an editable plan in a cloud session", "<prompt>", []],
  ["ultrareview", "Review the current branch in a cloud session", "", []],
  ["usage", "Show session cost, plan usage, and activity stats", "", ["cost", "stats"]],
  ["version", "Show this session's version (autoupdate may have a newer one)", "", []],
  ["voice", "Toggle voice mode", "[hold|tap|off]", []],
  ["web-setup", "Set up cloud sessions with your GitHub account", "", []],
  ["wellbeing", "Configure optional break reminders and quiet-hours nudges", "", ["breaks", "break-reminder", "downtime"]],
  ["workflows", "Browse running and completed workflows", "", []],
];

// Ones that open a picker or a panel in the terminal when run bare.
const PICKERS = new Set(["model", "resume", "config", "permissions", "effort", "theme", "memory", "hooks", "plugin", "mcp", "login", "ide", "status", "usage", "help", "skills", "tasks", "release-notes", "privacy-settings", "export", "rewind", "output-style", "color", "tui", "workflows", "loops", "daemon", "sandbox", "powerup", "remote-control", "feedback", "bug", "import", "install-github-app", "setup-bedrock", "setup-vertex", "session", "teleport", "diff", "skill-doctor", "scroll-speed", "wellbeing", "mobile", "agents", "terminal-setup", "advisor", "autocompact", "list-agents", "artifacts", "fast"]);
const CODEX_PICKERS = new Set(["model", "permissions", "resume", "fork", "settings", "experimental", "statusline", "title", "theme", "keymap", "apps", "plugins", "skills", "prompts", "hooks", "memories", "subagents", "import", "ide", "review", "mention", "worktree"]);

// Ones Claude takes but keeps out of its menu.
const HIDDEN = new Set(["agents", "design-consent", "design-revoke", "extra-usage", "heapdump", "pro-trial-expired", "rate-limit-options", "upgrade", "usage-credits", "workflow-launch-exec"]);

const CODEX = [
  ["model", "choose what model and reasoning effort to use"],
  ["permissions", "choose what Codex is allowed to do"],
  ["review", "review my current changes and find issues"],
  ["new", "start a new chat during a conversation"],
  ["init", "create an AGENTS.md file with instructions for Codex"],
  ["compact", "summarize conversation to prevent hitting the context limit"],
  ["plan", "switch to Plan mode"],
  ["goal", "set or view the goal for a long-running task"],
  ["side", "start a side conversation in an ephemeral fork"],
  ["diff", "show git diff (including untracked files)"],
  ["mention", "mention a file"],
  ["status", "show current session configuration and token usage"],
  ["usage", "view account usage or use a usage limit reset"],
  ["resume", "resume a saved chat"],
  ["fork", "fork the current chat"],
  ["rename", "rename the current thread"],
  ["recap", "summarize the current conversation now"],
  ["copy", "copy the last response or part of it"],
  ["export", "export the conversation as markdown"],
  ["worktree", "start or continue a conversation in a new worktree"],
  ["skills", "use skills to improve how Codex performs specific tasks"],
  ["prompts", "run or save reusable prompts and slash commands"],
  ["mcp", "list MCP tools; use /mcp verbose or /mcp login <name>"],
  ["apps", "manage apps"],
  ["plugins", "browse plugins"],
  ["hooks", "view and manage lifecycle hooks"],
  ["memories", "configure memory use and generation"],
  ["settings", "configure Codex preferences"],
  ["experimental", "toggle experimental features"],
  ["statusline", "configure which items appear in the status line"],
  ["title", "configure which items appear in the terminal title"],
  ["theme", "choose a syntax highlighting theme"],
  ["vim", "toggle Vim mode for the composer"],
  ["keymap", "remap TUI shortcuts"],
  ["ide", "include current selection, open files, and other context from your IDE"],
  ["import", "import setup, this project, and recent chats from Claude Code"],
  ["cd", "change the current working directory"],
  ["pwd", "show the current working directory"],
  ["ps", "list background terminals"],
  ["stop", "stop all background terminals"],
  ["subagents", "switch between this session's subagents"],
  ["archive", "archive this session"],
  ["app", "continue this session in the Desktop app"],
  ["clear", "clear the terminal and start a new chat"],
  ["feedback", "send logs to maintainers"],
  ["logout", "log out of Codex"],
  ["quit", "exit Codex", "", ["exit"]],
];

const entry = ([name, desc, hint, aliases], source = "built-in") => ({ name, desc: desc ?? "", hint: hint ?? "", aliases: aliases ?? [], source });

// What a skill or command file says about itself in its front matter.
function front(text) {
  const head = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  const field = (k) => {
    const m = new RegExp(`^${k}:[ \\t]*(.*)$`, "m").exec(head);
    if (!m) return "";
    let v = m[1].trim();
    if (/^[>|]-?$/.test(v)) {
      const rest = head.slice(m.index + m[0].length + 1).split("\n");
      const end = rest.findIndex((l) => !/^\s/.test(l));
      v = rest.slice(0, end < 0 ? rest.length : end).map((l) => l.trim()).join(" ");
    }
    return v.replace(/^(["'])(.*)\1$/, "$2");
  };
  return { desc: field("description"), hint: field("argument-hint") };
}

const sh = (script, args, on) => exec("sh", ["-c", script, "sh", ...args], { on });

// What each command does in the chat, as in the Claude app: some are answered
// here (side chat, pickers, cards); the rest go to the agent as typed.
const HOST = {
  btw: { action: "side", aliases: ["side"], desc: "Ask a quick side question without interrupting the main conversation", hint: "[question]" },
  model: { action: "model" },
  effort: { action: "effort" },
  permissions: { action: "permissions", aliases: ["allowed-tools"], desc: "Choose how Claude asks before acting" },
  resume: { action: "resume", aliases: ["continue"], desc: "Resume a previous conversation" },
  status: { action: "status", desc: "Show model, folder, account and version" },
  usage: { action: "usage", aliases: ["cost", "stats"], desc: "Show session cost and plan usage" },
  memory: { action: "memory", desc: "See and edit what Claude remembers (CLAUDE.md files)" },
  hooks: { action: "hooks", desc: "See the hooks that run on Claude's events" },
  mcp: { action: "mcp", desc: "See MCP servers and reconnect, enable or disable them" },
  skills: { action: "skills", desc: "See the skills Claude can use" },
  plugin: { action: "plugins", aliases: ["plugins", "marketplace"], desc: "See installed plugins" },
  config: { action: "config", aliases: ["settings"], desc: "See and edit Claude Code's settings" },
  help: { action: "help", desc: "Show every command" },
  diff: { action: "diff", desc: "Show the uncommitted changes" },
  copy: { action: "copy", desc: "Copy Claude's last response" },
};

// Kinds and their icons, the Claude app's: built into the app, the agent's
// own commands, skills, plugins and MCP servers.
export const KINDS = { app: "settings", harness: "terminal", skill: "scroll", plugin: "plugin", mcp: "plug" };

const SCOPE = /\s*\((user|project|managed|local|claude\.ai sync|dynamic workflow|bundled)\)\s*$/i;

function kindOf(c) {
  if (/^mcp__|\(MCP\)$/.test(c.name) || / \(mcp\)$/i.test(c.description ?? "")) return "mcp";
  if (c.name.includes(":")) return "plugin";
  if (SCOPE.test(c.description ?? "")) return "skill";
  return "harness";
}

async function claudeCommands(folder, on) {
  const info = await claudeInfo(folder, on);
  const list = [];
  const have = new Set();
  for (const c of info?.commands ?? []) {
    if (have.has(c.name) || HIDDEN.has(c.name) || c.name.startsWith("__") || c.name === "stats" || c.name === "cost") continue;
    have.add(c.name);
    const host = HOST[c.name];
    const kind = host ? "app" : kindOf(c);
    const mcp = kind === "mcp";
    const desc = (c.description ?? "").replace(SCOPE, "").replace(/^\([^)]*\)\s*/, (m) => (kind === "plugin" ? "" : m)).split("\n")[0];
    list.push({
      name: c.name, label: mcp ? c.name.replace(/ \(MCP\)$/, "") : undefined,
      desc: host?.desc ?? desc, hint: host?.hint ?? c.argumentHint ?? "",
      aliases: [...new Set([...(c.aliases ?? []), ...(host?.aliases ?? [])])].filter((a) => !a.includes(":")),
      kind, action: host?.action ?? null, picker: PICKERS.has(c.name),
    });
  }
  // The terminal's own commands that Claude doesn't list for other programs.
  for (const [name, desc, hint, aliases] of CLAUDE) {
    if (have.has(name) || HIDDEN.has(name) || !(HOST[name] || PICKERS.has(name) || !info)) continue;
    have.add(name);
    const host = HOST[name];
    list.push({ name, desc: host?.desc ?? desc, hint: host?.hint ?? hint, aliases: [...new Set([...aliases, ...(host?.aliases ?? [])])],
      kind: host ? "app" : "harness", action: host?.action ?? null, picker: PICKERS.has(name) });
  }
  const models = (info?.models ?? []).map((m) => ({ id: m.value, resolved: m.resolvedModel, name: m.displayName, desc: m.description, efforts: m.supportedEffortLevels ?? [] }));
  return { list: list.sort((x, y) => x.name.localeCompare(y.name)), models, account: info?.account ?? null, version: info?.claude_code_version ?? null };
}

// Codex's commands the chat answers itself, as the ChatGPT app does.
const CODEX_HOST = {
  side: { action: "side", aliases: ["btw"], desc: "Ask a side question without interrupting the main chat", hint: "[question]" },
  model: { action: "model" }, resume: { action: "resume" }, status: { action: "status" }, usage: { action: "usage" }, permissions: { action: "permissions" },
  memories: { action: "memory", desc: "See and edit what Codex remembers (AGENTS.md files)" },
  hooks: { action: "hooks" }, mcp: { action: "mcp", desc: "See MCP servers and their tools" }, skills: { action: "skills", desc: "See the skills Codex can use" },
  plugins: { action: "plugins" }, settings: { action: "config", desc: "See and edit Codex's settings" },
  diff: { action: "diff" }, copy: { action: "copy" },
};

async function codexCommands(folder, on) {
  const [r, [models]] = await Promise.all([
    sh('for f in "$HOME"/.codex/prompts/*.md; do [ -f "$f" ] && { printf "\\036%s\\n" "$(basename "$f" .md)"; head -n 20 "$f"; }; done; true', [], on),
    codexCalls(folder, [["model/list", {}]], on).catch(() => [null]),
  ]);
  const list = CODEX.map((c) => {
    const host = CODEX_HOST[c[0]];
    return { ...entry(c), desc: host?.desc ?? c[1], hint: host?.hint ?? c[2] ?? "", aliases: [...(c[3] ?? []), ...(host?.aliases ?? [])],
      kind: host ? "app" : "harness", action: host?.action ?? null, picker: CODEX_PICKERS.has(c[0]) };
  });
  for (const part of r.stdout.split("\x1e").slice(1)) {
    const nl = part.indexOf("\n"), fm = front(part.slice(nl + 1));
    list.push({ ...entry([`prompts:${part.slice(0, nl)}`, fm.desc, fm.hint]), kind: "skill" });
  }
  const catalog = (models?.data ?? []).filter((m) => !m.hidden).map((m) => ({
    id: m.model, name: m.displayName ?? m.model, desc: m.description ?? "", efforts: (m.supportedReasoningEfforts ?? []).map((e) => e.reasoningEffort),
  }));
  return { list: list.sort((x, y) => x.name.localeCompare(y.name)), models: catalog };
}

// Hermes's own palette (what its TUI lists after "/"): built-in commands, quick
// and plugin commands, and skills, sent to Hermes as typed.
const HERMES_CATALOG = `
import json
from tui_gateway.command_discovery import command_catalog
c = command_catalog()
print(json.dumps({k: c.get(k) for k in ("pairs", "canon", "skills", "plugin_commands")}))`;

async function hermesCommands() {
  const r = await docker(["exec", "-u", "hermes", "-w", "/opt/hermes", "hermes", "python3", "-c", HERMES_CATALOG]);
  const c = JSON.parse(r.stdout);
  const aliases = {};
  for (const [alias, name] of Object.entries(c.canon ?? {})) if (alias !== name.toLowerCase()) (aliases[name] ??= []).push(alias.slice(1));
  const list = (c.pairs ?? []).map(([key, text]) => {
    const name = key.slice(1);
    // "Start a new session (usage: /new [name])": the usage is the hint.
    const usage = /\s*\(usage: \/\S+\s*(.*)\)$/.exec(text);
    return { name, desc: usage ? text.slice(0, usage.index) : text, hint: usage?.[1] ?? "", aliases: aliases[key] ?? [],
      kind: c.skills?.[key] ? "skill" : c.plugin_commands?.[name] ? "plugin" : "harness", picker: false,
      // Bare, these open the chat's own model menu or resume list; with arguments they go to Hermes.
      action: name === "model" ? "model" : name === "reasoning" ? "effort" : name === "sessions" || name === "resume" ? "resume" : null };
  });
  return { list: list.sort((x, y) => x.name.localeCompare(y.name)), models: [] };
}

export async function loadCommands(kind, folder, on) {
  if (kind === "claude") return claudeCommands(folder, on);
  if (kind === "codex") return codexCommands(folder, on);
  if (kind === "hermes") return hermesCommands();
  return { list: [], models: [] };
}

// Typed after "/": names that start with it first, then ones with a word that
// does, then any that contain it; aliases count as names. Within each, the
// ones used most come first, as in the Claude app.
export function matchCommands(list, query, usage = {}) {
  const q = query.toLowerCase();
  const used = (c) => usage[c.name] ?? 0;
  const score = (c) => {
    const names = [c.name, c.label ?? "", ...c.aliases].filter(Boolean).map((n) => n.toLowerCase());
    if (names.some((n) => n === q)) return 0;
    if (names.some((n) => n.startsWith(q))) return 1;
    if (names.some((n) => n.split(/[-:_ ]/).some((w) => w.startsWith(q)))) return 2;
    if (names.some((n) => n.includes(q))) return 3;
    return c.desc.toLowerCase().includes(q) ? 4 : 9;
  };
  const scored = list.map((c) => [score(c), c]).filter(([s]) => s < 9);
  // A description only counts when no name matches.
  return scored.filter(([s]) => s < 4 || scored.every(([t]) => t >= 4))
    .sort((a, b) => a[0] - b[0] || used(b[1]) - used(a[1]) || a[1].name.length - b[1].name.length || a[1].name.localeCompare(b[1].name)).map(([, c]) => c);
}
