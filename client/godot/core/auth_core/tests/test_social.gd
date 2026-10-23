extends UnitTestCase
## Social adapter support by platform and the desktop `login-google` flow.

const Env := preload("res://core/auth_core/tests/support/auth_test_env.gd")
const Flow := preload("res://core/auth_core/tests/support/flow.gd")

const PLATFORMS: PackedStringArray = ["android", "ios", "web", "windows", "macos", "linux"]
## Platforms of the desktop `login-google` flow.
const DESKTOP: PackedStringArray = ["windows", "macos", "linux"]

var env: Env = null


func before_each() -> void:
	super()
	env = Env.new()


func after_each() -> void:
	env.finish()
	super()


func test_provider_support_follows_the_social_adapter_table() -> void:
	env.adapters.clear()
	env.adapters[CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE] = LoginAppleAdapter.new()
	env.adapters[CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE] = LoginGoogleAdapter.new()
	assert_true(await env.boot())
	for platform: String in PLATFORMS:
		CoreBuildInfo.platform = platform
		assert_true(AuthCore.is_provider_supported(CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST), platform)
		assert_eq(
			AuthCore.is_provider_supported(CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE),
			platform == "ios" or platform == "macos",
			platform
		)
		assert_true(AuthCore.is_provider_supported(CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE), platform)


func test_fake_adapters_work_everywhere_and_no_adapter_is_unsupported() -> void:
	env.adapters.clear()
	env.adapters[CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE] = FakeSocialAdapter.new()
	assert_true(await env.boot())
	for platform: String in PLATFORMS:
		CoreBuildInfo.platform = platform
		assert_true(AuthCore.is_provider_supported(CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE), platform)
		assert_false(AuthCore.is_provider_supported(CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE), platform)


## Whether this run can test the desktop flow. The browser runtime signs in through Google Identity Services and has
## no loopback listener, so the browser run (platform `web`) skips the desktop tests.
func _desktop_run() -> bool:
	CoreBuildInfo.platform = CoreBuildInfo.os_platform()
	UnitTestCore.require_platform(DESKTOP)
	return CoreBuildInfo.platform in DESKTOP


func _start_desktop_login() -> Flow:
	env.adapters[CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE] = LoginGoogleAdapter.new()
	assert_true(UnitTestCore.set_test_settings("loginGoogle.desktopClientId", "desktop-client"))
	assert_true(UnitTestCore.set_test_settings("AuthCore.desktopSignInTimeoutMs", 5000))
	assert_true(await env.boot())
	Env.agree_terms()
	Env.respond_terms()
	assert_eq(await AuthCore.prepare_terms(), AuthCore.TermsStatus.AGREED)
	var flow: Flow = Flow.new()
	flow.start(func(f: Flow) -> void:
		f.result = await AuthCore.login(CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE)
		f.finish())
	while env.opened_urls.is_empty() and not flow.finished and AuthCore.is_initialized():
		await UnitTestCore.wait_frames(1)
	return flow


static func _query(url: String) -> Dictionary[String, String]:
	var query: Dictionary[String, String] = {}
	var mark: int = url.find("?")
	if mark < 0:
		return query
	for pair: String in url.substr(mark + 1).split("&", false):
		var equals: int = pair.find("=")
		if equals > 0:
			query[pair.substr(0, equals)] = pair.substr(equals + 1).uri_decode()
	return query


static func _value(query: Dictionary[String, String], key: String) -> String:
	return query[key] if query.has(key) else ""


static func _port(redirect_uri: String) -> int:
	return redirect_uri.get_slice(":", 2).to_int()


## Polls `peer` each frame until its status is settled, or until `running` (the `is_initialized` of a module the
## test still uses) turns false; the test fails then. A refused connection can leave connecting as connected:
## `poll` retries the connect, and on some hosts the retry on the refused socket succeeds. The next `poll` of a
## connected peer closes it when the socket is readable with no bytes, which a refused socket is at once and an
## idle real connection is not, so a connected status is settled only after one more `poll` at the same frame.
func _settle(peer: StreamPeerTCP, running: Callable) -> void:
	while peer.get_status() == StreamPeerTCP.STATUS_CONNECTING and running.call():
		await UnitTestCore.wait_frames(1)
		peer.poll()
	if peer.get_status() == StreamPeerTCP.STATUS_CONNECTING:
		fail_test("the module release ended the connection wait before it settled")
		return
	peer.poll()


