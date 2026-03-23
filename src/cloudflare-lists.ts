/** Cloudflare Lists API operations for syncing IPsum data. */

import type { CfBulkOperation, CfClient, CfList } from './cf-api';
import { BULK_OP_MAX_POLLS, BULK_OP_POLL_INTERVAL_MS, listDescriptionForLevel, listNameForLevel } from './consts';
import type { Logger } from './log';

export interface ListSyncResult {
	level: number;
	listId: string;
	itemCount: number;
	durationMs: number;
	error?: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface PollOptions {
	maxPolls?: number;
	pollIntervalMs?: number;
}

/**
 * Wait for a bulk operation to complete.
 * Throws if the operation fails or polling times out.
 */
export const waitForBulkOperation = async (
	client: CfClient,
	operationId: string,
	log: Logger,
	opts?: PollOptions,
): Promise<void> => {
	const maxPolls = opts?.maxPolls ?? BULK_OP_MAX_POLLS;
	const pollIntervalMs = opts?.pollIntervalMs ?? BULK_OP_POLL_INTERVAL_MS;

	for (let i = 0; i < maxPolls; i++) {
		const op: CfBulkOperation = await client.getBulkOperation(operationId);

		switch (op.status) {
			case 'completed':
				log.info('bulk_op_complete', { operationId, polls: i + 1 });
				return;

			case 'failed': {
				const errorMsg = op.error ?? 'unknown error';
				log.error('bulk_op_failed', { operationId, error: errorMsg });
				throw new Error(`Bulk operation ${operationId} failed: ${errorMsg}`);
			}

			case 'pending':
			case 'running':
				await sleep(pollIntervalMs);
				break;
		}
	}

	log.error('bulk_op_timeout', { operationId, maxPolls });
	throw new Error(`Bulk operation ${operationId} timed out after ${maxPolls} polls`);
};

/**
 * Look up existing lists by name. Returns a map of listName -> CfList.
 */
export const getExistingLists = async (client: CfClient): Promise<Map<string, CfList>> => {
	const all = await client.getLists();
	const existing = new Map<string, CfList>();
	for (const list of all) {
		existing.set(list.name, list);
	}
	return existing;
};

/** Resolve an existing list or create it. Returns the list ID. */
const resolveOrCreateList = async (
	client: CfClient,
	level: number,
	existing: Map<string, CfList>,
	log: Logger,
): Promise<string> => {
	const name = listNameForLevel(level);
	const found = existing.get(name);

	if (found) {
		log.info('list_exists', { level, listId: found.id, name });
		return found.id;
	}

	const created = await client.createList(name, 'ip', listDescriptionForLevel(level));
	log.info('list_created', { level, listId: created.id, name });
	return created.id;
};

/**
 * Ensure all requested ipsum_level_N lists exist. Creates any that are missing.
 * Returns a map of level -> listId.
 */
export const ensureLists = async (client: CfClient, levels: number[], log: Logger): Promise<Map<number, string>> => {
	log.info('ensure_lists_start', { levels });
	const existing = await getExistingLists(client);
	const levelToListId = new Map<number, string>();

	for (const level of levels) {
		const listId = await resolveOrCreateList(client, level, existing, log);
		levelToListId.set(level, listId);
	}

	log.info('ensure_lists_complete', { count: levelToListId.size });
	return levelToListId;
};

/**
 * Replace all items in a list with the provided IPs.
 * Waits for the bulk operation to complete before returning.
 */
export const replaceListItems = async (client: CfClient, listId: string, ips: string[], log: Logger): Promise<void> => {
	log.info('replace_items_start', { listId, itemCount: ips.length });

	const operationId = await client.replaceListItems(
		listId,
		ips.map((ip) => ({ ip })),
	);

	log.info('replace_items_submitted', { listId, operationId });
	await waitForBulkOperation(client, operationId, log);
};

/**
 * Sync the requested levels: ensure lists exist, then replace items in each.
 * Continues on per-level errors so one failure doesn't block the rest.
 */
export const syncAllLists = async (
	client: CfClient,
	levels: number[],
	ipsForLevel: (level: number) => string[],
	log: Logger,
): Promise<ListSyncResult[]> => {
	const levelToListId = await ensureLists(client, levels, log);
	const results: ListSyncResult[] = [];

	for (const level of levels) {
		const listId = levelToListId.get(level)!;
		const ips = ipsForLevel(level);
		const start = Date.now();

		try {
			await replaceListItems(client, listId, ips, log);
			const durationMs = Date.now() - start;
			results.push({ level, listId, itemCount: ips.length, durationMs });
			log.info('list_sync_complete', { level, listId, itemCount: ips.length, durationMs });
		} catch (err) {
			const durationMs = Date.now() - start;
			const errorMsg = err instanceof Error ? err.message : String(err);
			results.push({ level, listId, itemCount: ips.length, durationMs, error: errorMsg });
			log.error('list_sync_failed', { level, listId, error: errorMsg, durationMs });
		}
	}

	return results;
};
