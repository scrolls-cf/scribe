import type { ClientFilter } from "./events.ts";
import type { HarnessContext } from "./harness.ts";
import type { LockHolder } from "./identity.ts";
import {
	appendProgress,
	advanceWorkflow,
	emptyWorkflow,
	getWorkflow,
	isValidSlug,
	listWorkflows,
	lockWorkflow,
	patchWorkflow,
	saveWorkflow,
	WorkflowError,
	type WorkflowRecord,
} from "./workflow.ts";

export type WorkflowClientMessage =
	| { type: "workflow_create"; slug: string; draft: string }
	| { type: "workflow_patch"; slug: string; draft?: string; spec?: string; plan?: string; design?: string }
	| { type: "workflow_advance"; slug: string }
	| { type: "workflow_lock"; slug: string }
	| { type: "workflow_progress"; slug: string; phase: string; summary: string }
	| { type: "workflow_get"; slug: string }
	| { type: "workflow_list" };

export type WorkflowServerReply =
	| { type: "workflow_snapshot"; workflow: WorkflowRecord; harness: HarnessContext }
	| { type: "workflow_list"; workflows: WorkflowRecord[]; harness: HarnessContext }
	| { type: "workflow_error"; error: string; message: string };

export interface WorkflowWsContext {
	storage: {
		get<T>(key: string): Promise<T | undefined>;
		put(key: string, value: unknown): Promise<void>;
		list(options?: { prefix?: string }): Promise<Map<string, unknown>>;
	};
	holder: LockHolder;
	filters: ClientFilter[];
	harness: () => Promise<HarnessContext>;
	onChange: (record: WorkflowRecord) => Promise<void>;
}

export function parseWorkflowMessage(raw: unknown): WorkflowClientMessage | null {
	if (!raw || typeof raw !== "object") return null;
	const msg = raw as { type?: string };
	if (typeof msg.type !== "string" || !msg.type.startsWith("workflow_")) return null;

	switch (msg.type) {
		case "workflow_create": {
			const slug = (msg as { slug?: string }).slug?.trim() ?? "";
			const draft = (msg as { draft?: string }).draft?.trim() ?? "";
			if (!slug || !draft) return null;
			return { type: "workflow_create", slug, draft };
		}
		case "workflow_patch": {
			const slug = (msg as { slug?: string }).slug?.trim() ?? "";
			if (!slug) return null;
			const body = msg as {
				draft?: string;
				spec?: string;
				plan?: string;
				design?: string;
			};
			return { type: "workflow_patch", slug, ...body };
		}
		case "workflow_advance":
		case "workflow_lock":
		case "workflow_get": {
			const slug = (msg as { slug?: string }).slug?.trim() ?? "";
			if (!slug) return null;
			return { type: msg.type, slug };
		}
		case "workflow_progress": {
			const slug = (msg as { slug?: string }).slug?.trim() ?? "";
			const phase = (msg as { phase?: string }).phase?.trim() ?? "";
			const summary = (msg as { summary?: string }).summary?.trim() ?? "";
			if (!slug || !phase || !summary) return null;
			return { type: "workflow_progress", slug, phase, summary };
		}
		case "workflow_list":
			return { type: "workflow_list" };
		default:
			return null;
	}
}

function workflowErrorReply(err: WorkflowError): WorkflowServerReply {
	return { type: "workflow_error", error: err.code, message: err.message };
}

export async function handleWorkflowMessage(
	msg: WorkflowClientMessage,
	ctx: WorkflowWsContext,
): Promise<WorkflowServerReply | null> {
	try {
		if (msg.type === "workflow_list") {
			const workflows = await listWorkflows(ctx.storage);
			return { type: "workflow_list", workflows, harness: await ctx.harness() };
		}

		if (!isValidSlug(msg.slug)) {
			return workflowErrorReply(new WorkflowError("invalid_slug", "invalid workflow slug"));
		}

		if (msg.type === "workflow_create") {
			const existing = await getWorkflow(ctx.storage, msg.slug);
			if (existing) {
				return { type: "workflow_error", error: "exists", message: "workflow already exists" };
			}
			const record = await saveWorkflow(ctx.storage, emptyWorkflow(msg.slug, msg.draft));
			await ctx.onChange(record);
			return { type: "workflow_snapshot", workflow: record, harness: await ctx.harness() };
		}

		const record = await getWorkflow(ctx.storage, msg.slug);
		if (!record) {
			return workflowErrorReply(new WorkflowError("not_found", "workflow not found"));
		}

		if (msg.type === "workflow_get") {
			return { type: "workflow_snapshot", workflow: record, harness: await ctx.harness() };
		}

		let updated: WorkflowRecord;

		if (msg.type === "workflow_patch") {
			updated = await saveWorkflow(
				ctx.storage,
				patchWorkflow(record, {
					draft: msg.draft,
					spec: msg.spec,
					plan: msg.plan,
					design: msg.design,
				}),
			);
		} else if (msg.type === "workflow_advance") {
			updated = await saveWorkflow(ctx.storage, advanceWorkflow(record));
		} else if (msg.type === "workflow_lock") {
			updated = await saveWorkflow(
				ctx.storage,
				lockWorkflow(record, ctx.holder.holder_id, ctx.holder.holder_kind),
			);
		} else if (msg.type === "workflow_progress") {
			updated = await saveWorkflow(
				ctx.storage,
				appendProgress(record, msg.phase, msg.summary),
			);
		} else {
			return null;
		}

		await ctx.onChange(updated);
		return { type: "workflow_snapshot", workflow: updated, harness: await ctx.harness() };
	} catch (err) {
		if (err instanceof WorkflowError) return workflowErrorReply(err);
		throw err;
	}
}
