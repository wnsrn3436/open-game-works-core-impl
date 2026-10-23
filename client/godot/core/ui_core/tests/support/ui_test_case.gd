extends UnitTestCase
## Base of the UICore core tests: settings, test resources, module start, the test log and helpers.

const LOG := preload("res://core/ui_core/tests/support/ui_test_log.gd")
const GATE := preload("res://core/ui_core/tests/support/ui_test_gate.gd")
const CALL := preload("res://core/ui_core/tests/support/ui_call.gd")
const TEST_CACHE := preload("res://core/ui_core/tests/support/ui_test_cache.gd")
const TEST_PARAM := preload("res://core/ui_core/tests/support/ui_test_param.gd")
const TEST_ITEM := preload("res://core/ui_core/tests/support/ui_test_item.gd")

const RESOURCES: String = "res://core/ui_core/tests/resources/"
const PANEL_A: String = "prefab/ui_test_panel_a"
const PANEL_B: String = "prefab/ui_test_panel_b"
const PANEL_C: String = "prefab/ui_test_panel_c"
const PANEL_D: String = "prefab/ui_test_panel_d"
const PANEL_R: String = "prefab/ui_test_panel_r"
const PANEL_CUSTOM: String = "prefab/ui_test_panel_custom"
const PANEL_IGNORE: String = "prefab/ui_test_panel_ignore"
const PANEL_NONMODAL: String = "prefab/ui_test_panel_nonmodal"
const PANEL_TWEEN: String = "prefab/ui_test_panel_tween"
const PANEL_SCROLL: String = "prefab/ui_test_panel_scroll"
const NOT_PANEL: String = "prefab/ui_test_not_panel"
const NODE_ROOT: String = "prefab/ui_test_node_root"
const FRAME: String = "prefab/ui_test_frame"
const POPUP_A: String = "prefab/ui_test_popup_a"
const POPUP_B: String = "prefab/ui_test_popup_b"
const POPUP_C: String = "prefab/ui_test_popup_c"
const POPUP_DIM_A: String = "prefab/ui_test_popup_dim_a"
const POPUP_DIM_B: String = "prefab/ui_test_popup_dim_b"
const POPUP_NONMODAL: String = "prefab/ui_test_popup_nonmodal"
const POPUP_CUSTOM: String = "prefab/ui_test_popup_custom"
const POPUP_IGNORE: String = "prefab/ui_test_popup_ignore"
const POPUP_TWEEN: String = "prefab/ui_test_popup_tween"
const POPUP_FOCUS: String = "prefab/ui_test_popup_focus"
const POPUP_TEXT: String = "prefab/ui_test_popup_text"
const ITEM: String = "prefab/ui_test_item"
const ITEM_MEASURED: String = "prefab/ui_test_item_measured"
## A `VBoxContainer` root whose minimum size comes from its own sort of an autowrap `Label`.
const ITEM_WRAPPED: String = "prefab/ui_test_item_wrapped"
const LOADING_ITEM: String = "prefab/ui_test_loading_item"
const TWEEN: String = "tween/ui_test_tween"
## The resource key of `[ui_button_click]` in the core test data.
const CLICK: String = "sfx/ui_button_click"
## Not in the test key list.
const MISSING: String = "prefab/ui_test_missing"

## Length of the test tween preset: one 100 ms change, repeat count 1.
const TWEEN_MS: int = 100
const CLICK_INTERVAL_MS: int = 300
const THRESHOLD: int = 3
const KEYBOARD_GAP: float = 10.0
const SCROLL_STEP: float = 40.0
const MARGIN_MS: int = 500
const MAX_BLOCK_MS: int = 5000
const DAY_MS: int = 86400000
## A server time far from the game day boundaries of the offsets the tests use.
const SERVER_TIME: int = 1710000000000
const TAG: String = "UICore"
const ERROR: String = "error"
const WARN: String = "warn"

