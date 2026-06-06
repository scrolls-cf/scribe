import {
  apiFetch,
  formatAge,
  lockSummary,
  specLinkLabel,
  specSlugFromPath,
  statusLabel,
} from "./api.js";
import {
  devNote,
  setLoadingText,
} from "./delight.js";
import { renderSpecDetail } from "./spec-view.js";

devNote();

const SPEC_LOADING = [
  "Reading active specs from the edge store…",
  "Checking lock state on in-flight plans…",
];
const ERROR_LOADING = [
  "Loading unresolved errors…",
  "Scanning the errors board…",
];
const DETAIL_LOADING = [
  "Loading plan and phases…",
  "Fetching spec from scribe…",
];

const specList = document.getElementById("spec-list");
const specEmpty = document.getElementById("spec-empty");
const specLoading = document.getElementById("spec-loading");
const errorList = document.getElementById("error-list");
const errorEmpty = document.getElementById("error-empty");
const errorLoading = document.getElementById("error-loading");
const boardError = document.getElementById("board-error");
const boardMain = document.getElementById("board-main");
const specCount = document.getElementById("spec-count");
const detailPanel = document.getElementById("spec-detail-panel");
const detailRoot = document.getElementById("spec-detail");
const detailLoading = document.getElementById("spec-detail-loading");
const detailClose = document.getElementById("spec-detail-close");

let activeSlug = null;
let cachedSpecs = [];

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

function slugFromHash() {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash.startsWith("specs/")) {
    return decodeURIComponent(hash.slice("specs/".length).split("/")[0]);
  }
  return "";
}

function setDetailOpen(open) {
  if (!boardMain || !detailPanel) return;
  boardMain.dataset.detailOpen = open ? "true" : "false";
  detailPanel.hidden = !open;
}

function renderSpecs(specs) {
  if (!specList || !specEmpty) return;
  setLoading(specLoading, false);
  specList.replaceChildren();
  cachedSpecs = specs;

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
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "spec-card";
    if (spec.slug === activeSlug) btn.classList.add("is-selected");
    btn.dataset.slug = spec.slug;
    btn.setAttribute("aria-label", specLinkLabel(spec));
    btn.setAttribute("aria-pressed", spec.slug === activeSlug ? "true" : "false");

    const pct =
      spec.phases_total > 0
        ? spec.phases_done / spec.phases_total
        : 0;

    const lockText = lockSummary(spec.lock);
    const lockOpen = !spec.lock;

    btn.innerHTML = `
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

    btn.addEventListener("click", () => openSpec(spec.slug));
    li.append(btn);
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
    `;
    if (activeSlug && err.source?.includes(activeSlug)) {
      li.classList.add("error-item--related");
    }
    errorList.append(li);
  }
}

function closeSpec({ updateHash = true } = {}) {
  activeSlug = null;
  setDetailOpen(false);
  if (detailRoot) detailRoot.hidden = true;
  if (detailLoading) detailLoading.hidden = true;
  document.title = "scribe · devscrolls";
  renderSpecs(cachedSpecs);
  if (updateHash) {
    const url = new URL(window.location.href);
    url.hash = "";
    history.pushState(null, "", url);
  }
}

async function openSpec(slug, { updateHash = true } = {}) {
  if (!slug) return;
  activeSlug = slug;
  setDetailOpen(true);
  renderSpecs(cachedSpecs);
  if (detailRoot) detailRoot.hidden = true;
  if (detailLoading) {
    setLoadingText(detailLoading, DETAIL_LOADING);
    detailLoading.hidden = false;
  }

  if (updateHash) {
    const url = new URL(window.location.href);
    url.hash = `specs/${encodeURIComponent(slug)}`;
    history.pushState(null, "", url);
  }

  try {
    const data = await apiFetch(`specs/${encodeURIComponent(slug)}`);
    const spec = data.spec;
    if (!spec) throw new Error("Spec not found");

    if (detailLoading) detailLoading.hidden = true;
    if (detailRoot) {
      detailRoot.hidden = false;
      renderSpecDetail(detailRoot, spec);
    }
    document.title = `${spec.title} · scribe · devscrolls`;
    detailPanel?.scrollTo(0, 0);
  } catch (e) {
    if (detailLoading) {
      detailLoading.textContent = e.message || "Could not load spec";
      detailLoading.hidden = false;
    }
  }
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
    const slug = slugFromHash() || specSlugFromPath();
    if (slug) openSpec(slug, { updateHash: false });
  }
}

detailClose?.addEventListener("click", () => closeSpec());

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && activeSlug) {
    e.preventDefault();
    closeSpec();
    return;
  }
  if (e.key !== "r" || e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  e.preventDefault();
  loadBoard();
});

window.addEventListener("popstate", () => {
  const slug = slugFromHash();
  if (slug) openSpec(slug, { updateHash: false });
  else closeSpec({ updateHash: false });
});

loadBoard();
