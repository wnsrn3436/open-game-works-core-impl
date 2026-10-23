extends UnitTestCase
## Base of the SceneCore core tests: test resources, settings, module start and helpers.

const Trace := preload("res://core/scene_core/tests/support/scene_trace.gd")
const Gate := preload("res://core/scene_core/tests/support/gate.gd")
const TestScene := preload("res://core/scene_core/tests/support/scene_stub.gd")
const TestLoading := preload("res://core/scene_core/tests/support/loading_screen_stub.gd")
const TestPopup := preload("res://core/scene_core/tests/support/popup_stub.gd")
const TestPoolItem := preload("res://core/scene_core/tests/support/pool_item_stub.gd")
const TestPanel := preload("res://core/scene_core/tests/support/panel_stub.gd")
const EventProbe := preload("res://core/scene_core/tests/support/event_probe.gd")

const TAG: String = "SceneCore"
const RESOURCES: String = "res://core/scene_core/tests/resources/"
## Scene with a 2D probe, a canvas layer and a 3D node.
const SCENE_A: String = "scene/scene_core_test_a"
const SCENE_B: String = "scene/scene_core_test_b"
## Scene with a scene UI root.
const SCENE_UI: String = "scene/scene_core_test_ui"
## Scene whose scene UI root has a full rect child `Background` with an ignore mark.
const SCENE_UI_IGNORE: String = "scene/scene_core_test_ui_ignore"
## Scene whose root panel is `PANEL`.
const SCENE_PANEL: String = "scene/scene_core_test_panel"
## Scene whose root panel is `OTHER_PANEL`.
const SCENE_OTHER_PANEL: String = "scene/scene_core_test_other_panel"
## Scene whose root panel is `FAIL_PANEL`.
const SCENE_FAIL_PANEL: String = "scene/scene_core_test_fail_panel"
## Scene resource whose root is not `SceneBase`.
const NOT_SCENE: String = "scene/scene_core_test_not_scene"
## Not in the test key list.
const MISSING: String = "scene/scene_core_test_missing"
const LOADING: String = "prefab/scene_core_test_loading"
## Loading screen resource whose root is not `LoadingScreenBase`.
const BAD_LOADING: String = "prefab/scene_core_test_bad_loading"
const PANEL: String = "prefab/scene_core_test_panel"
const OTHER_PANEL: String = "prefab/scene_core_test_other_panel"
const FAIL_PANEL: String = "prefab/scene_core_test_fail_panel"
const POPUP: String = "prefab/scene_core_test_popup"
const POOL_ITEM: String = "prefab/scene_core_test_pool_item"
const PRELOAD_ITEM: String = "prefab/scene_core_test_preload_item"
const BLOCK_TWEEN: String = "tween/scene_core_test_block"
## The resource key of `[ui_button_click]` in the core test data. `UICore.prepare` loads it.
const CLICK: String = "sfx/ui_button_click"
const RETRY_COUNT: int = 2
## Base resolution of the core test data and window size of the test screen of `set_notch_screen`.
const SCREEN: Vector2i = Vector2i(1280, 720)
const ERROR: String = "error"
const WARN: String = "warn"

var _blocks: Array[ActiveBlockInfo] = []
## Subscriber of the SceneCore events and boot events. Subscribed by `start_modules`.
var probe: EventProbe = null


func before_each() -> void:
	super()
	Trace.clear()
	TestScene.reset()
	TestLoading.reset()
	TestPopup.gate = null
	TestPanel.prepare_gate = null
	TestPoolItem.preload_was_loaded = false
	probe = EventProbe.new()
	add_child_autofree(probe)
	set_string("loadingScreen", LOADING)
	set_int("SceneCore.loadingMinDisplayMs", 0)
	set_int("SceneCore.prepareRetryCount", RETRY_COUNT)
	_blocks.resize(16)


func set_string(key: String, value: String) -> void:
	assert_true(UnitTestCore.set_test_settings(key, value), key)


