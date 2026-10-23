extends "res://core/qa_core/tests/support/qa_test_case.gd"
## Commands and QAState fields of the optional dependencies when they are in the module list: `CameraCore`
## feedback, `QualityCore`, `AccessibilityCore`, `PushCore`, `CutsceneCore` and `TutorialCore`.

const NATIVE: PackedStringArray = ["android", "ios", "windows", "macos", "linux"]
const SET_USER_STATE: String = "core/cheat/SetUserState"

## `message_id` of the `PushOpenedEvent`s and `PushReceivedEvent`s, in order.
var opened_pushes: PackedInt64Array = PackedInt64Array()
var received_pushes: PackedInt64Array = PackedInt64Array()


func before_each() -> void:
	super()
	opened_pushes = PackedInt64Array()
	received_pushes = PackedInt64Array()


func after_each() -> void:
	QACore.release()
	AccessibilityCore.release()
	QualityCore.release()
	TutorialCore.release()
	CutsceneCore.release()
	RequirementCore.release()
	PushCore.release()
	AuthCore.release()
	CameraCore.release()
	super()


## `start` with the optional dependencies in module list order before QACore.
func start_optional() -> bool:
	set_string("tutorialView", TUTORIAL_VIEW)
	var ok: bool = await start(false)
	assert_true(CameraCore.init(), "CameraCore.init")
	# A core test that inits AuthCore with no boot gives it the DEV token storage, as the DEV boot does.
	AuthCoreDev.use_dev_token_storage()
	assert_true(AuthCore.init(), "AuthCore.init")
	PushCore.set_notification_adapter(FakeNotificationAdapter.new())
	assert_true(PushCore.init(), "PushCore.init")
	assert_true(RequirementCore.init(), "RequirementCore.init")
	# The start requirements of the core test data tutorials: they do not pass, so only the plain tutorials start.
	var kinds: Array[GDScript] = [CoreContract.TutorialProgressUserState]
	assert_true(RequirementCore.register_judge(GameData.RequirementType.FLAG_A, _judge_never, kinds, ""), "FlagA judge")
	assert_true(RequirementCore.register_judge(GameData.RequirementType.FLAG_B, _judge_never, kinds, ""), "FlagB judge")
	assert_true(CutsceneCore.init(), "CutsceneCore.init")
	assert_true(TutorialCore.init(), "TutorialCore.init")
	assert_true(QualityCore.init(), "QualityCore.init")
	assert_true(AccessibilityCore.init(), "AccessibilityCore.init")
	assert_true(QACore.init(), "QACore.init")
	return ok


func test_camera_shake_is_feedback() -> void:
	assert_true(await start_optional())
	await run_ok("tap", window_args(640, 600))
	EventCore.publish(EventCore.acquire(CameraShakeStartedEvent))
	var json: String = await telemetry()
	assert_eq(JSONR.integer(json, "inputs.0.feedback.CameraShake"), 1)


func test_quality_level_and_text_scale() -> void:
	assert_true(await start_optional())
	await run_ok("set_quality_level", PackedStringArray(["High"]))
	assert_eq(QualityCore.get_level(), QualityCore.QualityLevel.HIGH, "set_test_level ran")
	assert_eq(JSONR.text(await run_ok("get_stats"), "quality_level"), "High")
	await run_ok("set_quality_level", PackedStringArray(["Low"]))
	assert_eq(JSONR.text(await run_ok("get_stats"), "quality_level"), "Low")
	assert_false((await run("set_quality_level", PackedStringArray(["low"]))).ok)
	assert_eq(LocalizationCore.get_text_scale(), 1000)
	await run_ok("set_text_scale", PackedStringArray(["1200"]))
	assert_eq(LocalizationCore.get_text_scale(), 1200, "set_test_text_scale ran")
	assert_false((await run("set_text_scale", PackedStringArray(["999"]))).ok)
	assert_eq(LocalizationCore.get_text_scale(), 1200, "no target operation")
	assert_eq(warns(), 2)


