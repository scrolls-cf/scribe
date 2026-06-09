import type { HolderKind, LockHolder } from "./identity.ts";
import { parseSpecFooterFields } from "./spec-footer.ts";
import type { PlanRecord } from "./plan.ts";
import type { SpecRecord } from "./spec.ts";
import { sha256Hex } from "./revision.ts";

export type RevisionTargetKind = "spec" | "plan";

export type RevisionEvent =
	| "spec_review_revise"
	| "spec_review_resubmit"
	| "spec_review_pass"
	| "spec_body_amend"
	| "plan_review_revise"
	| "plan_review_pass"
	| "plan_amend"
	| "post_ship_amend";

export const REVISION_EVENTS: readonly RevisionEvent[] = [
	"spec_review_revise",
	"spec_review_resubmit",
	"spec_review_pass",
	"spec_body_amend",
	"plan_review_revise",
	"plan_review_pass",
	"plan_amend",
	"post_ship_amend",
] as const;

export const MAX_REVISION_ROWS = 200;
export const DEFAULT_REVISION_LIST_LIMIT = 20;
export const DEFAULT_REVISION_PREVIEW = 3;
export const REVISION_REASON_MIN_LEN = 10;
export const REVISION_REASON_MAX_LEN = 4000;
export const REVISION_UNIFIED_DIFF_MAX_BYTES = 8 * 1024;
export const REVISION_BODY_EXCERPT_LEN = 500;

export interface RevisionReviewer {
	holder_id: string;
	holder_kind: HolderKind;
}

export interface RevisionSnapshot {
	etag: string;
	status: string;
	active_phase?: string | null;
	footer_review_gate?: string | null;
	footer_plan_review?: string | null;
	body_sha256: string;
	body_excerpt: string;
	phases_summary: { done: number; total: number };
	title: string;
}

export interface RevisionStatusChange {
	from: string;
	to: string;
}

export interface RevisionDiff {
	body_changed: boolean;
	status_changed: RevisionStatusChange | null;
	phases_changed: boolean;
	footer_fields_changed: string[];
	unified_diff?: string;
}

export interface RevisionRecord {
	id: string;
	target_kind: RevisionTargetKind;
	target_id: string;
	event: RevisionEvent;
	reason: string;
	reviewer: RevisionReviewer;
	created_at: string;
	before: RevisionSnapshot;
	after: RevisionSnapshot;
	diff?: RevisionDiff | null;
}

export interface RevisionSummaryEntry {
	id: string;
	event: RevisionEvent;
	reason: string;
	reviewer: RevisionReviewer;
	created_at: string;
	before: Pick<RevisionSnapshot, "footer_review_gate" | "footer_plan_review" | "status">;
	after: Pick<RevisionSnapshot, "footer_review_gate" | "footer_plan_review" | "status">;
}

export interface RevisionsSummary {
	count: number;
	latest: RevisionSummaryEntry[];
}

export type RevisionSqlValue = string | number | null | ArrayBuffer;

export interface RevisionSqlCursor<
	T extends Record<string, RevisionSqlValue> = Record<string, RevisionSqlValue>,
> extends Iterable<T> {
	toArray(): T[];
	one(): T;
}

/** Minimal SqlStorage surface — compatible with `ctx.storage.sql` on SQLite DOs. */
export interface RevisionSql {
	exec<T extends Record<string, RevisionSqlValue>>(
		query: string,
		...bindings: RevisionSqlValue[]
	): RevisionSqlCursor<T>;
}

export const REVISIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('spec', 'plan')),
  target_id TEXT NOT NULL,
  event TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  reviewer_id TEXT NOT NULL,
  reviewer_kind TEXT NOT NULL CHECK (reviewer_kind IN ('user', 'agent')),
  created_at TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  diff_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_revisions_target
  ON revisions (target_kind, target_id, created_at DESC);
