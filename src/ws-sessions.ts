import {
	EVENT_REPLAY_MAX_AGE_MS,
	EVENT_REPLAY_MAX_ENTRIES,
	parseClientFilters,
	type ClientFilter,
	type ConnectedEvent,
	type ScribeServerEvent,
	type WorkflowUpdateEvent,
} from "./events.ts";
import { buildHarnessContext, type HarnessContext } from "./harness.ts";
import type { LockHolder } from "./identity.ts";
import type { WorkflowRecord } from "./workflow.ts";

export const EVENT_SEQ_KEY = "events:seq";
export const EVENT_RING_KEY = "events:ring";

export interface StoredRingEntry {
	at: number;
	event: ScribeServerEvent;
}

export interface WsSessionAttachment {
	filters: ClientFilter[];
	since_seq: number;
	project: string;
	holder_id: string;
	holder_kind: "user" | "agent";
}

export interface DurableStorageLike {
	get<T>(key: string): Promise<T | undefined>;
	put(key: string, value: unknown): Promise<void>;
	list(options?: { prefix?: string }): Promise<Map<string, unknown>>;
}

export interface WsBroadcastContext {
	getWebSockets(): WebSocket[];
}

export function parseWsAttachment(raw: unknown): WsSessionAttachment | null {
	if (typeof raw !== "string" || !raw.trim()) return null;
	try {
		const parsed = JSON.parse(raw) as WsSessionAttachment;
		if (!parsed || typeof parsed !== "object") return null;
		return {
			filters: Array.isArray(parsed.filters) ? parsed.filters : [],
			since_seq: Number.isFinite(parsed.since_seq) ? parsed.since_seq : 0,
			project: typeof parsed.project === "string" ? parsed.project : "ged",
			holder_id: typeof parsed.holder_id === "string" ? parsed.holder_id : "",
			holder_kind: parsed.holder_kind === "user" ? "user" : "agent",
		};
	} catch {
		return null;
	}
}

export async function nextEventSeq(storage: DurableStorageLike): Promise<number> {
	const current = (await storage.get<number>(EVENT_SEQ_KEY)) ?? 0;
	const seq = current + 1;
	await storage.put(EVENT_SEQ_KEY, seq);
	return seq;
}

export async function appendEventRing(
	storage: DurableStorageLike,
	event: ScribeServerEvent,
	now = Date.now(),
): Promise<void> {
	const ring = (await storage.get<StoredRingEntry[]>(EVENT_RING_KEY)) ?? [];
	const cutoff = now - EVENT_REPLAY_MAX_AGE_MS;
	const pruned = ring.filter((entry) => entry.at >= cutoff);
	pruned.push({ at: now, event });
	while (pruned.length > EVENT_REPLAY_MAX_ENTRIES) pruned.shift();
	await storage.put(EVENT_RING_KEY, pruned);
}

export function replaySince(
	ring: StoredRingEntry[],
	sinceSeq: number,
	now = Date.now(),
): ScribeServerEvent[] {
	const cutoff = now - EVENT_REPLAY_MAX_AGE_MS;
	return ring
		.filter(
			(entry) =>
				entry.at >= cutoff &&
				"seq" in entry.event &&
				typeof entry.event.seq === "number" &&
				entry.event.seq > sinceSeq,
		)
		.map((entry) => entry.event);
}

export function eventMatchesFilters(event: ScribeServerEvent, filters: ClientFilter[]): boolean {
	if (filters.length === 0) return true;
	if (event.type !== "workflow_update") return false;
	return filters.some((f) => {
		if (f.kind === "spec") return f.slug === event.slug;
		if (f.kind === "plan") return f.id === event.slug;
		return false;
	});
}

export interface ConnectSession {
	holder: LockHolder;
	filters: ClientFilter[];
}

export async function buildConnectedFrame(
	storage: DurableStorageLike,
	project: string,
	sinceSeq: number,
	session: ConnectSession,
): Promise<ConnectedEvent> {
	const seq = await nextEventSeq(storage);
	const ring = (await storage.get<StoredRingEntry[]>(EVENT_RING_KEY)) ?? [];
	const replay = replaySince(ring, sinceSeq);
	const harness = await buildHarnessContext(storage, session.holder, session.filters);
	const frame: ConnectedEvent = {
		type: "connected",
		event_id: crypto.randomUUID(),
		seq,
		project,
		replay,
		harness,
	};
	return frame;
}

export async function buildHarnessRefresh(
	storage: DurableStorageLike,
	holder: LockHolder,
	filters: ClientFilter[],
): Promise<HarnessContext> {
	return buildHarnessContext(storage, holder, filters);
}

export function isWebSocketUpgrade(request: Request): boolean {
	return request.headers.get("Upgrade")?.toLowerCase() === "websocket";
}

export function parseSinceSeq(url: URL): number {
	const raw = url.searchParams.get("since_seq");
	if (!raw) return 0;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function broadcastWorkflowUpdate(
	storage: DurableStorageLike,
	wsCtx: WsBroadcastContext,
	project: string,
	record: WorkflowRecord,
): Promise<WorkflowUpdateEvent> {
	const seq = await nextEventSeq(storage);
	const event: WorkflowUpdateEvent = {
		type: "workflow_update",
		event_id: crypto.randomUUID(),
		seq,
		project,
		slug: record.slug,
		phase: record.phase,
		workflow: record,
	};
	await appendEventRing(storage, event);
	const payload = JSON.stringify(event);
	for (const ws of wsCtx.getWebSockets()) {
		const attachment = parseWsAttachment(ws.deserializeAttachment());
		if (!attachment || attachment.project !== project) continue;
		if (!eventMatchesFilters(event, attachment.filters)) continue;
		ws.send(payload);
	}
	return event;
}

export { parseClientFilters };
