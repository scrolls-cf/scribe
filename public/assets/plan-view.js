import {
  formatAge,
  lockSummary,
  planBoardStatus,
  planBoardStatusLabel,
  planProgressLabel,
} from "./api.js";
import { renderMarkdown } from "./markdown.js";

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

export function renderPlanToolbar(toolbar, plan) {
  if (!toolbar) return;
  toolbar.replaceChildren();

  const status = document.createElement("span");
  status.className = "status-pill";
  status.dataset.status = planBoardStatus(plan);
  status.textContent = planBoardStatusLabel(plan);
  toolbar.append(status);

  const progress = document.createElement("span");
  progress.className = "spec-toolbar-meta";
  progress.textContent = planProgressLabel(plan);
  toolbar.append(progress);

  const updated = document.createElement("span");
  updated.className = "spec-toolbar-meta";
  updated.textContent = `Updated ${formatAge(plan.updated_at)}`;
  toolbar.append(updated);

  const lock = document.createElement("span");
  lock.className = "lock-badge";
  if (!plan.lock) lock.dataset.open = "true";
  lock.textContent = lockSummary(plan.lock);
  toolbar.append(lock);
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

    const label = document.createElement("span");
    label.className = "plan-phase-label";
    label.textContent = phase.title || `Phase ${phase.index}`;

    li.append(marker, label);
    list.append(li);
  }

  container.append(list);
}

export function renderPlanDetail(root, plan, { onOpenSpec } = {}) {
  if (!root || !plan) return;

  const titleEl = root.querySelector("#plan-title");
  const idEl = root.querySelector("#plan-id");
  const specLink = root.querySelector("#plan-spec-link");
  const toolbar = root.querySelector("#plan-toolbar");
  const phaseSummary = root.querySelector("#plan-phase-summary");
  const bodyEl = root.querySelector("#plan-body");
  const doneNotice = root.querySelector("#plan-done-notice");

  if (titleEl) titleEl.textContent = plan.title;
  if (idEl) idEl.textContent = plan.id;

  if (specLink) {
    specLink.replaceChildren();
    if (plan.spec_slug) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "plan-spec-link";
      btn.textContent = plan.spec_slug;
      if (typeof onOpenSpec === "function") {
        btn.addEventListener("click", () => onOpenSpec(plan.spec_slug));
      }
      specLink.append(btn);
      specLink.hidden = false;
    } else {
      specLink.hidden = true;
    }
  }

  renderPhaseSummary(phaseSummary, plan.phases);
  renderPlanToolbar(toolbar, plan);

  if (bodyEl) {
    bodyEl.innerHTML = plan.body?.trim()
      ? renderMarkdown(plan.body)
      : '<p class="prose-empty">No plan body yet.</p>';
    hideDuplicateShellContent(bodyEl, plan);
  }

  if (doneNotice) {
    doneNotice.hidden = plan.status !== "done";
  }
}
