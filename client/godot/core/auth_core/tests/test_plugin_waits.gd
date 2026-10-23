extends UnitTestCase
## The real social adapters, tracking adapter and secure storage adapter over plugin singletons that never answer. A
## sign-in and a tracking permission request wait for the user with no time limit, and `release` ends them: the adapter
## stops reading the plugin and tells it with `cancel`. A storage operation ends at `AuthCore.storageCallTimeoutMs`,
## also after `release` (which ends only the caller's wait): the plugin is told to drop it and the next one starts.

const Env := preload("res://core/auth_core/tests/support/auth_test_env.gd")
const Flow := preload("res://core/auth_core/tests/support/flow.gd")
const Plugins := preload("res://core/auth_core/tests/support/silent_auth_plugins.gd")
const Tracking := preload("res://core/auth_core/adapters/tracking_adapter.gd")
const SecureStorage := preload("res://core/auth_core/adapters/secure_storage_adapter.gd")
const Storage := preload("res://core/auth_core/adapters/token_storage.gd")

const _LONG_MS: int = 3600000
const _STORAGE_TIMEOUT_MS: int = 5000
## Platforms whose runtime is not the browser: the browser runtime signs in through Google Identity Services and keeps
## the token in the browser storage, with no plugin.
const _NATIVE: PackedStringArray = ["android", "ios", "windows", "macos", "linux"]

var env: Env = null
var _singleton: String = ""
var _plugin: Plugins.Silent = null


func before_each() -> void:
	super()
	env = Env.new()


func after_each() -> void:
	env.finish()
	super()
	if not _singleton.is_empty() and Engine.has_singleton(_singleton):
		Engine.unregister_singleton(_singleton)
	_singleton = ""
	if _plugin != null:
		_plugin.free()
		_plugin = null


func _register(singleton: String, plugin: Plugins.Silent) -> void:
	_singleton = singleton
	_plugin = plugin
	Engine.register_singleton(singleton, plugin)


## `take_result` calls stay the same over a few frames.
func _stopped_reading() -> bool:
	var polls: int = _plugin.polls
	await UnitTestCore.wait_frames(4)
	return polls > 0 and _plugin.polls == polls


## Whether this run is not the browser runtime. The browser run skips the test.
func _native_run() -> bool:
	CoreBuildInfo.platform = CoreBuildInfo.os_platform()
	UnitTestCore.require_platform(_NATIVE)
	return CoreBuildInfo.platform in _NATIVE


## Boots with the terms agreed and starts `login` with `provider`.
func _start_login(provider: CoreContract.LoginProvider) -> Flow:
	assert_true(await env.boot())
	Env.agree_terms()
	Env.respond_terms()
	assert_eq(await AuthCore.prepare_terms(), AuthCore.TermsStatus.AGREED)
	var flow: Flow = Flow.new()
	flow.start(func(f: Flow) -> void:
		f.result = await AuthCore.login(provider)
		f.finish())
	await UnitTestCore.wait_frames(3)
	return flow


## The sign-in started, waits past a long time, and `release` ends it with `FAILED` and a `cancel`.
func _assert_sign_in_waits_until_release(flow: Flow) -> void:
	assert_eq(_plugin.started, PackedInt64Array([1]), "the sign-in started")
	UnitTestCore.advance_clock(_LONG_MS, false)
	await UnitTestCore.wait_frames(3)
	assert_false(flow.finished, "the sign-in waits for the user with no time limit")
	assert_eq(_plugin.cancelled.size(), 0)
	AuthCore.release()
	await flow.wait()
	assert_eq((flow.result as LoginResult).status, AuthCore.LoginStatus.FAILED)
	await UnitTestCore.wait_frames(2)
	assert_eq(_plugin.cancelled, PackedInt64Array([1]), "the plugin is told once")
	assert_true(await _stopped_reading(), "the adapter stops reading the plugin")
	assert_eq(Env.request_count("core/Login"), 0)


func test_release_ends_an_apple_sign_in_that_never_ends() -> void:
	_register("OgwAppleSignIn", Plugins.SignIn.new())
	env.platform = "macos"
	env.adapters[CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE] = LoginAppleAdapter.new()
	var flow: Flow = await _start_login(CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE)
	await _assert_sign_in_waits_until_release(flow)


func test_release_ends_a_google_plugin_sign_in_that_never_ends() -> void:
	if not _native_run():
		return
	_register("OgwGoogleSignIn", Plugins.SignIn.new())
	env.platform = "android"
	env.adapters[CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE] = LoginGoogleAdapter.new()
	assert_true(UnitTestCore.set_test_settings("loginGoogle.serverClientId", "server-client"))
	var flow: Flow = await _start_login(CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE)
	await _assert_sign_in_waits_until_release(flow)


