extends "res://core/message_core/tests/support/message_test_case.gd"
## Input: a toast takes no input and blocks nothing; a black box blocks input from step 1 to 5 except system popups.

var _presses: int = 0
var _system_presses: int = 0


func before_each() -> void:
	super()
	_presses = 0
	_system_presses = 0


func test_toast_blocks_nothing_and_ui_under_it_takes_input() -> void:
	assert_true(await start_prepared())
	var button: Button = _add_button_under_messages()
	MessageCore.show_toast(key_a())
	assert_eq(toast().phase, MessageCore._KIND_STATE.Phase.HOLD)
	assert_false(InputBlockCore.is_blocked())
	assert_eq(InputBlockCoreDev.count_active(), 0)
	await _tap_center(button)
	assert_eq(_presses, 1)


func test_toast_prefab_takes_no_input() -> void:
	set_string("MessageCore.toastResource", TOAST)
	assert_true(await start_prepared())
	var button: Button = _add_button_under_messages()
	MessageCore.show_toast(key_a())
	await _tap_center(button)
	assert_eq(_presses, 1)


func test_black_box_blocks_from_step_1_to_5_and_lets_system_popups_through() -> void:
	use_prefabs_with_tweens()
	assert_true(await start_prepared())
	var button: Button = _add_button_under_messages()
	MessageCore.show_black_box(key_a())
	assert_eq(black_box().phase, MessageCore._KIND_STATE.Phase.ENTER)
	assert_true(black_box().blocked)
	assert_true(InputBlockCore.is_active(black_box().block_token))
	assert_eq(InputBlockCoreDev.count_active(), 1)
	assert_eq(_message_blocks(), 1, "a message block during the enter tween")
	assert_false(InputBlockCore.pass_action("back"), "back input does not reach the UICore back handling")
	await _tap_center(button)
	assert_eq(_presses, 0, "UI under the black box takes no input")
	assert_true(await open_system_popup())
	var root: Control = UICore.get_block_pass_list().elements[0] as Control
	assert_true(UICore.is_system_popup_visible())
	assert_true(InputBlockCore.pass_focus(root), "the system popup root passes")
	assert_false(InputBlockCore.pass_focus(button))
	var system_button: Button = _system_popup_button()
	system_button.pressed.connect(_on_system_pressed)
	await _tap_center(system_button)
	assert_eq(_system_presses, 1, "the system popup button takes the tap through the black box")
	assert_eq(black_box().phase, MessageCore._KIND_STATE.Phase.ENTER)
	var token: int = black_box().block_token
	await advance(TWEEN_MS)
	assert_eq(black_box().phase, MessageCore._KIND_STATE.Phase.HOLD)
	assert_eq(_message_blocks(), 1, "a message block while held")
	await advance(BLACK_BOX_MS)
	assert_eq(black_box().phase, MessageCore._KIND_STATE.Phase.EXIT)
	assert_true(InputBlockCore.is_active(token), "the block holds during the exit tween")
	assert_eq(_message_blocks(), 1, "a message block during the exit tween")
	await advance(TWEEN_MS)
	assert_nothing_shown(black_box())
	assert_false(InputBlockCore.is_active(token))
	assert_eq(_message_blocks(), 0)


func test_no_black_box_block_after_close_black_box_close_all_and_release() -> void:
	use_prefabs_with_tweens()
	assert_true(await start_prepared())
	MessageCore.show_black_box(key_a())
	var token: int = black_box().block_token
	MessageCore.close_black_box()
	assert_false(InputBlockCore.is_active(token))
	MessageCore.show_black_box(key_a())
	token = black_box().block_token
	MessageCore.close_all()
	assert_false(InputBlockCore.is_active(token))
	MessageCore.show_black_box(key_a())
	token = black_box().block_token
	MessageCore.release()
	assert_false(InputBlockCore.is_active(token))
	assert_false(InputBlockCore.is_blocked())


## A button at the middle of the visible game area on the `Panel` layer, under the messages.
func _add_button_under_messages() -> Button:
	var area: Rect2 = ResolutionCore.get_visible_game_area()
	var button: Button = Button.new()
	button.size = Vector2(200.0, 200.0)
	button.position = area.get_center() - button.size / 2.0
	button.pressed.connect(_on_pressed)
	UICore.get_layer(UICore.UILayer.PANEL).add_child(button)
	autofree(button)
	return button


## Number of active blocks whose reason tag is `message`.
func _message_blocks() -> int:
	var buffer: Array[ActiveBlockInfo] = []
	buffer.resize(8)
	var count: int = InputBlockCoreDev.list_active(buffer)
	var found: int = 0
	for i: int in count:
		if buffer[i].reason == "message":
			found += 1
	return found


## The first button under the system popup root, the first element of `UICore.get_block_pass_list`.
func _system_popup_button() -> Button:
	var root: Control = UICore.get_block_pass_list().elements[0] as Control
	var buttons: Array[Node] = root.find_children("*", "Button", true, false)
	return buttons[0] as Button


## Taps the center of `control` in game coordinates, with the transform of its UI layer.
func _tap_center(control: Control) -> void:
	var center: Vector2 = control.get_global_transform_with_canvas() * (control.size / 2.0)
	UnitTestCore.tap(center)
	await UnitTestCore.wait_frames(2)


func _on_pressed() -> void:
	_presses += 1


func _on_system_pressed() -> void:
	_system_presses += 1
