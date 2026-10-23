extends UnitTestCase
## Remote push: `PushReceivedEvent`, `PushOpenedEvent`, `simulate_push`, the launch push, and the DEV code STG and
## PROD builds leave out.

const Env := preload("res://core/push_core/tests/support/push_test_env.gd")
const TestPush := preload("res://core/push_core/tests/support/scripted_push_adapter.gd")
const TestNotification := preload("res://core/push_core/tests/support/scripted_notification_adapter.gd")
const Recorder := preload("res://core/push_core/tests/support/push_event_recorder.gd")

## Names the code STG and PROD builds keep must not hold.
const _DEV_WORDS: PackedStringArray = ["PushCoreDev", "FakePushAdapter", "FakeNotificationAdapter", "ScheduledLocalPush", "/dev/"]

var _recorder: Recorder = null


func after_each() -> void:
	super()
	if _recorder != null:
		_recorder.finish()
		_recorder = null
	Env.stop()


func _record() -> void:
	_recorder = Recorder.new()
	assert_true(_recorder.start())


func test_push_adapter_notifications_become_events() -> void:
	var push: TestPush = TestPush.new()
	assert_true(await Env.start(push, TestNotification.new()))
	_record()
	push.receive(31)
	push.open(32)
	push.receive(0)
	assert_eq(_recorder.received, PackedInt64Array([31, 0]))
	assert_eq(_recorder.opened, PackedInt64Array([32]))


func test_notifications_the_push_adapter_tells_from_poll_become_events_while_the_tree_is_paused() -> void:
	var push: TestPush = TestPush.new()
	assert_true(await Env.start(push, TestNotification.new()))
	_record()
	TimeCore.set_paused(true)
	await UnitTestCore.wait_frames(1)
	push.queue_receive(33)
	push.queue_open(34)
	await UnitTestCore.wait_frames(2)
	assert_eq(_recorder.received, PackedInt64Array([33]), "the received push while paused")
	assert_eq(_recorder.opened, PackedInt64Array([34]), "the opened notification while paused")
	TimeCore.set_paused(false)


func test_notifications_of_an_adapter_push_core_does_not_hold_are_not_heard() -> void:
	assert_true(await Env.start(TestPush.new(), TestNotification.new()))
	_record()
	var other: TestPush = TestPush.new()
	other.receive(41)
	other.open(42)
	assert_eq(_recorder.received.size(), 0)
	assert_eq(_recorder.opened.size(), 0)


func test_simulate_push_publishes_the_event_of_the_fake_push_adapter() -> void:
	assert_true(await Env.start(FakePushAdapter.new(), FakeNotificationAdapter.new()))
	_record()
	PushCoreDev.simulate_push(51, false)
	PushCoreDev.simulate_push(52, true)
	assert_eq(_recorder.received, PackedInt64Array([51]))
	assert_eq(_recorder.opened, PackedInt64Array([52]))


func test_fake_launch_push_is_taken_once_across_release_and_init() -> void:
	assert_true(await Env.start(FakePushAdapter.new(), FakeNotificationAdapter.new()))
	PushCoreDev.set_fake_launch_push(4321)
	PushCore.release()
	assert_true(Env.start_push(FakePushAdapter.new(), FakeNotificationAdapter.new()))
	assert_eq(PushCore.take_launch_push(), 4321)
	assert_eq(PushCore.take_launch_push(), 0)
	PushCore.release()
	assert_true(Env.start_push(FakePushAdapter.new(), FakeNotificationAdapter.new()))
	assert_eq(PushCore.take_launch_push(), 0)


func test_launch_push_comes_from_the_push_adapter_and_is_not_kept() -> void:
	var push: TestPush = TestPush.new()
	push.launch_push = 61
	assert_true(await Env.start(push, TestNotification.new()))
	assert_eq(PushCore.take_launch_push(), 61)
	assert_eq(PushCore.take_launch_push(), 0)


func test_no_push_adapter_has_no_launch_push() -> void:
	assert_true(await Env.start(null, TestNotification.new()))
	assert_eq(PushCore.take_launch_push(), 0)
	assert_eq(Env.errors(), 0)


func test_dev_operations_and_fake_adapters_are_dev_code() -> void:
	var dev_scripts: Array[Script] = [PushCoreDev, FakePushAdapter, FakeNotificationAdapter, ScheduledLocalPush]
	for script: Script in dev_scripts:
		assert_true(script.resource_path.begins_with("res://core/push_core/dev/"), script.resource_path)
	var module_files: PackedStringArray = [
		"res://core/push_core/push_core.gd",
		"res://core/push_core/push_core_node.gd",
		"res://core/push_core/push_consent_info.gd",
		"res://core/push_core/push_token_wait.gd",
		"res://core/push_core/adapters/push_adapter.gd",
		"res://core/push_core/adapters/notification_adapter.gd",
		"res://core/push_core/adapters/native_push_adapter.gd",
		"res://core/push_core/adapters/push_fcm_adapter.gd",
		"res://core/push_core/adapters/push_apns_adapter.gd",
		"res://core/push_core/adapters/native_notification_adapter.gd",
	]
	for path: String in module_files:
		var source: String = FileAccess.get_file_as_string(path)
		assert_false(source.is_empty(), path)
		for word: String in _DEV_WORDS:
			assert_false(source.contains(word), "%s names %s" % [path, word])
