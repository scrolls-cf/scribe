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
	parsePatchSpecInput,
	normalizeSpecRecord,
	parseSaveSpecInput,
	SPEC_INDEX_KEY,
	specKey,
	toSpecSummary,
	type SpecRecord,
} from "./spec";

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
