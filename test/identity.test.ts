import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	lockFromHolder,
	MATRIX_USER_EMAIL,
	MATRIX_USER_SUB,
	resolveLockHolder,
	resolveLockSessionId,
	sameLockPrincipal,
	sessionLockConflict,
} from "../src/identity.ts";

function req(headers: Record<string, string> = {}): Request {
	return new Request("https://example.com", { headers });
}

describe("resolveLockHolder", () => {
	it("prefers matrix user email header", () => {
		const holder = resolveLockHolder(
			req({ [MATRIX_USER_EMAIL]: "dev@example.com" }),
			"composer-host",
		);
		assert.deepEqual(holder, {
			holder_id: "dev@example.com",
			holder_kind: "user",
		});
	});

	it("falls back to body agent_id", () => {
		const holder = resolveLockHolder(req(), "composer-host");
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

describe("sameLockPrincipal", () => {
	const userHolder = { holder_id: "dev@example.com", holder_kind: "user" as const };
	const agentHolder = { holder_id: "ged-orchestrator", holder_kind: "agent" as const };

	describe("user holder", () => {
		it("matches user lock by email", () => {
			const lock = { agent_id: "dev@example.com", holder_kind: "user" as const };
			assert.equal(sameLockPrincipal(userHolder, lock), true);
		});

		it("matches user lock by Access sub when request carries sub", () => {
			const lock = { agent_id: "cf-sub-abc", holder_kind: "user" as const };
			const request = req({
				[MATRIX_USER_EMAIL]: "dev@example.com",
				[MATRIX_USER_SUB]: "cf-sub-abc",
			});
			const holder = resolveLockHolder(request, "ged-orchestrator")!;
			assert.equal(sameLockPrincipal(holder, lock, request), true);
		});

		it("matches user lock held by sub when holder resolved from sub only", () => {
			const lock = { agent_id: "cf-sub-abc", holder_kind: "user" as const };
			const request = req({ [MATRIX_USER_SUB]: "cf-sub-abc" });
			const holder = resolveLockHolder(request)!;
			assert.equal(sameLockPrincipal(holder, lock, request), true);
		});

		it("user-JWT matches user lock even when body includes ged-orchestrator agent_id", () => {
			const lock = { agent_id: "dev@example.com", holder_kind: "user" as const };
			const request = req({ [MATRIX_USER_EMAIL]: "dev@example.com" });
			const holder = resolveLockHolder(request, "ged-orchestrator")!;
			assert.equal(holder.holder_kind, "user");
			assert.equal(sameLockPrincipal(holder, lock, request), true);
		});

		it("rejects agent-held lock", () => {
			const lock = { agent_id: "ged-orchestrator", holder_kind: "agent" as const };
			assert.equal(sameLockPrincipal(userHolder, lock), false);
		});

		it("rejects different user email", () => {
			const lock = { agent_id: "other@example.com", holder_kind: "user" as const };
			assert.equal(sameLockPrincipal(userHolder, lock), false);
		});

		it("rejects different Access sub", () => {
			const lock = { agent_id: "cf-sub-other", holder_kind: "user" as const };
			const request = req({
				[MATRIX_USER_EMAIL]: "dev@example.com",
				[MATRIX_USER_SUB]: "cf-sub-mine",
			});
			const holder = resolveLockHolder(request)!;
			assert.equal(sameLockPrincipal(holder, lock, request), false);
		});
	});

	describe("agent holder", () => {
		it("matches agent lock on exact agent_id", () => {
			const lock = { agent_id: "ged-orchestrator", holder_kind: "agent" as const };
			assert.equal(sameLockPrincipal(agentHolder, lock), true);
		});

		it("rejects user-held lock", () => {
			const lock = { agent_id: "dev@example.com", holder_kind: "user" as const };
			assert.equal(sameLockPrincipal(agentHolder, lock), false);
		});

		it("rejects different agent_id", () => {
			const lock = { agent_id: "composer-host", holder_kind: "agent" as const };
			assert.equal(sameLockPrincipal(agentHolder, lock), false);
		});

		it("rejects lock without holder_kind even when agent_id matches", () => {
			const lock = { agent_id: "ged-orchestrator" };
			assert.equal(sameLockPrincipal(agentHolder, lock), false);
		});
	});

	describe("sessionLockConflict", () => {
		it("no conflict when lock has no session_id", () => {
			assert.equal(sessionLockConflict({ session_id: undefined }, "sess-a"), false);
		});

		it("no conflict when incoming omits session_id (board renew)", () => {
			assert.equal(sessionLockConflict({ session_id: "sess-a" }, undefined), false);
		});

		it("conflict when session_id differs", () => {
			assert.equal(sessionLockConflict({ session_id: "sess-a" }, "sess-b"), true);
		});

		it("no conflict when session_id matches", () => {
			assert.equal(sessionLockConflict({ session_id: "sess-a" }, "sess-a"), false);
		});
	});

	describe("resolveLockSessionId", () => {
		it("adopts incoming session on first acquire", () => {
			assert.equal(resolveLockSessionId(null, "sess-a"), "sess-a");
		});

		it("keeps existing session on renew without incoming", () => {
			assert.equal(resolveLockSessionId({ session_id: "sess-a" }, undefined), "sess-a");
		});
	});

	describe("cross-operator", () => {
		it("user cannot take agent lock with same id string", () => {
			const lock = { agent_id: "ged-orchestrator", holder_kind: "agent" as const };
			const request = req({ [MATRIX_USER_EMAIL]: "ged-orchestrator@corp.example" });
			const holder = resolveLockHolder(request)!;
			assert.equal(sameLockPrincipal(holder, lock, request), false);
		});

		it("agent cannot take user lock", () => {
			const lock = { agent_id: "dev@example.com", holder_kind: "user" as const };
			assert.equal(sameLockPrincipal(agentHolder, lock), false);
		});
	});
});
