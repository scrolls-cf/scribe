import type { SpecLock, SpecStatus } from "./spec.ts";
import { parseLockInput } from "./spec.ts";

export type PlanTaskStatus = "pending" | "active" | "done";
export type PlanPhaseStatus = PlanTaskStatus;

export interface PlanTask {
	id: string;
	title: string;
	status: PlanTaskStatus;
}

export interface PlanDeploy {
	worker?: string;
	github_org?: string;
	github_repo?: string;
	github_branch?: string;
	builds_wired_at?: string | null;
}

export interface PlanPhase {
	id: string;
	index: number;
	title: string;
	status: PlanPhaseStatus;
	body: string;
	lock: SpecLock | null;
	completed_at?: string | null;
}

export interface PlanRecord {
	id: string;
	spec_slug: string;
	title: string;
	body: string;
	source?: string;
	status: SpecStatus;
	phases: PlanPhase[];
	tasks: PlanTask[];
	lock: SpecLock | null;
	user_instructions?: string;
	deploy?: PlanDeploy | null;
	etag: string;
	created_at: string;
	updated_at: string;
}

export interface PlanSummary {
	id: string;
	spec_slug: string;
	title: string;
	source?: string;
	status: SpecStatus;
	updated_at: string;
	phases_done: number;
	phases_total: number;
	tasks_done: number;
	tasks_total: number;
	completion_ratio: number;
	active_phase: Pick<PlanPhase, "id" | "index" | "title" | "status"> | null;
	lock: SpecLock | null;
	has_user_instructions: boolean;
	etag: string;
}

const PLAN_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const TASK_ID_RE = /^[a-z][a-z0-9-]*$/;
const PHASE_ID_RE = /^p\d+$/;
const STATUSES: SpecStatus[] = ["ready", "in_progress", "blocked", "done"];
const TASK_STATUSES: PlanTaskStatus[] = ["pending", "active", "done"];
const PHASE_HEADING_RE = /^##\s+(?:Phase|Wave)\s+(\d+)\b(.*)$/i;

export const PLAN_INDEX_KEY = "plan:index";

export function planKey(id: string): string {
	return `plan:${id}`;
}

function countCheckboxes(body: string): { done: number; total: number } {
	let done = 0;
	let total = 0;
	for (const line of body.split("\n")) {
		const m = line.match(/^-\s+\[( |x|X)\]\s+/);
		if (!m) continue;
		total += 1;
		if (m[1].toLowerCase() === "x") done += 1;
	}
	return { done, total };
}

function phaseStatusFromBody(body: string): PlanPhaseStatus {
	const { done, total } = countCheckboxes(body);
	if (total === 0) return "pending";
	if (done === total) return "done";
	if (done > 0) return "active";
	return "pending";
}

export function splitPlanPhasesFromBody(body: string): PlanPhase[] {
	const lines = body.split("\n");
	const headings: { index: number; title: string; line: number }[] = [];

	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(PHASE_HEADING_RE);
		if (!m) continue;
		const index = Number.parseInt(m[1], 10);
		if (Number.isNaN(index)) continue;
		let title = m[2].trim();
		title = title.replace(/^[(:-]\s*/, "").replace(/\)\s*$/, "").trim();
		headings.push({ index, title: title || `Phase ${index}`, line: i });
	}

	if (headings.length === 0) {
		const status = phaseStatusFromBody(body);
		return [
			{
				id: "p0",
				index: 0,
				title: "Phase 0",
				status,
				body: body.trim(),
				lock: null,
			},
		];
	}

	headings.sort((a, b) => a.index - b.index || a.line - b.line);
	const phases: PlanPhase[] = [];

	for (let i = 0; i < headings.length; i++) {
		const h = headings[i];
		const start = h.line + 1;
		const end = i + 1 < headings.length ? headings[i + 1].line : lines.length;
		const slice = lines.slice(start, end).join("\n").trim();
		phases.push({
			id: `p${h.index}`,
			index: h.index,
			title: h.title,
			status: phaseStatusFromBody(slice),
			body: slice,
			lock: null,
		});
	}

	return phases;
}

