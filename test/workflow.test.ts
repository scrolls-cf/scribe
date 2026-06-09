import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	advanceWorkflow,
	appendProgress,
	emptyWorkflow,
	lockWorkflow,
	patchWorkflow,
	WorkflowError,
} from "../src/workflow.ts";

describe("workflow", () => {
	it("creates draft workflow", () => {
		const w = emptyWorkflow("my-feature", "rough idea");
		assert.equal(w.phase, "draft");
		assert.equal(w.draft, "rough idea");
	});

	it("advance draft requires spec", () => {
		const w = emptyWorkflow("my-feature", "rough idea");
		assert.throws(() => advanceWorkflow(w), (err: unknown) => {
			assert.ok(err instanceof WorkflowError);
			assert.equal((err as WorkflowError).code, "missing_spec");
			return true;
		});
	});

	it("advance draft to spec when spec present", () => {
		const w = patchWorkflow(emptyWorkflow("my-feature", "rough idea"), {
			spec: "proper spec",
		});
		const next = advanceWorkflow(w);
		assert.equal(next.phase, "spec");
	});

	it("advance spec requires plan", () => {
		const w = { ...emptyWorkflow("x", "d"), phase: "spec" as const, spec: "s" };
		assert.throws(() => advanceWorkflow(w), (err: unknown) => {
			assert.ok(err instanceof WorkflowError);
			assert.equal((err as WorkflowError).code, "missing_plan");
			return true;
		});
	});

	it("lock only from plan_review", () => {
		const w = { ...emptyWorkflow("x", "d"), phase: "spec" as const };
		assert.throws(() => lockWorkflow(w, "agent-1", "agent"));
		const review = {
			...emptyWorkflow("x", "d"),
			phase: "plan_review" as const,
			spec: "s",
			plan: "p",
		};
		const locked = lockWorkflow(review, "agent-1", "agent");
		assert.equal(locked.phase, "locked");
		assert.equal(locked.locked_by, "agent-1");
	});

	it("progress only during implement", () => {
		const w = { ...emptyWorkflow("x", "d"), phase: "implement" as const };
		const updated = appendProgress(w, "phase-1", "did thing");
		assert.equal(updated.progress.length, 1);
		assert.equal(updated.progress[0].summary, "did thing");
	});

	it("full happy path phases", () => {
		let w = patchWorkflow(emptyWorkflow("ship-it", "draft"), { spec: "spec body" });
		w = advanceWorkflow(w);
		assert.equal(w.phase, "spec");
		w = patchWorkflow(w, { plan: "plan body" });
		w = advanceWorkflow(w);
		assert.equal(w.phase, "plan_review");
		w = lockWorkflow(w, "ged-stack", "agent");
		w = advanceWorkflow(w);
		assert.equal(w.phase, "design");
		w = advanceWorkflow(w);
		assert.equal(w.phase, "implement");
		w = appendProgress(w, "setup", "scaffold done");
		w = advanceWorkflow(w);
		assert.equal(w.phase, "final_review");
		w = advanceWorkflow(w);
		assert.equal(w.phase, "ship");
	});
});
