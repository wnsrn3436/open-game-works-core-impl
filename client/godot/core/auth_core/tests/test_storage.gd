extends UnitTestCase
## Login token storage: scope, operation order across `release` and late results.

const Env := preload("res://core/auth_core/tests/support/auth_test_env.gd")
const Flow := preload("res://core/auth_core/tests/support/flow.gd")
const Storage := preload("res://core/auth_core/adapters/token_storage.gd")

var env: Env = null


func before_each() -> void:
	super()
	env = Env.new()


func after_each() -> void:
	env.finish()
	super()


func test_item_of_another_scope_is_not_read() -> void:
	assert_true(await env.boot())
	Env.mark_installed()
	env.storage.items["com.example.other.LOCAL"] = "{\"login_token\":\"token-other\",\"linked_providers\":[]}"
	var result: LoginResult = await env.boot_guest(701, "token-a")
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(Env.request_count("core/AutoLogin"), 0)
	assert_eq(env.storage.items["com.example.other.LOCAL"], "{\"login_token\":\"token-other\",\"linked_providers\":[]}")
	assert_eq(env.stored_token(), "token-a")


func test_empty_scope_uses_no_storage() -> void:
	assert_true(await env.boot())
	AuthCore.release()
	AuthCore._test_storage = env.storage
	assert_true(AuthCore.init())
	Env.mark_installed()
	Env.agree_terms()
	Env.respond_terms()
	var result: LoginResult = await AuthCore.boot_login()
	assert_eq(result.status, AuthCore.LoginStatus.FAILED)
	assert_eq(env.storage.calls.size(), 0)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)


func test_release_while_waiting_for_storage_fails_the_caller_and_drops_the_late_result() -> void:
	assert_true(await env.boot())
	Env.mark_installed()
	Env.agree_terms()
	env.store("token-old")
	Env.respond_terms()
	env.storage.hold = true
	var flow: Flow = Flow.new()
	flow.start(func(f: Flow) -> void:
		f.result = await AuthCore.boot_login()
		f.finish())
	await UnitTestCore.wait_frames(5)
	assert_eq(env.storage.count("read"), 1)
	AuthCore.release()
	await flow.wait()
	assert_eq((flow.result as LoginResult).status, AuthCore.LoginStatus.FAILED)
	assert_true(env.start_auth())
	env.storage.release_held()
	await UnitTestCore.wait_frames(5)
	assert_false(AuthCore.is_logged_in())
	assert_eq(Env.request_count("core/AutoLogin"), 0)


func test_boot_login_write_starts_after_the_release_write_of_the_pending_token() -> void:
	assert_true(await env.boot())
	env.storage.script("write", Storage.Status.FAILED)
	var first: LoginResult = await env.boot_auto(711, "token-old", "token-pending")
	assert_eq(first.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)
	env.storage.hold = true
	AuthCore.release()
	await UnitTestCore.wait_frames(2)
	assert_eq(env.storage.count("write"), 2)
	assert_true(env.start_auth())
	Env.respond_terms()
	Env.respond_auto_login(711, "token-newest")
	var flow: Flow = Flow.new()
	flow.start(func(f: Flow) -> void:
		f.result = await AuthCore.boot_login()
		f.finish())
	await UnitTestCore.wait_frames(8)
	assert_eq(Env.request_header("core/AutoLogin", "Authorization", 1), "Bearer token-pending")
	assert_eq(env.storage.count("write"), 2)
	env.storage.release_held()
	await flow.wait()
	assert_eq((flow.result as LoginResult).status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(env.storage.count("write"), 3)
	assert_eq(env.storage.ended.slice(-2), PackedStringArray(["write " + Env.SCOPE, "write " + Env.SCOPE]))
	assert_eq(env.stored_token(), "token-newest")


func test_clear_dev_values_deletes_the_storage_item_of_the_scope_without_a_log() -> void:
	assert_true(await env.boot())
	var result: LoginResult = await env.boot_guest(721, "token-a")
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	env.storage.items["com.example.other.LOCAL"] = "{\"login_token\":\"token-other\",\"linked_providers\":[]}"
	var removes: int = env.storage.count("remove")
	AuthCoreDev.clear_dev_values()
	await UnitTestCore.wait_frames(2)
	assert_eq(env.storage.count("remove"), removes + 1)
	assert_eq(env.storage.calls[-1], "remove " + Env.SCOPE)
	assert_false(env.storage.items.has(Env.SCOPE))
	assert_true(env.storage.items.has("com.example.other.LOCAL"))
	assert_true(AuthCore.is_logged_in(), "the session is not a DEV value")
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 0)
	assert_eq(UnitTestCore.check_logs("warn", "AuthCore"), 0)


