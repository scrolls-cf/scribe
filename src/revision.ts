import type { SpecLock } from "./spec.ts";

export type RevisionTrigger = "register" | "refactor" | "manual" | "ship";
export type RevisionKind = "spec" | "plan";

export const MAX_REVISIONS = 20;

export interface BodyRevision {
	base_etag: string;
	head_etag: string;
	body: string;
	body_sha256: string;
	created_at: string;
	trigger: RevisionTrigger;
	lock_activity?: string;
	agent_id?: string;
	lines_added?: number;
	lines_removed?: number;
}

export interface BodyRevisionMeta {
	base_etag: string;
	head_etag: string;
	created_at: string;
	trigger: RevisionTrigger;
	lock_activity?: string;
	agent_id?: string;
	lines_added?: number;
	lines_removed?: number;
}

export interface RevisionSummaryFields {
	revisions_count: number;
	last_revision: BodyRevisionMeta | null;
}

export interface RevisionWriteContext {
	body: string;
	etag: string;
	status?: string;
	lock?: SpecLock | null;
}

export interface RevisionStorage {
	get<T>(key: string): Promise<T | undefined>;
	put(key: string, value: unknown): Promise<void>;
	delete(key: string): Promise<unknown>;
}

export function revisionStorageKey(
	kind: RevisionKind,
	id: string,
	baseEtag: string,
): string {
	return `revision:${kind}:${id}:${baseEtag}`;
}

export function revisionIndexKey(kind: RevisionKind, id: string): string {
	return `revision:index:${kind}:${id}`;
}

export async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export function lcsLength(a: string[], b: string[]): number {
	const m = a.length;
	const n = b.length;
	const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (a[i - 1] === b[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}
	}
	return dp[m][n];
}

export function countLineDelta(
	before: string,
	after: string,
): { lines_added: number; lines_removed: number } {
	const a = before.split("\n");
	const b = after.split("\n");
	const common = lcsLength(a, b);
	return { lines_removed: a.length - common, lines_added: b.length - common };
}

export function inferRevisionTrigger(
	existing: RevisionWriteContext | null,
	incoming: Pick<RevisionWriteContext, "status">,
): RevisionTrigger {
	if (!existing) return "register";
	if (incoming.status === "done" && existing.status !== "done") return "ship";
	if (existing.lock?.activity === "refactor") return "refactor";
	return "manual";
}

export function toRevisionMeta(revision: BodyRevision): BodyRevisionMeta {
	return {
		base_etag: revision.base_etag,
		head_etag: revision.head_etag,
		created_at: revision.created_at,
		trigger: revision.trigger,
		lock_activity: revision.lock_activity,
		agent_id: revision.agent_id,
		lines_added: revision.lines_added,
		lines_removed: revision.lines_removed,
	};
}

export async function loadRevisionIndex(
	storage: RevisionStorage,
	kind: RevisionKind,
	id: string,
): Promise<string[]> {
	return (await storage.get<string[]>(revisionIndexKey(kind, id))) ?? [];
}

export async function trimRevisionIndex(
	storage: RevisionStorage,
	kind: RevisionKind,
	id: string,
	index: string[],
): Promise<string[]> {
	const kept = index.slice(0, MAX_REVISIONS);
	const dropped = index.slice(MAX_REVISIONS);
	for (const baseEtag of dropped) {
		await storage.delete(revisionStorageKey(kind, id, baseEtag));
	}
	await storage.put(revisionIndexKey(kind, id), kept);
	return kept;
}

async function latestRevision(
	storage: RevisionStorage,
	kind: RevisionKind,
	id: string,
): Promise<BodyRevision | null> {
	const index = await loadRevisionIndex(storage, kind, id);
	const baseEtag = index[0];
	if (!baseEtag) return null;
	return (await storage.get<BodyRevision>(revisionStorageKey(kind, id, baseEtag))) ?? null;
}

export async function appendBodyRevision(
	storage: RevisionStorage,
	kind: RevisionKind,
	id: string,
	existing: RevisionWriteContext,
	incoming: RevisionWriteContext,
	opts?: { trigger?: RevisionTrigger; created_at?: string },
): Promise<{ appended: boolean } & RevisionSummaryFields> {
	const index = await loadRevisionIndex(storage, kind, id);

	if (existing.body === incoming.body) {
		return revisionSummaryFromIndex(storage, kind, id, index);
	}
	if (!existing.body.trim()) {
		return revisionSummaryFromIndex(storage, kind, id, index);
	}

	const body_sha256 = await sha256Hex(existing.body);
	const latest = await latestRevision(storage, kind, id);
	if (latest?.body_sha256 === body_sha256) {
		return revisionSummaryFromIndex(storage, kind, id, index);
	}

	const created_at = opts?.created_at ?? new Date().toISOString();
	const { lines_added, lines_removed } = countLineDelta(existing.body, incoming.body);
	const revision: BodyRevision = {
		base_etag: existing.etag,
		head_etag: incoming.etag,
		body: existing.body,
		body_sha256,
		created_at,
		trigger: opts?.trigger ?? inferRevisionTrigger(existing, incoming),
		lock_activity: existing.lock?.activity,
		agent_id: existing.lock?.agent_id,
		lines_added,
		lines_removed,
	};

	await storage.put(revisionStorageKey(kind, id, revision.base_etag), revision);
	const nextIndex = await trimRevisionIndex(storage, kind, id, [
		revision.base_etag,
		...index.filter((etag) => etag !== revision.base_etag),
	]);

	return {
		appended: true,
		revisions_count: nextIndex.length,
		last_revision: toRevisionMeta(revision),
	};
}

