import { Hono } from "hono";
import { Scribe } from "./scribe";
import { SCRIBE_MATRIX_MANIFEST } from "./matrix-manifest";

export { Scribe };

export interface Env {
	SCRIBE: DurableObjectNamespace<Scribe>;
	ASSETS?: Fetcher;
}

const DEFAULT_PROJECT = "default";
const MATRIX_PROJECT = "matrix";

const app = new Hono<{ Bindings: Env }>();

function projectStub(env: Env, projectId: string) {
	return env.SCRIBE.get(env.SCRIBE.idFromName(projectId));
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

app.get("/.well-known/matrix", (c) => c.json(SCRIBE_MATRIX_MANIFEST));

app.get("/health", (c) => c.json({ ok: true, service: "scribe" }));

app.all("/v1/projects/*", async (c) => {
	const url = new URL(c.req.url);
	const parts = url.pathname.split("/").filter(Boolean);
	const projectId = parts[2] ?? DEFAULT_PROJECT;
	const suffix = parts.slice(3).join("/");
	return forwardToProject(c, projectId, suffix);
});

app.get("/specs/:slug", async (c) => {
	if (!c.req.header("accept")?.includes("application/json")) {
		return c.notFound();
	}
	return forwardToProject(c, DEFAULT_PROJECT, `specs/${c.req.param("slug")}`);
});

app.get("/", async (c) => {
	if (!c.req.header("accept")?.includes("application/json")) {
		return c.notFound();
	}
	return c.json({
		ok: true,
		service: "scribe",
		matrix_project: MATRIX_PROJECT,
		endpoints: {
			health: "/health",
			matrix: "/.well-known/matrix",
			projects: "/v1/projects/:project",
			ui: "/",
		},
	});
});

function assetRequest(request: Request): Request {
	const url = new URL(request.url);
	const specPage = url.pathname.match(/^\/specs\/([^/]+)\/?$/);
	if (specPage && !request.headers.get("accept")?.includes("application/json")) {
		url.pathname = "/spec/";
		return new Request(url.toString(), request);
	}
	const planPage = url.pathname.match(/^\/plans\/([^/]+)\/?$/);
	if (planPage && !request.headers.get("accept")?.includes("application/json")) {
		url.pathname = "/plan/";
		return new Request(url.toString(), request);
	}
	return request;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const res = await app.fetch(request, env, ctx);
		if (res.status !== 404) return res;
		if (env.ASSETS && (request.method === "GET" || request.method === "HEAD")) {
			return env.ASSETS.fetch(assetRequest(request));
		}
		return new Response(JSON.stringify({ ok: false, error: "not_found" }), {
			status: 404,
			headers: { "content-type": "application/json" },
		});
	},
};
