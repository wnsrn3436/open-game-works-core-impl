# review NetworkCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/network_core/network_core.gd:147 | Commit ad967246 adds the `release` path of a NetworkCore that is not `init`: it deletes the `NetworkTransport` passed with `NetworkCoreDev.set_transport` (`_transport = null`). The defining documents set this behavior (`open-game-works-core/skills/core/SKILL.md:73`, a `release` of a module that is not `init` deletes the values set by operations called before `init`; `open-game-works-core/skills/client-core/modules/network-core.md:235`, `release` deletes a `NetworkTransport` passed with `set_transport`), but no test covers it. The only assert on `NetworkCore._transport` is `_assert_initial_state` in `client/godot/core/network_core/tests/test_lifecycle.gd:23`, which runs only after a `release` of an initialized module (`test_init_and_release`, `test_core_node_leaving_the_tree_cleans_up`). Every other `set_transport` call in the tests is followed by `init` (`tests/test_response.gd:211`, `tests/test_session.gd:277`). `UnitTestCore._register_replacements` (`client/godot/core/unit_test_core/dev/unit_test_core.gd:745`) sets the transport again right after every `BootstrapCoreDev.shutdown`, so no test can see a transport left behind. `client/godot/core/bootstrap_core/tests/test_boot_shutdown_pre_init.gd` checks only DataCore and ResourceCore. So deleting line 147 leaves every test passing: the following `init` (line 134) would then still use the transport of the earlier test | Add a NetworkCore test: call `NetworkCoreDev.set_transport(t)` while not initialized, call `NetworkCore.release()`, then assert `NetworkCore._transport == null`, no log, and that a following `init` uses the engine transport (`_active_transport` is not `t`) | no | 85 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- Core tests were not run. R1-1 rests on reading every test that calls `NetworkCoreDev.set_transport` or asserts `NetworkCore._transport`, not on running the suite with line 147 removed
- The same pre-init `release` change in RealtimeCore, NoticeCore, PaymentCore, PushCore, AdCore, NativeUiCore, GameUpdateCore, AuthCore, DataCore, QACore and BootstrapCore (commit ad967246) was not reviewed: those modules are outside this target
- Within the commit range, the only change to NetworkCore code is `client/godot/core/network_core/network_core.gd:146-147`. The rest of NetworkCore came before the range and was read only where it touches that change (`init`, `_cleanup`, `_reset_state`, the DEV operations in `dev/network_core_dev.gd`)
