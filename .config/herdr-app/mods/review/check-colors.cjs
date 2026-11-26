const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Exercise the actual checkbox builder with the color formats Herdr accepts.
const paints = {};
const el = new Proxy({}, { get: (_target, key) => key === "when"
  ? (on, draw) => { if (on) draw(el); return el; }
  : (...args) => {
    if (["bg", "border_color", "text_color"].includes(key)) {
      assert.match(args[0], /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i, `invalid ${key}: ${args[0]}`);
      paints[key] = args[0];
    }
    return el;
  } });
const scope = vm.createContext({ div: () => el, svg: () => el });
vm.runInContext(["color.js", "review-menu.js", "controls.js"].map(file => fs.readFileSync(`${__dirname}/${file}`, "utf8")).join("\n")
  .replace(/^import .*;\r?\n/gm, "").replace(/^export \{[^}]+\};\r?\n/gm, "").replace(/^export /gm, ""), scope);
const checkMark = vm.runInContext("checkMark", scope);
for (const [input, background] of [["#ffffff24", "#ffffff0c"], ["#ffffff", "#ffffff52"], ["#fff", "#ffffff52"], ["#abcdef80", "#abcdef29"], ["#abcdef00", "#abcdef00"]]) {
  const t = { input, accent: "#3388ff", accent_foreground: "#ffffff" };
  for (const state of ["none", "all", "some", "changed"]) {
    checkMark(t, state);
    assert.equal(paints.bg, state === "none" ? background : state === "changed" ? "#f97316" : t.accent);
    assert.equal(paints.border_color, state === "none" ? input : paints.bg);
  }
}
console.log("review checkbox theme colors: ok");
