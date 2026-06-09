import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildHarnessContext } from "../src/harness.ts";
import { handleWorkflowMessage, parseWorkflowMessage } from "../src/workflow-ws.ts";

function memoryStorage() {
	const map = new Map<string, unknown>();
	return {
		async get<T>(key: string) {
			return map.get(key) as T | undefined;
		},
		async put(key: string, value: unknown) {
			map.set(key, value);
		},
		async list(options?: { prefix?: string }) {
			const out = new Map<string, unknown>();
			for (const [k, v] of map) {
				if (!options?.prefix || k.startsWith(options.prefix)) out.set(k, v);
			}
			return out;
		},
	};
}

function wsCtx(storage: ReturnType<typeof memoryStorage>) {
	const holder = { holder_id: "ged-stack", holder_kind: "agent" as const };
	const filters: [] = [];
	return {
		storage,
		holder,
		filters,
		harness: () => buildHarnessContext(storage, holder, filters),
		onChange: async () => {},
	};
}

describe("workflow-ws", () => {
	it("parseWorkflowMessage reads create command", () => {
		const msg = parseWorkflowMessage({
			type: "workflow_create",
			slug: "my-feature",
			draft: "idea",
		});
		assert.deepEqual(msg, { type: "workflow_create", slug: "my-feature", draft: "idea" });
	});

	it("handleWorkflowMessage creates and broadcasts via onChange", async () => {
		const storage = memoryStorage();
		const changes: string[] = [];
		const ctx = wsCtx(storage);
		ctx.onChange = async (r) => {
			changes.push(r.slug);
		};
		const reply = await handleWorkflowMessage(
			{ type: "workflow_create", slug: "my-feature", draft: "idea" },
			ctx,
		);
		assert.equal(reply?.type, "workflow_snapshot");
		if (reply?.type === "workflow_snapshot") {
			assert.equal(reply.workflow.phase, "draft");
			assert.equal(reply.harness.workflows.length, 1);
		}
		assert.deepEqual(changes, ["my-feature"]);
	});

	it("handleWorkflowMessage advances over websocket flow", async () => {
		const storage = memoryStorage();
		const ctx = wsCtx(storage);
		await handleWorkflowMessage(
			{ type: "workflow_create", slug: "ship-it", draft: "d" },
			ctx,
		);
		await handleWorkflowMessage(
			{
				type: "workflow_patch",
				slug: "ship-it",
				spec: "spec",
				plan: "plan",
			},
			ctx,
		);
		await handleWorkflowMessage({ type: "workflow_advance", slug: "ship-it" }, ctx);
		const snap = await handleWorkflowMessage({ type: "workflow_get", slug: "ship-it" }, ctx);
		assert.equal(snap?.type, "workflow_snapshot");
		if (snap?.type === "workflow_snapshot") {
			assert.equal(snap.workflow.phase, "spec");
		}
	});
});
