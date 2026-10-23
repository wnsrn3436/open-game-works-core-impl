extends "res://core/user_state_core/tests/support/user_state_test_case.gd"
## `preview_item_add`: the rows server `item-ledger` `preview_add_items` computes for the same data and balances,
## input check failures, and the core test fixtures `item-timed` and `item-big`.

const T0: int = 1720000000000


## `<item>:<outcome>:<applied>/<big_applied>:<overflow>/<big_overflow>` and `[<replacement>...]` of each row.
func rows_text(rows: Array[ItemAddPreviewRow]) -> PackedStringArray:
	var out: PackedStringArray = PackedStringArray()
	for row: ItemAddPreviewRow in rows:
		var grants: PackedStringArray = PackedStringArray()
		for grant: ItemAddPreviewReplacement in row.replacements:
			grants.append("%s:%d/%s:%d/%s" % [GameDataDev.find_id_name(grant.item_id), grant.applied, grant.big_applied, grant.overflow, grant.big_overflow])
		var outcome: String = UserStateCore.ItemAddPreview.keys()[row.outcome]
		out.append("%s:%s:%d/%s:%d/%s[%s]" % [GameDataDev.find_id_name(row.item_id), outcome, row.applied, row.big_applied, row.overflow, row.big_overflow, ",".join(grants)])
	return out


func preview(items: Array[CoreContract.ItemAmount]) -> PackedStringArray:
	return rows_text(UserStateCore.preview_item_add(items))


func one(id_name: String, amount: int, big_amount: String = "") -> Array[CoreContract.ItemAmount]:
	return [item_amount(id_of(id_name), amount, big_amount)] as Array[CoreContract.ItemAmount]


func test_reject_discard_and_convert_rows_match_the_server() -> void:
	await start()
	put_balance(id_of("[ticket]"), 3)
	put_balance(id_of("[potion]"), 8)
	put_balance(id_of("[shard]"), 9)
	# Reject (max_amount 5): a grant that fits is applied.
	assert_eq(preview(one("[ticket]", 2)), PackedStringArray(["[ticket]:APPLIED:2/:0/[]"]))
	# Discard (max_amount 10): the part over max_amount is discarded.
	assert_eq(preview(one("[potion]", 5)), PackedStringArray(["[potion]:DISCARDED:2/:3/[]"]))
	# Convert (max_amount 10, 2 [dust] for each one over): the overflow goes to [dust].
	assert_eq(preview(one("[shard]", 3)), PackedStringArray(["[shard]:CONVERTED:1/:2/[[dust]:4/:0/]"]))
	# The replacement [dust] (Discard, max_amount 50) discards what goes over its max_amount.
	assert_eq(preview(one("[shard]", 31)), PackedStringArray(["[shard]:DISCARDED:1/:30/[[dust]:50/:10/]"]))


func test_one_reject_item_over_max_amount_mails_every_row() -> void:
	await start()
	put_balance(id_of("[ticket]"), 3)
	var items: Array[CoreContract.ItemAmount] = [item_amount(id_of("[potion]"), 1), item_amount(id_of("[ticket]"), 3)]
	assert_eq(preview(items), PackedStringArray(["[potion]:MAILED:0/:0/[]", "[ticket]:MAILED:0/:0/[]"]))


func test_a_reject_replacement_over_max_amount_mails_every_row() -> void:
	await start()
	put_balance(id_of("[ticket]"), 5)
	# [badge_coin] (Convert, max_amount 10) overflows 1 into 1 [ticket] (Reject, max_amount 5, balance 5).
	var items: Array[CoreContract.ItemAmount] = [item_amount(id_of("[potion]"), 1), item_amount(id_of("[badge_coin]"), 11)]
	assert_eq(preview(items), PackedStringArray(["[potion]:MAILED:0/:0/[]", "[badge_coin]:MAILED:0/:0/[]"]))


func test_a_listed_item_and_a_replacement_share_one_balance() -> void:
	await start()
	put_balance(id_of("[shard]"), 10)
	put_balance(id_of("[dust]"), 40)
	var items: Array[CoreContract.ItemAmount] = [item_amount(id_of("[shard]"), 4), item_amount(id_of("[dust]"), 5)]
	# [dust] gets 5 first (45); the 8 [dust] of the 4 [shard] over max_amount then fit 5 of 8.
	assert_eq(preview(items), PackedStringArray(["[shard]:DISCARDED:0/:4/[[dust]:5/:3/]", "[dust]:APPLIED:5/:0/[]"]))


