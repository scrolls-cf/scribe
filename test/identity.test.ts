import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveLockHolder } from "../src/identity.ts";

describe("identity", () => {
	it("resolveLockHolder accepts CF Access email header", () => {
		const req = new Request("https://scrollsmatrix.example/", {
			headers: { "x-matrix-user-email": "you@example.com" },
		});
		assert.deepEqual(resolveLockHolder(req), {
			holder_id: "you@example.com",
			holder_kind: "user",
		});
	});

	it("resolveLockHolder accepts CF Access sub as agent", () => {
		const req = new Request("https://scrollsmatrix.example/", {
			headers: { "x-matrix-user-sub": "service-token-id" },
		});
		assert.deepEqual(resolveLockHolder(req), {
			holder_id: "service-token-id",
			holder_kind: "agent",
		});
	});

	it("resolveLockHolder allows local wrangler dev", () => {
		const req = new Request("http://127.0.0.1:8791/events");
		assert.deepEqual(resolveLockHolder(req), {
			holder_id: "local-dev",
			holder_kind: "agent",
		});
	});

	it("resolveLockHolder rejects unauthenticated production requests", () => {
		const req = new Request("https://scrollsmatrix.example/events");
		assert.equal(resolveLockHolder(req), null);
	});
});