var hidden_calls: PackedStringArray = PackedStringArray()
var after_calls: PackedStringArray = PackedStringArray()
var opened_events: PackedStringArray = PackedStringArray()
var closed_events: PackedStringArray = PackedStringArray()
## Opened and closed events in order, as `opened:<key>` and `closed:<key>`.
var ui_events: PackedStringArray = PackedStringArray()
var finished_events: PackedStringArray = PackedStringArray()
## Real elapsed time of every `PanelFlowFinishedEvent` with `is_panel_transitioning` at that time.
var transitioning_at_finish: Array[bool] = []
var ui_sounds: int = 0
## `TweenStartedEvent`s.
var tweens_started: int = 0
var clicks: PackedStringArray = PackedStringArray()


func before_each() -> void:
	super()
	LOG.reset()
	hidden_calls = PackedStringArray()
	after_calls = PackedStringArray()
	opened_events = PackedStringArray()
	closed_events = PackedStringArray()
	ui_events = PackedStringArray()
	finished_events = PackedStringArray()
	transitioning_at_finish = []
	ui_sounds = 0
	tweens_started = 0
	clicks = PackedStringArray()
	set_int("UICore.buttonClickIntervalMs", CLICK_INTERVAL_MS)
	set_string("UICore.dimResource", "")
	set_float("UICore.dimOpacity", 0.5)
	set_string("UICore.loadingIconResource", "")
	set_string("UICore.systemPopupResource", "")
	set_int("UICore.scrollLoadThresholdItems", THRESHOLD)
	set_float("UICore.keyboardGap", KEYBOARD_GAP)
	set_float("UICore.systemPopupScrollStep", SCROLL_STEP)
	set_int("TimeCore.reachMarginMs", MARGIN_MS)
	set_int("dailyResetOffsetMs", 0)
	set_int("InputBlockCore.maxDurationMs", MAX_BLOCK_MS)


func set_int(key: String, value: int) -> void:
	assert_true(UnitTestCore.set_test_settings(key, value), key)


func set_float(key: String, value: float) -> void:
	assert_true(UnitTestCore.set_test_settings(key, value), key)


func set_string(key: String, value: String) -> void:
	assert_true(UnitTestCore.set_test_settings(key, value), key)


## The test key list: every test prefab and resource, and `[ui_button_click]`.
func resource_keys() -> Dictionary[String, String]:
	var keys: Dictionary[String, String] = {
		PANEL_A: RESOURCES + "test_panel.tscn",
		PANEL_B: RESOURCES + "test_panel.tscn",
		PANEL_C: RESOURCES + "test_panel.tscn",
		PANEL_D: RESOURCES + "test_panel.tscn",
		PANEL_R: RESOURCES + "test_panel.tscn",
		PANEL_CUSTOM: RESOURCES + "test_panel_custom.tscn",
		PANEL_IGNORE: RESOURCES + "test_panel_ignore.tscn",
		PANEL_NONMODAL: RESOURCES + "test_panel_nonmodal.tscn",
		PANEL_TWEEN: RESOURCES + "test_panel_tween.tscn",
		PANEL_SCROLL: RESOURCES + "test_panel_scroll.tscn",
		NOT_PANEL: RESOURCES + "test_not_panel.tscn",
		NODE_ROOT: RESOURCES + "test_node_root.tscn",
		FRAME: RESOURCES + "test_frame.tscn",
		POPUP_A: RESOURCES + "test_popup.tscn",
		POPUP_B: RESOURCES + "test_popup.tscn",
		POPUP_C: RESOURCES + "test_popup.tscn",
		POPUP_DIM_A: RESOURCES + "test_popup_dim.tscn",
		POPUP_DIM_B: RESOURCES + "test_popup_dim.tscn",
		POPUP_NONMODAL: RESOURCES + "test_popup_nonmodal.tscn",
		POPUP_CUSTOM: RESOURCES + "test_popup_custom.tscn",
		POPUP_IGNORE: RESOURCES + "test_popup_ignore.tscn",
		POPUP_TWEEN: RESOURCES + "test_popup_tween.tscn",
		POPUP_FOCUS: RESOURCES + "test_popup_focus.tscn",
		POPUP_TEXT: RESOURCES + "test_popup_text.tscn",
		ITEM: RESOURCES + "test_item.tscn",
		ITEM_MEASURED: RESOURCES + "test_item_measured.tscn",
		ITEM_WRAPPED: RESOURCES + "test_item_wrapped.tscn",
		LOADING_ITEM: RESOURCES + "test_loading_item.tscn",
		TWEEN: RESOURCES + "test_tween.tres",
	}
	keys[CLICK] = RESOURCES + "test_click.tres"
	return keys


