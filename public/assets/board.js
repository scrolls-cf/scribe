import {
  apiFetch,
  formatAge,
  lockSummary,
  lockTreeSummary,
  workspaceEnvSnippet,
  workspaceTreeSummary,
  planIdFromPath,
  mergePlansForActiveSpecs,
  planBoardStatus,
  planBoardStatusLabel,
  planLinkLabel,
  planProgressLabel,
  specLinkLabel,
  specSlugFromPath,
  specBoardStatus,
  specBoardStatusLabel,
  specOrchestrationLabels,
} from "./api.js";
import {
  isSmokeArtifact,
  resolveLinkedPlanRefs,
} from "./footer-plan.js";
import {
  devNote,
  setLoadingText,
} from "./delight.js";
import { renderPlanDetail } from "./plan-view.js";
import { renderSpecDetail } from "./spec-view.js";

devNote();

const WORK_LOADING = [
  "Loading active work…",
  "Fetching specs and implementations…",
];
const DETAIL_LOADING = [
  "Loading detail…",
  "Fetching spec or implementation…",
];

const workList = document.getElementById("work-list");
const workEmpty = document.getElementById("work-empty");
const workLoading = document.getElementById("work-loading");
const boardError = document.getElementById("board-error");
const boardMain = document.getElementById("board-main");
const workCount = document.getElementById("work-count");
const workHeading = document.getElementById("work-heading");
const workBoardHint = document.getElementById("work-board-hint");
const detailPanel = document.getElementById("detail-panel");
const detailEmpty = document.getElementById("detail-empty");
const detailLoading = document.getElementById("detail-loading");
const detailBreadcrumb = document.getElementById("detail-breadcrumb");
const specDetailRoot = document.getElementById("spec-detail");
const planDetailRoot = document.getElementById("plan-detail");

const WORK_FILTER_THRESHOLD = 8;

let activeSlug = null;
let activePlanId = null;
let cachedSpecs = [];
let cachedPlans = [];
/** @type {Map<string, object>} */
let cachedWorkspaces = new Map();
let lastFocusedButton = null;
let workFilter = "all";
let workFilterSelect = null;
let showSmoke = false;
let smokeToggle = null;

function isMobileDetail() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function focusDetailOnMobile() {
  if (!isMobileDetail()) return;
  const target =
    (detailBreadcrumb && !detailBreadcrumb.hidden
      ? detailBreadcrumb.querySelector("button")
      : null) ||
    (specDetailRoot && !specDetailRoot.hidden
      ? document.getElementById("spec-detail-title")
      : null) ||
    (planDetailRoot && !planDetailRoot.hidden
      ? document.getElementById("plan-detail-title")
      : null) ||
    detailPanel;
  if (!target) return;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus();
}

/** Active work units: one per on-board spec; detached orphan groups count once per completed spec slug. */
function activeWorkUnitCount(specs, plans) {
  const specSlugs = new Set(specs.map((s) => s.slug));
  const orphanSlugs = new Set(
    plans.filter((p) => !specSlugs.has(p.spec_slug)).map((p) => p.spec_slug || "unknown"),
  );
  return specs.length + orphanSlugs.size;
}

function specMatchesFilter(spec) {
  if (workFilter === "all") return true;
  if (workFilter === "locked") return !!spec.lock;
  const status = specBoardStatus(spec);
  return status === "ready" || status === "in_progress";
}

function planMatchesFilter(plan) {
  if (workFilter === "all") return true;
  if (workFilter === "locked") return !!plan.lock;
  const status = planBoardStatus(plan);
  return status === "ready" || status === "in_progress";
}

function filterBoardData(specs, plans) {
  if (workFilter === "all") return { specs, plans };
  const filteredPlans = plans.filter(planMatchesFilter);
  const filteredSpecs = specs.filter(
    (spec) =>
      specMatchesFilter(spec) ||
      filteredPlans.some((plan) => plan.spec_slug === spec.slug),
  );
  return { specs: filteredSpecs, plans: filteredPlans };
}

/** Hide ged-smoke-* artifacts from active board unless showSmoke is on. */
function applySmokeFilter(specs, plans) {
  if (showSmoke) return { specs, plans };
  return {
    specs: specs.filter((s) => !isSmokeArtifact(s)),
    plans: plans.filter((p) => !isSmokeArtifact(p)),
  };
}

