import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rankQueueCandidates } from "./queue.ts";
import type { PlanRecord } from "./plan.ts";

const now = "2026-06-06T12:00:00.000Z";

function planWithPhases(id: string, phases: PlanRecord["phases"]): PlanRecord {
	return {
		id,
		spec_slug: "s",
		title: id,
		body: "",
		status: "ready",
		phases,
		tasks: [],
		lock: null,
		created_at: now,
		updated_at: now,
	};
}

describe("rankQueueCandidates", () => {
	it("emits phase candidates not whole plans", () => {
		const ranked = rankQueueCandidates(
			[
				planWithPhases("a", [
					{ id: "p0", index: 0, title: "P0", status: "pending", body: "- [ ] x", lock: null },
					{ id: "p1", index: 1, title: "P1", status: "pending", body: "- [ ] y", lock: null },
				]),
			],
			[],
		);
		assert.equal(ranked.length, 1);
		assert.equal(ranked[0]?.kind, "phase");
		assert.equal(ranked[0]?.kind === "phase" && ranked[0].phase.id, "p0");
	});
});
