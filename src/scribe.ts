import { DurableObject } from "cloudflare:workers";
import { authorizeWrite, type AuthEnv } from "./auth";
import {
	parseSaveSpecInput,
	SPEC_INDEX_KEY,
	specKey,
	type SpecRecord,
} from "./spec";

export class Scribe extends DurableObject<AuthEnv> {
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
		const denied = authorizeWrite(request, this.env);
		if (denied) return denied;

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
}
