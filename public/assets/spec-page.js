import {
  agentId,
  apiFetch,
  formatAge,
  lockSummary,
  phaseStatusLabel,
  serviceRoot,
  statusLabel,
} from "./api.js";
import { renderMarkdown } from "./markdown.js";
import {
  devNote,
  flashNode,
  setLoadingText,
  toast,
} from "./delight.js";

devNote();

const SPEC_LOADING = [
  "Loading plan and phases…",
  "Fetching spec from scribe…",
];

const detail = document.getElementById("spec-detail");
const titleEl = document.getElementById("spec-title");
const slugEl = document.getElementById("spec-slug");
const toolbar = document.getElementById("spec-toolbar");
const phaseList = document.getElementById("phase-list");
const phaseEmpty = document.getElementById("phase-empty");
const bodyEl = document.getElementById("spec-body");
const specError = document.getElementById("spec-error");
const specLoading = document.getElementById("spec-loading");
const hostEl = document.getElementById("site-host");

if (hostEl) hostEl.textContent = window.location.host;

const slug = decodeURIComponent(
  window.location.pathname.replace(/^\/specs\//, "").replace(/\/$/, ""),
);

function showError(message) {
  if (specLoading) specLoading.hidden = true;
  if (!specError) return;
  specError.textContent = message;
  specError.hidden = false;
  specError.setAttribute("aria-live", "assertive");
  if (detail) detail.hidden = true;
}

function renderToolbar(spec) {
  if (!toolbar) return;
  toolbar.replaceChildren();

  const status = document.createElement("span");
  status.className = "status-pill";
  status.dataset.status = spec.status;
  status.textContent = statusLabel(spec.status);
  toolbar.append(status);

  const updated = document.createElement("span");
  updated.className = "spec-slug";
  updated.textContent = `Updated ${formatAge(spec.updated_at)}`;
  toolbar.append(updated);

  const me = agentId();
  const lockBtn = document.createElement("button");
  const releaseBtn = document.createElement("button");
  lockBtn.type = "button";
  lockBtn.className = "btn btn-primary";
  releaseBtn.type = "button";
  releaseBtn.className = "btn btn-ghost";

  if (spec.lock && spec.lock.agent_id !== me) {
    const held = document.createElement("span");
    held.className = "lock-badge";
    held.textContent = lockSummary(spec.lock);
    toolbar.append(held);
    return;
  }

  if (spec.lock && spec.lock.agent_id === me) {
    releaseBtn.textContent = "Release lock";
    releaseBtn.addEventListener("click", () => releaseLock(spec.slug));
    toolbar.append(releaseBtn);
    return;
  }

  lockBtn.textContent = "Acquire lock";
  lockBtn.addEventListener("click", () => acquireLock(spec.slug));
  toolbar.append(lockBtn);
}

function renderPhases(spec) {
  if (!phaseList || !phaseEmpty) return;
  phaseList.replaceChildren();

  if (!spec.phases.length) {
    phaseEmpty.hidden = false;
    phaseList.hidden = true;
    return;
  }

  phaseEmpty.hidden = true;
  phaseList.hidden = false;

  for (const phase of spec.phases) {
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

    const sr = document.createElement("span");
    sr.className = "sr-only";
    sr.textContent = `${phaseStatusLabel(phase.status)}: `;
    title.prepend(sr);

    const actions = document.createElement("div");
    actions.className = "phase-actions";

    if (phase.status !== "done") {
      const doneBtn = document.createElement("button");
      doneBtn.type = "button";
      doneBtn.className = "btn btn-ghost";
      doneBtn.textContent = "Mark phase done";
      doneBtn.addEventListener("click", () => markPhaseDone(spec, phase.id, li));
      actions.append(doneBtn);
    }

    li.append(dot, title, actions);
    phaseList.append(li);
  }
}

async function patchSpec(slug, payload) {
  const data = await apiFetch(`specs/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return data.spec;
}

async function acquireLock(slug) {
  try {
    const data = await apiFetch(`specs/${encodeURIComponent(slug)}/lock`, {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId() }),
    });
    toast("Lock acquired");
    render(data);
  } catch (e) {
    showError(e.data?.error === "lock held" ? "Another agent holds this spec" : e.message);
  }
}

async function releaseLock(slug) {
  try {
    const data = await apiFetch(`specs/${encodeURIComponent(slug)}/lock`, {
      method: "DELETE",
      body: JSON.stringify({ agent_id: agentId() }),
    });
    toast("Lock released");
    render(data);
  } catch (e) {
    showError(e.message || "Could not release lock");
  }
}

async function markPhaseDone(spec, phaseId, rowEl) {
  const phases = spec.phases.map((p) => ({ ...p }));
  let nextPending = false;
  for (const p of phases) {
    if (p.id === phaseId) {
      p.status = "done";
      nextPending = true;
      continue;
    }
    if (nextPending && p.status === "pending") {
      p.status = "active";
      nextPending = false;
    }
  }

  const phases_done = phases.filter((p) => p.status === "done").length;
  const allDone = phases.length > 0 && phases_done === phases.length;
  const status = allDone ? "done" : spec.status === "ready" ? "in_progress" : spec.status;

  try {
    flashNode(rowEl, "phase-row--flash");
    const updated = await patchSpec(spec.slug, { phases, status });
    if (updated.status === "done") {
      toast("Spec complete. Returning to board…");
      const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : 420;
      setTimeout(() => {
        window.location.href = `${serviceRoot() || "."}/`;
      }, delay);
      return;
    }
    toast("Phase marked done");
    render(updated);
  } catch (e) {
    showError(e.message || "Could not update phase");
  }
}

function render(spec) {
  if (!detail || !titleEl || !slugEl || !bodyEl) return;
  if (specLoading) specLoading.hidden = true;
  specError.hidden = true;
  detail.hidden = false;
  document.title = `${spec.title} · scribe`;
  titleEl.textContent = spec.title;
  slugEl.textContent = spec.slug;
  bodyEl.innerHTML = renderMarkdown(spec.body);
  renderToolbar(spec);
  renderPhases(spec);
}

async function load() {
  setLoadingText(specLoading, SPEC_LOADING);
  if (!slug) {
    showError("Missing spec slug in URL");
    return;
  }
  try {
    const data = await apiFetch(`specs/${encodeURIComponent(slug)}`);
    render(data.spec);
  } catch (e) {
    showError(e.message || "Spec not found");
  }
}

load();
