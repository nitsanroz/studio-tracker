# supabase/finance-reference — finance's schema history

**Every file here has ALREADY RUN on the live database. Never re-run one, and
never renumber one into `supabase/migrations/`.**

These are the SQL files finance-admin kept in its `reference/` folder while it
was a separate app (2026-07-13 → the merge of November 2026). That app had no
migrations folder: each change was written as a numbered file and run by hand in
the Supabase SQL editor. Their numbers (0007–0023) collide with the tracker's
own migrations of the same numbers, which are different changes — hence the
`finance-` prefix and this separate folder.

They are kept as the record of how the finance tables got their shape. They are
**not** the record of their policies: several were tightened by hand afterwards.
The policies as they actually are live in `migrations/0069_finance_policies.sql`,
written down from the live database on 2026-11-14.

New finance changes are ordinary tracker migrations, numbered from 0068 on.

| File | What it did |
| --- | --- |
| `finance-0007_finance_undo_log.sql` | `finance_undo_log` |
| `finance-0008_finance_payslips.sql` | `finance_payslips` (figures read from the Michpal PDFs; the tracker's vacation feature reads its vacation lines) |
| `finance-0009_person_factors.sql` | `finance_person_factors`; `finance_payslips.sick_used` |
| `finance-0010_finance_advice.sql` | `finance_advice_items`, `finance_advice_runs`, `is_finance_owner()` — the ONE &advice store since the merge |
| `finance-0011_finance_paid.sql` | `paid_at` on salaries and freelance |
| `finance-0012_finance_client_paid.sql` | `paid_at` on client months and income — the Plan's word on "the client paid" |
| `finance-0013_finance_invoiced_not_hourly.sql` | `invoiced_at`; `finance_not_hourly` |
| `finance-0014_finance_rls_check.sql` | A read-only policy check. Superseded by `supabase/checks/check-finance-access.sql` |
| `finance-0015_finance_mail.sql` | `finance_mail_accounts`, `finance_tool_mail` |
| `finance-0016_finance_mail_receipts.sql` | `finance_mail_receipts`, `finance_mail_ignored` |
| `finance-0017_finance_tracker_ignored.sql` | `finance_tracker_ignored` |
| `finance-0018_finance_expense_details.sql` | Extra columns on `finance_expenses` |
| `finance-0019_finance_documents.sql` | `finance_documents` and the `finance-docs` storage bucket |
| `finance-0020_finance_receipt_item.sql`, `finance-0021_finance_receipt_link.sql` | Receipt columns |
| `finance-0022_finance_mail_expenses_access.sql` | Lets an admin without full finance read and decide mail receipts (the Expenses page) |
| `finance-0023_finance_scenarios.sql` | `finance_scenarios`, `finance_scenario_settings`, `finance_scenario_advice` — owner only |

Not copied: finance-admin's `0005_finance.sql` / `0006_finance_seed.sql` (the
tracker's own migrations 0005/0006 are the same change), and the old tracker
code that sat beside them.
