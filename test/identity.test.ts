import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseBearerToken, resolveLockHolder } from "../src/identity.ts";

describe("identity", () => {
	it("parseBearerToken reads Authorization header", () => {
		const req = new Request("https://x/", {
			headers: { Authorization: "Bearer sekret" },
		});
		assert.equal(parseBearerToken(req), "sekret");
	});

	it("resolveLockHolder accepts CLOUDFLARE_API_TOKEN bearer", () => {
		const req = new Request("https://x/", {
			headers: { Authorization: "Bearer cf-token" },
		});
		const holder = resolveLockHolder(req, { CLOUDFLARE_API_TOKEN: "cf-token" });
		assert.deepEqual(holder, { holder_id: "ged-stack", holder_kind: "agent" });
	});

	it("resolveLockHolder rejects wrong bearer", () => {
		const req = new Request("https://x/", {
			headers: { Authorization: "Bearer wrong" },
		});
		assert.equal(resolveLockHolder(req, { CLOUDFLARE_API_TOKEN: "expected" }), null);
	});

	it("resolveLockHolder accepts CF Access email header", () => {
		const req = new Request("https://x/", {
			headers: { "x-matrix-user-email": "you@example.com" },
		});
		assert.deepEqual(resolveLockHolder(req, { CLOUDFLARE_API_TOKEN: "x" }), {
			holder_id: "you@example.com",
			holder_kind: "user",
		});
	});
});
