extends "res://core/resource_core/tests/support/resource_test_case.gd"
## Engine loads, the cache, references, `is_loaded` and registered kinds.

const SCRIPT_KIND = preload("res://core/resource_core/tests/support/resource_test_kind.gd")


func test_loads_of_a_loading_key_share_one_engine_load() -> void:
	start()
	var scene: Scope = new_scope("lobby")
	var panel: Scope = ResourceCore.create_scope(ResourceCore.ScopeKind.PANEL, "shop")
	var first: RUNNER = start_load(ANIM_A, ANIMATION, scene)
	var second: RUNNER = start_load(ANIM_A, ANIMATION, panel)
	var third: RUNNER = start_load(ANIM_A, ANIMATION, panel)
	assert_false(first.done or second.done or third.done, "the loads wait for the engine load")
	assert_eq(ResourceCore._engine_load_count, 1)
	await first.wait()
	await second.wait()
	await third.wait()
	assert_true(first.resource is Animation and first.resource != fallback_of(ANIMATION))
	assert_true(second.resource == first.resource)
	assert_true(third.resource == first.resource)
	assert_eq((first.resource as Animation).length, 1.0)
	assert_eq(ResourceCore._engine_load_count, 1)
	assert_eq(reference_count(ANIM_A), 2, "one reference per scope")


func test_engine_load_wait_starts_after_the_load_call() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	var runner: RUNNER = start_load(ANIM_A, ANIMATION, scope)
	assert_false(runner.done, "the load waits for the deferred engine load wait")
	assert_true(ResourceCore._loading.has(ANIM_A))
	assert_false(ResourceCore._loading[ANIM_A].done)
	await runner.wait()
	assert_true(runner.resource is Animation and runner.resource != fallback_of(ANIMATION))
	assert_true(ResourceCore._loading.is_empty())
	assert_errors(0)


func test_release_before_the_engine_load_wait_starts_leaves_the_next_init_alone() -> void:
	start()
	var old_runner: RUNNER = start_load(ANIM_A, ANIMATION, new_scope("lobby"))
	ResourceCore.release()
	assert_true(old_runner.done)
	start()
	var scope: Scope = new_scope("battle")
	var runner: RUNNER = start_load(ANIM_A, ANIMATION, scope)
	await runner.wait()
	assert_true(runner.resource is Animation and runner.resource != fallback_of(ANIMATION), "the new load got its resource")
	assert_true(ResourceCore._loading.is_empty())
	assert_eq(ResourceCore._engine_load_count, 1)
	assert_eq(reference_count(ANIM_A), 1)
	assert_errors(0)
	assert_eq(warns(), 0)


func test_cached_key_returns_without_engine_load() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	var loaded: Animation = await load_animation(ANIM_A, scope)
	assert_eq(ResourceCore._engine_load_count, 1)
	var other: Scope = new_scope("battle")
	var runner: RUNNER = start_load(ANIM_A, ANIMATION, other)
	assert_true(runner.done, "a cached key returns in the call")
	assert_true(runner.resource == loaded)
	assert_eq(ResourceCore._engine_load_count, 1)
	assert_true(ResourceCore.get_loaded(ANIM_A, ANIMATION, scope) == loaded)
	assert_eq(ResourceCore._engine_load_count, 1)


func test_one_scope_loading_a_key_many_times_adds_one_reference() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	for i: int in 3:
		assert_not_null(await load_animation(ANIM_A, scope))
		assert_not_null(ResourceCore.get_loaded(ANIM_A, ANIMATION, scope))
	assert_eq(reference_count(ANIM_A), 1)
	assert_eq(scope.keys, PackedStringArray([ANIM_A]))


