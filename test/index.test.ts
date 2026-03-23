import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock cf-api module to return a mock client
vi.mock('../src/cf-api', () => ({
	createCfClient: vi.fn().mockReturnValue({
		getLists: vi.fn().mockResolvedValue([]),
		createList: vi.fn().mockImplementation(async (name: string, kind: string) => ({
			id: `mock-id-${name}`,
			name,
			kind,
			num_items: 0,
			num_referencing_filters: 0,
			created_on: '2026-01-01T00:00:00Z',
			modified_on: '2026-01-01T00:00:00Z',
		})),
		replaceListItems: vi.fn().mockResolvedValue('op-1'),
		getBulkOperation: vi.fn().mockResolvedValue({
			id: 'op-1',
			status: 'completed',
			completed: '2026-01-01T00:00:01Z',
		}),
	}),
}));

const SAMPLE_IPSUM_RESPONSE = [
	'# IPsum Threat Intelligence Feed',
	'# Last update: Mon, 23 Mar 2026 03:01:10 +0100',
	'#',
	'2.57.121.25\t8',
	'185.91.69.217\t7',
	'45.148.10.121\t6',
	'80.94.95.115\t5',
	'91.208.206.75\t4',
	'1.2.3.4\t3',
	'10.0.0.1\t2',
	'192.168.1.1\t1',
].join('\n');

const makeEnv = () => ({
	CF_API_TOKEN: 'test-token',
	CF_ACCOUNT_ID: 'test-account',
	IPSUM_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(undefined) },
});
const makeCtx = () => ({ waitUntil: vi.fn(), passThroughOnException: vi.fn() });

describe('scheduled handler', () => {
	let logOutput: string[];

	beforeEach(() => {
		logOutput = [];
		const capture = (...args: unknown[]) => logOutput.push(String(args[0]));
		console.log = capture as any;
		console.warn = capture as any;
		console.error = capture as any;
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(SAMPLE_IPSUM_RESPONSE, { status: 200 })));
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('runs the full sync with consistent runId across all logs', async () => {
		const worker = await import('../src/index');
		const event = { cron: '0 4 * * *', scheduledTime: Date.now(), noRetry: () => {} };

		await worker.default.scheduled(event as any, makeEnv() as any, makeCtx() as any);

		const parsed = logOutput.flatMap((line) => {
			try { return [JSON.parse(line)]; } catch { return []; }
		});
		const runIds = new Set(parsed.map((p) => p.runId));
		expect(runIds.size).toBe(1);

		for (const entry of parsed) {
			expect(entry.cron).toBe('0 4 * * *');
		}

		const msgs = parsed.map((p) => p.msg);
		expect(msgs).toContain('run_start');
		expect(msgs).toContain('run_complete');

		const complete = parsed.find((p) => p.msg === 'run_complete')!;
		expect(complete.listsUpdated).toBe(8);
		expect(complete.trigger).toBe('cron:0 4 * * *');
	});

	it('emits run_failed on fetch failure and rethrows', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404, statusText: 'Not Found' })));

		const worker = await import('../src/index');
		const event = { cron: '0 4 * * *', scheduledTime: Date.now(), noRetry: () => {} };

		await expect(worker.default.scheduled(event as any, makeEnv() as any, makeCtx() as any)).rejects.toThrow();

		const parsed = logOutput.flatMap((line) => {
			try { return [JSON.parse(line)]; } catch { return []; }
		});
		const errorLog = parsed.find((p) => p.msg === 'run_failed');
		expect(errorLog).toBeDefined();
		expect(errorLog!.level).toBe('error');
		expect(errorLog!.error).toContain('404');
	});

	it('e2e log trail follows correct milestone order', async () => {
		const worker = await import('../src/index');
		const event = { cron: '0 4 * * *', scheduledTime: Date.now(), noRetry: () => {} };

		await worker.default.scheduled(event as any, makeEnv() as any, makeCtx() as any);

		const parsed = logOutput.flatMap((line) => {
			try { return [JSON.parse(line)]; } catch { return []; }
		});
		const msgs = parsed.map((p) => p.msg);

		const milestones = ['run_start', 'ipsum_fetch_start', 'ipsum_fetch_complete', 'ipsum_parsed', 'ensure_lists_start', 'ensure_lists_complete', 'list_sync_complete', 'run_complete'];

		let lastIdx = -1;
		for (const milestone of milestones) {
			const idx = msgs.indexOf(milestone);
			expect(idx, `expected "${milestone}" in log trail`).toBeGreaterThan(lastIdx);
			lastIdx = idx;
		}
	});

	it('stores sync state in KV', async () => {
		const worker = await import('../src/index');
		const event = { cron: '0 4 * * *', scheduledTime: Date.now(), noRetry: () => {} };
		const env = makeEnv();

		await worker.default.scheduled(event as any, env as any, makeCtx() as any);

		expect(env.IPSUM_KV.put).toHaveBeenCalledOnce();
		const storedJson = env.IPSUM_KV.put.mock.calls[0][1];
		const state = JSON.parse(storedJson);
		expect(state.runId).toBeTruthy();
		expect(state.levels).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
		expect(state.skipped).toBe(false);
	});
});

