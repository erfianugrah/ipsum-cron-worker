/**
 * Minimal typed Cloudflare Lists API client.
 * Replaces the full `cloudflare` npm package (~1.3MB bundled) with
 * raw fetch calls to the 5 endpoints we actually use.
 */

const BASE = 'https://api.cloudflare.com/client/v4';

/** Shared shape returned by the CF API. */
interface CfResponse<T> {
	success: boolean;
	errors: Array<{ code: number; message: string }>;
	result: T;
	result_info?: { cursors?: { after?: string } };
}

export interface CfList {
	id: string;
	name: string;
	kind: string;
	num_items: number;
	num_referencing_filters: number;
	created_on: string;
	modified_on: string;
	description?: string;
}

export interface CfBulkOperation {
	id: string;
	status: 'pending' | 'running' | 'completed' | 'failed';
	completed?: string;
	error?: string;
}

export interface CfClient {
	/** GET all lists on the account. */
	getLists(): Promise<CfList[]>;
	/** POST create a new list. */
	createList(name: string, kind: string, description?: string): Promise<CfList>;
	/** PUT replace all items in a list. Returns the bulk operation ID. */
	replaceListItems(listId: string, items: Array<{ ip: string }>): Promise<string>;
	/** GET bulk operation status. */
	getBulkOperation(operationId: string): Promise<CfBulkOperation>;
}

const cfFetch = async <T>(token: string, path: string, init?: RequestInit): Promise<T> => {
	const resp = await fetch(`${BASE}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
			...init?.headers,
		},
	});

	const body = (await resp.json()) as CfResponse<T>;

	if (!body.success) {
		const msgs = body.errors.map((e) => `${e.code}: ${e.message}`).join('; ');
		throw new Error(`CF API error: ${msgs}`);
	}

	return body.result;
};

/** Paginated GET — follows cursors to fetch all pages. */
const cfFetchAll = async <T>(token: string, path: string): Promise<T[]> => {
	const results: T[] = [];
	let cursor: string | undefined;

	for (;;) {
		const url = cursor ? `${path}?cursor=${cursor}` : path;
		const resp = await fetch(`${BASE}${url}`, {
			headers: { Authorization: `Bearer ${token}` },
		});

		const body = (await resp.json()) as CfResponse<T[]>;

		if (!body.success) {
			const msgs = body.errors.map((e) => `${e.code}: ${e.message}`).join('; ');
			throw new Error(`CF API error: ${msgs}`);
		}

		results.push(...body.result);

		const nextCursor = body.result_info?.cursors?.after;
		if (!nextCursor) break;
		cursor = nextCursor;
	}

	return results;
};

export const createCfClient = (token: string, accountId: string): CfClient => {
	const prefix = `/accounts/${accountId}/rules/lists`;

	return {
		getLists: () => cfFetchAll<CfList>(token, prefix),

		createList: (name, kind, description) =>
			cfFetch<CfList>(token, prefix, {
				method: 'POST',
				body: JSON.stringify({ name, kind, description }),
			}),

		replaceListItems: async (listId, items) => {
			const result = await cfFetch<{ operation_id: string }>(token, `${prefix}/${listId}/items`, {
				method: 'PUT',
				body: JSON.stringify(items),
			});
			return result.operation_id;
		},

		getBulkOperation: (operationId) => cfFetch<CfBulkOperation>(token, `${prefix}/bulk_operations/${operationId}`),
	};
};
