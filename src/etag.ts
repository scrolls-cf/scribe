/** Etag value for optimistic concurrency (edge #28 / step 10). */
export function recordEtag(updatedAt: string): string {
	return updatedAt;
}

/** @param {string | null | undefined} header */
export function normalizeEtagToken(header: string | null | undefined): string | null {
	if (!header) return null;
	const trimmed = header.trim();
	if (!trimmed || trimmed === "*") return null;
	return trimmed.replace(/^W\//, "").replace(/^"|"$/g, "");
}

/**
 * When client sends If-Match or body etag, require match; otherwise allow (backfill).
 */
export function etagConflict(
	recordEtagValue: string,
	request: Request,
	bodyEtag?: string | null,
): boolean {
	const ifMatch = normalizeEtagToken(request.headers.get("If-Match"));
	const bodyToken = normalizeEtagToken(bodyEtag ?? null);
	const provided = ifMatch ?? bodyToken;
	if (!provided) return false;
	return provided !== recordEtagValue;
}

export function etagResponseHeaders(etag: string): HeadersInit {
	return { etag: `"${etag}"` };
}