export function normalizePlanRecord(
	raw: PlanRecord | (Omit<PlanRecord, "status" | "tasks" | "phases" | "lock" | "etag"> & Partial<Pick<PlanRecord, "status" | "tasks" | "phases" | "lock" | "etag">>),
): PlanRecord {
	const phases =
		Array.isArray(raw.phases) && raw.phases.length > 0
			? raw.phases.map((p) => ({
					...p,
					lock: p.lock ?? null,
				}))
			: splitPlanPhasesFromBody(raw.body ?? "");
	const updated_at = raw.updated_at ?? raw.created_at ?? new Date().toISOString();
	return {
		...raw,
		status: raw.status ?? "ready",
		phases,
		tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
		lock: raw.lock ?? null,
		etag: raw.etag ?? updated_at,
		created_at: raw.created_at ?? updated_at,
		updated_at,
	};
}

export function planCompletion(record: PlanRecord): {
	phases_done: number;
	phases_total: number;
	tasks_done: number;
	tasks_total: number;
	completion_ratio: number;
} {
	const phases_done = record.phases.filter((p) => p.status === "done").length;
	const phases_total = record.phases.length;
	let tasks_done = 0;
	let tasks_total = 0;
	for (const phase of record.phases) {
		const c = countCheckboxes(phase.body);
		tasks_done += c.done;
		tasks_total += c.total;
	}
	if (tasks_total === 0 && record.tasks.length > 0) {
		tasks_done = record.tasks.filter((t) => t.status === "done").length;
		tasks_total = record.tasks.length;
	}
	const completion_ratio =
		phases_total > 0 ? phases_done / phases_total : tasks_total > 0 ? tasks_done / tasks_total : 0;
	return { phases_done, phases_total, tasks_done, tasks_total, completion_ratio };
}

export function nextPickablePhase(record: PlanRecord): PlanPhase | null {
	if (record.status === "done" || record.status === "blocked") return null;
	const phases = [...record.phases].sort((a, b) => a.index - b.index);
	for (const phase of phases) {
		if (phase.status === "done") continue;
		if (phase.lock) return null;
		const priorIncomplete = phases.some(
			(p) => p.index < phase.index && p.status !== "done",
		);
		if (priorIncomplete) return null;
		return phase;
	}
	return null;
}

export function toPlanSummary(record: PlanRecord): PlanSummary {
	const { phases_done, phases_total, tasks_done, tasks_total, completion_ratio } =
		planCompletion(record);
	const pickable = nextPickablePhase(record);
	return {
		id: record.id,
		spec_slug: record.spec_slug,
		title: record.title,
		source: record.source,
		status: record.status,
		updated_at: record.updated_at,
		phases_done,
		phases_total,
		tasks_done,
		tasks_total,
		completion_ratio,
		active_phase: pickable
			? { id: pickable.id, index: pickable.index, title: pickable.title, status: pickable.status }
			: null,
		lock: record.lock,
		has_user_instructions: Boolean(record.user_instructions?.trim()),
		etag: record.etag,
	};
}

export type PlanNextAction =
	| {
			type: "wire_workers_builds";
			worker: string;
			org: string;
			repo: string;
			branch: string;
	  };

export function planNextActionsAfterPatch(
	before: PlanRecord,
	after: PlanRecord,
): PlanNextAction[] {
	const actions: PlanNextAction[] = [];
	const deploy = after.deploy;
	if (!deploy?.github_org || !deploy.github_repo || !deploy.worker) return actions;
	if (deploy.builds_wired_at) return actions;

	for (const phase of after.phases) {
		const prev = before.phases.find((p) => p.id === phase.id);
		const becameDone = phase.status === "done" && prev?.status !== "done";
		if (!becameDone || phase.index < 1) continue;
		actions.push({
			type: "wire_workers_builds",
			worker: deploy.worker,
			org: deploy.github_org,
			repo: deploy.github_repo,
			branch: deploy.github_branch?.trim() || "main",
		});
		break;
	}
	return actions;
}

