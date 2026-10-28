# Installer drain fixture: separate successful cleanup from negative observation

On f48baad8d full coverage, final-runtime-entry's ready drain case exited99
(the fixture watchdog) instead of0. Both positive and intentionally unresolved
cases used the same700ms observation budget.

Added an actual inert Host stop acknowledgement delayed1000ms to the positive
case. Both entrypoints deterministically failed with the old700ms budget.
The positive case now gets the fixture's existing5000ms default budget, while
pending/failed cases retain700ms. All assertions about native drain ordering,
no forced fallback, exit status, and exact STOPPED_BY_OWNER_IPC evidence remain.
No production deadline or shutdown implementation was changed.

Both entrypoints pass under coverage after correction (2tests, each containing
ready/pending/failed scenarios). Evidence installer-drain-budget-before.log and
installer-drain-budget-after.log. Full current-source qualification pending.