`;

type RevisionRow = Record<string, RevisionSqlValue> & {
	id: string;
	target_kind: string;
	target_id: string;
	event: string;
	reason: string;
	reviewer_id: string;
	reviewer_kind: string;
	created_at: string;
	before_json: string;
	after_json: string;
	diff_json: string | null;
};

const REASON_REQUIRED_EVENTS = new Set<RevisionEvent>([
	"spec_review_revise",
	"plan_review_revise",
	"post_ship_amend",
]);

export function revisionReasonRequired(event: RevisionEvent): boolean {
	return REASON_REQUIRED_EVENTS.has(event);
}

export function validateRevisionReason(
	event: RevisionEvent,
	reason: string,
): { ok: true } | { ok: false; error: string } {
	const trimmed = reason.trim();
	if (!revisionReasonRequired(event)) return { ok: true };
	if (trimmed.length < REVISION_REASON_MIN_LEN) {
		return {
			ok: false,
			error: `revision_reason required (min ${REVISION_REASON_MIN_LEN} chars) for ${event}`,
		};
	}
	if (trimmed.length > REVISION_REASON_MAX_LEN) {
		return {
			ok: false,
			error: `revision_reason exceeds ${REVISION_REASON_MAX_LEN} chars`,
		};
	}
	return { ok: true };
}

export function newRevisionId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	return `rev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function reviewerFromHolder(holder: LockHolder): RevisionReviewer {
	return { holder_id: holder.holder_id, holder_kind: holder.holder_kind };
}

export function truncateRevisionText(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.slice(0, maxLen);
}

export function capUnifiedDiff(diff: string | undefined): string | undefined {
	if (!diff) return undefined;
	const bytes = new TextEncoder().encode(diff);
	if (bytes.byteLength <= REVISION_UNIFIED_DIFF_MAX_BYTES) return diff;
	let end = diff.length;
	while (end > 0 && new TextEncoder().encode(diff.slice(0, end)).byteLength > REVISION_UNIFIED_DIFF_MAX_BYTES) {
		end -= 1;
	}
	return diff.slice(0, end);
}

export async function bodyExcerpt(body: string): Promise<{ sha256: string; excerpt: string }> {
	const sha256 = await sha256Hex(body);
	return {
		sha256,
		excerpt: truncateRevisionText(body, REVISION_BODY_EXCERPT_LEN),
	};
}

function phasesSummary(phases: { status: string }[]): { done: number; total: number } {
	const total = phases.length;
	const done = phases.filter((p) => p.status === "done").length;
	return { done, total };
}

export function isShippedFooter(body: string): boolean {
	const section = body.match(/## Implementation status[\s\S]*?(?=\n## |$)/i)?.[0] ?? "";
	const table = section.match(/\|\s*\*\*Status\*\*\s*\|\s*([^|\n]+)/i)?.[1]?.trim().toLowerCase();
	if (table === "shipped") return true;
	return /^\*\*Shipped\*\*$/im.test(section.trim());
}

export interface RevisionAppendInput {
	revision_reason?: string;
	revision_event?: RevisionEvent;
}

export function parseRevisionAppendInput(raw: Record<string, unknown>): RevisionAppendInput {
	const revision_reason =
		typeof raw.revision_reason === "string" ? raw.revision_reason : undefined;
	const revision_event =
		typeof raw.revision_event === "string" &&
		REVISION_EVENTS.includes(raw.revision_event as RevisionEvent)
			? (raw.revision_event as RevisionEvent)
			: undefined;
	return { revision_reason, revision_event };
}

export type RevisionHandler = "save" | "patch";

export async function buildSpecRevisionSnapshot(record: SpecRecord): Promise<RevisionSnapshot> {
	const footer = parseSpecFooterFields(record.body);
	const { sha256, excerpt } = await bodyExcerpt(record.body);
	return {
		etag: record.etag,
		status: record.status,
		active_phase: record.active_phase,
		footer_review_gate: record.review_gate ?? footer.review_gate,
		footer_plan_review: record.plan_review ?? footer.plan_review,
		body_sha256: sha256,
		body_excerpt: excerpt,
		phases_summary: phasesSummary(record.phases),
		title: record.title,
	};
}

export async function buildPlanRevisionSnapshot(record: PlanRecord): Promise<RevisionSnapshot> {
	const footer = parseSpecFooterFields(record.body);
	const { sha256, excerpt } = await bodyExcerpt(record.body);
	return {
		etag: record.etag,
		status: record.status,
		footer_plan_review: footer.plan_review,
		body_sha256: sha256,
		body_excerpt: excerpt,
		phases_summary: phasesSummary(record.phases),
		title: record.title,
	};
}

export function computeRevisionDiff(
	before: RevisionSnapshot,
	after: RevisionSnapshot,
	opts?: { unified_diff?: string },
): RevisionDiff {
	const footerFields: string[] = [];
	if (before.footer_review_gate !== after.footer_review_gate) footerFields.push("Review gate");
	if (before.footer_plan_review !== after.footer_plan_review) footerFields.push("Plan review");
	if (before.active_phase !== after.active_phase) footerFields.push("Active phase");

	return {
		body_changed: before.body_sha256 !== after.body_sha256,
		status_changed:
			before.status !== after.status ? { from: before.status, to: after.status } : null,
		phases_changed:
			before.phases_summary.done !== after.phases_summary.done ||
			before.phases_summary.total !== after.phases_summary.total,
		footer_fields_changed: footerFields,
		unified_diff: capUnifiedDiff(opts?.unified_diff),
	};
}

export function toRevisionSummaryEntry(record: RevisionRecord): RevisionSummaryEntry {
	return {
		id: record.id,
		event: record.event,
		reason: record.reason,
		reviewer: record.reviewer,
		created_at: record.created_at,
		before: {
			footer_review_gate: record.before.footer_review_gate ?? null,
			footer_plan_review: record.before.footer_plan_review ?? null,
			status: record.before.status,
		},
		after: {
			footer_review_gate: record.after.footer_review_gate ?? null,
			footer_plan_review: record.after.footer_plan_review ?? null,
			status: record.after.status,
		},
	};
}

function rowToRevisionRecord(row: RevisionRow): RevisionRecord {
	return {
		id: row.id,
		target_kind: row.target_kind as RevisionTargetKind,
		target_id: row.target_id,
		event: row.event as RevisionEvent,
		reason: row.reason,
		reviewer: {
			holder_id: row.reviewer_id,
			holder_kind: row.reviewer_kind as HolderKind,
		},
		created_at: row.created_at,
		before: JSON.parse(row.before_json) as RevisionSnapshot,
		after: JSON.parse(row.after_json) as RevisionSnapshot,
		diff: row.diff_json ? (JSON.parse(row.diff_json) as RevisionDiff) : null,
	};
}

const REVISION_SCHEMA_VERSION = 1;

function readRevisionSchemaVersion(sql: RevisionSql): number {
	try {
		return sql.exec<{ user_version: number }>("PRAGMA user_version").one().user_version;
	} catch {
		const tables = sql
			.exec<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'revisions'",
			)
			.toArray();
		return tables.length > 0 ? REVISION_SCHEMA_VERSION : 0;
	}
}

