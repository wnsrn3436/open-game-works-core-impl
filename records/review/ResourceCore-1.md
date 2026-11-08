# ResourceCore review round 1

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

- The commit range 85f6b36d..c655dfd4 changes no file under `client/godot/core/resource_core/` (`git log --oneline 85f6b36d..c655dfd4 -- client/godot/core/resource_core` is empty), and input `## spec changes` is `none`, so the code of the module outside its contact points with the changed code was not reviewed again.
- Changed code that ResourceCore calls: `client/godot/core/log_core/log_core.gd` changes only comments (`_escape`, `_event_problem`, `_enqueue_error`), so `LogCore.log_error`, `log_warn` and `log_info` that `client/godot/core/resource_core/resource_core.gd` calls keep their behavior. `client/godot/core/util_core/` and `client/godot/core/local_data_core/` (`UtilCore.is_snake_case`, `LocalDataCore.hash_file`, `LocalDataCore.resolve_engine_path` at `client/godot/core/resource_core/resource_core.gd:776-781`) have no change in the range.
- `client/godot/generated/core_settings.json` and `core_settings_types.json` change only keys of other modules (InputCore, SoundCore, auth, iap, item-ledger, logging, matchmaker, routing); no `ResourceCore.*` key changed.
- Changed code that calls ResourceCore: the new QACore test `loaded_font` calls `ResourceCore.get_loaded("font/main", ResourceCore.BaseKind.FONT, ResourceCore.get_global_scope())` after `LocalizationCore.load_fonts`, which matches `get_loaded` at `client/godot/core/resource_core/resource_core.gd:215`; no other changed file in the range references ResourceCore.
- The ResourceCore core tests were not run, since no code they reach changed in the range.
