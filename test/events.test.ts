import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	isScribeEventType,
	parseClientFilter,
	parseClientFilters,
	validateServerEventFrame,
} from "../src/events.ts";

describe("events", () => {
	it("parseClientFilter accepts spec and plan slugs", () => {
		assert.deepEqual(parseClientFilter("spec:ged-a"), { kind: "spec", slug: "ged-a" });
		assert.deepEqual(parseClientFilter("plan:ged-a-plan"), { kind: "plan", id: "ged-a-plan" });
		assert.equal(parseClientFilter("bad"), null);
	});

	it("parseClientFilters collects repeatable query values", () => {
		const params = new URLSearchParams("filter=spec:a&filter=plan:p1");
		assert.deepEqual(parseClientFilters(params), [
			{ kind: "spec", slug: "a" },
			{ kind: "plan", id: "p1" },
		]);
	});

	it("isScribeEventType recognizes wire types", () => {
		assert.equal(isScribeEventType("spec_updated"), true);
		assert.equal(isScribeEventType("unknown"), false);
	});

	it("validateServerEventFrame requires event_id and seq", () => {
		assert.equal(
			validateServerEventFrame({
				type: "spec_updated",
				event_id: "e1",
				seq: 1,
				project: "ged",
				spec: { slug: "a" },
				cause: "patchSpec",
			}).ok,
			true,
		);
		assert.equal(validateServerEventFrame({ type: "spec_updated" }).ok, false);
	});
});
