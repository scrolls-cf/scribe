import { DurableObject } from "cloudflare:workers";
import { etagConflict, etagResponseHeaders } from "./etag.ts";
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
import { resolveLockHolder, type LockHolder } from "./identity.ts";
import {
	dueLeaseEntries,
	leaseStorageKey,
	listLeaseEntries,
	lockWithLease,
	parseLeaseSeconds,
	removeLease,
	syncLeaseAlarm,
	upsertLease,
	type LeaseEntry,
} from "./lease.ts";
import {
	parseLockInput,
	parsePatchPlanInput,
	parseSavePlanInput,
	normalizePlanRecord,
	nextPickablePhase,
	planNextActionsAfterPatch,
	PLAN_INDEX_KEY,
	planKey,
	stampPhaseCompletions,
	toPlanSummary,
	type PlanPhase,
	type PlanRecord,
} from "./plan.ts";
import { parseOptionalLockBody, resolveLockActivity } from "./spec.ts";
import {
	parseTakeInput,
	rankQueueCandidates,
	matchesTakeKind,
} from "./queue.ts";
import {
	computeWorkspaceManifest,
	getWorkspaceLease,
	listWorkspaceLeases,
	removeWorkspaceLease,
	toWorkspaceSummary,
	upsertWorkspaceLease,
	validatePlatformRoot,
	type WorkspaceLease,
} from "./workspace.ts";
import { parseSpecFooterFields } from "./spec-footer.ts";
import {
	parsePatchSpecInput,
	linkSpecPlanId,
	normalizeSpecRecord,
	parseSaveSpecInput,
	SPEC_INDEX_KEY,
	specKey,
	toSpecOrientView,
	toSpecSummary,
	type SpecRecord,
} from "./spec.ts";
import {
	deleteSpecStorage,
	hydrateSpecRecord,
	needsFooterBodyParse,
	putSpecRecord,
	resolveSpecBody,
} from "./spec-storage.ts";
import {
	applyBodyRevisionOnSave,
	buildRevisionDiff,
	getRevision,
	listRevisions,
	parseRevisionLimit,
} from "./revision.ts";
import {
	applyImplementStart,
	applyPhaseDone,
	applyPlanCreated,
	applyPlanGateC,
	applyPlanReviewPassed,
	applyReviewPassed,
	applyShip,
	OrchestratePreconditionError,
	parseOrchestrateRequest,
	TRANSITION_CACHE_PREFIX,
} from "./orchestrate.ts";

export class Scribe extends DurableObject {
	async alarm(): Promise<void> {
		try {
			await this.processDueLeases();
		} catch (err) {
			console.error("lease alarm failed", err);
			await this.ctx.storage.setAlarm(Date.now() + 5000);
		}
	}

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

		const specBodyMatch = url.pathname.match(/^\/specs\/([^/]+)\/body$/);
		if (specBodyMatch && request.method === "GET") {
			return this.getSpecBody(decodeURIComponent(specBodyMatch[1]));
		}

		const specRevisionMatch = url.pathname.match(/^\/specs\/([^/]+)\/revisions(?:\/([^/]+))?$/);
		if (specRevisionMatch && request.method === "GET") {
			const slug = decodeURIComponent(specRevisionMatch[1]);
			const baseEtag = specRevisionMatch[2]
				? decodeURIComponent(specRevisionMatch[2])
				: null;
			if (baseEtag) return this.getSpecRevision(slug, baseEtag);
			return this.listSpecRevisions(slug, url);
		}

		const specDiffMatch = url.pathname.match(/^\/specs\/([^/]+)\/diff$/);
		if (specDiffMatch && request.method === "GET") {
			return this.getSpecDiff(decodeURIComponent(specDiffMatch[1]), url);
		}

		const orchestrateMatch = url.pathname.match(/^\/orchestrate\/([^/]+)\/transition$/);
		if (orchestrateMatch && request.method === "POST") {
			return this.orchestrateTransition(decodeURIComponent(orchestrateMatch[1]), request);
		}

