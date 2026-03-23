/** IPsum threat intelligence feed constants. */

/** GitHub raw URL for the main ipsum.txt file (tab-separated: IP \t score). */
export const IPSUM_URL = 'https://raw.githubusercontent.com/stamparm/ipsum/master/ipsum.txt';

/** Threat levels range from 1 (lowest confidence) to 8 (highest confidence). */
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 8;
export const ALL_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/** Cloudflare list name prefix. Lists are named ipsum_level_1 ... ipsum_level_8. */
export const LIST_NAME_PREFIX = 'ipsum_level_';

/** Build the CF list name for a given threat level. */
export const listNameForLevel = (level: number): string => `${LIST_NAME_PREFIX}${level}`;

/** Description applied to each list on creation. */
export const listDescriptionForLevel = (level: number): string =>
	`IPsum threat IPs appearing on ${level}+ blacklists (https://github.com/stamparm/ipsum)`;

/** Delay (ms) between polling a bulk operation status. */
export const BULK_OP_POLL_INTERVAL_MS = 2_000;

/** Maximum number of polls before giving up on a bulk operation. */
export const BULK_OP_MAX_POLLS = 60;

/** KV key for the last sync result. */
export const KV_LAST_SYNC = 'last_sync';

/** KV key for the ETag of the last fetched ipsum.txt. */
export const KV_ETAG = 'ipsum_etag';

/**
 * Parse the IPSUM_LEVELS env var into an array of level numbers.
 * Accepts comma-separated integers, e.g. "3,4,5,6,7,8".
 * Returns ALL_LEVELS if the env var is unset or empty.
 */
export const parseLevels = (raw?: string): number[] => {
	if (!raw || !raw.trim()) return [...ALL_LEVELS];

	const parsed = raw
		.split(',')
		.map((s) => parseInt(s.trim(), 10))
		.filter((n) => !isNaN(n) && n >= MIN_LEVEL && n <= MAX_LEVEL);

	if (parsed.length === 0) return [...ALL_LEVELS];

	return [...new Set(parsed)].sort((a, b) => a - b);
};
