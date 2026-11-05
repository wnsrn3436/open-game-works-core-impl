# review reset-counter round 1

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

- The range 51d323b..0b2f181 changes no file of `server/core/reset-counter/` and no file of `server/core/server-time/`. The changes it makes to what reset-counter calls are in `server/core/storage/` (`core.ts`, `tx.ts`, `state.ts`, `rows.ts`, `index.ts`, `user_change.ts`, db adapters): `get_states`, `get_user_records`, the `broken_by` value of `mark_broken`, a body that returns or throws on a broken transaction ending `FAILED`, `run_savepoint` throwing on an aborted transaction, and `lock_row` returning `FAILED` on a broken transaction. reset-counter calls only `storage.get_state` and `storage.put_core_state`, neither of which changed. It does not catch throws, call `run_savepoint` or lock rows, so these changes do not change its results. `ogw core test server reset-counter` passed on this checkout (`reset-counter pass`)
- `server/core/routing/http.ts` and `pipeline.ts` (client IP text) and `tools/data-tool/src/checks/InputCore.ts` changed in the range. reset-counter does not reach them, and they were not checked further
- The client changes in the range that name the reset counter (`client/godot/core/qa_core/dev/qa_builtins.gd` `set_reset_counter`, `client/godot/core/qa_core/tests/test_cheats.gd`, generated `game_data_dev.gd`) belong to `QACore`, not to this server module. They were not reviewed. Client `UserStateCore.get_reset_counter` was not checked
- No test was run on PostgreSQL by hand: the module test was run only through `ogw core test server reset-counter`, with the DB that it chooses
