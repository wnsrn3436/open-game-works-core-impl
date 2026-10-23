extends UnitTestCase
## Base of the AccessibilityCore core tests: module start, test voices, saved values and event counting.

const RESOURCES: String = "res://core/accessibility_core/tests/resources/"
const VOICE_SHORT: String = "voice/accessibility_test_short"
const VOICE_LOOP: String = "voice/accessibility_test_loop"
## The resource key of `[ui_button_click]` in the core test data. `UICore.prepare` loads it.
const CLICK: String = "sfx/ui_button_click"
const ERROR: String = "error"
const WARN: String = "warn"
const TAG: String = "AccessibilityCore"
const DEVICE: LocalDataCore.FileKind = LocalDataCore.FileKind.DEVICE
const AUDIO: ResourceCore.BaseKind = ResourceCore.BaseKind.AUDIO_STREAM
const NONE: AccessibilityCore.ColorMode = AccessibilityCore.ColorMode.NONE
const PROTANOPIA: AccessibilityCore.ColorMode = AccessibilityCore.ColorMode.PROTANOPIA
const DEUTERANOPIA: AccessibilityCore.ColorMode = AccessibilityCore.ColorMode.DEUTERANOPIA
const TRITANOPIA: AccessibilityCore.ColorMode = AccessibilityCore.ColorMode.TRITANOPIA
## Every `ColorMode` but `NONE`.
const FILTER_MODES: Array[AccessibilityCore.ColorMode] = [PROTANOPIA, DEUTERANOPIA, TRITANOPIA]
## Test settings every test starts with, so the expected values do not depend on the core settings defaults.
const TEXT_SCALES: PackedInt64Array = [1000, 1250, 1500]
const REDUCED_SHAKE_PERMILLE: int = 250
const REDUCED_FLASH_MAX_OPACITY: float = 0.25
const SUBTITLE_WIDTH_PERMILLE: int = 800
const SUBTITLE_FONT_SIZE: int = 31
const SUBTITLE_PADDING: float = 12.0
const SUBTITLE_BOTTOM_MARGIN: float = 40.0
## Deuteranopia matrix of the tests, row-major.
const DEUTERANOPIA_MATRIX: PackedFloat64Array = [0.5, 0.25, 0.0, 0.25, 0.5, 0.25, 0.75, 0.0, 0.5]
const IDENTITY_MATRIX: PackedFloat64Array = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]

## Scene scope the tests play their voices with.
var scope: Scope = null
## Number of `AccessibilityChangedEvent`s since `count_changes`.
var changes: int = 0


func before_each() -> void:
	super()
	changes = 0
	set_int_array("AccessibilityCore.textScales", TEXT_SCALES)
	set_bool("AccessibilityCore.subtitlesDefault", true)
	set_bool("AccessibilityCore.colorFilterEnabled", true)
	set_matrices(DEUTERANOPIA_MATRIX)
	set_int("AccessibilityCore.reducedShakePermille", REDUCED_SHAKE_PERMILLE)
	set_float("AccessibilityCore.reducedFlashMaxOpacity", REDUCED_FLASH_MAX_OPACITY)
	set_int("AccessibilityCore.subtitleWidthPermille", SUBTITLE_WIDTH_PERMILLE)
	set_float("AccessibilityCore.subtitleBoxOpacity", 0.5)
	set_int("AccessibilityCore.subtitleFontSize", SUBTITLE_FONT_SIZE)
	set_float("AccessibilityCore.subtitlePadding", SUBTITLE_PADDING)
	set_float("AccessibilityCore.subtitleBottomMargin", SUBTITLE_BOTTOM_MARGIN)


func set_int(key: String, value: int) -> void:
	assert_true(UnitTestCore.set_test_settings(key, value), key)


func set_float(key: String, value: float) -> void:
	assert_true(UnitTestCore.set_test_settings(key, value), key)


func set_bool(key: String, value: bool) -> void:
	assert_true(UnitTestCore.set_test_settings(key, value), key)


func set_int_array(key: String, value: PackedInt64Array) -> void:
	assert_true(UnitTestCore.set_test_settings(key, value), key)


## Sets `AccessibilityCore.colorMatrices` with `deuteranopia` for `Deuteranopia` and the identity for the others.
func set_matrices(deuteranopia: PackedFloat64Array) -> void:
	var matrices: Dictionary[String, PackedFloat64Array] = {
		"Protanopia": IDENTITY_MATRIX,
		"Deuteranopia": deuteranopia,
		"Tritanopia": IDENTITY_MATRIX,
	}
	assert_true(UnitTestCore.set_test_settings("AccessibilityCore.colorMatrices", matrices), "colorMatrices")


