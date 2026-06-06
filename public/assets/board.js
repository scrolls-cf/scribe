import {
  apiFetch,
  formatAge,
  lockSummary,
  specLinkLabel,
  statusLabel,
} from "./api.js";
import {
  devNote,
  dismissNode,
  setLoadingText,
  toast,
} from "./delight.js";

devNote();

const SPEC_LOADING = [
  "Reading active specs from the edge store…",
  "Checking lock state on in-flight plans…",
];
const ERROR_LOADING = [
  "Loading unresolved errors…",
  "Scanning the errors board…",
];

const specList = document.getElementById("spec-list");
const specEmpty = document.getElementById("spec-empty");
const specLoading = document.getElementById("spec-loading");
const errorList = document.getElementById("error-list");
const errorEmpty = document.getElementById("error-empty");
const errorLoading = document.getElementById("error-loading");
const boardError = document.getElementById("board-error");
const boardMain = document.getElementById("board-main");
const hostEl = document.getElementById("site-host");
const specCount = document.getElementById("spec-count");

if (hostEl) hostEl.textContent = window.location.host;

function setBusy(busy) {
  if (boardMain) boardMain.setAttribute("aria-busy", busy ? "true" : "false");
}

function showBoardError(message) {
  if (!boardError) return;
  boardError.textContent = message;
  boardError.hidden = false;
  boardError.setAttribute("aria-live", "assertive");
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

function renderSpecs(specs) {
  if (!specList || !specEmpty) return;
  setLoading(specLoading, false);
  specList.replaceChildren();

  if (!specs.length) {
    specList.hidden = true;
    specEmpty.hidden = false;
    if (specCount) specCount.hidden = true;
    return;
  }

  specEmpty.hidden = true;
  specList.hidden = false;
  if (specCount) {
    specCount.textContent = String(specs.length);
    specCount.hidden = false;
  }

  for (const spec of specs) {
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.className = "spec-card";
    link.href = `specs/${encodeURIComponent(spec.slug)}`;
    link.setAttribute("aria-label", specLinkLabel(spec));

    const pct =
      spec.phases_total > 0
        ? spec.phases_done / spec.phases_total
        : 0;

    const lockText = lockSummary(spec.lock);
    const lockOpen = !spec.lock;

    link.innerHTML = `
      <div class="spec-card-head">
        <div>
          <h3>${escape(spec.title)}</h3>
          <p class="spec-slug">${escape(spec.slug)}</p>
        </div>
        <span class="status-pill" data-status="${escape(spec.status)}">${escape(statusLabel(spec.status))}</span>
      </div>
      <div class="spec-meta">
        <span class="lock-badge" ${lockOpen ? 'data-open="true"' : ""}>${escape(lockText)}</span>
        <div class="phase-bar${pct >= 1 ? " phase-bar--full" : ""}" role="img" aria-label="${spec.phases_done} of ${spec.phases_total} phases done">
          <span style="--progress: ${pct}"></span>
        </div>
        <span>${spec.phases_done}/${spec.phases_total} phases</span>
        <span>${formatAge(spec.updated_at)}</span>
      </div>
    `;

    li.append(link);
    specList.append(li);
  }
}

function renderErrors(errors) {
  if (!errorList || !errorEmpty) return;
  setLoading(errorLoading, false);
  errorList.replaceChildren();

  if (!errors.length) {
    errorList.hidden = true;
    errorEmpty.hidden = false;
    return;
  }

  errorEmpty.hidden = true;
  errorList.hidden = false;

  for (const err of errors) {
    const li = document.createElement("li");
    li.className = "error-item";
    li.innerHTML = `
      <p>${escape(err.message)}</p>
      <div class="error-source">${escape(err.source)}</div>
      <div class="error-age">${formatAge(err.created_at)}</div>
      <div class="error-actions">
        <button type="button" class="btn btn-ghost" data-resolve="${escape(err.id)}">Mark resolved</button>
      </div>
    `;
    errorList.append(li);
  }

  errorList.querySelectorAll("[data-resolve]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-resolve");
      const item = btn.closest(".error-item");
      btn.disabled = true;
      try {
        await apiFetch(`errors/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ resolved: true }),
        });
        toast("Error marked resolved");
        dismissNode(item, () => loadBoard());
      } catch (e) {
        showBoardError(e.message || "Could not resolve error");
        btn.disabled = false;
      }
    });
  });
}

async function loadBoard() {
  setBusy(true);
  hideBoardError();
  setLoadingText(specLoading, SPEC_LOADING);
  setLoadingText(errorLoading, ERROR_LOADING);
  setLoading(specLoading, true);
  setLoading(errorLoading, true);
  if (specList) specList.hidden = true;
  if (errorList) errorList.hidden = true;
  if (specEmpty) specEmpty.hidden = true;
  if (errorEmpty) errorEmpty.hidden = true;

  try {
    const [specData, errorData] = await Promise.all([
      apiFetch("specs"),
      apiFetch("errors"),
    ]);
    renderSpecs(specData.specs || []);
    renderErrors(errorData.errors || []);
  } catch (e) {
    setLoading(specLoading, false);
    setLoading(errorLoading, false);
    const msg =
      e instanceof TypeError
        ? "Could not reach scribe. Check your connection and try again."
        : e.message || "Could not load board";
    showBoardError(msg);
    if (specEmpty) specEmpty.hidden = true;
    if (errorEmpty) errorEmpty.hidden = true;
    if (specList) specList.hidden = true;
    if (errorList) errorList.hidden = true;
  } finally {
    setBusy(false);
  }
}

loadBoard();
