/** Fetch and parse the IPsum threat intelligence feed. */

import { IPSUM_URL, KV_ETAG, MAX_LEVEL, MIN_LEVEL } from './consts';
import type { Logger } from './log';

/** Map from threat level (1-8) to array of IP strings at *exactly* that level. */
export type IpsumByLevel = Map<number, string[]>;

/**
 * Precomputed cumulative arrays: level N contains IPs at score N or higher.
 * Built once from the by-level map, avoids repeated re-computation.
 */
export interface IpsumData {
	/** IPs bucketed by exact score (1-8). */
	byLevel: IpsumByLevel;
	/** Cumulative: level N -> IPs at score >= N. Built once, read many. */
	cumulative: Map<number, string[]>;
	/** Total unique IPs across all levels. */
	totalIps: number;
}

// IPv4: 4 dotted decimal octets (0-255)
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)$/;

// IPv6: simplified -- 8 groups of 1-4 hex digits separated by colons, or containing ::
const IPV6_RE = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,7}:$|^(?:[0-9a-fA-F]{1,4}:)*:[0-9a-fA-F:]+$/;

const isValidIp = (s: string): boolean => IPV4_RE.test(s) || IPV6_RE.test(s);

/**
 * Parse raw ipsum.txt content into IPs bucketed by their exact score,
 * then precompute cumulative arrays.
 *
 * Uses regex + parseInt instead of Zod for performance (~200k lines).
 */
export const parseIpsum = (text: string): IpsumData => {
	const byLevel: IpsumByLevel = new Map();
	for (let level = MIN_LEVEL; level <= MAX_LEVEL; level++) {
		byLevel.set(level, []);
	}

	let totalIps = 0;

	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		const tabIdx = trimmed.indexOf('\t');
		if (tabIdx === -1) continue;

		const rawIp = trimmed.slice(0, tabIdx);
		const rawScore = trimmed.slice(tabIdx + 1);
		if (!/^\d+$/.test(rawScore)) continue;
		const score = parseInt(rawScore, 10);

		if (score < MIN_LEVEL || score > MAX_LEVEL) continue;
		if (!isValidIp(rawIp)) continue;

		byLevel.get(score)!.push(rawIp);
		totalIps++;
	}

	// Build cumulative arrays from highest to lowest to avoid repeated concatenation.
	const cumulative = new Map<number, string[]>();
	let acc: string[] = [];
	for (let l = MAX_LEVEL; l >= MIN_LEVEL; l--) {
		const bucket = byLevel.get(l)!;
		acc = bucket.concat(acc);
		cumulative.set(l, acc);
	}

	return { byLevel, cumulative, totalIps };
};

/** Result of fetchIpsum -- includes the data and whether it was skipped due to ETag match. */
export interface FetchResult {
	data: IpsumData | null;
	skipped: boolean;
}

/**
 * Fetches ipsum.txt from GitHub. Uses ETag from KV to skip download if unchanged.
 * Returns null data + skipped=true if the feed hasn't changed.
 */
export const fetchIpsum = async (log: Logger, kv?: KVNamespace): Promise<FetchResult> => {
	log.info('ipsum_fetch_start', { url: IPSUM_URL });

	const headers: Record<string, string> = {};
	const cachedEtag = kv ? await kv.get(KV_ETAG) : null;
	if (cachedEtag) {
		headers['If-None-Match'] = cachedEtag;
		log.info('ipsum_etag_check', { etag: cachedEtag });
	}

	const resp = await fetch(IPSUM_URL, { headers });

	if (resp.status === 304) {
		log.info('ipsum_not_modified', { etag: cachedEtag });
		return { data: null, skipped: true };
	}

	if (!resp.ok) {
		throw new Error(`Failed to fetch ipsum.txt: ${resp.status} ${resp.statusText}`);
	}

	// Store the new ETag for next time
	const newEtag = resp.headers.get('ETag');
	if (kv && newEtag) {
		await kv.put(KV_ETAG, newEtag);
		log.info('ipsum_etag_saved', { etag: newEtag });
	}

	const text = await resp.text();
	const data = parseIpsum(text);

	const breakdown = Object.fromEntries(Array.from(data.byLevel.entries()).map(([level, ips]) => [`level_${level}`, ips.length]));
	log.info('ipsum_fetch_complete', { totalIps: data.totalIps, ...breakdown });

	return { data, skipped: false };
};
