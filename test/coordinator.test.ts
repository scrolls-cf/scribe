import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	planPhaseLockStillAvailable,
	specLockStillAvailable,
	tryAcquirePlanPhaseLock,
	tryAcquireSpecLock,
} from "../src/coordinator.ts";
import type { PlanRecord } from "../src/plan.ts";
import type { SpecRecord } from "../src/spec.ts";

const now = "2026-06-09T12:00:00.000Z";
const holder = { holder_id: "agent-a", holder_kind: "agent" as const };
const other = { holder_id: "agent-b", holder_kind: "agent" as const };

function baseSpec(overrides: Partial<SpecRecord> = {}): SpecRecord {
	return {
		slug: "ged-test",
		title: "Test",
		body: "",
		status: "ready",
		phases: [],
		active_phase: null,
		lock: null,
		etag: now,
		created_at: now,
		updated_at: now,
		...overrides,
	};
}

function basePlan(overrides: Partial<PlanRecord> = {}): PlanRecord {
	return {
		id: "ged-test-plan",
		spec_slug: "ged-test",
		title: "Plan",
		body: "",
		status: "ready",
		phases: [
			{ id: "p1", index: 1, title: "P1", status: "pending", body: "", lock: null },
		],
		tasks: [],
		lock: null,
		etag: now,
		created_at: now,
		updated_at: now,
		...overrides,
	};
}

describe("coordinator lock attempts", () => {
	it("acquires spec lock when free", () => {
		const result = tryAcquireSpecLock(holder, baseSpec(), 300);
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.equal(result.spec.lock?.agent_id, "agent-a");
			assert.ok(result.spec.lock?.expires_at);
		}
	});

	it("rejects spec lock held by another agent", () => {
		const locked = baseSpec({
			lock: {
				agent_id: "agent-b",
				acquired_at: now,
				holder_kind: "agent",
				lease_seconds: 300,
				expires_at: "2026-06-09T13:00:00.000Z",
			},
		});
		const result = tryAcquireSpecLock(holder, locked, 300);
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.status, 409);
	});

	it("specLockStillAvailable respects stored lock", () => {
		const locked = baseSpec({
			lock: {
				agent_id: "agent-b",
				acquired_at: now,
				holder_kind: "agent",
				lease_seconds: 300,
				expires_at: "2026-06-09T13:00:00.000Z",
			},
		});
		assert.equal(specLockStillAvailable(locked, holder), false);
		assert.equal(specLockStillAvailable(baseSpec(), holder), true);
	});

	it("acquires plan phase lock and activates pending phase", () => {
		const result = tryAcquirePlanPhaseLock(holder, basePlan(), "p1", 300);
		assert.equal(result.ok, true);
		if (result.ok) {
			const phase = result.plan.phases.find((p) => p.id === "p1");
			assert.equal(phase?.status, "active");
			assert.equal(phase?.lock?.agent_id, "agent-a");
		}
	});

	it("planPhaseLockStillAvailable blocks wrong agent", () => {
		const plan = basePlan({
			phases: [
				{
					id: "p1",
					index: 1,
					title: "P1",
					status: "active",
					body: "",
					lock: {
						agent_id: "agent-b",
						acquired_at: now,
						holder_kind: "agent",
						lease_seconds: 300,
						expires_at: "2026-06-09T13:00:00.000Z",
					},
				},
			],
		});
		assert.equal(planPhaseLockStillAvailable(plan, "p1", holder), false);
		assert.equal(planPhaseLockStillAvailable(plan, "p1", other), true);
	});
});
