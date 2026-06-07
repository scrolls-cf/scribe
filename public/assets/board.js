import {
  apiFetch,
  formatAge,
  lockSummary,
  planIdFromPath,
  planBoardStatus,
  planBoardStatusLabel,
  planLinkLabel,
  planProgressLabel,
  specLinkLabel,
  specSlugFromErrorSource,
  specSlugFromPath,
  specBoardStatus,
  specBoardStatusLabel,
} from "./api.js";
import {
  devNote,
  setLoadingText,
} from "./delight.js";
import { renderPlanDetail } from "./plan-view.js";
import { renderSpecDetail } from "./spec-view.js";

devNote();

const WORK_LOADING = [
  "Reading active work from the edge store…",
  "Checking locks and implementation progress…",
];
const DETAIL_LOADING = [
  "Loading from scribe…",
  "Fetching detail from the edge store…",
];

const workList = document.getElementById("work-list");
const workEmpty = document.getElementById("work-empty");
const workLoading = document.getElementById("work-loading");
const errorsPanel = document.getElementById("errors-panel");
const errorList = document.getElementById("error-list");
const boardError = document.getElementById("board-error");
const boardMain = document.getElementById("board-main");
const workCount = document.getElementById("work-count");
const workBoardHint = document.getElementById("work-board-hint");
const detailPanel = document.getElementById("detail-panel");
const detailEmpty = document.getElementById("detail-empty");
const detailLoading = document.getElementById("detail-loading");
const detailBreadcrumb = document.getElementById("detail-breadcrumb");
const specDetailRoot = document.getElementById("spec-detail");
const planDetailRoot = document.getElementById("plan-detail");
const errorsLive = document.getElementById("errors-live");

let activeSlug = null;
let activePlanId = null;
let cachedSpecs = [];
let cachedPlans = [];
let cachedErrors = [];
let lastFocusedButton = null;

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

function setErrorsPanelVisible(visible) {
  if (errorsPanel) errorsPanel.hidden = !visible;
  if (!boardMain) return;
  if (visible) boardMain.dataset.errorsVisible = "true";
  else {
    delete boardMain.dataset.errorsVisible;
    if (errorsLive) errorsLive.textContent = "";
  }
}

function announceErrors(count) {
  if (!errorsLive) return;
  errorsLive.textContent =
    count > 0
      ? `${count} unresolved error${count === 1 ? "" : "s"} on the errors board`
      : "";
}

function escape(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function detailFromHash() {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash.startsWith("specs/")) {
    return {
      type: "spec",
      id: decodeURIComponent(hash.slice("specs/".length).split("/")[0]),
    };
  }
  if (hash.startsWith("plans/")) {
    return {
      type: "plan",
      id: decodeURIComponent(hash.slice("plans/".length).split("/")[0]),
    };
  }
  return null;
}

function plansForSpec(slug) {
  return cachedPlans.filter((plan) => plan.spec_slug === slug);
}

function hasDetailSelection() {
  return !!(activeSlug || activePlanId);
}

function setDetailOpen(open) {
  if (!boardMain) return;
  if (open) boardMain.dataset.detailOpen = "true";
  else delete boardMain.dataset.detailOpen;
  syncDetailChrome();
}

function syncDetailChrome() {
  const selected = hasDetailSelection();
  const loading = detailLoading && !detailLoading.hidden;
  if (detailEmpty) detailEmpty.hidden = selected || loading;
  if (!selected) {
    if (detailLoading) detailLoading.hidden = true;
    hideDetailViews();
    clearBreadcrumb();
  }
}

function clearBreadcrumb() {
  if (!detailBreadcrumb) return;
  detailBreadcrumb.hidden = true;
  detailBreadcrumb.replaceChildren();
}

