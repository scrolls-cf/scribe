export interface ErrorRecord {
	id: string;
	message: string;
	source: string;
	created_at: string;
	resolved_at: string | null;
}

export const ERROR_INDEX_KEY = "error:index";

export function errorKey(id: string): string {
	return `error:${id}`;
}

function newErrorId(): string {
	return `err-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function parseCreateErrorInput(
	raw: unknown,
): { ok: true; value: ErrorRecord } | { ok: false; error: string } {
	if (!raw || typeof raw !== "object") {
		return { ok: false, error: "error must be a JSON object" };
	}
	const m = raw as Record<string, unknown>;
	const message = typeof m.message === "string" ? m.message.trim() : "";
	const source = typeof m.source === "string" ? m.source.trim() : "";
	if (!message) return { ok: false, error: "message is required" };
	if (!source) return { ok: false, error: "source is required" };
	const now = new Date().toISOString();
	return {
		ok: true,
		value: {
			id: newErrorId(),
			message,
			source,
			created_at: now,
			resolved_at: null,
		},
	};
}

export function parseResolveErrorInput(
	raw: unknown,
): { ok: true; value: { resolved: boolean } } | { ok: false; error: string } {
	if (!raw || typeof raw !== "object") {
		return { ok: true, value: { resolved: true } };
	}
	const resolved = (raw as { resolved?: unknown }).resolved;
	if (resolved === false) return { ok: true, value: { resolved: false } };
	return { ok: true, value: { resolved: true } };
}
