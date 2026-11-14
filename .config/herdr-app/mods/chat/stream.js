// What an agent is doing right now, read off its terminal: the reply it's
// writing, or the command or tool it's running and its output so far. The
// terminal draws both as they happen; the log only gets them once done.

// Claude Code: a reply is a "⏺ " line and the lines indented under it. One
// whose first words name a tool ("⏺ Bash(…)") is a tool call, its output
// under "⎿"; a "! " line is a shell command typed into it. Codex: the same
// with "• ", its tool lines naming what it does, output under "└".
const CLAUDE = { mark: "⏺ ", prompt: /^❯ \S/, run: /^! \S/, tool: /^⏺ [\w.:-]+\(|^⏺ (Read|Searched|Listed|Wrote|Updated|Edited|Fetched|Ran|Called|Found)\b.*\b(file|files|pattern|patterns|lines?|director(y|ies)|command|tools?)\b/ };
const CODEX = { mark: "• ", prompt: /^› \S/, run: /^\$ \S/, tool: /^• (Running|Ran|Explored|Exploring|Edited|Editing|Read|Reading|Searched|Searching|Called|Calling|Updated Plan|Added|Deleted|Listed|Viewed|Applied|Proposed)\b/ };
const STATUS = /^• (Working|Waiting|Interrupted)\b/;
// The full-screen view's one-line summaries of tool calls ("Running 1 shell
// command…", "Read 2 files"): a command running, not text.
const SUMMARY = /^(Running|Ran|Reading|Read|Searching|Searched|Listing|Listed|Writing|Wrote|Editing|Edited|Updating|Updated|Fetching|Fetched|Calling|Called|Creating|Created|Stopping|Stopped)\b.*\b(commands?|files?|patterns?|director(y|ies)|tools?|agents?|pages?|tasks?|searches)\b|^\d+ tool calls?\b/i;

// { kind: "text", text } | { kind: "run", title, out: [lines], time } | null
export function live(screen, kind) {
  const k = kind === "codex" ? CODEX : CLAUDE;
  const lines = (screen ?? "").split("\n").filter((l) => !l.startsWith("[hc]"));
  // The message box at the bottom: its rule line (Claude) or its prompt (Codex).
  let end = lines.length;
  if (kind === "codex") { for (let i = lines.length - 1; i >= 0; i--) if (/^› /.test(lines[i])) { end = i; break; } }
  else for (let i = lines.length - 1; i > 0; i--) if (/^─{10,}/.test(lines[i]) && /^❯/.test(lines[i + 1] ?? "")) { end = i; break; }
  // This turn: after the last message sent.
  let from = 0;
  for (let i = end - 1; i >= 0; i--) if (k.prompt.test(lines[i])) { from = i + 1; break; }
  // The last block in it: a reply, a tool call or a shell command.
  let at = -1;
  for (let i = end - 1; i >= from; i--) {
    const l = lines[i];
    if (l.startsWith(k.mark) && !STATUS.test(l)) { at = i; break; }
    if (k.run.test(l)) { at = i; break; }
  }
  if (at < 0) return null;
  const head = lines[at];
  const body = [];
  for (let i = at + 1; i < end; i++) {
    const l = lines[i];
    if ((l && !l.startsWith(" ")) || /^\s*Worked for \d/.test(l)) break;
    body.push(l);
  }
  const depth = (l) => l.length - l.trimStart().length;
  const isOut = (l) => /^\s*[⎿└]/.test(l);
  // A tool shown inside the block, as the full-screen view draws them: a line
  // with its output under "⎿". The last one counts, unless text follows it.
  let g = -1;
  for (let j = body.length - 1; j >= 0; j--) if (isOut(body[j])) { g = j; break; }
  if (g >= 0) {
    while (g > 0 && isOut(body[g - 1])) g--;
    let last = g;
    while (last + 1 < body.length && (isOut(body[last + 1]) || (body[last + 1].trim() && depth(body[last + 1]) > depth(body[g])))) last++;
    const after = body.slice(last + 1);
    const said = after.filter((l) => l.trim());
    if (said.length && said.every((l) => SUMMARY.test(l.trim()))) return runOf(said[said.length - 1].trim(), []);
    if (said.length) {
      // Text written after the tool: that's what's new.
      return textOf(after.map((l) => l.slice(2)));
    } else {
      let h = g - 1;
      while (h >= 0 && !body[h].trim()) h--;
      const title = h >= 0 ? body[h].trim() : k.run.test(head) ? `$ ${head.slice(2)}` : head.slice(k.mark.length);
      return runOf(title, body.slice(g, last + 1));
    }
  }
  if (k.run.test(head) || k.tool.test(head)) return runOf(k.run.test(head) ? `$ ${head.slice(2)}` : head.slice(k.mark.length), body);
  // A summary line last in a text block: the tool it's running now.
  const lastLine = [...body].reverse().find((l) => l.trim());
  if (lastLine && SUMMARY.test(lastLine.trim())) return runOf(lastLine.trim(), []);
  // A block that is only summaries ("⏺ Running 1 shell command…"): a command.
  const said = [head.slice(k.mark.length), ...body].map((l) => l.trim()).filter(Boolean);
  if (said.length && said.every((l) => SUMMARY.test(l))) return runOf(said[said.length - 1], []);
  return textOf([head.slice(k.mark.length), ...body.map((l) => l.slice(2))]);
}

// A reply: wrapped lines back into paragraphs; blank lines, lists and code stay.
function textOf(block) {
  const out = [];
  for (const l of block) {
    const prev = out[out.length - 1];
    const starts = /^\s*([-*•]|\d+[.)]|#|>|```|\|)/.test(l);
    if (prev && prev.trim() && l.trim() && !starts && !/^\s{2,}/.test(l)) out[out.length - 1] = `${prev} ${l.trim()}`;
    else out.push(l);
  }
  const text = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return text ? { kind: "text", text } : null;
}

// A running tool: its title (its elapsed time split off) and its output lines.
function runOf(title, body) {
  let time = null;
  const tm = /\s+·\s+(\d+[hms](?: \d+[ms])*)$/.exec(title);
  if (tm) { time = tm[1]; title = title.slice(0, tm.index); }
  // Output lines wrap under where the first one's text starts.
  const first = body.find((l) => /^\s*[⎿└]/.test(l)) ?? "";
  const col = first.length - first.replace(/^\s*[⎿└]\s*/, "").length;
  const out = [];
  for (const l of body) {
    const t = (/^\s*[⎿└]/.test(l) ? l.replace(/^\s*[⎿└]\s*/, "") : l.slice(Math.min(col, l.length - l.trimStart().length))).trimEnd();
    if (/^\(ctrl\+\w+ to .*\)$|^\(esc to .*\)$/i.test(t.trim())) continue;
    const m = /^\((\d+[hms](?: \d+[ms])*)\)$/.exec(t.trim());
    if (m) { time = m[1]; continue; }
    out.push(t);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  const indent = Math.min(...out.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length), 99);
  if (indent < 99) for (let i = 0; i < out.length; i++) out[i] = out[i].slice(indent);
  return { kind: "run", title: title.trim(), out, time };
}

export const streaming = (screen, kind) => {
  const x = live(screen, kind);
  return x?.kind === "text" ? x.text : null;
};
