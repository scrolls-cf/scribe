import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	broadcastScribeEvent,
	buildConnectedFrame,
	eventMatchesFilters,
	replaySince,
	type StoredRingEntry,
} from "../src/ws-sessions.ts";

class MockStorage {
	#data = new Map<string, unknown>();
	async get<T>(key: string): Promise<T | undefined> {
		return this.#data.get(key) as T | undefined;
	}
	async put(key: string, value: unknown): Promise<void> {
		this.#data.set(key, value);
	}
}

describe("ws-sessions", () => {
	it("buildConnectedFrame increments seq and includes replay", async () => {
		const storage = new MockStorage();
		const ring: StoredRingEntry[] = [
			{
				at: Date.now(),
				event: { type: "pong" },
			},
		];
		await storage.put("events:ring", ring);
		const frame = await buildConnectedFrame(storage, "ged", 0);
		assert.equal(frame.type, "connected");
		assert.equal(frame.project, "ged");
		assert.ok(frame.seq >= 1);
	});

	it("broadcastScribeEvent fans out to matching websocket sessions", async () => {
		const storage = new MockStorage();
		const sent: string[] = [];
		const ws = {
			deserializeAttachment: () =>
				JSON.stringify({ filters: [{ kind: "spec", slug: "ged-a" }], since_seq: 0, project: "ged" }),
			send: (msg: string) => {
				sent.push(msg);
			},
		};
		const frame = await broadcastScribeEvent(
			storage,
			{ getWebSockets: () => [ws as unknown as WebSocket] },
			"ged",
			{
				type: "spec_updated",
				spec: { slug: "ged-a" } as never,
				cause: "patchSpec",
			},
		);
		assert.equal(frame.type, "spec_updated");
		assert.equal(sent.length, 1);
		assert.equal(JSON.parse(sent[0]).spec.slug, "ged-a");
	});

	it("eventMatchesFilters respects spec slug", () => {
		const filters = [{ kind: "spec" as const, slug: "ged-a" }];
		assert.equal(
			eventMatchesFilters(
				{
					type: "spec_updated",
					event_id: "1",
					seq: 1,
					project: "ged",
					spec: { slug: "ged-a" } as never,
					cause: "patchSpec",
				},
				filters,
			),
			true,
		);
		assert.equal(
			eventMatchesFilters(
				{
					type: "spec_updated",
					event_id: "1",
					seq: 1,
					project: "ged",
					spec: { slug: "ged-b" } as never,
					cause: "patchSpec",
				},
				filters,
			),
			false,
		);
	});

	it("replaySince drops events before since_seq", () => {
		const ring: StoredRingEntry[] = [
			{ at: Date.now(), event: { type: "pong" } },
			{
				at: Date.now(),
				event: {
					type: "spec_updated",
					event_id: "a",
					seq: 2,
					project: "ged",
					spec: {} as never,
					cause: "patchSpec",
				},
			},
		];
		const replay = replaySince(ring, 1);
		assert.equal(replay.length, 1);
		assert.equal(replay[0].type, "spec_updated");
	});
});
