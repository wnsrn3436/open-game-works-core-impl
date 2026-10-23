extends UnitTestCase
## Real input of a test: `tap` and `tap_anchor` go through `InputCore.inject_device_input`.

const AnchorButton := preload("res://core/unit_test_core/tests/support/anchor_button.gd")
const ANCHOR: String = "unit_test_core_anchor"
## The key of `[ui_button_click]` in the core test data: the UI click sound `UICore.prepare` loads.
const CLICK: String = "sfx/ui_button_click"
const CLICK_RESOURCE: String = "res://core/unit_test_core/tests/resources/test_click.tres"


## Starts the modules `InputCore` depends on and `InputCore`, and with `ui` the modules of `UICore` and `UICore`, and
## loads the device file and the core test data as the boot does. Async.
func _start_input(ui: bool) -> bool:
	ResourceCoreDev.set_test_key_list({CLICK: CLICK_RESOURCE})
	var started: bool = (
		LogCore.init() and EventCore.init() and TimeCore.init() and LocalDataCore.init() and ResourceCore.init()
		and PoolCore.init() and DataCore.init() and InputBlockCore.init() and ResolutionCore.init() and InputCore.init()
	)
	if started and ui:
		started = LocalizationCore.init() and SoundCore.init() and SafeAreaCore.init() and TweenCore.init() and UICore.init()
	assert_true(started, "modules init")
	if not started:
		return false
	assert_true(LocalDataCore.load_device_file(), "LocalDataCore.load_device_file")
	var loaded: bool = await DataCore.load(null)
	assert_true(loaded, "DataCore.load")
	if not loaded or not ui:
		return loaded
	assert_eq(ReservedSound.ui_button_click(), CLICK, "the core test data key of [ui_button_click]")
	LocalizationCore.resolve_language()
	var translated: bool = await LocalizationCore.load_translation([])
	assert_true(translated, "LocalizationCore.load_translation")
	var prepared: bool = await UICore.prepare()
	assert_true(prepared, "UICore.prepare")
	return translated and prepared


func test_tap_reaches_the_element_and_a_block_stops_it() -> void:
	if not await _start_input(false):
		return
	var button: Button = Button.new()
	# Inside the visible game area: the fill area stage of `InputCore` drops a press outside it.
	button.position = ResolutionCore.get_visible_game_area().position + Vector2(20, 20)
	button.size = Vector2(200, 80)
	get_tree().root.add_child(button)
	var presses: Array[int] = [0]
	var on_pressed: Callable = func() -> void: presses[0] += 1
	assert_eq(button.pressed.connect(on_pressed), OK)
	await UnitTestCore.wait_frames(1)
	UnitTestCore.tap(button.get_global_rect().get_center())
	assert_eq(presses[0], 1, "tap presses the element")
	var token: int = InputBlockCore.block("content")
	UnitTestCore.tap(button.get_global_rect().get_center())
	assert_eq(presses[0], 1, "a block stops the tap")
	InputBlockCore.unblock(token)
	get_tree().root.remove_child(button)
	button.queue_free()


func test_tap_anchor_clicks_only_the_anchor_of_the_key() -> void:
	if not await _start_input(true):
		return
	var layer: CanvasLayer = UICore.get_layer(UICore.UILayer.SCENE_UI)
	assert_not_null(layer, "SceneUI layer")
	if layer == null:
		return
	var seven: AnchorButton = AnchorButton.new()
	var nine: AnchorButton = AnchorButton.new()
	seven.position = Vector2(20, 20)
	nine.position = Vector2(20, 200)
	for button: AnchorButton in [seven, nine]:
		button.size = Vector2(200, 80)
		layer.add_child(button)
	seven.add_components(ANCHOR, 7)
	nine.add_components(ANCHOR, 9)
	await UnitTestCore.wait_frames(2)
	assert_true(UnitTestCore.tap_anchor(ANCHOR, 9), "anchor key 9")
	await UnitTestCore.wait_frames(1)
	assert_eq([seven.clicks, nine.clicks], [0, 1])
	assert_false(UnitTestCore.tap_anchor(ANCHOR, 8), "no anchor of key 8")
	await UnitTestCore.wait_frames(1)
	assert_eq([seven.clicks, nine.clicks], [0, 1])
	for button: AnchorButton in [seven, nine]:
		layer.remove_child(button)
		button.queue_free()


func test_gut_runner_gui_is_hidden_during_the_run_and_a_tap_reaches_the_element_under_it() -> void:
	var layer: CanvasLayer = UnitTestCore._runner_gui_layer(gut)
	assert_not_null(layer, "the GUT runner GUI layer")
	if layer == null:
		return
	assert_eq(layer.layer, 128, "the GUT runner GUI layer")
	assert_false(layer.visible, "the GUT runner GUI layer is hidden")
	if not await _start_input(false):
		return
	# Where a GUT runner GUI element that would take the pointer is, inside the visible game area. GUT lays its GUI out
	# for the viewport size at its start, so the place differs between runs: the headless pass puts most of it left of
	# the viewport, the browser run over the middle of the page.
	var area: Rect2 = ResolutionCore.get_visible_game_area()
	var under: Rect2 = _largest_pointer_rect(layer, area)
	assert_true(under.has_area(), "a GUT runner GUI element that takes the pointer in the visible game area")
	if not under.has_area():
		return
	var button: Button = Button.new()
	button.position = under.position
	button.size = under.size
	get_tree().root.add_child(button)
	var presses: Array[int] = [0]
	var on_pressed: Callable = func() -> void: presses[0] += 1
	assert_eq(button.pressed.connect(on_pressed), OK)
	await UnitTestCore.wait_frames(1)
	UnitTestCore.tap(button.get_global_rect().get_center())
	assert_eq(presses[0], 1, "tap presses the element under the GUT runner GUI")
	get_tree().root.remove_child(button)
	button.queue_free()


## The largest part inside `area` of a `Control` under `node` that stops the pointer and is shown when `node` is: under
## a hidden `CanvasItem` nothing is shown.
func _largest_pointer_rect(node: Node, area: Rect2) -> Rect2:
	var largest: Rect2 = Rect2()
	for child: Node in node.get_children():
		if child is CanvasItem and not (child as CanvasItem).visible:
			continue
		if child is Control:
			var control: Control = child
			var rect: Rect2 = control.get_global_rect()
			if control.mouse_filter == Control.MOUSE_FILTER_STOP and rect.intersects(area):
				var part: Rect2 = rect.intersection(area)
				if part.get_area() > largest.get_area():
					largest = part
		var inner: Rect2 = _largest_pointer_rect(child, area)
		if inner.get_area() > largest.get_area():
			largest = inner
	return largest
