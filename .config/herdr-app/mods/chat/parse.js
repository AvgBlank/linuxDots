// Turns Claude Code and Codex session logs (JSONL), and Hermes's message rows, into chat entries:
// { kind: "user" | "assistant" | "tools" | "note", key, text, images, items }.
// Images come out as { data (base64) | path, ext } for the view to cache.

// As claude-chat cuts a tool result. A result's text isn't kept: a tool line reads it from the log when it opens.
export const MAX_RESULT = 24000;

// A Hermes tool row's content: JSON with the output, or plain text.
function hermesResult(c) {
  let v;
  try { v = JSON.parse(c); } catch { return { text: c ?? "", error: false }; }
  if (!v || typeof v !== "object" || !("output" in v)) return { text: c, error: Boolean(v?.error) };
  return { text: toText(v.output) || (v.error ? String(v.error) : ""), error: Boolean(v.error) || (v.exit_code ?? 0) !== 0 };
}

const stripAnsi = (s) => s.replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/g, "");

// Anything content-like (string, [{text}], {output}) as plain text.
export function toText(x) {
  if (x == null) return "";
  if (typeof x === "string") return x;
  if (Array.isArray(x)) return x.map(toText).filter(Boolean).join("\n");
  if (typeof x === "object") {
    if (typeof x.text === "string") return x.text;
    if (x.output != null) return toText(x.output);
    if (x.content != null) return toText(x.content);
  }
  return "";
}

// One tool's result from the log line that holds it (Claude Code's tool_result, or Codex's output for the call).
export function resultFrom(line, id) {
  let d;
  try { d = JSON.parse(line); } catch { return null; }
  const block = Array.isArray(d.message?.content) ? d.message.content.find((b) => b?.type === "tool_result" && b.tool_use_id === id) : null;
  const p = d.payload;
  const content = block ? block.content : p && p.call_id === id ? p.output
    : d.role === "tool" && d.tool_call_id === id ? hermesResult(d.content).text : undefined;
  if (content === undefined) return null;
  const text = stripAnsi(toText(content));
  return { text: text.slice(0, MAX_RESULT), clipped: text.length > MAX_RESULT };
}

const extOf = (media) => ({ "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp" })[media] ?? "png";

function fromDataUrl(url) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(url ?? "");
  return m ? { data: m[2], ext: extOf(m[1]) } : null;
}

// A one-line description of a tool call's input.
export function summarize(input) {
  let v = input;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return v.split("\n")[0]; } }
  if (v && typeof v === "object") {
    for (const k of ["description", "command", "cmd", "file_path", "path", "pattern", "url", "query", "prompt", "name"]) {
      const x = v[k];
      if (typeof x === "string" && x) return x.split("\n")[0];
      if (Array.isArray(x) && x.length) return x.join(" ").split("\n")[0];
    }
    if (v.action) return summarize(v.action);
    const first = Object.values(v).find((x) => typeof x === "string");
    if (first) return first.split("\n")[0];
  }
  return "";
}

export class Transcript {
  constructor(kind, { sidechain = false } = {}) {
    this.kind = kind;
    // A subagent's own log: every line is a sidechain one.
    this.sidechain = sidechain;
    this.entries = [];
    this.tools = new Map();
    this.next = 0;
    this.title = null;
    // Messages waiting in Claude Code's own queue (sent while it worked), as its
    // queue operations record them: taken in order, absorbed mid-turn, or popped
    // back into its input.
    this.queue = [];
    // What the log says the session runs on (Claude doesn't log its effort).
    this.model = null;
    this.effort = null;
    // Tokens the session used, per model, from its replies (each counted once).
    this.tokens = {};
    this.counted = new Set();
    // Background agents and shells (Claude): id -> { id, kind, label, started, status }.
    // Started by a tool result, ended by a <task-notification> or TaskStop/KillShell.
    this.bg = new Map();
    this.bgLabels = new Map();
  }

