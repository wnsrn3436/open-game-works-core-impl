# review VirtualPadCore round 1

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

- The commit range 625ae189..9e7d6e31 changes no file of `client/godot/core/virtual_pad_core/` and not `core-spec/VirtualPadCore.json`, and no file of its dependencies (`log_core`, `event_core`, `local_data_core`, `resource_core`, `safe_area_core`, `input_core`, `ui_core`). The client changes of the range are in other modules (`ad_core`, `auth_core`, `data_core`, `game_update_core`, `native_ui_core`, `network_core`, `notice_core`, `payment_core`, `push_core`, `qa_core`, `realtime_core`) and in `bootstrap_core` and `unit_test_core`. The only change that reaches the target is `client/godot/core/bootstrap_core/bootstrap_core.gd:1350`: DEV `shutdown` now calls `release` on every lifecycle module, including the ones that are not initialized
- `VirtualPadCore.release` of a module that is not initialized (`client/godot/core/virtual_pad_core/virtual_pad_core.gd:136`) returns at once, because `_node` is null whenever `_is_initialized` is false: a failed `init` after the core node was made calls `_cleanup(true)` (`virtual_pad_core.gd:127`), and `_on_node_exit_tree` resets the state through `_cleanup(false)`. VirtualPadCore has no value that an operation sets before `init` (`VirtualPadCoreDev.set_test_touch_support` before `init` only logs an error, `client/godot/core/virtual_pad_core/dev/virtual_pad_core_dev.gd:9`). So the new call calls no other module and leaves no log, as `skills/core/SKILL.md:73` (harness) requires. `shutdown` releases in reverse module order, so VirtualPadCore is released before `EventCore` and `ResourceCore`, which its `_cleanup` calls only after checking `is_initialized`
- The settings changes of the range (`settings/core-settings.schema.json`: `admin-api.maxSearchRows`) and `core-spec/storage.json` belong to server modules and do not touch the VirtualPadCore settings keys
- `ogw core test godot VirtualPadCore` passed on this checkout (job mw8ljf9tcc7bd2). It wrote no test record because the checkout had the uncommitted deletion of the earlier review file
- Target code that the range does not reach was not reviewed again: with a commit range, only problems that the changes cause or reveal are in scope
