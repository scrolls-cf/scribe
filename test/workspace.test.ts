import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	computeWorkspaceManifest,
	isLegacyAgentsWorkerPath,
	validatePlatformRoot,
} from "../src/workspace.ts";

describe("validatePlatformRoot", () => {
	it("accepts absolute forward-slash paths", () => {
		const parsed = validatePlatformRoot("C:/Users/me/source/ged");
		assert.equal(parsed.ok, true);
		if (parsed.ok) assert.equal(parsed.value, "C:/Users/me/source/ged");
	});

	it("normalizes backslashes", () => {
		const parsed = validatePlatformRoot("C:\\Users\\me\\source\\ged");
		assert.equal(parsed.ok, true);
		if (parsed.ok) assert.equal(parsed.value, "C:/Users/me/source/ged");
	});

	it("rejects relative paths", () => {
		const parsed = validatePlatformRoot("workspace/ged");
		assert.equal(parsed.ok, false);
	});

	it("rejects legacy agents paths", () => {
		const parsed = validatePlatformRoot("C:/Users/me/agents/worktrees/ged");
		assert.equal(parsed.ok, false);
	});
});

describe("computeWorkspaceManifest", () => {
	it("derives deterministic paths from spec_slug", () => {
		const lock = {
			agent_id: "ged-orchestrator",
			acquired_at: "2026-06-08T00:00:00.000Z",
			holder_kind: "agent" as const,
			expires_at: "2026-06-08T04:00:00.000Z",
			lease_seconds: 14_400,
		};
		const manifest = computeWorkspaceManifest(
			"ged-feature-a",
			"plan",
			"C:/Users/me/source/ged",
			lock,
		);
		assert.equal(manifest.id, "ged-feature-a");
		assert.equal(manifest.branch, "ged/ged-feature-a");
		assert.equal(manifest.worktree_path, "C:/Users/me/source/ged/workspace/agents/ged-feature-a");
		assert.equal(
			manifest.scribe_worker_root,
			"C:/Users/me/source/ged/workspace/agents/ged-feature-a/workspace/scribe",
		);
	});
});

describe("isLegacyAgentsWorkerPath", () => {
	it("detects agents segment", () => {
		assert.equal(isLegacyAgentsWorkerPath("C:/foo/agents/bar"), true);
		assert.equal(isLegacyAgentsWorkerPath("C:/foo/workspace/scribe"), false);
	});
});
