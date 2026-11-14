// Reads the provider-neutral `bettr.context` label (see SCHEMA.md) and turns it
// into what the panel draws. Nothing here knows which agent wrote it.

// The focused agent's terminal, or null. The displayed terminal takes precedence over
// the agent-block fallback. Same rule as the Activity panel.
export function focusedAgent(focus, terminals, agents) {
  const address = focus?.shown ?? focus?.terminal ?? focus?.agent;
  const terminal = terminals.find(item => item.address === address && item.state === "live");
  if (!terminal) return null;
  return terminal.program?.agent || terminal.status || agents.some(item => item.address === address) ? terminal : null;
}

const count = value => Number.isSafeInteger(value) && value > 0 ? value : 0;
const text = value => typeof value === "string" ? value.trim() : "";

function part(value) {
  const label = text(value?.label), tokens = count(value?.tokens);
  return label && tokens ? { label, tokens } : null;
}

function row(value) {
  const key = text(value?.key), label = text(value?.label), tokens = count(value?.tokens);
  if (!key || !label || !tokens) return null;
  const parts = Array.isArray(value.parts) ? value.parts.map(part).filter(Boolean) : [];
  return { key, label, tokens, parts };
}

function miss(value) {
  const at = count(value?.at), lost = count(value?.lost);
  if (!at || !lost) return null;
  const models = Array.isArray(value.models) && value.models.length === 2 && value.models.every(text) ? value.models : null;
  return { at, lost, rewritten: count(value.rewritten), compaction: value.compaction === true, models,
    idle: count(value.idle), ttl: count(value.ttl) };
}

function cache(value) {
  const requests = count(value?.requests);
  if (!requests) return null;
  const written = Number.isSafeInteger(value.written) ? value.written : null;
  return { requests, read: count(value.read), uncached: count(value.uncached), since: count(value.since), written,
    rewritten: written === null ? null : Math.min(written, count(value.rewritten)),
    // Null when the agent does not report cache writes: no misses can be found.
    misses: written === null ? null : (Array.isArray(value.misses) ? value.misses.map(miss).filter(Boolean) : []) };
}

// A compaction: only what the agent recorded. `before` is required; the rest may be missing.
function compaction(value) {
  const at = count(value?.at), before = count(value?.before);
  if (!at || !before) return null;
  const trigger = value.trigger === "auto" || value.trigger === "manual" ? value.trigger : null;
  return { at, before, after: count(value.after) || null, trigger,
    took: typeof value.took === "number" && value.took > 0 ? value.took : null };
}

function shape(state) {
  if (state?.version !== 1 || !text(state.provider) || !Array.isArray(state.rows)) return null;
  return {
    provider: state.provider, used: count(state.used), window: count(state.window),
    reserved: count(state.reserved), model: text(state.model), compactions: count(state.compactions),
    rows: state.rows.map(row).filter(Boolean), cache: cache(state.cache),
    log: Array.isArray(state.log) ? state.log.map(compaction).filter(Boolean) : [],
  };
}

// The label, parsed again only when its text changes. A label left by a different agent
// in the same terminal is stale; checked on every read, as its text does not change
// when another agent starts there.
let last = { text: null, value: null };
export function contextState(terminal) {
  const value = terminal?.labels?.["bettr.context"];
  if (typeof value !== "string") return null;
  if (last.text !== value) {
    let state = null;
    try { state = shape(JSON.parse(value)); } catch { state = null; }
    last = { text: value, value: state };
  }
  const app = terminal.program?.key ?? terminal.report?.app;
  return last.value && app && !app.includes(last.value.provider) ? null : last.value;
}

// `63.8k`, `1M`, `850`.
export function tokens(value) {
  const short = (n, unit) => `${n.toFixed(1).replace(/\.0$/, "")}${unit}`;
  if (value >= 1e6) return short(value / 1e6, "M");
  if (value >= 1e3) return short(value / 1e3, "k");
  return String(Math.round(value));
}

// A share of the window: `2.8%`, `<0.1%`.
export function percent(value, window) {
  if (!window) return "";
  const share = value / window * 100;
  return share > 0 && share < 0.1 ? "<0.1%" : `${share.toFixed(1).replace(/\.0$/, "")}%`;
}