function syncSmokeToggle() {
  if (!workBoardHint) return;
  if (!smokeToggle) {
    smokeToggle = document.createElement("label");
    smokeToggle.className = "work-smoke-toggle";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "work-smoke-toggle-input";
    input.setAttribute("aria-label", "Show smoke test artifacts");
    input.addEventListener("change", () => {
      showSmoke = input.checked;
      renderWorkBoard(cachedSpecs, cachedPlans);
    });
    smokeToggle.append(input, document.createTextNode(" Show smoke"));
    workBoardHint.append(smokeToggle);
  }
  smokeToggle.querySelector("input").checked = showSmoke;
}

function syncBoardControls(total) {
  syncSmokeToggle();
  if (!workHeading) return;

  if (total <= WORK_FILTER_THRESHOLD) {
    if (workFilterSelect) {
      workFilterSelect.remove();
      workFilterSelect = null;
      workFilter = "all";
    }
    return;
  }
  if (!workFilterSelect) {
    workFilterSelect = document.createElement("select");
    workFilterSelect.id = "work-filter";
    workFilterSelect.className = "work-filter";
    workFilterSelect.setAttribute("aria-label", "Filter active work");
    workFilterSelect.innerHTML = `
      <option value="all">Show all work</option>
      <option value="locked">Locked only</option>
      <option value="active">Ready or in progress</option>
    `;
    workFilterSelect.addEventListener("change", () => {
      workFilter = workFilterSelect.value;
      renderWorkBoard(cachedSpecs, cachedPlans);
    });
    workHeading.append(workFilterSelect);
  }
  if (workFilterSelect) workFilterSelect.value = workFilter;
}

function setBusy(busy) {
  if (boardMain) boardMain.setAttribute("aria-busy", busy ? "true" : "false");
}

function appendRetryButton(parent, label, onRetry) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-ghost banner-retry";
  btn.textContent = label;
  btn.addEventListener("click", onRetry);
  parent.append(btn);
  return btn;
}

function showBoardError(message, onRetry) {
  if (!boardError) return;
  boardError.replaceChildren();
  const text = document.createElement("span");
  text.className = "banner-error-text";
  text.textContent = message;
  boardError.append(text);
  if (onRetry) appendRetryButton(boardError, "Try again", onRetry);
  boardError.hidden = false;
  boardError.setAttribute("aria-live", "assertive");
}

function showDetailError(message, onRetry) {
  if (!detailLoading) return;
  detailLoading.replaceChildren();
  detailLoading.classList.add("panel-status--error");
  const text = document.createElement("span");
  text.textContent = message;
  detailLoading.append(text);
  if (onRetry) appendRetryButton(detailLoading, "Retry", onRetry);
  detailLoading.hidden = false;
}

function clearDetailError() {
  if (!detailLoading) return;
  detailLoading.classList.remove("panel-status--error");
  detailLoading.replaceChildren();
}

function hideBoardError() {
  if (boardError) boardError.hidden = true;
}

function setLoading(panel, loading) {
  if (!panel) return;
  panel.hidden = !loading;
}

function escape(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function detailFromHash() {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash.startsWith("specs/")) {
    return {
      type: "spec",
      id: decodeURIComponent(hash.slice("specs/".length).split("/")[0]),
    };
  }
  if (hash.startsWith("plans/")) {
    return {
      type: "plan",
      id: decodeURIComponent(hash.slice("plans/".length).split("/")[0]),
    };
  }
  return null;
}

function plansForSpec(slug) {
  return cachedPlans.filter((plan) => plan.spec_slug === slug);
}

function hasDetailSelection() {
  return !!(activeSlug || activePlanId);
}

function setDetailOpen(open) {
  if (!boardMain) return;
  if (open) boardMain.dataset.detailOpen = "true";
  else delete boardMain.dataset.detailOpen;
  syncDetailChrome();
}

function syncDetailChrome() {
  const selected = hasDetailSelection();
  const loading = detailLoading && !detailLoading.hidden;
  if (detailEmpty) detailEmpty.hidden = selected || loading;
  if (!selected) {
    if (detailLoading) detailLoading.hidden = true;
    hideDetailViews();
    clearBreadcrumb();
  }
}

function clearBreadcrumb() {
  if (!detailBreadcrumb) return;
  detailBreadcrumb.hidden = true;
  detailBreadcrumb.replaceChildren();
}

function setBreadcrumb(parts) {
  if (!detailBreadcrumb) return;
  if (!parts?.length) {
    clearBreadcrumb();
    return;
  }

  detailBreadcrumb.hidden = false;
  detailBreadcrumb.replaceChildren();

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "detail-breadcrumb-sep";
      sep.setAttribute("aria-hidden", "true");
      sep.textContent = "›";
      detailBreadcrumb.append(sep);
    }

    if (part.onClick) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "detail-breadcrumb-link";
      btn.textContent = part.label;
      if (part.title) btn.title = part.title;
      btn.addEventListener("click", part.onClick);
      detailBreadcrumb.append(btn);
    } else {
      const current = document.createElement("span");
      current.className = "detail-breadcrumb-current";
      current.textContent = part.label;
      if (i === parts.length - 1) current.setAttribute("aria-current", "page");
      detailBreadcrumb.append(current);
    }
  }
}

