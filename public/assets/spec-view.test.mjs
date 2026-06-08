import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderSpecBodyHtml } from "./spec-view.js";

describe("renderSpecBodyHtml", () => {
  const spec = {
    body: `## Problem
Intent

## Phases
| 1 | row |

## Goal
Done`,
  };

  it("hides execution sections when linked plan", () => {
    const html = renderSpecBodyHtml(spec, { mode: "prose", linkedPlan: true });
    assert.match(html, /Intent/);
    assert.match(html, /Done/);
    assert.doesNotMatch(html, /Phases/);
  });

  it("shows phases when no linked plan", () => {
    const html = renderSpecBodyHtml(spec, { mode: "prose", linkedPlan: false });
    assert.match(html, /Phases/);
  });
});
