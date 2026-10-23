extends RefCounted
## Starts and stops `QualityCore` with the modules it depends on, sets the common test settings, runs measured frames
## and reads the saved values, for the core tests of `QualityCore`.

const TAG: String = "QualityCore"
const KEY_OVERRIDE: String = "QualityCore.override_level"
const KEY_AUTO: String = "QualityCore.auto_level"
const DEVICE: LocalDataCore.FileKind = LocalDataCore.FileKind.DEVICE

## Common test settings: `targetFps` 60; frame limits Low 30, Medium 60, High 60.
const TARGET_FPS: int = 60
const LOW_RENDER_SCALE: int = 500
const MEDIUM_RENDER_SCALE: int = 800
const LOW_FPS: int = 30
const MEDIUM_FPS: int = 60
const HIGH_FPS: int = 60
## Device class items: `High` from 8000 bytes and 8 processors, `Medium` from 4000 bytes and 4 processors.
const HIGH_MEMORY: int = 8000
const HIGH_PROCESSORS: int = 8
const MEDIUM_MEMORY: int = 4000
const MEDIUM_PROCESSORS: int = 4
const DEVICE_CLASSES_JSON: String = (
	'[{"level": "High", "minMemoryBytes": 8000, "minProcessorCount": 8},'
	+ ' {"level": "Medium", "minMemoryBytes": 4000, "minProcessorCount": 4}]'
)
## Auto downgrade: window 1000 ms, 800 permille of the base FPS, frames over 100 ms dropped.
const WINDOW_MS: int = 1000
const FPS_PERMILLE: int = 800
const HITCH_MS: int = 100


## Sets the common test settings. Call before `start`.
static func set_common_settings() -> void:
	UnitTestCore.set_test_settings("targetFps", TARGET_FPS)
	set_json("QualityCore.levels", levels_json(500, 1000, 1000))
	set_json("QualityCore.deviceClasses", DEVICE_CLASSES_JSON)
	UnitTestCore.set_test_settings("QualityCore.autoDowngradeEnabled", true)
	UnitTestCore.set_test_settings("QualityCore.autoDowngradeWindowMs", WINDOW_MS)
	UnitTestCore.set_test_settings("QualityCore.autoDowngradeFpsPermille", FPS_PERMILLE)
	UnitTestCore.set_test_settings("QualityCore.hitchFrameMs", HITCH_MS)


## Sets the test value of the core settings `key` to the value of the JSON text `json`.
# ogw:input_boundary
static func set_json(key: String, json: String) -> void:
	var value: Variant = JSON.parse_string(json)
	UnitTestCore.set_test_settings(key, value)


## Sets the test value of the core settings `key` to the value of the JSON text `json`, whose type may differ from the
## type of the key.
# ogw:input_boundary
static func set_invalid_json(key: String, json: String) -> void:
	var value: Variant = JSON.parse_string(json)
	UnitTestCore.set_invalid_test_settings(key, value)


## JSON text of a `QualityCore.levels` value: Low render scale 500, shadow Off, density 300; Medium 800, Low, 600;
## High 1000, High, 1000; with the given frame limit permille of each level.
static func levels_json(low_frame_limit: int, medium_frame_limit: int, high_frame_limit: int) -> String:
	return '{"Low": %s, "Medium": %s, "High": %s}' % [
		level_json(LOW_RENDER_SCALE, "Off", 300, low_frame_limit),
		level_json(MEDIUM_RENDER_SCALE, "Low", 600, medium_frame_limit),
		level_json(1000, "High", 1000, high_frame_limit),
	]


static func level_json(render_scale: int, shadow: String, effect_density: int, frame_limit: int) -> String:
	return '{"renderScalePermille": %d, "shadow": "%s", "effectDensityPermille": %d, "frameLimitPermille": %d}' % [
		render_scale, shadow, effect_density, frame_limit
	]


## Inits the modules `QualityCore` depends on that are not initialized, in dependency order, loads the device file,
## and inits `QualityCore`. True when all succeed.
static func start() -> bool:
	if not start_dependencies():
		return false
	return QualityCore.init()


## Inits the dependencies that are not initialized and loads the device file. A test keeps `LogCore`, `EventCore` and
## `TimeCore` initialized until `stop`: their `release` clears the log listener and the test clock of the test.
static func start_dependencies() -> bool:
	if not LogCore.is_initialized() and not LogCore.init():
		return false
	if not EventCore.is_initialized() and not EventCore.init():
		return false
	if not TimeCore.is_initialized() and not TimeCore.init():
		return false
	if not LocalDataCore.is_initialized() and not LocalDataCore.init():
		return false
	if LocalDataCore.is_loaded(DEVICE):
		return true
	return LocalDataCore.load_device_file()


## `start`, the test device info and `apply_saved_level`. The refresh rate is unread.
static func start_applied(memory: int = HIGH_MEMORY, processors: int = HIGH_PROCESSORS) -> bool:
	if not start():
		return false
	QualityCoreDev.set_test_device_info(memory, processors, -1)
	QualityCore.apply_saved_level()
	return true


## Releases `QualityCore` and `LocalDataCore`, which writes the device file. `start` reads it again.
static func release_quality() -> void:
	QualityCore.release()
	LocalDataCore.release()


## Releases the modules `start` inits, in reverse order.
static func stop() -> void:
	QualityCore.release()
	LocalDataCore.release()
	TimeCore.release()
	EventCore.release()
	LogCore.release()


## Runs `count` engine frames of `ms` real elapsed time each, then one more frame so the last one is measured and the
## deferred downgrade has run.
static func run_frames(count: int, ms: int) -> void:
	for i: int in count:
		await UnitTestCore.wait_frames(1)
		UnitTestCore.advance_clock(ms, false)
	await UnitTestCore.wait_frames(1)


static func saved(key: String) -> String:
	return LocalDataCore.get_value_string(DEVICE, key, "")


static func save(key: String, value: String) -> void:
	LocalDataCore.set_value_string(DEVICE, key, value)


static func errors(tag: String = TAG) -> int:
	return UnitTestCore.check_logs("error", tag)


static func warnings(tag: String = TAG) -> int:
	return UnitTestCore.check_logs("warn", tag)


static func render_scale() -> float:
	return (Engine.get_main_loop() as SceneTree).root.scaling_3d_scale
