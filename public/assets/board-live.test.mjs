import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	applyBoardLiveEvent,
	applyLockChangedEvent,
	upsertPlanSummary,
	upsertSpecSummary,
} from "./board-live.js";

describe("board-live", () => {
	it("upsertSpecSummary merges by slug", () => {
		const specs = [{ slug: "ged-a", title: "Old", status: "ready" }];
		upsertSpecSummary(specs, { slug: "ged-a", status: "in_progress", review_gate: "passed" });
		assert.equal(specs[0].title, "Old");
		assert.equal(specs[0].status, "in_progress");
	});

	it("upsertPlanSummary merges by id", () => {
		const plans = [{ id: "p1", phases_done: 1, phases_total: 3 }];
		upsertPlanSummary(plans, { id: "p1", phases_done: 2 });
		assert.equal(plans[0].phases_done, 2);
	});

	it("applyLockChangedEvent updates spec lock", () => {
		const specs = [{ slug: "ged-a", lock: null }];
		const plans = [];
		assert.equal(
			applyLockChangedEvent(specs, plans, {
				target: "spec",
				spec_slug: "ged-a",
				lock: { agent_id: "a1" },
			}),
			true,
		);
		assert.equal(specs[0].lock.agent_id, "a1");
	});

	it("applyBoardLiveEvent handles spec_updated", () => {
		const specs = [];
		const plans = [];
		assert.equal(
			applyBoardLiveEvent(specs, plans, {
				type: "spec_updated",
				spec: { slug: "ged-b", status: "ready" },
			}),
			true,
		);
		assert.equal(specs[0].slug, "ged-b");
	});
});
