import { parseSpecFooterFields } from "./spec-footer.ts";
import type { RevisionSummaryFields } from "./revision.ts";
import type { RevisionsSummary } from "./revision-record.ts";

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
	/** Orchestrator activity label (review, implement, refactor). */
	activity?: string;
}

export interface SpecOrchestrationFields {
	terminal_skill?: string | null;
	design_lane?: string | null;
	plan_id?: string | null;
	review_gate?: string | null;
	plan_review?: string | null;
	worker_scope?: string[];
}

export interface SpecRecord extends SpecOrchestrationFields, RevisionSummaryFields {
	/** SQLite audit trail preview — populated on GET only. */
	revisions_summary?: RevisionsSummary;
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

export interface SpecSummary extends SpecOrchestrationFields, RevisionSummaryFields {
	revisions_summary?: RevisionsSummary;
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

/** Orient projection — summary + phases + orchestration metadata (view=summary). */
export interface SpecOrientView extends SpecSummary {
	phases: SpecPhase[];
	terminal_skill: string | null;
	design_lane: string | null;
	plan_id: string | null;
	review_gate: string | null;
	plan_review: string | null;
	worker_scope: string[];
}

const SLUG_RE = /^[a-z][a-z0-9-]*$/;
const ID_RE = /^[a-z][a-z0-9-]*$/;
const STATUSES: SpecStatus[] = ["ready", "in_progress", "blocked", "done"];
const PHASE_STATUSES: PhaseStatus[] = ["pending", "active", "done"];
const GED_ORCHESTRATOR_SOURCE = "ged-orchestrator";

/** Bootstrap / Shipped grandfather — skip greenfield blocked default. */
export function isGrandfatheredOrchestratorRegister(raw: Record<string, unknown>): boolean {
	return raw.grandfather_review_gate === true || raw.review_gate_pending === false;
}

function isExplicitStatus(raw: Record<string, unknown>): boolean {
	return typeof raw.status === "string" && STATUSES.includes(raw.status as SpecStatus);
}

/** New greenfield ged-orchestrator POST /specs without explicit status → blocked. */
export function shouldDefaultOrchestratorBlocked(
	source: string | undefined,
	existing: SpecRecord | null | undefined,
	raw: Record<string, unknown>,
): boolean {
	return (
		!existing &&
		source === GED_ORCHESTRATOR_SOURCE &&
		!isExplicitStatus(raw) &&
		!isGrandfatheredOrchestratorRegister(raw)
	);
}

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
		revisions_count: raw.revisions_count ?? 0,
		last_revision: raw.last_revision ?? null,
	};
}

/** Review gate passed — grandfather done/shipped and missing field. */
export function isReviewGatePassed(record: SpecRecord): boolean {
	const normalized = normalizeSpecRecord(record);
	if (normalized.status === "done") return true;

	let gate = normalized.review_gate;
	if (!gate) {
		gate = parseSpecFooterFields(normalized.body).review_gate;
	}
	if (!gate) return true;

	const normalizedGate = gate.toLowerCase().replace(/\*\*/g, "").trim();
	if (!normalizedGate) return true;
	if (normalizedGate === "passed" || normalizedGate.startsWith("passed")) return true;
	if (normalizedGate === "pending" || normalizedGate.startsWith("pending")) return false;
	return false;
}

/** Route/take pickability — pending review blocks primary pick. */
export function isSpecOrchestrationBlocked(record: SpecRecord): boolean {
	return !isReviewGatePassed(record);
}

/** Specs have no build progress; board shows ready/blocked/done only. */
export function specBoardStatus(record: SpecRecord): SpecStatus {
	const normalized = normalizeSpecRecord(record);
	if (normalized.status === "done" || normalized.status === "blocked") {
		return normalized.status;
	}
	return "ready";
}

function orchestrationFromRecord(record: SpecRecord): SpecOrchestrationFields {
	return {
		terminal_skill: record.terminal_skill ?? null,
		design_lane: record.design_lane ?? null,
		plan_id: record.plan_id ?? null,
		review_gate: record.review_gate ?? null,
		plan_review: record.plan_review ?? null,
		worker_scope: record.worker_scope ?? [],
	};
}

function pickOrchestrationString(
	explicit: unknown,
	stored: string | null | undefined,
	footer: string | null | undefined,
): string | null {
	if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
	if (typeof stored === "string" && stored.trim()) return stored.trim();
	return footer ?? null;
}

