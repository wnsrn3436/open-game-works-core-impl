extends "res://core/user_state_core/tests/support/user_state_test_case.gd"
## Item balances: plain, recovery, group, timed and big items, and the core test fixture `item-recovery`.
## `TimeCore.reachMarginMs` is not 0 here: the recovery and timed item calculations do not use it.

const MINUTE: int = 60000
const T0: int = 1720000000000


func test_a_plain_item_balance_comes_from_its_object() -> void:
	await start()
	var gold: int = id_of("[gold]")
	assert_eq(UserStateCore.get_item_balance(gold), 0, "no object")
	put_balance(gold, 1234)
	assert_eq(UserStateCore.get_item_balance(gold), 1234)


func test_a_recovery_item_recovers_at_each_interval_up_to_the_cap() -> void:
	await start(T0)
	var item: int = id_of("[user_state_recovery]")
	put_balance(item, 2, T0)
	sync_to(T0 + 59999)
	assert_eq(UserStateCore.get_item_balance(item), 2)
	sync_to(T0 + 60000)
	assert_eq(UserStateCore.get_item_balance(item), 3)
	var recovery: GetItemRecoveryResult = UserStateCore.get_item_recovery(item)
	assert_eq([recovery.next_at, recovery.cap_at], [T0 + 120000, T0 + 180000])
	sync_to(T0 + 600000)
	assert_eq(UserStateCore.get_item_balance(item), 5)
	recovery = UserStateCore.get_item_recovery(item)
	assert_eq([recovery.next_at, recovery.cap_at], [0, 0], "at the cap")


func test_the_cap_bonus_item_raises_the_cap() -> void:
	await start(T0)
	var item: int = id_of("[user_state_bonus_recovery]")
	var bonus: int = id_of("[user_state_bonus]")
	put_balance(bonus, 2)
	put_balance(item, 4, T0)
	sync_to(T0 + 2 * MINUTE)
	assert_eq(UserStateCore.get_item_balance(item), 6)
	sync_to(T0 + 3 * MINUTE)
	assert_eq(UserStateCore.get_item_balance(item), 7, "recovery_cap 5 + bonus 2")
	var recovery: GetItemRecoveryResult = UserStateCore.get_item_recovery(item)
	assert_eq([recovery.next_at, recovery.cap_at], [0, 0])
	put_balance(bonus, 3)
	assert_eq(UserStateCore.get_item_balance(item), 7)
	recovery = UserStateCore.get_item_recovery(item)
	assert_eq([recovery.next_at, recovery.cap_at], [T0 + 4 * MINUTE, T0 + 4 * MINUTE], "C is 8")
	sync_to(T0 + 30 * MINUTE)
	assert_eq(UserStateCore.get_item_balance(item), 8)


func test_a_recovery_item_without_an_object_starts_from_initial_amount() -> void:
	await start(0)
	var energy: int = id_of("[energy]")
	var full: int = id_of("[user_state_recovery]")
	UserStateCore.set_user_created_at(T0)
	assert_eq(UserStateCore.get_item_balance(energy), 0, "initial_amount before the first sync")
	assert_eq(UserStateCore.get_item_recovery(energy).next_at, 0)
	sync_to(T0 + 5 * MINUTE)
	assert_eq(UserStateCore.get_item_balance(energy), 2, "recovers from the user creation time")
	var recovery: GetItemRecoveryResult = UserStateCore.get_item_recovery(energy)
	assert_eq([recovery.next_at, recovery.cap_at], [T0 + 10 * MINUTE, T0 + 25 * MINUTE])
	assert_eq(UserStateCore.get_item_balance(full), 5, "initial_amount at the cap does not recover")
	UserStateCore.release()
	assert_true(UserStateCore.init())
	assert_eq(UserStateCore.get_item_balance(energy), 0, "no user creation time: no recovery")


func test_recovery_alone_changes_nothing_in_the_cache() -> void:
	await start(T0)
	var item: int = id_of("[user_state_recovery]")
	put_balance(item, 1, T0)
	var number: int = UserStateCore.get_change_number(CoreContract.ItemBalanceUserState)
	changed = PackedStringArray()
	sync_to(T0 + 3 * MINUTE)
	assert_eq(UserStateCore.get_item_balance(item), 4)
	assert_eq(changed.size(), 0)
	assert_eq(UserStateCore.get_change_number(CoreContract.ItemBalanceUserState), number)
	var state := UserStateCore.get_by_id(CoreContract.ItemBalanceUserState, item) as CoreContract.ItemBalanceUserState
	assert_eq(state.amount, 1, "the stored amount stays")