func set_int(key: String, value: int) -> void:
	assert_true(UnitTestCore.set_test_settings(key, value), key)


static func resource_keys() -> Dictionary[String, String]:
	var keys: Dictionary[String, String] = {
		SCENE_A: RESOURCES + "scene_a.tscn",
		SCENE_B: RESOURCES + "scene_b.tscn",
		SCENE_UI: RESOURCES + "scene_ui.tscn",
		SCENE_UI_IGNORE: RESOURCES + "scene_ui_ignore.tscn",
		SCENE_PANEL: RESOURCES + "scene_panel.tscn",
		SCENE_OTHER_PANEL: RESOURCES + "scene_other_panel.tscn",
		SCENE_FAIL_PANEL: RESOURCES + "scene_fail_panel.tscn",
		NOT_SCENE: RESOURCES + "not_scene.tscn",
		LOADING: RESOURCES + "loading.tscn",
		BAD_LOADING: RESOURCES + "bad_loading.tscn",
		PANEL: RESOURCES + "panel.tscn",
		OTHER_PANEL: RESOURCES + "other_panel.tscn",
		FAIL_PANEL: RESOURCES + "fail_panel.tscn",
		POPUP: RESOURCES + "popup.tscn",
		POOL_ITEM: RESOURCES + "pool_item.tscn",
		PRELOAD_ITEM: RESOURCES + "preload_item.tscn",
		BLOCK_TWEEN: RESOURCES + "block_tween.tres",
		CLICK: RESOURCES + "click.tres",
	}
	return keys


## Starts the modules SceneCore depends on in module list order with the device file, the core test data and
## translation, prepares `UICore` and `MessageCore`, and inits SceneCore unless `init_scene` is false. Settings are
## set before. Async.
func start_modules(init_scene: bool = true) -> bool:
	ResourceCoreDev.set_test_key_list(resource_keys())
	var started: bool = (
		LogCore.init() and EventCore.init() and TimeCore.init() and LocalDataCore.init()
		and LocalDataCore.load_device_file() and ResourceCore.init() and PoolCore.init() and DataCore.init()
		and ResolutionCore.init() and SafeAreaCore.init() and InputBlockCore.init() and InputCore.init()
		and LocalizationCore.init() and SoundCore.init() and TweenCore.init() and UICore.init()
		and ScreenEffectCore.init() and MessageCore.init()
	)
	assert_true(started, "dependencies init")
	if not started:
		return false
	probe.subscribe()
	var loaded: bool = await DataCore.load(null)
	assert_true(loaded, "DataCore.load")
	LocalizationCore.resolve_language()
	var translated: bool = await LocalizationCore.load_translation([])
	assert_true(translated, "LocalizationCore.load_translation")
	var ui_ready: bool = await UICore.prepare()
	assert_true(ui_ready, "UICore.prepare")
	var message_ready: bool = await MessageCore.prepare()
	assert_true(message_ready, "MessageCore.prepare")
	if not (loaded and translated and ui_ready and message_ready):
		return false
	if not init_scene:
		return true
	var initialized: bool = SceneCore.init()
	assert_true(initialized, "SceneCore.init")
	return initialized


## `start_modules` and a successful `boot_change_scene` to `scene_key`. Async.
func start_booted(scene_key: String = SCENE_A) -> bool:
	if not await start_modules():
		return false
	var ok: bool = await SceneCore.boot_change_scene(scene_key, null)
	assert_true(ok, "boot_change_scene")
	return ok


## Calls `change_scene` without waiting for it. `results` gets 1 or 0 when it ends.
func change_later(scene_key: String, results: PackedInt32Array) -> void:
	var ok: bool = await SceneCore.change_scene(scene_key, null)
	results.append(1 if ok else 0)


## Calls `boot_change_scene` without waiting for it. `results` gets 1 or 0 when it ends.
func boot_later(scene_key: String, results: PackedInt32Array) -> void:
	var ok: bool = await SceneCore.boot_change_scene(scene_key, null)
	results.append(1 if ok else 0)


