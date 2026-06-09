import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	applyImplementStart,
	applyPhaseDone,
	applyPlanCreated,
	applyPlanGateC,
	applyPlanReviewPassed,
	applyReviewPassed,
	applyShip,
	isReviewGatePending,
	OrchestratePreconditionError,
	parseOrchestrateRequest,
} from "../src/orchestrate.ts";
import type { PlanRecord } from "../src/plan.ts";
import type { SpecRecord } from "../src/spec.ts";

function baseSpec(overrides: Partial<SpecRecord> = {}): SpecRecord {
	const now = new Date().toISOString();
	return {
		slug: "ged-a",
		title: "Test",
		body: `## Implementation status

| **Status** | Pending |
| **Review gate** | pending |
`,
		status: "blocked",
		phases: [],
		active_phase: "Review",
		lock: null,
		review_gate: "pending",
		etag: now,
		created_at: now,
		updated_at: now,
		...overrides,
	};
}

function basePlan(overrides: Partial<PlanRecord> = {}): PlanRecord {
	const now = new Date().toISOString();
	return {
		id: "ged-a-plan",
		spec_slug: "ged-a",
		title: "Plan",
		body: "## Phase 1",
		status: "blocked",
		phases: [
			{ id: "p1", index: 1, title: "Phase 1", status: "pending", body: "", lock: null },
			{ id: "p2", index: 2, title: "Phase 2", status: "pending", body: "", lock: null },
		],
		tasks: [],
		lock: null,
		etag: now,
		created_at: now,
		updated_at: now,
		...overrides,
	};
}

describe("parseOrchestrateRequest", () => {
	it("accepts review_passed", () => {
		const parsed = parseOrchestrateRequest({ event: "review_passed" });
		assert.equal(parsed.ok, true);
		if (parsed.ok) assert.equal(parsed.value.event, "review_passed");
	});

	it("rejects unknown event", () => {
		const parsed = parseOrchestrateRequest({ event: "nope" });
		assert.equal(parsed.ok, false);
	});
});

describe("applyReviewPassed", () => {
	it("promotes blocked spec with pending review gate", () => {
		const spec = baseSpec();
		assert.equal(isReviewGatePending(spec), true);
		const next = applyReviewPassed(spec);
		assert.equal(next.review_gate, "passed");
		assert.equal(next.status, "ready");
		assert.equal(next.active_phase, "Plan");
		assert.match(next.body, /Review gate.*passed/i);
	});

	it("is idempotent when already passed and ready", () => {
		const spec = baseSpec({ review_gate: "passed", status: "ready", active_phase: "Plan" });
		const next = applyReviewPassed(spec);
		assert.equal(next.status, "ready");
		assert.equal(next.review_gate, "passed");
	});

	it("throws when review gate not pending", () => {
		const spec = baseSpec({ review_gate: "passed", status: "blocked" });
		assert.throws(() => applyReviewPassed(spec), OrchestratePreconditionError);
	});
});

describe("applyPlanReviewPassed", () => {
	it("unblocks plan and sets Implement on spec", () => {
		const spec = baseSpec({
			review_gate: "passed",
			status: "ready",
			plan_review: "required",
			body: `## Implementation status

| **Status** | Pending |
| **Review gate** | passed |
| **Plan review** | required |
`,
		});
		const plan = basePlan();
		const { spec: nextSpec, plan: nextPlan } = applyPlanReviewPassed(spec, plan);
		assert.equal(nextPlan.status, "ready");
		assert.equal(nextSpec.active_phase, "Implement");
		assert.equal(nextSpec.plan_id, "ged-a-plan");
		assert.equal(nextSpec.plan_review, "passed");
		assert.match(nextSpec.body, /Plan review.*passed/i);
	});

	it("throws when plan not blocked", () => {
		const spec = baseSpec({ review_gate: "passed", status: "ready" });
		const plan = basePlan({ status: "ready" });
		assert.throws(
			() => applyPlanReviewPassed(spec, plan),
			(err: unknown) => err instanceof OrchestratePreconditionError && err.code === "plan_not_blocked",
		);
	});
});