  bgEnd(id, status, usage) {
    const x = this.bg.get(id);
    if (!x) return;
    x.status = status;
    const n = (tag) => { const m = new RegExp(`<${tag}>(\\d+)</${tag}>`).exec(usage ?? ""); return m ? Number(m[1]) : null; };
    x.tokens = n("subagent_tokens") ?? x.tokens;
    x.tools = n("tool_uses") ?? x.tools;
    x.duration = n("duration_ms") ?? x.duration;
  }

  push(entry) {
    entry.key = `e${this.next++}`;
    this.entries.push(entry);
    return entry;
  }

  last() { return this.entries[this.entries.length - 1]; }

  note(text) { if (text) this.push({ kind: "note", text }); }

  user(text, images = []) {
    text = (text ?? "").replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
    // Slash commands and their output, as Claude Code records them.
    const cmd = /<command-name>([^<]*)<\/command-name>/.exec(text);
    if (cmd) {
      const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim();
      // /compact is logged again after the compaction: shown once, before it.
      const [before, note] = this.entries.slice(-2);
      if (note?.compact && before?.kind === "user" && before.text === `${cmd[1].trim()}${args ? " " + args : ""}`) return;
      return this.push({ kind: "user", command: true, text: `${cmd[1].trim()}${args ? " " + args : ""}`, images: [] });
    }
    const out = /<local-command-(?:stdout|stderr)>([\s\S]*?)<\/local-command-(?:stdout|stderr)>/.exec(text);
    if (out) {
      const o = stripAnsi(out[1]).trim();
      if (/^Compacted\b/.test(o) && this.entries.some((e) => e.compact)) return;
      if (o) this.push({ kind: "output", text: o });
      return;
    }
    if (/^<local-command-caveat>/.test(text)) return;
    const bash = /<bash-input>([\s\S]*?)<\/bash-input>/.exec(text);
    if (bash) text = "! " + bash[1];
    const stdout = /<bash-stdout>([\s\S]*?)<\/bash-stdout>/.exec(text);
    if (stdout) return this.note(stripAnsi(stdout[1]).trim().split("\n").slice(-6).join("\n"));
    if (/^\[Request interrupted/.test(text)) return this.note("Interrupted");
    if (/^<task-notification>/.test(text)) return this.note(/<summary>([\s\S]*?)<\/summary>/.exec(text)?.[1]?.trim() || "A background task finished");
    // Other tag-wrapped injections (environment context).
    if (/^<([a-z_-]+)[^>]*>[\s\S]*<\/\1>$/.test(text)) return;
    if (!text && !images.length) return;
    this.push({ kind: "user", text, images });
  }

  // The context card, in place of the terminal's drawing of the same numbers.
  contextCard(md) {
    const tokens = /\*\*Tokens:\*\*\s*([\d.]+[km]?)\s*\/\s*([\d.]+[km]?)\s*\((\d+)%\)/i.exec(md);
    const table = /### Estimated usage by category\s*\n([\s\S]*?)(?:\n\s*\n|\n###|$)/.exec(md)?.[1] ?? "";
    const cats = table.split("\n").slice(2).map((l) => l.split("|").map((x) => x.trim()).filter(Boolean))
      .filter((c) => c.length >= 3).map(([name, tokens, pct]) => ({ name, tokens, pct: parseFloat(pct) || 0 }));
    const win = { k: 1e3, m: 1e6 };
    const max = /([\d.]+)([km]?)$/.exec(tokens?.[2] ?? "");
    const size = (v) => { const m = /([\d.]+)([km]?)$/.exec(v ?? ""); return m ? parseFloat(m[1]) * (win[m[2]] ?? 1) : null; };
    if (max) this.context = { used: size(tokens[1]) ?? this.context?.used ?? 0, window: size(tokens[2]) };
    const card = { kind: "card", card: "context", model: /\*\*Model:\*\*\s*(\S+)/.exec(md)?.[1] ?? null,
      used: tokens?.[1], max: tokens?.[2], pct: tokens ? Number(tokens[3]) : null, cats };
    const prev = this.last();
    if (prev?.kind === "output") { Object.keys(prev).forEach((k) => k !== "key" && delete prev[k]); Object.assign(prev, card); }
    else this.push(card);
  }

  assistant(text) {
    if (!text?.trim()) return;
    const prev = this.last();
    if (prev?.kind === "assistant") prev.text += "\n\n" + text;
    else this.push({ kind: "assistant", text });
  }

  toolUse(id, name, input) {
    let group = this.last();
    if (group?.kind !== "tools") group = this.push({ kind: "tools", items: [] });
    const item = { id, name, summary: summarize(input), result: null, error: false, images: [], at: this.now };
    group.items.push(item);
    if (id) this.tools.set(id, item);
  }

  toolResult(id, content, error) {
    const item = this.tools.get(id);
    if (!item) return;
    const parts = Array.isArray(content) ? content : [content];
    for (const p of parts) {
      if (p?.type === "image" && p.source?.data) item.images.push({ data: p.source.data, ext: extOf(p.source.media_type) });
      if (p?.type === "input_image") { const img = fromDataUrl(p.image_url); if (img) item.images.push(img); }
    }
    // Finished: where its text is in the log, and whether it has any.
    item.result = "";
    item.line = this.lineAt;
    item.empty = !stripAnsi(toText(content)).trim();
    item.error = Boolean(error);
    if (item.at && this.now) item.took = this.now - item.at;
  }

  // `at` is the line's byte offset in the log, where a tool line reads its result back.
  feed(line, at = null) {
    this.lineAt = at;
    let d;
    try { d = JSON.parse(line); } catch { return; }
    // A finished background task, wherever the log carries it (queued or as a message).
    if (line.includes("<task-notification>")) {
      for (const m of line.matchAll(/<task-id>([^<]+)<\/task-id>[\s\S]*?<status>([^<]+)<\/status>([\s\S]*?)<\/task-notification>/g)) this.bgEnd(m[1], m[2], m[3]);
    }
    if (d.timestamp) { const at = typeof d.timestamp === "number" ? d.timestamp * 1000 : Date.parse(d.timestamp); this.firstAt ??= at; this.lastAt = at; this.now = at; }
    if (this.kind === "codex") this.codex(d);
    else if (this.kind === "hermes") this.hermes(d);
    else this.claude(d);
  }

  claude(d) {
    if (d.isSidechain && !this.sidechain) return;
    if (d.type === "queue-operation") {
      const text = typeof d.content === "string" ? d.content : "";
      if (d.operation === "enqueue") this.queue.push(text);
      else if (d.operation === "dequeue") this.queue.shift();
      else if (d.operation === "remove") { const i = this.queue.indexOf(text); this.queue.splice(i >= 0 ? i : 0, 1); }
      else if (d.operation === "popAll") this.queue = [];
      return;
    }
    if (d.type === "ai-title" && d.aiTitle) this.title = d.aiTitle;
    // Each message logs the permission mode it was sent in.
    if (d.type === "user" && d.permissionMode) this.mode = d.permissionMode;
    if (d.type === "system" && d.subtype === "compact_boundary") {
      // Until the next reply says exactly, the summary plus what every request carries.
      // Never more than before compacting.
      const after = d.compactMetadata?.postTokens, before = d.compactMetadata?.preTokens ?? Infinity;
      if (after != null) this.context = { used: Math.min(after + (this.base ?? 0), before), window: this.context?.window ?? null };
      return this.push({ kind: "note", text: "Conversation compacted", compact: true });
    }
    // How long a turn took, logged when it ends.
    if (d.type === "system" && d.subtype === "turn_duration" && d.durationMs) return this.push({ kind: "worked", ms: d.durationMs, at: this.now });
    // Slash commands and what they print, in newer versions of Claude Code.
    if (d.type === "system" && d.subtype === "local_command" && typeof d.content === "string") return this.user(d.content);
    // A message sent while the agent worked and taken into that turn is logged
    // as an attachment, not a user message. Only the person's own.
    const q = d.attachment;
    if (q?.type === "queued_command" && (q.origin?.kind ?? "human") === "human" && (q.commandMode ?? "prompt") === "prompt") {
      if (typeof q.prompt === "string") return this.user(q.prompt);
      const blocks = Array.isArray(q.prompt) ? q.prompt : [];
      const images = blocks.filter((b) => b.type === "image" && b.source?.data).map((b) => ({ data: b.source.data, ext: extOf(b.source.media_type) }));
      return this.user(blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n"), images);
    }
    if (d.type === "user") {
      // /context also logs its numbers as markdown: they become a card.
      const meta = d.message?.content;
      if (d.isMeta && typeof meta === "string" && meta.startsWith("## Context Usage")) return this.contextCard(meta);
      if (d.isCompactSummary && typeof meta === "string") {
        const note = [...this.entries].reverse().find((e) => e.compact);
        // Without the note to Claude at its end ("If you need specific details…").
        if (note) note.summary = meta.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
          .replace(/\n+If you need specific details from before compaction[\s\S]*$/, "").trim();
        return;
      }
      if (d.isMeta || d.isCompactSummary || d.isVisibleInTranscriptOnly) return;
      const c = d.message?.content;
      if (typeof c === "string") return this.user(c);
      if (!Array.isArray(c)) return;
      const texts = [], images = [];
      for (const b of c) {
        if (b.type === "text") texts.push(b.text);
        else if (b.type === "image" && b.source?.data) images.push({ data: b.source.data, ext: extOf(b.source.media_type) });
        else if (b.type === "tool_result") {
          this.toolResult(b.tool_use_id, b.content, b.is_error);
          const r = d.toolUseResult;
          const id = r?.isAsync ? r.agentId : r?.backgroundTaskId;
          const asked = this.bgLabels.get(b.tool_use_id) ?? {};
          const text = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "");
          if (id && !this.bg.has(id)) this.bg.set(id, { id, kind: r.isAsync ? "agent" : "shell",
            label: r.description || asked.label || id, type: asked.type ?? null, model: r.resolvedModel ?? null,
            output: /Output is being written to: (\S+?\.output)/.exec(text)?.[1] ?? null,
            started: Date.parse(d.timestamp) || Date.now(), status: "running" });
        }
      }
      if (texts.length || images.length) this.user(texts.join("\n"), images);
    } else if (d.type === "assistant") {
      if (d.message?.model && !d.message.model.startsWith("<")) this.model = d.message.model;
      const u = d.message?.usage, id = d.message?.id;
      // How full the context is: what the latest reply was sent and wrote.
      if (u && !d.message.model?.startsWith("<")) {
        if (this.base == null) this.base = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        this.context = { used: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0), window: this.context?.window ?? null };
      }
      if (u && id && !this.counted.has(id) && !d.message.model?.startsWith("<")) {
        this.counted.add(id);
        const m = (this.tokens[d.message.model] ??= { input: 0, output: 0 });
        m.input += (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        m.output += u.output_tokens ?? 0;
      }
      for (const b of d.message?.content ?? []) {
        if (b.type === "text") this.assistant(b.text);
        else if (b.type === "tool_use") {
          this.toolUse(b.id, b.name, b.input);
          if (b.input?.run_in_background || b.name === "Agent" || b.name === "Task")
            this.bgLabels.set(b.id, { label: b.input.description || b.input.command, type: b.input.subagent_type ?? null });
          const stop = b.input?.task_id ?? b.input?.shell_id;
          if ((b.name === "TaskStop" || b.name === "KillShell") && stop) this.bgEnd(stop, "stopped");
        }
      }
    }
  }

  // One row of Hermes's messages table (OpenAI style). A message another
  // terminal sent through hc comes wrapped in <hc from="…">.
  hermes(d) {
    if (d.session) {
      const s = d.session;
      this.model = s.model ?? this.model;
      this.title = s.title ?? this.title;
      let a = null;
      try { a = JSON.parse(s.model_config ?? "{}")?._usage_anchor; } catch {}
      // ponytail: the window comes from the model's name ([1m] = 1M, else 200k); Hermes doesn't store its own lookup.
      if (a?.prompt_tokens) this.context = { used: a.prompt_tokens + (a.completion_tokens ?? 0), window: /\[1m\]/i.test(s.model ?? "") ? 1e6 : 2e5 };
      return;
    }
    const c = d.content ?? "";
    if (d.role === "user") return this.user(c.replace(/^<hc from="[^"]*">([\s\S]*)<\/hc>$/, "$1"));
    if (d.role === "tool") { const r = hermesResult(c); return this.toolResult(d.tool_call_id, r.text, r.error); }
    if (d.role !== "assistant") return;
    if (d.display_kind === "failed_turn") return this.note(c.trim() || "The turn failed");
    this.assistant(c);
    let calls = [];
    try { calls = JSON.parse(d.tool_calls ?? "[]") ?? []; } catch {}
    for (const t of calls) this.toolUse(t.id ?? t.call_id, t.function?.name ?? "tool", t.function?.arguments);
  }

  codex(d) {
    const p = d.payload ?? {};
    if (d.type === "compacted") return this.note("Conversation compacted");
    if (d.type === "turn_context") {
      this.model = p.model ?? this.model;
      this.effort = p.effort ?? p.collaboration_mode?.settings?.reasoning_effort ?? this.effort;
      // Which of /permissions' presets this turn ran with.
      const box = p.sandbox_policy?.type;
      if (box) this.mode = box === "read-only" ? "read" : box === "danger-full-access" ? "full" : p.approvals_reviewer === "auto_review" ? "auto" : "ask";
      return;
    }
    if (d.type === "event_msg" && p.type === "turn_aborted") return this.note("Interrupted");
    // Codex's running totals: tokens, how full the context is, and its limits.
    if (d.type === "event_msg" && p.type === "token_count") {
      const total = p.info?.total_token_usage;
      if (total) this.tokens = { [this.model ?? "codex"]: { input: total.input_tokens ?? 0, output: (total.output_tokens ?? 0) + (total.reasoning_output_tokens ?? 0) } };
      if (p.info) this.context = { used: p.info.last_token_usage?.total_tokens ?? 0, window: p.info.model_context_window ?? null };
      if (p.rate_limits) this.limits = p.rate_limits;
      return;
    }
    if (d.type !== "response_item") return;
    if (p.type === "message") {
      if (p.role === "assistant") return this.assistant(toText(p.content.filter((c) => c.type === "output_text")));
      if (p.role !== "user") return;
      const texts = [], images = [];
      for (const c of p.content ?? []) {
        if (c.type === "input_image") { const img = fromDataUrl(c.image_url); if (img) images.push(img); continue; }
        let t = (c.text ?? "").trim();
        if (!t || /^<\/?image\b/.test(t) || /^<([a-z_-]+)[^>]*>[\s\S]*<\/\1>$/.test(t) || /^# AGENTS\.md/.test(t)) continue;
        // The desktop app lists attachments, then "## My request:".
        const req = t.indexOf("## My request:");
        if (t.startsWith("# Files mentioned by the user:")) t = req >= 0 ? t.slice(req + 14).trim() : "";
        if (t) texts.push(t);
      }
      if (texts.length || images.length) this.user(texts.join("\n"), images);
    } else if (/_call$/.test(p.type)) {
      this.toolUse(p.call_id ?? p.id, p.name ?? p.type.replace(/_call$/, ""), p.arguments ?? p.input ?? p.action);
    } else if (/_call_output$/.test(p.type)) {
      this.toolResult(p.call_id, p.output, p.status === "failed");
    }
  }
}
