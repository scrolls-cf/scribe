import {
  formatAge,
  lockSummary,
  planProgressLabel,
  specBoardStatus,
  specBoardStatusLabel,
  workspaceEnvSnippet,
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

export function renderToolbar(toolbar, spec, { linkedPlans = [], workspace = null } = {}) {
  if (!toolbar) return;
  toolbar.replaceChildren();

  const status = document.createElement("span");
  status.className = "status-pill status-pill--intent";
  status.dataset.status = specBoardStatus(spec);
  status.textContent = specBoardStatusLabel(spec);
  toolbar.append(status);

  appendPlanLinks(toolbar, linkedPlans);

  const updated = document.createElement("span");
  updated.className = "spec-toolbar-meta";
  updated.textContent = `Updated ${formatAge(spec.updated_at)}`;
  toolbar.append(updated);

  if (linkedPlans.length === 1 && !linkedPlans[0]._footerOnly) {
    const rollup = document.createElement("span");
    rollup.className = "spec-toolbar-meta spec-toolbar-plan-rollup";
    rollup.textContent = planProgressLabel(linkedPlans[0]);
    toolbar.append(rollup);
  }

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

export function renderSpecDetail(root, spec, opts = {}) {
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
      : '<p class="prose-empty">This spec has no markdown body yet.</p>';
    hideDuplicateShellContent(bodyEl, spec);
  }

  const doneNotice = root.querySelector("#spec-done-notice");
  if (doneNotice) {
    doneNotice.hidden = spec.status !== "done";
  }

  renderToolbar(toolbar, spec, opts);
}
