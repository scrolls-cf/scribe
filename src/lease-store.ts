import type { RevisionSql } from "./revision-record.ts";
import {
	LEASE_PREFIX,
	type LeaseEntry,
	type LeaseTarget,
	leaseStorageKey,
} from "./lease.ts";
import type { HolderKind } from "./spec.ts";

export const LEASES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS leases (
  target_key TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('spec', 'plan', 'plan-phase')),
  target_id TEXT NOT NULL,
  phase_id TEXT,
  expires_at_ms INTEGER NOT NULL,
  acquired_at TEXT NOT NULL,
  holder_id TEXT NOT NULL,
  holder_kind TEXT NOT NULL CHECK (holder_kind IN ('user', 'agent'))
);
CREATE INDEX IF NOT EXISTS idx_leases_expires ON leases (expires_at_ms);
`;

type LeaseRow = {
	target_key: string;
	target_kind: string;
	target_id: string;
	phase_id: string | null;
	expires_at_ms: number;
	acquired_at: string;
	holder_id: string;
	holder_kind: string;
};

function leaseSchemaReady(sql: RevisionSql): boolean {
	const tables = sql
		.exec<{ name: string }>(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'leases'",
		)
		.toArray();
	return tables.length > 0;
}

/** Idempotent — call once from DO constructor via blockConcurrencyWhile. */
export function initLeaseSchema(sql: RevisionSql): void {
	if (leaseSchemaReady(sql)) return;
	sql.exec(LEASES_TABLE_SQL);
}

function targetFromRow(row: LeaseRow): LeaseTarget {
	if (row.target_kind === "spec") return { kind: "spec", slug: row.target_id };
	if (row.target_kind === "plan") return { kind: "plan", id: row.target_id };
	return {
		kind: "plan-phase",
		id: row.target_id,
		phaseId: row.phase_id ?? "",
	};
}

function rowToEntry(row: LeaseRow): LeaseEntry {
	return {
		target: targetFromRow(row),
		expires_at_ms: Number(row.expires_at_ms),
		acquired_at: row.acquired_at,
		holder_id: row.holder_id,
		holder_kind: row.holder_kind as HolderKind,
	};
}

function targetToRowFields(target: LeaseTarget): {
	target_kind: string;
	target_id: string;
	phase_id: string | null;
} {
	if (target.kind === "spec") {
		return { target_kind: "spec", target_id: target.slug, phase_id: null };
	}
	if (target.kind === "plan") {
		return { target_kind: "plan", target_id: target.id, phase_id: null };
	}
	return {
		target_kind: "plan-phase",
		target_id: target.id,
		phase_id: target.phaseId,
	};
}

export function listLeaseEntriesSql(sql: RevisionSql): LeaseEntry[] {
	initLeaseSchema(sql);
	const rows = sql.exec<LeaseRow>("SELECT * FROM leases ORDER BY expires_at_ms ASC").toArray();
	return rows.map(rowToEntry);
}

export function upsertLeaseEntrySql(sql: RevisionSql, target: LeaseTarget, entry: LeaseEntry): void {
	initLeaseSchema(sql);
	const key = leaseStorageKey(target);
	const fields = targetToRowFields(target);
	sql.exec(
		`INSERT INTO leases (
      target_key, target_kind, target_id, phase_id,
      expires_at_ms, acquired_at, holder_id, holder_kind
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(target_key) DO UPDATE SET
      expires_at_ms = excluded.expires_at_ms,
      acquired_at = excluded.acquired_at,
      holder_id = excluded.holder_id,
      holder_kind = excluded.holder_kind`,
		key,
		fields.target_kind,
		fields.target_id,
		fields.phase_id,
		entry.expires_at_ms,
		entry.acquired_at,
		entry.holder_id,
		entry.holder_kind,
	);
}

export function deleteLeaseEntrySql(sql: RevisionSql, target: LeaseTarget): void {
	initLeaseSchema(sql);
	sql.exec("DELETE FROM leases WHERE target_key = ?", leaseStorageKey(target));
}

/** One-time migration from legacy KV lease:index keys. */
export async function migrateKvLeasesToSql(
	storage: DurableObjectStorage,
	sql: RevisionSql,
): Promise<number> {
	initLeaseSchema(sql);
	const listed = await storage.list<LeaseEntry>({ prefix: LEASE_PREFIX });
	let migrated = 0;
	for (const [, entry] of listed) {
		if (!entry?.target) continue;
		upsertLeaseEntrySql(sql, entry.target, entry);
		await storage.delete(leaseStorageKey(entry.target));
		migrated++;
	}
	return migrated;
}
