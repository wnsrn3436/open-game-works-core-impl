# DataCore review round 1

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

- The commit range 85f6b36d..9808fd47 changes no file of `client/godot/core/data_core/`, of `client/godot/core/local_data_core/`, of UtilCore, of the data tool or of the generated data code (`GameData`). Of the code DataCore calls, only `client/godot/core/log_core/log_core.gd` changed, and that change is comments only (lines 270, 350, 359-360); `LogCore.log_error` behavior is unchanged. `client/godot/generated/core_settings.json` keeps `DataCore.downloadedFileMaxBytes` unchanged, and `test-data/settings.json` only adds `pixelRatio`, which DataCore does not read. So no finding comes from the range
- `ogw core test godot DataCore` passes on 9808fd47
- `client/godot/core/data_core/data_core.gd` was read for problems that existed before the range (`## out of scope`); none of severity `medium` or higher was found. The generated `GameData` load entry point, `is_key_column` and `key_value` were not read, since nothing in the range changed them
- Engine-export behavior of `DirAccess.get_files()` on `res://build/data/` in an exported build (validation 3 and `_builtin_table_names`) was not run; only the editor/dev run of the core test was checked
