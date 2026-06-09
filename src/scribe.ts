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
import {
	resolveLockHolder,
	resolveLockSessionId,
	sameLockPrincipal,
	sessionLockConflict,
	type LockHolder,
} from "./identity.ts";
import {
	dueLeaseEntries,
	leaseStorageKey,
	listLeaseEntries,
	lockWithLease,
	parseLeaseSeconds,
	refreshLockLease,
	deleteLeaseEntry,
	putLeaseEntry,
	removeLease,
	syncLeaseAlarm,
	upsertLease,
	type LeaseEntry,
	type LeaseTarget,
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
import {
	parseOptionalLockBody,
	parseOptionalSessionId,
	resolveLockActivity,
} from "./spec.ts";
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
	type SpecLock,
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
} from "./revision.ts";
import {
	appendRevisionRecordIfNeeded,
	getRevisionRecord,
	initRevisionSchema,
	listRevisionRecords,
	loadRevisionsSummary,
	parseRevisionAppendInput,
	parseRevisionListLimit,
	parseRevisionOffset,
	parseRevisionPreview,
	reviewerFromHolder,
	toRevisionSummaryEntry,
	type RevisionHandler,
	type RevisionSql,
	type RevisionTargetKind,
	type RevisionsSummary,
} from "./revision-record.ts";
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
import {
	buildQueueTakenEventId,
	type LockChangedCause,
	type SpecUpdatedCause,
} from "./events.ts";
import {
	buildAgentAssignmentFromResume,
	buildAgentAssignmentFromTake,
	nextActionsForMode,
	parseAgentCheckInInput,
} from "./agent-check-in.ts";
import {
	planPhaseLockStillAvailable,
	specLockStillAvailable,
	tryAcquirePlanPhaseLock,
	tryAcquireSpecLock,
} from "./coordinator.ts";
import {
	initLeaseSchema,
	migrateKvLeasesToSql,
} from "./lease-store.ts";
import {
	broadcastScribeEvent,
	buildConnectedFrame,
	isWebSocketUpgrade,
	parseClientFilters,
	parseSinceSeq,
	type WsSessionAttachment,
} from "./ws-sessions.ts";

const SCRIBE_PROJECT = "ged";

export interface ScribeEnv {
	SCRIBE: DurableObjectNamespace<Scribe>;
	ASSETS?: Fetcher;
}

export class Scribe extends DurableObject<ScribeEnv> {
	constructor(ctx: DurableObjectState, env: ScribeEnv) {
		super(ctx, env);
		ctx.blockConcurrencyWhile(async () => {
			const sql = this.revisionSql();
			initRevisionSchema(sql);
			initLeaseSchema(sql);
			await migrateKvLeasesToSql(this.ctx.storage, sql);
			await syncLeaseAlarm(this.ctx.storage, sql);
		});
	}

	private revisionSql(): RevisionSql {
		return this.ctx.storage.sql as unknown as RevisionSql;
	}

	private async fanOutSpecUpdated(record: SpecRecord, cause: SpecUpdatedCause): Promise<void> {
		await broadcastScribeEvent(this.ctx.storage, this.ctx, SCRIBE_PROJECT, {
			type: "spec_updated",
			spec: toSpecSummary(record),
			cause,
		});
	}

	private async fanOutPlanUpdated(record: PlanRecord): Promise<void> {
		await broadcastScribeEvent(this.ctx.storage, this.ctx, SCRIBE_PROJECT, {
			type: "plan_updated",
			plan: toPlanSummary(record),
		});
	}

	private async fanOutLockChanged(
		target: LeaseTarget["kind"],
		cause: LockChangedCause,
		lock: SpecLock | null,
		specSlug: string,
		planId?: string,
		phaseId?: string,
	): Promise<void> {
		await broadcastScribeEvent(this.ctx.storage, this.ctx, SCRIBE_PROJECT, {
			type: "lock_changed",
			target,
			cause,
			lock,
			spec_slug: specSlug,
			...(planId ? { plan_id: planId } : {}),
			...(phaseId ? { phase_id: phaseId } : {}),
		});
	}

	private async fanOutQueueTaken(
		holder: LockHolder,
		body: {
			kind: string;
			spec_slug?: string;
			plan_id?: string;
			phase?: { id?: string };
			phase_id?: string | null;
			spec?: { etag?: string };
			plan?: { etag?: string };
		},
	): Promise<void> {
		const phaseId = body.phase?.id ?? body.phase_id ?? undefined;
		const lockEtag = body.spec?.etag ?? body.plan?.etag;
		const event_id = await buildQueueTakenEventId({
			kind: body.kind,
			spec_slug: body.spec_slug,
			plan_id: body.plan_id,
			phase_id: phaseId ?? undefined,
			lock_etag: lockEtag,
		});
		await broadcastScribeEvent(
			this.ctx.storage,
			this.ctx,
			SCRIBE_PROJECT,
			{
				type: "queue_taken",
				kind: body.kind,
				agent_id: holder.holder_id,
				...(body.spec_slug ? { spec_slug: body.spec_slug } : {}),
				...(body.plan_id ? { plan_id: body.plan_id } : {}),
				...(phaseId ? { phase_id: phaseId } : {}),
			},
			{ event_id },
		);
	}

