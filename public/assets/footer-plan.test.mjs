import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSmokeArtifact,
  parsePlanLinkFromBody,
  resolveLinkedPlanRefs,
} from "./footer-plan.js";

describe("parsePlanLinkFromBody", () => {
  it("reads Plan field from implementation status table", () => {
    const body = `## Implementation status

| Field | Value |
| --- | --- |
| **Plan** | ged-spec-plan-required-plan |
`;
    assert.equal(parsePlanLinkFromBody(body), "ged-spec-plan-required-plan");
  });

  it("returns null when Plan missing", () => {
    assert.equal(parsePlanLinkFromBody("## Implementation status\n\n| **Status** | Pending |"), null);
  });
});

describe("resolveLinkedPlanRefs", () => {
  it("prefers cached plans over footer", () => {
    const cached = [{ id: "a-plan", spec_slug: "ged-a", title: "A plan" }];
    const refs = resolveLinkedPlanRefs("ged-a", "| **Plan** | other-plan |", cached);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].id, "a-plan");
  });

  it("falls back to footer when cache empty", () => {
    const refs = resolveLinkedPlanRefs(
      "ged-a",
      "| **Plan** | ged-a-plan |",
      [],
    );
    assert.equal(refs[0].id, "ged-a-plan");
    assert.equal(refs[0]._footerOnly, true);
  });
});

describe("isSmokeArtifact", () => {
  it("detects smoke spec and plan", () => {
    assert.equal(isSmokeArtifact({ slug: "ged-smoke-123", source: "ged-smoke" }), true);
    assert.equal(isSmokeArtifact({ id: "ged-smoke-123-plan", spec_slug: "ged-smoke-123" }), true);
    assert.equal(isSmokeArtifact({ slug: "ged-real" }), false);
  });
});