describe("applyShip", () => {
	it("marks spec shipped and plan done", () => {
		const spec = baseSpec({ review_gate: "passed", status: "in_progress" });
		const plan = basePlan({ status: "in_progress" });
		const { spec: nextSpec, plan: nextPlan } = applyShip(spec, plan);
		assert.equal(nextSpec.status, "done");
		assert.match(nextSpec.body, /Shipped/);
		assert.equal(nextPlan?.status, "done");
		assert.equal(nextPlan?.phases.every((p) => p.status === "done"), true);
	});

	it("clears stale plan_review required on ship", () => {
		const spec = baseSpec({
			review_gate: "passed",
			status: "in_progress",
			plan_review: "required",
			body: `## Implementation status

| **Status** | Pending |
| **Review gate** | passed |
| **Plan review** | required |
`,
		});
		const plan = basePlan({ status: "in_progress" });
		const { spec: nextSpec } = applyShip(spec, plan);
		assert.equal(nextSpec.plan_review, "passed");
		assert.match(nextSpec.body, /Plan review.*passed/i);
	});
});

describe("applyPlanCreated", () => {
	it("links plan blocked when plan_review required", () => {
		const spec = baseSpec({
			review_gate: "passed",
			status: "ready",
			plan_review: "required",
		});
		const plan = basePlan({ status: "ready" });
		const { spec: nextSpec, plan: nextPlan } = applyPlanCreated(spec, plan);
		assert.equal(nextPlan.status, "blocked");
		assert.equal(nextSpec.plan_id, "ged-a-plan");
		assert.match(nextSpec.body, /Plan:/);
	});

	it("links plan ready when plan_review n/a", () => {
		const spec = baseSpec({
			review_gate: "passed",
			status: "ready",
			plan_review: "n/a",
		});
		const plan = basePlan({ status: "blocked" });
		const { plan: nextPlan } = applyPlanCreated(spec, plan);
		assert.equal(nextPlan.status, "ready");
	});
});

describe("applyPlanGateC", () => {
	it("appends plan body and applies spec phase updates while blocked", () => {
		const spec = baseSpec({
			review_gate: "passed",
			status: "ready",
			body: "| 1 | Row | Pending |",
		});
		const plan = basePlan();
		const { spec: nextSpec, plan: nextPlan } = applyPlanGateC(spec, plan, {
			plan_body_append: "## Gate C notes",
			spec_phase_updates: [{ from: "| Pending |", to: "| Updated |" }],
		});
		assert.equal(nextPlan.status, "blocked");
		assert.match(nextPlan.body, /Gate C notes/);
		assert.match(nextSpec.body, /Updated/);
	});

	it("throws when plan not blocked", () => {
		const spec = baseSpec({ review_gate: "passed", status: "ready" });
		const plan = basePlan({ status: "ready" });
		assert.throws(
			() => applyPlanGateC(spec, plan),
			(err: unknown) => err instanceof OrchestratePreconditionError && err.code === "plan_not_blocked",
		);
	});
});

describe("applyPhaseDone", () => {
	it("marks phase done and activates next", () => {
		const spec = baseSpec({ review_gate: "passed", status: "in_progress", active_phase: "Implement" });
		const plan = basePlan({
			status: "in_progress",
			phases: [
				{ id: "p1", index: 1, title: "P1", status: "active", body: "", lock: null },
				{ id: "p2", index: 2, title: "P2", status: "pending", body: "", lock: null },
			],
		});
		const { plan: nextPlan } = applyPhaseDone(spec, plan, { phase_id: "p1" });
		assert.equal(nextPlan.phases.find((p) => p.id === "p1")?.status, "done");
		assert.equal(nextPlan.phases.find((p) => p.id === "p2")?.status, "active");
		assert.equal(nextPlan.status, "in_progress");
	});

	it("throws when plan not in_progress", () => {
		const spec = baseSpec({ review_gate: "passed", status: "ready" });
		const plan = basePlan({ status: "ready" });
		assert.throws(
			() => applyPhaseDone(spec, plan, { phase_id: "p1" }),
			(err: unknown) =>
				err instanceof OrchestratePreconditionError && err.code === "plan_not_in_progress",
		);
	});
});

describe("applyImplementStart", () => {
	it("promotes ready plan to in_progress", () => {
		const spec = baseSpec({ review_gate: "passed", status: "ready" });
		const plan = basePlan({ status: "ready" });
		const { plan: nextPlan } = applyImplementStart(spec, plan);
		assert.equal(nextPlan.status, "in_progress");
	});

	it("throws when plan not ready", () => {
		const spec = baseSpec({ review_gate: "passed", status: "ready" });
		const plan = basePlan({ status: "blocked" });
		assert.throws(
			() => applyImplementStart(spec, plan),
			(err: unknown) => err instanceof OrchestratePreconditionError && err.code === "plan_not_ready",
		);
	});
});

describe("parseOrchestrateRequest plan_id", () => {
	it("requires plan_id for phase_done", () => {
		const parsed = parseOrchestrateRequest({ event: "phase_done" });
		assert.equal(parsed.ok, false);
	});
});
