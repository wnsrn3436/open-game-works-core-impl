extends "res://core/cutscene_core/tests/support/cutscene_test_case.gd"
## The frame processing of the playback allocates no memory: typing, the advance input check, the voice end check,
## and the end checks of `Line`, `Wait`, a waiting command and playback end.

## Long enough that no measured wait ends.
const LONG_MS: int = 10000000
const TYPING_MS: int = 300


## The frame code of the core node `count` times, the test clock moving `ms` before each. Frame code.
func _frames(count: int, ms: int) -> void:
	for i: int in count:
		if ms > 0:
			UnitTestCore.advance_clock(ms, false)
		CutsceneCore._on_frame()


## Warm-up of 100 frames, then 1000 frames that make no object and take no memory. Call after `LogCore.release`.
func assert_frames_allocate_nothing(label: String, ms: int) -> void:
	_frames(100, ms)
	var objects: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	_frames(1000, ms)
	# Read both before asserting: an assert allocates.
	var objects_after: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory_after: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	assert_true(objects_after <= objects, label + ": no object is made")
	assert_true(memory_after <= memory, label + ": no memory is taken")


func stop_playback(call: PLAY) -> void:
	CutsceneCore._stop()
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.STOPPED)


func test_typing_and_the_voice_end_check_allocate_nothing() -> void:
	set_setting("CutsceneCore.typingIntervalMs", TYPING_MS)
	assert_true(await start())
	var call: PLAY = await play("[cut_line]")
	await tap(view().auto_advance_button)
	assert_true(CutsceneCore._auto_on)
	assert_eq(playing(SoundCore.SoundBus.VOICE), PackedStringArray([VOICE_HELLO]), "the voice end check runs")
	var shown: int = text_label().visible_characters
	LogCore.release()
	assert_frames_allocate_nothing("typing", 1)
	assert_true(line_running())
	assert_gt(text_label().visible_characters, shown, "typing shows more characters")
	assert_lt(text_label().visible_characters, CutsceneCore._line_total, "typing goes on")
	await stop_playback(call)


func test_the_auto_advance_wait_allocates_nothing() -> void:
	set_setting("CutsceneCore.autoAdvanceDelayMs", LONG_MS)
	assert_true(await start())
	var call: PLAY = await play("[cut_plain]")
	await tap(view().auto_advance_button)
	assert_true(CutsceneCore._auto_on)
	LogCore.release()
	assert_frames_allocate_nothing("auto advance", 1)
	assert_true(line_running())
	await stop_playback(call)


func test_the_fast_forward_wait_allocates_nothing() -> void:
	set_setting("CutsceneCore.fastForwardDelayMs", LONG_MS)
	assert_true(await start())
	var call: PLAY = await play("[cut_plain]")
	await tap(view().fast_forward_button)
	assert_true(CutsceneCore._fast_forward_on)
	LogCore.release()
	assert_frames_allocate_nothing("fast forward", 1)
	assert_true(line_running())
	await stop_playback(call)


func test_the_wait_end_check_allocates_nothing() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_wait]")
	assert_eq(CutsceneCore._hold, CutsceneCore._HOLD_WAIT)
	LogCore.release()
	assert_frames_allocate_nothing("Wait for the in-progress Move", 0)
	assert_false(CutsceneCore._wait_counting)
	await advance(MOVE_MS)
	await UnitTestCore.wait_frames(1)
	assert_true(CutsceneCore._wait_counting)
	assert_frames_allocate_nothing("Wait counting", 0)
	assert_eq(CutsceneCore._hold, CutsceneCore._HOLD_WAIT)
	await stop_playback(call)


func test_the_waiting_command_end_check_allocates_nothing() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_move]")
	assert_eq(CutsceneCore._hold, CutsceneCore._HOLD_COMMAND)
	LogCore.release()
	assert_frames_allocate_nothing("waiting Move", 0)
	assert_eq(CutsceneCore._hold, CutsceneCore._HOLD_COMMAND)
	await stop_playback(call)


func test_the_playback_end_check_allocates_nothing() -> void:
	var rows: ROWS = ROWS.new()
	var cut: int = rows.new_id()
	rows.step(cut, 1, GameData.CutsceneCommand.MOVE, false, "hero", "spot", MOVE)
	rows.step(cut, 2, GameData.CutsceneCommand.END)
	assert_true(await start(true, true, rows.tables()))
	var call: PLAY = await play_id(cut)
	assert_eq(CutsceneCore._hold, CutsceneCore._HOLD_END, "End waits for the Move")
	LogCore.release()
	assert_frames_allocate_nothing("playback end", 0)
	assert_eq(CutsceneCore._hold, CutsceneCore._HOLD_END)
	await stop_playback(call)
