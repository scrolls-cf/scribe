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

/** Like apiFetch but returns the response ETag header (detail poll). */
export async function apiFetchWithEtag(segment, options = {}) {
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
  return { data, etag: normalizeEtagHeader(res.headers.get("etag")) };
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

/** Canonical spec documenting the 4a review workflow (board link target). */
export const REVIEW_WORKFLOW_SPEC_SLUG = "ged-spec-review-gate";

/** @param {string | null | undefined} value */
export function normalizeReviewGate(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\*\*/g, "")
    .trim();
}

/** @param {object} spec */
export function specReviewGateLabel(spec) {
  const review = normalizeReviewGate(spec?.review_gate);
  if (!review || review === "passed" || review.startsWith("passed") || review === "n/a") {
    return null;
  }
  if (review === "pending" || review.startsWith("pending")) return "Pending";
  if (review === "revise") return "Revise";
  return String(spec.review_gate ?? "").trim() || null;
}

/** True when spec is blocked on intent review (list filter + detail callout). */
export function specNeedsReviewAttention(spec) {
  if (spec?.status === "blocked") return true;
  const gate = specReviewGateLabel(spec);
  return gate === "Pending" || gate === "Revise";
}

/**
 * @param {string} [baseHref]
 * @returns {string}
 */
export function specReviewInstructionsHref(baseHref = "") {
  const root = String(baseHref).replace(/\/?$/, "/");
  return `${root}#specs/${encodeURIComponent(REVIEW_WORKFLOW_SPEC_SLUG)}`;
}

/**
 * @param {object} spec
 * @returns {{ headline: string, detail: string, gate: string } | null}
 */
export function specReviewNoticeState(spec) {
  if (!specNeedsReviewAttention(spec)) return null;
  const gate = specReviewGateLabel(spec) || "Blocked";
  return {
    gate,
    headline: gate === "Revise" ? "Revision requested" : "Review required",
    detail:
      gate === "Revise"
        ? "Update the spec body, then re-submit for review before planning (phase 4c)."
        : "Intent must pass review (phase 4a) before savePlan. Read the workflow spec for pass / revise steps.",
  };
}

/** Board/detail status for specs (no build progress). */
export function specBoardStatus(spec) {
  if (spec.status === "done") return "done";
  if (spec.status === "blocked") return "blocked";
  const review = normalizeReviewGate(spec?.review_gate);
  if (review === "pending" || review.startsWith("pending") || review === "revise") {
    return "blocked";
  }
  return "ready";
}

export function specBoardStatusLabel(spec) {
  return `Intent · ${statusLabel(specBoardStatus(spec))}`;
}

