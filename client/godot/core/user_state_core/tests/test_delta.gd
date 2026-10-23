extends "res://core/user_state_core/tests/support/user_state_test_case.gd"
## Delta apply: upserts, deletes, in-place copies, skipped entries, change numbers, `UserStateChangedEvent` and
## deltas that break the contract.

const TUTORIAL: String = "TutorialProgressUserState"
const MAIL: String = "MailUserState"

var restarts: int = 0
## `<kind> tutorial=<count> mail=<count>` at each `UserStateChangedEvent`.
var seen: PackedStringArray = PackedStringArray()


func _on_user_state_changed(event: UserStateChangedEvent) -> void:
	super(event)
	seen.append("%s tutorial=%d mail=%d" % [kind_name_of(event.kind), UserStateCore.count(CoreContract.TutorialProgressUserState), UserStateCore.count(CoreContract.MailUserState)])


func _on_restart_requested(_event: RestartRequestedEvent) -> void:
	restarts += 1


func start_with_restarts() -> void:
	await start()
	restarts = 0
	assert_true(EventCore.subscribe(RestartRequestedEvent, _on_restart_requested))


func test_upserts_and_a_delete_leave_the_server_values() -> void:
	await start()
	var first: CoreContract.UserStateDelta = new_delta()
	add_tutorial(first, 2, 1)
	add_tutorial(first, 3, 1)
	assert_true(UserStateCore.apply_delta(first, UserStateCore.DeltaSource.RESPONSE))
	var delta: CoreContract.UserStateDelta = new_delta()
	add_tutorial(delta, 1, 4)
	add_tutorial(delta, 2, 5)
	add_delete(delta, TUTORIAL, 3)
	assert_true(UserStateCore.apply_delta(delta, UserStateCore.DeltaSource.RESPONSE))
	assert_eq(get_tutorial(1).step, 4, "upsert of a missing object")
	assert_eq(get_tutorial(2).step, 5, "upsert of a present object")
	assert_null(get_tutorial(3), "deleted")
	assert_eq(UserStateCore.count(CoreContract.TutorialProgressUserState), 2)


func test_an_upsert_copies_into_the_same_object() -> void:
	await start()
	var first: CoreContract.UserStateDelta = new_delta()
	add_tutorial(first, 1, 1)
	assert_true(UserStateCore.apply_delta(first, UserStateCore.DeltaSource.RESPONSE))
	var before: CoreContract.TutorialProgressUserState = get_tutorial(1)
	var second: CoreContract.UserStateDelta = new_delta()
	add_tutorial(second, 1, 9)
	assert_true(UserStateCore.apply_delta(second, UserStateCore.DeltaSource.PENDING))
	assert_same(get_tutorial(1), before)
	assert_eq(before.step, 9)


func test_two_entries_of_one_kind_and_id_apply_nothing() -> void:
	await start_with_restarts()
	var first: CoreContract.UserStateDelta = new_delta()
	add_tutorial(first, 1, 1)
	assert_true(UserStateCore.apply_delta(first, UserStateCore.DeltaSource.RESPONSE))
	var number: int = UserStateCore.get_change_number(CoreContract.TutorialProgressUserState)
	changed = PackedStringArray()
	var delta: CoreContract.UserStateDelta = new_delta()
	add_tutorial(delta, 1, 7)
	add_tutorial(delta, 2, 7)
	add_delete(delta, TUTORIAL, 2)
	assert_false(UserStateCore.apply_delta(delta, UserStateCore.DeltaSource.RESPONSE))
	assert_eq(get_tutorial(1).step, 1, "nothing applied")
	assert_null(get_tutorial(2))
	assert_eq(UserStateCore.get_change_number(CoreContract.TutorialProgressUserState), number)
	assert_eq(changed.size(), 0)
	assert_eq(errors(), 1)
	assert_eq(restarts, 1)


