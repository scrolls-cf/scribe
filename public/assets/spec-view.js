import {
  formatAge,
  hideSpecExecutionSections,
  lockSummary,
  planProgressTracked,
  revisionSummaryLabel,
  shouldShowDiffToggle,
  specBoardStatus,
  specBoardStatusLabel,
  specOrchestrationLabels,
  specReviewInstructionsHref,
  specReviewLoopActive,
  specReviewNoticeState,
  workspaceEnvSnippet,
} from "./api.js";
import {
  mountBodyViewToggle,
  renderDiffPanelHtml,
  syncBodyViewToggle,
} from "./detail-diff.js";
import { renderMarkdown } from "./markdown.js";

/** @typedef {"prose" | "changes"} BodyViewMode */

/**
 * @param {object} spec
 * @returns {{ loopActive: boolean, showToggle: boolean, iterationLabel: string | null, showIterationChip: boolean, revisionMeta: string }}
 */
export function specDiffUiState(spec) {
  const loopActive = specReviewLoopActive(spec);
  const count = spec.revisions_count ?? 0;
  const showToggle = shouldShowDiffToggle(spec, loopActive);
  return {
    loopActive,
    showToggle,
    iterationLabel: count > 0 ? `Iteration · ${count}` : null,
    showIterationChip: loopActive && count > 0,
    revisionMeta: revisionSummaryLabel(spec.last_revision),
  };
}

/**
 * @param {object} spec
 * @param {{ mode: BodyViewMode, diff?: object | null }} opts
 */
export function renderSpecBodyHtml(spec, opts) {
  if (opts.mode === "changes" && opts.diff?.base_body != null && opts.diff?.head_body != null) {
    const summary = revisionSummaryLabel(spec.last_revision);
    return renderDiffPanelHtml(opts.diff, { summary: summary || null });
  }
  const linkedPlan = Boolean(opts.linkedPlan);
  const body = linkedPlan
    ? hideSpecExecutionSections(spec.body ?? "", { linkedPlan: true })
    : spec.body;
  return body?.trim()
    ? renderMarkdown(body)
    : '<p class="prose-empty">This spec has no markdown body yet.</p>';
}

function normalizeTitle(text) {
  return String(text).trim().toLowerCase().replace(/\s+/g, " ");
}

function hideIfTitleMatch(el, title) {
  if (!el || el.hidden) return;
  if (normalizeTitle(el.textContent) === title) el.hidden = true;
}

function hideDuplicateShellContent(bodyEl, spec) {
  const title = normalizeTitle(spec.title);
  hideIfTitleMatch(bodyEl.querySelector(".prose-title"), title);
  hideIfTitleMatch(bodyEl.firstElementChild, title);
}

/**
 * @param {HTMLElement} toolbar
 * @param {Array<{ id: string, title?: string, _footerOnly?: boolean }>} linkedPlans
 */
function appendPlanLinks(toolbar, linkedPlans) {
  if (!linkedPlans.length) return;

  const wrap = document.createElement("span");
  wrap.className = "spec-toolbar-plan-links";

  if (linkedPlans.length === 1) {
    const plan = linkedPlans[0];
    const planLink = document.createElement("a");
    planLink.className = "spec-toolbar-plan-link";
    planLink.href = `#plans/${encodeURIComponent(plan.id)}`;
    planLink.textContent = plan._footerOnly ? "View plan (footer)" : "View plan";
    planLink.setAttribute("aria-label", `View implementation plan ${plan.id}`);
    wrap.append(planLink);
  } else {
    const primary = linkedPlans[0];
    const planLink = document.createElement("a");
    planLink.className = "spec-toolbar-plan-link";
    planLink.href = `#plans/${encodeURIComponent(primary.id)}`;
    planLink.textContent = "View plan";
    planLink.setAttribute("aria-label", `View primary plan ${primary.id}`);
    wrap.append(planLink);

    const picker = document.createElement("select");
    picker.className = "spec-toolbar-plan-picker";
    picker.setAttribute("aria-label", "Choose implementation plan");
    for (const plan of linkedPlans) {
      const opt = document.createElement("option");
      opt.value = plan.id;
      opt.textContent = plan.title || plan.id;
      picker.append(opt);
    }
    picker.addEventListener("change", () => {
      window.location.hash = `plans/${encodeURIComponent(picker.value)}`;
    });
    wrap.append(picker);

    const count = document.createElement("span");
    count.className = "spec-toolbar-plan-count";
    count.textContent = `${linkedPlans.length} plans`;
    wrap.append(count);
  }

  toolbar.append(wrap);
}

/**
 * @param {HTMLElement} toolbar
 * @param {object} spec
 * @param {{ diffUi: ReturnType<typeof specDiffUiState>, viewMode: BodyViewMode, onViewModeChange: (mode: BodyViewMode) => void }} diffOpts
 */
