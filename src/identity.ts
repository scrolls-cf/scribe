/** Headers set by scrollsmatrix gateway from Cloudflare Access JWT. */
export const MATRIX_USER_EMAIL = "x-matrix-user-email";
export const MATRIX_USER_SUB = "x-matrix-user-sub";

export type HolderKind = "user" | "agent";

export interface LockHolder {
	holder_id: string;
	holder_kind: HolderKind;
}

export interface AuthEnv {
	CLOUDFLARE_API_TOKEN?: string;
}

export function parseBearerToken(request: Request): string | null {
	const header = request.headers.get("Authorization")?.trim();
	if (!header) return null;
	const match = header.match(/^Bearer\s+(.+)$/i);
	return match?.[1]?.trim() || null;
}

/**
 * Auth order:
 * 1. Bearer CLOUDFLARE_API_TOKEN (ged stack — same token wrangler uses)
 * 2. CF Access identity headers (scrollsmatrix gateway)
 */
export function resolveLockHolder(request: Request, env: AuthEnv = {}): LockHolder | null {
	const expected = env.CLOUDFLARE_API_TOKEN?.trim();
	if (expected) {
		const bearer = parseBearerToken(request);
		if (bearer && bearer === expected) {
			return { holder_id: "ged-stack", holder_kind: "agent" };
		}
	}

	const email = request.headers.get(MATRIX_USER_EMAIL)?.trim();
	if (email) return { holder_id: email, holder_kind: "user" };

	const sub = request.headers.get(MATRIX_USER_SUB)?.trim();
	if (sub) return { holder_id: sub, holder_kind: "user" };

	return null;
}
