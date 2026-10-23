extends "res://core/resource_core/tests/support/resource_test_case.gd"
## Keys with two or more variants: the variant file paths, the `ResourceVariants` list, its kind check, its leak check
## and the variant counts of `ResourceCoreDev.set_test_key_list`. A key with variants has the path `test_<name>.tres`
## and the files `test_<name>.1.tres` to `test_<name>.<n>.tres`.

const KEY_ENTRY = preload("res://core/resource_core/resource_key_entry.gd")

## Three animation variants of lengths 1, 2 and 3.
const VARIANT: String = "test/variant"
## Two variants: the files of `VARIANT` variants 1 and 2.
const VARIANT_TWO: String = "test/variant_two"
## Two variants; the files are `test_variant_plain.tres` and `test_variant_plain.2.tres`, so variant 1 has no file.
const VARIANT_PLAIN: String = "test/variant_plain"
## Variant 1 is an animation, variant 2 a gradient.
const VARIANT_MIXED: String = "test/variant_mixed"
## Two variants; the variant 2 file does not exist.
const VARIANT_MISSING: String = "test/variant_missing"
## Three variants in app storage; the variant 2 file exists and its engine load fails.
const VARIANT_BROKEN: String = "test/variant_broken"


## Inits `ResourceCore` with the test key list and the variant keys.
func start_with_variants() -> void:
	var keys: Dictionary[String, String] = key_paths()
	keys[VARIANT] = RESOURCES + "test_variant.tres"
	keys[VARIANT_TWO] = RESOURCES + "test_variant.tres"
	keys[VARIANT_PLAIN] = RESOURCES + "test_variant_plain.tres"
	keys[VARIANT_MIXED] = RESOURCES + "test_variant_mixed.tres"
	keys[VARIANT_MISSING] = RESOURCES + "test_variant_missing.tres"
	var variants: Dictionary[String, int] = {
		VARIANT: 3, VARIANT_TWO: 2, VARIANT_PLAIN: 2, VARIANT_MIXED: 2, VARIANT_MISSING: 2
	}
	ResourceCoreDev.set_test_key_list(keys, variants)
	assert_true(ResourceCore.init(), "ResourceCore init")


func test_a_key_with_variants_loads_its_variant_files_in_variant_order() -> void:
	start_with_variants()
	var scope: Scope = new_scope("lobby")
	var resource: Resource = await ResourceCore.load(VARIANT, ANIMATION, scope)
	assert_true(resource is ResourceVariants, "a resource list")
	var variants: ResourceVariants = resource as ResourceVariants
	if variants == null:
		return
	var paths: PackedStringArray = PackedStringArray(
		[RESOURCES + "test_variant.1.tres", RESOURCES + "test_variant.2.tres", RESOURCES + "test_variant.3.tres"]
	)
	_assert_variant_files(variants, paths)
	assert_eq(ResourceCore._engine_load_count, 1, "one engine load of the key")
	assert_true(ResourceCore.is_loaded(VARIANT, ANIMATION))
	assert_false(ResourceCore.is_loaded(VARIANT, TEXTURE), "another kind")
	assert_true(ResourceCore.get_loaded(VARIANT, ANIMATION, scope) == variants, "the cached list")
	var other: Scope = new_scope("battle")
	assert_true(await ResourceCore.load(VARIANT, ANIMATION, other) == variants, "one list per key")
	assert_eq(ResourceCore._engine_load_count, 1)
	assert_eq(reference_count(VARIANT), 2)
	assert_errors(0)


func test_a_key_with_two_variants_loads_both_variant_files() -> void:
	start_with_variants()
	assert_false(ResourceLoader.exists(RESOURCES + "test_variant.tres"), "the key path is not a file")
	var resource: Resource = await ResourceCore.load(VARIANT_TWO, ANIMATION, new_scope("lobby"))
	assert_true(resource is ResourceVariants, "a resource list")
	var variants: ResourceVariants = resource as ResourceVariants
	if variants == null:
		return
	var paths: PackedStringArray = PackedStringArray(
		[RESOURCES + "test_variant.1.tres", RESOURCES + "test_variant.2.tres"]
	)
	_assert_variant_files(variants, paths)
	assert_true(ResourceCore.is_loaded(VARIANT_TWO, ANIMATION))
	assert_errors(0)


func test_variant_1_is_not_the_key_path() -> void:
	start_with_variants()
	assert_true(ResourceLoader.exists(RESOURCES + "test_variant_plain.tres"), "a file at the key path")
	assert_true(ResourceLoader.exists(RESOURCES + "test_variant_plain.2.tres"), "the variant 2 file")
	var logged_before: int = log_file_text().length()
	assert_true(await ResourceCore.load(VARIANT_PLAIN, ANIMATION, new_scope("lobby")) == fallback_of(ANIMATION))
	assert_errors(1)
	var text: String = log_file_text().substr(logged_before)
	assert_string_contains(text, "engine load failed, no file: " + RESOURCES + "test_variant_plain.1.tres")
	assert_eq(ResourceCore._engine_load_count, 0, "no engine load starts")
	assert_false(ResourceCore.is_loaded(VARIANT_PLAIN, ANIMATION))


