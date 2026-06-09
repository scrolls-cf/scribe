import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	parseSaveSpecInput,
	parsePatchSpecInput,
	mergeOrchestrationFields,
	linkSpecPlanId,
	normalizeSpecRecord,
	specBoardStatus,
	toSpecOrientView,
	toSpecSummary,
	shouldDefaultOrchestratorBlocked,
	isGrandfatheredOrchestratorRegister,
} from "./spec.ts";
import { parseSpecFooterFields } from "./spec-footer.ts";

describe("parseSaveSpecInput", () => {
	it("accepts a valid spec payload", () => {
		const result = parseSaveSpecInput({
			slug: "composer-foo-design",
			title: "Composer foo",
			body: "# Design\n\n## Phases\n",
			source: "composer",
		});
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.equal(result.value.slug, "composer-foo-design");
			assert.equal(result.value.title, "Composer foo");
		}
	});

	it("rejects invalid slug", () => {
		const result = parseSaveSpecInput({
			slug: "bad_slug",
			title: "x",
			body: "y",
		});
		assert.equal(result.ok, false);
	});

	it("defaults status and phases for new specs", () => {
		const result = parseSaveSpecInput({
			slug: "composer-bar-design",
			title: "Bar",
			body: "# Plan",
			phases: [{ id: "p1", title: "Design", status: "active" }],
		});
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.equal(result.value.status, "ready");
			assert.equal(result.value.phases.length, 1);
			assert.equal(result.value.lock, null);
		}
	});

	it("defaults ged-orchestrator greenfield to blocked + Review active_phase", () => {
		const result = parseSaveSpecInput({
			slug: "ged-foo-gate",
			title: "Foo",
			body: "## Implementation status\n\n| **Status** | Pending |\n",
			source: "ged-orchestrator",
		});
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.equal(result.value.status, "blocked");
			assert.equal(result.value.active_phase, "Review");
			assert.equal(result.value.review_gate, "pending");
			assert.equal(specBoardStatus(result.value), "blocked");
		}
	});

	it("respects explicit status for ged-orchestrator", () => {
		const result = parseSaveSpecInput({
			slug: "ged-bootstrap-spec",
			title: "Bootstrap",
			body: "## Implementation status\n\n| **Status** | Pending |\n",
			source: "ged-orchestrator",
			status: "ready",
			review_gate: "passed",
			active_phase: "Plan",
		});
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.equal(result.value.status, "ready");
			assert.equal(result.value.active_phase, "Plan");
			assert.equal(result.value.review_gate, "passed");
		}
	});

	it("grandfather_review_gate skips blocked default", () => {
		const result = parseSaveSpecInput({
			slug: "ged-grandfather-spec",
			title: "Grandfather",
			body: "## Implementation status\n\n| **Status** | Pending |\n",
			source: "ged-orchestrator",
			grandfather_review_gate: true,
			status: "ready",
			review_gate: "passed",
		});
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.equal(result.value.status, "ready");
		}
	});

	it("review_gate_pending false skips blocked default", () => {
		const result = parseSaveSpecInput({
			slug: "ged-no-pending-spec",
			title: "No pending",
			body: "# Spec",
			source: "ged-orchestrator",
			review_gate_pending: false,
		});
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.equal(result.value.status, "ready");
		}
	});

	it("preserves status on ged-orchestrator re-save without explicit status", () => {
		const existing = normalizeSpecRecord({
			slug: "ged-resave-spec",
			title: "Resave",
			body: "# Spec",
			source: "ged-orchestrator",
			status: "ready",
			phases: [],
			active_phase: "Plan",
			lock: null,
			etag: "e1",
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: "2026-01-01T00:00:00.000Z",
			review_gate: "passed",
		});
		const result = parseSaveSpecInput(
			{
				slug: "ged-resave-spec",
				title: "Resave",
				body: "# Spec updated",
				source: "ged-orchestrator",
			},
			existing,
		);
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.equal(result.value.status, "ready");
			assert.equal(result.value.active_phase, "Plan");
		}
	});
});

describe("shouldDefaultOrchestratorBlocked", () => {
	it("detects grandfather flags", () => {
		assert.equal(isGrandfatheredOrchestratorRegister({ grandfather_review_gate: true }), true);
		assert.equal(isGrandfatheredOrchestratorRegister({ review_gate_pending: false }), true);
		assert.equal(
			shouldDefaultOrchestratorBlocked("ged-orchestrator", null, { grandfather_review_gate: true }),
			false,
		);
	});
});

describe("specBoardStatus", () => {
	it("coerces stale in_progress without lock to ready", () => {
		const record = normalizeSpecRecord({
			slug: "x402-veo-api",
			title: "Veo",
			body: "# Spec",
			status: "in_progress",
			phases: [],
			active_phase: null,
			lock: null,
			etag: "2026-06-06T00:00:00.000Z",
			created_at: "2026-06-06T00:00:00.000Z",
			updated_at: "2026-06-06T00:00:00.000Z",
		});
		assert.equal(record.status, "ready");
		assert.equal(specBoardStatus(record), "ready");
		assert.equal(toSpecSummary(record).status, "ready");
	});
});

