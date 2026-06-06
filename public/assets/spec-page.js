import { agentId, apiFetch, formatAge, serviceRoot, statusLabel } from "./api.js";
import { renderMarkdown } from "./markdown.js";

const detail = document.getElementById("spec-detail");
const titleEl = document.getElementById("spec-title");
const slugEl = document.getElementById("spec-slug");
const toolbar = document.getElementById("spec-toolbar");
const phaseList = document.getElementById("phase-list");
const bodyEl = document.getElementById("spec-body");
const specError = document.getElementById("spec-error");
const hostEl = document.getElementById("site-host");

if (hostEl) hostEl.textContent = window.location.host;

const slug = decodeURIComponent(
  window.location.pathname.replace(/^\/specs\//, "").replace(/\/$/, ""),
);

function showError(message) {
  if (!specError) return;
  specError.textContent = message;
  specError.hidden = false;
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
    held.textContent = `Held by ${spec.lock.agent_id}`;
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
  if (!phaseList) return;
  phaseList.replaceChildren();

  if (!spec.phases.length) {
    const empty = document.createElement("p");
    empty.className = "empty-line";
    empty.textContent = "—";
    phaseList.append(empty);
    return;
  }

  for (const phase of spec.phases) {
    const li = document.createElement("li");
    li.className = "phase-row";
    li.dataset.status = phase.status;

    const dot = document.createElement("span");
    dot.className = "phase-dot";
    dot.setAttribute("aria-hidden", "true");

    const title = document.createElement("span");
    title.className = "phase-title";
    title.textContent = phase.title;

    const actions = document.createElement("div");
    actions.className = "phase-actions";

    if (phase.status !== "done") {
      const doneBtn = document.createElement("button");
      doneBtn.type = "button";
      doneBtn.className = "btn btn-ghost";
      doneBtn.textContent = "Mark done";
      doneBtn.addEventListener("click", () => markPhaseDone(spec, phase.id));
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
    render(data);
  } catch (e) {
    showError(e.message || "Could not release lock");
  }
}

async function markPhaseDone(spec, phaseId) {
  const phases = spec.phases.map((p) => ({ ...p }));
  let found = false;
  let nextPending = false;
  for (const p of phases) {
    if (p.id === phaseId) {
      p.status = "done";
      found = true;
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
    const updated = await patchSpec(spec.slug, { phases, status });
    if (updated.status === "done") {
      window.location.href = `${serviceRoot() || "."}/`;
      return;
    }
    render(updated);
  } catch (e) {
    showError(e.message || "Could not update phase");
  }
}

function render(spec) {
  if (!detail || !titleEl || !slugEl || !bodyEl) return;
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
  if (!slug) {
    showError("Missing spec slug");
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
