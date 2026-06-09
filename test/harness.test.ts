import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildHarnessContext, describeWorkflowHarness } from "../src/harness.ts";
import { emptyWorkflow } from "../src/workflow.ts";

function memoryStorage(seed: Record<string, unknown> = {}) {
	const map = new Map(Object.entries(seed));
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

const agent = { holder_id: "ged-stack", holder_kind: "agent" as const };

describe("harness", () => {
	it("describeWorkflowHarness draft phase suggests spec patch", () => {
		const view = describeWorkflowHarness(emptyWorkflow("feat", "idea"), agent);
		assert.equal(view.phase, "draft");
		assert.match(view.guidance, /spec/i);
		assert.ok(view.actions.some((a) => a.command === "workflow_patch" && a.ready));
		assert.ok(view.actions.some((a) => a.command === "workflow_advance" && !a.ready));
	});

	it("describeWorkflowHarness plan_review offers lock", () => {
		const w = {
			...emptyWorkflow("feat", "d"),
			phase: "plan_review" as const,
			spec: "s",
			plan: "p",
		};
		const view = describeWorkflowHarness(w, agent);
		assert.ok(view.actions.some((a) => a.command === "workflow_lock" && a.ready));
	});

	it("buildHarnessContext empty state", async () => {
		const ctx = await buildHarnessContext(memoryStorage(), agent, []);
		assert.equal(ctx.role, "scribe_harness");
		assert.ok(ctx.commands.length > 0);
		assert.match(ctx.summary, /No workflows/);
	});

	it("buildHarnessContext respects spec filter", async () => {
		const a = emptyWorkflow("alpha", "d");
		const b = emptyWorkflow("beta", "d");
		const storage = memoryStorage({
			"workflow:alpha": a,
			"workflow:beta": b,
		});
		const ctx = await buildHarnessContext(storage, agent, [{ kind: "spec", slug: "alpha" }]);
		assert.equal(ctx.workflows.length, 1);
		assert.equal(ctx.workflows[0].slug, "alpha");
	});
});
