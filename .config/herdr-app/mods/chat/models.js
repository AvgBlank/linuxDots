// Models and effort levels for Claude Code and Codex: what can be picked,
// how to start an agent with them, and how to switch a running one.
import { exec, hc } from "herdr";

export const CLAUDE_MODELS = [
  { id: "claude-opus-5-5", name: "Opus 5.5", alias: "opus" },
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5", alias: "sonnet" },
  { id: "claude-fable-5-2", name: "Fable 5.2", alias: "fable" },
  { id: "claude-haiku-5-5", name: "Haiku 5.5", alias: "haiku" },
];
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

const cat = async (path, on) =>
  (await exec("sh", ["-c", 'cat "$HOME/$1" 2>/dev/null', "sh", path], { on })).stdout;

// { models: [{ id, name, efforts }], model, effort }: the choices and the defaults.
export async function catalog(kind, on) {
  if (kind === "hermes") return hermesCatalog(on);
  if (kind === "claude") {
    let s = {};
    try { s = JSON.parse(await cat(".claude/settings.json", on)); } catch {}
    const model = CLAUDE_MODELS.find((m) => m.alias === s.model || m.id === s.model)?.id ?? CLAUDE_MODELS[0].id;
    const effort = s.modelSettings?.[model]?.effortLevel ?? s.effortLevel ?? "medium";
    return { models: CLAUDE_MODELS.map((m) => ({ ...m, efforts: CLAUDE_EFFORTS })), model, effort };
  }
  let c = {};
  try { c = JSON.parse(await cat(".codex/models_cache.json", on)); } catch {}
  const models = (c.models ?? []).filter((m) => m.visibility === "list").map((m) => ({
    id: m.slug, name: m.display_name ?? m.slug,
    efforts: (m.supported_reasoning_levels ?? []).map((l) => l.effort),
  }));
  const toml = await cat(".codex/config.toml", on);
  return {
    models,
    model: /^model\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? models[0]?.id,
    effort: /^model_reasoning_effort\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? "medium",
  };
}

// Hermes: the models its provider lists (cached by Hermes), and the model and
// effort its config.yaml starts with.
const yamlKey = (text, key) => new RegExp(`^ {2}${key}:\\s*"?([^"\\n#]*?)"?\\s*(?:#.*)?$`, "m").exec(text)?.[1] || null;
const prettyModel = (id) => {
  const [base, tag] = id.split("[");
  const [family, ...rest] = base.replace(/^claude-/, "").replace(/-\d{8}$/, "").split("-");
  return `${family[0].toUpperCase()}${family.slice(1)} ${rest.join(".")}${tag ? ` ${tag.replace("]", "").toUpperCase()}` : ""}`.trim();
};
async function hermesCatalog(on) {
  const conf = await cat(".hermes/data/config.yaml", on);
  const block = /^model:\n((?:[ #].*\n|\n)*)/m.exec(conf)?.[1] ?? "";
  const provider = yamlKey(block, "provider"), model = yamlKey(block, "default") ?? yamlKey(block, "model");
  let cache = {};
  try { cache = JSON.parse(await cat(".hermes/data/provider_models_cache.json", on)); } catch {}
  const ids = cache[provider]?.models ?? (model ? [model] : []);
  return { models: ids.map((id) => ({ id, name: prettyModel(id), efforts: CLAUDE_EFFORTS })), model, effort: yamlKey(conf, "reasoning_effort") };
}

export const modelName = (models, id) =>
  models?.find((m) => m.id === id)?.name ?? CLAUDE_MODELS.find((m) => m.id === id || id?.startsWith(m.id))?.name ?? id ?? "";

export function launchArgv(kind, model, effort, task) {
  const argv = kind === "codex"
    ? ["codex", ...(model ? ["-m", model] : []), ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : [])]
    : ["claude", ...(model ? ["--model", model] : []), ...(effort ? ["--effort", effort] : [])];
  if (task) argv.push(task);
  return argv;
}

// Codex switches for the session only. Claude's /model and /effort also save
// themselves as the default for new sessions, so its settings file is put back.
export async function switchModel(term, kind, model, effort, on, sleep) {
  // Hermes's /model and /reasoning hold for this session only.
  if (kind === "hermes") {
    if (model) { await hc(["send", term, `/model ${model}`]); await sleep(1200); }
    if (effort) await hc(["send", term, `/reasoning ${effort}`]);
    return;
  }
  if (kind === "codex") return hc(["send", term, `/model ${model}${effort ? ` --reasoning=${effort}` : ""}`]);
  const f = '"$HOME/.claude/settings.json"';
  await exec("sh", ["-c", `cp ${f} ${f}.chat-bak`], { on });
  try {
    if (model) { await hc(["send", term, `/model ${model}`]); await sleep(1200); }
    if (effort) { await hc(["send", term, `/effort ${effort}`]); await sleep(1200); }
  } finally {
    await exec("sh", ["-c", `cp ${f}.chat-bak ${f} && rm -f ${f}.chat-bak`], { on });
  }
}
