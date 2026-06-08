import type { PlanPhase, PlanRecord } from "./plan.ts";
import {
	normalizePlanRecord,
	stampPhaseCompletions,
	toPlanSummary,
} from "./plan.ts";
import { parseSpecFooterFields } from "./spec-footer.ts";
import {
	applySpecPhaseUpdates,
	markPhaseTableComplete,
	type SpecPhaseUpdate,
	upsertFooterActivePhase,
	upsertFooterPlan,
	upsertFooterReviewGate,
	upsertFooterStatus,
} from "./spec-footer-upsert.ts";
import {
	isReviewGatePassed,
	normalizeSpecRecord,
	toSpecSummary,
	type SpecRecord,
} from "./spec.ts";

export type OrchestrateEvent =
	| "review_passed"
	| "plan_created"
	| "plan_gate_c"
	| "plan_review_passed"
	| "phase_done"
	| "implement_start"
	| "ship";

export interface OrchestratePayload {
	body?: string;
	mark_phases_complete?: boolean;
	plan_body_append?: string;
	spec_phase_updates?: SpecPhaseUpdate[];
	phase_id?: string;
	phase_index?: number;
}

export interface OrchestrateRequest {
	event: OrchestrateEvent;
	plan_id?: string;
	payload?: OrchestratePayload;
	transition_id?: string;
}

export interface OrchestrateTransitionResult {
	event: OrchestrateEvent;
	spec: ReturnType<typeof toSpecSummary>;
	plan: ReturnType<typeof toPlanSummary> | null;
	body_changed: boolean;
}

export class OrchestratePreconditionError extends Error {
	readonly code: string;

	constructor(code: string, message?: string) {
		super(message ?? code);
		this.name = "OrchestratePreconditionError";
		this.code = code;
	}
}

const EVENTS: OrchestrateEvent[] = [
	"review_passed",
	"plan_created",
	"plan_gate_c",
	"plan_review_passed",
	"phase_done",
	"implement_start",
	"ship",
];

const PLAN_ID_REQUIRED: OrchestrateEvent[] = [
	"plan_review_passed",
	"plan_gate_c",
	"phase_done",
	"implement_start",
	"ship",
];

function parseSpecPhaseUpdates(raw: unknown): SpecPhaseUpdate[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const updates: SpecPhaseUpdate[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const u = item as SpecPhaseUpdate;
		if (typeof u.from === "string" && typeof u.to === "string") {
			updates.push({ from: u.from, to: u.to });
		}
	}
	return updates.length > 0 ? updates : undefined;
}

export function parseOrchestrateRequest(
	raw: unknown,
): { ok: true; value: OrchestrateRequest } | { ok: false; error: string } {
	if (!raw || typeof raw !== "object") {
		return { ok: false, error: "transition must be a JSON object" };
	}
	const m = raw as Record<string, unknown>;
	const event = typeof m.event === "string" ? m.event.trim() : "";
	if (!EVENTS.includes(event as OrchestrateEvent)) {
		return { ok: false, error: "invalid or missing event" };
	}
	const plan_id = typeof m.plan_id === "string" ? m.plan_id.trim() : undefined;
	if (PLAN_ID_REQUIRED.includes(event as OrchestrateEvent) && !plan_id) {
		return { ok: false, error: "plan_id required" };
	}
	const transition_id =
		typeof m.transition_id === "string" ? m.transition_id.trim() : undefined;
	let payload: OrchestratePayload | undefined;
	if (m.payload !== undefined) {
		if (!m.payload || typeof m.payload !== "object") {
			return { ok: false, error: "payload must be an object" };
		}
		const p = m.payload as OrchestratePayload & Record<string, unknown>;
		const phase_index =
			typeof p.phase_index === "number" && Number.isFinite(p.phase_index)
				? p.phase_index
				: undefined;
		payload = {
			body: typeof p.body === "string" ? p.body : undefined,
			mark_phases_complete: p.mark_phases_complete === true,
			plan_body_append:
				typeof p.plan_body_append === "string" ? p.plan_body_append : undefined,
			spec_phase_updates: parseSpecPhaseUpdates(p.spec_phase_updates),
			phase_id: typeof p.phase_id === "string" ? p.phase_id.trim() : undefined,
			phase_index,
		};
	}
	return {
		ok: true,
		value: {
			event: event as OrchestrateEvent,
			plan_id: plan_id || undefined,
			payload,
			transition_id: transition_id || undefined,
		},
	};
}

