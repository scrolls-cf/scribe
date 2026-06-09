import type { PlanRecord } from "./plan.ts";
import { toPlanSummary } from "./plan.ts";
import { parseTakeInput, type TakeInput } from "./queue.ts";
import { parseSpecFooterFields } from "./spec-footer.ts";
import { toSpecSummary, type SpecRecord } from "./spec.ts";

export type AgentAssignmentMode =
	| "implement"
	| "review"
	| "phase_bridge"
	| "resume"
	| "plan_required"
	| "idle";

export interface AgentAssignment {
	agent_id: string;
	mode: AgentAssignmentMode;
	spec_slug: string;
	plan_id?: string | null;
	phase_id?: string | null;
	phase_title?: string | null;
	phase_index?: number | null;
	take_kind?: string;
	terminal_skill?: string | null;
	design_lane?: string | null;
	active_phase?: string | null;
	review_gate?: string | null;
	plan_review?: string | null;
	worker_scope?: string[];
	next_actions: string[];
	workspace?: Record<string, unknown>;
	endpoints: {
		project: string;
		spec: string;
		plan?: string;
		queue_take: string;
		check_in: string;
		release_spec_lock: string;
		release_plan_lock?: string;
	};
}

export interface AgentCheckInInput extends TakeInput {
	resume_slug?: string;
}

export function parseAgentCheckInInput(
	raw: unknown,
): { ok: true; value: AgentCheckInInput } | { ok: false; error: string } {
	if (!raw || typeof raw !== "object") {
		return { ok: false, error: "body must be a JSON object" };
	}
	const m = raw as Record<string, unknown>;
	const takeParsed = parseTakeInput(raw);
	if (!takeParsed.ok) return takeParsed;

	let resume_slug: string | undefined;
	if (m.resume_slug !== undefined) {
		if (typeof m.resume_slug !== "string" || !m.resume_slug.trim()) {
			return { ok: false, error: "resume_slug must be a non-empty string" };
		}
		resume_slug = m.resume_slug.trim();
	}

	return {
		ok: true,
		value: { ...takeParsed.value, resume_slug },
	};
}

function projectEndpoints(project: string, specSlug: string, planId?: string | null) {
	const base = `/v1/projects/${project}`;
	return {
		project: base,
		spec: `${base}/specs/${encodeURIComponent(specSlug)}`,
		...(planId ? { plan: `${base}/plans/${encodeURIComponent(planId)}` } : {}),
		queue_take: `${base}/queue/take`,
		check_in: `${base}/agents/check-in`,
		release_spec_lock: `${base}/specs/${encodeURIComponent(specSlug)}/lock`,
		...(planId
			? { release_plan_lock: `${base}/plans/${encodeURIComponent(planId)}/lock` }
			: {}),
	};
}

function classifyTakeMode(take: Record<string, unknown>): AgentAssignmentMode {
	const kind = typeof take.kind === "string" ? take.kind : "";
	if (kind === "phase") return "implement";
	if (kind === "phase_bridge") return "phase_bridge";
	if (kind === "spec") return "review";
	return "idle";
}

function footerFields(spec: SpecRecord | ReturnType<typeof toSpecSummary>) {
	const body = "body" in spec && typeof spec.body === "string" ? spec.body : "";
	const footer = parseSpecFooterFields(body);
	return {
		terminal_skill: spec.terminal_skill ?? footer.terminal_skill ?? null,
		design_lane: spec.design_lane ?? footer.design_lane ?? null,
		active_phase: spec.active_phase ?? footer.active_phase ?? null,
		review_gate: spec.review_gate ?? footer.review_gate ?? null,
		plan_review: spec.plan_review ?? footer.plan_review ?? null,
		worker_scope: spec.worker_scope ?? [],
	};
}

