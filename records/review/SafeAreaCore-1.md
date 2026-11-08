# SafeAreaCore review round 1

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

- The commit range 85f6b36d..d79c51fd changes no file under `client/godot/core/safe_area_core/` (the module is unchanged since the initial commit 301b3dd8), and no file of `ResolutionCore` or `EventCore`. In `LogCore` (`client/godot/core/log_core/log_core.gd`) it changes only comments. In `client/godot/generated/core_settings.json` it does not change `SafeAreaCore.rotationCheckIntervalMs`. No changed line in `client/godot/` refers to SafeAreaCore, its events or its DEV operations. So the changes of this range cause no finding. I read the module code and tests for problems that existed before the range and found none of severity `medium` or higher.
- `ogw core test godot SafeAreaCore` printed `SafeAreaCore pass` (headless Godot run). The runs on a real `android` or `ios` device were not checked: whether `DisplayServer.get_display_safe_area()` together with `window_get_position()`, and `virtual_keyboard_get_height()`, give window pixels in the same units as `ResolutionCore.get_window_size()` (`client/godot/core/safe_area_core/safe_area_core.gd:288-302`). The tests cover these paths only with the virtual notch, the virtual keyboard and a display safe area of size 0, because there is no device here.
- The `web` runtime was not run (`--web`). Its OS safe area path is the whole window (`safe_area_core.gd:286`), and `tests/test_calculation.gd:150` covers it headless.
