// Checks prompt.js against Claude's real AskUserQuestion screens: node check-prompt.mjs
import assert from "node:assert/strict";
import { parsePrompt, reflow, choose, noLinks, noImages } from "./prompt.js";

const RULE = "─".repeat(60);
const ask = [
  "❯ Call AskUserQuestion once with two questions.",
  RULE,
  "←  ☐ Prompt  ☒ Editor  ✔ Submit  →",
  "",
  "│ Which **shell prompt** would you pick? Things to weigh:",
  "│ - Speed: how fast it renders in a `big repo`",
  "│ - Info: git status, language version, time",
  "│",
  "│ Which one *wins*?",
  "",
  "❯ 1. Minimal",
  "     Just a `$` caret",
  "  2. Starship",
  "     **Git**, language, and time info",
  "  3. Type something.",
  RULE,
  "  4. Chat about this",
  "",
  "Enter to select · Tab/Arrow keys to navigate · Esc to cancel",
].join("\n");

const q = parsePrompt(ask);
assert.deepEqual(q.options, ["Minimal", "Starship", "Type something.", "Chat about this"]);
assert.deepEqual(q.descs, ["Just a `$` caret", "**Git**, language, and time info", "", ""]);
assert.equal(q.selected, 0);
assert.equal(q.typeAt, 2);
assert.equal(q.answered, null);
assert.deepEqual(q.tabs, [{ mark: "☐", name: "Prompt" }, { mark: "☒", name: "Editor" }, { mark: "✔", name: "Submit" }]);
assert.equal(q.question, "Which **shell prompt** would you pick? Things to weigh:\n- Speed: how fast it renders in a `big repo`\n- Info: git status, language version, time\n\nWhich one *wins*?");

// The cursor on the option under the rule still reads the whole list.
const low = parsePrompt(ask.replace("❯ 1. Minimal", "  1. Minimal").replace("  4. Chat about this", "❯ 4. Chat about this"));
assert.deepEqual(low.options, q.options);
assert.equal(low.selected, 3);
assert.equal(low.typeAt, 2);

// A revisited answered question: its answer carries a ✔, which isn't part of the label.
const answered = parsePrompt(ask.replace("  3. Type something.", "  3. Teal ✔"));
assert.equal(answered.options[2], "Teal");
assert.equal(answered.answered, 2);

// The review screen: each answer its own list item.
assert.equal(reflow(["Review your answers", "", " ● Which color?", "   → Red", " ● Which size?", "   → Small", "", "Ready?"]),
  "Review your answers\n\n- Which color? → Red\n- Which size? → Small\n\nReady?");
// Fences keep their lines, blank ones too; ~~~ isn't closed by ```.
assert.equal(reflow(["Run:", "~~~sh", "a", "", "", "```", "~~~", "ok?"]), "Run:\n~~~sh\na\n\n\n```\n~~~\nok?");
// Wrapped text joins up.
assert.equal(reflow(["│ A long", "│ question here"]), "A long question here");

assert.deepEqual(choose(0, 2), ["down", "down", "enter"]);
assert.deepEqual(choose(3, 1), ["up", "up", "enter"]);
assert.equal(noLinks("[Yes](https://x.example) ![p](https://x.example/p.png) <https://x.example>"), "Yes p https://x.example");
assert.equal(noImages("see [docs](https://x.example) ![p](https://x.example/p.png)"), "see [docs](https://x.example) p");
console.log("prompt.js checks passed");
