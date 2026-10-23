extends "res://core/resource_core/tests/support/resource_test_case.gd"
## `apply_bundles`. Attached bundle files stay until the process ends, so every test uses its own bundle names and
## engine paths.

const BUNDLE_ROOT: String = "res://resource_core_test_bundles/"


func test_bundle_keys_load_from_the_bundle_and_the_later_bundle_wins() -> void:
	start_with_storage()
	var first_path: String = BUNDLE_ROOT + "order_first/animation.tres"
	var second_path: String = BUNDLE_ROOT + "order_second/animation.tres"
	var first_files: Dictionary[String, String] = {first_path: RESOURCES + "test_animation_a.tres"}
	var first_keys: Dictionary[String, String] = {"bundle/only_first": first_path, "bundle/both": first_path, ANIM_B: first_path}
	var first: DownloadedBundle = make_bundle("order_first", first_files, key_list_json(first_keys))
	var second_files: Dictionary[String, String] = {second_path: RESOURCES + "test_animation_b.tres"}
	var second_keys: Dictionary[String, String] = {"bundle/both": second_path}
	var second: DownloadedBundle = make_bundle("order_second", second_files, key_list_json(second_keys))
	var bundles: Array[DownloadedBundle] = [first, second]
	assert_true(ResourceCore.apply_bundles(bundles))
	var scope: Scope = ResourceCore.get_global_scope()
	var only_first: Animation = await load_animation("bundle/only_first", scope)
	assert_eq(only_first.resource_path, first_path)
	var both: Animation = await load_animation("bundle/both", scope)
	assert_eq(both.resource_path, second_path, "the later bundle's resource")
	assert_eq(both.length, 2.0)
	var replaced: Animation = await load_animation(ANIM_B, scope)
	assert_eq(replaced.resource_path, first_path, "a bundle key wins over the resource key list")
	var kept: Animation = await load_animation(ANIM_A, scope)
	assert_eq(kept.resource_path, RESOURCES + "test_animation_a.tres", "other keys use the resource key list")


func test_bundle_with_a_wrong_sha256_is_skipped() -> void:
	start_with_storage()
	var good_path: String = BUNDLE_ROOT + "hash_good/animation.tres"
	var bad_path: String = BUNDLE_ROOT + "hash_bad/animation.tres"
	var good_files: Dictionary[String, String] = {good_path: RESOURCES + "test_animation_b.tres"}
	var good_keys: Dictionary[String, String] = {"bundle/good": good_path}
	var good: DownloadedBundle = make_bundle("hash_good", good_files, key_list_json(good_keys))
	var bad_files: Dictionary[String, String] = {bad_path: RESOURCES + "test_animation_b.tres"}
	var bad_keys: Dictionary[String, String] = {"bundle/bad": bad_path}
	var bad: DownloadedBundle = make_bundle("hash_bad", bad_files, key_list_json(bad_keys))
	bad.sha256 = "0".repeat(64)
	var bundles: Array[DownloadedBundle] = [bad, good]
	assert_false(ResourceCore.apply_bundles(bundles))
	assert_errors(1, "one error naming the skipped bundle")
	var scope: Scope = ResourceCore.get_global_scope()
	var loaded: Animation = await load_animation("bundle/good", scope)
	assert_eq(loaded.resource_path, good_path, "the other bundle is applied")
	assert_true(await ResourceCore.load("bundle/bad", ANIMATION, scope) == fallback_of(ANIMATION))
	assert_errors(1, "the skipped bundle's key is unknown")


