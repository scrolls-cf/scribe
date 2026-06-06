import { apiFetch, formatAge, statusLabel } from "./api.js";

const specList = document.getElementById("spec-list");
const specEmpty = document.getElementById("spec-empty");
const errorList = document.getElementById("error-list");
const errorEmpty = document.getElementById("error-empty");
const boardError = document.getElementById("board-error");
const hostEl = document.getElementById("site-host");

if (hostEl) hostEl.textContent = window.location.host;

function showBoardError(message) {
  if (!boardError) return;
  boardError.textContent = message;
  boardError.hidden = false;
}

function renderSpecs(specs) {
  if (!specList || !specEmpty) return;
  specList.replaceChildren();

  if (!specs.length) {
    specList.hidden = true;
    specEmpty.hidden = false;
    return;
  }

  specEmpty.hidden = true;
  specList.hidden = false;

  for (const spec of specs) {
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.className = "spec-card";
    link.href = `specs/${encodeURIComponent(spec.slug)}`;

    const pct =
      spec.phases_total > 0
        ? Math.round((spec.phases_done / spec.phases_total) * 100)
        : 0;

    const lockHtml = spec.lock
      ? `<span class="lock-badge">Held by ${escape(spec.lock.agent_id)}</span>`
      : `<span class="lock-badge" data-open="true">Open</span>`;

    link.innerHTML = `
      <div class="spec-card-head">
        <div>
          <h3>${escape(spec.title)}</h3>
          <p class="spec-slug">${escape(spec.slug)}</p>
        </div>
        <span class="status-pill" data-status="${escape(spec.status)}">${escape(statusLabel(spec.status))}</span>
      </div>
      <div class="spec-meta">
        ${lockHtml}
        <div class="phase-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
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
      btn.disabled = true;
      try {
        await apiFetch(`errors/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ resolved: true }),
        });
        await loadBoard();
      } catch (e) {
        showBoardError(e.message || "Could not resolve error");
        btn.disabled = false;
      }
    });
  });
}

function escape(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadBoard() {
  try {
    const [specData, errorData] = await Promise.all([
      apiFetch("specs"),
      apiFetch("errors"),
    ]);
    renderSpecs(specData.specs || []);
    renderErrors(errorData.errors || []);
  } catch (e) {
    showBoardError(e.message || "Could not load board");
    if (specEmpty) {
      specEmpty.hidden = false;
      specList.hidden = true;
    }
    if (errorEmpty) {
      errorEmpty.hidden = false;
      errorList.hidden = true;
    }
  }
}

loadBoard();
