extends "res://core/cutscene_core/tests/support/cutscene_test_case.gd"
## Start checks of `Move`, `Animate`, `Camera` and `ScreenEffect`: actor and target dimensions, the camera dimension,
## tween presets with no first change or a first change out of range. A failed start check logs one error, comes before
## the finalize of the same command and leaves the command in progress running. Also the parent-local position of
## `Move` for a 2D actor under a parent that is not a `CanvasItem` and for a 3D actor under any parent.

const COMMAND := preload("res://core/cutscene_core/cutscene_command.gd")
const CUE_FIRST: GameData.CutsceneCue = GameData.CutsceneCue.FIRST
const SPOT_3D_AT: Vector3 = Vector3(1, 2, 3)

var _rows: ROWS = null
var spot_3d: Node3D = null


func before_each() -> void:
	super()
	_rows = ROWS.new()
	spot_3d = null


## `start` with the rows of `_rows` and the 3D actor `spot_3d` at `SPOT_3D_AT`. Async.
func start_rows() -> bool:
	var started: bool = await start(true, true, _rows.tables())
	spot_3d = make_actor_3d("spot_3d", SPOT_3D_AT)
	return started


## A cutscene of two wait choice commands of `command` (the first without waiting, the second waiting), a `First` cue
## and `End`. `first` and `second` are [actor, target, resource].
func two_commands(command: GameData.CutsceneCommand, first: Array[String], second: Array[String]) -> int:
	var id_value: int = _rows.new_id()
	_rows.step(id_value, 1, command, false, first[0], first[1], first[2])
	_rows.step(id_value, 2, command, true, second[0], second[1], second[2])
	_rows.step(id_value, 3, GameData.CutsceneCommand.CUE, false, "", "", "", 0, CUE_FIRST)
	_rows.step(id_value, 4, GameData.CutsceneCommand.END)
	return id_value


## The command of `command` that is in progress, or `null`.
func in_progress(command: GameData.CutsceneCommand) -> COMMAND:
	for record: COMMAND in CutsceneCore._commands:
		if not record.done and record.command == command:
			return record
	return null


func attach_camera_2d(position: Vector2 = Vector2(30, 40)) -> Camera2D:
	var camera: Camera2D = Camera2D.new()
	camera.position = position
	get_tree().root.add_child(camera)
	autofree(camera)
	assert_true(CameraCore.attach_camera(camera))
	return camera


func attach_camera_3d() -> Camera3D:
	var camera: Camera3D = Camera3D.new()
	camera.position = Vector3(0, 10, 10)
	camera.rotation_degrees = Vector3(-60, 0, 0)
	get_tree().root.add_child(camera)
	autofree(camera)
	assert_true(CameraCore.attach_camera(camera))
	return camera


## Advances the test clock by `MOVE_MS` until the play call ends, at most five times. Async.
func run_to_end(call: PLAY) -> void:
	for i: int in 5:
		await advance(MOVE_MS)
		if call.done:
			break
	await finish(call)