function workspaceForSlug(slug) {
  return cachedWorkspaces.get(slug) ?? null;
}

function createSpecRow(spec) {
  const linkedPlans = plansForSpec(spec.slug);
  const workspace = workspaceForSlug(spec.slug);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "work-row work-row--spec";
  if (spec.slug === activeSlug) btn.classList.add("is-selected");
  if (activePlanId && linkedPlans.some((p) => p.id === activePlanId)) {
    btn.classList.add("is-related");
  }
  btn.dataset.slug = spec.slug;
  btn.setAttribute("aria-label", specLinkLabel(spec));
  btn.setAttribute("aria-pressed", spec.slug === activeSlug ? "true" : "false");

  const lockText = lockTreeSummary(spec.lock);
  const workspaceBadge = workspace
    ? `<span class="workspace-badge" title="${escape(workspace.worktree_path)}">${escape(workspaceTreeSummary(workspace))}</span>`
    : "";
  const rollup =
    linkedPlans.length === 1 && !linkedPlans[0]._footerOnly
      ? `<span class="work-row-plan-rollup">${escape(planProgressLabel(linkedPlans[0]))}${linkedPlans[0].active_phase?.title ? ` · ${escape(linkedPlans[0].active_phase.title)}` : ""}</span>`
      : linkedPlans.length > 1
        ? `<span class="work-row-plan-rollup">${linkedPlans.length} plans</span>`
        : "";
  const orchLabels = specOrchestrationLabels(spec);
  const orchPills = orchLabels
    .map(
      (label) =>
        `<span class="status-pill status-pill--orch" data-orch="${escape(label)}">${escape(label)}</span>`,
    )
    .join("");

  btn.innerHTML = `
    <span class="work-row-kind">Spec</span>
    <span class="work-row-main">
      <span class="work-row-title">${escape(spec.title)}</span>
      <span class="work-row-slug">${escape(spec.slug)}</span>
      ${rollup}
    </span>
    <span class="work-row-meta work-row-meta--inline">
      ${spec.lock ? `<span class="lock-badge" data-held="true" title="${escape(lockSummary(spec.lock))}">${escape(lockText)}</span>` : ""}
      ${workspaceBadge}
      <span class="status-pill status-pill--intent" data-status="${escape(specBoardStatus(spec))}">${escape(specBoardStatusLabel(spec))}</span>
      ${orchPills}
      <span class="work-row-age sr-only">Updated ${formatAge(spec.updated_at)}</span>
    </span>
  `;

  btn.addEventListener("click", () => {
    if (spec.slug === activeSlug) {
      closeDetail();
      return;
    }
    lastFocusedButton = btn;
    openSpec(spec.slug);
  });

  return btn;
}

function createImplRow(plan, { nested = false } = {}) {
  const ratio = Math.round((plan.completion_ratio || 0) * 100);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "work-row work-row--impl";
  if (nested) btn.classList.add("work-row--nested");
  if (plan.id === activePlanId) btn.classList.add("is-selected");
  if (activeSlug && plan.spec_slug === activeSlug) btn.classList.add("is-related");
  btn.dataset.planId = plan.id;
  btn.setAttribute("aria-label", planLinkLabel(plan));
  btn.setAttribute("aria-pressed", plan.id === activePlanId ? "true" : "false");

  const activePhase = plan.active_phase?.title
    ? `<span class="work-row-phase">${escape(plan.active_phase.title)}</span>`
    : "";
  const lockLine = plan.lock
    ? `<span class="lock-badge" title="${escape(lockSummary(plan.lock))}">${escape(lockTreeSummary(plan.lock))}</span>`
    : "";
  const workspace = workspaceForSlug(plan.spec_slug);
  const workspaceBadge = workspace
    ? `<span class="workspace-badge" title="${escape(workspace.worktree_path)}">${escape(workspaceTreeSummary(workspace))}</span>`
    : "";

  btn.innerHTML = `
    <span class="work-row-kind">Implementation</span>
    <span class="work-row-main">
      <span class="work-row-title">${escape(plan.title)}</span>
      ${activePhase}
      <span class="work-row-progress">
        <span class="plan-progress-label">${escape(planProgressLabel(plan))}</span>
        <span class="plan-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${ratio}" aria-label="${escape(planProgressLabel(plan))}" style="--plan-progress: ${ratio / 100}">
          <span class="plan-progress-bar"></span>
        </span>
      </span>
    </span>
    <span class="work-row-meta work-row-meta--inline">
      ${lockLine}
      ${workspaceBadge}
      <span class="status-pill status-pill--build" data-status="${escape(planBoardStatus(plan))}">${escape(planBoardStatusLabel(plan))}</span>
    </span>
  `;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (plan.id === activePlanId) {
      closeDetail();
      return;
    }
    lastFocusedButton = btn;
    openPlan(plan.id);
  });

  return btn;
}

