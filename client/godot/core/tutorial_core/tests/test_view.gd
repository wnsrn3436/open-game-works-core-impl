extends "res://core/tutorial_core/tests/support/tutorial_test_case.gd"
## The tutorial view: the highlight, the hand pointer, the speech bubble placement, the safe area, the system popup
## hide, the view check, pointer input through the view and the bound texts.

const MISSING_VIEW: String = "prefab/tutorial_core_test_missing_view"
const NEAR: Vector2 = Vector2(0.01, 0.01)


## Game coordinates rectangle of `control`.
func game_rect(control: Control) -> Rect2:
	var rect: Rect2 = control.get_global_rect()
	rect.position += center_of(control) - rect.get_center()
	return rect


## Stage position of the game coordinates `point`: the safe area depends on the host window.
func stage_point(point: Vector2) -> Vector2:
	return point - game_rect(stage).position


func root_rect() -> Rect2:
	return game_rect(TutorialCore._view_root)


func bubble_rect() -> Rect2:
	return game_rect(view().speech_bubble)


func anchor_rect(anchor_name: String = "tc_anchor") -> Rect2:
	return UICore.get_anchor_rect(anchor_name).rect


## The highlight hole of the dim shader in game coordinates.
# ogw:input_boundary
func hole_rect() -> Rect2:
	var material: ShaderMaterial = view().dim.material as ShaderMaterial
	var hole: Variant = material.get_shader_parameter(&"hole")
	if not hole is Vector4:
		return Rect2()
	var value: Vector4 = hole
	var origin: Vector2 = game_rect(view().dim).position
	return Rect2(origin.x + value.x, origin.y + value.y, value.z, value.w)


func test_the_view_waits_for_the_anchor_and_follows_it() -> void:
	assert_true(await start())
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_anchor]"])))
	await frames(2)
	assert_false(view_visible())
	assert_false(has_block())
	var anchor: Button = add_anchor("tc_anchor", Rect2(100, 300, 160, 60))
	assert_true(await wait_shown())
	assert_true(has_block())
	assert_true(view().dim.visible)
	assert_true(view().hand_pointer.visible)
	assert_true(hole_rect().is_equal_approx(anchor_rect()))
	assert_almost_eq(game_rect(view().hand_pointer).get_center(), anchor_rect().get_center(), NEAR)
	anchor.position = Vector2(400, 200)
	await frames()
	assert_true(hole_rect().is_equal_approx(anchor_rect()))
	assert_almost_eq(game_rect(view().hand_pointer).get_center(), anchor_rect().get_center(), NEAR)


func test_the_speech_bubble_goes_below_or_above_the_anchor_by_the_room_left() -> void:
	assert_true(await start())
	var area: Rect2 = SafeAreaCore.get_safe_area()
	var top: Vector2 = stage_point(Vector2(area.get_center().x - 80, area.position.y + 100))
	var anchor: Button = add_anchor("tc_anchor", Rect2(top, Vector2(160, 60)))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_anchor]"])))
	assert_true(await wait_shown())
	assert_true(view().speech_bubble.visible)
	var bubble: Rect2 = bubble_rect()
	assert_almost_eq(bubble.position.y, anchor_rect().end.y, 0.01, "right below")
	assert_almost_eq(bubble.get_center().x, anchor_rect().get_center().x, 0.01)
	assert_false(bubble.intersects(anchor_rect()))
	assert_true(root_rect().grow(0.01).encloses(bubble))
	anchor.position = stage_point(Vector2(area.get_center().x - 80, area.end.y - 160))
	await frames()
	bubble = bubble_rect()
	assert_almost_eq(bubble.end.y, anchor_rect().position.y, 0.01, "right above")
	assert_false(bubble.intersects(anchor_rect()))
	assert_true(root_rect().grow(0.01).encloses(bubble))


func test_the_speech_bubble_overlaps_a_tall_anchor_and_touches_an_edge_of_the_view_root() -> void:
	assert_true(await start())
	var area: Rect2 = SafeAreaCore.get_safe_area()
	var top: Vector2 = stage_point(Vector2(area.get_center().x - 80, area.position.y + 50))
	add_anchor("tc_anchor", Rect2(top, Vector2(160, area.size.y - 100)))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_anchor]"])))
	assert_true(await wait_shown())
	var bubble: Rect2 = bubble_rect()
	var root: Rect2 = root_rect()
	assert_true(bubble.intersects(anchor_rect()))
	assert_true(root.grow(0.01).encloses(bubble))
	assert_true(is_equal_approx(bubble.position.y, root.position.y) or is_equal_approx(bubble.end.y, root.end.y))


