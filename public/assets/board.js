import {
  apiFetch,
  apiFetchWithEtag,
  fetchPlanDiff,
  fetchRecordEtag,
  fetchSpecDiff,
  formatAge,
  lockSummary,
  lockTreeSummary,
  workspaceEnvSnippet,
  workspaceTreeSummary,
  partitionCompletedWork,
  planIdFromPath,
  mergePlansForActiveSpecs,
  planBoardStatus,
  planBoardStatusLabel,
  planLinkLabel,
  planProgressDisplayLabel,
  planProgressLabel,
  planProgressTracked,
  planReviewLoopActive,
  revisionListMeta,
  specLinkLabel,
  specSlugFromPath,
  specBoardStatus,
  specBoardStatusLabel,
  specNeedsReviewAttention,
  specOrchestrationLabels,
  specReviewLoopActive,
  workUnitCount,
} from "./api.js";
import {
  pulseIterationChip,
  setDetailPollEtag,
  startDetailPoll,
  stopDetailPoll,
} from "./detail-poll.js";
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
const BOARD_PANE_KEY = "scribe-board-pane";
const BOARD_PANE_ACTIVE = "active";
const BOARD_PANE_COMPLETED = "completed";

let activeSlug = null;
let activePlanId = null;
let cachedSpecs = [];
let cachedPlans = [];
let cachedCompletedSpecs = [];
let cachedCompletedPlans = [];
let completedLoaded = false;
let completedLoading = false;
/** @type {Map<string, object>} */
let cachedWorkspaces = new Map();
let lastFocusedButton = null;
let workFilter = "all";
let workFilterSelect = null;
let workPaneTabs = null;
let boardPane =
  sessionStorage.getItem(BOARD_PANE_KEY) === BOARD_PANE_COMPLETED
    ? BOARD_PANE_COMPLETED
    : BOARD_PANE_ACTIVE;

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

function isCompletedPane() {
  return boardPane === BOARD_PANE_COMPLETED;
}

function getCurrentSpecs() {
  return isCompletedPane() ? cachedCompletedSpecs : cachedSpecs;
}

function getCurrentPlans() {
  return isCompletedPane() ? cachedCompletedPlans : cachedPlans;
}

function allCachedPlans() {
  if (!cachedCompletedPlans.length) return cachedPlans;
  const seen = new Set(cachedPlans.map((p) => p.id));
  const merged = [...cachedPlans];
  for (const plan of cachedCompletedPlans) {
    if (!seen.has(plan.id)) merged.push(plan);
  }
  return merged;
}

function setWorkHeadingLabel(pane) {
  if (!workHeading) return;
  let labelEl = workHeading.querySelector(".work-heading-label");
  if (!labelEl) {
    labelEl = document.createElement("span");
    labelEl.className = "work-heading-label";
    workHeading.prepend(labelEl);
  }
  labelEl.textContent =
    pane === BOARD_PANE_COMPLETED ? "Completed / shipped" : "Active work";
}

function completedPaneCrumb() {
  return {
    label: "Completed",
    onClick: () => {
      if (!isCompletedPane()) switchBoardPane(BOARD_PANE_COMPLETED);
    },
  };
}

function syncBoardTabs(activeCount, completedCount) {
  const rail = workHeading?.closest(".board-rail-work");
  if (!rail) return;

  if (!workPaneTabs) {
    workPaneTabs = document.createElement("div");
    workPaneTabs.id = "work-pane-tabs";
    workPaneTabs.className = "work-pane-tabs";
    workPaneTabs.setAttribute("role", "tablist");
    workPaneTabs.setAttribute("aria-label", "Work board");
    rail.insertBefore(workPaneTabs, workHeading);
  }

  workPaneTabs.replaceChildren();

  for (const [pane, label] of [
    [BOARD_PANE_ACTIVE, "Active"],
    [BOARD_PANE_COMPLETED, "Completed"],
  ]) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "work-pane-tab";
    tab.setAttribute("role", "tab");
    tab.id = `work-pane-tab-${pane}`;
    tab.setAttribute("aria-controls", "work-list");
    tab.setAttribute("aria-selected", pane === boardPane ? "true" : "false");
    tab.tabIndex = pane === boardPane ? 0 : -1;

    const text = document.createElement("span");
    text.textContent = label;
    tab.append(text);

    const count =
      pane === BOARD_PANE_ACTIVE
        ? activeCount
        : completedLoaded
          ? completedCount
          : null;
    if (count !== null && count > 0) {
      const badge = document.createElement("span");
      badge.className = "work-pane-tab-badge";
      badge.textContent = String(count);
      badge.setAttribute(
        "aria-label",
        count === 1 ? "1 item" : `${count} items`,
      );
      tab.append(badge);
    }

    tab.addEventListener("click", () => switchBoardPane(pane));
    workPaneTabs.append(tab);
  }
}