func test_a_group_item_is_the_sum_of_its_members() -> void:
	await start()
	put_balance(id_of("[gem_paid]"), 3)
	put_balance(id_of("[gem_free]"), 4)
	assert_eq(UserStateCore.get_item_balance(id_of("[gem]")), 7)
	assert_eq(UserStateCore.get_item_big_balance(id_of("[gem]")), "7")


func test_a_timed_item_ends_at_its_end_time_without_an_event() -> void:
	var ends_at: int = T0 + 3600000
	await start(T0)
	var boost: int = id_of("[boost_reject]")
	put_balance(boost, 0, 0, ends_at)
	changed = PackedStringArray()
	sync_to(ends_at - 1)
	assert_eq(UserStateCore.get_item_balance(boost), 1)
	assert_eq(UserStateCore.get_item_ends_at(boost), ends_at)
	sync_to(ends_at)
	assert_eq(UserStateCore.get_item_balance(boost), 0)
	assert_eq(UserStateCore.get_item_ends_at(boost), 0)
	assert_eq(changed.size(), 0)
	assert_eq(UserStateCore.get_item_ends_at(id_of("[gold]")), 0, "not a timed item")


func test_a_timed_item_before_the_first_sync_has_no_effect() -> void:
	await start(0)
	var boost: int = id_of("[boost_reject]")
	put_balance(boost, 0, 0, T0)
	assert_eq(UserStateCore.get_item_balance(boost), 0)
	assert_eq(UserStateCore.get_item_ends_at(boost), 0)


func test_big_balances() -> void:
	await start()
	var big: int = id_of("[big_gold]")
	put_balance(big, 0, 0, 0, "12345678901234567890")
	assert_eq(UserStateCore.get_item_big_balance(big), "12345678901234567890")
	assert_eq(UserStateCore.get_item_balance(big), MAX_SAFE)
	put_balance(big, 77)
	assert_eq(UserStateCore.get_item_big_balance(big), "77")
	assert_eq(UserStateCore.get_item_balance(big), 77)
	var gold: int = id_of("[gold]")
	put_balance(gold, 4500)
	assert_eq(UserStateCore.get_item_big_balance(gold), "4500", "not a big item")
	assert_eq(UserStateCore.get_item_big_balance(id_of("[potion]")), "0")


## Core test fixture `item-recovery`: the recovery item, its `cap_bonus_item` balance, the stored A and S, the server
## time, and the expected balance and `get_item_recovery`.
func test_core_fixture_item_recovery() -> void:
	await start()
	assert_gt(_run_recovery_fixture(), 0, "cases")


# ogw:input_boundary
func _run_recovery_fixture() -> int:
	var cases: PackedStringArray = fixture_cases("item-recovery")
	for text: String in cases:
		var case: Dictionary = JSON.parse_string(text)
		var input: Dictionary = case["input"]
		var expected: Dictionary = case["expected"]
		var case_name: String = case["name"]
		var item: int = id_of(str(input["item"]))
		var recovery: GameData.ItemRecoveryRow = GameData.ItemRecoveryTable.get_row(item)
		var full: CoreContract.UserStateDelta = new_delta(true)
		var state: CoreContract.ItemBalanceUserState = CoreContract.ItemBalanceUserState.new()
		state.id = item
		state.amount = json_int(input["amount"])
		state.recovery_started_at = json_int(input["recovery_started_at"])
		var bonus_balance: int = json_int(input["cap_bonus_balance"])
		if recovery.cap_bonus_item != 0 and bonus_balance > 0:
			var bonus: CoreContract.ItemBalanceUserState = CoreContract.ItemBalanceUserState.new()
			bonus.id = recovery.cap_bonus_item
			bonus.amount = bonus_balance
			add_upsert(full, "ItemBalanceUserState", bonus.id, bonus)
		add_upsert(full, "ItemBalanceUserState", item, state)
		assert_true(UserStateCoreDev.apply_test_delta(full), case_name)
		sync_to(json_int(input["time"]))
		assert_eq(UserStateCore.get_item_balance(item), json_int(expected["balance"]), case_name + ": balance")
		var times: GetItemRecoveryResult = UserStateCore.get_item_recovery(item)
		assert_eq(times.next_at, json_int(expected["next_recovery_at"]), case_name + ": next recovery")
		assert_eq(times.cap_at, json_int(expected["cap_reached_at"]), case_name + ": cap")
	return cases.size()