/** Orchestration chips for list/detail (review gate + plan review). */
export function specOrchestrationLabels(spec) {
  /** @type {string[]} */
  const labels = [];
  const reviewLabel = specReviewGateLabel(spec);
  if (reviewLabel) {
    labels.push(`Review · ${reviewLabel}`);
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

/** @param {string} [activity] */
export function lockActivityLabel(activity) {
  /** @type {Record<string, string>} */
  const labels = {
    review: "Review",
    implement: "Implement",
    refactor: "Refactor",
  };
  const key = String(activity ?? "").trim().toLowerCase();
  return labels[key] ?? "";
}

export function lockSummary(lock) {
  if (!lock) return "Open";
  const who = lock.holder_kind === "user" ? lock.agent_id : lock.agent_id;
  const held = lock.holder_kind === "user" ? `Held by ${who}` : `Held by agent ${who}`;
  const activity = lockActivityLabel(lock.activity);
  const base = activity ? `${activity} · ${held}` : held;
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
  const activity = lockActivityLabel(lock.activity);
  const id = String(lock.agent_id);
  const short = id.length > 14 ? `${id.slice(0, 10)}…` : id;
  const held = `Held · ${short}`;
  return activity ? `${activity} · ${held}` : held;
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
  if ((plan.phases ?? []).some((p) => p.status === "active")) return "in_progress";
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

/** True when orchestrator has marked at least one phase done or plan is terminal. */
export function planProgressTracked(plan) {
  if (!plan) return false;
  if (plan.status === "done" || planPhasesComplete(plan)) return true;
  return (plan.phases_done ?? 0) > 0;
}

/** Board/detail label — honest copy when in_progress but not yet tracked. */
export function planProgressDisplayLabel(plan) {
  if (!planProgressTracked(plan) && planBoardStatus(plan) === "in_progress") {
    return "In progress · phases not tracked";
  }
  return planProgressLabel(plan);
}

const SPEC_EXECUTION_SECTIONS = new Set(["phases", "implementation status"]);

/**
 * Strip registration/execution sections from spec markdown when a plan owns execution.
 * @param {string} body
 * @param {{ linkedPlan?: boolean }} [opts]
 */
export function hideSpecExecutionSections(body, { linkedPlan = false } = {}) {
  if (!linkedPlan || !body?.trim()) return body ?? "";

  const lines = body.split("\n");
  const out = [];
  let skipping = false;

  for (const line of lines) {
    const h2 = line.match(/^## (.+)$/);
    if (h2) {
      const title = h2[1].replace(/`/g, "").trim().toLowerCase();
      skipping = SPEC_EXECUTION_SECTIONS.has(title);
      if (!skipping) out.push(line);
      continue;
    }
    if (!skipping) out.push(line);
  }

  const trimmed = out.join("\n").trim();
  return trimmed ? `${trimmed}\n` : "";
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

/**
 * Completed board: specs and plans with terminal `status: done`.
 * @param {Array<{ status?: string, slug?: string }>} allSpecs
 * @param {Array<{ status?: string, spec_slug?: string }>} allPlans
 */
export function partitionCompletedWork(allSpecs, allPlans) {
  const specs = allSpecs.filter((s) => s.status === "done");
  const doneSlugs = new Set(specs.map((s) => s.slug));
  const plans = allPlans.filter(
    (p) => p.status === "done" || (doneSlugs.has(p.spec_slug) && planPhasesComplete(p)),
  );
  return { specs, plans };
}

/**
 * Board work-unit count: one per spec row plus one per detached orphan slug group.
 * @param {Array<{ slug: string }>} specs
 * @param {Array<{ spec_slug?: string }>} plans
 */
export function workUnitCount(specs, plans) {
  const specSlugs = new Set(specs.map((s) => s.slug));
  const orphanSlugs = new Set(
    plans.filter((p) => !specSlugs.has(p.spec_slug)).map((p) => p.spec_slug || "unknown"),
  );
  return specs.length + orphanSlugs.size;
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

/** True when spec is in an active review/refactor loop (diff affordances). */
export function specReviewLoopActive(spec) {
  const review = String(spec?.review_gate ?? "")
    .toLowerCase()
    .replace(/\*\*/g, "")
    .trim();
  if (review && review !== "passed" && !review.startsWith("passed")) return true;
  const activity = String(spec?.lock?.activity ?? "").toLowerCase();
  return activity === "review" || activity === "refactor";
}

/**
 * @param {{ status?: string, lock?: { activity?: string } }} plan
 * @param {{ plan_review?: string | null } | null | undefined} spec
 */
export function planReviewLoopActive(plan, spec) {
  const activity = String(plan?.lock?.activity ?? "").toLowerCase();
  if (activity === "review" || activity === "refactor") return true;
  if (plan?.status !== "blocked") return false;
  const planReview = String(spec?.plan_review ?? "")
    .toLowerCase()
    .replace(/\*\*/g, "")
    .trim();
  return planReview === "required";
}

/** @param {{ lines_added?: number, lines_removed?: number, created_at?: string } | null | undefined} lastRevision */
export function revisionSummaryLabel(lastRevision) {
  if (!lastRevision) return "";
  const parts = [];
  if (lastRevision.lines_added != null || lastRevision.lines_removed != null) {
    parts.push(`+${lastRevision.lines_added ?? 0} −${lastRevision.lines_removed ?? 0}`);
  }
  if (lastRevision.created_at) {
    parts.push(formatAge(lastRevision.created_at));
  }
  return parts.join(" · ");
}

/** @param {{ revisions_count?: number, status?: string }} record */
export function shouldShowDiffToggle(record, loopActive) {
  const count = record?.revisions_count ?? 0;
  if (count <= 0) return false;
  if (loopActive) return true;
  if (record.status === "done") return true;
  return count > 0;
}

/** @param {string | null | undefined} header */
export function normalizeEtagHeader(header) {
  if (!header) return null;
  const trimmed = String(header).trim();
  if (!trimmed || trimmed === "*") return null;
  return trimmed.replace(/^W\//, "").replace(/^"|"$/g, "");
}

/**
 * Lightweight GET for etag polling (response header only).
 * @param {string} segment
 */
export async function fetchRecordEtag(segment) {
  const headers = new Headers({ accept: "application/json" });
  const res = await fetch(apiPath(segment), { method: "GET", headers });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return normalizeEtagHeader(res.headers.get("etag"));
}

/**
 * Short list-row revision label during active review loops.
 * @param {{ revisions_count?: number, last_revision?: { lines_added?: number, lines_removed?: number } }} record
 * @param {boolean} loopActive
 */
export function revisionListMeta(record, loopActive) {
  if (!loopActive) return null;
  const count = record?.revisions_count ?? 0;
  if (count <= 0) return null;
  const rev = record?.last_revision;
  if (!rev) return "Δ";
  const added = rev.lines_added ?? 0;
  const removed = rev.lines_removed ?? 0;
  if (added === 0 && removed === 0) return "Δ";
  return `Δ +${added} −${removed}`;
}

/** @param {string} slug @param {{ base?: string, head?: string }} [params] */
export async function fetchSpecDiff(slug, params = {}) {
  const qs = new URLSearchParams();
  if (params.base) qs.set("base", params.base);
  if (params.head) qs.set("head", params.head);
  const q = qs.toString();
  return apiFetch(`specs/${encodeURIComponent(slug)}/diff${q ? `?${q}` : ""}`);
}

/** @param {string} id @param {{ base?: string, head?: string }} [params] */
export async function fetchPlanDiff(id, params = {}) {
  const qs = new URLSearchParams();
  if (params.base) qs.set("base", params.base);
  if (params.head) qs.set("head", params.head);
  const q = qs.toString();
  return apiFetch(`plans/${encodeURIComponent(id)}/diff${q ? `?${q}` : ""}`);
}

/** Human label for SQLite audit revision events. */
export function auditEventLabel(event) {
  const labels = {
    spec_review_revise: "Spec review · revise",
    spec_review_resubmit: "Spec review · resubmit",
    spec_review_pass: "Spec review · passed",
    spec_body_amend: "Spec body amend",
    plan_review_revise: "Plan review · revise",
    plan_review_pass: "Plan review · passed",
    plan_amend: "Plan amend",
    post_ship_amend: "Post-ship amend",
  };
  return labels[event] ?? String(event ?? "").replace(/_/g, " ");
}

/** @param {{ holder_id?: string, holder_kind?: string } | null | undefined} reviewer */
export function formatReviewer(reviewer) {
  if (!reviewer?.holder_id) return "";
  const kind = reviewer.holder_kind === "user" ? "User" : "Agent";
  return `${kind}: ${reviewer.holder_id}`;
}

/** @param {{ revisions_summary?: { count?: number } } | null | undefined} record */
export function auditRevisionCount(record) {
  const n = record?.revisions_summary?.count;
  return typeof n === "number" && n > 0 ? n : 0;
}

/** Short list-row label for SQLite audit trail (distinct from KV body-diff Δ). */
export function auditRevisionListMeta(record) {
  const count = auditRevisionCount(record);
  if (count <= 0) return null;
  return count === 1 ? "1 audit rev" : `${count} audit revs`;
}

/** @param {string} slug @param {{ limit?: number, offset?: number }} [params] */
export async function fetchSpecRevisions(slug, params = {}) {
  const qs = new URLSearchParams();
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  const q = qs.toString();
  return apiFetch(`specs/${encodeURIComponent(slug)}/revisions${q ? `?${q}` : ""}`);
}

/** @param {string} slug @param {string} revisionId */
export async function fetchSpecRevision(slug, revisionId) {
  const data = await apiFetch(
    `specs/${encodeURIComponent(slug)}/revisions/${encodeURIComponent(revisionId)}`,
  );
  return data.revision;
}

/** @param {string} id @param {{ limit?: number, offset?: number }} [params] */
export async function fetchPlanRevisions(id, params = {}) {
  const qs = new URLSearchParams();
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  const q = qs.toString();
  return apiFetch(`plans/${encodeURIComponent(id)}/revisions${q ? `?${q}` : ""}`);
}

/** @param {string} id @param {string} revisionId */
export async function fetchPlanRevision(id, revisionId) {
  const data = await apiFetch(
    `plans/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}`,
  );
  return data.revision;
}