export function nextActionsForMode(
	mode: AgentAssignmentMode,
	ctx: {
		spec_slug: string;
		plan_id?: string | null;
		phase_id?: string | null;
		active_phase?: string | null;
	},
): string[] {
	const { spec_slug, plan_id, phase_id, active_phase } = ctx;
	switch (mode) {
		case "implement":
			return [
				`Read spec ${spec_slug} and plan ${plan_id ?? "linked"} via production scribe HTTP`,
				phase_id
					? `Implement plan phase ${phase_id} — patchPlan / worker edits only in scope`
					: "Implement active plan phase",
				"On phase complete: orchestrateTransition phase_done or patchPlan phases",
				"When all plan rows done: verify then ship via ged-orchestrator phase 6–7",
			];
		case "review":
			return [
				`4a spec review on ${spec_slug} — Task ged-platform-expert readonly`,
				"On pass: orchestrateTransition review_passed",
				"Then 4c plan if plan_review required",
			];
		case "phase_bridge":
			return [
				`Execute phase-bridge row for ${spec_slug} (active_phase: ${active_phase ?? "unknown"})`,
				"patchSpec to mark spec ## Phases row Complete",
				"Re check-in or pipeline:route for next item",
			];
		case "resume":
			return [
				`Resume work on ${spec_slug} — lock already held`,
				active_phase
					? `Continue orchestrator phase: ${active_phase}`
					: "Continue from footer active_phase",
				"Do not call queue/take again until lock released",
			];
		case "plan_required":
			return [
				`Spec ${spec_slug} needs plan — run buildPlanFromSpec + savePlan (4c)`,
				"Then implement or re check-in",
			];
		default:
			return ["No assignment — queue empty or blocked; wait for lease expiry or release stale locks"];
	}
}

export function buildAgentAssignmentFromTake(
	project: string,
	agentId: string,
	take: Record<string, unknown>,
): AgentAssignment | null {
	if (take.empty === true) return null;

	const mode = classifyTakeMode(take);
	const spec =
		take.spec && typeof take.spec === "object"
			? (take.spec as ReturnType<typeof toSpecSummary>)
			: null;
	const plan =
		take.plan && typeof take.plan === "object"
			? (take.plan as ReturnType<typeof toPlanSummary>)
			: null;

	const spec_slug =
		(typeof take.spec_slug === "string" ? take.spec_slug : null) ??
		spec?.slug ??
		plan?.spec_slug ??
		"";
	if (!spec_slug) return null;

	const plan_id =
		(typeof take.plan_id === "string" ? take.plan_id : null) ?? plan?.id ?? spec?.plan_id ?? null;
	const phase =
		take.phase && typeof take.phase === "object"
			? (take.phase as { id?: string; title?: string; index?: number })
			: null;
	const phase_id =
		phase?.id ??
		(typeof take.phase_id === "string" ? take.phase_id : null) ??
		null;
	const fields = spec
		? footerFields(spec)
		: {
				terminal_skill: null,
				design_lane: null,
				active_phase: null,
				review_gate: null,
				plan_review: null,
				worker_scope: [] as string[],
			};

	const assignment: AgentAssignment = {
		agent_id: agentId,
		mode: take.plan_required === true ? "plan_required" : mode,
		spec_slug,
		plan_id,
		phase_id,
		phase_title: phase?.title ?? (typeof take.phase_name === "string" ? take.phase_name : null),
		phase_index: phase?.index ?? null,
		take_kind: typeof take.kind === "string" ? take.kind : undefined,
		...fields,
		next_actions: nextActionsForMode(
			take.plan_required === true ? "plan_required" : mode,
			{
				spec_slug,
				plan_id,
				phase_id,
				active_phase: fields.active_phase,
			},
		),
		endpoints: projectEndpoints(project, spec_slug, plan_id),
	};

	if (take.workspace && typeof take.workspace === "object") {
		assignment.workspace = take.workspace as Record<string, unknown>;
	}

	return assignment;
}

export function buildAgentAssignmentFromResume(
	project: string,
	agentId: string,
	spec: SpecRecord,
	plan: PlanRecord | null,
): AgentAssignment {
	const fields = footerFields(spec);
	const plan_id = plan?.id ?? spec.plan_id ?? null;
	const mode: AgentAssignmentMode =
		fields.review_gate?.toLowerCase().startsWith("pending") ? "review" : "resume";

	return {
		agent_id: agentId,
		mode,
		spec_slug: spec.slug,
		plan_id,
		...fields,
		next_actions: nextActionsForMode(mode, {
			spec_slug: spec.slug,
			plan_id,
			active_phase: fields.active_phase,
		}),
		endpoints: projectEndpoints(project, spec.slug, plan_id),
	};
}
