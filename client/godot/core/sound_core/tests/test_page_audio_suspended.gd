extends "res://core/sound_core/tests/support/sound_test_case.gd"
## Browser runtime: what SoundCore does while the page audio context is suspended, as a real browser keeps it until a
## user gesture. The engine's playback goes on only while the page audio worklet pulls its mix, and a suspended context
## pulls none and so reports no end, so a play ends when the real elapsed time it spent outside pause reaches its sound
## length. A click the
## test host puts into the page (`UnitTestCore.put_page_click`) is a user gesture: the engine resumes the page audio.

## Length of `SHORT`.
const SHORT_MS: int = 300
## Length of `LONG`: 20000 samples at 1000 Hz. The engine plays it for this real time after the page audio runs, longer
## than the test after the input takes.
const LONG_MS: int = 20000
const STATE_LIMIT_MS: int = 2000
## Where the test clicks the page: a corner of the canvas with no UI element under it.
const PAGE_CLICK: Vector2 = Vector2(2, 2)


func after_each() -> void:
	super()
	SoundPageAudio.unhook()


func test_a_play_while_suspended_ends_at_its_length_and_leaves_no_player() -> void:
	if not await _start_suspended():
		return
	var handle: int = SoundCore.play(SHORT, SoundCore.SoundBus.SFX, scope)
	assert_ne(handle, SoundCore.INVALID_HANDLE)
	var player: AudioStreamPlayer = player_of(handle)
	await advance(SHORT_MS - 1)
	await SoundPageAudio.wait_real(SHORT_MS * 2)
	assert_true(SoundCore.is_playing(handle), "1 ms before its length")
	assert_true(player.playing, "the engine has not ended it")
	await advance(1)
	assert_false(SoundCore.is_playing(handle), "it ends at its length")
	assert_null(player_of(handle), "the handle is invalid")
	assert_eq(playing_count(), 0, "it left the play count")
	assert_false(player.playing, "its player stopped, so it does not sound when the audio runs again")
	SoundPageAudio.resume()
	assert_true(await SoundPageAudio.wait_state("running", STATE_LIMIT_MS), "the context runs again")
	assert_false(SoundCore.is_playing(handle))
	assert_eq(errors(), 0)


func test_plays_that_ended_at_their_length_while_suspended_make_room_for_a_lower_priority_play() -> void:
	set_int("SoundCore.maxConcurrent", 2)
	set_int("SoundCore.maxConcurrentPerKey", 2)
	if not await _start_suspended():
		return
	await load_sound(LOOP_A)
	assert_ne(SoundCore.play(SHORT, SoundCore.SoundBus.SFX, scope, 1), SoundCore.INVALID_HANDLE)
	assert_ne(SoundCore.play(SHORT, SoundCore.SoundBus.SFX, scope, 1), SoundCore.INVALID_HANDLE)
	assert_eq(SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope, 0), SoundCore.INVALID_HANDLE,
			"a lower priority play finds no player while both play")
	await advance(SHORT_MS)
	assert_eq(playing_count(), 0, "both plays ended at their length")
	var handle: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope, 0)
	assert_ne(handle, SoundCore.INVALID_HANDLE, "the same play gets a player")
	SoundCore.stop(handle)


func test_time_in_a_pause_does_not_count_toward_the_length_while_suspended() -> void:
	if not await _start_suspended():
		return
	var handle: int = SoundCore.play(SHORT, SoundCore.SoundBus.SFX, scope)
	await advance(100)
	var token: int = SoundCore.request_pause()
	await advance(SHORT_MS * 5)
	assert_true(SoundCore.is_playing(handle), "paused")
	SoundCore.release_pause(token)
	await advance(SHORT_MS - 100 - 1)
	assert_true(SoundCore.is_playing(handle), "1 ms before its length outside pause")
	await advance(1)
	assert_false(SoundCore.is_playing(handle))
	assert_eq(playing_count(), 0)


func test_a_page_input_resumes_the_suspended_page_audio_and_a_play_from_before_it_still_ends_at_its_length() -> void:
	if not await _start_suspended():
		return
	await load_sound(LONG)
	var handle: int = SoundCore.play(LONG, SoundCore.SoundBus.SFX, scope)
	assert_ne(handle, SoundCore.INVALID_HANDLE)
	var player: AudioStreamPlayer = player_of(handle)
	await advance(1000)
	assert_eq(SoundPageAudio.state(), "suspended", "the page audio waits for an input")
	assert_true(await UnitTestCore.put_page_click(PAGE_CLICK), "the test host put a click into the page")
	assert_true(await SoundPageAudio.wait_state("running", STATE_LIMIT_MS), "the click resumes the page audio")
	assert_true(SoundCore.is_playing(handle), "the play goes on after the input")
	assert_true(player.playing)
	await advance(LONG_MS - 1000 - 1)
	assert_true(SoundCore.is_playing(handle), "1 ms before its length counted from its start before the input")
	await advance(1)
	assert_false(SoundCore.is_playing(handle), "it ends at its length, not at the length after the input")
	assert_null(player_of(handle), "the handle is invalid")
	assert_false(player.playing, "its player stopped though the engine still plays it")
	assert_eq(playing_count(), 0)


## Starts the modules, finds the page audio context through the engine's latency read and suspends it. False, and a
## skip, outside the browser runtime. Async.
func _start_suspended() -> bool:
	UnitTestCore.require_platform(PackedStringArray(["web"]))
	if OS.get_name() != "Web":
		return false
	assert_true(await start_modules())
	await load_sound(SHORT)
	assert_true(SoundPageAudio.hook())
	var found: bool = await SoundPageAudio.wait_state("running", STATE_LIMIT_MS)
	assert_true(found, "the engine's latency read shows the running page audio context")
	SoundPageAudio.suspend()
	var suspended: bool = await SoundPageAudio.wait_state("suspended", STATE_LIMIT_MS)
	assert_true(suspended, "the page audio context is suspended")
	return found and suspended
