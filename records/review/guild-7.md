# review guild round 7

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R6-1 | fixed | server/core/guild/rpc.ts:186 now returns the empty response without running `guilds_with_prefix` when the normalized `name` holds U+0000, so the statement that storage rejects (server/core/storage/db/sqlite.ts:49) is never run; that is the result guild.md `### query` gives, since no saved `normalized_name` can hold U+0000. New test server/core/guild/tests/query.test.ts:166 sends `a` U+0000, U+0000 and `al` U+0000 `pha` with guild `Alpha` saved and asserts code 0, an empty `guilds` list and no `error` log. Defect restored in a temporary copy outside the checkout (the rpc.ts:186 condition put back to `prefix === ''` only) and the test run with vitest on SQLite: it failed at query.test.ts:174 with `"a\u0000": expected 8 to be +0` (`INTERNAL`). With the fix in the copy, all 14 tests of query.test.ts passed on SQLite |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The restored-defect run and the passing run were made only on SQLite; the PostgreSQL run of query.test.ts was not made in this round. The core agent report says the new test failed on both DBs before the fix.
- Only query.test.ts was run; the rest of the guild test suite and the suites of dependent modules were not run in this round.
- The other changes of the range (auth withdraw tests and peer, storage abort test, client modules and review records) are outside the guild target. They were read only where they reach guild (the auth `Withdraw` test that holds the `guild_guild` row lock through `guild.remove_user`, which this range changes only in its helper signature) and give no guild finding.
