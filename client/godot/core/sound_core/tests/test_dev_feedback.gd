extends "res://core/sound_core/tests/support/sound_test_case.gd"
## DEV mute and play skip, which QACore holds while feedback is off or a reward window is open.

const POSITIONAL_GROUP: StringName = &"ogw_positional_sound"

var _positional: AudioStreamPlayer2D = null


func after_each() -> void:
	super()
	if is_instance_valid(_positional):
		_positional.queue_free()
	_positional = null


func test_dev_mute_silences_sfx_and_its_positional_players_and_keeps_mute_saved_values_and_plays() -> void:
	assert_true(await start_modules())
	await load_sound(LOOP_A)
	await load_sound(LOOP_B)
	var device: LocalDataCore.FileKind = LocalDataCore.FileKind.DEVICE
	var index: int = bus_index(SoundCore.SoundBus.SFX)
	SoundCore.set_volume(SoundCore.SoundBus.SFX, 0.3)
	SoundCore.set_mute(SoundCore.SoundBus.SFX, false)
	_positional = AudioStreamPlayer2D.new()
	_positional.bus = &"Sfx"
	_positional.stream = ResourceCore.get_loaded(LOOP_A, KIND, scope) as AudioStream
	_positional.add_to_group(POSITIONAL_GROUP)
	add_child(_positional)
	_positional.play()
	SoundCoreDev.set_dev_mute(SoundCore.SoundBus.SFX, true)
	assert_true(AudioServer.is_bus_mute(index), "Sfx and the positional player on it are silent")
	assert_eq(_positional.bus, &"Sfx")
	assert_false(SoundCore.get_mute(SoundCore.SoundBus.SFX), "get_mute is unchanged")
	assert_false(LocalDataCore.get_value_bool(device, "SoundCore.sfx_mute", true), "saved mute is unchanged")
	assert_eq(LocalDataCore.get_value_float(device, "SoundCore.sfx_volume", 1.0), 0.3, "saved volume is unchanged")
	assert_false(AudioServer.is_bus_mute(bus_index(SoundCore.SoundBus.UI)), "other buses are not muted")
	var handle: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope)
	assert_ne(handle, SoundCore.INVALID_HANDLE)
	assert_true(SoundCore.is_playing(handle))
	assert_eq(playing_keys(), PackedStringArray([LOOP_A]))
	assert_eq(played_buses.size(), 0, "no SoundPlayedEvent on a bus with DEV mute")
	assert_ne(SoundCore.play(LOOP_B, SoundCore.SoundBus.UI, scope), SoundCore.INVALID_HANDLE)
	assert_eq(played_buses, PackedInt32Array([SoundCore.SoundBus.UI]))
	SoundCore.set_mute(SoundCore.SoundBus.SFX, false)
	assert_true(AudioServer.is_bus_mute(index), "set_mute does not lift DEV mute")
	SoundCore.load_volume_settings()
	assert_true(AudioServer.is_bus_mute(index), "load_volume_settings does not lift DEV mute")
	SoundCoreDev.set_dev_mute(SoundCore.SoundBus.SFX, false)
	assert_false(AudioServer.is_bus_mute(index))
	assert_almost_eq(AudioServer.get_bus_volume_db(index), linear_to_db(0.3), 0.0001, "back at the level of 0.3")
	SoundCore.set_mute(SoundCore.SoundBus.SFX, true)
	SoundCoreDev.set_dev_mute(SoundCore.SoundBus.SFX, true)
	SoundCoreDev.set_dev_mute(SoundCore.SoundBus.SFX, false)
	assert_true(AudioServer.is_bus_mute(index), "lifting DEV mute keeps the mute of set_mute")
	SoundCore.set_mute(SoundCore.SoundBus.SFX, false)
	assert_ne(SoundCore.play(LOOP_B, SoundCore.SoundBus.SFX, scope), SoundCore.INVALID_HANDLE)
	assert_eq(played_buses, PackedInt32Array([SoundCore.SoundBus.UI, SoundCore.SoundBus.SFX]))


func test_dev_mute_decides_the_played_event_when_the_playback_starts() -> void:
	assert_true(await start_modules())
	var handle: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope)
	UnitTestCore.check_logs("warn", SoundCore._TAG)
	SoundCoreDev.set_dev_mute(SoundCore.SoundBus.SFX, true)
	await wait_load_end(LOOP_A)
	assert_true(SoundCore.is_playing(handle))
	assert_eq(playing_keys(), PackedStringArray([LOOP_A]), "plays as usual")
	assert_eq(played_buses.size(), 0, "started on a bus with DEV mute: no SoundPlayedEvent")
	SoundCoreDev.set_dev_mute(SoundCore.SoundBus.SFX, false)
	assert_eq(played_buses.size(), 0, "turning DEV mute off publishes nothing for a playback already started")


