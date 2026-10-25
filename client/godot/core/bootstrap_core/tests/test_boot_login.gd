extends UnitTestCase
## BootstrapCore login stage: login failure popups, deletion code popup, dev login, restart while logging in.

const _SUPPORT := preload("res://core/bootstrap_core/tests/support/boot_test_support.gd")
const _NETWORK := preload("res://core/bootstrap_core/tests/support/boot_test_network.gd")
const _ENTRY := preload("res://core/bootstrap_core/tests/support/boot_test_entry.gd")

const AUTH: PackedStringArray = ["AuthCore"]


## Starts a dev login boot and waits until the boot is halted on a login failure popup.
func _boot_to_failure(entry: _ENTRY) -> void:
	_SUPPORT.prepare({"OGW_DEV_ACCOUNT": "tester"})
	_SUPPORT.start(entry, _SUPPORT.modules(AUTH))
	await entry.initialized
	await UnitTestCore.wait_frames(3)


func _restart_buttons() -> PackedStringArray:
	return PackedStringArray([ReservedString.bootstrap_restart()])


func test_age_blocked_halts_with_one_age_blocked_popup_and_restart_button_restarts() -> void:
	_NETWORK.add_dev_login_error(CoreContract.CoreError.CORE_ERROR_AGE_BELOW_MINIMUM)
	_NETWORK.add_dev_login_success()
	var entry := _ENTRY.new()
	await _boot_to_failure(entry)
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.HALTED)
	assert_false("stage:AfterLogin" in BootstrapCore._trace)
	assert_false("stage:FirstScene" in BootstrapCore._trace)
	assert_eq(_SUPPORT.popups(), PackedStringArray([_SUPPORT.popup(ReservedString.bootstrap_age_blocked(), _restart_buttons())]))
	assert_eq(UICore.get_open_popup_count(), 1)
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	await _SUPPORT.press_popup_button(0)
	await UnitTestCore.wait_latch(latch)
	assert_eq(_SUPPORT.count("stage:InitModules"), 2)


func test_failed_login_opens_login_failed_popup() -> void:
	_NETWORK.add_dev_login_error(CoreContract.CoreError.CORE_ERROR_INTERNAL)
	var entry := _ENTRY.new()
	await _boot_to_failure(entry)
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.HALTED)
	assert_eq(_SUPPORT.popups(), PackedStringArray([_SUPPORT.popup(ReservedString.bootstrap_login_failed(), _restart_buttons())]))
	assert_eq(UnitTestCore.check_logs("warn", "NetworkCore"), 1, "DevLogin ServerError INTERNAL")


func test_banned_with_end_opens_banned_popup_with_format_args() -> void:
	_NETWORK.add_dev_login_error(CoreContract.CoreError.CORE_ERROR_BANNED, 1800000000000)
	var entry := _ENTRY.new()
	await _boot_to_failure(entry)
	var buttons := PackedStringArray([ReservedString.bootstrap_banned_deletion(), ReservedString.bootstrap_restart()])
	var args := "public_code=%s until_at=%d url=%s" % [_NETWORK.PUBLIC_CODE, 1800000000000, _NETWORK.DELETION_URL]
	assert_eq(_SUPPORT.popups(), PackedStringArray([_SUPPORT.popup(ReservedString.bootstrap_banned(), buttons, args)]))
	assert_eq(UnitTestCore.check_logs("warn", "NetworkCore"), 1, "DevLogin ServerError BANNED")


func test_permanent_ban_opens_permanent_popup_and_deletion_code_popup_restarts() -> void:
	_NETWORK.add_dev_login_error(CoreContract.CoreError.CORE_ERROR_BANNED, 0)
	_NETWORK.add_deletion_code("ABCD1234", 1700000600000)
	_NETWORK.add_dev_login_success()
	var entry := _ENTRY.new()
	await _boot_to_failure(entry)
	var buttons := PackedStringArray([ReservedString.bootstrap_banned_deletion(), ReservedString.bootstrap_restart()])
	var args := "public_code=%s until_at=0 url=%s" % [_NETWORK.PUBLIC_CODE, _NETWORK.DELETION_URL]
	assert_eq(_SUPPORT.popups()[0], _SUPPORT.popup(ReservedString.bootstrap_banned_permanent(), buttons, args))
	await _SUPPORT.press_popup_button(0)
	await UnitTestCore.wait_frames(3)
	assert_eq(_SUPPORT.count("AuthCore.issue_deletion_code"), 1)
	var code_args := "public_code=%s code=ABCD1234 expires_at=1700000600000 url=%s" % [_NETWORK.PUBLIC_CODE, _NETWORK.DELETION_URL]
	assert_eq(_SUPPORT.popups()[1], _SUPPORT.popup(ReservedString.bootstrap_banned_deletion_code(), _restart_buttons(), code_args))
	assert_eq(_SUPPORT.count("stage:InitModules"), 1)
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	await _SUPPORT.press_popup_button(0)
	await UnitTestCore.wait_latch(latch)
	assert_eq(_SUPPORT.count("stage:InitModules"), 2)
	assert_eq(UnitTestCore.check_logs("warn", "NetworkCore"), 1, "DevLogin ServerError BANNED")


