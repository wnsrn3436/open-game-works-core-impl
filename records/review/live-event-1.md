# review: live-event round 1

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

- The range 2ef5ae8d..f5e49d53 changes no file in `server/core/live-event/`, no file of `server/core/server-time/` or `server/core/logging/`, and none of the storage files behind the operations live-event calls (`get_state`, `list_state`, `put_core_state`, `run_user_transaction`, `with_hook_change_source`, `check_hook_output`: `server/core/storage/tx.ts`, `state.ts`, `hook_output.ts`, `user_change.ts` are unchanged). The changes checked for an effect on live-event: random user IDs below 2^53 and public codes (`server/core/storage/public_code.ts`, `rows.ts`, `schema.ts` core schema 2), the `public_code` of `BanDetail` in step 6 of `server/core/routing/pipeline.ts:588`, the `FindUserByPublicCode` prepare entry in `server/core/routing/spec_tables.ts` (`REQUEST_START_ORDER` unchanged), and the `public_code` reads in `server/core/auth/login.ts`. live-event handles user IDs only as `bigint` (`server/core/live-event/index.ts:148`, `:278`) and its tests do not depend on the order users were made (`server/core/live-event/tests/settlement.test.ts:25`), so none of these changes causes or reveals a problem in live-event
- The live-event core tests were not run: running them needs an `npm ci` that writes `server/node_modules/` into the checkout under review, and this review writes no file outside `output`. Whether they pass on SQLite and PostgreSQL after the random user ID change is not checked by running them
- The data rules of `## data` (`server does not start` on a rule violation) are data checks of the data tool (`core` SKILL.md data checks); `tools/data-tool/src/checks/live-event.ts` was not reviewed because it is outside this target and the range does not change it