function reviewGateValue(record: SpecRecord): string | null {
	return record.review_gate ?? parseSpecFooterFields(record.body).review_gate;
}

export function isReviewGatePending(record: SpecRecord): boolean {
	const gate = reviewGateValue(record);
	if (!gate) return false;
	const normalized = gate.toLowerCase().replace(/\*\*/g, "").trim();
	return normalized === "pending" || normalized.startsWith("pending");
}

function planReviewValue(record: SpecRecord): string | null {
	return record.plan_review ?? parseSpecFooterFields(record.body).plan_review;
}

export function isPlanReviewRequired(record: SpecRecord): boolean {
	const value = planReviewValue(record);
	if (!value) return false;
	const normalized = value.toLowerCase().replace(/\*\*/g, "").trim();
	return normalized === "required";
}

export function isSpecReadyForPlan(record: SpecRecord): boolean {
	const status = normalizeSpecRecord(record).status;
	return status === "ready" || status === "in_progress" || status === "done";
}

function stamp(now: string) {
	return { updated_at: now, etag: now };
}

function resolvePlanPhase(
	plan: PlanRecord,
	payload: OrchestratePayload,
): PlanPhase | null {
	if (payload.phase_id) {
		return plan.phases.find((p) => p.id === payload.phase_id) ?? null;
	}
	if (payload.phase_index !== undefined) {
		return plan.phases.find((p) => p.index === payload.phase_index) ?? null;
	}
	return null;
}

export function applyReviewPassed(
	spec: SpecRecord,
	payload: OrchestratePayload = {},
): SpecRecord {
	const record = normalizeSpecRecord(spec);
	if (isReviewGatePassed(record) && record.status === "ready") {
		return record;
	}
	if (!isReviewGatePending(record)) {
		throw new OrchestratePreconditionError("review_gate_not_pending");
	}

	const now = new Date().toISOString();
	let body = payload.body ?? record.body;
	body = upsertFooterReviewGate(body, "passed");
	body = upsertFooterActivePhase(body, "Plan");

	return normalizeSpecRecord({
		...record,
		body,
		review_gate: "passed",
		status: "ready",
		active_phase: "Plan",
		...stamp(now),
	});
}

export function applyPlanCreated(
	spec: SpecRecord,
	plan: PlanRecord,
): { spec: SpecRecord; plan: PlanRecord } {
	const specRecord = normalizeSpecRecord(spec);
	const planRecord = normalizePlanRecord(plan);

	if (!isReviewGatePassed(specRecord)) {
		throw new OrchestratePreconditionError("review_gate_not_passed");
	}
	if (!isSpecReadyForPlan(specRecord)) {
		throw new OrchestratePreconditionError("spec_status_not_ready");
	}
	if (planRecord.spec_slug && planRecord.spec_slug !== specRecord.slug) {
		throw new OrchestratePreconditionError("plan_spec_mismatch");
	}

	const now = new Date().toISOString();
	const blocked = isPlanReviewRequired(specRecord);
	let body = specRecord.body;
	body = upsertFooterPlan(body, planRecord.id);

	const updatedSpec = normalizeSpecRecord({
		...specRecord,
		body,
		plan_id: planRecord.id,
		...stamp(now),
	});

	const updatedPlan = normalizePlanRecord({
		...planRecord,
		status: blocked ? "blocked" : "ready",
		...stamp(now),
	});

	return { spec: updatedSpec, plan: updatedPlan };
}

export function applyPlanGateC(
	spec: SpecRecord,
	plan: PlanRecord,
	payload: OrchestratePayload = {},
): { spec: SpecRecord; plan: PlanRecord } {
	const specRecord = normalizeSpecRecord(spec);
	const planRecord = normalizePlanRecord(plan);

	if (!isReviewGatePassed(specRecord)) {
		throw new OrchestratePreconditionError("review_gate_not_passed");
	}
	if (planRecord.status !== "blocked") {
		throw new OrchestratePreconditionError("plan_not_blocked");
	}
	if (planRecord.spec_slug && planRecord.spec_slug !== specRecord.slug) {
		throw new OrchestratePreconditionError("plan_spec_mismatch");
	}

	const now = new Date().toISOString();
	let specBody = specRecord.body;
	if (payload.spec_phase_updates?.length) {
		specBody = applySpecPhaseUpdates(specBody, payload.spec_phase_updates);
	}

	let planBody = planRecord.body;
	if (payload.plan_body_append) {
		planBody = `${planBody.trim()}\n${payload.plan_body_append.trim()}\n`;
	}

	const updatedSpec = normalizeSpecRecord({
		...specRecord,
		body: specBody,
		plan_id: planRecord.id,
		...stamp(now),
	});

	const updatedPlan = normalizePlanRecord({
		...planRecord,
		body: planBody,
		status: "blocked",
		...stamp(now),
	});

	return { spec: updatedSpec, plan: updatedPlan };
}

