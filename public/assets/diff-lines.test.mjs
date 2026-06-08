import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLineDiffRows, countDiffLineStats } from "./diff-lines.js";

describe("buildLineDiffRows", () => {
	it("emits add and remove rows", () => {
		const rows = buildLineDiffRows("a\nb\nc", "a\nx\nc\nd");
		const stats = countDiffLineStats(rows);
		assert.equal(stats.lines_removed, 1);
		assert.equal(stats.lines_added, 2);
		assert.ok(rows.some((r) => r.type === "remove" && r.text === "b"));
		assert.ok(rows.some((r) => r.type === "add" && r.text === "x"));
	});

	it("returns empty stats for identical bodies", () => {
		const rows = buildLineDiffRows("same", "same");
		const stats = countDiffLineStats(rows);
		assert.equal(stats.lines_added, 0);
		assert.equal(stats.lines_removed, 0);
	});
});