func test_failed_deletion_code_opens_failed_popup_whose_button_restarts() -> void:
	_NETWORK.add_dev_login_error(CoreContract.CoreError.CORE_ERROR_BANNED, 0)
	var error := CoreContract.ServerError.new()
	error.code = CoreContract.CoreError.CORE_ERROR_INTERNAL
	_NETWORK.add_error(_NETWORK.ISSUE_DELETION_CODE, error)
	_NETWORK.add_dev_login_success()
	var entry := _ENTRY.new()
	await _boot_to_failure(entry)
	await _SUPPORT.press_popup_button(0)
	await UnitTestCore.wait_frames(3)
	assert_eq(_SUPPORT.popups()[1], _SUPPORT.popup(ReservedString.bootstrap_banned_deletion_failed(), _restart_buttons()))
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	await _SUPPORT.press_popup_button(0)
	await UnitTestCore.wait_latch(latch)
	assert_eq(_SUPPORT.count("stage:InitModules"), 2)
	assert_eq(UnitTestCore.check_logs("warn", "NetworkCore"), 2, "DevLogin BANNED and IssueDeletionCode INTERNAL")


## Starts a dev login boot banned without an end, presses `[bootstrap_banned_deletion]` and leaves `IssueDeletionCode`
## pending.
func _boot_to_pending_deletion_code(entry: _ENTRY) -> void:
	_NETWORK.add_dev_login_error(CoreContract.CoreError.CORE_ERROR_BANNED, 0)
	UnitTestCore.add_pending(_NETWORK.ISSUE_DELETION_CODE)
	await _boot_to_failure(entry)
	await _SUPPORT.press_popup_button(0)
	await UnitTestCore.wait_frames(2)
	assert_eq(_SUPPORT.count("AuthCore.issue_deletion_code"), 1)
	assert_eq(_SUPPORT.popups().size(), 1)


## Whether `BootstrapCore` asked `UICore` to open a deletion code popup.
func _deletion_code_popup_opened() -> bool:
	for operation: String in _SUPPORT.popups():
		for body: String in [ReservedString.bootstrap_banned_deletion_code(), ReservedString.bootstrap_banned_deletion_failed()]:
			if operation.begins_with("UICore.open_system_popup body=%s buttons=" % body):
				return true
	return false


func test_restart_while_waiting_for_deletion_code_opens_no_deletion_code_popup() -> void:
	var entry := _ENTRY.new()
	await _boot_to_pending_deletion_code(entry)
	_NETWORK.add_dev_login_success()
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	BootstrapCore.request_restart()
	await UnitTestCore.wait_latch(latch)
	# The halted boot's request is held over the restart or was ended by it; either way its result comes back now.
	_NETWORK.release_pending_deletion_code("ABCD1234", 1700000600000)
	await UnitTestCore.wait_frames(3)
	assert_false(_deletion_code_popup_opened())
	assert_eq(_SUPPORT.popups().size(), 1)
	assert_eq(UICore.get_open_popup_count(), 0)
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.DONE)
	assert_eq(UnitTestCore.check_logs("warn", "NetworkCore"), 1, "DevLogin ServerError BANNED")


func test_fatal_while_waiting_for_deletion_code_opens_only_the_fatal_popup() -> void:
	var entry := _ENTRY.new()
	await _boot_to_pending_deletion_code(entry)
	BootstrapCore.report_fatal("content failure")
	await UnitTestCore.wait_frames(3)
	assert_true(_NETWORK.release_pending_deletion_code("ABCD1234", 1700000600000))
	await UnitTestCore.wait_frames(3)
	assert_false(_deletion_code_popup_opened())
	var fatal := _SUPPORT.popup(ReservedString.bootstrap_fatal_error(), _restart_buttons())
	assert_eq(_SUPPORT.popups().slice(1), PackedStringArray([fatal]))
	assert_eq(UICore.get_open_popup_count(), 1)
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.HALTED)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1)
	assert_eq(UnitTestCore.check_logs("warn", "NetworkCore"), 1, "DevLogin ServerError BANNED")


func test_dev_account_uses_dev_login_and_not_boot_login() -> void:
	_SUPPORT.prepare({"OGW_DEV_ACCOUNT": "tester"})
	_NETWORK.add_dev_login_success()
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	_SUPPORT.start(_ENTRY.new(), _SUPPORT.modules(AUTH))
	await UnitTestCore.wait_latch(latch)
	assert_eq(_SUPPORT.count("AuthCore.dev_login"), 1)
	assert_eq(_SUPPORT.count("AuthCore.boot_login"), 0)
	assert_eq(AuthCore.get_user_id(), _NETWORK.USER_ID)


func test_restart_while_logging_in_drops_the_halted_boot() -> void:
	_SUPPORT.prepare({"OGW_DEV_ACCOUNT": "tester"})
	UnitTestCore.add_pending(_NETWORK.DEV_LOGIN)
	_NETWORK.add_dev_login_success()
	var entry := _ENTRY.new()
	_SUPPORT.start(entry, _SUPPORT.modules(AUTH))
	await entry.initialized
	await UnitTestCore.wait_frames(1)
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.LOGIN)
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	BootstrapCore.request_restart()
	await UnitTestCore.wait_latch(latch)
	assert_eq(_SUPPORT.count("stage:AfterLogin"), 1)
	assert_eq(_SUPPORT.count("stage:InitModules"), 2)
	assert_eq(UICore.get_open_popup_count(), 0)
	var stage_logs := BootstrapCore._trace.size()
	_NETWORK.release_pending_failure(_NETWORK.DEV_LOGIN)
	await UnitTestCore.wait_frames(3)
	assert_eq(_SUPPORT.popups().size(), 0)
	assert_eq(BootstrapCore._trace.size(), stage_logs)
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.DONE)
