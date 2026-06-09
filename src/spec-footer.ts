/** Minimal footer field extraction for orient/summary API (mirrors ged parse-spec-footer.mjs). */

export interface SpecFooterFields {
	terminal_skill: string | null;
	design_lane: string | null;
	plan_id: string | null;
	review_gate: string | null;
	plan_review: string | null;
	active_phase: string | null;
	worker_scope: string[];
}

function normalizePlanLink(raw: string | null): string | null {
	if (!raw) return null;
	const trimmed = raw.trim().replace(/^`(.+)`$/, "$1").trim();
	return trimmed || null;
}

function extractSection(content: string, heading: string): string | null {
	const re = new RegExp(`^## ${heading}\\r?\\n`, "m");
	const match = re.exec(content);
	if (!match) return null;
	const start = match.index + match[0].length;
	const tail = content.slice(start);
	const nextHeading = tail.search(/^## /m);
	return nextHeading === -1 ? tail : tail.slice(0, nextHeading);
}

function parseField(section: string, field: string): string | null {
	const table = section.match(new RegExp(`\\|\\s*\\*\\*${field}\\*\\*\\s*\\|\\s*([^|\\n]+)`, "i"));
	if (table) return table[1].trim();
	const bold = section.match(new RegExp(`^\\*\\*${field}:\\*\\*\\s*(.+)$`, "im"));
	if (bold) return bold[1].trim();
	if (field === "Status" && /^\*\*Partial\*\*$/im.test(section.trim())) return "Partial";
	if (field === "Status" && /^\*\*Shipped\*\*$/im.test(section.trim())) return "Shipped";
	return null;
}

export function parseWorkerScope(body: string): string[] {
	const section = extractSection(body, "Implementation status");
	if (!section) return [];
	const raw = parseField(section, "Worker scope");
	if (!raw) return [];
	return raw
		.split(/[,;]/)
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
}

export function parseSpecFooterFields(body: string): SpecFooterFields {
	const section = extractSection(body, "Implementation status");
	if (!section) {
		return {
			terminal_skill: null,
			design_lane: null,
			plan_id: null,
			review_gate: null,
			plan_review: null,
			active_phase: null,
			worker_scope: [],
		};
	}
	const planReviewRaw = parseField(section, "Plan review");
	let plan_review: string | null = null;
	if (planReviewRaw) {
		const n = planReviewRaw.toLowerCase().replace(/\*\*/g, "").trim();
		if (n === "n/a" || n === "na") plan_review = "n/a";
		else if (n === "required") plan_review = "required";
		else if (n === "passed" || n.startsWith("passed")) plan_review = "passed";
	}
	const plan_id = normalizePlanLink(
		parseField(section, "Plan") ?? parseField(section, "Plan:"),
	);
	return {
		terminal_skill: parseField(section, "Terminal skill"),
		design_lane: parseField(section, "Design lane"),
		plan_id,
		review_gate: parseField(section, "Review gate"),
		plan_review,
		active_phase: parseField(section, "Active phase"),
		worker_scope: parseWorkerScope(body),
	};
}
