import { DurableObject } from "cloudflare:workers";
import {
	ERROR_INDEX_KEY,
	errorKey,
	parseCreateErrorInput,
	parseResolveErrorInput,
	type ErrorRecord,
} from "./errors";
import {
	parseServiceRegistration,
	SERVICE_INDEX_KEY,
	serviceRegistryKey,
	type ServiceRegistration,
} from "./service-registry";
import {
	parseLockInput,
	parsePatchPlanInput,
	parseSavePlanInput,
	normalizePlanRecord,
	nextPickablePhase,
	PLAN_INDEX_KEY,
	planKey,
	toPlanSummary,
	type PlanPhase,
	type PlanRecord,
} from "./plan.ts";
import {
	parseTakeInput,
	rankQueueCandidates,
	matchesTakeKind,
} from "./queue.ts";
import {
	parsePatchSpecInput,
	normalizeSpecRecord,
	parseSaveSpecInput,
	SPEC_INDEX_KEY,
	specKey,
	toSpecSummary,
	type SpecRecord,
} from "./spec.ts";

export class Scribe extends DurableObject {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/health") {
			return Response.json({ ok: true, class: "Scribe" });
		}

		if (url.pathname === "/specs") {
			if (request.method === "GET") return this.listSpecs(url);
			if (request.method === "POST") return this.saveSpec(request);
		}

		const specLockMatch = url.pathname.match(/^\/specs\/([^/]+)\/lock$/);
		if (specLockMatch) {
			const slug = decodeURIComponent(specLockMatch[1]);
			if (request.method === "POST") return this.acquireLock(slug, request);
			if (request.method === "DELETE") return this.releaseLock(slug, request);
		}

		const specPatchMatch = url.pathname.match(/^\/specs\/([^/]+)$/);
		if (specPatchMatch) {
			const slug = decodeURIComponent(specPatchMatch[1]);
			if (request.method === "GET") return this.getSpec(slug);
			if (request.method === "PATCH") return this.patchSpec(slug, request);
		}

		if (url.pathname === "/plans") {
			if (request.method === "GET") return this.listPlans(url);
			if (request.method === "POST") return this.savePlan(request);
		}

		const planLockMatch = url.pathname.match(/^\/plans\/([^/]+)\/lock$/);
		if (planLockMatch) {
			const id = decodeURIComponent(planLockMatch[1]);
			if (request.method === "POST") return this.acquirePlanLock(id, request);
			if (request.method === "DELETE") return this.releasePlanLock(id, request);
		}

		const planPatchMatch = url.pathname.match(/^\/plans\/([^/]+)$/);
		if (planPatchMatch) {
			const id = decodeURIComponent(planPatchMatch[1]);
			if (request.method === "GET") return this.getPlan(id);
			if (request.method === "PATCH") return this.patchPlan(id, request);
		}

		const planPhaseLockMatch = url.pathname.match(/^\/plans\/([^/]+)\/phases\/([^/]+)\/lock$/);
		if (planPhaseLockMatch) {
			const id = decodeURIComponent(planPhaseLockMatch[1]);
			const phaseId = decodeURIComponent(planPhaseLockMatch[2]);
			if (request.method === "POST") return this.acquirePlanPhaseLock(id, phaseId, request);
			if (request.method === "DELETE") return this.releasePlanPhaseLock(id, phaseId, request);
		}

		if (url.pathname === "/queue/take" && request.method === "POST") {
			return this.takeFromQueue(request);
		}

		if (url.pathname === "/errors") {
			if (request.method === "GET") return this.listErrors();
			if (request.method === "POST") return this.createError(request);
		}

		const errorMatch = url.pathname.match(/^\/errors\/([^/]+)$/);
		if (errorMatch && request.method === "PATCH") {
			return this.resolveError(decodeURIComponent(errorMatch[1]), request);
		}

		if (url.pathname === "/services") {
			if (request.method === "GET") return this.listServices();
			if (request.method === "POST") return this.upsertService(request);
		}

		const serviceMatch = url.pathname.match(/^\/services\/([^/]+)$/);
		if (serviceMatch && request.method === "GET") {
			return this.getService(decodeURIComponent(serviceMatch[1]));
		}

		return Response.json({ ok: false, error: "not found" }, { status: 404 });
	}

	private async listSpecs(url: URL): Promise<Response> {
		const includeDone = url.searchParams.get("all") === "true";
		const slugs = (await this.ctx.storage.get<string[]>(SPEC_INDEX_KEY)) ?? [];
		const specs: SpecRecord[] = [];
		for (const slug of slugs) {
			const stored = await this.ctx.storage.get<SpecRecord>(specKey(slug));
			if (!stored) continue;
			const record = normalizeSpecRecord(stored);
			if (!includeDone && record.status === "done") continue;
			specs.push(record);
		}
		specs.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
		return Response.json({
			ok: true,
			specs: specs.map(toSpecSummary),
		});
	}

	private async getSpec(slug: string): Promise<Response> {
		const stored = await this.ctx.storage.get<SpecRecord>(specKey(slug));
		if (!stored) {
			return Response.json({ ok: false, error: "spec not found" }, { status: 404 });
		}
		return Response.json({ ok: true, spec: normalizeSpecRecord(stored) });
	}

	private async saveSpec(request: Request): Promise<Response> {
		let raw: unknown;
		try {
			raw = await request.json();
		} catch {
			return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
		}

		const slug = typeof (raw as { slug?: unknown })?.slug === "string"
			? (raw as { slug: string }).slug.trim()
			: "";
		const existingRaw = slug ? await this.ctx.storage.get<SpecRecord>(specKey(slug)) : null;
		const existing = existingRaw ? normalizeSpecRecord(existingRaw) : null;
		const parsed = parseSaveSpecInput(raw, existing);
		if (!parsed.ok) {
			return Response.json({ ok: false, error: parsed.error }, { status: 400 });
		}

		const record = parsed.value;
		const slugs = new Set((await this.ctx.storage.get<string[]>(SPEC_INDEX_KEY)) ?? []);
		slugs.add(record.slug);
		const created = !existing;
		await this.ctx.storage.put(specKey(record.slug), record);
		await this.ctx.storage.put(SPEC_INDEX_KEY, [...slugs].sort());

		return Response.json({ ok: true, spec: record }, { status: created ? 201 : 200 });
	}

	private async patchSpec(slug: string, request: Request): Promise<Response> {
		const stored = await this.ctx.storage.get<SpecRecord>(specKey(slug));
		if (!stored) {
			return Response.json({ ok: false, error: "spec not found" }, { status: 404 });
		}
		const record = normalizeSpecRecord(stored);

		let raw: unknown;
		try {
			raw = await request.json();
		} catch {
			return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
		}

		const parsed = parsePatchSpecInput(raw);
		if (!parsed.ok) {
			return Response.json({ ok: false, error: parsed.error }, { status: 400 });
		}

		const updated: SpecRecord = {
			...record,
			status: parsed.value.status ?? record.status,
			phases: parsed.value.phases ?? record.phases,
			updated_at: new Date().toISOString(),
		};
		await this.ctx.storage.put(specKey(slug), updated);
		return Response.json({ ok: true, spec: updated });
	}

	private async acquireLock(slug: string, request: Request): Promise<Response> {
		const stored = await this.ctx.storage.get<SpecRecord>(specKey(slug));
		if (!stored) {
			return Response.json({ ok: false, error: "spec not found" }, { status: 404 });
		}
		const record = normalizeSpecRecord(stored);

		let raw: unknown;
		try {
			raw = await request.json();
		} catch {
			return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
		}

		const parsed = parseLockInput(raw);
		if (!parsed.ok) {
			return Response.json({ ok: false, error: parsed.error }, { status: 400 });
		}

		if (record.lock && record.lock.agent_id !== parsed.value.agent_id) {
			return Response.json(
				{ ok: false, error: "lock held", lock: record.lock },
				{ status: 409 },
			);
		}

		const now = new Date().toISOString();
		const updated: SpecRecord = {
			...record,
			lock: { agent_id: parsed.value.agent_id, acquired_at: now },
			status: record.status === "ready" ? "in_progress" : record.status,
			updated_at: now,
		};
		await this.ctx.storage.put(specKey(slug), updated);
		return Response.json({ ok: true, spec: updated });
	}

	private async releaseLock(slug: string, request: Request): Promise<Response> {
		const stored = await this.ctx.storage.get<SpecRecord>(specKey(slug));
		if (!stored) {
			return Response.json({ ok: false, error: "spec not found" }, { status: 404 });
		}
		const record = normalizeSpecRecord(stored);

		let agentId: string | undefined;
		if (request.headers.get("content-type")?.includes("application/json")) {
			try {
				const raw = await request.json();
				const parsed = parseLockInput(raw);
				if (parsed.ok) agentId = parsed.value.agent_id;
			} catch {
				/* optional body */
			}
		}

		if (record.lock && agentId && record.lock.agent_id !== agentId) {
			return Response.json(
				{ ok: false, error: "lock held by another agent", lock: record.lock },
				{ status: 403 },
			);
		}

		const updated: SpecRecord = {
			...record,
			lock: null,
			updated_at: new Date().toISOString(),
		};
		await this.ctx.storage.put(specKey(slug), updated);
		return Response.json({ ok: true, spec: updated });
	}

	private async loadAllSpecs(includeDone: boolean): Promise<SpecRecord[]> {
		const slugs = (await this.ctx.storage.get<string[]>(SPEC_INDEX_KEY)) ?? [];
		const specs: SpecRecord[] = [];
		for (const slug of slugs) {
			const stored = await this.ctx.storage.get<SpecRecord>(specKey(slug));
			if (!stored) continue;
			const record = normalizeSpecRecord(stored);
			if (!includeDone && record.status === "done") continue;
			specs.push(record);
		}
		return specs;
	}

	private async loadAllPlans(includeDone: boolean): Promise<PlanRecord[]> {
		const ids = (await this.ctx.storage.get<string[]>(PLAN_INDEX_KEY)) ?? [];
		const plans: PlanRecord[] = [];
		for (const id of ids) {
			const stored = await this.ctx.storage.get<PlanRecord>(planKey(id));
			if (!stored) continue;
			const record = normalizePlanRecord(stored);
			if (!includeDone && record.status === "done") continue;
			plans.push(record);
		}
		return plans;
	}

	private async listPlans(url: URL): Promise<Response> {
		const includeDone = url.searchParams.get("all") === "true";
		const plans = await this.loadAllPlans(includeDone);
		plans.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
		return Response.json({
			ok: true,
			plans: plans.map(toPlanSummary),
		});
	}

	private async getPlan(id: string): Promise<Response> {
		const stored = await this.ctx.storage.get<PlanRecord>(planKey(id));
		if (!stored) {
			return Response.json({ ok: false, error: "plan not found" }, { status: 404 });
		}
		return Response.json({ ok: true, plan: normalizePlanRecord(stored) });
	}

	private async savePlan(request: Request): Promise<Response> {
		let raw: unknown;
		try {
			raw = await request.json();
		} catch {
			return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
		}

		const id = typeof (raw as { id?: unknown })?.id === "string"
			? (raw as { id: string }).id.trim()
			: "";
		const existingRaw = id ? await this.ctx.storage.get<PlanRecord>(planKey(id)) : null;
		const existing = existingRaw ? normalizePlanRecord(existingRaw) : null;
		const parsed = parseSavePlanInput(raw, existing);
		if (!parsed.ok) {
			return Response.json({ ok: false, error: parsed.error }, { status: 400 });
		}

		const record = parsed.value;
		const ids = new Set((await this.ctx.storage.get<string[]>(PLAN_INDEX_KEY)) ?? []);
		ids.add(record.id);
		const created = !existing;
		await this.ctx.storage.put(planKey(record.id), record);
		await this.ctx.storage.put(PLAN_INDEX_KEY, [...ids].sort());

		return Response.json({ ok: true, plan: record }, { status: created ? 201 : 200 });
	}

	private async patchPlan(id: string, request: Request): Promise<Response> {
		const stored = await this.ctx.storage.get<PlanRecord>(planKey(id));
		if (!stored) {
			return Response.json({ ok: false, error: "plan not found" }, { status: 404 });
		}
		const record = normalizePlanRecord(stored);

		let raw: unknown;
		try {
			raw = await request.json();
		} catch {
			return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
		}

		const parsed = parsePatchPlanInput(raw);
		if (!parsed.ok) {
			return Response.json({ ok: false, error: parsed.error }, { status: 400 });
		}

		const updated: PlanRecord = {
			...record,
			status: parsed.value.status ?? record.status,
			tasks: parsed.value.tasks ?? record.tasks,
			phases: parsed.value.phases ?? record.phases,
			updated_at: new Date().toISOString(),
		};
		await this.ctx.storage.put(planKey(id), updated);
		return Response.json({ ok: true, plan: updated });
	}

	private async acquirePlanLock(id: string, request: Request): Promise<Response> {
		const stored = await this.ctx.storage.get<PlanRecord>(planKey(id));
		if (!stored) {
			return Response.json({ ok: false, error: "plan not found" }, { status: 404 });
		}
		const record = normalizePlanRecord(stored);

		let raw: unknown;
		try {
			raw = await request.json();
		} catch {
			return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
		}

		const parsed = parseLockInput(raw);
		if (!parsed.ok) {
			return Response.json({ ok: false, error: parsed.error }, { status: 400 });
		}

		if (record.lock && record.lock.agent_id !== parsed.value.agent_id) {
			return Response.json(
				{ ok: false, error: "lock held", lock: record.lock },
				{ status: 409 },
			);
		}

		const now = new Date().toISOString();
		const updated: PlanRecord = {
			...record,
			lock: { agent_id: parsed.value.agent_id, acquired_at: now },
			status: record.status === "ready" ? "in_progress" : record.status,
			updated_at: now,
		};
		await this.ctx.storage.put(planKey(id), updated);
		return Response.json({ ok: true, plan: updated });
	}

	private async releasePlanLock(id: string, request: Request): Promise<Response> {
		const stored = await this.ctx.storage.get<PlanRecord>(planKey(id));
		if (!stored) {
			return Response.json({ ok: false, error: "plan not found" }, { status: 404 });
		}
		const record = normalizePlanRecord(stored);

		let agentId: string | undefined;
		if (request.headers.get("content-type")?.includes("application/json")) {
			try {
				const raw = await request.json();
				const parsed = parseLockInput(raw);
				if (parsed.ok) agentId = parsed.value.agent_id;
			} catch {
				/* optional body */
			}
		}

		if (record.lock && agentId && record.lock.agent_id !== agentId) {
			return Response.json(
				{ ok: false, error: "lock held by another agent", lock: record.lock },
				{ status: 403 },
			);
		}

		const updated: PlanRecord = {
			...record,
			lock: null,
			updated_at: new Date().toISOString(),
		};
		await this.ctx.storage.put(planKey(id), updated);
		return Response.json({ ok: true, plan: updated });
	}

	private async takeFromQueue(request: Request): Promise<Response> {
		let raw: unknown;
		try {
			raw = await request.json();
		} catch {
			return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
		}

		const parsed = parseTakeInput(raw);
		if (!parsed.ok) {
			return Response.json({ ok: false, error: parsed.error }, { status: 400 });
		}

		const { agent_id, exclude, kind } = parsed.value;
		const excludeSet = new Set(exclude);
		const [plans, specs] = await Promise.all([
			this.loadAllPlans(false),
			this.loadAllSpecs(false),
		]);
		let ranked = rankQueueCandidates(plans, specs, excludeSet);
		ranked = ranked.filter((c) => matchesTakeKind(c, kind));

		for (const candidate of ranked) {
			if (candidate.kind === "phase") {
				const lockRes = this.acquirePlanPhaseLockInternal(
					agent_id,
					candidate.record,
					candidate.phase.id,
				);
				if (lockRes.ok) {
					await this.ctx.storage.put(planKey(candidate.record.id), lockRes.plan);
					const phase = lockRes.plan.phases.find((p) => p.id === candidate.phase.id)!;
					return Response.json({
						ok: true,
						kind: "phase",
						completion_ratio: candidate.completion_ratio,
						plan_id: lockRes.plan.id,
						spec_slug: lockRes.plan.spec_slug,
						phase: {
							id: phase.id,
							index: phase.index,
							title: phase.title,
							status: phase.status,
							lock: phase.lock,
						},
						plan: toPlanSummary(lockRes.plan),
					});
				}
				if (lockRes.status !== 409) {
					return Response.json({ ok: false, error: lockRes.error }, { status: lockRes.status });
				}
				continue;
			}

			const lockRes = this.acquireSpecLockInternal(agent_id, candidate.record);
			if (lockRes.ok) {
				await this.ctx.storage.put(specKey(candidate.record.slug), lockRes.spec);
				return Response.json({
					ok: true,
					kind: "spec",
					completion_ratio: candidate.completion_ratio,
					spec: toSpecSummary(lockRes.spec),
				});
			}
			if (lockRes.status !== 409) {
				return Response.json({ ok: false, error: lockRes.error }, { status: lockRes.status });
			}
		}

		return Response.json({ ok: true, empty: true, eligible_count: 0 });
	}

	private acquireSpecLockInternal(
		agentId: string,
		record: SpecRecord,
	): { ok: true; spec: SpecRecord } | { ok: false; error: string; status: number } {
		if (record.lock && record.lock.agent_id !== agentId) {
			return { ok: false, error: "lock held", status: 409 };
		}
		const now = new Date().toISOString();
		const updated: SpecRecord = {
			...record,
			lock: { agent_id: agentId, acquired_at: now },
			status: record.status === "ready" ? "in_progress" : record.status,
			updated_at: now,
		};
		return { ok: true, spec: updated };
	}

	private acquirePlanPhaseLockInternal(
		agentId: string,
		record: PlanRecord,
		phaseId: string,
	): { ok: true; plan: PlanRecord } | { ok: false; error: string; status: number } {
		const pickable = nextPickablePhase(record);
		if (!pickable || pickable.id !== phaseId) {
			return { ok: false, error: "phase not available", status: 409 };
		}
		const phase = record.phases.find((p) => p.id === phaseId);
		if (!phase) return { ok: false, error: "phase not found", status: 404 };
		if (phase.lock && phase.lock.agent_id !== agentId) {
			return { ok: false, error: "lock held", status: 409 };
		}
		const now = new Date().toISOString();
		const phases = record.phases.map((p) =>
			p.id === phaseId
				? {
						...p,
						lock: { agent_id: agentId, acquired_at: now },
						status: p.status === "pending" ? ("active" as PlanPhase["status"]) : p.status,
					}
				: p,
		);
		return {
			ok: true,
			plan: {
				...record,
				phases,
				status: record.status === "ready" ? "in_progress" : record.status,
				updated_at: now,
			},
		};
	}

	private async acquirePlanPhaseLock(
		id: string,
		phaseId: string,
		request: Request,
	): Promise<Response> {
		const stored = await this.ctx.storage.get<PlanRecord>(planKey(id));
		if (!stored) {
			return Response.json({ ok: false, error: "plan not found" }, { status: 404 });
		}
		const record = normalizePlanRecord(stored);

		let raw: unknown;
		try {
			raw = await request.json();
		} catch {
			return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
		}
		const parsed = parseLockInput(raw);
		if (!parsed.ok) {
			return Response.json({ ok: false, error: parsed.error }, { status: 400 });
		}

		const lockRes = this.acquirePlanPhaseLockInternal(
			parsed.value.agent_id,
			record,
			phaseId,
		);
		if (!lockRes.ok) {
			return Response.json({ ok: false, error: lockRes.error }, { status: lockRes.status });
		}
		await this.ctx.storage.put(planKey(id), lockRes.plan);
		return Response.json({ ok: true, plan: lockRes.plan });
	}

	private async releasePlanPhaseLock(
		id: string,
		phaseId: string,
		request: Request,
	): Promise<Response> {
		const stored = await this.ctx.storage.get<PlanRecord>(planKey(id));
		if (!stored) {
			return Response.json({ ok: false, error: "plan not found" }, { status: 404 });
		}
		const record = normalizePlanRecord(stored);
		const phase = record.phases.find((p) => p.id === phaseId);
		if (!phase) {
			return Response.json({ ok: false, error: "phase not found" }, { status: 404 });
		}

		let agentId: string | undefined;
		try {
			const raw = await request.json();
			const parsed = parseLockInput(raw);
			if (parsed.ok) agentId = parsed.value.agent_id;
		} catch {
			/* optional body */
		}

		if (phase.lock && agentId && phase.lock.agent_id !== agentId) {
			return Response.json(
				{ ok: false, error: "lock held by another agent", lock: phase.lock },
				{ status: 403 },
			);
		}

		const updated: PlanRecord = {
			...record,
			phases: record.phases.map((p) => (p.id === phaseId ? { ...p, lock: null } : p)),
			updated_at: new Date().toISOString(),
		};
		await this.ctx.storage.put(planKey(id), updated);
		return Response.json({ ok: true, plan: updated });
	}

	private acquirePlanLockInternal(
		agentId: string,
		record: PlanRecord,
	): { ok: true; plan: PlanRecord } | { ok: false; error: string; status: number } {
		if (record.lock && record.lock.agent_id !== agentId) {
			return { ok: false, error: "lock held", status: 409 };
		}
		const now = new Date().toISOString();
		const updated: PlanRecord = {
			...record,
			lock: { agent_id: agentId, acquired_at: now },
			status: record.status === "ready" ? "in_progress" : record.status,
			updated_at: now,
		};
		return { ok: true, plan: updated };
	}

	private async listErrors(): Promise<Response> {
		const ids = (await this.ctx.storage.get<string[]>(ERROR_INDEX_KEY)) ?? [];
		const errors: ErrorRecord[] = [];
		for (const id of ids) {
			const record = await this.ctx.storage.get<ErrorRecord>(errorKey(id));
			if (record && !record.resolved_at) errors.push(record);
		}
		errors.sort((a, b) => b.created_at.localeCompare(a.created_at));
		return Response.json({ ok: true, errors });
	}

	private async createError(request: Request): Promise<Response> {
		let raw: unknown;
		try {
			raw = await request.json();
		} catch {
			return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
		}

		const parsed = parseCreateErrorInput(raw);
		if (!parsed.ok) {
			return Response.json({ ok: false, error: parsed.error }, { status: 400 });
		}

		const record = parsed.value;
		const ids = new Set((await this.ctx.storage.get<string[]>(ERROR_INDEX_KEY)) ?? []);
		ids.add(record.id);
		await this.ctx.storage.put(errorKey(record.id), record);
		await this.ctx.storage.put(ERROR_INDEX_KEY, [...ids].sort());

		return Response.json({ ok: true, error: record }, { status: 201 });
	}

	private async resolveError(id: string, request: Request): Promise<Response> {
		const record = await this.ctx.storage.get<ErrorRecord>(errorKey(id));
		if (!record) {
			return Response.json({ ok: false, error: "error not found" }, { status: 404 });
		}

		let raw: unknown = {};
		try {
			raw = await request.json();
		} catch {
			/* empty body resolves */
		}

		const parsed = parseResolveErrorInput(raw);
		if (!parsed.ok) {
			return Response.json({ ok: false, error: parsed.error }, { status: 400 });
		}

		const updated: ErrorRecord = {
			...record,
			resolved_at: parsed.value.resolved ? new Date().toISOString() : null,
		};
		await this.ctx.storage.put(errorKey(id), updated);
		return Response.json({ ok: true, error: updated });
	}

	private async listServices(): Promise<Response> {
		const ids = (await this.ctx.storage.get<string[]>(SERVICE_INDEX_KEY)) ?? [];
		const services: ServiceRegistration[] = [];
		for (const id of ids) {
			const record = await this.ctx.storage.get<ServiceRegistration>(serviceRegistryKey(id));
			if (record) services.push(record);
		}
		services.sort((a, b) => a.id.localeCompare(b.id));
		return Response.json({ ok: true, services });
	}

	private async getService(id: string): Promise<Response> {
		const record = await this.ctx.storage.get<ServiceRegistration>(serviceRegistryKey(id));
		if (!record) {
			return Response.json({ ok: false, error: "service not found" }, { status: 404 });
		}
		return Response.json({ ok: true, service: record });
	}

	private async upsertService(request: Request): Promise<Response> {
		let raw: unknown;
		try {
			raw = await request.json();
		} catch {
			return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
		}

		const parsed = parseServiceRegistration(raw);
		if (!parsed.ok) {
			return Response.json({ ok: false, error: parsed.error }, { status: 400 });
		}

		const incoming = parsed.value;
		const existing = await this.ctx.storage.get<ServiceRegistration>(serviceRegistryKey(incoming.id));
		const record: ServiceRegistration = {
			...incoming,
			registered_at: existing?.registered_at ?? incoming.registered_at,
			updated_at: new Date().toISOString(),
		};

		const ids = new Set((await this.ctx.storage.get<string[]>(SERVICE_INDEX_KEY)) ?? []);
		ids.add(record.id);
		await this.ctx.storage.put(serviceRegistryKey(record.id), record);
		await this.ctx.storage.put(SERVICE_INDEX_KEY, [...ids].sort());

		return Response.json({ ok: true, service: record }, { status: existing ? 200 : 201 });
	}
}
