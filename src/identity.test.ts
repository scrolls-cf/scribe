import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lockFromHolder, resolveLockHolder } from "./identity.ts";

describe("resolveLockHolder", () => {
	it("prefers matrix user email header", () => {
		const req = new Request("https://example.com", {
			headers: { "x-matrix-user-email": "dev@example.com" },
		});
		const holder = resolveLockHolder(req, "composer-host");
		assert.deepEqual(holder, {
			holder_id: "dev@example.com",
			holder_kind: "user",
		});
	});

	it("falls back to body agent_id", () => {
		const req = new Request("https://example.com");
		const holder = resolveLockHolder(req, "composer-host");
		assert.deepEqual(holder, {
			holder_id: "composer-host",
			holder_kind: "agent",
		});
	});

	it("lockFromHolder stores holder_kind", () => {
		const lock = lockFromHolder(
			{ holder_id: "dev@example.com", holder_kind: "user" },
			"2026-01-01T00:00:00.000Z",
		);
		assert.equal(lock.agent_id, "dev@example.com");
		assert.equal(lock.holder_kind, "user");
	});
});