func test_a_2d_actor_under_a_3d_parent_or_a_plain_node_reaches_the_2d_target() -> void:
	var cutscene: int = _rows.new_id()
	_rows.step(cutscene, 1, GameData.CutsceneCommand.MOVE, true, "under_3d", "spot", MOVE)
	_rows.step(cutscene, 2, GameData.CutsceneCommand.MOVE, true, "under_node", "spot_b", MOVE)
	_rows.step(cutscene, 3, GameData.CutsceneCommand.END)
	assert_true(await start_rows())
	var parent_3d: Node3D = Node3D.new()
	parent_3d.position = Vector3(7, -3, 5)
	parent_3d.rotation_degrees = Vector3(0, 30, 0)
	get_tree().root.add_child(parent_3d)
	autofree(parent_3d)
	var parent_node: Node = Node.new()
	get_tree().root.add_child(parent_node)
	autofree(parent_node)
	var under_3d: Node2D = make_actor("under_3d", Vector2(3, 4), parent_3d)
	var under_node: Node2D = make_actor("under_node", Vector2(-6, 8), parent_node)
	var call: PLAY = await play_id(cutscene)
	await run_to_end(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_almost_eq(under_3d.global_position, spot.global_position, Vector2(0.01, 0.01), "the parent is a Node3D")
	assert_almost_eq(under_node.global_position, spot_b.global_position, Vector2(0.01, 0.01), "the parent is a Node")
	assert_eq(errors(), 0)
	assert_eq(UnitTestCore.check_logs(ERROR, "TweenCore"), 0)


func test_a_3d_actor_reaches_the_3d_target_under_a_2d_parent_and_a_3d_parent() -> void:
	var cutscene: int = _rows.new_id()
	_rows.step(cutscene, 1, GameData.CutsceneCommand.MOVE, true, "under_2d", "spot_3d", MOVE)
	_rows.step(cutscene, 2, GameData.CutsceneCommand.MOVE, true, "under_3d", "spot_3d", MOVE)
	_rows.step(cutscene, 3, GameData.CutsceneCommand.END)
	assert_true(await start_rows())
	var stage: Node2D = Node2D.new()
	stage.position = Vector2(100, 0)
	get_tree().root.add_child(stage)
	autofree(stage)
	var pivot: Node3D = Node3D.new()
	pivot.position = Vector3(5, 0, -2)
	pivot.rotation_degrees = Vector3(0, 90, 0)
	pivot.scale = Vector3(2, 2, 2)
	get_tree().root.add_child(pivot)
	autofree(pivot)
	var under_2d: Node3D = make_actor_3d("under_2d", Vector3.ZERO, stage)
	var under_3d: Node3D = make_actor_3d("under_3d", Vector3(1, 1, 1), pivot)
	var call: PLAY = await play_id(cutscene)
	await run_to_end(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	var close: Vector3 = Vector3(0.01, 0.01, 0.01)
	assert_almost_eq(under_2d.global_position, SPOT_3D_AT, close, "the parent is a Node2D")
	assert_almost_eq(under_3d.global_position, SPOT_3D_AT, close, "the parent is a Node3D")
	assert_eq(errors(), 0)


func test_moves_between_2d_and_3d_log_one_error_each_move_nothing_and_the_next_step_runs() -> void:
	var cutscene: int = _rows.new_id()
	_rows.step(cutscene, 1, GameData.CutsceneCommand.MOVE, false, "hero", "spot", MOVE)
	_rows.step(cutscene, 2, GameData.CutsceneCommand.MOVE, true, "hero", "spot_3d", MOVE)
	_rows.step(cutscene, 3, GameData.CutsceneCommand.CUE, false, "", "", "", 0, CUE_FIRST)
	_rows.step(cutscene, 4, GameData.CutsceneCommand.MOVE, false, "hero_3d", "spot_3d", MOVE)
	_rows.step(cutscene, 5, GameData.CutsceneCommand.MOVE, true, "hero_3d", "spot", MOVE)
	_rows.step(cutscene, 6, GameData.CutsceneCommand.CUE, false, "", "", "", 0, CUE_FIRST)
	_rows.step(cutscene, 7, GameData.CutsceneCommand.END)
	assert_true(await start_rows())
	var hero_3d: Node3D = make_actor_3d("hero_3d", Vector3(-4, 0, 6))
	var call: PLAY = await play_id(cutscene)
	assert_eq(errors(), 2, "2D actor with a 3D target, 3D actor with a 2D target")
	assert_eq(cue_steps, PackedInt64Array([3, 6]), "the next steps ran")
	assert_almost_eq(hero.global_position, HERO_AT, Vector2(0.01, 0.01), "the Move of hero is not finalized")
	assert_almost_eq(hero_3d.global_position, Vector3(-4, 0, 6), Vector3(0.01, 0.01, 0.01), "nor the one of hero_3d")
	await run_to_end(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_almost_eq(hero.global_position, spot.global_position, Vector2(0.01, 0.01), "the first Move went on")
	assert_almost_eq(hero_3d.global_position, SPOT_3D_AT, Vector3(0.01, 0.01, 0.01), "the first Move went on")
	assert_eq(errors(), 0)


func test_a_camera_to_a_target_of_the_other_dimension_leaves_the_camera_in_progress() -> void:
	var cutscene: int = two_commands(GameData.CutsceneCommand.CAMERA, ["", "spot", MOVE], ["", "spot_3d", MOVE])
	assert_true(await start_rows())
	attach_camera_2d(Vector2(30, 40))
	var call: PLAY = await play_id(cutscene)
	assert_eq(errors(), 1)
	assert_eq(cue_steps, PackedInt64Array([3]))
	assert_not_null(in_progress(GameData.CutsceneCommand.CAMERA), "the first Camera is not finalized")
	var center: Vector3 = CameraCore.get_view_center()
	assert_ne(Vector2(center.x, center.y), spot.global_position, "the first Camera was not snapped to its target")
	await run_to_end(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	center = CameraCore.get_view_center()
	assert_almost_eq(Vector2(center.x, center.y), spot.global_position, Vector2(0.01, 0.01), "the first Camera went on")
	assert_eq(errors(), 0)
	assert_eq(UnitTestCore.check_logs(ERROR, "CameraCore"), 0)


func test_an_animate_of_a_missing_animation_leaves_the_animate_of_the_same_actor_in_progress() -> void:
	var cutscene: int = _rows.new_id()
	_rows.step(cutscene, 1, GameData.CutsceneCommand.ANIMATE, false, "hero", "", "", 0, GameData.CutsceneCue.NONE, "", "", "wave")
	_rows.step(cutscene, 2, GameData.CutsceneCommand.ANIMATE, true, "hero", "", "", 0, GameData.CutsceneCue.NONE, "", "", "missing")
	_rows.step(cutscene, 3, GameData.CutsceneCommand.CUE, false, "", "", "", 0, CUE_FIRST)
	_rows.step(cutscene, 4, GameData.CutsceneCommand.END)
	assert_true(await start_rows())
	var call: PLAY = await play_id(cutscene)
	assert_eq(errors(), 1)
	assert_eq(cue_steps, PackedInt64Array([3]))
	var player: AnimationPlayer = player_of(hero)
	assert_eq(player.current_animation, &"wave")
	assert_true(player.current_animation_position < WAVE_S, "the first Animate is not at its end")
	assert_false(call.done, "the first Animate is in progress")
	player.advance(WAVE_S)
	await UnitTestCore.wait_frames(1)
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)


func test_a_camera_with_no_first_change_moves_no_camera_when_played_or_skipped() -> void:
	var played: int = _rows.new_id()
	_rows.step(played, 1, GameData.CutsceneCommand.CAMERA, true, "", "spot", EMPTY)
	_rows.step(played, 2, GameData.CutsceneCommand.CUE, false, "", "", "", 0, CUE_FIRST)
	_rows.step(played, 3, GameData.CutsceneCommand.END)
	var skipped: int = _rows.new_id()
	_rows.step(skipped, 1, GameData.CutsceneCommand.MOVE, true, "hero", "spot_b", MOVE)
	_rows.step(skipped, 2, GameData.CutsceneCommand.CAMERA, true, "", "spot", EMPTY)
	_rows.step(skipped, 3, GameData.CutsceneCommand.CUE, false, "", "", "", 0, CUE_FIRST)
	_rows.step(skipped, 4, GameData.CutsceneCommand.END)
	assert_true(await start_rows())
	attach_camera_2d(Vector2(30, 40))
	var call: PLAY = await play_id(played)
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 1)
	assert_eq(cue_steps, PackedInt64Array([2]))
	assert_almost_eq(CameraCore.get_view_center(), Vector3(30, 40, 0), Vector3(0.01, 0.01, 0.01))
	call = await play_id(skipped)
	assert_eq(CutsceneCore._hold, CutsceneCore._HOLD_COMMAND, "the Move runs")
	await press_skip()
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.SKIPPED)
	assert_eq(errors(), 1, "skip application of the Camera")
	assert_almost_eq(CameraCore.get_view_center(), Vector3(30, 40, 0), Vector3(0.01, 0.01, 0.01), "the camera stays")
	assert_eq(UnitTestCore.check_logs(ERROR, "CameraCore"), 0)


func test_a_camera_with_no_first_change_leaves_the_camera_in_progress() -> void:
	var cutscene: int = two_commands(GameData.CutsceneCommand.CAMERA, ["", "spot", MOVE], ["", "spot_b", EMPTY])
	assert_true(await start_rows())
	attach_camera_2d(Vector2(30, 40))
	var call: PLAY = await play_id(cutscene)
	assert_eq(errors(), 1)
	assert_eq(cue_steps, PackedInt64Array([3]))
	assert_not_null(in_progress(GameData.CutsceneCommand.CAMERA), "the first Camera is not finalized")
	await run_to_end(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	var center: Vector3 = CameraCore.get_view_center()
	assert_almost_eq(Vector2(center.x, center.y), spot.global_position, Vector2(0.01, 0.01), "the first Camera went on")
	assert_eq(errors(), 0)
	assert_eq(UnitTestCore.check_logs(ERROR, "CameraCore"), 0)


func test_a_camera_whose_first_change_is_longer_than_the_max_duration_leaves_the_camera_in_progress() -> void:
	set_setting("TweenCore.maxDurationMs", MOVE_MS)
	var cutscene: int = two_commands(GameData.CutsceneCommand.CAMERA, ["", "spot", MOVE], ["", "spot_b", LONG])
	assert_true(await start_rows())
	attach_camera_2d(Vector2(30, 40))
	var call: PLAY = await play_id(cutscene)
	assert_eq(errors(), 1)
	assert_eq(cue_steps, PackedInt64Array([3]))
	assert_not_null(in_progress(GameData.CutsceneCommand.CAMERA), "the first Camera is not finalized")
	await run_to_end(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	var center: Vector3 = CameraCore.get_view_center()
	assert_almost_eq(Vector2(center.x, center.y), spot.global_position, Vector2(0.01, 0.01), "the first Camera went on")
	assert_eq(errors(), 0)
	assert_eq(UnitTestCore.check_logs(ERROR, "CameraCore"), 0)


func test_a_camera_whose_first_change_duration_is_negative_leaves_the_camera_in_progress() -> void:
	var cutscene: int = two_commands(GameData.CutsceneCommand.CAMERA, ["", "spot", MOVE], ["", "spot_b", NEGATIVE])
	assert_true(await start_rows())
	attach_camera_2d(Vector2(30, 40))
	var call: PLAY = await play_id(cutscene)
	assert_eq(errors(), 1)
	assert_eq(UnitTestCore.check_logs(ERROR, "CameraCore"), 0, "CameraCore did not get the preset")
	assert_eq(cue_steps, PackedInt64Array([3]))
	assert_not_null(in_progress(GameData.CutsceneCommand.CAMERA), "the first Camera is not finalized")
	var center: Vector3 = CameraCore.get_view_center()
	assert_ne(Vector2(center.x, center.y), spot.global_position, "the first Camera was not snapped to its target")
	await run_to_end(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	center = CameraCore.get_view_center()
	assert_almost_eq(Vector2(center.x, center.y), spot.global_position, Vector2(0.01, 0.01), "the first Camera went on")
	assert_eq(errors(), 0)
	assert_eq(UnitTestCore.check_logs(ERROR, "CameraCore"), 0)


func test_a_screen_effect_whose_preset_did_not_load_leaves_the_screen_effect_in_progress() -> void:
	var cutscene: int = two_commands(GameData.CutsceneCommand.SCREEN_EFFECT, ["", "", FADE], ["", "", MISSING_TWEEN])
	assert_true(await start_rows())
	var call: PLAY = await play_id(cutscene)
	assert_eq(errors(), 1)
	assert_gt(UnitTestCore.check_logs(ERROR, "ResourceCore"), 0, "the preset did not load")
	assert_eq(cue_steps, PackedInt64Array([3]))
	var record: COMMAND = in_progress(GameData.CutsceneCommand.SCREEN_EFFECT)
	assert_not_null(record, "the first ScreenEffect is not finalized")
	var effect: ScreenEffectHandle = record.effect if record != null else null
	assert_false(effect == null or effect._done, "the first ScreenEffect runs")
	await run_to_end(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_true(effect != null and effect._done)
	assert_eq(errors(), 0)
	assert_eq(UnitTestCore.check_logs(ERROR, "ScreenEffectCore"), 0)


func test_a_move_whose_preset_step_0_is_empty_leaves_the_move_of_the_same_actor_in_progress() -> void:
	var cutscene: int = two_commands(GameData.CutsceneCommand.MOVE, ["hero", "spot", MOVE], ["hero", "spot_b", EMPTY_STEP])
	assert_true(await start_rows())
	var call: PLAY = await play_id(cutscene)
	assert_eq(errors(), 1)
	assert_eq(cue_steps, PackedInt64Array([3]))
	assert_almost_eq(hero.global_position, HERO_AT, Vector2(0.01, 0.01), "the first Move is not finalized")
	await run_to_end(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_almost_eq(hero.global_position, spot.global_position, Vector2(0.01, 0.01), "the first Move went on")
	assert_eq(errors(), 0)


func test_a_3d_camera_with_a_2d_target_moves_no_camera_when_played_or_skipped() -> void:
	var played: int = _rows.new_id()
	_rows.step(played, 1, GameData.CutsceneCommand.CAMERA, true, "", "spot", MOVE)
	_rows.step(played, 2, GameData.CutsceneCommand.CUE, false, "", "", "", 0, CUE_FIRST)
	_rows.step(played, 3, GameData.CutsceneCommand.END)
	var skipped: int = _rows.new_id()
	_rows.step(skipped, 1, GameData.CutsceneCommand.MOVE, true, "hero", "spot_b", MOVE)
	_rows.step(skipped, 2, GameData.CutsceneCommand.CAMERA, true, "", "spot", MOVE)
	_rows.step(skipped, 3, GameData.CutsceneCommand.END)
	assert_true(await start_rows())
	attach_camera_3d()
	var before: Vector3 = CameraCore.get_view_center()
	var call: PLAY = await play_id(played)
	assert_eq(cue_steps, PackedInt64Array([2]), "the Camera ended at once")
	await finish(call)
	assert_eq(errors(), 1)
	assert_almost_eq(CameraCore.get_view_center(), before, Vector3(0.01, 0.01, 0.01))
	call = await play_id(skipped)
	await press_skip()
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.SKIPPED)
	assert_eq(errors(), 1, "skip application of the Camera")
	assert_almost_eq(CameraCore.get_view_center(), before, Vector3(0.01, 0.01, 0.01), "the camera stays")
	assert_eq(UnitTestCore.check_logs(ERROR, "CameraCore"), 0)


func test_a_2d_camera_with_a_3d_target_moves_no_camera_when_played_or_skipped() -> void:
	var played: int = _rows.new_id()
	_rows.step(played, 1, GameData.CutsceneCommand.CAMERA, true, "", "spot_3d", MOVE)
	_rows.step(played, 2, GameData.CutsceneCommand.CUE, false, "", "", "", 0, CUE_FIRST)
	_rows.step(played, 3, GameData.CutsceneCommand.END)
	var skipped: int = _rows.new_id()
	_rows.step(skipped, 1, GameData.CutsceneCommand.MOVE, true, "hero", "spot_b", MOVE)
	_rows.step(skipped, 2, GameData.CutsceneCommand.CAMERA, true, "", "spot_3d", MOVE)
	_rows.step(skipped, 3, GameData.CutsceneCommand.END)
	assert_true(await start_rows())
	attach_camera_2d(Vector2(30, 40))
	var call: PLAY = await play_id(played)
	assert_eq(cue_steps, PackedInt64Array([2]), "the Camera ended at once")
	await finish(call)
	assert_eq(errors(), 1)
	assert_almost_eq(CameraCore.get_view_center(), Vector3(30, 40, 0), Vector3(0.01, 0.01, 0.01))
	call = await play_id(skipped)
	await press_skip()
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.SKIPPED)
	assert_eq(errors(), 1, "skip application of the Camera")
	assert_almost_eq(CameraCore.get_view_center(), Vector3(30, 40, 0), Vector3(0.01, 0.01, 0.01), "the camera stays")
	assert_eq(UnitTestCore.check_logs(ERROR, "CameraCore"), 0)