function setBreadcrumb(parts) {
  if (!detailBreadcrumb) return;
  if (!parts?.length) {
    clearBreadcrumb();
    return;
  }

  detailBreadcrumb.hidden = false;
  detailBreadcrumb.replaceChildren();

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "detail-breadcrumb-sep";
      sep.setAttribute("aria-hidden", "true");
      sep.textContent = "›";
      detailBreadcrumb.append(sep);
    }

    if (part.onClick) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "detail-breadcrumb-link";
      btn.textContent = part.label;
      btn.addEventListener("click", part.onClick);
      detailBreadcrumb.append(btn);
    } else {
      const current = document.createElement("span");
      current.className = "detail-breadcrumb-current";
      current.textContent = part.label;
      if (i === parts.length - 1) current.setAttribute("aria-current", "page");
      detailBreadcrumb.append(current);
    }
  }
}

function createSpecRow(spec) {
  const linkedPlans = plansForSpec(spec.slug);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "work-row work-row--spec";
  if (spec.slug === activeSlug) btn.classList.add("is-selected");
  if (activePlanId && linkedPlans.some((p) => p.id === activePlanId)) {
    btn.classList.add("is-related");
  }
  btn.dataset.slug = spec.slug;
  btn.setAttribute("aria-label", specLinkLabel(spec));
  btn.setAttribute("aria-pressed", spec.slug === activeSlug ? "true" : "false");

  const lockText = lockSummary(spec.lock);

  btn.innerHTML = `
    <span class="work-row-main">
      <span class="work-row-title">${escape(spec.title)}</span>
      <span class="work-row-slug">${escape(spec.slug)}</span>
    </span>
    <span class="work-row-meta work-row-meta--inline">
      ${spec.lock ? `<span class="lock-badge" data-held="true">${escape(lockText)}</span>` : ""}
      <span class="status-pill" data-status="${escape(specBoardStatus(spec))}">${escape(specBoardStatusLabel(spec))}</span>
      <span class="work-row-age sr-only">Updated ${formatAge(spec.updated_at)}</span>
    </span>
  `;

  btn.addEventListener("click", () => {
    if (spec.slug === activeSlug) {
      closeDetail();
      return;
    }
    lastFocusedButton = btn;
    openSpec(spec.slug);
  });

  return btn;
}

function createImplRow(plan, { nested = false } = {}) {
  const ratio = Math.round((plan.completion_ratio || 0) * 100);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "work-row work-row--impl";
  if (nested) btn.classList.add("work-row--nested");
  if (plan.id === activePlanId) btn.classList.add("is-selected");
  if (activeSlug && plan.spec_slug === activeSlug) btn.classList.add("is-related");
  btn.dataset.planId = plan.id;
  btn.setAttribute("aria-label", planLinkLabel(plan));
  btn.setAttribute("aria-pressed", plan.id === activePlanId ? "true" : "false");

  const activePhase = plan.active_phase?.title
    ? `<span class="work-row-phase">${escape(plan.active_phase.title)}</span>`
    : "";
  const lockLine = plan.lock
    ? `<span class="lock-badge">${escape(lockSummary(plan.lock))}</span>`
    : "";

  btn.innerHTML = `
    <span class="work-row-main">
      <span class="work-row-title">${escape(plan.title)}</span>
      ${activePhase}
      <span class="work-row-progress">
        <span class="plan-progress-label">${escape(planProgressLabel(plan))}</span>
        <span class="plan-progress" role="presentation" style="--plan-progress: ${ratio / 100}">
          <span class="plan-progress-bar"></span>
        </span>
      </span>
    </span>
    <span class="work-row-meta work-row-meta--inline">
      ${lockLine}
      <span class="status-pill" data-status="${escape(planBoardStatus(plan))}">${escape(planBoardStatusLabel(plan))}</span>
    </span>
  `;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (plan.id === activePlanId) {
      closeDetail();
      return;
    }
    lastFocusedButton = btn;
    openPlan(plan.id);
  });

  return btn;
}

function appendImplList(plans) {
  const ul = document.createElement("ul");
  ul.className = "work-impl-list";
  ul.setAttribute("role", "list");
  for (const plan of plans) {
    const li = document.createElement("li");
    li.append(createImplRow(plan, { nested: true }));
    ul.append(li);
  }
  return ul;
}

