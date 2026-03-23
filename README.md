# ipsum-cron-worker

Cloudflare Worker that syncs the [IPsum](https://github.com/stamparm/ipsum) threat intelligence feed into Cloudflare IP Lists — one per threat level. Runs daily via cron trigger and exposes a status dashboard at [ipsum.erfi.io](https://ipsum.erfi.io).

## How it works

1. **Fetch** — Downloads `ipsum.txt` from GitHub (~200k IPs with blacklist hit scores 1–8). Uses `ETag` / `If-None-Match` to skip the download when the feed hasn't changed.
2. **Parse** — Buckets IPs by exact score using fast regex validation, then precomputes cumulative arrays (level N = all IPs appearing on N+ blacklists).
3. **Sync** — For each configured level, ensures a Cloudflare IP list exists (`ipsum_level_N`) and replaces all items via the Lists API, polling bulk operations to completion. Per-level errors are caught so one failure doesn't block the rest.
4. **Store** — Writes sync state (run ID, duration, per-level results, errors) to KV for the status dashboard.
5. **Log** — Every step emits structured JSON logs with a `runId` for end-to-end tracing.

## Endpoints

| Path           | Description                                                                     |
| -------------- | ------------------------------------------------------------------------------- |
| `GET /`        | HTML status dashboard showing all lists, IP counts, last sync state, and timing |
| `GET /trigger` | Manually trigger a sync; returns JSON with full sync state                      |

## Setup

### Prerequisites

- Node.js 20+
- Cloudflare account with a zone for the custom domain
- API token with **Account Filter Lists: Edit** permission

### Install

```sh
git clone <repo-url> && cd ipsum-cron-worker
npm install
```

### Configure secrets

```sh
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put CF_API_TOKEN
```

### Configure levels (optional)

By default all 8 levels are synced. To sync only specific levels (e.g. 3–8 to stay within non-Enterprise list item limits), set the `IPSUM_LEVELS` env var in the Cloudflare dashboard or `wrangler.jsonc`:

```jsonc
"vars": { "IPSUM_LEVELS": "3,4,5,6,7,8" }
```

### Deploy

```sh
npm run deploy
```

The worker deploys to `ipsum.erfi.io` (configured in `wrangler.jsonc`) with a daily cron at 04:00 UTC.

## Development

```sh
npm run dev              # local dev server (--test-scheduled)
npm run cf-typegen       # regenerate worker-configuration.d.ts
npm run typecheck        # tsc --noEmit
```

### Testing the scheduled handler locally

```sh
npm run dev
# In another terminal:
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```

## Testing

74 tests across 6 test files using Vitest + `@cloudflare/vitest-pool-workers`:

```sh
npm test                                      # run all tests once
npm run test:watch                            # watch mode
npx vitest run test/ipsum.test.ts             # single file
npx vitest run -t "test name pattern"         # by name
```

### Test coverage

| File                            | Tests | Covers                                                                                                                                                                                                                                  |
| ------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/consts.test.ts`           | 13    | List naming, CF constraints, description limits, `parseLevels` (defaults, ranges, dedup, edge cases)                                                                                                                                    |
| `test/log.test.ts`              | 4     | Structured JSON output, `runId` correlation across all log levels                                                                                                                                                                       |
| `test/ipsum.test.ts`            | 21    | Parsing (comments, blanks, invalid IPs, non-integer scores, out-of-range), cumulative arrays (subset property), `fetchIpsum` (success, 404, network error, ETag 304, ETag caching, no-KV mode)                                          |
| `test/cloudflare-lists.test.ts` | 16    | Bulk op polling (success, retry, failure, timeout), `ensureLists` (create all, reuse, partial, subset, API error), `replaceListItems` (normal, empty, error), `syncAllLists` (e2e, ordering, subset levels, per-level error resilience) |
| `test/status-page.test.ts`      | 12    | `fetchListStatus` (full, partial, empty, filtering), `renderStatusPage` (HTML structure, stats, missing levels, links, sync state display, skipped state, error highlighting)                                                           |
| `test/index.test.ts`            | 8     | Scheduled handler (runId correlation, error path, breadcrumb ordering, KV persistence), fetch handler (`/trigger` success/error, `/`, unknown paths, manual trigger log correlation)                                                    |

## Architecture

```
src/
  index.ts              Entry point — ExportedHandler with fetch + scheduled
  routes.ts             Path-based router, route handlers (trigger, status)
  cf-api.ts             Minimal typed Cloudflare Lists API client (raw fetch)
  ipsum.ts              Fetch + parse ipsum.txt, ETag caching, cumulative arrays
  cloudflare-lists.ts   Ensure lists, replace items, poll bulk operations
  status-page.ts        Fetch list metadata, render HTML dashboard with KV state
  log.ts                Structured JSON logger with runId correlation
  consts.ts             URLs, levels, list names, polling config, parseLevels
  env.d.ts              Env type augmentation for secrets + IPSUM_LEVELS
```

### Key design decisions

- **Precomputed cumulative arrays** — Built once bottom-up after parsing. Level N's array is `bucket[N].concat(bucket[N+1]...bucket[8])`, constructed in a single pass from level 8 down. No repeated iteration.
- **Regex parsing** — `parseInt` + `/^\d+$/` + IPv4/IPv6 regexes instead of Zod for 200k+ lines.
- **Per-level error resilience** — `syncAllLists` catches errors per level and records them in the result. Only throws if _all_ levels fail.
- **ETag skip** — Stores the GitHub ETag in KV. If the feed hasn't changed, the sync is skipped entirely (304 response).

### Structured log trail

Every cron/manual run produces a consistent log trail with a shared `runId`:

```
run_start → ipsum_fetch_start → ipsum_fetch_complete → ipsum_parsed
  → ensure_lists_start → list_exists/list_created (×N) → ensure_lists_complete
  → replace_items_start → replace_items_submitted → bulk_op_complete (×N)
  → list_sync_complete (×N) → run_complete
```

On ETag match: `run_start → ipsum_fetch_start → ipsum_not_modified → run_skipped`

On failure: `run_failed` with `error`, `stack`, `durationMs`.

## Cloudflare IP Lists limits

| Plan         | Max lists | Max items (across all lists) |
| ------------ | --------- | ---------------------------- |
| Free         | 1         | 10,000                       |
| Pro/Business | 10        | 10,000                       |
| Enterprise   | 1,000     | 500,000                      |

Level 1 alone has ~200k IPs. Use `IPSUM_LEVELS=3,4,5,6,7,8` on non-Enterprise plans to stay within limits.

[## MIT License](./LICENSE)
