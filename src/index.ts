import { Scribe } from "./scribe";
import { SCRIBE_MATRIX_MANIFEST } from "./matrix-manifest";

export { Scribe };

export interface Env {
	SCRIBE: DurableObjectNamespace<Scribe>;
}

const DEFAULT_PROJECT = "default";
const MATRIX_PROJECT = "matrix";

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/.well-known/matrix") {
			return Response.json(SCRIBE_MATRIX_MANIFEST);
		}

		if (url.pathname === "/health") {
			return Response.json({ ok: true, service: "scribe" });
		}

		if (url.pathname.startsWith("/v1/projects/")) {
			const parts = url.pathname.split("/").filter(Boolean);
			const projectId = parts[2] ?? DEFAULT_PROJECT;
			const stub = env.SCRIBE.get(env.SCRIBE.idFromName(projectId));
			const suffix = parts.slice(3).join("/");
			const target = new URL(request.url);
			target.pathname = suffix ? `/${suffix}` : "/health";
			return stub.fetch(new Request(target.toString(), request));
		}

		return Response.json({
			ok: true,
			service: "scribe",
			matrix_project: MATRIX_PROJECT,
			well_known: "/.well-known/matrix",
		});
	},
} satisfies ExportedHandler<Env>;