func test_clear_dev_values_fails_the_waiting_caller_and_deletes_after_the_operation_in_progress() -> void:
	assert_true(await env.boot())
	Env.mark_installed()
	Env.agree_terms()
	env.store("token-old")
	Env.respond_terms()
	env.storage.hold = true
	var flow: Flow = Flow.new()
	flow.start(func(f: Flow) -> void:
		f.result = await AuthCore.boot_login()
		f.finish())
	await UnitTestCore.wait_frames(5)
	assert_eq(env.storage.count("read"), 1)
	AuthCoreDev.clear_dev_values()
	await flow.wait()
	assert_eq((flow.result as LoginResult).status, AuthCore.LoginStatus.FAILED)
	assert_eq(env.storage.count("remove"), 0, "the delete waits for the read in progress")
	env.storage.release_held()
	await UnitTestCore.wait_frames(5)
	assert_eq(env.storage.ended, PackedStringArray(["read " + Env.SCOPE, "remove " + Env.SCOPE]))
	assert_false(env.storage.items.has(Env.SCOPE))
	assert_false(AuthCore.is_logged_in())
	assert_eq(Env.request_count("core/AutoLogin"), 0)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 0)


## Waits until the fake storage has started `count` operations of `kind`. `false` when it did not within 60 frames.
func _wait_storage(kind: String, count: int) -> bool:
	for i: int in 60:
		if env.storage.count(kind) >= count:
			return true
		await UnitTestCore.wait_frames(1)
	return env.storage.count(kind) >= count


func test_clear_dev_values_during_the_auto_login_write_fails_boot_login_without_a_pending_token() -> void:
	assert_true(await env.boot())
	Env.mark_installed()
	Env.agree_terms()
	env.store("token-old")
	Env.respond_terms()
	Env.respond_auto_login(741, "token-new")
	env.storage.hold = true
	var flow: Flow = Flow.new()
	flow.start(func(f: Flow) -> void:
		f.result = await AuthCore.boot_login()
		f.finish())
	assert_true(await _wait_storage("read", 1))
	# Ends the held read and keeps holding: the AutoLogin response can come in the same frame as the read.
	env.storage.released.emit()
	assert_true(await _wait_storage("write", 1), "the AutoLogin write waits")
	assert_eq(Env.request_count("core/AutoLogin"), 1)
	AuthCoreDev.clear_dev_values()
	await flow.wait()
	assert_eq((flow.result as LoginResult).status, AuthCore.LoginStatus.FAILED)
	assert_false(AuthCore.is_logged_in())
	assert_eq(AuthCore._pending_token, "")
	assert_eq(AuthCore._pending_sent_token, "")
	env.storage.release_held()
	await UnitTestCore.wait_frames(5)
	assert_eq(env.storage.ended.slice(-2), PackedStringArray(["write " + Env.SCOPE, "remove " + Env.SCOPE]))
	assert_false(env.storage.items.has(Env.SCOPE))
	assert_false(AuthCore.is_logged_in())
	assert_eq(AuthCore._pending_token, "")
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 0)
	assert_eq(UnitTestCore.check_logs("warn", "AuthCore"), 0)