function writeRevisionSchemaVersion(sql: RevisionSql, version: number): void {
	try {
		sql.exec(`PRAGMA user_version = ${version}`);
	} catch {
		/* test shims without PRAGMA writes — table presence is the guard */
	}
}

/** Idempotent SQLite migration — safe in DO constructor or first write. */
export function initRevisionSchema(sql: RevisionSql): void {
	const version = readRevisionSchemaVersion(sql);
	if (version >= REVISION_SCHEMA_VERSION) return;
	if (version < 1) {
		sql.exec(REVISIONS_TABLE_SQL);
		writeRevisionSchemaVersion(sql, 1);
	}
}

/** @deprecated Tests use fresh in-memory DBs; kept for hook compatibility. */
export function resetRevisionSchemaForTests(): void {
	/* PRAGMA user_version is per-database; no module-global state. */
}

export function insertRevisionRecord(sql: RevisionSql, record: RevisionRecord): void {
	initRevisionSchema(sql);
	const diffJson = record.diff ? JSON.stringify(record.diff) : null;
	sql.exec(
		`INSERT INTO revisions (
      id, target_kind, target_id, event, reason,
      reviewer_id, reviewer_kind, created_at,
      before_json, after_json, diff_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		record.id,
		record.target_kind,
		record.target_id,
		record.event,
		record.reason,
		record.reviewer.holder_id,
		record.reviewer.holder_kind,
		record.created_at,
		JSON.stringify(record.before),
		JSON.stringify(record.after),
		diffJson,
	);
	pruneRevisionRecords(sql, record.target_kind, record.target_id, MAX_REVISION_ROWS);
}

export function getRevisionRecord(sql: RevisionSql, id: string): RevisionRecord | null {
	initRevisionSchema(sql);
	const rows = sql
		.exec<RevisionRow>("SELECT * FROM revisions WHERE id = ?", id)
		.toArray();
	return rows[0] ? rowToRevisionRecord(rows[0]) : null;
}

export function countRevisionRecords(
	sql: RevisionSql,
	targetKind: RevisionTargetKind,
	targetId: string,
): number {
	initRevisionSchema(sql);
	const row = sql
		.exec<{ n: number }>(
			"SELECT COUNT(*) AS n FROM revisions WHERE target_kind = ? AND target_id = ?",
			targetKind,
			targetId,
		)
		.one();
	return Number(row.n);
}

export function listRevisionRecords(
	sql: RevisionSql,
	targetKind: RevisionTargetKind,
	targetId: string,
	limit = 20,
	offset = 0,
): { revisions: RevisionRecord[]; total: number } {
	initRevisionSchema(sql);
	const total = countRevisionRecords(sql, targetKind, targetId);
	const cappedLimit = Math.min(Math.max(limit, 1), MAX_REVISION_ROWS);
	const safeOffset = Math.max(offset, 0);
	const rows = sql
		.exec<RevisionRow>(
			`SELECT * FROM revisions
       WHERE target_kind = ? AND target_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
			targetKind,
			targetId,
			cappedLimit,
			safeOffset,
		)
		.toArray();
	return { revisions: rows.map(rowToRevisionRecord), total };
}

