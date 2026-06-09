import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMatrixManifest, parseServiceRegistration } from "../src/service-registry.ts";

describe("service registry", () => {
	it("parses matrix manifest", () => {
		const result = parseMatrixManifest({
			id: "scribe",
			title: "scribe",
			description: "Spec store",
			routes: [{ method: "GET", path: "/health" }],
		});
		assert.equal(result.ok, true);
	});

	it("requires binding on registration", () => {
		const result = parseServiceRegistration({
			id: "foo",
			title: "Foo",
			description: "Bar",
			routes: [],
		});
		assert.equal(result.ok, false);
	});
});
