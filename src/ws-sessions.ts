import {
	EVENT_REPLAY_MAX_AGE_MS,
	EVENT_REPLAY_MAX_ENTRIES,
	parseClientFilters,
	type ClientFilter,
	type ConnectedEvent,
	type LockChangedEvent,
	type PlanUpdatedEvent,
	type QueueTakenEvent,
	type ScribeServerEvent,
	type SpecUpdatedEvent,
	type TransitionAppliedEvent,
} from "./events.ts";

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
}

export interface DurableStorageLike {
	get<T>(key: string): Promise<T | undefined>;
	put(key: string, value: unknown): Promise<void>;
}

export interface WsBroadcastContext {
	getWebSockets(): WebSocket[];
}

/** Fan-out payload — `event_id`, `seq`, and `project` are assigned at broadcast time. */
export type ScribeBroadcastInput =
	| Omit<SpecUpdatedEvent, "event_id" | "seq" | "project">
	| Omit<PlanUpdatedEvent, "event_id" | "seq" | "project">
	| Omit<LockChangedEvent, "event_id" | "seq" | "project">
	| Omit<QueueTakenEvent, "event_id" | "seq" | "project">
	| Omit<TransitionAppliedEvent, "event_id" | "seq" | "project">;

export function parseWsAttachment(raw: unknown): WsSessionAttachment | null {
	if (typeof raw !== "string" || !raw.trim()) return null;
	try {
		const parsed = JSON.parse(raw) as WsSessionAttachment;
		if (!parsed || typeof parsed !== "object") return null;
		return {
			filters: Array.isArray(parsed.filters) ? parsed.filters : [],
			since_seq: Number.isFinite(parsed.since_seq) ? parsed.since_seq : 0,
			project: typeof parsed.project === "string" ? parsed.project : "ged",
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
	for (const filter of filters) {
		if (filter.kind === "spec" && event.type === "spec_updated" && event.spec?.slug === filter.slug) {
			return true;
		}
		if (filter.kind === "plan" && event.type === "plan_updated" && event.plan?.id === filter.id) {
			return true;
		}
		if (filter.kind === "spec" && event.type === "lock_changed" && event.spec_slug === filter.slug) {
			return true;
		}
		if (filter.kind === "plan" && event.type === "lock_changed" && event.plan_id === filter.id) {
			return true;
		}
		if (filter.kind === "spec" && event.type === "queue_taken" && event.spec_slug === filter.slug) {
			return true;
		}
		if (filter.kind === "plan" && event.type === "queue_taken" && event.plan_id === filter.id) {
			return true;
		}
	}
	return false;
}

export async function buildConnectedFrame(
	storage: DurableStorageLike,
	project: string,
	sinceSeq: number,
): Promise<ConnectedEvent> {
	const seq = await nextEventSeq(storage);
	const ring = (await storage.get<StoredRingEntry[]>(EVENT_RING_KEY)) ?? [];
	const replay = replaySince(ring, sinceSeq);
	const frame: ConnectedEvent = {
		type: "connected",
		event_id: crypto.randomUUID(),
		seq,
		project,
		replay,
	};
	await appendEventRing(storage, frame);
	return frame;
}

export async function broadcastScribeEvent(
	storage: DurableStorageLike,
	ctx: WsBroadcastContext,
	project: string,
	input: ScribeBroadcastInput,
	opts: { event_id?: string } = {},
): Promise<ScribeServerEvent> {
	const seq = await nextEventSeq(storage);
	const frame = {
		...input,
		event_id: opts.event_id ?? crypto.randomUUID(),
		seq,
		project,
	} as ScribeServerEvent;
	await appendEventRing(storage, frame);
	const payload = JSON.stringify(frame);
	for (const ws of ctx.getWebSockets()) {
		const attachment = parseWsAttachment(ws.deserializeAttachment());
		if (!attachment || attachment.project !== project) continue;
		if (!eventMatchesFilters(frame, attachment.filters)) continue;
		try {
			ws.send(payload);
		} catch {
			/* client disconnected */
		}
	}
	return frame;
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

export { parseClientFilters };
