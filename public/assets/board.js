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

const SPEC_LOADING = [
  "Reading active specs from the edge store…",
  "Checking lock state on in-flight specs…",
];
const PLAN_LOADING = [
  "Reading pushed plans from the edge store…",
  "Checking phase progress on active plans…",
];
const DETAIL_LOADING = [
  "Loading from scribe…",
  "Fetching detail from the edge store…",
];

const specList = document.getElementById("spec-list");
const specEmpty = document.getElementById("spec-empty");
const specLoading = document.getElementById("spec-loading");
const planList = document.getElementById("plan-list");
const planEmpty = document.getElementById("plan-empty");
const planLoading = document.getElementById("plan-loading");
const errorsPanel = document.getElementById("errors-panel");
const errorList = document.getElementById("error-list");
const boardError = document.getElementById("board-error");
const boardMain = document.getElementById("board-main");
const specCount = document.getElementById("spec-count");
const planCount = document.getElementById("plan-count");
const detailPanel = document.getElementById("spec-detail-panel");
const specDetailRoot = document.getElementById("spec-detail");
const planDetailRoot = document.getElementById("plan-detail");
const detailLoading = document.getElementById("spec-detail-loading");
const specPlansSection = document.getElementById("spec-plans");
const specPlanLinks = document.getElementById("spec-plan-links");
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

function setDetailOpen(open) {
  if (!boardMain || !detailPanel) return;
  boardMain.dataset.detailOpen = open ? "true" : "false";
  detailPanel.hidden = !open;
}

function renderSpecPlanLinks(slug) {
  if (!specPlansSection || !specPlanLinks) return;
  const linked = plansForSpec(slug);
  specPlanLinks.replaceChildren();

  if (!linked.length) {
    specPlansSection.hidden = true;
    return;
  }

  specPlansSection.hidden = false;
  for (const plan of linked) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "spec-plan-link";
    btn.textContent = plan.title;
    btn.setAttribute("aria-label", planLinkLabel(plan));
    btn.addEventListener("click", () => openPlan(plan.id));
    li.append(btn);

    const meta = document.createElement("span");
    meta.className = "spec-plan-link-meta";
    meta.textContent = planProgressLabel(plan);
    li.append(meta);

    specPlanLinks.append(li);
  }
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
    const linkedPlans = plansForSpec(spec.slug);
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "spec-card";
    if (spec.slug === activeSlug) btn.classList.add("is-selected");
    if (activePlanId && linkedPlans.some((p) => p.id === activePlanId)) {
      btn.classList.add("is-related");
    }
    btn.dataset.slug = spec.slug;
    btn.setAttribute("aria-label", specLinkLabel(spec));
    btn.setAttribute("aria-pressed", spec.slug === activeSlug ? "true" : "false");

    const lockText = lockSummary(spec.lock);
    const lockOpen = !spec.lock;
    const planHint =
      linkedPlans.length > 0
        ? `<span class="spec-plan-count">${linkedPlans.length} plan${linkedPlans.length === 1 ? "" : "s"}</span>`
        : "";

    btn.innerHTML = `
      <div class="spec-card-head">
        <div class="spec-card-identity">
          <h3>${escape(spec.title)}</h3>
          <p class="spec-slug">${escape(spec.slug)}</p>
        </div>
        <span class="status-pill" data-status="${escape(specBoardStatus(spec))}">${escape(specBoardStatusLabel(spec))}</span>
      </div>
      <div class="spec-meta">
        ${planHint}
        <span class="lock-badge" ${lockOpen ? 'data-open="true"' : ""}>${escape(lockText)}</span>
        <span class="spec-meta-age">${formatAge(spec.updated_at)}</span>
      </div>
    `;

    btn.addEventListener("click", () => {
      if (spec.slug === activeSlug) {
        closeDetail();
        return;
      }
      lastFocusedButton = btn;
      openSpec(spec.slug);
    });
    li.append(btn);
    specList.append(li);
  }
}

