extends "res://core/ui_core/tests/support/ui_test_case.gd"
## Popups, the popup queue, system popups over popups, `close_popup`, `close_all_popups` and `is_flow_in_progress`.


func test_popups_open_one_at_a_time_in_order() -> void:
	assert_true(await start())
	var gate: GATE = LOG.add_gate(POPUP_A)
	var first: CALL = CALL.new()
	first.open_popup(POPUP_A)
	var second: CALL = CALL.new()
	second.open_popup(POPUP_B)
	await UnitTestCore.wait_frames(3)
	assert_eq(LOG.count(POPUP_B + ":prepare"), 0, "B waits for the flow of A")
	gate.open()
	await finish(second)
	assert_true(first.ok and second.ok)
	assert_true(LOG.index_of(POPUP_B + ":prepare") > LOG.index_of(POPUP_A + ":on_opened"))
	assert_true(popup_of(POPUP_B).is_greater_than(popup_of(POPUP_A)), "B above A")


func test_popup_opens_during_a_panel_transition() -> void:
	assert_true(await start())
	var gate: GATE = LOG.add_gate(PANEL_A)
	var panel: CALL = CALL.new()
	panel.open_panel(PANEL_A)
	await UnitTestCore.wait_frames(2)
	var popup: CALL = CALL.new()
	popup.open_popup(POPUP_A)
	await finish(popup)
	assert_true(popup.ok)
	assert_false(panel.done, "the transition still runs")
	gate.open()
	await finish(panel)
	assert_true(panel.ok)


func test_system_popup_opens_over_everything() -> void:
	assert_true(await start())
	assert_true(await UICore.open_system_popup(one_button_param("first"), Callable()))
	assert_true(await UICore.open_system_popup(one_button_param("second"), Callable()), "over another system popup")
	var gate: GATE = LOG.add_gate(POPUP_A)
	var popup: CALL = CALL.new()
	popup.open_popup(POPUP_A)
	await UnitTestCore.wait_frames(3)
	assert_true(await UICore.open_system_popup(one_button_param("third"), Callable()), "while a popup prepares")
	gate.open()
	await finish(popup)
	var system: Control = system_popup()
	assert_true(system.is_greater_than(popup_of(POPUP_A)), "system popups above the popup opened later")


func test_close_popup_order_and_callbacks_once() -> void:
	assert_true(await start())
	var call: CALL = CALL.new()
	call.open_popup(POPUP_TWEEN, hidden_of("hidden"))
	await finish(call)
	var popup: UIPopup = popup_of(POPUP_TWEEN)
	var closing: CALL = CALL.new()
	closing.close_popup(popup, after_of("after"))
	await UnitTestCore.wait_frames(1)
	assert_eq(LOG.count(POPUP_TWEEN + ":on_closed"), 1)
	assert_eq(hidden_calls.size(), 0, "the close tween runs first")
	assert_true(is_instance_valid(popup))
	await finish(closing)
	assert_eq(hidden_calls, PackedStringArray(["hidden"]))
	assert_eq(after_calls, PackedStringArray(["after"]))
	assert_null(popup_of(POPUP_TWEEN))
	await UnitTestCore.wait_frames(2)
	assert_false(is_instance_valid(popup), "destroyed")
	assert_eq(hidden_calls.size(), 1)
	assert_eq(after_calls.size(), 1)


## State at the hidden callback of `test_close_popup_destroys_before_hidden_and_closed_event_after`.
var _watched: UIPopup = null
var _watched_scope: Scope = null
var _hidden_in_tree: bool = true
var _hidden_scope_released: bool = false
var _hidden_closed_events: int = -1
var _hidden_after_calls: int = -1


func test_close_popup_destroys_before_hidden_and_closed_event_after() -> void:
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_A, null, _on_watched_hidden) == UICore.PopupOpenResult.OPENED)
	_watched = popup_of(POPUP_A)
	_watched_scope = UICore._shown_record_of(_watched).scope
	await UICore.close_popup(_watched, after_of("after"))
	assert_false(_hidden_in_tree, "the instance is out of the tree at the hidden callback")
	assert_true(_hidden_scope_released, "the scope is released at the hidden callback")
	assert_eq(_hidden_closed_events, 0, "no UIClosedEvent before the hidden callback")
	assert_eq(_hidden_after_calls, 0, "the after-close callback follows the hidden callback")
	assert_eq(closed_events, PackedStringArray([POPUP_A + ":CLOSED"]), "one UIClosedEvent after the hidden callback")
	assert_eq(after_calls, PackedStringArray(["after"]))