function parseDeploy(raw: unknown): PlanDeploy | null | undefined {
	if (raw === undefined) return undefined;
	if (raw === null) return null;
	if (!raw || typeof raw !== "object") return null;
	const m = raw as PlanDeploy;
	const out: PlanDeploy = {};
	if (typeof m.worker === "string" && m.worker.trim()) out.worker = m.worker.trim();
	if (typeof m.github_org === "string" && m.github_org.trim()) {
		out.github_org = m.github_org.trim();
	}
	if (typeof m.github_repo === "string" && m.github_repo.trim()) {
		out.github_repo = m.github_repo.trim();
	}
	if (typeof m.github_branch === "string" && m.github_branch.trim()) {
		out.github_branch = m.github_branch.trim();
	}
	if (m.builds_wired_at === null) out.builds_wired_at = null;
	else if (typeof m.builds_wired_at === "string" && m.builds_wired_at.trim()) {
		out.builds_wired_at = m.builds_wired_at.trim();
	}
	return out;
}

function stampPhaseCompletions(before: PlanPhase[], after: PlanPhase[]): PlanPhase[] {
	const now = new Date().toISOString();
	return after.map((phase) => {
		const prev = before.find((p) => p.id === phase.id);
		const becameDone = phase.status === "done" && prev?.status !== "done";
		if (becameDone && !phase.completed_at) {
			return { ...phase, completed_at: now };
		}
		return phase;
	});
}

export function isPickablePlan(record: PlanRecord): boolean {
	return nextPickablePhase(record) !== null;
}

export function parsePlanTasks(raw: unknown): PlanTask[] | null {
	if (!Array.isArray(raw)) return [];
	const tasks: PlanTask[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") return null;
		const t = item as PlanTask;
		const id = typeof t.id === "string" ? t.id.trim() : "";
		const title = typeof t.title === "string" ? t.title.trim() : "";
		const status = typeof t.status === "string" ? t.status.trim() : "";
		if (!id || !TASK_ID_RE.test(id) || !title) return null;
		if (!TASK_STATUSES.includes(status as PlanTaskStatus)) return null;
		tasks.push({ id, title, status: status as PlanTaskStatus });
	}
	return tasks;
}

function parsePlanPhases(raw: unknown): PlanPhase[] | null {
	if (!Array.isArray(raw)) return null;
	const phases: PlanPhase[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") return null;
		const p = item as PlanPhase;
		const id = typeof p.id === "string" ? p.id.trim() : "";
		const index = typeof p.index === "number" ? p.index : Number.NaN;
		const title = typeof p.title === "string" ? p.title.trim() : "";
		const status = typeof p.status === "string" ? p.status.trim() : "";
		const body = typeof p.body === "string" ? p.body : "";
		if (!id || !PHASE_ID_RE.test(id) || !title || Number.isNaN(index)) return null;
		if (!TASK_STATUSES.includes(status as PlanPhaseStatus)) return null;
		phases.push({
			id,
			index,
			title,
			status: status as PlanPhaseStatus,
			body,
			lock: p.lock ?? null,
			completed_at:
				typeof p.completed_at === "string" ? p.completed_at : p.completed_at ?? null,
		});
	}
	return phases;
}