async function revisionSummaryFromIndex(
	storage: RevisionStorage,
	kind: RevisionKind,
	id: string,
	index: string[],
): Promise<{ appended: boolean } & RevisionSummaryFields> {
	if (index.length === 0) {
		return { appended: false, revisions_count: 0, last_revision: null };
	}
	const latest =
		(await storage.get<BodyRevision>(revisionStorageKey(kind, id, index[0]!))) ?? null;
	return {
		appended: false,
		revisions_count: index.length,
		last_revision: latest ? toRevisionMeta(latest) : null,
	};
}

export async function loadRevisionSummary(
	storage: RevisionStorage,
	kind: RevisionKind,
	id: string,
): Promise<RevisionSummaryFields> {
	const index = await loadRevisionIndex(storage, kind, id);
	const result = await revisionSummaryFromIndex(storage, kind, id, index);
	return {
		revisions_count: result.revisions_count,
		last_revision: result.last_revision,
	};
}

export async function listRevisions(
	storage: RevisionStorage,
	kind: RevisionKind,
	id: string,
	limit = 10,
): Promise<{ revisions: BodyRevisionMeta[]; count: number }> {
	const capped = Math.min(Math.max(limit, 1), MAX_REVISIONS);
	const index = await loadRevisionIndex(storage, kind, id);
	const revisions: BodyRevisionMeta[] = [];
	for (const baseEtag of index.slice(0, capped)) {
		const row =
			(await storage.get<BodyRevision>(revisionStorageKey(kind, id, baseEtag))) ?? null;
		if (row) revisions.push(toRevisionMeta(row));
	}
	return { revisions, count: index.length };
}

export async function getRevision(
	storage: RevisionStorage,
	kind: RevisionKind,
	id: string,
	baseEtag: string,
): Promise<BodyRevision | null> {
	return (await storage.get<BodyRevision>(revisionStorageKey(kind, id, baseEtag))) ?? null;
}

export async function getDiffBodies(
	storage: RevisionStorage,
	kind: RevisionKind,
	id: string,
	baseEtag: string,
	headBody: string,
	headEtag: string,
): Promise<{ base_etag: string; head_etag: string; base_body: string; head_body: string } | null> {
	const snapshot = await getRevision(storage, kind, id, baseEtag);
	if (!snapshot) return null;
	return {
		base_etag: snapshot.base_etag,
		head_etag: headEtag,
		base_body: snapshot.body,
		head_body: headBody,
	};
}

export function parseRevisionLimit(raw: string | null): number {
	if (!raw) return 10;
	const n = Number.parseInt(raw, 10);
	if (Number.isNaN(n)) return 10;
	return Math.min(Math.max(n, 1), MAX_REVISIONS);
}

export async function resolveDefaultBaseEtag(
	storage: RevisionStorage,
	kind: RevisionKind,
	id: string,
	lastRevision: BodyRevisionMeta | null,
): Promise<string | null> {
	if (lastRevision?.base_etag) return lastRevision.base_etag;
	const index = await loadRevisionIndex(storage, kind, id);
	return index[0] ?? null;
}

export async function resolveBodyAtEtag(
	storage: RevisionStorage,
	kind: RevisionKind,
	id: string,
	record: { body: string; etag: string },
	etag: string,
): Promise<string | null> {
	if (etag === record.etag) return record.body;
	const snapshot = await getRevision(storage, kind, id, etag);
	return snapshot?.body ?? null;
}

export async function buildRevisionDiff(
	storage: RevisionStorage,
	kind: RevisionKind,
	id: string,
	record: { body: string; etag: string; last_revision: BodyRevisionMeta | null },
	baseEtag: string | null,
	headEtag: string | null,
): Promise<{ base_etag: string; head_etag: string; base_body: string; head_body: string } | null> {
	const resolvedBase =
		baseEtag?.trim() ||
		(await resolveDefaultBaseEtag(storage, kind, id, record.last_revision));
	if (!resolvedBase) return null;

	const resolvedHead = headEtag?.trim() || record.etag;
	const headBody = await resolveBodyAtEtag(storage, kind, id, record, resolvedHead);
	if (headBody === null) return null;

	return getDiffBodies(storage, kind, id, resolvedBase, headBody, resolvedHead);
}

export async function applyBodyRevisionOnSave<T extends RevisionWriteContext & RevisionSummaryFields>(
	storage: RevisionStorage,
	kind: RevisionKind,
	id: string,
	existing: (T & RevisionWriteContext) | null,
	incoming: T,
): Promise<T> {
	let revisions_count = existing?.revisions_count ?? 0;
	let last_revision = existing?.last_revision ?? null;

	if (existing && existing.body !== incoming.body) {
		const result = await appendBodyRevision(storage, kind, id, existing, incoming);
		revisions_count = result.revisions_count;
		last_revision = result.last_revision;
	}

	return { ...incoming, revisions_count, last_revision };
}