func test_bundles_with_a_bad_name_or_key_list_are_skipped() -> void:
	start_with_storage()
	var path: String = BUNDLE_ROOT + "skip_cases/animation.tres"
	var files: Dictionary[String, String] = {path: RESOURCES + "test_animation_b.tres"}
	var keys: Dictionary[String, String] = {"bundle/skip": path}
	var bad_name: DownloadedBundle = make_bundle("Skip_Name", files, key_list_json(keys))
	var bad_keys: DownloadedBundle = make_bundle("skip_bad_keys", files, "{\"bundle/skip\": 1}")
	var missing: DownloadedBundle = DownloadedBundle.new()
	missing.name = "skip_missing"
	missing.path = TEST_FOLDER + "/skip_missing.pck"
	missing.sha256 = bad_keys.sha256
	var bundles: Array[DownloadedBundle] = [bad_name, bad_keys, missing]
	var logged_before: int = log_file_text().length()
	assert_false(ResourceCore.apply_bundles(bundles))
	assert_errors(3)
	var text: String = log_file_text().substr(logged_before)
	assert_string_contains(text, "apply_bundles skipped bundle Skip_Name at " + bad_name.path)
	assert_string_contains(text, "apply_bundles skipped bundle skip_missing at " + missing.path)
	assert_string_contains(text, "apply_bundles skipped bundle skip_bad_keys at " + bad_keys.path + ": its key list")
	assert_eq(text.count("so its files stay attached"), 1, "only the bundle skipped after attaching says its files stay")
	assert_true(await ResourceCore.load("bundle/skip", ANIMATION, ResourceCore.get_global_scope()) == fallback_of(ANIMATION))
	assert_errors(1)


func test_bundle_skipped_after_attaching_keeps_its_files_over_the_same_paths() -> void:
	var path: String = BUNDLE_ROOT + "skip_attached/animation.tres"
	assert_false(ResourceLoader.exists(path), "no file at the path before the bundle")
	var keys: Dictionary[String, String] = key_paths()
	keys["base/shadowed"] = path
	start_storage_modules()
	ResourceCoreDev.set_test_key_list(keys)
	assert_true(ResourceCore.init(), "ResourceCore init")
	var files: Dictionary[String, String] = {path: RESOURCES + "test_animation_b.tres"}
	var bundle: DownloadedBundle = make_bundle("skip_attached", files, "{\"base/shadowed\": 1}")
	var bundles: Array[DownloadedBundle] = [bundle]
	var logged_before: int = log_file_text().length()
	assert_false(ResourceCore.apply_bundles(bundles))
	assert_errors(1)
	var text: String = log_file_text().substr(logged_before)
	assert_string_contains(
		text,
		(
			"apply_bundles skipped bundle skip_attached at " + bundle.path
			+ ": its key list could not be read after it was attached, so its files stay attached over the same paths"
		)
	)
	var loaded: Animation = await load_animation("base/shadowed", ResourceCore.get_global_scope())
	assert_not_null(loaded, "the base key loads the skipped bundle's file")
	if loaded != null:
		assert_eq(loaded.resource_path, path)
		assert_eq(loaded.length, 2.0)
	assert_errors(0)


func test_apply_bundles_after_a_load_fails() -> void:
	start_with_storage()
	var path: String = BUNDLE_ROOT + "late/animation.tres"
	var files: Dictionary[String, String] = {path: RESOURCES + "test_animation_b.tres"}
	var keys: Dictionary[String, String] = {"bundle/late": path, ANIM_B: path}
	var bundle: DownloadedBundle = make_bundle("late", files, key_list_json(keys))
	var scope: Scope = ResourceCore.get_global_scope()
	assert_not_null(await load_animation(ANIM_A, scope))
	var bundles: Array[DownloadedBundle] = [bundle]
	assert_false(ResourceCore.apply_bundles(bundles))
	assert_errors(1)
	var listed: Animation = await load_animation(ANIM_B, scope)
	assert_eq(listed.resource_path, RESOURCES + "test_animation_b.tres", "the bundle's key is not from the bundle")
	assert_true(await ResourceCore.load("bundle/late", ANIMATION, scope) == fallback_of(ANIMATION))
	assert_errors(1)


func test_second_apply_bundles_fails() -> void:
	start_with_storage()
	var path: String = BUNDLE_ROOT + "twice/animation.tres"
	var files: Dictionary[String, String] = {path: RESOURCES + "test_animation_b.tres"}
	var keys: Dictionary[String, String] = {"bundle/twice": path}
	var bundle: DownloadedBundle = make_bundle("twice", files, key_list_json(keys))
	var none: Array[DownloadedBundle] = []
	assert_true(ResourceCore.apply_bundles(none))
	var bundles: Array[DownloadedBundle] = [bundle]
	assert_false(ResourceCore.apply_bundles(bundles))
	assert_errors(1)
	ResourceCore.release()
	start()
	assert_true(ResourceCore.apply_bundles(bundles), "apply_bundles again after release and init")
	var loaded: Animation = await load_animation("bundle/twice", ResourceCore.get_global_scope())
	assert_eq(loaded.resource_path, path)
