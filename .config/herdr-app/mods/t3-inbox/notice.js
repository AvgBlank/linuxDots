// One Undo notice per run across t3-inbox and t3-tabs (in globalThis.t3Notice); shared(KEY.notice) carries display metadata only.
import { shared, setShared } from "herdr";
import { KEY } from "./store.js";

const LIVE_MS = 5000;
const FADE_IN_MS = 16;
const FADE_OUT_MS = 250;

const store = () => (/** @type {any} */ (globalThis).t3Notice ??= { current: null, gen: 0 });
const meta = (n) => n ? { action: n.action, count: n.count, gen: n.gen, shown: n.shown, live: n.live, at: n.at } : null;
const publish = (n) => setShared(KEY.notice, meta(n));

function cancelTimers(n) {
  n.fadeInTimer?.cancel?.();
  n.expireTimer?.cancel?.();
  n.fadeOutTimer?.cancel?.();
  n.fadeInTimer = n.expireTimer = n.fadeOutTimer = null;
}

function armExpiry(n, cx) {
  n.expireTimer?.cancel?.();
  n.expireTimer = cx?.timer?.after(LIVE_MS, (cx) => {
    if (store().current === n && n.live) forgetNotice(cx, n);
  }) ?? null;
}

/**
 * Records an undoable notice, joining a live same-action notice within 5000ms.
 * @param {string} action
 * @param {number} count
 * @param {(cx: any) => any} undoFn
 * @param {any} cx
 */
export function rememberNotice(action, count, undoFn, cx) {
  if (!(count > 0)) return { drop() {} };
  const s = store(), now = Date.now(), cur = s.current;
  const joined = Boolean(cur && cur.live && cur.action === action && now - cur.at < LIVE_MS);
  const entry = { count, undo: undoFn };
  let n;
  if (joined) {
    n = cur;
    n.count += count;
    n.at = now;
    n.entries.push(entry);
  } else {
    if (cur) cancelTimers(cur);
    s.gen = Math.max(s.gen ?? 0, shared(KEY.notice)?.gen ?? 0) + 1;
    n = {
      action,
      count,
      gen: s.gen,
      shown: false,
      live: true,
      at: now,
      cx,
      entries: [entry],
      fadeInTimer: null,
      expireTimer: null,
      fadeOutTimer: null,
    };
    s.current = n;
    n.fadeInTimer = cx?.timer?.after(FADE_IN_MS, (cx) => {
      if (store().current !== n || !n.live) return;
      n.shown = true;
      publish(n);
      cx?.notify?.();
    }) ?? null;
  }
  n.cx = cx ?? n.cx;
  armExpiry(n, n.cx);
  publish(n);
  return {
    drop(amount = 1, dropCx = cx) {
      if (!(amount > 0) || store().current !== n || !n.live || entry.count <= 0) return;
      const taken = Math.min(amount, entry.count);
      entry.count -= taken;
      n.count -= taken;
      if (entry.count <= 0) {
        const i = n.entries.indexOf(entry);
        if (i >= 0) n.entries.splice(i, 1);
      }
      if (n.count <= 0) forgetNotice(dropCx, n);
      else {
        publish(n);
        dropCx?.notify?.();
      }
    },
  };
}

export function forgetNotice(cx, target = null) {
  const s = store(), n = s.current;
  if (!n || (target && n !== target) || !n.live) return;
  const runCx = cx ?? n.cx;
  cancelTimers(n);
  n.live = false;
  n.shown = false;
  if (!runCx?.timer) {
    s.current = null;
    publish(null);
    runCx?.notify?.();
    return;
  }
  publish(n);
  n.fadeOutTimer = runCx.timer.after(FADE_OUT_MS, (cx) => {
    if (store().current !== n) return;
    store().current = null;
    publish(null);
    cx?.notify?.();
  });
  runCx?.notify?.();
}

export async function undoNotice(cx) {
  const s = store(), n = s.current;
  if (!n || !n.live || Date.now() - n.at >= LIVE_MS) return;
  const runCx = cx ?? n.cx;
  s.current = null;
  cancelTimers(n);
  publish(null);
  runCx?.notify?.();
  const failed = [];
  for (const entry of [...n.entries].reverse()) {
    const result = entry.undo(runCx);
    const outcome = result && typeof result.then === "function" ? await result : result;
    if (outcome === false) failed.unshift(entry);
  }
  if (failed.length && !s.current) {
    const restored = {
      action: n.action,
      count: failed.reduce((sum, entry) => sum + entry.count, 0),
      gen: n.gen,
      shown: true,
      live: true,
      at: Date.now(),
      cx: runCx,
      entries: failed,
      fadeInTimer: null,
      expireTimer: null,
      fadeOutTimer: null,
    };
    armExpiry(restored, runCx);
    s.current = restored;
    publish(restored);
    runCx?.notify?.();
  }
}
