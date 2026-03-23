/**
 * Structured logger that attaches a runId to every log line,
 * enabling end-to-end tracing of a single cron invocation.
 */

export interface LogContext {
	runId: string;
	cron: string;
}

interface LogPayload {
	level: 'info' | 'warn' | 'error';
	msg: string;
	runId: string;
	cron: string;
	[key: string]: unknown;
}

const emit = (payload: LogPayload): void => {
	const fn = payload.level === 'error' ? console.error : payload.level === 'warn' ? console.warn : console.log;
	fn(JSON.stringify(payload));
};

export const createLogger = (ctx: LogContext) => ({
	ctx,
	info: (msg: string, extra?: Record<string, unknown>) => emit({ level: 'info', msg, ...ctx, ...extra }),
	warn: (msg: string, extra?: Record<string, unknown>) => emit({ level: 'warn', msg, ...ctx, ...extra }),
	error: (msg: string, extra?: Record<string, unknown>) => emit({ level: 'error', msg, ...ctx, ...extra }),
});

export type Logger = ReturnType<typeof createLogger>;
