extends "res://core/resource_core/tests/support/resource_test_case.gd"
## The leak check of builds with DEV code.


func test_resource_referenced_after_it_left_the_cache_is_a_leak() -> void:
	assert_true(CoreBuildInfo.has_dev_code, "the core project holds DEV code")
	start()
	var scope: Scope = new_scope("lobby")
	var holder: Sprite2D = Sprite2D.new()
	holder.texture = await ResourceCore.load(TEX, TEXTURE, scope) as Texture2D
	ResourceCore.release_scope(scope)
	var drop_frame: int = Engine.get_process_frames()
	assert_eq(ResourceCore._leaks.size(), 1)
	await wait_process_frame(drop_frame + 1)
	assert_errors(0, "no leak check in the frame of the drop")
	await wait_process_frame(drop_frame + 2)
	assert_errors(1, "the leak error names the key and the scope, at the end of the frame after the drop")
	assert_true(ResourceCore._leaks.is_empty())
	holder.free()


func test_resource_freed_by_a_deletion_queued_in_the_frame_of_the_drop_is_not_a_leak() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	var holder: Sprite2D = Sprite2D.new()
	get_tree().root.add_child(holder)
	holder.texture = await ResourceCore.load(TEX, TEXTURE, scope) as Texture2D
	ResourceCore.release_scope(scope)
	holder.queue_free()
	await wait_leak_check()
	assert_errors(0)


func test_dropped_resource_is_not_a_leak() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	var holder: Sprite2D = Sprite2D.new()
	holder.texture = await ResourceCore.load(TEX, TEXTURE, scope) as Texture2D
	holder.texture = null
	holder.free()
	ResourceCore.release_scope(scope)
	await wait_leak_check()
	assert_errors(0)


func test_resource_cached_again_is_not_a_leak() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	var holder: Sprite2D = Sprite2D.new()
	holder.texture = await ResourceCore.load(TEX, TEXTURE, scope) as Texture2D
	ResourceCore.release_scope(scope)
	var again: Scope = new_scope("battle")
	assert_true(await ResourceCore.load(TEX, TEXTURE, again) == holder.texture, "Godot gives the living resource")
	await wait_leak_check()
	assert_errors(0)
	holder.free()


func test_sound_stopped_in_the_frame_of_the_drop_is_not_a_leak() -> void:
	start()
	var scope: Scope = new_scope("battle")
	var player: AudioStreamPlayer = play_sound(await ResourceCore.load(SOUND, AUDIO, scope) as AudioStream)
	await UnitTestCore.wait_frames(3)
	assert_true(player.playing)
	player.stop()
	player.stream = null
	ResourceCore.release_scope(scope)
	await wait_leak_check()
	assert_errors(0, "the audio server let go of the stopped playback at the frame end after its mix")
	player.free()


func test_sound_a_living_player_holds_is_a_leak_after_the_audio_mix() -> void:
	start()
	var scope: Scope = new_scope("battle")
	var player: AudioStreamPlayer = play_sound(await ResourceCore.load(SOUND, AUDIO, scope) as AudioStream)
	await UnitTestCore.wait_frames(3)
	player.stop()
	ResourceCore.release_scope(scope)
	assert_true(ResourceCore._leaks[0].audio)
	assert_eq(ResourceCore._leaks[0].mixed_frame, -1)
	await wait_leak_check()
	assert_errors(1, "the player still holds the stream")
	player.free()


func test_release_judges_a_leak_whose_frame_ended() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	var holder: Sprite2D = Sprite2D.new()
	holder.texture = await ResourceCore.load(TEX, TEXTURE, scope) as Texture2D
	ResourceCore.release_scope(scope)
	await wait_process_frame(Engine.get_process_frames() + 1)
	ResourceCore.release()
	assert_errors(1, "the leak right before release is reported")
	assert_true(ResourceCore._leaks.is_empty())
	holder.free()


func test_release_judges_a_sound_after_its_audio_mix() -> void:
	start()
	var scope: Scope = new_scope("battle")
	var player: AudioStreamPlayer = play_sound(await ResourceCore.load(SOUND, AUDIO, scope) as AudioStream)
	await UnitTestCore.wait_frames(3)
	player.stop()
	ResourceCore.release_scope(scope)
	await wait_audio_mix()
	assert_errors(0, "not judged before the frame end after the mix")
	assert_eq(ResourceCore._leaks.size(), 1)
	ResourceCore.release()
	assert_errors(1, "the sound a living player holds is reported")
	player.free()


func test_release_does_not_judge_a_resource_before_its_wait_ended() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	var holder: Sprite2D = Sprite2D.new()
	get_tree().root.add_child(holder)
	holder.texture = await ResourceCore.load(TEX, TEXTURE, scope) as Texture2D
	ResourceCore.release_scope(scope)
	holder.queue_free()
	ResourceCore.release()
	assert_errors(0, "the deletion queued in the frame of the drop has not run")
	assert_true(ResourceCore._leaks.is_empty())


func test_resource_a_cached_resource_references_in_its_file_is_not_a_leak() -> void:
	start()
	var scene_scope: Scope = new_scope("lobby")
	var texture_scope: Scope = new_scope("battle")
	assert_not_null(await ResourceCore.load(PREFAB_WITH_TEXTURE, SCENE, scene_scope) as PackedScene)
	assert_ne(await ResourceCore.load(TEX, TEXTURE, texture_scope), fallback_of(TEXTURE))
	var texture_path: String = RESOURCES + "test_texture.tres"
	assert_true(ResourceCore._cached_dependencies.has(texture_path), "the scene file's references are read on caching")
	ResourceCore.release_scope(texture_scope)
	assert_eq(ResourceCore._leaks.size(), 1)
	var alive: Object = ResourceCore._leaks[0].reference.get_ref()
	assert_true(alive != null, "the cached scene holds the texture")
	alive = null
	await wait_leak_check()
	assert_errors(0, "the cached scene references the texture in its file")
	ResourceCore.release_scope(scene_scope)
	assert_true(ResourceCore._cached_dependencies.is_empty(), "the scene's references left with it")
	assert_true(ResourceCore._cached_resources.is_empty())
	await wait_leak_check()
	assert_errors(0)


func test_resource_a_scene_left_the_cache_references_is_a_leak() -> void:
	start()
	var scene_scope: Scope = new_scope("lobby")
	var texture_scope: Scope = new_scope("battle")
	assert_not_null(await ResourceCore.load(PREFAB_WITH_TEXTURE, SCENE, scene_scope) as PackedScene)
	var holder: Sprite2D = Sprite2D.new()
	holder.texture = await ResourceCore.load(TEX, TEXTURE, texture_scope) as Texture2D
	ResourceCore.release_scope(scene_scope)
	ResourceCore.release_scope(texture_scope)
	await wait_leak_check()
	assert_errors(1, "the texture a living sprite holds, once the scene that referenced it left the cache")
	holder.free()
