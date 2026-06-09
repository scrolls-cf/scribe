/** Scribe WebSocket event envelope (v1 harness). */

import type { HarnessContext } from "./harness.ts";
import type { WorkflowRecord } from "./workflow.ts";

export const EVENT_REPLAY_MAX_ENTRIES = 256;
export const EVENT_REPLAY_MAX_AGE_MS = 15 * 60 * 1000;

export const SCRIBE_EVENT_TYPES = [
	"connected",
	"workflow_update",
	"ping",
	"pong",
] as const;

export type ScribeEventType = (typeof SCRIBE_EVENT_TYPES)[number];

export interface ScribeEventBase {
	event_id: string;
	seq: number;
	project: string;
}

export interface ConnectedEvent extends ScribeEventBase {
	type: "connected";
	replay: ScribeServerEvent[];
	harness: HarnessContext;
}

export interface WorkflowUpdateEvent extends ScribeEventBase {
	type: "workflow_update";
	slug: string;
	phase: string;
	workflow: WorkflowRecord;
}

export interface PingEvent {
	type: "ping";
}

export interface PongEvent {
	type: "pong";
}

export type ScribeServerEvent = ConnectedEvent | WorkflowUpdateEvent | PongEvent;
export type ScribeEvent = ScribeServerEvent | PingEvent;

export type ClientFilter =
	| { kind: "spec"; slug: string }
	| { kind: "plan"; id: string };

const FILTER_RE = /^(spec|plan):([a-z][a-z0-9-]*)$/;

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
