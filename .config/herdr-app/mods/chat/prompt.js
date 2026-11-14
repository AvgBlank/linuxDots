// Reads a question an agent asks on its terminal screen (a trust or
// permission prompt): the question's text and its choices, if it has any.

const MARKER = /^(\s*)([❯›>])\s+/;
const NUMBER = /^\s*\d+[.)]\s+/;
const HINT = /(Enter to (confirm|select)|Esc to (cancel|exit)|↑\/↓|to navigate)/i;
const RULE = /^\s*[─━—\-▔▁═]{8,}\s*$/;
// Claude's question tabs: "←  ☐ Provider  ☐ Run mode  ✔ Submit  →".
const TABS = /^\s*←\s+(.*\S)\s+→\s*$/;

// A menu waiting at the bottom of the screen: its hint line ("Enter to confirm ·
// Esc to cancel") is among the last lines. "form" when ←/→ change its values,
// which a pick-one list can't show.
export function menuAtBottom(screen) {
  let lines = (screen ?? "").split("\n").filter((l) => l.trim());
  // Claude keeps its input box (a rule, ❯, a rule, its footer) under the menu.
  const rules = lines.flatMap((l, i) => (RULE.test(l) ? [i] : []));
  const box = rules.at(-2);
  if (box !== undefined && lines.length - box <= 6 && /^\s*❯/.test(lines[box + 1] ?? "")) lines = lines.slice(0, box);
  const hint = lines.slice(-2).find((l) => HINT.test(l));
  return hint ? (/←|→|to change/.test(hint) ? "form" : "menu") : null;
}

// { question, options: [label], descs: [description], selected, answered, typeAt, tabs: [{ mark, name }] | null } or null
// when the screen has no menu. A description is the option's indented lines under its label. `selected` is where the
// cursor is, `answered` the option a ✔ marks (an earlier answer, or a menu's current value). `typeAt` is Claude's "Type
// something" line, the last option above the rule: the answer is typed on it.
export function parsePrompt(screen) {
  // A ✔ marks the current choice; read it as an indent, so its line lines up.
  const current = new Set();
  const lines = (screen ?? "").split("\n").map((l, i) => {
    const m = /^(\s*(?:[❯›>]\s+)?)[✔✓]\s/.exec(l);
    if (!m) return l;
    current.add(i);
    return m[1] + "  " + l.slice(m[0].length);
  });
  const at = lines.findLastIndex((l) => MARKER.test(l) && !HINT.test(l));
  if (at < 0) return null;
  // Unselected options sit where the marker's text starts; deeper lines continue one.
  const indent = MARKER.exec(lines[at])[0].length;
  const depth = (l) => l.length - l.trimStart().length;
  const isOption = (l) => MARKER.test(l) || (l.trim() && depth(l) === indent && !HINT.test(l) && !RULE.test(l));
  const continues = (l) => l.trim() && depth(l) > indent && !HINT.test(l) && !RULE.test(l);

  // Back to the first option, across a rule when the cursor is on an option under it ("Chat about this").
  const inList = (l) => isOption(l) || continues(l);
  let first = at;
  for (;;) {
    if (first > 0 && inList(lines[first - 1])) first--;
    else if (first > 1 && RULE.test(lines[first - 1]) && NUMBER.test(lines[first].replace(MARKER, "")) && inList(lines[first - 2])) first -= 2;
    else break;
  }
  while (first < at && !isOption(lines[first])) first++;
  let last = at;
  for (;;) {
    if (last + 1 < lines.length && (isOption(lines[last + 1]) || continues(lines[last + 1]))) last++;
    // A numbered option under a rule ("Chat about this") is still one of them.
    else if (RULE.test(lines[last + 1] ?? "") && NUMBER.test(lines[last + 2] ?? "") && isOption(lines[last + 2])) last += 2;
    else break;
  }
  const options = [], descs = [];
  let selected = 0, answered = null, typeAt = null;
  for (let i = first; i <= last; i++) {
    const l = lines[i];
    if (RULE.test(l)) { typeAt = options.length - 1; continue; }
    let text = l.replace(MARKER, "").replace(NUMBER, "").trim();
    if (!isOption(l)) { descs[descs.length - 1] = `${descs[descs.length - 1]} ${text}`.trim(); continue; }
    if (i === at) selected = options.length;
    // A question answered before shows its answer with a ✔ after it.
    if (/\s[✔✓]$/.test(text)) { text = text.replace(/\s+[✔✓]$/, ""); answered = options.length; }
    if (current.has(i)) answered = options.length;
    options.push(text);
    descs.push("");
  }
  if (options.length < 2) return null;

  // The question: what's above the options, back to the last rule line.
  let top = first;
  while (top > 0 && !RULE.test(lines[top - 1])) top--;
  const above = lines.slice(top, first);
  const tabRow = above.findIndex((l) => TABS.test(l));
  const tabs = tabRow < 0 ? null : TABS.exec(above[tabRow])[1].split(/\s{2,}/).map((t) => {
    const m = /^([☐☒✔✓■□])\s*(.*)$/.exec(t.trim());
    return m ? { mark: m[1], name: m[2] } : { mark: "", name: t.trim() };
  });
  const question = reflow(tabRow < 0 ? above : above.slice(tabRow + 1));
  return { question, options, descs, selected, answered, typeAt, tabs };
}

// Terminal-wrapped text back as markdown. A long question is drawn as a quote: a │ starts each of its lines. Wrapped lines
// join up, but a line that starts a markdown block (list item, heading, quote, table row) keeps its break, and a fence keeps
// every line. A ● line (Claude's answer review) is a list item, with its "→ answer" line joined on.
const BLOCK = /^([-*+]\s|\d+[.)]\s|#{1,6}\s|>|\|)/;
const FENCE = /^(```|~~~)/;
export function reflow(lines) {
  // `fence` is the open fence's marker (``` or ~~~): only the same kind closes it.
  let out = "", fence = null;
  for (const raw of lines) {
    const kept = raw.replace(/^\s*│\s?/, "").trimEnd(), l = kept.trim().replace(/^[●•]\s+/, "- ");
    const mark = FENCE.exec(l)?.[1];
    if (mark && (!fence || mark === fence)) {
      fence = fence ? null : mark;
      out += (out && !out.endsWith("\n") ? "\n" : "") + l + (fence ? "" : "\n");
      continue;
    }
    if (fence) { out += "\n" + kept; continue; }
    if (!l) { if (out && !out.endsWith("\n\n")) out += out.endsWith("\n") ? "\n" : "\n\n"; continue; }
    out += !out || out.endsWith("\n") ? l : BLOCK.test(l) ? "\n" + l : " " + l;
  }
  return out.trim();
}

// The keys that move the selection from `from` to `to` and confirm it.
export function choose(from, to) {
  const keys = Array(Math.abs(to - from)).fill(to > from ? "down" : "up");
  return [...keys, "enter"];
}

// Screen text is the agent's output, so what it renders stays inert: an option's link would open on the click that picks it,
// and an image would fetch from wherever it points. Both keep only their words.
export const noImages = (s) => s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
export const noLinks = (s) => noImages(s).replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/<(https?:[^>\s]+)>/g, "$1");
