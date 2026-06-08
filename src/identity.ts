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

export function holderLabel(lock: { agent_id: string; holder_kind?: HolderKind }): string {
	if (lock.holder_kind === "user") return lock.agent_id;
	return lock.agent_id;
}
