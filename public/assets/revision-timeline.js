import {
	auditEventLabel,
	auditRevisionCount,
	formatAge,
	formatReviewer,
} from "./api.js";
import { escapeDiffHtml } from "./detail-diff.js";

/** @param {object} entry */
export function gateTransitionLabel(entry) {
	const before = entry.before ?? {};
	const after = entry.after ?? {};
	const parts = [];
	if (
		before.footer_review_gate !== after.footer_review_gate &&
		(before.footer_review_gate || after.footer_review_gate)
	) {
		parts.push(
			`Review gate ${before.footer_review_gate ?? "—"} → ${after.footer_review_gate ?? "—"}`,
		);
	}
	if (
		before.footer_plan_review !== after.footer_plan_review &&
		(before.footer_plan_review || after.footer_plan_review)
	) {
		parts.push(
			`Plan review ${before.footer_plan_review ?? "—"} → ${after.footer_plan_review ?? "—"}`,
		);
	}
	if (before.status !== after.status) {
		parts.push(`Status ${before.status ?? "—"} → ${after.status ?? "—"}`);
	}
	return parts.join(" · ");
}

/**
 * @param {object} entry
 * @param {{ detailHtml?: string }} [opts]
 */
export function renderRevisionTimelineEntryHtml(entry, opts = {}) {
	const gateLine = gateTransitionLabel(entry);
	const reason = entry.reason?.trim();
	const detailInner =
		opts.detailHtml ??
		[
			reason ? `<p class="revision-timeline-reason">${escapeDiffHtml(reason)}</p>` : "",
			entry.reviewer
				? `<p class="revision-timeline-reviewer">${escapeDiffHtml(formatReviewer(entry.reviewer))}</p>`
				: "",
		].join("");

	return `<li class="revision-timeline-item" data-revision-id="${escapeDiffHtml(entry.id)}">
  <button type="button" class="revision-timeline-summary" aria-expanded="false">
    <span class="revision-timeline-event">${escapeDiffHtml(auditEventLabel(entry.event))}</span>
    <span class="revision-timeline-when">${escapeDiffHtml(formatAge(entry.created_at))}</span>
    ${gateLine ? `<span class="revision-timeline-gates">${escapeDiffHtml(gateLine)}</span>` : ""}
  </button>
  <div class="revision-timeline-detail" hidden>${detailInner}</div>
</li>`;
}

/** @param {object[]} entries */
export function renderRevisionTimelineListHtml(entries) {
	if (!entries?.length) return "";
	return `<ol class="revision-timeline-list" role="list">${entries.map((e) => renderRevisionTimelineEntryHtml(e)).join("")}</ol>`;
}

/**
 * @param {object | null | undefined} revision
 */
export function renderRevisionDetailHtml(revision) {
	if (!revision) return "";
	const parts = [];
	const reason = revision.reason?.trim();
	if (reason) {
		parts.push(`<p class="revision-timeline-reason">${escapeDiffHtml(reason)}</p>`);
	}
	if (revision.reviewer) {
		parts.push(
			`<p class="revision-timeline-reviewer">${escapeDiffHtml(formatReviewer(revision.reviewer))}</p>`,
		);
	}
	const gateLine = gateTransitionLabel(revision);
	if (gateLine) {
		parts.push(`<p class="revision-timeline-gates-detail">${escapeDiffHtml(gateLine)}</p>`);
	}
	const diff = revision.diff;
	if (diff?.unified_diff) {
		parts.push(
			`<pre class="revision-timeline-diff">${escapeDiffHtml(diff.unified_diff)}</pre>`,
		);
	} else if (diff?.body_changed) {
		parts.push(`<p class="revision-timeline-diff-hint">Body changed (no inline diff).</p>`);
	}
	return parts.join("");
}

/** @type {WeakMap<HTMLElement, { expandedId: string | null, fullList: object[] | null }>} */
const timelineState = new WeakMap();