export function parseSavePlanInput(
	raw: unknown,
	existing?: PlanRecord | null,
): { ok: true; value: PlanRecord } | { ok: false; error: string } {
	if (!raw || typeof raw !== "object") {
		return { ok: false, error: "plan must be a JSON object" };
	}
	const m = raw as Record<string, unknown>;
	const id = typeof m.id === "string" ? m.id.trim() : "";
	const spec_slug = typeof m.spec_slug === "string" ? m.spec_slug.trim() : "";
	const title = typeof m.title === "string" ? m.title.trim() : "";
	const body = typeof m.body === "string" ? m.body : "";
	if (!id || !PLAN_ID_RE.test(id)) {
		return { ok: false, error: "id must be lowercase hyphenated" };
	}
	if (!spec_slug) return { ok: false, error: "spec_slug is required" };
	if (!title) return { ok: false, error: "title is required" };
	if (!body) return { ok: false, error: "body is required" };

	const tasksRaw = m.tasks !== undefined ? parsePlanTasks(m.tasks) : existing?.tasks ?? [];
	if (tasksRaw === null) return { ok: false, error: "invalid tasks" };

	let phases: PlanPhase[];
	if (m.phases !== undefined) {
		const parsed = parsePlanPhases(m.phases);
		if (parsed === null) return { ok: false, error: "invalid phases" };
		phases = parsed;
	} else if (existing?.phases?.length) {
		phases = existing.phases;
	} else {
		phases = splitPlanPhasesFromBody(body);
	}

	let status: SpecStatus = existing?.status ?? "ready";
	if (typeof m.status === "string" && STATUSES.includes(m.status as SpecStatus)) {
		status = m.status as SpecStatus;
	}

	let user_instructions = existing?.user_instructions;
	if (typeof m.user_instructions === "string") {
		user_instructions = m.user_instructions;
	}

	let deploy = existing?.deploy ?? null;
	const deployParsed = parseDeploy(m.deploy);
	if (deployParsed !== undefined) deploy = deployParsed;

	const now = new Date().toISOString();
	return {
		ok: true,
		value: {
			id,
			spec_slug,
			title,
			body,
			source: typeof m.source === "string" ? m.source.trim() : existing?.source,
			status,
			phases,
			tasks: tasksRaw,
			lock: existing?.lock ?? null,
			user_instructions,
			deploy,
			etag: now,
			created_at: existing?.created_at ?? now,
			updated_at: now,
		},
	};
}

export function parsePatchPlanInput(
	raw: unknown,
): { ok: true; value: { status?: SpecStatus; tasks?: PlanTask[]; phases?: PlanPhase[]; user_instructions?: string; deploy?: PlanDeploy | null; etag?: string } } | { ok: false; error: string } {
	if (!raw || typeof raw !== "object") {
		return { ok: false, error: "body must be a JSON object" };
	}
	const m = raw as Record<string, unknown>;
	const out: {
		status?: SpecStatus;
		tasks?: PlanTask[];
		phases?: PlanPhase[];
		user_instructions?: string;
		deploy?: PlanDeploy | null;
		etag?: string;
	} = {};

	if (m.status !== undefined) {
		if (typeof m.status !== "string" || !STATUSES.includes(m.status as SpecStatus)) {
			return { ok: false, error: "invalid status" };
		}
		out.status = m.status as SpecStatus;
	}

	if (m.tasks !== undefined) {
		const tasks = parsePlanTasks(m.tasks);
		if (tasks === null) return { ok: false, error: "invalid tasks" };
		out.tasks = tasks;
	}

	if (m.phases !== undefined) {
		const phases = parsePlanPhases(m.phases);
		if (phases === null) return { ok: false, error: "invalid phases" };
		out.phases = phases;
	}

	if (m.user_instructions !== undefined) {
		if (typeof m.user_instructions !== "string") {
			return { ok: false, error: "invalid user_instructions" };
		}
		out.user_instructions = m.user_instructions;
	}

	if (m.deploy !== undefined) {
		const deploy = parseDeploy(m.deploy);
		if (deploy === null && m.deploy !== null) {
			return { ok: false, error: "invalid deploy" };
		}
		out.deploy = deploy ?? null;
	}

	if (typeof m.etag === "string" && m.etag.trim()) {
		out.etag = m.etag.trim();
	}

	if (
		out.status === undefined &&
		out.tasks === undefined &&
		out.phases === undefined &&
		out.user_instructions === undefined &&
		out.deploy === undefined
	) {
		return { ok: false, error: "status, tasks, phases, user_instructions, or deploy required" };
	}

	return { ok: true, value: out };
}

export { stampPhaseCompletions };

export { parseLockInput };
