const now = Date.now();
const ago = (mins) => new Date(now - mins * 60_000).toISOString();

export const MOCK_SPECS = [
  {
    slug: "scrollsmatrix-splash",
    title: "Scrollsmatrix splash refresh",
    status: "in_progress",
    updated_at: ago(12),
    phases_done: 2,
    phases_total: 4,
    lock: { agent_id: "composer-7f3a", acquired_at: ago(45) },
  },
  {
    slug: "scribe-board",
    title: "Scribe planning board",
    status: "ready",
    updated_at: ago(180),
    phases_done: 0,
    phases_total: 3,
    lock: null,
  },
  {
    slug: "access-gateway",
    title: "Access gateway hardening",
    status: "blocked",
    updated_at: ago(35),
    phases_done: 1,
    phases_total: 3,
    lock: { agent_id: "ci-runner", acquired_at: ago(90) },
  },
];

export const MOCK_SPEC_DETAILS = {
  "scrollsmatrix-splash": {
    slug: "scrollsmatrix-splash",
    title: "Scrollsmatrix splash refresh",
    body: `## Goal

Replace PNG logo with glowing wordmark. Remove footer utilities.

## Constraints

- Humans read only on splash
- devscrolls palette continuity`,
    status: "in_progress",
    updated_at: ago(12),
    phases: [
      { id: "audit", title: "Audit current splash", status: "done" },
      { id: "wordmark", title: "Ship glowing wordmark", status: "done" },
      { id: "polish", title: "Impeccable polish pass", status: "active" },
      { id: "deploy", title: "Deploy to scrollsmatrix", status: "pending" },
    ],
    lock: { agent_id: "composer-7f3a", acquired_at: ago(45) },
  },
  "scribe-board": {
    slug: "scribe-board",
    title: "Scribe planning board",
    body: `## Goal

Inline spec drill-down on the board. Full-width row layout.

## Notes

Agents mutate via API. Humans navigate and read.`,
    status: "ready",
    updated_at: ago(180),
    phases: [
      { id: "shape", title: "Shape read-only IA", status: "pending" },
      { id: "build", title: "Build inline detail pane", status: "pending" },
      { id: "critique", title: "Critique loop", status: "pending" },
    ],
    lock: null,
  },
  "tokens-ui": {
    slug: "tokens-ui",
    title: "Shared devscrolls tokens",
    body: `## Outcome

Tokens extracted to \`tokens.css\` and shared across scrolls services.`,
    status: "done",
    updated_at: ago(2880),
    phases: [
      { id: "extract", title: "Extract tokens", status: "done" },
      { id: "wire", title: "Wire scrollsmatrix + scribe", status: "done" },
    ],
    lock: null,
  },
  "access-gateway": {
    slug: "access-gateway",
    title: "Access gateway hardening",
    body: `## Blocker

JWT validation fails on cold start for matrix manifest route.`,
    status: "blocked",
    updated_at: ago(35),
    phases: [
      { id: "repro", title: "Reproduce in staging", status: "done" },
      { id: "fix", title: "Fix token refresh path", status: "active" },
      { id: "verify", title: "Verify behind Access", status: "pending" },
    ],
    lock: { agent_id: "ci-runner", acquired_at: ago(90) },
  },
};

export const MOCK_ERRORS = [
  {
    id: "err-ci-scrollsmatrix",
    message: "Workers Builds failed: wrangler deploy exited 1 on scrollsmatrix",
    source: "github.com/scrolls-cf/scrollsmatrix/actions/runs/1849201",
    created_at: ago(8),
  },
  {
    id: "err-lock-contention",
    message: "Lock held by ci-runner on access-gateway for 90m",
    source: "scribe/v1/projects/default/specs/access-gateway/lock",
    created_at: ago(22),
  },
  {
    id: "err-matrix-manifest",
    message: "GET /.well-known/matrix returned 503 from scribe stub",
    source: "scrollsmatrix/service-registry",
    created_at: ago(55),
  },
  {
    id: "err-phase-stale",
    message: "Phase polish on scrollsmatrix-splash unchanged for 6h",
    source: "scribe/phase-watch",
    created_at: ago(360),
  },
];

export function mockMode() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("mock")) return true;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

export function mockSpecDetail(slug) {
  return MOCK_SPEC_DETAILS[slug] ?? null;
}
