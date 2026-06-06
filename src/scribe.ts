import { DurableObject } from "cloudflare:workers";

export class Scribe extends DurableObject {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/health") {
			return Response.json({ ok: true, class: "Scribe" });
		}

		if (request.method === "GET" && url.pathname === "/v1/state") {
			const value = (await this.ctx.storage.get<string>("value")) ?? null;
			return Response.json({ value });
		}

		if (request.method === "PUT" && url.pathname === "/v1/state") {
			const body = (await request.json()) as { value?: string };
			await this.ctx.storage.put("value", body.value ?? "");
			return Response.json({ ok: true });
		}

		return new Response("Not found", { status: 404 });
	}
}
