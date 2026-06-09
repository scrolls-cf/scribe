import type { LockHolder } from "./identity.ts";
import {
	resolveLockSessionId,
	sameLockPrincipal,
	sessionLockConflict,
} from "./identity.ts";
import { lockWithLease } from "./lease.ts";
import { nextPickablePhase, type PlanPhase, type PlanRecord } from "./plan.ts";
import type { SpecLock, SpecRecord } from "./spec.ts";

export type LockAttempt =
	| { ok: true; spec: SpecRecord }
	| { ok: true; plan: PlanRecord; phaseId: string }
	| { ok: false; error: string; status: number };

export type SpecLockAttempt =
	| { ok: true; spec: SpecRecord }
	| { ok: false; error: string; status: number };

export type PlanPhaseLockAttempt =
	| { ok: true; plan: PlanRecord; phaseId: string }
	| { ok: false; error: string; status: number };

/** In-memory lock decision — caller must commit inside a storage transaction. */
export function tryAcquireSpecLock(
	holder: LockHolder,
	record: SpecRecord,
	leaseSeconds: number,
	activity?: string,
	request?: Request,
	sessionId?: string,
): SpecLockAttempt {
	if (record.lock && !sameLockPrincipal(holder, record.lock, request)) {
		return { ok: false, error: "lock held", status: 409 };
	}
	if (record.lock && sessionLockConflict(record.lock, sessionId)) {
		return { ok: false, error: "lock held by another session", status: 409 };
	}
	const now = new Date().toISOString();
	const lockActivity = activity ?? record.lock?.activity;
	const lockSessionId = resolveLockSessionId(record.lock, sessionId);
	const updated: SpecRecord = {
		...record,
		lock: lockWithLease(holder, now, leaseSeconds, lockActivity, lockSessionId),
		updated_at: now,
		etag: now,
	};
	return { ok: true, spec: updated };
}

/** Re-check lock on stored metadata before commit — prevents agent collision. */
export function specLockStillAvailable(
	stored: SpecRecord,
	holder: LockHolder,
	request?: Request,
	sessionId?: string,
): boolean {
	if (!stored.lock) return true;
	if (!sameLockPrincipal(holder, stored.lock, request)) return false;
	return !sessionLockConflict(stored.lock, sessionId);
}

export function tryAcquirePlanPhaseLock(
	holder: LockHolder,
	record: PlanRecord,
	phaseId: string,
	leaseSeconds: number,
	activity?: string,
	request?: Request,
	sessionId?: string,
): PlanPhaseLockAttempt {
	const phase = record.phases.find((p) => p.id === phaseId);
	if (!phase) return { ok: false, error: "phase not found", status: 404 };
	if (phase.lock) {
		if (!sameLockPrincipal(holder, phase.lock, request)) {
			return { ok: false, error: "lock held", status: 409 };
		}
		if (sessionLockConflict(phase.lock, sessionId)) {
			return { ok: false, error: "lock held by another session", status: 409 };
		}
	} else {
		const pickable = nextPickablePhase(record);
		if (!pickable || pickable.id !== phaseId) {
			return { ok: false, error: "phase not available", status: 409 };
		}
	}
	const now = new Date().toISOString();
	const lockActivity = activity ?? phase.lock?.activity;
	const lockSessionId = resolveLockSessionId(phase.lock, sessionId);
	const phaseLock = lockWithLease(holder, now, leaseSeconds, lockActivity, lockSessionId);
	const phases = record.phases.map((p) =>
		p.id === phaseId
			? {
					...p,
					lock: phaseLock,
					status: p.status === "pending" ? ("active" as PlanPhase["status"]) : p.status,
				}
			: p,
	);
	return {
		ok: true,
		plan: {
			...record,
			phases,
			status: record.status === "ready" ? "in_progress" : record.status,
			updated_at: now,
		},
		phaseId,
	};
}

export function planPhaseLockStillAvailable(
	stored: PlanRecord,
	phaseId: string,
	holder: LockHolder,
	request?: Request,
	sessionId?: string,
): boolean {
	const phase = stored.phases.find((p) => p.id === phaseId);
	if (!phase) return false;
	if (!phase.lock) {
		const pickable = nextPickablePhase(stored);
		return pickable?.id === phaseId;
	}
	if (!sameLockPrincipal(holder, phase.lock, request)) return false;
	return !sessionLockConflict(phase.lock, sessionId);
}
