/** Must match ged SCRIBE_PROJECT_ID (orchestration store). */
const PROJECT = "ged";

function routeAnchorIndex(path) {
  const specIdx = path.indexOf("/specs/");
  if (specIdx !== -1) return specIdx;
  const planIdx = path.indexOf("/plans/");
  if (planIdx !== -1) return planIdx;
  return -1;
}

export function serviceRoot() {
  const path = window.location.pathname.replace(/\/$/, "") || "";
  const anchor = routeAnchorIndex(path);
  if (anchor !== -1) return path.slice(0, anchor);
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

export function planIdFromPath(pathname = window.location.pathname) {
  const path = pathname.replace(/\/$/, "");
  const planAt = path.indexOf("/plans/");
  if (planAt === -1) return "";
  const rest = path.slice(planAt + "/plans/".length);
  const id = rest.split("/")[0];
  return id ? decodeURIComponent(id) : "";
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
    in_progress: "In progress",
    blocked: "Blocked",
    done: "Done",
  };
  return map[status] || status;
}

/** Board/detail status for specs (no build progress). */
export function specBoardStatus(spec) {
  if (spec.status === "done") return "done";
  if (spec.status === "blocked") return "blocked";
  const review = String(spec?.review_gate ?? "")
    .toLowerCase()
    .replace(/\*\*/g, "")
    .trim();
  if (review === "pending" || review.startsWith("pending")) return "blocked";
  return "ready";
}

export function specBoardStatusLabel(spec) {
  return `Intent · ${statusLabel(specBoardStatus(spec))}`;
}

/** Orchestration chips for list/detail (review gate + plan review). */
export function specOrchestrationLabels(spec) {
  /** @type {string[]} */
  const labels = [];
  const review = String(spec?.review_gate ?? "")
    .toLowerCase()
    .replace(/\*\*/g, "")
    .trim();
  if (review && review !== "passed" && !review.startsWith("passed")) {
    labels.push(`Review · ${review === "pending" ? "Pending" : spec.review_gate}`);
  }
  const planReview = String(spec?.plan_review ?? "")
    .toLowerCase()
    .replace(/\*\*/g, "")
    .trim();
  if (planReview === "required") {
    labels.push("Plan review · Required");
  }
  return labels;
}

export function specOrchestrationLabel(spec) {
  return specOrchestrationLabels(spec).join(" · ");
}

export function lockSummary(lock) {
  if (!lock) return "Open";
  const who = lock.holder_kind === "user" ? lock.agent_id : lock.agent_id;
  const base = lock.holder_kind === "user" ? `Held by ${who}` : `Held by agent ${who}`;
  if (!lock.expires_at) return base;
  const ms = new Date(lock.expires_at).getTime() - Date.now();
  if (ms <= 0) return `${base} · expired`;
  const mins = Math.ceil(ms / 60_000);
  if (mins < 60) return `${base} · expires ${mins}m`;
  const hrs = Math.ceil(mins / 60);
  if (hrs < 48) return `${base} · expires ${hrs}h`;
  const days = Math.ceil(hrs / 24);
  return `${base} · expires ${days}d`;
}

/** Short lock label for tree rows (full text lives in detail toolbar + aria-label). */
export function lockTreeSummary(lock) {
  if (!lock?.agent_id) return "Held";
  const id = String(lock.agent_id);
  const short = id.length > 14 ? `${id.slice(0, 10)}…` : id;
  return `Held · ${short}`;
}

export function workspaceShortPath(path) {
  if (!path) return "";
  const parts = String(path).replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return parts.join("/");
  return `…/${parts.slice(-2).join("/")}`;
}

/** @param {{ id?: string, branch?: string, worktree_path?: string, scribe_worker_root?: string, scrollsmatrix_worker_root?: string }} ws */
export function workspaceEnvSnippet(ws) {
  if (!ws?.worktree_path) return "";
  return [
    `GED_WORKSPACE_ROOT=${ws.worktree_path}`,
    `GED_WORKSPACE_BRANCH=${ws.branch ?? ""}`,
    `GED_RESUME_SLUG=${ws.id ?? ""}`,
    ws.scribe_worker_root ? `SCRIBE_WORKER_ROOT=${ws.scribe_worker_root}` : null,
    ws.scrollsmatrix_worker_root ? `SCROLLSMATRIX_WORKER_ROOT=${ws.scrollsmatrix_worker_root}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function workspaceTreeSummary(ws) {
  if (!ws?.worktree_path) return "";
  return `Workspace · ${workspaceShortPath(ws.worktree_path)}`;
}

export function specLinkLabel(spec) {
  return [
    spec.title,
    specBoardStatusLabel(spec),
    lockSummary(spec.lock),
    `Updated ${formatAge(spec.updated_at)}`,
  ].join(", ");
}

/** @param {{ phases_done?: number, phases_total?: number }} plan */
export function planPhasesComplete(plan) {
  const total = plan.phases_total ?? 0;
  const done = plan.phases_done ?? 0;
  return total > 0 && done >= total;
}

/** Board/detail status for plans (includes build progress). */
export function planBoardStatus(plan) {
  if (plan.status === "done" || planPhasesComplete(plan)) return "done";
  if (plan.status === "blocked") return "blocked";
  if (plan.status === "in_progress") return "in_progress";
  if (plan.active_phase?.status === "active") return "in_progress";
  const ratio = plan.completion_ratio ?? 0;
  if (ratio > 0 && ratio < 1) return "in_progress";
  return "ready";
}

export function planBoardStatusLabel(plan) {
  return `Build · ${statusLabel(planBoardStatus(plan))}`;
}

export function planProgressLabel(plan) {
  if (plan.phases_total > 0) {
    const base = `${plan.phases_done}/${plan.phases_total} phases`;
    if (planPhasesComplete(plan)) return `${base} · complete`;
    return base;
  }
  if (plan.tasks_total > 0) {
    return `${plan.tasks_done}/${plan.tasks_total} tasks`;
  }
  return "No tasks yet";
}

/**
 * Active board plans: not-done plans plus done plans still linked to an on-board spec.
 * @param {Array<{ status?: string, spec_slug?: string }>} allPlans
 * @param {Array<{ slug: string }>} activeSpecs
 */
export function mergePlansForActiveSpecs(allPlans, activeSpecs) {
  const slugs = new Set(activeSpecs.map((s) => s.slug));
  return allPlans.filter(
    (p) => p.status !== "done" || slugs.has(p.spec_slug),
  );
}

export function planLinkLabel(plan) {
  const parts = [
    plan.title,
    `for spec ${plan.spec_slug}`,
    planBoardStatusLabel(plan),
    planProgressLabel(plan),
    lockSummary(plan.lock),
    `Updated ${formatAge(plan.updated_at)}`,
  ];
  if (plan.active_phase?.title) {
    parts.splice(3, 0, `Active: ${plan.active_phase.title}`);
  }
  return parts.join(", ");
}

