extends UnitTestCase
## Base of the SoundCore core tests: test resources, module start and helpers.

const RESOURCES: String = "res://core/sound_core/tests/resources/"
const SHORT: String = "sfx/sound_test_short"
## A sound that does not loop, 20 s long: the engine still plays it when the test clock reaches its length.
const LONG: String = "sfx/sound_test_long"
const LOOP_A: String = "sfx/sound_test_loop_a"
const LOOP_B: String = "sfx/sound_test_loop_b"
const LOOP_C: String = "sfx/sound_test_loop_c"
const BGM_A: String = "bgm/sound_test_a"
const BGM_B: String = "bgm/sound_test_b"
const BGM_C: String = "bgm/sound_test_c"
const BGM_D: String = "bgm/sound_test_d"
const HAPTIC_VALID: String = "haptic/sound_test_valid"
const HAPTIC_EMPTY: String = "haptic/sound_test_empty"
const HAPTIC_ZERO_DURATION: String = "haptic/sound_test_zero_duration"
const HAPTIC_STRONG: String = "haptic/sound_test_strong"
const HAPTIC_UNKNOWN_KEY: String = "haptic/sound_test_unknown_key"
const HAPTIC_LATE: String = "haptic/sound_test_late"
## Segments of 10 ms, shorter than a frame at 60 fps.
const HAPTIC_SHORT: String = "haptic/sound_test_short"
## Variant 1 is one segment of intensity 200, variant 2 two segments of intensity 600 and 700.
const HAPTIC_VARIANT: String = "haptic/sound_test_variant"
## A sound with 3 variant files, each a copy of `SHORT`.
const VARIANT: String = "sfx/sound_test_variant"
const VARIANT_COUNT: int = 3
## A key in neither the resource key list nor a bundle: its load ends with the fallback resource.
const UNKNOWN: String = "sfx/sound_test_unknown"
const UNKNOWN_BGM: String = "bgm/sound_test_unknown"
const CROSSFADE_MS: int = 400
const ERROR: String = "error"
const KIND: ResourceCore.BaseKind = ResourceCore.BaseKind.AUDIO_STREAM

## Scene scope the tests play their sounds with.
var scope: Scope = null
var played_buses: PackedInt32Array = PackedInt32Array()


func before_each() -> void:
	super()
	played_buses = PackedInt32Array()
	set_int("SoundCore.bgmCrossfadeMs", CROSSFADE_MS)


func set_int(key: String, value: int) -> void:
	assert_true(UnitTestCore.set_test_settings(key, value), key)


func set_float(key: String, value: float) -> void:
	assert_true(UnitTestCore.set_test_settings(key, value), key)


## Starts the modules SoundCore depends on in dependency order with the test resources and the device file, then
## SoundCore unless `init_sound` is false, and makes `scope`. Settings are set before. Async.
func start_modules(init_sound: bool = true) -> bool:
	var keys: Dictionary[String, String] = {
		SHORT: RESOURCES + "test_short.tres",
		LONG: RESOURCES + "test_long.tres",
		LOOP_A: RESOURCES + "test_loop_a.tres",
		LOOP_B: RESOURCES + "test_loop_b.tres",
		LOOP_C: RESOURCES + "test_loop_c.tres",
		BGM_A: RESOURCES + "test_bgm_a.tres",
		BGM_B: RESOURCES + "test_bgm_b.tres",
		BGM_C: RESOURCES + "test_bgm_c.tres",
		BGM_D: RESOURCES + "test_bgm_d.tres",
		HAPTIC_VALID: RESOURCES + "test_haptic_valid.json",
		HAPTIC_EMPTY: RESOURCES + "test_haptic_empty.json",
		HAPTIC_ZERO_DURATION: RESOURCES + "test_haptic_zero_duration.json",
		HAPTIC_STRONG: RESOURCES + "test_haptic_strong.json",
		HAPTIC_UNKNOWN_KEY: RESOURCES + "test_haptic_unknown_key.json",
		HAPTIC_LATE: RESOURCES + "test_haptic_late.json",
		HAPTIC_SHORT: RESOURCES + "test_haptic_short.json",
		HAPTIC_VARIANT: RESOURCES + "test_haptic_variant.json",
		VARIANT: RESOURCES + "test_variant.tres",
	}
	var variants: Dictionary[String, int] = {VARIANT: VARIANT_COUNT, HAPTIC_VARIANT: 2}
	ResourceCoreDev.set_test_key_list(keys, variants)
	var started: bool = (
		LogCore.init() and EventCore.init() and TimeCore.init() and LocalDataCore.init() and ResourceCore.init()
		and DataCore.init() and InputBlockCore.init() and ResolutionCore.init()
	)
	assert_true(started, "dependencies init")
	if not started:
		return false
	var loaded: bool = await DataCore.load(null)
	assert_true(loaded, "DataCore.load")
	var device_loaded: bool = LocalDataCore.load_device_file()
	assert_true(device_loaded, "LocalDataCore.load_device_file")
	var input_started: bool = InputCore.init()
	assert_true(input_started, "InputCore.init")
	scope = ResourceCore.create_scope(ResourceCore.ScopeKind.SCENE, "sound_test")
	assert_true(EventCore.subscribe(SoundPlayedEvent, _on_sound_played), "subscribe SoundPlayedEvent")
	if not init_sound:
		return loaded and device_loaded and input_started
	var initialized: bool = SoundCore.init()
	assert_true(initialized, "SoundCore.init")
	return loaded and device_loaded and input_started and initialized


