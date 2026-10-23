extends "res://core/user_state_core/tests/support/user_state_test_case.gd"
## The `after_update` hook, `ItemChangedEvent`, `ItemMailedEvent` and the user creation time.

const TUTORIAL: String = "TutorialProgressUserState"

const _HOOKS := preload("res://core/user_state_core/tests/support/hook_recorder.gd")


func _instance_hook(_state: ContractMessage) -> void:
	_HOOKS.calls.append("instance")


func before_each() -> void:
	super()
	_HOOKS.calls = PackedStringArray()


func test_after_update_runs_right_after_each_upsert() -> void:
	await start()
	assert_true(UserStateCore.register_after_update(CoreContract.TutorialProgressUserState, _HOOKS.after_tutorial))
	var first: CoreContract.UserStateDelta = new_delta()
	add_tutorial(first, 9, 1)
	assert_true(UserStateCore.apply_delta(first, UserStateCore.DeltaSource.RESPONSE))
	_HOOKS.calls = PackedStringArray()
	var delta: CoreContract.UserStateDelta = new_delta()
	add_tutorial(delta, 1, 5)
	add_tutorial(delta, 2, 6)
	add_delete(delta, TUTORIAL, 9)
	add_delete(delta, TUTORIAL, 10)
	var unknown: CoreContract.UserStateEntry = CoreContract.UserStateEntry.new()
	unknown.kind = "FutureUserState"
	delta.entries.append(unknown)
	assert_true(UserStateCore.apply_delta(delta, UserStateCore.DeltaSource.RESPONSE))
	# Change number 1 came from the first delta. Object 9 is still there when 1 and 2 are applied.
	assert_eq(_HOOKS.calls, PackedStringArray(["1:5:2:2", "2:6:3:3"]))
	assert_eq(warns(), 1)


func test_after_update_gets_the_cached_object() -> void:
	await start()
	assert_true(UserStateCore.register_after_update(CoreContract.TutorialProgressUserState, _HOOKS.after_tutorial))
	var first: CoreContract.UserStateDelta = new_delta()
	add_tutorial(first, 1, 1)
	assert_true(UserStateCore.apply_delta(first, UserStateCore.DeltaSource.RESPONSE))
	var again: CoreContract.UserStateDelta = new_delta()
	add_tutorial(again, 1, 2)
	assert_true(UserStateCore.apply_delta(again, UserStateCore.DeltaSource.RESPONSE))
	assert_eq(_HOOKS.calls, PackedStringArray(["1:1:1:1", "1:2:2:1"]))


func test_after_update_that_throws_logs_an_error_and_the_delta_goes_on() -> void:
	await start()
	assert_true(UserStateCore.register_after_update(CoreContract.TutorialProgressUserState, _HOOKS.throwing_for_one))
	var delta: CoreContract.UserStateDelta = new_delta()
	add_tutorial(delta, 1, 5)
	add_tutorial(delta, 2, 6)
	assert_true(UserStateCore.apply_delta(delta, UserStateCore.DeltaSource.RESPONSE))
	assert_eq(UnitTestCore.check_script_errors(), 1, "the hook threw for object 1")
	assert_eq(errors(), 1)
	assert_eq(_HOOKS.calls, PackedStringArray(["throw:1", "2"]), "the hook is called for the next upsert")
	assert_eq(UserStateCore.count(CoreContract.TutorialProgressUserState), 2, "the whole delta is applied")
	var again: CoreContract.UserStateDelta = new_delta()
	add_tutorial(again, 1, 7)
	assert_true(UserStateCore.apply_delta(again, UserStateCore.DeltaSource.RESPONSE))
	assert_eq(UnitTestCore.check_script_errors(), 1, "the next upsert called the hook again")
	assert_eq(errors(), 1)


