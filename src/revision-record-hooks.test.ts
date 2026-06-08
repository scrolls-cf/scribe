import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it, beforeEach } from "node:test";
import type { PlanRecord } from "./plan.ts";
import type { SpecRecord } from "./spec.ts";
import type { RevisionSql, RevisionSqlCursor, RevisionSqlValue } from "./revision-record.ts";
import {
	appendRevisionRecordIfNeeded,
	buildSpecRevisionSnapshot,
	countRevisionRecords,
	evaluatePlanRevisionAppend,
	evaluateSpecRevisionAppend,
	inferSpecRevisionEvent,
	planStructureChanged,
	resetRevisionSchemaForTests,
	reviewerFromHolder,
} from "./revision-record.ts";

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

function baseSpec(overrides: Partial<SpecRecord> = {}): SpecRecord {
	const now = "2026-06-08T12:00:00.000Z";
	return {
		slug: "ged-demo",
		title: "Demo",
		body: `## Implementation status

| **Review gate** | pending |
`,
		status: "blocked",
		phases: [],
		active_phase: "Review",
		lock: null,
		review_gate: "pending",
		etag: "e1",
		created_at: now,
		updated_at: now,
		revisions_count: 0,
		last_revision: null,
		...overrides,
	};
}

function basePlan(overrides: Partial<PlanRecord> = {}): PlanRecord {
	const now = "2026-06-08T12:00:00.000Z";
	return {
		id: "ged-demo-plan",
		spec_slug: "ged-demo",
		title: "Plan",
		body: "## Phase 1\n- [ ] task\n",
		status: "ready",
		phases: [
			{ id: "p1", index: 1, title: "Phase 1", status: "pending", body: "", lock: null },
		],
		tasks: [{ id: "t1", title: "Task 1", status: "pending" }],
		lock: null,
		etag: "p1",
		created_at: now,
		updated_at: now,
		revisions_count: 0,
		last_revision: null,
		...overrides,
	};
}

describe("revision append inference", () => {
	it("infers spec_review_revise from review_gate transition", async () => {
		const before = await buildSpecRevisionSnapshot(baseSpec({ review_gate: "pending" }));
		const after = await buildSpecRevisionSnapshot(
			baseSpec({ review_gate: "revise", status: "blocked" }),
		);
		assert.equal(
			inferSpecRevisionEvent(before, after, before.body_excerpt, after.body_excerpt),
			"spec_review_revise",
		);
	});

	it("infers spec_review_pass when gate becomes passed", async () => {
		const before = await buildSpecRevisionSnapshot(baseSpec({ review_gate: "pending" }));
		const after = await buildSpecRevisionSnapshot(
			baseSpec({ review_gate: "passed", status: "ready" }),
		);
		assert.equal(
			inferSpecRevisionEvent(before, after, before.body_excerpt, after.body_excerpt),
			"spec_review_pass",
		);
	});

	it("skips plan task status-only progress", () => {
		const before = basePlan();
		const after = basePlan({
			tasks: [{ id: "t1", title: "Task 1", status: "done" }],
		});
		assert.equal(planStructureChanged(before, after), false);
	});

	it("detects plan structural phase edits after ready", () => {
		const before = basePlan();
		const after = basePlan({
			phases: [
				{ id: "p1", index: 1, title: "Phase 1 revised", status: "pending", body: "", lock: null },
			],
		});
		assert.equal(planStructureChanged(before, after), true);
	});
});

describe("revision append hooks integration", () => {
	let sql: RevisionSql;

	beforeEach(() => {
		resetRevisionSchemaForTests();
		sql = createTestRevisionSql();
	});

	it("appends spec_review_revise on patch with reason and reviewer", async () => {
		const before = baseSpec({ review_gate: "pending" });
		const after = baseSpec({
			review_gate: "revise",
			status: "blocked",
			etag: "e2",
			updated_at: "2026-06-08T12:01:00.000Z",
		});
		const evaluation = await evaluateSpecRevisionAppend(before, after, {
			revision_reason: "Scope too broad for v1 — trim board UI.",
		}, "patch");
		assert.equal(evaluation.should_append, true);
		assert.equal(evaluation.event, "spec_review_revise");

		const result = await appendRevisionRecordIfNeeded(
			sql,
			"spec",
			before,
			after,
			reviewerFromHolder({ holder_id: "user@example.com", holder_kind: "user" }),
			{ revision_reason: "Scope too broad for v1 — trim board UI." },
			"patch",
		);
		assert.equal(result.ok, true);
		if (result.ok) assert.equal(result.appended, true);
		assert.equal(countRevisionRecords(sql, "spec", "ged-demo"), 1);
	});

	it("rejects revise without required reason", async () => {
		const before = baseSpec({ review_gate: "pending" });
		const after = baseSpec({ review_gate: "revise", etag: "e2", updated_at: "2026-06-08T12:01:00.000Z" });
		const result = await appendRevisionRecordIfNeeded(
			sql,
			"spec",
			before,
			after,
			reviewerFromHolder({ holder_id: "agent-1", holder_kind: "agent" }),
			{},
			"patch",
		);
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.status, 400);
			assert.match(result.error, /revision_reason/);
		}
	});

	it("skips saveSpec body amend without revision_reason", async () => {
		const before = baseSpec({
			review_gate: "passed",
			body: "# Spec v1\n\n## Implementation status\n\n| **Review gate** | passed |\n",
		});
		const after = baseSpec({
			review_gate: "passed",
			body: "# Spec v2\n\n## Implementation status\n\n| **Review gate** | passed |\n",
			etag: "e2",
			updated_at: "2026-06-08T12:01:00.000Z",
		});
		const evaluation = await evaluateSpecRevisionAppend(before, after, {}, "save");
		assert.equal(evaluation.should_append, false);
		assert.equal(countRevisionRecords(sql, "spec", "ged-demo"), 0);
	});

	it("appends plan_review_pass when plan unblocks to ready", async () => {
		const before = basePlan({ status: "blocked" });
		const after = basePlan({
			status: "ready",
			etag: "p2",
			updated_at: "2026-06-08T12:01:00.000Z",
		});
		const evaluation = await evaluatePlanRevisionAppend(before, after, {}, "patch");
		assert.equal(evaluation.should_append, true);
		assert.equal(evaluation.event, "plan_review_pass");

		const result = await appendRevisionRecordIfNeeded(
			sql,
			"plan",
			before,
			after,
			reviewerFromHolder({ holder_id: "user@example.com", holder_kind: "user" }),
			{},
			"patch",
		);
		assert.equal(result.ok, true);
		if (result.ok) assert.equal(result.appended, true);
		assert.equal(countRevisionRecords(sql, "plan", "ged-demo-plan"), 1);
	});

	it("does not append on routine task checkbox progress", async () => {
		const before = basePlan();
		const after = basePlan({
			tasks: [{ id: "t1", title: "Task 1", status: "done" }],
			etag: "p2",
			updated_at: "2026-06-08T12:01:00.000Z",
		});
		const evaluation = await evaluatePlanRevisionAppend(before, after, {}, "patch");
		assert.equal(evaluation.should_append, false);
	});
});
