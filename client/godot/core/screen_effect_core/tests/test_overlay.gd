extends "res://core/screen_effect_core/tests/support/screen_effect_test_case.gd"
## Overlays: UI layers, visible game area and pointer input.

var _presses: Array[int] = [0, 0, 0]


func test_overlays_are_on_their_ui_layers() -> void:
	assert_true(await start_modules())
	assert_eq(ScreenEffectCore._overlays[WORLD].get_parent(), UICore.get_layer(UICore.UILayer.WORLD_EFFECT))
	assert_eq(ScreenEffectCore._overlays[CUTSCENE].get_parent(), UICore.get_layer(UICore.UILayer.CUTSCENE_EFFECT))
	assert_eq(ScreenEffectCore._overlays[TRANSITION].get_parent(), UICore.get_layer(UICore.UILayer.TRANSITION_EFFECT))
	for channel: ScreenEffectCore.ScreenEffectChannel in CHANNELS:
		assert_no_effect(channel, "after init")


func test_overlays_follow_the_visible_game_area() -> void:
	assert_true(await start_modules())
	ResolutionCoreDev.set_test_screen(Vector2i(1280, 720), Vector2i(1280, 720), ResolutionCore.FillMode.LETTERBOX, false)
	var first: Rect2 = ResolutionCore.get_visible_game_area()
	for channel: ScreenEffectCore.ScreenEffectChannel in CHANNELS:
		assert_eq(state(channel).rect, first, "after init")
	ResolutionCoreDev.set_test_screen(Vector2i(1280, 720), Vector2i(1000, 1000), ResolutionCore.FillMode.CROP, false)
	var second: Rect2 = ResolutionCore.get_visible_game_area()
	assert_ne(second, first, "the visible game area changed")
	for channel: ScreenEffectCore.ScreenEffectChannel in CHANNELS:
		assert_eq(state(channel).rect, second, "after the change")


func test_ui_element_under_visible_overlays_takes_pointer_input() -> void:
	assert_true(await start_modules())
	var owner: Node = make_owner()
	for channel: ScreenEffectCore.ScreenEffectChannel in CHANNELS:
		ScreenEffectCore.fade(channel, owner, Color.BLACK, 1.0, 1.0, 0)
		assert_eq(ScreenEffectCore._overlays[channel].mouse_filter, Control.MOUSE_FILTER_IGNORE, "channel %d" % channel)
	var area: Rect2 = ResolutionCore.get_visible_game_area()
	# one button right under each overlay: the world canvas is under WorldEffect, Panel under CutsceneEffect and
	# Loading under TransitionEffect, so each tap goes through every overlay above its button
	var parents: Array[Node] = [
		get_tree().root, UICore.get_layer(UICore.UILayer.PANEL), UICore.get_layer(UICore.UILayer.LOADING),
	]
	var buttons: Array[Button] = []
	for i: int in parents.size():
		var button: Button = Button.new()
		button.size = Vector2(area.size.x * 0.15, area.size.y * 0.15)
		button.position = area.position + area.size * Vector2(0.25 * (i + 1), 0.5) - button.size / 2.0
		button.pressed.connect(_on_pressed.bind(i))
		parents[i].add_child(button)
		autofree(button)
		buttons.append(button)
	await UnitTestCore.wait_frames(1)
	for channel: ScreenEffectCore.ScreenEffectChannel in CHANNELS:
		assert_true(state(channel).visible, "channel %d overlay is visible" % channel)
	for i: int in buttons.size():
		UnitTestCore.tap(buttons[i].get_global_rect().get_center())
		await UnitTestCore.wait_frames(2)
	var expected: Array[int] = [1, 1, 1]
	assert_eq(_presses, expected, "the buttons under the overlays were pressed: world canvas, Panel, Loading")


func _on_pressed(index: int) -> void:
	_presses[index] += 1
