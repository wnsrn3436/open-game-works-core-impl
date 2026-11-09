# update core: BootstrapCore (shutdown and release of modules that are not init)

## done

- `BootstrapCore` (`client/godot/core/bootstrap_core/`)
  - `shutdown` step 3 now first calls `AuthCore.clear_dev_values`, while the AuthCore scope text is still set. It goes through a new DEV hook, `before_shutdown_release` (`bootstrap_dev_hooks.gd`, implemented in `dev/bootstrap_core_dev.gd`), because the non-DEV `bootstrap_core.gd` cannot reference `AuthCoreDev`. After that it releases every lifecycle module except `UnitTestCore`, including modules that are not init: the `is_initialized` gate in `_release_entry` is gone.
  - The boot trace still records only the releases of modules that were init, so the trace of a booted module list stays as the existing release-order tests expect.
- New test `bootstrap_core/tests/test_boot_shutdown_pre_init.gd` covers the new `## test` item. The first test calls `DataCoreDev.set_test_data_location` with a non-default location and `ResourceCoreDev.set_test_key_list`, then ends without `init`. The second test (after the `shutdown` of its test setup) checks two things:
  - `DataCore.get_builtin_location` is the default location (the value read before the first test changed it).
  - `ResourceCore.init` reads the generated resource key list file and not the first test's list. The core project has no such file, so `init` fails with one `ResourceCore` error log, as `test_init_without_test_key_list_and_key_list_file_fails` of ResourceCore shows.
- `UnitTestCore`: removed `_clear_pre_init_values`, which only covered TimeCore and is now covered by `shutdown`, and its two calls after `BootstrapCoreDev.shutdown()` in `_close_run` and `_setup_test`.
- Changes outside the module, needed so that `release` of a module that is not init follows `## lifecycle` of the `core` skill (it only deletes the values that operations called before `init` set, calls no other module and leaves no log). Before, these modules returned at once when not init, so their pre-init values stayed:
  - `AuthCore`: deletes the scope text and the social adapters (`set_storage_scope`, `set_social_adapter`). It also deletes the internal test replacements that tests assign before `init` (`_test_storage`, `_test_url_opener`, `_test_persist_requester`, `_test_tracking`). It keeps the fake account, fake tracking state, DEV token storage and pending token, which the spec keeps after `release` (`clear_dev_values` deletes those).
  - `AdCore`: deletes the ads adapter and the ad units (`set_ads_adapter`).
  - `NativeUiCore`: deletes the native adapter (`set_native_adapter`).
  - `NetworkCore`: deletes the transport (`NetworkCoreDev.set_transport`).
  - `NoticeCore`: deletes the image downloader (`NoticeCoreDev.set_image_downloader`).
  - `GameUpdateCore`: deletes the downloader (`GameUpdateCoreDev.set_downloader`).
  - `PaymentCore`: deletes the store adapter (`set_store_adapter`).
  - `PushCore`: deletes the push adapter and the notification adapter (`set_push_adapter`, `set_notification_adapter`).
  - `RealtimeCore`: deletes the transport (`set_transport`).
  - `QACore`: deletes the test launch values that tests assign before `init`.
  - `DataCore`: when not init, `release` now resets only the test data location and the built-in version read from it. It no longer clears `GameData` or resumes the session in that case.
- Checked and left unchanged, because they already clear exactly their pre-init values unconditionally, or have no operation that works before `init`:
  - Already clear their pre-init values: TimeCore (test clock, random base, frame step), LogCore (test clock, log listener), ResourceCore (test key list), LocalDataCore (test storage root), LocalizationCore (test device language and timezone offset), EventCore (init listeners), AccessibilityCore, RequirementCore.
  - No operation that works before `init`: all other client modules.
- Runs, all on the committed branch:
  - `ogw core test godot` and `ogw core test godot --web` of the edited modules and every module that `ogw core dependents` lists (30 modules): all pass.
  - `ogw code check core`: type check, lint, dependency and secret all pass.
- No engine-specific implementation rules document was written. `## <engine> build` of `tools/ogw.md` was not written.

## spec proposals

- `bootstrap-core.md` `shutdown` step 3 does not say whether `AuthCore.clear_dev_values` is called when `AuthCore` is not in the module list. The implementation always calls it, since it works before `init` without a log and starts no delete then. Proposal: write "also when `AuthCore` is not in the module list".

## review

none

## unverified

- `InputCore` and `VirtualPadCore` still run their full cleanup in `release` when not init but their core node exists. That state only happens inside a failed `init`, which already cleans up, so no test reaches it and it was not changed.
- The new BootstrapCore test relies on GUT running the tests of one file in declaration order. The second test asserts that the first one ran, so a different order fails rather than passing without checking anything.
- No run on Android or iOS devices: core tests run on the desktop Godot runtime and the browser.
