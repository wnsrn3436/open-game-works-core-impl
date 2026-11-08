# update core: routing

Commits on `agent/mw7vh51vdcf5f8`:
- `6ac30088`: cherry-pick of `35c4385b` from `agent/mw7tlg94f2d321`. It applied with no conflict on main `47e03f23`, which already had the ads-reward test fix, the BootstrapCore change and the logging cheat label change.
- `55d5be70`: the spec changes since harness `f3d27fc`.

## done

- `routing`: the server process, the ops port, the settings check at `create_server` and `min_version` in step 7 (`6ac30088`). What it does is in the previous report, `records/1794141617800-update-core-mw7tlg94f2d321.md` on `agent/mw7tlg94f2d321`.
- I checked each spec change since `f3d27fc` against the code, and fixed it or added tests (`55d5be70`):
  - **Settings check, keywords it does not check.** `settings_check.ts` checks only `type`, `minimum`, `maximum`, `exclusiveMinimum`, `items`, `minItems`, `required` and unknown keys, which matches the spec. No code change.
    - Test added in `routing/tests/settings-check.test.ts`: `enum`, `maxItems`, `uniqueItems`, `contains` and nested `properties`/`required`/`additionalProperties` are not checked.
  - **Front settings check before workers start.** `ServerProcess.run` → `read_settings` (`routing/server_process.ts`) runs `run_settings_check` on `server/generated/core_settings.json` before it listens or starts any worker. On failure it writes one `error` line and returns the reason. This matches the spec. No code change.
    - Test added in `server-process.test.ts`: `routing.requestWorkers` 0 and `routing.readyMaxReportAgeMs` `"soon"`.
      - Through `core/start.ts`: exit code 1, exactly one log line (the error, with both keys and keywords), no worker probe line, and `--port` is not accepting.
      - Through `run_server_process`: returns the same reason.
  - **Upgraded connection counted as in progress until it closes.** `hand_upgrade` adds 1 to `in_progress`. It subtracts it only on socket `close`, on the worker's `sclose`, or when the worker answers without taking the connection over. A half-close (`send`) does not subtract it. This matches the spec. No code change. No test: see `## unverified`.
  - **Samples with the same label text, ordered by sample name.** `metrics_text` already sorts by label text, then by name.
    - Unit test added in `server-process.test.ts` (`describe('metrics_text')`). It checks sums across two reports, families in byte order of name, and inside a histogram `_count`, `_sum`, `{le="+Inf"}`, `{le="10"}`.
  - **SQLite WAL journal mode at open.** Already done in the cherry-pick (`storage/db/sqlite.ts`): it retries synchronously up to `storage.schemaLockWaitMs`. No change.
  - **`start_test_server` gives a settings check failure as `StartFailure`.** Already done in the cherry-pick (`testing/dev/test_server.ts`).
    - Test added in `testing/tests/isolation.test.ts`: `start_test_server` with `routing.requestWorkers` 0 throws `StartFailure`. Its message holds `routing.requestWorkers (minimum)`, and `logs` holds one such error line.
  - **`ServerError.detail` is `step <n> <step name>: <reason>`.** Changed in `routing/pipeline.ts` and `routing/dev/index.ts`:
    - step 11: `step 11 field validation: <field path>: <rule>` (the colon is added)
    - step 4: `step 4 maintenance` → `step 4 maintenance: admin-api.is_maintenance is true`
    - step 5: `step 5 <check>: <code>` and `step 5: …` → `step 5 authentication: …`
    - step 6: `step 6 ban` → `step 6 ban: admin-api.is_banned is true`
    - step 7: `step 7 data version: …` and `step 7 app version: …` → `step 7 app version and data version: …`
    - step 9: `step 9 kill switch` → `step 9 kill switch: admin-api.is_kill_switched is true`
    - step 13: `step 13: …` → `step 13 transaction start: …`
    - step 14: `step 14: …` → `step 14 idempotency: …`
    - step 15: `step 15: …` and `step 15 handler: …` → `step 15 handler run: …`
    - Steps 2, 3, 8 and 10 already had the form.
    - Tests: `ads-reward/tests/claim.test.ts` and `fake-callback.test.ts` now take only `^step 11 field validation: (.*\.)?notify_id: nul$`, so the old form without the colon fails. `routing/tests/processing-order.test.ts` checks the `step <n> <step name>: <reason>` prefix for steps 2, 3, 4, 5, 6, 7, 9, 10 and 11, the exact step 11 detail (`step 11 field validation: full: routing_test`), and `^step 14 idempotency: ` for step 14.
