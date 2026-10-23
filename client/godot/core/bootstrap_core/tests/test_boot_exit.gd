extends UnitTestCase
## BootstrapCore app exit and DEV `shutdown`.

const _SUPPORT := preload("res://core/bootstrap_core/tests/support/boot_test_support.gd")
const _NETWORK := preload("res://core/bootstrap_core/tests/support/boot_test_network.gd")
const _ENTRY := preload("res://core/bootstrap_core/tests/support/boot_test_entry.gd")
const _SCENE := preload("res://core/bootstrap_core/tests/resources/boot_test_scene.gd")

const AUTH: PackedStringArray = ["AuthCore"]

## Children of the root before the boot, and the orphan nodes then.
var _root_children: Array[Node] = []
var _orphans_before: int = 0


func after_each() -> void:
	_SCENE.start_hook = Callable()
	super()


func _exit_by_os() -> void:
	BootstrapCore._node.notification(Node.NOTIFICATION_WM_CLOSE_REQUEST)


## Keeps the engine objects there are before the boot. The `BootstrapCore` core node is there from the test setup.
func _keep_engine_objects() -> void:
	_root_children = (Engine.get_main_loop() as SceneTree).root.get_children()
	_orphans_before = int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))


## After the exit, the root has the children it had before the boot, and the nodes the modules made are freed.
func _assert_no_engine_objects_left() -> void:
	await UnitTestCore.wait_frames(2)
	var root := (Engine.get_main_loop() as SceneTree).root
	assert_true(is_instance_valid(BootstrapCore._node))
	assert_eq(root.get_children(), _root_children)
	assert_lte(int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT)), _orphans_before)


func _assert_exited_once(list: Array[CoreModuleEntry]) -> void:
	assert_eq(_SUPPORT.count("EventCore.publish(AppQuitEvent)"), 1)
	assert_eq(_SUPPORT.count("LogCore.notify_app_state"), 1)
	assert_eq(_SUPPORT.count("LocalDataCore.flush"), 1)
	for item: CoreModuleEntry in list:
		assert_eq(_SUPPORT.count("%s.release" % item.name), 1, item.name)
		assert_false(BootstrapCore._to_bool(item.is_initialized.call()), item.name)
	assert_false(is_instance_valid(BootstrapCore._fatal_screen))


## Starts a dev login boot whose login waits, and waits until it is in `Login`.
func _boot_to_login(entry: _ENTRY) -> Array[CoreModuleEntry]:
	_SUPPORT.prepare({"OGW_DEV_ACCOUNT": "tester"})
	_keep_engine_objects()
	UnitTestCore.add_pending(_NETWORK.DEV_LOGIN)
	var list := _SUPPORT.modules(AUTH)
	_SUPPORT.start(entry, list)
	await entry.initialized
	await UnitTestCore.wait_frames(1)
	return list


func test_exit_while_logging_in() -> void:
	var entry := _ENTRY.new()
	var list: Array[CoreModuleEntry] = await _boot_to_login(entry)
	_exit_by_os()
	_assert_exited_once(list)
	assert_eq(entry.release_count, 1)
	_exit_by_os()
	BootstrapCore.request_restart()
	await UnitTestCore.wait_frames(2)
	_assert_exited_once(list)
	assert_eq(BootstrapCore._quit_request_count, 0)
	await _assert_no_engine_objects_left()


func test_exit_in_title_scene_has_no_content_release() -> void:
	_SUPPORT.prepare()
	var entry := _ENTRY.new()
	_SCENE.start_hook = func(_key: String) -> void: _exit_by_os()
	var list := _SUPPORT.modules()
	_keep_engine_objects()
	_SUPPORT.start(entry, list)
	assert_true(await _SUPPORT.wait_stage(BootstrapCore.BootStage.HALTED), "boot stage HALTED")
	_assert_exited_once(list)
	assert_eq(entry.release_count, 0)
	assert_false("stage:Update" in BootstrapCore._trace)
	await _assert_no_engine_objects_left()


