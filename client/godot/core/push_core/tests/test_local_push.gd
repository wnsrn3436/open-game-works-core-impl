extends UnitTestCase
## Local push: scheduling by `local_push` row, the checks and their logs, the permission, the fake schedule result,
## the text language, and the schedules `release` keeps and `SessionEndedEvent` clears.

const Env := preload("res://core/push_core/tests/support/push_test_env.gd")
const TestNotification := preload("res://core/push_core/tests/support/scripted_notification_adapter.gd")

const _MISSING_ID: int = 987654


func after_each() -> void:
	super()
	Env.stop()


## Starts with the fake notification adapter and waits for the first permission read.
func _start_fake() -> void:
	assert_true(await Env.start(null, FakeNotificationAdapter.new()))
	await UnitTestCore.wait_frames(2)
	assert_eq(PushCore.get_permission(), PushCore.PermissionStatus.GRANTED)


func _scheduled() -> Array[ScheduledLocalPush]:
	var buffer: Array[ScheduledLocalPush] = []
	buffer.resize(8)
	buffer.resize(PushCoreDev.list_scheduled_local(buffer))
	return buffer


func test_schedule_local_uses_the_row_delay() -> void:
	await _start_fake()
	var id: int = Env.id_of(Env.RETURN_ROW)
	assert_true(PushCore.schedule_local(id))
	var list: Array[ScheduledLocalPush] = _scheduled()
	assert_eq(list.size(), 1)
	assert_eq(list[0].id, id)
	assert_eq(list[0].remaining_ms, Env.RETURN_DELAY_MS)


func test_scheduling_the_same_row_twice_keeps_one_schedule_with_the_later_delay() -> void:
	await _start_fake()
	var id: int = Env.id_of(Env.EVENT_ROW)
	assert_true(PushCore.schedule_local_after(id, 60000))
	assert_true(PushCore.schedule_local_after(id, 120000))
	var list: Array[ScheduledLocalPush] = _scheduled()
	assert_eq(list.size(), 1)
	assert_eq(list[0].id, id)
	assert_eq(list[0].remaining_ms, 120000)
	var row_id: int = Env.id_of(Env.RETURN_ROW)
	assert_true(PushCore.schedule_local(row_id))
	UnitTestCore.advance_clock(1000, false)
	assert_true(PushCore.schedule_local(row_id))
	list = _scheduled()
	assert_eq(list.size(), 2)
	assert_eq(list[1].id, row_id)
	assert_eq(list[1].remaining_ms, Env.RETURN_DELAY_MS, "the later schedule counts from its own time")


func test_each_failed_check_schedules_nothing_and_logs_one_error() -> void:
	await _start_fake()
	assert_false(PushCore.schedule_local(Env.id_of(Env.EVENT_ROW)), "null delay row")
	assert_eq(Env.errors(), 1)
	assert_false(PushCore.schedule_local_after(Env.id_of(Env.RETURN_ROW), 1000), "row with a delay")
	assert_eq(Env.errors(), 1)
	assert_false(PushCore.schedule_local_after(Env.id_of(Env.EVENT_ROW), 0), "zero delay")
	assert_eq(Env.errors(), 1)
	assert_false(PushCore.schedule_local_after(Env.id_of(Env.EVENT_ROW), -5), "negative delay")
	assert_eq(Env.errors(), 1)
	assert_false(PushCore.schedule_local(_MISSING_ID), "no local_push row")
	assert_eq(Env.errors(), 1)
	assert_false(PushCore.schedule_local_after(_MISSING_ID, 1000), "no local_push row")
	assert_eq(Env.errors(), 1)
	assert_eq(_scheduled().size(), 0)


func test_cancel_of_an_id_value_with_no_row_logs_an_error() -> void:
	await _start_fake()
	PushCore.cancel_local(_MISSING_ID)
	assert_eq(Env.errors(), 1)


func test_permission_not_granted_sends_nothing_to_the_os_and_logs_nothing() -> void:
	var adapter: TestNotification = TestNotification.new()
	adapter.permission = PushCore.PermissionStatus.DENIED
	assert_true(await Env.start(null, adapter))
	assert_false(PushCore.schedule_local(Env.id_of(Env.RETURN_ROW)))
	assert_false(PushCore.schedule_local_after(Env.id_of(Env.EVENT_ROW), 1000))
	adapter.permission = PushCore.PermissionStatus.UNDETERMINED
	UnitTestCore.advance_clock(1000, true)
	await UnitTestCore.wait_frames(2)
	assert_eq(PushCore.get_permission(), PushCore.PermissionStatus.UNDETERMINED)
	assert_false(PushCore.schedule_local(Env.id_of(Env.RETURN_ROW)))
	assert_eq(adapter.scheduled.size(), 0)
	assert_eq(Env.errors(), 0)