func test_a_wide_speech_bubble_stays_in_the_view_root_at_its_left_edge() -> void:
	assert_true(await start())
	var anchor: Button = add_anchor("tc_anchor", Rect2(0, 100, 100, 60))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_anchor]"])))
	assert_true(await wait_shown())
	var root: Rect2 = root_rect()
	anchor.position.x = root.position.x
	await frames()
	var bubble: Rect2 = bubble_rect()
	assert_gt(bubble.size.x, anchor_rect().size.x)
	assert_almost_eq(bubble.position.x, root.position.x, 0.01)
	var left_y: float = bubble.position.y
	anchor.position.x = root.get_center().x - anchor.size.x * 0.5
	await frames()
	assert_almost_eq(bubble_rect().position.y, left_y, 0.01)


func test_the_view_root_is_the_safe_area_and_the_dim_covers_the_visible_game_area() -> void:
	assert_true(await start())
	# The notch distances are window pixels: 60, 40, 30 and 20 on a 1280 x 720 window.
	var window: Vector2i = ResolutionCore.get_window_size()
	SafeAreaCoreDev.set_virtual_notch(
		maxi(1, window.x * 60 / 1280), maxi(1, window.y * 40 / 720),
		maxi(1, window.x * 30 / 1280), maxi(1, window.y * 20 / 720),
	)
	await frames(2)
	var anchor: Button = add_anchor("tc_anchor", Rect2(300, 300, 160, 60))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_anchor]"])))
	assert_true(await wait_shown())
	respond_saved(id_of("[tutorial_anchor]"), 1)
	await click(anchor)
	assert_eq(current_text(), "[tutorial_anchor]:2")
	assert_true(await wait_shown())
	await frames(2)
	var safe: Rect2 = SafeAreaCore.get_safe_area()
	assert_true(root_rect().is_equal_approx(safe), "view root is the safe area")
	var inside: Rect2 = safe.grow(0.01)
	assert_true(inside.encloses(bubble_rect()))
	assert_true(inside.encloses(game_rect(view().advance_button)))
	assert_true(inside.encloses(game_rect(view().skip_button)))
	assert_true(game_rect(view().dim).is_equal_approx(ResolutionCore.get_visible_game_area()))
	assert_true(hole_rect().is_equal_approx(anchor_rect()))
	SafeAreaCoreDev.clear_virtual_notch()


func test_a_system_popup_hides_the_view_and_keeps_the_block_and_the_step() -> void:
	assert_true(await start())
	add_anchor("tc_anchor", Rect2(560, 340, 160, 60))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_anchor]"])))
	assert_true(await wait_shown())
	await open_system_popup()
	await frames()
	assert_false(view_visible())
	assert_true(has_block())
	assert_eq(shown_text(), "[tutorial_anchor]")
	var button: Button = system_popup_button()
	assert_not_null(button)
	await click(button)
	await frames(2)
	assert_false(UICore.is_system_popup_visible(), "the system popup button was pressed")
	assert_true(view_visible())
	assert_eq(current_text(), "[tutorial_anchor]:1")


func test_without_a_tutorial_view_advance_steps_end_at_once_without_a_block() -> void:
	set_value("tutorialView", MISSING_VIEW)
	assert_true(await start())
	respond_saved(id_of("[tutorial_first]"), 2)
	respond_saved(id_of("[tutorial_first]"), 3)
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_first]"])))
	while TutorialCore.is_initialized() and TutorialCore.is_running():
		assert_false(has_block())
		await frames()
	assert_eq(events, PackedStringArray([
		"started:[tutorial_first]:1", "started:[tutorial_first]:2", "started:[tutorial_first]:3",
		"completed:[tutorial_first]:false",
	]))
	assert_eq(errors(), 1)
	UnitTestCore.check_logs(ERROR, "ResourceCore")


func test_a_view_root_that_is_no_ui_element_fails_once_and_is_not_loaded_again() -> void:
	set_value("tutorialView", BROKEN_VIEW)
	assert_true(await start())
	respond_saved(id_of("[tutorial_second]"), 1)
	respond_saved(id_of("[tutorial_second]"), 2)
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_second]"])))
	assert_true(await wait_not_running())
	assert_eq(errors(), 1)
	assert_eq(TutorialCore._view_state, TutorialCore._VIEW_FAILED)
	respond_saved(id_of("[tutorial_first]"), 2)
	respond_saved(id_of("[tutorial_first]"), 3)
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_first]"])))
	assert_true(await wait_not_running())
	assert_false(TutorialCore.is_running())
	assert_eq(errors(), 0, "no second load")
	assert_eq(TutorialCore._view_state, TutorialCore._VIEW_FAILED)


