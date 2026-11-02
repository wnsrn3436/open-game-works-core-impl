extends "res://core/ui_core/tests/support/ui_test_case.gd"
## `is_dimmed`, where a dim lies during `prepare` and a close tween, and the dim and tweens of system popups.

var _lower: UIPopup = null
## Whether the dim lies directly below `_lower` at the hidden callback of the popup above it.
var _dim_below_lower_at_hidden: bool = false


func open_panel_button(key: String = PANEL_A) -> Button:
	assert_true(await UICore.open_panel(key, null, false))
	return named_button(current(), "Button")


## A UI element added to `layer`. `release` destroys it with the layer.
func element_on(layer: UICore.UILayer) -> Control:
	var element: Control = Control.new()
	UICore.get_layer(layer).add_child(element)
	return element


func test_popup_with_dim_on_and_modal_off() -> void:
	assert_true(await start())
	var panel_button: Button = await open_panel_button()
	assert_false(UICore.is_dimmed(panel_button), "no dim")
	assert_true(await UICore.open_popup(POPUP_DIM_NONMODAL, null, Callable()) == UICore.PopupOpenResult.OPENED)
	assert_true(UICore.is_dimmed(panel_button))
	assert_false(UICore.is_modal_covered(panel_button), "dimmed is not modal covered")
	var popup: UIPopup = popup_of(POPUP_DIM_NONMODAL)
	assert_false(UICore.is_dimmed(named_button(popup, "First")), "an element in the popup")
	await UICore.close_popup(popup)
	assert_false(UICore.is_dimmed(panel_button), "after the popup closed")


