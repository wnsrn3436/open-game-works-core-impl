extends "res://core/network_core/tests/support/network_test_case.gd"
## Common headers, request IDs, the request signature and what logs leave out.


func _sha256_hex(bytes: PackedByteArray) -> String:
	var hashing: HashingContext = HashingContext.new()
	assert_eq(hashing.start(HashingContext.HASH_SHA256), OK)
	if not bytes.is_empty():
		assert_eq(hashing.update(bytes), OK)
	return hashing.finish().hex_encode()


func _expected_signature(key: String, request_name: String, index: int) -> String:
	var text: String = "%s\n%s\n%s\n%s" % [request_name, header(index, "X-Ogw-Request-Id"), header(index, "X-Ogw-Timestamp"), _sha256_hex(body_of(index))]
	return Crypto.new().hmac_digest(HashingContext.HASH_SHA256, key.to_utf8_buffer(), text.to_utf8_buffer()).hex_encode()


func test_every_send_gets_a_token_and_the_common_headers() -> void:
	await start_network()
	add_ok(INTERACTION)
	add_ok(SILENT)
	var device_time: int = TimeCore.get_device_time()
	assert_true(await NetworkCore.send(request(INTERACTION)))
	assert_true(TimeCore.is_synced(), "the first response syncs the server time")
	var server_time: int = TimeCore.get_server_time()
	assert_true(await NetworkCore.send(request(SILENT)))
	assert_eq(provider.get_calls, 2, "get_access_token once per send")
	assert_eq(header(0, "X-Ogw-Timestamp"), str(device_time), "device time before the first sync")
	assert_eq(header(1, "X-Ogw-Timestamp"), str(server_time), "server time after the first sync")
	for i: int in 2:
		var request_id: String = header(i, "X-Ogw-Request-Id")
		assert_true(RegEx.create_from_string("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$").search(request_id) != null, request_id)
		assert_eq(header(i, "Authorization"), "Bearer " + provider.access_token)
		assert_eq(header(i, "X-Ogw-Data-Version"), DataCore.get_data_version())
		assert_eq(header(i, "X-Ogw-Client-Version"), APP_VERSION)
		assert_eq(header(i, "X-Ogw-Platform"), CoreBuildInfo.platform)
		assert_eq(header(i, "Content-Type"), "application/x-protobuf")
		assert_false(has_header(i, "Content-Encoding"))
		assert_eq(header(i, "X-Ogw-Signature"), _expected_signature(provider.signing_key, INTERACTION if i == 0 else SILENT, i))


func test_token_failure_without_server_error_is_connection_failed_without_transport() -> void:
	await start_network()
	provider.get_results.append(FakeProvider.failed(0))
	provider.get_results.append(FakeProvider.failed(0))
	var kinds: PackedInt32Array = PackedInt32Array()
	var on_failure: Callable = func(failure: RequestFailure) -> bool:
		kinds.append(failure.kind)
		return true
	assert_false(await NetworkCore.send(request(SILENT), Callable(), on_failure))
	assert_eq(kinds, PackedInt32Array([NetworkCore.FailureKind.CONNECTION_FAILED]))
	assert_eq(request_count(), 0, "no NetworkTransport call")


func test_maintenance_from_the_token_refresh_is_a_maintenance_failure() -> void:
	await start_network()
	provider.get_results.append(FakeProvider.failed(CoreContract.CoreError.CORE_ERROR_MAINTENANCE))
	var codes: PackedInt32Array = PackedInt32Array()
	var on_failure: Callable = func(failure: RequestFailure) -> bool:
		codes.append(failure.error_code)
		return false
	assert_false(await NetworkCore.send(request(INTERACTION), Callable(), on_failure))
	assert_eq(codes, PackedInt32Array([CoreContract.CoreError.CORE_ERROR_MAINTENANCE]))
	assert_eq(request_count(), 0)
	await UnitTestCore.wait_frames(2)
	assert_true(popup_shows(ReservedString.network_error_maintenance()))
	assert_true(popup_shows(ReservedString.network_go_to_title()))