describe("orchestration fields on save", () => {
	it("persists footer fields on parseSaveSpecInput", () => {
		const body = `## Implementation status

| **Review gate** | pending |
| **Plan review** | required |
| **Worker scope** | scribe |
`;
		const result = parseSaveSpecInput({
			slug: "ged-orch-test",
			title: "Orch",
			body,
		});
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.equal(result.value.review_gate, "pending");
			assert.equal(result.value.plan_review, "required");
			assert.deepEqual(result.value.worker_scope, ["scribe"]);
		}
	});

	it("prefers stored DO metadata over stale footer on re-save", () => {
		const body = `## Implementation status

| **Review gate** | pending |
| **Plan** | stale-plan |
`;
		const existing = normalizeSpecRecord({
			slug: "ged-orch-resave",
			title: "Orch",
			body,
			status: "ready",
			phases: [],
			active_phase: "Implement",
			lock: null,
			etag: "e1",
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: "2026-01-01T00:00:00.000Z",
			review_gate: "passed",
			plan_id: "ged-orch-resave-plan",
		});
		const result = parseSaveSpecInput(
			{ slug: "ged-orch-resave", title: "Orch", body },
			existing,
		);
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.equal(result.value.review_gate, "passed");
			assert.equal(result.value.plan_id, "ged-orch-resave-plan");
			assert.equal(result.value.active_phase, "Implement");
		}
	});

	it("promotes footer plan_id and active_phase when DO fields missing", () => {
		const body = `## Implementation status

| **Plan:** | \`ged-foo-plan\` |
| **Active phase** | Plan |
`;
		const result = parseSaveSpecInput({
			slug: "ged-foo",
			title: "Foo",
			body,
		});
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.equal(result.value.plan_id, "ged-foo-plan");
			assert.equal(result.value.active_phase, "Plan");
		}
	});

	it("toSpecOrientView prefers stored record fields", () => {
		const record = normalizeSpecRecord({
			slug: "ged-orch",
			title: "Orch",
			body: `## Implementation status

| **Review gate** | pending |
`,
			status: "ready",
			phases: [],
			active_phase: null,
			lock: null,
			etag: "e1",
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: "2026-01-01T00:00:00.000Z",
			review_gate: "passed",
		});
		const orient = toSpecOrientView(record, parseSpecFooterFields(record.body));
		assert.equal(orient.review_gate, "passed");
	});
});

describe("mergeOrchestrationFields", () => {
	it("orders explicit input over stored over footer", () => {
		const footer = parseSpecFooterFields(`## Implementation status

| **Terminal skill** | footer-skill |
| **Plan** | footer-plan |
`);
		const merged = mergeOrchestrationFields(
			{ terminal_skill: "explicit-skill" },
			normalizeSpecRecord({
				slug: "x",
				title: "X",
				body: "",
				status: "ready",
				phases: [],
				active_phase: null,
				lock: null,
				etag: "e1",
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
				plan_id: "stored-plan",
			}),
			footer,
		);
		assert.equal(merged.terminal_skill, "explicit-skill");
		assert.equal(merged.plan_id, "stored-plan");
	});
});

describe("linkSpecPlanId", () => {
	it("sets plan_id when missing on spec", () => {
		const spec = normalizeSpecRecord({
			slug: "ged-a",
			title: "A",
			body: "# Spec",
			status: "ready",
			phases: [],
			active_phase: null,
			lock: null,
			etag: "e1",
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: "2026-01-01T00:00:00.000Z",
		});
		const linked = linkSpecPlanId(spec, "ged-a-plan", "ged-a");
		assert.ok(linked);
		assert.equal(linked?.plan_id, "ged-a-plan");
	});

	it("returns null when plan_id already matches", () => {
		const spec = normalizeSpecRecord({
			slug: "ged-a",
			title: "A",
			body: "# Spec",
			status: "ready",
			phases: [],
			active_phase: null,
			lock: null,
			etag: "e1",
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: "2026-01-01T00:00:00.000Z",
			plan_id: "ged-a-plan",
		});
		assert.equal(linkSpecPlanId(spec, "ged-a-plan", "ged-a"), null);
	});
});

describe("reconcilePlanReview", () => {
	it("prefers footer passed over stale DO required", async () => {
		const { reconcilePlanReview } = await import("./spec.ts");
		assert.equal(reconcilePlanReview("required", "passed"), "passed");
		assert.equal(reconcilePlanReview("required", "required"), "required");
		assert.equal(reconcilePlanReview(null, "passed"), "passed");
	});
});

describe("parsePatchSpecInput", () => {
	it("accepts orchestration metadata fields", () => {
		const result = parsePatchSpecInput({
			plan_id: "ged-a-plan",
			review_gate: "passed",
			terminal_skill: "ged-implementer",
			design_lane: "n/a",
			plan_review: "required",
			worker_scope: ["scribe"],
		});
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.equal(result.value.plan_id, "ged-a-plan");
			assert.equal(result.value.review_gate, "passed");
			assert.equal(result.value.terminal_skill, "ged-implementer");
			assert.deepEqual(result.value.worker_scope, ["scribe"]);
		}
	});

	it("rejects empty patch body", () => {
		const result = parsePatchSpecInput({});
		assert.equal(result.ok, false);
	});
});
