extends "res://core/qa_core/tests/support/qa_test_case.gd"
## Telemetry: input latency and feedback, `Response` marks, rewards, marks and goal intervals, idle spans, scene
## loads, the record limit, `clear_telemetry` and the time step mode leaves out.

const BIG: String = "12345678901234567890"


func test_latency_and_feedback_of_an_input() -> void:
	assert_true(await start())
	await tap_empty()
	await advance(120, 1)
	publish(EventCore.acquire(SoundPlayedEvent))
	publish(EventCore.acquire(TweenStartedEvent))
	await advance(FEEDBACK_WINDOW_MS, 1)
	publish(EventCore.acquire(SoundPlayedEvent))
	var json: String = await telemetry()
	assert_eq(JSONR.count(json, "inputs"), 1)
	assert_eq(JSONR.text(json, "inputs.0.command"), "tap")
	assert_eq(JSONR.integer(json, "inputs.0.latency_ms"), 120, "latency to the first response event")
	assert_eq(JSONR.integer(json, "inputs.0.feedback.Sound"), 1, "the sound after the window is not counted")
	assert_eq(JSONR.integer(json, "inputs.0.feedback.Tween"), 1)
	assert_eq(JSONR.count(json, "inputs.0.feedback"), 2)
	await tap_empty()
	await advance(FEEDBACK_WINDOW_MS, 1)
	publish(EventCore.acquire(SoundPlayedEvent))
	json = await telemetry()
	assert_true(JSONR.is_null(json, "inputs.1.latency_ms"), "no response event in the window")
	assert_eq(JSONR.count(json, "inputs.1.feedback"), 0)


func test_response_mark_without_feedback() -> void:
	assert_true(await start())
	await tap_empty()
	await advance(80, 1)
	QACore.mark(QACore.MarkKind.RESPONSE)
	var json: String = await telemetry()
	assert_eq(JSONR.integer(json, "inputs.0.latency_ms"), 80)
	assert_eq(JSONR.count(json, "inputs.0.feedback"), 0, "a Response mark is no feedback")


func test_a_release_input_is_not_recorded() -> void:
	assert_true(await start())
	await run_ok("key_down", PackedStringArray(["A"]))
	await advance(30, 1)
	await run_ok("key_up", PackedStringArray(["A"]))
	await advance(20, 1)
	publish(EventCore.acquire(SoundPlayedEvent))
	var json: String = await telemetry()
	assert_eq(JSONR.count(json, "inputs"), 1, "the key_up is not recorded")
	assert_eq(JSONR.text(json, "inputs.0.command"), "key_down")
	assert_eq(JSONR.integer(json, "inputs.0.latency_ms"), 50, "latency from the key_down")
	assert_eq(JSONR.integer(json, "inputs.0.feedback.Sound"), 1, "the feedback goes to the key_down")


func test_rewards() -> void:
	assert_true(await start())
	var gold: int = GameDataDev.find_id_value("[gold]")
	var event: ItemChangedEvent = EventCore.acquire(ItemChangedEvent) as ItemChangedEvent
	event.changes = [
		change(gold, 5, "", CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_REQUEST),
		change(gold, 0, BIG, CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_SHOP),
		change(gold, 0, "", CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_REQUEST),
		change(gold, -3, "", CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_REQUEST),
		change(gold, 7, "", CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_CHEAT),
		change(gold, 9, "", CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_PLAY_SESSION_REFUND),
	]
	publish(event)
	QACore.mark(QACore.MarkKind.REWARD, 42)
	var json: String = await telemetry()
	assert_eq(JSONR.count(json, "rewards"), 3)
	assert_eq(JSONR.text(json, "rewards.0.kind"), "Item")
	assert_eq(JSONR.integer(json, "rewards.0.id"), gold)
	assert_eq(JSONR.integer(json, "rewards.0.amount"), 5)
	assert_eq(JSONR.integer(json, "rewards.1.amount"), 9007199254740991, "a big delta is cut at 2^53 - 1")
	assert_eq(JSONR.text(json, "rewards.2.kind"), "Mark")
	assert_eq(JSONR.integer(json, "rewards.2.id"), 42)
	assert_eq(JSONR.integer(json, "rewards.2.amount"), 1)
	for i: int in 3:
		assert_true(JSONR.has(json, "rewards.%d.play_at" % i), "play_at of reward %d" % i)


