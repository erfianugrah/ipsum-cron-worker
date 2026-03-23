# ipsum-cron-worker

Cloudflare Worker that syncs the [IPsum](https://github.com/stamparm/ipsum) threat intelligence feed into 8 Cloudflare IP Lists (`ipsum_level_1` through `ipsum_level_8`), one per threat level. Runs daily via cron trigger and exposes a status dashboard at [ipsum.erfi.io](https://ipsum.erfi.io).

## How it works

1. **Fetch** -- Downloads `ipsum.txt` from GitHub (~200k IPs with blacklist hit scores 1--8)
2. **Parse** -- Buckets IPs by exact score using fast regex validation, then precomputes cumulative arrays (level N = all IPs appearing on N+ blacklists)
3. **Sync** -- For each level 1--8, ensures a Cloudflare IP list exists (`ipsum_level_N`) and replaces all items via the Lists API, polling bulk operations to completion
4. **Log** -- Every step emits structured JSON logs with a `runId` for end-to-end tracing

## Endpoints

| Path | Description |
|------|-------------|
| `GET /` | HTML status dashboard showing all 8 lists, IP counts, and last update time |
| `GET /trigger` | Manually trigger a sync; returns JSON with results |

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

57 tests across 6 test files using Vitest + `@cloudflare/vitest-pool-workers`:

```sh
npm test                                      # run all tests once
npm run test:watch                            # watch mode
npx vitest run test/ipsum.test.ts             # single file
npx vitest run -t "test name pattern"         # by name
```

### Test coverage

| File | Tests | Covers |
|------|-------|--------|
| `test/consts.test.ts` | 5 | List naming, CF constraints, description limits |
| `test/log.test.ts` | 4 | Structured JSON output, runId correlation, log levels |
| `test/ipsum.test.ts` | 17 | Parsing (comments, blanks, invalid IPs, bad scores), cumulative arrays, `fetchIpsum` success/failure/network error, structured logs |
| `test/cloudflare-lists.test.ts` | 13 | Bulk op polling (success, retry, failure, timeout), `ensureLists` (create/reuse/error), `replaceListItems` (normal, empty, error), `syncAllLists` e2e |
| `test/status-page.test.ts` | 10 | `fetchListStatus` (full, partial, empty, filtering), `renderStatusPage` HTML (stats, rows, missing levels, links) |
| `test/index.test.ts` | 8 | Scheduled handler (full run, error, breadcrumb ordering), fetch handler (`/trigger`, error 500, `/`, unknown paths, manual trigger logs) |

## Architecture

```
src/
  index.ts              Entry point -- ExportedHandler with fetch + scheduled
  routes.ts             Path-based router, route handlers (trigger, status)
  ipsum.ts              Fetch + parse ipsum.txt, precompute cumulative arrays
  cloudflare-lists.ts   Ensure lists, replace items, poll bulk operations
  status-page.ts        Fetch list metadata, render HTML dashboard
  log.ts                Structured JSON logger with runId correlation
  consts.ts             URLs, levels, list names, polling config
  env.d.ts              Env type augmentation for secrets
```

### Structured log trail

Every cron/manual run produces a consistent log trail with a shared `runId`:

```
run_start -> ipsum_fetch_start -> ipsum_fetch_complete -> ipsum_parsed
  -> ensure_lists_start -> list_exists/list_created (x8) -> ensure_lists_complete
  -> replace_items_start -> replace_items_submitted -> bulk_op_complete (x8)
  -> list_sync_complete (x8) -> run_complete
```

On failure: `run_failed` with `error`, `stack`, `durationMs`.

### Performance

- **Parsing**: Regex + `parseInt` instead of Zod for 200k+ lines (~5--10x faster)
- **Cumulative arrays**: Built once bottom-up (`concat` from level 8 down), not recomputed per level
- **Bundle**: ~1290 KiB / 151 KiB gzip, 8ms startup

## Cloudflare IP Lists limits

| Plan | Max lists | Max items (across all lists) |
|------|-----------|------------------------------|
| Free | 1 | 10,000 |
| Pro/Business | 10 | 10,000 |
| Enterprise | 1,000 | 500,000 |

Level 1 alone has ~200k IPs. You need an Enterprise plan (or to skip level 1) to fit all 8 lists.

## License

MIT -- Erfi Anugrah
