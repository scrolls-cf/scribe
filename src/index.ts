import { Hono } from "hono";
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

app.all("/v1/projects/*", async (c) => {
	const url = new URL(c.req.url);
	const parts = url.pathname.split("/").filter(Boolean);
	const projectId = parts[2] ?? DEFAULT_PROJECT;
	const suffix = parts.slice(3).join("/");
	return forwardToProject(c, projectId, suffix);
});

app.get("/", (c) => {
	if (!c.req.header("accept")?.includes("application/json")) {
		return c.notFound();
	}
	return c.json({
		ok: true,
		service: "scribe",
		harness: "ged",
		endpoints: {
			health: "/health",
			events: "/v1/projects/:project/events",
		},
	});
});

export default app;