func test_dev_mute_of_a_bus_outside_sound_bus_logs_an_error_and_release_turns_dev_mute_off() -> void:
	assert_true(await start_modules())
	SoundCoreDev.set_dev_mute(7 as SoundCore.SoundBus, true)
	SoundCoreDev.set_dev_mute(-1 as SoundCore.SoundBus, true)
	assert_eq(errors(), 2)
	SoundCoreDev.set_dev_mute(SoundCore.SoundBus.SFX, true)
	SoundCoreDev.set_dev_mute(SoundCore.SoundBus.UI, true)
	SoundCore.release()
	SoundCoreDev.set_dev_mute(SoundCore.SoundBus.SFX, true)
	assert_eq(errors(), 1, "after release")
	assert_true(SoundCore.init())
	for bus: int in SoundCore._BUS_NAMES.size():
		assert_false(SoundCore._dev_mutes[bus], "no DEV mute after init")
		assert_false(AudioServer.is_bus_mute(bus_index(bus as SoundCore.SoundBus)))
	await load_sound(LOOP_A)
	SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope)
	assert_eq(played_buses, PackedInt32Array([SoundCore.SoundBus.SFX]))


func test_play_skip_returns_the_invalid_handle_without_load_log_or_event_and_keeps_earlier_plays() -> void:
	assert_true(await start_modules())
	await load_sound(LOOP_A)
	var before: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope)
	var loading: int = SoundCore.play(LOOP_C, SoundCore.SoundBus.VOICE, scope)
	assert_eq(UnitTestCore.check_logs("warn", SoundCore._TAG), 1)
	SoundCoreDev.set_play_skip(true)
	assert_eq(SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope), SoundCore.INVALID_HANDLE, "loaded")
	assert_eq(SoundCore.play(LOOP_B, SoundCore.SoundBus.UI, scope), SoundCore.INVALID_HANDLE, "not loaded")
	assert_eq(UnitTestCore.check_logs("warn", SoundCore._TAG), 0, "no log")
	await wait_load_end(LOOP_C)
	await UnitTestCore.wait_frames(2)
	assert_false(ResourceCoreDev.list_loaded_resources().has(LOOP_B), "no loading started")
	assert_true(SoundCore._pending.is_empty())
	assert_true(SoundCore.is_playing(before), "a playback started before goes on")
	assert_true(SoundCore.is_playing(loading), "a request made before plays as usual")
	assert_eq(playing_keys(), PackedStringArray([LOOP_A, LOOP_C]))
	assert_eq(played_buses, PackedInt32Array([SoundCore.SoundBus.SFX, SoundCore.SoundBus.VOICE]))
	assert_eq(SoundCore.play(LOOP_A, SoundCore.SoundBus.BGM, scope), SoundCore.INVALID_HANDLE)
	assert_eq(errors(), 1, "the bus check still logs")
	assert_eq(SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, null), SoundCore.INVALID_HANDLE)
	assert_eq(errors(), 1, "the scope check still logs for a missing scope")
	var released: Scope = ResourceCore.create_scope(ResourceCore.ScopeKind.PANEL, "sound_test_released")
	ResourceCore.release_scope(released)
	assert_eq(SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, released), SoundCore.INVALID_HANDLE)
	assert_eq(errors(), 1, "the scope check still logs for a released scope")
	SoundCoreDev.set_play_skip(false)
	var after: int = SoundCore.play(LOOP_A, SoundCore.SoundBus.UI, scope)
	assert_ne(after, SoundCore.INVALID_HANDLE)
	assert_true(SoundCore.is_playing(after))
	assert_eq(played_buses.size(), 3)
	assert_eq(played_buses[2], SoundCore.SoundBus.UI)


func test_release_turns_play_skip_off() -> void:
	assert_true(await start_modules())
	await load_sound(LOOP_A)
	SoundCoreDev.set_play_skip(true)
	SoundCore.release()
	SoundCoreDev.set_play_skip(true)
	assert_eq(errors(), 1, "after release")
	assert_true(SoundCore.init())
	assert_ne(SoundCore.play(LOOP_A, SoundCore.SoundBus.SFX, scope), SoundCore.INVALID_HANDLE)
	assert_eq(played_buses, PackedInt32Array([SoundCore.SoundBus.SFX]))
