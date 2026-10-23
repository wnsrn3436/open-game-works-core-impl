extends "res://core/cutscene_core/tests/support/cutscene_test_case.gd"
## Browser runtime: auto advance while the page audio context is suspended, as a real browser keeps it until a user
## gesture. Voice end is `SoundCore.is_playing` of the line voice turning `false`. The engine reports no end of a play
## while the page audio is suspended, and SoundCore ends the play at its sound length, so voice end and auto
## advance follow the voice length. A click the test host puts into the page (`UnitTestCore.put_page_click`) is a user
## gesture: the engine resumes the page audio.

const STATE_LIMIT_MS: int = 2000
## Where the test clicks the page: a corner of the canvas with no button under it, so the click is no cutscene input.
const PAGE_CLICK: Vector2 = Vector2(2, 2)


func after_each() -> void:
	super()
	SoundPageAudio.unhook()


func test_a_line_voice_ends_at_its_length_while_the_page_audio_is_suspended_and_auto_advance_follows() -> void:
	var call: PLAY = await _play_suspended()
	if call == null:
		return
	await advance(VOICE_MS - 1)
	assert_true(SoundCore.is_playing(CutsceneCore._voice_handle), "1 ms before the voice length")
	assert_true(line_running(), "auto advance waits for voice end")
	await advance(1)
	assert_false(SoundCore.is_playing(CutsceneCore._voice_handle), "the voice ends at its length")
	assert_true(line_running())
	await advance(AUTO_MS - 1)
	assert_true(line_running())
	await advance(1)
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)


func test_a_page_input_resumes_the_page_audio_and_a_voice_from_before_it_still_ends_at_its_length() -> void:
	var call: PLAY = await _play_suspended()
	if call == null:
		return
	var voice: int = CutsceneCore._voice_handle
	await advance(1000)
	assert_eq(SoundPageAudio.state(), "suspended", "the page audio waits for an input")
	assert_true(await UnitTestCore.put_page_click(PAGE_CLICK), "the test host put a click into the page")
	assert_true(await SoundPageAudio.wait_state("running", STATE_LIMIT_MS), "the click resumes the page audio")
	assert_true(SoundCore.is_playing(voice), "the voice goes on after the input")
	assert_true(line_running(), "the click is no cutscene input")
	await advance(VOICE_MS - 1000 - 1)
	assert_true(SoundCore.is_playing(voice), "1 ms before the voice length counted from its start before the input")
	assert_true(line_running(), "auto advance waits for voice end")
	await advance(1)
	assert_false(SoundCore.is_playing(voice), "the voice ends at its length, not at the length after the input")
	assert_true(line_running())
	await advance(AUTO_MS - 1)
	assert_true(line_running())
	await advance(1)
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)


## Starts the modules, suspends the page audio context found through the engine's latency read, plays `[cut_line]` and
## turns auto advance on. Null, and a skip, outside the browser runtime. Async.
func _play_suspended() -> PLAY:
	UnitTestCore.require_platform(PackedStringArray(["web"]))
	if OS.get_name() != "Web":
		return null
	assert_true(await start())
	await ResourceCore.load(VOICE_HELLO, ResourceCore.BaseKind.AUDIO_STREAM, scope)
	assert_true(SoundPageAudio.hook())
	assert_true(await SoundPageAudio.wait_state("running", STATE_LIMIT_MS),
			"the engine's latency read shows the running context")
	SoundPageAudio.suspend()
	assert_true(await SoundPageAudio.wait_state("suspended", STATE_LIMIT_MS), "the page audio context is suspended")
	var call: PLAY = await play("[cut_line]")
	await tap(view().auto_advance_button)
	assert_true(view().auto_advance_button.button_pressed)
	return call
