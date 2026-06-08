import type { RevisionStorage } from "./revision.ts";
import { normalizeSpecRecord, specKey, type SpecRecord } from "./spec.ts";

export function specBodyKey(slug: string): string {
	return `spec:${slug}:body`;
}

/** True when orient/summary may need footer parse because DO fields are incomplete. */
export function needsFooterBodyParse(record: SpecRecord): boolean {
	const normalized = normalizeSpecRecord(record);
	if (!normalized.terminal_skill) return true;
	if (!normalized.design_lane) return true;
	if (!normalized.plan_id) return true;
	if (!normalized.review_gate) return true;
	if (!normalized.plan_review) return true;
	if (!normalized.worker_scope?.length) return true;
	return false;
}

export async function resolveSpecBody(
	storage: RevisionStorage,
	slug: string,
	stored: SpecRecord,
): Promise<string> {
	if (stored.body) return stored.body;
	const split = await storage.get<string>(specBodyKey(slug));
	return typeof split === "string" ? split : "";
}

export async function hydrateSpecRecord(
	storage: RevisionStorage,
	slug: string,
	stored: SpecRecord,
): Promise<SpecRecord> {
	const body = await resolveSpecBody(storage, slug, stored);
	return normalizeSpecRecord({ ...stored, body });
}

export async function putSpecRecord(storage: RevisionStorage, record: SpecRecord): Promise<void> {
	const normalized = normalizeSpecRecord(record);
	const { body, ...meta } = normalized;
	await storage.put(specKey(normalized.slug), { ...meta, body: "" });
	await storage.put(specBodyKey(normalized.slug), body);
}

export async function deleteSpecStorage(storage: RevisionStorage, slug: string): Promise<void> {
	await storage.delete(specKey(slug));
	await storage.delete(specBodyKey(slug));
}
