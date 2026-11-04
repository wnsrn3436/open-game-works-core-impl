# review AuthCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `client/godot/plugins/ogw-secure-storage/desktop/src/backend_windows.cpp:62-81`: `available()` now checks the logon session once and caches the result. It returns `false` in two cases. First, when `CredGetSessionTypes(CRED_TYPE_MAXIMUM, persist)` fails or `persist[CRED_TYPE_GENERIC]` is below `CRED_PERSIST_LOCAL_MACHINE`, which is the persistence that `write` uses at `:110`. Second, when a `CredReadW` of `PROBE_TARGET` fails with `ERROR_NO_SUCH_LOGON_SESSION`. `PROBE_TARGET` is `ogw-secure-storage-probe` (`:19`). It is outside `TARGET_PREFIX` (`ogw-secure-storage:`), so it can never be an item. In a network or service logon, `register_types.cpp:22-26` therefore registers no `OgwSecureStorage` singleton. `secure_storage_adapter.gd` `is_available` is then `false`, and `AuthCore._platform_storage` (`client/godot/core/auth_core/auth_core.gd:243-244`) returns the DEV token storage when `use_dev_token_storage` was called, as open-game-works-core/skills/client-core/engines/godot.md:420 requires. In an interactive session the probe read fails with `ERROR_NOT_FOUND`, so `available()` stays `true` and that path does not change. The committed DLL `client/godot/plugins/ogw-secure-storage/dist/windows/addons/ogw-secure-storage/windows/libogw-secure-storage.windows.x86_64.dll` was rebuilt in this range. It contains the import names `CredGetSessionTypes` and `CredReadW` and the UTF-16 text of `ogw-secure-storage-probe`, so it was built from the new source |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D6 | fixed | none | This is the same defect as R1-1, which is fixed. See the evidence of R1-1 in `## previous`. `backend_windows.cpp:62-81` no longer returns `true` unconditionally |

## must fix

none

## unknown

- The Windows behavior was not observed in a run. This review ran on macOS, so the Windows DLL cannot be loaded here. Three behaviors were checked against the Win32 Credential Manager documentation only, not in a run: `CredGetSessionTypes` gives a maximum persistence below `CRED_PERSIST_LOCAL_MACHINE` in a network or service logon, `CredReadW` fails with `ERROR_NO_SUCH_LOGON_SESSION` there, and `CredReadW` fails with `ERROR_NOT_FOUND` in an interactive session
- No tests were run. No finding needed a test run to check it. R1-1 is a `spec` finding, not a `test evidence` finding, so step 5 did not require restoring the defect. The new test `test_a_dev_run_keeps_the_dev_token_storage_exactly_when_it_has_no_plugin_singleton` (`client/godot/core/auth_core/tests/test_secure_storage_plugin.gd:48-59`) checks the AuthCore storage choice for each value of `is_available()`. It does not run the Windows `available()`. The existing test `test_a_run_with_the_plugin_singleton_can_use_the_os_secure_storage` (`:62-76`) is the one that would fail on a Windows network or service logon if the old `available()` came back
- The commit range also changes many other client modules: AccessibilityCore, AdCore, BadgeCore, BootstrapCore, ChatCore, CutsceneCore, GameUpdateCore, NativeUiCore, NoticeCore, PaymentCore, PushCore, RemoteConfigCore, SceneCore, ShortcutCore, TutorialCore, UnitTestCore and VirtualPadCore. None of them is AuthCore or a module that AuthCore depends on (LogCore, EventCore, TimeCore, LocalDataCore, LocalizationCore, UICore, MessageCore, NetworkCore, UserStateCore). That code was not reviewed for this target. The only change in the range to `client/godot/generated/core_settings_types.json` moves the server key `storage.userLockWaitMs`, which AuthCore does not read
