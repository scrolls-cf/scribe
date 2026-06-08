import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	parseSavePlanInput,
	splitPlanPhasesFromBody,
	nextPickablePhase,
	normalizePlanRecord,
	planNextActionsAfterPatch,
	stampPhaseCompletions,
} from "./plan.ts";

describe("splitPlanPhasesFromBody", () => {
	it("splits ## Phase N headings", () => {
		const body = `# Plan

## Phase 0 (setup)
- [ ] task a

## Phase 1 (ship)
- [ ] task b
`;
		const phases = splitPlanPhasesFromBody(body);
		assert.equal(phases.length, 2);
		assert.equal(phases[0].id, "p0");
		assert.equal(phases[0].index, 0);
		assert.equal(phases[1].id, "p1");
		assert.match(phases[0].body, /task a/);
	});

	it("defaults to single p0 when no headings", () => {
		const phases = splitPlanPhasesFromBody("# Plan\n\n- [ ] only task\n");
		assert.equal(phases.length, 1);
		assert.equal(phases[0].id, "p0");
	});
});

describe("nextPickablePhase", () => {
	it("offers phase 0 first", () => {
		const result = parseSavePlanInput({
			id: "demo-plan",
			spec_slug: "demo",
			title: "Demo",
			body: "## Phase 0\n- [ ] a\n\n## Phase 1\n- [ ] b",
		});
		assert.equal(result.ok, true);
		if (!result.ok) return;
		const record = normalizePlanRecord(result.value);
		const phase = nextPickablePhase(record);
		assert.equal(phase?.id, "p0");
	});

	it("skips to phase 1 when phase 0 done", () => {
		const result = parseSavePlanInput({
			id: "demo-plan",
			spec_slug: "demo",
			title: "Demo",
			body: "## Phase 0\n- [x] a\n\n## Phase 1\n- [ ] b",
		});
		assert.equal(result.ok, true);
		if (!result.ok) return;
		const record = normalizePlanRecord(result.value);
		assert.equal(nextPickablePhase(record)?.id, "p1");
	});
});

describe("planNextActionsAfterPatch", () => {
	it("requests wire_workers_builds when phase 1 becomes done", () => {
		const base = normalizePlanRecord({
			id: "demo",
			spec_slug: "demo",
			title: "Demo",
			body: "",
			status: "ready",
			phases: [
				{ id: "p0", index: 0, title: "Design", status: "done", body: "", lock: null },
				{ id: "p1", index: 1, title: "Repo", status: "active", body: "", lock: null },
			],
			tasks: [],
			lock: null,
			deploy: {
				worker: "demo",
				github_org: "scrolls-cf",
				github_repo: "demo",
				github_branch: "main",
			},
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: "2026-01-01T00:00:00.000Z",
		});
		const after = {
			...base,
			phases: base.phases.map((p) =>
				p.id === "p1" ? { ...p, status: "done" as const } : p,
			),
		};
		const actions = planNextActionsAfterPatch(base, after);
		assert.equal(actions.length, 1);
		assert.equal(actions[0].type, "wire_workers_builds");
	});
});

describe("stampPhaseCompletions", () => {
	it("sets completed_at when a phase becomes done", () => {
		const before = [
			{ id: "p0", index: 0, title: "A", status: "active" as const, body: "", lock: null },
		];
		const after = [
			{ id: "p0", index: 0, title: "A", status: "done" as const, body: "", lock: null },
		];
		const stamped = stampPhaseCompletions(before, after);
		assert.ok(stamped[0].completed_at);
	});
});