func test_exit_after_done() -> void:
	_SUPPORT.prepare()
	var entry := _ENTRY.new()
	var list := _SUPPORT.modules()
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	_keep_engine_objects()
	_SUPPORT.start(entry, list)
	await UnitTestCore.wait_latch(latch)
	_exit_by_os()
	_assert_exited_once(list)
	assert_eq(entry.release_count, 1)
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.HALTED)
	await _assert_no_engine_objects_left()


func test_exit_confirmed_event_exits_and_requests_process_end_once() -> void:
	_SUPPORT.prepare()
	var list := _SUPPORT.modules()
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	_keep_engine_objects()
	_SUPPORT.start(_ENTRY.new(), list)
	await UnitTestCore.wait_latch(latch)
	var event := EventCore.acquire(ExitConfirmedEvent) as ExitConfirmedEvent
	EventCore.publish(event)
	_assert_exited_once(list)
	assert_eq(BootstrapCore._quit_request_count, 1)
	await _assert_no_engine_objects_left()


func test_exit_in_the_frame_of_a_restart_request_releases_once_without_a_new_boot() -> void:
	_SUPPORT.prepare()
	var entry := _ENTRY.new()
	var list := _SUPPORT.modules()
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	_keep_engine_objects()
	_SUPPORT.start(entry, list)
	await UnitTestCore.wait_latch(latch)
	BootstrapCore._trace.clear()
	BootstrapCore.request_restart()
	_exit_by_os()
	await UnitTestCore.wait_frames(3)
	_assert_exited_once(list)
	assert_eq(entry.release_count, 1)
	assert_eq(entry.init_count, 1)
	assert_eq(_SUPPORT.count("stage:InitModules"), 0)
	for item: CoreModuleEntry in list:
		assert_eq(_SUPPORT.count("%s.init" % item.name), 0, item.name)
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.HALTED)
	await _assert_no_engine_objects_left()


func _assert_shut_down(entry: _ENTRY) -> void:
	assert_eq(entry.release_count, 1)
	for module_name: String in _SUPPORT.MODULE_ORDER:
		var item := _SUPPORT.entry(module_name)
		if item.is_initialized.is_valid():
			assert_false(BootstrapCore._to_bool(item.is_initialized.call()), module_name)
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.NONE)
	assert_eq(_SUPPORT.count("EventCore.publish(AppQuitEvent)"), 0)
	assert_eq(_SUPPORT.count("LogCore.notify_app_state"), 0)
	assert_eq(_SUPPORT.count("LocalDataCore.flush"), 0)
	assert_eq(BootstrapCore._quit_request_count, 0)


func _boot_again() -> void:
	_SUPPORT.prepare()
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	_SUPPORT.start(_ENTRY.new(), _SUPPORT.modules())
	await UnitTestCore.wait_latch(latch)
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.DONE)


func test_shutdown_while_logging_in() -> void:
	var entry := _ENTRY.new()
	await _boot_to_login(entry)
	BootstrapCoreDev.shutdown()
	_assert_shut_down(entry)
	_NETWORK.release_pending_failure(_NETWORK.DEV_LOGIN)
	await UnitTestCore.wait_frames(3)
	assert_false("stage:AfterLogin" in BootstrapCore._trace)
	assert_eq(_SUPPORT.popups().size(), 0)
	await _boot_again()


func test_shutdown_after_done() -> void:
	_SUPPORT.prepare()
	var entry := _ENTRY.new()
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	_SUPPORT.start(entry, _SUPPORT.modules())
	await UnitTestCore.wait_latch(latch)
	BootstrapCoreDev.shutdown()
	_assert_shut_down(entry)
	await _boot_again()


func test_shutdown_releases_modules_a_test_initialized_without_start_boot() -> void:
	assert_true(LogCore.init())
	assert_true(EventCore.init())
	assert_true(TimeCore.init())
	BootstrapCoreDev.shutdown()
	assert_false(LogCore.is_initialized())
	assert_false(EventCore.is_initialized())
	assert_false(TimeCore.is_initialized())
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.NONE)