## Starts the modules AccessibilityCore depends on in dependency order with the test voices and the device file, then
## AccessibilityCore unless `init_accessibility` is false, and makes `scope`. Settings are set before. Async.
func start_modules(init_accessibility: bool = true) -> bool:
	var keys: Dictionary[String, String] = {
		VOICE_SHORT: RESOURCES + "test_voice_short.tres",
		VOICE_LOOP: RESOURCES + "test_voice_loop.tres",
		CLICK: RESOURCES + "test_voice_short.tres",
	}
	ResourceCoreDev.set_test_key_list(keys)
	var started: bool = (
		LogCore.init() and EventCore.init() and TimeCore.init() and LocalDataCore.init() and ResourceCore.init()
		and PoolCore.init() and DataCore.init() and InputBlockCore.init() and ResolutionCore.init()
	)
	assert_true(started, "dependencies init")
	if not started:
		return false
	var loaded: bool = await DataCore.load(null)
	assert_true(loaded, "DataCore.load")
	var device_loaded: bool = LocalDataCore.load_device_file()
	assert_true(device_loaded, "LocalDataCore.load_device_file")
	started = (
		InputCore.init() and LocalizationCore.init() and SoundCore.init() and SafeAreaCore.init() and TweenCore.init()
		and UICore.init() and ScreenEffectCore.init() and CameraCore.init()
	)
	assert_true(started, "dependencies init after the device file")
	if not started:
		return false
	LocalizationCore.resolve_language()
	var translated: bool = await LocalizationCore.load_translation([])
	assert_true(translated, "LocalizationCore.load_translation")
	var ui_ready: bool = await UICore.prepare()
	assert_true(ui_ready, "UICore.prepare")
	scope = ResourceCore.create_scope(ResourceCore.ScopeKind.SCENE, "accessibility_test")
	if not init_accessibility:
		return loaded and device_loaded and translated and ui_ready
	var initialized: bool = AccessibilityCore.init()
	assert_true(initialized, "AccessibilityCore.init")
	return loaded and device_loaded and translated and ui_ready and initialized


## Loads `key` into `scope` so that a `play_voice` of it starts playing in the call. Async.
func load_voice(key: String) -> void:
	var resource: Resource = await ResourceCore.load(key, AUDIO, scope)
	assert_true(resource is AudioStream, key)


## Moves the test clock and lets the modules process one frame of it.
func advance(ms: int) -> void:
	UnitTestCore.advance_clock(ms, false)
	await UnitTestCore.wait_frames(1)


func errors() -> int:
	return UnitTestCore.check_logs(ERROR, TAG)


func warns() -> int:
	return UnitTestCore.check_logs(WARN, TAG)


## Starts counting `AccessibilityChangedEvent`s into `changes`.
func count_changes() -> void:
	changes = 0
	assert_true(EventCore.subscribe(AccessibilityChangedEvent, _on_changed), "subscribe AccessibilityChangedEvent")


func _on_changed(_event: AccessibilityChangedEvent) -> void:
	changes += 1


## A translation key of the core test data whose text the tests show as a subtitle.
func subtitle_key() -> String:
	return ReservedString.auth_age_title()


func other_subtitle_key() -> String:
	return ReservedString.auth_age_year()


## A translation key of the core test data with the format argument `{count}`: "{count} items for you".
func count_subtitle_key() -> String:
	return GameData.MailTemplateTable.get_row(GameDataDev.find_id_value("[mail_mailbox_notice]")).body


func subtitle_visible() -> bool:
	return is_instance_valid(AccessibilityCore._subtitle_box) and AccessibilityCore._subtitle_box.visible


func subtitle_text() -> String:
	return AccessibilityCore._subtitle_label.text


func subtitle_font_size() -> int:
	return AccessibilityCore._subtitle_label.get_theme_font_size(&"font_size")


func assert_settings(
	settings: AccessibilitySettings, text_scale: int, mode: AccessibilityCore.ColorMode, subtitles: bool,
	reduce_shake: bool, reduce_flash: bool, text: String = ""
) -> void:
	assert_eq(settings.text_scale_permille, text_scale, "text scale " + text)
	assert_eq(settings.color_mode, mode, "color mode " + text)
	assert_eq(settings.subtitles, subtitles, "subtitles " + text)
	assert_eq(settings.reduce_shake, reduce_shake, "reduce shake " + text)
	assert_eq(settings.reduce_flash, reduce_flash, "reduce flash " + text)