/** Footer passed wins over stale DO required (plan_review_passed before metadata sync). */
export function reconcilePlanReview(
	stored: string | null | undefined,
	footer: string | null | undefined,
): string | null {
	const storedNorm = String(stored ?? "")
		.toLowerCase()
		.replace(/\*\*/g, "")
		.trim();
	const footerNorm = String(footer ?? "")
		.toLowerCase()
		.replace(/\*\*/g, "")
		.trim();
	if (footerNorm === "passed" && storedNorm === "required") return "passed";
	if (stored && stored.trim()) return stored.trim();
	return footer ?? null;
}

function pickWorkerScope(
	explicit: unknown,
	stored: string[] | undefined,
	footer: string[],
): string[] {
	if (Array.isArray(explicit)) {
		const scoped = explicit
			.filter((item): item is string => typeof item === "string")
			.map((item) => item.trim().toLowerCase())
			.filter(Boolean);
		if (scoped.length > 0) return scoped;
	}
	if (stored && stored.length > 0) return stored;
	return footer;
}

/** Merge explicit input, DO metadata, and footer — explicit > stored > footer. */
export function mergeOrchestrationFields(
	raw: Record<string, unknown>,
	existing: SpecRecord | null | undefined,
	footer: ReturnType<typeof parseSpecFooterFields>,
): SpecOrchestrationFields {
	return {
		terminal_skill: pickOrchestrationString(
			raw.terminal_skill,
			existing?.terminal_skill,
			footer.terminal_skill,
		),
		design_lane: pickOrchestrationString(raw.design_lane, existing?.design_lane, footer.design_lane),
		plan_id: pickOrchestrationString(raw.plan_id, existing?.plan_id, footer.plan_id),
		review_gate: pickOrchestrationString(raw.review_gate, existing?.review_gate, footer.review_gate),
		plan_review: pickOrchestrationString(raw.plan_review, existing?.plan_review, footer.plan_review),
		worker_scope: pickWorkerScope(raw.worker_scope, existing?.worker_scope, footer.worker_scope),
	};
}

/** Link plan_id on spec when savePlan carries spec_slug. Returns null when unchanged. */
export function linkSpecPlanId(spec: SpecRecord, planId: string, specSlug: string): SpecRecord | null {
	if (spec.slug !== specSlug) return null;
	if (spec.plan_id === planId) return null;
	const now = new Date().toISOString();
	return normalizeSpecRecord({
		...spec,
		plan_id: planId,
		updated_at: now,
		etag: now,
	});
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
		revisions_count: normalized.revisions_count,
		last_revision: normalized.last_revision,
		...orchestrationFromRecord(normalized),
	};
}

