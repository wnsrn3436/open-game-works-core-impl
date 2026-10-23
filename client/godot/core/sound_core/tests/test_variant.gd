extends "res://core/sound_core/tests/support/sound_test_case.gd"
## Variant choice for a resource key with variants.


## Loads `VARIANT` into `scope` and returns its variant items in variant order. Async.
func load_variants() -> Array[Resource]:
	var resource: Resource = await ResourceCore.load(VARIANT, KIND, scope)
	var variants: ResourceVariants = resource as ResourceVariants
	assert_not_null(variants, "a key with 3 variants loads as a ResourceVariants")
	if variants == null:
		return []
	assert_eq(variants.items.size(), VARIANT_COUNT)
	return variants.items


## Variant index of the stream the player of `handle` plays: its position in `items`, -1 when it is none of them.
func variant_of(handle: int, items: Array[Resource]) -> int:
	var player: AudioStreamPlayer = player_of(handle)
	if player == null:
		return -1
	return items.find(player.stream)


func test_100_plays_of_a_key_with_3_variants_never_repeat_and_play_every_variant() -> void:
	assert_true(await start_modules())
	var items: Array[Resource] = await load_variants()
	var seen: Array[bool] = [false, false, false]
	var last: int = -1
	for index: int in 100:
		var handle: int = SoundCore.play(VARIANT, SoundCore.SoundBus.SFX, scope)
		assert_ne(handle, SoundCore.INVALID_HANDLE, "a loaded key with variants plays")
		var variant: int = variant_of(handle, items)
		assert_true(variant >= 0, "the player plays one of the variants")
		assert_ne(variant, last, "two plays in a row have different variants")
		if variant >= 0:
			seen[variant] = true
		last = variant
		SoundCore.stop(handle)
	var all_seen: Array[bool] = [true, true, true]
	assert_eq(seen, all_seen)
	assert_eq(played_buses.size(), 100, "SoundPlayedEvent for every play")
	assert_eq(errors(), 0)


func test_play_of_a_key_with_variants_not_loaded_plays_a_variant_after_loading() -> void:
	assert_true(await start_modules())
	var handle: int = SoundCore.play(VARIANT, SoundCore.SoundBus.SFX, scope)
	assert_ne(handle, SoundCore.INVALID_HANDLE)
	assert_eq(UnitTestCore.check_logs("warn", SoundCore._TAG), 1, "warn in a build with DEV code")
	await wait_load_end(VARIANT)
	var items: Array[Resource] = await load_variants()
	assert_true(variant_of(handle, items) >= 0, "the player plays one of the variants")
	assert_eq(played_buses, PackedInt32Array([SoundCore.SoundBus.SFX]))
	assert_eq(errors(), 0)


func test_play_bgm_of_a_key_with_variants_plays() -> void:
	assert_true(await start_modules())
	await load_variants()
	SoundCore.play_bgm(VARIANT, scope)
	await wait_load_end(VARIANT)
	assert_eq(SoundCore.get_bgm_key(), VARIANT)
	assert_not_null(channel_of(VARIANT))
	assert_true(channel_of(VARIANT).player.playing)
	assert_eq(errors(), 0)


func test_one_variant_is_always_variant_0() -> void:
	assert_true(await start_modules())
	for index: int in 5:
		assert_eq(SoundCore._choose_variant(SHORT, 1), 0)
