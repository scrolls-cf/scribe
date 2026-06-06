export interface ServiceRoute {
	method: string;
	path: string;
	summary?: string;
}

export interface ServiceRegistration {
	id: string;
	binding: string;
	title: string;
	description: string;
	routes: ServiceRoute[];
	registered_at: string;
	updated_at: string;
}

export interface MatrixManifest {
	id: string;
	binding?: string;
	title: string;
	description: string;
	version?: string;
	routes: ServiceRoute[];
}

const ID_RE = /^[a-z][a-z0-9-]*$/;

export const SERVICE_INDEX_KEY = "service:index";

export function serviceRegistryKey(id: string): string {
	return `service:${id}`;
}

export function parseMatrixManifest(raw: unknown): { ok: true; value: MatrixManifest } | { ok: false; error: string } {
	if (!raw || typeof raw !== "object") {
		return { ok: false, error: "manifest must be a JSON object" };
	}
	const m = raw as MatrixManifest;
	const id = typeof m.id === "string" ? m.id.trim() : "";
	const title = typeof m.title === "string" ? m.title.trim() : "";
	const description = typeof m.description === "string" ? m.description.trim() : "";
	if (!id || !ID_RE.test(id)) return { ok: false, error: "id must be lowercase hyphenated" };
	if (!title) return { ok: false, error: "title is required" };
	if (!description) return { ok: false, error: "description is required" };
	const routes = Array.isArray(m.routes) ? m.routes.filter(isRoute) : [];
	return {
		ok: true,
		value: {
			id,
			binding: typeof m.binding === "string" ? m.binding.trim() : undefined,
			title,
			description,
			version: typeof m.version === "string" ? m.version.trim() : undefined,
			routes,
		},
	};
}

export function parseServiceRegistration(raw: unknown): { ok: true; value: ServiceRegistration } | { ok: false; error: string } {
	const manifest = parseMatrixManifest(raw);
	if (!manifest.ok) return manifest;
	const binding =
		manifest.value.binding ??
		(typeof (raw as ServiceRegistration).binding === "string"
			? (raw as ServiceRegistration).binding.trim()
			: "");
	if (!binding) return { ok: false, error: "binding is required" };
	const now = new Date().toISOString();
	return {
		ok: true,
		value: {
			id: manifest.value.id,
			binding,
			title: manifest.value.title,
			description: manifest.value.description,
			routes: manifest.value.routes,
			registered_at: now,
			updated_at: now,
		},
	};
}

function isRoute(value: unknown): value is ServiceRoute {
	if (!value || typeof value !== "object") return false;
	const r = value as ServiceRoute;
	return typeof r.method === "string" && typeof r.path === "string";
}