## Starts the modules UICore depends on in module list order, loads the device file as the boot does, and loads the
## core test data and translation, then the test resources unless `load_all` is false, then UICore
## unless `init_ui` is false, and `UICore.prepare` when `prepare` is true. Settings are set before. Async.
func start(init_ui: bool = true, prepare: bool = true, load_all: bool = true) -> bool:
	ResourceCoreDev.set_test_key_list(resource_keys())
	var started: bool = (
		LogCore.init() and EventCore.init() and TimeCore.init() and LocalDataCore.init() and ResourceCore.init()
		and PoolCore.init() and DataCore.init() and InputBlockCore.init() and ResolutionCore.init()
		and InputCore.init() and LocalizationCore.init() and SoundCore.init() and SafeAreaCore.init()
		and TweenCore.init()
	)
	assert_true(started, "dependencies init")
	if not started:
		return false
	assert_true(LocalDataCore.load_device_file(), "LocalDataCore.load_device_file")
	var loaded: bool = await DataCore.load(null)
	assert_true(loaded, "DataCore.load")
	assert_eq(ReservedSound.ui_button_click(), CLICK, "the core test data key of [ui_button_click]")
	LocalizationCore.resolve_language()
	var translated: bool = await LocalizationCore.load_translation([])
	assert_true(translated, "LocalizationCore.load_translation")
	if load_all:
		assert_true(await load_resources(), "load the test resources")
	assert_true(EventCore.subscribe(UIOpenedEvent, _on_opened), "subscribe UIOpenedEvent")
	assert_true(EventCore.subscribe(UIClosedEvent, _on_closed), "subscribe UIClosedEvent")
	assert_true(EventCore.subscribe(PanelFlowFinishedEvent, _on_finished), "subscribe PanelFlowFinishedEvent")
	assert_true(EventCore.subscribe(SoundPlayedEvent, _on_sound), "subscribe SoundPlayedEvent")
	assert_true(EventCore.subscribe(TweenStartedEvent, _on_tween_started), "subscribe TweenStartedEvent")
	if not init_ui:
		return loaded and translated
	var initialized: bool = UICore.init()
	assert_true(initialized, "UICore.init")
	if not initialized or not prepare:
		return loaded and translated and initialized
	var prepared: bool = await UICore.prepare()
	assert_true(prepared, "UICore.prepare")
	return loaded and translated and prepared


## Loads every resource of the test key list into the global scope and waits for the result. The threaded loads end
## before a test flow starts, so the UICore flows take the cached resources and the frames a test waits for are the
## frames of those flows, not of the engine load threads.
func load_resources() -> bool:
	var request: PreloadRequest = PreloadRequest.new()
	for key: String in resource_keys():
		var kind: int = ResourceCore.BaseKind.PACKED_SCENE
		if key == TWEEN:
			kind = TweenCore.get_preset_kind()
		elif key == CLICK:
			kind = ResourceCore.BaseKind.AUDIO_STREAM
		request.add_item(key, kind)
	return await ResourceCore.preload_resources(request, ResourceCore.get_global_scope())


## Waits for the event of `latch`, made before the operation that publishes it, then one frame, so that the operation
## ends the call that published it. The event ends the wait, not a frame count; the test time limit ends it too.
## Returns whether the event came.
func wait_event(latch: UnitTestLatch) -> bool:
	await UnitTestCore.wait_latch(latch)
	await UnitTestCore.wait_frames(1)
	return latch.happened


func _on_opened(event: UIOpenedEvent) -> void:
	opened_events.append("%s:%s" % [event.key, LOG.open_reason(event.reason)])
	ui_events.append("opened:" + event.key)