func test_a_recovery_item_previews_with_its_recovered_balance() -> void:
	await start(T0)
	var item: int = id_of("[user_state_recovery]")
	put_balance(item, 2, T0)
	sync_to(T0 + 10 * 60000)
	assert_eq(UserStateCore.get_item_balance(item), 5)
	# max_amount 100, Discard: 5 + 96 keeps 95.
	assert_eq(preview(one("[user_state_recovery]", 96)), PackedStringArray(["[user_state_recovery]:DISCARDED:95/:1/[]"]))


func test_a_convert_overflow_past_2_53_goes_to_the_big_field() -> void:
	await start()
	put_balance(id_of("[shard]"), 10)
	var rows: Array[ItemAddPreviewRow] = UserStateCore.preview_item_add(one("[shard]", MAX_SAFE))
	assert_eq(rows.size(), 1)
	assert_eq(rows[0].outcome, UserStateCore.ItemAddPreview.DISCARDED)
	assert_eq([rows[0].applied, rows[0].big_applied, rows[0].overflow, rows[0].big_overflow], [0, "", MAX_SAFE, ""])
	assert_eq(rows[0].replacements.size(), 1)
	var dust: ItemAddPreviewReplacement = rows[0].replacements[0]
	assert_eq(dust.item_id, id_of("[dust]"))
	assert_eq(dust.applied, 50, "the max_amount of [dust]")
	assert_eq(dust.overflow, 0)
	# 2 × (2^53−1) − 50
	assert_eq(dust.big_overflow, "18014398509481932")


func test_one_preview_computes_with_one_server_time() -> void:
	await start(T0)
	var item: int = id_of("[boost_reject]")
	var ends_at: int = T0 + 3600000
	put_balance(item, 0, 0, ends_at)
	sync_to(ends_at - 1)
	# Every server time read moves the clock by 2 ms: a second read would see ends_at + 1 and a remaining time of −1.
	TimeCoreDev.set_test_clock_read_step(2)
	var rows: PackedStringArray = preview(one("[boost_reject]", 3))
	TimeCoreDev.set_test_clock_read_step(0)
	# max_amount 3 of 1h, Reject: 1 ms left + 3h is over 3h, so the grant is mailed.
	assert_eq(rows, PackedStringArray(["[boost_reject]:MAILED:0/:0/[]"]))


func test_input_check_failures_give_no_rows() -> void:
	await start()
	assert_eq(preview(one("[gem]", 1)).size(), 0, "a group item")
	assert_eq(errors(), 1)
	assert_eq(preview(one("[gold]", 0, "9007199254740992")).size(), 0, "more than 2^53−1 of an item that is not big")
	assert_eq(errors(), 1)
	assert_eq(preview(one("[gold]", 0)).size(), 0, "amount 0")
	assert_eq(errors(), 1)
	assert_eq(preview(one("[gold]", 1, "1e3")).size(), 0, "big_amount is not a big integer")
	assert_eq(errors(), 1)
	assert_eq(preview([item_amount(123456789, 1)] as Array[CoreContract.ItemAmount]).size(), 0, "not in the item table")
	assert_eq(errors(), 1)
	assert_eq(preview([item_amount(id_of("[gold]"), 1), item_amount(id_of("[gold]"), 2)] as Array[CoreContract.ItemAmount]).size(), 0, "twice")
	assert_eq(errors(), 1)
	assert_eq(preview(one("[big_gold]", 0, "100000000000000000000")).size(), 0, "over 10^max_digits − 1 of a big item")
	assert_eq(errors(), 1)
	assert_eq(preview(one("[big_gold]", 0, "99999999999999999999")).size(), 1, "10^max_digits − 1 of a big item")


func test_preview_changes_nothing() -> void:
	await start()
	put_balance(id_of("[potion]"), 8)
	var number: int = UserStateCore.get_change_number(CoreContract.ItemBalanceUserState)
	changed = PackedStringArray()
	assert_eq(preview(one("[potion]", 5)).size(), 1)
	assert_eq(UserStateCore.get_item_balance(id_of("[potion]")), 8)
	assert_eq(UserStateCore.get_change_number(CoreContract.ItemBalanceUserState), number)
	assert_eq(changed.size(), 0)


## Core test fixture `item-timed`: the timed item, its stored `ends_at`, the server time and the amount to add, and
## the expected result, `delta` and `overflow` of the server `add_items`.
func test_core_fixture_item_timed() -> void:
	await start()
	assert_gt(_run_timed_fixture(), 0, "cases")


## Core test fixture `item-big`: the big item, its stored balance and the amount to add, and the expected
## `ItemAddPreview` element, `applied` and `overflow`.
func test_core_fixture_item_big() -> void:
	await start()
	assert_gt(_run_big_fixture(), 0, "cases")


