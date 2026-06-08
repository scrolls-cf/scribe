import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planDiffUiState, renderPlanBodyHtml } from "./plan-view.js";

describe("planDiffUiState", () => {
	it("activates on blocked plan with plan_review required", () => {
		const ui = planDiffUiState(
			{ status: "blocked", revisions_count: 3, lock: null },
			{ plan_review: "required" },
		);
		assert.equal(ui.loopActive, true);
		assert.equal(ui.showIterationChip, true);
		assert.match(ui.iterationLabel ?? "", /Plan review · Iteration · 3/);
	});

	it("activates on refactor lock", () => {
		const ui = planDiffUiState(
			{ status: "in_progress", revisions_count: 1, lock: { activity: "refactor" } },
			null,
		);
		assert.equal(ui.loopActive, true);
		assert.equal(ui.showToggle, true);
	});
});

describe("renderPlanBodyHtml", () => {
	it("renders diff in changes mode", () => {
		const html = renderPlanBodyHtml(
			{ body: "next", last_revision: null },
			{
				mode: "changes",
				diff: { base_body: "prev", head_body: "next", base_etag: "b1" },
			},
		);
		assert.match(html, /diff-panel/);
	});
});
