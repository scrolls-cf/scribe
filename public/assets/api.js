const PROJECT = "default";

export function serviceRoot() {
  const path = window.location.pathname.replace(/\/$/, "") || "";
  const specIdx = path.indexOf("/specs/");
  if (specIdx !== -1) return path.slice(0, specIdx);
  return path;
}

export function specSlugFromPath(pathname = window.location.pathname) {
  const path = pathname.replace(/\/$/, "");
  const specAt = path.indexOf("/specs/");
  if (specAt === -1) return "";
  const rest = path.slice(specAt + "/specs/".length);
  const slug = rest.split("/")[0];
  return slug ? decodeURIComponent(slug) : "";
}

export function apiPath(segment) {
  const root = serviceRoot();
  const base = `${root}/v1/projects/${PROJECT}`;
  if (!segment) return base;
  return segment.startsWith("/") ? `${base}${segment}` : `${base}/${segment}`;
}

export async function apiFetch(segment, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has("accept")) headers.set("accept", "application/json");
  if (options.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(apiPath(segment), { ...options, headers });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-json */
  }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function agentId() {
  const key = "scribe-agent-id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = `agent-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

export function formatAge(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function statusLabel(status) {
  const map = {
    ready: "Ready",
    in_progress: "Ready",
    blocked: "Blocked",
    done: "Done",
  };
  return map[status] || status;
}

/** Board/detail status for specs (no build progress). */
export function specBoardStatus(spec) {
  if (spec.status === "done") return "done";
  if (spec.status === "blocked") return "blocked";
  return "ready";
}

export function specBoardStatusLabel(spec) {
  return statusLabel(specBoardStatus(spec));
}

export function lockSummary(lock) {
  if (!lock) return "Open";
  return `Held by ${lock.agent_id}`;
}

export function specLinkLabel(spec) {
  return [
    spec.title,
    specBoardStatusLabel(spec),
    lockSummary(spec.lock),
    `Updated ${formatAge(spec.updated_at)}`,
  ].join(", ");
}

/** Pull a spec slug from an error source path or message when possible. */
export function specSlugFromErrorSource(source, knownSlugs = []) {
  if (!source) return "";
  const pathMatch = String(source).match(/\/specs\/([a-z0-9-]+)/);
  if (pathMatch) return pathMatch[1];
  for (const slug of knownSlugs) {
    if (source.includes(slug)) return slug;
  }
  return "";
}
