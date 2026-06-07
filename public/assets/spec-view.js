import {
  formatAge,
  lockSummary,
  specBoardStatus,
  specBoardStatusLabel,
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
}

export function renderToolbar(toolbar, spec) {
  if (!toolbar) return;
  toolbar.replaceChildren();

  const status = document.createElement("span");
  status.className = "status-pill";
  status.dataset.status = specBoardStatus(spec);
  status.textContent = specBoardStatusLabel(spec);
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
}

export function renderSpecDetail(root, spec) {
  if (!root || !spec) return;

  const titleEl = root.querySelector("#spec-title");
  const slugEl = root.querySelector("#spec-slug");
  const toolbar = root.querySelector("#spec-toolbar");
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
}
