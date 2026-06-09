/** Headers set by scrollsmatrix gateway from verified CF Access JWT. */
export const MATRIX_USER_EMAIL = "x-matrix-user-email";
export const MATRIX_USER_SUB = "x-matrix-user-sub";

export type HolderKind = "user" | "agent";

export interface LockHolder {
	holder_id: string;
	holder_kind: HolderKind;
}

function isLocalDev(hostname: string): boolean {
	const h = hostname.toLowerCase();
	return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

/**
 * Auth: CF Access identity forwarded by scrollsmatrix (human or service token).
 * Local wrangler dev: allow without Access.
 */
export function resolveLockHolder(request: Request): LockHolder | null {
	const url = new URL(request.url);
	if (isLocalDev(url.hostname)) {
		return { holder_id: "local-dev", holder_kind: "agent" };
	}

	const email = request.headers.get(MATRIX_USER_EMAIL)?.trim();
	if (email) return { holder_id: email, holder_kind: "user" };

	const sub = request.headers.get(MATRIX_USER_SUB)?.trim();
	if (sub) return { holder_id: sub, holder_kind: "agent" };

	return null;
}