function renderPlans(plans) {
  if (!planList || !planEmpty) return;
  setLoading(planLoading, false);
  planList.replaceChildren();
  cachedPlans = plans;

  if (!plans.length) {
    planList.hidden = true;
    planEmpty.hidden = false;
    if (planCount) planCount.hidden = true;
    return;
  }

  planEmpty.hidden = true;
  planList.hidden = false;
  if (planCount) {
    planCount.textContent = String(plans.length);
    planCount.hidden = false;
  }

  for (const plan of plans) {
    const ratio = Math.round((plan.completion_ratio || 0) * 100);
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "spec-card plan-card";
    if (plan.id === activePlanId) btn.classList.add("is-selected");
    btn.dataset.planId = plan.id;
    btn.setAttribute("aria-label", planLinkLabel(plan));
    btn.setAttribute("aria-pressed", plan.id === activePlanId ? "true" : "false");

    const lockText = lockSummary(plan.lock);
    const lockOpen = !plan.lock;
    const activePhase = plan.active_phase?.title
      ? `<p class="plan-active-phase">${escape(plan.active_phase.title)}</p>`
      : "";

    btn.innerHTML = `
      <div class="spec-card-head">
        <div class="spec-card-identity">
          <h3>${escape(plan.title)}</h3>
          <p class="spec-slug">${escape(plan.spec_slug)}</p>
          ${activePhase}
        </div>
        <span class="status-pill" data-status="${escape(planBoardStatus(plan))}">${escape(planBoardStatusLabel(plan))}</span>
      </div>
      <div class="spec-meta">
        <span class="plan-progress-label">${escape(planProgressLabel(plan))}</span>
        <div class="plan-progress" role="presentation" style="--plan-progress: ${ratio / 100}">
          <div class="plan-progress-bar"></div>
        </div>
        <span class="lock-badge" ${lockOpen ? 'data-open="true"' : ""}>${escape(lockText)}</span>
        <span class="spec-meta-age">${formatAge(plan.updated_at)}</span>
      </div>
    `;

    btn.addEventListener("click", () => {
      if (plan.id === activePlanId) {
        closeDetail();
        return;
      }
      lastFocusedButton = btn;
      openPlan(plan.id);
    });
    li.append(btn);
    planList.append(li);
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
          specList?.querySelector(`[data-slug="${CSS.escape(relatedSlug)}"]`) || link;
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
  hideDetailViews();
  if (detailLoading) detailLoading.hidden = true;
  document.title = "scribe · devscrolls";
  renderSpecs(cachedSpecs);
  renderPlans(cachedPlans);
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
  renderSpecs(cachedSpecs);
  renderPlans(cachedPlans);
  renderErrors(cachedErrors);
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
    if (specDetailRoot) {
      specDetailRoot.hidden = false;
      renderSpecDetail(specDetailRoot, spec);
      renderSpecPlanLinks(slug);
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
  renderSpecs(cachedSpecs);
  renderPlans(cachedPlans);
  renderErrors(cachedErrors);
  if (detailLoading) {
    setLoadingText(detailLoading, DETAIL_LOADING);
    detailLoading.hidden = false;
  }

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
      renderPlanDetail(planDetailRoot, plan, {
        onOpenSpec: (slug) => {
          lastFocusedButton = planList?.querySelector(`[data-plan-id="${CSS.escape(id)}"]`);
          openSpec(slug);
        },
      });
    }
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
  setLoadingText(specLoading, SPEC_LOADING);
  setLoadingText(planLoading, PLAN_LOADING);
  setLoading(specLoading, true);
  setLoading(planLoading, true);
  setErrorsPanelVisible(false);
  if (specList) specList.hidden = true;
  if (planList) planList.hidden = true;
  if (errorList) errorList.hidden = true;
  if (specEmpty) specEmpty.hidden = true;
  if (planEmpty) planEmpty.hidden = true;

  try {
    const [specData, planData, errorData] = await Promise.all([
      apiFetch("specs"),
      apiFetch("plans"),
      apiFetch("errors"),
    ]);
    renderPlans(planData.plans || []);
    renderSpecs(specData.specs || []);
    renderErrors(errorData.errors || []);
  } catch (e) {
    setLoading(specLoading, false);
    setLoading(planLoading, false);
    const msg =
      e instanceof TypeError
        ? "Could not reach scribe. Check your connection and try again."
        : e.message || "Could not load board";
    showBoardError(msg);
    if (specEmpty) specEmpty.hidden = true;
    if (planEmpty) planEmpty.hidden = true;
    setErrorsPanelVisible(false);
    if (specList) specList.hidden = true;
    if (planList) planList.hidden = true;
    if (errorList) errorList.hidden = true;
  } finally {
    setBusy(false);
    const fromHash = detailFromHash();
    const slug = fromHash?.type === "spec" ? fromHash.id : specSlugFromPath();
    const planId = fromHash?.type === "plan" ? fromHash.id : planIdFromPath();
    if (planId) openPlan(planId, { updateHash: false });
    else if (slug) openSpec(slug, { updateHash: false });
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
