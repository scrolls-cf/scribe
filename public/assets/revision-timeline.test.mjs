import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	auditEventLabel,
	auditRevisionCount,
	auditRevisionListMeta,
	formatReviewer,
} from "./api.js";
import {
	gateTransitionLabel,
	renderRevisionDetailHtml,
	renderRevisionTimelineListHtml,
} from "./revision-timeline.js";

describe("audit revision api helpers", () => {
	it("counts audit revisions from summary", () => {
		assert.equal(auditRevisionCount({ revisions_summary: { count: 3 } }), 3);
		assert.equal(auditRevisionCount({ revisions_summary: { count: 0 } }), 0);
		assert.equal(auditRevisionCount({}), 0);
	});

	it("labels audit events", () => {
		assert.equal(auditEventLabel("spec_review_pass"), "Spec review · passed");
		assert.match(auditEventLabel("unknown_event"), /unknown/);
	});

	it("formats reviewer", () => {
		assert.equal(
			formatReviewer({ holder_id: "u@x.com", holder_kind: "user" }),
			"User: u@x.com",
		);
	});

	it("list meta for audit trail", () => {
		assert.equal(
			auditRevisionListMeta({ revisions_summary: { count: 1 } }),
			"1 audit rev",
		);
		assert.equal(
			auditRevisionListMeta({ revisions_summary: { count: 4 } }),
			"4 audit revs",
		);
	});
});

describe("revision timeline render", () => {
	const entry = {
		id: "rev-1",
		event: "spec_review_revise",
		reason: "Narrow scope for v1.",
		reviewer: { holder_id: "agent-1", holder_kind: "agent" },
		created_at: "2026-06-08T12:00:00.000Z",
		before: { status: "blocked", footer_review_gate: "pending" },
		after: { status: "blocked", footer_review_gate: "revise" },
	};

	it("renders gate transition", () => {
		assert.match(gateTransitionLabel(entry), /Review gate pending → revise/);
	});

	it("renders timeline list html", () => {
		const html = renderRevisionTimelineListHtml([entry]);
		assert.match(html, /Spec review · revise/);
		assert.match(html, /rev-1/);
		assert.match(html, /revision-timeline-list/);
	});

	it("renders detail with unified diff", () => {
		const html = renderRevisionDetailHtml({
			...entry,
			diff: { body_changed: true, unified_diff: "+added line" },
		});
		assert.match(html, /Narrow scope/);
		assert.match(html, /\+added line/);
	});
});