func _on_watched_hidden() -> void:
	_hidden_in_tree = _watched.is_inside_tree()
	_hidden_scope_released = _watched_scope.released
	_hidden_closed_events = closed_events.size()
	_hidden_after_calls = after_calls.size()


func test_close_all_popups_skips_after_close_callback() -> void:
	assert_true(await start())
	var call: CALL = CALL.new()
	call.open_popup(POPUP_TWEEN, hidden_of("hidden"))
	await finish(call)
	var closing: CALL = CALL.new()
	closing.close_popup(popup_of(POPUP_TWEEN), after_of("after"))
	await UnitTestCore.wait_frames(1)
	UICore.close_all_popups()
	await advance(TWEEN_MS * 3)
	assert_eq(after_calls.size(), 0)
	assert_eq(hidden_calls, PackedStringArray(["hidden"]))


func test_close_all_popups_empties_popups_and_queue() -> void:
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_A, null, hidden_of("a")) == UICore.PopupOpenResult.OPENED)
	assert_true(await UICore.open_popup(POPUP_B, null, hidden_of("b")) == UICore.PopupOpenResult.OPENED)
	var gate: GATE = LOG.add_gate(POPUP_C)
	var preparing: CALL = CALL.new()
	preparing.open_popup(POPUP_C, hidden_of("c"))
	var queued: CALL = CALL.new()
	queued.open_popup(POPUP_DIM_A, hidden_of("d"))
	await UnitTestCore.wait_frames(3)
	UICore.close_all_popups()
	assert_true(queued.done and queued.result == UICore.PopupOpenResult.FAILED)
	assert_true(preparing.done and preparing.result == UICore.PopupOpenResult.FAILED)
	assert_eq(UICore.get_open_popup_count(), 0)
	assert_eq(UICore._queue.size(), 0)
	assert_eq(hidden_calls, PackedStringArray(["b", "a"]))
	gate.open()


func test_close_popup_during_open_tween() -> void:
	assert_true(await start())
	var call: CALL = CALL.new()
	var tween_started: UnitTestLatch = UnitTestCore.latch_event(TweenStartedEvent)
	call.open_popup(POPUP_TWEEN, hidden_of("hidden"))
	assert_true(await wait_event(tween_started), "the popup is shown and its open tween runs")
	var popup: UIPopup = popup_of(POPUP_TWEEN)
	assert_not_null(popup)
	assert_false(call.done, "in the open tween")
	var closing: CALL = CALL.new()
	closing.close_popup(popup, Callable())
	assert_true(call.done and call.ok, "Opened")
	assert_eq(opened_events, PackedStringArray([POPUP_TWEEN + ":NEW"]))
	assert_true(LOG.count(POPUP_TWEEN + ":on_closed") == 1)
	await finish(closing)
	assert_eq(hidden_calls.size(), 1)
	assert_eq(closed_events, PackedStringArray([POPUP_TWEEN + ":CLOSED"]))
	assert_false(InputBlockCore.is_blocked())


func test_opened_before_on_closed() -> void:
	assert_true(await start())
	var order: PackedStringArray = PackedStringArray()
	var call: CALL = CALL.new()
	var tween_started: UnitTestLatch = UnitTestCore.latch_event(TweenStartedEvent)
	call.open_popup(POPUP_TWEEN)
	assert_true(await wait_event(tween_started), "the popup is shown and its open tween runs")
	call.finished.connect(func() -> void: order.append("opened:%d" % LOG.count(POPUP_TWEEN + ":on_closed")))
	UICore.close_popup(popup_of(POPUP_TWEEN))
	assert_eq(order, PackedStringArray(["opened:0"]))
	await advance(TWEEN_MS * 2)


