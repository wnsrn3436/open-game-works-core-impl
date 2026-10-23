extends "res://core/tutorial_core/tests/support/tutorial_test_case.gd"
## Lifecycle: `init`, `release`, the init check, the operations outside `init` and `release` with active tutorials.


func test_init_release_and_the_init_check() -> void:
	assert_true(await start())
	assert_true(TutorialCore.is_initialized())
	assert_false(TutorialCore.init())
	assert_eq(errors(), 1)
	var node: Node = TutorialCore._node
	assert_true(node.is_inside_tree())
	TutorialCore.release()
	assert_false(TutorialCore.is_initialized())
	assert_false(node.is_inside_tree())
	assert_eq(TutorialCore._session, null)
	assert_eq(TutorialCore._node, null)
	assert_eq(TutorialCore._view_key, "")
	assert_eq(TutorialCore._anchor_wait_warn_ms, 0)
	assert_false(TutorialCore._gamepad_supported)
	assert_true(TutorialCore._can_start_hook.is_null())
	assert_false(TutorialCore._defs_made)
	assert_eq(TutorialCore._defs.size(), 0)
	assert_eq(TutorialCore._defs_by_id.size(), 0)
	assert_eq(TutorialCore._done_steps.size(), 0)
	assert_eq(TutorialCore._save_steps.size(), 0)
	assert_eq(TutorialCore._check_failed.size(), 0)
	assert_eq(TutorialCore._pending_saves.size(), 0)
	assert_eq(TutorialCore._runs.size(), 0)
	assert_eq(TutorialCore._shown, null)
	assert_eq(TutorialCore._last_shown_id, 0)
	assert_false(TutorialCore._scene_stopped)
	assert_false(TutorialCore._start_watched)
	assert_eq(TutorialCore._start_watches.size(), 0)
	assert_false(TutorialCore._checking)
	assert_false(TutorialCore._check_again)
	assert_false(TutorialCore._start_check_deferred)
	assert_eq(TutorialCore._step_watches.size(), 0)
	assert_eq(TutorialCore._tap_run, null)
	assert_eq(TutorialCore._tap_serial, 0)
	assert_eq(TutorialCore._view_state, TutorialCore._VIEW_NONE)
	assert_eq(TutorialCore._layer, null)
	assert_eq(TutorialCore._safe_root, null)
	assert_eq(TutorialCore._view_root, null)
	assert_eq(TutorialCore._view, null)
	assert_eq(TutorialCore._material, null)
	assert_eq(TutorialCore._bubble_home, Vector2.ZERO)
	assert_true(TutorialCore.init())
	assert_true(TutorialCore.is_initialized())


func test_operations_before_init_log_an_error_and_return_the_failure_value() -> void:
	# The error logs are counted from LogCore, so it starts first.
	assert_true(LogCore.init())
	assert_false(TutorialCore.is_initialized())
	assert_false(TutorialCore.check_start())
	assert_false(TutorialCore.notify_cue(GameData.TutorialCue.OPENED))
	assert_false(TutorialCore.skip())
	assert_false(TutorialCore.is_running())
	var current: CurrentResult = TutorialCore.current()
	assert_eq(current.tutorial_id, 0)
	assert_eq(current.step, 0)
	assert_false(TutorialCore.is_completed(1))
	assert_eq(errors(), 6)


func test_a_destroyed_core_node_cleans_up_like_release() -> void:
	assert_true(await start())
	add_anchor("tc_anchor", Rect2(560, 300, 160, 60))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_anchor]"])))
	assert_true(await wait_shown())
	var root: Control = TutorialCore._view_root
	var node: Node = TutorialCore._node
	node.free()
	assert_false(TutorialCore.is_initialized())
	assert_false(has_block())
	await frames(2)
	assert_false(is_instance_valid(root))


func test_release_removes_the_view_and_the_block_and_sends_no_more_saves() -> void:
	assert_true(await start())
	add_anchor("tc_anchor", Rect2(560, 300, 160, 60))
	assert_true(await start_tutorials(PackedStringArray(["[tutorial_anchor]"])))
	assert_true(await wait_shown())
	assert_true(has_block())
	var root: Control = TutorialCore._view_root
	TutorialCore.release()
	assert_false(has_block())
	await frames(2)
	assert_false(is_instance_valid(root))
	await touch_user_state()
	await advance(1000)
	assert_eq(saves(), PackedStringArray())
	assert_true(TutorialCore.init())
	assert_true(TutorialCore.register_can_start_tutorial(_can_start))
	assert_false(view_visible())


func test_a_lambda_or_a_bound_hook_is_refused_and_a_second_hook_is_ignored() -> void:
	assert_true(await start(false, false))
	assert_false(TutorialCore.register_can_start_tutorial(func(_id: int) -> bool: return true))
	assert_false(TutorialCore.register_can_start_tutorial(_can_start.bind(1)))
	assert_eq(errors(), 2)
	assert_true(TutorialCore.register_can_start_tutorial(_can_start))
	assert_false(TutorialCore.register_can_start_tutorial(_can_start))
	assert_eq(errors(), 1)
