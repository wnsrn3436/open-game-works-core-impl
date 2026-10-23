extends "res://core/qa_core/tests/support/qa_test_case.gd"
## Cheat commands: one `NetworkCore.send_cheat` request each, with ID names as ID values and the contract's big
## encoding, and no request after a failed check.

const SET_USER_STATE: String = "core/cheat/SetUserState"
const DELETE_USER_STATE: String = "core/cheat/DeleteUserState"
const SET_ITEM_BALANCE: String = "core/cheat/SetItemBalance"
const SET_MISSION_PROGRESS: String = "core/cheat/SetMissionProgress"
const SET_RESET_COUNTER: String = "core/cheat/SetResetCounter"
const SET_TIME_OFFSET: String = "core/cheat/SetTimeOffset"
const BIG: String = "12345678901234567890"

var gold: int = 0


func start_cheats() -> bool:
	var ok: bool = await start()
	gold = GameDataDev.find_id_value("[gold]")
	assert_true(gold != 0, "[gold] is in the core test data")
	return ok


func test_set_user_state() -> void:
	assert_true(await start_cheats())
	add_ok(SET_USER_STATE)
	await run_ok("set_user_state", PackedStringArray(["ItemBalanceUserState", "[gold]", "{\"amount\": \"7\", \"id\": \"[gem]\"}"]))
	var sent: Array[PackedByteArray] = bodies(SET_USER_STATE)
	assert_eq(sent.size(), 1, "one SetUserState")
	var request: CoreCheatContract.SetUserStateRequest = CoreCheatContract.SetUserStateRequest.new()
	assert_true(request.decode(sent[0]))
	assert_eq(request.kind, "ItemBalanceUserState")
	assert_eq(request.item_id, gold, "the ID name item is its ID value")
	var row: CoreContract.ItemBalanceUserState = CoreContract.ItemBalanceUserState.new()
	assert_true(ContractJsonDev.from_json(row, request.value_json))
	assert_eq(row.id, gold, "a list kind takes the item ID as id")
	assert_eq(row.amount, 7)
	add_ok(SET_USER_STATE)
	await run_ok("set_user_state", PackedStringArray(["ItemBalanceUserState", "12", "{\"amount\": 1}"]))
	sent = bodies(SET_USER_STATE)
	assert_true(request.decode(sent[1]))
	assert_eq(request.item_id, 12, "a decimal item is the item ID")
	add_ok(SET_USER_STATE)
	await run_ok("set_user_state", PackedStringArray(["ItemBalanceUserState", "0", "{\"amount\": 1}"]))
	sent = bodies(SET_USER_STATE)
	assert_true(request.decode(sent[2]))
	assert_eq(request.item_id, 0, "a decimal item of 0 is the item ID")
	assert_true(ContractJsonDev.from_json(row, request.value_json))
	assert_eq(row.id, 0)
	add_ok(SET_USER_STATE)
	await run_ok("set_user_state", PackedStringArray(["GuildTestUserState", "[]", "{\"guild_id\": \"[gold]\"}"]))
	sent = bodies(SET_USER_STATE)
	assert_true(request.decode(sent[3]))
	var guild: GameContract.GuildTestUserState = GameContract.GuildTestUserState.new()
	assert_true(ContractJsonDev.from_json(guild, request.value_json))
	assert_eq(guild.guild_id, gold, "an ID name string in the value is its ID value")
	assert_eq(request.item_id, 0, "a single kind has item 0")
	var count: int = request_count()
	var bad: Array[PackedStringArray] = [
		PackedStringArray(["ItemBalanceUserState", "[qa_no_such_id]", "{}"]),
		PackedStringArray(["ItemBalanceUserState", "[gold]", "{\"amount\": \"[qa_no_such_id]\"}"]),
		PackedStringArray(["ItemBalanceUserState", "[gold]", "{\"amount\": 1"]),
		PackedStringArray(["ItemBalanceUserState", "[gold]", "[1]"]),
		PackedStringArray(["ItemBalanceUserState", "1234567890123456789", "{}"]),
		PackedStringArray(["ItemBalanceUserState", "-", "{}"]),
		PackedStringArray(["ItemBalanceUserState", "-1", "{}"]),
		PackedStringArray(["ItemBalanceUserState", "[]", "{}"]),
		PackedStringArray(["NoSuchUserState", "[gold]", "{}"]),
		PackedStringArray(["GuildTestUserState", "[gold]", "{}"]),
		PackedStringArray(["GuildTestUserState", "0", "{}"]),
	]
	for item: PackedStringArray in bad:
		assert_false((await run("set_user_state", item)).ok, " ".join(item))
	assert_eq(request_count(), count, "no request after a failed check")
	assert_eq(warns(), bad.size())


