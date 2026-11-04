# review: friend, round 1

## findings

none

The range changes nothing in `server/core/friend/`. The changes that reach friend are `block-report.remove_user` (now locks `block_report_sequence`, returns `FAILED`), `block-report.add_report` (reads `is_active_user` after that lock), the `FallibleRemoveUser` type of `block-report` in `server/core/auth/deps.ts`, and the raised schema minimums with `server/core/routing/tests/settings-minimum.test.ts`. None of them produces a friend problem:

- Lock order: `server/core/auth/withdraw.ts:16` runs `friend.remove_user` before `block-report.remove_user`, so a withdrawal takes `friend_count` rows, then `block_report_sequence`. `add_report` (`server/core/block-report/index.ts`) takes `block_report_sequence` and then no `friend_count` row, and its core callers (`ReportUser`, `server/core/chat/index.ts:370`) take none after it. A hook `on_friend_changed` that calls `add_report` takes the locks in the same order as the withdrawal. No lock cycle with friend exists in core code
- `withdraw` stops at the first `FAILED` and its callers roll the transaction back, so a `FAILED` of `block-report.remove_user` also undoes what `friend.remove_user` already changed in that transaction. `server/core/auth/tests/withdraw.test.ts` checks that rollback with a held `block_report_sequence` row, but its users have no friend rows, so the friend rows in that rollback come from the transaction rule of `storage` and are not asserted there
- The friend keys in `settings/core-settings.schema.json` did not change. `friend.*` at minimum 0, `nickname.maxLookupCount` and `public-profile.maxRequestCount` at minimum 1 pass the checks of `create_friend`

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- Lock cycle check: `friend_count` then `block_report_sequence` was checked by reading the core callers, not by a test that runs a withdrawal and a report concurrently with friend rows. Content handlers are not covered: a content handler that calls `add_report` and then locks other rows is not something core code shows
- Run: `ogw core test server friend` and `ogw core test server block-report --file server/core/block-report/tests/withdraw.test.ts` passed on SQLite and PostgreSQL. The whole server suite was not run, and the tests of `auth` and `routing` were read, not run
- `server/core/friend/tests/` was not checked by restoring defects in a temporary copy, since no finding needs it
