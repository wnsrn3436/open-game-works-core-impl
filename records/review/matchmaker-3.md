# review matchmaker round 3

## findings

none

## previous

none

## out of scope

- server/core/matchmaker/matching.ts:69: medium `efficiency`. `collect` keeps walking the whole queue after the collected headcount reached `max_players`, so one `matchmaker_tick` over one queue grows quadratically with its entries (`run_tick` to `run_queue` to `collect`). This is the problem that round 1 wrote and that is item D1 of records/review-debt/matchmaker.json. The commit range does not change matching.ts, and the loop is unchanged at that line. It was not measured again in this round

## debt

none

## must fix

none

## unknown

- Commit range: of the code of this target, only server/core/matchmaker/realtime.ts (`leave_room` and the `timeout` step of `run_tick`) and server/core/matchmaker/tests/rooms.test.ts changed, both in 59ad5cf. The other changed files of the range belong to other targets (iap, RealtimeCore, review records) and were not reviewed
- The unmodified checkout passed `ogw core test server matchmaker` (the whole module on SQLite and PostgreSQL, job mw197s2rd1f70e) and `ogw core test server matchmaker --file server/core/matchmaker/tests/rooms.test.ts` (job mw195z27adba69). The core tests of modules that depend on matchmaker were not run. `ogw review run` runs them after a fix, and this round found no failure outside the module's tests that would need them
- The new tests were checked by restoring defects in temporary copies outside the checkout and running rooms.test.ts with vitest on SQLite. `remove_entry` before `match_failed` in the `timeout` step: `sends each member MATCH_FAILED TIMEOUT before the ROOM_STATE Open` fails. `room.status = 'Open'` back in `leave_room`: the `leaves` and `is kicked` cases of `keeps the room Matching` fail. `reopen()` before the `MATCH_FOUND` sends: both of those cases fail. These runs were not made on PostgreSQL. In each of them, and in the unmodified copy, the 2 tests of `member rating resolution` that need PostgreSQL fail because the run gives no `OGW_POSTGRESQL`
- A room stays `Matching` without an entry when `create_match` rejects after `run_tick` cleared `room.entry`, because `reopen` then does not run, and since this range `leave_room` no longer makes such a room `Open`. It is not a finding because no reproducing input was found: `results.create` and `participant_change` catch their failures, `prepare_transport` is caught, and the throws of `open_match_session` (server/core/p2p-signaling/sessions.ts:80) need a repeated match ID, a repeated connection or wrong indexes, which the code that was read does not produce. This was read from the code, not forced by a run. `build_record` and `new_seed` were not read
- Rooms with several members leaving during creation, a connection close or a connection replacement during creation, and a host `MATCH_CANCEL` or `ROOM_START` during creation were read from the code (`drop`, `leave_room`, `match_cancel`, `host_error`), not run. The tests run the `ROOM_LEAVE` and `ROOM_KICK` cases, and `ROOM_JOIN` and the host `MATCH_REQUEST` during creation
- The client side of the frame order (`RealtimeCore`) is another target and was not checked here
- Input `## debt` is `none` although records/review-debt/matchmaker.json holds D1, so D1 is written in `## out of scope` as in round 2 and has no row in `## debt`. Why `ogw review next` left it out was not checked
- Of the defining documents, `## API`, `## behavior` from `### connection` through `### apply`, the room and party items of `## test`, and the spec diff of `2d89afc` of the matchmaker spec were read. Of the storage spec, only the `run_game_transaction` lines were read. `auth`, `session`, `admin-api`, `server-time`, `logging`, `p2p-signaling`, `validation`, `game-update`, core SKILL.md, command.md and server-core SKILL.md were not read in this round, because the range changes no call to them