func test_clear_dev_values_during_the_link_account_write_fails_the_link_without_a_log() -> void:
	assert_true(await env.boot())
	var login: LoginResult = await env.boot_guest(742, "token-a")
	assert_eq(login.status, AuthCore.LoginStatus.SUCCESS)
	var response: CoreContract.LinkAccountResponse = CoreContract.LinkAccountResponse.new()
	response.linked_providers = PackedInt32Array([CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE])
	Env.respond("core/LinkAccount", response)
	var writes: int = env.storage.count("write")
	env.storage.hold = true
	var flow: Flow = Flow.new()
	flow.start(func(f: Flow) -> void:
		f.status = await AuthCore.link_account(CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE)
		f.finish())
	assert_true(await _wait_storage("write", writes + 1), "the link write waits")
	AuthCoreDev.clear_dev_values()
	await flow.wait()
	assert_eq(flow.status, AuthCore.LinkStatus.FAILED)
	assert_eq(AuthCore._pending_token, "", "a cut write keeps no pending token")
	assert_true(AuthCore.is_logged_in(), "the session is not a DEV value")
	env.storage.release_held()
	await UnitTestCore.wait_frames(5)
	assert_eq(env.storage.ended.slice(-2), PackedStringArray(["write " + Env.SCOPE, "remove " + Env.SCOPE]))
	assert_eq(AuthCore._pending_token, "")
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 0)
	assert_eq(UnitTestCore.check_logs("warn", "AuthCore"), 0)


func test_clear_dev_values_during_the_withdraw_remove_fails_the_withdraw_without_ending_the_session() -> void:
	assert_true(await env.boot())
	var login: LoginResult = await env.boot_guest(743, "token-a")
	assert_eq(login.status, AuthCore.LoginStatus.SUCCESS)
	Env.respond("core/Withdraw", CoreContract.WithdrawResponse.new())
	var removes: int = env.storage.count("remove")
	env.storage.hold = true
	var flow: Flow = Flow.new()
	flow.start(func(f: Flow) -> void:
		f.flag = await AuthCore.withdraw()
		f.finish())
	assert_true(await _wait_storage("remove", removes + 1), "the withdraw remove waits")
	AuthCoreDev.clear_dev_values()
	await flow.wait()
	assert_false(flow.flag)
	assert_true(AuthCore.is_logged_in())
	assert_eq(env.recorder.session_ends.size(), 0)
	assert_eq(env.recorder.restarts, 0)
	env.storage.release_held()
	await UnitTestCore.wait_frames(5)
	assert_eq(env.storage.ended.slice(-2), PackedStringArray(["remove " + Env.SCOPE, "remove " + Env.SCOPE]))
	assert_eq(env.recorder.session_ends.size(), 0)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 0)
	assert_eq(UnitTestCore.check_logs("warn", "AuthCore"), 0)


func test_clear_dev_values_after_release_deletes_the_pending_token_and_starts_no_delete() -> void:
	assert_true(await env.boot())
	env.storage.script("write", Storage.Status.FAILED)
	env.storage.script("write", Storage.Status.FAILED)
	var first: LoginResult = await env.boot_auto(731, "token-old", "token-pending")
	assert_eq(first.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)
	AuthCore.release()
	await UnitTestCore.wait_frames(2)
	assert_eq(AuthCore._pending_token, "token-pending")
	var calls: int = env.storage.calls.size()
	AuthCoreDev.clear_dev_values()
	await UnitTestCore.wait_frames(2)
	assert_eq(AuthCore._pending_token, "")
	assert_eq(AuthCore._pending_sent_token, "")
	assert_eq(env.storage.calls.size(), calls, "after release the scope text is empty")
	assert_true(env.start_auth())
	Env.respond_terms()
	Env.respond_auto_login(731, "token-next")
	var again: LoginResult = await AuthCore.boot_login()
	assert_eq(again.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(Env.request_header("core/AutoLogin", "Authorization", 1), "Bearer token-old")
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 0)


func test_clear_dev_values_before_init_and_with_an_empty_scope_starts_no_delete() -> void:
	assert_true(await env.boot())
	AuthCore.release()
	AuthCore.set_storage_scope(Env.SCOPE)
	AuthCoreDev.set_fake_social_account("frank")
	var calls: int = env.storage.calls.size()
	AuthCoreDev.clear_dev_values()
	assert_eq(AuthCore._fake_social_account, "")
	assert_eq(AuthCore._storage_scope, Env.SCOPE, "the scope text is not a DEV value")
	AuthCore.release()
	AuthCore.set_storage_scope("")
	AuthCore._test_storage = env.storage
	assert_true(AuthCore.init())
	AuthCoreDev.clear_dev_values()
	await UnitTestCore.wait_frames(2)
	assert_eq(env.storage.calls.size(), calls)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 0)