# ogw:input_boundary
func _js(code: String) -> String:
	var reply: Variant = JavaScriptBridge.eval(code, true)
	if reply is String:
		var text: String = reply
		return text
	return ""


func test_release_ends_a_browser_google_sign_in_that_never_ends() -> void:
	UnitTestCore.require_platform(["web"])
	if OS.get_name() != "Web":
		return
	# Google Identity Services that never calls back: no prompt notification and no credential.
	_js("window.google={accounts:{id:{initialize:function(){},prompt:function(){}}}};\"0\"")
	env.platform = "web"
	env.adapters[CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE] = LoginGoogleAdapter.new()
	assert_true(UnitTestCore.set_test_settings("loginGoogle.serverClientId", "server-client"))
	var flow: Flow = await _start_login(CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE)
	assert_eq(_js("String(window.__ogwGoogle&&window.__ogwGoogle.state)"), "0", "the sign-in waits")
	UnitTestCore.advance_clock(_LONG_MS, false)
	await UnitTestCore.wait_frames(3)
	assert_false(flow.finished, "the sign-in waits for the user with no time limit")
	AuthCore.release()
	await flow.wait()
	assert_eq((flow.result as LoginResult).status, AuthCore.LoginStatus.FAILED)
	await UnitTestCore.wait_frames(2)
	assert_eq(_js("typeof window.__ogwGoogle"), "undefined", "the page state goes with the wait")
	_js("delete window.google;\"0\"")
	assert_eq(Env.request_count("core/Login"), 0)


func test_release_ends_a_tracking_request_that_never_ends() -> void:
	_register("OgwTracking", Plugins.Tracking.new())
	env.platform = "ios"
	assert_true(await env.boot())
	assert_true(AuthCore._tracking is Tracking, "the real tracking adapter")
	var flow: Flow = Flow.new()
	flow.start(func(f: Flow) -> void:
		await AuthCore._request_tracking()
		f.finish())
	await UnitTestCore.wait_frames(3)
	assert_eq(_plugin.started, PackedInt64Array([1]))
	UnitTestCore.advance_clock(_LONG_MS, false)
	await UnitTestCore.wait_frames(3)
	assert_false(flow.finished, "the request waits for the user with no time limit")
	AuthCore.release()
	await flow.wait()
	await UnitTestCore.wait_frames(2)
	assert_eq(_plugin.cancelled, PackedInt64Array([1]), "the plugin is told once")
	assert_true(await _stopped_reading(), "the adapter stops reading the plugin")


## Inits AuthCore again with the secure storage adapter, the storage scope and the storage time limit.
func _init_with_secure_storage() -> void:
	assert_true(UnitTestCore.set_test_settings("AuthCore.storageCallTimeoutMs", _STORAGE_TIMEOUT_MS))
	var storage: SecureStorage = SecureStorage.new()
	AuthCore._test_storage = storage
	AuthCore.set_storage_scope(Env.SCOPE)
	assert_true(AuthCore.init())
	assert_eq(storage.call_timeout_ms, _STORAGE_TIMEOUT_MS, "init sets the adapter time limit")


## Starts a storage operation `op` whose outcome goes to the flow.
func _start_storage(op: AuthCore.StorageOp) -> Flow:
	var flow: Flow = Flow.new()
	flow.start(func(f: Flow) -> void:
		f.result = await AuthCore._storage_call(op)
		f.finish())
	return flow


func test_a_storage_operation_that_never_ends_fails_at_the_time_limit_and_the_next_one_starts() -> void:
	if not _native_run():
		return
	_register("OgwSecureStorage", Plugins.Storage.new())
	assert_true(await env.boot())
	AuthCore.release()
	_init_with_secure_storage()
	var first: Flow = _start_storage(AuthCore.StorageOp.READ)
	var second: Flow = _start_storage(AuthCore.StorageOp.REMOVE)
	await UnitTestCore.wait_frames(3)
	assert_eq(_plugin.started, PackedInt64Array([1]), "one storage operation at a time")
	UnitTestCore.advance_clock(_STORAGE_TIMEOUT_MS - 1, false)
	await UnitTestCore.wait_frames(3)
	assert_false(first.finished, "not before the time limit")
	assert_eq(_plugin.cancelled.size(), 0)
	UnitTestCore.advance_clock(1, false)
	await first.wait()
	assert_eq((first.result as Storage.Outcome).status, Storage.Status.FAILED)
	await UnitTestCore.wait_frames(2)
	assert_eq(_plugin.cancelled, PackedInt64Array([1]), "the plugin is told to drop it once")
	assert_eq(_plugin.started, PackedInt64Array([1, 2]), "the next storage operation starts")
	assert_false(second.finished)
	UnitTestCore.advance_clock(_STORAGE_TIMEOUT_MS, false)
	await second.wait()
	assert_eq((second.result as Storage.Outcome).status, Storage.Status.FAILED)
	await UnitTestCore.wait_frames(2)
	assert_eq(_plugin.cancelled, PackedInt64Array([1, 2]))
	assert_true(await _stopped_reading(), "the adapter stops reading the plugin")
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 2, "login token storage read and remove: Failed")