func test_send_again_reuses_the_id_and_body_and_a_new_send_does_not() -> void:
	await start_network()
	add_connection_failure(INTERACTION)
	add_ok(INTERACTION)
	add_ok(INTERACTION)
	var message: CoreContract.CheckPurchaseRequest = CoreContract.CheckPurchaseRequest.new()
	assert_true(await NetworkCore.send(message))
	assert_true(await NetworkCore.send(message))
	assert_eq(header(0, "X-Ogw-Request-Id"), header(1, "X-Ogw-Request-Id"), "the send again keeps the request ID")
	assert_eq(body_of(0), body_of(1))
	assert_ne(header(2, "X-Ogw-Request-Id"), header(0, "X-Ogw-Request-Id"), "a new send gets a new request ID")


func test_logs_leave_out_tokens_keys_signatures_and_sensitive_bodies() -> void:
	await start_network()
	provider.access_token = "token-in-no-log-7f3a"
	provider.signing_key = "key-in-no-log-9c2e"
	# 0: `SendOptions.sensitive`.
	var sensitive: CoreContract.CheckPurchaseRequest = CoreContract.CheckPurchaseRequest.new()
	sensitive.product_id = 424242
	var sensitive_response: CoreContract.CheckPurchaseResponse = CoreContract.CheckPurchaseResponse.new()
	sensitive_response.account_token = "sensitive-response-in-no-log-3d9f"
	var options: SendOptions = SendOptions.new()
	options.sensitive = true
	UnitTestCore.add_result(INTERACTION, NetworkCore.TransferResult.DONE, 200, ok_bytes(sensitive_response))
	assert_true(await NetworkCore.send(sensitive, Callable(), Callable(), options))
	# 1: `(ogw.sensitive)`.
	var age: CoreContract.ConfirmAgeRequest = CoreContract.ConfirmAgeRequest.new()
	age.birth_year_month = 199912
	var age_response: CoreContract.ConfirmAgeResponse = CoreContract.ConfirmAgeResponse.new()
	age_response.consent = CoreContract.ConsentUserState.new()
	age_response.consent.age_confirmed_at = 1700000012345
	age_response.consent.age_from = 18
	UnitTestCore.add_result("core/ConfirmAge", NetworkCore.TransferResult.DONE, 200, ok_bytes(age_response))
	assert_true(await NetworkCore.send(age))
	# 2: `send_auth`.
	var login: CoreContract.LoginRequest = CoreContract.LoginRequest.new()
	login.credential = "login-credential-in-no-log-5e6f"
	var login_response: CoreContract.LoginResponse = CoreContract.LoginResponse.new()
	login_response.result = CoreContract.AuthResult.new()
	login_response.result.login_token = "login-response-in-no-log-77cc"
	UnitTestCore.add_result("core/Login", NetworkCore.TransferResult.DONE, 200, ok_bytes(login_response))
	var auth: AuthSendOptions = AuthSendOptions.new()
	auth.authorization = "login-token-in-no-log-11aa"
	auth.sign = true
	auth.signing_key = "auth-key-in-no-log-22bb"
	assert_true((await NetworkCore.send_auth(login, auth)).ok)
	# 3: a request that is not sensitive, sent the same way as 0.
	var plain: CoreContract.CheckPurchaseRequest = CoreContract.CheckPurchaseRequest.new()
	plain.product_id = 515151
	var plain_response: CoreContract.CheckPurchaseResponse = CoreContract.CheckPurchaseResponse.new()
	plain_response.account_token = "plain-response-8a8a"
	UnitTestCore.add_result(INTERACTION, NetworkCore.TransferResult.DONE, 200, ok_bytes(plain_response))
	assert_true(await NetworkCore.send(plain))
	assert_eq(request_count(), 4)
	var text: String = log_text()
	for secret: String in [provider.access_token, provider.signing_key, auth.authorization, auth.signing_key, header(0, "X-Ogw-Signature"), header(2, "X-Ogw-Signature")]:
		assert_false(secret.is_empty())
		assert_false(text.contains(secret), "log has no %s" % secret)
	var hidden: Array[PackedByteArray] = [body_of(0), body_of(1), body_of(2), sensitive_response.encode(), age_response.encode(), login_response.encode()]
	for body: PackedByteArray in hidden:
		assert_false(body.is_empty(), "the body has bytes to look for")
		assert_false(text.contains(Marshalls.raw_to_base64(body)), "no sensitive or send_auth body")
	for body: PackedByteArray in [body_of(3), plain_response.encode()]:
		assert_false(body.is_empty())
		assert_true(text.contains(Marshalls.raw_to_base64(body)), "a DEV build log has the body of a request that is not sensitive")