func test_delete_user_state() -> void:
	assert_true(await start_cheats())
	add_ok(DELETE_USER_STATE)
	await run_ok("delete_user_state", PackedStringArray(["ItemBalanceUserState", "[gold]"]))
	var request: CoreCheatContract.DeleteUserStateRequest = CoreCheatContract.DeleteUserStateRequest.new()
	assert_true(request.decode(bodies(DELETE_USER_STATE)[0]))
	assert_eq(request.kind, "ItemBalanceUserState")
	assert_eq(request.item_id, gold)
	add_ok(DELETE_USER_STATE)
	await run_ok("delete_user_state", PackedStringArray(["GuildTestUserState", "[]"]))
	assert_true(request.decode(bodies(DELETE_USER_STATE)[1]))
	assert_eq(request.kind, "GuildTestUserState")
	assert_eq(request.item_id, 0, "a single kind has item 0")
	var count: int = request_count()
	var bad: Array[PackedStringArray] = [
		PackedStringArray(["ItemBalanceUserState", "[]"]),
		PackedStringArray(["ItemBalanceUserState", "-1"]),
		PackedStringArray(["GuildTestUserState", "0"]),
		PackedStringArray(["NoSuchUserState", "[gold]"]),
	]
	for item: PackedStringArray in bad:
		assert_false((await run("delete_user_state", item)).ok, " ".join(item))
	assert_eq(request_count(), count, "no request after a failed check")
	assert_eq(warns(), bad.size())


func test_set_item_balance() -> void:
	assert_true(await start_cheats())
	var envelope: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	envelope.server_time_at = SERVER_TIME
	envelope.user_state = balance_delta(gold, 250)
	add_ok(SET_ITEM_BALANCE, envelope)
	await run_ok("set_item_balance", PackedStringArray(["[gold]", "250"]))
	var request: CoreCheatContract.SetItemBalanceRequest = CoreCheatContract.SetItemBalanceRequest.new()
	assert_true(request.decode(bodies(SET_ITEM_BALANCE)[0]))
	assert_eq(request.item_id, gold)
	assert_eq(request.balance, 250)
	assert_eq(request.big_balance, "")
	assert_eq(UserStateCore.get_item_balance(gold), 250, "the response delta reaches UserStateCore")
	add_ok(SET_ITEM_BALANCE)
	await run_ok("set_item_balance", PackedStringArray(["[gold]", BIG]))
	assert_true(request.decode(bodies(SET_ITEM_BALANCE)[1]))
	assert_eq(request.balance, 0, "a big balance goes in big_balance")
	assert_eq(request.big_balance, BIG)
	var count: int = request_count()
	for balance: String in ["-1", "01", "1.5", ""]:
		assert_false((await run("set_item_balance", PackedStringArray(["[gold]", balance]))).ok, balance)
	assert_false((await run("set_item_balance", PackedStringArray(["gold", "1"]))).ok, "not an ID name")
	assert_eq(request_count(), count, "no request after a failed check")
	assert_eq(warns(), 5)


func test_set_mission_progress_and_reset_counter() -> void:
	assert_true(await start_cheats())
	add_ok(SET_MISSION_PROGRESS)
	await run_ok("set_mission_progress", PackedStringArray(["[mission_sum_daily]", "3", "true"]))
	var mission: CoreCheatContract.SetMissionProgressRequest = CoreCheatContract.SetMissionProgressRequest.new()
	assert_true(mission.decode(bodies(SET_MISSION_PROGRESS)[0]))
	assert_eq(mission.mission_id, GameDataDev.find_id_value("[mission_sum_daily]"))
	assert_eq(mission.progress, 3)
	assert_true(mission.claimed)
	add_ok(SET_RESET_COUNTER)
	await run_ok("set_reset_counter", PackedStringArray(["[reset_counter_daily]", "2"]))
	var counter: CoreCheatContract.SetResetCounterRequest = CoreCheatContract.SetResetCounterRequest.new()
	assert_true(counter.decode(bodies(SET_RESET_COUNTER)[0]))
	assert_eq(counter.counter_id, GameDataDev.find_id_value("[reset_counter_daily]"))
	assert_eq(counter.count, 2)
	var count: int = request_count()
	assert_false((await run("set_mission_progress", PackedStringArray(["[mission_sum_daily]", "-1", "true"]))).ok)
	assert_false((await run("set_mission_progress", PackedStringArray(["[mission_sum_daily]", "1", "yes"]))).ok)
	assert_false((await run("set_reset_counter", PackedStringArray(["[qa_no_such_id]", "1"]))).ok)
	assert_eq(request_count(), count)
	assert_eq(warns(), 3)


func test_set_server_time_offset() -> void:
	assert_true(await start_cheats())
	add_ok(SET_TIME_OFFSET)
	await run_ok("set_server_time_offset", PackedStringArray(["-60000"]))
	var request: CoreCheatContract.SetTimeOffsetRequest = CoreCheatContract.SetTimeOffsetRequest.new()
	assert_true(request.decode(bodies(SET_TIME_OFFSET)[0]))
	assert_eq(request.offset_ms, -60000)


func balance_delta(item_id: int, amount: int) -> CoreContract.UserStateDelta:
	var row: CoreContract.ItemBalanceUserState = CoreContract.ItemBalanceUserState.new()
	row.id = item_id
	row.amount = amount
	var entry: CoreContract.UserStateEntry = CoreContract.UserStateEntry.new()
	entry.kind = "ItemBalanceUserState"
	entry.id = item_id
	entry.value = row.encode()
	var delta: CoreContract.UserStateDelta = CoreContract.UserStateDelta.new()
	delta.entries.append(entry)
	return delta