func test_variant_paths_put_the_variant_number_from_1_before_the_extension() -> void:
	assert_eq(
		ResourceCore._variant_paths(_key_entry("res://resource/sfx/hit.wav", 1)),
		PackedStringArray(["res://resource/sfx/hit.wav"]),
		"a key with one variant"
	)
	assert_eq(
		ResourceCore._variant_paths(_key_entry("res://resource/sfx/hit.wav", 2)),
		PackedStringArray(["res://resource/sfx/hit.1.wav", "res://resource/sfx/hit.2.wav"])
	)
	assert_eq(
		ResourceCore._variant_paths(_key_entry("res://resource/sfx/ui_click.wav", 3)),
		PackedStringArray(
			[
				"res://resource/sfx/ui_click.1.wav",
				"res://resource/sfx/ui_click.2.wav",
				"res://resource/sfx/ui_click.3.wav",
			]
		)
	)
	assert_eq(
		ResourceCore._variant_paths(_key_entry("res://resource/haptic/hit", 2)),
		PackedStringArray(["res://resource/haptic/hit.1", "res://resource/haptic/hit.2"]),
		"a path without an extension"
	)


func test_loads_of_a_loading_key_with_variants_share_one_list() -> void:
	start_with_variants()
	var scene: Scope = new_scope("lobby")
	var panel: Scope = ResourceCore.create_scope(ResourceCore.ScopeKind.PANEL, "shop")
	var first: RUNNER = start_load(VARIANT, ANIMATION, scene)
	var second: RUNNER = start_load(VARIANT, ANIMATION, panel)
	assert_false(first.done or second.done, "the loads wait for the engine loads")
	await first.wait()
	await second.wait()
	assert_true(first.resource is ResourceVariants)
	assert_true(second.resource == first.resource)
	assert_eq(ResourceCore._engine_load_count, 1)
	assert_eq(reference_count(VARIANT), 2)


func test_a_variant_of_another_kind_fails_the_kind_check() -> void:
	start_with_variants()
	var scope: Scope = new_scope("lobby")
	assert_true(await ResourceCore.load(VARIANT_MIXED, ANIMATION, scope) == fallback_of(ANIMATION), "one fallback")
	assert_errors(1)
	assert_false(ResourceCore.is_loaded(VARIANT_MIXED, ANIMATION))
	assert_eq(reference_count(VARIANT_MIXED), 0)
	assert_true(await ResourceCore.load(VARIANT_MIXED, ANIMATION, scope) == fallback_of(ANIMATION))
	assert_errors(0, "one log per key")
	var kept: Resource = await ResourceCore.load(VARIANT, ANIMATION, scope)
	assert_true(kept is ResourceVariants)
	assert_true(ResourceCore.get_loaded(VARIANT, TEXTURE, scope) == fallback_of(TEXTURE), "a cached list as another kind")
	assert_errors(1)
	assert_false(ResourceCore.is_loaded(VARIANT, TEXTURE))


func test_a_missing_variant_file_gives_the_fallback() -> void:
	start_with_variants()
	assert_true(ResourceLoader.exists(RESOURCES + "test_variant_missing.1.tres"), "variant 1 exists")
	assert_false(ResourceLoader.exists(RESOURCES + "test_variant_missing.2.tres"), "variant 2 does not")
	var scope: Scope = new_scope("lobby")
	assert_true(await ResourceCore.load(VARIANT_MISSING, ANIMATION, scope) == fallback_of(ANIMATION))
	assert_errors(1)
	assert_true(await ResourceCore.load(VARIANT_MISSING, ANIMATION, scope) == fallback_of(ANIMATION))
	assert_errors(0, "one log per key")
	assert_eq(ResourceCore._engine_load_count, 0, "no engine load starts")
	assert_true(ResourceCore._loading.is_empty())
	assert_false(ResourceCore.is_loaded(VARIANT_MISSING, ANIMATION))


