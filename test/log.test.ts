import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/log';

describe('createLogger', () => {
	const ctx = { runId: 'test-run-123', cron: '0 4 * * *' };
	let logSpy: ReturnType<typeof vi.fn>;
	let warnSpy: ReturnType<typeof vi.fn>;
	let errorSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		logSpy = vi.fn();
		warnSpy = vi.fn();
		errorSpy = vi.fn();
		// Replace console methods directly (Workers runtime doesn't support vi.spyOn on console)
		console.log = logSpy as any;
		console.warn = warnSpy as any;
		console.error = errorSpy as any;
	});

	it('emits valid JSON with runId and cron on every info log', () => {
		const log = createLogger(ctx);
		log.info('test_event', { foo: 'bar' });

		expect(logSpy).toHaveBeenCalledOnce();
		const payload = JSON.parse(logSpy.mock.calls[0][0]);
		expect(payload).toMatchObject({
			level: 'info',
			msg: 'test_event',
			runId: 'test-run-123',
			cron: '0 4 * * *',
			foo: 'bar',
		});
	});

	it('emits warn logs via console.warn', () => {
		const log = createLogger(ctx);
		log.warn('something_off', { detail: 42 });

		expect(warnSpy).toHaveBeenCalledOnce();
		const payload = JSON.parse(warnSpy.mock.calls[0][0]);
		expect(payload.level).toBe('warn');
		expect(payload.msg).toBe('something_off');
		expect(payload.runId).toBe('test-run-123');
	});

	it('emits error logs via console.error', () => {
		const log = createLogger(ctx);
		log.error('bad_thing', { error: 'boom' });

		expect(errorSpy).toHaveBeenCalledOnce();
		const payload = JSON.parse(errorSpy.mock.calls[0][0]);
		expect(payload.level).toBe('error');
		expect(payload.msg).toBe('bad_thing');
		expect(payload.error).toBe('boom');
	});

	it('all log levels include runId for correlation', () => {
		const log = createLogger(ctx);
		log.info('a');
		log.warn('b');
		log.error('c');

		for (const spy of [logSpy, warnSpy, errorSpy]) {
			const payload = JSON.parse(spy.mock.calls[0][0]);
			expect(payload.runId).toBe('test-run-123');
			expect(payload.cron).toBe('0 4 * * *');
		}
	});
});
