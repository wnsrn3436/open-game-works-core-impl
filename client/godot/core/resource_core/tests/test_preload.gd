extends "res://core/resource_core/tests/support/resource_test_case.gd"
## `preload_resources`, its progress and the shader warmup.


func test_preload_counts_each_item_and_references_the_successes() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	assert_not_null(await load_animation(ANIM_A, scope))
	var request: PreloadRequest = PreloadRequest.new()
	request.add_item(ANIM_A, ANIMATION)
	request.add_item(ANIM_B, ANIMATION)
	request.add_item(TEX, TEXTURE)
	assert_eq(request.total_count, 3)
	var runner: RUNNER = start_preload(request, scope)
	assert_false(runner.done)
	assert_eq(request.done_count, 1, "the cached item ended in the call")
	assert_eq(request.total_count, 3)
	var item_load: RUNNER = start_load(ANIM_B, ANIMATION, scope)
	await item_load.wait()
	assert_true(request.done_count >= 2, "the anim_b item ended with its engine load")
	await runner.wait()
	assert_true(runner.ok)
	assert_eq(request.done_count, request.total_count)
	assert_true(scope.keys.has(ANIM_A))
	assert_true(scope.keys.has(ANIM_B))
	assert_true(scope.keys.has(TEX))
	assert_true(ResourceCore.is_loaded(TEX, TEXTURE))


func test_preload_with_a_fallback_item_is_false() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	var request: PreloadRequest = PreloadRequest.new()
	request.add_item(ANIM_A, ANIMATION)
	request.add_item(UNKNOWN, ANIMATION)
	request.add_item(GRADIENT, TEXTURE)
	assert_false(await ResourceCore.preload_resources(request, scope))
	assert_errors(2)
	assert_eq(request.done_count, 3, "failed items are counted")
	assert_eq(scope.keys, PackedStringArray([ANIM_A]), "only the success has a reference")


func test_empty_preload_is_true() -> void:
	start()
	var request: PreloadRequest = PreloadRequest.new()
	assert_true(await ResourceCore.preload_resources(request, new_scope("lobby")))
	assert_eq(request.done_count, 0)
	assert_eq(request.total_count, 0)


func test_preload_ends_after_the_shader_warmup() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	var prefab: Resource = await ResourceCore.load(PREFAB, SCENE, scope)
	assert_true(prefab is PackedScene and prefab != fallback_of(SCENE))
	prefab = null
	var request: PreloadRequest = PreloadRequest.new()
	request.add_item(PREFAB, SCENE, true)
	var started_frame: int = Engine.get_process_frames()
	var runner: RUNNER = start_preload(request, scope)
	assert_false(runner.done, "the warmup draws frames")
	assert_eq(request.done_count, 0)
	assert_eq(ResourceCore._warmup_holder.get_child_count(), 1, "a warmup instance is shown")
	await runner.wait()
	assert_true(runner.ok)
	assert_eq(request.done_count, 1)
	assert_true(Engine.get_process_frames() - started_frame >= 2, "the instance drew two frames")
	assert_eq(ResourceCore._warmup_holder.get_child_count(), 0, "the warmup instance is gone")
	assert_true(ResourceCore._warmups.is_empty())


func test_material_shader_warmup() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	var request: PreloadRequest = PreloadRequest.new()
	request.add_item(MAT, MATERIAL, true)
	request.add_item(ANIM_A, ANIMATION)
	assert_true(await ResourceCore.preload_resources(request, scope))
	assert_eq(request.done_count, 2)
	assert_true(scope.keys.has(MAT))
	assert_eq(ResourceCore._warmup_holder.get_child_count(), 0)


func test_shader_warmup_of_a_kind_that_cannot_warm_up_loads_and_fails() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	var request: PreloadRequest = PreloadRequest.new()
	request.add_item(TEX, TEXTURE, true)
	assert_false(await ResourceCore.preload_resources(request, scope))
	assert_errors(1)
	assert_eq(request.done_count, 1)
	assert_true(ResourceCore.is_loaded(TEX, TEXTURE), "the item was loaded")


func test_preload_of_a_running_request_fails() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	var request: PreloadRequest = PreloadRequest.new()
	request.add_item(ANIM_A, ANIMATION)
	var runner: RUNNER = start_preload(request, scope)
	assert_false(runner.done)
	assert_false(await ResourceCore.preload_resources(request, scope))
	assert_errors(1)
	await runner.wait()
	assert_true(runner.ok, "the first preload goes on")
	assert_eq(request.done_count, 1)
	assert_true(await ResourceCore.preload_resources(request, scope), "a request can preload again after it ended")


func test_preload_without_a_request_fails() -> void:
	start()
	assert_false(await ResourceCore.preload_resources(null, new_scope("lobby")))
	assert_errors(1)
