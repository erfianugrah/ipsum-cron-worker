/** Route handlers for the fetch endpoint. */

import { createCfClient } from './cf-api';
import { KV_LAST_SYNC } from './consts';
import { createLogger } from './log';
import { fetchListStatus, renderStatusPage } from './status-page';
import type { SyncState } from './index';

type RouteHandler = (req: Request, env: Env) => Promise<Response>;
type SyncFn = (env: Env, trigger: string, log: ReturnType<typeof createLogger>) => Promise<SyncState>;

/** POST/GET /trigger -- manually run the sync and return JSON. */
export const handleTrigger =
	(runSync: SyncFn): RouteHandler =>
	async (_req, env) => {
		const runId = crypto.randomUUID();
		const log = createLogger({ runId, cron: 'manual' });

		try {
			const state = await runSync(env, 'manual', log);
			return Response.json(state);
		} catch (err) {
			return Response.json({ ok: false, runId, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
		}
	};

/** GET / -- render the HTML status dashboard using KV-cached sync state + live list data. */
export const handleStatus: RouteHandler = async (_req, env) => {
	try {
		const client = createCfClient(env.CF_API_TOKEN, env.CF_ACCOUNT_ID);
		const [lists, lastSyncRaw] = await Promise.all([fetchListStatus(client), env.IPSUM_KV.get(KV_LAST_SYNC)]);
		const lastSync: SyncState | null = lastSyncRaw ? JSON.parse(lastSyncRaw) : null;
		const html = renderStatusPage(lists, lastSync);
		return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
	} catch (err) {
		return new Response(`Failed to load status: ${err instanceof Error ? err.message : String(err)}`, {
			status: 500,
			headers: { 'content-type': 'text/plain' },
		});
	}
};

/** Simple path-based router. Falls back to the status page for unknown paths. */
export const route = (routes: Record<string, RouteHandler>, fallback: RouteHandler): RouteHandler => {
	return (req, env) => {
		const { pathname } = new URL(req.url);
		const handler = routes[pathname] ?? fallback;
		return handler(req, env);
	};
};
