extends UnitTestCase
## AuthCore lifecycle: init check, the state `release` keeps and clears, calls before `init`.

const Env := preload("res://core/auth_core/tests/support/auth_test_env.gd")
const Storage := preload("res://core/auth_core/adapters/token_storage.gd")

var env: Env = null


func before_each() -> void:
	super()
	env = Env.new()


func after_each() -> void:
	env.finish()
	super()


func test_init_check_follows_init_and_release() -> void:
	assert_false(AuthCore.is_initialized())
	assert_true(await env.boot())
	assert_true(AuthCore.is_initialized())
	AuthCore.release()
	assert_false(AuthCore.is_initialized())
	assert_true(env.start_auth())
	assert_true(AuthCore.is_initialized())


func test_second_init_fails_with_error() -> void:
	assert_true(await env.boot())
	assert_false(AuthCore.init())
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)


func test_release_clears_state_and_removes_the_core_node() -> void:
	assert_true(await env.boot())
	var result: LoginResult = await env.boot_guest(801, "token-a")
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	var node: Node = AuthCore._node
	AuthCore.release()
	await UnitTestCore.wait_frames(2)
	assert_false(is_instance_valid(node))
	assert_null(AuthCore._node)
	assert_null(AuthCore._session)
	assert_null(AuthCore._ban_session)
	assert_null(AuthCore._provider)
	assert_null(AuthCore._remote_config)
	assert_null(AuthCore._storage)
	assert_null(AuthCore._tracking)
	assert_null(AuthCore._refresh_wait)
	assert_null(AuthCore._applied_consent)
	assert_null(AuthCore._life)
	assert_eq(AuthCore._storage_scope, "")
	assert_eq(AuthCore._social_adapters.size(), 0)
	assert_false(AuthCore._terms_agreed)
	assert_false(AuthCore._frame_refresh_stopped)
	assert_false(AuthCore._frame_refresh_queued)
	assert_false(AuthCore._frame_refresh_call.is_valid())
	assert_false(AuthCore._replaced_popup_open)
	assert_eq(AuthCore._waits.size(), 0)
	assert_eq(AuthCore._popup_waits.size(), 0)
	assert_eq(AuthCore._refresh_margin_ms, 0)
	assert_eq(AuthCore._terms_popup_key, "")
	assert_false(AuthCore._ad_push)
	assert_eq(AuthCore._fake_social_account, "")
	assert_eq(AuthCore._fake_tracking, -1)
	assert_null(AuthCore._dev_storage)
	assert_null(AuthCore._test_storage)
	assert_false(AuthCore._test_url_opener.is_valid())
	assert_eq(AuthCore.get_login_remote_config().entries.size(), 0)
	assert_false(AuthCore.is_logged_in())
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 2)


func test_release_keeps_the_pending_token() -> void:
	assert_true(await env.boot())
	env.storage.script("write", Storage.Status.FAILED)
	env.storage.script("write", Storage.Status.FAILED)
	var result: LoginResult = await env.boot_auto(802, "token-old", "token-pending")
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	AuthCore.release()
	await UnitTestCore.wait_frames(2)
	assert_eq(AuthCore._pending_token, "token-pending")
	assert_eq(AuthCore._pending_sent_token, "token-old")
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1)


func test_core_node_freed_outside_release_cleans_up_without_errors() -> void:
	assert_true(await env.boot())
	var node: Node = AuthCore._node
	node.get_parent().remove_child(node)
	node.free()
	assert_false(AuthCore.is_initialized())
	assert_null(AuthCore._node)
	assert_true(env.start_auth())


func test_calls_before_init_log_and_return_the_failure_value() -> void:
	assert_true(LogCore.init())
	assert_false(AuthCore.is_logged_in())
	assert_eq(AuthCore.get_user_id(), 0)
	assert_false(AuthCore.is_provider_supported(CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST))
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 3)


func test_storage_scope_and_adapter_after_init_are_ignored() -> void:
	assert_true(await env.boot())
	AuthCore.set_storage_scope("other.scope")
	AuthCore.set_social_adapter(CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE, LoginAppleAdapter.new())
	assert_eq(AuthCore._storage_scope, Env.SCOPE)
	assert_true(AuthCore._social_adapters[CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE] == env.apple)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 2)