export function applyPlanReviewPassed(
	spec: SpecRecord,
	plan: PlanRecord,
	payload: OrchestratePayload = {},
): { spec: SpecRecord; plan: PlanRecord } {
	const specRecord = normalizeSpecRecord(spec);
	const planRecord = normalizePlanRecord(plan);

	if (!isReviewGatePassed(specRecord)) {
		throw new OrchestratePreconditionError("review_gate_not_passed");
	}
	if (planRecord.status !== "blocked") {
		throw new OrchestratePreconditionError("plan_not_blocked");
	}
	if (planRecord.spec_slug && planRecord.spec_slug !== specRecord.slug) {
		throw new OrchestratePreconditionError("plan_spec_mismatch");
	}

	const now = new Date().toISOString();
	let body = payload.body ?? specRecord.body;
	body = upsertFooterActivePhase(body, "Implement");

	const updatedSpec = normalizeSpecRecord({
		...specRecord,
		body,
		active_phase: "Implement",
		plan_id: planRecord.id,
		...stamp(now),
	});

	const updatedPlan = normalizePlanRecord({
		...planRecord,
		status: "ready",
		...stamp(now),
	});

	return { spec: updatedSpec, plan: updatedPlan };
}

export function applyPhaseDone(
	spec: SpecRecord,
	plan: PlanRecord,
	payload: OrchestratePayload = {},
): { spec: SpecRecord; plan: PlanRecord } {
	const specRecord = normalizeSpecRecord(spec);
	const planRecord = normalizePlanRecord(plan);

	if (planRecord.status !== "in_progress") {
		throw new OrchestratePreconditionError("plan_not_in_progress");
	}
	if (planRecord.spec_slug && planRecord.spec_slug !== specRecord.slug) {
		throw new OrchestratePreconditionError("plan_spec_mismatch");
	}

	const target = resolvePlanPhase(planRecord, payload);
	if (!target) {
		throw new OrchestratePreconditionError("invalid_payload");
	}
	if (target.status === "done") {
		return { spec: specRecord, plan: planRecord };
	}

	const now = new Date().toISOString();
	const marked = planRecord.phases.map((p) =>
		p.id === target.id ? { ...p, status: "done" as const } : p,
	);
	const stamped = stampPhaseCompletions(planRecord.phases, marked);

	let activateNext = false;
	const phases = [...stamped]
		.sort((a, b) => a.index - b.index)
		.map((p) => {
			if (p.id === target.id) {
				activateNext = true;
				return p;
			}
			if (activateNext && p.status === "pending") {
				activateNext = false;
				return { ...p, status: "active" as const };
			}
			return p;
		});

	const allDone = phases.length > 0 && phases.every((p) => p.status === "done");
	const updatedPlan = normalizePlanRecord({
		...planRecord,
		phases,
		status: allDone ? "done" : "in_progress",
		...stamp(now),
	});

	const updatedSpec = normalizeSpecRecord({
		...specRecord,
		active_phase: specRecord.active_phase ?? "Implement",
		plan_id: planRecord.id,
		...stamp(now),
	});

	return { spec: updatedSpec, plan: updatedPlan };
}

