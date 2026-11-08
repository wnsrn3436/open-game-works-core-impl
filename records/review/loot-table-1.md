# review: loot-table round 1

## findings

none

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range 85f6b36d..86353a81 changes no file under `server/core/loot-table/` and no `core-spec/loot-table.json`, and `## spec changes` is `none`. This review checked only how the range's changes to the modules loot-table depends on could reach it: `storage` (seed provider now takes request ID, user ID and request name; `make_seed`; DB meter wrapped around the adapter; `random_weighted` unchanged), `item-ledger` (`onceKeyRetentionMs` split from `historyRetentionMs`, history changes; `amount_limit`, `read_amount` and `make_item_amount` unchanged), `logging` (metrics; `write` of an `error` log now also counts toward the error log alert, which `logging` `### metrics` defines for every error log), and `testing` (`seed_of` by request ID still matches the new `SeedProvider` signature, as extra arguments are ignored). None of them changes a result that loot-table code or its tests rely on. Code of loot-table that the range did not reach was not reviewed again.
- `ogw core test server loot-table` passed in this worktree (SQLite). PostgreSQL runs of the loot-table tests were not checked.