func test_popups_with_dim_off() -> void:
	assert_true(await start())
	var panel_button: Button = await open_panel_button()
	assert_true(await UICore.open_popup(POPUP_NONMODAL, null, Callable()) == UICore.PopupOpenResult.OPENED)
	assert_false(UICore.is_dimmed(panel_button), "a popup with modal off")
	assert_true(await UICore.open_popup(POPUP_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	assert_true(UICore.is_modal_covered(panel_button))
	assert_false(UICore.is_dimmed(panel_button), "a popup with modal on")


func test_two_popups_with_dim_on() -> void:
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_DIM_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	assert_true(await UICore.open_popup(POPUP_DIM_B, null, Callable()) == UICore.PopupOpenResult.OPENED)
	assert_true(UICore.is_dimmed(named_button(popup_of(POPUP_DIM_A), "First")), "the lower popup")
	assert_false(UICore.is_dimmed(named_button(popup_of(POPUP_DIM_B), "First")), "the upper popup")


func test_panel_with_dim_on() -> void:
	assert_true(await start())
	var scene_element: Control = element_on(UICore.UILayer.SCENE_UI)
	var panel_button: Button = await open_panel_button(PANEL_DIM)
	assert_true(UICore.is_dimmed(scene_element), "SceneUI is below the panel dim")
	assert_false(UICore.is_dimmed(panel_button), "an element of that panel")
	assert_false(UICore.is_dimmed(element_on(UICore.UILayer.POPUP)), "the Popup layer is above the panel dim")
	assert_true(await UICore.close_panel())
	assert_false(UICore.is_dimmed(scene_element), "after the panel closed")


func test_layers_above_the_dim() -> void:
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_DIM_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	assert_true(UICore.is_dimmed(element_on(UICore.UILayer.PANEL)))
	assert_false(UICore.is_dimmed(element_on(UICore.UILayer.TUTORIAL)))


func test_failure_values() -> void:
	assert_true(await start(false))
	var outside: Control = Control.new()
	assert_false(UICore.is_dimmed(outside), "before init")
	assert_eq(errors(), 1)
	assert_true(UICore.init())
	assert_true(await UICore.prepare())
	assert_true(await UICore.open_popup(POPUP_DIM_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	assert_false(UICore.is_dimmed(null))
	assert_false(UICore.is_dimmed(outside), "outside the tree")
	assert_eq(errors(), 0, "no log after init")
	outside.free()


func test_no_dim_while_a_popup_prepares() -> void:
	assert_true(await start())
	var panel_button: Button = await open_panel_button()
	var gate: GATE = LOG.add_gate(POPUP_DIM_A)
	var call: CALL = CALL.new()
	call.open_popup(POPUP_DIM_A)
	await UnitTestCore.wait_frames(2)
	assert_eq(LOG.count(POPUP_DIM_A + ":prepare"), 1)
	assert_false(UICore._popup_dim.visible, "no dim in prepare")
	assert_false(UICore.is_dimmed(panel_button))
	gate.open()
	await wait_result(call)
	assert_true(call.ok)
	assert_true(UICore.is_dimmed(panel_button))


func test_dim_stays_during_the_close_tween() -> void:
	assert_true(await start())
	var panel_button: Button = await open_panel_button()
	var opening: CALL = CALL.new()
	opening.open_popup(POPUP_DIM_TWEEN)
	await finish(opening)
	var closing: CALL = CALL.new()
	closing.close_popup(popup_of(POPUP_DIM_TWEEN))
	await UnitTestCore.wait_frames(1)
	assert_false(closing.done, "the close tween runs")
	assert_true(UICore.is_dimmed(panel_button))
	await finish(closing)
	assert_false(UICore.is_dimmed(panel_button), "the destruction started")


func test_dim_moves_when_the_destruction_of_the_upper_popup_starts() -> void:
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_DIM_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	_lower = popup_of(POPUP_DIM_A)
	var opening: CALL = CALL.new()
	opening.open_popup(POPUP_DIM_TWEEN, _on_upper_hidden)
	await finish(opening)
	var upper: UIPopup = popup_of(POPUP_DIM_TWEEN)
	assert_eq(UICore._popup_dim.get_index(), upper.get_index() - 1, "right below the upper popup")
	var closing: CALL = CALL.new()
	closing.close_popup(upper)
	await UnitTestCore.wait_frames(1)
	assert_false(closing.done, "the close tween runs")
	assert_eq(UICore._popup_dim.get_index(), upper.get_index() - 1, "still below the upper popup")
	assert_true(UICore.is_dimmed(named_button(_lower, "First")))
	await finish(closing)
	assert_true(_dim_below_lower_at_hidden, "right below the lower popup at the hidden callback")
	assert_false(UICore.is_dimmed(named_button(_lower, "First")))
	assert_true(UICore._popup_dim.visible)


func _on_upper_hidden() -> void:
	_dim_below_lower_at_hidden = UICore._popup_dim.get_index() == _lower.get_index() - 1


func test_code_made_system_popups() -> void:
	assert_true(await start())
	var panel_button: Button = await open_panel_button()
	assert_true(await UICore.open_system_popup(one_button_param(), Callable()))
	assert_eq(tweens_started, 0, "no open tween")
	assert_true(UICore.is_dimmed(panel_button), "under a system popup")
	var lower_button: Button = system_buttons(system_popup())[0]
	assert_false(UICore.is_dimmed(lower_button), "an element inside it")
	assert_true(await UICore.open_system_popup(one_button_param(), Callable()))
	assert_eq(tweens_started, 0, "no open tween")
	assert_true(UICore.is_dimmed(lower_button), "the lower system popup")
	assert_false(UICore.is_dimmed(system_buttons(system_popup())[0]), "the upper system popup")
	var closing: CALL = CALL.new()
	closing.close_popup(system_popup())
	await wait_result(closing)
	assert_eq(tweens_started, 0, "no close tween")
	assert_false(UICore.is_dimmed(lower_button), "the dim moved below the lower system popup")
	assert_true(UICore.is_dimmed(panel_button))
	UICore.close_all_popups()
	assert_false(UICore.is_dimmed(panel_button), "no system popup")


func test_system_popup_dim_lies_above_a_popup_with_dim_on() -> void:
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_DIM_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	var popup_button: Button = named_button(popup_of(POPUP_DIM_A), "First")
	assert_false(UICore.is_dimmed(popup_button))
	assert_true(await UICore.open_system_popup(one_button_param(), Callable()))
	assert_true(UICore.is_dimmed(popup_button), "the popup is below the dim of the system popup")
	UICore.close_popup(system_popup())
	await UnitTestCore.wait_frames(1)
	assert_false(UICore.is_dimmed(popup_button), "the dim moved back below the popup")
	assert_true(UICore._popup_dim.visible)
	assert_eq(UICore._popup_dim.get_parent(), UICore._popup_root)


## The panel interface calls of a system popup would be logged with the empty popup key.
func test_system_popup_prefab_with_a_popup_root() -> void:
	set_string("UICore.systemPopupResource", POPUP_DIM_TWEEN)
	assert_true(await start())
	LOG.fail_new[""] = true
	var panel_button: Button = await open_panel_button()
	var opening: CALL = CALL.new()
	opening.open_system_popup(one_button_param())
	assert_eq(tweens_started, 1, "the open tween of the root")
	assert_false(opening.done, "the open flow waits for the open tween")
	assert_true(UICore.is_dimmed(panel_button), "the dim of the root")
	await finish(opening)
	assert_true(opening.ok)
	assert_true(UICore.is_system_popup_visible())
	var closing: CALL = CALL.new()
	closing.close_popup(system_popup())
	await UnitTestCore.wait_frames(1)
	assert_eq(tweens_started, 2, "the close tween of the root")
	assert_false(closing.done)
	assert_true(UICore.is_dimmed(panel_button), "during the close tween")
	await finish(closing)
	assert_false(UICore.is_dimmed(panel_button), "the destruction started")
	assert_eq(LOG.count(":"), 0, "no method of the panel interface")


func test_system_popup_prefab_without_a_popup_root() -> void:
	set_string("UICore.systemPopupResource", FRAME)
	assert_true(await start())
	var panel_button: Button = await open_panel_button()
	assert_true(await UICore.open_system_popup(one_button_param(), Callable()))
	assert_eq(tweens_started, 0, "no open tween")
	assert_false(UICore.is_dimmed(panel_button), "dim off")
	assert_true(UICore.is_modal_covered(panel_button), "still modal")
	var closing: CALL = CALL.new()
	closing.close_popup(system_popup())
	await wait_result(closing)
	assert_eq(tweens_started, 0, "no close tween")