function appendImplList(plans) {
  const ul = document.createElement("ul");
  ul.className = "work-impl-list";
  ul.setAttribute("role", "list");
  for (const plan of plans) {
    const li = document.createElement("li");
    li.append(createImplRow(plan, { nested: true }));
    ul.append(li);
  }
  return ul;
}

function renderWorkBoard(specs, plans) {
  if (!workList || !workEmpty) return;
  setLoading(workLoading, false);
  workList.replaceChildren();
  cachedSpecs = specs;
  cachedPlans = plans;

  const smokeFiltered = applySmokeFilter(specs, plans);
  syncBoardControls(activeWorkUnitCount(smokeFiltered.specs, smokeFiltered.plans));
  const filtered = filterBoardData(smokeFiltered.specs, smokeFiltered.plans);
  specs = filtered.specs;
  plans = filtered.plans;

  const specSlugs = new Set(specs.map((s) => s.slug));
  const orphanPlans = plans.filter((p) => !specSlugs.has(p.spec_slug));

  if (!specs.length && !orphanPlans.length) {
    workList.hidden = true;
    workEmpty.hidden = false;
    if (workCount) workCount.hidden = true;
    if (workBoardHint) workBoardHint.hidden = true;
    return;
  }

  workEmpty.hidden = true;
  workList.hidden = false;
  if (workBoardHint) workBoardHint.hidden = false;
  if (workCount) {
    const units = activeWorkUnitCount(specs, plans);
    workCount.textContent = String(units);
    workCount.hidden = !units;
    workCount.setAttribute(
      "aria-label",
      units === 1 ? "1 active work unit" : `${units} active work units`,
    );
  }

  for (const spec of specs) {
    const group = document.createElement("li");
    group.className = "work-group work-group--spec-plan";
    group.dataset.specSlug = spec.slug;
    group.append(createSpecRow(spec));
    const nested = plansForSpec(spec.slug);
    if (nested.length) group.append(appendImplList(nested));
    workList.append(group);
  }

  if (orphanPlans.length) {
    const bySlug = new Map();
    for (const plan of orphanPlans) {
      const slug = plan.spec_slug || "unknown";
      if (!bySlug.has(slug)) bySlug.set(slug, []);
      bySlug.get(slug).push(plan);
    }

    for (const [slug, slugPlans] of bySlug) {
      const group = document.createElement("li");
      group.className = "work-group work-group--detached";

      const label = document.createElement("div");
      label.className = "work-group-detached-label";
      label.textContent = `Spec completed · ${slug}`;
      group.append(label);
      group.append(appendImplList(slugPlans));
      workList.append(group);
    }
  }
}

function hideDetailViews() {
  if (specDetailRoot) specDetailRoot.hidden = true;
  if (planDetailRoot) planDetailRoot.hidden = true;
}

function closeDetail({ updateHash = true } = {}) {
  activeSlug = null;
  activePlanId = null;
  setDetailOpen(false);
  document.title = "scribe · devscrolls";
  renderWorkBoard(cachedSpecs, cachedPlans);
  if (updateHash) {
    const url = new URL(window.location.href);
    url.hash = "";
    history.pushState(null, "", url);
  }
  lastFocusedButton?.focus();
  lastFocusedButton = null;
}

