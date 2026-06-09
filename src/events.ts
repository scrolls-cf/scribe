/**
 * Scribe WebSocket event envelope (v1) — ged-scribe-websockets phase 1 sign-off.
 * Payloads use summary projections only; no markdown body on the wire.
 */
import type { OrchestrateTransitionResult } from "./orchestrate.ts";
import type { PlanSummary } from "./plan.ts";
import type { LeaseTarget } from "./lease.ts";
import type { SpecLock, SpecSummary } from "./spec.ts";

/** Ring buffer bounds — replay window for reconnect. */
export const EVENT_REPLAY_MAX_ENTRIES = 256;
export const EVENT_REPLAY_MAX_AGE_MS = 15 * 60 * 1000;

/** Coalesce metadata-only spec_updated bursts (lock_changed is never coalesced). */
export const SPEC_UPDATED_COALESCE_MS = 50;

export const SCRIBE_EVENT_TYPES = [
	"connected",
	"spec_updated",
	"plan_updated",
	"lock_changed",
	"queue_taken",
	"transition_applied",
	"ping",
	"pong",
] as const;

export type ScribeEventType = (typeof SCRIBE_EVENT_TYPES)[number];

export type LockChangedCause = "acquire" | "release" | "lease_alarm";
export type SpecUpdatedCause = "patchSpec" | "transition" | "lease_alarm" | "queue_take";
export type LockTargetKind = LeaseTarget["kind"];

export interface ScribeEventBase {
	event_id: string;
	seq: number;
	project: string;
}

export interface ConnectedEvent extends ScribeEventBase {
	type: "connected";
	replay: ScribeServerEvent[];
}

export interface SpecUpdatedEvent extends ScribeEventBase {
	type: "spec_updated";
	spec: SpecSummary;
	cause: SpecUpdatedCause;
}

export interface PlanUpdatedEvent extends ScribeEventBase {
	type: "plan_updated";
	plan: PlanSummary;
}

export interface LockChangedEvent extends ScribeEventBase {
	type: "lock_changed";
	target: LockTargetKind;
	cause: LockChangedCause;
	lock: SpecLock | null;
	spec_slug: string;
	plan_id?: string;
	phase_id?: string;
}

export interface QueueTakenEvent extends ScribeEventBase {
	type: "queue_taken";
	kind: string;
	agent_id: string;
	spec_slug?: string;
	plan_id?: string;
	phase_id?: string;
}

export interface TransitionAppliedEvent extends ScribeEventBase {
	type: "transition_applied";
	transition: OrchestrateTransitionResult;
}

export interface PingEvent {
	type: "ping";
}

export interface PongEvent {
	type: "pong";
}

/** Server → client frames (excludes client ping). */
export type ScribeServerEvent =
	| ConnectedEvent
	| SpecUpdatedEvent
	| PlanUpdatedEvent
	| LockChangedEvent
	| QueueTakenEvent
	| TransitionAppliedEvent
	| PongEvent;

/** Bidirectional wire union. */
export type ScribeEvent = ScribeServerEvent | PingEvent;

export type ClientFilter =
	| { kind: "spec"; slug: string }
	| { kind: "plan"; id: string };

const FILTER_RE = /^(spec|plan):([a-z][a-z0-9-]*)$/;

/** Parse `?filter=spec:{slug}` / `?filter=plan:{id}` query values. */
export function parseClientFilter(raw: string): ClientFilter | null {
	const m = raw.trim().match(FILTER_RE);
	if (!m) return null;
	if (m[1] === "spec") return { kind: "spec", slug: m[2] };
	return { kind: "plan", id: m[2] };
}

export function parseClientFilters(searchParams: URLSearchParams): ClientFilter[] {
	const out: ClientFilter[] = [];
	for (const value of searchParams.getAll("filter")) {
		const parsed = parseClientFilter(value);
		if (parsed) out.push(parsed);
	}
	return out;
}

/** Stable id for queue_taken — same seed as `scripts/pipeline/lib/ged-event-schema.mjs`. */
export async function buildQueueTakenEventId(fields: {
	kind: string;
	spec_slug?: string;
	plan_id?: string;
	phase_id?: string;
	lock_etag?: string;
}): Promise<string> {
	const seed = [
		fields.kind,
		fields.spec_slug ?? "",
		fields.plan_id ?? "",
		fields.phase_id ?? "",
		fields.lock_etag ?? "",
	].join("|");
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")
		.slice(0, 32);
}

export function isScribeEventType(value: string): value is ScribeEventType {
	return (SCRIBE_EVENT_TYPES as readonly string[]).includes(value);
}

/** Runtime guard for inbound JSON text frames (phase 2+ DO handler). */
export function validateServerEventFrame(
	raw: unknown,
): { ok: true; event: ScribeServerEvent } | { ok: false; error: string } {
	if (!raw || typeof raw !== "object") return { ok: false, error: "not_object" };
	const type = (raw as { type?: unknown }).type;
	if (typeof type !== "string" || !isScribeEventType(type)) {
		return { ok: false, error: "invalid_type" };
	}
	if (type === "ping" || type === "pong") {
		return { ok: true, event: { type } as PongEvent };
	}
	const event_id = (raw as { event_id?: unknown }).event_id;
	const seq = (raw as { seq?: unknown }).seq;
	if (typeof event_id !== "string" || !event_id.trim()) {
		return { ok: false, error: "missing_event_id" };
	}
	if (typeof seq !== "number" || !Number.isFinite(seq)) {
		return { ok: false, error: "missing_seq" };
	}
	return { ok: true, event: raw as ScribeServerEvent };
}
