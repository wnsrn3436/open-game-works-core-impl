extends "res://core/ui_core/tests/support/ui_test_case.gd"
## Panel transitions and the panel stack.


func test_open_covers_the_current_panel() -> void:
	assert_true(await start())
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	var a: UIPanel = current()
	var a_scope: Scope = a.scope
	assert_true(await UICore.open_panel(PANEL_B, null, false))
	assert_eq(UICore.get_panel_stack(), PackedStringArray([PANEL_A, PANEL_B]))
	assert_true(a_scope.released, "A scope released")
	await UnitTestCore.wait_frames(1)
	assert_false(is_instance_valid(a), "A destroyed")
	assert_eq(LOG.count(PANEL_A + ":on_closed:COVERED"), 1)
	assert_eq(LOG.count(PANEL_B + ":on_opened:NEW"), 1)


func test_failed_prepare_changes_nothing() -> void:
	assert_true(await start())
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	var a: UIPanel = current()
	LOG.fail_new[PANEL_B] = true
	assert_false(await UICore.open_panel(PANEL_B, null, false))
	assert_eq(current(), a)
	assert_eq(UICore.get_panel_stack(), PackedStringArray([PANEL_A]))
	await UnitTestCore.wait_frames(1)
	assert_eq(UICore._panel_root.find_children("*", "UIPanel", false, false).size(), 1, "no B instance")
	assert_eq(LOG.count(PANEL_A + ":on_closed"), 0)


func test_returned_panel_gets_its_param_and_cache() -> void:
	assert_true(await start())
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	var param: UIParam = TEST_PARAM.new()
	assert_true(await UICore.open_panel(PANEL_B, param, false))
	var cache: UIPanelCache = TEST_CACHE.new()
	(cache as TEST_CACHE).label = "C"
	current().cache = cache
	assert_true(await UICore.open_panel(PANEL_D, null, false))
	LOG.entries = PackedStringArray()
	var gate: GATE = LOG.add_gate(PANEL_B)
	var call: CALL = CALL.new()
	call.close_panel()
	await UnitTestCore.wait_frames(3)
	assert_eq(UICore.get_current_panel_key(), PANEL_D, "D shows while B prepares")
	assert_true(current().visible)
	assert_eq(LOG.params[PANEL_B], param, "the first param")
	assert_eq(log_entries()[1], PANEL_B + ":prepare:RETURNED:C")
	gate.open()
	await finish(call)
	assert_true(call.ok)
	var closed: int = LOG.index_of(PANEL_D + ":on_closed:CLOSED")
	var opened: int = LOG.index_of(PANEL_B + ":on_opened:RETURNED")
	assert_true(closed >= 0 and opened > closed, "D on_closed before B on_opened")
	assert_eq(UICore.get_current_panel_key(), PANEL_B)


func test_returned_panel_has_no_open_tween() -> void:
	assert_true(await start())
	var call: CALL = CALL.new()
	call.open_panel(PANEL_TWEEN)
	await finish(call)
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	var started: int = tweens_started
	assert_true(await UICore.close_panel())
	await UnitTestCore.wait_frames(2)
	assert_eq(tweens_started, started, "no tween for the returned panel")


func test_clear_stack_keeps_the_root_item() -> void:
	assert_true(await start())
	assert_true(await UICore.open_root_panel(PANEL_R))
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	assert_true(await UICore.open_panel(PANEL_B, null, true))
	assert_eq(UICore.get_panel_stack(), PackedStringArray([PANEL_R, PANEL_B]))
	assert_eq(LOG.count(PANEL_A + ":on_closed:CLOSED"), 1)


func test_clear_stack_covers_a_current_root_item() -> void:
	assert_true(await start())
	assert_true(await UICore.open_root_panel(PANEL_R))
	assert_true(await UICore.open_panel(PANEL_B, null, true))
	assert_eq(UICore.get_panel_stack(), PackedStringArray([PANEL_R, PANEL_B]))
	assert_eq(LOG.count(PANEL_R + ":on_closed:COVERED"), 1)


func test_clear_stack_without_root_item() -> void:
	assert_true(await start())
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	assert_true(await UICore.open_panel(PANEL_C, null, false))
	assert_true(await UICore.open_panel(PANEL_B, null, true))
	assert_eq(UICore.get_panel_stack(), PackedStringArray([PANEL_B]))


