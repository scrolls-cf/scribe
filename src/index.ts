import { Hono } from "hono";
import { SCRIBE_MATRIX_MANIFEST } from "./matrix-manifest.ts";
import { Scribe } from "./scribe.ts";

export { Scribe };

export interface Env {
	SCRIBE: DurableObjectNamespace<Scribe>;
	ASSETS?: Fetcher;
	/** wrangler secret — same CLOUDFLARE_API_TOKEN ged uses for wrangler */
	CLOUDFLARE_API_TOKEN: string;
}

const DEFAULT_PROJECT = "ged";

const app = new Hono<{ Bindings: Env }>();

function harnessInfo(projectId = DEFAULT_PROJECT) {
	return {
		ok: true,
		service: "scribe",
		harness: "ged",
		transport: "websocket",
		events: `/v1/projects/${projectId}/events`,
		health: "/health",
		note: "Connect WebSocket to events; connected frame includes harness context.",
	};
}

function harnessNotFound(projectId = DEFAULT_PROJECT) {
	const info = harnessInfo(projectId);
	return {
		...info,
		ok: false,
		error: "not_found",
		message: "scribe harness is WebSocket-only; HTTP spec/plan routes were removed",
	};
}

function projectStub(env: Env, projectId: string) {
	return env.SCRIBE.getByName(projectId);
}

async function forwardToProject(
	c: { env: Env; req: { url: string; raw: Request } },
	projectId: string,
	suffix: string,
) {
	const stub = projectStub(c.env, projectId);
	const target = new URL(c.req.url);
	target.pathname = suffix ? `/${suffix}` : "/health";
	return stub.fetch(new Request(target.toString(), c.req.raw));
}

app.get("/health", (c) => c.json({ ok: true, service: "scribe" }));

app.get("/.well-known/matrix", (c) => c.json(SCRIBE_MATRIX_MANIFEST));

app.get("/", async (c) => {
	if (c.req.header("accept")?.includes("application/json")) {
		return c.json(harnessInfo());
	}
	if (c.env.ASSETS) {
		const assetUrl = new URL("/index.html", c.req.url);
		return c.env.ASSETS.fetch(new Request(assetUrl.toString(), c.req.raw));
	}
	return c.json(harnessInfo());
});

app.all("/v1/projects/*", async (c) => {
	const url = new URL(c.req.url);
	const parts = url.pathname.split("/").filter(Boolean);
	const projectId = parts[2] ?? DEFAULT_PROJECT;
	const suffix = parts.slice(3).join("/");

	if (suffix && suffix !== "events" && suffix !== "health") {
		return c.json(harnessNotFound(projectId), 404);
	}

	return forwardToProject(c, projectId, suffix);
});

app.notFound((c) => c.json(harnessNotFound(), 404));

async function fetchWithAssets(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const res = await app.fetch(request, env, ctx);
	if (res.status !== 404) return res;
	if (env.ASSETS && (request.method === "GET" || request.method === "HEAD")) {
		return env.ASSETS.fetch(request);
	}
	return res;
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		return fetchWithAssets(request, env, ctx);
	},
};