func test_a_storage_operation_release_left_ends_at_the_time_limit_and_the_next_init_one_starts() -> void:
	if not _native_run():
		return
	_register("OgwSecureStorage", Plugins.Storage.new())
	assert_true(await env.boot())
	AuthCore.release()
	_init_with_secure_storage()
	var flow: Flow = _start_storage(AuthCore.StorageOp.READ)
	await UnitTestCore.wait_frames(3)
	assert_eq(_plugin.started, PackedInt64Array([1]))
	AuthCore.release()
	await flow.wait()
	assert_eq((flow.result as Storage.Outcome).status, Storage.Status.FAILED, "release ends the caller's wait")
	var polls: int = _plugin.polls
	await UnitTestCore.wait_frames(3)
	assert_gt(_plugin.polls, polls, "the storage operation goes on after release")
	_init_with_secure_storage()
	var next: Flow = _start_storage(AuthCore.StorageOp.READ)
	await UnitTestCore.wait_frames(3)
	assert_eq(_plugin.started.size(), 1, "the next storage operation waits for the one release left")
	UnitTestCore.advance_clock(_STORAGE_TIMEOUT_MS, false)
	await UnitTestCore.wait_frames(3)
	assert_eq(_plugin.cancelled, PackedInt64Array([1]), "the operation release left ends at the time limit")
	assert_eq(_plugin.started, PackedInt64Array([1, 2]), "then the next one starts")
	assert_false(next.finished)
	Engine.unregister_singleton(_singleton)
	_singleton = ""
	_plugin.free()
	_plugin = null
	await next.wait()
	assert_eq((next.result as Storage.Outcome).status, Storage.Status.FAILED, "the plugin went away")
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 1, "login token storage read: Failed")


func test_a_storage_operation_release_left_counts_the_time_limit_across_a_new_time_core_init() -> void:
	if not _native_run():
		return
	_register("OgwSecureStorage", Plugins.Storage.new())
	assert_true(await env.boot())
	AuthCore.release()
	_init_with_secure_storage()
	var flow: Flow = _start_storage(AuthCore.StorageOp.READ)
	await UnitTestCore.wait_frames(3)
	AuthCore.release()
	await flow.wait()
	UnitTestCore.advance_clock(_STORAGE_TIMEOUT_MS - 1, false)
	await UnitTestCore.wait_frames(3)
	# The modules that read TimeCore go first, in the reverse order of their init.
	var releases: Array[Callable] = [
		NetworkCore.release,
		UserStateCore.release,
		MessageCore.release,
		UICore.release,
		TweenCore.release,
		SoundCore.release,
		LocalizationCore.release,
		InputCore.release,
		SafeAreaCore.release,
		ResolutionCore.release,
		InputBlockCore.release,
		PoolCore.release,
		DataCore.release,
		ResourceCore.release,
		LocalDataCore.release,
		TimeCore.release,
	]
	for release: Callable in releases:
		release.call()
	await UnitTestCore.wait_frames(3)
	UnitTestCore.advance_clock(_LONG_MS, false)
	await UnitTestCore.wait_frames(3)
	assert_eq(_plugin.cancelled.size(), 0, "no time passes while TimeCore does not run")
	TimeCoreDev.set_test_clock(DevTestClock.new())
	assert_true(TimeCore.init())
	await UnitTestCore.wait_frames(3)
	assert_eq(_plugin.cancelled.size(), 0, "the real elapsed time of the new TimeCore starts again")
	UnitTestCore.advance_clock(1, false)
	await UnitTestCore.wait_frames(3)
	assert_eq(_plugin.cancelled, PackedInt64Array([1]), "the time before and after the new init adds up")
