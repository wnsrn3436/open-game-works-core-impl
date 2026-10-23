extends UnitTestCase
## Base of the ScreenEffectCore core tests: module start, tween definitions, result and event recording.

const ERROR: String = "error"
## The resource key of `[ui_button_click]` in the core test data. `UICore.prepare` loads it.
const CLICK: String = "sfx/ui_button_click"
const RESOURCES: String = "res://core/screen_effect_core/tests/resources/"
const MAX_DURATION_MS: int = 10000
const WORLD: ScreenEffectCore.ScreenEffectChannel = ScreenEffectCore.ScreenEffectChannel.WORLD
const CUTSCENE: ScreenEffectCore.ScreenEffectChannel = ScreenEffectCore.ScreenEffectChannel.CUTSCENE
const TRANSITION: ScreenEffectCore.ScreenEffectChannel = ScreenEffectCore.ScreenEffectChannel.TRANSITION
const CHANNELS: Array[ScreenEffectCore.ScreenEffectChannel] = [WORLD, CUTSCENE, TRANSITION]
const COMPLETED: ScreenEffectCore.ScreenEffectResult = ScreenEffectCore.ScreenEffectResult.COMPLETED
const CANCELLED: ScreenEffectCore.ScreenEffectResult = ScreenEffectCore.ScreenEffectResult.CANCELLED
const FAILED: ScreenEffectCore.ScreenEffectResult = ScreenEffectCore.ScreenEffectResult.FAILED
const OPACITY_EPSILON: float = 0.0001

## Results recorded by `record`, in the order they were set.
var results: Array[ScreenEffectCore.ScreenEffectResult] = []
## Channels of the `ScreenEffectStartedEvent`s received since `count_started`.
var started_channels: Array[ScreenEffectCore.ScreenEffectChannel] = []


func before_each() -> void:
	super()
	results.clear()
	started_channels.clear()
	assert_true(UnitTestCore.set_test_settings("TweenCore.maxDurationMs", MAX_DURATION_MS), "TweenCore.maxDurationMs")


## Starts the modules ScreenEffectCore depends on in dependency order, loads the device file, then ScreenEffectCore
## unless `init_effect` is false. Async.
func start_modules(init_effect: bool = true) -> bool:
	var keys: Dictionary[String, String] = {CLICK: RESOURCES + "test_click.tres"}
	ResourceCoreDev.set_test_key_list(keys)
	var started: bool = (
		LogCore.init() and EventCore.init() and TimeCore.init() and LocalDataCore.init() and ResourceCore.init()
		and PoolCore.init() and DataCore.init() and InputBlockCore.init() and ResolutionCore.init()
		and InputCore.init() and LocalizationCore.init() and SoundCore.init() and SafeAreaCore.init()
		and TweenCore.init() and UICore.init()
	)
	assert_true(started, "dependencies init")
	if not started:
		return false
	var device_loaded: bool = LocalDataCore.load_device_file()
	assert_true(device_loaded, "LocalDataCore.load_device_file")
	if not device_loaded:
		return false
	var loaded: bool = await DataCore.load(null)
	assert_true(loaded, "DataCore.load")
	LocalizationCore.resolve_language()
	var translated: bool = await LocalizationCore.load_translation([])
	assert_true(translated, "LocalizationCore.load_translation")
	var ui_ready: bool = await UICore.prepare()
	assert_true(ui_ready, "UICore.prepare")
	if not init_effect:
		return loaded and translated and ui_ready
	var initialized: bool = ScreenEffectCore.init()
	assert_true(initialized, "ScreenEffectCore.init")
	return loaded and translated and ui_ready and initialized


## A node that owns effects. Freed after the test unless the test frees it.
func make_owner() -> Node:
	var owner: Node = Node.new()
	add_child(owner)
	autofree(owner)
	return owner


## Moves the test clock and lets the modules process it.
func advance(ms: int) -> void:
	UnitTestCore.advance_clock(ms, false)
	await UnitTestCore.wait_frames(2)


func errors() -> int:
	return UnitTestCore.check_logs(ERROR, ScreenEffectCore._TAG)


func state(channel: ScreenEffectCore.ScreenEffectChannel) -> GetOverlayStateResult:
	return ScreenEffectCoreDev.get_overlay_state(channel)


## Starts waiting for the result of `handle`; the result is appended to `results` when it is set. A handle with its
## result appends before this returns.
func record(handle: ScreenEffectHandle) -> void:
	var result: ScreenEffectCore.ScreenEffectResult = await ScreenEffectCore.wait_result(handle)
	results.append(result)


## True when `handle` has its result: a `wait_result` started now returns without waiting.
func is_settled(handle: ScreenEffectHandle) -> bool:
	var before: int = results.size()
	record(handle)
	var settled: bool = results.size() > before
	if not settled:
		assert_true(false, "the handle has no result yet")
	return settled


## Starts collecting `ScreenEffectStartedEvent` channels into `started_channels`.
func count_started() -> void:
	started_channels.clear()
	assert_true(EventCore.subscribe(ScreenEffectStartedEvent, _on_started))


func _on_started(event: ScreenEffectStartedEvent) -> void:
	started_channels.append(event.channel)


## A tween definition with one step per change, in order.
func make_definition(changes: Array[TweenChange], repeat_count: int = 1) -> TweenDefinition:
	var definition: TweenDefinition = TweenDefinition.new()
	definition.repeat_count = repeat_count
	for change: TweenChange in changes:
		var step: TweenStep = TweenStep.new()
		step.changes.append(change)
		definition.steps.append(step)
	return definition


func opacity_change(target: float, duration_ms: int) -> TweenChange:
	return make_change(TweenCore.TweenProperty.OPACITY, Vector4(target, 0.0, 0.0, 0.0), duration_ms)


func color_change(target: Color, duration_ms: int) -> TweenChange:
	return make_change(
		TweenCore.TweenProperty.COLOR, Vector4(target.r, target.g, target.b, target.a), duration_ms
	)


func make_change(property: TweenCore.TweenProperty, target: Vector4, duration_ms: int) -> TweenChange:
	var change: TweenChange = TweenChange.new()
	change.property = property
	change.target_value = target
	change.use_start_value = false
	change.duration = duration_ms
	change.delay = 0
	change.easing = TweenCore.Easing.LINEAR
	return change


func assert_overlay(
	channel: ScreenEffectCore.ScreenEffectChannel, color: Color, opacity: float, visible: bool, text: String = ""
) -> void:
	var overlay: GetOverlayStateResult = state(channel)
	assert_eq(overlay.color, Color(color.r, color.g, color.b), "color " + text)
	assert_almost_eq(overlay.opacity, opacity, OPACITY_EPSILON, "opacity " + text)
	assert_eq(overlay.visible, visible, "visible " + text)


## Black, opacity 0, hidden.
func assert_no_effect(channel: ScreenEffectCore.ScreenEffectChannel, text: String = "") -> void:
	assert_overlay(channel, Color.BLACK, 0.0, false, text)


func assert_results(expected: Array[ScreenEffectCore.ScreenEffectResult]) -> void:
	assert_eq(results, expected, "recorded results")
