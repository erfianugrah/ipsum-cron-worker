import { describe, expect, it, vi } from 'vitest';
import type { CfClient, CfList } from '../src/cf-api';
import { ensureLists, replaceListItems, syncAllLists, waitForBulkOperation } from '../src/cloudflare-lists';
import { ALL_LEVELS, listNameForLevel } from '../src/consts';
import type { Logger } from '../src/log';

const silentLogger = (): Logger => ({ ctx: { runId: 'test', cron: 'test' }, info: () => {}, warn: () => {}, error: () => {} }) as unknown as Logger;

/** Build a mock CfClient. */
const mockClient = (overrides?: {
	existingLists?: Array<{ id: string; name: string }>;
	bulkOpSequence?: Array<{ status: string; error?: string }>;
	createShouldThrow?: boolean;
	updateShouldThrow?: boolean;
}) => {
	const opts = {
		existingLists: overrides?.existingLists ?? [],
		bulkOpSequence: overrides?.bulkOpSequence ?? [{ status: 'completed' }],
	};

	let bulkOpCallIndex = 0;
	const createdLists: Array<{ name: string; kind: string; description?: string }> = [];
	const updatedItems: Array<{ listId: string; items: Array<{ ip: string }> }> = [];

	const client: CfClient & { _createdLists: typeof createdLists; _updatedItems: typeof updatedItems } = {
		getLists: vi.fn().mockImplementation(async () =>
			opts.existingLists.map((l) => ({
				id: l.id,
				name: l.name,
				kind: 'ip',
				num_items: 0,
				num_referencing_filters: 0,
				created_on: '2026-01-01T00:00:00Z',
				modified_on: '2026-01-01T00:00:00Z',
			})),
		),

		createList: vi.fn().mockImplementation(async (name: string, kind: string, description?: string) => {
			if (overrides?.createShouldThrow) throw new Error('API create error');
			const id = `list-${name}`;
			createdLists.push({ name, kind, description });
			return { id, name, kind, num_items: 0, num_referencing_filters: 0, created_on: '2026-01-01T00:00:00Z', modified_on: '2026-01-01T00:00:00Z' };
		}),

		replaceListItems: vi.fn().mockImplementation(async (listId: string, items: Array<{ ip: string }>) => {
			if (overrides?.updateShouldThrow) throw new Error('API update error');
			updatedItems.push({ listId, items });
			return `op-${listId}-${updatedItems.length}`;
		}),

		getBulkOperation: vi.fn().mockImplementation(async () => {
			const idx = Math.min(bulkOpCallIndex, opts.bulkOpSequence.length - 1);
			bulkOpCallIndex++;
			const entry = opts.bulkOpSequence[idx];
			return {
				id: 'op-123',
				status: entry.status,
				...(entry.status === 'completed' ? { completed: '2026-01-01T00:00:01Z' } : {}),
				...(entry.status === 'failed' ? { completed: '2026-01-01T00:00:01Z', error: entry.error ?? 'unknown' } : {}),
			};
		}),

		_createdLists: createdLists,
		_updatedItems: updatedItems,
	};

	return client;
};

describe('waitForBulkOperation', () => {
	it('resolves immediately when operation is completed', async () => {
		const client = mockClient({ bulkOpSequence: [{ status: 'completed' }] });
		await expect(waitForBulkOperation(client, 'op-1', silentLogger())).resolves.toBeUndefined();
	});

	it('polls until completed', async () => {
		const client = mockClient({
			bulkOpSequence: [{ status: 'pending' }, { status: 'running' }, { status: 'completed' }],
		});
		await expect(waitForBulkOperation(client, 'op-1', silentLogger())).resolves.toBeUndefined();
		expect(client.getBulkOperation).toHaveBeenCalledTimes(3);
	});

	it('throws on failed operation', async () => {
		const client = mockClient({
			bulkOpSequence: [{ status: 'failed', error: 'something broke' }],
		});
		await expect(waitForBulkOperation(client, 'op-1', silentLogger())).rejects.toThrow('something broke');
	});

	it('throws on timeout after max polls', async () => {
		const client = mockClient({ bulkOpSequence: [{ status: 'pending' }] });

		await expect(
			waitForBulkOperation(client, 'op-1', silentLogger(), { maxPolls: 3, pollIntervalMs: 0 }),
		).rejects.toThrow('timed out after 3 polls');
		expect(client.getBulkOperation).toHaveBeenCalledTimes(3);
	});
});

