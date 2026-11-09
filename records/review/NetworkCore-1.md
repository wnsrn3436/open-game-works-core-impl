# review NetworkCore round 1

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

- Commit range 04fd07a1..c80e3d35 changes NetworkCore only in commit f614a4a0: it removes `NetworkCoreDev.force_delay`, `_forced_delay_ms`, `_dev_received_hook`, the waiter field `deliver_at` and its checks in `_on_frame` and `_run_due`, and the delay part of `test_force_failure` (formerly `test_force_failure_and_force_delay`). The spec `## DEV` no longer has `force_delay`, so this matches the definition. Checked: no remaining reference to the removed names in the checkout (`grep` over `.gd`, `.ts`, `.json`, `.md`), the transport result is now fired at once in `_drive_transport` (client/godot/core/network_core/network_core.gd:623), and timeout firing in `_run_due` (client/godot/core/network_core/network_core.gd:695) still sets `timed_out` and covers the retry-delay waiter. `ogw core test godot NetworkCore` passed
- Unchanged NetworkCore code that the removed code did not reach (auth, failure flow, block, session, records) was not reviewed again, since the range does not change it or its callers
- Web transport (`ogw core test --web`) was not run; the range does not touch `web_network_transport.gd`
