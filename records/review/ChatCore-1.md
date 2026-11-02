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

- The commit range d4c3ae7f..a362280a changes no file under `client/godot/core/chat_core/`, no file of the client dependencies (`log_core`, `event_core`, `time_core`, `local_data_core`, `network_core`, `badge_core`), no file of the server dependency `server/core/chat/`, and neither `core-spec/ChatCore.json` nor `core-spec/chat.json` (checked with `git diff --stat` over those paths). `records/review-debt/ChatCore.json` has no items
- The changes in the range that could reach ChatCore are these, and none changes its behavior. `client/godot/core/ui_core/ui_core.gd` adds only `is_dimmed`, `_is_dimmed` and `_dim_above`, and outside `ui_core/tests` and `qa_core/tests` the only caller of `is_dimmed` is `client/godot/core/qa_core/dev/qa_query.gd:271`. ChatCore code does not refer to `UICore` or `QACore`; `client/godot/core/chat_core/tests/support/chat_test_case.gd:98` and `client/godot/core/chat_core/tests/support/chat_test_case.gd:111` call only `UICore.init` and `UICore.prepare`, which the range did not change. `client/godot/generated/core_settings.json` drops `uiQuality.maxFlatShare`, which no core code reads, and leaves `ChatCore.maxWatchedChannels` and `ChatCore.failureRetryMs` as they were
- ChatCore code and tests outside the range were not read again, and whether they equal `chat-core.md` was not rechecked in this round, because the range changed neither them nor the defining documents (`## spec changes` is `none`)
- ChatCore tests were not run by this review, because nothing in the range reaches ChatCore. `records/1793645028102-update-core-mvzlxt6u5be5ef.md:15` and its run log record `ogw core test godot` runs with ChatCore among the modules. That record was read, and its result was not reproduced here