func test_taps_on_the_dim_and_the_speech_bubble_reach_the_elements_below_without_restrict_input() -> void:
	assert_true(await start())
	var anchor: Button = add_anchor("tc_anchor", Rect2(560, 100, 160, 60))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_anchor]"])))
	assert_true(await wait_shown())
	respond_saved(id_of("[tutorial_anchor]"), 1)
	await click(anchor)
	assert_eq(current_text(), "[tutorial_anchor]:2")
	assert_true(await wait_shown())
	assert_false(has_block())
	assert_true(view().dim.visible)
	var bubble: Rect2 = bubble_rect()
	var under_bubble: Button = add_anchor("tc_under_bubble", Rect2(bubble.get_center() - Vector2(20, 10), Vector2(40, 20)))
	var under_dim: Button = add_anchor("tc_under_dim", Rect2(100, 600, 120, 60))
	clicks = PackedStringArray()
	await click(under_bubble)
	await click(under_dim)
	assert_eq(clicks, PackedStringArray(["tc_under_bubble", "tc_under_dim"]))
	assert_eq(current_text(), "[tutorial_anchor]:2")


func test_a_tap_on_the_hand_pointer_reaches_the_element_below() -> void:
	assert_true(await start())
	var anchor: Button = add_anchor("tc_keyed", Rect2(560, 300, 160, 60), id_of("[gold]"))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_keyed]"])))
	assert_true(await wait_shown())
	assert_true(view().hand_pointer.visible)
	await click(view().hand_pointer)
	assert_eq(clicks, PackedStringArray(["tc_keyed"]))
	assert_eq(current_text(), "[tutorial_keyed]:2")
	assert_not_null(anchor)


func test_the_bound_text_follows_the_input_device_only_while_its_step_shows() -> void:
	assert_true(await start())
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_prompt]"])))
	assert_true(await wait_shown())
	var key: String = TutorialCore._defs_by_id[id_of("[tutorial_prompt]")].steps[0].text
	var touch_text: String = view().text_label.text
	assert_eq(touch_text, LocalizationCore.get_text(key))
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	await frames()
	assert_eq(view().text_label.text, LocalizationCore.get_text(key))
	assert_ne(view().text_label.text, touch_text)
	assert_eq(view().skip_button.text, LocalizationCore.get_text(ReservedString.tutorial_skip()))
	respond_saved(id_of("[tutorial_prompt]"), 1)
	await click(view().advance_button)
	assert_false(TutorialCore.is_running())
	# Hiding the view unbinds the text and leaves the text of the step.
	var ended_text: String = view().text_label.text
	assert_eq(ended_text, LocalizationCore.get_text(key))
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	await frames()
	assert_eq(view().text_label.text, ended_text)


func test_release_unbinds_the_view_texts_and_leaves_them() -> void:
	assert_true(await start())
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_prompt]"])))
	assert_true(await wait_shown())
	var key: String = TutorialCore._defs_by_id[id_of("[tutorial_prompt]")].steps[0].text
	var label: Label = view().text_label
	var skip: Button = view().skip_button
	var label_text: String = label.text
	var skip_text: String = skip.text
	assert_eq(label_text, LocalizationCore.get_text(key))
	assert_eq(skip_text, LocalizationCore.get_text(ReservedString.tutorial_skip()))
	TutorialCore.release()
	# `release` frees the view at the end of the frame, so the checks below run in this frame.
	assert_eq(label.text, label_text)
	assert_eq(skip.text, skip_text)
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	assert_ne(LocalizationCore.get_text(key), label_text)
	assert_eq(label.text, label_text)
	assert_eq(skip.text, skip_text)
	# A bound element would be written again with the text of its key.
	label.text = "unbound label"
	skip.text = "unbound skip"
	assert_true(LocalizationCore.load_translation([]))
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	assert_eq(label.text, "unbound label")
	assert_eq(skip.text, "unbound skip")


func test_a_step_waiting_for_its_anchor_logs_one_warn_after_the_wait_time() -> void:
	assert_true(await start())
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_anchor]"])))
	await advance(ANCHOR_WAIT_WARN_MS - 1)
	assert_eq(warns(), 0)
	await advance(1)
	assert_eq(warns(), 1)
	await advance(ANCHOR_WAIT_WARN_MS * 3)
	assert_eq(warns(), 0)
