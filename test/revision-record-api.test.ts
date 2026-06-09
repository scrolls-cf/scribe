import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it, beforeEach } from "node:test";
import type { RevisionRecord, RevisionSql, RevisionSqlCursor, RevisionSqlValue } from "../src/revision-record.ts";
import {
	DEFAULT_REVISION_LIST_LIMIT,
	DEFAULT_REVISION_PREVIEW,
	getRevisionRecord,
	initRevisionSchema,
	insertRevisionRecord,
	listRevisionRecords,
	loadRevisionsSummary,
	MAX_REVISION_ROWS,
	newRevisionId,
	parseRevisionListLimit,
	parseRevisionOffset,
	parseRevisionPreview,
	resetRevisionSchemaForTests,
	toRevisionSummaryEntry,
} from "../src/revision-record.ts";

function makeRevisionSqlCursor<T extends Record<string, RevisionSqlValue>>(
	rows: T[],
): RevisionSqlCursor<T> {
	return {
		*[Symbol.iterator](): Iterator<T> {
			for (const row of rows) yield row;
		},
		toArray(): T[] {
			return [...rows];
		},
		one(): T {
			if (rows.length !== 1) {
				throw new Error(`expected exactly one row, got ${rows.length}`);
			}
			return rows[0]!;
		},
	};
}

function createTestRevisionSql(): RevisionSql {
	const db = new DatabaseSync(":memory:");
	return {
		exec<T extends Record<string, RevisionSqlValue>>(query: string, ...bindings: RevisionSqlValue[]) {
			const trimmed = query.trim();
			if (!trimmed.toUpperCase().startsWith("SELECT")) {
				if (bindings.length > 0) {
					db.prepare(trimmed).run(...bindings);
				} else {
					db.exec(trimmed);
				}
				return makeRevisionSqlCursor<T>([]);
			}
			const stmt = db.prepare(trimmed);
			const rows = (bindings.length > 0 ? stmt.all(...bindings) : stmt.all()) as T[];
			return makeRevisionSqlCursor(rows);
		},
	};
}

function sampleRevision(overrides: Partial<RevisionRecord> = {}): RevisionRecord {
	return {
		id: newRevisionId(),
		target_kind: "spec",
		target_id: "demo-spec",
		event: "spec_review_revise",
		reason: "Scope too broad for v1 — defer board UI.",
		reviewer: { holder_id: "user@example.com", holder_kind: "user" },
		created_at: "2026-06-08T12:00:00.000Z",
		before: {
			etag: "e1",
			status: "blocked",
			footer_review_gate: "pending",
			body_sha256: "aaa",
			body_excerpt: "# before",
			phases_summary: { done: 0, total: 1 },
			title: "Demo",
		},
		after: {
			etag: "e2",
			status: "blocked",
			footer_review_gate: "revise",
			body_sha256: "bbb",
			body_excerpt: "# after",
			phases_summary: { done: 0, total: 1 },
			title: "Demo",
		},
		diff: {
			body_changed: true,
			status_changed: null,
			phases_changed: false,
			footer_fields_changed: ["Review gate"],
		},
		...overrides,
	};
}

describe("revision API query parsers", () => {
	it("parses list limit with cap", () => {
		assert.equal(parseRevisionListLimit(null), DEFAULT_REVISION_LIST_LIMIT);
		assert.equal(parseRevisionListLimit("5"), 5);
		assert.equal(parseRevisionListLimit("999"), MAX_REVISION_ROWS);
		assert.equal(parseRevisionListLimit("bad"), DEFAULT_REVISION_LIST_LIMIT);
	});

	it("parses offset as non-negative integer", () => {
		assert.equal(parseRevisionOffset(null), 0);
		assert.equal(parseRevisionOffset("3"), 3);
		assert.equal(parseRevisionOffset("-1"), 0);
		assert.equal(parseRevisionOffset("bad"), 0);
	});

	it("parses preview count with cap", () => {
		assert.equal(parseRevisionPreview(null), DEFAULT_REVISION_PREVIEW);
		assert.equal(parseRevisionPreview("1"), 1);
		assert.equal(parseRevisionPreview("0"), 0);
		assert.equal(parseRevisionPreview("999"), MAX_REVISION_ROWS);
	});
});

describe("revision API list/detail shapes", () => {
	let sql: RevisionSql;

	beforeEach(() => {
		resetRevisionSchemaForTests();
		sql = createTestRevisionSql();
		initRevisionSchema(sql);
	});

	it("lists summary entries with pagination metadata", () => {
		for (let i = 0; i < 4; i++) {
			insertRevisionRecord(
				sql,
				sampleRevision({
					id: `rev-${i}`,
					created_at: `2026-06-08T12:00:0${i}.000Z`,
				}),
			);
		}
		const page = listRevisionRecords(sql, "spec", "demo-spec", 2, 1);
		const summaries = page.revisions.map(toRevisionSummaryEntry);
		assert.equal(page.total, 4);
		assert.equal(summaries.length, 2);
		assert.equal(summaries[0]?.id, "rev-2");
		assert.equal(summaries[0]?.event, "spec_review_revise");
		assert.ok(summaries[0]?.before.footer_review_gate);
		assert.ok(summaries[0]?.after.footer_review_gate);
		assert.equal(summaries[0]?.diff, undefined);
	});

	it("loads orient revisions_summary preview", () => {
		insertRevisionRecord(sql, sampleRevision({ id: "r1", created_at: "2026-06-08T10:00:00.000Z" }));
		insertRevisionRecord(
			sql,
			sampleRevision({
				id: "r2",
				created_at: "2026-06-08T11:00:00.000Z",
				event: "spec_review_pass",
				reason: "",
			}),
		);
		const summary = loadRevisionsSummary(sql, "spec", "demo-spec", 1);
		assert.equal(summary.count, 2);
		assert.equal(summary.latest.length, 1);
		assert.equal(summary.latest[0]?.id, "r2");
	});

	it("gets full revision by id for detail endpoint", () => {
		const record = sampleRevision({ id: "detail-rev" });
		insertRevisionRecord(sql, record);
		const loaded = getRevisionRecord(sql, "detail-rev");
		assert.ok(loaded);
		assert.equal(loaded?.diff?.body_changed, true);
		assert.equal(getRevisionRecord(sql, "missing"), null);
	});

	it("rejects cross-target revision lookup", () => {
		insertRevisionRecord(
			sql,
			sampleRevision({ id: "plan-rev", target_kind: "plan", target_id: "demo-plan" }),
		);
		const loaded = getRevisionRecord(sql, "plan-rev");
		assert.ok(loaded);
		assert.equal(loaded?.target_kind, "plan");
		assert.notEqual(loaded?.target_id, "demo-spec");
	});
});
