extends GutTest
## Encode and decode round trip of the Godot generated contract code (`client-core` Godot `### generated code`).

## Bytes of `full_state()` by the server generated code of the same contract.
const GOLDEN_HEX: String = "082a10fbffffffffffffffff011880ccbbbcdeffffffff01250000c03f2900000000000002c030013a0768c3a9f09f9880420300ff07480252060803120208045a0d01feffffffffffffffff01ac02620b05faffffffffffffffff016a080000803e000000bf72107dc39425ad49b254000000000000c0bf7a020100820101618201008201036363638a0101018a010092010201009a010208099a0100a2011808011a143132333435363738393031323334353637383930"


static func full_state() -> GameContract.ToolTestUserState:
	var m: GameContract.ToolTestUserState = GameContract.ToolTestUserState.new()
	m.id = 42
	m.small = -5
	m.large = -9000000000
	m.ratio = 1.5
	m.precise = -2.25
	m.flag = true
	m.label = "hé😀"
	m.blob = PackedByteArray([0, 255, 7])
	m.kind = GameContract.ToolTestKind.TOOL_TEST_KIND_SHIELD
	var part: GameContract.ToolTestPart = GameContract.ToolTestPart.new()
	part.item_id = 3
	var child: GameContract.ToolTestPart = GameContract.ToolTestPart.new()
	child.item_id = 4
	part.children.append(child)
	m.part = part
	m.smalls = PackedInt32Array([1, -2, 300])
	m.larges = PackedInt64Array([5, -6])
	m.ratios = PackedFloat32Array([0.25, -0.5])
	m.precises = PackedFloat64Array([1e100, -0.125])
	m.flags = [true, false]
	m.labels = PackedStringArray(["a", "", "ccc"])
	m.blobs = [PackedByteArray([1]), PackedByteArray()]
	m.kinds = PackedInt32Array([GameContract.ToolTestKind.TOOL_TEST_KIND_SWORD, 0])
	var first: GameContract.ToolTestPart = GameContract.ToolTestPart.new()
	first.item_id = 9
	m.parts = [first, GameContract.ToolTestPart.new()]
	var reward: CoreContract.ItemAmount = CoreContract.ItemAmount.new()
	reward.item_id = 1
	reward.big_amount = "12345678901234567890"
	m.reward = reward
	return m


func assert_full_state(m: GameContract.ToolTestUserState) -> void:
	assert_eq(m.id, 42)
	assert_eq(m.small, -5)
	assert_eq(m.large, -9000000000)
	assert_eq(m.ratio, 1.5)
	assert_eq(m.precise, -2.25)
	assert_true(m.flag)
	assert_eq(m.label, "hé😀")
	assert_eq(m.blob, PackedByteArray([0, 255, 7]))
	assert_eq(m.kind, GameContract.ToolTestKind.TOOL_TEST_KIND_SHIELD)
	assert_not_null(m.part)
	if m.part != null:
		assert_eq(m.part.item_id, 3)
		assert_eq(m.part.children.size(), 1)
		if m.part.children.size() == 1:
			assert_eq(m.part.children[0].item_id, 4)
	assert_eq(m.smalls, PackedInt32Array([1, -2, 300]))
	assert_eq(m.larges, PackedInt64Array([5, -6]))
	assert_eq(m.ratios, PackedFloat32Array([0.25, -0.5]))
	assert_eq(m.precises, PackedFloat64Array([1e100, -0.125]))
	assert_eq(m.flags.size(), 2)
	assert_eq(m.labels, PackedStringArray(["a", "", "ccc"]))
	assert_eq(m.blobs.size(), 2)
	if m.blobs.size() == 2:
		assert_eq(m.blobs[0], PackedByteArray([1]))
		assert_eq(m.blobs[1], PackedByteArray())
	assert_eq(m.kinds, PackedInt32Array([1, 0]))
	assert_eq(m.parts.size(), 2)
	if m.parts.size() == 2:
		assert_eq(m.parts[0].item_id, 9)
		assert_eq(m.parts[1].children.size(), 0)
	assert_not_null(m.reward)
	if m.reward != null:
		assert_eq(m.reward.item_id, 1)
		assert_eq(m.reward.amount, 0)
		assert_eq(m.reward.big_amount, "12345678901234567890")