func test_push_commands() -> void:
	assert_true(await start_optional())
	assert_true(EventCore.subscribe(PushOpenedEvent, _on_push_opened))
	assert_true(EventCore.subscribe(PushReceivedEvent, _on_push_received))
	var info: int = GameDataDev.find_id_value("[push_info]")
	await run_ok("simulate_push", PackedStringArray(["[push_info]", "opened"]))
	assert_eq(opened_pushes, PackedInt64Array([info]), "simulate_push opened the message")
	assert_true(received_pushes.is_empty())
	await run_ok("simulate_push", PackedStringArray(["[push_info]", "received"]))
	assert_eq(received_pushes, PackedInt64Array([info]), "simulate_push received the message")
	assert_eq(opened_pushes.size(), 1)
	assert_false((await run("simulate_push", PackedStringArray(["[qa_no_such_id]", "opened"]))).ok)
	assert_eq(opened_pushes.size() + received_pushes.size(), 2, "no target operation")
	assert_eq(warns(), 1)


func test_set_push_permission_sets_the_fake_permission() -> void:
	UnitTestCore.require_platform(NATIVE)
	if not CoreBuildInfo.platform in NATIVE:
		return
	assert_true(await start_optional())
	await UnitTestCore.wait_frames(2)
	await run_ok("set_push_permission", PackedStringArray(["Denied"]))
	assert_eq(await PushCore.request_permission(), PushCore.PermissionStatus.DENIED, "the fake permission")
	await run_ok("set_push_permission", PackedStringArray(["Granted"]))
	assert_eq(await PushCore.request_permission(), PushCore.PermissionStatus.GRANTED)
	assert_false((await run("set_push_permission", PackedStringArray(["denied"]))).ok)
	assert_eq(await PushCore.request_permission(), PushCore.PermissionStatus.GRANTED, "no target operation")
	assert_eq(warns(), 1)


func test_cutscene_field() -> void:
	assert_true(await start_optional())
	var json: String = await state()
	assert_eq(JSONR.boolean(json, "cutscene_playing"), CutsceneCore.is_playing())
	assert_false(JSONR.is_null(json, "cutscene_playing"), "CutsceneCore is in the module list")


func test_tutorial_fields() -> void:
	assert_true(await start_optional())
	var json: String = await state()
	assert_true(JSONR.is_null(json, "tutorial"), "no current tutorial before the login")
	assert_eq(JSONR.keys(json, "completed_tutorials"), PackedStringArray(), "none completed")
	assert_false(JSONR.is_null(json, "completed_tutorials"))
	await dev_login()
	var second: int = GameDataDev.find_id_value("[tutorial_second]")
	var envelope: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	envelope.server_time_at = SERVER_TIME
	envelope.user_state = progress_delta(second, 2)
	add_ok(SET_USER_STATE, envelope)
	await run_ok("set_user_state", PackedStringArray(["TutorialProgressUserState", "[tutorial_second]", "{\"step\": 2}"]))
	assert_true(TutorialCore.is_completed(second), "the last step of [tutorial_second] is stored")
	TutorialCore.check_start()
	await UnitTestCore.wait_frames(2)
	var current: CurrentResult = TutorialCore.current()
	assert_eq(GameDataDev.find_id_name(current.tutorial_id), "[tutorial_first]", "the first tutorial started")
	json = await state()
	assert_eq(JSONR.text(json, "tutorial.id"), "[tutorial_first]")
	assert_eq(JSONR.integer(json, "tutorial.step"), current.step)
	assert_eq(JSONR.integer(json, "tutorial.step"), 1)
	assert_eq(JSONR.keys(json, "completed_tutorials"), PackedStringArray(["[tutorial_second]"]), "the completed one only")
	assert_true(JSONR.boolean(json, "completed_tutorials.[tutorial_second]"))


func progress_delta(tutorial_id: int, step: int) -> CoreContract.UserStateDelta:
	var row: CoreContract.TutorialProgressUserState = CoreContract.TutorialProgressUserState.new()
	row.id = tutorial_id
	row.step = step
	var entry: CoreContract.UserStateEntry = CoreContract.UserStateEntry.new()
	entry.kind = "TutorialProgressUserState"
	entry.id = tutorial_id
	entry.value = row.encode()
	var delta: CoreContract.UserStateDelta = CoreContract.UserStateDelta.new()
	delta.entries.append(entry)
	return delta


static func _judge_never(_row: GameData.RequirementRow) -> bool:
	return false


func _on_push_opened(event: PushOpenedEvent) -> void:
	opened_pushes.append(event.message_id)


func _on_push_received(event: PushReceivedEvent) -> void:
	received_pushes.append(event.message_id)
