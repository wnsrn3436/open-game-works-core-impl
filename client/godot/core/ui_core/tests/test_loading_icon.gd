extends "res://core/ui_core/tests/support/ui_test_case.gd"
## The loading icon.


func test_icon_shows_while_a_request_is_left() -> void:
	assert_true(await start())
	var icon: Control = UICore._loading_icon
	assert_false(icon.visible)
	var first: int = UICore.show_loading_icon()
	var second: int = UICore.show_loading_icon()
	assert_true(first != second and first != 0 and second != 0)
	assert_true(icon.visible)
	UICore.hide_loading_icon(first)
	assert_true(icon.visible, "one request left")
	UICore.hide_loading_icon(second)
	assert_false(icon.visible)


func test_icon_takes_no_pointer_input() -> void:
	assert_true(await start())
	var button: Button = add_button(UICore.UILayer.SCENE_UI, "below", Vector2.ZERO)
	var token: int = UICore.show_loading_icon()
	await UnitTestCore.wait_frames(1)
	var icon: Control = UICore._loading_icon
	button.global_position = icon.get_global_rect().get_center() - button.size / 2.0
	await UnitTestCore.wait_frames(1)
	await tap_control(icon)
	assert_eq(clicks, PackedStringArray(["below"]), "the UI below the icon takes the tap")
	assert_false(InputBlockCore.is_blocked(), "the icon puts no block")
	UICore.hide_loading_icon(token)
