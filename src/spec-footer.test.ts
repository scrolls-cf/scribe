import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSpecFooterFields } from "./spec-footer.ts";
import { toSpecOrientView, normalizeSpecRecord } from "./spec.ts";

describe("parseSpecFooterFields", () => {
	it("extracts implementation status table fields", () => {
		const body = `## Implementation status

| **Status** | Pending |
| **Terminal skill** | cloudflare |
| **Design lane** | n/a |
| **Plan** | ged-a-plan |
| **Review gate** | passed |
| **Plan review** | required |
`;
		const fields = parseSpecFooterFields(body);
		assert.equal(fields.terminal_skill, "cloudflare");
		assert.equal(fields.design_lane, "n/a");
		assert.equal(fields.plan_id, "ged-a-plan");
		assert.equal(fields.review_gate, "passed");
		assert.equal(fields.plan_review, "required");
		assert.deepEqual(fields.worker_scope, []);
	});

	it("accepts Plan: field and worker scope", () => {
		const body = `## Implementation status

| **Plan:** | ged-a-plan |
| **Worker scope** | scribe, scrollsmatrix |
`;
		const fields = parseSpecFooterFields(body);
		assert.equal(fields.plan_id, "ged-a-plan");
		assert.deepEqual(fields.worker_scope, ["scribe", "scrollsmatrix"]);
	});
});

describe("toSpecOrientView", () => {
	it("combines summary, phases, and footer fields", () => {
		const record = normalizeSpecRecord({
			slug: "ged-a",
			title: "A",
			body: `## Implementation status

| **Terminal skill** | ged-implementer |
`,
			status: "ready",
			phases: [{ id: "1", title: "Orient", status: "pending" }],
			active_phase: "Orient",
			lock: null,
			etag: "e1",
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: "2026-01-01T00:00:00.000Z",
		});
		const orient = toSpecOrientView(record, parseSpecFooterFields(record.body));
		assert.equal(orient.slug, "ged-a");
		assert.equal(orient.phases.length, 1);
		assert.equal(orient.terminal_skill, "ged-implementer");
		assert.equal("body" in orient, false);
	});
});
