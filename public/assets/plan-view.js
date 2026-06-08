import {
  fetchPlanRevision,
  fetchPlanRevisions,
  formatAge,
  lockSummary,
  planBoardStatus,
  planBoardStatusLabel,
  planProgressDisplayLabel,
  planProgressTracked,
  planReviewLoopActive,
  revisionSummaryLabel,
  shouldShowDiffToggle,
} from "./api.js";
import { mountRevisionTimeline } from "./revision-timeline.js";
import {
  mountBodyViewToggle,
  renderDiffPanelHtml,
  syncBodyViewToggle,
} from "./detail-diff.js";
import { renderMarkdown } from "./markdown.js";

/** @typedef {"prose" | "changes"} BodyViewMode */

/**
 * @param {object} plan
 * @param {object | null | undefined} spec
 */
export function planDiffUiState(plan, spec) {
  const loopActive = planReviewLoopActive(plan, spec);
  const count = plan.revisions_count ?? 0;
  const showToggle = shouldShowDiffToggle(plan, loopActive);
  const prefix = loopActive && plan.status === "blocked" ? "Plan review · " : "";
  return {
    loopActive,
    showToggle,
    iterationLabel: count > 0 ? `${prefix}Iteration · ${count}` : null,
    showIterationChip: loopActive && count > 0,
    revisionMeta: revisionSummaryLabel(plan.last_revision),
  };
}

/**
 * @param {object} plan
 * @param {{ mode: BodyViewMode, diff?: object | null }} opts
 */
export function renderPlanBodyHtml(plan, opts) {
  if (opts.mode === "changes" && opts.diff?.base_body != null && opts.diff?.head_body != null) {
    const summary = revisionSummaryLabel(plan.last_revision);
    return renderDiffPanelHtml(opts.diff, { summary: summary || null });
  }
  return plan.body?.trim()
    ? renderMarkdown(plan.body)
    : '<p class="prose-empty">This implementation has no markdown body yet.</p>';
}

function normalizeTitle(text) {
  return String(text).trim().toLowerCase().replace(/\s+/g, " ");
}

function hideIfTitleMatch(el, title) {
  if (!el || el.hidden) return;
  if (normalizeTitle(el.textContent) === title) el.hidden = true;
}

function hideDuplicateShellContent(bodyEl, plan) {
  const title = normalizeTitle(plan.title);
  hideIfTitleMatch(bodyEl.querySelector(".prose-title"), title);
  hideIfTitleMatch(bodyEl.firstElementChild, title);
}

/**
 * @param {HTMLElement} toolbar
 * @param {object} plan
 * @param {{ diffUi: ReturnType<typeof planDiffUiState>, viewMode: BodyViewMode, onViewModeChange: (mode: BodyViewMode) => void }} diffOpts
 */
function appendDiffToolbar(toolbar, diffOpts) {
  if (diffOpts.diffUi.showIterationChip && diffOpts.diffUi.iterationLabel) {
    const chip = document.createElement("span");
    chip.className = "status-pill status-pill--orch status-pill--iteration";
    chip.dataset.orch = "iteration";
    chip.textContent = diffOpts.diffUi.iterationLabel;
    toolbar.append(chip);
  }

  mountBodyViewToggle(toolbar, {
    visible: diffOpts.diffUi.showToggle,
    mode: diffOpts.viewMode,
    onChange: diffOpts.onViewModeChange,
  });

  if (diffOpts.diffUi.revisionMeta && diffOpts.diffUi.showToggle) {
    const meta = document.createElement("span");
    meta.className = "spec-toolbar-meta spec-toolbar-revision-meta";
    meta.textContent = diffOpts.diffUi.revisionMeta;
    toolbar.append(meta);
  }
}

