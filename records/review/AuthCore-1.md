# review AuthCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/plugins/ogw-secure-storage/desktop/src/backend_windows.cpp:59 | Input D6 is unchanged at HEAD e02d2bf. `backend::available()` always returns `true`. Because of that, `register_types.cpp:22-26` registers the `OgwSecureStorage` singleton even in a Windows logon session that has no credential set (a network logon such as an OpenSSH session with key authentication, or a service logon). In that session `CredReadW`/`CredWriteW`/`CredDeleteW` fail with `ERROR_NO_SUCH_LOGON_SESSION`, which `status_of` maps to `STATUS_UNSUPPORTED` (`backend_windows.cpp:45-47`, and its comment names that case). Run path: a dev run or core test with DEV code in such a session calls `AuthCoreDev.use_dev_token_storage()`. `AuthCore._platform_storage` (`client/godot/core/auth_core/auth_core.gd`, `not _SECURE_STORAGE.is_available()`, and `is_available` is `Engine.has_singleton`, `secure_storage_adapter.gd:43-44`) then picks `secure_storage_adapter.gd` and not the DEV token storage that open-game-works-core/skills/client-core/engines/godot.md:420 sets for "a process that cannot use OS secure storage". On first launch the install marker delete is `Unsupported`, which is a check failure (open-game-works-core/skills/client-core/modules/auth-core.md:140). Otherwise the auto-login read is `Unsupported`, which is `Failed` (open-game-works-core/skills/client-core/modules/auth-core.md:94). So `boot_login` is `Failed` on every launch. In the same session `test_a_run_with_the_plugin_singleton_can_use_the_os_secure_storage` (`client/godot/core/auth_core/tests/test_secure_storage_plugin.gd:47-61`) fails its `assert_ne(outcome.status, UNSUPPORTED)`. The Linux backend already handles this condition: its `available()` (`backend_linux.cpp:164-181`) checks that the default collection can be opened | In `available()`, probe the credential set once and cache the result. Return `false` when the session cannot keep a generic credential: either `CredGetSessionTypes` gives a maximum persistence below `CRED_PERSIST_LOCAL_MACHINE` for `CRED_TYPE_GENERIC`, or `CredReadW` of a target that does not exist fails with `ERROR_NO_SUCH_LOGON_SESSION` and not with `ERROR_NOT_FOUND` | no | 85 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D6 | open | R1-1 | The commit range e02d2bf..e02d2bf is empty, and `backend_windows.cpp:59-61` still returns `true` without any check of the logon session. See R1-1 |

## must fix

none

## unknown

- The commit range is empty (`e02d2bf..e02d2bf`, no diff) and `## spec changes` is `none`, so the only code read was at the D6 position and along its run path: `backend_windows.cpp`, `register_types.cpp`, `backend_linux.cpp` `available()`, `AuthCore._platform_storage`, `secure_storage_adapter.gd` `is_available`, and `test_secure_storage_plugin.gd`. The rest of AuthCore was not reviewed in this round
- R1-1 was not reproduced on a Windows host, because this review ran on macOS. The `ERROR_NO_SUCH_LOGON_SESSION` behavior of a session without a credential set comes from the Win32 Credential Manager documentation and from the comment at `backend_windows.cpp:45`. It was not observed in a run
- No tests were run: no finding needed a test run to check it, and the Windows plugin build cannot run on this host