function getState(section) {
	let state = timelineState.get(section);
	if (!state) {
		state = { expandedId: null, fullList: null };
		timelineState.set(section, state);
	}
	return state;
}

function collapseOpenItems(section) {
	for (const item of section.querySelectorAll(".revision-timeline-item")) {
		const btn = item.querySelector(".revision-timeline-summary");
		const detail = item.querySelector(".revision-timeline-detail");
		if (btn) btn.setAttribute("aria-expanded", "false");
		if (detail) detail.hidden = true;
	}
}

/**
 * @param {HTMLElement} section
 * @param {{
 *   summary?: { count?: number, latest?: object[] } | null,
 *   fetchList?: (opts: { limit?: number, offset?: number }) => Promise<{ revisions?: object[], count?: number }>,
 *   fetchDetail?: (id: string) => Promise<object>,
 * }} opts
 */
export function mountRevisionTimeline(section, opts) {
	if (!section) return;

	const count = auditRevisionCount({ revisions_summary: opts.summary });
	const latest = opts.summary?.latest ?? [];

	if (count <= 0) {
		section.hidden = true;
		section.replaceChildren();
		return;
	}

	section.hidden = false;
	const state = getState(section);
	const entries = state.fullList ?? latest;

	section.replaceChildren();

	const head = document.createElement("div");
	head.className = "revision-timeline-head";

	const title = document.createElement("h3");
	title.className = "revision-timeline-title";
	title.id = `${section.id || "revision-timeline"}-heading`;
	title.textContent = "Revision history";

	const badge = document.createElement("span");
	badge.className = "revision-timeline-count";
	badge.textContent = String(count);
	badge.setAttribute("aria-label", count === 1 ? "1 revision" : `${count} revisions`);

	head.append(title, badge);
	section.append(head);
	section.setAttribute("aria-labelledby", title.id);

	const listWrap = document.createElement("div");
	listWrap.className = "revision-timeline-body";
	listWrap.innerHTML = renderRevisionTimelineListHtml(entries);
	section.append(listWrap);

	if (!state.fullList && count > latest.length && opts.fetchList) {
		const moreBtn = document.createElement("button");
		moreBtn.type = "button";
		moreBtn.className = "btn-ghost revision-timeline-more";
		moreBtn.textContent = `Show all ${count} revisions`;
		moreBtn.addEventListener("click", async () => {
			moreBtn.disabled = true;
			moreBtn.textContent = "Loading…";
			try {
				const data = await opts.fetchList({ limit: Math.min(count, 50), offset: 0 });
				state.fullList = data.revisions ?? [];
				mountRevisionTimeline(section, { ...opts, summary: { count, latest: state.fullList } });
			} catch {
				moreBtn.disabled = false;
				moreBtn.textContent = `Show all ${count} revisions`;
			}
		});
		section.append(moreBtn);
	}

	listWrap.addEventListener("click", async (ev) => {
		const btn = ev.target.closest(".revision-timeline-summary");
		if (!btn) return;
		const item = btn.closest(".revision-timeline-item");
		if (!item) return;
		const detail = item.querySelector(".revision-timeline-detail");
		if (!detail) return;
		const id = item.dataset.revisionId;
		const opening = detail.hidden;

		collapseOpenItems(section);
		state.expandedId = opening ? id : null;

		if (!opening) return;

		btn.setAttribute("aria-expanded", "true");
		detail.hidden = false;

		if (!opts.fetchDetail || detail.dataset.loaded === "1") return;

		detail.innerHTML = '<p class="revision-timeline-loading">Loading detail…</p>';
		try {
			const revision = await opts.fetchDetail(id);
			detail.innerHTML = renderRevisionDetailHtml(revision);
			detail.dataset.loaded = "1";
		} catch {
			detail.innerHTML =
				'<p class="revision-timeline-error">Could not load revision detail.</p>';
		}
	});
}
