extends "res://core/network_core/tests/support/network_test_case.gd"
## `send_auth`.


func _signature(key: String, request_name: String, index: int) -> String:
	var hashing: HashingContext = HashingContext.new()
	assert_eq(hashing.start(HashingContext.HASH_SHA256), OK)
	var body: PackedByteArray = body_of(index)
	if not body.is_empty():
		assert_eq(hashing.update(body), OK)
	var text: String = "%s\n%s\n%s\n%s" % [request_name, header(index, "X-Ogw-Request-Id"), header(index, "X-Ogw-Timestamp"), hashing.finish().hex_encode()]
	return Crypto.new().hmac_digest(HashingContext.HASH_SHA256, key.to_utf8_buffer(), text.to_utf8_buffer()).hex_encode()


func test_send_auth_skips_the_queue_and_follows_its_options() -> void:
	await start_network()
	UnitTestCore.add_pending(INTERACTION)
	var queued: Sent = start_send(request(INTERACTION))
	var login: CoreContract.LoginRequest = CoreContract.LoginRequest.new()
	var env: CoreContract.ResponseEnvelope = envelope()
	env.user_state = tutorial_delta(PackedInt64Array([4]))
	add_envelope("core/Login", env)
	var options: AuthSendOptions = AuthSendOptions.new()
	options.authorization = "login-token"
	options.sign = true
	options.signing_key = "option-key"
	var result: AuthSendResult = await NetworkCore.send_auth(login, options)
	assert_true(result.ok, "does not wait for the queue")
	assert_true(result.response is CoreContract.LoginResponse)
	assert_eq(header(1, "Authorization"), "Bearer login-token")
	assert_eq(header(1, "X-Ogw-Signature"), _signature("option-key", "core/Login", 1))
	assert_eq(UserStateCore.count(CoreContract.TutorialProgressUserState), 1, "the login delta is applied")
	assert_eq(provider.get_calls, 1, "no access token wait")
	# An empty signing key uses the provider's; no authorization and no signature leave the headers out.
	add_ok("core/GetTerms")
	var provider_key: AuthSendOptions = AuthSendOptions.new()
	provider_key.sign = true
	assert_true((await NetworkCore.send_auth(CoreContract.GetTermsRequest.new(), provider_key)).ok)
	assert_eq(header(2, "X-Ogw-Signature"), _signature(provider.signing_key, "core/GetTerms", 2))
	assert_false(has_header(2, "Authorization"))
	add_ok("core/GetNotices")
	assert_true((await NetworkCore.send_auth(CoreContract.GetNoticesRequest.new(), AuthSendOptions.new())).ok)
	assert_false(has_header(3, "X-Ogw-Signature"))
	assert_false(has_header(3, "Authorization"))
	assert_true(release_ok(INTERACTION))
	assert_true(await wait_sent(queued))
	assert_eq(completed, PackedStringArray([INTERACTION + ":true"]), "no RequestCompletedEvent for send_auth")


func test_send_auth_has_no_block_or_popup() -> void:
	await start_network()
	UnitTestCore.add_pending("core/Login")
	var results: Array[AuthSendResult] = []
	var run: Callable = func() -> void:
		results.append(await NetworkCore.send_auth(CoreContract.LoginRequest.new(), AuthSendOptions.new()))
	run.call()
	assert_false(InputBlockCore.is_blocked())
	await advance(ICON_DELAY_MS + 100)
	assert_false(loading_icon_visible())
	assert_true(UnitTestCore.release_pending("core/Login", NetworkCore.TransferResult.CONNECTION_FAILED, 0, PackedByteArray()))
	await UnitTestCore.wait_frames(2)
	assert_eq(results.size(), 1)
	assert_eq(results[0].failure.kind, NetworkCore.FailureKind.CONNECTION_FAILED)
	assert_eq(popup_count(), 0)
	assert_eq(error_logs(), 1)


func test_banned_detail_is_in_the_failure() -> void:
	await start_network(false)
	var env: CoreContract.ResponseEnvelope = envelope()
	env.error = CoreContract.ServerError.new()
	env.error.code = CoreContract.CoreError.CORE_ERROR_BANNED
	env.error.ban = CoreContract.BanDetail.new()
	env.error.ban.user_id = 77
	env.error.ban.until_at = 1800000000000
	add_envelope("core/Login", env)
	var result: AuthSendResult = await NetworkCore.send_auth(CoreContract.LoginRequest.new(), AuthSendOptions.new())
	assert_false(result.ok)
	assert_eq(result.failure.error_code, CoreContract.CoreError.CORE_ERROR_BANNED)
	assert_true(result.failure.ban != null)
	assert_eq(result.failure.ban.user_id, 77)
	assert_eq(result.failure.ban.until_at, 1800000000000)
	assert_eq(warn_logs(), 1)


func test_send_auth_update_error_publishes_the_event() -> void:
	await start_network(false)
	add_error("core/Login", CoreContract.CoreError.CORE_ERROR_APP_UPDATE_REQUIRED)
	var result: AuthSendResult = await NetworkCore.send_auth(CoreContract.LoginRequest.new(), AuthSendOptions.new())
	assert_false(result.ok)
	assert_eq(update_codes, PackedInt32Array([CoreContract.CoreError.CORE_ERROR_APP_UPDATE_REQUIRED]))
	assert_eq(warn_logs(), 1)
