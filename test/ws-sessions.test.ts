import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkflowUpdateEvent } from "../src/events.ts";
import { eventMatchesFilters } from "../src/ws-sessions.ts";

describe("ws-sessions", () => {
	it("eventMatchesFilters passes workflow_update for matching spec filter", () => {
		const event: WorkflowUpdateEvent = {
			type: "workflow_update",
			event_id: "e1",
			seq: 1,
			project: "ged",
			slug: "my-feature",
			phase: "draft",
			workflow: {
				slug: "my-feature",
				phase: "draft",
				draft: "idea",
				spec: "",
				plan: "",
				design: "",
				locked_by: null,
				locked_kind: null,
				progress: [],
				updated_at: "2026-01-01T00:00:00.000Z",
			},
		};
		assert.equal(eventMatchesFilters(event, [{ kind: "spec", slug: "my-feature" }]), true);
		assert.equal(eventMatchesFilters(event, [{ kind: "spec", slug: "other" }]), false);
	});
});
