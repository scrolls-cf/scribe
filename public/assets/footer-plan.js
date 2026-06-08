/**
 * Client-side footer **Plan:** resolution (mirrors ged parse-spec-footer).
 */

/**
 * @param {string | undefined} body
 * @returns {string | null}
 */
export function parsePlanLinkFromBody(body) {
  if (!body) return null;
  const sectionMatch = body.match(/## Implementation status[\s\S]*?(?=\n## |$)/);
  const section = sectionMatch ? sectionMatch[0] : body;
  const row = section.match(/\|\s*\*\*Plan\*\*\s*\|\s*([^|\n]+)/i);
  if (!row) return null;
  const raw = row[1].trim().replace(/\*\*/g, "").replace(/`/g, "");
  const id = raw.split(/\s/)[0]?.trim();
  return id || null;
}

/**
 * @param {{ slug?: string, id?: string, source?: string, spec_slug?: string }} record
 * @returns {boolean}
 */
export function isSmokeArtifact(record) {
  if (!record) return false;
  if (record.source === "ged-smoke") return true;
  const slug = record.slug || record.id || "";
  if (String(slug).startsWith("ged-smoke-")) return true;
  if (record.spec_slug?.startsWith("ged-smoke-")) return true;
  return false;
}

/**
 * Cached plans first, then footer **Plan:** fallback (stub ref when plan not in cache).
 * @param {string} specSlug
 * @param {string | undefined} specBody
 * @param {Array<{ id: string, spec_slug: string, title?: string, _footerOnly?: boolean }>} cachedPlans
 */
export function resolveLinkedPlanRefs(specSlug, specBody, cachedPlans) {
  const fromCache = cachedPlans.filter((p) => p.spec_slug === specSlug);
  if (fromCache.length) return fromCache;

  const footerId = parsePlanLinkFromBody(specBody);
  if (footerId) {
    return [
      {
        id: footerId,
        spec_slug: specSlug,
        title: "Linked plan",
        _footerOnly: true,
      },
    ];
  }
  return [];
}

/**
 * @param {string} specSlug
 * @returns {string}
 */
export function defaultPlanIdForSpec(specSlug) {
  return `${specSlug}-plan`;
}
