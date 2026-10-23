extends "res://core/sound_core/tests/support/sound_test_case.gd"
## Bus volume, mute and their local data.


func test_volume_1_half_and_0_give_0_db_minus_6_02_db_and_silence() -> void:
	assert_true(await start_modules())
	var index: int = bus_index(SoundCore.SoundBus.SFX)
	SoundCore.set_volume(SoundCore.SoundBus.SFX, 1.0)
	assert_almost_eq(AudioServer.get_bus_volume_db(index), 0.0, 0.0001)
	assert_false(AudioServer.is_bus_mute(index))
	SoundCore.set_volume(SoundCore.SoundBus.SFX, 0.5)
	assert_almost_eq(AudioServer.get_bus_volume_db(index), -6.02, 0.01)
	assert_false(AudioServer.is_bus_mute(index))
	SoundCore.set_volume(SoundCore.SoundBus.SFX, 0.0)
	assert_true(AudioServer.is_bus_mute(index), "volume 0 is silent")
	assert_eq(SoundCore.get_volume(SoundCore.SoundBus.SFX), 0.0)


func test_bgm_sfx_voice_and_ui_buses_send_to_master() -> void:
	assert_true(await start_modules())
	for bus: int in range(SoundCore.SoundBus.BGM, SoundCore._BUS_NAMES.size()):
		var index: int = bus_index(bus as SoundCore.SoundBus)
		assert_ne(index, -1)
		assert_eq(AudioServer.get_bus_send(index), SoundCore._BUS_NAMES[SoundCore.SoundBus.MASTER])


func test_mute_of_a_bus_at_0_3_silences_it_and_unmute_brings_0_3_back() -> void:
	assert_true(await start_modules())
	var index: int = bus_index(SoundCore.SoundBus.VOICE)
	SoundCore.set_volume(SoundCore.SoundBus.VOICE, 0.3)
	SoundCore.set_mute(SoundCore.SoundBus.VOICE, true)
	assert_true(AudioServer.is_bus_mute(index))
	assert_true(SoundCore.get_mute(SoundCore.SoundBus.VOICE))
	assert_eq(SoundCore.get_volume(SoundCore.SoundBus.VOICE), 0.3, "mute keeps the volume")
	SoundCore.set_mute(SoundCore.SoundBus.VOICE, false)
	assert_false(AudioServer.is_bus_mute(index))
	assert_almost_eq(AudioServer.get_bus_volume_db(index), linear_to_db(0.3), 0.0001)


func test_volume_out_of_range_and_nan_apply_the_nearest_value_with_an_error() -> void:
	assert_true(await start_modules())
	SoundCore.set_volume(SoundCore.SoundBus.UI, -0.5)
	assert_eq(SoundCore.get_volume(SoundCore.SoundBus.UI), 0.0)
	SoundCore.set_volume(SoundCore.SoundBus.UI, 1.5)
	assert_eq(SoundCore.get_volume(SoundCore.SoundBus.UI), 1.0)
	SoundCore.set_volume(SoundCore.SoundBus.UI, 0.2)
	SoundCore.set_volume(SoundCore.SoundBus.UI, NAN)
	assert_eq(SoundCore.get_volume(SoundCore.SoundBus.UI), 1.0)
	assert_eq(errors(), 3)


func test_bus_outside_sound_bus_changes_nothing_and_queries_give_failure_values() -> void:
	assert_true(await start_modules())
	SoundCore.set_volume(7 as SoundCore.SoundBus, 0.5)
	SoundCore.set_mute(-1 as SoundCore.SoundBus, true)
	assert_eq(SoundCore.get_volume(7 as SoundCore.SoundBus), 1.0)
	assert_false(SoundCore.get_mute(7 as SoundCore.SoundBus))
	for bus: int in SoundCore._BUS_NAMES.size():
		assert_eq(SoundCore.get_volume(bus as SoundCore.SoundBus), 1.0)
		assert_false(SoundCore.get_mute(bus as SoundCore.SoundBus))
	assert_eq(errors(), 4)


func test_set_values_are_saved_and_load_volume_settings_restores_them() -> void:
	assert_true(await start_modules())
	SoundCore.set_volume(SoundCore.SoundBus.MASTER, 0.8)
	SoundCore.set_volume(SoundCore.SoundBus.BGM, 0.4)
	SoundCore.set_mute(SoundCore.SoundBus.SFX, true)
	SoundCore.set_haptic_enabled(false)
	var device: LocalDataCore.FileKind = LocalDataCore.FileKind.DEVICE
	assert_eq(LocalDataCore.get_value_float(device, "SoundCore.master_volume", 1.0), 0.8)
	assert_eq(LocalDataCore.get_value_float(device, "SoundCore.bgm_volume", 1.0), 0.4)
	assert_true(LocalDataCore.get_value_bool(device, "SoundCore.sfx_mute", false))
	assert_false(LocalDataCore.get_value_bool(device, "SoundCore.haptic_enabled", true))
	SoundCore.release()
	assert_true(SoundCore.init())
	assert_eq(SoundCore.get_volume(SoundCore.SoundBus.BGM), 1.0, "default before load_volume_settings")
	SoundCore.load_volume_settings()
	assert_eq(SoundCore.get_volume(SoundCore.SoundBus.MASTER), 0.8)
	assert_eq(SoundCore.get_volume(SoundCore.SoundBus.BGM), 0.4)
	assert_true(SoundCore.get_mute(SoundCore.SoundBus.SFX))
	assert_false(SoundCore.get_mute(SoundCore.SoundBus.UI))
	assert_false(SoundCore.is_haptic_enabled())
	assert_almost_eq(AudioServer.get_bus_volume_db(bus_index(SoundCore.SoundBus.BGM)), linear_to_db(0.4), 0.0001)
	assert_true(AudioServer.is_bus_mute(bus_index(SoundCore.SoundBus.SFX)))


func test_saved_volume_out_of_range_or_nan_loads_the_default_without_log() -> void:
	assert_true(await start_modules())
	var device: LocalDataCore.FileKind = LocalDataCore.FileKind.DEVICE
	LocalDataCore.set_value_float(device, "SoundCore.sfx_volume", 1.5)
	LocalDataCore.set_value_float(device, "SoundCore.voice_volume", -0.1)
	LocalDataCore.set_value_float(device, "SoundCore.ui_volume", NAN)
	SoundCore.load_volume_settings()
	assert_eq(SoundCore.get_volume(SoundCore.SoundBus.SFX), 1.0)
	assert_eq(SoundCore.get_volume(SoundCore.SoundBus.VOICE), 1.0)
	assert_eq(SoundCore.get_volume(SoundCore.SoundBus.UI), 1.0)
	assert_eq(errors(), 0)
