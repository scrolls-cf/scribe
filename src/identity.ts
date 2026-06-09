/** Headers set by scrollsmatrix gateway from Cloudflare Access JWT. */
export const MATRIX_USER_EMAIL = "x-matrix-user-email";
export const MATRIX_USER_SUB = "x-matrix-user-sub";

export type HolderKind = "user" | "agent";

export interface LockHolder {
	/** Email, Access sub, or agent id. */
	holder_id: string;
	holder_kind: HolderKind;
}

export function resolveLockHolder(
	request: Request,
	bodyAgentId?: string,
): LockHolder | null {
	const email = request.headers.get(MATRIX_USER_EMAIL)?.trim();
	if (email) return { holder_id: email, holder_kind: "user" };

	const sub = request.headers.get(MATRIX_USER_SUB)?.trim();
	if (sub) return { holder_id: sub, holder_kind: "user" };

	const agentId = bodyAgentId?.trim();
	if (agentId) return { holder_id: agentId, holder_kind: "agent" };

	return null;
}

export function lockFromHolder(holder: LockHolder, acquiredAt: string) {
	return {
		agent_id: holder.holder_id,
		acquired_at: acquiredAt,
		holder_kind: holder.holder_kind,
	};
}

export interface LockPrincipal {
	agent_id: string;
	holder_kind?: HolderKind;
}

/** Whether request holder may acquire, renew, or release the existing lock. */
export function sameLockPrincipal(
	holder: LockHolder,
	lock: LockPrincipal,
	request?: Request,
): boolean {
	const lockKind = lock.holder_kind;

	if (holder.holder_kind === "agent") {
		return lockKind === "agent" && holder.holder_id === lock.agent_id;
	}

	if (lockKind === "agent") return false;

	if (holder.holder_id === lock.agent_id) return true;

	const sub = request?.headers.get(MATRIX_USER_SUB)?.trim();
	if (sub && lock.agent_id === sub) return true;

	return false;
}

export function holderLabel(lock: { agent_id: string; holder_kind?: HolderKind }): string {
	if (lock.holder_kind === "user") return lock.agent_id;
	return lock.agent_id;
}

/**
 * True when an existing lock is bound to a different ged/Cursor session.
 * Board renews (no incoming session_id) never conflict.
 */
export function sessionLockConflict(
	existing: { session_id?: string } | null | undefined,
	incomingSessionId: string | undefined,
): boolean {
	if (!existing?.session_id) return false;
	if (!incomingSessionId) return false;
	return existing.session_id !== incomingSessionId;
}

/** Session id to store on acquire — adopt incoming or keep existing on renew. */
export function resolveLockSessionId(
	existing: { session_id?: string } | null | undefined,
	incomingSessionId: string | undefined,
): string | undefined {
	if (incomingSessionId) return incomingSessionId;
	return existing?.session_id;
}
