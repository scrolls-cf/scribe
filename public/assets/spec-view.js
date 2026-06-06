import {
  formatAge,
  lockSummary,
  phaseStatusLabel,
  statusLabel,
} from "./api.js";
import { renderMarkdown } from "./markdown.js";

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

  if (!spec.phases?.length) return;
  for (const heading of bodyEl.querySelectorAll("h2, h3")) {
    if (!/^phases$/i.test(heading.textContent.trim())) continue;
    heading.hidden = true;
    let sibling = heading.nextElementSibling;
    while (sibling && sibling.tagName === "P" && !sibling.textContent.trim()) {
      sibling.hidden = true;
      sibling = sibling.nextElementSibling;
    }
    if (sibling?.classList?.contains("prose-table-wrap")) sibling.hidden = true;
    break;
  }
}

export function renderToolbar(toolbar, spec) {
  if (!toolbar) return;
  toolbar.replaceChildren();

  const status = document.createElement("span");
  status.className = "status-pill";
  status.dataset.status = spec.status;
  status.textContent = statusLabel(spec.status);
  toolbar.append(status);

  const updated = document.createElement("span");
  updated.className = "spec-toolbar-meta";
  updated.textContent = `Updated ${formatAge(spec.updated_at)}`;
  toolbar.append(updated);

  const lock = document.createElement("span");
  lock.className = "lock-badge";
  if (!spec.lock) lock.dataset.open = "true";
  lock.textContent = lockSummary(spec.lock);
  toolbar.append(lock);

  const phases = spec.phases || [];
  if (phases.length) {
    const done = phases.filter((p) => p.status === "done").length;
    const progress = document.createElement("span");
    progress.className = "spec-toolbar-meta";
    progress.textContent = `${done}/${phases.length} phases`;
    toolbar.insertBefore(progress, lock);
  }
}

export function renderPhases(phaseList, phaseEmpty, spec) {
  if (!phaseList || !phaseEmpty) return;
  phaseList.replaceChildren();

  const phases = spec.phases || [];
  if (!phases.length) {
    phaseEmpty.hidden = false;
    phaseList.hidden = true;
    return;
  }

  phaseEmpty.hidden = true;
  phaseList.hidden = false;

  for (const phase of phases) {
    const li = document.createElement("li");
    li.className = "phase-row";
    li.dataset.status = phase.status;
    li.setAttribute(
      "aria-label",
      `${phase.title}, ${phaseStatusLabel(phase.status)}`,
    );

    const dot = document.createElement("span");
    dot.className = "phase-dot";
    dot.setAttribute("aria-hidden", "true");

    const title = document.createElement("span");
    title.className = "phase-title";
    title.textContent = phase.title;
    title.setAttribute("title", phase.title);

    li.append(dot, title);
    phaseList.append(li);
  }
}

export function renderSpecDetail(root, spec) {
  if (!root || !spec) return;

  const titleEl = root.querySelector("#spec-title");
  const slugEl = root.querySelector("#spec-slug");
  const toolbar = root.querySelector("#spec-toolbar");
  const phaseList = root.querySelector("#phase-list");
  const phaseEmpty = root.querySelector("#phase-empty");
  const bodyEl = root.querySelector("#spec-body");

  if (titleEl) titleEl.textContent = spec.title;
  if (slugEl) slugEl.textContent = spec.slug;
  if (bodyEl) {
    bodyEl.innerHTML = spec.body?.trim()
      ? renderMarkdown(spec.body)
      : '<p class="prose-empty">No body yet.</p>';
    hideDuplicateShellContent(bodyEl, spec);
  }

  const doneNotice = root.querySelector("#spec-done-notice");
  if (doneNotice) {
    doneNotice.hidden = spec.status !== "done";
  }

  renderToolbar(toolbar, spec);
  renderPhases(phaseList, phaseEmpty, spec);
}
