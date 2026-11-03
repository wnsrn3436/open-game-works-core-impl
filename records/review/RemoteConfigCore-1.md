# review RemoteConfigCore round 1

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

- Scope: the range changes only `client/godot/core/localization_core/localization_core.gd` (`_restore_heading_types`), `client/godot/core/localization_core/tests/test_font_weight.gd` and `records/`. It changes no file of `client/godot/core/remote_config_core/`, `core-spec/`, `proto/` or `settings/`. `LocalizationCore` is not in `## dependency` of RemoteConfigCore, `remote_config_core.gd` does not refer to it, and the test support of RemoteConfigCore (`tests/support/remote_config_test_case.gd:60`, `:69`, `:70`) calls only `init`, `resolve_language` and `load_translation`, not `load_fonts` or the `release` path after it that reaches `_restore_heading_types` with saved heading types. So the range causes and reveals no problem of the target
- Tests were not run. No finding needed a test to check it, so the core tests of RemoteConfigCore have no result from this review. Every statement here comes from reading the code
- Read outside the required scope, with no finding: `remote_config_core.gd`, `remote_config_refresh.gd`, `remote_config_core_node.gd`, `events/remote_config_changed_event.gd` and all of `tests/`, compared with the module spec. By reading, each item of `## test` of the module spec has a test. Whether each test fails when its defect is restored was not checked, because no defect was restored in a temporary copy
- Dependencies read only in part: in `auth_core.gd` the login success order, `get_login_remote_config` and `logout`; in `time_core.gd` `get_real_time` and `_return_from_background`; in `event_core.gd` `acquire` and the start of `publish`; in the generated `game_data.gd` `RemoteConfigKeyTable` and its `get_row`. How `_real_time_ms` advances in `_on_engine_frame` was not read, so that real time excludes background time is taken from the comment at `time_core.gd:295` and from `_return_from_background` resetting `_last_frame_monotonic_ms`, not from a run. `network_core.gd` was not read; the behavior of `send` when the session ends and on `release` is taken from `network-core.md`
- Not read: server core `remote-config` (`server/core/remote-config/`), which is a separate target. That its entries and assignments match what the client expects was not checked here
- Not decided: when the first entry of a `key_id` has a `value.kind` that does not correspond to the key `type` and a second entry of that `key_id` does, `_apply` (`remote_config_core.gd:275`) discards both and the key gives `default_value`. The spec line "the first entry is used" and the discard rule do not state this order, so it was not written as a finding against the code. This is a question about the spec, and no core test covers it
