# review matchmaker round 4

## findings

none

## previous

none

## out of scope

- server/core/matchmaker/matching.ts:69: medium `efficiency`. `collect` keeps walking the whole queue after the collected headcount reached `max_players`, so one `matchmaker_tick` over one queue grows quadratically with its entries (`run_tick` to `run_queue` to `collect`). This is item D1 of records/review-debt/matchmaker.json, which input `## debt` does not list. The last commit that changed matching.ts (301b3dd) is older than the commit range, and the loop has no break after the placement. It was read from the code and not measured again in this round

## debt

none

## must fix

none

## unknown

- Commit range: of this target, only server/core/matchmaker/tests/rooms.test.ts changed (e974fe7). No code of the module, and nothing in core-spec, proto, settings, fixtures, test-data or server/generated, changed. The other changed files of the range belong to another target (RealtimeCore) or are records, and were not reviewed
- `ogw core test server matchmaker --file server/core/matchmaker/tests/rooms.test.ts` (job mw1bjfac6a1413) printed `matchmaker pass`. It may be a kept passing result of the same key and not a new run. The core tests of modules that depend on matchmaker were not run, because only a test file changed
- The changed test was run with vitest on SQLite in temporary copies outside the checkout, with `-t 'match creation failure'`. The unmodified copy passed 3 of 3 runs. `reopen()` moved before the `match_failed` loop in `create_match` of realtime.ts: the test fails with `[19, 6]` against `[6, 19]`. `reopen()` removed there: the test fails with `[6]` against `[6, 19]`. The new `barrier(b.conn)` removed from the test on unmodified code: the test fails with `[19, 6, 19]`, so that line is needed. These restored runs were not made on PostgreSQL
- A room staying `Matching` without an entry when `create_match` rejects, which `## unknown` of round 3 wrote, was not checked again, because the range does not change that code. Still no reproducing input is known
- Input `## debt` is `none` although records/review-debt/matchmaker.json holds D1, so D1 is written in `## out of scope` as in rounds 2 and 3 and has no row in `## debt`. Why `ogw review next` left it out was not checked
- The client side (`RealtimeCore`, including its `MATCH_CANCEL` after `ROOM_BUSY` added in this range) is another target and was not checked here. Whether that cancel reaches a room of matchmaker that is `Matching` without an entry was not run
- Of the defining documents, only the matchmaker spec lines on `MATCH_FAILED`, `ROOM_STATE` and `MATCH_CANCEL`, including the `## test` item on the frame order of a failed match record save, were read. The other defining documents were not read in this round, because the range changes no code that calls them