- `routing/tests/process_support.ts`: when `wait_line` finds no line, the error now gives the time waited, whether the child ended and its exit code, and the last 4000 characters of the child's stderr. stderr used to be thrown away (see the routing failure in `## unverified`).
- Last runs:
  - `ogw core test server` (all server modules, on SQLite and PostgreSQL) on commit `55d5be70`: every module passes, `ads-reward` included.
  - `ogw code check core`: type check, lint, dependency and secret pass.
- No engine-specific implementation rules document was written. `## <engine> build` of `tools/ogw.md` was not written.

## spec proposals

- routing `## DEV`, `ServerError.detail`: some failures are not a numbered step. Their details are not in the `step <n> <step name>: <reason>` form, and I left them as they were:
  - the IP counter of `NoAccessTokenRpc` / `NoUserRpc`: `rate limit: …`
  - request prepare, between steps 12 and 13: `request prepare: …`
  - the token-less core `rpc` handler, which runs in place of steps 5–9 and 12–16: `handler: …`
  - an unhandled exception: `unhandled exception`
  - the cheat path: `dev access: …` and `unknown cheat <name>`

  Proposal: give each of these a form in the spec, e.g. `rate limit: <reason>`, `request prepare: <reason>`, `handler run: <reason>`.
- `server-core` SKILL `## module` (carried over from the previous report): `matchmaker`, `friend`, `public-profile`, `ranking`, `play-session`, `rating`, `item-ledger`, `server-time`, `chat`, `auth`, `mailbox`, `idempotency`, `user-snapshot-clone`, `remote-config`, `coupon`, `storage`, `notice` and `p2p-signaling` still check their own settings values, which the settings check now covers. Proposal: a follow-up job per module to remove those checks.

## review

none

## unverified

- **One routing failure did not come back, and its cause is not known.** My first `ogw core test server routing`, before `55d5be70`, failed one test on SQLite: `server-process.test.ts` "with --matchmaker has a realtime worker …". The error was `no matching line; the lines: []` from `wait_line`. One of the two `run_process` driver children wrote no JSON line to stdout: it either ended or ran past 60 s, and its stderr was thrown away.
  - The test file alone passed, and the next full routing run passed. The final full `ogw core test server` passed too, routing included.
  - I could not reproduce it, so I did not change any time value. Instead, `wait_line` now reports the elapsed time, whether the child ended, its exit code and its stderr tail, so the cause shows if it happens again.
  - What I suspect, without evidence: start time under load, while the other routing test files and the SQLite and PostgreSQL runs go on together.
- **The upgrade counting has no test.** No core module exports a WebSocket route that request workers take over. `GET /realtime` goes to the realtime worker with `--matchmaker`, and request workers answer it with 404. So "an upgraded connection on a request worker is in progress until it closes" cannot be observed from outside the process. `choose` and `in_progress` are private to the front. I checked this behavior by reading `hand_upgrade`, `done` and `from_worker` only.
- **Carried over from the previous report:**
  - I did not confirm from the run output that the PostgreSQL-only process tests (`describe.skipIf(OGW_POSTGRESQL === null)`) ran.
  - The SIGTERM test does not observe each instance's `stop()` directly.
  - The DB wait state probe in `front-link.test.ts` and the SQLite open race test in `storage` are probabilistic.