func test_contract_encode_matches_the_server_code() -> void:
	assert_eq(full_state().encode().hex_encode(), GOLDEN_HEX)


func test_contract_decode_reads_the_server_code_bytes() -> void:
	var m: GameContract.ToolTestUserState = GameContract.ToolTestUserState.new()
	assert_true(m.decode(GOLDEN_HEX.hex_decode()))
	assert_full_state(m)


func test_contract_round_trip_keeps_every_field() -> void:
	var m: GameContract.ToolTestUserState = GameContract.ToolTestUserState.new()
	assert_true(m.decode(full_state().encode()))
	assert_full_state(m)
	assert_eq(m.encode(), full_state().encode())


func test_contract_default_message_is_empty_bytes() -> void:
	assert_eq(GameContract.ToolTestUserState.new().encode().size(), 0)
	var m: GameContract.ToolTestUserState = GameContract.ToolTestUserState.new()
	assert_true(m.decode(PackedByteArray()))
	assert_eq(m.small, 0)
	assert_null(m.part)
	assert_eq(m.kind, GameContract.ToolTestKind.TOOL_TEST_KIND_UNSPECIFIED)


func test_contract_decode_resets_fields_first() -> void:
	var m: GameContract.ToolTestUserState = full_state()
	var only: GameContract.ToolTestUserState = GameContract.ToolTestUserState.new()
	only.small = 3
	assert_true(m.decode(only.encode()))
	assert_eq(m.small, 3)
	assert_eq(m.large, 0)
	assert_eq(m.labels.size(), 0)
	assert_null(m.part)


func test_contract_negative_int32_is_a_ten_byte_varint() -> void:
	var m: GameContract.ToolTestSingleUserState = GameContract.ToolTestSingleUserState.new()
	m.count = -1
	assert_eq(m.encode().hex_encode(), "08ffffffffffffffffff01")


func test_contract_decode_reads_unpacked_repeated_scalars_and_skips_unknown_fields() -> void:
	# smalls (11) unpacked 7 and 8, unknown field 99 varint, unknown field 98 bytes, flag (6) true.
	var bytes: PackedByteArray = "5807580898060192060261623001".hex_decode()
	var m: GameContract.ToolTestUserState = GameContract.ToolTestUserState.new()
	assert_true(m.decode(bytes))
	assert_eq(m.smalls, PackedInt32Array([7, 8]))
	assert_true(m.flag)


func test_contract_repeated_message_occurrences_of_a_singular_field_merge() -> void:
	# part (10) twice: item_id 3, then children [item_id 4]
	var bytes: PackedByteArray = "52020803520412020804".hex_decode()
	var m: GameContract.ToolTestUserState = GameContract.ToolTestUserState.new()
	assert_true(m.decode(bytes))
	assert_not_null(m.part)
	if m.part != null:
		assert_eq(m.part.item_id, 3)
		assert_eq(m.part.children.size(), 1)


func test_contract_decode_fails_on_bad_bytes() -> void:
	var m: GameContract.ToolTestUserState = GameContract.ToolTestUserState.new()
	# truncated varint
	assert_false(m.decode("1080".hex_decode()))
	# wire type 1 for an int32 field
	assert_false(m.decode("110000000000000000".hex_decode()))
	# length past the end
	assert_false(m.decode("3a05616263".hex_decode()))
	# string that is not UTF-8
	assert_false(m.decode("3a02ff61".hex_decode()))
	# field number 0
	assert_false(m.decode("0001".hex_decode()))
	# wire type 7
	assert_false(m.decode("0f".hex_decode()))
	# bad bytes in a nested message
	assert_false(m.decode("5202ff01".hex_decode()))