func test_scope_release_drops_only_its_references() -> void:
	start()
	var scene: Scope = new_scope("lobby")
	var panel: Scope = ResourceCore.create_scope(ResourceCore.ScopeKind.PANEL, "shop")
	assert_not_null(await load_animation(ANIM_A, scene))
	assert_not_null(await load_animation(ANIM_A, panel))
	assert_not_null(await load_animation(ANIM_B, panel))
	assert_eq(reference_count(ANIM_A), 2)
	ResourceCore.release_scope(panel)
	assert_true(panel.released)
	assert_true(panel.keys.is_empty())
	assert_false(ResourceCore.is_loaded(ANIM_B, ANIMATION), "only the panel held anim_b")
	assert_true(ResourceCore.is_loaded(ANIM_A, ANIMATION))
	assert_eq(reference_count(ANIM_A), 1)
	assert_eq(ResourceCoreDev.list_loaded_resources().size(), 1)


func test_is_loaded_without_log() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	assert_false(ResourceCore.is_loaded(ANIM_A, ANIMATION), "not cached")
	var runner: RUNNER = start_load(ANIM_A, ANIMATION, scope)
	assert_false(ResourceCore.is_loaded(ANIM_A, ANIMATION), "loading")
	await runner.wait()
	assert_true(ResourceCore.is_loaded(ANIM_A, ANIMATION))
	assert_false(ResourceCore.is_loaded(ANIM_A, TEXTURE), "another kind")
	assert_false(ResourceCore.is_loaded(UNKNOWN, ANIMATION))
	assert_eq(warns(), 0)


func test_registered_kind_loads_its_type_and_falls_back() -> void:
	start()
	var fallback: Gradient = Gradient.new()
	var kind: int = ResourceCore.register_kind(Gradient, fallback)
	assert_ne(kind, ResourceCore.INVALID_KIND)
	assert_true(kind >= ResourceCore.BaseKind.size())
	var scope: Scope = new_scope("lobby")
	var gradient: Resource = await ResourceCore.load(GRADIENT, kind, scope)
	assert_true(gradient is Gradient and gradient != fallback)
	assert_eq(gradient.resource_path, RESOURCES + "test_gradient.tres")
	assert_true(ResourceCore.is_loaded(GRADIENT, kind))
	var curve: Resource = await ResourceCore.load(CURVE, kind, scope)
	assert_true(curve == fallback, "a curve is not a gradient")
	assert_errors(1)


func test_registered_script_kind() -> void:
	start()
	var fallback: Resource = SCRIPT_KIND.new()
	var kind: int = ResourceCore.register_kind(SCRIPT_KIND, fallback)
	assert_ne(kind, ResourceCore.INVALID_KIND)
	var scope: Scope = new_scope("lobby")
	assert_true(await ResourceCore.load(GRADIENT, kind, scope) == fallback)
	assert_errors(1)


func test_register_kind_again_changes_the_fallback() -> void:
	start()
	var kind: int = ResourceCore.register_kind(Gradient, Gradient.new())
	var second: Gradient = Gradient.new()
	assert_eq(ResourceCore.register_kind(Gradient, second), kind)
	var scope: Scope = new_scope("lobby")
	assert_true(ResourceCore.get_loaded(UNKNOWN, kind, scope) == second)
	assert_errors(1)
	assert_ne(ResourceCore.register_kind(Curve, Curve.new()), kind, "another type is another kind")


func test_register_kind_without_a_fallback_of_the_type_fails() -> void:
	start()
	assert_eq(ResourceCore.register_kind(Gradient, null), ResourceCore.INVALID_KIND)
	assert_eq(ResourceCore.register_kind(Gradient, Curve.new()), ResourceCore.INVALID_KIND)
	assert_eq(ResourceCore.register_kind(null, Gradient.new()), ResourceCore.INVALID_KIND)
	assert_errors(3)
	assert_eq(ResourceCore._kinds.size(), ResourceCore.BaseKind.size())


func test_is_loaded_and_get_loaded_of_a_held_key_allocate_no_memory() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	assert_not_null(await load_animation(ANIM_A, scope))
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
	assert_eq(reference_count(ANIM_A), 1)


func _query_held_key(scope: Scope) -> void:
	ResourceCore.is_loaded(ANIM_A, ANIMATION)
	ResourceCore.is_loaded(UNKNOWN, ANIMATION)
	ResourceCore.get_loaded(ANIM_A, ANIMATION, scope)