	private async fanOutTransitionApplied(
		transition: {
			event: string;
			spec: ReturnType<typeof toSpecSummary>;
			plan: ReturnType<typeof toPlanSummary> | null;
			body_changed: boolean;
		},
	): Promise<void> {
		await broadcastScribeEvent(this.ctx.storage, this.ctx, SCRIBE_PROJECT, {
			type: "transition_applied",
			transition: transition as never,
		});
	}

	private async auditRevisionOnSave(
		request: Request,
		raw: unknown,
		targetKind: RevisionTargetKind,
		before: SpecRecord | PlanRecord | null,
		after: SpecRecord | PlanRecord,
		handler: RevisionHandler,
	): Promise<Response | null> {
		if (!before) return null;
		const holder = resolveLockHolder(request, parseOptionalLockBody(raw));
		const input = parseRevisionAppendInput(
			raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {},
		);
		const result = await appendRevisionRecordIfNeeded(
			this.revisionSql(),
			targetKind,
			before,
			after,
			holder ? reviewerFromHolder(holder) : null,
			input,
			handler,
		);
		if (!result.ok) {
			return Response.json({ ok: false, error: result.error }, { status: result.status });
		}
		return null;
	}

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
			return this.applyOrchestrateTransition(decodeURIComponent(orchestrateMatch[1]), request);
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
			if (request.method === "GET") return this.getPlan(id, url);
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

		if (url.pathname === "/agents/check-in" && request.method === "POST") {
			return this.agentCheckIn(request);
		}

		if (url.pathname === "/queue/take" && request.method === "POST") {
			return this.takeQueueItem(request);
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

		if (url.pathname === "/events" && request.method === "GET") {
			return this.handleEvents(request, url);
		}

		return Response.json({ ok: false, error: "not found" }, { status: 404 });
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		const text = typeof message === "string" ? message : new TextDecoder().decode(message);
		let parsed: { type?: string };
		try {
			parsed = JSON.parse(text) as { type?: string };
		} catch {
			return;
		}
		if (parsed?.type === "ping") {
			ws.send(JSON.stringify({ type: "pong" }));
		}
	}

	async webSocketClose(
		_ws: WebSocket,
		_code: number,
		_reason: string,
		_wasClean: boolean,
	): Promise<void> {
		// Hibernation — sessions reattach on next message; no per-close cleanup in v1.
	}

	private async handleEvents(request: Request, url: URL): Promise<Response> {
		if (!isWebSocketUpgrade(request)) {
			return Response.json({ ok: false, error: "upgrade required" }, { status: 426 });
		}
		const holder = resolveLockHolder(request);
		if (!holder) {
			return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
		}

		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];
		const project = url.searchParams.get("project")?.trim() || SCRIBE_PROJECT;
		const sinceSeq = parseSinceSeq(url);
		const filters = parseClientFilters(url.searchParams);
		const attachment: WsSessionAttachment = { filters, since_seq: sinceSeq, project };

		this.ctx.acceptWebSocket(server);
		server.serializeAttachment(JSON.stringify(attachment));

		const connected = await buildConnectedFrame(this.ctx.storage, project, sinceSeq);
		server.send(JSON.stringify(connected));

		return new Response(null, { status: 101, webSocket: client });
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

	private revisionsSummaryFor(
		targetKind: RevisionTargetKind,
		targetId: string,
		preview: number,
	): RevisionsSummary {
		return loadRevisionsSummary(this.revisionSql(), targetKind, targetId, preview);
	}

	private async getSpec(slug: string, url: URL): Promise<Response> {
		const stored = await this.ctx.storage.get<SpecRecord>(specKey(slug));
		if (!stored) {
			return Response.json({ ok: false, error: "spec not found" }, { status: 404 });
		}
		const metadata = normalizeSpecRecord(stored);
		const revisions_summary = this.revisionsSummaryFor(
			"spec",
			slug,
			parseRevisionPreview(url.searchParams.get("revision_preview")),
		);
		const view = url.searchParams.get("view") ?? "full";
		if (view === "summary") {
			const footerBody = needsFooterBodyParse(metadata)
				? await resolveSpecBody(this.ctx.storage, slug, stored)
				: "";
			const orient = toSpecOrientView(metadata, parseSpecFooterFields(footerBody));
			return Response.json(
				{ ok: true, spec: { ...orient, revisions_summary } },
				{ headers: etagResponseHeaders(metadata.etag) },
			);
		}
		const spec = await this.loadSpecRecord(slug, stored);
		return Response.json(
			{ ok: true, spec: { ...spec, revisions_summary } },
			{ headers: etagResponseHeaders(spec.etag) },
		);
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
		const limit = parseRevisionListLimit(url.searchParams.get("limit"));
		const offset = parseRevisionOffset(url.searchParams.get("offset"));
		const result = listRevisionRecords(this.revisionSql(), "spec", slug, limit, offset);
		return Response.json({
			ok: true,
			revisions: result.revisions.map(toRevisionSummaryEntry),
			count: result.total,
			limit,
			offset,
		});
	}

