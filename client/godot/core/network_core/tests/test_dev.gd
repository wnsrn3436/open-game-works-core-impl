extends "res://core/network_core/tests/support/network_test_case.gd"
## DEV operations: cheat sends, dev access, forced failure and delay, request records, and their absence from the
## module code that STG and PROD builds keep.

const _MODULE_DIR: String = "res://core/network_core"
const _DEV_PATH: String = "res://core/network_core/dev/network_core_dev.gd"
## Names of the DEV code the module code outside `dev/` must not hold: its classes, the cheat sends, the dev access
## header and the forced failure and delay. The module code keeps the request records in a run with DEV code.
const _DEV_WORDS: PackedStringArray = [
	"NetworkCoreDev", "NetworkRequestRecord", "/dev/", "Dev-Access", "_send_cheat", "_send_auth_cheat",
	"forced failure", "_forced_failure as", "_forced_delay_ms >",
]


func test_send_cheat_keeps_the_queue_order_and_the_cheat_path() -> void:
	await start_network()
	UnitTestCore.add_pending(INTERACTION)
	var first: Sent = start_send(request(INTERACTION))
	var cheat: CoreCheatContract.SetTimeOffsetRequest = CoreCheatContract.SetTimeOffsetRequest.new()
	cheat.offset_ms = 1000
	var env: CoreContract.ResponseEnvelope = envelope()
	env.user_state = tutorial_delta(PackedInt64Array([8]))
	add_envelope("core/cheat/SetTimeOffset", env)
	var results: PackedStringArray = PackedStringArray()
	var run: Callable = func() -> void:
		results.append(str(await NetworkCoreDev.send_cheat(cheat)))
	run.call()
	assert_eq(request_count(), 1, "the cheat waits in the queue")
	assert_true(InputBlockCore.is_blocked())
	assert_true(release_ok(INTERACTION))
	assert_true(await wait_sent(first))
	await UnitTestCore.wait_frames(1)
	assert_eq(results, PackedStringArray(["true"]))
	assert_eq(request_count("core/cheat/SetTimeOffset"), 1)
	assert_eq(UserStateCore.count(CoreContract.TutorialProgressUserState), 1)
	assert_false(await NetworkCoreDev.send_cheat(request(INTERACTION)), "send_cheat takes only cheat requests")
	assert_eq(error_logs(), 1)


func test_dev_access_goes_only_to_cheat_requests() -> void:
	await start_network()
	NetworkCoreDev.set_dev_access("dev-access-secret-5d1")
	add_ok("core/cheat/SetTimeOffset")
	add_ok("core/cheat/DevLogin")
	add_ok(INTERACTION)
	add_ok("core/Login")
	assert_true(await NetworkCoreDev.send_cheat(CoreCheatContract.SetTimeOffsetRequest.new()))
	assert_true((await NetworkCoreDev.send_auth_cheat(CoreCheatContract.DevLoginRequest.new(), AuthSendOptions.new())).ok)
	assert_true(await NetworkCore.send(request(INTERACTION)))
	assert_true((await NetworkCore.send_auth(request("core/Login"), AuthSendOptions.new())).ok)
	assert_eq(header(0, "X-Ogw-Dev-Access"), "dev-access-secret-5d1")
	assert_eq(header(1, "X-Ogw-Dev-Access"), "dev-access-secret-5d1")
	assert_false(has_header(2, "X-Ogw-Dev-Access"))
	assert_false(has_header(3, "X-Ogw-Dev-Access"))
	assert_false(log_text().contains("dev-access-secret-5d1"))


func test_force_failure_and_force_delay() -> void:
	await start_network()
	NetworkCoreDev.force_failure(NetworkCore.FailureKind.TIMEOUT)
	var kinds: PackedInt32Array = PackedInt32Array()
	var on_failure: Callable = func(failure: RequestFailure) -> bool:
		kinds.append(failure.kind)
		return true
	assert_false(await NetworkCore.send(request(SILENT), Callable(), on_failure))
	assert_eq(kinds, PackedInt32Array([NetworkCore.FailureKind.TIMEOUT]))
	assert_eq(request_count(), 0, "no transport")
	assert_eq(provider.get_calls, 0, "no token")
	NetworkCoreDev.force_failure(-1)
	NetworkCoreDev.force_delay(2000)
	add_ok(SILENT, SERVER_TIME)
	var sent: Sent = start_send(request(SILENT))
	await advance(1999)
	assert_false(sent.done, "the result is taken 2000 ms later")
	await advance(1)
	assert_true(await wait_sent(sent))
	assert_eq(TimeCore.get_server_time(), SERVER_TIME + 1000, "the sync takes the delayed time")
	NetworkCoreDev.force_delay(TIMEOUT_MS + 1)
	add_ok(SILENT)
	add_ok(SILENT)
	var late: Sent = start_send(request(SILENT), Callable(), on_failure)
	await advance(TIMEOUT_MS)
	await advance(TIMEOUT_MS)
	assert_false(await wait_sent(late), "a delay over the timeout times out")
	assert_eq(kinds[kinds.size() - 1], NetworkCore.FailureKind.TIMEOUT)
	assert_eq(error_logs(), 2)


