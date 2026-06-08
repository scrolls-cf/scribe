import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it, beforeEach } from "node:test";
import type { RevisionRecord, RevisionSql, RevisionSqlCursor, RevisionSqlValue } from "./revision-record.ts";
import {
	buildPlanRevisionSnapshot,
	buildSpecRevisionSnapshot,
	computeRevisionDiff,
	countRevisionRecords,
	getRevisionRecord,
	initRevisionSchema,
	insertRevisionRecord,
	listRevisionRecords,
	loadRevisionsSummary,
	MAX_REVISION_ROWS,
	parseRevisionListLimit,
	parseRevisionOffset,
	parseRevisionPreview,
	newRevisionId,
	pruneRevisionRecords,
	resetRevisionSchemaForTests,
	revisionReasonRequired,
	REVISIONS_TABLE_SQL,
	toRevisionSummaryEntry,
	validateRevisionReason,
} from "./revision-record.ts";
import type { PlanRecord } from "./plan.ts";
import type { SpecRecord } from "./spec.ts";

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

function createTestRevisionSql(): { sql: RevisionSql; db: DatabaseSync } {
	const db = new DatabaseSync(":memory:");
	const sql: RevisionSql = {
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
	return { sql, db };
}

function sampleSpec(overrides: Partial<SpecRecord> = {}): SpecRecord {
	return {
		slug: "demo-spec",
		title: "Demo",
		body: "# Demo\n\n## Implementation status\n\n| **Review gate** | pending |\n",
		status: "blocked",
		phases: [{ id: "p1", title: "Phase 1", status: "pending" }],
		active_phase: "Implement",
		lock: null,
		etag: "etag-1",
		created_at: "2026-06-08T00:00:00.000Z",
		updated_at: "2026-06-08T00:00:00.000Z",
		revisions_count: 0,
		last_revision: null,
		...overrides,
	};
}

function samplePlan(overrides: Partial<PlanRecord> = {}): PlanRecord {
	return {
		id: "demo-plan",
		spec_slug: "demo-spec",
		title: "Demo plan",
		body: "## Phase 1\n- [ ] task\n",
		status: "ready",
		phases: [],
		tasks: [],
		lock: null,
		etag: "plan-etag-1",
		created_at: "2026-06-08T00:00:00.000Z",
		updated_at: "2026-06-08T00:00:00.000Z",
		revisions_count: 0,
		last_revision: null,
		...overrides,
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

describe("revision-record validation", () => {
	it("requires reason for revise and post-ship events", () => {
		assert.equal(revisionReasonRequired("spec_review_revise"), true);
		assert.equal(revisionReasonRequired("plan_review_revise"), true);
		assert.equal(revisionReasonRequired("post_ship_amend"), true);
		assert.equal(revisionReasonRequired("spec_review_pass"), false);
	});

	it("validates revise reason length", () => {
		assert.equal(validateRevisionReason("spec_review_revise", "short").ok, false);
		assert.equal(
			validateRevisionReason("spec_review_revise", "Valid reason with enough detail.").ok,
			true,
		);
		assert.equal(validateRevisionReason("spec_review_pass", "").ok, true);
	});
});

describe("revision snapshots and diff", () => {
	it("builds spec snapshot with footer fields and excerpt", async () => {
		const snapshot = await buildSpecRevisionSnapshot(sampleSpec());
		assert.equal(snapshot.status, "blocked");
		assert.equal(snapshot.footer_review_gate, "pending");
		assert.equal(snapshot.active_phase, "Implement");
		assert.ok(snapshot.body_sha256);
		assert.ok(snapshot.body_excerpt.length <= 500);
	});

	it("builds plan snapshot", async () => {
		const snapshot = await buildPlanRevisionSnapshot(samplePlan());
		assert.equal(snapshot.title, "Demo plan");
		assert.equal(snapshot.status, "ready");
		assert.ok(snapshot.body_sha256);
	});

	it("computes structured diff between snapshots", () => {
		const before = {
			etag: "e1",
			status: "ready",
			footer_review_gate: "pending",
			body_sha256: "a",
			body_excerpt: "a",
			phases_summary: { done: 0, total: 2 },
			title: "T",
		};
		const after = {
			etag: "e2",
			status: "blocked",
			footer_review_gate: "revise",
			body_sha256: "b",
			body_excerpt: "b",
			phases_summary: { done: 1, total: 2 },
			title: "T",
		};
		const diff = computeRevisionDiff(before, after, { unified_diff: "x".repeat(9000) });
		assert.equal(diff.body_changed, true);
		assert.deepEqual(diff.status_changed, { from: "ready", to: "blocked" });
		assert.equal(diff.phases_changed, true);
		assert.deepEqual(diff.footer_fields_changed, ["Review gate"]);
		assert.ok((diff.unified_diff?.length ?? 0) <= 8192);
	});
});

describe("revision SQLite storage", () => {
	let sql: RevisionSql;

	beforeEach(() => {
		resetRevisionSchemaForTests();
		sql = createTestRevisionSql().sql;
	});

	it("initializes schema idempotently", () => {
		initRevisionSchema(sql);
		initRevisionSchema(sql);
		const tables = sql
			.exec<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'revisions'",
			)
			.toArray();
		assert.equal(tables.length, 1);
		assert.match(REVISIONS_TABLE_SQL, /CREATE TABLE IF NOT EXISTS revisions/);
	});

	it("inserts and reads revision rows", () => {
		const record = sampleRevision();
		insertRevisionRecord(sql, record);
		const loaded = getRevisionRecord(sql, record.id);
		assert.ok(loaded);
		assert.equal(loaded?.event, "spec_review_revise");
		assert.equal(loaded?.reviewer.holder_id, "user@example.com");
		assert.equal(loaded?.before.footer_review_gate, "pending");
		assert.equal(loaded?.after.footer_review_gate, "revise");
	});

	it("lists revisions newest-first with pagination", () => {
		for (let i = 0; i < 5; i++) {
			insertRevisionRecord(
				sql,
				sampleRevision({
					id: `rev-${i}`,
					created_at: `2026-06-08T12:00:0${i}.000Z`,
				}),
			);
		}
		const page = listRevisionRecords(sql, "spec", "demo-spec", 2, 1);
		assert.equal(page.total, 5);
		assert.equal(page.revisions.length, 2);
		assert.equal(page.revisions[0]?.id, "rev-3");
		assert.equal(page.revisions[1]?.id, "rev-2");
	});

	it("builds revisions summary preview", () => {
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
		const entry = toRevisionSummaryEntry(getRevisionRecord(sql, "r2")!);
		assert.equal(entry.event, "spec_review_pass");
	});

	it(`prunes oldest rows beyond ${MAX_REVISION_ROWS}`, () => {
		for (let i = 0; i < MAX_REVISION_ROWS + 5; i++) {
			insertRevisionRecord(
				sql,
				sampleRevision({
					id: `rev-${i}`,
					created_at: `2026-06-01T00:00:${String(i).padStart(2, "0")}.000Z`,
				}),
			);
		}
		assert.equal(countRevisionRecords(sql, "spec", "demo-spec"), MAX_REVISION_ROWS);
		const oldest = getRevisionRecord(sql, "rev-0");
		const newest = getRevisionRecord(sql, `rev-${MAX_REVISION_ROWS + 4}`);
		assert.equal(oldest, null);
		assert.ok(newest);
	});

	it("prune helper removes explicit excess", () => {
		initRevisionSchema(sql);
		for (let i = 0; i < 8; i++) {
			sql.exec(
				`INSERT INTO revisions (
          id, target_kind, target_id, event, reason,
          reviewer_id, reviewer_kind, created_at, before_json, after_json, diff_json
        ) VALUES (?, 'spec', 'x', 'spec_body_amend', '', 'u', 'user', ?, '{}', '{}', NULL)`,
				`id-${i}`,
				`2026-06-08T00:00:0${i}.000Z`,
			);
		}
		const removed = pruneRevisionRecords(sql, "spec", "x", 3);
		assert.equal(removed, 5);
		assert.equal(countRevisionRecords(sql, "spec", "x"), 3);
	});
});

describe("revision list query params", () => {
	it("parses list limit with cap", () => {
		assert.equal(parseRevisionListLimit(null), 20);
		assert.equal(parseRevisionListLimit("5"), 5);
		assert.equal(parseRevisionListLimit("999"), MAX_REVISION_ROWS);
		assert.equal(parseRevisionListLimit("bad"), 20);
	});

	it("parses offset safely", () => {
		assert.equal(parseRevisionOffset(null), 0);
		assert.equal(parseRevisionOffset("3"), 3);
		assert.equal(parseRevisionOffset("-1"), 0);
		assert.equal(parseRevisionOffset("bad"), 0);
	});

	it("parses preview count for getSpec/getPlan", () => {
		assert.equal(parseRevisionPreview(null), 3);
		assert.equal(parseRevisionPreview("1"), 1);
		assert.equal(parseRevisionPreview("0"), 0);
		assert.equal(parseRevisionPreview("999"), MAX_REVISION_ROWS);
	});
});