export function parseRevisionListLimit(raw: string | null): number {
	if (!raw) return DEFAULT_REVISION_LIST_LIMIT;
	const n = Number.parseInt(raw, 10);
	if (Number.isNaN(n)) return DEFAULT_REVISION_LIST_LIMIT;
	return Math.min(Math.max(n, 1), MAX_REVISION_ROWS);
}

export function parseRevisionOffset(raw: string | null): number {
	if (!raw) return 0;
	const n = Number.parseInt(raw, 10);
	if (Number.isNaN(n) || n < 0) return 0;
	return n;
}

export function parseRevisionPreview(raw: string | null): number {
	if (!raw) return DEFAULT_REVISION_PREVIEW;
	const n = Number.parseInt(raw, 10);
	if (Number.isNaN(n)) return DEFAULT_REVISION_PREVIEW;
	return Math.min(Math.max(n, 0), MAX_REVISION_ROWS);
}

export function loadRevisionsSummary(
	sql: RevisionSql,
	targetKind: RevisionTargetKind,
	targetId: string,
	preview = DEFAULT_REVISION_PREVIEW,
): RevisionsSummary {
	const { revisions, total } = listRevisionRecords(sql, targetKind, targetId, preview, 0);
	return {
		count: total,
		latest: revisions.map(toRevisionSummaryEntry),
	};
}

export function planStructureChanged(before: PlanRecord, after: PlanRecord): boolean {
	if (before.body !== after.body) return true;
	if (before.phases.length !== after.phases.length) return true;
	if (before.tasks.length !== after.tasks.length) return true;
	for (const phase of after.phases) {
		const prev = before.phases.find((p) => p.id === phase.id);
		if (!prev) return true;
		if (prev.index !== phase.index || prev.title !== phase.title || prev.body !== phase.body) {
			return true;
		}
	}
	for (const task of after.tasks) {
		const prev = before.tasks.find((t) => t.id === task.id);
		if (!prev) return true;
		if (prev.title !== task.title) return true;
	}
	return false;
}

export function inferSpecRevisionEvent(
	before: RevisionSnapshot,
	after: RevisionSnapshot,
	beforeBody: string,
	afterBody: string,
	explicit?: RevisionEvent,
): RevisionEvent | null {
	if (explicit) return explicit;

	if (isShippedFooter(afterBody) && before.body_sha256 !== after.body_sha256) {
		return "post_ship_amend";
	}

	const bg = before.footer_review_gate;
	const ag = after.footer_review_gate;

	if (ag === "revise" && bg !== "revise") return "spec_review_revise";
	if (ag === "pending" && bg === "revise") return "spec_review_resubmit";
	if (ag === "passed" && bg !== "passed") return "spec_review_pass";

	if (before.body_sha256 !== after.body_sha256 && bg === "passed") {
		return "spec_body_amend";
	}

	return null;
}

export function inferPlanRevisionEvent(
	before: RevisionSnapshot,
	after: RevisionSnapshot,
	beforePlan: PlanRecord,
	afterPlan: PlanRecord,
	explicit?: RevisionEvent,
): RevisionEvent | null {
	if (explicit) return explicit;

	const bp = before.footer_plan_review;
	const ap = after.footer_plan_review;

	if (ap === "revise" && bp !== "revise") return "plan_review_revise";
	if (afterPlan.status === "blocked" && beforePlan.status !== "blocked" && ap === "revise") {
		return "plan_review_revise";
	}
	if (afterPlan.status === "ready" && beforePlan.status === "blocked") return "plan_review_pass";

	if (beforePlan.status === "ready") {
		if (before.body_sha256 !== after.body_sha256) return "plan_amend";
		if (planStructureChanged(beforePlan, afterPlan)) return "plan_amend";
	}

	return null;
}

