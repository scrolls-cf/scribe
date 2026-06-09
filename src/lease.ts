import type { LockHolder } from "./identity.ts";
import type { SpecLock } from "./spec.ts";
import type { HolderKind } from "./spec.ts";

export const LEASE_PREFIX = "lease:";
export const MIN_LEASE_SECONDS = 300;
export const MAX_LEASE_SECONDS = 86400;
export const DEFAULT_AGENT_LEASE_SECONDS = 14_400;
export const DEFAULT_USER_LEASE_SECONDS = 86_400;

export type LeaseTarget =
	| { kind: "spec"; slug: string }
	| { kind: "plan"; id: string }
	| { kind: "plan-phase"; id: string; phaseId: string };

export interface LeaseEntry {
	target: LeaseTarget;
	expires_at_ms: number;
	acquired_at: string;
	holder_id: string;
	holder_kind: HolderKind;
}

export function leaseStorageKey(target: LeaseTarget): string {
	if (target.kind === "spec") return `${LEASE_PREFIX}spec:${target.slug}`;
	if (target.kind === "plan") return `${LEASE_PREFIX}plan:${target.id}`;
	return `${LEASE_PREFIX}plan-phase:${target.id}:${target.phaseId}`;
}

export function defaultLeaseSeconds(holderKind: HolderKind): number {
	return holderKind === "user" ? DEFAULT_USER_LEASE_SECONDS : DEFAULT_AGENT_LEASE_SECONDS;
}

export function clampLeaseSeconds(seconds: number): number {
	return Math.min(MAX_LEASE_SECONDS, Math.max(MIN_LEASE_SECONDS, Math.floor(seconds)));
}

export function parseLeaseSeconds(
	raw: unknown,
	holderKind: HolderKind,
): { ok: true; value: number } | { ok: false; error: string } {
	if (raw === undefined || raw === null) {
		return { ok: true, value: defaultLeaseSeconds(holderKind) };
	}
	if (typeof raw !== "number" || !Number.isFinite(raw)) {
		return { ok: false, error: "lease_seconds must be a number" };
	}
	if (raw < MIN_LEASE_SECONDS || raw > MAX_LEASE_SECONDS) {
		return {
			ok: false,
			error: `lease_seconds must be between ${MIN_LEASE_SECONDS} and ${MAX_LEASE_SECONDS}`,
		};
	}
	return { ok: true, value: clampLeaseSeconds(raw) };
}

export function parseOptionalLeaseSeconds(raw: unknown, holderKind: HolderKind): number {
	const parsed = parseLeaseSeconds(
		raw && typeof raw === "object" ? (raw as { lease_seconds?: unknown }).lease_seconds : undefined,
		holderKind,
	);
	return parsed.ok ? parsed.value : defaultLeaseSeconds(holderKind);
}

export function lockWithLease(
	holder: LockHolder,
	acquiredAt: string,
	leaseSeconds: number,
	activity?: string,
	sessionId?: string,
): SpecLock {
	const acquiredMs = new Date(acquiredAt).getTime();
	const expiresAt = new Date(acquiredMs + leaseSeconds * 1000).toISOString();
	return {
		agent_id: holder.holder_id,
		acquired_at: acquiredAt,
		holder_kind: holder.holder_kind,
		lease_seconds: leaseSeconds,
		expires_at: expiresAt,
		...(activity ? { activity } : {}),
		...(sessionId ? { session_id: sessionId } : {}),
	};
}

export function dueLeaseEntries(entries: LeaseEntry[], nowMs: number): LeaseEntry[] {
	return entries.filter((e) => e.expires_at_ms <= nowMs);
}

export function nextLeaseExpiryMs(entries: LeaseEntry[]): number | null {
	if (entries.length === 0) return null;
	return Math.min(...entries.map((e) => e.expires_at_ms));
}

export async function listLeaseEntries(
	storage: DurableObjectStorage,
): Promise<LeaseEntry[]> {
	const listed = await storage.list<LeaseEntry>({ prefix: LEASE_PREFIX });
	return [...listed.values()];
}

type LeaseStorageWriter = Pick<DurableObjectStorage, "put">;

/** Persist lease index entry only — pair with syncLeaseAlarm after transactions commit. */
export async function putLeaseEntry(
	storage: LeaseStorageWriter,
	target: LeaseTarget,
	lock: SpecLock,
): Promise<void> {
	if (!lock.expires_at) return;
	const entry: LeaseEntry = {
		target,
		expires_at_ms: new Date(lock.expires_at).getTime(),
		acquired_at: lock.acquired_at,
		holder_id: lock.agent_id,
		holder_kind: lock.holder_kind ?? "agent",
	};
	await storage.put(leaseStorageKey(target), entry);
}

export async function upsertLease(
	storage: DurableObjectStorage,
	target: LeaseTarget,
	lock: SpecLock,
): Promise<void> {
	await putLeaseEntry(storage, target, lock);
	await syncLeaseAlarm(storage);
}

export async function removeLease(
	storage: DurableObjectStorage,
	target: LeaseTarget,
): Promise<void> {
	await storage.delete(leaseStorageKey(target));
	await syncLeaseAlarm(storage);
}

/** Maintain one alarm for the earliest pending lease expiry. */
export async function syncLeaseAlarm(storage: DurableObjectStorage): Promise<void> {
	const entries = await listLeaseEntries(storage);
	const next = nextLeaseExpiryMs(entries);
	if (next === null) {
		await storage.deleteAlarm();
		return;
	}
	const current = await storage.getAlarm();
	if (current === null || next < current) {
		await storage.setAlarm(next);
		return;
	}
	// Reschedule when current alarm is stale (no entry at that time).
	const hasCurrent = entries.some((e) => e.expires_at_ms === current);
	if (!hasCurrent) {
		await storage.setAlarm(next);
	}
}
