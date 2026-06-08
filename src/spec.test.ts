import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSaveSpecInput, normalizeSpecRecord, specBoardStatus, toSpecSummary } from "./spec.ts";

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