func test_contract_decode_reads_the_server_code_bytes_of_a_lone_surrogate() -> void:
	var m: GameContract.ToolTestUserState = GameContract.ToolTestUserState.new()
	# label "a" + U+DC80 + "b" as the server code writes it: the lone surrogate is U+FFFD
	assert_true(m.decode("3a0561efbfbd62".hex_decode()))
	assert_eq(m.label, "a�b")
	# the raw byte 0x80 in its place is not UTF-8
	assert_false(m.decode("3a03618062".hex_decode()))


func test_contract_decode_fails_past_the_nesting_limit() -> void:
	var bytes: PackedByteArray = PackedByteArray()
	for _i: int in range(120):
		var outer: PackedByteArray = PackedByteArray([0x12])
		ContractMessage._write_varint(outer, bytes.size())
		outer.append_array(bytes)
		bytes = outer
	var part: GameContract.ToolTestPart = GameContract.ToolTestPart.new()
	assert_false(part.decode(bytes))


func test_contract_copy_from_puts_the_field_values() -> void:
	var m: GameContract.ToolTestUserState = GameContract.ToolTestUserState.new()
	m.copy_from(full_state())
	assert_full_state(m)
	var other: GameContract.ToolTestSingleUserState = GameContract.ToolTestSingleUserState.new()
	other.count = 5
	m.copy_from(other)
	assert_eq(m.small, -5)


func test_contract_request_has_its_rpc_name_and_options() -> void:
	var echo: GameContract.ToolTestEchoRequest = GameContract.ToolTestEchoRequest.new()
	assert_true(echo is ContractRequest)
	assert_eq(echo.request_name(), "ToolTestEcho")
	assert_true(echo.is_silent())
	assert_false(echo.is_retry())
	assert_true(echo.is_sensitive())
	assert_true(echo.new_response() is GameContract.ToolTestEchoResponse)
	var run: GameContract.RunCoreTestRequest = GameContract.RunCoreTestRequest.new()
	assert_eq(run.request_name(), "RunCoreTest")
	assert_true(run.is_retry())
	var response: ContractMessage = GameContract.ToolTestEchoResponse.new()
	assert_false(response is ContractRequest)


func test_contract_core_and_cheat_requests_have_their_request_names() -> void:
	var login: CoreContract.LoginRequest = CoreContract.LoginRequest.new()
	assert_eq(login.request_name(), "core/Login")
	assert_true(login.new_response() is CoreContract.LoginResponse)
	var cheat: GameCheatContract.ToolTestSetCountRequest = GameCheatContract.ToolTestSetCountRequest.new()
	assert_eq(cheat.request_name(), "cheat/ToolTestSetCount")
	assert_eq(cheat.kind, GameContract.ToolTestKind.TOOL_TEST_KIND_UNSPECIFIED)


func test_contract_user_state_kinds_are_in_kind_order() -> void:
	var names: PackedStringArray = PackedStringArray()
	var tool_kind: ContractKind = null
	for kind: ContractKind in GameContract.user_state_kinds():
		names.append(kind.name)
		if kind.name == "ToolTestUserState":
			tool_kind = kind
	assert_eq(names, PackedStringArray(["GuildTestUserState", "ToolTestUserState", "ToolTestSingleUserState"]))
	assert_not_null(tool_kind)
	if tool_kind != null:
		assert_true(tool_kind.is_list)
		assert_eq(tool_kind.kind_class, GameContract.ToolTestUserState)
		assert_true(tool_kind.kind_class.new() is GameContract.ToolTestUserState)
	var core_names: PackedStringArray = PackedStringArray()
	for kind: ContractKind in CoreContract.user_state_kinds():
		core_names.append(kind.name)
	assert_true(core_names.has("ItemBalanceUserState"))


