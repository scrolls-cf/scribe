import type { MatrixManifest } from "./service-registry";

export const SCRIBE_MATRIX_MANIFEST: MatrixManifest = {
	id: "scribe",
	binding: "SCRIBE",
	title: "scribe",
	description: "Edge store for design specs, phased plans, and org errors.",
	version: "0.2.0",
	routes: [
		{ method: "GET", path: "/health", summary: "Worker health" },
		{ method: "GET", path: "/", summary: "Planning dashboard" },
		{ method: "GET", path: "/v1/projects/:project/specs", summary: "List active specs" },
		{ method: "GET", path: "/v1/projects/:project/specs/:slug", summary: "Read one spec" },
		{ method: "POST", path: "/v1/projects/:project/specs", summary: "Save design spec" },
		{ method: "PATCH", path: "/v1/projects/:project/specs/:slug", summary: "Update status or phases" },
		{ method: "POST", path: "/v1/projects/:project/specs/:slug/lock", summary: "Acquire agent lock" },
		{ method: "DELETE", path: "/v1/projects/:project/specs/:slug/lock", summary: "Release agent lock" },
		{ method: "GET", path: "/v1/projects/:project/errors", summary: "Unresolved errors board" },
		{ method: "POST", path: "/v1/projects/:project/errors", summary: "Report error" },
		{ method: "PATCH", path: "/v1/projects/:project/errors/:id", summary: "Resolve error" },
		{ method: "GET", path: "/v1/projects/:project/services", summary: "Service registry (matrix project)" },
		{ method: "POST", path: "/v1/projects/:project/services", summary: "Upsert service registry entry" },
	],
};