func test_close_panel_on_root_item_is_refused() -> void:
	assert_true(await start())
	assert_true(await UICore.open_root_panel(PANEL_R))
	assert_false(await UICore.close_panel())
	assert_eq(warns(), 1)
	assert_eq(UICore.get_panel_stack(), PackedStringArray([PANEL_R]))


func test_close_with_failing_destination() -> void:
	assert_true(await start())
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	assert_true(await UICore.open_panel(PANEL_B, null, false))
	assert_true(await UICore.open_panel(PANEL_C, null, false))
	var c: UIPanel = current()
	LOG.entries = PackedStringArray()
	opened_events = PackedStringArray()
	closed_events = PackedStringArray()
	LOG.fail_returned[PANEL_B] = true
	assert_false(await UICore.close_panel())
	assert_eq(current(), c)
	assert_true(c.visible)
	assert_eq(UICore.get_panel_stack(), PackedStringArray([PANEL_A, PANEL_B, PANEL_C]))
	assert_eq(LOG.count(PANEL_C + ":on_closed"), 0)
	assert_eq(opened_events.size() + closed_events.size(), 0, "no opened or closed event")
	assert_true(await UICore.close_panel(true))
	assert_eq(UICore.get_panel_stack(), PackedStringArray([PANEL_A]))
	assert_eq(LOG.count(PANEL_A + ":prepare:RETURNED"), 1)
	assert_eq(LOG.count(PANEL_A + ":on_opened:RETURNED"), 1)


func test_forced_close_shows_a_failing_root_item() -> void:
	assert_true(await start())
	assert_true(await UICore.open_root_panel(PANEL_R))
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	LOG.fail_returned[PANEL_R] = true
	assert_true(await UICore.close_panel(true))
	assert_eq(errors(), 1)
	assert_eq(UICore.get_current_panel_key(), PANEL_R)
	assert_eq(LOG.count(PANEL_R + ":on_opened:RETURNED"), 1)


func test_open_the_current_key_replaces_it() -> void:
	assert_true(await start())
	assert_true(await UICore.open_panel(PANEL_C, null, false))
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	var param: UIParam = TEST_PARAM.new()
	assert_true(await UICore.open_panel(PANEL_A, param, false))
	assert_eq(LOG.count(PANEL_A + ":on_closed:CLOSED"), 1)
	var prepared: int = LOG.entries.rfind(PANEL_A + ":prepare:NEW:none")
	assert_true(prepared < LOG.index_of(PANEL_A + ":on_closed:CLOSED"), "new A prepared before old A closed")
	assert_eq(UICore.get_panel_stack(), PackedStringArray([PANEL_C, PANEL_A]))
	assert_eq(current().panel_param, param)
	var a: UIPanel = current()
	LOG.fail_new[PANEL_A] = true
	assert_false(await UICore.open_panel(PANEL_A, null, false))
	assert_eq(current(), a)
	assert_eq(UICore.get_panel_stack(), PackedStringArray([PANEL_C, PANEL_A]))


func test_replacing_the_root_item_keeps_it_root() -> void:
	assert_true(await start())
	assert_true(await UICore.open_root_panel(PANEL_R))
	assert_true(await UICore.open_panel(PANEL_R, TEST_PARAM.new(), false))
	assert_true(UICore._stack[0].root)
	assert_false(await UICore.close_panel())
	assert_eq(warns(), 1)


func test_close_panels_to() -> void:
	assert_true(await start())
	assert_true(await UICore.open_root_panel(PANEL_R))
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	assert_true(await UICore.open_panel(PANEL_B, null, false))
	assert_true(await UICore.open_panel(PANEL_C, null, false))
	LOG.entries = PackedStringArray()
	LOG.fail_returned[PANEL_A] = true
	assert_false(await UICore.close_panels_to(PANEL_A))
	assert_eq(UICore.get_panel_stack(), PackedStringArray([PANEL_R, PANEL_A, PANEL_B, PANEL_C]))
	LOG.fail_returned.erase(PANEL_A)
	LOG.entries = PackedStringArray()
	assert_true(await UICore.close_panels_to(PANEL_A))
	assert_eq(UICore.get_panel_stack(), PackedStringArray([PANEL_R, PANEL_A]))
	assert_eq(LOG.count(PANEL_B + ":"), 0, "B has no instance and no callback")
	assert_false(await UICore.close_panels_to(PANEL_D))
	assert_eq(warns(), 1)
	finished_events = PackedStringArray()
	assert_true(await UICore.close_panels_to(PANEL_A))
	assert_eq(finished_events.size(), 0, "no transition for the current panel key")


