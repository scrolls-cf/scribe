import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	parseSaveSpecInput,
	normalizeSpecRecord,
	specBoardStatus,
	toSpecOrientView,
	toSpecSummary,
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