func test_a_delta_against_the_contract_changes_nothing() -> void:
	await start_with_restarts()
	var first: CoreContract.UserStateDelta = new_delta()
	add_tutorial(first, 1, 1)
	assert_true(UserStateCore.apply_delta(first, UserStateCore.DeltaSource.RESPONSE))
	var number: int = UserStateCore.get_change_number(CoreContract.TutorialProgressUserState)
	var broken: CoreContract.UserStateDelta = new_delta()
	add_tutorial(broken, 2, 3)
	var entry: CoreContract.UserStateEntry = CoreContract.UserStateEntry.new()
	entry.kind = TUTORIAL
	entry.id = 4
	entry.value = PackedByteArray([0xff, 0xff, 0xff])
	broken.entries.append(entry)
	changed = PackedStringArray()
	assert_false(UserStateCore.apply_delta(broken, UserStateCore.DeltaSource.RESPONSE))
	assert_null(get_tutorial(2), "the entry before the broken one is not applied either")
	assert_eq(UserStateCore.count(CoreContract.TutorialProgressUserState), 1)
	assert_eq(UserStateCore.get_change_number(CoreContract.TutorialProgressUserState), number)
	assert_eq(changed.size(), 0)
	assert_eq(errors(), 1)
	assert_eq(restarts, 1)
	# An applied delta returns true.
	var good: CoreContract.UserStateDelta = new_delta()
	add_tutorial(good, 2, 3)
	assert_true(UserStateCore.apply_delta(good, UserStateCore.DeltaSource.RESPONSE))
	assert_eq(restarts, 1)


func test_an_entry_of_an_unknown_kind_is_skipped_with_a_warn() -> void:
	await start()
	var delta: CoreContract.UserStateDelta = new_delta()
	var unknown: CoreContract.UserStateEntry = CoreContract.UserStateEntry.new()
	unknown.kind = "FutureUserState"
	unknown.id = 1
	unknown.value = PackedByteArray([0xff])
	delta.entries.append(unknown)
	add_tutorial(delta, 1, 2)
	assert_true(UserStateCore.apply_delta(delta, UserStateCore.DeltaSource.RESPONSE))
	assert_eq(get_tutorial(1).step, 2)
	assert_eq(warns(), 1)
	assert_eq(changed, PackedStringArray(["TutorialProgressUserState|0|1|"]))


func test_a_delete_of_a_missing_object_is_skipped_quietly() -> void:
	await start()
	var only: CoreContract.UserStateDelta = new_delta()
	add_delete(only, TUTORIAL, 5)
	assert_true(UserStateCore.apply_delta(only, UserStateCore.DeltaSource.RESPONSE))
	assert_eq(UserStateCore.get_change_number(CoreContract.TutorialProgressUserState), 0)
	assert_eq(changed.size(), 0, "no event")
	assert_eq(warns(), 0)
	# With an applied entry of the same kind, the skipped id is not in the deleted list.
	var first: CoreContract.UserStateDelta = new_delta()
	add_tutorial(first, 1, 1)
	assert_true(UserStateCore.apply_delta(first, UserStateCore.DeltaSource.RESPONSE))
	changed = PackedStringArray()
	var mixed: CoreContract.UserStateDelta = new_delta()
	add_tutorial(mixed, 2, 1)
	add_delete(mixed, TUTORIAL, 1)
	add_delete(mixed, TUTORIAL, 5)
	assert_true(UserStateCore.apply_delta(mixed, UserStateCore.DeltaSource.PENDING))
	assert_eq(changed, PackedStringArray(["TutorialProgressUserState|1|2|1"]))
	assert_eq(UserStateCore.get_change_number(CoreContract.TutorialProgressUserState), 3)
	assert_eq(warns(), 0, "upserts and deletes log nothing")