func _on_closed(event: UIClosedEvent) -> void:
	closed_events.append("%s:%s" % [event.key, LOG.close_reason(event.reason)])
	ui_events.append("closed:" + event.key)


func _on_finished(event: PanelFlowFinishedEvent) -> void:
	finished_events.append("%s:%s:%s" % [event.panel_key, event.is_open, event.success])
	transitioning_at_finish.append(UICore.is_panel_transitioning())


func _on_tween_started(_event: TweenStartedEvent) -> void:
	tweens_started += 1


func _on_sound(event: SoundPlayedEvent) -> void:
	if event.bus == SoundCore.SoundBus.UI:
		ui_sounds += 1


## A hidden callback that records `label`.
func hidden_of(label: String) -> Callable:
	return _on_hidden.bind(label)


func _on_hidden(label: String) -> void:
	hidden_calls.append(label)


## An after-close callback that records `label`.
func after_of(label: String) -> Callable:
	return _on_after.bind(label)


func _on_after(label: String) -> void:
	after_calls.append(label)


## A click callback that records `label`.
func click_of(label: String) -> Callable:
	return _on_click.bind(label)


func _on_click(label: String) -> void:
	clicks.append(label)


## Moves the test clock by `ms` of foreground time and lets the modules process it.
func advance(ms: int, frames: int = 2) -> void:
	UnitTestCore.advance_clock(ms, false)
	await UnitTestCore.wait_frames(frames)


## Waits until the async call ended, moving the test clock by one tween length at a time.
func finish(call: CALL, max_steps: int = 20) -> void:
	for i: int in max_steps:
		if call.done:
			return
		await advance(TWEEN_MS)
	assert_true(call.done, "the call ended")


## Waits for the result of the async call, not a frame count: a call that waits for a threaded load ends when the
## load does. A release of the modules, as at the test time limit, ends it too.
func wait_result(call: CALL) -> void:
	if not call.done:
		await call.finished


## Syncs with a response received now whose round trip is 0, so the server time becomes `server_time`.
func sync_time(server_time: int) -> void:
	var now: int = TimeCore.get_monotonic_time()
	TimeCore.sync_server_time(server_time, now, now)


## Start of a game day boundary of offset `offset_ms`, far from 1970.
func boundary(offset_ms: int) -> int:
	return 19800 * DAY_MS + offset_ms


## Loads the user file of user 1 without the suppression elements an earlier test saved.
func load_user_file() -> void:
	assert_true(LocalDataCore.load_user_file(1), "LocalDataCore.load_user_file")
	LocalDataCore.remove_value(LocalDataCore.FileKind.USER, UICore._SUPPRESS_KEY)


func errors() -> int:
	return UnitTestCore.check_logs(ERROR, TAG)


func warns() -> int:
	return UnitTestCore.check_logs(WARN, TAG)


func log_entries() -> PackedStringArray:
	return LOG.entries


func current() -> UIPanel:
	return UICore._current.panel if UICore._current != null else null


## The shown popup instance of `key`, or `null`.
func popup_of(key: String) -> UIPopup:
	for record: UICore._POPUP in UICore._shown_normal:
		if record.key == key:
			return record.instance as UIPopup
	return null


## The shown system popup instance at `index` from the bottom (-1: the top), or `null`.
func system_popup(index: int = -1) -> Control:
	var records: Array[UICore._POPUP] = UICore._shown_system
	if records.is_empty():
		return null
	return records[index if index >= 0 else records.size() + index].instance


## The buttons of a shown system popup instance.
func system_buttons(popup: Control) -> Array[Button]:
	var record: UICore._POPUP = UICore._shown_record_of(popup)
	if record == null:
		return []
	var view: UICore._SYSTEM_VIEW = record.system_view as UICore._SYSTEM_VIEW
	return view.buttons if view != null else []


