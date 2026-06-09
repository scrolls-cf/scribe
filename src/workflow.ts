/** Scribe harness workflow — draft → spec → plan → lock → design → implement → ship */

export const WORKFLOW_PHASES = [
	"draft",
	"spec",
	"plan_review",
	"locked",
	"design",
	"implement",
	"final_review",
	"ship",
] as const;

export type WorkflowPhase = (typeof WORKFLOW_PHASES)[number];

export interface ProgressEntry {
	phase: string;
	summary: string;
	at: string;
}

export interface WorkflowRecord {
	slug: string;
	phase: WorkflowPhase;
	draft: string;
	spec: string;
	plan: string;
	design: string;
	locked_by: string | null;
	locked_kind: "user" | "agent" | null;
	progress: ProgressEntry[];
	updated_at: string;
}

export interface DurableStorageLike {
	get<T>(key: string): Promise<T | undefined>;
	put(key: string, value: unknown): Promise<void>;
	list(options?: { prefix?: string }): Promise<Map<string, unknown>>;
}

const SLUG_RE = /^[a-z][a-z0-9-]*$/;

export function isValidSlug(slug: string): boolean {
	return SLUG_RE.test(slug);
}

export function workflowKey(slug: string): string {
	return `workflow:${slug}`;
}

export async function getWorkflow(
	storage: DurableStorageLike,
	slug: string,
): Promise<WorkflowRecord | null> {
	const record = await storage.get<WorkflowRecord>(workflowKey(slug));
	return record ?? null;
}

export async function listWorkflows(storage: DurableStorageLike): Promise<WorkflowRecord[]> {
	const map = await storage.list({ prefix: "workflow:" });
	const out: WorkflowRecord[] = [];
	for (const value of map.values()) {
		if (value && typeof value === "object" && "slug" in value) {
			out.push(value as WorkflowRecord);
		}
	}
	return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

export function emptyWorkflow(slug: string, draft: string): WorkflowRecord {
	const now = new Date().toISOString();
	return {
		slug,
		phase: "draft",
		draft,
		spec: "",
		plan: "",
		design: "",
		locked_by: null,
		locked_kind: null,
		progress: [],
		updated_at: now,
	};
}

const NEXT_PHASE: Partial<Record<WorkflowPhase, WorkflowPhase>> = {
	draft: "spec",
	spec: "plan_review",
	locked: "design",
	design: "implement",
	implement: "final_review",
	final_review: "ship",
};

export type WorkflowErrorCode =
	| "invalid_slug"
	| "not_found"
	| "invalid_phase"
	| "missing_spec"
	| "missing_plan"
	| "not_lockable"
	| "already_locked";

export class WorkflowError extends Error {
	code: WorkflowErrorCode;

	constructor(code: WorkflowErrorCode, message: string) {
		super(message);
		this.name = "WorkflowError";
		this.code = code;
	}
}

export interface PatchWorkflowInput {
	spec?: string;
	plan?: string;
	design?: string;
	draft?: string;
}

export function patchWorkflow(record: WorkflowRecord, input: PatchWorkflowInput): WorkflowRecord {
	const now = new Date().toISOString();
	const next = { ...record, updated_at: now };
	if (input.draft !== undefined) next.draft = input.draft;
	if (input.spec !== undefined) next.spec = input.spec;
	if (input.plan !== undefined) next.plan = input.plan;
	if (input.design !== undefined) next.design = input.design;
	return next;
}

export function advanceWorkflow(record: WorkflowRecord): WorkflowRecord {
	const target = NEXT_PHASE[record.phase];
	if (!target) {
		throw new WorkflowError("invalid_phase", `cannot advance from ${record.phase}`);
	}
	if (record.phase === "draft" && !record.spec.trim()) {
		throw new WorkflowError("missing_spec", "spec required before leaving draft");
	}
	if (record.phase === "spec" && !record.plan.trim()) {
		throw new WorkflowError("missing_plan", "plan required before plan review");
	}
	return { ...record, phase: target, updated_at: new Date().toISOString() };
}

export function lockWorkflow(
	record: WorkflowRecord,
	holderId: string,
	holderKind: "user" | "agent",
): WorkflowRecord {
	if (record.phase !== "plan_review") {
		throw new WorkflowError("not_lockable", "only plan_review workflows can be locked");
	}
	if (record.locked_by) {
		throw new WorkflowError("already_locked", "workflow already locked");
	}
	return {
		...record,
		phase: "locked",
		locked_by: holderId,
		locked_kind: holderKind,
		updated_at: new Date().toISOString(),
	};
}

export function appendProgress(
	record: WorkflowRecord,
	phase: string,
	summary: string,
): WorkflowRecord {
	if (record.phase !== "implement") {
		throw new WorkflowError("invalid_phase", "progress only during implement");
	}
	const entry: ProgressEntry = {
		phase: phase.trim(),
		summary: summary.trim(),
		at: new Date().toISOString(),
	};
	return {
		...record,
		progress: [...record.progress, entry],
		updated_at: new Date().toISOString(),
	};
}

export async function saveWorkflow(
	storage: DurableStorageLike,
	record: WorkflowRecord,
): Promise<WorkflowRecord> {
	await storage.put(workflowKey(record.slug), record);
	return record;
}