# ogw:input_boundary
func _run_timed_fixture() -> int:
	var cases: PackedStringArray = fixture_cases("item-timed")
	for text: String in cases:
		var case: Dictionary = JSON.parse_string(text)
		var input: Dictionary = case["input"]
		var expected: Dictionary = case["expected"]
		var case_name: String = case["name"]
		var item: int = id_of(str(input["item"]))
		var full: CoreContract.UserStateDelta = new_delta(true)
		var ends_at: int = json_int(input["ends_at"])
		if ends_at != 0:
			var state: CoreContract.ItemBalanceUserState = CoreContract.ItemBalanceUserState.new()
			state.id = item
			state.ends_at = ends_at
			add_upsert(full, "ItemBalanceUserState", item, state)
		assert_true(UserStateCoreDev.apply_test_delta(full), case_name)
		sync_to(json_int(input["time"]))
		var rows: Array[ItemAddPreviewRow] = UserStateCore.preview_item_add([item_amount(item, json_int(input["amount"]))] as Array[CoreContract.ItemAmount])
		assert_eq(rows.size(), 1, case_name)
		if rows.size() != 1:
			continue
		var row: ItemAddPreviewRow = rows[0]
		var delta: int = json_int(expected["delta"])
		var overflow: int = json_int(expected["overflow"])
		var outcome: UserStateCore.ItemAddPreview = UserStateCore.ItemAddPreview.APPLIED
		if str(expected["result"]) == "LIMIT_EXCEEDED":
			outcome = UserStateCore.ItemAddPreview.MAILED
		elif overflow > 0:
			outcome = UserStateCore.ItemAddPreview.DISCARDED
		assert_eq(row.outcome, outcome, case_name + ": outcome")
		assert_eq([row.applied, row.big_applied], [delta, ""], case_name + ": applied")
		assert_eq([row.overflow, row.big_overflow], [overflow, ""], case_name + ": overflow")
	return cases.size()


# ogw:input_boundary
func _run_big_fixture() -> int:
	var cases: PackedStringArray = fixture_cases("item-big")
	for text: String in cases:
		var case: Dictionary = JSON.parse_string(text)
		var input: Dictionary = case["input"]
		var expected: Dictionary = case["expected"]
		var case_name: String = case["name"]
		var item: int = id_of(str(input["item"]))
		var full: CoreContract.UserStateDelta = new_delta(true)
		var balance: String = str(input["balance"])
		if balance != "0":
			var state: CoreContract.ItemBalanceUserState = CoreContract.ItemBalanceUserState.new()
			state.id = item
			_put_pair(state, balance)
			add_upsert(full, "ItemBalanceUserState", item, state)
		assert_true(UserStateCoreDev.apply_test_delta(full), case_name)
		assert_eq(UserStateCore.get_item_big_balance(item), balance, case_name + ": balance")
		var amount: CoreContract.ItemAmount = item_amount(item, 0)
		var amount_text: String = str(input["amount"])
		if _fits_small(amount_text):
			amount.amount = amount_text.to_int()
		else:
			amount.big_amount = amount_text
		var rows: Array[ItemAddPreviewRow] = UserStateCore.preview_item_add([amount] as Array[CoreContract.ItemAmount])
		assert_eq(rows.size(), 1, case_name)
		if rows.size() != 1:
			continue
		var row: ItemAddPreviewRow = rows[0]
		var outcome_name: String = UserStateCore.ItemAddPreview.keys()[row.outcome]
		assert_eq(outcome_name, str(expected["outcome"]).to_upper(), case_name + ": outcome")
		assert_eq(_value_of(row.applied, row.big_applied), str(expected["applied"]), case_name + ": applied")
		assert_eq(_value_of(row.overflow, row.big_overflow), str(expected["overflow"]), case_name + ": overflow")
	return cases.size()


## Puts a big integer into the `amount`, `big_amount` pair of a balance object.
func _put_pair(state: CoreContract.ItemBalanceUserState, value: String) -> void:
	if _fits_small(value):
		state.amount = value.to_int()
	else:
		state.big_amount = value


## Whether a non-negative big integer is at most 2^53−1, the `amount` side of the contract big encoding pair.
func _fits_small(value: String) -> bool:
	return value.length() < MAX_SAFE_TEXT.length() or (value.length() == MAX_SAFE_TEXT.length() and value <= MAX_SAFE_TEXT)


func _value_of(small: int, big: String) -> String:
	return big if big != "" else str(small)
