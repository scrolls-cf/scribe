import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { etagConflict, normalizeEtagToken, recordEtag } from "./etag.ts";

describe("etag", () => {
	it("recordEtag uses updated_at", () => {
		assert.equal(recordEtag("2026-06-07T00:00:00.000Z"), "2026-06-07T00:00:00.000Z");
	});

	it("normalizeEtagToken strips quotes", () => {
		assert.equal(normalizeEtagToken('"abc"'), "abc");
	});

	it("etagConflict when If-Match mismatches", () => {
		const req = new Request("https://x/", {
			headers: { "If-Match": '"stale"' },
		});
		assert.equal(etagConflict("fresh", req), true);
	});

	it("etagConflict allows missing If-Match", () => {
		const req = new Request("https://x/");
		assert.equal(etagConflict("fresh", req), false);
	});
});
