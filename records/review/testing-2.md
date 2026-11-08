# review testing round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | server/core/testing/tests/local-server.test.ts:179-191 now runs both cases through the driver in a `local_game` folder where every other start input is valid, and asserts the rule text of the `StartFailure` message. Restored the defect in a `git worktree add --detach` copy of HEAD (deleted lines 133-134 of server/core/testing/dev/local_server.ts) and ran `ogw core test server testing --file server/core/testing/tests/local-server.test.ts`: `testing fail` in both the sqlite and postgresql runs. `with --env DEV ...` failed with `expected 'storage: storage: the secret db-dev h…' to contain 'takes only --env LOCAL, not --env DEV'`, and `with --ops-port ...` failed with `no matching line within 60000 ms` (the driver listened and printed no failure line) |
| R1-2 | fixed | All four items now have tests, and each one failed in both DB runs when its defect was restored in a `git worktree add --detach` copy of HEAD. (1) and (2): in server/core/testing/dev/request.ts:249 the `recorded(...)` wrapper of `send_cheat` was removed, and in server/core/testing/dev/test_server.ts:159 the `admin_operation` lines were recorded only when `this.origin === null`. `ogw core test server testing --file server/core/testing/tests/test-record.test.ts` then failed `records game_error of a send_cheat whose response is a GameError only` and `records admin_operation once more at start_peer_server` (`expected [ { kind: 'admin_operation', …(1) } ] to deeply equal [ …(2) ]`). (3) and (4): in server/core/testing/dev/local_server.ts the `process.on('SIGINT', done)` listener (line 117) was removed and `log_objects(lines)` (line 171) was replaced with `[]`. The local-server test file then failed `... its process ends after SIGINT` (`expected null to be +0`) and `a server start failure (routing.requestWorkers 0 ...)` (`expected [] to have a length of 1 but got +0`) |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Changes in this range outside `server/core/testing/` (routing front link and server process, iap, logging, BootstrapCore) were read only for their effect on testing; their own targets review them
- The whole testing suite was not run on HEAD here. Only `local-server.test.ts` and `test-record.test.ts` were run, on the three copies with restored defects; the core agent report states that `ogw core test server testing` passes on the commit in both DB runs
- With the `--ops-port` defect restored, the test fails only through the 60 s `wait_line` timeout, not through a direct assertion (the core agent report says the same). With the correct code the rule check runs before any listen, so the timeout only decides how long the mutated run takes. I did not check whether it holds on a heavily loaded host
