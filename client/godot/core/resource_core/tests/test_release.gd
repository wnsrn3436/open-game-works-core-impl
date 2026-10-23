extends "res://core/resource_core/tests/support/resource_test_case.gd"
## `release` while `load` and `preload_resources` wait.

var _listener_calls: int = 0


func before_each() -> void:
	super()
	_listener_calls = 0


func test_release_ends_waiting_load_and_preload_without_log() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	assert_not_null(await load_animation(ANIM_A, scope))
	var gradient_kind: int = ResourceCore.register_kind(Gradient, Gradient.new())
	var animation_fallback: Resource = fallback_of(ANIMATION)
	var load_runner: RUNNER = start_load(ANIM_B, ANIMATION, scope)
	var request: PreloadRequest = PreloadRequest.new()
	request.add_item(GRADIENT, gradient_kind)
	request.add_item(TEX, TEXTURE)
	var preload_runner: RUNNER = start_preload(request, scope)
	var warmup_request: PreloadRequest = PreloadRequest.new()
	warmup_request.add_item(MAT, MATERIAL, true)
	var warmup_runner: RUNNER = start_preload(warmup_request, scope)
	assert_false(load_runner.done or preload_runner.done or warmup_runner.done, "all wait")
	ResourceCore.add_scope_release_listener(_count_listener)
	ResourceCore.release()
	assert_true(load_runner.done)
	assert_true(load_runner.resource == animation_fallback, "the load ends with the fallback")
	assert_true(preload_runner.done)
	assert_false(preload_runner.ok, "the preload ends with false")
	assert_true(warmup_runner.done)
	assert_false(warmup_runner.ok)
	assert_eq(warns(), 0)
	assert_eq(_listener_calls, 0, "release calls no listener")
	assert_true(scope.released)
	assert_true(ResourceCore._cache.is_empty())
	assert_true(ResourceCore._scopes.is_empty())
	assert_true(ResourceCore._kinds.is_empty(), "no registered kind")
	assert_true(ResourceCore._loading.is_empty())
	await UnitTestCore.wait_frames(3)
	assert_false(ResourceCore.is_initialized())


func test_release_during_shader_warmup_destroys_the_instance() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	assert_not_null(await ResourceCore.load(PREFAB, SCENE, scope))
	var request: PreloadRequest = PreloadRequest.new()
	request.add_item(PREFAB, SCENE, true)
	var runner: RUNNER = start_preload(request, scope)
	var instance: Node = ResourceCore._warmups[0]
	assert_true(is_instance_valid(instance))
	ResourceCore.release()
	assert_true(runner.done)
	assert_false(runner.ok)
	assert_false(is_instance_valid(instance), "release destroyed the warmup instance")
	assert_eq(warns(), 0)


func _count_listener(_scope: Scope) -> void:
	_listener_calls += 1