func test_open_panels_puts_hidden_items() -> void:
	assert_true(await start())
	assert_true(await UICore.open_root_panel(PANEL_R))
	LOG.entries = PackedStringArray()
	opened_events = PackedStringArray()
	assert_true(await UICore.open_panels(_requests([PANEL_A, PANEL_B, PANEL_C])))
	assert_eq(UICore.get_panel_stack(), PackedStringArray([PANEL_R, PANEL_A, PANEL_B, PANEL_C]))
	assert_eq(LOG.count(PANEL_A + ":") + LOG.count(PANEL_B + ":"), 0)
	assert_eq(LOG.count(PANEL_C + ":prepare:NEW:none"), 1)
	assert_eq(LOG.count(PANEL_C + ":on_opened:NEW"), 1)
	assert_eq(opened_events, PackedStringArray([PANEL_C + ":NEW"]))
	var started: int = tweens_started
	assert_true(await UICore.close_panel())
	assert_eq(LOG.count(PANEL_B + ":prepare:RETURNED:none"), 1)
	assert_eq(LOG.count(PANEL_B + ":on_opened:RETURNED"), 1)
	assert_eq(opened_events[opened_events.size() - 1], PANEL_B + ":RETURNED")
	await UnitTestCore.wait_frames(2)
	assert_eq(tweens_started, started, "no open tween")


func test_open_panels_failure_puts_nothing() -> void:
	assert_true(await start())
	assert_true(await UICore.open_root_panel(PANEL_R))
	LOG.fail_new[PANEL_C] = true
	assert_false(await UICore.open_panels(_requests([PANEL_A, PANEL_B, PANEL_C])))
	assert_eq(UICore.get_panel_stack(), PackedStringArray([PANEL_R]))


func test_open_panels_with_clear_stack() -> void:
	assert_true(await start())
	assert_true(await UICore.open_root_panel(PANEL_R))
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	assert_true(await UICore.open_panels(_requests([PANEL_B, PANEL_C]), true))
	assert_eq(UICore.get_panel_stack(), PackedStringArray([PANEL_R, PANEL_B, PANEL_C]))
	assert_eq(LOG.count(PANEL_A + ":on_closed:CLOSED"), 1)


func test_open_panels_with_clear_stack_without_root() -> void:
	assert_true(await start())
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	assert_true(await UICore.open_panels(_requests([PANEL_B, PANEL_C]), true))
	assert_eq(UICore.get_panel_stack(), PackedStringArray([PANEL_B, PANEL_C]))


func test_open_panels_without_clear_stack() -> void:
	assert_true(await start())
	assert_true(await UICore.open_root_panel(PANEL_R))
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	assert_true(await UICore.open_panels(_requests([PANEL_B, PANEL_C])))
	assert_eq(UICore.get_panel_stack(), PackedStringArray([PANEL_R, PANEL_A, PANEL_B, PANEL_C]))


func test_open_root_panel_needs_an_empty_stack() -> void:
	assert_true(await start())
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	assert_false(await UICore.open_root_panel(PANEL_R))
	assert_eq(errors(), 1)


func test_reset_during_prepare_cancels_the_open() -> void:
	assert_true(await start())
	var gate: GATE = LOG.add_gate(PANEL_A)
	var call: CALL = CALL.new()
	call.open_panel(PANEL_A)
	await UnitTestCore.wait_frames(3)
	assert_eq(LOG.count(PANEL_A + ":prepare"), 1)
	UICore.reset_panel_stack()
	assert_true(call.done)
	assert_false(call.ok)
	gate.open()
	await UnitTestCore.wait_frames(2)
	assert_eq(UICore.get_panel_stack().size(), 0)
	assert_null(current())
	assert_eq(LOG.count(PANEL_A + ":on_opened"), 0)
	assert_false(InputBlockCore.is_blocked())


func _requests(keys: Array[String]) -> Array[UIPanelRequest]:
	var requests: Array[UIPanelRequest] = []
	for key: String in keys:
		var request: UIPanelRequest = UIPanelRequest.new()
		request.panel_key = key
		requests.append(request)
	return requests
