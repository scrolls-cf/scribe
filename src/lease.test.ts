import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	clampLeaseSeconds,
	defaultLeaseSeconds,
	dueLeaseEntries,
	leaseStorageKey,
	listLeaseEntries,
	lockWithLease,
	nextLeaseExpiryMs,
	parseLeaseSeconds,
	removeLease,
	syncLeaseAlarm,
	upsertLease,
	type LeaseEntry,
} from "./lease.ts";

class MockStorage {
	#data = new Map<string, unknown>();
	#alarm: number | null = null;

	async get<T>(key: string): Promise<T | undefined> {
		return this.#data.get(key) as T | undefined;
	}

	async put(key: string, value: unknown): Promise<void> {
		this.#data.set(key, value);
	}

	async delete(key: string): Promise<void> {
		this.#data.delete(key);
	}

	async list<T>(opts: { prefix: string }) {
		const out = new Map<string, T>();
		for (const [key, value] of this.#data) {
			if (key.startsWith(opts.prefix)) out.set(key, value as T);
		}
		return out;
	}

	async getAlarm(): Promise<number | null> {
		return this.#alarm;
	}

	async setAlarm(when: number): Promise<void> {
		this.#alarm = when;
	}

	async deleteAlarm(): Promise<void> {
		this.#alarm = null;
	}

	alarmAt() {
		return this.#alarm;
	}
}

describe("lease helpers", () => {
	it("defaults lease seconds by holder kind", () => {
		assert.equal(defaultLeaseSeconds("agent"), 14_400);
		assert.equal(defaultLeaseSeconds("user"), 86_400);
	});

	it("parses and clamps lease_seconds", () => {
		const unset = parseLeaseSeconds(undefined, "agent");
		assert.ok(unset.ok);
		if (unset.ok) assert.equal(unset.value, 14_400);
		const bad = parseLeaseSeconds(60, "agent");
		assert.equal(bad.ok, false);
		const ok = parseLeaseSeconds(600, "agent");
		assert.ok(ok.ok);
		if (ok.ok) assert.equal(ok.value, 600);
		assert.equal(clampLeaseSeconds(999_999), 86_400);
	});

	it("builds lock with expires_at", () => {
		const lock = lockWithLease(
			{ holder_id: "agent-1", holder_kind: "agent" },
			"2026-01-01T00:00:00.000Z",
			300,
		);
		assert.equal(lock.lease_seconds, 300);
		assert.equal(lock.expires_at, "2026-01-01T00:05:00.000Z");
	});

	it("finds due leases", () => {
		const entries: LeaseEntry[] = [
			{
				target: { kind: "spec", slug: "a" },
				expires_at_ms: 100,
				acquired_at: "2026-01-01T00:00:00.000Z",
				holder_id: "x",
				holder_kind: "agent",
			},
			{
				target: { kind: "spec", slug: "b" },
				expires_at_ms: 500,
				acquired_at: "2026-01-01T00:00:00.000Z",
				holder_id: "y",
				holder_kind: "agent",
			},
		];
		assert.equal(dueLeaseEntries(entries, 200).length, 1);
		assert.equal(nextLeaseExpiryMs(entries), 100);
	});
});

describe("lease storage", () => {
	it("schedules earliest alarm on upsert", async () => {
		const storage = new MockStorage();
		const lockA = lockWithLease(
			{ holder_id: "a", holder_kind: "agent" },
			"2026-01-01T00:00:00.000Z",
			300,
		);
		const lockB = lockWithLease(
			{ holder_id: "b", holder_kind: "agent" },
			"2026-01-01T00:00:00.000Z",
			600,
		);
		await upsertLease(storage as unknown as DurableObjectStorage, { kind: "spec", slug: "a" }, lockA);
		await upsertLease(storage as unknown as DurableObjectStorage, { kind: "spec", slug: "b" }, lockB);
		assert.equal(storage.alarmAt(), new Date(lockA.expires_at!).getTime());
		const listed = await listLeaseEntries(storage as unknown as DurableObjectStorage);
		assert.equal(listed.length, 2);
		assert.equal(leaseStorageKey({ kind: "spec", slug: "a" }), "lease:spec:a");
	});

	it("clears alarm when last lease removed", async () => {
		const storage = new MockStorage();
		const target = { kind: "spec" as const, slug: "only" };
		const lock = lockWithLease(
			{ holder_id: "a", holder_kind: "agent" },
			"2026-01-01T00:00:00.000Z",
			300,
		);
		await upsertLease(storage as unknown as DurableObjectStorage, target, lock);
		await removeLease(storage as unknown as DurableObjectStorage, target);
		assert.equal(storage.alarmAt(), null);
		assert.equal((await listLeaseEntries(storage as unknown as DurableObjectStorage)).length, 0);
	});

	it("reschedules alarm after sync", async () => {
		const storage = new MockStorage();
		await storage.setAlarm(999_999);
		const lock = lockWithLease(
			{ holder_id: "a", holder_kind: "agent" },
			"2026-01-01T00:00:00.000Z",
			300,
		);
		await storage.put(leaseStorageKey({ kind: "spec", slug: "x" }), {
			target: { kind: "spec", slug: "x" },
			expires_at_ms: new Date(lock.expires_at!).getTime(),
			acquired_at: lock.acquired_at,
			holder_id: "a",
			holder_kind: "agent",
		});
		await syncLeaseAlarm(storage as unknown as DurableObjectStorage);
		assert.equal(storage.alarmAt(), new Date(lock.expires_at!).getTime());
	});
});