function renderWorkBoard(specs, plans) {
  if (!workList || !workEmpty) return;
  setLoading(workLoading, false);
  workList.replaceChildren();
  cachedSpecs = specs;
  cachedPlans = plans;

  const specSlugs = new Set(specs.map((s) => s.slug));
  const orphanPlans = plans.filter((p) => !specSlugs.has(p.spec_slug));

  if (!specs.length && !plans.length) {
    workList.hidden = true;
    workEmpty.hidden = false;
    if (workCount) workCount.hidden = true;
    if (workBoardHint) workBoardHint.hidden = true;
    return;
  }

  workEmpty.hidden = true;
  workList.hidden = false;
  if (workBoardHint) workBoardHint.hidden = false;
  if (workCount) {
    const total = specs.length + plans.length;
    workCount.textContent = String(total);
    workCount.hidden = !total;
  }

  for (const spec of specs) {
    const group = document.createElement("li");
    group.className = "work-group";
    group.append(createSpecRow(spec));
    const nested = plansForSpec(spec.slug);
    if (nested.length) group.append(appendImplList(nested));
    workList.append(group);
  }

  if (orphanPlans.length) {
    const bySlug = new Map();
    for (const plan of orphanPlans) {
      const slug = plan.spec_slug || "unknown";
      if (!bySlug.has(slug)) bySlug.set(slug, []);
      bySlug.get(slug).push(plan);
    }

    for (const [slug, slugPlans] of bySlug) {
      const group = document.createElement("li");
      group.className = "work-group work-group--detached";

      const label = document.createElement("div");
      label.className = "work-group-detached-label";
      label.textContent = `Spec completed · ${slug}`;
      group.append(label);
      group.append(appendImplList(slugPlans));
      workList.append(group);
    }
  }
}

function renderErrors(errors) {
  if (!errorList) return;
  errorList.replaceChildren();
  cachedErrors = errors;

  if (!errors.length) {
    errorList.hidden = true;
    setErrorsPanelVisible(false);
    return;
  }

  setErrorsPanelVisible(true);
  errorList.hidden = false;
  announceErrors(errors.length);

  const knownSlugs = cachedSpecs.map((spec) => spec.slug);

  for (const err of errors) {
    const li = document.createElement("li");
    li.className = "error-item";

    const message = document.createElement("p");
    message.textContent = err.message;
    li.append(message);

    const source = document.createElement("div");
    source.className = "error-source";
    source.textContent = err.source || "";
    li.append(source);

    const age = document.createElement("div");
    age.className = "error-age";
    age.textContent = formatAge(err.created_at);
    li.append(age);

    const relatedSlug = specSlugFromErrorSource(err.source, knownSlugs);
    if (relatedSlug) {
      const actions = document.createElement("div");
      actions.className = "error-actions";
      const link = document.createElement("button");
      link.type = "button";
      link.className = "error-spec-link";
      link.textContent = "View spec";
      link.addEventListener("click", () => {
        lastFocusedButton =
          workList?.querySelector(`[data-slug="${CSS.escape(relatedSlug)}"]`) || link;
        openSpec(relatedSlug);
      });
      actions.append(link);
      li.append(actions);
    }

    if (
      (activeSlug && relatedSlug === activeSlug) ||
      (activePlanId && err.source?.includes(activePlanId)) ||
      (activeSlug && err.source?.includes(activeSlug))
    ) {
      li.classList.add("error-item--related");
    }

    errorList.append(li);
  }
}

function hideDetailViews() {
  if (specDetailRoot) specDetailRoot.hidden = true;
  if (planDetailRoot) planDetailRoot.hidden = true;
}

function closeDetail({ updateHash = true } = {}) {
  activeSlug = null;
  activePlanId = null;
  setDetailOpen(false);
  document.title = "scribe · devscrolls";
  renderWorkBoard(cachedSpecs, cachedPlans);
  renderErrors(cachedErrors);
  if (updateHash) {
    const url = new URL(window.location.href);
    url.hash = "";
    history.pushState(null, "", url);
  }
  lastFocusedButton?.focus();
  lastFocusedButton = null;
}

