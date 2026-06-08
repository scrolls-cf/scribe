import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { isSmokeArtifact } from "./footer-plan.js";

const boardSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "board.js"),
  "utf8",
);

/** Mirrors board.js applySmokeFilter (always hides smoke artifacts). */
function applySmokeFilter(specs, plans) {
  return {
    specs: specs.filter((s) => !isSmokeArtifact(s)),
    plans: plans.filter((p) => !isSmokeArtifact(p)),
  };
}

describe("board.js smoke toggle removal", () => {
  it("has no show-smoke toggle DOM or state", () => {
    assert.doesNotMatch(boardSource, /\bsyncSmokeToggle\b/);
    assert.doesNotMatch(boardSource, /\bshowSmoke\b/);
    assert.doesNotMatch(boardSource, /work-smoke-toggle/);
    assert.doesNotMatch(boardSource, /Show smoke/);
  });

  it("keeps applySmokeFilter always hiding smoke artifacts", () => {
    const specs = [
      { slug: "ged-real" },
      { slug: "ged-smoke-abc", source: "ged-smoke" },
    ];
    const plans = [
      { id: "ged-real-plan", spec_slug: "ged-real" },
      { id: "ged-smoke-abc-plan", spec_slug: "ged-smoke-abc" },
    ];
    const filtered = applySmokeFilter(specs, plans);
    assert.deepEqual(
      filtered.specs.map((s) => s.slug),
      ["ged-real"],
    );
    assert.deepEqual(
      filtered.plans.map((p) => p.id),
      ["ged-real-plan"],
    );
  });
});
