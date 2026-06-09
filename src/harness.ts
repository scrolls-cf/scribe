import type { ClientFilter } from "./events.ts";
import type { LockHolder } from "./identity.ts";
import {
	listWorkflows,
	type DurableStorageLike,
	type WorkflowPhase,
	type WorkflowRecord,
} from "./workflow.ts";

export interface HarnessCommand {
	type: string;
	summary: string;
	body?: Record<string, string>;
}

export const HARNESS_COMMANDS: HarnessCommand[] = [
	{ type: "ping", summary: "keepalive; server replies pong" },
	{
		type: "workflow_create",
		summary: "start new spec workflow from draft outline",
		body: { slug: "kebab-case id", draft: "rough feature outline" },
	},
	{
		type: "workflow_patch",
		summary: "update draft, spec, plan, or design text",
		body: { slug: "workflow id", spec: "optional", plan: "optional", design: "optional" },
	},
	{
		type: "workflow_advance",
		summary: "move to next phase when prerequisites met",
		body: { slug: "workflow id" },
	},
	{
		type: "workflow_lock",
		summary: "claim plan_review workflow for this agent",
		body: { slug: "workflow id" },
	},
	{
		type: "workflow_progress",
		summary: "report implement-phase progress",
		body: { slug: "workflow id", phase: "step name", summary: "what changed" },
	},
	{
		type: "workflow_get",
		summary: "refresh one workflow snapshot",
		body: { slug: "workflow id" },
	},
	{ type: "workflow_list", summary: "refresh all workflow snapshots" },
];

export interface HarnessAction {
	command: string;
	summary: string;
	ready: boolean;
	blocker?: string;
}

export interface WorkflowHarnessView {
	slug: string;
	phase: WorkflowPhase;
	workflow: WorkflowRecord;
	guidance: string;
	actions: HarnessAction[];
	locked_by_you: boolean;
}

export interface HarnessContext {
	role: "scribe_harness";
	holder: LockHolder;
	filters: ClientFilter[];
	commands: HarnessCommand[];
	workflows: WorkflowHarnessView[];
	summary: string;
}

function matchesFilters(slug: string, filters: ClientFilter[]): boolean {
	if (filters.length === 0) return true;
	return filters.some((f) => {
		if (f.kind === "spec") return f.slug === slug;
		if (f.kind === "plan") return f.id === slug;
		return false;
	});
}

function isLockHolder(workflow: WorkflowRecord, holder: LockHolder): boolean {
	return workflow.locked_by === holder.holder_id;
}

function canMutate(workflow: WorkflowRecord, holder: LockHolder): boolean {
	if (workflow.phase === "ship") return false;
	if (!workflow.locked_by) return true;
	return isLockHolder(workflow, holder);
}

export function describeWorkflowHarness(
	workflow: WorkflowRecord,
	holder: LockHolder,
): WorkflowHarnessView {
	const lockedByYou = isLockHolder(workflow, holder);
	const canEdit = canMutate(workflow, holder);
	const actions: HarnessAction[] = [];
	let guidance = "";

	const patch = (fields: string, summary: string, ready = canEdit, blocker?: string) => {
		actions.push({
			command: "workflow_patch",
			summary: `${summary} (${fields})`,
			ready,
			blocker: ready ? undefined : blocker,
		});
	};

	const advance = (summary: string, ready: boolean, blocker?: string) => {
		actions.push({
			command: "workflow_advance",
			summary,
			ready: ready && canEdit,
			blocker: ready && canEdit ? undefined : blocker ?? (canEdit ? undefined : `locked by ${workflow.locked_by}`),
		});
	};

	switch (workflow.phase) {
		case "draft":
			guidance = "Review/refactor draft into a proper spec.";
			patch("spec", "write or refine spec from draft", canEdit);
			advance(
				"move to spec phase",
				!!workflow.spec.trim(),
				"set spec via workflow_patch first",
			);
			break;
		case "spec":
			guidance = "Spec ready — write implementation plan.";
			patch("spec", "refine spec during review");
			patch("plan", "write implementation plan");
			advance(
				"enter plan review",
				!!workflow.plan.trim(),
				"set plan via workflow_patch first",
			);
			break;
		case "plan_review":
			guidance = "Review/refactor spec and plan until ready to lock.";
			patch("spec", "refine spec");
			patch("plan", "refine plan");
			actions.push({
				command: "workflow_lock",
				summary: "lock plan to this agent",
				ready: canEdit && !workflow.locked_by,
				blocker: workflow.locked_by ? `locked by ${workflow.locked_by}` : undefined,
			});
			break;
		case "locked":
			guidance = lockedByYou
				? "Plan locked to you — start design using spec + plan as context."
				: `Plan locked to ${workflow.locked_by} — wait or coordinate.`;
			if (lockedByYou) {
				patch("design", "capture design notes/summary");
				advance("start design phase", true);
			}
			break;
		case "design":
			guidance = lockedByYou || !workflow.locked_by
				? "Finish design; spec + plan are context for implementation."
				: `Locked to ${workflow.locked_by}.`;
			patch("design", "update design summary", canEdit);
			advance("start implementation", canEdit);
			break;
		case "implement":
			guidance = "Implement plan; report progress each phase.";
			actions.push({
				command: "workflow_progress",
				summary: "report phase progress",
				ready: canEdit,
				blocker: canEdit ? undefined : `locked by ${workflow.locked_by}`,
			});
			advance("finish implementation", canEdit);
			break;
		case "final_review":
			guidance = "Final review/refactor loop before ship.";
			patch("spec", "final spec tweaks", canEdit);
			patch("plan", "final plan tweaks", canEdit);
			patch("design", "final design tweaks", canEdit);
			advance("mark ready to ship", canEdit);
			break;
		case "ship":
			guidance = "Workflow complete — commit and deploy outside scribe.";
			break;
	}

	return {
		slug: workflow.slug,
		phase: workflow.phase,
		workflow,
		guidance,
		actions,
		locked_by_you: lockedByYou,
	};
}

export function summarizeHarness(views: WorkflowHarnessView[]): string {
	if (views.length === 0) return "No workflows yet — send workflow_create to start.";
	if (views.length === 1) {
		const v = views[0];
		return `${v.slug} is in ${v.phase}: ${v.guidance}`;
	}
	const active = views.filter((v) => v.phase !== "ship");
	if (active.length === 0) return `${views.length} workflow(s); all shipped.`;
	return `${active.length} active workflow(s) across phases: ${active.map((v) => `${v.slug}@${v.phase}`).join(", ")}`;
}

export async function buildHarnessContext(
	storage: DurableStorageLike,
	holder: LockHolder,
	filters: ClientFilter[],
): Promise<HarnessContext> {
	const all = await listWorkflows(storage);
	const workflows = all
		.filter((w) => matchesFilters(w.slug, filters))
		.map((w) => describeWorkflowHarness(w, holder));

	return {
		role: "scribe_harness",
		holder,
		filters,
		commands: HARNESS_COMMANDS,
		workflows,
		summary: summarizeHarness(workflows),
	};
}
