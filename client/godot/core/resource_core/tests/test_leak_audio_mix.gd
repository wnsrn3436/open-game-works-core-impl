extends "res://core/resource_core/tests/support/resource_test_case.gd"
## When the leak check judges a dropped `AudioStream`: after the audio driver callbacks since the drop handed out more
## than one 512-frame audio mix. The tick and audio server values come from a test clock, so the callbacks are the
## test's on every runtime.

const CLOCK = preload("res://core/resource_core/tests/support/resource_test_audio_clock.gd")
const LEAK = preload("res://core/resource_core/resource_leak.gd")

## Microseconds between the callbacks the tests start.
const CALLBACK_USEC: int = 4000

var _clock: CLOCK = null
## The dropped stream the test holds, so the leak check waits for its mix and then finds it.
var _stream: AudioStream = null


func before_each() -> void:
	super()
	_clock = null
	_stream = null


func after_each() -> void:
	_stream = null
	await super()


## Inits `ResourceCore` with the test clock, loads `SOUND` in a scope, holds it and drops the scope after the callback
## running at that time started. Returns the stream's leak check entry.
func drop_held_sound() -> LEAK:
	_clock = CLOCK.new()
	ResourceCore._audio_clock = _clock
	start()
	_clock.start_callback(0, 128)
	var scope: Scope = new_scope("battle")
	_stream = await ResourceCore.load(SOUND, AUDIO, scope) as AudioStream
	assert_ne(_stream, fallback_of(AUDIO))
	_clock.now_usec += 1000
	ResourceCore.release_scope(scope)
	assert_eq(ResourceCore._leaks.size(), 1)
	return ResourceCore._leaks[0]


## Async. Waits frames until the next frame check of the leak check read the test clock. On web the first frames of a
## run emit `process_frame` more than once per frame, so a frame count does not tell. `ResourceCore.release`, as at
## the test time limit, ends it too.
func next_frame() -> void:
	var reads: int = _clock.reads
	while _clock.reads == reads and ResourceCore.is_initialized():
		await UnitTestCore.wait_frames(1)
	assert_eq(_clock.reads, reads + 1, "one frame check read the clock")


func test_sound_is_judged_after_the_frame_its_callbacks_passed_512_frames() -> void:
	var leak: LEAK = await drop_held_sound()
	await next_frame()
	assert_eq(leak.mix_frames, 0, "the callback that started before the drop does not count")
	for i: int in 4:
		_clock.start_callback(CALLBACK_USEC, 128)
		await next_frame()
	assert_eq(leak.mix_frames, 512)
	await next_frame()
	await next_frame()
	assert_eq(leak.mixed_frame, -1, "512 frames are not more than one mix")
	assert_eq(ResourceCore._leaks.size(), 1, "not judged while the sum is 512 or less")
	assert_errors(0)
	_clock.start_callback(CALLBACK_USEC, 128)
	await next_frame()
	assert_eq(leak.mix_frames, 640)
	var mixed: int = leak.mixed_frame
	assert_true(mixed >= 0, "the frame that saw the sum pass 512")
	await wait_process_frame(mixed + 1)
	assert_eq(ResourceCore._leaks.size(), 1, "not judged before the end of the frame after it")
	assert_errors(0)
	await wait_process_frame(mixed + 2)
	assert_true(ResourceCore._leaks.is_empty())
	assert_errors(1, "the held stream is a leak at the end of the frame after the one whose sum passed 512")


## Async. Drops a held sound, moves the ticks `step_usec` on before each clock read and starts 4 callbacks of 128
## frames, then one more. Each callback counts the floor of 128 frames less the step between the first
## `get_time_since_last_mix` and `get_time_to_next_mix`: 127 for a step under 1 frame (30.5 microseconds).
func count_callbacks_with_read_step(step_usec: int) -> void:
	var leak: LEAK = await drop_held_sound()
	_clock.read_step_usec = step_usec
	await next_frame()
	for i: int in 4:
		_clock.start_callback(CALLBACK_USEC, 128)
		await next_frame()
	assert_eq(leak.mix_frames, 4 * 127, "not more than the 512 frames the callbacks handed out")
	await next_frame()
	await next_frame()
	assert_eq(leak.mixed_frame, -1, "callbacks of exactly 512 frames are not more than one mix")
	assert_eq(ResourceCore._leaks.size(), 1)
	assert_errors(0)
	_clock.start_callback(CALLBACK_USEC, 128)
	await next_frame()
	assert_eq(leak.mix_frames, 5 * 127)
	assert_true(leak.mixed_frame >= 0)
	await wait_leak_check()
	assert_errors(1)


## 16 microseconds are 0.524288 frames. The second `get_time_since_last_mix` is 2 steps after the first, so a count
## that adds it gets 129 per callback and passes 512 after the 4 callbacks.
func test_callback_frame_count_adds_the_first_time_since_last_mix() -> void:
	await count_callbacks_with_read_step(16)


## 8 microseconds are 0.262144 frames, so a count that rounds up or to the nearest gets 128 per callback.
func test_callback_frame_count_rounds_down() -> void:
	await count_callbacks_with_read_step(8)


func test_callback_seen_in_several_frames_counts_once() -> void:
	var leak: LEAK = await drop_held_sound()
	_clock.start_callback(CALLBACK_USEC, 256)
	for lag: int in [0, 3, 1, 7]:
		_clock.read_lag_usec = lag
		await next_frame()
	assert_eq(leak.mix_frames, 256, "the start each frame reads differs by the read lag, but it is one callback")
	_clock.read_lag_usec = 0
	_clock.start_callback(CALLBACK_USEC, 256)
	await next_frame()
	await next_frame()
	assert_eq(leak.mix_frames, 512)
	assert_eq(leak.mixed_frame, -1)
	_clock.start_callback(CALLBACK_USEC, 256)
	await next_frame()
	assert_eq(leak.mix_frames, 768)
	assert_true(leak.mixed_frame >= 0)
	await wait_leak_check()
	assert_errors(1)


func test_frame_whose_two_reads_see_different_callback_starts_counts_nothing() -> void:
	var leak: LEAK = await drop_held_sound()
	_clock.start_callback(CALLBACK_USEC, 128)
	_clock.switch_after_usec = CALLBACK_USEC
	_clock.switch_frames = 128
	await next_frame()
	assert_eq(leak.mix_frames, 0, "a callback started between the two reads")
	assert_eq(_clock.switch_after_usec, 0, "the frame check read the time to the next mix")
	await next_frame()
	assert_eq(leak.mix_frames, 128, "the later callback counts in the next frame; the one before it is not seen")
	for i: int in 4:
		_clock.start_callback(CALLBACK_USEC, 128)
		await next_frame()
	assert_true(leak.mixed_frame >= 0)
	await wait_leak_check()
	assert_errors(1)


func test_sound_freed_before_its_mix_is_not_a_leak() -> void:
	var leak: LEAK = await drop_held_sound()
	await next_frame()
	assert_eq(ResourceCore._leaks.size(), 1, "no callback since the drop")
	_stream = null
	await wait_leak_check()
	assert_eq(leak.mixed_frame, -1)
	assert_errors(0)


func test_init_reads_the_engine_audio_server_when_no_test_clock_is_set() -> void:
	start()
	assert_not_null(ResourceCore._audio_clock)
	assert_false(ResourceCore._audio_clock is CLOCK)
	ResourceCore.release()
	assert_null(ResourceCore._audio_clock, "release clears the clock")