	private async getSpecRevision(slug: string, revisionId: string): Promise<Response> {
		const stored = await this.ctx.storage.get<SpecRecord>(specKey(slug));
		if (!stored) {
			return Response.json({ ok: false, error: "spec not found" }, { status: 404 });
		}
		const revision = getRevisionRecord(this.revisionSql(), revisionId);
		if (!revision || revision.target_kind !== "spec" || revision.target_id !== slug) {
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
		const staleInProgress =
			stored.status === "in_progress" && !stored.lock && record.status === "ready";
		if (!staleInProgress) return record;

		const orphanLease = await this.ctx.storage.get<LeaseEntry>(
			leaseStorageKey({ kind: "spec", slug }),
		);
		if (orphanLease) {
			await this.releaseSpecLockRecord(slug, record);
		} else {
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
		const auditErr = await this.auditRevisionOnSave(
			request,
			raw,
			"spec",
			existing,
			record,
			"save",
		);
		if (auditErr) return auditErr;
		const slugs = new Set((await this.ctx.storage.get<string[]>(SPEC_INDEX_KEY)) ?? []);
		slugs.add(record.slug);
		const created = !existing;
		await putSpecRecord(this.ctx.storage, record);
		await this.ctx.storage.put(SPEC_INDEX_KEY, [...slugs].sort());
		await this.fanOutSpecUpdated(record, "patchSpec");

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
		const holder = resolveLockHolder(request, undefined);
		let activeLock = record.lock;
		if (activeLock && holder && sameLockPrincipal(holder, activeLock, request)) {
			activeLock = refreshLockLease(activeLock, now);
		}
		const nextStatus = parsed.value.status ?? record.status;
		const nextBody = parsed.value.body !== undefined ? parsed.value.body : record.body;
		const updated: SpecRecord = {
			...record,
			body: nextBody,
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
			lock: nextStatus === "done" ? null : activeLock,
			updated_at: now,
			etag: now,
		};
		const withRevisions = await applyBodyRevisionOnSave(
			this.ctx.storage,
			"spec",
			slug,
			record,
			updated,
		);
		const auditErr = await this.auditRevisionOnSave(
			request,
			raw,
			"spec",
			record,
			withRevisions,
			"patch",
		);
		if (auditErr) return auditErr;
		if (nextStatus === "done" && record.lock) {
			const sql = this.revisionSql();
			await this.ctx.storage.transaction(async (txn) => {
				await putSpecRecord(txn, withRevisions);
				await deleteLeaseEntry(txn, { kind: "spec", slug }, sql);
				await removeWorkspaceLease(txn, slug);
			});
			await syncLeaseAlarm(this.ctx.storage, sql);
		} else if (activeLock && activeLock.expires_at !== record.lock?.expires_at) {
			const sql = this.revisionSql();
			await this.ctx.storage.transaction(async (txn) => {
				await putSpecRecord(txn, withRevisions);
				await putLeaseEntry(txn, { kind: "spec", slug }, activeLock, sql);
				const ws = await getWorkspaceLease(txn, slug);
				if (ws) {
					await upsertWorkspaceLease(
						txn,
						computeWorkspaceManifest(slug, ws.kind, ws.platform_root, activeLock),
					);
				}
			});
			await syncLeaseAlarm(this.ctx.storage, sql);
		} else {
			await putSpecRecord(this.ctx.storage, withRevisions);
		}
		await this.fanOutSpecUpdated(withRevisions, "patchSpec");
		return Response.json(
			{ ok: true, spec: withRevisions },
			{ headers: etagResponseHeaders(withRevisions.etag) },
		);
	}

	/** DO RPC — apply orchestrator transition; HTTP fetch delegates here. */
	async applyOrchestrateTransition(slug: string, request: Request): Promise<Response> {
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

		const responseBody = {
			ok: true,
			event: req.event,
			spec: toSpecSummary(nextSpec),
			plan: nextPlan ? toPlanSummary(nextPlan) : null,
			body_changed: nextSpec.body !== spec.body,
		};

		const shipClearsSpecLease = req.event === "ship" && spec.lock;
		const shipClearsPlanLease = req.event === "ship" && nextPlan?.lock;
		const sql = this.revisionSql();

		await this.ctx.storage.transaction(async (txn) => {
			await putSpecRecord(txn, nextSpec);
			if (nextPlan) {
				await txn.put(planKey(nextPlan.id), nextPlan);
			}
			if (shipClearsSpecLease) {
				await deleteLeaseEntry(txn, { kind: "spec", slug }, sql);
				await removeWorkspaceLease(txn, slug);
			}
			if (shipClearsPlanLease && nextPlan) {
				await deleteLeaseEntry(txn, { kind: "plan", id: nextPlan.id }, sql);
			}
			if (req.transition_id) {
				await txn.put(
					`${TRANSITION_CACHE_PREFIX}${req.transition_id}`,
					JSON.stringify(responseBody),
				);
			}
		});

		if (shipClearsSpecLease || shipClearsPlanLease) {
			await syncLeaseAlarm(this.ctx.storage, sql);
		}

		await this.fanOutSpecUpdated(nextSpec, "transition");
		if (nextPlan) await this.fanOutPlanUpdated(nextPlan);
		await this.fanOutTransitionApplied({
			event: req.event,
			spec: toSpecSummary(nextSpec),
			plan: nextPlan ? toPlanSummary(nextPlan) : null,
			body_changed: nextSpec.body !== spec.body,
		});

		return Response.json(responseBody, { headers: etagResponseHeaders(nextSpec.etag) });
	}

	private async respondQueueTake(holder: LockHolder, body: Record<string, unknown>): Promise<Response> {
		await this.fanOutQueueTaken(holder, {
			kind: String(body.kind ?? ""),
			spec_slug: typeof body.spec_slug === "string" ? body.spec_slug : undefined,
			plan_id: typeof body.plan_id === "string" ? body.plan_id : undefined,
			phase:
				body.phase && typeof body.phase === "object"
					? (body.phase as { id?: string })
					: undefined,
			phase_id:
				typeof body.phase_id === "string" || body.phase_id === null
					? body.phase_id
					: undefined,
			spec:
				body.spec && typeof body.spec === "object"
					? (body.spec as { etag?: string })
					: undefined,
			plan:
				body.plan && typeof body.plan === "object"
					? (body.plan as { etag?: string })
					: undefined,
		});
		return Response.json(body);
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

		const sessionId = parseOptionalSessionId(raw);
		if (record.lock && !sameLockPrincipal(holder, record.lock, request)) {
			return Response.json(
				{ ok: false, error: "lock held", lock: record.lock },
				{ status: 409 },
			);
		}
		if (record.lock && sessionLockConflict(record.lock, sessionId)) {
			return Response.json(
				{ ok: false, error: "lock held by another session", lock: record.lock },
				{ status: 409 },
			);
		}

		const leaseParsed = this.resolveLeaseSeconds(raw, holder);
		if (!leaseParsed.ok) {
			return Response.json({ ok: false, error: leaseParsed.error }, { status: 400 });
		}

		const now = new Date().toISOString();
		const activity = resolveLockActivity(raw, record.lock);
		const lockSessionId = resolveLockSessionId(record.lock, sessionId);
		const updated: SpecRecord = {
			...record,
			lock: lockWithLease(holder, now, leaseParsed.value, activity, lockSessionId),
			updated_at: now,
			etag: now,
		};
		const committed = await this.persistSpecQueueTake(
			slug,
			updated,
			updated.lock!,
			holder,
			request,
			sessionId,
		);
		if (!committed) {
			return Response.json({ ok: false, error: "lock held" }, { status: 409 });
		}
		await this.fanOutLockChanged("spec", "acquire", updated.lock!, slug);
		return Response.json({ ok: true, spec: normalizeSpecRecord(updated) });
	}

	private async releaseLock(slug: string, request: Request): Promise<Response> {
		const stored = await this.ctx.storage.get<SpecRecord>(specKey(slug));
		if (!stored) {
			return Response.json({ ok: false, error: "spec not found" }, { status: 404 });
		}
		const record = await hydrateSpecRecord(this.ctx.storage, slug, stored);

		let raw: unknown = {};
		if (request.headers.get("content-type")?.includes("application/json")) {
			try {
				raw = await request.json();
			} catch {
				/* optional body */
			}
		}

		const holder = resolveLockHolder(request, parseOptionalLockBody(raw));
		if (record.lock && holder && !sameLockPrincipal(holder, record.lock, request)) {
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
		await this.releaseSpecLockRecord(slug, updated);
		await removeWorkspaceLease(this.ctx.storage, slug);
		await this.fanOutLockChanged("spec", "release", null, slug);
		return Response.json({ ok: true, spec: updated });
	}

	private async releaseSpecLockRecord(
		slug: string,
		spec: SpecRecord,
		opts?: { syncAlarm?: boolean },
	): Promise<void> {
		const sql = this.revisionSql();
		await this.ctx.storage.transaction(async (txn) => {
			await putSpecRecord(txn, spec);
			await deleteLeaseEntry(txn, { kind: "spec", slug }, sql);
		});
		if (opts?.syncAlarm !== false) {
			await syncLeaseAlarm(this.ctx.storage, sql);
		}
	}

	private async releasePlanLockRecord(
		id: string,
		plan: PlanRecord,
		target: LeaseTarget,
		opts?: { syncAlarm?: boolean },
	): Promise<void> {
		const sql = this.revisionSql();
		await this.ctx.storage.transaction(async (txn) => {
			await txn.put(planKey(id), plan);
			await deleteLeaseEntry(txn, target, sql);
		});
		if (opts?.syncAlarm !== false) {
			await syncLeaseAlarm(this.ctx.storage, sql);
		}
	}

	private async persistSpecQueueTake(
		slug: string,
		spec: SpecRecord,
		lock: SpecLock,
		holder: LockHolder,
		request: Request,
		sessionId?: string,
		workspace?: WorkspaceLease,
	): Promise<boolean> {
		const sql = this.revisionSql();
		let committed = false;
		await this.ctx.storage.transaction(async (txn) => {
			const stored = await txn.get<SpecRecord>(specKey(slug));
			if (
				!stored ||
				!specLockStillAvailable(normalizeSpecRecord(stored), holder, request, sessionId)
			) {
				return;
			}
			await putSpecRecord(txn, spec);
			await putLeaseEntry(txn, { kind: "spec", slug }, lock, sql);
			if (workspace) await upsertWorkspaceLease(txn, workspace);
			committed = true;
		});
		if (committed) await syncLeaseAlarm(this.ctx.storage, sql);
		return committed;
	}

	private async persistPlanLockAcquire(id: string, plan: PlanRecord, lock: SpecLock): Promise<void> {
		const sql = this.revisionSql();
		await this.ctx.storage.transaction(async (txn) => {
			await txn.put(planKey(id), plan);
			await putLeaseEntry(txn, { kind: "plan", id }, lock, sql);
		});
		await syncLeaseAlarm(this.ctx.storage, sql);
	}

	private async persistPlanPhaseQueueTake(
		planId: string,
		phaseId: string,
		plan: PlanRecord,
		lock: SpecLock,
		holder: LockHolder,
		request: Request,
		sessionId?: string,
		workspace?: WorkspaceLease,
	): Promise<boolean> {
		const sql = this.revisionSql();
		let committed = false;
		await this.ctx.storage.transaction(async (txn) => {
			const stored = await txn.get<PlanRecord>(planKey(planId));
			if (
				!stored ||
				!planPhaseLockStillAvailable(
					normalizePlanRecord(stored),
					phaseId,
					holder,
					request,
					sessionId,
				)
			) {
				return;
			}
			await txn.put(planKey(planId), plan);
			await putLeaseEntry(txn, { kind: "plan-phase", id: planId, phaseId }, lock, sql);
			if (workspace) await upsertWorkspaceLease(txn, workspace);
			committed = true;
		});
		if (committed) await syncLeaseAlarm(this.ctx.storage, sql);
		return committed;
	}

	private async workspaceLeaseForQueueTake(
		specSlug: string | undefined,
		kind: "spec" | "plan",
		lock: SpecLock,
		platformRoot: string | undefined,
		workspaceIsolation: boolean,
	): Promise<{ upsert?: WorkspaceLease; response?: WorkspaceLease }> {
		if (!workspaceIsolation || !platformRoot || !specSlug) return {};
		const rootParsed = validatePlatformRoot(platformRoot);
		if (!rootParsed.ok) return {};
		const existing = await getWorkspaceLease(this.ctx.storage, specSlug);
		if (existing && existing.agent_id !== lock.agent_id) {
			return { response: existing };
		}
		const lease = computeWorkspaceManifest(specSlug, kind, rootParsed.value, lock);
		return { upsert: lease, response: lease };
	}

	private async freshSpecForQueue(slug: string): Promise<SpecRecord | null> {
		const stored = await this.ctx.storage.get<SpecRecord>(specKey(slug));
		if (!stored) return null;
		return this.loadSpecRecord(slug, stored);
	}

	private async loadPlanRecord(id: string, stored: PlanRecord): Promise<PlanRecord> {
		let record = normalizePlanRecord(stored);

		if (stored.status === "in_progress" && !stored.lock) {
			const orphanPlanLease = await this.ctx.storage.get<LeaseEntry>(
				leaseStorageKey({ kind: "plan", id }),
			);
			if (orphanPlanLease) {
				record = {
					...record,
					status: "ready",
					updated_at: new Date().toISOString(),
				};
				await this.releasePlanLockRecord(id, record, { kind: "plan", id });
				return record;
			}
		}

		for (const phase of record.phases) {
			if (phase.lock) continue;
			const orphanPhaseLease = await this.ctx.storage.get<LeaseEntry>(
				leaseStorageKey({ kind: "plan-phase", id, phaseId: phase.id }),
			);
			if (!orphanPhaseLease) continue;

			const now = new Date().toISOString();
			const repaired: PlanRecord = {
				...record,
				phases: record.phases.map((p) =>
					p.id === phase.id && p.status === "active"
						? { ...p, status: "pending" as PlanPhase["status"] }
						: p,
				),
				updated_at: now,
			};
			await this.releasePlanLockRecord(id, repaired, {
				kind: "plan-phase",
				id,
				phaseId: phase.id,
			});
			return repaired;
		}

		return record;
	}

	private async freshPlanForQueue(id: string): Promise<PlanRecord | null> {
		const stored = await this.ctx.storage.get<PlanRecord>(planKey(id));
		if (!stored) return null;
		return this.loadPlanRecord(id, stored);
	}

	private async loadAllSpecs(includeDone: boolean): Promise<SpecRecord[]> {
		const slugs = (await this.ctx.storage.get<string[]>(SPEC_INDEX_KEY)) ?? [];
		const specs: SpecRecord[] = [];
		for (const slug of slugs) {
			const stored = await this.ctx.storage.get<SpecRecord>(specKey(slug));
			if (!stored) continue;
			const record = await this.loadSpecRecord(slug, stored);
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
			const record = await this.loadPlanRecord(id, stored);
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

	private async getPlan(id: string, url?: URL): Promise<Response> {
		const stored = await this.ctx.storage.get<PlanRecord>(planKey(id));
		if (!stored) {
			return Response.json({ ok: false, error: "plan not found" }, { status: 404 });
		}
		const plan = await this.loadPlanRecord(id, stored);
		const summary = toPlanSummary(plan);
		const revisions_summary = this.revisionsSummaryFor(
			"plan",
			id,
			parseRevisionPreview(url?.searchParams.get("revision_preview") ?? null),
		);
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
					revisions_summary,
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
		const limit = parseRevisionListLimit(url.searchParams.get("limit"));
		const offset = parseRevisionOffset(url.searchParams.get("offset"));
		const result = listRevisionRecords(this.revisionSql(), "plan", id, limit, offset);
		return Response.json({
			ok: true,
			revisions: result.revisions.map(toRevisionSummaryEntry),
			count: result.total,
			limit,
			offset,
		});
	}

	private async getPlanRevision(id: string, revisionId: string): Promise<Response> {
		const stored = await this.ctx.storage.get<PlanRecord>(planKey(id));
		if (!stored) {
			return Response.json({ ok: false, error: "plan not found" }, { status: 404 });
		}
		const revision = getRevisionRecord(this.revisionSql(), revisionId);
		if (!revision || revision.target_kind !== "plan" || revision.target_id !== id) {
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
		const auditErr = await this.auditRevisionOnSave(
			request,
			raw,
			"plan",
			existing,
			record,
			"save",
		);
		if (auditErr) return auditErr;
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
					await this.fanOutSpecUpdated(linked, "patchSpec");
				}
			}
		}

		await this.fanOutPlanUpdated(record);
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
		const withRevisions = await applyBodyRevisionOnSave(
			this.ctx.storage,
			"plan",
			id,
			record,
			updated,
		);
		const auditErr = await this.auditRevisionOnSave(
			request,
			raw,
			"plan",
			record,
			withRevisions,
			"patch",
		);
		if (auditErr) return auditErr;
		if (nextStatus === "done" && record.lock) {
			const sql = this.revisionSql();
			await this.ctx.storage.transaction(async (txn) => {
				await txn.put(planKey(id), withRevisions);
				await deleteLeaseEntry(txn, { kind: "plan", id }, sql);
				if (record.spec_slug) {
					await removeWorkspaceLease(txn, record.spec_slug);
				}
			});
			await syncLeaseAlarm(this.ctx.storage, sql);
		} else {
			await this.ctx.storage.put(planKey(id), withRevisions);
		}
		await this.fanOutPlanUpdated(withRevisions);
		return Response.json(
			{ ok: true, plan: withRevisions, next_actions },
			{ headers: etagResponseHeaders(withRevisions.etag) },
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

		const sessionId = parseOptionalSessionId(raw);
		if (record.lock && !sameLockPrincipal(holder, record.lock, request)) {
			return Response.json(
				{ ok: false, error: "lock held", lock: record.lock },
				{ status: 409 },
			);
		}
		if (record.lock && sessionLockConflict(record.lock, sessionId)) {
			return Response.json(
				{ ok: false, error: "lock held by another session", lock: record.lock },
				{ status: 409 },
			);
		}

		const leaseParsed = this.resolveLeaseSeconds(raw, holder);
		if (!leaseParsed.ok) {
			return Response.json({ ok: false, error: leaseParsed.error }, { status: 400 });
		}

		const now = new Date().toISOString();
		const activity = resolveLockActivity(raw, record.lock);
		const lockSessionId = resolveLockSessionId(record.lock, sessionId);
		const lock = lockWithLease(holder, now, leaseParsed.value, activity, lockSessionId);
		const updated: PlanRecord = {
			...record,
			lock,
			status: record.status === "ready" ? "in_progress" : record.status,
			updated_at: now,
		};
		await this.persistPlanLockAcquire(id, updated, lock);
		await this.fanOutLockChanged("plan", "acquire", lock, record.spec_slug ?? "", id);
		return Response.json({ ok: true, plan: updated });
	}

	private async releasePlanLock(id: string, request: Request): Promise<Response> {
		const stored = await this.ctx.storage.get<PlanRecord>(planKey(id));
		if (!stored) {
			return Response.json({ ok: false, error: "plan not found" }, { status: 404 });
		}
		const record = normalizePlanRecord(stored);

		let raw: unknown = {};
		if (request.headers.get("content-type")?.includes("application/json")) {
			try {
				raw = await request.json();
			} catch {
				/* optional body */
			}
		}

		const holder = resolveLockHolder(request, parseOptionalLockBody(raw));
		if (record.lock && holder && !sameLockPrincipal(holder, record.lock, request)) {
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
		await this.releasePlanLockRecord(id, updated, { kind: "plan", id });
		if (record.spec_slug) {
			await removeWorkspaceLease(this.ctx.storage, record.spec_slug);
		}
		await this.fanOutLockChanged("plan", "release", null, record.spec_slug ?? "", id);
		return Response.json({ ok: true, plan: updated });
	}

	/** DO RPC — agent check-in: take or resume + assignment (what/where next). */
	async agentCheckIn(request: Request): Promise<Response> {
		let raw: unknown;
		try {
			raw = await request.json();
		} catch {
			return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
		}

		const parsed = parseAgentCheckInInput(raw);
		if (!parsed.ok) {
			return Response.json({ ok: false, error: parsed.error }, { status: 400 });
		}

		const holder = resolveLockHolder(request, parsed.value.agent_id);
		if (!holder) {
			return Response.json({ ok: false, error: "identity or agent_id required" }, { status: 401 });
		}

		if (parsed.value.resume_slug) {
			const stored = await this.ctx.storage.get<SpecRecord>(specKey(parsed.value.resume_slug));
			if (stored) {
				const spec = await hydrateSpecRecord(this.ctx.storage, parsed.value.resume_slug, stored);
				if (spec.lock && sameLockPrincipal(holder, spec.lock, request)) {
					let plan: PlanRecord | null = null;
					if (spec.plan_id) {
						const planStored = await this.ctx.storage.get<PlanRecord>(planKey(spec.plan_id));
						if (planStored) plan = normalizePlanRecord(planStored);
					}
					const assignment = buildAgentAssignmentFromResume(
						SCRIBE_PROJECT,
						holder.holder_id,
						spec,
						plan,
					);
					return Response.json({
						ok: true,
						empty: false,
						resumed: true,
						assignment,
						spec: toSpecSummary(spec),
						plan: plan ? toPlanSummary(plan) : null,
					});
				}
			}
		}

		const { resume_slug: _resume, ...takeBody } = parsed.value;
		const takeRequest = new Request(request.url, {
			method: "POST",
			headers: request.headers,
			body: JSON.stringify(takeBody),
		});
		const takeResponse = await this.takeQueueItem(takeRequest);
		const take = (await takeResponse.json()) as Record<string, unknown>;

		if (!takeResponse.ok) {
			return Response.json(take, { status: takeResponse.status });
		}

		if (take.empty === true) {
			return Response.json({
				ok: true,
				empty: true,
				eligible_count: take.eligible_count ?? 0,
				next_actions: nextActionsForMode("idle", { spec_slug: "" }),
			});
		}

		const assignment = buildAgentAssignmentFromTake(SCRIBE_PROJECT, holder.holder_id, take);
		return Response.json({
			ok: true,
			empty: false,
			assignment,
			take_kind: take.kind,
			spec: take.spec ?? null,
			plan: take.plan ?? null,
			workspace: take.workspace ?? null,
		});
	}

	/** DO RPC — take next queue item with lock; HTTP fetch delegates here. */
	async takeQueueItem(request: Request): Promise<Response> {
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
		const { exclude, kind, platform_root, workspace_isolation, session_id: takeSessionId } =
			parsed.value;
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
				const freshPlan = await this.freshPlanForQueue(candidate.record.id);
				if (!freshPlan) continue;
				const freshPhase = freshPlan.phases.find((p) => p.id === candidate.phase.id);
				if (!freshPhase) continue;
				const lockRes = tryAcquirePlanPhaseLock(
					holder,
					freshPlan,
					freshPhase.id,
					leaseSeconds,
					undefined,
					request,
					takeSessionId,
				);
				if (lockRes.ok) {
					const phase = lockRes.plan.phases.find((p) => p.id === freshPhase.id)!;
					const workspaceCtx = await this.workspaceLeaseForQueueTake(
						lockRes.plan.spec_slug,
						"plan",
						phase.lock!,
						platform_root,
						workspace_isolation,
					);
					const committed = await this.persistPlanPhaseQueueTake(
						freshPlan.id,
						freshPhase.id,
						lockRes.plan,
						phase.lock!,
						holder,
						request,
						takeSessionId,
						workspaceCtx.upsert,
					);
					if (!committed) continue;
					const workspace = workspaceCtx.response;
					await this.fanOutLockChanged(
						"plan-phase",
						"acquire",
						phase.lock!,
						lockRes.plan.spec_slug ?? "",
						lockRes.plan.id,
						phase.id,
					);
					return this.respondQueueTake(holder, {
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
				const freshSpec = await this.freshSpecForQueue(candidate.record.slug);
				if (!freshSpec) continue;
				const lockRes = tryAcquireSpecLock(
					holder,
					freshSpec,
					leaseSeconds,
					undefined,
					request,
					takeSessionId,
				);
				if (lockRes.ok) {
					const workspaceCtx = await this.workspaceLeaseForQueueTake(
						freshSpec.slug,
						"spec",
						lockRes.spec.lock!,
						platform_root,
						workspace_isolation,
					);
					const committed = await this.persistSpecQueueTake(
						freshSpec.slug,
						lockRes.spec,
						lockRes.spec.lock!,
						holder,
						request,
						takeSessionId,
						workspaceCtx.upsert,
					);
					if (!committed) continue;
					const pending = freshSpec.phases.find(
						(p) => p.status === "pending" || p.status === "active",
					);
					const workspace = workspaceCtx.response;
					await this.fanOutLockChanged(
						"spec",
						"acquire",
						lockRes.spec.lock!,
						freshSpec.slug,
					);
					return this.respondQueueTake(holder, {
						ok: true,
						kind: "phase_bridge",
						completion_ratio: candidate.completion_ratio,
						spec_slug: freshSpec.slug,
						phase_id: pending?.id ?? null,
						phase_name: pending?.title ?? freshSpec.active_phase,
						spec: toSpecSummary(lockRes.spec),
						...(workspace ? { workspace } : {}),
					});
				}
				if (lockRes.status !== 409) {
					return Response.json({ ok: false, error: lockRes.error }, { status: lockRes.status });
				}
				continue;
			}

			const freshSpec = await this.freshSpecForQueue(candidate.record.slug);
			if (!freshSpec) continue;
			const lockRes = tryAcquireSpecLock(
				holder,
				freshSpec,
				leaseSeconds,
				undefined,
				request,
				takeSessionId,
			);
			if (lockRes.ok) {
				const workspaceCtx = await this.workspaceLeaseForQueueTake(
					freshSpec.slug,
					"spec",
					lockRes.spec.lock!,
					platform_root,
					workspace_isolation,
				);
				const committed = await this.persistSpecQueueTake(
					freshSpec.slug,
					lockRes.spec,
					lockRes.spec.lock!,
					holder,
					request,
					takeSessionId,
					workspaceCtx.upsert,
				);
				if (!committed) continue;
				const workspace = workspaceCtx.response;
				await this.fanOutLockChanged(
					"spec",
					"acquire",
					lockRes.spec.lock!,
					freshSpec.slug,
				);
				return this.respondQueueTake(holder, {
					ok: true,
					kind: "spec",
					completion_ratio: candidate.completion_ratio,
					spec_slug: freshSpec.slug,
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

		const sessionId = parseOptionalSessionId(raw);
		const activity = resolveLockActivity(
			raw,
			record.phases.find((p) => p.id === phaseId)?.lock ?? null,
		);
		const lockRes = tryAcquirePlanPhaseLock(
			holder,
			record,
			phaseId,
			leaseParsed.value,
			activity,
			request,
			sessionId,
		);
		if (!lockRes.ok) {
			return Response.json({ ok: false, error: lockRes.error }, { status: lockRes.status });
		}
		const phase = lockRes.plan.phases.find((p) => p.id === phaseId)!;
		const committed = await this.persistPlanPhaseQueueTake(
			id,
			phaseId,
			lockRes.plan,
			phase.lock!,
			holder,
			request,
			sessionId,
		);
		if (!committed) {
			return Response.json({ ok: false, error: "lock held" }, { status: 409 });
		}
		await this.fanOutLockChanged(
			"plan-phase",
			"acquire",
			phase.lock!,
			lockRes.plan.spec_slug ?? "",
			id,
			phaseId,
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

		let raw: unknown = {};
		try {
			raw = await request.json();
		} catch {
			/* optional body */
		}

		const holder = resolveLockHolder(request, parseOptionalLockBody(raw));
		if (phase.lock && holder && !sameLockPrincipal(holder, phase.lock, request)) {
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
		await this.releasePlanLockRecord(id, updated, { kind: "plan-phase", id, phaseId });
		if (record.spec_slug) {
			await removeWorkspaceLease(this.ctx.storage, record.spec_slug);
		}
		await this.fanOutLockChanged(
			"plan-phase",
			"release",
			null,
			record.spec_slug ?? "",
			id,
			phaseId,
		);
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
		const sql = this.revisionSql();
		const entries = await listLeaseEntries(this.ctx.storage, sql);
		const due = dueLeaseEntries(entries, Date.now());
		for (const entry of due) {
			await this.expireLease(entry);
		}
		await syncLeaseAlarm(this.ctx.storage, sql);
	}

	private async expireLease(entry: LeaseEntry): Promise<void> {
		const now = new Date().toISOString();
		const target = entry.target;
		const sql = this.revisionSql();

		if (target.kind === "spec") {
			const stored = await this.ctx.storage.get<SpecRecord>(specKey(target.slug));
			if (stored?.lock) {
				const record = await hydrateSpecRecord(this.ctx.storage, target.slug, stored);
				const updated: SpecRecord = {
					...record,
					lock: null,
					status: record.status === "in_progress" ? "ready" : record.status,
					updated_at: now,
					etag: now,
				};
				await this.releaseSpecLockRecord(target.slug, updated, { syncAlarm: false });
				await this.fanOutLockChanged("spec", "lease_alarm", null, target.slug);
				if (updated.status !== record.status) {
					await this.fanOutSpecUpdated(updated, "lease_alarm");
				}
			} else {
				await deleteLeaseEntry(this.ctx.storage, target, sql);
			}
			console.log(
				JSON.stringify({ event: "lease_expired", kind: "spec", slug: target.slug, holder_id: entry.holder_id }),
			);
		} else if (target.kind === "plan") {
			const stored = await this.ctx.storage.get<PlanRecord>(planKey(target.id));
			if (stored?.lock) {
				const record = normalizePlanRecord(stored);
				const updated: PlanRecord = {
					...record,
					lock: null,
					status: record.status === "in_progress" ? "ready" : record.status,
					updated_at: now,
				};
				await this.releasePlanLockRecord(target.id, updated, { kind: "plan", id: target.id }, {
					syncAlarm: false,
				});
				await this.fanOutLockChanged("plan", "lease_alarm", null, record.spec_slug ?? "", target.id);
				if (updated.status !== record.status) {
					await this.fanOutPlanUpdated(updated);
				}
			} else {
				await deleteLeaseEntry(this.ctx.storage, target, sql);
			}
			console.log(
				JSON.stringify({ event: "lease_expired", kind: "plan", id: target.id, holder_id: entry.holder_id }),
			);
		} else {
			const stored = await this.ctx.storage.get<PlanRecord>(planKey(target.id));
			if (stored) {
				const record = normalizePlanRecord(stored);
				const updated: PlanRecord = {
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
				};
				await this.releasePlanLockRecord(
					target.id,
					updated,
					{
						kind: "plan-phase",
						id: target.id,
						phaseId: target.phaseId,
					},
					{ syncAlarm: false },
				);
				await this.fanOutLockChanged(
					"plan-phase",
					"lease_alarm",
					null,
					record.spec_slug ?? "",
					target.id,
					target.phaseId,
				);
				await this.fanOutPlanUpdated(updated);
			} else {
				await deleteLeaseEntry(this.ctx.storage, target, sql);
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
