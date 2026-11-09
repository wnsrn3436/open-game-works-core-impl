# review: public-profile round 1

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

- The commit range 625ae189..0b72b87d changes no file under `server/core/public-profile/`, `server/core/routing/`, `server/core/server-time/` or the non-test code of `server/core/nickname/` and `server/core/auth/`. Checked the changes of the range that public-profile calls: `storage` (`core.ts`, `tx.ts`, `index.ts`: the new `fail_transaction` and the `not_failed` check in `user_state_of` and `any_state_of`; `register_table`, `run_read_only`, `run_user_transaction`, `db`, `read_db`, `get_user_record(s)` and `find_user_by_public_code` are unchanged in behavior for a transaction that `fail_transaction` did not mark). public-profile does not call `fail_transaction`; only `item-ledger` does. When another core module marked the request transaction before a caller runs `get_public_profiles` or `is_active_user`, `run_read_only` and `db` throw a value that is not a `StorageMisuse` and the request is `FAILED`, as `### transaction` of the `storage` spec sets. `logging/metrics.ts` changes only a comment. `session/index.ts` (`end_session`) and the `admin-api.maxSearchRows` minimum are not reached by public-profile. No change of the range causes or reveals a problem in public-profile
- `ogw core test server public-profile` passed (job mw8lvoy09bd244, two runs: SQLite and PostgreSQL). The core tests of the modules that depend on public-profile (`friend`, `block-report`, `guild`, `chat`, `auth`, `routing`) were not run here
- The settings constraint `public-profile.maxRequestCount` × 1 ≤ `nickname.maxLookupCount` is not checked by the server settings check; per `## settings` of the `core` SKILL it is checked by `ogw game check`, which was not run here
