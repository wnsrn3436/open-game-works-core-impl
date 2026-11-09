# AuthCore review round 3

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | fixed | Commit 5acc0e5f. `_block_age` (client/godot/core/auth_core/auth_core.gd:1416-1432) now queues the remove with `_storage_begin` (auth_core.gd:1011-1019). Before it waits, it clears the session and the pending token, writes the `auth/age_blocked` marker and calls `_end_session(AGE_BLOCKED)` (auth_core.gd:1680-1687). That call sets `_provider` to null, calls `NetworkCore.set_session_provider(null)` and `LogCore.set_analytics_allowed(false)`, and publishes `SessionEndedEvent(AgeBlocked)`. A wait that `clear_dev_values` or `release` ends makes `_storage_end` return `null` (auth_core.gd:1027-1028). `_block_age` then returns `false`, and `prepare_consent` returns `Failed` (auth_core.gd:1207-1208), as the `clear_dev_values` DEV row of auth-core.md:348 requires. `boot_login` maps that to `Failed` (auth_core.gd:409-410). The storage order is still the one auth-core.md:174 sets. The remove goes in the queue before the event is published, and `_run_storage` runs operations in queue order (auth_core.gd:1050-1053). So a storage read or write that a `SessionEndedEvent` subscriber starts runs after the remove. The two core subscribers, PaymentCore `_on_login_session_changed` and PushCore `_on_session_ended` (client/godot/core/push_core/push_core.gd:287-294), do not touch AuthCore storage. The new test client/godot/core/auth_core/tests/test_consent.gd:129 holds the remove and calls `clear_dev_values`. It then asserts `Failed`, no session or pending token, a null provider, a `NetworkCore.send` that fails without a request, analytics not allowed, the marker, one `SessionEndedEvent(AgeBlocked)`, no storage item after the held remove ends, and no AuthCore error or warn log. `ogw core test godot AuthCore --file client/godot/core/auth_core/tests/test_consent.gd` passes |

## out of scope

none

## debt

none

## must fix

none

## unknown

- R2-1 is a `spec` finding, so I did not restore the defect in a worktree. I did not check the core agent's claim that the new test fails on the auth_core.gd from before 5acc0e5f. I ran only test_consent.gd of AuthCore. I did not run the other AuthCore test files, the `--web` run or the dependent modules. The core agent report says they pass
- I did not check the real platform storage adapters (`ogw-secure-storage`, the web storage) with `clear_dev_values` during the age-block remove
- I reviewed only the AuthCore files of the range (client/godot/core/auth_core/). The NoticeCore test change (29a4b168) and the record files of the range belong to other targets
- As in round 2: `withdraw` and `logout` (`_forget_account`, auth_core.gd:1638-1648) leave the session open when `clear_dev_values` ends their remove wait. The range did not change this, and the existing withdraw test sets this behavior. No defining document sets the state after it, so I did not write it as a finding
