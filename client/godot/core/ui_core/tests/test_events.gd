extends "res://core/ui_core/tests/support/ui_test_case.gd"
## `PanelFlowFinishedEvent` and the order of the opened and closed events.


func test_flow_finished_once_per_started_transition() -> void:
	assert_true(await start())
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	assert_eq(finished_events, PackedStringArray([PANEL_A + ":true:true"]))
	LOG.fail_new[PANEL_B] = true
	assert_false(await UICore.open_panel(PANEL_B, null, false))
	assert_eq(finished_events[1], PANEL_B + ":true:false")
	var gate: GATE = LOG.add_gate(PANEL_C)
	var call: CALL = CALL.new()
	call.open_panel(PANEL_C)
	await UnitTestCore.wait_frames(2)
	UICore.reset_panel_stack()
	assert_eq(finished_events[2], PANEL_C + ":true:false")
	assert_eq(finished_events.size(), 3)
	assert_eq(transitioning_at_finish, [false, false, false] as Array[bool], "not transitioning at the event")
	gate.open()


## The call a `UIOpenedEvent` of `PANEL_A` starts in `test_flow_finished_before_a_transition_an_opened_subscriber_starts`.
var _follow: CALL = null


func test_flow_finished_before_a_transition_an_opened_subscriber_starts() -> void:
	assert_true(await start())
	var gate: GATE = LOG.add_gate(PANEL_B)
	var follow: CALL = CALL.new()
	_follow = follow
	assert_true(EventCore.subscribe(UIOpenedEvent, _open_b_on_opened_a))
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	assert_eq(finished_events, PackedStringArray([PANEL_A + ":true:true"]), "one finished event for A")
	assert_eq(transitioning_at_finish, [false] as Array[bool], "not transitioning at the finished event of A")
	assert_true(UICore.is_panel_transitioning(), "the transition to B runs")
	assert_eq(warns(), 0)
	gate.open()
	await finish(follow)
	assert_true(follow.ok)
	assert_eq(finished_events, PackedStringArray([PANEL_A + ":true:true", PANEL_B + ":true:true"]))
	assert_eq(transitioning_at_finish, [false, false] as Array[bool], "not transitioning at either finished event")
	assert_eq(UICore.get_current_panel_key(), PANEL_B)


func _open_b_on_opened_a(event: UIOpenedEvent) -> void:
	if event.key == PANEL_A and _follow != null:
		var follow: CALL = _follow
		_follow = null
		follow.open_panel(PANEL_B)


func test_refused_calls_have_no_flow_finished() -> void:
	assert_true(await start())
	assert_false(await UICore.close_panel(), "no current panel")
	assert_eq(warns(), 1)
	var gate: GATE = LOG.add_gate(PANEL_A)
	var call: CALL = CALL.new()
	call.open_panel(PANEL_A)
	await UnitTestCore.wait_frames(2)
	assert_false(await UICore.open_panel(PANEL_B, null, false), "during a transition")
	assert_eq(warns(), 1)
	gate.open()
	await finish(call)
	UICore.set_panel_lock(true)
	assert_false(await UICore.open_panel(PANEL_B, null, false), "during the panel lock")
	assert_eq(warns(), 1)
	UICore.set_panel_lock(false)
	assert_eq(finished_events, PackedStringArray([PANEL_A + ":true:true"]), "one event for the transition that ran")


func test_closed_before_opened_in_one_operation() -> void:
	assert_true(await start())
	assert_true(await UICore.open_panel(PANEL_A, null, false))
	ui_events = PackedStringArray()
	assert_true(await UICore.open_panel(PANEL_B, null, false))
	assert_eq(ui_events, PackedStringArray(["closed:" + PANEL_A, "opened:" + PANEL_B]))