func test_no_bodies_in_logs_of_stg_and_prod() -> void:
	await start_network()
	CoreBuildInfo.has_dev_code = false
	var message: CoreContract.SaveTutorialProgressRequest = CoreContract.SaveTutorialProgressRequest.new()
	message.tutorial_id = 123456789
	add_ok(SILENT_RETRY)
	assert_true(await NetworkCore.send(message))
	LogCore.log_info("Test", "a line after the request")
	var text: String = log_text()
	assert_true(text.contains("a line after the request"))
	assert_false(text.contains(Marshalls.raw_to_base64(body_of(0))))


func test_set_server_info_checks_the_url_platform_and_version() -> void:
	await start_network()
	assert_true(NetworkCore.set_server_info("https://api.example.com/game", "", "android"))
	assert_true(NetworkCore.set_server_info("http://127.0.0.1:8080", "10.0.3", "web"), "DEV build takes http")
	for bad: PackedStringArray in [
		PackedStringArray(["ftp://example.com", "1.0.0", "ios"]),
		PackedStringArray(["https://example.com/?a=1", "1.0.0", "ios"]),
		PackedStringArray(["https://example.com/#top", "1.0.0", "ios"]),
		PackedStringArray(["https://example.com", "1.0.0", "playstation"]),
		PackedStringArray(["https://example.com", "1.0", "ios"]),
		PackedStringArray(["https://example.com", "1.x.0", "ios"]),
	]:
		assert_false(NetworkCore.set_server_info(bad[0], bad[1], bad[2]), str(bad))
	assert_eq(error_logs(), 6)
	add_ok(INTERACTION)
	assert_true(await NetworkCore.send(request(INTERACTION)))
	assert_eq(header(0, "X-Ogw-Client-Version"), "10.0.3", "a refused call keeps the last values")
	assert_eq(header(0, "X-Ogw-Platform"), "web")


func test_http_base_url_is_refused_without_dev_code() -> void:
	await start_network()
	CoreBuildInfo.has_dev_code = false
	assert_false(NetworkCore.set_server_info("http://127.0.0.1:8080", "1.0.0", "ios"))
	assert_eq(error_logs(), 1)
	assert_true(NetworkCore.set_server_info("https://127.0.0.1:8080", "1.0.0", "ios"))
	CoreBuildInfo.has_dev_code = true
	assert_true(NetworkCore.set_server_info("http://127.0.0.1:8080", "1.0.0", "ios"))


func test_send_without_base_url_or_provider_is_connection_failed() -> void:
	await start_network(false)
	var kinds: PackedInt32Array = PackedInt32Array()
	var on_failure: Callable = func(failure: RequestFailure) -> bool:
		kinds.append(failure.kind)
		return true
	assert_false(await NetworkCore.send(request(SILENT), Callable(), on_failure))
	NetworkCore.release()
	assert_true(NetworkCore.init())
	NetworkCore.set_session_provider(FakeProvider.new())
	assert_false(await NetworkCore.send(request(SILENT), Callable(), on_failure))
	assert_eq(kinds, PackedInt32Array([NetworkCore.FailureKind.CONNECTION_FAILED, NetworkCore.FailureKind.CONNECTION_FAILED]))
	assert_eq(request_count(), 0)
	assert_eq(error_logs(), 2)


func test_a_message_that_is_not_a_request_is_not_sent() -> void:
	await start_network()
	assert_false(await NetworkCore.send(CoreCheatContract.SetTimeOffsetRequest.new()), "a cheat request through send")
	assert_false(await NetworkCore.send(null))
	assert_false(await NetworkCore.send(ContractRequest.new()), "no request name")
	assert_eq(request_count(), 0)
	assert_eq(error_logs(), 3)
	assert_eq(completed.size(), 0)
