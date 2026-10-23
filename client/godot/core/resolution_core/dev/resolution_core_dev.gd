class_name ResolutionCoreDev
extends RefCounted
## DEV operations of `ResolutionCore`.


## Uses `base_resolution`, `window_size`, `fill_mode` and `screen_mode_supported` in place of the settings base
## resolution, the real window size, and the fill mode and screen mode support of the platform, and recalculates.
## Real window size changes after it are not used. `ResolutionCore.release` clears it.
static func set_test_screen(
	base_resolution: Vector2i,
	window_size: Vector2i,
	fill_mode: ResolutionCore.FillMode,
	screen_mode_supported: bool
) -> void:
	ResolutionCore._set_test_screen(base_resolution, window_size, fill_mode, screen_mode_supported)
