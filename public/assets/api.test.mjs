import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fetchRecordEtag,
  lockActivityLabel,
  lockSummary,
  lockTreeSummary,
  mergePlansForActiveSpecs,
  normalizeEtagHeader,
  partitionCompletedWork,
  planBoardStatus,
  planBoardStatusLabel,
  hideSpecExecutionSections,
  planPhasesComplete,
  planProgressDisplayLabel,
  planProgressLabel,
  planProgressTracked,
  specBoardStatus,
  specBoardStatusLabel,
  specNeedsReviewAttention,
  specOrchestrationLabel,
  specOrchestrationLabels,
  specReviewGateLabel,
  specReviewInstructionsHref,
  specReviewLoopActive,
  specReviewNoticeState,
  planReviewAttention,
  planReviewLoopActive,
  revisionListMeta,
  revisionSummaryLabel,
  shouldShowDiffToggle,
  workUnitCount,
} from "./api.js";

describe("partitionCompletedWork", () => {
  it("keeps done specs and done plans", () => {
    const { specs, plans } = partitionCompletedWork(
      [
        { slug: "ged-a", status: "done" },
        { slug: "ged-b", status: "ready" },
      ],
      [
        { id: "p1", spec_slug: "ged-a", status: "done" },
        { id: "p2", spec_slug: "ged-b", status: "in_progress" },
      ],
    );
    assert.equal(specs.length, 1);
    assert.equal(specs[0].slug, "ged-a");
    assert.equal(plans.length, 1);
    assert.equal(plans[0].id, "p1");
  });

  it("includes phase-complete plans for done specs", () => {
    const { plans } = partitionCompletedWork(
      [{ slug: "ged-a", status: "done" }],
      [
        {
          id: "p1",
          spec_slug: "ged-a",
          status: "ready",
          phases_done: 6,
          phases_total: 6,
        },
      ],
    );
    assert.equal(plans.length, 1);
  });
});

