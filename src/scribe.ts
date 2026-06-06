import { DurableObject } from "cloudflare:workers";
import {
	parseServiceRegistration,
	SERVICE_INDEX_KEY,
	serviceRegistryKey,
	type ServiceRegistration,
} from "./service-registry";
import {
	parseSaveSpecInput,
	SPEC_INDEX_KEY,
	specKey,
	type SpecRecord,
} from "./spec";

export class Scribe extends DurableObject {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/health") {
			return Response.json({ ok: true, class: "Scribe" });
		}

		if (url.pathname === "/specs") {
			if (request.method === "GET") return this.listSpecs();
			if (request.method === "POST") return this.saveSpec(request);
		}

		const specMatch = url.pathname.match(/^\/specs\/([^/]+)$/);
		if (specMatch && request.method === "GET") {
			return this.getSpec(decodeURIComponent(specMatch[1]));
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

	private async listSpecs(): Promise<Response> {
		const slugs = (await this.ctx.storage.get<string[]>(SPEC_INDEX_KEY)) ?? [];
		const specs: SpecRecord[] = [];
		for (const slug of slugs) {
			const record = await this.ctx.storage.get<SpecRecord>(specKey(slug));
			if (record) specs.push(record);
		}
		specs.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
		return Response.json({
			ok: true,
			specs: specs.map((s) => ({
				slug: s.slug,
				title: s.title,
				source: s.source,
				updated_at: s.updated_at,
			})),
		});
	}

	private async getSpec(slug: string): Promise<Response> {
		const record = await this.ctx.storage.get<SpecRecord>(specKey(slug));
		if (!record) {
			return Response.json({ ok: false, error: "spec not found" }, { status: 404 });
		}
		return Response.json({ ok: true, spec: record });
	}

	private async saveSpec(request: Request): Promise<Response> {
		let raw: unknown;
		try {
			raw = await request.json();
		} catch {
			return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
		}

		const parsed = parseSaveSpecInput(raw);
		if (!parsed.ok) {
			return Response.json({ ok: false, error: parsed.error }, { status: 400 });
		}

		const record = parsed.value;
		const slugs = new Set((await this.ctx.storage.get<string[]>(SPEC_INDEX_KEY)) ?? []);
		slugs.add(record.slug);
		await this.ctx.storage.put(specKey(record.slug), record);
		await this.ctx.storage.put(SPEC_INDEX_KEY, [...slugs].sort());

		return Response.json({ ok: true, spec: record }, { status: 201 });
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
