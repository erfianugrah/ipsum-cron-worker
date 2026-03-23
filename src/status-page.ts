/** Generates an HTML status page showing list info from the Cloudflare account. */

import type { CfClient } from './cf-api';
import { ALL_LEVELS, listNameForLevel } from './consts';
import type { SyncState } from './index';

interface ListInfo {
	level: number;
	name: string;
	id: string;
	numItems: number;
	modifiedOn: string;
}

/** Fetch current state of all ipsum lists from the CF API. */
export const fetchListStatus = async (client: CfClient): Promise<ListInfo[]> => {
	const allLists = await client.getLists();
	const ipListNames = new Set(ALL_LEVELS.map(listNameForLevel));
	const lists: ListInfo[] = [];

	for (const list of allLists) {
		if (ipListNames.has(list.name)) {
			const level = parseInt(list.name.replace('ipsum_level_', ''), 10);
			lists.push({
				level,
				name: list.name,
				id: list.id,
				numItems: list.num_items,
				modifiedOn: list.modified_on,
			});
		}
	}

	lists.sort((a, b) => a.level - b.level);
	return lists;
};

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const renderStatusPage = (lists: ListInfo[], lastSync?: SyncState | null): string => {
	const totalIps = lists.reduce((sum, l) => sum + l.numItems, 0);
	const lastUpdated = lists.length > 0 ? lists.reduce((latest, l) => (l.modifiedOn > latest ? l.modifiedOn : latest), '') : 'never';

	const rows = lists
		.map(
			(l) => `
			<tr>
				<td>${l.level}</td>
				<td><code>${escapeHtml(l.name)}</code></td>
				<td class="num">${l.numItems.toLocaleString('en-US')}</td>
				<td><code>${escapeHtml(l.id)}</code></td>
				<td>${new Date(l.modifiedOn).toUTCString()}</td>
			</tr>`,
		)
		.join('');

	const missingLevels = ALL_LEVELS.filter((l) => !lists.find((li) => li.level === l));
	const missingRows = missingLevels
		.map(
			(l) => `
			<tr class="missing">
				<td>${l}</td>
				<td><code>${listNameForLevel(l)}</code></td>
				<td class="num">--</td>
				<td>not created</td>
				<td>--</td>
			</tr>`,
		)
		.join('');

	const lastSyncHtml = lastSync
		? `<div class="stat-card">
			<div class="label">Last Run</div>
			<div class="value" style="font-size:0.95rem">${escapeHtml(lastSync.trigger)}</div>
		</div>
		<div class="stat-card">
			<div class="label">Run ID</div>
			<div class="value" style="font-size:0.75rem"><code>${escapeHtml(lastSync.runId)}</code></div>
		</div>
		<div class="stat-card">
			<div class="label">Duration</div>
			<div class="value">${(lastSync.durationMs / 1000).toFixed(1)}s</div>
		</div>
		<div class="stat-card">
			<div class="label">Errors</div>
			<div class="value" style="color:${lastSync.errors > 0 ? '#f85149' : '#3fb950'}">${lastSync.errors}</div>
		</div>
		${lastSync.skipped ? '<div class="stat-card"><div class="label">Status</div><div class="value" style="color:#d29922">Skipped (unchanged)</div></div>' : ''}`
		: '';

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>IPsum Cron Worker</title>
<style>
	* { margin: 0; padding: 0; box-sizing: border-box; }
	body {
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
		background: #0f1117; color: #e1e4e8; padding: 2rem; line-height: 1.6;
	}
	.container { max-width: 960px; margin: 0 auto; }
	h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.25rem; color: #f0f6fc; }
	h2 { font-size: 1.1rem; font-weight: 600; margin: 1.5rem 0 0.75rem; color: #f0f6fc; }
	.subtitle { color: #8b949e; margin-bottom: 1.5rem; font-size: 0.9rem; }
	.subtitle a { color: #58a6ff; text-decoration: none; }
	.subtitle a:hover { text-decoration: underline; }
	.stats {
		display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 0.75rem; margin-bottom: 1.5rem;
	}
	.stat-card {
		background: #161b22; border: 1px solid #30363d; border-radius: 8px;
		padding: 0.75rem 1rem;
	}
	.stat-card .label { color: #8b949e; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
	.stat-card .value { font-size: 1.25rem; font-weight: 600; color: #f0f6fc; margin-top: 0.15rem; }
	table {
		width: 100%; border-collapse: collapse; background: #161b22;
		border: 1px solid #30363d; border-radius: 8px; overflow: hidden;
	}
	th {
		text-align: left; padding: 0.75rem 1rem; background: #1c2128;
		border-bottom: 1px solid #30363d; color: #8b949e; font-size: 0.8rem;
		text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;
	}
	td { padding: 0.6rem 1rem; border-bottom: 1px solid #21262d; font-size: 0.9rem; }
	tr:last-child td { border-bottom: none; }
	tr:hover { background: #1c2128; }
	td.num { font-variant-numeric: tabular-nums; text-align: right; font-weight: 500; }
	code { font-family: "SF Mono", "Fira Code", "Fira Mono", Menlo, monospace; font-size: 0.85em; color: #79c0ff; }
	.missing td { color: #6e7681; }
	.actions { margin-top: 1.5rem; }
	.btn {
		display: inline-block; padding: 0.5rem 1rem; background: #238636; color: #fff;
		border: 1px solid #2ea043; border-radius: 6px; text-decoration: none;
		font-size: 0.85rem; font-weight: 500; cursor: pointer; transition: background 0.15s;
	}
	.btn:hover { background: #2ea043; }
	.footer { margin-top: 2rem; color: #484f58; font-size: 0.8rem; }
	.footer a { color: #58a6ff; text-decoration: none; }
</style>
</head>
<body>
<div class="container">
	<h1>IPsum Cron Worker</h1>
	<p class="subtitle">
		Syncs <a href="https://github.com/stamparm/ipsum">stamparm/ipsum</a> threat IPs
		into Cloudflare IP Lists &mdash; daily at 04:00 UTC
	</p>

	<div class="stats">
		<div class="stat-card">
			<div class="label">Lists</div>
			<div class="value">${lists.length} / ${ALL_LEVELS.length}</div>
		</div>
		<div class="stat-card">
			<div class="label">Total IPs</div>
			<div class="value">${totalIps.toLocaleString('en-US')}</div>
		</div>
		<div class="stat-card">
			<div class="label">Last Updated</div>
			<div class="value" style="font-size:0.95rem">${lastUpdated !== 'never' ? new Date(lastUpdated).toUTCString() : 'Never'}</div>
		</div>
		${lastSyncHtml}
	</div>

	<h2>IP Lists</h2>
	<table>
		<thead>
			<tr>
				<th>Level</th>
				<th>List Name</th>
				<th style="text-align:right">IPs</th>
				<th>List ID</th>
				<th>Modified</th>
			</tr>
		</thead>
		<tbody>
			${rows}${missingRows}
		</tbody>
	</table>

	<div class="actions">
		<a class="btn" href="/trigger">Trigger Manual Sync</a>
	</div>

	<p class="footer">
		Source: <a href="https://github.com/stamparm/ipsum">github.com/stamparm/ipsum</a>
		&bull; IPs at level N appear on N+ blacklists
	</p>
</div>
</body>
</html>`;
};