describe("workUnitCount", () => {
  it("counts specs plus detached orphan slug groups", () => {
    assert.equal(
      workUnitCount([{ slug: "a" }], [{ spec_slug: "b" }, { spec_slug: "b" }]),
      2,
    );
  });
});

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

  it("in_progress when a phase row is active", () => {
    assert.equal(
      planBoardStatus({
        status: "ready",
        phases: [
          { id: "p1", status: "done" },
          { id: "p2", status: "active" },
        ],
        phases_done: 1,
        phases_total: 2,
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

describe("planProgressTracked", () => {
  it("false when in_progress with zero phases done", () => {
    assert.equal(
      planProgressTracked({
        status: "in_progress",
        phases_done: 0,
        phases_total: 6,
      }),
      false,
    );
  });

  it("true when at least one phase done", () => {
    assert.equal(
      planProgressTracked({
        status: "in_progress",
        phases_done: 1,
        phases_total: 6,
      }),
      true,
    );
  });

  it("planProgressDisplayLabel honest when untracked", () => {
    assert.equal(
      planProgressDisplayLabel({
        status: "in_progress",
        phases_done: 0,
        phases_total: 6,
      }),
      "In progress · phases not tracked",
    );
  });
});

describe("hideSpecExecutionSections", () => {
  const body = `## Problem
x

## Phases
| 1 | a |

## Implementation status
| **Status** | Pending |

## Goal
y`;

  it("keeps intent sections when linked plan", () => {
    const out = hideSpecExecutionSections(body, { linkedPlan: true });
    assert.match(out, /## Problem/);
    assert.match(out, /## Goal/);
    assert.doesNotMatch(out, /## Phases/);
    assert.doesNotMatch(out, /## Implementation status/);
  });

  it("unchanged when no linked plan", () => {
    assert.equal(hideSpecExecutionSections(body, { linkedPlan: false }), body);
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

  it("blocked when review_gate revise", () => {
    assert.equal(specBoardStatus({ status: "ready", review_gate: "revise" }), "blocked");
    assert.equal(specReviewGateLabel({ review_gate: "revise" }), "Revise");
  });

  it("ready when review_gate passed", () => {
    assert.equal(specBoardStatus({ status: "ready", review_gate: "passed" }), "ready");
  });
});

describe("spec review notice helpers", () => {
  it("specNeedsReviewAttention for pending and blocked DO status", () => {
    assert.equal(specNeedsReviewAttention({ status: "ready", review_gate: "pending" }), true);
    assert.equal(specNeedsReviewAttention({ status: "blocked", review_gate: "passed" }), true);
    assert.equal(specNeedsReviewAttention({ status: "ready", review_gate: "passed" }), false);
  });

  it("specReviewNoticeState and instructions href", () => {
    const state = specReviewNoticeState({ status: "ready", review_gate: "pending" });
    assert.equal(state?.gate, "Pending");
    assert.match(state?.headline ?? "", /Review required/);
    assert.match(
      specReviewInstructionsHref("/scribe/"),
      /#specs\/ged-spec-review-gate$/,
    );
  });
});

describe("lockActivityLabel", () => {
  it("maps known activities", () => {
    assert.equal(lockActivityLabel("review"), "Review");
    assert.equal(lockActivityLabel("implement"), "Implement");
  });

  it("returns empty for unknown activity", () => {
    assert.equal(lockActivityLabel("ship"), "");
  });
});

describe("lockSummary", () => {
  it("prefixes review activity before holder", () => {
    const text = lockSummary({
      agent_id: "ged-session-1",
      holder_kind: "agent",
      acquired_at: "2026-06-08T00:00:00.000Z",
      activity: "review",
    });
    assert.match(text, /^Review · Held by agent ged-session-1/);
  });

  it("lockTreeSummary includes activity prefix", () => {
    assert.equal(
      lockTreeSummary({ agent_id: "ged-session-1", activity: "implement" }),
      "Implement · Held · ged-session-1",
    );
  });
});

describe("specOrchestrationLabels", () => {
  it("shows pending review and required plan review", () => {
    const labels = specOrchestrationLabels({
      review_gate: "pending",
      plan_review: "required",
    });
    assert.deepEqual(labels, ["Review · Pending", "Plan review · Required"]);
    assert.deepEqual(specOrchestrationLabels({ review_gate: "revise" }), [
      "Review · Revise",
    ]);
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

describe("revision loop helpers", () => {
  it("specReviewLoopActive when review pending", () => {
    assert.equal(specReviewLoopActive({ review_gate: "pending" }), true);
    assert.equal(specReviewLoopActive({ review_gate: "passed" }), false);
  });

  it("planReviewLoopActive when blocked and plan review required", () => {
    assert.equal(
      planReviewLoopActive({ status: "blocked" }, { plan_review: "required" }),
      true,
    );
  });

  it("shouldShowDiffToggle requires revisions", () => {
    assert.equal(shouldShowDiffToggle({ revisions_count: 0 }, true), false);
    assert.equal(shouldShowDiffToggle({ revisions_count: 2 }, false), true);
  });

  it("revisionSummaryLabel formats delta and age", () => {
    const label = revisionSummaryLabel({
      lines_added: 3,
      lines_removed: 1,
      created_at: new Date(Date.now() - 120_000).toISOString(),
    });
    assert.match(label, /\+3 −1/);
    assert.match(label, /ago|just now/);
  });

  it("revisionListMeta hidden when loop inactive or no revisions", () => {
    assert.equal(
      revisionListMeta(
        { revisions_count: 2, last_revision: { lines_added: 4, lines_removed: 2 } },
        false,
      ),
      null,
    );
    assert.equal(revisionListMeta({ revisions_count: 0 }, true), null);
  });

  it("revisionListMeta formats delta label during loop", () => {
    assert.equal(
      revisionListMeta(
        { revisions_count: 2, last_revision: { lines_added: 4, lines_removed: 2 } },
        true,
      ),
      "Δ +4 −2",
    );
    assert.equal(revisionListMeta({ revisions_count: 1 }, true), "Δ");
  });
});

describe("planReviewAttention", () => {
  it("hides required on done specs", () => {
    assert.equal(
      planReviewAttention({ status: "done", plan_review: "required" }),
      false,
    );
  });

  it("hides required when linked plan is no longer blocked", () => {
    assert.equal(
      planReviewAttention(
        { status: "ready", plan_review: "required", active_phase: "Plan" },
        { status: "ready" },
      ),
      false,
    );
  });

  it("shows required only while plan is blocked", () => {
    assert.equal(
      planReviewAttention(
        { status: "ready", plan_review: "required", active_phase: "Plan review" },
        { status: "blocked" },
      ),
      true,
    );
  });
});

describe("specOrchestrationLabels", () => {
  it("omits stale plan review chip on shipped specs", () => {
    const labels = specOrchestrationLabels({
      status: "done",
      review_gate: "passed",
      plan_review: "required",
    });
    assert.deepEqual(labels, []);
  });
});

describe("normalizeEtagHeader", () => {
  it("strips weak prefix and quotes", () => {
    assert.equal(normalizeEtagHeader('"2026-06-08T12:00:00.000Z"'), "2026-06-08T12:00:00.000Z");
    assert.equal(normalizeEtagHeader('W/"abc"'), "abc");
    assert.equal(normalizeEtagHeader(null), null);
  });
});

describe("fetchRecordEtag", () => {
  it("returns normalized etag from GET response", async () => {
    const originalFetch = globalThis.fetch;
    const originalWindow = globalThis.window;
    globalThis.window = { location: { pathname: "/scribe" } };
    globalThis.fetch = async (url) => {
      assert.match(String(url), /\/specs\/ged-a$/);
      return {
        ok: true,
        headers: { get: (name) => (name === "etag" ? '"rev-abc"' : null) },
      };
    };
    try {
      assert.equal(await fetchRecordEtag("specs/ged-a"), "rev-abc");
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
    }
  });
});
