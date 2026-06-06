export interface SpecRecord {
	slug: string;
	title: string;
	body: string;
	source: string | null;
	updated_at: string;
}

export interface SaveSpecInput {
	slug?: string;
	title?: string;
	body?: string;
	source?: string | null;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*-design$/;

export function specKey(slug: string): string {
	return `spec:${slug}`;
}

export const SPEC_INDEX_KEY = "spec:index";

export function parseSaveSpecInput(raw: unknown): { ok: true; value: SpecRecord } | { ok: false; error: string } {
	if (!raw || typeof raw !== "object") {
		return { ok: false, error: "body must be a JSON object" };
	}

	const input = raw as SaveSpecInput;
	const slug = typeof input.slug === "string" ? input.slug.trim() : "";
	const title = typeof input.title === "string" ? input.title.trim() : "";
	const body = typeof input.body === "string" ? input.body : "";

	if (!slug) return { ok: false, error: "slug is required" };
	if (!SLUG_RE.test(slug)) {
		return { ok: false, error: "slug must match <topic>-design (lowercase, hyphens)" };
	}
	if (!title) return { ok: false, error: "title is required" };
	if (!body.trim()) return { ok: false, error: "body is required" };

	const source =
		input.source === undefined || input.source === null
			? null
			: typeof input.source === "string"
				? input.source.trim() || null
				: null;

	return {
		ok: true,
		value: {
			slug,
			title,
			body,
			source,
			updated_at: new Date().toISOString(),
		},
	};
}