func test_marks_and_goal_intervals() -> void:
	assert_true(await start())
	QACore.mark(QACore.MarkKind.GOAL)
	await tap_empty()
	await tap_empty()
	QACore.mark(QACore.MarkKind.FAIL)
	QACore.mark(QACore.MarkKind.GOAL)
	QACore.mark(QACore.MarkKind.RESTART)
	QACore.mark(99 as QACore.MarkKind)
	assert_eq(errors(), 1, "an undefined mark kind")
	var json: String = await telemetry()
	var kinds: PackedStringArray = PackedStringArray()
	for i: int in JSONR.count(json, "marks"):
		kinds.append(JSONR.text(json, "marks.%d.kind" % i))
	assert_eq(kinds, PackedStringArray(["Goal", "Fail", "Goal", "Restart"]))
	assert_eq(JSONR.count(json, "goal_intervals"), 2)
	assert_eq(JSONR.integer(json, "goal_intervals.0.input_count"), 0)
	assert_eq(JSONR.integer(json, "goal_intervals.1.input_count"), 2, "the inputs between the two Goal marks")


func test_play_at_and_goal_interval_duration() -> void:
	assert_true(await start())
	await run_ok("clear_telemetry")
	await advance(300, 1)
	QACore.mark(QACore.MarkKind.GOAL)
	await advance(200, 1)
	QACore.mark(QACore.MarkKind.REWARD, 42)
	await advance(100, 1)
	QACore.mark(QACore.MarkKind.GOAL)
	var json: String = await telemetry()
	assert_eq(JSONR.integer(json, "marks.0.play_at"), 300, "ms played since the telemetry start")
	assert_eq(JSONR.integer(json, "marks.1.play_at"), 500)
	assert_eq(JSONR.integer(json, "rewards.0.play_at"), 500, "a Reward mark reward")
	assert_eq(JSONR.integer(json, "marks.2.play_at"), 600)
	assert_eq(JSONR.integer(json, "goal_intervals.0.duration_ms"), 300, "from the telemetry start")
	assert_eq(JSONR.integer(json, "goal_intervals.1.duration_ms"), 300, "from the Goal mark before")
	assert_eq(JSONR.integer(json, "goal_intervals.1.end_at") - JSONR.integer(json, "goal_intervals.1.start_at"), 300)


func test_play_at_leaves_out_device_time_jumps_and_the_background() -> void:
	assert_true(await start())
	await run_ok("clear_telemetry")
	QACore.mark(QACore.MarkKind.FAIL)
	UnitTestCore.set_device_time(TimeCore.get_device_time() + 60000)
	await advance(100, 1)
	QACore.mark(QACore.MarkKind.RESTART)
	QACore.mark(QACore.MarkKind.FAIL)
	await advance(100, 1)
	UnitTestCore.advance_clock(30000, true)
	await UnitTestCore.wait_frames(1)
	QACore.mark(QACore.MarkKind.RESTART)
	var json: String = await telemetry()
	assert_eq(JSONR.integer(json, "marks.1.play_at") - JSONR.integer(json, "marks.0.play_at"), 100,
		"a device time jump is not played time")
	assert_eq(JSONR.integer(json, "marks.3.play_at") - JSONR.integer(json, "marks.2.play_at"), 100,
		"background progress is not played time")


func test_idle_span() -> void:
	assert_true(await start())
	await run_ok("clear_telemetry")
	await advance(IDLE_THRESHOLD_MS + 1, 1)
	await tap_empty()
	var json: String = await telemetry()
	assert_eq(JSONR.count(json, "idle_spans"), 1)
	assert_eq(JSONR.integer(json, "idle_spans.0.end_at") - JSONR.integer(json, "idle_spans.0.start_at"), IDLE_THRESHOLD_MS + 1)
	assert_eq(JSONR.integer(json, "idle_spans.0.duration_ms"), IDLE_THRESHOLD_MS + 1)
	await advance(IDLE_THRESHOLD_MS + 1, 1)
	json = await telemetry()
	assert_eq(JSONR.count(json, "idle_spans"), 2, "a span that goes on")
	assert_true(JSONR.is_null(json, "idle_spans.1.end_at"))
	assert_true(JSONR.is_null(json, "idle_spans.1.duration_ms"))


func test_scene_loads() -> void:
	assert_true(await start())
	var event: SceneStartedEvent = EventCore.acquire(SceneStartedEvent) as SceneStartedEvent
	event.scene_key = "scene/qa_loaded"
	event.duration_ms = 345
	publish(event)
	var json: String = await telemetry()
	assert_eq(JSONR.count(json, "scene_loads"), 1)
	assert_eq(JSONR.text(json, "scene_loads.0.scene_key"), "scene/qa_loaded")
	assert_eq(JSONR.integer(json, "scene_loads.0.duration_ms"), 345)
	assert_eq(JSONR.integer(await run_ok("get_stats"), "last_scene_load_ms"), 345)


