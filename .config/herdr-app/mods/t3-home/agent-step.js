import { sidebarParts } from "./sidebar.js";
import { KEY } from "./store.js";

// Query the chosen sidebar, not its visibility. Home can arrive before the sidebar's view catches up.
export function agentStep(root, read, spaces, by) {
  const inbox = sidebarParts(root).stack?.active === "inbox";
  const { order = [], view = null } = read(inbox ? KEY.inboxRows : KEY.agentsRows) ?? {};
  const home = read(KEY.home);
  if (view === null || spaces.some(s => s.active && s.machine === null && s.id === home)) {
    return (by > 0 ? order[0] : order.at(-1)) ?? null;
  }
  const at = order.indexOf(view);
  return at < 0 ? null : order[at + by] ?? null;
}