async function openSpec(slug, { updateHash = true } = {}) {
  if (!slug) return;
  activeSlug = slug;
  activePlanId = null;
  setDetailOpen(true);
  hideDetailViews();
  clearBreadcrumb();
  renderWorkBoard(cachedSpecs, cachedPlans);
  if (detailLoading) {
    clearDetailError();
    setLoadingText(detailLoading, DETAIL_LOADING);
    detailLoading.hidden = false;
  }
  syncDetailChrome();

  if (updateHash) {
    const url = new URL(window.location.href);
    url.hash = `specs/${encodeURIComponent(slug)}`;
    history.pushState(null, "", url);
  }

  try {
    const data = await apiFetch(`specs/${encodeURIComponent(slug)}`);
    const spec = data.spec;
    if (!spec) throw new Error("Spec not found");

    if (detailLoading) {
      clearDetailError();
      detailLoading.hidden = true;
    }
    if (specDetailRoot) {
      specDetailRoot.hidden = false;
      const linkedPlans = resolveLinkedPlanRefs(slug, spec.body, cachedPlans);
      renderSpecDetail(specDetailRoot, spec, {
        linkedPlans,
        workspace: cachedWorkspaces.get(spec.slug) ?? null,
      });
    }
    document.title = `${spec.title} · scribe · devscrolls`;
    detailPanel?.scrollTo(0, 0);
    focusDetailOnMobile();
  } catch (e) {
    showDetailError(e.message || "Could not load spec", () => openSpec(slug, { updateHash: false }));
  }
}

async function openPlan(id, { updateHash = true } = {}) {
  if (!id) return;
  activePlanId = id;
  activeSlug = null;
  setDetailOpen(true);
  hideDetailViews();
  renderWorkBoard(cachedSpecs, cachedPlans);
  if (detailLoading) {
    clearDetailError();
    setLoadingText(detailLoading, DETAIL_LOADING);
    detailLoading.hidden = false;
  }
  syncDetailChrome();

  if (updateHash) {
    const url = new URL(window.location.href);
    url.hash = `plans/${encodeURIComponent(id)}`;
    history.pushState(null, "", url);
  }

  try {
    const data = await apiFetch(`plans/${encodeURIComponent(id)}`);
    const plan = data.plan;
    if (!plan) throw new Error("Plan not found");

    if (detailLoading) {
      clearDetailError();
      detailLoading.hidden = true;
    }
    if (planDetailRoot) {
      planDetailRoot.hidden = false;
      renderPlanDetail(planDetailRoot, plan);
    }

    const specMeta = cachedSpecs.find((s) => s.slug === plan.spec_slug);
    const specTitle = specMeta?.title || plan.spec_slug;

    setBreadcrumb([
      {
        label: specTitle,
        title: plan.spec_slug,
        onClick: () => {
          lastFocusedButton = document.querySelector(
            `[data-plan-id="${CSS.escape(id)}"]`,
          );
          openSpec(plan.spec_slug);
        },
      },
      { label: plan.title },
    ]);

    document.title = `${plan.title} · scribe · devscrolls`;
    detailPanel?.scrollTo(0, 0);
    focusDetailOnMobile();
  } catch (e) {
    showDetailError(e.message || "Could not load plan", () => openPlan(id, { updateHash: false }));
  }
}

async function loadBoard() {
  setBusy(true);
  hideBoardError();
  setLoadingText(workLoading, WORK_LOADING);
  setLoading(workLoading, true);
  if (workList) workList.hidden = true;
  if (workEmpty) workEmpty.hidden = true;

  try {
    const [specData, planData, workspaceData] = await Promise.all([
      apiFetch("specs"),
      apiFetch("plans?all=true"),
      apiFetch("workspaces").catch(() => ({ workspaces: [] })),
    ]);
    const specs = specData.specs || [];
    const plans = mergePlansForActiveSpecs(planData.plans || [], specs);
    cachedWorkspaces = new Map((workspaceData.workspaces || []).map((ws) => [ws.id, ws]));
    renderWorkBoard(specs, plans);
  } catch (e) {
    setLoading(workLoading, false);
    const msg =
      e instanceof TypeError
        ? "Could not reach scribe. Check the network, then try again."
        : e.message || "Could not load the board";
    showBoardError(msg, () => loadBoard());
    if (workEmpty) workEmpty.hidden = true;
    if (workList) workList.hidden = true;
  } finally {
    setBusy(false);
    const fromHash = detailFromHash();
    const slug = fromHash?.type === "spec" ? fromHash.id : specSlugFromPath();
    const planId = fromHash?.type === "plan" ? fromHash.id : planIdFromPath();
    if (planId) openPlan(planId, { updateHash: false });
    else if (slug) openSpec(slug, { updateHash: false });
    else syncDetailChrome();
  }
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && (activeSlug || activePlanId)) {
    e.preventDefault();
    closeDetail();
    return;
  }
  if (e.key !== "r" || e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  e.preventDefault();
  loadBoard();
});

window.addEventListener("popstate", () => {
  const target = detailFromHash();
  if (target?.type === "plan") openPlan(target.id, { updateHash: false });
  else if (target?.type === "spec") openSpec(target.id, { updateHash: false });
  else closeDetail({ updateHash: false });
});

loadBoard();