export function renderPlanToolbar(toolbar, plan, { spec = null, diffUi = null, viewMode = "prose", onViewModeChange = null } = {}) {
  if (!toolbar) return;
  toolbar.replaceChildren();

  const status = document.createElement("span");
  status.className = "status-pill";
  status.dataset.status = planBoardStatus(plan);
  status.textContent = planBoardStatusLabel(plan);
  toolbar.append(status);

  const ui = diffUi ?? planDiffUiState(plan, spec);
  if (onViewModeChange) {
    appendDiffToolbar(toolbar, {
      diffUi: ui,
      viewMode,
      onViewModeChange,
    });
  }

  const progress = document.createElement("span");
  progress.className = "spec-toolbar-meta";
  progress.textContent = planProgressDisplayLabel(plan);
  toolbar.append(progress);

  const updated = document.createElement("span");
  updated.className = "spec-toolbar-meta";
  updated.textContent = `Updated ${formatAge(plan.updated_at)}`;
  toolbar.append(updated);

  if (plan.lock) {
    const lock = document.createElement("span");
    lock.className = "lock-badge";
    lock.textContent = lockSummary(plan.lock);
    toolbar.append(lock);
  }
}

export function renderPhaseSummary(container, phases) {
  if (!container) return;
  container.replaceChildren();
  if (!phases?.length) {
    container.hidden = true;
    return;
  }
  container.hidden = false;

  const list = document.createElement("ol");
  list.className = "plan-phase-list";
  list.setAttribute("role", "list");

  for (const phase of phases) {
    const li = document.createElement("li");
    li.className = "plan-phase-item";
    li.dataset.status = phase.status;

    const marker = document.createElement("span");
    marker.className = "plan-phase-marker";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent =
      phase.status === "done" ? "✓" : phase.status === "active" ? "…" : "○";

    const title = phase.title || `Phase ${phase.index}`;
    const statusWord =
      phase.status === "done" ? "Done" : phase.status === "active" ? "Active" : "Pending";

    const label = document.createElement("span");
    label.className = "plan-phase-label";
    label.textContent = title;

    li.setAttribute("aria-label", `${title}, ${statusWord}`);
    li.append(marker, label);
    list.append(li);
  }

  container.append(list);
}

export function renderUserInstructions(root, plan) {
  const section = root?.querySelector("#plan-user-instructions");
  const bodyEl = root?.querySelector("#plan-user-instructions-body");
  if (!section || !bodyEl) return;

  const text = plan.user_instructions?.trim();
  if (!text) {
    section.hidden = true;
    bodyEl.replaceChildren();
    return;
  }

  section.hidden = false;
  bodyEl.innerHTML = renderMarkdown(text);
}

export function renderPlanDetail(root, plan, opts = {}) {
  if (!root || !plan) return;

  const titleEl = root.querySelector("#plan-title");
  const toolbar = root.querySelector("#plan-toolbar");
  const phaseSummary = root.querySelector("#plan-phase-summary");
  const bodyEl = root.querySelector("#plan-body");
  const doneNotice = root.querySelector("#plan-done-notice");

  if (titleEl) titleEl.textContent = plan.title;

  const diffUi = planDiffUiState(plan, opts.spec ?? null);
  let viewMode = /** @type {BodyViewMode} */ (root.dataset.bodyViewMode || "prose");
  if (viewMode === "changes" && !opts.diff) viewMode = "prose";

  const applyBody = () => {
    if (!bodyEl) return;
    bodyEl.innerHTML = renderPlanBodyHtml(plan, { mode: viewMode, diff: opts.diff ?? null });
    if (viewMode === "prose") hideDuplicateShellContent(bodyEl, plan);
    root.dataset.bodyViewMode = viewMode;
    syncBodyViewToggle(toolbar?.querySelector(".view-toggle"), viewMode);
  };

  const onViewModeChange = (mode) => {
    viewMode = mode;
    applyBody();
  };

  if (planProgressTracked(plan)) {
    renderPhaseSummary(phaseSummary, plan.phases);
  } else if (phaseSummary) {
    phaseSummary.hidden = true;
    phaseSummary.replaceChildren();
  }
  renderPlanToolbar(toolbar, plan, {
    spec: opts.spec ?? null,
    diffUi,
    viewMode,
    onViewModeChange: diffUi.showToggle ? onViewModeChange : null,
  });
  renderUserInstructions(root, plan);
  applyBody();

  const timeline = root.querySelector("#plan-revision-timeline");
  mountRevisionTimeline(timeline, {
    summary: plan.revisions_summary ?? null,
    fetchList: (opts) => fetchPlanRevisions(plan.id, opts),
    fetchDetail: (id) => fetchPlanRevision(plan.id, id),
  });

  if (doneNotice) {
    doneNotice.hidden = plan.status !== "done";
  }
}
