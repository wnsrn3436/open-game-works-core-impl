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

- The commit range 85f6b36d..c9ea0440 changes no file under `server/core/public-profile/`. Checked the changes of the range that public-profile calls or that call it: `storage` (`index.ts`, `tx.ts`, `core.ts`: the DB meter, `make_seed`, the seed provider signature, `read_db_metrics`; `register_table`, `run_read_only`, `run_user_transaction`, `db`, `read_db`, `get_user_record(s)`, `find_user_by_public_code` are unchanged in behavior), `logging` (`write` now also feeds the metrics; the `error` entries of public-profile are written as before), `routing` (`pipeline.ts`: step 12 request start and the request prepare that call `on_request_start` and `count_find_attempt` keep their order after the new min version judgement of step 7; `server_process.ts`: several request workers on one DB, where the upserts of `on_request_start` (larger of the two values) and `count_find_attempt` (`ON CONFLICT ... DO UPDATE`) stay correct under concurrent runs; `settings_check.ts`: the public-profile keys are in the schema with the minimums public-profile reads). No change of the range causes or reveals a problem in public-profile
- `ogw core test server public-profile` passed (job mw7xwxuwbedbee, SQLite and PostgreSQL runs). The core tests of the modules that depend on public-profile (`friend`, `block-report`, `guild`, `chat`, `auth`, `routing`) were not run here
- The settings constraint `public-profile.maxRequestCount` × 1 ≤ `nickname.maxLookupCount` is not checked by the server settings check of `create_server`; per `## settings` of the `core` SKILL it is checked by `ogw game check`, which was not run here
