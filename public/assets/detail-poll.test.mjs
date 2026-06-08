import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	DETAIL_POLL_MS,
	getDetailPollEtag,
	setDetailPollEtag,
	startDetailPoll,
	stopDetailPoll,
} from "./detail-poll.js";

describe("detail-poll", () => {
	it("exports 15s poll interval", () => {
		assert.equal(DETAIL_POLL_MS, 15_000);
	});

	it("tracks etag and stops cleanly", () => {
		stopDetailPoll();
		setDetailPollEtag("etag-a");
		assert.equal(getDetailPollEtag(), "etag-a");
		let ticks = 0;
		startDetailPoll({
			shouldContinue: () => ticks < 1,
			tick: async () => {
				ticks++;
			},
		});
		stopDetailPoll();
		assert.equal(getDetailPollEtag(), null);
	});
});