## Waits until the scene trace has `entry`. The test goes on at the start of a frame, not inside the callback that
## added the entry, so the transition step of that callback has returned. The wait also ends when SceneCore is
## released, as the test time limit does, so that a failing test ends.
func wait_trace(entry: String) -> void:
	await wait_trace_count(entry, 1)


## Waits until the scene trace has `entry` `count` times. Goes on and ends like `wait_trace`.
func wait_trace_count(entry: String, count: int) -> void:
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	while Trace.count(entry) < count:
		if not SceneCore.is_initialized():
			fail_test("SceneCore was released while waiting for %s x%d" % [entry, count])
			return
		await tree.process_frame


## Sets a test screen for `SafeAreaCoreDev.set_virtual_notch`: the headless window is too small for a notch.
func set_notch_screen() -> void:
	ResolutionCoreDev.set_test_screen(SCREEN, SCREEN, ResolutionCore.FillMode.LETTERBOX, true)
	await UnitTestCore.wait_frames(2)


## Moves the test clock and lets the modules process it.
func advance(ms: int) -> void:
	UnitTestCore.advance_clock(ms, false)
	await UnitTestCore.wait_frames(2)


func errors(tag: String) -> int:
	return UnitTestCore.check_logs(ERROR, tag)


func warns(tag: String) -> int:
	return UnitTestCore.check_logs(WARN, tag)


## Reason tags of the active blocks.
func active_reasons() -> PackedStringArray:
	var reasons: PackedStringArray = PackedStringArray()
	var count: int = InputBlockCoreDev.list_active(_blocks)
	for i: int in count:
		reasons.append(_blocks[i].reason)
	return reasons


## Number of active blocks with reason tag `scene`.
func scene_blocks() -> int:
	return active_reasons().count("scene")


## Label translation key of the button of the last retry popup.
func retry_popup_label() -> String:
	var param: SystemPopupParam = SceneCore._popup_param
	if param == null or param.buttons.is_empty():
		return ""
	return param.buttons[0].label


## The visible buttons of the visible system popup.
func system_popup_buttons() -> Array[Button]:
	var buttons: Array[Button] = []
	var pass_list: BlockPassList = UICore.get_block_pass_list()
	if pass_list == null or pass_list.elements.is_empty():
		return buttons
	var root: Control = pass_list.elements[0]
	for node: Node in root.find_children("*", "Button", true, false):
		var button: Button = node as Button
		if button != null and button.is_visible_in_tree():
			buttons.append(button)
	return buttons


## Taps the first button of the visible system popup. Async: first moves the test clock past the UI button click
## interval of an earlier tap, then waits for the frames of the input and the popup close.
func tap_system_popup_button() -> bool:
	var buttons: Array[Button] = system_popup_buttons()
	if buttons.is_empty():
		return false
	await advance(CoreSettings.get_int("UICore.buttonClickIntervalMs"))
	UnitTestCore.tap(buttons[0].get_global_rect().get_center())
	await UnitTestCore.wait_frames(3)
	return true


## Lets the system popup open flow lay out.
func wait_popup_layout() -> void:
	await UnitTestCore.wait_frames(3)


## Number of visible message objects (toasts and black boxes) in the `Message` layer.
func visible_messages() -> int:
	var count: int = 0
	var layer: Node = UICore.get_layer(UICore.UILayer.MESSAGE)
	for node: Node in layer.find_children("*", "Label", true, false):
		var label: Label = node as Label
		if label != null and label.is_visible_in_tree():
			count += 1
	return count


## Opacity of the `Transition` channel overlay.
func transition_opacity() -> float:
	var state: GetOverlayStateResult = ScreenEffectCoreDev.get_overlay_state(ScreenEffectCore.ScreenEffectChannel.TRANSITION)
	return state.opacity