describe('ensureLists', () => {
	it('creates all 8 lists when none exist', async () => {
		const client = mockClient();
		const result = await ensureLists(client, [...ALL_LEVELS], silentLogger());

		expect(result.size).toBe(8);
		expect(client._createdLists.length).toBe(8);
		for (const level of ALL_LEVELS) {
			expect(result.has(level)).toBe(true);
		}
	});

	it('skips existing lists and only creates missing ones', async () => {
		const client = mockClient({
			existingLists: [
				{ id: 'existing-1', name: 'ipsum_level_1' },
				{ id: 'existing-2', name: 'ipsum_level_2' },
			],
		});
		const result = await ensureLists(client, [...ALL_LEVELS], silentLogger());

		expect(result.size).toBe(8);
		expect(result.get(1)).toBe('existing-1');
		expect(result.get(2)).toBe('existing-2');
		expect(client._createdLists.length).toBe(6);
	});

	it('reuses all lists when all 8 already exist', async () => {
		const existing = ALL_LEVELS.map((l) => ({ id: `existing-${l}`, name: listNameForLevel(l) }));
		const client = mockClient({ existingLists: [...existing] });
		const result = await ensureLists(client, [...ALL_LEVELS], silentLogger());

		expect(result.size).toBe(8);
		expect(client._createdLists.length).toBe(0);
	});

	it('only creates requested levels', async () => {
		const client = mockClient();
		const result = await ensureLists(client, [3, 4, 5], silentLogger());

		expect(result.size).toBe(3);
		expect(client._createdLists.length).toBe(3);
		expect(client._createdLists.map((l) => l.name)).toEqual(['ipsum_level_3', 'ipsum_level_4', 'ipsum_level_5']);
	});

	it('propagates API errors from list creation', async () => {
		const client = mockClient({ createShouldThrow: true });
		await expect(ensureLists(client, [...ALL_LEVELS], silentLogger())).rejects.toThrow('API create error');
	});
});

describe('replaceListItems', () => {
	it('sends IPs and waits for completion', async () => {
		const client = mockClient();
		await replaceListItems(client, 'list-123', ['1.1.1.1', '2.2.2.2'], silentLogger());

		expect(client._updatedItems.length).toBe(1);
		expect(client._updatedItems[0].listId).toBe('list-123');
		expect(client._updatedItems[0].items).toEqual([{ ip: '1.1.1.1' }, { ip: '2.2.2.2' }]);
	});

	it('handles empty IP list', async () => {
		const client = mockClient();
		await replaceListItems(client, 'list-123', [], silentLogger());
		expect(client._updatedItems[0].items).toEqual([]);
	});

	it('propagates API errors from replaceListItems', async () => {
		const client = mockClient({ updateShouldThrow: true });
		await expect(replaceListItems(client, 'list-123', ['1.1.1.1'], silentLogger())).rejects.toThrow('API update error');
	});
});

describe('syncAllLists', () => {
	it('creates lists and updates all 8 levels end-to-end', async () => {
		const client = mockClient();
		const ipsForLevel = (level: number) => (level >= 7 ? ['1.1.1.1', '2.2.2.2'] : ['3.3.3.3']);

		const results = await syncAllLists(client, [...ALL_LEVELS], ipsForLevel, silentLogger());

		expect(results.length).toBe(8);
		expect(results.find((r) => r.level === 7)!.itemCount).toBe(2);
		expect(results.find((r) => r.level === 1)!.itemCount).toBe(1);
		expect(results.find((r) => r.level === 1)!.error).toBeUndefined();
	});

	it('result levels match requested order', async () => {
		const client = mockClient();
		const results = await syncAllLists(client, [...ALL_LEVELS], () => [], silentLogger());
		expect(results.map((r) => r.level)).toEqual([...ALL_LEVELS]);
	});

	it('only syncs requested levels', async () => {
		const client = mockClient();
		const results = await syncAllLists(client, [5, 6, 7], () => ['1.1.1.1'], silentLogger());

		expect(results.length).toBe(3);
		expect(results.map((r) => r.level)).toEqual([5, 6, 7]);
	});

	it('continues on per-level error and records it in result', async () => {
		const client = mockClient({ updateShouldThrow: true });
		const results = await syncAllLists(client, [1, 2, 3], () => ['1.1.1.1'], silentLogger());

		expect(results.length).toBe(3);
		for (const r of results) {
			expect(r.error).toBe('API update error');
		}
	});
});
