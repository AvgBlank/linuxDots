// What a terminal's Resume button needs to open its last agent session again, or null.
// The session comes from the `bettr.activity` label (mods/bettr-activity/SCHEMA.md): the label
// stays on the terminal when the agent exits, and when the core replaces a lost agent with a shell.

const AGENTS = {
  claude: { name: "Claude Code", command: (id) => `claude --resume ${id}` },
  codex: { name: "Codex", command: (id) => `codex resume ${id}` },
};

// The ID is typed into a shell: accept only characters that need no quoting.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function parse(text) {
  try {
    const value = JSON.parse(text ?? "");
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

// "claude-opus-5-5-20260101" → "opus-5-5", as the reporter's `modelLabel`.
const shortModel = (model) => model.replace(/^claude-/, "").replace(/-\d{8}$/, "");

// `labels`: the terminal's labels. `program`: what runs in it now (Herdr's Program).
// Null unless a shell is in front: a running agent or editor must not get the text.
// Returns { command, title, prompt }: the shell command, the button's text, and the
// last prompt a person sent ("" when none).
export function resume(labels, program) {
  if (!program?.shell) return null;
  const index = parse(labels?.["bettr.activity"]);
  const agent = index && Object.hasOwn(AGENTS, index.provider) ? AGENTS[index.provider] : null;
  const id = index?.sessionId;
  if (!agent || typeof id !== "string" || !SAFE_ID.test(id)) return null;

  // The Context label is the same session's only when both IDs match.
  const context = parse(labels["bettr.context"]);
  const model = context?.provider === index.provider && context.sessionId === id && typeof context.model === "string"
    ? shortModel(context.model)
    : "";
  const turns = Array.isArray(index.turns) ? index.turns : [];
  const last = turns.findLast((turn) => turn?.source !== "notice" && typeof turn?.prompt === "string" && turn.prompt.trim());
  return {
    command: agent.command(id),
    title: `Resume: ${agent.name}${model ? ` (${model})` : ""}`,
    prompt: last ? last.prompt.trim() : "",
  };
}
