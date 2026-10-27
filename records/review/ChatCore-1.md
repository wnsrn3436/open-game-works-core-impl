# ChatCore review round 1

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

- The commit range cf89b7fd..53dc14cd changes no file under `client/godot/core/chat_core/`, no file of the client dependencies (`log_core`, `event_core`, `time_core`, `local_data_core`, `network_core`, `badge_core`), no file of the server dependency `server/core/chat/`, and neither `core-spec/ChatCore.json` nor `core-spec/chat.json` (checked with `git diff --stat` over those paths). The changes in the range that touch ChatCore are these. `records/review-debt/ChatCore.json` drops D1 (`client/godot/core/chat_core/tests/test_read_seq.gd:154`, a `check_logs` assert whose expected value is 0). The current `unit-test-core.md` no longer has the rule that D1 cited, so it is not written again. `client/godot/generated/core_settings.json` adds `storage.sweep*` and changes `routing.ipRateLimitPerMinute`. ChatCore does not read those keys
- The server `storage` changes (`sweep_expired` batch delete, expiry index in `schema.ts`) also reach the `chat` tables that have `expires_at` (`server/core/chat/tables.ts:44`, `server/core/chat/tables.ts:69`). Those changes belong to the `storage` and `chat` server targets, so they were not reviewed here. ChatCore reads only expiry that the server already applied (`expires_at > now` in `server/core/chat/tables.ts:272`), and does not depend on when the sweep runs
- ChatCore code and tests outside the range were not read again. ChatCore tests were not run, because nothing in the range changed ChatCore or its dependencies