func test_a_variant_file_whose_engine_load_fails_gives_the_fallback() -> void:
	var folder: String = TEST_FOLDER + "/variant_broken/"
	write_storage_file(folder + "animation.1.tres", _animation_text("1.0"))
	write_storage_file(folder + "animation.2.tres", "[gd_resource type=\"Animation\" format=3]\n\n[resource]\nlength = \n")
	write_storage_file(folder + "animation.3.tres", _animation_text("3.0"))
	var path: String = CoreBuildInfo.storage_root + folder + "animation.tres"
	var broken: String = CoreBuildInfo.storage_root + folder + "animation.2.tres"
	assert_true(ResourceLoader.exists(broken), "the variant 2 file exists")
	var keys: Dictionary[String, String] = key_paths()
	keys[VARIANT_BROKEN] = path
	var variants: Dictionary[String, int] = {VARIANT_BROKEN: 3}
	start_storage_modules()
	ResourceCoreDev.set_test_key_list(keys, variants)
	assert_true(ResourceCore.init(), "ResourceCore init")
	var scope: Scope = new_scope("lobby")
	var logged_before: int = log_file_text().length()
	# The engine prints the parse error of the broken file it was asked to load as an engine error line, which fails
	# the run. Only these two loads read the broken file, so engine error printing is off for them alone.
	Engine.print_error_messages = false
	var first: Resource = await ResourceCore.load(VARIANT_BROKEN, ANIMATION, scope)
	var second: Resource = await ResourceCore.load(VARIANT_BROKEN, ANIMATION, scope)
	Engine.print_error_messages = true
	assert_true(first == fallback_of(ANIMATION), "the fallback, not a list of the loaded variants")
	assert_true(second == fallback_of(ANIMATION))
	assert_eq(ResourceCore._engine_load_count, 2, "the engine loads started")
	assert_errors(1, "one log per key")
	var text: String = log_file_text().substr(logged_before)
	assert_string_contains(text, "engine load failed: " + broken)
	assert_false(ResourceCore.is_loaded(VARIANT_BROKEN, ANIMATION))
	assert_false(ResourceCore._cache.has(VARIANT_BROKEN), "no cache entry")
	assert_eq(reference_count(VARIANT_BROKEN), 0)
	assert_true(ResourceCore._loading.is_empty())


func test_set_test_key_list_sets_the_variant_counts() -> void:
	start_with_variants()
	assert_eq(ResourceCore._key_list[VARIANT].variants, 3)
	assert_eq(ResourceCore._key_list[VARIANT].path, RESOURCES + "test_variant.tres", "the key path as given")
	assert_eq(ResourceCore._key_list[VARIANT_MIXED].variants, 2)
	assert_eq(ResourceCore._key_list[ANIM_A].variants, 1, "a key not in variants has one variant")
	var single: Resource = await ResourceCore.load(ANIM_A, ANIMATION, new_scope("lobby"))
	assert_true(single is Animation and single != fallback_of(ANIMATION), "a key with one variant loads one resource")
	var other: Dictionary[String, int] = {ANIM_A: 2}
	ResourceCoreDev.set_test_key_list(key_paths(), other)
	assert_errors(1, "set_test_key_list after init")
	assert_false(ResourceCore._test_variants.has(ANIM_A), "the variant counts did not change")
	ResourceCore.release()
	assert_true(ResourceCore._test_variants.is_empty(), "release clears the variant counts")


func test_variant_referenced_after_its_list_left_the_cache_is_a_leak() -> void:
	start_with_variants()
	var scope: Scope = new_scope("lobby")
	var variants: ResourceVariants = await ResourceCore.load(VARIANT, ANIMATION, scope) as ResourceVariants
	assert_not_null(variants)
	if variants == null:
		return
	var held: Resource = variants.items[1]
	variants = null
	ResourceCore.release_scope(scope)
	assert_eq(ResourceCore._leaks.size(), 3, "every variant is watched")
	await wait_leak_check()
	assert_errors(1, "the held variant is a leak")
	held = null


func test_is_loaded_and_get_loaded_of_a_held_key_with_variants_allocate_no_memory() -> void:
	start_with_variants()
	var scope: Scope = new_scope("lobby")
	assert_true(await ResourceCore.load(VARIANT, ANIMATION, scope) is ResourceVariants)
	LogCore.release()
	for i: int in 100:
		_query_held_key(scope)
	var objects: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	for i: int in 1000:
		_query_held_key(scope)
	var objects_after: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory_after: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	assert_true(objects_after <= objects, "no new object")
	assert_true(memory_after <= memory, "no new static memory")
	assert_eq(reference_count(VARIANT), 1)


func _query_held_key(scope: Scope) -> void:
	ResourceCore.is_loaded(VARIANT, ANIMATION)
	ResourceCore.is_loaded(VARIANT, TEXTURE)
	ResourceCore.get_loaded(VARIANT, ANIMATION, scope)


## Checks `variants` holds an animation of length `<n>` from file `paths[<n> - 1]` for every variant `<n>`.
func _assert_variant_files(variants: ResourceVariants, paths: PackedStringArray) -> void:
	assert_eq(variants.items.size(), paths.size())
	for index: int in mini(variants.items.size(), paths.size()):
		var item: Animation = variants.items[index] as Animation
		assert_not_null(item, "variant %d is an animation" % (index + 1))
		if item == null:
			continue
		assert_eq(item.resource_path, paths[index], "variant %d file" % (index + 1))
		assert_eq(item.length, float(index + 1))


## Key list entry of `path` with `variants` variants.
func _key_entry(path: String, variants: int) -> KEY_ENTRY:
	var entry: KEY_ENTRY = KEY_ENTRY.new()
	entry.path = path
	entry.variants = variants
	return entry


## Text of an animation resource file of `length`.
func _animation_text(length: String) -> String:
	return "[gd_resource type=\"Animation\" format=3]\n\n[resource]\nlength = " + length + "\n"
