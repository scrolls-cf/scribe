/**
 * Line-level diff rows for board Changes view (client-side, v1).
 * @typedef {{ type: "add" | "remove" | "context", num: number, text: string }} DiffLineRow
 */

/**
 * @param {string[]} a
 * @param {string[]} b
 * @returns {string[]}
 */
export function lcsSequence(a, b) {
	const m = a.length;
	const n = b.length;
	const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (a[i - 1] === b[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}
	}
	/** @type {string[]} */
	const seq = [];
	let i = m;
	let j = n;
	while (i > 0 && j > 0) {
		if (a[i - 1] === b[j - 1]) {
			seq.unshift(a[i - 1]);
			i--;
			j--;
		} else if (dp[i - 1][j] >= dp[i][j - 1]) {
			i--;
		} else {
			j--;
		}
	}
	return seq;
}

/**
 * @param {string} baseText
 * @param {string} headText
 * @returns {DiffLineRow[]}
 */
export function buildLineDiffRows(baseText, headText) {
	const a = String(baseText ?? "").split("\n");
	const b = String(headText ?? "").split("\n");
	const common = lcsSequence(a, b);

	/** @type {DiffLineRow[]} */
	const rows = [];
	let i = 0;
	let j = 0;
	let k = 0;

	while (k < common.length) {
		const line = common[k];
		while (i < a.length && a[i] !== line) {
			rows.push({ type: "remove", num: i + 1, text: a[i] });
			i++;
		}
		while (j < b.length && b[j] !== line) {
			rows.push({ type: "add", num: j + 1, text: b[j] });
			j++;
		}
		rows.push({ type: "context", num: j + 1, text: line });
		i++;
		j++;
		k++;
	}
	while (i < a.length) {
		rows.push({ type: "remove", num: i + 1, text: a[i] });
		i++;
	}
	while (j < b.length) {
		rows.push({ type: "add", num: j + 1, text: b[j] });
		j++;
	}
	return rows;
}

/**
 * @param {DiffLineRow[]} rows
 */
export function countDiffLineStats(rows) {
	let lines_added = 0;
	let lines_removed = 0;
	for (const row of rows) {
		if (row.type === "add") lines_added++;
		if (row.type === "remove") lines_removed++;
	}
	return { lines_added, lines_removed };
}
