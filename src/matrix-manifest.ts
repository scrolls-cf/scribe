export interface MatrixManifest {
	id: string;
	binding: string;
	title: string;
	description: string;
	version: string;
	routes: Array<{ method: string; path: string; summary: string }>;
}

export const SCRIBE_MATRIX_MANIFEST: MatrixManifest = {
	id: "scribe",
	binding: "SCRIBE",
	title: "scribe",
	description: "Ged harness — workflow state on DO, agents connect via WebSocket.",
	version: "0.3.0",
	routes: [
		{ method: "GET", path: "/health", summary: "Worker health" },
		{ method: "GET", path: "/", summary: "Harness landing" },
		{ method: "GET", path: "/.well-known/matrix", summary: "Service manifest" },
		{
			method: "GET",
			path: "/v1/projects/:project/events",
			summary: "WebSocket harness (workflow commands + state-aware connected frame)",
		},
		{ method: "GET", path: "/v1/projects/:project/health", summary: "Project DO health" },
	],
};
