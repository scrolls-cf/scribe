export interface AuthEnv {
	INGEST_API_KEY?: string;
}

export function authorizeWrite(request: Request, env: AuthEnv): Response | null {
	const expected = env.INGEST_API_KEY?.trim();
	if (!expected) return null;

	const header = request.headers.get("Authorization")?.trim() ?? "";
	const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
	if (!token || token !== expected) {
		return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
	}

	return null;
}