## Settled status of a new connection to `port`. See `_settle`.
func _settled_status(port: int, running: Callable) -> StreamPeerTCP.Status:
	var peer: StreamPeerTCP = StreamPeerTCP.new()
	peer.connect_to_host("127.0.0.1", port)
	await _settle(peer, running)
	var status: StreamPeerTCP.Status = peer.get_status()
	peer.disconnect_from_host()
	return status


func test_desktop_google_url_on_windows() -> void:
	if not _desktop_run():
		return
	await _assert_desktop_url("windows")


func test_desktop_google_url_on_macos() -> void:
	if not _desktop_run():
		return
	await _assert_desktop_url("macos")


func test_desktop_google_url_on_linux() -> void:
	if not _desktop_run():
		return
	await _assert_desktop_url("linux")


## The URL the system browser gets has the desktop client ID, PKCE `S256` and the loopback redirect URI.
func _assert_desktop_url(platform: String) -> void:
	env.platform = platform
	var flow: Flow = await _start_desktop_login()
	assert_eq(env.opened_urls.size(), 1)
	var query: Dictionary[String, String] = _query(env.opened_urls[0])
	assert_true(env.opened_urls[0].begins_with("https://accounts.google.com/o/oauth2/v2/auth?"))
	assert_eq(_value(query, "client_id"), "desktop-client")
	assert_eq(_value(query, "code_challenge_method"), "S256")
	assert_eq(_value(query, "response_type"), "code")
	assert_eq(_value(query, "scope"), "openid")
	assert_ne(_value(query, "code_challenge"), "")
	assert_ne(_value(query, "state"), "")
	var redirect: String = _value(query, "redirect_uri")
	assert_true(redirect.begins_with("http://127.0.0.1:"))
	assert_gt(_port(redirect), 0)
	AuthCore.release()
	await flow.wait()


func test_desktop_google_other_state_fails_and_closes_the_listener() -> void:
	if not _desktop_run():
		return
	env.platform = "macos"
	var flow: Flow = await _start_desktop_login()
	var query: Dictionary[String, String] = _query(env.opened_urls[0])
	var port: int = _port(_value(query, "redirect_uri"))
	var peer: StreamPeerTCP = StreamPeerTCP.new()
	assert_eq(peer.connect_to_host("127.0.0.1", port), OK)
	await _settle(peer, AuthCore.is_initialized)
	assert_eq(peer.get_status(), StreamPeerTCP.STATUS_CONNECTED)
	assert_eq(peer.put_data("GET /?state=other&code=abc HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n".to_utf8_buffer()), OK)
	await flow.wait()
	var result: LoginResult = flow.result as LoginResult
	assert_eq(result.status, AuthCore.LoginStatus.FAILED)
	assert_eq(Env.request_count("core/Login"), 0)
	assert_ne(await _settled_status(port, AuthCore.is_initialized), StreamPeerTCP.STATUS_CONNECTED)


func test_desktop_google_without_request_fails_at_the_time_limit() -> void:
	if not _desktop_run():
		return
	env.platform = "linux"
	var flow: Flow = await _start_desktop_login()
	var port: int = _port(_value(_query(env.opened_urls[0]), "redirect_uri"))
	UnitTestCore.advance_clock(4999, false)
	await UnitTestCore.wait_frames(3)
	assert_false(flow.finished)
	UnitTestCore.advance_clock(1, false)
	await flow.wait()
	assert_eq((flow.result as LoginResult).status, AuthCore.LoginStatus.FAILED)
	assert_ne(await _settled_status(port, AuthCore.is_initialized), StreamPeerTCP.STATUS_CONNECTED)


func test_release_during_the_desktop_google_sign_in_ends_it_and_closes_the_listener() -> void:
	if not _desktop_run():
		return
	env.platform = "windows"
	var flow: Flow = await _start_desktop_login()
	var port: int = _port(_value(_query(env.opened_urls[0]), "redirect_uri"))
	assert_eq(await _settled_status(port, AuthCore.is_initialized), StreamPeerTCP.STATUS_CONNECTED, "the listener is open")
	AuthCore.release()
	await flow.wait()
	assert_eq((flow.result as LoginResult).status, AuthCore.LoginStatus.FAILED)
	await UnitTestCore.wait_frames(2)
	assert_true(TimeCore.is_initialized(), "release itself ends the wait, not a TimeCore release")
	var after_release: StreamPeerTCP.Status = await _settled_status(port, TimeCore.is_initialized)
	assert_ne(after_release, StreamPeerTCP.STATUS_CONNECTED, "release closes the listener")
	assert_eq(Env.request_count("core/Login"), 0)