function switchBoardPane(pane) {
  if (pane === boardPane) return;
  boardPane = pane;
  sessionStorage.setItem(BOARD_PANE_KEY, pane);
  hideBoardError();
  if (pane === BOARD_PANE_COMPLETED && !completedLoaded) {
    loadCompletedBoard();
    return;
  }
  renderCurrentBoard();
}

function renderCurrentBoard() {
  if (isCompletedPane()) {
    renderBoard(cachedCompletedSpecs, cachedCompletedPlans, {
      pane: BOARD_PANE_COMPLETED,
    });
  } else {
    renderBoard(cachedSpecs, cachedPlans, { pane: BOARD_PANE_ACTIVE });
  }
}

function specMatchesFilter(spec) {
  if (workFilter === "all") return true;
  if (workFilter === "locked") return !!spec.lock;
  if (workFilter === "review") return specNeedsReviewAttention(spec);
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

/** Hide ged-smoke-* artifacts from the active board (always filtered). */
function applySmokeFilter(specs, plans) {
  return {
    specs: specs.filter((s) => !isSmokeArtifact(s)),
    plans: plans.filter((p) => !isSmokeArtifact(p)),
  };
}

function syncBoardControls(total, { pane = boardPane } = {}) {
  const activeUnits = workUnitCount(
    applySmokeFilter(cachedSpecs, cachedPlans).specs,
    applySmokeFilter(cachedSpecs, cachedPlans).plans,
  );
  const completedUnits = completedLoaded
    ? workUnitCount(cachedCompletedSpecs, cachedCompletedPlans)
    : 0;
  syncBoardTabs(activeUnits, completedUnits);
  setWorkHeadingLabel(pane);

  if (!workHeading) return;

  if (isCompletedPane() || total <= WORK_FILTER_THRESHOLD) {
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
      <option value="review">Needs review</option>
      <option value="active">Ready or in progress</option>
    `;
    workFilterSelect.addEventListener("change", () => {
      workFilter = workFilterSelect.value;
      renderBoard(cachedSpecs, cachedPlans, { pane: BOARD_PANE_ACTIVE });
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
  return getCurrentPlans().filter((plan) => plan.spec_slug === slug);
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

function specMetaForPlan(plan) {
  return (
    getCurrentSpecs().find((s) => s.slug === plan.spec_slug) ||
    cachedCompletedSpecs.find((s) => s.slug === plan.spec_slug) ||
    cachedSpecs.find((s) => s.slug === plan.spec_slug) ||
    null
  );
}

function upsertCachedSpec(spec) {
  const idx = cachedSpecs.findIndex((s) => s.slug === spec.slug);
  if (idx >= 0) cachedSpecs[idx] = { ...cachedSpecs[idx], ...spec };
}

function upsertCachedPlan(plan) {
  const idx = cachedPlans.findIndex((p) => p.id === plan.id);
  if (idx >= 0) cachedPlans[idx] = { ...cachedPlans[idx], ...plan };
}

async function loadSpecDiff(slug, spec) {
  if ((spec.revisions_count ?? 0) <= 0) return null;
  try {
    return await fetchSpecDiff(slug);
  } catch {
    return null;
  }
}

async function loadPlanDiff(id, plan) {
  if ((plan.revisions_count ?? 0) <= 0) return null;
  try {
    return await fetchPlanDiff(id);
  } catch {
    return null;
  }
}

function paintSpecDetailView(spec, { diff = null } = {}) {
  if (!specDetailRoot) return;
  const linkedPlans = resolveLinkedPlanRefs(spec.slug, spec.body, allCachedPlans());
  renderSpecDetail(specDetailRoot, spec, {
    linkedPlans,
    workspace: cachedWorkspaces.get(spec.slug) ?? null,
    diff,
  });
}

function paintPlanDetailView(plan, specMeta, { diff = null } = {}) {
  if (!planDetailRoot) return;
  renderPlanDetail(planDetailRoot, plan, { spec: specMeta, diff });
}

async function refreshSpecDetailQuiet(slug, { pulse = false } = {}) {
  const data = await apiFetch(`specs/${encodeURIComponent(slug)}`);
  const spec = data.spec;
  if (!spec || !specDetailRoot) return spec;
  upsertCachedSpec(spec);
  const diff = await loadSpecDiff(slug, spec);
  paintSpecDetailView(spec, { diff });
  if (pulse) pulseIterationChip(specDetailRoot);
  renderCurrentBoard();
  return spec;
}

async function refreshPlanDetailQuiet(id, { pulse = false } = {}) {
  const data = await apiFetch(`plans/${encodeURIComponent(id)}`);
  const plan = data.plan;
  if (!plan || !planDetailRoot) return plan;
  upsertCachedPlan(plan);
  const specMeta = specMetaForPlan(plan);
  const diff = await loadPlanDiff(id, plan);
  paintPlanDetailView(plan, specMeta, { diff });
  if (pulse) pulseIterationChip(planDetailRoot);
  renderCurrentBoard();
  return plan;
}

function beginSpecDetailPoll(slug) {
  const segment = `specs/${encodeURIComponent(slug)}`;
  startDetailPoll({
    shouldContinue: () => activeSlug === slug && !isCompletedPane(),
    tick: async (prevEtag) => {
      const etag = await fetchRecordEtag(segment);
      if (!etag) return;
      if (prevEtag && etag !== prevEtag) {
        await refreshSpecDetailQuiet(slug, { pulse: true });
      }
      setDetailPollEtag(etag);
    },
  });
}

function beginPlanDetailPoll(id) {
  const segment = `plans/${encodeURIComponent(id)}`;
  startDetailPoll({
    shouldContinue: () => activePlanId === id && !isCompletedPane(),
    tick: async (prevEtag) => {
      const etag = await fetchRecordEtag(segment);
      if (!etag) return;
      if (prevEtag && etag !== prevEtag) {
        await refreshPlanDetailQuiet(id, { pulse: true });
      }
      setDetailPollEtag(etag);
    },
  });
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
      ? ""
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
  const revMeta =
    !isCompletedPane() ? revisionListMeta(spec, specReviewLoopActive(spec)) : null;
  const revMetaHtml = revMeta
    ? `<span class="work-row-revision-meta" title="Body changes during review loop">${escape(revMeta)}</span>`
    : "";

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
      ${revMetaHtml}
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
  const tracked = planProgressTracked(plan);
  const ratio = tracked ? Math.round((plan.completion_ratio || 0) * 100) : 0;
  const progressLabel = planProgressDisplayLabel(plan);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "work-row work-row--impl";
  if (nested) btn.classList.add("work-row--nested");
  if (plan.id === activePlanId) btn.classList.add("is-selected");
  if (activeSlug && plan.spec_slug === activeSlug) btn.classList.add("is-related");
  btn.dataset.planId = plan.id;
  btn.setAttribute("aria-label", planLinkLabel(plan));
  btn.setAttribute("aria-pressed", plan.id === activePlanId ? "true" : "false");

  const activePhase =
    tracked && plan.active_phase?.title
      ? `<span class="work-row-phase">${escape(plan.active_phase.title)}</span>`
      : "";
  const lockLine = plan.lock
    ? `<span class="lock-badge" title="${escape(lockSummary(plan.lock))}">${escape(lockTreeSummary(plan.lock))}</span>`
    : "";
  const workspace = workspaceForSlug(plan.spec_slug);
  const workspaceBadge = workspace
    ? `<span class="workspace-badge" title="${escape(workspace.worktree_path)}">${escape(workspaceTreeSummary(workspace))}</span>`
    : "";
  const specMeta = specMetaForPlan(plan);
  const revMeta =
    !isCompletedPane()
      ? revisionListMeta(plan, planReviewLoopActive(plan, specMeta))
      : null;
  const revMetaHtml = revMeta
    ? `<span class="work-row-revision-meta" title="Plan body changes during review loop">${escape(revMeta)}</span>`
    : "";

  btn.innerHTML = `
    <span class="work-row-kind">Implementation</span>
    <span class="work-row-main">
      <span class="work-row-title">${escape(plan.title)}</span>
      ${activePhase}
      <span class="work-row-progress${tracked ? "" : " work-row-progress--untracked"}">
        <span class="plan-progress-label">${escape(progressLabel)}</span>
        ${
          tracked
            ? `<span class="plan-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${ratio}" aria-label="${escape(progressLabel)}" style="--plan-progress: ${ratio / 100}">
          <span class="plan-progress-bar"></span>
        </span>`
            : ""
        }
      </span>
    </span>
    <span class="work-row-meta work-row-meta--inline">
      ${lockLine}
      ${workspaceBadge}
      <span class="status-pill status-pill--build" data-status="${escape(planBoardStatus(plan))}">${escape(planBoardStatusLabel(plan))}</span>
      ${revMetaHtml}
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

function setWorkEmptyCopy(pane) {
  if (!workEmpty) return;
  const lead = workEmpty.querySelector(".panel-empty-lead");
  const hint = workEmpty.querySelector(".panel-empty-hint");
  if (pane === BOARD_PANE_COMPLETED) {
    if (lead) lead.textContent = "—";
    if (hint) hint.textContent = "No completed specs or implementations yet.";
  } else {
    if (lead) lead.textContent = "—";
    if (hint) {
      hint.textContent =
        "No specs or implementations are in flight. Open a completed spec by slug in the URL.";
    }
  }
}

function renderBoard(specs, plans, { pane = BOARD_PANE_ACTIVE } = {}) {
  if (!workList || !workEmpty) return;
  setLoading(workLoading, false);
  workList.replaceChildren();

  if (pane === BOARD_PANE_ACTIVE) {
    cachedSpecs = specs;
    cachedPlans = plans;
  } else {
    cachedCompletedSpecs = specs;
    cachedCompletedPlans = plans;
  }

  const smokeFiltered = applySmokeFilter(specs, plans);
  syncBoardControls(workUnitCount(smokeFiltered.specs, smokeFiltered.plans), {
    pane,
  });
  const filtered =
    pane === BOARD_PANE_ACTIVE
      ? filterBoardData(smokeFiltered.specs, smokeFiltered.plans)
      : smokeFiltered;
  specs = filtered.specs;
  plans = filtered.plans;

  const specSlugs = new Set(specs.map((s) => s.slug));
  const orphanPlans = plans.filter((p) => !specSlugs.has(p.spec_slug));

  if (!specs.length && !orphanPlans.length) {
    workList.hidden = true;
    workEmpty.hidden = false;
    setWorkEmptyCopy(pane);
    if (workCount) workCount.hidden = true;
    if (workBoardHint) workBoardHint.hidden = pane !== BOARD_PANE_ACTIVE;
    return;
  }

  workEmpty.hidden = true;
  workList.hidden = false;
  if (workBoardHint) workBoardHint.hidden = pane !== BOARD_PANE_ACTIVE;
  if (workCount) {
    const units = workUnitCount(specs, plans);
    workCount.textContent = String(units);
    workCount.hidden = !units;
    const unitWord = pane === BOARD_PANE_COMPLETED ? "completed" : "active";
    workCount.setAttribute(
      "aria-label",
      units === 1 ? `1 ${unitWord} work unit` : `${units} ${unitWord} work units`,
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
  stopDetailPoll();
  activeSlug = null;
  activePlanId = null;
  setDetailOpen(false);
  document.title = "scribe · devscrolls";
  renderCurrentBoard();
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
  renderCurrentBoard();
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
    const { data, etag } = await apiFetchWithEtag(`specs/${encodeURIComponent(slug)}`);
    const spec = data.spec;
    if (!spec) throw new Error("Spec not found");

    if (detailLoading) {
      clearDetailError();
      detailLoading.hidden = true;
    }
    if (specDetailRoot) {
      specDetailRoot.hidden = false;
      const diff = await loadSpecDiff(slug, spec);
      setDetailPollEtag(etag);
      paintSpecDetailView(spec, { diff });
      if (specReviewLoopActive(spec)) beginSpecDetailPoll(slug);
      else stopDetailPoll();
    }
    if (isCompletedPane() || spec.status === "done") {
      setBreadcrumb([completedPaneCrumb(), { label: spec.title }]);
    } else {
      clearBreadcrumb();
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
  renderCurrentBoard();
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
    const { data, etag } = await apiFetchWithEtag(`plans/${encodeURIComponent(id)}`);
    const plan = data.plan;
    if (!plan) throw new Error("Plan not found");

    if (detailLoading) {
      clearDetailError();
      detailLoading.hidden = true;
    }
    const specMeta = specMetaForPlan(plan);
    if (planDetailRoot) {
      planDetailRoot.hidden = false;
      const diff = await loadPlanDiff(id, plan);
      setDetailPollEtag(etag);
      paintPlanDetailView(plan, specMeta, { diff });
      if (planReviewLoopActive(plan, specMeta)) beginPlanDetailPoll(id);
      else stopDetailPoll();
    }

    const specTitle = specMeta?.title || plan.spec_slug;
    const crumbs = [
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
    ];
    if (isCompletedPane() || plan.status === "done") {
      setBreadcrumb([completedPaneCrumb(), ...crumbs]);
    } else {
      setBreadcrumb(crumbs);
    }

    document.title = `${plan.title} · scribe · devscrolls`;
    detailPanel?.scrollTo(0, 0);
    focusDetailOnMobile();
  } catch (e) {
    showDetailError(e.message || "Could not load plan", () => openPlan(id, { updateHash: false }));
  }
}

async function loadCompletedBoard() {
  if (completedLoading) return;
  completedLoading = true;
  setBusy(true);
  hideBoardError();
  setLoadingText(workLoading, [
    "Loading completed work…",
    "Fetching shipped specs and implementations…",
  ]);
  setLoading(workLoading, true);
  if (workList) workList.hidden = true;
  if (workEmpty) workEmpty.hidden = true;

  try {
    const [specData, planData, workspaceData] = await Promise.all([
      apiFetch("specs?all=true"),
      apiFetch("plans?all=true"),
      apiFetch("workspaces").catch(() => ({ workspaces: [] })),
    ]);
    const partitioned = partitionCompletedWork(
      specData.specs || [],
      planData.plans || [],
    );
    for (const ws of workspaceData.workspaces || []) {
      cachedWorkspaces.set(ws.id, ws);
    }
    completedLoaded = true;
    renderBoard(partitioned.specs, partitioned.plans, {
      pane: BOARD_PANE_COMPLETED,
    });
  } catch (e) {
    setLoading(workLoading, false);
    const msg =
      e instanceof TypeError
        ? "Could not reach scribe. Check the network, then try again."
        : e.message || "Could not load completed work";
    showBoardError(msg, () => loadCompletedBoard());
    if (workEmpty) workEmpty.hidden = true;
    if (workList) workList.hidden = true;
  } finally {
    completedLoading = false;
    setBusy(false);
    const fromHash = detailFromHash();
    const slug = fromHash?.type === "spec" ? fromHash.id : specSlugFromPath();
    const planId = fromHash?.type === "plan" ? fromHash.id : planIdFromPath();
    if (planId) openPlan(planId, { updateHash: false });
    else if (slug) openSpec(slug, { updateHash: false });
    else syncDetailChrome();
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
    if (isCompletedPane()) {
      renderBoard(specs, plans, { pane: BOARD_PANE_ACTIVE });
      await loadCompletedBoard();
    } else {
      renderBoard(specs, plans, { pane: BOARD_PANE_ACTIVE });
    }
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
    if (!isCompletedPane()) {
      const fromHash = detailFromHash();
      const slug = fromHash?.type === "spec" ? fromHash.id : specSlugFromPath();
      const planId = fromHash?.type === "plan" ? fromHash.id : planIdFromPath();
      if (planId) openPlan(planId, { updateHash: false });
      else if (slug) openSpec(slug, { updateHash: false });
      else syncDetailChrome();
    }
  }
}

function refreshBoard() {
  if (isCompletedPane()) loadCompletedBoard();
  else loadBoard();
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
  refreshBoard();
});

window.addEventListener("popstate", () => {
  const target = detailFromHash();
  if (target?.type === "plan") openPlan(target.id, { updateHash: false });
  else if (target?.type === "spec") openSpec(target.id, { updateHash: false });
  else closeDetail({ updateHash: false });
});

loadBoard();
