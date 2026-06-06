import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	parseSavePlanInput,
	splitPlanPhasesFromBody,
	nextPickablePhase,
	normalizePlanRecord,
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