describe('fetch handler', () => {
	let logOutput: string[];

	beforeEach(() => {
		logOutput = [];
		const capture = (...args: unknown[]) => logOutput.push(String(args[0]));
		console.log = capture as any;
		console.warn = capture as any;
		console.error = capture as any;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('GET /trigger returns JSON with sync state', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(SAMPLE_IPSUM_RESPONSE, { status: 200 })));

		const worker = await import('../src/index');
		const req = new Request('https://ipsum.erfi.io/trigger');
		const resp = await worker.default.fetch(req, makeEnv() as any, makeCtx() as any);

		expect(resp.status).toBe(200);
		const body = (await resp.json()) as any;
		expect(body.runId).toBeTruthy();
		expect(body.levels).toHaveLength(8);
	});

	it('GET /trigger returns 500 JSON on failure', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('fail', { status: 500, statusText: 'Error' })));

		const worker = await import('../src/index');
		const req = new Request('https://ipsum.erfi.io/trigger');
		const resp = await worker.default.fetch(req, makeEnv() as any, makeCtx() as any);

		expect(resp.status).toBe(500);
		const body = (await resp.json()) as any;
		expect(body.ok).toBe(false);
		expect(body.error).toContain('500');
	});

	it('GET / returns HTML status page', async () => {
		const worker = await import('../src/index');
		const req = new Request('https://ipsum.erfi.io/');
		const resp = await worker.default.fetch(req, makeEnv() as any, makeCtx() as any);

		expect(resp.status).toBe(200);
		expect(resp.headers.get('content-type')).toContain('text/html');
		const html = await resp.text();
		expect(html).toContain('<!DOCTYPE html>');
		expect(html).toContain('IPsum Cron Worker');
	});

	it('GET /anything also returns status page (no 404)', async () => {
		const worker = await import('../src/index');
		const req = new Request('https://ipsum.erfi.io/some-random-path');
		const resp = await worker.default.fetch(req, makeEnv() as any, makeCtx() as any);

		expect(resp.status).toBe(200);
		const html = await resp.text();
		expect(html).toContain('<!DOCTYPE html>');
	});

	it('GET /trigger logs use "manual" as cron field', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(SAMPLE_IPSUM_RESPONSE, { status: 200 })));

		const worker = await import('../src/index');
		const req = new Request('https://ipsum.erfi.io/trigger');
		await worker.default.fetch(req, makeEnv() as any, makeCtx() as any);

		const parsed = logOutput.flatMap((line) => {
			try { return [JSON.parse(line)]; } catch { return []; }
		});
		for (const entry of parsed) {
			expect(entry.cron).toBe('manual');
		}
		const start = parsed.find((p) => p.msg === 'run_start');
		expect(start?.trigger).toBe('manual');
	});
});
