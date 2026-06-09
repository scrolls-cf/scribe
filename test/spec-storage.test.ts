import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSpecFooterFields } from "../src/spec-footer.ts";
import { normalizeSpecRecord, specKey, toSpecOrientView } from "../src/spec.ts";
import {
	deleteSpecStorage,
	hydrateSpecRecord,
	needsFooterBodyParse,
	putSpecRecord,
	resolveSpecBody,
	specBodyKey,
} from "../src/spec-storage.ts";

function mockStorage() {
	const map = new Map<string, unknown>();
	return {
		async get<T>(key: string): Promise<T | undefined> {
			return map.get(key) as T | undefined;
		},
		async put(key: string, value: unknown): Promise<void> {
			map.set(key, value);
		},
		async delete(key: string): Promise<void> {
			map.delete(key);
		},
		map,
	};
}

const baseRecord = normalizeSpecRecord({
	slug: "ged-a",
	title: "A",
	body: "# Spec body\n\n## Goal\nDone",
	status: "ready",
	phases: [{ id: "p1", title: "Orient", status: "pending" }],
	active_phase: "Orient",
	lock: null,
	etag: "e1",
	created_at: "2026-01-01T00:00:00.000Z",
	updated_at: "2026-01-01T00:00:00.000Z",
	terminal_skill: "ged-implementer",
	design_lane: "n/a",
	plan_id: "ged-a-plan",
	review_gate: "passed",
	plan_review: "n/a",
	worker_scope: ["scribe"],
});

describe("spec storage split", () => {
	it("writes metadata without body and body to split key", async () => {
		const storage = mockStorage();
		await putSpecRecord(storage, baseRecord);
		const meta = await storage.get<typeof baseRecord>(specKey("ged-a"));
		assert.ok(meta);
		assert.equal(meta.body, "");
		assert.equal(await storage.get(specBodyKey("ged-a")), baseRecord.body);
	});

	it("hydrates from split keys", async () => {
		const storage = mockStorage();
		await putSpecRecord(storage, baseRecord);
		const stored = (await storage.get(specKey("ged-a"))) as typeof baseRecord;
		const hydrated = await hydrateSpecRecord(storage, "ged-a", stored);
		assert.equal(hydrated.body, baseRecord.body);
	});

	it("reads monolithic legacy records", async () => {
		const storage = mockStorage();
		await storage.put(specKey("ged-legacy"), baseRecord);
		const hydrated = await hydrateSpecRecord(
			storage,
			"ged-legacy",
			(await storage.get(specKey("ged-legacy"))) as typeof baseRecord,
		);
		assert.equal(hydrated.body, baseRecord.body);
	});

	it("resolveSpecBody prefers inline body on legacy record", async () => {
		const storage = mockStorage();
		await storage.put(specKey("ged-legacy"), baseRecord);
		const stored = (await storage.get(specKey("ged-legacy"))) as typeof baseRecord;
		assert.equal(await resolveSpecBody(storage, "ged-legacy", stored), baseRecord.body);
	});

	it("deleteSpecStorage removes metadata and body keys", async () => {
		const storage = mockStorage();
		await putSpecRecord(storage, baseRecord);
		await deleteSpecStorage(storage, "ged-a");
		assert.equal(await storage.get(specKey("ged-a")), undefined);
		assert.equal(await storage.get(specBodyKey("ged-a")), undefined);
	});
});

describe("needsFooterBodyParse", () => {
	it("false when orchestration fields are stored on record", () => {
		assert.equal(needsFooterBodyParse(baseRecord), false);
	});

	it("true when review_gate missing from record", () => {
		const record = normalizeSpecRecord({
			...baseRecord,
			review_gate: null,
			body: `## Implementation status\n\n| **Review gate** | passed |\n`,
		});
		assert.equal(needsFooterBodyParse(record), true);
	});
});

describe("summary orient without body load", () => {
	it("builds orient from stored metadata only", () => {
		const metadata = normalizeSpecRecord({ ...baseRecord, body: "" });
		assert.equal(needsFooterBodyParse(metadata), false);
		const orient = toSpecOrientView(metadata, parseSpecFooterFields(""));
		assert.equal(orient.slug, "ged-a");
		assert.equal(orient.review_gate, "passed");
		assert.equal(orient.plan_id, "ged-a-plan");
		assert.equal("body" in orient, false);
	});
});
