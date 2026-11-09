# AuthCore review round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/auth_core/auth_core.gd:1011 | The DEV table of the AuthCore spec says that for `clear_dev_values` "the async operations of callers waiting for them end as failures, as on `release`", and that it works "without a log". `clear_dev_values` (client/godot/core/auth_core/dev/auth_core_dev.gd:67) calls `_end_storage_waits`, which finishes each wait with a `null` result. On `release` the caller then sees `life != _life` and returns its failure value. While AuthCore stays initialized, `_life` does not change, so `_storage_call` (auth_core.gd:1011) hands the caller an ordinary `FAILED` outcome and the caller takes its storage-failure path, which is not always a failure. Run path 1: `env.boot()`, `Env.mark_installed()`, `Env.agree_terms()`, `env.store("token-old")`, `Env.respond_terms()`, `Env.respond_auto_login(n, "token-new")`, then hold the storage write that comes after `AutoLogin` (`env.storage.hold = true` once the read has ended). Call `AuthCoreDev.clear_dev_values()` while that write waits. `_auto_login` (auth_core.gd:451-461) sees `written == false` with `life == _life`, keeps the new token as the pending token and returns `_open_session(...)`. `boot_login` returns `Success` and `is_logged_in()` is `true`, where the spec requires a failure. Run path 2: during the write of `link_account` (auth_core.gd:1513-1522), the caller gets `LinkStatus.SUCCESS` and leaves the error log `link_account: storage item was not written again`. The only test, `test_clear_dev_values_fails_the_waiting_caller_and_deletes_after_the_operation_in_progress` (client/godot/core/auth_core/tests/test_storage.gd:114), covers just the read of `boot_login`, where `FAILED` already maps to `Failed` | Make a wait that `_end_storage_waits` ended distinguishable from a storage `FAILED` outcome. For example, renew a storage-wait life object in `_end_storage_waits` and have each `_storage_call` caller check it as it checks `_life`, then return its failure value with no further work and no log. Add tests for the auto-login write and the `link_account` write while `clear_dev_values` runs with AuthCore initialized | no | 85 |
| R1-2 | spec | medium | client/godot/core/auth_core/auth_core.gd:152 | Commit ad967246 adds `_clear_pre_init_values` to `release` of an AuthCore that is not initialized. It deletes the scope text and the social adapters and keeps the DEV values and the pending token (open-game-works-core/skills/core/SKILL.md:73, open-game-works-core/skills/client-core/modules/auth-core.md:240). No AuthCore test calls `release` before `init` and then reads the scope text or the social adapters. `test_clear_dev_values_before_init_and_with_an_empty_scope_starts_no_delete` (client/godot/core/auth_core/tests/test_storage.gd:165) calls `AuthCore.release()` before `init`, but then sets the scope with `AuthCore.set_storage_scope("")` before it reads anything. client/godot/core/auth_core/tests/test_lifecycle.gd only releases an initialized AuthCore. The BootstrapCore test `test_boot_shutdown_pre_init.gd` covers only DataCore and ResourceCore. So deleting the `_clear_pre_init_values()` call, or making it also delete `_fake_social_account` or `_pending_token`, passes every test | Add a lifecycle test: `set_storage_scope`, `set_social_adapter`, `set_fake_social_account` and a pending token before `init`, then `release` without `init`. Assert that the scope text and social adapters are empty, that the fake account name and pending token remain, and that there is no log and no storage call | no | 90 |
| R1-3 | spec | medium | client/godot/core/auth_core/auth_core.gd:244 | open-game-works-core/AGENTS.md `## harness writing rules` requires that a commit that changes a rule state the cause it fixes and the evidence for the new rule. Commit e6caa1ef ("AuthCore: keep the DEV values across release, add clear_dev_values") changes the rule for which state `release` keeps: `_fake_social_account`, `_fake_tracking` and `_dev_storage` are no longer reset in `_clean_up`. Commit ad967246 changes what `release` of a module that is not initialized does (auth_core.gd:152-167). Both messages are a subject line only, with no cause and no evidence (`git log -1 --format=%B e6caa1ef ad967246`) | State the cause and the evidence of both rule changes in the commit message of the next change of these lines, e.g. the QACore `set_social_account` restart, the shutdown leak of pre-init values between tests, and the spec lines open-game-works-core/skills/client-core/modules/auth-core.md:240 and open-game-works-core/skills/core/SKILL.md:73 | no | 85 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- I did not run the Godot core tests. R1-1 comes from reading the code path: `_end_storage_waits` → `_storage_call` → `_auto_login` and `link_account`. I did not run a test for it
- I did not check whether Godot resumes an awaited `AuthWait.done` synchronously inside `emit`. Under synchronous resume, `clear_dev_values` deletes the pending token that `_auto_login` sets in R1-1. Under deferred resume, the pending token would remain after `clear_dev_values`. Either way, the `Success` result of R1-1 is the same
- I reviewed only the AuthCore changes of the range: client/godot/core/auth_core/ and the AuthCore call in client/godot/core/bootstrap_core/dev/bootstrap_core_dev.gd. I did not review the other files of the range (the other client modules and the server core)
- I did not check the real platform storage adapters (`ogw-secure-storage`, the web storage) with `clear_dev_values`
