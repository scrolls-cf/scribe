import type { PlanPhase, PlanRecord } from "./plan.ts";
import type { SpecRecord } from "./spec.ts";

/** Minimum non-boilerplate checkbox tasks before plan may skip forced 4c review. */
export const MIN_PLAN_SUBSTANTIVE_TASKS = 3;

/** Minimum substantive spec markdown (excluding footer) before implement. */
export const MIN_SPEC_BODY_CHARS = 80;

const RESEARCH_PHASE_RE =
	/inventory|audit|coverage|taxonomy|research|root-cause/i;

const PLAN_BOILERPLATE_RES: RegExp[] = [
	/graphify\s+query/i,
	/\bgetSpec\b/i,
	/confirm\s+footer\s+terminal_skill/i,
	/confirm\s+footer\s+design_lane/i,
	/phase\s+complete\s*\(mark\s+via\s+patchPlan\)/i,
	/generated\s+by\s+`?scripts\/pipeline\/spec-to-plan/i,
	/^linked\s+spec:/i,
	/—\s*owner:\s*(orch|orchestrator)\s*$/i,
];

export class OrchestrationGateError extends Error {
	readonly code: string;

	constructor(code: string, message?: string) {
		super(message ?? code);
		this.name = "OrchestrationGateError";
		this.code = code;
	}
}

function extractSection(content: string, heading: string): string | null {
	const re = new RegExp(`^## ${heading}\\r?\\n`, "im");
	const match = re.exec(content);
	if (!match) return null;
	const start = match.index + match[0].length;
	const tail = content.slice(start);
	const nextHeading = tail.search(/^## /m);
	return nextHeading === -1 ? tail : tail.slice(0, nextHeading);
}

export function isResearchPlanPhase(phase: Pick<PlanPhase, "title" | "body">): boolean {
	const label = `${phase.title ?? ""} ${phase.body ?? ""}`;
	return RESEARCH_PHASE_RE.test(label);
}

export function isBoilerplatePlanTaskLine(line: string): boolean {
	const text = line.replace(/^-\s+\[(?: |x|X)\]\s+/, "").trim();
	if (!text) return true;
	return PLAN_BOILERPLATE_RES.some((re) => re.test(text));
}

export function listPlanCheckboxLines(body: string): string[] {
	const lines: string[] = [];
	for (const line of body.split("\n")) {
		if (/^-\s+\[(?: |x|X)\]\s+/.test(line)) lines.push(line);
	}
	return lines;
}

export function countSubstantivePlanTasks(plan: Pick<PlanRecord, "body" | "phases">): number {
	const bodies = [plan.body ?? "", ...(plan.phases ?? []).map((p) => p.body ?? "")];
	let count = 0;
	for (const body of bodies) {
		for (const line of listPlanCheckboxLines(body)) {
			if (!isBoilerplatePlanTaskLine(line)) count += 1;
		}
	}
	return count;
}

export function isThinOrBoilerplatePlan(plan: Pick<PlanRecord, "body" | "phases">): boolean {
	return countSubstantivePlanTasks(plan) < MIN_PLAN_SUBSTANTIVE_TASKS;
}

export function specBodyWithoutFooter(body: string): string {
	const withoutFooter = body.replace(/## Implementation status[\s\S]*/i, "").trim();
	return withoutFooter.replace(/^#\s+.+$/m, "").trim();
}

export function isSpecBodySubstantive(body: string): boolean {
	return specBodyWithoutFooter(body).length >= MIN_SPEC_BODY_CHARS;
}

export function hasOpenAcceptanceCriteria(body: string): boolean {
	const section = extractSection(body, "Acceptance criteria");
	if (!section) return false;
	return /^-\s+\[\s*\]/m.test(section);
}

export interface PhaseEvidenceInput {
	evidence?: string | null;
	gate_command?: string | null;
	stdout_hash?: string | null;
}

export function resolvePhaseEvidence(
	phase: PlanPhase,
	payload: PhaseEvidenceInput = {},
): { evidence: string; gate_command: string; stdout_hash: string } {
	return {
		evidence: (payload.evidence ?? phase.evidence ?? "").trim(),
		gate_command: (payload.gate_command ?? phase.gate_command ?? "").trim(),
		stdout_hash: (payload.stdout_hash ?? phase.stdout_hash ?? "").trim(),
	};
}

export function assertPhaseCompletionEvidence(
	phase: PlanPhase,
	payload: PhaseEvidenceInput = {},
): { evidence?: string; gate_command?: string; stdout_hash?: string } {
	const resolved = resolvePhaseEvidence(phase, payload);
	if (isResearchPlanPhase(phase)) {
		if (!resolved.evidence) {
			throw new OrchestrationGateError(
				"phase_evidence_required",
				`plan phase ${phase.id} requires evidence (task output path) before done`,
			);
		}
		return { evidence: resolved.evidence };
	}
	if (!resolved.gate_command || !resolved.stdout_hash) {
		throw new OrchestrationGateError(
			"phase_gate_evidence_required",
			`plan phase ${phase.id} requires gate_command and stdout_hash before done`,
		);
	}
	return {
		gate_command: resolved.gate_command,
		stdout_hash: resolved.stdout_hash,
	};
}

export function assertSpecBodyReadyForImplement(spec: Pick<SpecRecord, "body" | "slug">): void {
	if (!isSpecBodySubstantive(spec.body ?? "")) {
		throw new OrchestrationGateError(
			"spec_body_empty",
			`spec ${spec.slug} body must be non-empty before implement`,
		);
	}
}

export function assertAcceptanceCriteriaClosed(spec: Pick<SpecRecord, "body" | "slug">): void {
	if (hasOpenAcceptanceCriteria(spec.body ?? "")) {
		throw new OrchestrationGateError(
			"acceptance_criteria_open",
			`spec ${spec.slug} has open acceptance criteria`,
		);
	}
}

export function assertPlanReadyForImplementPromotion(
	plan: PlanRecord,
	spec: Pick<SpecRecord, "plan_review">,
): void {
	if (!isThinOrBoilerplatePlan(plan)) return;
	const review = (spec.plan_review ?? "").toLowerCase();
	if (review === "passed" || review.startsWith("passed")) return;
	throw new OrchestrationGateError(
		"plan_review_required",
		"thin or boilerplate plan requires plan review before implement",
	);
}

export function phasesBecomingDone(before: PlanPhase[], after: PlanPhase[]): PlanPhase[] {
	return after.filter((phase) => {
		const prev = before.find((p) => p.id === phase.id);
		return phase.status === "done" && prev?.status !== "done";
	});
}

export function applyPhaseEvidenceFields(
	phase: PlanPhase,
	evidence: ReturnType<typeof assertPhaseCompletionEvidence>,
): PlanPhase {
	return {
		...phase,
		...(evidence.evidence ? { evidence: evidence.evidence } : {}),
		...(evidence.gate_command ? { gate_command: evidence.gate_command } : {}),
		...(evidence.stdout_hash ? { stdout_hash: evidence.stdout_hash } : {}),
	};
}