func system_param(labels: PackedStringArray, callbacks: Array[Callable] = [], back: int = -1) -> SystemPopupParam:
	var param: SystemPopupParam = SystemPopupParam.new()
	param.body = ReservedString.ui_exit_confirm()
	for i: int in labels.size():
		var button: SystemPopupButton = SystemPopupButton.new()
		button.label = labels[i]
		if i < callbacks.size():
			button.callback = callbacks[i]
		param.buttons.append(button)
	param.back_button = back
	return param


## A one-button system popup param whose button records `label` as after-close callback.
func one_button_param(label: String = "button") -> SystemPopupParam:
	return system_param(PackedStringArray([ReservedString.ui_exit_quit()]), [after_of(label)], -1)


## Game coordinates of the center of `control`, with the offset of its UI layer.
func center_of(control: Control) -> Vector2:
	var center: Vector2 = control.get_global_rect().get_center()
	var layer: CanvasLayer = UICore._canvas_layer_of(control)
	if layer != null:
		center += layer.offset
	return center


func tap_control(control: Control) -> void:
	UnitTestCore.tap(center_of(control))
	await UnitTestCore.wait_frames(1)


## Presses and releases the ESC key: one back input.
func press_back() -> void:
	await press_key(KEY_ESCAPE)


## One back input while the platform is `platform`. The platform is set back before the next frame, so modules that
## read the OS on mobile platforms do not run with it.
func back_on(platform: String) -> void:
	var previous: String = CoreBuildInfo.platform
	CoreBuildInfo.platform = platform
	var press: InputEventKey = InputEventKey.new()
	press.keycode = KEY_ESCAPE
	press.physical_keycode = KEY_ESCAPE
	press.pressed = true
	InputCoreDev.inject_device_input(press)
	var release: InputEventKey = press.duplicate() as InputEventKey
	release.pressed = false
	InputCoreDev.inject_device_input(release)
	CoreBuildInfo.platform = previous
	await UnitTestCore.wait_frames(1)


## The back handler result while the platform is `platform`.
func handle_back_on(platform: String) -> bool:
	var previous: String = CoreBuildInfo.platform
	CoreBuildInfo.platform = platform
	var consumed: bool = UICore._handle_back()
	CoreBuildInfo.platform = previous
	return consumed


func press_key(keycode: Key) -> void:
	var press: InputEventKey = InputEventKey.new()
	press.keycode = keycode
	press.physical_keycode = keycode
	press.pressed = true
	InputCoreDev.inject_device_input(press)
	var release: InputEventKey = press.duplicate() as InputEventKey
	release.pressed = false
	InputCoreDev.inject_device_input(release)
	await UnitTestCore.wait_frames(1)


func press_pad(button: JoyButton) -> void:
	var press: InputEventJoypadButton = InputEventJoypadButton.new()
	press.button_index = button
	press.pressed = true
	InputCoreDev.inject_device_input(press)
	var release: InputEventJoypadButton = press.duplicate() as InputEventJoypadButton
	release.pressed = false
	InputCoreDev.inject_device_input(release)
	await UnitTestCore.wait_frames(1)


func move_mouse(position: Vector2) -> void:
	var motion: InputEventMouseMotion = InputEventMouseMotion.new()
	motion.position = position
	InputCoreDev.inject_device_input(motion)
	await UnitTestCore.wait_frames(1)


func focus_owner() -> Control:
	return get_tree().root.gui_get_focus_owner()


## A `Button` with a `UIButton` child that records `label` when clicked, on `layer`.
func add_button(layer: UICore.UILayer, label: String, position: Vector2 = Vector2(600, 300)) -> Button:
	var button: Button = Button.new()
	button.position = position
	button.size = Vector2(120, 60)
	var ui_button: UIButton = UIButton.new()
	ui_button.set_on_click(click_of(label))
	button.add_child(ui_button)
	UICore.get_layer(layer).add_child(button)
	return button


## The `UIButton` child of `control`.
func ui_button_of(control: Control) -> UIButton:
	for child: Node in control.get_children():
		if child is UIButton:
			return child as UIButton
	return null


func named_button(root: Node, button_name: String) -> Button:
	return root.find_child(button_name, true, false) as Button
