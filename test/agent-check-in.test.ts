import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildAgentAssignmentFromTake,
	nextActionsForMode,
	parseAgentCheckInInput,
} from "../src/agent-check-in.ts";

describe("parseAgentCheckInInput", () => {
	it("requires agent_id", () => {
		const parsed = parseAgentCheckInInput({});
		assert.equal(parsed.ok, false);
	});

	it("accepts resume_slug", () => {
		const parsed = parseAgentCheckInInput({
			agent_id: "ged-spawn-1",
			resume_slug: "ged-a",
			workspace_isolation: false,
		});
		assert.equal(parsed.ok, true);
		if (parsed.ok) assert.equal(parsed.value.resume_slug, "ged-a");
	});
});

describe("buildAgentAssignmentFromTake", () => {
	it("builds implement assignment from phase take", () => {
		const assignment = buildAgentAssignmentFromTake("ged", "ged-spawn-1", {
			ok: true,
			kind: "phase",
			spec_slug: "ged-a",
			plan_id: "ged-a-plan",
			phase: { id: "p1", title: "Phase 1", index: 1 },
		});
		assert.ok(assignment);
		assert.equal(assignment?.mode, "implement");
		assert.equal(assignment?.endpoints.spec, "/v1/projects/ged/specs/ged-a");
		assert.ok(assignment?.next_actions.length > 0);
	});

	it("returns null for empty take", () => {
		assert.equal(buildAgentAssignmentFromTake("ged", "a", { empty: true }), null);
	});
});

describe("nextActionsForMode", () => {
	it("includes spec slug in review actions", () => {
		const actions = nextActionsForMode("review", { spec_slug: "ged-x" });
		assert.ok(actions.some((a) => a.includes("ged-x")));
	});
});
