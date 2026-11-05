# review LocalizationCore round 1

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

- Scope checked: the LocalizationCore changes of 51d323b..9d6b79f in client/godot/core/localization_core/ (localization_core.gd `bind_text`, `unbind_text`, `_check_text_element`, `release`; dev/localization_core_dev.gd `set_test_timezone_offset`; tests test_format.gd, test_lifecycle.gd, test_text_binding.gd), the callers of `bind_text`/`unbind_text` in client/godot/core/auth_core/auth_popup_util.gd and client/godot/core/tutorial_core/tutorial_core.gd, and `_timezone_offset_ms`/`_build`, which read the DEV offset. These were compared with `### text binding`, `## error`, `## DEV` and `## test` of the LocalizationCore spec and with the DEV code rules of the Godot implementation rules
- `ogw core test godot LocalizationCore` (native run) passed. The browser run (`--web`) was not run
- Whether the new tests fail on code with the defect restored (range check of `set_test_timezone_offset` removed, `bind_text` keeping the first key, `unbind_text` logging for an element that is not bound) was checked only by reading the test assertions, not by running them on a temporary copy with the defect put back
- A `bind_text`/`unbind_text` argument that is a `Node` but not a `Control` (e.g. `Node2D`) hits the `Control` parameter type of the GDScript signature before the error-log path runs. The signature is unchanged in this range, and the Godot implementation rules do not state the engine type of that parameter, so this was not judged