func test_an_object_put_again_after_a_delete_is_a_new_object() -> void:
	await start()
	var first: CoreContract.UserStateDelta = new_delta()
	add_tutorial(first, 1, 1)
	assert_true(UserStateCore.apply_delta(first, UserStateCore.DeltaSource.RESPONSE))
	var removed: CoreContract.TutorialProgressUserState = get_tutorial(1)
	var delete: CoreContract.UserStateDelta = new_delta()
	add_delete(delete, TUTORIAL, 1)
	assert_true(UserStateCore.apply_delta(delete, UserStateCore.DeltaSource.RESPONSE))
	var again: CoreContract.UserStateDelta = new_delta()
	add_tutorial(again, 1, 8)
	assert_true(UserStateCore.apply_delta(again, UserStateCore.DeltaSource.RESPONSE))
	var later: CoreContract.UserStateDelta = new_delta()
	add_tutorial(later, 1, 9)
	assert_true(UserStateCore.apply_delta(later, UserStateCore.DeltaSource.RESPONSE))
	assert_ne(get_tutorial(1), removed)
	assert_eq(get_tutorial(1).step, 9)
	assert_eq(removed.step, 1, "the deleted object does not change")


func test_a_delete_of_a_single_kind() -> void:
	await start()
	var nickname: CoreContract.NicknameUserState = CoreContract.NicknameUserState.new()
	nickname.nickname = "first"
	var put: CoreContract.UserStateDelta = new_delta()
	add_upsert(put, "NicknameUserState", 0, nickname)
	assert_true(UserStateCore.apply_delta(put, UserStateCore.DeltaSource.RESPONSE))
	assert_eq((UserStateCore.get_single(CoreContract.NicknameUserState) as CoreContract.NicknameUserState).nickname, "first")
	var number: int = UserStateCore.get_change_number(CoreContract.NicknameUserState)
	changed = PackedStringArray()
	var delete: CoreContract.UserStateDelta = new_delta()
	add_delete(delete, "NicknameUserState", 0)
	assert_true(UserStateCore.apply_delta(delete, UserStateCore.DeltaSource.RESPONSE))
	assert_null(UserStateCore.get_single(CoreContract.NicknameUserState))
	assert_eq(UserStateCore.get_change_number(CoreContract.NicknameUserState), number + 1)
	assert_eq(changed, PackedStringArray(["NicknameUserState|0||"]))


func test_one_event_per_kind_with_applied_entries() -> void:
	await start()
	var delta: CoreContract.UserStateDelta = new_delta()
	put_balance(id_of("[gold]"), 1)
	changed = PackedStringArray()
	add_tutorial(delta, 1, 1)
	add_tutorial(delta, 2, 1)
	add_tutorial(delta, 3, 1)
	add_delete(delta, "ItemBalanceUserState", id_of("[potion]"))
	assert_true(UserStateCore.apply_delta(delta, UserStateCore.DeltaSource.PENDING))
	assert_eq(changed, PackedStringArray(["TutorialProgressUserState|1|1,2,3|"]))
	assert_eq(changes_of("ItemBalanceUserState").size(), 0, "no event for a kind with no applied entry")


func test_change_numbers_count_applied_entries() -> void:
	await start()
	assert_eq(UserStateCore.get_change_number(CoreContract.TutorialProgressUserState), 0)
	var delta: CoreContract.UserStateDelta = new_delta()
	add_tutorial(delta, 1, 1)
	add_tutorial(delta, 2, 1)
	add_delete(delta, TUTORIAL, 9)
	var unknown: CoreContract.UserStateEntry = CoreContract.UserStateEntry.new()
	unknown.kind = "FutureUserState"
	delta.entries.append(unknown)
	assert_true(UserStateCore.apply_delta(delta, UserStateCore.DeltaSource.RESPONSE))
	assert_eq(UserStateCore.get_change_number(CoreContract.TutorialProgressUserState), 2)
	assert_eq(UserStateCore.get_change_number(CoreContract.MailUserState), 0)
	assert_eq(warns(), 1)
	var again: CoreContract.UserStateDelta = new_delta()
	add_tutorial(again, 1, 2)
	add_delete(again, TUTORIAL, 2)
	assert_true(UserStateCore.apply_delta(again, UserStateCore.DeltaSource.RESPONSE))
	assert_eq(UserStateCore.get_change_number(CoreContract.TutorialProgressUserState), 4)