## Loads `key` into `target` (default `scope`) so that a SoundCore request for it finds it loaded. Async.
func load_sound(key: String, target: Scope = null) -> void:
	var resource: Resource = await ResourceCore.load(key, KIND, target if target != null else scope)
	assert_true(resource is AudioStream, key)


## Waits until the engine load of `key` that a SoundCore request started has ended, through a request of the test
## that joins it in a scope released right after. The frame waited first runs SoundCore's deferred start of its
## loads. SoundCore's request, made first, has seen the result. Async.
func wait_load_end(key: String) -> void:
	await UnitTestCore.wait_frames(1)
	var probe: Scope = ResourceCore.create_scope(ResourceCore.ScopeKind.PANEL, "sound_test_probe")
	await ResourceCore.load(key, KIND, probe)
	ResourceCore.release_scope(probe)


## Starts SoundCore's queued loads now, as its deferred call at the end of the frame does.
func start_loads() -> void:
	SoundCore._on_deferred_load()


func load_haptic(key: String) -> void:
	await ResourceCore.load(key, SoundCore._haptic_kind, scope)


## Moves the test clock and lets SoundCore process one frame of it.
func advance(ms: int) -> void:
	UnitTestCore.advance_clock(ms, false)
	await UnitTestCore.wait_frames(1)


func errors(tag: String = SoundCore._TAG) -> int:
	return UnitTestCore.check_logs(ERROR, tag)


## The BGM player that plays `key`, or null.
func channel_of(key: String) -> SoundCore._BGM_CHANNEL:
	for channel: SoundCore._BGM_CHANNEL in SoundCore._channels:
		if channel.record != null and channel.record.key == key:
			return channel
	return null


func playing_count() -> int:
	var buffer: Array[SoundPlayingRecord] = []
	buffer.resize(SoundCore._max_concurrent + 1)
	return SoundCoreDev.get_playing(buffer)


## Keys of the playing `play` requests.
func playing_keys() -> PackedStringArray:
	var buffer: Array[SoundPlayingRecord] = []
	buffer.resize(SoundCore._max_concurrent + 1)
	var count: int = SoundCoreDev.get_playing(buffer)
	var keys: PackedStringArray = PackedStringArray()
	for index: int in count:
		keys.append(buffer[index].key)
	return keys


## The sfx player of `handle`, or null.
func player_of(handle: int) -> AudioStreamPlayer:
	for slot: int in SoundCore._players.size():
		if SoundCore._slot_handles[slot] == handle:
			return SoundCore._players[slot]
	return null


func bus_index(bus: SoundCore.SoundBus) -> int:
	return AudioServer.get_bus_index(SoundCore._BUS_NAMES[bus])


func _on_sound_played(event: SoundPlayedEvent) -> void:
	played_buses.append(event.bus)
