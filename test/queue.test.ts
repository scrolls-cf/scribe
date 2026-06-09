import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rankQueueCandidates } from "../src/queue.ts";
import type { PlanRecord } from "../src/plan.ts";
import type { SpecRecord } from "../src/spec.ts";

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
		etag: now,
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

	it("skips specs with pending review_gate", () => {
		const spec: SpecRecord = {
			slug: "headroom-r1-design",
			title: "Headroom",
			body: "## Implementation status\n\n| **Review gate** | pending |\n",
			status: "ready",
			phases: [],
			active_phase: null,
			lock: null,
			review_gate: "pending",
			etag: now,
			created_at: now,
			updated_at: now,
		};
		const ranked = rankQueueCandidates([], [spec]);
		assert.equal(ranked.length, 0);
	});

	it("skips plan phases when linked spec review is pending", () => {
		const spec: SpecRecord = {
			slug: "headroom-r1-design",
			title: "Headroom",
			body: "",
			status: "ready",
			phases: [],
			active_phase: null,
			lock: null,
			review_gate: "pending",
			etag: now,
			created_at: now,
			updated_at: now,
		};
		const plan = planWithPhases("headroom-r1-design-plan", [
			{ id: "p1", index: 1, title: "P1", status: "pending", body: "- [ ] x", lock: null },
		]);
		plan.spec_slug = "headroom-r1-design";
		const ranked = rankQueueCandidates([plan], [spec]);
		assert.equal(ranked.length, 0);
	});
});