		const specPatchMatch = url.pathname.match(/^\/specs\/([^/]+)$/);
		if (specPatchMatch) {
			const slug = decodeURIComponent(specPatchMatch[1]);
			if (request.method === "GET") return this.getSpec(slug, url);
			if (request.method === "PATCH") return this.patchSpec(slug, request);
			if (request.method === "DELETE") return this.deleteSpec(slug);
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

		const planRevisionMatch = url.pathname.match(/^\/plans\/([^/]+)\/revisions(?:\/([^/]+))?$/);
		if (planRevisionMatch && request.method === "GET") {
			const id = decodeURIComponent(planRevisionMatch[1]);
			const baseEtag = planRevisionMatch[2]
				? decodeURIComponent(planRevisionMatch[2])
				: null;
			if (baseEtag) return this.getPlanRevision(id, baseEtag);
			return this.listPlanRevisions(id, url);
		}

		const planDiffMatch = url.pathname.match(/^\/plans\/([^/]+)\/diff$/);
		if (planDiffMatch && request.method === "GET") {
			return this.getPlanDiff(decodeURIComponent(planDiffMatch[1]), url);
		}

		const planPatchMatch = url.pathname.match(/^\/plans\/([^/]+)$/);
		if (planPatchMatch) {
			const id = decodeURIComponent(planPatchMatch[1]);
			if (request.method === "GET") return this.getPlan(id);
			if (request.method === "PATCH") return this.patchPlan(id, request);
			if (request.method === "DELETE") return this.deletePlan(id);
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

		if (url.pathname === "/workspaces" && request.method === "GET") {
			return this.listWorkspaces(url);
		}

		const workspaceMatch = url.pathname.match(/^\/workspaces\/([^/]+)$/);
		if (workspaceMatch && request.method === "DELETE") {
			return this.deleteWorkspace(decodeURIComponent(workspaceMatch[1]), request);
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
			const record = await this.loadSpecRecord(slug, stored);
			if (!includeDone && record.status === "done") continue;
			specs.push(record);
		}
		specs.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
		return Response.json({
			ok: true,
			specs: specs.map(toSpecSummary),
		});
	}

	private async getSpec(slug: string, url: URL): Promise<Response> {
		const stored = await this.ctx.storage.get<SpecRecord>(specKey(slug));
		if (!stored) {
			return Response.json({ ok: false, error: "spec not found" }, { status: 404 });
		}
		const metadata = normalizeSpecRecord(stored);
		const view = url.searchParams.get("view") ?? "full";
		if (view === "summary") {
			const footerBody = needsFooterBodyParse(metadata)
				? await resolveSpecBody(this.ctx.storage, slug, stored)
				: "";
			const orient = toSpecOrientView(metadata, parseSpecFooterFields(footerBody));
			return Response.json(
				{ ok: true, spec: orient },
				{ headers: etagResponseHeaders(metadata.etag) },
			);
		}
		const spec = await this.loadSpecRecord(slug, stored);
		return Response.json({ ok: true, spec }, { headers: etagResponseHeaders(spec.etag) });
	}

	private async getSpecBody(slug: string): Promise<Response> {
		const stored = await this.ctx.storage.get<SpecRecord>(specKey(slug));
		if (!stored) {
			return Response.json({ ok: false, error: "spec not found" }, { status: 404 });
		}
		const metadata = normalizeSpecRecord(stored);
		const body = await resolveSpecBody(this.ctx.storage, slug, stored);
		return Response.json(
			{ ok: true, slug: metadata.slug, body, etag: metadata.etag },
			{ headers: etagResponseHeaders(metadata.etag) },
		);
	}

	private async listSpecRevisions(slug: string, url: URL): Promise<Response> {
		const stored = await this.ctx.storage.get<SpecRecord>(specKey(slug));
		if (!stored) {
			return Response.json({ ok: false, error: "spec not found" }, { status: 404 });
		}
		const spec = normalizeSpecRecord(stored);
		const limit = parseRevisionLimit(url.searchParams.get("limit"));
		const result = await listRevisions(this.ctx.storage, "spec", slug, limit);
		return Response.json({ ok: true, revisions: result.revisions, count: result.count });
	}

	private async getSpecRevision(slug: string, baseEtag: string): Promise<Response> {
		const stored = await this.ctx.storage.get<SpecRecord>(specKey(slug));
		if (!stored) {
			return Response.json({ ok: false, error: "spec not found" }, { status: 404 });
		}
		const revision = await getRevision(this.ctx.storage, "spec", slug, baseEtag);
		if (!revision) {
			return Response.json({ ok: false, error: "revision not found" }, { status: 404 });
		}
		return Response.json({ ok: true, revision });
	}

	private async getSpecDiff(slug: string, url: URL): Promise<Response> {
		const stored = await this.ctx.storage.get<SpecRecord>(specKey(slug));
		if (!stored) {
			return Response.json({ ok: false, error: "spec not found" }, { status: 404 });
		}
		const spec = await hydrateSpecRecord(this.ctx.storage, slug, stored);
		const diff = await buildRevisionDiff(
			this.ctx.storage,
			"spec",
			slug,
			spec,
			url.searchParams.get("base"),
			url.searchParams.get("head"),
		);
		if (!diff) {
			return Response.json({ ok: false, error: "revision not found" }, { status: 404 });
		}
		return Response.json({ ok: true, ...diff });
	}

	private async loadSpecRecord(slug: string, stored: SpecRecord): Promise<SpecRecord> {
		const record = await hydrateSpecRecord(this.ctx.storage, slug, stored);
		if (stored.status === "in_progress" && !stored.lock && record.status === "ready") {
			await putSpecRecord(this.ctx.storage, record);
		}
		return record;
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
		const existing = existingRaw
			? await hydrateSpecRecord(this.ctx.storage, slug, existingRaw)
			: null;
		const parsed = parseSaveSpecInput(raw, existing);
		if (!parsed.ok) {
			return Response.json({ ok: false, error: parsed.error }, { status: 400 });
		}

		const record = await applyBodyRevisionOnSave(
			this.ctx.storage,
			"spec",
			parsed.value.slug,
			existing,
			parsed.value,
		);
		const slugs = new Set((await this.ctx.storage.get<string[]>(SPEC_INDEX_KEY)) ?? []);
		slugs.add(record.slug);
		const created = !existing;
		await putSpecRecord(this.ctx.storage, record);
		await this.ctx.storage.put(SPEC_INDEX_KEY, [...slugs].sort());

		return Response.json({ ok: true, spec: record }, { status: created ? 201 : 200 });
	}

	private async deleteSpec(slug: string): Promise<Response> {
		const stored = await this.ctx.storage.get<SpecRecord>(specKey(slug));
		if (!stored) {
			return Response.json({ ok: false, error: "spec not found" }, { status: 404 });
		}
		await deleteSpecStorage(this.ctx.storage, slug);
		const slugs = (await this.ctx.storage.get<string[]>(SPEC_INDEX_KEY)) ?? [];
		await this.ctx.storage.put(
			SPEC_INDEX_KEY,
			slugs.filter((s) => s !== slug),
		);
		return Response.json({ ok: true, deleted: slug });
	}

	private async patchSpec(slug: string, request: Request): Promise<Response> {
		const stored = await this.ctx.storage.get<SpecRecord>(specKey(slug));
		if (!stored) {
			return Response.json({ ok: false, error: "spec not found" }, { status: 404 });
		}
		const record = await hydrateSpecRecord(this.ctx.storage, slug, stored);

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

		if (etagConflict(record.etag, request, parsed.value.etag)) {
			return Response.json(
				{ ok: false, error: "etag mismatch", etag: record.etag },
				{ status: 409, headers: etagResponseHeaders(record.etag) },
			);
		}

		const now = new Date().toISOString();
		const nextStatus = parsed.value.status ?? record.status;
		const updated: SpecRecord = {
			...record,
			status: nextStatus,
			phases: parsed.value.phases ?? record.phases,
			active_phase:
				parsed.value.active_phase !== undefined
					? parsed.value.active_phase
					: record.active_phase,
			terminal_skill:
				parsed.value.terminal_skill !== undefined
					? parsed.value.terminal_skill
					: record.terminal_skill,
			design_lane:
				parsed.value.design_lane !== undefined ? parsed.value.design_lane : record.design_lane,
			plan_id: parsed.value.plan_id !== undefined ? parsed.value.plan_id : record.plan_id,
			review_gate:
				parsed.value.review_gate !== undefined ? parsed.value.review_gate : record.review_gate,
			plan_review:
				parsed.value.plan_review !== undefined ? parsed.value.plan_review : record.plan_review,
			worker_scope:
				parsed.value.worker_scope !== undefined ? parsed.value.worker_scope : record.worker_scope,
			lock: nextStatus === "done" ? null : record.lock,
			updated_at: now,
			etag: now,
		};
		await putSpecRecord(this.ctx.storage, updated);
		if (nextStatus === "done" && record.lock) {
			await removeLease(this.ctx.storage, { kind: "spec", slug });
			await removeWorkspaceLease(this.ctx.storage, slug);
		}
		return Response.json({ ok: true, spec: updated }, { headers: etagResponseHeaders(updated.etag) });
	}

	private async orchestrateTransition(slug: string, request: Request): Promise<Response> {
		let raw: unknown;
		try {
			raw = await request.json();
		} catch {
			return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
		}

		const parsed = parseOrchestrateRequest(raw);
		if (!parsed.ok) {
			return Response.json({ ok: false, error: parsed.error }, { status: 400 });
		}
		const req = parsed.value;

		if (req.transition_id) {
			const cached = await this.ctx.storage.get<string>(
				`${TRANSITION_CACHE_PREFIX}${req.transition_id}`,
			);
			if (cached) {
				return Response.json(JSON.parse(cached), {
					headers: { "content-type": "application/json" },
				});
			}
		}

		const stored = await this.ctx.storage.get<SpecRecord>(specKey(slug));
		if (!stored) {
			return Response.json({ ok: false, error: "spec not found" }, { status: 404 });
		}
		const spec = await hydrateSpecRecord(this.ctx.storage, slug, stored);

		if (etagConflict(spec.etag, request)) {
			return Response.json(
				{ ok: false, error: "etag mismatch", code: "etag_mismatch", etag: spec.etag },
				{ status: 409, headers: etagResponseHeaders(spec.etag) },
			);
		}

		let plan: PlanRecord | null = null;
		const planId = req.plan_id ?? spec.plan_id ?? `${slug}-plan`;
		const planEvents = new Set([
			"plan_created",
			"plan_gate_c",
			"plan_review_passed",
			"phase_done",
			"implement_start",
			"ship",
		]);
		if (planEvents.has(req.event)) {
			const planStored = await this.ctx.storage.get<PlanRecord>(planKey(planId));
			if (!planStored) {
				const needsPlan = req.event !== "ship";
				if (needsPlan) {
					return Response.json(
						{ ok: false, error: "plan not found", code: "plan_not_found" },
						{ status: 404 },
					);
				}
			} else {
				plan = normalizePlanRecord(planStored);
			}
		}

		let nextSpec: SpecRecord;
		let nextPlan: PlanRecord | null = null;
		const payload = req.payload ?? {};

		try {
			if (req.event === "review_passed") {
				nextSpec = await applyBodyRevisionOnSave(
					this.ctx.storage,
					"spec",
					slug,
					spec,
					applyReviewPassed(spec, payload),
				);
			} else if (req.event === "plan_created") {
				if (!plan) throw new OrchestratePreconditionError("plan_required");
				const pair = applyPlanCreated(spec, plan);
				nextSpec = await applyBodyRevisionOnSave(
					this.ctx.storage,
					"spec",
					slug,
					spec,
					pair.spec,
				);
				nextPlan = await applyBodyRevisionOnSave(
					this.ctx.storage,
					"plan",
					plan.id,
					plan,
					pair.plan,
				);
			} else if (req.event === "plan_gate_c") {
				if (!plan) throw new OrchestratePreconditionError("plan_required");
				const pair = applyPlanGateC(spec, plan, payload);
				nextSpec = await applyBodyRevisionOnSave(
					this.ctx.storage,
					"spec",
					slug,
					spec,
					pair.spec,
				);
				nextPlan = await applyBodyRevisionOnSave(
					this.ctx.storage,
					"plan",
					plan.id,
					plan,
					pair.plan,
				);
			} else if (req.event === "plan_review_passed") {
				if (!plan) throw new OrchestratePreconditionError("plan_required");
				const pair = applyPlanReviewPassed(spec, plan, payload);
				nextSpec = await applyBodyRevisionOnSave(
					this.ctx.storage,
					"spec",
					slug,
					spec,
					pair.spec,
				);
				nextPlan = await applyBodyRevisionOnSave(
					this.ctx.storage,
					"plan",
					plan.id,
					plan,
					pair.plan,
				);
			} else if (req.event === "phase_done") {
				if (!plan) throw new OrchestratePreconditionError("plan_required");
				const pair = applyPhaseDone(spec, plan, payload);
				nextSpec = await applyBodyRevisionOnSave(
					this.ctx.storage,
					"spec",
					slug,
					spec,
					pair.spec,
				);
				nextPlan = await applyBodyRevisionOnSave(
					this.ctx.storage,
					"plan",
					plan.id,
					plan,
					pair.plan,
				);
			} else if (req.event === "implement_start") {
				if (!plan) throw new OrchestratePreconditionError("plan_required");
				const pair = applyImplementStart(spec, plan);
				nextSpec = await applyBodyRevisionOnSave(
					this.ctx.storage,
					"spec",
					slug,
					spec,
					pair.spec,
				);
				nextPlan = await applyBodyRevisionOnSave(
					this.ctx.storage,
					"plan",
					plan.id,
					plan,
					pair.plan,
				);
			} else if (req.event === "ship") {
				const pair = applyShip(spec, plan, payload);
				nextSpec = await applyBodyRevisionOnSave(
					this.ctx.storage,
					"spec",
					slug,
					spec,
					pair.spec,
				);
				if (pair.plan && plan) {
					nextPlan = await applyBodyRevisionOnSave(
						this.ctx.storage,
						"plan",
						pair.plan.id,
						plan,
						pair.plan,
					);
				}
			} else {
				return Response.json({ ok: false, error: "unknown event" }, { status: 400 });
			}
		} catch (err) {
			if (err instanceof OrchestratePreconditionError) {
				return Response.json(
					{ ok: false, error: err.message, code: err.code },
					{ status: 422 },
				);
			}
			throw err;
		}

		await putSpecRecord(this.ctx.storage, nextSpec);
		if (nextPlan) {
			await this.ctx.storage.put(planKey(nextPlan.id), nextPlan);
		}
		if (req.event === "ship" && spec.lock) {
			await removeLease(this.ctx.storage, { kind: "spec", slug });
			await removeWorkspaceLease(this.ctx.storage, slug);
		}
		if (req.event === "ship" && nextPlan?.lock) {
			await removeLease(this.ctx.storage, { kind: "plan", id: nextPlan.id });
		}

		const responseBody = {
			ok: true,
			event: req.event,
			spec: toSpecSummary(nextSpec),
			plan: nextPlan ? toPlanSummary(nextPlan) : null,
			body_changed: nextSpec.body !== spec.body,
		};

		if (req.transition_id) {
			await this.ctx.storage.put(
				`${TRANSITION_CACHE_PREFIX}${req.transition_id}`,
				JSON.stringify(responseBody),
			);
		}

		return Response.json(responseBody, { headers: etagResponseHeaders(nextSpec.etag) });
	}

	private async acquireLock(slug: string, request: Request): Promise<Response> {
		const stored = await this.ctx.storage.get<SpecRecord>(specKey(slug));
		if (!stored) {
			return Response.json({ ok: false, error: "spec not found" }, { status: 404 });
		}
		const record = await hydrateSpecRecord(this.ctx.storage, slug, stored);

		let raw: unknown = {};
		try {
			raw = await request.json();
		} catch {
			/* identity-only lock */
		}

		const holder = resolveLockHolder(request, parseOptionalLockBody(raw));
		if (!holder) {
			return Response.json({ ok: false, error: "identity or agent_id required" }, { status: 400 });
		}

		if (record.lock && record.lock.agent_id !== holder.holder_id) {
			return Response.json(
				{ ok: false, error: "lock held", lock: record.lock },
				{ status: 409 },
			);
		}

		const leaseParsed = this.resolveLeaseSeconds(raw, holder);
		if (!leaseParsed.ok) {
			return Response.json({ ok: false, error: leaseParsed.error }, { status: 400 });
		}

		const now = new Date().toISOString();
		const activity = resolveLockActivity(raw, record.lock);
		const updated: SpecRecord = {
			...record,
			lock: lockWithLease(holder, now, leaseParsed.value, activity),
			updated_at: now,
			etag: now,
		};
		await putSpecRecord(this.ctx.storage, updated);
		await upsertLease(this.ctx.storage, { kind: "spec", slug }, updated.lock!);
		return Response.json({ ok: true, spec: normalizeSpecRecord(updated) });
	}

	private async releaseLock(slug: string, request: Request): Promise<Response> {
		const stored = await this.ctx.storage.get<SpecRecord>(specKey(slug));
		if (!stored) {
			return Response.json({ ok: false, error: "spec not found" }, { status: 404 });
		}
		const record = await hydrateSpecRecord(this.ctx.storage, slug, stored);

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

		const now = new Date().toISOString();
		const updated: SpecRecord = {
			...record,
			lock: null,
			updated_at: now,
			etag: now,
		};
		await putSpecRecord(this.ctx.storage, updated);
		await removeLease(this.ctx.storage, { kind: "spec", slug });
		await removeWorkspaceLease(this.ctx.storage, slug);
		return Response.json({ ok: true, spec: updated });
	}

	private async loadAllSpecs(includeDone: boolean): Promise<SpecRecord[]> {
		const slugs = (await this.ctx.storage.get<string[]>(SPEC_INDEX_KEY)) ?? [];
		const specs: SpecRecord[] = [];
		for (const slug of slugs) {
			const stored = await this.ctx.storage.get<SpecRecord>(specKey(slug));
			if (!stored) continue;
			const record = await hydrateSpecRecord(this.ctx.storage, slug, stored);
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
		const specSlugFilter = url.searchParams.get("spec_slug")?.trim() ?? "";
		let plans = await this.loadAllPlans(includeDone);
		if (specSlugFilter) {
			plans = plans.filter((p) => p.spec_slug === specSlugFilter);
		}
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
		const plan = normalizePlanRecord(stored);
		const summary = toPlanSummary(plan);
		return Response.json(
			{
				ok: true,
				plan: {
					...plan,
					phases_done: summary.phases_done,
					phases_total: summary.phases_total,
					tasks_done: summary.tasks_done,
					tasks_total: summary.tasks_total,
					completion_ratio: summary.completion_ratio,
					active_phase: summary.active_phase,
				},
			},
			{ headers: etagResponseHeaders(plan.etag) },
		);
	}

	private async listPlanRevisions(id: string, url: URL): Promise<Response> {
		const stored = await this.ctx.storage.get<PlanRecord>(planKey(id));
		if (!stored) {
			return Response.json({ ok: false, error: "plan not found" }, { status: 404 });
		}
		const limit = parseRevisionLimit(url.searchParams.get("limit"));
		const result = await listRevisions(this.ctx.storage, "plan", id, limit);
		return Response.json({ ok: true, revisions: result.revisions, count: result.count });
	}

	private async getPlanRevision(id: string, baseEtag: string): Promise<Response> {
		const stored = await this.ctx.storage.get<PlanRecord>(planKey(id));
		if (!stored) {
			return Response.json({ ok: false, error: "plan not found" }, { status: 404 });
		}
		const revision = await getRevision(this.ctx.storage, "plan", id, baseEtag);
		if (!revision) {
			return Response.json({ ok: false, error: "revision not found" }, { status: 404 });
		}
		return Response.json({ ok: true, revision });
	}

	private async getPlanDiff(id: string, url: URL): Promise<Response> {
		const stored = await this.ctx.storage.get<PlanRecord>(planKey(id));
		if (!stored) {
			return Response.json({ ok: false, error: "plan not found" }, { status: 404 });
		}
		const plan = normalizePlanRecord(stored);
		const diff = await buildRevisionDiff(
			this.ctx.storage,
			"plan",
			id,
			plan,
			url.searchParams.get("base"),
			url.searchParams.get("head"),
		);
		if (!diff) {
			return Response.json({ ok: false, error: "revision not found" }, { status: 404 });
		}
		return Response.json({ ok: true, ...diff });
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

		const record = await applyBodyRevisionOnSave(
			this.ctx.storage,
			"plan",
			parsed.value.id,
			existing,
			parsed.value,
		);
		const ids = new Set((await this.ctx.storage.get<string[]>(PLAN_INDEX_KEY)) ?? []);
		ids.add(record.id);
		const created = !existing;
		await this.ctx.storage.put(planKey(record.id), record);
		await this.ctx.storage.put(PLAN_INDEX_KEY, [...ids].sort());

		if (record.spec_slug) {
			const specStored = await this.ctx.storage.get<SpecRecord>(specKey(record.spec_slug));
			if (specStored) {
				const spec = await hydrateSpecRecord(this.ctx.storage, record.spec_slug, specStored);
				const linked = linkSpecPlanId(spec, record.id, record.spec_slug);
				if (linked) {
					await putSpecRecord(this.ctx.storage, linked);
				}
			}
		}

		return Response.json({ ok: true, plan: record }, { status: created ? 201 : 200 });
	}

	private async deletePlan(id: string): Promise<Response> {
		const stored = await this.ctx.storage.get<PlanRecord>(planKey(id));
		if (!stored) {
			return Response.json({ ok: false, error: "plan not found" }, { status: 404 });
		}
		await this.ctx.storage.delete(planKey(id));
		const ids = (await this.ctx.storage.get<string[]>(PLAN_INDEX_KEY)) ?? [];
		await this.ctx.storage.put(
			PLAN_INDEX_KEY,
			ids.filter((planId) => planId !== id),
		);
		return Response.json({ ok: true, deleted: id });
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

		if (etagConflict(record.etag, request, parsed.value.etag)) {
			return Response.json(
				{ ok: false, error: "etag mismatch", etag: record.etag },
				{ status: 409, headers: etagResponseHeaders(record.etag) },
			);
		}

		const nextPhases = parsed.value.phases ?? record.phases;
		const stampedPhases = stampPhaseCompletions(record.phases, nextPhases);

		const now = new Date().toISOString();
		const nextStatus = parsed.value.status ?? record.status;
		const updated: PlanRecord = {
			...record,
			status: nextStatus,
			tasks: parsed.value.tasks ?? record.tasks,
			phases: stampedPhases,
			user_instructions: parsed.value.user_instructions ?? record.user_instructions,
			deploy:
				parsed.value.deploy !== undefined ? parsed.value.deploy : record.deploy,
			lock: nextStatus === "done" ? null : record.lock,
			updated_at: now,
			etag: now,
		};
		const next_actions = planNextActionsAfterPatch(record, updated);
		await this.ctx.storage.put(planKey(id), updated);
		if (nextStatus === "done" && record.lock) {
			await removeLease(this.ctx.storage, { kind: "plan", id });
			if (record.spec_slug) {
				await removeWorkspaceLease(this.ctx.storage, record.spec_slug);
			}
		}
		return Response.json(
			{ ok: true, plan: updated, next_actions },
			{ headers: etagResponseHeaders(updated.etag) },
		);
	}

	private async acquirePlanLock(id: string, request: Request): Promise<Response> {
		const stored = await this.ctx.storage.get<PlanRecord>(planKey(id));
		if (!stored) {
			return Response.json({ ok: false, error: "plan not found" }, { status: 404 });
		}
		const record = normalizePlanRecord(stored);

		let raw: unknown = {};
		try {
			raw = await request.json();
		} catch {
			/* identity-only lock */
		}

		const holder = resolveLockHolder(request, parseOptionalLockBody(raw));
		if (!holder) {
			return Response.json({ ok: false, error: "identity or agent_id required" }, { status: 400 });
		}

		if (record.lock && record.lock.agent_id !== holder.holder_id) {
			return Response.json(
				{ ok: false, error: "lock held", lock: record.lock },
				{ status: 409 },
			);
		}

		const leaseParsed = this.resolveLeaseSeconds(raw, holder);
		if (!leaseParsed.ok) {
			return Response.json({ ok: false, error: leaseParsed.error }, { status: 400 });
		}

		const now = new Date().toISOString();
		const activity = resolveLockActivity(raw, record.lock);
		const lock = lockWithLease(holder, now, leaseParsed.value, activity);
		const updated: PlanRecord = {
			...record,
			lock,
			status: record.status === "ready" ? "in_progress" : record.status,
			updated_at: now,
		};
		await this.ctx.storage.put(planKey(id), updated);
		await upsertLease(this.ctx.storage, { kind: "plan", id }, lock);
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
		await removeLease(this.ctx.storage, { kind: "plan", id });
		if (record.spec_slug) {
			await removeWorkspaceLease(this.ctx.storage, record.spec_slug);
		}
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

		const holder = resolveLockHolder(request, parsed.value.agent_id);
		if (!holder) {
			return Response.json({ ok: false, error: "identity or agent_id required" }, { status: 400 });
		}
		const leaseParsed =
			parsed.value.lease_seconds !== undefined
				? parseLeaseSeconds(parsed.value.lease_seconds, holder.holder_kind)
				: parseLeaseSeconds(undefined, holder.holder_kind);
		if (!leaseParsed.ok) {
			return Response.json({ ok: false, error: leaseParsed.error }, { status: 400 });
		}
		const leaseSeconds = leaseParsed.value;
		const { exclude, kind, platform_root, workspace_isolation } = parsed.value;
		if (workspace_isolation) {
			const rootParsed = validatePlatformRoot(platform_root);
			if (!rootParsed.ok) {
				return Response.json({ ok: false, error: rootParsed.error }, { status: 400 });
			}
		}
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
					holder,
					candidate.record,
					candidate.phase.id,
					leaseSeconds,
				);
				if (lockRes.ok) {
					await this.ctx.storage.put(planKey(candidate.record.id), lockRes.plan);
					await upsertLease(
						this.ctx.storage,
						{ kind: "plan-phase", id: candidate.record.id, phaseId: candidate.phase.id },
						lockRes.plan.phases.find((p) => p.id === candidate.phase.id)!.lock!,
					);
					const phase = lockRes.plan.phases.find((p) => p.id === candidate.phase.id)!;
					const workspace = await this.bindWorkspaceOnTake(
						lockRes.plan.spec_slug,
						"plan",
						phase.lock!,
						platform_root,
						workspace_isolation,
					);
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
						...(workspace ? { workspace } : {}),
					});
				}
				if (lockRes.status !== 409) {
					return Response.json({ ok: false, error: lockRes.error }, { status: lockRes.status });
				}
				continue;
			}

			if (candidate.kind === "phase_bridge") {
				const lockRes = this.acquireSpecLockInternal(holder, candidate.record, leaseSeconds);
				if (lockRes.ok) {
					await putSpecRecord(this.ctx.storage, lockRes.spec);
					await upsertLease(
						this.ctx.storage,
						{ kind: "spec", slug: candidate.record.slug },
						lockRes.spec.lock!,
					);
					const pending = candidate.record.phases.find(
						(p) => p.status === "pending" || p.status === "active",
					);
					const workspace = await this.bindWorkspaceOnTake(
						candidate.record.slug,
						"spec",
						lockRes.spec.lock!,
						platform_root,
						workspace_isolation,
					);
					return Response.json({
						ok: true,
						kind: "phase_bridge",
						completion_ratio: candidate.completion_ratio,
						spec_slug: candidate.record.slug,
						phase_id: pending?.id ?? null,
						phase_name: pending?.title ?? candidate.record.active_phase,
						spec: toSpecSummary(lockRes.spec),
						...(workspace ? { workspace } : {}),
					});
				}
				if (lockRes.status !== 409) {
					return Response.json({ ok: false, error: lockRes.error }, { status: lockRes.status });
				}
				continue;
			}

			const lockRes = this.acquireSpecLockInternal(holder, candidate.record, leaseSeconds);
			if (lockRes.ok) {
				await putSpecRecord(this.ctx.storage, lockRes.spec);
				await upsertLease(
					this.ctx.storage,
					{ kind: "spec", slug: candidate.record.slug },
					lockRes.spec.lock!,
				);
				const workspace = await this.bindWorkspaceOnTake(
					candidate.record.slug,
					"spec",
					lockRes.spec.lock!,
					platform_root,
					workspace_isolation,
				);
				return Response.json({
					ok: true,
					kind: "spec",
					completion_ratio: candidate.completion_ratio,
					spec_slug: candidate.record.slug,
					spec: toSpecSummary(lockRes.spec),
					...(workspace ? { workspace } : {}),
				});
			}
			if (lockRes.status !== 409) {
				return Response.json({ ok: false, error: lockRes.error }, { status: lockRes.status });
			}
		}

		return Response.json({ ok: true, empty: true, eligible_count: 0 });
	}

	private acquireSpecLockInternal(
		holder: LockHolder,
		record: SpecRecord,
		leaseSeconds: number,
		activity?: string,
	): { ok: true; spec: SpecRecord } | { ok: false; error: string; status: number } {
		if (record.lock && record.lock.agent_id !== holder.holder_id) {
			return { ok: false, error: "lock held", status: 409 };
		}
		const now = new Date().toISOString();
		const lockActivity = activity ?? record.lock?.activity;
		const updated: SpecRecord = {
			...record,
			lock: lockWithLease(holder, now, leaseSeconds, lockActivity),
			updated_at: now,
			etag: now,
		};
		return { ok: true, spec: updated };
	}

	private acquirePlanPhaseLockInternal(
		holder: LockHolder,
		record: PlanRecord,
		phaseId: string,
		leaseSeconds: number,
		activity?: string,
	): { ok: true; plan: PlanRecord } | { ok: false; error: string; status: number } {
		const pickable = nextPickablePhase(record);
		if (!pickable || pickable.id !== phaseId) {
			return { ok: false, error: "phase not available", status: 409 };
		}
		const phase = record.phases.find((p) => p.id === phaseId);
		if (!phase) return { ok: false, error: "phase not found", status: 404 };
		if (phase.lock && phase.lock.agent_id !== holder.holder_id) {
			return { ok: false, error: "lock held", status: 409 };
		}
		const now = new Date().toISOString();
		const lockActivity = activity ?? phase.lock?.activity;
		const phaseLock = lockWithLease(holder, now, leaseSeconds, lockActivity);
		const phases = record.phases.map((p) =>
			p.id === phaseId
				? {
						...p,
						lock: phaseLock,
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

		let raw: unknown = {};
		try {
			raw = await request.json();
		} catch {
			/* identity-only lock */
		}
		const holder = resolveLockHolder(request, parseOptionalLockBody(raw));
		if (!holder) {
			return Response.json({ ok: false, error: "identity or agent_id required" }, { status: 400 });
		}

		const leaseParsed = this.resolveLeaseSeconds(raw, holder);
		if (!leaseParsed.ok) {
			return Response.json({ ok: false, error: leaseParsed.error }, { status: 400 });
		}

		const activity = resolveLockActivity(
			raw,
			record.phases.find((p) => p.id === phaseId)?.lock ?? null,
		);
		const lockRes = this.acquirePlanPhaseLockInternal(
			holder,
			record,
			phaseId,
			leaseParsed.value,
			activity,
		);
		if (!lockRes.ok) {
			return Response.json({ ok: false, error: lockRes.error }, { status: lockRes.status });
		}
		await this.ctx.storage.put(planKey(id), lockRes.plan);
		const phase = lockRes.plan.phases.find((p) => p.id === phaseId)!;
		await upsertLease(
			this.ctx.storage,
			{ kind: "plan-phase", id, phaseId },
			phase.lock!,
		);
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
		await removeLease(this.ctx.storage, { kind: "plan-phase", id, phaseId });
		if (record.spec_slug) {
			await removeWorkspaceLease(this.ctx.storage, record.spec_slug);
		}
		return Response.json({ ok: true, plan: updated });
	}

	private resolveLeaseSeconds(
		raw: unknown,
		holder: LockHolder,
	): { ok: true; value: number } | { ok: false; error: string } {
		const override =
			raw && typeof raw === "object"
				? (raw as { lease_seconds?: unknown }).lease_seconds
				: undefined;
		return parseLeaseSeconds(override, holder.holder_kind);
	}

	private async processDueLeases(): Promise<void> {
		const entries = await listLeaseEntries(this.ctx.storage);
		const due = dueLeaseEntries(entries, Date.now());
		for (const entry of due) {
			await this.expireLease(entry);
		}
		await syncLeaseAlarm(this.ctx.storage);
	}

	private async expireLease(entry: LeaseEntry): Promise<void> {
		const now = new Date().toISOString();
		const target = entry.target;

		if (target.kind === "spec") {
			const stored = await this.ctx.storage.get<SpecRecord>(specKey(target.slug));
			if (stored?.lock) {
				const record = await hydrateSpecRecord(this.ctx.storage, target.slug, stored);
				await putSpecRecord(this.ctx.storage, {
					...record,
					lock: null,
					status: record.status === "in_progress" ? "ready" : record.status,
					updated_at: now,
					etag: now,
				});
			}
			console.log(
				JSON.stringify({ event: "lease_expired", kind: "spec", slug: target.slug, holder_id: entry.holder_id }),
			);
		} else if (target.kind === "plan") {
			const stored = await this.ctx.storage.get<PlanRecord>(planKey(target.id));
			if (stored?.lock) {
				const record = normalizePlanRecord(stored);
				await this.ctx.storage.put(planKey(target.id), {
					...record,
					lock: null,
					status: record.status === "in_progress" ? "ready" : record.status,
					updated_at: now,
				});
			}
			console.log(
				JSON.stringify({ event: "lease_expired", kind: "plan", id: target.id, holder_id: entry.holder_id }),
			);
		} else {
			const stored = await this.ctx.storage.get<PlanRecord>(planKey(target.id));
			if (stored) {
				const record = normalizePlanRecord(stored);
				await this.ctx.storage.put(planKey(target.id), {
					...record,
					phases: record.phases.map((p) =>
						p.id === target.phaseId
							? {
									...p,
									lock: null,
									status: p.status === "active" ? ("pending" as PlanPhase["status"]) : p.status,
								}
							: p,
					),
					updated_at: now,
				});
			}
			console.log(
				JSON.stringify({
					event: "lease_expired",
					kind: "plan-phase",
					id: target.id,
					phaseId: target.phaseId,
					holder_id: entry.holder_id,
				}),
			);
		}

		await this.ctx.storage.delete(leaseStorageKey(target));

		const specSlug = await this.specSlugForLeaseTarget(target);
		if (specSlug) {
			await removeWorkspaceLease(this.ctx.storage, specSlug);
		}
	}

	private async specSlugForLeaseTarget(target: LeaseEntry["target"]): Promise<string | null> {
		if (target.kind === "spec") return target.slug;
		const stored = await this.ctx.storage.get<PlanRecord>(planKey(target.id));
		return stored?.spec_slug ?? null;
	}

	private async bindWorkspaceOnTake(
		specSlug: string,
		kind: "spec" | "plan",
		lock: NonNullable<SpecRecord["lock"]>,
		platformRoot: string | undefined,
		workspaceIsolation: boolean,
	): Promise<WorkspaceLease | undefined> {
		if (!workspaceIsolation || !platformRoot) return undefined;
		const rootParsed = validatePlatformRoot(platformRoot);
		if (!rootParsed.ok) return undefined;
		const existing = await getWorkspaceLease(this.ctx.storage, specSlug);
		if (existing && existing.agent_id !== lock.agent_id) {
			return existing;
		}
		const lease = computeWorkspaceManifest(specSlug, kind, rootParsed.value, lock);
		await upsertWorkspaceLease(this.ctx.storage, lease);
		return lease;
	}

	private async listWorkspaces(url: URL): Promise<Response> {
		const specSlug = url.searchParams.get("spec_slug")?.trim() || undefined;
		const leases = await listWorkspaceLeases(this.ctx.storage, specSlug);
		return Response.json({
			ok: true,
			workspaces: leases.map(toWorkspaceSummary),
		});
	}

	private async deleteWorkspace(id: string, request: Request): Promise<Response> {
		const lease = await getWorkspaceLease(this.ctx.storage, id);
		if (!lease) {
			return Response.json({ ok: true, deleted: false, idempotent: true });
		}

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

		if (agentId && lease.agent_id !== agentId) {
			return Response.json(
				{ ok: false, error: "workspace held by another agent", workspace: toWorkspaceSummary(lease) },
				{ status: 403 },
			);
		}

		await removeWorkspaceLease(this.ctx.storage, id);
		return Response.json({ ok: true, deleted: true, id });
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
