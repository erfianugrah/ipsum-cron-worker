/**
 * IPsum Cron Worker
 *
 * Fetches the IPsum threat intelligence feed daily and syncs IPs into
 * Cloudflare IP lists (ipsum_level_N), one per configured threat level.
 *
 * Secrets (set via `wrangler secret put`):
 *   CF_API_TOKEN  -- Cloudflare API token with Account Filter Lists Edit permission
 *   CF_ACCOUNT_ID -- Cloudflare account ID
 *
 * Optional env vars (set in wrangler.jsonc or dashboard):
 *   IPSUM_LEVELS -- comma-separated levels to sync, e.g. "3,4,5,6,7,8". Defaults to all (1-8).
 */

import { createCfClient } from './cf-api';
import { syncAllLists, type ListSyncResult } from './cloudflare-lists';
import { KV_LAST_SYNC, parseLevels } from './consts';
import { fetchIpsum } from './ipsum';
import { createLogger, type Logger } from './log';
import { handleStatus, handleTrigger, route } from './routes';

/** Stored in KV after each sync for the status page. */
export interface SyncState {
	runId: string;
	trigger: string;
	timestamp: string;
	durationMs: number;
	skipped: boolean;
	levels: number[];
	results: Array<{ level: number; items: number; ms: number; error?: string }>;
	totalItems: number;
	errors: number;
}

/** Shared sync logic used by both the cron and manual trigger. */
export const runSync = async (env: Env, trigger: string, log: Logger): Promise<SyncState> => {
	const runId = log.ctx.runId;
	const levels = parseLevels(env.IPSUM_LEVELS);

	log.info('run_start', { trigger, levels });
	const runStart = Date.now();

	try {
		const { data, skipped } = await fetchIpsum(log, env.IPSUM_KV);

		if (skipped) {
			const state: SyncState = {
				runId,
				trigger,
				timestamp: new Date().toISOString(),
				durationMs: Date.now() - runStart,
				skipped: true,
				levels,
				results: [],
				totalItems: 0,
				errors: 0,
			};
			log.info('run_skipped', { reason: 'etag_match', durationMs: state.durationMs });
			await env.IPSUM_KV.put(KV_LAST_SYNC, JSON.stringify(state));
			return state;
		}

		const levelSummary = Object.fromEntries(levels.map((l) => [`level_${l}`, data!.cumulative.get(l)?.length ?? 0]));
		log.info('ipsum_parsed', levelSummary);

		const client = createCfClient(env.CF_API_TOKEN, env.CF_ACCOUNT_ID);

		const results = await syncAllLists(client, levels, (level) => data!.cumulative.get(level) ?? [], log);

		const totalItems = results.reduce((sum, r) => sum + r.itemCount, 0);
		const errors = results.filter((r) => r.error).length;
		const durationMs = Date.now() - runStart;
		const resultsSummary = results.map((r) => ({ level: r.level, items: r.itemCount, ms: r.durationMs, error: r.error }));

		const state: SyncState = {
			runId,
			trigger,
			timestamp: new Date().toISOString(),
			durationMs,
			skipped: false,
			levels,
			results: resultsSummary,
			totalItems,
			errors,
		};

		log.info('run_complete', { trigger, listsUpdated: results.length, totalItems, errors, durationMs, results: resultsSummary });
		await env.IPSUM_KV.put(KV_LAST_SYNC, JSON.stringify(state));

		if (errors > 0 && errors === results.length) {
			throw new Error(`All ${errors} list syncs failed`);
		}

		return state;
	} catch (err) {
		log.error('run_failed', {
			trigger,
			error: err instanceof Error ? err.message : String(err),
			stack: err instanceof Error ? err.stack : undefined,
			durationMs: Date.now() - runStart,
		});
		throw err;
	}
};

const router = route({ '/trigger': handleTrigger(runSync) }, handleStatus);

export default {
	async fetch(req, env, ctx): Promise<Response> {
		return router(req, env);
	},

	async scheduled(event, env, ctx): Promise<void> {
		const runId = crypto.randomUUID();
		const log = createLogger({ runId, cron: event.cron });
		await runSync(env, `cron:${event.cron}`, log);
	},
} satisfies ExportedHandler<Env>;
