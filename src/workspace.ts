import type { SpecLock } from "./spec.ts";
import type { HolderKind } from "./spec.ts";

export const WORKSPACE_INDEX_KEY = "workspace:index";

export interface WorkspaceLease {
	/** Always spec_slug — primary work id */
	id: string;
	kind: "spec" | "plan";
	agent_id: string;
	holder_kind?: HolderKind;
	/** Caller-supplied ged repo root at take time (forward slashes) */
	platform_root: string;
	platform_id: "ged";
	branch: string;
	/** Absolute path to git worktree */
	worktree_path: string;
	scribe_worker_root?: string;
	scrollsmatrix_worker_root?: string;
	acquired_at: string;
	expires_at?: string;
	lease_seconds?: number;
}

export interface WorkspaceSummary {
	id: string;
	kind: "spec" | "plan";
	agent_id: string;
	platform_root: string;
	branch: string;
	worktree_path: string;
	scribe_worker_root?: string;
	scrollsmatrix_worker_root?: string;
	acquired_at: string;
	expires_at?: string;
}

export function workspaceKey(id: string): string {
	return `workspace:${id}`;
}

export function isLegacyAgentsWorkerPath(path: string): boolean {
	return /[/\\]agents[/\\]/i.test(path.replace(/\\/g, "/"));
}

export function normalizePlatformPath(raw: string): string {
	return raw.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

export function isAbsolutePlatformPath(path: string): boolean {
	if (/^[a-zA-Z]:\//.test(path)) return true;
	return path.startsWith("/");
}

export function validatePlatformRoot(
	raw: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
	if (typeof raw !== "string" || !raw.trim()) {
		return { ok: false, error: "platform_root is required when workspace_isolation is enabled" };
	}
	const normalized = normalizePlatformPath(raw);
	if (!isAbsolutePlatformPath(normalized)) {
		return { ok: false, error: "platform_root must be an absolute path" };
	}
	if (isLegacyAgentsWorkerPath(normalized)) {
		return { ok: false, error: "platform_root must not use legacy agents/ paths" };
	}
	return { ok: true, value: normalized };
}

export function computeWorkspaceManifest(
	specSlug: string,
	kind: "spec" | "plan",
	platformRoot: string,
	lock: SpecLock,
): WorkspaceLease {
	const root = normalizePlatformPath(platformRoot);
	const branch = `ged/${specSlug}`;
	const worktree_path = `${root}/workspace/agents/${specSlug}`;
	return {
		id: specSlug,
		kind,
		agent_id: lock.agent_id,
		holder_kind: lock.holder_kind,
		platform_root: root,
		platform_id: "ged",
		branch,
		worktree_path,
		scribe_worker_root: `${worktree_path}/workspace/scribe`,
		scrollsmatrix_worker_root: `${worktree_path}/workspace/scrollsmatrix`,
		acquired_at: lock.acquired_at,
		expires_at: lock.expires_at,
		lease_seconds: lock.lease_seconds,
	};
}

export function toWorkspaceSummary(lease: WorkspaceLease): WorkspaceSummary {
	return {
		id: lease.id,
		kind: lease.kind,
		agent_id: lease.agent_id,
		platform_root: lease.platform_root,
		branch: lease.branch,
		worktree_path: lease.worktree_path,
		scribe_worker_root: lease.scribe_worker_root,
		scrollsmatrix_worker_root: lease.scrollsmatrix_worker_root,
		acquired_at: lease.acquired_at,
		expires_at: lease.expires_at,
	};
}

export async function listWorkspaceIds(storage: DurableObjectStorage): Promise<string[]> {
	return (await storage.get<string[]>(WORKSPACE_INDEX_KEY)) ?? [];
}

export async function getWorkspaceLease(
	storage: DurableObjectStorage,
	id: string,
): Promise<WorkspaceLease | null> {
	return (await storage.get<WorkspaceLease>(workspaceKey(id))) ?? null;
}

export async function upsertWorkspaceLease(
	storage: DurableObjectStorage,
	lease: WorkspaceLease,
): Promise<void> {
	await storage.put(workspaceKey(lease.id), lease);
	const ids = new Set(await listWorkspaceIds(storage));
	ids.add(lease.id);
	await storage.put(WORKSPACE_INDEX_KEY, [...ids].sort());
}

export async function removeWorkspaceLease(
	storage: DurableObjectStorage,
	id: string,
): Promise<boolean> {
	const existing = await getWorkspaceLease(storage, id);
	if (!existing) return false;
	await storage.delete(workspaceKey(id));
	const ids = (await listWorkspaceIds(storage)).filter((entry) => entry !== id);
	if (ids.length) {
		await storage.put(WORKSPACE_INDEX_KEY, ids);
	} else {
		await storage.delete(WORKSPACE_INDEX_KEY);
	}
	return true;
}

export async function listWorkspaceLeases(
	storage: DurableObjectStorage,
	specSlug?: string,
): Promise<WorkspaceLease[]> {
	const ids = await listWorkspaceIds(storage);
	const leases: WorkspaceLease[] = [];
	for (const id of ids) {
		if (specSlug && id !== specSlug) continue;
		const lease = await getWorkspaceLease(storage, id);
		if (lease) leases.push(lease);
	}
	leases.sort((a, b) => b.acquired_at.localeCompare(a.acquired_at));
	return leases;
}