func test_close_all_popups_with_each_popup_state() -> void:
	assert_true(await start())
	var gate: GATE = LOG.add_gate(POPUP_A)
	var preparing: CALL = CALL.new()
	preparing.open_popup(POPUP_A, hidden_of("preparing"))
	await UnitTestCore.wait_frames(3)
	UICore.close_all_popups()
	assert_true(preparing.done and preparing.result == UICore.PopupOpenResult.FAILED)
	assert_eq(hidden_calls.size(), 0, "no hidden callback before it shows")
	gate.open()
	var opening: CALL = CALL.new()
	opening.open_popup(POPUP_TWEEN, hidden_of("opening"))
	await UnitTestCore.wait_frames(3)
	assert_false(opening.done)
	UICore.close_all_popups()
	assert_true(opening.done and opening.result == UICore.PopupOpenResult.OPENED)
	assert_eq(hidden_calls, PackedStringArray(["opening"]))
	hidden_calls = PackedStringArray()
	var open: CALL = CALL.new()
	open.open_popup(POPUP_TWEEN, hidden_of("closing"))
	await finish(open)
	LOG.entries = PackedStringArray()
	UICore.close_popup(popup_of(POPUP_TWEEN))
	await UnitTestCore.wait_frames(1)
	UICore.close_all_popups()
	assert_eq(LOG.count(POPUP_TWEEN + ":on_closed"), 1, "on_closed is not called again")
	assert_eq(hidden_calls, PackedStringArray(["closing"]))


func test_popups_stay_through_panel_transitions() -> void:
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_NONMODAL, null, Callable()) == UICore.PopupOpenResult.OPENED)
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	assert_true(await UICore.open_panel(PANEL_B, null, false))
	assert_true(await UICore.close_panel())
	UICore.reset_panel_stack()
	assert_not_null(popup_of(POPUP_NONMODAL))
	assert_eq(UICore.get_open_popups(), PackedStringArray([POPUP_NONMODAL]))


func test_popup_suppress_is_read_by_the_instance() -> void:
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	assert_null(popup_of(POPUP_A).popup_suppress)
	var suppress: PopupSuppress = PopupSuppress.new()
	suppress.key = "ui_test.popup_b"
	suppress.mode = UICore.PopupSuppressMode.TODAY
	assert_true(await UICore.open_popup(POPUP_B, null, Callable(), suppress) == UICore.PopupOpenResult.OPENED)
	assert_eq(popup_of(POPUP_B).popup_suppress, suppress)


