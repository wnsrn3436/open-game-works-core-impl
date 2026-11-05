# review session round 1

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

- `server/core/session/` (code and tests) has no change in the commit range 51d323b..5c1f425 (last change baad073 is before it). The review read the whole session code and tests, and the range's changes of the code that session calls: `server/core/storage/` (`tx.ts` body/`run_savepoint`/`lock_row` on a broken transaction, `core.ts` `mark_broken`/`in_id_list`, `db/sqlite.ts` U+0000 string parameter, `db/postgres.ts` and `db/pg_worker.ts` `statement_timeout` and the read connection retry, `state.ts` `get_states`, `rows.ts` `get_user_records`, `user_change.ts`). `server-time` has no change in the range. None of them changes the result of `register_table`, `db`, `read_db`, `read_full_state` or `user_now` as session calls them: session passes only `user_id` (bigint) and its own base64url values as SQL parameters, compares the session ID in code, and lets a failed `read_db` statement throw to its caller as `storage` `## behavior` sets
- The routing, auth and user-snapshot-clone changes of the range were checked only for their calls of `start_session`, `end_session`, `check_current`, `verify_signature`, `sign_request` and `Resync`; none of those calls changed
- `ogw core test server session` (job mw3nb7yi010de1) passed for both runs. The whole server test suite was not run
- The behavior of session on a PostgreSQL read connection that PostgreSQL ends (the new retry of `pg_worker.ts` `query`) has no session test; it is a storage behavior and storage's tests were not reviewed here
