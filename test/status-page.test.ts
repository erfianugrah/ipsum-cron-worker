import { describe, expect, it, vi } from 'vitest';
import type { CfClient } from '../src/cf-api';
import { fetchListStatus, renderStatusPage } from '../src/status-page';
import { ALL_LEVELS, listNameForLevel } from '../src/consts';

const mockListsClient = (lists: Array<{ name: string; id: string; num_items: number; modified_on: string }>): CfClient => ({
	getLists: vi.fn().mockResolvedValue(
		lists.map((l) => ({
			id: l.id,
			name: l.name,
			kind: 'ip',
			num_items: l.num_items,
			num_referencing_filters: 0,
			created_on: '2026-01-01T00:00:00Z',
			modified_on: l.modified_on,
		})),
	),
	createList: vi.fn(),
	replaceListItems: vi.fn(),
	getBulkOperation: vi.fn(),
});

describe('fetchListStatus', () => {
	it('returns info for all 8 ipsum lists sorted by level', async () => {
		const allLists = ALL_LEVELS.map((l) => ({
			name: listNameForLevel(l),
			id: `id-${l}`,
			num_items: l * 100,
			modified_on: `2026-03-${10 + l}T00:00:00Z`,
		}));
		const client = mockListsClient(allLists);

		const result = await fetchListStatus(client);
		expect(result.length).toBe(8);
		expect(result[0].level).toBe(1);
		expect(result[7].level).toBe(8);
		expect(result[0].numItems).toBe(100);
		expect(result[7].numItems).toBe(800);
	});

	it('filters out non-ipsum lists', async () => {
		const lists = [
			{ name: 'ipsum_level_3', id: 'id-3', num_items: 50, modified_on: '2026-03-23T00:00:00Z' },
			{ name: 'some_other_list', id: 'id-other', num_items: 999, modified_on: '2026-03-23T00:00:00Z' },
		];
		const client = mockListsClient(lists);

		const result = await fetchListStatus(client);
		expect(result.length).toBe(1);
		expect(result[0].name).toBe('ipsum_level_3');
	});

	it('returns empty array when no lists exist', async () => {
		const client = mockListsClient([]);
		const result = await fetchListStatus(client);
		expect(result).toEqual([]);
	});
});

describe('renderStatusPage', () => {
	const fullLists = ALL_LEVELS.map((l) => ({
		level: l,
		name: listNameForLevel(l),
		id: `id-${l}`,
		numItems: l * 1000,
		modifiedOn: '2026-03-23T04:00:00Z',
	}));

	it('renders valid HTML with DOCTYPE', () => {
		const html = renderStatusPage(fullLists);
		expect(html).toContain('<!DOCTYPE html>');
		expect(html).toContain('<title>IPsum Cron Worker</title>');
	});

	it('includes all 8 list rows with IP counts', () => {
		const html = renderStatusPage(fullLists);
		for (const l of fullLists) {
			expect(html).toContain(l.name);
			expect(html).toContain(l.id);
		}
	});

	it('shows stat cards with totals', () => {
		const html = renderStatusPage(fullLists);
		expect(html).toContain('8 / 8');
		expect(html).toContain('36,000');
	});

	it('shows missing levels when some lists are absent', () => {
		const partial = fullLists.slice(0, 3);
		const html = renderStatusPage(partial);
		expect(html).toContain('3 / 8');
		expect(html).toContain('ipsum_level_4');
		expect(html).toContain('not created');
	});

	it('handles empty list (no lists created)', () => {
		const html = renderStatusPage([]);
		expect(html).toContain('0 / 8');
		expect(html).toContain('Never');
		for (const l of ALL_LEVELS) {
			expect(html).toContain(listNameForLevel(l));
		}
	});

	it('includes trigger button link', () => {
		const html = renderStatusPage(fullLists);
		expect(html).toContain('href="/trigger"');
	});

	it('links to stamparm/ipsum source', () => {
		const html = renderStatusPage(fullLists);
		expect(html).toContain('github.com/stamparm/ipsum');
	});

	it('shows last sync info when SyncState provided', () => {
		const lastSync = {
			runId: 'test-run-id',
			trigger: 'manual',
			timestamp: '2026-03-23T12:00:00Z',
			durationMs: 5000,
			skipped: false,
			levels: [1, 2, 3, 4, 5, 6, 7, 8],
			results: [],
			totalItems: 100,
			errors: 0,
		};
		const html = renderStatusPage(fullLists, lastSync);
		expect(html).toContain('test-run-id');
		expect(html).toContain('5.0s');
		expect(html).toContain('manual');
	});

	it('shows skipped status when sync was skipped', () => {
		const lastSync = {
			runId: 'test-run-id',
			trigger: 'cron:0 4 * * *',
			timestamp: '2026-03-23T04:00:00Z',
			durationMs: 200,
			skipped: true,
			levels: [1, 2, 3, 4, 5, 6, 7, 8],
			results: [],
			totalItems: 0,
			errors: 0,
		};
		const html = renderStatusPage(fullLists, lastSync);
		expect(html).toContain('Skipped (unchanged)');
	});

	it('shows error count in red when errors exist', () => {
		const lastSync = {
			runId: 'test-run-id',
			trigger: 'manual',
			timestamp: '2026-03-23T12:00:00Z',
			durationMs: 3000,
			skipped: false,
			levels: [1, 2, 3],
			results: [],
			totalItems: 50,
			errors: 2,
		};
		const html = renderStatusPage(fullLists, lastSync);
		expect(html).toContain('#f85149'); // red color for errors
	});
});
