import {
	isPickablePlan,
	nextPickablePhase,
	planCompletion,
	type PlanPhase,
	type PlanRecord,
} from "./plan.ts";
import { normalizeSpecRecord, type SpecRecord } from "./spec.ts";

export type QueueCandidate =
	| { kind: "phase"; record: PlanRecord; phase: PlanPhase; completion_ratio: number }
	| { kind: "spec"; record: SpecRecord; completion_ratio: number };

export function isPickableSpec(record: SpecRecord): boolean {
	if (record.lock) return false;
	if (record.status === "done" || record.status === "blocked") return false;
	return true;
}

export function rankQueueCandidates(
	plans: PlanRecord[],
	specs: SpecRecord[],
	exclude: Set<string> = new Set(),
): QueueCandidate[] {
	const candidates: QueueCandidate[] = [];

	for (const record of plans) {
		if (!isPickablePlan(record)) continue;
		if (exclude.has(record.id)) continue;
		const phase = nextPickablePhase(record);
		if (!phase) continue;
		const excludePhase = `${record.id}/${phase.id}`;
		if (exclude.has(excludePhase)) continue;
		const { completion_ratio } = planCompletion(record);
		candidates.push({ kind: "phase", record, phase, completion_ratio });
	}

	for (const record of specs) {
		const normalized = normalizeSpecRecord(record);
		if (!isPickableSpec(normalized)) continue;
		if (exclude.has(normalized.slug)) continue;
		candidates.push({ kind: "spec", record: normalized, completion_ratio: 0 });
	}

	candidates.sort((a, b) => {
		if (b.completion_ratio !== a.completion_ratio) {
			return b.completion_ratio - a.completion_ratio;
		}
		if (a.kind !== b.kind) {
			return a.kind === "phase" ? -1 : 1;
		}
		return a.record.updated_at.localeCompare(b.record.updated_at);
	});

	return candidates;
}

export function pickNextCandidate(
	plans: PlanRecord[],
	specs: SpecRecord[],
	exclude: Set<string> = new Set(),
): QueueCandidate | null {
	const ranked = rankQueueCandidates(plans, specs, exclude);
	return ranked[0] ?? null;
}

export type TakeKind = "phase" | "plan" | "spec";

export function parseTakeInput(
	raw: unknown,
): { ok: true; value: { agent_id: string; exclude: string[]; kind?: TakeKind } } | { ok: false; error: string } {
	if (!raw || typeof raw !== "object") {
		return { ok: false, error: "body must be a JSON object" };
	}
	const m = raw as Record<string, unknown>;
	const agent_id = typeof m.agent_id === "string" ? m.agent_id.trim() : "";
	if (!agent_id || agent_id.length > 120) {
		return { ok: false, error: "agent_id is required" };
	}
	const exclude: string[] = [];
	if (m.exclude !== undefined) {
		if (!Array.isArray(m.exclude)) return { ok: false, error: "exclude must be an array" };
		for (const item of m.exclude) {
			if (typeof item !== "string" || !item.trim()) {
				return { ok: false, error: "exclude entries must be non-empty strings" };
			}
			exclude.push(item.trim());
		}
	}
	let kind: TakeKind | undefined;
	if (m.kind !== undefined) {
		if (m.kind !== "plan" && m.kind !== "phase" && m.kind !== "spec") {
			return { ok: false, error: "kind must be plan, phase, or spec" };
		}
		kind = m.kind;
	}
	return { ok: true, value: { agent_id, exclude, kind } };
}

export function matchesTakeKind(candidate: QueueCandidate, kind?: TakeKind): boolean {
	if (!kind) return true;
	if (kind === "spec") return candidate.kind === "spec";
	return candidate.kind === "phase";
}
