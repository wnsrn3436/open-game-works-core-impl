# ChatCore review round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/chat_core/tests/test_read_seq.gd:154: medium test evidence: `assert_eq(UnitTestCore.check_logs("error", "BadgeCore"), 0, ...)` asserts an error log count whose expected value is 0, which the unit-test-core.md log rule ("The error log count is asserted with `check_logs` only when the expected value is not 0") does not allow. Any unchecked BadgeCore error log already fails the test at its end, so this assert catches nothing extra. It is the same defect as AuthCore R1-1/R1-2 and was there before d4e2728 (last change to the file is 301b3dd, an ancestor of d4e2728)

## debt

none

## must fix

none

## unknown

- The commit range d4e2728..b58145f changes no file under `client/godot/core/chat_core/`, no ChatCore or chat spec (`core-spec/ChatCore.json`, `core-spec/chat.json`), no file under `server/core/chat/`, and no file of the modules ChatCore depends on (LogCore, EventCore, TimeCore, LocalDataCore, NetworkCore, BadgeCore). The changes that reach ChatCore's tests are additive or test-runner changes, and were read only for that effect: `UICore.is_flow_in_progress` and `TweenCore.get_finite_playing_count` are added (the ChatCore test case inits both), and UnitTestCore sends `PUT /started` in `_begin_run`, which ChatCore tests do not call. The whole ChatCore code was not reviewed again in this round
- The core tests were not run in this review
