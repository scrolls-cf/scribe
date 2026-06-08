/** Detail etag poll interval while review loop is active (ms). */
export const DETAIL_POLL_MS = 15_000;

/** @type {ReturnType<typeof setInterval> | null} */
let pollTimer = null;
/** @type {string | null} */
let cachedEtag = null;

export function prefersReducedMotion() {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * @param {ParentNode | null | undefined} root
 */
/**
 * @param {ParentNode | null | undefined} root
 */
export function pulseIterationChip(root) {
	if (prefersReducedMotion()) return;
	const chip = root?.querySelector(".status-pill--iteration");
	if (!chip) return;
	chip.classList.add("status-pill--pulse");
	chip.addEventListener(
		"animationend",
		() => chip.classList.remove("status-pill--pulse"),
		{ once: true },
	);
}

export function stopDetailPoll() {
	if (pollTimer) clearInterval(pollTimer);
	pollTimer = null;
	cachedEtag = null;
}

/**
 * @param {{ shouldContinue: () => boolean, tick: (prevEtag: string | null) => Promise<void> }} opts
 */
export function startDetailPoll(opts) {
	stopDetailPoll();
	pollTimer = setInterval(async () => {
		if (!opts.shouldContinue()) {
			stopDetailPoll();
			return;
		}
		try {
			await opts.tick(cachedEtag);
		} catch {
			/* poll must not break detail view */
		}
	}, DETAIL_POLL_MS);
}

/** @param {string | null | undefined} etag */
export function setDetailPollEtag(etag) {
	cachedEtag = etag ?? null;
}

export function getDetailPollEtag() {
	return cachedEtag;
}
