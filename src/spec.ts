export type SpecStatus = "ready" | "in_progress" | "blocked" | "done";
export type PhaseStatus = "pending" | "active" | "done";

export interface SpecPhase {
	id: string;
	title: string;
	status: PhaseStatus;
}

export type HolderKind = "user" | "agent";

export interface SpecLock {
	/** User email/sub from Access, or agent id for service callers. */
	agent_id: string;
	acquired_at: string;
	holder_kind?: HolderKind;
	/** Wall-clock expiry (DO alarm lease). */
	expires_at?: string;
	/** TTL seconds used for this lock. */
	lease_seconds?: number;
}

export interface SpecRecord {
	slug: string;
	title: string;
	body: string;
	source?: string;
	status: SpecStatus;
	phases: SpecPhase[];
	/** Orchestrator phase label (step 10 — DO-owned, mirrors footer Active phase). */
	active_phase: string | null;
	lock: SpecLock | null;
	etag: string;
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
	active_phase: string | null;
	lock: SpecLock | null;
	etag: string;
}

const SLUG_RE = /^[a-z][a-z0-9-]*$/;
const ID_RE = /^[a-z][a-z0-9-]*$/;
const STATUSES: SpecStatus[] = ["ready", "in_progress", "blocked", "done"];
const PHASE_STATUSES: PhaseStatus[] = ["pending", "active", "done"];

export const SPEC_INDEX_KEY = "spec:index";

export function specKey(slug: string): string {
	return `spec:${slug}`;
}

export function normalizeSpecRecord(raw: SpecRecord | (Omit<SpecRecord, "status" | "phases" | "lock" | "active_phase" | "etag"> & Partial<Pick<SpecRecord, "status" | "phases" | "lock" | "active_phase" | "etag">>)): SpecRecord {
	const lock = raw.lock ?? null;
	let status = raw.status ?? "ready";
	if (status === "in_progress" && !lock) status = "ready";
	const updated_at = raw.updated_at ?? raw.created_at ?? new Date().toISOString();
	return {
		...raw,
		status,
		phases: Array.isArray(raw.phases) ? raw.phases : [],
		active_phase: typeof raw.active_phase === "string" ? raw.active_phase : raw.active_phase ?? null,
		lock,
		etag: raw.etag ?? updated_at,
		created_at: raw.created_at ?? updated_at,
		updated_at,
	};
}

/** Specs have no build progress; board shows ready/blocked/done only. */
export function specBoardStatus(record: SpecRecord): SpecStatus {
	const normalized = normalizeSpecRecord(record);
	if (normalized.status === "done" || normalized.status === "blocked") {
		return normalized.status;
	}
	return "ready";
}

export function toSpecSummary(record: SpecRecord): SpecSummary {
	const normalized = normalizeSpecRecord(record);
	const phases_done = normalized.phases.filter((p) => p.status === "done").length;
	return {
		slug: normalized.slug,
		title: normalized.title,
		source: normalized.source,
		status: specBoardStatus(normalized),
		updated_at: normalized.updated_at,
		phases_done,
		phases_total: normalized.phases.length,
		active_phase: normalized.active_phase,
		lock: normalized.lock,
		etag: normalized.etag,
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
			active_phase: existing?.active_phase ?? null,
			lock: existing?.lock ?? null,
			etag: now,
			created_at: existing?.created_at ?? now,
			updated_at: now,
		},
	};
}

export function parsePatchSpecInput(
	raw: unknown,
): { ok: true; value: { status?: SpecStatus; phases?: SpecPhase[]; active_phase?: string | null; etag?: string } } | { ok: false; error: string } {
	if (!raw || typeof raw !== "object") {
		return { ok: false, error: "body must be a JSON object" };
	}
	const m = raw as Record<string, unknown>;
	const out: { status?: SpecStatus; phases?: SpecPhase[]; active_phase?: string | null; etag?: string } = {};

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

	if (m.active_phase !== undefined) {
		if (m.active_phase === null) {
			out.active_phase = null;
		} else if (typeof m.active_phase === "string" && m.active_phase.trim()) {
			out.active_phase = m.active_phase.trim();
		} else {
			return { ok: false, error: "invalid active_phase" };
		}
	}

	if (typeof m.etag === "string" && m.etag.trim()) {
		out.etag = m.etag.trim();
	}

	if (out.status === undefined && out.phases === undefined && out.active_phase === undefined) {
		return { ok: false, error: "status, phases, or active_phase required" };
	}

	return { ok: true, value: out };
}

/** Shipped spec with pending phase rows — server-side phase_bridge candidate. */
export function isPhaseBridgeSpec(record: SpecRecord): boolean {
	const normalized = normalizeSpecRecord(record);
	if (normalized.status !== "done") return false;
	return normalized.phases.some((p) => p.status === "pending" || p.status === "active");
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

/** Body agent_id is optional when gateway forwards Access identity headers. */
export function parseOptionalLockBody(raw: unknown): string | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const agent_id = typeof (raw as { agent_id?: unknown }).agent_id === "string"
		? (raw as { agent_id: string }).agent_id.trim()
		: "";
	return agent_id || undefined;
}
