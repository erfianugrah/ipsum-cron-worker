import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_LEVEL, MIN_LEVEL } from '../src/consts';
import { fetchIpsum, parseIpsum } from '../src/ipsum';
import type { Logger } from '../src/log';

const SAMPLE_IPSUM = `# IPsum Threat Intelligence Feed
# (https://github.com/stamparm/ipsum)
#
# Last update: Mon, 23 Mar 2026 03:01:10 +0100
#
# IP\tnumber of (black)lists
#
2.57.121.25\t8
185.91.69.217\t8
45.148.10.121\t7
80.94.95.115\t6
91.208.206.75\t5
1.2.3.4\t4
10.0.0.1\t3
192.168.1.1\t2
172.16.0.1\t1
`;

const silentLogger = (): Logger => ({ ctx: { runId: 'test', cron: 'test' }, info: () => {}, warn: () => {}, error: () => {} }) as unknown as Logger;

describe('parseIpsum', () => {
	it('initializes all 8 levels with empty arrays', () => {
		const { byLevel } = parseIpsum('');
		for (let level = MIN_LEVEL; level <= MAX_LEVEL; level++) {
			expect(byLevel.get(level)).toEqual([]);
		}
	});

	it('correctly buckets IPs by exact score', () => {
		const { byLevel } = parseIpsum(SAMPLE_IPSUM);

		expect(byLevel.get(8)).toEqual(['2.57.121.25', '185.91.69.217']);
		expect(byLevel.get(7)).toEqual(['45.148.10.121']);
		expect(byLevel.get(6)).toEqual(['80.94.95.115']);
		expect(byLevel.get(5)).toEqual(['91.208.206.75']);
		expect(byLevel.get(4)).toEqual(['1.2.3.4']);
		expect(byLevel.get(3)).toEqual(['10.0.0.1']);
		expect(byLevel.get(2)).toEqual(['192.168.1.1']);
		expect(byLevel.get(1)).toEqual(['172.16.0.1']);
	});

	it('reports correct totalIps count', () => {
		const { totalIps } = parseIpsum(SAMPLE_IPSUM);
		expect(totalIps).toBe(9);
	});

	it('skips comment lines', () => {
		const { totalIps, byLevel } = parseIpsum('# comment\n1.1.1.1\t3\n');
		expect(totalIps).toBe(1);
		expect(byLevel.get(3)).toEqual(['1.1.1.1']);
	});

	it('skips blank lines', () => {
		const { totalIps } = parseIpsum('\n\n1.1.1.1\t3\n\n');
		expect(totalIps).toBe(1);
	});

	it('skips lines with invalid IPs', () => {
		const { totalIps } = parseIpsum('not-an-ip\t3\n999.999.999.999\t3\n');
		expect(totalIps).toBe(0);
	});

	it('skips lines with out-of-range scores', () => {
		const { totalIps } = parseIpsum('1.1.1.1\t0\n2.2.2.2\t9\n3.3.3.3\t-1\n');
		expect(totalIps).toBe(0);
	});

	it('skips malformed lines (no tab separator)', () => {
		const { totalIps } = parseIpsum('1.1.1.1 3\n');
		expect(totalIps).toBe(0);
	});

	it('skips lines with non-integer scores', () => {
		const { totalIps } = parseIpsum('1.1.1.1\t3.5\n2.2.2.2\tabc\n');
		expect(totalIps).toBe(0);
	});
});

describe('cumulative arrays', () => {
	const { cumulative } = parseIpsum(SAMPLE_IPSUM);

	it('level 8 returns only score-8 IPs', () => {
		expect(cumulative.get(8)).toEqual(['2.57.121.25', '185.91.69.217']);
	});

	it('level 7 returns score 7 + score 8', () => {
		const ips = cumulative.get(7)!;
		expect(ips).toContain('45.148.10.121');
		expect(ips).toContain('2.57.121.25');
		expect(ips).toContain('185.91.69.217');
		expect(ips.length).toBe(3);
	});

	it('level 1 returns all IPs', () => {
		expect(cumulative.get(1)!.length).toBe(9);
	});

	it('higher levels are strict subsets of lower levels', () => {
		for (let l = MIN_LEVEL; l < MAX_LEVEL; l++) {
			const lower = new Set(cumulative.get(l)!);
			const higher = cumulative.get(l + 1)!;
			for (const ip of higher) {
				expect(lower.has(ip), `level ${l} should contain all IPs from level ${l + 1}`).toBe(true);
			}
			expect(cumulative.get(l)!.length).toBeGreaterThanOrEqual(cumulative.get(l + 1)!.length);
		}
	});
});

describe('fetchIpsum', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('fetches, parses and returns IpsumData on success', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(SAMPLE_IPSUM, { status: 200 })));

		const result = await fetchIpsum(silentLogger());
		expect(result.skipped).toBe(false);
		expect(result.data!.totalIps).toBe(9);
		expect(result.data!.byLevel.get(8)).toEqual(['2.57.121.25', '185.91.69.217']);
	});

	it('throws on non-200 response', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404, statusText: 'Not Found' })));

		await expect(fetchIpsum(silentLogger())).rejects.toThrow('Failed to fetch ipsum.txt: 404 Not Found');
	});

	it('propagates network errors', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network timeout')));

		await expect(fetchIpsum(silentLogger())).rejects.toThrow('network timeout');
	});

	it('returns skipped=true on 304 Not Modified', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 304 })));

		const mockKv = { get: vi.fn().mockResolvedValue('"some-etag"'), put: vi.fn() } as any;
		const result = await fetchIpsum(silentLogger(), mockKv);
		expect(result.skipped).toBe(true);
		expect(result.data).toBeNull();
	});

	it('sends If-None-Match header when ETag cached in KV', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(SAMPLE_IPSUM, { status: 200, headers: { ETag: '"new-etag"' } }));
		vi.stubGlobal('fetch', fetchMock);

		const mockKv = { get: vi.fn().mockResolvedValue('"old-etag"'), put: vi.fn() } as any;
		await fetchIpsum(silentLogger(), mockKv);

		expect(fetchMock.mock.calls[0][1].headers['If-None-Match']).toBe('"old-etag"');
		expect(mockKv.put).toHaveBeenCalledWith('ipsum_etag', '"new-etag"');
	});

	it('works without KV (no ETag caching)', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(SAMPLE_IPSUM, { status: 200 })));

		const result = await fetchIpsum(silentLogger());
		expect(result.skipped).toBe(false);
		expect(result.data!.totalIps).toBe(9);
	});
});