async function openSpec(slug, { updateHash = true } = {}) {
  if (!slug) return;
  activeSlug = slug;
  activePlanId = null;
  setDetailOpen(true);
  hideDetailViews();
  clearBreadcrumb();
  renderWorkBoard(cachedSpecs, cachedPlans);
  renderErrors(cachedErrors);
  if (detailLoading) {
    setLoadingText(detailLoading, DETAIL_LOADING);
    detailLoading.hidden = false;
  }
  syncDetailChrome();

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
    if (specDetailRoot) {
      specDetailRoot.hidden = false;
      renderSpecDetail(specDetailRoot, spec);
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

async function openPlan(id, { updateHash = true } = {}) {
  if (!id) return;
  activePlanId = id;
  activeSlug = null;
  setDetailOpen(true);
  hideDetailViews();
  renderWorkBoard(cachedSpecs, cachedPlans);
  renderErrors(cachedErrors);
  if (detailLoading) {
    setLoadingText(detailLoading, DETAIL_LOADING);
    detailLoading.hidden = false;
  }
  syncDetailChrome();

  if (updateHash) {
    const url = new URL(window.location.href);
    url.hash = `plans/${encodeURIComponent(id)}`;
    history.pushState(null, "", url);
  }

  try {
    const data = await apiFetch(`plans/${encodeURIComponent(id)}`);
    const plan = data.plan;
    if (!plan) throw new Error("Plan not found");

    if (detailLoading) detailLoading.hidden = true;
    if (planDetailRoot) {
      planDetailRoot.hidden = false;
      renderPlanDetail(planDetailRoot, plan);
    }

    setBreadcrumb([
      {
        label: plan.spec_slug,
        onClick: () => {
          lastFocusedButton = document.querySelector(
            `[data-plan-id="${CSS.escape(id)}"]`,
          );
          openSpec(plan.spec_slug);
        },
      },
      { label: plan.title },
    ]);

    document.title = `${plan.title} · scribe · devscrolls`;
    detailPanel?.scrollTo(0, 0);
  } catch (e) {
    if (detailLoading) {
      detailLoading.textContent = e.message || "Could not load plan";
      detailLoading.hidden = false;
    }
  }
}

async function loadBoard() {
  setBusy(true);
  hideBoardError();
  setLoadingText(workLoading, WORK_LOADING);
  setLoading(workLoading, true);
  setErrorsPanelVisible(false);
  if (workList) workList.hidden = true;
  if (errorList) errorList.hidden = true;
  if (workEmpty) workEmpty.hidden = true;

  try {
    const [specData, planData, errorData] = await Promise.all([
      apiFetch("specs"),
      apiFetch("plans"),
      apiFetch("errors"),
    ]);
    renderWorkBoard(specData.specs || [], planData.plans || []);
    renderErrors(errorData.errors || []);
  } catch (e) {
    setLoading(workLoading, false);
    const msg =
      e instanceof TypeError
        ? "Could not reach scribe. Check your connection and try again."
        : e.message || "Could not load board";
    showBoardError(msg);
    if (workEmpty) workEmpty.hidden = true;
    setErrorsPanelVisible(false);
    if (workList) workList.hidden = true;
    if (errorList) errorList.hidden = true;
  } finally {
    setBusy(false);
    const fromHash = detailFromHash();
    const slug = fromHash?.type === "spec" ? fromHash.id : specSlugFromPath();
    const planId = fromHash?.type === "plan" ? fromHash.id : planIdFromPath();
    if (planId) openPlan(planId, { updateHash: false });
    else if (slug) openSpec(slug, { updateHash: false });
    else syncDetailChrome();
  }
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && (activeSlug || activePlanId)) {
    e.preventDefault();
    closeDetail();
    return;
  }
  if (e.key !== "r" || e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  e.preventDefault();
  loadBoard();
});

window.addEventListener("popstate", () => {
  const target = detailFromHash();
  if (target?.type === "plan") openPlan(target.id, { updateHash: false });
  else if (target?.type === "spec") openSpec(target.id, { updateHash: false });
  else closeDetail({ updateHash: false });
});

loadBoard();
