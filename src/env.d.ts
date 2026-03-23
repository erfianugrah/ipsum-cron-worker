/** Augment the auto-generated Env with secrets set via `wrangler secret put`. */
interface Env {
	CF_API_TOKEN: string;
	CF_ACCOUNT_ID: string;
	/** Optional: comma-separated levels to sync, e.g. "3,4,5,6,7,8". Defaults to all (1-8). */
	IPSUM_LEVELS?: string;
}
