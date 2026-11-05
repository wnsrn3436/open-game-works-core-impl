# review guild round 8

## findings

none

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D7 | fixed | none | Commit 0951512 changed server/core/guild/members.ts:185-186: after the locks, when the re-read member row of the user exists and its guild is not the guild locked in step 1 (`locked_guild` is null when no row was read, so a row added later also differs) or that guild row does not exist, `remove_user` returns `'CHANGED'` before any delete, as guild.md:223 sets; `FAILED` is now returned only for `LOCK_FAILED` from the lock (members.ts:183). The `remove_user` type at server/core/guild/index.ts:82 is `LockFailed \| 'CHANGED' \| null`, and auth `withdraw_in_request` (server/core/auth/account.ts:78) writes the `withdrawal rolled back: a remove_user is CHANGED` `error` log for it and returns `INTERNAL`. Tests: server/core/guild/tests/locks.test.ts:362 (row added after the first read, PostgreSQL), :383 (row moved to another guild, PostgreSQL), :404 (guild row missing, nothing deleted) assert `CHANGED`, and :330 asserts the `Withdraw` is `INTERNAL` with one CHANGED `error` log and unchanged rows; server/core/guild/tests/withdraw.test.ts:168 covers the accept-during-withdraw path on two server instances. `ogw core test server guild --file` of locks.test.ts and withdraw.test.ts passed (SQLite and PostgreSQL) |

## must fix

none

## unknown

- The commit range is empty (92042ba..92042ba), so no change was reviewed for new findings; round 7 had no findings, so `## previous` has no rows.
- The defect of D7 was not restored in a temporary copy, because D7 is a debt item and not a `test evidence` finding. The fix is judged from the code and from the tests above that assert `CHANGED`.
- Only locks.test.ts and withdraw.test.ts of guild were run; the other guild test files and the auth tests were not run in this round.
