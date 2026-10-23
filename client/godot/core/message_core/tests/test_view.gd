extends "res://core/message_core/tests/support/message_test_case.gd"
## Render order and the code made toast and black box.


func test_message_layer_is_above_popup_layer_and_toast_above_black_box() -> void:
	set_string("MessageCore.toastResource", TOAST)
	assert_true(await start_prepared())
	var message: CanvasLayer = UICore.get_layer(UICore.UILayer.MESSAGE) as CanvasLayer
	var popup: CanvasLayer = UICore.get_layer(UICore.UILayer.POPUP) as CanvasLayer
	assert_gt(message.layer, popup.layer)
	MessageCore.show_black_box(key_a())
	MessageCore.show_toast(key_b())
	assert_eq(MessageCore._black_box_holder.get_parent(), message)
	assert_eq(MessageCore._toast_holder.get_parent(), message)
	assert_gt(MessageCore._toast_holder.get_index(), MessageCore._black_box_holder.get_index())
	assert_eq(toast().object.get_parent(), MessageCore._toast_holder)
	assert_eq(black_box().object.get_parent(), MessageCore._black_box_holder)


func test_messages_cover_the_visible_game_area() -> void:
	assert_true(await start_prepared())
	MessageCore.show_black_box(key_a())
	var area: Rect2 = ResolutionCore.get_visible_game_area()
	assert_eq(MessageCore._black_box_holder.get_rect(), area)
	await UnitTestCore.wait_frames(1)
	assert_eq(black_box().object.get_global_rect(), MessageCore._black_box_holder.get_global_rect())


func test_messages_on_screen_follow_the_visible_game_area_when_it_changes() -> void:
	assert_true(await start_prepared())
	ResolutionCoreDev.set_test_screen(Vector2i(1280, 720), Vector2i(1280, 720), ResolutionCore.FillMode.LETTERBOX, false)
	MessageCore.show_black_box(key_a())
	MessageCore.show_toast(key_b())
	var first: Rect2 = ResolutionCore.get_visible_game_area()
	assert_eq(MessageCore._black_box_holder.get_rect(), first)
	ResolutionCoreDev.set_test_screen(Vector2i(1280, 720), Vector2i(1000, 1000), ResolutionCore.FillMode.CROP, false)
	var second: Rect2 = ResolutionCore.get_visible_game_area()
	assert_ne(second, first, "the visible game area changed")
	await UnitTestCore.wait_frames(2)
	assert_eq(black_box().phase, MessageCore._KIND_STATE.Phase.HOLD, "the black box is still on screen")
	assert_eq(toast().phase, MessageCore._KIND_STATE.Phase.HOLD, "the toast is still on screen")
	assert_eq(MessageCore._black_box_holder.get_rect(), second)
	assert_eq(MessageCore._toast_holder.get_rect(), second)
	var holder_rect: Rect2 = MessageCore._black_box_holder.get_global_rect()
	var dim: ColorRect = black_box().object.get_child(0) as ColorRect
	assert_eq(dim.get_global_rect(), holder_rect, "the dim covers the new visible game area")
	assert_eq(MessageCore._black_box_label.get_global_rect().get_center(), holder_rect.get_center())
	assert_eq(toast().object.get_global_rect(), MessageCore._toast_holder.get_global_rect())

func test_empty_resource_keys_show_code_made_toast_and_black_box() -> void:
	set_float("UICore.dimOpacity", 0.25)
	assert_true(await start_prepared())
	MessageCore.show_toast(key_a())
	MessageCore.show_black_box(key_b())
	assert_eq(toast().object, MessageCore._code_toast_object)
	assert_true(toast().object.visible)
	assert_eq(shown_text(toast()), LocalizationCore.get_text(key_a()))
	assert_eq(black_box().object, MessageCore._black_box_object)
	assert_true(black_box().object.visible)
	assert_eq(shown_text(black_box()), LocalizationCore.get_text(key_b()))
	var band: PanelContainer = toast().object.get_child(0) as PanelContainer
	var style: StyleBoxFlat = band.get_theme_stylebox("panel") as StyleBoxFlat
	assert_eq(style.bg_color, Color(0.0, 0.0, 0.0, 0.25))
	assert_eq(MessageCore._code_toast_label.get_theme_color("font_color"), Color.WHITE)
	var dim: ColorRect = black_box().object.get_child(0) as ColorRect
	assert_eq(dim.color, Color(0.0, 0.0, 0.0, 0.25))
	assert_eq(MessageCore._black_box_label.get_theme_color("font_color"), Color.WHITE)


func test_three_toasts_show_one_after_another_on_one_code_made_toast_object() -> void:
	assert_true(await start_prepared())
	var object: Control = MessageCore._code_toast_object
	MessageCore.show_toast(key_a())
	MessageCore.show_toast(key_b())
	MessageCore.show_toast(key_c())
	var keys: PackedStringArray = PackedStringArray([key_a(), key_b(), key_c()])
	for key: String in keys:
		assert_eq(toast().object, object)
		assert_eq(shown_text(toast()), LocalizationCore.get_text(key))
		await advance(TOAST_MS)
	assert_nothing_shown(toast())
	assert_false(object.visible)
	assert_eq(MessageCore._toast_holder.get_child_count(), 1)


func test_toast_after_code_made_toast_object_was_destroyed_outside_shows_with_a_new_object() -> void:
	assert_true(await start_prepared())
	var old: Control = MessageCore._code_toast_object
	old.free()
	MessageCore.show_toast(key_a())
	assert_eq(toast().phase, MessageCore._KIND_STATE.Phase.HOLD)
	assert_true(is_instance_valid(MessageCore._code_toast_object))
	assert_eq(toast().object, MessageCore._code_toast_object)
	assert_eq(shown_text(toast()), LocalizationCore.get_text(key_a()))


func set_float(key: String, value: float) -> void:
	assert_true(UnitTestCore.set_test_settings(key, value), key)