func test_the_event_comes_after_the_whole_delta() -> void:
	await start()
	seen = PackedStringArray()
	var delta: CoreContract.UserStateDelta = new_delta()
	var mail: CoreContract.MailUserState = CoreContract.MailUserState.new()
	mail.id = 5
	add_upsert(delta, MAIL, 5, mail)
	add_tutorial(delta, 1, 1)
	assert_true(UserStateCore.apply_delta(delta, UserStateCore.DeltaSource.RESPONSE))
	assert_eq(seen.size(), 2)
	for text: String in seen:
		assert_string_ends_with(text, "tutorial=1 mail=1")


func test_a_full_delta_keeps_only_its_upserts() -> void:
	await start()
	var first: CoreContract.UserStateDelta = new_delta()
	add_tutorial(first, 1, 1)
	add_tutorial(first, 2, 1)
	var mail: CoreContract.MailUserState = CoreContract.MailUserState.new()
	mail.id = 7
	add_upsert(first, MAIL, 7, mail)
	var nickname: CoreContract.NicknameUserState = CoreContract.NicknameUserState.new()
	add_upsert(first, "NicknameUserState", 0, nickname)
	assert_true(UserStateCore.apply_delta(first, UserStateCore.DeltaSource.RESPONSE))
	var kept: CoreContract.TutorialProgressUserState = get_tutorial(1)
	changed = PackedStringArray()
	var full: CoreContract.UserStateDelta = new_delta(true)
	add_upsert(full, "ItemBalanceUserState", id_of("[gold]"), CoreContract.ItemBalanceUserState.new())
	add_tutorial(full, 1, 6)
	add_tutorial(full, 3, 6)
	assert_true(UserStateCore.apply_delta(full, UserStateCore.DeltaSource.RESPONSE))
	assert_same(get_tutorial(1), kept, "a kept id keeps its object")
	assert_eq(kept.step, 6)
	assert_null(get_tutorial(2))
	assert_not_null(get_tutorial(3))
	assert_eq(UserStateCore.count(CoreContract.MailUserState), 0)
	assert_null(UserStateCore.get_single(CoreContract.NicknameUserState))
	assert_eq(UserStateCore.count(CoreContract.ItemBalanceUserState), 1)
	var texts: PackedStringArray = changed.duplicate()
	texts.sort()
	var item: String = "ItemBalanceUserState|0|%d|" % id_of("[gold]")
	var expected: PackedStringArray = PackedStringArray(["MailUserState|0||7", "NicknameUserState|0||", "TutorialProgressUserState|0|1,3|2", item])
	expected.sort()
	assert_eq(texts, expected)


func test_get_and_list_check_the_kind() -> void:
	await start()
	var delta: CoreContract.UserStateDelta = new_delta()
	add_tutorial(delta, 1, 1)
	add_tutorial(delta, 2, 2)
	assert_true(UserStateCore.apply_delta(delta, UserStateCore.DeltaSource.RESPONSE))
	var buffer: Array[ContractMessage] = []
	buffer.resize(4)
	assert_eq(UserStateCore.list(CoreContract.TutorialProgressUserState, buffer), 2)
	var steps: Array[int] = []
	for i: int in 2:
		steps.append((buffer[i] as CoreContract.TutorialProgressUserState).step)
	steps.sort()
	assert_eq(steps, [1, 2] as Array[int])
	assert_null(UserStateCore.get_by_id(CoreContract.TutorialProgressUserState, 9), "no object, no log")
	assert_null(UserStateCore.get_by_id(CoreContract.NicknameUserState, 0))
	assert_eq(errors(), 1, "get of a single kind")
	assert_null(UserStateCore.get_single(CoreContract.TutorialProgressUserState))
	assert_eq(errors(), 1, "get_single of a list kind")
	assert_eq(UserStateCore.list(CoreContract.NicknameUserState, buffer), 0)
	assert_eq(errors(), 1, "list of a single kind")
	var small: Array[ContractMessage] = []
	small.resize(1)
	assert_eq(UserStateCore.list(CoreContract.TutorialProgressUserState, small), 1)
	assert_eq(small.size(), 1, "the buffer keeps its size")
	assert_eq(errors(), 1, "the objects do not fit")
