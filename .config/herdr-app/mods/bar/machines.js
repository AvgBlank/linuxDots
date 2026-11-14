// Customize > Machines: whether the agent reporter (mods/bettr-reporter/setup.py: the data behind Activity, Context and
// Subagents) is set up and current on this computer and each connected machine, with a button that installs or updates it.
// From bettr-chrome's Layout dialog (layout-config.js), drawn as Herdr's Settings rows.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, appHome, machines, run } from "herdr";

const LOCAL = ""; // this computer's key: setup.py without a machine
const remotes = () => machines().filter((m) => m.name && !m.temporary).map((m) => m.name);
const all = () => [LOCAL, ...remotes()];
const nameOf = (m) => m || "This computer";

// Per machine: { state, agents?, files?, detail?, installed? }; state is checking, installing, current, old, missing or error.
// Kept while the app runs; checked again each time the panel opens.
const reporter = new Map();
const LABELS = { checking: "Checking…", installing: "Installing…", current: "Up to date", old: "Out of date", missing: "Not set up", error: "Unreachable" };
const AGENT_NAMES = { claude: "Claude", codex: "Codex" };
const HOOK_STATES = { current: "hooks current", old: "hooks out of date", missing: "no hooks", absent: "not used" };

async function setup(mode, name) {
  try {
    const r = await exec("python3", ["-I", `${appHome()}/mods/bettr-reporter/setup.py`, mode, ...(name ? [name] : [])]);
    if (r.code === 0) return JSON.parse(r.stdout.trim().split("\n").pop());
    return { state: "error", detail: (r.stderr || r.stdout).trim().split("\n").pop() };
  } catch (error) {
    return { state: "error", detail: error instanceof Error ? error.message : String(error) };
  }
}

async function step(cx, name, busy, mode) {
  reporter.set(name, { ...reporter.get(name), state: busy });
  cx.notify();
  const result = await setup(mode, name);
  reporter.set(name, mode === "install" && result.state !== "error" ? { ...result, installed: true } : result);
  cx.notify();
}

// When the panel opens.
export const checkMachines = (cx) => Promise.all(all().map((name) => step(cx, name, "checking", "status")));

function detail(r) {
  if (r.detail) return r.detail;
  if (r.state === "checking" || r.state === "installing") return "";
  const agents = Object.entries(r.agents ?? {}).map(([a, s]) => `${AGENT_NAMES[a] ?? a}: ${HOOK_STATES[s] ?? s}`);
  return [r.files ? `Reporter files ${LABELS[r.files]?.toLowerCase() ?? r.files}` : null, ...agents].filter(Boolean).join(" · ");
}

// heading, row and button: Settings' helpers, from settings.js.
export function machinesPage(t, { heading, row, button }) {
  const rowFor = (name) => {
    const r = reporter.get(name) ?? { state: "checking" };
    const color = { current: t.done, old: t.working, error: t.blocked }[r.state] ?? t.dim;
    const action = { old: "Update", missing: "Set up", error: "Retry" }[r.state];
    return row(t, nameOf(name), detail(r), h_flex().gap(10).items_center()
      .child(div().text_size(12.5).text_color(color).child(LABELS[r.state] ?? r.state))
      .when(Boolean(action), (el) => el.child(button(t, `cz-m-${name || "local"}`, action, (_e, cx) => cx.spawn(async (cx) => {
        if (r.state === "error") await step(cx, name, "checking", "status");
        else await step(cx, name, "installing", "install");
      })))));
  };
  return v_flex().w_full()
    .child(heading(t, "Agent reporter"))
    .child(div().pb(8).text_size(12.5).line_height("18px").text_color(t.dim)
      .child("Activity, Context and the chat's subagents read what Claude Code and Codex report through hooks. Set them up on each machine you run agents on."))
    .children(all().map(rowFor))
    .when(remotes().length === 0, (el) => el.child(div().pt(12).text_size(12.5).text_color(t.dim).child("No other machines yet.")))
    .when(all().some((name) => reporter.get(name)?.installed), (el) => el
      .child(div().pt(12).text_size(12.5).text_color(t.dim).child("Restart agent sessions there to load the new hooks.")))
    .child(h_flex().pt(16).child(button(t, "cz-m-add", "Add a machine", () => run("mod.open", { name: "machine-add" }))));
}
