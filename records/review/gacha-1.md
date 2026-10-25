# review gacha round 1

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

- The commit range 2ef5ae8d3d40c74ba1bc3385efee1c2c0591c772..bef745290ca6601beb797654b99af7383577162d changes no file under `server/core/gacha/`. The changes checked for effect on gacha are: storage `create_user` (now returns `NewUser`, random user IDs below 2^53), `get_user_record` (adds `public_code`), `find_user_by_public_code`, `is_public_code_input`, core schema version 2 with the public code start fill, routing `check_ban_and_version` (`BanDetail.public_code`), `spec_tables.ts` (`FindUserByPublicCode`, `find_user_by_public_code`), and the test helpers `storage/tests/helpers.ts`, `item-ledger/tests/helpers.ts` and `mailbox/tests/helpers.ts`. gacha code (`server/core/gacha/index.ts`, `draw.ts`, `records.ts`) calls none of the changed storage operations (it picks `register_table`, `get_state`, `put_core_state`, `db`, `with_hook_change_source` and `check_hook_output`). The gacha tests do not call `create_user` directly, and they do not expect any order based on user IDs: draw records are keyed and ordered by the per-user `draw_seq`, and `history.test.ts` compares only per-user `draw_seq` lists. The admin output `user_id` is a bigint that admin-api writes as a decimal string, so the user IDs below 2^53 lose no precision
- The gacha tests were not run. `npx vitest run --globals core/gacha` with `OGW_DEFAULT_DB=sqlite` fails before any server test runs, with `testing: the server build data folder null does not exist` (`server/core/testing/dev/runner_input.ts:47`). The server build data input is prepared by `ogw core test`, which this review does not run. Only `draw-rules.test.ts` (7 tests, no server) passed
- With commit range set and `## spec changes` `none`, the gacha code from before this range was not fully reviewed against the spec for this round. It was read through once, and no problem with confidence 80 or more was found. Not checked: whether `admin-api` rejects a `limit` of `list_gacha_history` that is 0 or less, or that is too large, before the handler runs (`server/core/gacha/records.ts` `LIST_RANGE` passes `limit` straight to SQL `LIMIT`)