function appendDiffToolbar(toolbar, spec, diffOpts) {
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

export function renderToolbar(toolbar, spec, { linkedPlans = [], workspace = null, diffUi = null, viewMode = "prose", onViewModeChange = null } = {}) {
  if (!toolbar) return;
  toolbar.replaceChildren();

  const status = document.createElement("span");
  status.className = "status-pill status-pill--intent";
  status.dataset.status = specBoardStatus(spec);
  status.textContent = specBoardStatusLabel(spec);
  toolbar.append(status);

  for (const label of specOrchestrationLabels(spec)) {
    const chip = document.createElement("span");
    chip.className = "status-pill status-pill--orch";
    chip.dataset.orch = label;
    chip.textContent = label;
    toolbar.append(chip);
  }

  const ui = diffUi ?? specDiffUiState(spec);
  if (onViewModeChange) {
    appendDiffToolbar(toolbar, spec, {
      diffUi: ui,
      viewMode,
      onViewModeChange,
    });
  }

  appendPlanLinks(toolbar, linkedPlans);

  if (linkedPlans.length === 1 && !linkedPlans[0]._footerOnly) {
    const callout = document.createElement("span");
    callout.className = "spec-toolbar-meta spec-execution-callout";
    const plan = linkedPlans[0];
    callout.textContent = planProgressTracked(plan)
      ? "Execution progress lives on the linked plan."
      : "In progress · phases update after implement patchPlan.";
    toolbar.append(callout);
  }

  const updated = document.createElement("span");
  updated.className = "spec-toolbar-meta";
  updated.textContent = `Updated ${formatAge(spec.updated_at)}`;
  toolbar.append(updated);

  if (spec.lock) {
    const lock = document.createElement("span");
    lock.className = "lock-badge";
    lock.textContent = lockSummary(spec.lock);
    toolbar.append(lock);
  }

  if (workspace?.worktree_path) {
    const ws = document.createElement("span");
    ws.className = "workspace-detail";
    ws.innerHTML = `<span class="workspace-detail-label">Branch</span> <code>${workspace.branch ?? ""}</code>`;
    toolbar.append(ws);

    const paths = document.createElement("div");
    paths.className = "workspace-paths";
    paths.innerHTML = [
      workspace.worktree_path ? `<div><span>Worktree</span> <code>${workspace.worktree_path}</code></div>` : "",
      workspace.scribe_worker_root ? `<div><span>Scribe</span> <code>${workspace.scribe_worker_root}</code></div>` : "",
      workspace.scrollsmatrix_worker_root
        ? `<div><span>Scrollsmatrix</span> <code>${workspace.scrollsmatrix_worker_root}</code></div>`
        : "",
    ].join("");
    toolbar.append(paths);

    const snippet = workspaceEnvSnippet(workspace);
    if (snippet) {
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "btn-ghost workspace-copy-env";
      copyBtn.textContent = "Copy env";
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(snippet);
          copyBtn.textContent = "Copied";
          setTimeout(() => {
            copyBtn.textContent = "Copy env";
          }, 1500);
        } catch {
          copyBtn.textContent = "Copy failed";
        }
      });
      toolbar.append(copyBtn);
    }
  }
}

export function renderSpecReviewNotice(root, spec) {
  const section = root?.querySelector("#spec-review-notice");
  const heading = root?.querySelector("#spec-review-notice-heading");
  const bodyEl = root?.querySelector("#spec-review-notice-body");
  const link = root?.querySelector("#spec-review-notice-link");
  if (!section || !heading || !bodyEl) return;

  const state = specReviewNoticeState(spec);
  if (!state) {
    section.hidden = true;
    heading.textContent = "";
    bodyEl.textContent = "";
    return;
  }

  section.hidden = false;
  heading.textContent = `${state.headline} · Review gate: ${state.gate}`;
  bodyEl.textContent = state.detail;
  if (link) {
    link.href = specReviewInstructionsHref(
      typeof window !== "undefined" ? window.location.pathname : "",
    );
  }
}

export function renderSpecDetail(root, spec, opts = {}) {
  if (!root || !spec) return;

  const titleEl = root.querySelector("#spec-title");
  const slugEl = root.querySelector("#spec-slug");
  const toolbar = root.querySelector("#spec-toolbar");
  const bodyEl = root.querySelector("#spec-body");

  if (titleEl) titleEl.textContent = spec.title;
  if (slugEl) slugEl.textContent = spec.slug;

  const diffUi = specDiffUiState(spec);
  let viewMode = /** @type {BodyViewMode} */ (root.dataset.bodyViewMode || "prose");
  if (viewMode === "changes" && !opts.diff) viewMode = "prose";

  const applyBody = () => {
    if (!bodyEl) return;
    const linkedPlan =
      (opts.linkedPlans?.length === 1 && !opts.linkedPlans[0]._footerOnly) || false;
    bodyEl.innerHTML = renderSpecBodyHtml(spec, {
      mode: viewMode,
      diff: opts.diff ?? null,
      linkedPlan,
    });
    if (viewMode === "prose") hideDuplicateShellContent(bodyEl, spec);
    root.dataset.bodyViewMode = viewMode;
    syncBodyViewToggle(toolbar?.querySelector(".view-toggle"), viewMode);
  };

  const onViewModeChange = (mode) => {
    viewMode = mode;
    applyBody();
  };

  renderToolbar(toolbar, spec, {
    ...opts,
    diffUi,
    viewMode,
    onViewModeChange: diffUi.showToggle ? onViewModeChange : null,
  });

  applyBody();
  renderSpecReviewNotice(root, spec);

  const doneNotice = root.querySelector("#spec-done-notice");
  if (doneNotice) {
    doneNotice.hidden = spec.status !== "done";
  }
}
