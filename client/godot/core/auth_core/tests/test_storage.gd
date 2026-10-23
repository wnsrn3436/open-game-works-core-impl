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
