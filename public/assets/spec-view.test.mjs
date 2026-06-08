import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderSpecBodyHtml, specDiffUiState } from "./spec-view.js";

describe("specDiffUiState", () => {
	it("shows iteration chip when review gate pending and revisions exist", () => {
		const ui = specDiffUiState({
			review_gate: "pending",
			revisions_count: 2,
			status: "ready",
			lock: null,
		});
		assert.equal(ui.loopActive, true);
		assert.equal(ui.showToggle, true);
		assert.equal(ui.showIterationChip, true);
		assert.equal(ui.iterationLabel, "Iteration · 2");
	});

	it("hides toggle when no revisions", () => {
		const ui = specDiffUiState({
			review_gate: "pending",
			revisions_count: 0,
			status: "ready",
		});
		assert.equal(ui.showToggle, false);
	});

	it("keeps toggle for history when gate passed", () => {
		const ui = specDiffUiState({
			review_gate: "passed",
			revisions_count: 1,
			status: "ready",
		});
		assert.equal(ui.loopActive, false);
		assert.equal(ui.showToggle, true);
		assert.equal(ui.showIterationChip, false);
	});
});

describe("renderSpecBodyHtml", () => {
	it("renders diff panel in changes mode", () => {
		const html = renderSpecBodyHtml(
			{ body: "# v2", last_revision: { lines_added: 1, lines_removed: 1 } },
			{
				mode: "changes",
				diff: { base_body: "# v1", head_body: "# v2", base_etag: "e1" },
			},
		);
		assert.match(html, /diff-panel/);
		assert.match(html, /diff-line--remove/);
		assert.match(html, /diff-line--add/);
	});

	it("renders prose in prose mode", () => {
		const html = renderSpecBodyHtml(
			{ body: "# Title\n\nBody" },
			{ mode: "prose", diff: null },
		);
    assert.match(html, /<h2/);
	});
});
