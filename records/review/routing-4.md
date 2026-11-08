# review routing round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | Commit df714383 adds `OGW_TEST_MODE` `flood` to the process test content (`server/core/routing/tests/process_support.ts:29-41`: the route `GET /account/deletion` takes over an upgrade, writes `OGW_TEST_FLOOD_BYTES` bytes with `end(data, () => destroy())`, then writes the probe line `flood`) and the test `server/core/routing/tests/server-process.test.ts:316`, whose client (`paused_upgrade`, `:124`) reads nothing until the probe line was seen and `ogw_requests_in_progress` is 0, then expects all 32 MiB and the end. Restored in a temporary worktree (`git worktree add --detach` of HEAD, removed afterwards): the `sclose` branch of `server/core/routing/server_process.ts:487-492` replaced with plain `socket.destroy()` as before round 3, then `ogw core test server routing --file server-process.test.ts`: that test failed on SQLite and PostgreSQL with `expected { bytes: 327212, ended: true } to deeply equal { bytes: 33554432, ended: true }`, and no other test of the file failed. On the unchanged checkout the same command passes on both |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The routing changes of the range are commit df714383 (tests only) and the `matchmaker` row added to `MODULE_ADMIN_OPERATIONS` in `server/core/routing/spec_tables.ts:105` by commit 412ae0e9. That row was compared with `admin-api.md` (`matchmaker`: `list_match_flags`, `get_match`) and with the members the `matchmaker` module object exports (`server/core/matchmaker/index.ts:152-153`); its collection through `admin-api` is reached by the `matchmaker` tests that call `list_match_flags` with `send_admin` (`server/core/matchmaker/tests/forfeit.test.ts:172`). Those `matchmaker` tests were not run in this review; the rest of commit 412ae0e9 is outside the `routing` target and was not reviewed
- The whole routing test suite was not run. Only `--file server-process.test.ts` was run, once with the defect restored and once on the unchanged checkout
- The one-time failure that the round 3 fix report wrote in `## unverified` (the driver process of the `--matchmaker` realtime worker test ended by a signal on PostgreSQL) did not happen in the two runs of this review; its cause was not reproduced or checked