export function toSpecOrientView(
	record: SpecRecord,
	footerFields: {
		terminal_skill: string | null;
		design_lane: string | null;
		plan_id: string | null;
		review_gate: string | null;
		plan_review: string | null;
		worker_scope: string[];
	},
): SpecOrientView {
	const normalized = normalizeSpecRecord(record);
	const summary = toSpecSummary(normalized);
	const stored = orchestrationFromRecord(normalized);
	return {
		...summary,
		phases: normalized.phases,
		terminal_skill: stored.terminal_skill ?? footerFields.terminal_skill,
		design_lane: stored.design_lane ?? footerFields.design_lane,
		plan_id: stored.plan_id ?? footerFields.plan_id,
		review_gate: stored.review_gate ?? footerFields.review_gate,
		plan_review: reconcilePlanReview(stored.plan_review, footerFields.plan_review),
		worker_scope:
			stored.worker_scope && stored.worker_scope.length > 0
				? stored.worker_scope
				: footerFields.worker_scope,
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

	const source = typeof m.source === "string" ? m.source.trim() : existing?.source;
	const applyOrchestratorBlockedDefault = shouldDefaultOrchestratorBlocked(source, existing, m);

	let status: SpecStatus = existing?.status ?? "ready";
	if (isExplicitStatus(m)) {
		status = m.status as SpecStatus;
	} else if (applyOrchestratorBlockedDefault) {
		status = "blocked";
	}

	const now = new Date().toISOString();
	const footer = parseSpecFooterFields(body);
	const orchestration = mergeOrchestrationFields(m, existing, footer);
	if (
		!orchestration.review_gate &&
		applyOrchestratorBlockedDefault &&
		status === "blocked"
	) {
		orchestration.review_gate = "pending";
	}

	let active_phase = existing?.active_phase ?? null;
	if (m.active_phase === null) {
		active_phase = null;
	} else if (typeof m.active_phase === "string" && m.active_phase.trim()) {
		active_phase = m.active_phase.trim();
	} else if (!active_phase && footer.active_phase) {
		active_phase = footer.active_phase;
	} else if (applyOrchestratorBlockedDefault && status === "blocked") {
		active_phase = "Review";
	}

	return {
		ok: true,
		value: {
			slug,
			title,
			body,
			source,
			status,
			phases: phasesRaw,
			active_phase,
			lock: existing?.lock ?? null,
			etag: now,
			created_at: existing?.created_at ?? now,
			updated_at: now,
			...orchestration,
			revisions_count: existing?.revisions_count ?? 0,
			last_revision: existing?.last_revision ?? null,
		},
	};
}

export interface SpecPatchInput {
	status?: SpecStatus;
	body?: string;
	phases?: SpecPhase[];
	active_phase?: string | null;
	etag?: string;
	terminal_skill?: string | null;
	design_lane?: string | null;
	plan_id?: string | null;
	review_gate?: string | null;
	plan_review?: string | null;
	worker_scope?: string[];
	revision_reason?: string;
	revision_event?: string;
}

function parsePatchOrchestrationString(
	field: string,
	raw: unknown,
): { ok: true; value: string | null } | { ok: false; error: string } {
	if (raw === null) return { ok: true, value: null };
	if (typeof raw === "string" && raw.trim()) return { ok: true, value: raw.trim() };
	return { ok: false, error: `invalid ${field}` };
}

export function parsePatchSpecInput(
	raw: unknown,
): { ok: true; value: SpecPatchInput } | { ok: false; error: string } {
	if (!raw || typeof raw !== "object") {
		return { ok: false, error: "body must be a JSON object" };
	}
	const m = raw as Record<string, unknown>;
	const out: SpecPatchInput = {};

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

	for (const field of [
		"terminal_skill",
		"design_lane",
		"plan_id",
		"review_gate",
		"plan_review",
	] as const) {
		if (m[field] === undefined) continue;
		const parsed = parsePatchOrchestrationString(field, m[field]);
		if (!parsed.ok) return parsed;
		out[field] = parsed.value;
	}

	if (m.worker_scope !== undefined) {
		if (!Array.isArray(m.worker_scope)) {
			return { ok: false, error: "invalid worker_scope" };
		}
		out.worker_scope = m.worker_scope
			.filter((item): item is string => typeof item === "string")
			.map((item) => item.trim().toLowerCase())
			.filter(Boolean);
	}

	if (typeof m.etag === "string" && m.etag.trim()) {
		out.etag = m.etag.trim();
	}

	if (m.body !== undefined) {
		if (typeof m.body !== "string") return { ok: false, error: "invalid body" };
		out.body = m.body;
	}

	if (m.revision_reason !== undefined) {
		if (typeof m.revision_reason !== "string") {
			return { ok: false, error: "invalid revision_reason" };
		}
		out.revision_reason = m.revision_reason;
	}

	if (m.revision_event !== undefined) {
		if (typeof m.revision_event !== "string" || !m.revision_event.trim()) {
			return { ok: false, error: "invalid revision_event" };
		}
		out.revision_event = m.revision_event.trim();
	}

	if (
		out.status === undefined &&
		out.body === undefined &&
		out.phases === undefined &&
		out.active_phase === undefined &&
		out.terminal_skill === undefined &&
		out.design_lane === undefined &&
		out.plan_id === undefined &&
		out.review_gate === undefined &&
		out.plan_review === undefined &&
		out.worker_scope === undefined &&
		out.revision_reason === undefined &&
		out.revision_event === undefined
	) {
		return { ok: false, error: "at least one patch field required" };
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

/** Optional lock activity from acquire/renew body (lowercase, max 32 chars). */
export function parseOptionalLockActivity(raw: unknown): string | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const activity = typeof (raw as { activity?: unknown }).activity === "string"
		? (raw as { activity: string }).activity.trim().toLowerCase()
		: "";
	if (!activity || activity.length > 32) return undefined;
	return activity;
}

/** Prefer body activity; keep existing on same-holder renew when omitted. */
export function resolveLockActivity(
	raw: unknown,
	existing: SpecLock | null | undefined,
): string | undefined {
	return parseOptionalLockActivity(raw) ?? existing?.activity;
}