func test_register_after_update_refuses_bad_hooks() -> void:
	await start()
	assert_false(UserStateCore.register_after_update(CoreContract.TutorialProgressUserState, _instance_hook))
	assert_eq(errors(), 1, "an instance method")
	var lambda: Callable = func(_state: ContractMessage) -> void: pass
	assert_false(UserStateCore.register_after_update(CoreContract.TutorialProgressUserState, lambda))
	assert_eq(errors(), 1, "a lambda")
	assert_false(UserStateCore.register_after_update(CoreContract.UserStateDelta, _HOOKS.after_tutorial))
	assert_eq(errors(), 1, "not a kind")
	assert_true(UserStateCore.register_after_update(CoreContract.TutorialProgressUserState, _HOOKS.after_tutorial))
	assert_false(UserStateCore.register_after_update(CoreContract.TutorialProgressUserState, _HOOKS.other))
	assert_eq(errors(), 1, "a second hook")
	var delta: CoreContract.UserStateDelta = new_delta()
	add_tutorial(delta, 1, 1)
	assert_true(UserStateCore.apply_delta(delta, UserStateCore.DeltaSource.RESPONSE))
	assert_eq(_HOOKS.calls, PackedStringArray(["1:1:1:1"]), "the first hook stays")


func test_item_events_carry_the_lists_in_order() -> void:
	await start()
	var changes: Array[CoreContract.ItemChange] = []
	for item_id: int in [3, 1, 2]:
		var change: CoreContract.ItemChange = CoreContract.ItemChange.new()
		change.item_id = item_id
		change.delta = item_id * 10
		changes.append(change)
	UserStateCore.notify_item_changes(changes)
	UserStateCore.notify_item_changes([] as Array[CoreContract.ItemChange])
	assert_eq(item_change_events, 1)
	var got: Array[int] = []
	for change: CoreContract.ItemChange in item_changes:
		got.append(change.item_id)
	assert_eq(got, [3, 1, 2] as Array[int])
	var mails: Array[CoreContract.ItemMail] = []
	for mail_id: int in [8, 4]:
		var mail: CoreContract.ItemMail = CoreContract.ItemMail.new()
		mail.mail_id = mail_id
		mails.append(mail)
	UserStateCore.notify_item_mails(mails)
	UserStateCore.notify_item_mails([] as Array[CoreContract.ItemMail])
	assert_eq(item_mail_events, 1)
	var mail_ids: Array[int] = []
	for mail: CoreContract.ItemMail in item_mails:
		mail_ids.append(mail.mail_id)
	assert_eq(mail_ids, [8, 4] as Array[int])


func test_user_created_at() -> void:
	await start()
	assert_eq(UserStateCore.get_user_created_at(), 0, "before it is set")
	UserStateCore.set_user_created_at(1700000000000)
	assert_eq(UserStateCore.get_user_created_at(), 1700000000000)
	assert_eq(changed, PackedStringArray(["ItemBalanceUserState|0||"]))
	assert_eq(UserStateCore.get_change_number(CoreContract.ItemBalanceUserState), 0)
	UserStateCore.set_user_created_at(1700000000000)
	assert_eq(changed.size(), 1, "the same value publishes nothing")
	UserStateCore.set_user_created_at(1700000000001)
	assert_eq(changed.size(), 2)
	assert_eq(UserStateCore.get_change_number(CoreContract.ItemBalanceUserState), 0)
	UserStateCore.release()
	assert_true(UserStateCore.init())
	assert_eq(UserStateCore.get_user_created_at(), 0, "after release")


func test_init_again_after_release_starts_empty() -> void:
	await start()
	assert_true(UserStateCore.register_after_update(CoreContract.TutorialProgressUserState, _HOOKS.after_tutorial))
	var delta: CoreContract.UserStateDelta = new_delta()
	add_tutorial(delta, 1, 1)
	assert_true(UserStateCore.apply_delta(delta, UserStateCore.DeltaSource.RESPONSE))
	UserStateCore.release()
	assert_true(UserStateCore.init())
	_HOOKS.calls = PackedStringArray()
	assert_eq(UserStateCore.count(CoreContract.TutorialProgressUserState), 0)
	assert_eq(UserStateCore.get_change_number(CoreContract.TutorialProgressUserState), 0)
	var again: CoreContract.UserStateDelta = new_delta()
	add_tutorial(again, 2, 1)
	assert_true(UserStateCore.apply_delta(again, UserStateCore.DeltaSource.RESPONSE))
	assert_eq(_HOOKS.calls.size(), 0, "the hook registered before release is gone")
	assert_true(UserStateCore.register_after_update(CoreContract.TutorialProgressUserState, _HOOKS.after_tutorial))