func test_contract_core_errors_list_the_game_errors_of_a_core_rpc() -> void:
	assert_eq(GameContract.core_errors("core/StartPlaySession"), PackedInt32Array([GameContract.GameError.GAME_ERROR_CORE_TEST]))
	assert_eq(GameContract.core_errors("core/Login"), PackedInt32Array())


func test_contract_json_round_trip() -> void:
	var text: String = ContractJsonDev.to_json(full_state())
	var parser: JSON = JSON.new()
	assert_eq(parser.parse(text), OK)
	var m: GameContract.ToolTestUserState = GameContract.ToolTestUserState.new()
	assert_true(ContractJsonDev.from_json(m, text))
	assert_full_state(m)


func test_contract_json_uses_proto_names_decimal_int64_and_enum_names() -> void:
	var text: String = ContractJsonDev.to_json(full_state())
	assert_true(text.begins_with("{\"id\":\"42\",\"small\":-5,\"large\":\"-9000000000\","))
	assert_true(text.contains("\"kind\":\"TOOL_TEST_KIND_SHIELD\""))
	assert_true(text.contains("\"blob\":\"AP8H\""))
	assert_true(text.contains("\"reward\":{\"item_id\":1,\"big_amount\":\"12345678901234567890\"}"))
	assert_eq(ContractJsonDev.to_json(GameContract.ToolTestSingleUserState.new()), "{}")


func test_contract_json_reads_the_server_code_json() -> void:
	var json: String = "{\"id\":\"42\",\"small\":-5,\"large\":\"-9000000000\",\"ratio\":1.5,\"precise\":-2.25,\"flag\":true,\"label\":\"hé😀\",\"blob\":\"AP8H\",\"kind\":\"TOOL_TEST_KIND_SHIELD\",\"part\":{\"item_id\":3,\"children\":[{\"item_id\":4}]},\"smalls\":[1,-2,300],\"larges\":[\"5\",\"-6\"],\"ratios\":[0.25,-0.5],\"precises\":[1e+100,-0.125],\"flags\":[true,false],\"labels\":[\"a\",\"\",\"ccc\"],\"blobs\":[\"AQ==\",\"\"],\"kinds\":[\"TOOL_TEST_KIND_SWORD\",\"TOOL_TEST_KIND_UNSPECIFIED\"],\"parts\":[{\"item_id\":9},{}],\"reward\":{\"item_id\":1,\"big_amount\":\"12345678901234567890\"}}"
	var m: GameContract.ToolTestUserState = GameContract.ToolTestUserState.new()
	assert_true(ContractJsonDev.from_json(m, json))
	assert_full_state(m)


func test_contract_json_reads_json_names_and_rejects_bad_values() -> void:
	var m: GameContract.ToolTestPart = GameContract.ToolTestPart.new()
	assert_true(ContractJsonDev.from_json(m, "{\"itemId\":2}"))
	assert_eq(m.item_id, 2)
	var state: GameContract.ToolTestUserState = GameContract.ToolTestUserState.new()
	assert_true(ContractJsonDev.from_json(state, "{\"startedAt\":1,\"small\":2,\"unknown\":true}"))
	assert_eq(state.small, 2)
	assert_false(ContractJsonDev.from_json(state, "{\"small\":\"x\"}"))
	assert_false(ContractJsonDev.from_json(state, "{\"small\":2147483648}"))
	assert_false(ContractJsonDev.from_json(state, "{\"large\":\"9223372036854775808\"}"))
	assert_true(ContractJsonDev.from_json(state, "{\"large\":\"-9223372036854775808\"}"))
	assert_eq(state.large, -9223372036854775807 - 1)
	assert_false(ContractJsonDev.from_json(state, "{\"kind\":\"NOT_A_KIND\"}"))
	assert_false(ContractJsonDev.from_json(state, "{\"blob\":\"#\"}"))
	assert_false(ContractJsonDev.from_json(state, "[]"))
	assert_false(ContractJsonDev.from_json(state, "{"))