func test_modal_popup_blocks_input_below() -> void:
	assert_true(await start())
	assert_true(await UICore.open_panel(PANEL_NONMODAL, null, false))
	var scene_button: Button = add_button(UICore.UILayer.SCENE_UI, "scene", Vector2(900, 300))
	var panel_button: Button = named_button(current(), "Button")
	ui_button_of(panel_button).set_on_click(click_of("panel"))
	assert_true(await UICore.open_popup(POPUP_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	await advance(CLICK_INTERVAL_MS)
	await tap_control(panel_button)
	await advance(CLICK_INTERVAL_MS)
	await tap_control(scene_button)
	assert_eq(clicks.size(), 0, "a modal popup covers the panel and the scene UI")
	UICore.close_all_popups()
	assert_true(await UICore.open_popup(POPUP_NONMODAL, null, Callable()) == UICore.PopupOpenResult.OPENED)
	await advance(CLICK_INTERVAL_MS)
	await tap_control(panel_button)
	assert_eq(clicks, PackedStringArray(["panel"]), "a popup without modal lets the panel take input")


func test_one_dim_below_the_top_dim_popup() -> void:
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_DIM_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	assert_true(await UICore.open_popup(POPUP_DIM_B, null, Callable()) == UICore.PopupOpenResult.OPENED)
	var dims: int = 0
	for child: Node in UICore._popup_root.get_children():
		if child == UICore._popup_dim and (child as Control).visible:
			dims += 1
	assert_eq(dims, 1)
	var upper: UIPopup = popup_of(POPUP_DIM_B)
	assert_eq(UICore._popup_dim.get_index(), upper.get_index() - 1, "right below the upper popup")
	await UICore.close_popup(upper)
	var lower: UIPopup = popup_of(POPUP_DIM_A)
	assert_eq(UICore._popup_dim.get_index(), lower.get_index() - 1, "right below the lower popup")
	assert_true(UICore._popup_dim.visible)


func test_open_popup_count_follows_shown_popups() -> void:
	assert_true(await start())
	assert_eq(UICore.get_open_popup_count(), 0)
	assert_true(await UICore.open_popup(POPUP_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	assert_eq(UICore.get_open_popup_count(), 1)
	assert_true(await UICore.open_system_popup(one_button_param(), Callable()))
	assert_eq(UICore.get_open_popup_count(), 2)
	await tap_control(system_buttons(system_popup())[0])
	assert_eq(UICore.get_open_popup_count(), 1)
	await UICore.close_popup(popup_of(POPUP_A))
	assert_eq(UICore.get_open_popup_count(), 0)


func test_system_popup_visible_follows_the_root() -> void:
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	assert_false(UICore.is_system_popup_visible(), "only a normal popup")
	assert_true(await UICore.open_system_popup(one_button_param(), Callable()))
	assert_true(UICore.is_system_popup_visible())
	assert_eq(UICore.is_system_popup_visible(), UICore._system_root.visible)
	await tap_control(system_buttons(system_popup())[0])
	assert_false(UICore.is_system_popup_visible())
	assert_eq(UICore.is_system_popup_visible(), UICore._system_root.visible)


func test_system_popups_are_not_in_the_open_popups() -> void:
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	opened_events = PackedStringArray()
	closed_events = PackedStringArray()
	assert_true(await UICore.open_system_popup(one_button_param(), Callable()))
	assert_eq(UICore.get_open_popups(), PackedStringArray([POPUP_A]))
	await tap_control(system_buttons(system_popup())[0])
	assert_eq(UICore.get_open_popups(), PackedStringArray([POPUP_A]))
	assert_eq(opened_events.size() + closed_events.size(), 0)


func test_memory_free_popup_counts() -> void:
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	assert_true(await UICore.open_system_popup(one_button_param(), Callable()))
	LogCore.release()
	for i: int in 100:
		UICore.get_open_popup_count()
		UICore.is_system_popup_visible()
		UICore.is_flow_in_progress()
	var objects: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	for i: int in 1000:
		UICore.get_open_popup_count()
		UICore.is_system_popup_visible()
		UICore.is_flow_in_progress()
	var objects_after: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory_after: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	assert_true(objects_after <= objects, "no object made")
	assert_true(memory_after <= memory, "no memory taken")


func test_flow_in_progress_before_init() -> void:
	assert_true(await start(false))
	assert_false(UICore.is_flow_in_progress())
	assert_eq(errors(), 1)


func test_flow_in_progress_follows_the_flows() -> void:
	set_string("UICore.systemPopupResource", POPUP_TWEEN)
	assert_true(await start())
	assert_false(UICore.is_flow_in_progress(), "no flow")
	var panel_gate: GATE = LOG.add_gate(PANEL_A)
	var panel: CALL = CALL.new()
	panel.open_panel(PANEL_A)
	await UnitTestCore.wait_frames(2)
	assert_true(UICore.is_flow_in_progress(), "a panel transition")
	panel_gate.open()
	await finish(panel)
	assert_true(panel.ok)
	assert_false(UICore.is_flow_in_progress(), "the panel transition ended")
	var popup_gate: GATE = LOG.add_gate(POPUP_A)
	var first: CALL = CALL.new()
	first.open_popup(POPUP_A)
	var queued: CALL = CALL.new()
	queued.open_popup(POPUP_TWEEN)
	await UnitTestCore.wait_frames(2)
	assert_true(UICore.is_flow_in_progress(), "an open flow in prepare and a queued popup")
	popup_gate.open()
	await wait_result(first)
	assert_true(first.ok, "the flow of the first popup ended")
	assert_false(queued.done)
	assert_true(UICore.is_flow_in_progress(), "the queued popup in its open flow")
	await finish(queued)
	assert_true(queued.ok)
	assert_false(UICore.is_flow_in_progress(), "the open tween ended")
	var closing: CALL = CALL.new()
	closing.close_popup(popup_of(POPUP_TWEEN))
	await UnitTestCore.wait_frames(1)
	assert_false(closing.done, "in the close tween")
	assert_true(UICore.is_flow_in_progress(), "a popup close")
	await finish(closing)
	assert_false(UICore.is_flow_in_progress(), "the close ended")
	var system: CALL = CALL.new()
	system.open_system_popup(one_button_param())
	await UnitTestCore.wait_frames(1)
	assert_false(system.done, "in the open tween")
	assert_true(UICore.is_flow_in_progress(), "a system popup open flow")
	await finish(system)
	assert_true(system.ok)
	assert_false(UICore.is_flow_in_progress(), "the system popup is open")
	var system_closing: CALL = CALL.new()
	system_closing.close_popup(system_popup())
	await UnitTestCore.wait_frames(1)
	assert_false(system_closing.done, "in the close tween")
	assert_true(UICore.is_flow_in_progress(), "a system popup close")
	await finish(system_closing)
	assert_null(system_popup())
	assert_false(UICore.is_flow_in_progress(), "only open popups remain")