export function applyImplementStart(
	spec: SpecRecord,
	plan: PlanRecord,
): { spec: SpecRecord; plan: PlanRecord } {
	const specRecord = normalizeSpecRecord(spec);
	const planRecord = normalizePlanRecord(plan);

	if (!isReviewGatePassed(specRecord)) {
		throw new OrchestratePreconditionError("review_gate_not_passed");
	}
	if (planRecord.status !== "ready") {
		throw new OrchestratePreconditionError("plan_not_ready");
	}
	if (planRecord.spec_slug && planRecord.spec_slug !== specRecord.slug) {
		throw new OrchestratePreconditionError("plan_spec_mismatch");
	}

	const now = new Date().toISOString();
	const updatedPlan = normalizePlanRecord({
		...planRecord,
		status: "in_progress",
		...stamp(now),
	});

	const updatedSpec = normalizeSpecRecord({
		...specRecord,
		active_phase: specRecord.active_phase ?? "Implement",
		plan_id: planRecord.id,
		...stamp(now),
	});

	return { spec: updatedSpec, plan: updatedPlan };
}

export function applyShip(
	spec: SpecRecord,
	plan: PlanRecord | null,
	payload: OrchestratePayload = {},
): { spec: SpecRecord; plan: PlanRecord | null } {
	const specRecord = normalizeSpecRecord(spec);
	if (!isReviewGatePassed(specRecord) && specRecord.status !== "done") {
		throw new OrchestratePreconditionError("review_gate_not_passed");
	}

	const now = new Date().toISOString();
	let body = payload.body ?? specRecord.body;
	if (payload.mark_phases_complete !== false) {
		body = markPhaseTableComplete(body);
	}
	body = upsertFooterStatus(body, "Shipped");
	const planId = plan?.id ?? specRecord.plan_id ?? `${specRecord.slug}-plan`;
	if (plan) {
		body = upsertFooterPlan(body, planId);
	}

	const updatedSpec = normalizeSpecRecord({
		...specRecord,
		body,
		status: "done",
		lock: null,
		...stamp(now),
	});

	let updatedPlan: PlanRecord | null = null;
	if (plan) {
		const phases = plan.phases.map((p) =>
			p.status === "done" ? p : { ...p, status: "done" as const },
		);
		updatedPlan = normalizePlanRecord({
			...plan,
			status: "done",
			phases,
			lock: null,
			...stamp(now),
		});
	}

	return { spec: updatedSpec, plan: updatedPlan };
}

export function applyOrchestrateTransition(
	event: OrchestrateEvent,
	spec: SpecRecord,
	plan: PlanRecord | null,
	payload: OrchestratePayload = {},
): OrchestrateTransitionResult {
	let nextSpec = normalizeSpecRecord(spec);
	let nextPlan: PlanRecord | null = plan ? normalizePlanRecord(plan) : null;

	const bodyBefore = spec.body;
	const planBodyBefore = plan?.body;

	switch (event) {
		case "review_passed":
			nextSpec = applyReviewPassed(nextSpec, payload);
			break;
		case "plan_created":
			if (!nextPlan) throw new OrchestratePreconditionError("plan_required");
			({ spec: nextSpec, plan: nextPlan } = applyPlanCreated(nextSpec, nextPlan));
			break;
		case "plan_gate_c":
			if (!nextPlan) throw new OrchestratePreconditionError("plan_required");
			({ spec: nextSpec, plan: nextPlan } = applyPlanGateC(nextSpec, nextPlan, payload));
			break;
		case "plan_review_passed":
			if (!nextPlan) throw new OrchestratePreconditionError("plan_required");
			({ spec: nextSpec, plan: nextPlan } = applyPlanReviewPassed(
				nextSpec,
				nextPlan,
				payload,
			));
			break;
		case "phase_done":
			if (!nextPlan) throw new OrchestratePreconditionError("plan_required");
			({ spec: nextSpec, plan: nextPlan } = applyPhaseDone(nextSpec, nextPlan, payload));
			break;
		case "implement_start":
			if (!nextPlan) throw new OrchestratePreconditionError("plan_required");
			({ spec: nextSpec, plan: nextPlan } = applyImplementStart(nextSpec, nextPlan));
			break;
		case "ship":
			({ spec: nextSpec, plan: nextPlan } = applyShip(nextSpec, nextPlan, payload));
			break;
		default:
			throw new OrchestratePreconditionError("unknown_event");
	}

	const body_changed =
		nextSpec.body !== bodyBefore || (nextPlan?.body ?? null) !== (planBodyBefore ?? null);

	return {
		event,
		spec: toSpecSummary(nextSpec),
		plan: nextPlan ? toPlanSummary(nextPlan) : null,
		body_changed,
	};
}

export const TRANSITION_CACHE_PREFIX = "transition:";
