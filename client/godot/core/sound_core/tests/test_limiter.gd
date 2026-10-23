extends "res://core/sound_core/tests/support/sound_test_case.gd"
## `Master` limiter: its ceiling comes from the settings and it holds the output peak under the ceiling.

const PEAK_METER := preload("res://core/sound_core/tests/support/peak_meter.gd")
const LOUD_RATE: int = 8000
const LOUD_SAMPLES: int = 4000
## Longest wait for the engine's latency read that shows the page audio context: the engine reads it every 1000 ms.
const PAGE_STATE_LIMIT_MS: int = 2000


func after_each() -> void:
	super()
	SoundPageAudio.unhook()


func test_limiter_ceiling_is_peak_limit_minus_margin_on_master() -> void:
	set_float("SoundCore.masterPeakMaxDbtp", -2.0)
	set_float("SoundCore.masterLimiterMarginDb", 0.5)
	assert_true(await start_modules())
	var master: int = bus_index(SoundCore.SoundBus.MASTER)
	var found: bool = false
	for effect: int in AudioServer.get_bus_effect_count(master):
		if AudioServer.get_bus_effect(master, effect) == SoundCore._limiter:
			found = true
	assert_true(found, "the limiter is on Master")
	assert_almost_eq(SoundCore._limiter.ceiling_db, -2.5, 0.0001)


func test_lower_ceiling_holds_the_output_peak_of_the_same_input_under_it() -> void:
	var limiter_platforms: PackedStringArray = PackedStringArray(["android", "ios", "windows", "macos", "linux"])
	UnitTestCore.require_platform(limiter_platforms)
	if not CoreBuildInfo.platform in limiter_platforms:
		return
	set_float("SoundCore.masterPeakMaxDbtp", -6.0)
	set_float("SoundCore.masterLimiterMarginDb", 1.0)
	assert_true(await start_modules())
	assert_almost_eq(SoundCore._limiter.ceiling_db, -7.0, 0.0001)
	var meter: PEAK_METER = PEAK_METER.new()
	add_child(meter)
	var player: AudioStreamPlayer = AudioStreamPlayer.new()
	player.process_mode = Node.PROCESS_MODE_ALWAYS
	player.bus = &"Master"
	player.volume_db = 12.0
	player.stream = _loud_stream()
	add_child(player)
	player.play()
	await player.finished
	var peak: float = meter.max_peak_db
	assert_gt(peak, -10.0, "the input reached the limiter")
	assert_lt(peak, -7.0 + 0.1, "output peak under the ceiling")
	player.queue_free()
	meter.queue_free()


## The browser run skips the test above, whose platforms are the native ones. The browser runtime plays through the
## engine mixer too (stream playback, `audio/general/default_playback_type.web` `Stream`), and its page audio worklet
## plays the mix: with the page audio context running, the same input reaches `Master` and the limiter holds its output
## peak under the ceiling.
func test_browser_playback_goes_through_the_master_limiter() -> void:
	UnitTestCore.require_platform(PackedStringArray(["web"]))
	if OS.get_name() != "Web":
		return
	set_float("SoundCore.masterPeakMaxDbtp", -6.0)
	set_float("SoundCore.masterLimiterMarginDb", 1.0)
	assert_true(await start_modules())
	assert_almost_eq(SoundCore._limiter.ceiling_db, -7.0, 0.0001)
	assert_true(SoundPageAudio.hook())
	assert_true(await SoundPageAudio.wait_state("running", PAGE_STATE_LIMIT_MS), "the page audio context runs")
	var meter: PEAK_METER = PEAK_METER.new()
	add_child(meter)
	var player: AudioStreamPlayer = AudioStreamPlayer.new()
	player.process_mode = Node.PROCESS_MODE_ALWAYS
	player.bus = &"Master"
	player.volume_db = 12.0
	player.stream = _loud_stream()
	add_child(player)
	player.play()
	await player.finished
	assert_eq(SoundPageAudio.state(), "running", "the page audio played the mix")
	SoundPageAudio.unhook()
	var peak: float = meter.max_peak_db
	assert_gt(peak, -10.0, "the input reached the limiter")
	assert_lt(peak, -7.0 + 0.1, "output peak under the ceiling")
	player.queue_free()
	meter.queue_free()


## Full scale square wave, 0.5 s.
func _loud_stream() -> AudioStreamWAV:
	var data: PackedByteArray = PackedByteArray()
	data.resize(LOUD_SAMPLES * 2)
	for index: int in LOUD_SAMPLES:
		data.encode_s16(index * 2, 32767 if (index / 20) % 2 == 0 else -32767)
	var stream: AudioStreamWAV = AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = LOUD_RATE
	stream.data = data
	return stream
