import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCreateErrorInput } from "../src/errors.ts";

describe("parseCreateErrorInput", () => {
	it("accepts a valid error payload", () => {
		const result = parseCreateErrorInput({
			message: "CI failed on main",
			source: "agents/composer",
		});
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.match(result.value.id, /^err-/);
			assert.equal(result.value.resolved_at, null);
		}
	});

	it("rejects missing message", () => {
		const result = parseCreateErrorInput({ source: "x" });
		assert.equal(result.ok, false);
	});
});
