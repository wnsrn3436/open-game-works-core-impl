# review matchmaker round 1

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

- Scope: commit range 51d323b..867c58a. The matchmaker changes in it are commit fa0f999: `server/core/matchmaker/matching.ts` (`collect` stops at a full match), `server/core/matchmaker/realtime.ts` (`p2p_frame` no longer awaits `results.participant_change`), the matchmaker keys of `settings/core-settings.schema.json` (`helloTimeoutMs`, `frameReadTimeoutMs`, `applyRetryMaxAttempts` minimum 1), and new tests in `connection.test.ts`, `matching.test.ts`, `queue-rules.test.ts`, `results.test.ts`, `rooms.test.ts` and `helpers.ts` (`hold_next_transaction`).
- Checked against the spec: `collect` breaking at `count === max_players` gives the same result as step 2 of `### matching`, because every entry has at least one member, so nothing fits after a full match. `p2p_frame` matches `### connection`: the frame handling ends when `handle_frame` returns. `participant_change` (`server/core/matchmaker/results.ts:386`) still chains the changes of one match in order and catches and logs its own failure, so the `void` call leaves no unhandled rejection. All matchmaker schema minimums match the "1 or more" rules in `## settings`.
- Checked by reading whether each new test would fail on the defect it targets. `queue-rules.test.ts` reads ratings about n²/2 times without the break, above its `4 * n` bound. In the `results.test.ts` test of `## test` item "write of a DISCONNECTED waits ... REJOINED", an awaiting `p2p_frame` would block the barrier behind the held transaction, so the test fails. The matching and room tests about frames sent while `prepare_match_request` or member rating resolution waits would see an extra queue entry or room frames if the frames were handled concurrently. I did not restore these defects and run the tests (round 1 does not require it).
- Ran `ogw core test server matchmaker --file` for `queue-rules`, `matching`, `results`, `rooms` and `connection` test files on this checkout: all pass. The other matchmaker test files were not run because nothing in them changed.
- I did not review the storage, admin-api, auth, logging, routing and iap changes in the same range. They belong to their own modules, and matchmaker uses none of their changed public surface, except the admin-api switch cache read at start, which does not change `is_maintenance` or `is_kill_switched`. I also did not check the non-matchmaker schema minimum changes in `settings/core-settings.schema.json` (auth, logging, routing, iap keys).
- `efficiency`: `remove` in `server/core/matchmaker/matching.ts:120` still splices from the front of the queue once per matched entry. Whether V8 makes this a linear move per splice was not measured, so it is not written as a finding.