func test_permission_not_granted_on_the_fake_adapter_sends_nothing() -> void:
	assert_true(await Env.start(null, FakeNotificationAdapter.new()))
	assert_false(PushCore.schedule_local(Env.id_of(Env.RETURN_ROW)), "before the first read ends")
	await UnitTestCore.wait_frames(2)
	PushCoreDev.set_fake_permission(PushCore.PermissionStatus.DENIED)
	UnitTestCore.advance_clock(1000, true)
	await UnitTestCore.wait_frames(2)
	assert_false(PushCore.schedule_local(Env.id_of(Env.RETURN_ROW)))
	assert_eq(_scheduled().size(), 0)
	assert_eq(Env.errors(), 0)


func test_fake_schedule_result_false_fails_each_schedule_with_one_error() -> void:
	await _start_fake()
	PushCoreDev.set_fake_schedule_result(false)
	assert_false(PushCore.schedule_local(Env.id_of(Env.RETURN_ROW)))
	assert_eq(Env.errors(), 1)
	assert_false(PushCore.schedule_local_after(Env.id_of(Env.EVENT_ROW), 1000))
	assert_eq(Env.errors(), 1)
	assert_eq(_scheduled().size(), 0)
	PushCoreDev.set_fake_schedule_result(true)
	assert_true(PushCore.schedule_local(Env.id_of(Env.RETURN_ROW)))
	assert_eq(_scheduled().size(), 1)


func test_title_and_body_are_the_text_of_the_language_at_schedule_time() -> void:
	var adapter: TestNotification = TestNotification.new()
	assert_true(await Env.start(null, adapter))
	var id: int = Env.id_of(Env.RETURN_ROW)
	var row: GameData.LocalPushRow = GameData.LocalPushTable.get_row(id)
	assert_true(PushCore.schedule_local(id))
	assert_eq(adapter.scheduled[0].title, "Come back")
	assert_eq(adapter.scheduled[0].body, "Your rewards are waiting")
	assert_true(await Env.restart_language("ca", PackedStringArray([row.title, "Torna", row.body, "Les recompenses t'esperen"])))
	assert_true(PushCore.schedule_local(id))
	assert_eq(adapter.scheduled.size(), 2)
	assert_eq(adapter.scheduled[1].title, "Torna")
	assert_eq(adapter.scheduled[1].body, "Les recompenses t'esperen")
	assert_eq(adapter.scheduled[0].title, "Come back", "the earlier schedule keeps its text")


func test_release_keeps_the_os_schedules() -> void:
	await _start_fake()
	assert_true(PushCore.schedule_local(Env.id_of(Env.RETURN_ROW)))
	assert_true(PushCore.schedule_local_after(Env.id_of(Env.EVENT_ROW), 1000))
	PushCore.release()
	assert_true(Env.start_push(null, FakeNotificationAdapter.new()))
	assert_eq(_scheduled().size(), 2)
	PushCore.cancel_local(Env.id_of(Env.EVENT_ROW))
	assert_eq(_scheduled().size(), 1)
	PushCore.cancel_all_local()
	assert_eq(_scheduled().size(), 0)


func test_release_calls_no_cancel() -> void:
	var adapter: TestNotification = TestNotification.new()
	assert_true(await Env.start(null, adapter))
	assert_true(PushCore.schedule_local(Env.id_of(Env.RETURN_ROW)))
	PushCore.release()
	assert_eq(adapter.cancel_all_calls, 0)
	assert_eq(adapter.cancelled.size(), 0)


func test_session_end_of_another_account_cancels_all_local_once() -> void:
	var adapter: TestNotification = TestNotification.new()
	assert_true(await Env.start(null, adapter))
	var reasons: PackedInt32Array = [
		AuthCore.SessionEndReason.LOGOUT,
		AuthCore.SessionEndReason.SWITCH,
		AuthCore.SessionEndReason.WITHDRAW,
		AuthCore.SessionEndReason.AGE_BLOCKED,
	]
	var expected: int = 0
	for reason: int in reasons:
		_publish_session_end(reason as AuthCore.SessionEndReason)
		expected += 1
		assert_eq(adapter.cancel_all_calls, expected, str(reason))
	_publish_session_end(AuthCore.SessionEndReason.REJECTED)
	assert_eq(adapter.cancel_all_calls, expected, "Rejected keeps the schedules")
	_publish_session_end(AuthCore.SessionEndReason.REPLACED)
	assert_eq(adapter.cancel_all_calls, expected, "Replaced keeps the schedules")


func _publish_session_end(reason: AuthCore.SessionEndReason) -> void:
	var event: SessionEndedEvent = EventCore.acquire(SessionEndedEvent) as SessionEndedEvent
	event.reason = reason
	EventCore.publish(event)
