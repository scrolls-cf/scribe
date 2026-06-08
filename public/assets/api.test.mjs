import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mergePlansForActiveSpecs,
  planBoardStatus,
  planBoardStatusLabel,
  planPhasesComplete,
  planProgressLabel,
  specBoardStatus,
  specBoardStatusLabel,
  specOrchestrationLabel,
  specOrchestrationLabels,
} from "./api.js";

describe("mergePlansForActiveSpecs", () => {
  it("keeps done plans when parent spec is on the board", () => {
    const specs = [{ slug: "ged-a" }];
    const plans = [
      { id: "ged-a-plan", spec_slug: "ged-a", status: "done", phases_done: 6, phases_total: 6 },
      { id: "ged-b-plan", spec_slug: "ged-b", status: "done", phases_done: 1, phases_total: 1 },
    ];
    const merged = mergePlansForActiveSpecs(plans, specs);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, "ged-a-plan");
  });

  it("includes in_progress plans regardless of spec list", () => {
    const merged = mergePlansForActiveSpecs(
      [{ id: "p1", spec_slug: "orphan", status: "in_progress" }],
      [],
    );
    assert.equal(merged.length, 1);
  });
});

describe("planPhasesComplete", () => {
  it("true when phases_done equals phases_total", () => {
    assert.equal(planPhasesComplete({ phases_done: 6, phases_total: 6 }), true);
  });

  it("false when incomplete", () => {
    assert.equal(planPhasesComplete({ phases_done: 0, phases_total: 6 }), false);
  });
});

describe("planBoardStatus", () => {
  it("in_progress when status in_progress and ratio 0", () => {
    assert.equal(
      planBoardStatus({
        status: "in_progress",
        completion_ratio: 0,
        phases_done: 0,
        phases_total: 6,
      }),
      "in_progress",
    );
  });

  it("done when all phases complete even if status ready", () => {
    assert.equal(
      planBoardStatus({
        status: "ready",
        phases_done: 6,
        phases_total: 6,
        completion_ratio: 1,
      }),
      "done",
    );
  });

  it("in_progress from partial completion_ratio", () => {
    assert.equal(
      planBoardStatus({
        status: "ready",
        completion_ratio: 0.5,
        phases_done: 3,
        phases_total: 6,
      }),
      "in_progress",
    );
  });
});

describe("planProgressLabel", () => {
  it("appends complete when all phases done", () => {
    assert.equal(
      planProgressLabel({ phases_done: 6, phases_total: 6 }),
      "6/6 phases · complete",
    );
  });

  it("planBoardStatusLabel reflects in_progress status", () => {
    assert.equal(
      planBoardStatusLabel({
        status: "in_progress",
        completion_ratio: 0,
        phases_done: 0,
        phases_total: 6,
      }),
      "Build · In progress",
    );
  });
});

describe("specBoardStatus", () => {
  it("blocked when review_gate pending", () => {
    assert.equal(specBoardStatus({ status: "ready", review_gate: "pending" }), "blocked");
    assert.equal(
      specBoardStatusLabel({ status: "ready", review_gate: "pending" }),
      "Intent · Blocked",
    );
  });

  it("ready when review_gate passed", () => {
    assert.equal(specBoardStatus({ status: "ready", review_gate: "passed" }), "ready");
  });
});

describe("specOrchestrationLabels", () => {
  it("shows pending review and required plan review", () => {
    const labels = specOrchestrationLabels({
      review_gate: "pending",
      plan_review: "required",
    });
    assert.deepEqual(labels, ["Review · Pending", "Plan review · Required"]);
    assert.equal(
      specOrchestrationLabel({ review_gate: "pending", plan_review: "required" }),
      "Review · Pending · Plan review · Required",
    );
  });

  it("hides passed review and n/a plan review", () => {
    assert.deepEqual(
      specOrchestrationLabels({ review_gate: "passed", plan_review: "n/a" }),
      [],
    );
  });
});
