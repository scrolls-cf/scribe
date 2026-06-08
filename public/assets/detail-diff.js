import { buildLineDiffRows, countDiffLineStats } from "./diff-lines.js";

/**
 * @param {string} text
 */
export function escapeDiffHtml(text) {
	return String(text)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/**
 * @param {{ base_body?: string, head_body?: string, base_etag?: string, head_etag?: string }} diff
 * @param {{ summary?: string | null }} [opts]
 */
export function renderDiffPanelHtml(diff, opts = {}) {
	if (!diff?.base_body && !diff?.head_body) {
		return '<p class="prose-empty">No diff available.</p>';
	}
	const rows = buildLineDiffRows(diff.base_body ?? "", diff.head_body ?? "");
	const stats = countDiffLineStats(rows);
	const summary =
		opts.summary?.trim() ||
		`+${stats.lines_added} −${stats.lines_removed} lines`;
	const etagHint = diff.base_etag
		? ` vs revision <code>${escapeDiffHtml(diff.base_etag)}</code>`
		: "";

	const lineHtml = rows
		.map((row) => {
			const cls =
				row.type === "add"
					? "diff-line diff-line--add"
					: row.type === "remove"
						? "diff-line diff-line--remove"
						: "diff-line diff-line--context";
			return `<div class="${cls}"><span class="diff-line-num">${row.num}</span><span>${escapeDiffHtml(row.text)}</span></div>`;
		})
		.join("");

	return `<p class="diff-meta">${escapeDiffHtml(summary)}${etagHint}</p><div class="diff-panel" role="region" aria-label="Line changes">${lineHtml}</div>`;
}

/** @typedef {"prose" | "changes"} BodyViewMode */

/**
 * @param {HTMLElement} toolbar
 * @param {{ visible: boolean, mode: BodyViewMode, onChange: (mode: BodyViewMode) => void }} opts
 * @returns {HTMLElement | null}
 */
export function mountBodyViewToggle(toolbar, opts) {
	const existing = toolbar?.querySelector(".view-toggle");
	existing?.remove();
	if (!opts.visible || !toolbar) return null;

	const wrap = document.createElement("span");
	wrap.className = "view-toggle";
	wrap.setAttribute("role", "tablist");
	wrap.setAttribute("aria-label", "Body view");

	for (const [mode, label] of [
		["prose", "Prose"],
		["changes", "Changes"],
	]) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.setAttribute("role", "tab");
		btn.dataset.viewMode = mode;
		btn.textContent = label;
		btn.setAttribute("aria-selected", opts.mode === mode ? "true" : "false");
		btn.addEventListener("click", () => opts.onChange(/** @type {BodyViewMode} */ (mode)));
		wrap.append(btn);
	}

	toolbar.append(wrap);
	return wrap;
}

/**
 * @param {HTMLElement} toggleRoot
 * @param {BodyViewMode} mode
 */
export function syncBodyViewToggle(toggleRoot, mode) {
	if (!toggleRoot) return;
	for (const btn of toggleRoot.querySelectorAll("button[data-view-mode]")) {
		btn.setAttribute(
			"aria-selected",
			btn.dataset.viewMode === mode ? "true" : "false",
		);
	}
}
