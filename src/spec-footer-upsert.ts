/** Footer markdown upserts — mirrors ged parse-spec-footer.mjs for DO transitions. */

export function upsertFooterStatus(body: string, statusLabel = "Shipped"): string {
	const fieldRe = /(\|\s*\*\*Status\*\*\s*\|\s*)([^|\n]*)(\s*\|)/i;
	if (fieldRe.test(body)) {
		return body.replace(fieldRe, `$1${statusLabel}$3`);
	}

	const sectionRe = /^## Implementation status\r?\n/m;
	if (sectionRe.test(body)) {
		return body.replace(
			sectionRe,
			`## Implementation status\n\n| **Status** | ${statusLabel} |\n`,
		);
	}

	return `${body.trim()}\n\n## Implementation status\n\n| **Status** | ${statusLabel} |\n`;
}

export function upsertFooterPlan(body: string, planId: string): string {
	const id = planId.trim();
	if (!id) return body;
	const fieldRe = /(\|\s*\*\*Plan:\*\*\s*\|\s*)([^|\n]*)(\s*\|)/i;
	const row = `\`${id}\``;
	if (fieldRe.test(body)) {
		return body.replace(fieldRe, `$1${row}$3`);
	}
	const planReviewRe = /(\|\s*\*\*Plan review\*\*\s*\|\s*[^|\n]*\s*\|)/i;
	if (planReviewRe.test(body)) {
		return body.replace(planReviewRe, `$1\n| **Plan:** | ${row} |`);
	}
	return upsertFooterStatus(body).replace(
		/(\|\s*\*\*Status\*\*\s*\|\s*[^|\n]*\s*\|)/i,
		`$1\n| **Plan:** | ${row} |`,
	);
}

export function upsertFooterReviewGate(body: string, value = "pending"): string {
	const gate = value.trim();
	const fieldRe = /(\|\s*\*\*Review gate\*\*\s*\|\s*)([^|\n]*)(\s*\|)/i;
	if (fieldRe.test(body)) {
		return body.replace(fieldRe, `$1${gate} |`);
	}

	const statusRe = /(\|\s*\*\*Status\*\*\s*\|\s*[^|\n]*\s*\|)/i;
	if (statusRe.test(body)) {
		return body.replace(statusRe, `$1\n| **Review gate** | ${gate} |`);
	}

	const sectionRe = /^## Implementation status\r?\n/m;
	if (sectionRe.test(body)) {
		return body.replace(
			sectionRe,
			`## Implementation status\n\n| **Review gate** | ${gate} |\n`,
		);
	}

	return `${body.trim()}\n\n## Implementation status\n\n| **Review gate** | ${gate} |\n`;
}

export function upsertFooterPlanReview(body: string, value = "passed"): string {
	const label = value.trim();
	const fieldRe = /(\|\s*\*\*Plan review\*\*\s*\|\s*)([^|\n]*)(\s*\|)/i;
	if (fieldRe.test(body)) {
		return body.replace(fieldRe, `$1${label}$3`);
	}

	const reviewRe = /(\|\s*\*\*Review gate\*\*\s*\|\s*[^|\n]*\s*\|)/i;
	if (reviewRe.test(body)) {
		return body.replace(reviewRe, `$1\n| **Plan review** | ${label} |`);
	}

	const activeRe = /(\|\s*\*\*Active phase\*\*\s*\|\s*[^|\n]*\s*\|)/i;
	if (activeRe.test(body)) {
		return body.replace(activeRe, `$1\n| **Plan review** | ${label} |`);
	}

	const statusRe = /(\|\s*\*\*Status\*\*\s*\|\s*[^|\n]*\s*\|)/i;
	if (statusRe.test(body)) {
		return body.replace(statusRe, `$1\n| **Plan review** | ${label} |`);
	}

	return upsertFooterStatus(body).replace(
		/(\|\s*\*\*Status\*\*\s*\|\s*[^|\n]*\s*\|)/i,
		`$1\n| **Plan review** | ${label} |`,
	);
}

export function upsertFooterActivePhase(body: string, phase = "Review"): string {
	const label = phase.trim();
	const fieldRe = /(\|\s*\*\*Active phase\*\*\s*\|\s*)([^|\n]*)(\s*\|)/i;
	if (fieldRe.test(body)) {
		return body.replace(fieldRe, `$1${label} |`);
	}

	const reviewRe = /(\|\s*\*\*Review gate\*\*\s*\|\s*[^|\n]*\s*\|)/i;
	if (reviewRe.test(body)) {
		return body.replace(reviewRe, `$1\n| **Active phase** | ${label} |`);
	}

	const statusRe = /(\|\s*\*\*Status\*\*\s*\|\s*[^|\n]*\s*\|)/i;
	if (statusRe.test(body)) {
		return body.replace(statusRe, `$1\n| **Active phase** | ${label} |`);
	}

	return upsertFooterReviewGate(body).replace(
		/(\|\s*\*\*Review gate\*\*\s*\|\s*[^|\n]*\s*\|)/i,
		`$1\n| **Active phase** | ${label} |`,
	);
}

/** Mark all phase table rows Pending → Complete (ship lane). */
export function markPhaseTableComplete(body: string): string {
	return body.replace(/\| Pending \|/g, "| **Complete** |");
}

export interface SpecPhaseUpdate {
	from: string;
	to: string;
}

/** Structured spec phase table edits (plan_gate_c payload). */
export function applySpecPhaseUpdates(body: string, updates: SpecPhaseUpdate[]): string {
	let result = body;
	for (const update of updates) {
		if (typeof update.from !== "string" || typeof update.to !== "string" || !update.from) {
			continue;
		}
		result = result.replace(update.from, update.to);
	}
	return result;
}
