# scripts/ — what is safe to run

Most of this directory is **archaeology**: one-off scripts that reconstructed
~86,000 hours of pre-Everhour history in July 2026. They have already run. The
only complete account of what each one did is the working log in `CLAUDE.md`,
which is long, so this table is the short answer to "can I run this?".

Read the status column before running anything. Re-running a **done-once**
script is the failure mode to worry about: several of them add hours, and a
second pass can double-count silently.

Every script needs the Node 24 PATH and `.env.local`:

```bash
export PATH="$HOME/.local/node/node-v24.18.0-darwin-arm64/bin:$PATH"
node --env-file=.env.local scripts/<name>.mjs
```

`--env-file` takes the **last** duplicate of a key — a stray placeholder line
appended after a real token silently shadows it and every API call 401s.

## Status

| Script | Status | Notes |
| --- | --- | --- |
| `build-about-stats.mjs` | **repeatable** | Regenerates `src/lib/about-data.json`, the figures behind the About panel (sidebar → version number). Reads Supabase, `git`, and the local Claude Code transcripts; writes only that one JSON. Preview with no flag, write with `--apply`. Re-run whenever the panel looks stale — it is the only way those numbers change. |
| `compare-finance-hours.mjs` | **read-only** | Tracker vs `finance_client_monthly`, per client-year. Run any time. |
| `report-missing-clients.mjs` | **read-only** | → `data/missing-clients.csv`. Clients the plan sheets bill for that the tracker is short on. |
| `report-overages.mjs` | **read-only** | Where the tracker exceeds the finance sheets. |
| `report-rollup-risk.mjs` | **read-only** | Quantifies the open roll-up correctness issue (see below). |
| `audit-rehome.mjs` | **read-only** | Assertion suite over the recovered history. Run after any data change; PASS is the bar. |
| `reconcile-legacy-hours.mjs` | **read-only** | Writes review CSVs only. Owns the entry list that `build-rehome-sql.mjs` consumes verbatim. |
| `build-rehome-sql.mjs` | **generator** | Writes a `.sql` file, touches no DB. The file it generated caused the 620-task incident — read [Bulk SQL](#bulk-sql) before running its output. |
| `fetch-asana-stories.mjs` | **cache fill** | Needs `ASANA_ACCESS_TOKEN`. Resumable, per-task cache under `data/asana/stories/`. Asana rate-limits hard. |
| `fetch-asana-shapes.mjs` | **cache fill** | Same, for parent/subtask shape → `data/asana/parents.json`. |
| `parse-plan-2016.py` | **repeatable** | Raw-XML xlsx parse (no openpyxl here) → `data/finance-2016.json`. Pure file in, file out. |
| `enrich-asana.mjs` | **repeatable** | Only ever fills empty fields, never overwrites. Idempotent. |
| `sync-everhour.mjs` | **repeatable** | Insert-only, idempotent by `everhour_id`. Needs `EVERHOUR_API_KEY`. No longer wired into the app — hand-run only (see [Retired syncs](#retired-syncs)). |
| `import-everhour.mjs` | **done once** | The original bulk import from `data/` snapshots. Re-running is not idempotent. |
| `import-weekly-plan.mjs` | **done once, destructive** | **Clears** free_text/absence for the days it covers before inserting. A bad enum value throws *after* the delete and wipes those days. |
| `import-plan-sheet.mjs` | **done once** | Skips entries that already exist, so safer than the above, but it was written for one specific sheet. |
| `apply-legacy-hours.mjs` | **done once** | Applied 7,948.65h. `--apply` to write, dry-run by default. Re-running double-counts. |
| `recover-title-hours.mjs` | **done once** | +14,668h from task titles. Guarded to tasks with zero time entries, so a re-run plans ~nothing — but don't rely on that. |
| `spread-legacy-remainder.mjs` | **done once** | Dated 3,758.75h of undated remainder. Re-running would re-spread. |
| `backfill-from-finance.mjs` | **done once** | +18,509h from the billing record. Top-up not replace (`max(0, finance − already)` per client-year), so a re-run now plans 0.02h. |
| `create-former-staff.mjs` | **done once** | Created 24 accountless profiles and relinked their entries/comments. |
| `merge-renamed-clients.mjs` | **done once** | Double → Donsplus. |
| `merge-finance-client-names.mjs` | **⚠️ PENDING** | The Ravin monthly rename never ran — the classifier blocked the write. Re-run with `--apply`. Its `client_rates` rows *were* renamed. |
| `import-finance-2016.mjs` | **done once** | 2016 was absent from the finance DB entirely. Insert-only against locked finance tables. |
| `restore-unsorted.mjs` | **break-glass** | Rebuilt 627 tasks from the committed `data/` dumps after the incident. Inserts/upserts only, dry-run by default. Harmless to run, meaningless unless data was lost. |

`lib/` holds the shared pieces: `legacy-hours.mjs` (the title/comment parser,
46 tests — `node --test scripts/lib/legacy-hours.test.mjs`), `client-names.mjs`
(alias resolution — extracted because it had been copy-pasted into four scripts
and an alias added to one silently didn't apply in the others), `csv.mjs`,
`asana-users.mjs`.

## Bulk SQL

`data/*.sql` are **not** migrations and must never be numbered like them. They
are hand-run scripts for the Supabase SQL editor.

**Do not assume the SQL editor runs a pasted multi-statement script as one
transaction.** On 2026-07-28 a 2,326-statement file wrapped in `begin; …
commit;` had its `update tasks` statements fail to take effect while a
`delete from clients` at the end ran anyway — cascading away 620 tasks, 2,397
comments and 2,103h of time entries. A `raise exception` guard sat immediately
before that delete and did not fire.

So: never put a cascading DELETE in the same file as the UPDATEs it depends on.

For an admin-only bulk write, prefer `set_config` over disabling the trigger —
0011's and 0021's triggers call `is_admin()`, which reads `auth.uid()`, and a
service-key or SQL-editor connection has none:

```sql
select set_config('request.jwt.claims', '{"sub":"<admin uuid>"}', true);
```

Still pending: `data/merge-clients-inreach-quadream.sql` (6 task moves —
`tasks.client_id` is trigger-protected).

## Retired syncs

Every live sync was removed on 2026-07-29. There is no `vercel.json`, no cron,
and `EVERHOUR_API_KEY` / `WEEKLY_PLAN_CSV_URL` / `CRON_SECRET` are gone from
Vercel. The importers here survive deliberately — nothing can fire them on a
schedule, and the Everhour key still works locally for a historical pull.

## Open issue

The roll-up rule ("a parent task's title figure is the sum of its subtasks —
children win, parent contributes 0") was only ever applied to the 23 legacy
projects, because it reads `data/asana/parents.json` and only those tasks were
fetched. `report-rollup-risk.mjs` puts **14,896h of 23,792h asana-recovered
hours (63%)** on tasks whose subtask shape was never fetched — an upper bound,
not an error estimate.

Fix, needs `ASANA_ACCESS_TOKEN`: run `fetch-asana-stories.mjs` over the 965 gids
in `data/rollup-refetch-gids.csv`, then re-run the reconciler.
