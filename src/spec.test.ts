import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSaveSpecInput } from "./spec.ts";

describe("parseSaveSpecInput", () => {
	it("accepts a brainstorm spec payload", () => {
		const result = parseSaveSpecInput({
			slug: "composer-foo-design",
			title: "Composer foo",
			body: "# Design\n\n## Phases\n",
			source: "brainstorm",
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
});
