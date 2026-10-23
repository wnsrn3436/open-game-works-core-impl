extends "res://core/resource_core/tests/support/resource_test_case.gd"
## Fallback resources and the failure logs of `load` and `get_loaded`.


func test_unknown_key_gives_the_fallback_and_one_error() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	for i: int in 3:
		var resource: Resource = await ResourceCore.load(UNKNOWN, ANIMATION, scope)
		assert_true(resource is Animation and resource == fallback_of(ANIMATION), "load fallback")
		resource = ResourceCore.get_loaded(UNKNOWN, TEXTURE, scope)
		assert_true(resource is Texture2D and resource == fallback_of(TEXTURE), "get_loaded fallback")
	assert_errors(1)


func test_engine_load_failure_gives_the_fallback_and_one_error() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	for i: int in 3:
		var resource: Resource = await ResourceCore.load(MISSING_FILE, ANIMATION, scope)
		assert_true(resource == fallback_of(ANIMATION))
	assert_errors(1)
	assert_false(ResourceCore.is_loaded(MISSING_FILE, ANIMATION))


func test_kind_check_failure_gives_the_requested_kind_fallback_and_one_error() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	for i: int in 3:
		var resource: Resource = await ResourceCore.load(GRADIENT, ANIMATION, scope)
		assert_true(resource == fallback_of(ANIMATION), "a gradient is not an animation")
	assert_errors(1)
	assert_not_null(await load_animation(ANIM_A, scope))
	for i: int in 3:
		var cached: Resource = await ResourceCore.load(ANIM_A, TEXTURE, scope)
		assert_true(cached == fallback_of(TEXTURE), "a cached key requested as another kind")
		cached = ResourceCore.get_loaded(ANIM_A, SCENE, scope)
		assert_true(cached == fallback_of(SCENE))
	assert_errors(1, "one error for the cached key")
	assert_eq(reference_count(ANIM_A), 1, "the failed requests add no reference")


func test_missing_scope_gives_the_fallback_and_one_error() -> void:
	start()
	for i: int in 3:
		var resource: Resource = await ResourceCore.load(ANIM_A, ANIMATION, null)
		assert_true(resource == fallback_of(ANIMATION))
		resource = ResourceCore.get_loaded(ANIM_A, ANIMATION, null)
		assert_true(resource == fallback_of(ANIMATION))
	assert_errors(1)
	assert_false(ResourceCore.is_loaded(ANIM_A, ANIMATION), "nothing was loaded")
	assert_eq(ResourceCore._engine_load_count, 0)


func test_released_scope_gives_the_fallback_and_one_error() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	ResourceCore.release_scope(scope)
	for i: int in 3:
		var resource: Resource = await ResourceCore.load(ANIM_A, ANIMATION, scope)
		assert_true(resource == fallback_of(ANIMATION))
		resource = ResourceCore.get_loaded(ANIM_A, ANIMATION, scope)
		assert_true(resource == fallback_of(ANIMATION))
	assert_errors(1)
	assert_true(scope.keys.is_empty())
	assert_eq(ResourceCore._engine_load_count, 0)


func test_get_loaded_of_a_key_not_cached_or_loading_gives_the_fallback_and_one_error() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	for i: int in 3:
		var resource: Resource = ResourceCore.get_loaded(ANIM_A, ANIMATION, scope)
		assert_true(resource == fallback_of(ANIMATION))
	assert_errors(1)
	var runner: RUNNER = start_load(ANIM_B, ANIMATION, scope)
	assert_false(runner.done, "the load runs")
	for i: int in 3:
		var resource: Resource = ResourceCore.get_loaded(ANIM_B, ANIMATION, scope)
		assert_true(resource == fallback_of(ANIMATION))
	assert_errors(1)
	assert_eq(ResourceCore._engine_load_count, 1, "get_loaded starts no engine load")
	await runner.wait()
	assert_true(runner.resource is Animation and runner.resource != fallback_of(ANIMATION))
	assert_true(ResourceCore.get_loaded(ANIM_B, ANIMATION, scope) == runner.resource, "cached after the load")


func test_invalid_kind_gives_none_and_an_error() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	assert_null(await ResourceCore.load(ANIM_A, ResourceCore.INVALID_KIND, scope))
	assert_null(ResourceCore.get_loaded(ANIM_A, 999, scope))
	assert_false(ResourceCore.is_loaded(ANIM_A, ResourceCore.INVALID_KIND))
	assert_errors(2)


func test_fallback_is_in_no_reference_and_outlives_the_scope() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	var fallback: Resource = await ResourceCore.load(UNKNOWN, ANIMATION, scope)
	assert_errors(1)
	assert_false(scope.keys.has(UNKNOWN))
	assert_true(ResourceCoreDev.list_loaded_resources().is_empty())
	for listed: Scope in ResourceCoreDev.list_scopes():
		assert_true(listed.keys.is_empty(), "no scope has a reference")
	ResourceCore.release_scope(scope)
	assert_true(is_instance_valid(fallback))
	var other: Scope = new_scope("battle")
	assert_true(ResourceCore.get_loaded(UNKNOWN, ANIMATION, other) == fallback, "the same fallback after the release")


func test_base_kind_fallbacks_are_of_their_kind() -> void:
	start()
	var types: Array[Object] = [
		PackedScene, Texture2D, AudioStream, Font, Material, Shader, Mesh, Animation, SpriteFrames, TileSet
	]
	assert_eq(ResourceCore.BaseKind.size(), types.size())
	var scope: Scope = new_scope("lobby")
	for kind: int in types.size():
		var resource: Resource = ResourceCore.get_loaded(UNKNOWN, kind, scope)
		assert_not_null(resource, "kind %d has a fallback" % kind)
		assert_true(is_instance_of(resource, types[kind]), "kind %d fallback type" % kind)
	assert_errors(1)