export async function evaluateSpecRevisionAppend(
	before: SpecRecord,
	after: SpecRecord,
	input: RevisionAppendInput,
	handler: RevisionHandler,
): Promise<{ should_append: boolean; event?: RevisionEvent }> {
	const beforeSnap = await buildSpecRevisionSnapshot(before);
	const afterSnap = await buildSpecRevisionSnapshot(after);
	const event = inferSpecRevisionEvent(
		beforeSnap,
		afterSnap,
		before.body,
		after.body,
		input.revision_event,
	);
	if (!event) return { should_append: false };

	if (handler === "save") {
		if (event === "spec_body_amend" && !input.revision_reason?.trim()) {
			return { should_append: false };
		}
	}

	return { should_append: true, event };
}

export async function evaluatePlanRevisionAppend(
	before: PlanRecord,
	after: PlanRecord,
	input: RevisionAppendInput,
	handler: RevisionHandler,
): Promise<{ should_append: boolean; event?: RevisionEvent }> {
	const beforeSnap = await buildPlanRevisionSnapshot(before);
	const afterSnap = await buildPlanRevisionSnapshot(after);
	let event = inferPlanRevisionEvent(
		beforeSnap,
		afterSnap,
		before,
		after,
		input.revision_event,
	);

	if (!event && handler === "save" && before.status === "ready") {
		if (beforeSnap.body_sha256 !== afterSnap.body_sha256) {
			event = "plan_amend";
		}
	}

	if (!event) return { should_append: false };
	return { should_append: true, event };
}

export type RevisionAppendResult =
	| { ok: true; appended: boolean }
	| { ok: false; error: string; status: number };

export async function appendRevisionRecordIfNeeded(
	sql: RevisionSql,
	targetKind: RevisionTargetKind,
	before: SpecRecord | PlanRecord,
	after: SpecRecord | PlanRecord,
	reviewer: RevisionReviewer | null,
	input: RevisionAppendInput,
	handler: RevisionHandler,
): Promise<RevisionAppendResult> {
	const evaluation =
		targetKind === "spec"
			? await evaluateSpecRevisionAppend(
					before as SpecRecord,
					after as SpecRecord,
					input,
					handler,
				)
			: await evaluatePlanRevisionAppend(
					before as PlanRecord,
					after as PlanRecord,
					input,
					handler,
				);

	if (!evaluation.should_append || !evaluation.event) {
		return { ok: true, appended: false };
	}

	const reason = input.revision_reason?.trim() ?? "";
	const validation = validateRevisionReason(evaluation.event, reason);
	if (!validation.ok) {
		return { ok: false, error: validation.error, status: 400 };
	}

	if (!reviewer) {
		return { ok: false, error: "reviewer identity required", status: 400 };
	}

	const beforeSnap =
		targetKind === "spec"
			? await buildSpecRevisionSnapshot(before as SpecRecord)
			: await buildPlanRevisionSnapshot(before as PlanRecord);
	const afterSnap =
		targetKind === "spec"
			? await buildSpecRevisionSnapshot(after as SpecRecord)
			: await buildPlanRevisionSnapshot(after as PlanRecord);
	const diff = computeRevisionDiff(beforeSnap, afterSnap);
	const targetId =
		targetKind === "spec" ? (before as SpecRecord).slug : (before as PlanRecord).id;

	const record: RevisionRecord = {
		id: newRevisionId(),
		target_kind: targetKind,
		target_id: targetId,
		event: evaluation.event,
		reason,
		reviewer,
		created_at: after.updated_at,
		before: beforeSnap,
		after: afterSnap,
		diff,
	};

	insertRevisionRecord(sql, record);
	return { ok: true, appended: true };
}

export function pruneRevisionRecords(
	sql: RevisionSql,
	targetKind: RevisionTargetKind,
	targetId: string,
	cap = MAX_REVISION_ROWS,
): number {
	initRevisionSchema(sql);
	const total = countRevisionRecords(sql, targetKind, targetId);
	const excess = total - cap;
	if (excess <= 0) return 0;
	sql.exec(
		`DELETE FROM revisions WHERE id IN (
      SELECT id FROM revisions
      WHERE target_kind = ? AND target_id = ?
      ORDER BY created_at ASC
      LIMIT ?
    )`,
		targetKind,
		targetId,
		excess,
	);
	return excess;
}