// What the panel draws. `open` holds the keys of opened rows.
export function contextView(state, open = new Set()) {
  const window = state.window;
  const rows = state.rows.map(item => ({ ...item, expandable: item.parts.length > 0, opened: open.has(item.key) }));
  // The reserve and free space count only with a known window.
  const reserved = window ? Math.min(state.reserved, Math.max(0, window - state.used)) : 0;
  const free = window ? Math.max(0, window - state.used - reserved) : 0;
  const scale = window || state.used || 1;
  return {
    heading: window ? `${Math.round(state.used / window * 100)}% used` : `${tokens(state.used)} used`,
    total: window ? `${tokens(state.used)} / ${tokens(window)}` : "",
    // Bar segments as fractions of the bar; the free space is the track behind them.
    segments: [...rows.map(item => ({ key: item.key, share: item.tokens / scale })),
      ...(reserved ? [{ key: "reserved", share: reserved / scale }] : [])],
    rows,
    reserved, free,
  };
}

// `2h 20m`, `45m`, `30s`: as the Activity panel writes run times, without seconds past a minute.
export function duration(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60), h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

// `14:03`, or `Nov 4 14:03` on another day than `now` (both epoch seconds).
export function clock(at, now = Date.now() / 1000) {
  const date = new Date(at * 1000), today = new Date(now * 1000);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (date.toDateString() === today.toDateString()) return time;
  return `${date.toDateString().slice(4, 10).replace(/ 0/, " ")} ${time}`;
}

// What happened before a miss, as found in the transcript; never a cause. Only the
// main one shows: a compaction, else a model change, else idle time. A compaction
// rewrites nothing (the new prompt is a summary), so its line starts with "Drop".
function facts(item) {
  const found = item.compaction ? "after compaction"
    : item.models ? `after model change: ${item.models[0]} → ${item.models[1]}`
      : item.idle && item.ttl ? `after ${duration(item.idle)} idle`
        : "with no cause in transcript";
  return `${item.rewritten ? "Rewrite" : "Drop"} ${found}`;
}

// Before the first request: all zero.
const EMPTY = { requests: 0, read: 0, written: 0, rewritten: 0, uncached: 0, since: 0, misses: [] };

// The Cache section. The hit rate is rounded down, so a miss never shows as 100%.
// All four totals always show; one the agent does not report is "—", never 0.
export function cacheView(cache, provider, now = Date.now() / 1000) {
  cache = cache ?? EMPTY;
  const input = cache.read + (cache.written ?? 0) + cache.uncached;
  const hit = input ? Math.floor(cache.read / input * 1000) / 10 : 0;
  // Written splits into new content and content the previous prompt had cached.
  const unknown = cache.written === null;
  const name = `${provider[0].toUpperCase()}${provider.slice(1)}`;
  const totals = [
    { key: "read", label: "Read from cache", tokens: cache.read },
    { key: "write", label: "Written to cache: new content", tokens: unknown ? null : cache.written - cache.rewritten },
    { key: "rewrite", label: "Written to cache again: content the previous prompt had cached",
      tokens: unknown ? null : cache.rewritten },
    { key: "uncached", label: "Uncached: not read from or written to cache", tokens: cache.uncached },
  ].map(item => item.tokens === null ? { ...item, value: "—", label: `${item.label} · ${name} does not report it` }
    : { ...item, value: tokens(item.tokens) });
  const since = [cache.since ? `Since ${clock(cache.since, now)}` : "", `${cache.requests} requests`].filter(Boolean);
  return {
    hit: input ? `${hit}% hit` : "",
    totals,
    about: [...since, "main agent only"].join(" · "),
    misses: (cache.misses ?? []).slice().reverse()
      // A compaction's old cache is dropped, not written again.
      .map(item => {
        const lost = tokens(item.rewritten || item.lost);
        return { key: `${item.at}-${item.lost}`, time: clock(item.at, now), lost, facts: facts(item), plain: item.compaction,
          tip: [`${lost} ${item.rewritten ? "rewritten" : "dropped"}`,
            ...(item.ttl ? [`cache TTL ${duration(item.ttl)}`] : [])].join(" · ") };
      }),
  };
}

// The compaction log, newest last: the time, then context before and after. The
// tooltip has how it started and how long it took, when the agent recorded them.
export function logView(log, window, now = Date.now() / 1000) {
  return (log ?? []).map(item => ({
    key: `${item.at}-${item.before}`, time: clock(item.at, now),
    before: tokens(item.before), after: item.after ? tokens(item.after) : "—",
    tip: [item.trigger === "auto" ? "Automatic" : item.trigger === "manual" ? "Manual" : "",
      window ? `at ${percent(item.before, window)} of the window` : "",
      item.took ? `took ${duration(item.took)}` : "",
      item.after ? "" : "size after not recorded"].filter(Boolean).join(" · ") || "Compacted",
  }));
}
