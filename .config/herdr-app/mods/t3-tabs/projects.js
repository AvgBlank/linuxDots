// Remembered project folders (t3.projects, docs/internals/storage.md): a closed space stays in New without keeping a live
// terminal behind to hold its place.
import { placeOf } from "./project.js";

export const PROJECT_CAP = 50;
const PROJECT_HOME_NAME = "Home\u200b";
const projectKey = (machine, folder) => `${machine ?? ""}\0${folder}`;

function projectEntry(s, ps, localHome) {
  const machine = s.machine ?? null;
  if (machine === null && !s.named && (!s.folder || s.folder === localHome)) return null;
  const folder = s.folder || placeOf(s, ps);
  if (!folder) return null;
  const name = (s.named || folder === s.folder ? s.name : "") || folder.split(/[\\/]/).filter(Boolean).pop() || folder;
  return s.named ? { machine, folder, name, named: true } : { machine, folder, name };
}

/**
 * Updates the saved project list from live `spaces`: active first, then newly seen or renamed live spaces, then prior closed
 * entries, capped at `PROJECT_CAP`. Returns `null` when nothing changed so callers don't rewrite shared state every frame.
 * @param {any[]} sp @param {any[]} ps @param {string | null | undefined} homeId @param {string | null | undefined} localHome @param {any[]} [was]
 */
export function rememberProjects(sp, ps, homeId, localHome, was = []) {
  const prior = Array.isArray(was) ? was.filter((p) => p && typeof p.folder === "string" && p.folder) : [];
  const byKey = new Map(prior.map((p) => [projectKey(p.machine ?? null, p.folder), p]));
  const live = [];
  for (const s of sp) {
    if (s.id === homeId || (s.machine === null && s.named && s.name === PROJECT_HOME_NAME)) continue;
    const item = projectEntry(s, ps, localHome);
    if (item) live.push({ item, active: Boolean(s.active), fresh: !byKey.has(projectKey(item.machine, item.folder)) });
  }
  for (const { item } of live) byKey.set(projectKey(item.machine, item.folder), item);
  const lead = [];
  const seen = new Set();
  const push = (p) => {
    const k = projectKey(p.machine ?? null, p.folder);
    if (seen.has(k)) return;
    seen.add(k);
    lead.push(byKey.get(k) ?? (p.named ? { machine: p.machine ?? null, folder: p.folder, name: p.name, named: true } : { machine: p.machine ?? null, folder: p.folder, name: p.name }));
  };
  for (const x of live) if (x.active) push(x.item);
  for (const x of live) if (!x.active && x.fresh) push(x.item);
  for (const p of prior) push(p);
  const next = lead.slice(0, PROJECT_CAP);
  return JSON.stringify(next) === JSON.stringify(prior) ? null : next;
}

/**
 * Saved projects not already open in `sp` (matched by either creation `folder` or live terminal `placeOf`). Remote entries
 * carry `off: true` unless `reportedMachines` reports that machine with `layout === "ready"`.
 * @param {any[]} sp @param {any[]} ps @param {string | null | undefined} homeId @param {any[]} [saved] @param {any[]} [reportedMachines]
 */
export function dormantProjects(sp, ps, homeId, saved = [], reportedMachines = []) {
  const open = new Set();
  for (const s of sp) {
    if (s.id === homeId) continue;
    const m = s.machine ?? null;
    if (s.folder) open.add(projectKey(m, s.folder));
    const live = placeOf(s, ps);
    if (live) open.add(projectKey(m, live));
  }
  const ready = new Set((reportedMachines ?? []).filter((m) => m?.name && m.layout === "ready").map((m) => m.name));
  return (Array.isArray(saved) ? saved : [])
    .filter((p) => p && typeof p.folder === "string" && p.folder && !open.has(projectKey(p.machine ?? null, p.folder)))
    .map((p) => ({
      machine: p.machine ?? null,
      folder: p.folder,
      name: p.name || p.folder,
      ...(p.named ? { named: true } : {}),
      off: Boolean(p.machine && !ready.has(p.machine)),
    }));
}

/**
 * Removes the remembered Project matching `(machine, folder)`. Returns `null` when nothing matched so callers don't rewrite shared state.
 * @param {any[] | null | undefined} saved @param {string | null | undefined} machine @param {string} folder
 */
export function forgetProject(saved, machine, folder) {
  if (!Array.isArray(saved) || !folder) return null;
  const drop = projectKey(machine ?? null, folder);
  const next = saved.filter((p) => !p || typeof p.folder !== "string" || projectKey(p.machine ?? null, p.folder) !== drop);
  return next.length === saved.length ? null : next;
}