func test_record_limit_and_clear() -> void:
	assert_true(await start())
	for i: int in TELEMETRY_MAX_RECORDS + 1:
		await tap_empty()
	var json: String = await telemetry()
	assert_eq(JSONR.count(json, "inputs"), TELEMETRY_MAX_RECORDS)
	assert_eq(JSONR.integer(json, "dropped"), 1)
	QACore.mark(QACore.MarkKind.GOAL)
	await advance(10, 1)
	await run_ok("clear_telemetry")
	json = await telemetry()
	for item: String in ["inputs", "rewards", "marks", "idle_spans", "goal_intervals", "scene_loads"]:
		assert_eq(JSONR.count(json, item), 0, item)
	assert_eq(JSONR.integer(json, "dropped"), 0)
	assert_eq(JSONR.integer(json, "started_at"), TimeCore.get_device_time())


func test_time_without_a_step_is_left_out_in_step_mode() -> void:
	assert_true(await start())
	await run_ok("set_step_mode", PackedStringArray(["on"]))
	await tap_empty()
	await advance(IDLE_THRESHOLD_MS * 2, 1)
	publish(EventCore.acquire(SoundPlayedEvent))
	var json: String = await telemetry()
	assert_eq(JSONR.integer(json, "inputs.0.latency_ms"), 0, "the stopped time is not in the latency")
	assert_eq(JSONR.count(json, "idle_spans"), 0, "nor in an idle span")
	var step: Pending = start_command("step", PackedStringArray(["100"]))
	await finish(step, 16)
	await run_ok("set_step_mode", PackedStringArray(["off"]))


func test_durations_in_step_mode_are_the_stepped_time() -> void:
	assert_true(await start())
	await run_ok("set_step_mode", PackedStringArray(["on"]))
	await run_ok("clear_telemetry")
	await advance(IDLE_THRESHOLD_MS * 3, 1)
	for ms: String in [str(STEP_MAX_MS), "200"]:
		assert_true((await finish(start_command("step", PackedStringArray([ms])), 16)).ok, "step " + ms)
	await tap_empty()
	QACore.mark(QACore.MarkKind.GOAL)
	var json: String = await telemetry()
	assert_eq(JSONR.count(json, "idle_spans"), 1, "the stepped time is over the idle threshold")
	assert_eq(JSONR.integer(json, "idle_spans.0.duration_ms"), STEP_MAX_MS + 200, "the time between the steps is not in it")
	assert_true(JSONR.integer(json, "idle_spans.0.end_at") - JSONR.integer(json, "idle_spans.0.start_at") >= IDLE_THRESHOLD_MS * 3)
	assert_eq(JSONR.integer(json, "goal_intervals.0.duration_ms"), STEP_MAX_MS + 200)
	assert_eq(JSONR.integer(json, "goal_intervals.0.input_count"), 1)
	await run_ok("set_step_mode", PackedStringArray(["off"]))


func test_play_at_in_step_mode_leaves_out_the_time_without_a_step() -> void:
	assert_true(await start())
	await run_ok("set_step_mode", PackedStringArray(["on"]))
	QACore.mark(QACore.MarkKind.FAIL)
	await advance(1000, 1)
	assert_true((await finish(start_command("step", PackedStringArray(["100"])), 16)).ok)
	QACore.mark(QACore.MarkKind.RESTART)
	var json: String = await telemetry()
	assert_eq(JSONR.text(json, "marks.0.kind"), "Fail")
	assert_eq(JSONR.text(json, "marks.1.kind"), "Restart")
	assert_eq(JSONR.integer(json, "marks.1.play_at") - JSONR.integer(json, "marks.0.play_at"), 100, "the stepped ms only")
	assert_true(JSONR.integer(json, "marks.1.at") - JSONR.integer(json, "marks.0.at") >= 1000, "at is device time")
	await run_ok("set_step_mode", PackedStringArray(["off"]))


## A tap in the visible game area away from UI, one input.
func tap_empty() -> void:
	await run_ok("tap", window_args(640, 600))


func publish(event: EventBase) -> void:
	EventCore.publish(event)


func change(item_id: int, delta: int, big_delta: String, source: CoreContract.ItemChangeSource) -> CoreContract.ItemChange:
	var item: CoreContract.ItemChange = CoreContract.ItemChange.new()
	item.item_id = item_id
	item.delta = delta
	item.big_delta = big_delta
	item.source = source
	return item
