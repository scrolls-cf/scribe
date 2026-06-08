import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	MAX_REVISIONS,
	appendBodyRevision,
	countLineDelta,
	inferRevisionTrigger,
	loadRevisionIndex,
	revisionIndexKey,
	revisionStorageKey,
	trimRevisionIndex,
	type BodyRevision,
} from "./revision.ts";

class MockStorage {
	#data = new Map<string, unknown>();

	async get<T>(key: string): Promise<T | undefined> {
		return this.#data.get(key) as T | undefined;
	}

	async put(key: string, value: unknown): Promise<void> {
		this.#data.set(key, value);
	}

	async delete(key: string): Promise<void> {
		this.#data.delete(key);
	}

	has(key: string): boolean {
		return this.#data.has(key);
	}
}

function specCtx(
	body: string,
	etag: string,
	overrides: Record<string, unknown> = {},
) {
	return {
		body,
		etag,
		status: "ready" as const,
		lock: null,
		revisions_count: 0,
		last_revision: null,
		...overrides,
	};
}

describe("revision helpers", () => {
	it("counts line delta via LCS", () => {
		const delta = countLineDelta("a\nb\nc", "a\nx\nc\nd");
		assert.equal(delta.lines_removed, 1);
		assert.equal(delta.lines_added, 2);
	});

	it("infers trigger from lock activity and status", () => {
		assert.equal(inferRevisionTrigger(null, {}), "register");
		assert.equal(
			inferRevisionTrigger(
				{ body: "", etag: "e1", status: "ready", lock: { activity: "refactor" } as never },
				{},
			),
			"refactor",
		);
		assert.equal(
			inferRevisionTrigger(
				{ body: "", etag: "e1", status: "in_progress", lock: null },
				{ status: "done" },
			),
			"ship",
		);
		assert.equal(
			inferRevisionTrigger(
				{ body: "", etag: "e1", status: "ready", lock: null },
				{ status: "ready" },
			),
			"manual",
		);
	});
});

describe("appendBodyRevision", { concurrency: 1 }, () => {
	it("appends snapshot when body changes", async () => {
		const storage = new MockStorage();
		const result = await appendBodyRevision(
			storage,
			"spec",
			"demo-spec",
			specCtx("# v1", "etag-v1"),
			specCtx("# v2", "etag-v2"),
		);
		assert.equal(result.appended, true);
		assert.equal(result.revisions_count, 1);
		assert.equal(result.last_revision?.base_etag, "etag-v1");
		assert.equal(result.last_revision?.head_etag, "etag-v2");
		const row = await storage.get<BodyRevision>(
			revisionStorageKey("spec", "demo-spec", "etag-v1"),
		);
		assert.equal(row?.body, "# v1");
		assert.ok(row?.body_sha256);
	});

	it("skips append when body is unchanged", async () => {
		const storage = new MockStorage();
		const body = "# same";
		const first = await appendBodyRevision(
			storage,
			"spec",
			"demo-spec",
			specCtx(body, "etag-v1"),
			specCtx("# next", "etag-v2"),
		);
		assert.equal(first.appended, true);
		const second = await appendBodyRevision(
			storage,
			"spec",
			"demo-spec",
			specCtx("# next", "etag-v2"),
			specCtx("# next", "etag-v3"),
		);
		assert.equal(second.appended, false);
		assert.equal(second.revisions_count, 1);
	});

	it("skips append when previous body is empty", async () => {
		const storage = new MockStorage();
		const result = await appendBodyRevision(
			storage,
			"spec",
			"demo-spec",
			specCtx("", "etag-v1"),
			specCtx("# first", "etag-v2"),
		);
		assert.equal(result.appended, false);
		assert.equal(result.revisions_count, 0);
	});

	it("dedups identical consecutive snapshot bodies", async () => {
		const storage = new MockStorage();
		await appendBodyRevision(
			storage,
			"spec",
			"demo-spec",
			specCtx("# v1", "etag-v1"),
			specCtx("# v2", "etag-v2"),
		);
		const result = await appendBodyRevision(
			storage,
			"spec",
			"demo-spec",
			specCtx("# v1", "etag-v3"),
			specCtx("# v3", "etag-v4"),
		);
		assert.equal(result.appended, false);
		assert.equal(result.revisions_count, 1);
	});

	it(`trims index to ${MAX_REVISIONS} entries (FIFO)`, async () => {
		const storage = new MockStorage();
		const kind = "plan" as const;
		const id = "demo-plan";
		const index: string[] = [];
		for (let i = 0; i < MAX_REVISIONS + 3; i++) {
			const base = `etag-${i}`;
			const head = `etag-${i + 1}`;
			index.unshift(base);
			await storage.put(revisionStorageKey(kind, id, base), {
				base_etag: base,
				head_etag: head,
				body: `body-${i}`,
				body_sha256: `hash-${i}`,
				created_at: new Date().toISOString(),
				trigger: "manual",
			} satisfies BodyRevision);
		}
		await storage.put(revisionIndexKey(kind, id), index);
		const trimmed = await trimRevisionIndex(storage, kind, id, index);
		assert.equal(trimmed.length, MAX_REVISIONS);
		assert.equal(trimmed[0], `etag-${MAX_REVISIONS + 2}`);
		for (let i = 0; i < 3; i++) {
			assert.equal(
				storage.has(revisionStorageKey(kind, id, `etag-${i}`)),
				false,
				`expected dropped revision etag-${i}`,
			);
		}
		const kept = await loadRevisionIndex(storage, kind, id);
		assert.equal(kept.length, MAX_REVISIONS);
	});

	it("trims during append when index exceeds cap", async () => {
		const storage = new MockStorage();
		const kind = "spec" as const;
		const id = "overflow-spec";
		const index: string[] = [];
		for (let i = 0; i < MAX_REVISIONS; i++) {
			const base = `old-${i}`;
			index.push(base);
			await storage.put(revisionStorageKey(kind, id, base), {
				base_etag: base,
				head_etag: `old-head-${i}`,
				body: `old-body-${i}`,
				body_sha256: `old-hash-${i}`,
				created_at: new Date().toISOString(),
				trigger: "manual",
			} satisfies BodyRevision);
		}
		await storage.put(revisionIndexKey(kind, id), index);
		const result = await appendBodyRevision(
			storage,
			kind,
			id,
			specCtx("current-body", "current-etag"),
			specCtx("next-body", "next-etag"),
		);
		assert.equal(result.appended, true);
		assert.equal(result.revisions_count, MAX_REVISIONS);
		assert.equal(storage.has(revisionStorageKey(kind, id, "old-19")), false);
		assert.equal(storage.has(revisionStorageKey(kind, id, "current-etag")), true);
	});
});
