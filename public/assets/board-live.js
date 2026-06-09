/**
 * Apply scribe WebSocket summary events to board list caches (ged-scribe-websockets p4).
 */

/** @param {Array<{ slug: string }>} specs @param {object} summary */
export function upsertSpecSummary(specs, summary) {
	if (!summary?.slug) return false;
	const idx = specs.findIndex((s) => s.slug === summary.slug);
	if (idx >= 0) {
		specs[idx] = { ...specs[idx], ...summary };
	} else {
		specs.push(summary);
	}
	return true;
}

/** @param {Array<{ id: string }>} plans @param {object} summary */
export function upsertPlanSummary(plans, summary) {
	if (!summary?.id) return false;
	const idx = plans.findIndex((p) => p.id === summary.id);
	if (idx >= 0) {
		plans[idx] = { ...plans[idx], ...summary };
	} else {
		plans.push(summary);
	}
	return true;
}

/**
 * Merge lock_changed into cached spec/plan rows.
 * @param {Array<{ slug: string, lock?: object | null }>} specs
 * @param {Array<{ id: string, spec_slug?: string, lock?: object | null, phases?: Array<{ id: string, lock?: object | null }> }>} plans
 * @param {{ target?: string, spec_slug?: string, plan_id?: string, phase_id?: string, lock?: object | null }} event
 */
export function applyLockChangedEvent(specs, plans, event) {
	const slug = event.spec_slug;
	if (!slug) return false;
	let changed = false;

	if (event.target === "spec" || !event.plan_id) {
		const idx = specs.findIndex((s) => s.slug === slug);
		if (idx >= 0) {
			specs[idx] = { ...specs[idx], lock: event.lock ?? null };
			changed = true;
		}
		return changed;
	}

	const planIdx = plans.findIndex((p) => p.id === event.plan_id);
	if (planIdx < 0) return false;

	if (event.target === "plan-phase" && event.phase_id && Array.isArray(plans[planIdx].phases)) {
		plans[planIdx] = {
			...plans[planIdx],
			phases: plans[planIdx].phases.map((p) =>
				p.id === event.phase_id ? { ...p, lock: event.lock ?? null } : p,
			),
		};
	} else {
		plans[planIdx] = { ...plans[planIdx], lock: event.lock ?? null };
	}
	return true;
}

/**
 * @param {Array<{ slug: string }>} specs
 * @param {Array<{ id: string }>} plans
 * @param {object} event
 */
export function applyBoardLiveEvent(specs, plans, event) {
	if (!event || typeof event !== "object") return false;
	if (event.type === "spec_updated" && event.spec) {
		return upsertSpecSummary(specs, event.spec);
	}
	if (event.type === "plan_updated" && event.plan) {
		return upsertPlanSummary(plans, event.plan);
	}
	if (event.type === "lock_changed") {
		return applyLockChangedEvent(specs, plans, event);
	}
	if (event.type === "queue_taken" && event.spec_slug) {
		return applyLockChangedEvent(specs, plans, {
			target: event.phase_id ? "plan-phase" : event.plan_id ? "plan" : "spec",
			spec_slug: event.spec_slug,
			plan_id: event.plan_id,
			phase_id: event.phase_id,
			lock: { agent_id: event.agent_id },
		});
	}
	if (event.type === "transition_applied" && event.transition?.spec) {
		return upsertSpecSummary(specs, event.transition.spec);
	}
	return false;
}
