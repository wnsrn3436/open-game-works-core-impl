extends "res://core/user_state_core/tests/support/user_state_test_case.gd"
## DEV operations: `export_json` in the form of server `admin-api` `get_user` `user_state`, and their absence from the
## module class that STG and PROD builds keep.

const _MODULE_PATH: String = "res://core/user_state_core/user_state_core.gd"
const _DEV_PATH: String = "res://core/user_state_core/dev/user_state_core_dev.gd"


func test_export_json_writes_the_cache_as_get_user_does() -> void:
	await start()
	var delta: CoreContract.UserStateDelta = new_delta()
	add_tutorial(delta, 1, 3)
	add_tutorial(delta, 2, 4)
	var nickname: CoreContract.NicknameUserState = CoreContract.NicknameUserState.new()
	nickname.nickname = "player"
	nickname.change_count = 2
	add_upsert(delta, "NicknameUserState", 0, nickname)
	assert_true(UserStateCore.apply_delta(delta, UserStateCore.DeltaSource.RESPONSE))
	put_balance(id_of("[gold]"), 15)
	var balance: ContractMessage = UserStateCore.get_by_id(CoreContract.ItemBalanceUserState, id_of("[gold]"))
	var tutorials: String = "[%s,%s]" % [ContractJsonDev.to_json(get_tutorial(1)), ContractJsonDev.to_json(get_tutorial(2))]
	var expected: String = "{\"item_balance_user_state\":[%s],\"tutorial_progress_user_state\":%s,\"nickname_user_state\":%s}" % [
		ContractJsonDev.to_json(balance), tutorials, ContractJsonDev.to_json(UserStateCore.get_single(CoreContract.NicknameUserState)),
	]
	var exported: String = UserStateCoreDev.export_json()
	assert_eq(exported, expected)
	assert_eq(UserStateCoreDev.export_json(CoreContract.TutorialProgressUserState), "{\"tutorial_progress_user_state\":%s}" % tutorials)
	assert_eq(UserStateCoreDev.export_json(CoreContract.MailUserState), "{}", "a kind with no object")


func test_export_json_of_an_unknown_kind_fails() -> void:
	await start()
	assert_eq(UserStateCoreDev.export_json(CoreContract.UserStateDelta), "")
	assert_eq(errors(), 1)


func test_apply_test_delta_applies_like_apply_delta() -> void:
	await start()
	var delta: CoreContract.UserStateDelta = new_delta()
	add_tutorial(delta, 4, 2)
	assert_true(UserStateCoreDev.apply_test_delta(delta))
	assert_eq(get_tutorial(4).step, 2)
	assert_eq(changed, PackedStringArray(["TutorialProgressUserState|0|4|"]))


func test_the_dev_operations_are_only_in_dev_code() -> void:
	assert_true(ResourceLoader.exists(_DEV_PATH), "the DEV class is under dev/, which STG and PROD builds leave out")
	var source: String = FileAccess.get_file_as_string(_MODULE_PATH)
	assert_ne(source, "")
	assert_false(source.contains("func export_json"), "the module class has no export_json")
	assert_false(source.contains("func apply_test_delta"), "the module class has no apply_test_delta")
	assert_false(source.contains("UserStateCoreDev"), "the module class does not refer to its DEV class")
