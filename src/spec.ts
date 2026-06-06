export type SpecStatus = "ready" | "in_progress" | "blocked" | "done";
export type PhaseStatus = "pending" | "active" | "done";

export interface SpecPhase {
	id: string;
	title: string;
	status: PhaseStatus;
}

export interface SpecLock {
	agent_id: string;
	acquired_at: string;
}

export interface SpecRecord {
	slug: string;
	title: string;
	body: string;
	source?: string;
	status: SpecStatus;
	phases: SpecPhase[];
	lock: SpecLock | null;
	created_at: string;
	updated_at: string;
}

export interface SpecSummary {
	slug: string;
	title: string;
	source?: string;
	status: SpecStatus;
	updated_at: string;
	phases_done: number;
	phases_total: number;
	lock: SpecLock | null;
}

const SLUG_RE = /^[a-z][a-z0-9-]*$/;
const ID_RE = /^[a-z][a-z0-9-]*$/;
const STATUSES: SpecStatus[] = ["ready", "in_progress", "blocked", "done"];
const PHASE_STATUSES: PhaseStatus[] = ["pending", "active", "done"];

export const SPEC_INDEX_KEY = "spec:index";

export function specKey(slug: string): string {
	return `spec:${slug}`;
}

export function normalizeSpecRecord(raw: SpecRecord | (Omit<SpecRecord, "status" | "phases" | "lock"> & Partial<Pick<SpecRecord, "status" | "phases" | "lock">>)): SpecRecord {
	return {
		...raw,
		status: raw.status ?? "ready",
		phases: Array.isArray(raw.phases) ? raw.phases : [],
		lock: raw.lock ?? null,
		created_at: raw.created_at ?? raw.updated_at,
	};
}

export function toSpecSummary(record: SpecRecord): SpecSummary {
	const phases_done = record.phases.filter((p) => p.status === "done").length;
	return {
		slug: record.slug,
		title: record.title,
		source: record.source,
		status: record.status,
		updated_at: record.updated_at,
		phases_done,
		phases_total: record.phases.length,
		lock: record.lock,
	};
}

export function parsePhases(raw: unknown): SpecPhase[] | null {
	if (!Array.isArray(raw)) return [];
	const phases: SpecPhase[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") return null;
		const p = item as SpecPhase;
		const id = typeof p.id === "string" ? p.id.trim() : "";
		const title = typeof p.title === "string" ? p.title.trim() : "";
		const status = typeof p.status === "string" ? p.status.trim() : "";
		if (!id || !ID_RE.test(id) || !title) return null;
		if (!PHASE_STATUSES.includes(status as PhaseStatus)) return null;
		phases.push({ id, title, status: status as PhaseStatus });
	}
	return phases;
}

export function parseSaveSpecInput(
	raw: unknown,
	existing?: SpecRecord | null,
): { ok: true; value: SpecRecord } | { ok: false; error: string } {
	if (!raw || typeof raw !== "object") {
		return { ok: false, error: "spec must be a JSON object" };
	}
	const m = raw as Record<string, unknown>;
	const slug = typeof m.slug === "string" ? m.slug.trim() : "";
	const title = typeof m.title === "string" ? m.title.trim() : "";
	const body = typeof m.body === "string" ? m.body : "";
	if (!slug || !SLUG_RE.test(slug)) {
		return { ok: false, error: "slug must be lowercase hyphenated" };
	}
	if (!title) return { ok: false, error: "title is required" };
	if (!body) return { ok: false, error: "body is required" };

	const phasesRaw = m.phases !== undefined ? parsePhases(m.phases) : existing?.phases ?? [];
	if (phasesRaw === null) return { ok: false, error: "invalid phases" };

	let status: SpecStatus = existing?.status ?? "ready";
	if (typeof m.status === "string" && STATUSES.includes(m.status as SpecStatus)) {
		status = m.status as SpecStatus;
	}

	const now = new Date().toISOString();
	return {
		ok: true,
		value: {
			slug,
			title,
			body,
			source: typeof m.source === "string" ? m.source.trim() : existing?.source,
			status,
			phases: phasesRaw,
			lock: existing?.lock ?? null,
			created_at: existing?.created_at ?? now,
			updated_at: now,
		},
	};
}

export function parsePatchSpecInput(
	raw: unknown,
): { ok: true; value: { status?: SpecStatus; phases?: SpecPhase[] } } | { ok: false; error: string } {
	if (!raw || typeof raw !== "object") {
		return { ok: false, error: "body must be a JSON object" };
	}
	const m = raw as Record<string, unknown>;
	const out: { status?: SpecStatus; phases?: SpecPhase[] } = {};

	if (m.status !== undefined) {
		if (typeof m.status !== "string" || !STATUSES.includes(m.status as SpecStatus)) {
			return { ok: false, error: "invalid status" };
		}
		out.status = m.status as SpecStatus;
	}

	if (m.phases !== undefined) {
		const phases = parsePhases(m.phases);
		if (phases === null) return { ok: false, error: "invalid phases" };
		out.phases = phases;
	}

	if (out.status === undefined && out.phases === undefined) {
		return { ok: false, error: "status or phases required" };
	}

	return { ok: true, value: out };
}

export function parseLockInput(
	raw: unknown,
): { ok: true; value: { agent_id: string } } | { ok: false; error: string } {
	if (!raw || typeof raw !== "object") {
		return { ok: false, error: "body must be a JSON object" };
	}
	const agent_id = typeof (raw as { agent_id?: unknown }).agent_id === "string"
		? (raw as { agent_id: string }).agent_id.trim()
		: "";
	if (!agent_id || agent_id.length > 120) {
		return { ok: false, error: "agent_id is required" };
	}
	return { ok: true, value: { agent_id } };
}