func test_request_records() -> void:
	await start_network()
	add_ok(SILENT)
	add_error(INTERACTION, GameContract.GameError.GAME_ERROR_CORE_TEST)
	add_ok("core/Login")
	add_ok("core/ConfirmAge")
	add_ok(SILENT_RETRY)
	var loot: CoreContract.GetLootRatesRequest = CoreContract.GetLootRatesRequest.new()
	loot.loot_table_id = 5
	assert_true(await NetworkCore.send(loot))
	assert_false(await NetworkCore.send(request(INTERACTION), Callable(), func(_f: RequestFailure) -> bool: return true))
	assert_true((await NetworkCore.send_auth(request("core/Login"), AuthSendOptions.new())).ok)
	var records: Array[NetworkRequestRecord] = []
	records.resize(RECORD_COUNT)
	assert_eq(NetworkCoreDev.get_request_records(records), 3)
	assert_eq(records[0].request_name, SILENT)
	assert_eq(records[0].kind, NetworkCore.RequestKind.SILENT)
	assert_true(records[0].ok)
	assert_eq(records[0].request_body, loot.encode())
	assert_eq(records[1].request_name, INTERACTION)
	assert_false(records[1].ok)
	assert_eq(records[1].error_code, GameContract.GameError.GAME_ERROR_CORE_TEST)
	assert_eq(records[2].request_name, "core/Login")
	assert_true(records[2].request_body.is_empty(), "send_auth body is empty")
	var age: CoreContract.ConfirmAgeRequest = CoreContract.ConfirmAgeRequest.new()
	age.birth_year_month = 200001
	assert_true(await NetworkCore.send(age))
	var tutorial: CoreContract.SaveTutorialProgressRequest = CoreContract.SaveTutorialProgressRequest.new()
	tutorial.tutorial_id = 3
	var options: SendOptions = SendOptions.new()
	options.sensitive = true
	assert_true(await NetworkCore.send(tutorial, Callable(), Callable(), options))
	assert_eq(NetworkCore._request_records.size(), RECORD_COUNT, "keeps the latest devRequestRecordCount")
	assert_eq(NetworkCoreDev.get_request_records(records), 3)
	assert_eq(records[0].request_name, "core/Login")
	assert_eq(records[1].request_name, "core/ConfirmAge")
	assert_true(records[1].request_body.is_empty(), "(ogw.sensitive) body is empty")
	assert_true(records[2].request_body.is_empty(), "sensitive body is empty")
	var small: Array[NetworkRequestRecord] = []
	small.resize(2)
	assert_eq(NetworkCoreDev.get_request_records(small), 2)
	assert_eq(error_logs(), 1, "a buffer smaller than the records")
	assert_eq(warn_logs(), 1)


func test_the_dev_operations_are_only_in_dev_code() -> void:
	assert_true(ResourceLoader.exists(_DEV_PATH), "the DEV class is under dev/, which STG and PROD builds leave out")
	var files: PackedStringArray = PackedStringArray()
	for file: String in DirAccess.get_files_at(_MODULE_DIR):
		if file.ends_with(".gd"):
			files.append(file)
	assert_true(files.has("network_core.gd"), str(files))
	for file: String in files:
		var source: String = FileAccess.get_file_as_string(_MODULE_DIR + "/" + file)
		assert_ne(source, "", file)
		for word: String in _DEV_WORDS:
			assert_false(source.contains(word), "%s has no %s" % [file, word])


func test_request_records_from_init_with_no_call() -> void:
	await start_network()
	add_ok(SILENT)
	assert_true(await NetworkCore.send(request(SILENT)))
	var records: Array[NetworkRequestRecord] = []
	records.resize(RECORD_COUNT)
	assert_eq(NetworkCoreDev.get_request_records(records), 1, "kept from init with no call from another module")
	assert_eq(records[0].request_name, SILENT)


func test_no_request_record_without_dev_code() -> void:
	await start_network(false)
	NetworkCore.release()
	CoreBuildInfo.has_dev_code = false
	assert_true(NetworkCore.init())
	# No server info: the request ends as `ConnectionFailed` without the transport.
	assert_false(await NetworkCore.send(request(SILENT), Callable(), func(_f: RequestFailure) -> bool: return true))
	assert_true(NetworkCore._request_records.is_empty())
	assert_eq(error_logs(), 1)
