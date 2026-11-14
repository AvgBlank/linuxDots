// Checks parse.js against Hermes's real message rows: node check-hermes.mjs
import assert from "node:assert/strict";
import { Transcript, resultFrom } from "./parse.js";

const rows = [
  { id: 112, role: "user", content: '<hc from="t9n">Run "sleep 6; echo done", then write about otters.</hc>', timestamp: 1794265459.36 },
  { id: 113, role: "assistant", content: "", finish_reason: "tool_calls", timestamp: 1794265461.93,
    tool_calls: JSON.stringify([{ id: "toolu_1", type: "function", function: { name: "terminal", arguments: '{"command":"sleep 6; echo done"}' } }]) },
  { id: 114, role: "tool", tool_call_id: "toolu_1", content: '{"output": "done", "exit_code": 0, "error": null}', timestamp: 1794265468.09 },
  { id: 115, role: "assistant", content: "It printed `done`. Otters hold hands.", finish_reason: "stop", timestamp: 1794265471.51 },
  { id: 116, role: "session_meta", content: "{}" },
  { id: 117, role: "tool", tool_call_id: "toolu_2", content: '{"output": "", "exit_code": 1, "error": "Write denied"}' },
  { id: 118, role: "assistant", content: "Model call failed", display_kind: "failed_turn" },
];
const t = new Transcript("hermes");
for (const r of rows) t.feed(JSON.stringify(r), r.id);

assert.deepEqual(t.entries.map((e) => e.kind), ["user", "tools", "assistant", "note"]);
assert.equal(t.entries[0].text, 'Run "sleep 6; echo done", then write about otters.');
const [tool] = t.entries[1].items;
assert.equal(tool.name, "terminal");
assert.equal(tool.summary, "sleep 6; echo done");
assert.equal(tool.line, 114);
assert.equal(tool.error, false);
assert.equal(Math.round(tool.took), 6160);
assert.deepEqual(resultFrom(JSON.stringify(rows[2]), "toolu_1"), { text: "done", clipped: false });
assert.deepEqual(resultFrom(JSON.stringify(rows[5]), "toolu_2"), { text: "Write denied", clipped: false });
assert.equal(t.entries[3].text, "Model call failed");

t.feed(JSON.stringify({ session: { model: "claude-opus-5-5[1m]", title: "Otters",
  model_config: JSON.stringify({ _usage_anchor: { prompt_tokens: 26036, completion_tokens: 716 } }) } }), null);
assert.deepEqual([t.model, t.title, t.context], ["claude-opus-5-5[1m]", "Otters", { used: 26752, window: 1e6 }]);
assert.equal(t.entries.length, 4);
console.log("Hermes parse checks passed");
