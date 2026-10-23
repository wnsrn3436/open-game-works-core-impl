extends "res://core/game_update_core/tests/support/game_update_test_case.gd"
## Deploy list signature check.


func test_deploy_list_over_its_max_bytes_is_invalid_file() -> void:
	var list: _BUILDER = make_list()
	var bytes: PackedByteArray = list.to_bytes()
	if not UnitTestCore.set_test_settings("GameUpdateCore.deployListMaxBytes", bytes.size() - 1):
		fail_test("setup failed")
		return
	if not await start():
		fail_test("setup failed")
		return
	serve(list)
	start_check(make_source())
	await expect_fetch_failure(ReservedString.game_update_invalid_file())
	assert_eq(downloader.count_calls(SIGNATURE_URL), 0, "the signature file is not downloaded")
	assert_true(UnitTestCore.set_test_settings("GameUpdateCore.deployListMaxBytes", bytes.size()))
	assert_true(await restart_module())
	serve(list)
	assert_true(await GameUpdateCore.check_update(make_source()), "a deploy list of its max bytes passes")


func test_signature_file_over_its_max_bytes_is_invalid_file() -> void:
	var list: _BUILDER = make_list()
	var signature_size: int = signature_bytes(list.to_bytes(), list.sequence).size()
	if not UnitTestCore.set_test_settings("GameUpdateCore.signatureMaxBytes", signature_size - 1):
		fail_test("setup failed")
		return
	if not await start():
		fail_test("setup failed")
		return
	serve(list)
	start_check(make_source())
	await expect_fetch_failure(ReservedString.game_update_invalid_file())
	assert_true(UnitTestCore.set_test_settings("GameUpdateCore.signatureMaxBytes", signature_size))
	assert_true(await restart_module())
	serve(list)
	assert_true(await GameUpdateCore.check_update(make_source()), "a signature file of its max bytes passes")


func test_signature_file_without_signature_is_invalid_file() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var bytes: PackedByteArray = make_list().to_bytes()
	downloader.add_body(LIST_URL, bytes)
	downloader.add_body(SIGNATURE_URL, ("{\"key_id\":%s,\"sequence\":1000}" % JSON.stringify(key_id(TRUSTED_SEED_HEX))).to_utf8_buffer())
	start_check(make_source())
	await expect_fetch_failure(ReservedString.game_update_invalid_file())


func test_empty_signature_file_is_invalid_file() -> void:
	if not await start():
		fail_test("setup failed")
		return
	downloader.add_body(LIST_URL, make_list().to_bytes())
	downloader.add_body(SIGNATURE_URL, PackedByteArray())
	start_check(make_source())
	await expect_fetch_failure(ReservedString.game_update_invalid_file())


func test_key_id_outside_trust_keys_is_invalid_file() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var bytes: PackedByteArray = make_list().to_bytes()
	downloader.add_body(LIST_URL, bytes)
	downloader.add_body(SIGNATURE_URL, signature_bytes(bytes, 1000, OTHER_SEED_HEX))
	start_check(make_source())
	await expect_fetch_failure(ReservedString.game_update_invalid_file())


func test_wrong_signature_is_invalid_file() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var bytes: PackedByteArray = make_list().to_bytes()
	downloader.add_body(LIST_URL, bytes)
	var other_signature: PackedByteArray = _SIGNER.sign(OTHER_SEED_HEX.hex_decode(), bytes)
	downloader.add_body(SIGNATURE_URL, signature_json(key_id(TRUSTED_SEED_HEX), 1000, other_signature))
	start_check(make_source())
	await expect_fetch_failure(ReservedString.game_update_invalid_file())


func test_deploy_list_with_one_changed_byte_is_invalid_file() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var list: _BUILDER = make_list()
	var bytes: PackedByteArray = list.to_bytes()
	var signature: PackedByteArray = signature_bytes(bytes, list.sequence)
	list.store_url = list.store_url.replace("store", "stork")
	var changed: PackedByteArray = list.to_bytes()
	assert_eq(changed.size(), bytes.size())
	downloader.add_body(LIST_URL, changed)
	downloader.add_body(SIGNATURE_URL, signature)
	start_check(make_source())
	await expect_fetch_failure(ReservedString.game_update_invalid_file())


func test_signature_sequence_mismatch_downloads_both_once_more() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var list: _BUILDER = make_list()
	var bytes: PackedByteArray = list.to_bytes()
	downloader.add_body(LIST_URL, bytes)
	downloader.add_body(SIGNATURE_URL, signature_bytes(bytes, list.sequence - 1))
	downloader.add_body(SIGNATURE_URL, signature_bytes(bytes, list.sequence))
	assert_true(await GameUpdateCore.check_update(make_source()))
	assert_eq(downloader.count_calls(LIST_URL), 2)
	assert_eq(downloader.count_calls(SIGNATURE_URL), 2)


func test_signature_sequence_mismatch_twice_is_invalid_file() -> void:
	if not await start():
		fail_test("setup failed")
		return
	var list: _BUILDER = make_list()
	var bytes: PackedByteArray = list.to_bytes()
	downloader.add_body(LIST_URL, bytes)
	downloader.add_body(SIGNATURE_URL, signature_bytes(bytes, list.sequence + 1))
	start_check(make_source())
	await expect_fetch_failure(ReservedString.game_update_invalid_file())
	assert_eq(downloader.count_calls(LIST_URL), 2)
	assert_eq(downloader.count_calls(SIGNATURE_URL), 2)
