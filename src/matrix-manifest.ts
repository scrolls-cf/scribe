import type { MatrixManifest } from "./service-registry";

export const SCRIBE_MATRIX_MANIFEST: MatrixManifest = {
	id: "scribe",
	binding: "SCRIBE",
	title: "Scribe",
	description: "Edge store for brainstorm design specs and the fleet service registry.",
	version: "0.1.0",
	routes: [
		{ method: "GET", path: "/health", summary: "Worker health" },
		{ method: "GET", path: "/v1/projects/:project/specs", summary: "List specs" },
		{ method: "GET", path: "/v1/projects/:project/specs/:slug", summary: "Read one spec" },
		{ method: "POST", path: "/v1/projects/:project/specs", summary: "Save brainstorm spec" },
		{ method: "GET", path: "/v1/projects/:project/services", summary: "Fleet registry (matrix project)" },
		{ method: "POST", path: "/v1/projects/:project/services", summary: "Upsert fleet registry entry" },
	],
};
